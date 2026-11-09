begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- The append transaction owns the contiguous ordinal counter. At commit the
-- existing payload read also verifies the physical count.
do $stage$
declare
  fn regprocedure;
  definition text;
  changed text;
begin
  foreach fn in array array[
    'public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb)'::regprocedure,
    'public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure
  ] loop
    definition := pg_get_functiondef(fn);
    changed := replace(definition, 'set_config(''statement_timeout'',''45s'',true)',
      'set_config(''statement_timeout'',''120s'',true)');
    if changed = definition then raise exception 'ERP_STAGE_TIMEOUT_ANCHOR_MISSING'; end if;
    execute changed;
    execute format('alter function %s set statement_timeout = %L', fn, '120s');
  end loop;

  fn := 'public.fast_seal_erp_stage_v1(uuid,integer)'::regprocedure;
  definition := pg_get_functiondef(fn);
  changed := replace(definition,
    'select count(*) into actual_rows from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;',
    'actual_rows := stage.staged_rows;');
  if changed = definition then raise exception 'ERP_STAGE_SEAL_ANCHOR_MISSING'; end if;
  execute changed;

  fn := 'public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure;
  definition := pg_get_functiondef(fn);
  changed := replace(definition,
    E'\n     or (select count(*) from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id)<>stage.expected_rows', '');
  if changed = definition then raise exception 'ERP_STAGE_COMMIT_COUNT_ANCHOR_MISSING'; end if;
  definition := changed;
  changed := replace(definition,
    'from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;',
    $check$from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;
  if coalesce(jsonb_array_length(rows_value),0) <> stage.expected_rows then
    raise exception using errcode='55000',message='FAST_ERP_STAGE_INCOMPLETE';
  end if;$check$);
  if changed = definition then raise exception 'ERP_STAGE_COMMIT_PAYLOAD_ANCHOR_MISSING'; end if;
  execute changed;
end
$stage$;

alter function public.fast_seal_erp_stage_v1(uuid,integer) set statement_timeout = '120s';
alter function public.fast_commit_erp_stage_swap_v1(uuid) set work_mem = '16MB';
alter function public.fast_abort_erp_stage_v1(uuid) set statement_timeout = '120s';

create function private.apply_erp_master_provenance_v3042()
returns void language plpgsql set search_path = '' as $provenance$
declare
  source_filename text;
begin
  with incoming as materialized (
    select map.canonical_unique_id,
      private.inventory_location_evidence_number_v2(s.raw_values->>'ptronhand') as on_hand,
      private.inventory_location_evidence_number_v2(s.raw_values->>'ptrreviewed') as reviewed,
      private.inventory_location_evidence_number_v2(s.raw_values->>'ptravailable') as available,
      s.raw_values->>'filename' as filename
    from pg_temp.ph_master_bulk_stage_v1 s
    join pg_temp.ph_master_bulk_map_v1 map using(row_number)
  )
  update public.ph_master_inventory m
  set erp_on_hand=i.on_hand, erp_ptrreview=i.reviewed, erp_available=i.available,
      filename=coalesce(i.filename,m.filename),
      erp_source_filename=coalesce(i.filename,m.filename), erp_source_present=true
  from incoming i
  where m.unique_id=i.canonical_unique_id
    and (m.erp_on_hand,m.erp_ptrreview,m.erp_available,m.filename,m.erp_source_filename,m.erp_source_present)
      is distinct from (i.on_hand,i.reviewed,i.available,coalesce(i.filename,m.filename),coalesce(i.filename,m.filename),true);

  select min(filename) into source_filename
  from pg_temp.ph_master_bulk_stage_v1
  where nullif(btrim(filename),'') is not null
  having count(distinct nullif(btrim(filename),''))=1;
  if source_filename is null then return; end if;

  with retained as materialized (
    select unique_id from public.ph_master_inventory
    except
    select canonical_unique_id from pg_temp.ph_master_bulk_map_v1
  )
  update public.ph_master_inventory m
  set erp_source_filename=coalesce(m.erp_source_filename,m.filename),
      erp_source_present=false, filename=source_filename
  from retained r
  where m.unique_id=r.unique_id
    and (m.filename is distinct from source_filename or m.erp_source_present is distinct from false);
