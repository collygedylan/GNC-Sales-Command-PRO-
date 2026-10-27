begin;
set local lock_timeout='1500ms';
set local statement_timeout='10s';

create table if not exists private.fast_erp_stage_runs_v1(
  stage_id uuid primary key default gen_random_uuid(),
  dataset_key text not null check(dataset_key in ('drive_around','soc','reserves','cav')),
  file_meta jsonb not null,
  source_fingerprint text not null,
  expected_rows integer not null check(expected_rows between 1 and 50000),
  staged_rows integer not null default 0 check(staged_rows>=0),
  stage_state text not null default 'staging' check(stage_state in ('staging','committing','failed','committed')),
  committed_result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '2 days'),
  unique(dataset_key,source_fingerprint)
);
create table if not exists private.fast_erp_stage_rows_v1(
  stage_id uuid not null references private.fast_erp_stage_runs_v1(stage_id) on delete cascade,
  row_ordinal integer not null check(row_ordinal>0),
  unique_id text not null,
  row_value jsonb not null check(jsonb_typeof(row_value)='object'),
  primary key(stage_id,row_ordinal),
  unique(stage_id,unique_id)
);
revoke all on private.fast_erp_stage_runs_v1,private.fast_erp_stage_rows_v1 from public,anon,authenticated,service_role;

create or replace function private.sync_new_unassigned_warehouse_itemcodes_v1(p_import_run_id uuid)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='5s' set lock_timeout='1s' as $function$
declare run app_sync_private.import_runs; inserted_defaults integer:=0; inserted_warehouse integer:=0; queued integer:=0;
begin
  select * into run from app_sync_private.import_runs r where r.id=p_import_run_id;
  if run.id is null or run.state<>'active' or run.expires_at<=clock_timestamp()
     or not ('ph_master_inventory'=any(run.canonical_keys))
     or not exists(select 1 from app_sync_private.import_leases l where l.key='ph_master_inventory' and l.run_id=run.id) then
    return jsonb_build_object('status','skipped','reason','MASTER_IMPORT_NOT_ACTIVE');
  end if;

  with codes as materialized (
    select upper(btrim(m.itemcode)) code,
      max(nullif(btrim(coalesce(m.commonname,'')),'')) commonname,
      max(nullif(btrim(coalesce(m.contsize,'')),'')) contsize,
      max(nullif(btrim(coalesce(m.plantgroupcode,'')),'')) plantgroupcode,
      max(nullif(btrim(coalesce(m.genusname,'')),'')) genusname,
      max(nullif(btrim(coalesce(m.locationcode,'')),'')) locationcode
    from public.ph_master_inventory m
    where nullif(btrim(coalesce(m.itemcode,'')),'') is not null
      and not exists(select 1 from public.ph_warehouse_assigned_items existing
        where existing.itemcode_normalized=upper(btrim(m.itemcode)))
    group by upper(btrim(m.itemcode))
  ), defaults as (
    insert into public.ph_itemcode_default_owners(itemcode_normalized,assignedto,revision,review_required,updated_by,updated_at)
    select c.code,null,0,false,'system',clock_timestamp() from codes c
    on conflict(itemcode_normalized) do nothing
    returning itemcode_normalized
  ), owner_values as (
    select c.*,o.assignedto,o.assigned_at,o.updated_by
    from codes c
    left join public.ph_itemcode_default_owners o on o.itemcode_normalized=c.code
    left join defaults d on d.itemcode_normalized=c.code
    where o.itemcode_normalized is not null or d.itemcode_normalized is not null
  ), warehouse as (
    insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,
      genusname_normalized,concat,assignment_key,commonname,contsize,locationcode,source,
      first_seen_at,last_seen_at,present_in_drive,assignedto,assigned_by,assigned_at,
      unassigned_notified_at,raw_row,updated_at)
    select 'eval-itemcode-genus-'||md5(c.code||'|'||lower(regexp_replace(btrim(coalesce(c.genusname,'')),'[[:space:]]+',' ','g'))),
      c.code,c.code,c.genusname,lower(regexp_replace(btrim(coalesce(c.genusname,'')),'[[:space:]]+',' ','g')),
      c.code||c.genusname,c.code||'|'||lower(regexp_replace(btrim(coalesce(c.genusname,'')),'[[:space:]]+',' ','g')),
      c.commonname,c.contsize,c.locationcode,'supabase_drive_reconcile',clock_timestamp(),clock_timestamp(),true,
      c.assignedto,c.updated_by,c.assigned_at,
      case when nullif(btrim(coalesce(c.assignedto,'')),'') is null then clock_timestamp() else null end,
      jsonb_build_object('authority','ph_itemcode_default_owners','plantgroupcode',c.plantgroupcode),clock_timestamp()
    from owner_values c
    on conflict(assignment_key) where assignment_key is not null do nothing
    returning itemcode_normalized
  ), notification_events as (
    insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status)
    select 'eval-unassigned:'||md5(d.code),'eval_assignment_unassigned',
      jsonb_build_object('itemcode',d.code,
        'manager_usernames',jsonb_build_array('dylan_collyge','megan_kelly')),'pending'
    from owner_values d where nullif(btrim(coalesce(d.assignedto,'')),'') is null
    on conflict(event_key) do nothing
    returning event_key
  )
  select (select count(*) from defaults),(select count(*) from warehouse),
    (select count(*) from notification_events)
  into inserted_defaults,inserted_warehouse,queued;
  return jsonb_build_object('status','completed','new_itemcodes',inserted_defaults,
    'warehouse_rows',inserted_warehouse,'push_events',queued);
