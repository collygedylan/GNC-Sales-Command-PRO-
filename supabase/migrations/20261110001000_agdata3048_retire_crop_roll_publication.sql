begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Retire only the Crop Roll projection hooks. Historical tables, their read
-- grants, and the canonical inventory/evaluation triggers remain in place.
alter table public.ph_master_inventory disable trigger trg_v2_master_inventory_crop_roll_drive_rows;
alter table public.ph_master_inventory disable trigger trg_v2_master_inventory_crop_roll_drive_rows_insert;
alter table public.ph_master_inventory disable trigger trg_v2_master_inventory_crop_roll_drive_rows_delete;
alter table public.ph_crop_roll_rows disable trigger trg_sync_v2_crop_roll_completed_drive_keys;

revoke execute on function public.refresh_v2_crop_roll_completed_drive_keys()
  from public,anon,authenticated,service_role;

do $erp$
declare
  importer regprocedure;
  definition text;
  crop_call text := $call$  if cardinality(touched_ids) > 0 then
    perform private.sync_ph_master_bulk_crop_roll_v1(p_run_id, p_request_id, touched_ids);
  end if;
$call$;
  all_uids text := $uids$coalesce(array_agg(unique_id), ''{}''::text[])$uids$;
begin
  foreach importer in array array[
    'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure,
    'public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(importer);
    if strpos(definition,crop_call)=0 then raise exception 'ERP_CROP_ROLL_RETIREMENT_ANCHOR_MISSING'; end if;
    definition:=replace(definition,crop_call,'');
    definition:=regexp_replace(definition,$line$(?m)^  (previous_crop_roll_marker|perform set_config\('gnc\.master_bulk_crop_roll_deferred')[^\n]*\n$line$,'','g');
    definition:=regexp_replace(definition,$line$(?m)^\s*(batch_touched text\[\];|touched_ids[^\n]*)\n$line$,'','g');
    definition:=replace(definition,', batch_touched','');
    definition:=replace(definition,', '||all_uids||' from affected',' from affected');
    definition:=replace(definition,','||chr(10)||'           '||all_uids||' from affected',' from affected');
    definition:=replace(definition,'           '||all_uids||','||chr(10),'');
    definition:=replace(definition,$uids$, coalesce(array_agg(unique_id), '{}'::text[])$uids$,'');
    if definition ~ 'touched_ids|batch_touched|gnc\.master_bulk_crop_roll_deferred|sync_ph_master_bulk_crop_roll_v1' then
      raise exception 'ERP_CROP_ROLL_RETIREMENT_REFERENCE_REMAINS';
    end if;
    execute definition;
  end loop;
end
$erp$;

do $reclass$
declare
  definition text := pg_get_functiondef('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure);
  start_at integer := strpos(definition,$start$  select coalesce(array_agg(uid),'{}'::text[]) into touched_ids$start$);
  end_at integer := strpos(definition,$end$  select coalesce(jsonb_agg(jsonb_build_object('table','ph_master_inventory','row',r.row_value)$end$);
begin
  if start_at=0 or end_at<=start_at or strpos(substring(definition from start_at for end_at-start_at),
    'private.sync_ph_master_bulk_crop_roll_v1(null,p_batch_request_id,touched_ids)')=0 then
    raise exception 'RECLASS_CROP_ROLL_RETIREMENT_ANCHOR_MISSING';
  end if;
  definition:=overlay(definition placing '' from start_at for end_at-start_at);
  execute replace(definition,'  touched_ids text[];'||chr(10)||'  crop_roll_result jsonb;'||chr(10),'');
end
$reclass$;

commit;
