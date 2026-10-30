begin;
-- Recover only accepted, inactive-lease work; every HTTP relay envelope remains bounded to forty hops.
create or replace function private.wake_erp_sync_job_v23116()
returns bigint language plpgsql security definer set search_path = ''
as $function$
declare target_run uuid; worker_key text;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('agdata_erp_sync_recovery_v23116')) then return null; end if;
  select run_id into target_run from private.erp_sync_jobs
    where active and (request_lease_until is null or request_lease_until <= clock_timestamp())
      and updated_at < clock_timestamp() - interval '10 seconds'
    order by updated_at limit 1;
  if target_run is null then return null; end if;
  select decrypted_secret into worker_key from vault.decrypted_secrets where name='hr_calendar_service_role_key' limit 1;
  if coalesce(worker_key,'')='' then raise exception 'ERP_SYNC_RECOVERY_KEY_UNAVAILABLE'; end if;
  return net.http_post(
    url := 'https://kzrnyjsosryejjejliii.supabase.co/functions/v1/app-api',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_key,'apikey',worker_key),
    body := jsonb_build_object('action','erp_sync','operation','continue','runId',target_run,'relayHop',1),
    timeout_milliseconds := 10000);
end;
$function$;
revoke all on function private.wake_erp_sync_job_v23116() from public, anon, authenticated;
grant execute on function private.wake_erp_sync_job_v23116() to service_role;
select cron.schedule('agdata-erp-sync-recovery-v23116','* * * * *','select private.wake_erp_sync_job_v23116();');
commit;
