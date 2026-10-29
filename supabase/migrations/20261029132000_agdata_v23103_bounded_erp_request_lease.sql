begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

-- Browser-driven bounded ERP continuations release promptly and can be reclaimed
-- when a worker is abandoned. Local filesystem workers retain their null request lease.
create or replace function public.claim_erp_sync_request_step_v1(p_run_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare job private.erp_sync_jobs%rowtype; stamp timestamptz:=clock_timestamp();
begin
  select * into job from private.erp_sync_jobs where run_id=p_run_id for update;
  if not found then raise exception 'ERP_SYNC_JOB_NOT_FOUND'; end if;
  if job.requested_by is distinct from nullif(btrim(p_actor),'') then raise exception 'ERP_SYNC_COMMAND_ACTOR_MISMATCH'; end if;
  if not job.active or job.request_lease_until>stamp then
    return job.status||jsonb_build_object('claimed',false,'continuationStep',job.continuation_step,'retryAfterMs',1000);
  end if;
  update private.erp_sync_jobs set worker_id=gen_random_uuid(),request_lease_until=stamp+interval '12 seconds',
    continuation_step=continuation_step+1,updated_at=stamp,
    status=status||jsonb_build_object('status','running','worker','supabase_request',
      'continuationStep',continuation_step+1,'updatedAt',stamp)
    where run_id=p_run_id returning * into job;
  return job.status||jsonb_build_object('claimed',true,'workerId',job.worker_id,'continuationStep',job.continuation_step);
end;
$$;

create or replace function public.assert_erp_sync_worker_v1(p_run_id uuid,p_worker_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,private as $$
declare result jsonb; stamp timestamptz:=clock_timestamp();
begin
  update private.erp_sync_jobs set request_lease_until=case when request_lease_until is null then null
      else stamp+interval '12 seconds' end
    where run_id=p_run_id and worker_id=p_worker_id and active
      and (request_lease_until is null or request_lease_until>stamp)
    returning status into result;
  if result is null then raise exception 'ERP_SYNC_WORKER_LEASE_INVALID'; end if;
  return result;
end;
$$;

revoke all on function public.claim_erp_sync_request_step_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.assert_erp_sync_worker_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_erp_sync_request_step_v1(uuid,text) to service_role;
grant execute on function public.assert_erp_sync_worker_v1(uuid,uuid) to service_role;
commit;