end
$provenance$;
revoke all on function private.apply_erp_master_provenance_v3042() from public,anon,authenticated,service_role;

-- Reuse the canonical import flag around exact pruning. The installed delete
-- guards honor it, so the publisher does not need table-wide trigger DDL.
do $master$
declare
  fn regprocedure := 'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure;
  definition text := pg_get_functiondef(fn);
  anchor text := '  perform private.apply_inventory_live_overrides_bulk_v1(p_run_id);';
  start_at integer;
  end_at integer;
begin
  if (select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid='public.ph_master_inventory'::regclass
        and t.tgname in ('aa00_inventory_override_delete','aaa_ph_master_inventory_priority_hold_shield_delete',
          'aab_ph_master_inventory_item6_guard_v7_delete')
        and position('agdata.bulk_import.' in p.prosrc)>0) <> 3
    or strpos(definition,anchor)=0 then raise exception 'ERP_MASTER_PRUNE_GUARD_MISSING'; end if;
  definition := replace(definition,anchor,anchor||E'\n  analyze pg_temp.ph_master_bulk_map_v1 (row_number, canonical_unique_id);\n  analyze pg_temp.ph_master_bulk_stage_v1 (row_number, unique_id, raw_item6_fields, field_keys);');
  start_at := strpos(definition,'  alter table public.ph_master_inventory disable trigger aa00_inventory_override_delete;');
  end_at := strpos(definition,'  with deleted as (');
  if start_at=0 or end_at<=start_at then raise exception 'ERP_MASTER_PRUNE_START_MISSING'; end if;
  definition := overlay(definition placing $guard$  previous_bulk_guard := coalesce(current_setting('agdata.bulk_import.ph_master_inventory',true),'');
  perform set_config('agdata.bulk_import.ph_master_inventory','on',true);
$guard$ from start_at for end_at-start_at);
  definition := regexp_replace(definition,'\mdeclare\M',
    E'declare\n  previous_bulk_guard text;','i');
  start_at := strpos(definition,'  alter table public.ph_master_inventory enable trigger aa00_inventory_override_delete;');
  end_at := strpos(definition,'  touched_ids := touched_ids || batch_touched;'||chr(10)||'  if cardinality(touched_ids) > 0 then');
  if start_at=0 or end_at<=start_at then raise exception 'ERP_MASTER_PRUNE_END_MISSING'; end if;
  definition := overlay(definition placing $stamp$  if previous_bulk_guard <> 'on' or to_regclass('pg_temp.erp_order_delta_v23196') is null then
    with source as (
      select min(filename) as filename from pg_temp.ph_master_bulk_stage_v1
      where nullif(btrim(filename),'') is not null
      having count(distinct nullif(btrim(filename),''))=1
    )
    update public.ph_master_inventory live set filename=source.filename from source
    where live.filename is distinct from source.filename;
  end if;
  perform set_config('agdata.bulk_import.ph_master_inventory',previous_bulk_guard,true);
$stamp$ from start_at for end_at-start_at);
  if definition ~* 'alter table public\.ph_master_inventory (disable|enable) trigger' then
    raise exception 'ERP_MASTER_TRIGGER_DDL_REMAINS';
  end if;
  execute definition;
end
$master$;

do $wire$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure);
  start_at integer := strpos(definition,'      update public.ph_master_inventory m set erp_on_hand=');
  end_at integer := strpos(definition,'      update public.ph_master_inventory m set loc_photo_match=');
begin
  if start_at=0 or end_at<=start_at then raise exception 'ERP_MASTER_PROVENANCE_ANCHOR_MISSING'; end if;
  execute overlay(definition placing '      perform private.apply_erp_master_provenance_v3042();'||chr(10)
    from start_at for end_at-start_at);
end
$wire$;

commit;