end
$function$;
revoke all on function private.sync_new_unassigned_warehouse_itemcodes_v1(uuid) from public,anon,authenticated,service_role;

create or replace function private.mirror_itemcode_default_owner_to_warehouse_v1()
returns trigger language plpgsql security definer set search_path=''
set statement_timeout='2s' set lock_timeout='250ms' as $function$
begin
  if (tg_op='INSERT' and nullif(btrim(coalesce(new.assignedto,'')),'') is null)
     or not exists(select 1 from public.ph_warehouse_assigned_items a
       where a.itemcode_normalized=new.itemcode_normalized) then
    return new;
  end if;
  update public.ph_warehouse_assigned_items a set
    assignedto=new.assignedto,
    assigned_by=case when nullif(btrim(coalesce(new.assignedto,'')),'') is null then null
      else coalesce(new.updated_by,a.assigned_by) end,
    assigned_at=new.assigned_at,
    updated_at=clock_timestamp()
  where a.itemcode_normalized=new.itemcode_normalized
    and (a.assignedto is distinct from new.assignedto or a.assigned_at is distinct from new.assigned_at
      or a.assigned_by is distinct from case when nullif(btrim(coalesce(new.assignedto,'')),'') is null then null
        else coalesce(new.updated_by,a.assigned_by) end);
  return new;
end
$function$;
revoke all on function private.mirror_itemcode_default_owner_to_warehouse_v1() from public,anon,authenticated,service_role;
drop trigger if exists ph_itemcode_default_owner_warehouse_mirror_v2381 on public.ph_itemcode_default_owners;
create trigger ph_itemcode_default_owner_warehouse_mirror_v2381
  after insert or update of assignedto,assigned_at on public.ph_itemcode_default_owners
  for each row execute function private.mirror_itemcode_default_owner_to_warehouse_v1();

do $wire_new_itemcode_discovery$
declare definition text; needle text:=E'\n  witness := private.inventory_row_assignment_reconcile_source_witness_v1();';
begin
  definition:=replace(pg_get_functiondef('public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)'::regprocedure),E'\r\n',E'\n');
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'FAST_ERP_NEW_ITEMCODE_RECONCILE_HOOK_ANCHOR_MISSING';
  end if;
  execute replace(definition,needle,
    E'\n  if not exists(select 1 from private.inventory_row_assignment_reconcile_runs r where r.import_run_id=p_import_run_id)\n' ||
    E'     or exists(select 1 from private.inventory_row_assignment_reconcile_runs r where r.import_run_id=p_import_run_id and r.processed_count=0) then\n' ||
    E'    perform private.sync_new_unassigned_warehouse_itemcodes_v1(p_import_run_id);\n  end if;' || needle);
