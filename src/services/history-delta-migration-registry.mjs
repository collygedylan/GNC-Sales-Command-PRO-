export const consecutiveHistoryMigrationName = '20261109001000_agdata3039_consecutive_history_states.sql';
export const requestArchiveCatalogMigrationName = '20261109002000_agdata3039_request_archive_catalog.sql';
export const snapshotCoverageMigrationName = '20261109003000_agdata3039_snapshot_coverage.sql';
export const snapshotDeltaPlansMigrationName = '20261109004000_agdata3039_snapshot_delta_plans.sql';
export const snapshotCompactionMigrationName = '20261109005000_agdata3039_bounded_snapshot_compaction.sql';
export const snapshotReadersMigrationName = '20261109006000_agdata3039_snapshot_reader_compatibility.sql';
export const privateImportSnapshotMigrationName = '20261109006500_agdata3039_private_import_snapshot_delta.sql';
export const snapshotPipelineMigrationName = '20261109007000_agdata3039_completed_snapshot_pipeline.sql';
export const driveProjectionReceiptsMigrationName = '20261109007500_agdata3039_drive_projection_receipts.sql';
export const requestArchiveReaderMigrationName = '20261109008000_agdata3039_request_archive_reader.sql';

const contracts = Object.freeze({
  [consecutiveHistoryMigrationName]: `select
    to_regprocedure('private.history_business_state_v3039(jsonb)') is not null
    and (select count(*) from pg_trigger where tgfoid='private.merge_compact_history_state_v2366()'::regprocedure
      and tgrelid in('public.ph_orders_history'::regclass,'public.ph_reserves_history'::regclass,'public.ph_drive_mode_history'::regclass)
      and not tgisinternal and tgenabled<>'D')=3
    and position('return null' in pg_get_functiondef('private.merge_compact_history_state_v2366()'::regprocedure))=0
    and not exists(select 1 from cron.job where jobid=56 and jobname='agdata_historical_state_dedup_v2366'
      and command='select private.run_historical_state_dedup_v2366();' and active) as installed`,
  [requestArchiveCatalogMigrationName]: `select
    (select count(*) from pg_class where oid in('public.ph_request_archive_catalog_v3039'::regclass,
      'public.ph_photo_archive_queue'::regclass) and reloptions @> array['security_invoker=true'])=2
    and to_regclass('public.ph_request_history_customer_name_v3039') is not null
    and to_regclass('public.ph_request_history_consignee_name_v3039') is not null
    and exists(select 1 from pg_attribute where attrelid='public.ph_photo_archive_jobs'::regclass
      and attname='archive_path_receipts' and atttypid='jsonb'::regtype and attnotnull and not attisdropped)
    and has_table_privilege('service_role','public.ph_photo_archive_queue','select')
    and not has_table_privilege('authenticated','public.ph_photo_archive_queue','select')
    and not has_table_privilege('anon','public.ph_photo_archive_queue','select') as installed`,
  [snapshotCoverageMigrationName]: `select
    (select count(*) from pg_class where oid in('public.ph_drive_around_report_rows_snapshot_v3039'::regclass,
      'public.ph_hold_stop_itemcode_snapshots_snapshot_v3039'::regclass,'public.ph_history_state_coverage_v3039'::regclass)
      and reloptions @> array['security_invoker=true'])=3
    and (select count(*) from pg_class where relrowsecurity and oid in
      ('private.history_snapshot_coverage_v3039'::regclass,'private.history_snapshot_states_v3039'::regclass))=2
    and exists(select 1 from pg_constraint where contype='f'
      and conrelid='private.history_snapshot_coverage_v3039'::regclass
      and confrelid='private.history_snapshot_states_v3039'::regclass)
    and public.snapshot_archive_policy_supported_v3039('public.ph_drive_around_report_rows'::regclass)
    and public.snapshot_archive_policy_supported_v3039('public.ph_hold_stop_itemcode_snapshots'::regclass)
    and exists(select 1 from pg_policy where polrelid='private.history_snapshot_coverage_v3039'::regclass
      and polname='snapshot_coverage_read_v3039' and position('snapshot_coverage_visible_v3039' in pg_get_expr(polqual,polrelid))>0)
    and (select count(*) from pg_policy where not polpermissive and polcmd='r'
      and polname in('snapshot_coverage_active_profile_v3039','snapshot_state_active_profile_v3039')
      and polroles=array['authenticated'::regrole::oid]
      and position('private.current_active_profile()' in pg_get_expr(polqual,polrelid))>0)=2
    and not (select prosecdef from pg_proc where oid='public.snapshot_coverage_visible_v3039(oid)'::regprocedure)
    and not exists(select 1 from unnest(array['anon','authenticated','service_role']) role
      where has_table_privilege(role,'public.ph_drive_around_report_rows','select')<>has_table_privilege(role,'public.ph_drive_around_report_rows_snapshot_v3039','select')
        or has_table_privilege(role,'public.ph_hold_stop_itemcode_snapshots','select')<>has_table_privilege(role,'public.ph_hold_stop_itemcode_snapshots_snapshot_v3039','select')) as installed`,
  [snapshotDeltaPlansMigrationName]: `select
    to_regprocedure('private.snapshot_delta_report_v3039(regclass,text)') is not null
    and position('HISTORY_ITEM_EXCEEDS_5000_OBSERVATIONS' in pg_get_functiondef('private.snapshot_delta_plan_v3039(regclass,text)'::regprocedure))>0
    and position('previous_sequence' in pg_get_functiondef('private.snapshot_delta_plan_v3039(regclass,text)'::regprocedure))>0
    and not has_function_privilege('authenticated','private.snapshot_delta_plan_v3039(regclass,text)','execute') as installed`,
  [snapshotCompactionMigrationName]: `select
    to_regclass('private.history_delta_receipts_v3039') is not null
    and position('HISTORY_UNMIGRATED_SNAPSHOT_READERS' in pg_get_functiondef('private.assert_snapshot_archive_writable_v3039(regclass)'::regprocedure))>0
    and position('HISTORY_COVERAGE_RECONSTRUCTION_FAILED' in pg_get_functiondef('private.delete_verified_snapshot_duplicates_v3039(regclass)'::regprocedure))>0
    and not has_function_privilege('service_role','private.compact_snapshot_item_v3039(regclass,text,boolean)','execute') as installed`,
  [snapshotReadersMigrationName]: `select
    (select count(*) from private.history_reader_rewire_receipts_v3039)>=10
    and jsonb_array_length(private.snapshot_delta_reader_blockers_v3039('public.ph_drive_around_report_rows'))=0
    and jsonb_array_length(private.snapshot_delta_reader_blockers_v3039('public.ph_hold_stop_itemcode_snapshots'))=0
    and position('ph_drive_around_report_rows_snapshot_v3039' in pg_get_functiondef('private.historical_drive_file_page_v2367(text,integer,integer)'::regprocedure))>0 as installed`,
  [privateImportSnapshotMigrationName]: `select
    (select reloptions @> array['security_invoker=true'] from pg_class
      where oid='import_private.import_history_logical_rows_v3039'::regclass)
    and (select count(*) from pg_class where relrowsecurity and oid in
      ('import_private.import_history_states_v3039'::regclass,'import_private.import_history_coverage_v3039'::regclass))=2
    and not has_table_privilege('service_role','import_private.import_history_logical_rows_v3039','select')
    and not has_function_privilege('service_role','import_private.compact_import_history_delta_v3039(uuid,integer,integer,boolean)','execute')
    and position('import_history_logical_rows_v3039' in pg_get_functiondef('public.publish_import_history_v1(uuid)'::regprocedure))>0
    and position('import_history_logical_rows_v3039' in pg_get_functiondef('public.get_import_history_rows_v1(uuid,integer,integer)'::regprocedure))>0
    and position('capture_history_stage_v3039' in pg_get_functiondef('public.stage_import_history_rows_v1(uuid,jsonb)'::regprocedure))>0 as installed`,
  [snapshotPipelineMigrationName]: `select
    (select count(*) from pg_trigger where tgname in('history_delta_completed_file_v3039',
      'history_delta_drive_capture_v3039','history_delta_hold_capture_v3039',
      'zz_history_delta_drive_replay_v3039','zz_history_delta_hold_replay_v3039')
      and not tgisinternal and tgenabled<>'D')=5
    and position('capture_snapshot_archive_v3039' in pg_get_functiondef('private.capture_snapshot_insert_v3039()'::regprocedure))>0
    and position('source_count_not_complete' in pg_get_functiondef('private.snapshot_file_completion_v3039(regclass,text)'::regprocedure))>0
    and exists(select 1 from cron.job where jobname='agdata_history_delta_queue_v3039' and schedule='* * * * *'
      and command='select private.process_history_delta_queue_v3039();' and not active)
    and not has_function_privilege('service_role','private.process_history_delta_queue_v3039()','execute') as installed`,
  [driveProjectionReceiptsMigrationName]: `select
    to_regclass('private.drive_mode_projection_receipts_v3039') is not null
    and position('finish_drive_mode_projection_v3039' in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and not has_table_privilege('service_role','private.drive_mode_projection_receipts_v3039','insert')
    and not has_function_privilege('service_role','private.finish_drive_mode_projection_v3039(text,integer,integer)','execute') as installed`,
  [requestArchiveReaderMigrationName]: `select
    has_function_privilege('service_role','public.historical_request_archive_read_v3039(uuid,jsonb)','execute')
    and not has_function_privilege('authenticated','public.historical_request_archive_read_v3039(uuid,jsonb)','execute')
    and not has_function_privilege('anon','public.historical_request_archive_read_v3039(uuid,jsonb)','execute')
    and has_function_privilege('service_role','public.historical_request_party_lookup_v3039(uuid,text,text,integer)','execute')
    and not has_function_privilege('authenticated','public.historical_request_party_lookup_v3039(uuid,text,text,integer)','execute')
    and position('historical_requests_read_v2370' in pg_get_functiondef('private.request_archive_scope_v3039(uuid,text)'::regprocedure))>0
    and position('lower(h.consignee_name)' in pg_get_functiondef('public.historical_request_party_lookup_v3039(uuid,text,text,integer)'::regprocedure))>0 as installed`,
});

export const historyDeltaMigrationNames = Object.freeze(Object.keys(contracts));

export function historyDeltaMigrationContract(name) {
  return Object.hasOwn(contracts, name) ? contracts[name] : undefined;
}
