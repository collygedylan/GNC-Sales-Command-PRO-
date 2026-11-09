export const erpPublicationLivenessMigration = '20261109210000_agdata3042_erp_publication_liveness.sql';
export const erpPublicationQueueMigration = '20261109211000_agdata3042_erp_publication_queue.sql';
export const erpPayloadEfficiencyMigration = '20261109212000_agdata3042_erp_payload_efficiency.sql';
export const erpPublicationMigrationNames = [erpPublicationLivenessMigration, erpPublicationQueueMigration, erpPayloadEfficiencyMigration];

export function erpPublicationMigrationContract(name) {
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