end
$wire_new_itemcode_discovery$;

do $wire_new_itemcode_discovery_fallback$
declare definition text; needle text:=E'  if not found then\n    return private.reconcile_inventory_row_assignments_v1(p_run_id);\n  end if;';
  replacement text:=E'  if not found then\n    perform private.sync_new_unassigned_warehouse_itemcodes_v1(p_run_id);\n    return private.reconcile_inventory_row_assignments_v1(p_run_id);\n  end if;';
begin
  definition:=replace(pg_get_functiondef('private.inventory_row_assignment_reconcile_finish_v1(uuid)'::regprocedure),E'\r\n',E'\n');
  if position(replacement in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'FAST_ERP_NEW_ITEMCODE_FALLBACK_HOOK_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,needle,replacement);
end
$wire_new_itemcode_discovery_fallback$;

do $repair_fast_drive_archive_sql$
declare definition text; repaired text;
  broken text := $broken$coalesce(master.itemcode,''))),encode(extensions.digest$broken$;
  fixed text := $fixed$coalesce(master.itemcode,''''))),encode(extensions.digest$fixed$;
  projection_needle text := $needle$select_columns:=case when common_columns is null then '' else ','||common_columns end;$needle$;
  projection_fixed text := $replacement$select_columns:=case when common_columns is null then '' else ','||replace(common_columns,
    'ptravailable','case when nullif(btrim(master.ptravailable),'''') is null then null when btrim(master.ptravailable) ~ ''^[+-]?[0-9]+([.][0-9]+)?$'' then btrim(master.ptravailable)::numeric else null end') end;$replacement$;
  history_needle text := $needle$master.season,master.available,master.on_hand,master.review,master.available,master.open_stock,master.pri,$needle$;
  history_fixed text := $replacement$master.season,private.manager_report_safe_numeric_v1(master.ptravailable),
    private.manager_report_safe_numeric_v1(master.ptronhand),private.manager_report_safe_numeric_v1(master.ptrreviewed),
    private.manager_report_safe_numeric_v1(master.ptravailable),private.manager_report_safe_numeric_v1(master.s_lts),master.priority,$replacement$;
  hold_needle text := $needle$master.hold_stop_code,master.hold_stop_reason$needle$;
  hold_fixed text := $replacement$master.holdstopcode,master.holdstopreason$replacement$;
  price_needle text := $needle$master.unit_list_price$needle$;
  price_fixed text := $replacement$private.manager_report_safe_numeric_v1(master.listprice)$replacement$;
begin
  definition:=pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure);
  repaired:=definition;
  if position(fixed in repaired)=0 then
    if (length(repaired)-length(replace(repaired,broken,'')))/length(broken)<>1 then
      raise exception 'FAST_DRIVE_ARCHIVE_SQL_REPAIR_ANCHOR_MISMATCH';
    end if;
    repaired:=replace(repaired,broken,fixed);
  end if;
  if position(projection_fixed in repaired)=0 then
    if (length(repaired)-length(replace(repaired,projection_needle,'')))/length(projection_needle)<>1 then
      raise exception 'FAST_DRIVE_ARCHIVE_TYPED_PROJECTION_ANCHOR_MISMATCH';
    end if;
    repaired:=replace(repaired,projection_needle,projection_fixed);
  end if;
  if position(history_fixed in repaired)=0 then
    if (length(repaired)-length(replace(repaired,history_needle,'')))/length(history_needle)<>1 then
      raise exception 'FAST_DRIVE_ARCHIVE_HISTORY_PROJECTION_ANCHOR_MISMATCH';
    end if;
    repaired:=replace(repaired,history_needle,history_fixed);
  end if;
  if position(hold_fixed in repaired)=0 then
    if (length(repaired)-length(replace(repaired,hold_needle,'')))/length(hold_needle)<>1 then
      raise exception 'FAST_DRIVE_ARCHIVE_HOLD_PROJECTION_ANCHOR_MISMATCH';
    end if;
    repaired:=replace(repaired,hold_needle,hold_fixed);
  end if;
  if position(price_fixed in repaired)=0 then
    if (length(repaired)-length(replace(repaired,price_needle,'')))/length(price_needle)<>1 then
      raise exception 'FAST_DRIVE_ARCHIVE_PRICE_PROJECTION_ANCHOR_MISMATCH';
    end if;
    repaired:=replace(repaired,price_needle,price_fixed);
  end if;
  if repaired=definition then return; end if;
  execute repaired;
