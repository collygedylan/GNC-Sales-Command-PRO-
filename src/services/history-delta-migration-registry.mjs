export const historyStateUniquenessMigrationName = '20261109000900_agdata3039_retire_history_state_uniqueness.sql';
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
export const indexedPhotoEvidenceMigrationName = '20261109009000_agdata3039_indexed_photo_evidence_lookup.sql';
export const canonicalSqlRepairsMigrationName = '20261109010000_agdata3039_canonical_sql_repairs.sql';
export const ownerRevisionLockOrderMigrationName = '20261109012000_agdata3039_owner_revision_lock_order.sql';
export const stageUnprovenSplitChecksMigrationName = '20261109013000_agdata3039_stage_unproven_split_checks.sql';
export const setBasedAssignmentFinishMigrationName = '20261109014000_agdata3039_set_based_assignment_finish.sql';

const contracts = Object.freeze({
  [historyStateUniquenessMigrationName]: `select
    to_regclass('public.ph_orders_history_item_state_v2366') is null
    and to_regclass('public.ph_reserves_history_item_state_v2366') is null
    and to_regclass('public.ph_drive_mode_history_item_state_v2366') is null
    and (select count(*) from pg_index
      where indisprimary and indrelid in('public.ph_orders_history'::regclass,
        'public.ph_reserves_history'::regclass,'public.ph_drive_mode_history'::regclass))=3 as installed`,
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
    and position('sales_private.actor(p_actor)' in pg_get_functiondef('private.request_archive_scope_v3039(uuid,text)'::regprocedure))>0
    and position('private.navigation_module_allowed_v1(p_actor,p_view)' in pg_get_functiondef('private.request_archive_scope_v3039(uuid,text)'::regprocedure))>0
    and position('private.history_dylan_financial_v1(p_actor)' in pg_get_functiondef('private.request_archive_scope_v3039(uuid,text)'::regprocedure))>0
    and position('return public.historical_request_archive_read_v3039(p_actor_id,p_query)' in pg_get_functiondef('public.historical_archive_read_v2370(uuid,jsonb)'::regprocedure))>0
    and position('lower(h.consignee_name)' in pg_get_functiondef('public.historical_request_party_lookup_v3039(uuid,text,text,integer)'::regprocedure))>0 as installed`,
  [indexedPhotoEvidenceMigrationName]: `select
    exists(select 1 from pg_index
      where indexrelid=to_regclass('public.ph_master_inventory_item_location_on_hand_idx')
        and indrelid='public.ph_master_inventory'::regclass and indisvalid and indisready)
    and position('m.itemcode IS NOT NULL AND m.locationcode IS NOT NULL'
      in pg_get_functiondef('private.collect_item_detail_photo_links_v308(text,text,text,jsonb)'::regprocedure))>0
    and position('upper(btrim(coalesce(m.locationcode,' in
      pg_get_functiondef('private.collect_item_detail_photo_links_v308(text,text,text,jsonb)'::regprocedure))>0
    and position('keys(key,field_ord)' in
      pg_get_functiondef('private.collect_item_detail_photo_links_v308(text,text,text,jsonb)'::regprocedure))>0
    and (select proconfig @> array['enable_seqscan=off','jit=off'] from pg_proc
      where oid='private.collect_item_detail_photo_links_v308(text,text,text,jsonb)'::regprocedure)
    and not has_function_privilege('anon','private.collect_item_detail_photo_links_v308(text,text,text,jsonb)','execute')
    and not has_function_privilege('authenticated','private.collect_item_detail_photo_links_v308(text,text,text,jsonb)','execute') as installed`,
  [canonicalSqlRepairsMigrationName]: `select
    not has_column_privilege('anon','public.ph_customer_consignee_sales_reps','raw_data','select')
    and not has_column_privilege('authenticated','public.ph_customer_consignee_sales_reps','raw_data','select')
    and has_column_privilege('authenticated','public.ph_customer_consignee_sales_reps','customeridentityid','select')
    and position('from adjusted a join staged using(row_number)'
      in pg_get_functiondef('private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure))>0
    and position('on conflict do nothing;'||chr(10)||'  analyze pg_temp.ph_master_proven_new_ids_v1;'
      in pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure))>0
    and position('perform sales_private.replay_customer_mapping_rows_v2397();'||chr(10)||
      '  import_result:=app_sync_private.advance_import(p_run_id,''finish'');'
      in pg_get_functiondef('public.finalize_customer_rep_mapping_import_v2397_base(uuid)'::regprocedure))>0
    and position('return public.finalize_customer_rep_mapping_import_v2397_base(p_run_id);'
      in pg_get_functiondef('public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure))>0
    and position('or history.date_completed is not null'
      in pg_get_functiondef('private.recover_unfulfilled_requests_v1()'::regprocedure))>0
    and position('errcode=''PT409'',message=''DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT'''
      in pg_get_functiondef('private.validate_drive_reclass_sheared_v5(jsonb)'::regprocedure))>0
    and position('writable_columns) using to_jsonb(r)'
      in pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and position('candidate.source_sales_year=work_source_sales_year'
      in pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))>0
    and position('=requested_common_name'
      in pg_get_functiondef('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure))>0
    and position('for target in select unnest'
      in pg_get_functiondef('public.ph_prune_supabase_bloat_v1()'::regprocedure))>0
    and not has_function_privilege('authenticated','private.apply_inventory_live_overrides_bulk_v1(uuid)','execute')
    and not has_function_privilege('anon','private.apply_inventory_live_overrides_bulk_v1(uuid)','execute') as installed`,
  [ownerRevisionLockOrderMigrationName]: `select (select
    strpos(definition,'gnc-reconcile-eval-itemcodes-v2')>0
    and strpos(definition,'gnc-reconcile-eval-itemcodes-v2')<strpos(definition,'into source_revision')
    and has_function_privilege('authenticated','public.set_itemcode_default_owners_v1(jsonb,uuid)','execute')
    from pg_get_functiondef('public.set_itemcode_default_owners_v1(jsonb,uuid)'::regprocedure) definition) as installed`,
  [stageUnprovenSplitChecksMigrationName]: `select
    strpos(pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure),
      'with unproven as materialized')>0
    and strpos(pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure),
      'from unproven u'||chr(10)||'  where private.is_master_priority_split_v1(p_request_id,u.unique_id)')>0
    and strpos(pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure),
      'perform private.apply_inventory_live_overrides_bulk_v1(p_run_id);')>0
    and strpos(pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure),
      'with first_sources as materialized')>0
    and strpos(pg_get_functiondef('private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure),
      'and field.attnum>0 and not field.attisdropped and field.attname=e.field_name')>0 as installed`,
  [setBasedAssignmentFinishMigrationName]: `select (select
    strpos(prosrc,'except'||chr(10)||'       select w.master_unique_id')>0
    and strpos(prosrc,'except'||chr(10)||'       select m.unique_id')>0
    and strpos(prosrc,'source_witness')>0
    and strpos(prosrc,'progress.processed_count <> progress.total_count')>0
    and not has_function_privilege('service_role',oid,'execute')
    from pg_proc where oid='private.inventory_row_assignment_reconcile_finish_v1(uuid)'::regprocedure) as installed`,
});

export const historyDeltaMigrationNames = Object.freeze(Object.keys(contracts));

export function historyDeltaMigrationContract(name) {
  return Object.hasOwn(contracts, name) ? contracts[name] : undefined;
}
