begin;
set local statement_timeout = '30s';
set local lock_timeout = '1500ms';

-- Only the scheduled wake uses this guard; immediate outbox wakes and the
-- existing worker's per-event leases remain independent and unchanged.
create or replace function private.dispatch_request_delivery_worker_cron()
returns bigint language plpgsql set search_path = '' as $dispatch$
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('agdata:delivery-cron-wake:v3078',0)) then return null; end if;
  return private.wake_request_delivery_worker_now('cron');
end
$dispatch$;
revoke all on function private.dispatch_request_delivery_worker_cron() from public,anon,authenticated,service_role;

do $schedule$
declare job record;
  old_command constant text := 'select private.wake_request_delivery_worker_now(''cron'')';
  new_command constant text := 'select private.dispatch_request_delivery_worker_cron()';
begin
  select jobid,jobname,schedule,database,username,active,command into job from cron.job where jobid=45;
  if not found or job.jobname is distinct from 'gnc-request-delivery-worker'
    or job.schedule is distinct from '* * * * *' or job.database is distinct from 'postgres'
    or job.username is distinct from 'postgres' or job.active is distinct from true
    or job.command not in (old_command,new_command)
    or not has_function_privilege(job.username,'private.dispatch_request_delivery_worker_cron()','EXECUTE') then
    raise exception 'DELIVERY_CRON_IDENTITY_CHANGED';
  end if;
  if job.command=old_command then perform cron.alter_job(job.jobid,command:=new_command); end if;
  if not exists(select 1 from cron.job j where j.jobid=45 and j.jobname=job.jobname
    and j.schedule=job.schedule and j.database=job.database and j.username=job.username
    and j.active=job.active and j.command=new_command) then
    raise exception 'DELIVERY_CRON_UPDATE_UNCONFIRMED';
  end if;
end
$schedule$;
commit;
