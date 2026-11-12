export const erpPublicationSingleFlightMigration = '20261112021631_agdata3078_publication_single_flight.sql';
export const requestDeliveryCronSingleFlightMigration = '20261112022023_agdata3078_delivery_cron_single_flight.sql';
export const erpPublicationIdleCleanupMigration = '20261112022300_agdata3078_publication_idle_cleanup.sql';

export function erpPublicationSingleFlightContract() {
  return `select exists(select 1 from pg_catalog.pg_proc p
    where p.oid=to_regprocedure('private.run_erp_stage_publication_v3042(uuid)')
      and p.prorettype='void'::regtype and not p.prosecdef
      and strpos(split_part(p.prosrc,E'\\nbegin\\n',2),
        E'  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(''agdata:erp-publication-worker:v3078'',0)) then return; end if;\\n  select * into job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update skip locked;')=1
      and position('fast_commit_erp_stage_swap_v1' in p.prosrc)>0
      and position('cron.unschedule(job_name)' in p.prosrc)>0
      and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE')) as installed`;
}

export function requestDeliveryCronSingleFlightContract() {
  return `select exists(select 1 from pg_catalog.pg_proc p
    where p.oid=to_regprocedure('private.dispatch_request_delivery_worker_cron()')
      and p.prorettype='bigint'::regtype and not p.prosecdef
      and strpos(split_part(p.prosrc,E'\\nbegin\\n',2),
        E'  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(''agdata:delivery-cron-wake:v3078'',0)) then return null; end if;\\n  return private.wake_request_delivery_worker_now(''cron'');')=1
      and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE')
      and has_function_privilege('postgres',p.oid,'EXECUTE'))
    and exists(select 1 from cron.job where jobid=45 and jobname='gnc-request-delivery-worker'
      and schedule='* * * * *' and database='postgres' and username='postgres' and active
      and command='select private.dispatch_request_delivery_worker_cron()') as installed`;
}

export function erpPublicationIdleCleanupContract() {
  return `select exists(select 1 from pg_catalog.pg_proc p
    where p.oid=to_regprocedure('private.run_erp_stage_publication_v3042(uuid)')
      and position('if not exists(select 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id) and exists(select 1 from cron.job where jobname=job_name) then' in p.prosrc)>0
      and position('perform cron.unschedule(job_name)' in p.prosrc)>0
      and position('for update skip locked' in p.prosrc)>0)
    and (${erpPublicationSingleFlightContract().replace(/^select /,'').replace(/ as installed$/,'')}) as installed`;
}

export const erpPublicationSingleFlightContracts = [
  [erpPublicationSingleFlightMigration, erpPublicationSingleFlightContract],
  [requestDeliveryCronSingleFlightMigration, requestDeliveryCronSingleFlightContract],
  [erpPublicationIdleCleanupMigration, erpPublicationIdleCleanupContract]
];
