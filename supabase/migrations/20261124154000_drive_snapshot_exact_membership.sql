begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '30s';

-- This is the embedded ERP export time. Drive's modified time can arrive later.
create function private.drive_workbook_export_at_v3088(p_filename text)
returns timestamptz language plpgsql immutable set search_path = '' as $export$
declare
  stamp text := substring(p_filename from '(?i)^DriveAroundMC-[0-9]+-[0-9]{6}([0-9]{14})[.]xlsx$');
begin
  if stamp is null then return null; end if;
  return make_timestamptz(substr(stamp,1,4)::integer,substr(stamp,5,2)::integer,
    substr(stamp,7,2)::integer,substr(stamp,9,2)::integer,substr(stamp,11,2)::integer,
    substr(stamp,13,2)::double precision,'America/Chicago');
end
$export$;

create function private.assert_exact_drive_snapshot_size_v3088(p_row_count integer)
returns void language plpgsql set search_path = '' as $size$
declare
  previous_rows integer;
begin
  select s.expected_rows into previous_rows
  from public.app_dataset_revisions r
  join private.fast_erp_stage_runs_v1 s on s.committed_result->>'runId'=r.source_import_run_id::text
  where r.key='ph_master_inventory' and s.dataset_key='drive_around' and s.stage_state='committed'
    and s.expected_rows=s.staged_rows and s.file_meta->>'file_id'=r.source_file_id
  limit 1;
  if previous_rows is null then
    select count(*)::integer into previous_rows from public.ph_master_inventory where erp_source_present;
  end if;
  if p_row_count is null or p_row_count < 1 or p_row_count::numeric < previous_rows * 0.80 then
    raise exception using errcode='22023',message='DRIVE_SNAPSHOT_INCOMPLETE',
      detail=format('Incoming rows: %s. Prior complete rows: %s.',p_row_count,previous_rows);
  end if;
end
$size$;

-- A bare bulk RPC remains available for non-workbook operations. Only a
-- complete native Drive workbook may take the exact replacement path.
create function private.prepare_exact_drive_snapshot_v3088(p_row_count integer)
returns timestamptz language plpgsql set search_path = '' as $prepare$
declare
  workbook_name text;
  count_named integer;
  count_workbooks integer;
  export_at timestamptz;
  prior_export_at timestamptz;
begin
  select min(s.filename),count(s.filename),count(distinct s.filename)
  into workbook_name,count_named,count_workbooks from pg_temp.ph_master_bulk_stage_v1 s
  where s.filename ~* '^DriveAroundMC-';
  if count_named=0 then return null; end if;
  export_at:=private.drive_workbook_export_at_v3088(workbook_name);
  if export_at is null or count_named<>p_row_count or count_workbooks<>1 then
    raise exception using errcode='22023',message='DRIVE_SNAPSHOT_WORKBOOK_IDENTITY_INVALID';
  end if;
  select private.drive_workbook_export_at_v3088(source_file_name) into prior_export_at
    from public.app_dataset_revisions where key='ph_master_inventory';
  if export_at<prior_export_at then
    raise exception using errcode='22023',message='DRIVE_SNAPSHOT_OLDER_THAN_PUBLISHED';
  end if;
  perform private.assert_exact_drive_snapshot_size_v3088(p_row_count);
  if exists(select 1 from pg_temp.ph_master_bulk_stage_v1 s
    where nullif(btrim(s.itemcode),'') is null or nullif(btrim(s.locationcode),'') is null
      or nullif(btrim(s.lotcode),'') is null or not (s.raw_values ? 'ptronhand')) then
    raise exception using errcode='22023',message='DRIVE_SNAPSHOT_ROW_IDENTITY_INCOMPLETE';
  end if;

  drop table if exists pg_temp.exact_drive_input_v3088;
  create temp table exact_drive_input_v3088 on commit drop as
    select row_number,source_unique_id,canonical_unique_id,candidate_count from pg_temp.ph_master_bulk_map_v1;
  alter table pg_temp.exact_drive_input_v3088 add primary key(row_number);
  return export_at;
end
$prepare$;

