export const erpPublicationLivenessMigration = '20261109210000_agdata3042_erp_publication_liveness.sql';
export const erpPublicationQueueMigration = '20261109211000_agdata3042_erp_publication_queue.sql';
export const erpPayloadEfficiencyMigration = '20261109212000_agdata3042_erp_payload_efficiency.sql';
export const erpDrivePrepareBatchesMigration = '20261109213000_agdata3042_drive_prepare_batches.sql';
export const erpDriveTransactionInputMigration = '20261109214000_agdata3042_drive_transaction_input.sql';
export const erpScanRecoveryMigration = '20261109215000_agdata3044_reclaim_stale_erp_scans.sql';
export const erpPublicationMigrationNames = [erpPublicationLivenessMigration, erpPublicationQueueMigration,
  erpPayloadEfficiencyMigration, erpDrivePrepareBatchesMigration, erpDriveTransactionInputMigration, erpScanRecoveryMigration];

export function erpPublicationMigrationContract(name) {
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
