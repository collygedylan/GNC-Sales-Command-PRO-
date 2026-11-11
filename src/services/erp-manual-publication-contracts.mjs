export const erpManualRestartMigration = '20261110223000_agdata3064_manual_scan_restart.sql';
export const erpBatchedPublicationMigration = '20261110224000_agdata3064_batched_publication_worker.sql';

export function erpManualRestartContract() {
  return `select
    position('erp_manual_scan_restartable_v3064' in pg_get_functiondef(
      'public.claim_erp_sync_job_v2(text,text,boolean)'::regprocedure))>0
    and not has_function_privilege('service_role',
      'private.erp_manual_scan_restartable_v3064(jsonb,timestamptz,timestamptz,timestamptz)','EXECUTE')
    and private.erp_manual_scan_restartable_v3064('{"currentStage":"scanning"}',
      now()-interval '2 minutes',now()-interval '2 minutes',now())
    and not private.erp_manual_scan_restartable_v3064(
      '{"currentStage":"drive","continuationCursor":{"fileContinuation":{"phase":"finalize"}}}',
      now()-interval '2 minutes',now()-interval '2 minutes',now()) as installed`;
}

export function erpBatchedPublicationContract() {
  return `select
    position('prepare_erp_publication_part_v3064' in pg_get_functiondef(
      'private.run_erp_stage_publication_v3042(uuid)'::regprocedure))>0
    and position('preparedRows' in pg_get_functiondef(
      'public.fast_commit_erp_stage_swap_v1(uuid,boolean)'::regprocedure))>0
    and position('limit 1000' in pg_get_functiondef(
      'private.prepare_erp_publication_part_v3064(uuid,integer,integer)'::regprocedure))>0
    and not has_function_privilege('service_role',
      'private.prepare_erp_publication_part_v3064(uuid,integer,integer)','EXECUTE')
    and not has_table_privilege('authenticated','private.erp_drive_publication_parts_v3042','SELECT')
    and private.erp_publication_part_matches_v3064('drive_around',
      '{"values":{"spec":"keep","last_updated":"before"}}',
      '{"values":{"spec":"keep","last_updated":"after"}}')
    and not private.erp_publication_part_matches_v3064('drive_around',
      '{"values":{"spec":"keep"}}','{"values":{"spec":"changed"}}') as installed`;
}

export const erpManualPublicationContracts = [
  [erpManualRestartMigration, erpManualRestartContract],
  [erpBatchedPublicationMigration, erpBatchedPublicationContract]
];
