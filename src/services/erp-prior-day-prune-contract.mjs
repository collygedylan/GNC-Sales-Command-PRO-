export const erpPriorDayPruneMigration = '20261112060100_agdata3078_prior_day_prune_guard.sql';

export function erpPriorDayPruneContract() {
  return `select exists(select 1 from pg_proc scope
    join pg_proc guard on guard.oid=to_regprocedure('private.assert_prior_run_day_prune_safe_v3078(text[],timestamptz)')
    join pg_proc owner on owner.oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')
    where scope.oid=to_regprocedure('private.erp_prior_run_day_cutoff_v3078(text)')
      and not scope.prosecdef and not guard.prosecdef and owner.prosecdef
      and pg_get_userbyid(scope.proowner)='postgres' and pg_get_userbyid(guard.proowner)='postgres'
      and not has_function_privilege('anon',scope.oid,'EXECUTE')
      and not has_function_privilege('authenticated',scope.oid,'EXECUTE')
      and not has_function_privilege('service_role',scope.oid,'EXECUTE')
      and not has_function_privilege('anon',guard.oid,'EXECUTE')
      and not has_function_privilege('authenticated',guard.oid,'EXECUTE')
      and not has_function_privilege('service_role',guard.oid,'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(scope.proacl,acldefault('f',scope.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(guard.proacl,acldefault('f',guard.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      and position('private.has_drive_work_binding_v3078(true)' in scope.prosrc)>0
      and position('private.erp_drive_final_certificates_v3078' in scope.prosrc)>0
      and position('private.erp_sync_jobs' in scope.prosrc)>0
      and position('r.started_at' in scope.prosrc)>0
      and position('America/Chicago' in scope.prosrc)>0
      and position('ERP_PRIOR_DAY_CONTEXT_INVALID' in scope.prosrc)>0
      and position('ph_master_inventory_app_edits' in guard.prosrc)>0
      and position('inventory_live_overrides_v1' in guard.prosrc)>0
      and position('inventory_location_evidence_v1' in guard.prosrc)>0
      and position('ph_productivity_history' in guard.prosrc)>0
      and position('any(p_candidates)' in guard.prosrc)>0
      and position('ERP_PRIOR_RUN_DAY_PRUNE_REVIEW_REQUIRED' in guard.prosrc)>0
      and position('canonical_unique_id'',affected_uid' in guard.prosrc)>0
      and position('prior_run_day_scope_v3078 as materialized' in owner.prosrc)>0
      and position('prior_run_day_guard_v3078 as materialized' in owner.prosrc)>0
      and position('private.assert_prior_run_day_prune_safe_v3078(array(select c.unique_id from eligible_missing_source c),scope.prior_day)' in owner.prosrc)>0
      and position('using eligible_missing_source candidate,prior_run_day_guard_v3078 guard' in owner.prosrc)>0
      and position('where guard.ok and live.unique_id=candidate.unique_id and live.ctid=candidate.physical_tid' in owner.prosrc)>0
  ) as installed`;
}

export const erpPriorDayPruneContracts = [[erpPriorDayPruneMigration, erpPriorDayPruneContract]];