create function private.archive_retiring_drive_notes_v3088(p_ids text[])
returns void language sql set search_path = '' as $notes$
  insert into public.ph_location_sales_notes(
    unique_id,source,itemcode,locationcode,lotcode,spec,caliper,loc_match_pct,loc_photo_match,
    av_note,pick_note,sales_note,photo_link,photo_name,photos,photo_url,photo_date,completed_at,
    eval_baseline_available,initial_loc_photo_match,updated_at)
  select m.unique_id,coalesce(m.source,''),m.itemcode,m.locationcode,coalesce(m.lotcode,''),
    m.spec,m.caliper,coalesce(m.loc_match_pct,private.request_numeric_v2362(m.match)),m.loc_photo_match,
    m.av_note,coalesce(m.pick_note,m.pic_note),m.sales_note,m.photo_link,m.photo_name,m.photos,m.photo_url,
    m.photo_date,m.date_completed,m.eval_baseline_available,m.initial_loc_photo_match,
    coalesce(m.last_updated,statement_timestamp())
  from public.ph_master_inventory m where m.unique_id=any(p_ids)
    and (coalesce(m.spec,m.caliper,m.match,m.av_note,m.pick_note,m.pic_note,m.sales_note,
      m.photo_link,m.photo_url) is not null or m.loc_match_pct is not null or m.date_completed is not null
      or coalesce(m.photos,'[]'::jsonb) not in ('[]'::jsonb,'null'::jsonb))
  on conflict(unique_id) do nothing;
$notes$;

create function private.retire_absent_drive_overrides_v3088(p_ids text[],p_run_id uuid)
returns void language plpgsql set search_path = '' as $retire$
begin
  update app_sync_private.inventory_live_overrides_v1 set pending=false,reconciled_at=statement_timestamp()
    where canonical_unique_id=any(p_ids) and pending;
  update public.app_row_actions set reconciliation_status='superseded',sync_run_id=p_run_id
    where canonical_unique_id=any(p_ids) and reconciliation_status='pending';
  update private.ph_inventory_reclass_movements_v1 set status='conflict',
    conflict_reason='source_retired_by_erp',updated_at=statement_timestamp()
    where (source_unique_id=any(p_ids) or destination_unique_id=any(p_ids))
      and status in ('pending','conflict') and conflict_reason is distinct from 'source_retired_by_erp';
  delete from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id=any(p_ids);
  delete from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id=any(p_ids);
  delete from app_sync_private.ph_master_inventory_item6_edits_v7 where canonical_unique_id=any(p_ids);
  delete from app_sync_private.ph_master_inventory_item6_source_v7 where canonical_unique_id=any(p_ids);
  delete from app_sync_private.ph_master_inventory_item6_aliases_v7 where canonical_unique_id=any(p_ids);
  delete from private.ph_inventory_reclass_import_aliases_v1 where canonical_unique_id=any(p_ids);
  delete from app_sync_private.ph_master_bulk_import_source_v1 where canonical_unique_id=any(p_ids);
end
$retire$;

create function private.prune_absent_drive_inventory_v3088(p_ids text[],p_export_at timestamptz,p_run_id uuid)
returns integer language plpgsql set search_path = '' as $prune$
declare
  retired_ids text[];
  deleted_rows integer;
begin
  if p_export_at is null or p_run_id is null or coalesce(cardinality(p_ids),0)=0
    or array_position(p_ids,null) is not null then
    raise exception using errcode='22023',message='DRIVE_SNAPSHOT_MEMBERSHIP_INVALID';
  end if;
  select coalesce(array_agg(absent.unique_id),'{}'::text[]) into retired_ids from (
    select live.unique_id from public.ph_master_inventory live
    where not exists(select 1 from unnest(p_ids) current_row(uid) where current_row.uid=live.unique_id)
      and (live.erp_source_present or live.erp_source_filename ~* '^DriveAround'
        or live.filename ~* '^DriveAround' or exists(
          select 1 from app_sync_private.ph_master_bulk_import_source_v1 b
          where b.canonical_unique_id=live.unique_id) or exists(
          select 1 from private.ph_inventory_reclass_movements_v1 m
          where m.destination_unique_id=live.unique_id and m.destination_before is null))
      and not exists(
        select 1 from private.ph_inventory_reclass_movements_v1 m
        join private.ph_inventory_reclass_commands_v1 c using(request_id)
        where m.destination_unique_id=live.unique_id and m.destination_before is null and m.status='pending'
          and c.created_at>p_export_at and m.source_unique_id=any(p_ids))
    order by live.unique_id for update of live
  ) absent;
  if cardinality(retired_ids)=0 then return 0; end if;
  perform private.archive_retiring_drive_notes_v3088(retired_ids);
  perform private.retire_absent_drive_overrides_v3088(retired_ids,p_run_id);
  delete from public.ph_master_inventory where unique_id=any(retired_ids);
  get diagnostics deleted_rows=row_count;
  if deleted_rows<>cardinality(retired_ids) then
    raise exception using errcode='55000',message='DRIVE_SNAPSHOT_DELETE_RECEIPT_MISMATCH';
  end if;
  return deleted_rows;