end
$repair_fast_drive_archive_sql$;

create or replace function public.fast_begin_erp_stage_v1(
  p_dataset_key text,p_file_meta jsonb,p_expected_rows integer
) returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='2s' set lock_timeout='250ms' as $function$
declare v_dataset text:=lower(btrim(coalesce(p_dataset_key,'')));
  meta jsonb; fingerprint text; check_result jsonb; stage private.fast_erp_stage_runs_v1%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  if v_dataset not in ('drive_around','soc','reserves','cav') or p_expected_rows is null
     or p_expected_rows<1 or p_expected_rows>50000 then
    raise exception using errcode='22023',message='FAST_ERP_STAGE_INPUT_INVALID';
  end if;
  meta:=private.fast_erp_file_meta_v2369(p_file_meta);
  fingerprint:=encode(extensions.digest(convert_to(v_dataset||'|'||(meta->>'file_id')||'|'||(meta->>'file_name')||'|'||(meta->>'modified_at')||'|'||coalesce(meta->>'content_hash','')||'|'||p_expected_rows::text,'UTF8'),'sha256'),'hex');
  check_result:=public.check_erp_file_sync_needed_v1(v_dataset,meta->>'file_id',meta->>'file_name',meta->>'modified_at',meta->>'content_hash');
  if coalesce((check_result->>'skip')::boolean,false) then
    return check_result||jsonb_build_object('ok',true,'skipped',true,'status','UP_TO_DATE');
  end if;
  delete from private.fast_erp_stage_runs_v1 where expires_at<=clock_timestamp();
  perform pg_advisory_xact_lock(hashtextextended('fast-erp-stage:'||fingerprint,0));
  select * into stage from private.fast_erp_stage_runs_v1 r
    where r.dataset_key=v_dataset and r.source_fingerprint=fingerprint for update;
  if stage.stage_id is null then
    insert into private.fast_erp_stage_runs_v1(dataset_key,file_meta,source_fingerprint,expected_rows)
      values(v_dataset,meta,fingerprint,p_expected_rows) returning * into stage;
  elsif stage.expected_rows<>p_expected_rows or stage.file_meta is distinct from meta then
    raise exception using errcode='22023',message='FAST_ERP_STAGE_SOURCE_CONFLICT';
  end if;
  return jsonb_build_object('ok',true,'skipped',false,'stage_id',stage.stage_id,
    'dataset_key',v_dataset,'expected_rows',stage.expected_rows,'staged_rows',stage.staged_rows,'status',stage.stage_state);
end
$function$;

