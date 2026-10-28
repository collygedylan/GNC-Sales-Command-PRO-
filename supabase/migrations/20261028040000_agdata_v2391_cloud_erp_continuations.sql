begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

alter table private.erp_sync_jobs
  add column if not exists continuation_step integer not null default 0
  check (continuation_step >= 0);

create or replace function public.claim_erp_sync_worker_v1(p_run_id uuid, p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare job private.erp_sync_jobs%rowtype;
begin
  if p_run_id is null or p_worker_id is null then raise exception 'ERP_SYNC_WORKER_ID_INVALID'; end if;
  select * into job from private.erp_sync_jobs where run_id=p_run_id for update;
  if not found then raise exception 'ERP_SYNC_JOB_NOT_FOUND'; end if;
  if not job.active or job.worker_id is not null or job.status->>'status' <> 'queued' then
    return job.status || jsonb_build_object('claimed',false,'continuationStep',job.continuation_step);
  end if;
  update private.erp_sync_jobs set worker_id=p_worker_id, updated_at=clock_timestamp(),
    status=status || jsonb_build_object('status','running','currentStage','drive',
      'currentStageLabel','Drive','updatedAt',clock_timestamp(),'worker','supabase_edge',
      'continuationStep',continuation_step)
    where run_id=p_run_id returning * into job;
  return job.status || jsonb_build_object('claimed',true,'continuationStep',job.continuation_step);
end;
$$;

create or replace function public.claim_erp_sync_worker_step_v1(p_run_id uuid, p_worker_id uuid, p_step integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare job private.erp_sync_jobs%rowtype;
begin
  if p_run_id is null or p_worker_id is null or p_step is null or p_step < 0 or p_step > 100000 then
    raise exception 'ERP_SYNC_WORKER_STEP_INVALID';
  end if;
  select * into job from private.erp_sync_jobs where run_id=p_run_id for update;
  if not found then raise exception 'ERP_SYNC_JOB_NOT_FOUND'; end if;
  if not job.active or job.worker_id is distinct from p_worker_id or job.continuation_step <> p_step then
    return job.status || jsonb_build_object('claimed',false,'continuationStep',job.continuation_step);
  end if;
  update private.erp_sync_jobs set continuation_step=continuation_step+1,
    updated_at=clock_timestamp(), status=status || jsonb_build_object(
      'continuationStep',continuation_step+1,'updatedAt',clock_timestamp(),'worker','supabase_edge')
    where run_id=p_run_id returning * into job;
  return job.status || jsonb_build_object('claimed',true,'continuationStep',job.continuation_step);
end;
$$;

revoke all on function public.claim_erp_sync_worker_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_erp_sync_worker_step_v1(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_erp_sync_worker_v1(uuid,uuid) to service_role;
grant execute on function public.claim_erp_sync_worker_step_v1(uuid,uuid,integer) to service_role;
commit;
