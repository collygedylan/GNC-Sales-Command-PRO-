-- Run after erp-drive-soc-evidence-delta-fixture.sql in the same rollback.
create temporary table drive_soc_inline_history_calls (source_uid text);
create function pg_temp.record_soc_history(p_uid text)
returns void language sql as $probe$
  insert into pg_temp.drive_soc_inline_history_calls values(p_uid);
$probe$;
do $install_probe$
declare definition text := pg_get_functiondef('private.archive_soc_order_trigger_v2366()'::regprocedure);
begin
  definition:=replace(definition,'private.archive_soc_order_trigger_v2366','pg_temp.archive_soc_fixture');
  execute replace(definition,'private.refresh_soc_order_history_v2366','pg_temp.record_soc_history');
end
$install_probe$;
create trigger drive_soc_history_probe after update on soc_evidence_target
for each row execute function pg_temp.archive_soc_fixture();

update soc_evidence_target set filename='prior-argos-order.xlsx' where unique_id='soc-evidence-outer';
truncate pg_temp.drive_soc_inline_history_calls;
select set_config('gnc.erp_drive_soc_history_run_v3048','e3048000-0000-4000-8000-000000000023',true),
  set_config('agdata.bulk_import.ph_master_inventory','on',true),
  set_config('agdata.fast_erp_defer_history','off',true),
  set_config('request.jwt.claim.role','authenticated',true);
update drive_evidence_source set pick_note='interactive note' where unique_id='drive-evidence-outer';
select set_config('request.jwt.claim.role','service_role',true),set_config('agdata.bulk_import.ph_master_inventory','off',true);
update drive_evidence_source set pick_note='service edit outside publication' where unique_id='drive-evidence-outer';
do $interactive$
begin
  if (select count(*) from pg_temp.drive_soc_inline_history_calls where source_uid='soc-evidence-outer')<>2
    or exists(select 1 from private.erp_order_history_rows_v3046 where file_id='drive-evidence:e3048000-0000-4000-8000-000000000023') then
    raise exception 'ERP_DRIVE_SOC_HISTORY_DEFERRED_NONPUBLICATION';
  end if;
end
$interactive$;

select set_config('agdata.bulk_import.ph_master_inventory','on',true);
update drive_evidence_source set pick_note='final ERP note',loc_match_qty='0' where unique_id='drive-evidence-outer';
do $erp$
begin
  if (select count(*) from pg_temp.drive_soc_inline_history_calls)<>2
    or current_setting('agdata.fast_erp_defer_history',true) is distinct from 'off'
    or not exists(select 1 from private.erp_order_history_rows_v3046
      where dataset_key='ph_soc_master' and file_id='drive-evidence:e3048000-0000-4000-8000-000000000023'
        and source_uid='soc-evidence-outer' and source_row->>'pick_note'='final ERP note'
        and source_row->>'loc_match_qty'='0' and source_row->>'filename'='prior-argos-order.xlsx') then
    raise exception 'ERP_DRIVE_SOC_HISTORY_NOT_FROZEN_FROM_EXACT_CHANGED_ROW';
  end if;
end
$erp$;

select set_config('gnc.erp_drive_soc_history_run_v3048','',true),
  set_config('agdata.bulk_import.ph_master_inventory','off',true);
update soc_evidence_target set filename='next-argos-order.xlsx',pick_note='next SOC note' where unique_id='soc-evidence-outer';
select set_config('agdata.erp.order_history_file_v3046','drive-evidence:e3048000-0000-4000-8000-000000000023',true);
do $replay$
declare frozen jsonb := private.read_erp_order_history_row_v3046('ph_soc_master','soc-evidence-outer');
begin
  if frozen->>'filename' is distinct from 'prior-argos-order.xlsx'
    or frozen->>'pick_note' is distinct from 'final ERP note' then
    raise exception 'ERP_DRIVE_SOC_HISTORY_REPLAY_USED_NEWER_WORKBOOK';
  end if;
end
$replay$;
