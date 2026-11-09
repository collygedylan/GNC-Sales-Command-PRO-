export const erpPublicationLivenessMigration = '20261109210000_agdata3042_erp_publication_liveness.sql';
export const erpPublicationQueueMigration = '20261109211000_agdata3042_erp_publication_queue.sql';
export const erpPayloadEfficiencyMigration = '20261109212000_agdata3042_erp_payload_efficiency.sql';
export const erpDrivePrepareBatchesMigration = '20261109213000_agdata3042_drive_prepare_batches.sql';
export const erpDriveTransactionInputMigration = '20261109214000_agdata3042_drive_transaction_input.sql';
export const erpScanRecoveryMigration = '20261109215000_agdata3044_reclaim_stale_erp_scans.sql';
export const erpDeltaPublicationMigration = '20261109220000_agdata3046_delta_erp_publication.sql';
export const erpDeferredOrderHistoryMigration = '20261109221000_agdata3046_defer_order_history.sql';
export const erpDriveTuplePlanMigration = '20261109222000_agdata3046_prepare_drive_tuple_plan.sql';
export const erpDriveSemanticDeltaMigration = '20261109223000_agdata3046_drive_semantic_delta.sql';
export const erpDriveOverlayOrdinalsMigration = '20261109224000_agdata3046_index_drive_overlay_ordinals.sql';
export const erpDriveTempContextMigration = '20261109225000_agdata3046_temp_drive_import_context.sql';
export const erpDriveAssignmentSetMigration = '20261109226000_agdata3047_set_based_drive_assignments.sql';
export const erpDriveHistoryFileProofIndexMigration = '20261109226100_agdata3047_drive_history_file_proof_index.sql';
export const erpPublicationMigrationNames = [erpPublicationLivenessMigration, erpPublicationQueueMigration,
  erpPayloadEfficiencyMigration, erpDrivePrepareBatchesMigration, erpDriveTransactionInputMigration, erpScanRecoveryMigration,
  erpDeltaPublicationMigration, erpDeferredOrderHistoryMigration, erpDriveTuplePlanMigration, erpDriveSemanticDeltaMigration,
  erpDriveOverlayOrdinalsMigration, erpDriveTempContextMigration, erpDriveAssignmentSetMigration,
  erpDriveHistoryFileProofIndexMigration];

function erpDeltaPublicationContract() {
  return `select
    to_regclass('private.erp_soc_history_jobs_v3046') is not null
    and not has_table_privilege('service_role',to_regclass('private.erp_soc_history_jobs_v3046'),'SELECT')
    and not has_function_privilege('service_role',to_regprocedure('private.drain_erp_soc_history_v3046()'),'EXECUTE')
    and position('erp_soc_history_jobs_v3046' in pg_get_functiondef(to_regprocedure(
      'private.normalize_soc_itemcode_from_pairs_v23104(jsonb)')))>0
    and position('reconcile_inventory_location_evidence_v1' in pg_get_functiondef(to_regprocedure(
      'public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)')))=0
    and position('erp_source_present is distinct from false' in pg_get_functiondef(to_regprocedure(
      'private.apply_erp_master_provenance_v3042()')))>0
    and (select 'lock_timeout=4s'=any(proconfig) from pg_proc where oid=
      to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid)')) as installed`;
}

function erpDeferredOrderHistoryContract() {
  return `select
    to_regclass('private.erp_order_history_rows_v3046') is not null
    and not has_table_privilege('authenticated',to_regclass('private.erp_order_history_rows_v3046'),'SELECT')
    and not has_function_privilege('service_role',to_regprocedure('private.drain_erp_order_history_v3046()'),'EXECUTE')
    and position('freeze_erp_order_history_rows_v3046' in pg_get_functiondef(to_regprocedure(
      'private.fast_finish_live_ingest_v2369(text,jsonb,jsonb,text[],boolean)')))>0
    and position('read_erp_order_history_row_v3046' in pg_get_functiondef(to_regprocedure(
      'private.refresh_soc_order_history_v2366(text)')))>0
    and position('read_erp_order_history_row_v3046' in pg_get_functiondef(to_regprocedure(
      'private.refresh_reserve_history_v2366(text)')))>0 as installed`;
}

