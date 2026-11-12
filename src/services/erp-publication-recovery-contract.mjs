export const erpBoundedRecoveryMigration = '20261112011000_agdata3077_bounded_publication_recovery.sql';
export const erpPublicationLoadPauseMigration = '20261112011500_agdata3077_publication_load_pause.sql';
export const erpDrivePlannerStatisticsMigration = '20261112012000_agdata3077_drive_stage_planner_statistics.sql';
export const erpVerifiedStageResumeMigration = '20261112012500_agdata3077_resume_verified_drive_stage.sql';

export function erpBoundedRecoveryContract() {
  return `select
    position('120s' in pg_get_functiondef(
      'private.schedule_erp_stage_publication_v3057(uuid)'::regprocedure))>0
    and position('select private.load_drive' in pg_get_functiondef(
      'private.schedule_erp_stage_publication_v3057(uuid)'::regprocedure))=0
    and position('GET STACKED DIAGNOSTICS' in upper(pg_get_functiondef(
      'private.run_erp_stage_publication_v3042(uuid)'::regprocedure)))>0
    and position('last_progress_at' in pg_get_functiondef(
      'public.resume_erp_stage_publication_v3077(uuid)'::regprocedure))>0
    and position('exception when query_canceled' in pg_get_functiondef(
      'private.load_drive_erp_publication_input_v3042(uuid)'::regprocedure))=0
    and has_function_privilege('service_role','public.resume_erp_stage_publication_v3077(uuid)','EXECUTE')
    and not has_function_privilege('authenticated','public.resume_erp_stage_publication_v3077(uuid)','EXECUTE')
    and has_function_privilege('service_role','public.resume_failed_erp_sync_run_v3077(uuid,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.resume_failed_erp_sync_run_v3077(uuid,text)','EXECUTE')
    and not has_table_privilege('service_role','private.erp_stage_publication_jobs_v3042','SELECT') as installed`;
}

export function erpPublicationLoadPauseContract() {
  return `select
    position('pg_cancel_backend' in pg_get_functiondef(
      'private.pause_erp_publication_v3077(uuid,text)'::regprocedure))>0
    and position('cron.alter_job' in pg_get_functiondef(
      'private.pause_erp_publication_v3077(uuid,text)'::regprocedure))>0
    and not has_function_privilege('service_role',
      'private.pause_erp_publication_v3077(uuid,text)','EXECUTE')
    and not has_function_privilege('authenticated',
      'private.pause_erp_publication_v3077(uuid,text)','EXECUTE') as installed`;
}

export function erpDrivePlannerStatisticsContract() {
  return `select position(
    'perform private.refresh_drive_stage_cohort_statistics_v3077()'
    in pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure))>0
    and position('count(distinct field_keys)' in pg_get_functiondef(
      'private.refresh_drive_stage_cohort_statistics_v3077()'::regprocedure))>0
    and position('n_distinct=%s' in pg_get_functiondef(
      'private.refresh_drive_stage_cohort_statistics_v3077()'::regprocedure))>0
    and not has_function_privilege('service_role','private.refresh_drive_stage_cohort_statistics_v3077()','EXECUTE')
    and not has_function_privilege('service_role','private.prepare_master_bulk_stage_v3046(jsonb)','EXECUTE') as installed`;
}

export const erpRecoveryPublicationContracts = [
  [erpBoundedRecoveryMigration, erpBoundedRecoveryContract],
  [erpPublicationLoadPauseMigration, erpPublicationLoadPauseContract],
  [erpDrivePlannerStatisticsMigration, erpDrivePlannerStatisticsContract],
  [erpVerifiedStageResumeMigration, erpDrivePlannerStatisticsContract]
];