end
$prune$;

create function private.finish_exact_drive_snapshot_v3088(p_export_at timestamptz,p_run_id uuid,p_count integer)
returns integer language plpgsql set search_path = '' as $finish$
declare
  current_ids text[];
begin
  select array_agg(live.unique_id) into current_ids
  from pg_temp.ph_master_bulk_stage_v1 as source
  join pg_temp.ph_master_bulk_map_v1 as mapped using(row_number)
  join public.ph_master_inventory live on live.unique_id=mapped.canonical_unique_id;
  if cardinality(current_ids) is distinct from p_count then
    raise exception using errcode='55000',message='DRIVE_SNAPSHOT_CANONICAL_MEMBERSHIP_INCOMPLETE';
  end if;
  insert into app_sync_private.ph_master_bulk_import_source_v1 as membership(
    canonical_unique_id,source_unique_id,source_hash,import_run_id)
  select mapped.canonical_unique_id,mapped.source_unique_id,source.source_hash,p_run_id
  from pg_temp.ph_master_bulk_map_v1 mapped join pg_temp.ph_master_bulk_stage_v1 source using(row_number)
  on conflict(canonical_unique_id) do update set source_unique_id=excluded.source_unique_id,
    source_hash=excluded.source_hash,import_run_id=excluded.import_run_id,updated_at=statement_timestamp()
  where (membership.source_unique_id,membership.source_hash,membership.import_run_id)
    is distinct from (excluded.source_unique_id,excluded.source_hash,excluded.import_run_id);
  return private.prune_absent_drive_inventory_v3088(current_ids,p_export_at,p_run_id);
end
$finish$;

-- Repair the already-published snapshot from its retained exact staging rows.
-- Lock the READY receipt and verify a one-to-one mapping before any deletion.
create function private.reconcile_published_drive_membership_v3088()
returns integer language plpgsql set search_path = '' as $repair$
declare
  published public.app_dataset_revisions%rowtype;
  workbook private.fast_erp_stage_runs_v1%rowtype;
  export_at timestamptz;
  raw_count integer;
  distinct_raw integer;
  distinct_live integer;
  current_ids text[];
begin
  select * into published from public.app_dataset_revisions where key='ph_master_inventory' for update;
  if published.state is distinct from 'ready' or published.source_import_run_id is null then
    raise exception 'DRIVE_SNAPSHOT_READY_RECEIPT_REQUIRED';
  end if;
  select s.* into strict workbook from private.fast_erp_stage_runs_v1 s
  where s.dataset_key='drive_around' and s.stage_state='committed' and s.expected_rows=s.staged_rows
    and s.committed_result @> jsonb_build_object('runId',published.source_import_run_id,'published',true,'sourceRows',s.expected_rows)
    and s.file_meta->>'file_name'=published.source_file_name and s.file_meta->>'file_id'=published.source_file_id
    and nullif(s.file_meta->>'content_hash','') is not distinct from published.source_content_hash;
  export_at:=private.drive_workbook_export_at_v3088(published.source_file_name);
  if export_at is null or workbook.expected_rows<1 then raise exception 'DRIVE_SNAPSHOT_ARCHIVED_WORKBOOK_INVALID'; end if;
  lock table public.ph_master_inventory in share row exclusive mode;
  with input as materialized (
    select coalesce(row_value->'values',row_value)->>'unique_id' as source_uid
    from private.fast_erp_stage_rows_v1 where stage_id=workbook.stage_id
  )
  select count(*),count(distinct input.source_uid),count(distinct live.unique_id),array_agg(live.unique_id)
    into raw_count,distinct_raw,distinct_live,current_ids
  from input left join app_sync_private.ph_master_bulk_import_source_v1 mapped on mapped.source_unique_id=input.source_uid
  left join public.ph_master_inventory live on live.unique_id=coalesce(mapped.canonical_unique_id,input.source_uid);
  if (raw_count,distinct_raw,distinct_live) is distinct from (workbook.expected_rows,workbook.expected_rows,workbook.expected_rows) then
    raise exception 'DRIVE_SNAPSHOT_ARCHIVED_MEMBERSHIP_INCOMPLETE';
  end if;
  update app_sync_private.ph_master_bulk_import_source_v1 set import_run_id=published.source_import_run_id
    where canonical_unique_id=any(current_ids) and import_run_id is distinct from published.source_import_run_id;
  return private.prune_absent_drive_inventory_v3088(current_ids,export_at,published.source_import_run_id);
