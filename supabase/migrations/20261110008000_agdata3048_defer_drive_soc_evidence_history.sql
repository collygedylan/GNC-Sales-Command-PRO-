begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Scope history deferral to the canonical ERP order/photo reconciliation
-- statement. The ordinary interactive SOC history trigger stays synchronous.
do $scope$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure);
  declaration text := 'declare result_value jsonb;';
  start_at integer := strpos(definition,'      update public.ph_master_inventory m set loc_photo_match=a.new_loc_photo_match');
  stop_at integer;
begin
  if start_at=0 or strpos(definition,declaration)=0 then
    raise exception 'ERP_DRIVE_SOC_HISTORY_SCOPE_ANCHOR_MISSING';
  end if;
  stop_at:=strpos(substring(definition from start_at),chr(10)||'    end if;');
  if stop_at=0 then raise exception 'ERP_DRIVE_SOC_HISTORY_SCOPE_END_MISSING'; end if;
  definition:=overlay(definition placing $restore$
      perform set_config('gnc.erp_drive_soc_history_run_v3048',previous_history_run,true);$restore$
    from start_at+stop_at-1 for 0);
  definition:=overlay(definition placing $scope_call$      previous_history_run:=coalesce(current_setting('gnc.erp_drive_soc_history_run_v3048',true),'');
      perform set_config('gnc.erp_drive_soc_history_run_v3048',p_run_id::text,true);
$scope_call$ from start_at for 0);
  execute replace(definition,declaration,declaration||E'\n  previous_history_run text;');
end
$scope$;

-- Preserve the changed SOC row and its workbook identity through a later
-- SOC stage. Reuse the frozen order-history worker and its retry cap.
do $frozen$
declare
  definition text := pg_get_functiondef('private.publish_drive_evidence_to_soc_v23142()'::regprocedure);
  declaration text := 'declare';
  start_at integer := strpos(definition,'  with changed_drive_evidence as materialized (');
  write_anchor text := E'  )\n  update public.ph_soc_master s';
  end_anchor text := '          then s.date_completed else n.date_completed end);'||chr(10)||'  return null;';
begin
  if start_at=0 or cardinality(string_to_array(definition,write_anchor))<>2
    or cardinality(string_to_array(definition,end_anchor))<>2
    or to_regclass('private.erp_order_history_rows_v3046') is null then
    raise exception 'ERP_DRIVE_SOC_HISTORY_FREEZE_ANCHOR_MISSING';
  end if;
  definition:=overlay(definition placing $settings$  deferred_file:='drive-evidence:'||nullif(current_setting('gnc.erp_drive_soc_history_run_v3048',true),'');
  if deferred_file is not null and (coalesce(auth.role(),'')<>'service_role'
    or current_setting('agdata.bulk_import.ph_master_inventory',true) is distinct from 'on') then
    deferred_file:=null;
  end if;
  if deferred_file is not null then
    previous_defer:=coalesce(current_setting('agdata.fast_erp_defer_history',true),'');
    perform set_config('agdata.fast_erp_defer_history','on',true);
  end if;

$settings$ from start_at for 0);
  definition:=replace(definition,write_anchor,E'  ), published as (\n  update public.ph_soc_master s');
  definition:=replace(definition,end_anchor,$queue$          then s.date_completed else n.date_completed end)
    returning case when deferred_file is not null then to_jsonb(s) end as source_row
  ) select array_agg(source_row) into frozen_rows from published where source_row is not null;
  if deferred_file is not null then
    perform set_config('agdata.fast_erp_defer_history',previous_defer,true);
  end if;
  if cardinality(frozen_rows)>0 then
    insert into private.erp_order_history_rows_v3046 as frozen(dataset_key,file_id,source_uid,source_row)
    select 'ph_soc_master',deferred_file,source_row->>'unique_id',source_row from unnest(frozen_rows) saved(source_row)
    on conflict(dataset_key,file_id,source_uid) do update
      set source_row=excluded.source_row,attempts=0,next_attempt_at=clock_timestamp(),last_sqlstate=null
      where frozen.source_row is distinct from excluded.source_row;
  end if;
  return null;$queue$);
  execute overlay(definition placing $declare$declare
  deferred_file text;
  previous_defer text;
  frozen_rows jsonb[];$declare$ from strpos(definition,declaration) for length(declaration));
end
$frozen$;

commit;