function erpDriveTuplePlanContract() {
  return `select
    to_regprocedure('private.prepare_master_bulk_stage_v3046(jsonb)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.prepare_master_bulk_stage_v3046(jsonb)'),'EXECUTE')
    and position('prepare_master_bulk_stage_v3046' in pg_get_functiondef(to_regprocedure(
      'private.load_drive_erp_publication_input_v3042(uuid)')))>0
    and position('input.payload=p_rows' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('from pg_temp.ph_master_bulk_tuples_v3046' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0 as installed`;
}

function erpDriveSemanticDeltaContract() {
  return `select
    to_regprocedure('private.prior_drive_source_aliases_v3046()') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.prior_drive_source_aliases_v3046()'),'EXECUTE')
    and position('drive_master_delta_predicate_v3046' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('prior_alias.canonical_unique_id=mapped.canonical_unique_id' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('=new.unique_id' in pg_get_functiondef(to_regprocedure(
      'private.apply_inventory_location_evidence_v1()')))>0 as installed`;
}

function erpDriveOverlayOrdinalsContract() {
  return `select
    position('ph_master_bulk_stage_v1_ordinal_uidx' in pg_get_functiondef(to_regprocedure(
      'private.prepare_master_bulk_stage_v3046(jsonb)')))>0
    and position('analyze pg_temp.ph_master_bulk_map_v1 (canonical_unique_id,row_number)' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('to_jsonb(m) old_row' in pg_get_functiondef(to_regprocedure(
      'private.apply_inventory_live_overrides_bulk_v1(uuid)')))=0 as installed`;
}

function erpDriveTempContextContract() {
  return `select
    to_regprocedure('private.open_master_bulk_temp_context_v3046(uuid,uuid)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.open_master_bulk_temp_context_v3046(uuid,uuid)'),'EXECUTE')
    and position('v.relowner=owner.relowner' in pg_get_functiondef(to_regprocedure(
      'private.master_bulk_temp_context_active_v3046(uuid,uuid)')))>0
    and position('insert into app_sync_private.ph_master_bulk_import_context_v1' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))=0
    and position('insert into app_sync_private.ph_master_bulk_import_context_v1' in pg_get_functiondef(to_regprocedure(
      'public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)')))>0 as installed`;
}

function erpDriveAssignmentSetContract() {
  return `select
    to_regprocedure('private.reconcile_drive_row_assignments_v3047(uuid)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.reconcile_drive_row_assignments_v3047(uuid)'),'EXECUTE')
    and position('decide_inventory_row_owner_v3047' in pg_get_functiondef(to_regprocedure(
      'private.resolve_inventory_row_assignment_v1(text,bigint)')))>0
    and position('apply_drive_row_assignment_plan_v3047' in pg_get_functiondef(to_regprocedure(
      'private.reconcile_drive_row_assignments_v3047(uuid)')))>0
    and position('sync_new_unassigned_warehouse_itemcodes_v1' in pg_get_functiondef(to_regprocedure(
      'private.inventory_row_assignment_reconcile_finish_v1(uuid)')))>0 as installed`;
}

function erpDriveHistoryFileProofIndexContract() {
  return `select coalesce((select indisvalid and indisready and indisusable
    from (select indisvalid,indisready,indislive as indisusable from pg_index
      where indexrelid=to_regclass('public.ph_drive_mode_history_file_proof_v3047')
        and indrelid=to_regclass('public.ph_drive_mode_history')) as proof),false) as installed`;
}

