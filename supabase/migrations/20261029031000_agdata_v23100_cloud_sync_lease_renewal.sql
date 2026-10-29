begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Keep the canonical private job lease shared by browser and cloud workers.
-- Renew before each <=120s append/publication RPC; an expired/replaced owner
-- cannot revive its lease or publish further progress.
create or replace function public.assert_erp_sync_worker_v1(p_run_id uuid, p_worker_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public, private as $$
declare result jsonb; stamp timestamptz := clock_timestamp();
begin
  update private.erp_sync_jobs
    set request_lease_until = case when request_lease_until is null then null
      else stamp + interval '140 seconds' end
    where run_id=p_run_id and worker_id=p_worker_id and active
      and (request_lease_until is null or request_lease_until > stamp)
    returning status into result;
  if result is null then raise exception 'ERP_SYNC_WORKER_LEASE_INVALID'; end if;
  return result;
end;
$$;
revoke all on function public.assert_erp_sync_worker_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.assert_erp_sync_worker_v1(uuid,uuid) to service_role;
commit;