end
$repair$;

revoke all on function private.drive_workbook_export_at_v3088(text),
  private.assert_exact_drive_snapshot_size_v3088(integer),private.prepare_exact_drive_snapshot_v3088(integer),
  private.archive_retiring_drive_notes_v3088(text[]),private.retire_absent_drive_overrides_v3088(text[],uuid),
  private.prune_absent_drive_inventory_v3088(text[],timestamptz,uuid),
  private.finish_exact_drive_snapshot_v3088(timestamptz,uuid,integer),private.reconcile_published_drive_membership_v3088()
  from public,anon,authenticated,service_role;

do $wire$
declare
  owner regprocedure;
  definition text;
  overlay_call text := '  perform private.apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id);';
  delete_start text;
  delete_end text := '    into deleted_rows from deleted;';
  overlay_definition text := pg_get_functiondef('private.apply_inventory_reclass_import_overlay_v1(uuid,uuid)'::regprocedure);
  overlay_filter text := '    where m.status in (''pending'',''conflict'')';
begin
  if cardinality(string_to_array(overlay_definition,overlay_filter))<>2 then
    raise exception 'DRIVE_SNAPSHOT_RECLASS_OWNER_CHANGED';
  end if;
  execute replace(overlay_definition,overlay_filter,overlay_filter||E'\n      and m.conflict_reason is distinct from ''source_retired_by_erp''');
  foreach owner in array array['public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure,
    'public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure] loop
    definition:=pg_get_functiondef(owner);
    delete_start:=case when owner='public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure
      then '  with missing_source as materialized ('
      else '  with deleted as (' end;
    if cardinality(string_to_array(definition,overlay_call))<>2
      or cardinality(string_to_array(definition,delete_start))<>2
      or cardinality(string_to_array(definition,'  source_rows integer;'))<>2
      or cardinality(string_to_array(definition,delete_end))<>2 then
      raise exception 'DRIVE_SNAPSHOT_PUBLICATION_OWNER_CHANGED: %',owner;
    end if;
    definition:=replace(definition,'  source_rows integer;',E'  source_rows integer;\n  exact_export_at timestamptz;');
    definition:=replace(definition,overlay_call,$prepare$
  exact_export_at:=private.prepare_exact_drive_snapshot_v3088(source_rows);
  perform private.apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id);
  if exact_export_at is not null then
    insert into pg_temp.ph_master_bulk_map_v1(row_number,source_unique_id,canonical_unique_id,candidate_count)
      select row_number,source_unique_id,canonical_unique_id,candidate_count from pg_temp.exact_drive_input_v3088
      on conflict(row_number) do nothing;
  end if;$prepare$);
    definition:=replace(definition,delete_start,$branch$  if exact_export_at is not null then
    deleted_rows:=private.finish_exact_drive_snapshot_v3088(exact_export_at,p_run_id,source_rows);
  else
$branch$||delete_start);
    execute replace(definition,delete_end,delete_end||E'\n  end if;');
  end loop;
end
$wire$;

notify pgrst,'reload schema';
commit;