const erpBoundedPublicationContracts = new Map([
  [erpDeltaPublicationMigration, erpDeltaPublicationContract],
  [erpDeferredOrderHistoryMigration, erpDeferredOrderHistoryContract],
  [erpDriveTuplePlanMigration, erpDriveTuplePlanContract],
  [erpDriveSemanticDeltaMigration, erpDriveSemanticDeltaContract],
  [erpDriveOverlayOrdinalsMigration, erpDriveOverlayOrdinalsContract],
  [erpDriveTempContextMigration, erpDriveTempContextContract],
  [erpDriveAssignmentSetMigration, erpDriveAssignmentSetContract],
  [erpDriveHistoryFileProofIndexMigration, erpDriveHistoryFileProofIndexContract],
]);

export function erpPublicationMigrationContract(name) {
  const bounded = erpBoundedPublicationContracts.get(name);
  if (bounded) return bounded();
  if (name === erpScanRecoveryMigration) return `select
    to_regprocedure('private.erp_sync_recovery_due_v3044(jsonb,timestamptz,timestamptz,timestamptz)') is not null
    and not has_function_privilege('service_role',to_regprocedure(
      'private.erp_sync_recovery_due_v3044(jsonb,timestamptz,timestamptz,timestamptz)'),'EXECUTE')
    and position('recoveryClaimedAt' in pg_get_functiondef(to_regprocedure('public.claim_erp_sync_request_step_v1(uuid,text)')))>0
    and position('_workerLeaseId' in pg_get_functiondef(to_regprocedure('public.update_erp_sync_job_v1(uuid,jsonb)')))>0
    and position('recoveryDue' in pg_get_functiondef(to_regprocedure('public.get_erp_sync_status_v1()')))>0
    and position('erp_sync_recovery_due_v3044' in pg_get_functiondef(to_regprocedure('private.wake_erp_sync_job_v23116()')))>0 as installed`;
  if (name === erpDriveTransactionInputMigration) return `select
    to_regprocedure('private.load_drive_erp_publication_input_v3042(uuid)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.load_drive_erp_publication_input_v3042(uuid)'),'EXECUTE')
    and position('load_drive_erp_publication_input_v3042' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid,boolean)')))>0
    and position('prepared_digest' in pg_get_functiondef(to_regprocedure(
      'public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)')))>0 as installed`;
  if (name === erpDrivePrepareBatchesMigration) return `select
    to_regclass('private.erp_drive_publication_parts_v3042') is not null
    and not has_table_privilege('authenticated',to_regclass('private.erp_drive_publication_parts_v3042'),'SELECT')
    and position('prepared_rows' in pg_get_functiondef(to_regprocedure(
      'private.run_erp_stage_publication_v3042(uuid)')))>0
    and position('agdata.erp.prepared_drive' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid)')))>0 as installed`;
  if (name === erpPayloadEfficiencyMigration) return `select
    position('stable_aliases as materialized' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('private.ph_master_inventory_lineage_key_v1(m)' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('agdata_erp_publication' in pg_get_functiondef(to_regprocedure(
      'private.run_erp_stage_publication_v3042(uuid)')))>0 as installed`;
  if (name === erpPublicationQueueMigration) return `select
    to_regclass('private.erp_stage_publication_jobs_v3042') is not null
    and to_regprocedure('private.run_erp_stage_publication_v3042(uuid)') is not null
    and has_function_privilege('service_role',to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'),'EXECUTE')
    and not has_function_privilege('authenticated',to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'),'EXECUTE')
    and position('select j.payload' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid)')))>0 as installed`;
  if (name !== erpPublicationLivenessMigration) return null;
  return `select
    position('disable trigger' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))=0
    and position('apply_erp_master_provenance_v3042' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)')))>0
    and position('jsonb_array_length(rows_value)' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid)')))>0
    and not has_function_privilege('authenticated',to_regprocedure('private.apply_erp_master_provenance_v3042()'),'EXECUTE')
    and (select count(*)=4 from pg_proc where oid in (
      to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid)'),
      to_regprocedure('public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb)'),
      to_regprocedure('public.fast_seal_erp_stage_v1(uuid,integer)'),
      to_regprocedure('public.fast_abort_erp_stage_v1(uuid)')) and 'statement_timeout=120s'=any(proconfig)) as installed`;
}