create or replace function public.fast_append_erp_stage_batch_v1(
  p_stage_id uuid,p_start_row integer,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='5s' set lock_timeout='1s' as $function$
declare stage private.fast_erp_stage_runs_v1%rowtype; batch_size integer; inserted integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  if p_stage_id is null or p_start_row is null or p_start_row<0 or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>1000 then
    raise exception using errcode='22023',message='FAST_ERP_STAGE_BATCH_INVALID';
  end if;
  batch_size:=jsonb_array_length(p_rows);
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id for update;
  if not found or stage.stage_state not in ('staging','committed') or stage.expires_at<=clock_timestamp()
     or p_start_row+batch_size>stage.expected_rows then
    raise exception using errcode='55000',message='FAST_ERP_STAGE_SEQUENCE_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) with ordinality b(value,ordinality)
      where jsonb_typeof(b.value) is distinct from 'object'
        or nullif(btrim(coalesce(b.value->'values'->>'unique_id',b.value->>'unique_id','')),'') is null
        or (stage.dataset_key='drive_around' and (jsonb_typeof(b.value->'values') is distinct from 'object'
          or jsonb_typeof(b.value->'rawFields') is distinct from 'array'))
        or (stage.dataset_key<>'drive_around' and b.value ? 'values'))
     or exists(select 1 from jsonb_array_elements(p_rows) b(value)
       group by coalesce(b.value->'values'->>'unique_id',b.value->>'unique_id') having count(*)>1) then
    raise exception using errcode='22023',message='FAST_ERP_STAGE_ROW_INVALID';
  end if;
  if p_start_row<stage.staged_rows then
    if stage.stage_state='committed' or p_start_row+batch_size>stage.staged_rows
       or exists(
         select 1 from jsonb_array_elements(p_rows) with ordinality b(value,ordinality)
         left join private.fast_erp_stage_rows_v1 existing
           on existing.stage_id=p_stage_id and existing.row_ordinal=p_start_row+b.ordinality
         where existing.row_ordinal is null or existing.row_value is distinct from b.value
       ) then
      raise exception using errcode='55000',message='FAST_ERP_STAGE_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object('ok',true,'stage_id',stage.stage_id,'accepted_rows',batch_size,
      'staged_rows',stage.staged_rows,'expected_rows',stage.expected_rows,'replayed',true);
  end if;
  if stage.stage_state<>'staging' or p_start_row<>stage.staged_rows then
    raise exception using errcode='55000',message='FAST_ERP_STAGE_SEQUENCE_INVALID';
  end if;
  insert into private.fast_erp_stage_rows_v1(stage_id,row_ordinal,unique_id,row_value)
  select p_stage_id,p_start_row+b.ordinality,
    coalesce(b.value->'values'->>'unique_id',b.value->>'unique_id'),b.value
  from jsonb_array_elements(p_rows) with ordinality b(value,ordinality);
  get diagnostics inserted=row_count;
  if inserted<>batch_size then raise exception using errcode='55000',message='FAST_ERP_STAGE_BATCH_INCOMPLETE'; end if;
  update private.fast_erp_stage_runs_v1 set staged_rows=staged_rows+inserted,expires_at=clock_timestamp()+interval '2 days'
    where stage_id=p_stage_id returning * into stage;
  return jsonb_build_object('ok',true,'stage_id',stage.stage_id,'accepted_rows',inserted,'staged_rows',stage.staged_rows,
    'expected_rows',stage.expected_rows);
end
$function$;

create or replace function public.fast_commit_erp_stage_swap_v1(p_stage_id uuid)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='120s' set lock_timeout='5s' as $function$
declare stage private.fast_erp_stage_runs_v1%rowtype; rows_value jsonb; result_value jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id for update;
  if found and stage.stage_state='committed' and stage.committed_result is not null then
    return stage.committed_result||jsonb_build_object('stage_replayed',true);
  end if;
  if not found or stage.stage_state<>'staging' or stage.expires_at<=clock_timestamp()
     or stage.staged_rows<>stage.expected_rows
     or (select count(*) from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id)<>stage.expected_rows then
    raise exception using errcode='55000',message='FAST_ERP_STAGE_INCOMPLETE';
  end if;
  update private.fast_erp_stage_runs_v1 set stage_state='committing' where stage_id=p_stage_id;
  select jsonb_agg(row_value order by row_ordinal) into rows_value
    from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;
  case stage.dataset_key
    when 'drive_around' then result_value:=public.fast_ingest_drive_around_v1(stage.file_meta,rows_value);
    when 'soc' then result_value:=public.fast_ingest_soc_orders_v1(stage.file_meta,rows_value);
    when 'reserves' then result_value:=public.fast_ingest_soc_reserves_v1(stage.file_meta,rows_value);
    when 'cav' then result_value:=public.fast_ingest_cav_v1(stage.file_meta,rows_value);
    else raise exception using errcode='22023',message='FAST_ERP_STAGE_DATASET_INVALID';
  end case;
  if coalesce((result_value->>'ok')::boolean,false) is distinct from true then
    raise exception using errcode='55000',message='FAST_ERP_STAGE_COMMIT_UNCONFIRMED';
  end if;
  result_value:=result_value||jsonb_build_object('staged_rows',stage.expected_rows,'stage_commit','canonical_atomic_import');
  update private.fast_erp_stage_runs_v1 set stage_state='committed',committed_result=result_value,
    expires_at=clock_timestamp()+interval '2 days' where stage_id=p_stage_id;
  return result_value;
end
$function$;

create or replace function public.fast_abort_erp_stage_v1(p_stage_id uuid)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='2s' set lock_timeout='250ms' as $function$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  delete from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  return jsonb_build_object('ok',true,'aborted',found);
end
$function$;

revoke all on function public.fast_begin_erp_stage_v1(text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.fast_commit_erp_stage_swap_v1(uuid) from public,anon,authenticated;
revoke all on function public.fast_abort_erp_stage_v1(uuid) from public,anon,authenticated;
grant execute on function public.fast_begin_erp_stage_v1(text,jsonb,integer) to service_role;
grant execute on function public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb) to service_role;
grant execute on function public.fast_commit_erp_stage_swap_v1(uuid) to service_role;
grant execute on function public.fast_abort_erp_stage_v1(uuid) to service_role;

create or replace function public.fast_ingest_warehouse_assigned_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='55s' set lock_timeout='5s' as $function$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='FAST_ERP_INGEST_FORBIDDEN';
  end if;
  if exists(select 1 from public.ph_warehouse_assigned_items) then
    return jsonb_build_object('ok',true,'skip',true,'up_to_date',true,
      'dataset_key','ph_warehouse_assigned_items','status','WAREHOUSE_ASSIGNMENTS_SEED_ONLY',
      'source_rows',0,'preserved_assignments',true);
  end if;
  return private.fast_finish_live_ingest_v2369('warehouse_assigned',p_file_meta,p_rows,array[
    'id','assignedto','assigned_by','assigned_at','first_seen_at','last_seen_at','present_in_drive',
    'unassigned_notified_at','zone_override_active','zone_override_prior_assignedto','zone_override_prior_assigned_by',
    'zone_override_prior_assigned_at','zone_override_rule_version','zone_override_evaluated_revision','assignment_reason'],false);
end
$function$;
revoke all on function public.fast_ingest_warehouse_assigned_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fast_ingest_warehouse_assigned_v1(jsonb,jsonb) to service_role;

create or replace function app_sync_private.bump_eval_report_revision_for_low_stock_v1()
returns trigger language plpgsql security definer set search_path=''
set statement_timeout='2s' set lock_timeout='250ms' as $function$
begin
  insert into public.app_dataset_revisions as existing_revision(key,revision,state,changed_at)
  values('ph_eval_report_settings',1,'ready',clock_timestamp())
  on conflict(key) do update set
    revision=existing_revision.revision+1,
    changed_at=clock_timestamp();
  return null;
end
$function$;
revoke all on function app_sync_private.bump_eval_report_revision_for_low_stock_v1() from public,anon,authenticated;
drop trigger if exists ph_eval_low_stock_override_revision_v2381 on private.ph_eval_item_low_stock_overrides;
create trigger ph_eval_low_stock_override_revision_v2381
after insert or update or delete on private.ph_eval_item_low_stock_overrides
for each statement execute function app_sync_private.bump_eval_report_revision_for_low_stock_v1();
drop trigger if exists ph_eval_low_stock_import_revision_v2381 on private.ph_eval_item_low_stock_import_state;
create trigger ph_eval_low_stock_import_revision_v2381
after insert or update or delete on private.ph_eval_item_low_stock_import_state
for each statement execute function app_sync_private.bump_eval_report_revision_for_low_stock_v1();
notify pgrst,'reload schema';
commit;
