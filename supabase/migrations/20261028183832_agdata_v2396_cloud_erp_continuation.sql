begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

alter table private.erp_sync_jobs add column if not exists request_lease_until timestamptz;

-- A browser advances cloud requests explicitly. A live request is never replaced
-- while its atomic publication can still be running; an expired request is resumable.
create or replace function public.claim_erp_sync_job_v2(
  p_command_id text, p_actor text, p_force_restart boolean
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare job private.erp_sync_jobs%rowtype; stamp timestamptz := clock_timestamp();
begin
  if p_command_id is null or p_command_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or nullif(btrim(p_actor),'') is null or length(p_actor)>200 then
    raise exception 'ERP_SYNC_COMMAND_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agdata:manual-erp-sync',0));
  select * into job from private.erp_sync_jobs where command_id=p_command_id for update;
  if found then
    if job.requested_by <> btrim(p_actor) then raise exception 'ERP_SYNC_COMMAND_ACTOR_MISMATCH'; end if;
    return job.status || jsonb_build_object('claimed',false);
  end if;
  select * into job from private.erp_sync_jobs where active for update;
  if found then
    if not coalesce(p_force_restart,false) or job.request_lease_until > stamp
      or (job.status->>'worker' is distinct from 'supabase_request'
        and job.updated_at > stamp-interval '150 seconds') then
      return job.status || jsonb_build_object('claimed',false,'status','busy');
    end if;
    -- Preserve a browser run's durable cursor instead of replaying committed stages.
    if job.status->>'worker' = 'supabase_request' and job.requested_by=btrim(p_actor) then
      return job.status || jsonb_build_object('claimed',false,'status','busy');
    end if;
    update private.erp_sync_jobs set active=false, worker_id=null, request_lease_until=null,
      finished_at=stamp, updated_at=stamp,
      status=status || jsonb_build_object('active',false,'status','failed','currentStage','idle',
        'finishedAt',stamp,'updatedAt',stamp,'errorCode','ERP_SYNC_SUPERSEDED',
        'error','The abandoned worker was replaced; published data is retained.')
      where run_id=job.run_id;
  end if;
  return public.claim_erp_sync_job_v1(p_command_id,p_actor);
end;
$$;

create or replace function public.claim_erp_sync_request_step_v1(p_run_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare job private.erp_sync_jobs%rowtype; stamp timestamptz := clock_timestamp();
begin
  select * into job from private.erp_sync_jobs where run_id=p_run_id for update;
  if not found then raise exception 'ERP_SYNC_JOB_NOT_FOUND'; end if;
  if job.requested_by is distinct from nullif(btrim(p_actor),'') then raise exception 'ERP_SYNC_COMMAND_ACTOR_MISMATCH'; end if;
  if not job.active or job.request_lease_until > stamp then
    return job.status || jsonb_build_object('claimed',false,'continuationStep',job.continuation_step,'retryAfterMs',1000);
  end if;
  update private.erp_sync_jobs set worker_id=gen_random_uuid(),
    request_lease_until=stamp+interval '140 seconds', continuation_step=continuation_step+1,
    updated_at=stamp, status=status || jsonb_build_object('status','running','worker','supabase_request',
      'continuationStep',continuation_step+1,'updatedAt',stamp)
    where run_id=p_run_id returning * into job;
  return job.status || jsonb_build_object('claimed',true,'workerId',job.worker_id,'continuationStep',job.continuation_step);
end;
$$;

create or replace function public.release_erp_sync_request_step_v1(p_run_id uuid,p_worker_id uuid,p_step integer)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  update private.erp_sync_jobs set request_lease_until=null
    where run_id=p_run_id and worker_id=p_worker_id and continuation_step=p_step;
  return found;
end;
$$;

-- Keep the canonical staging validator, exact replay checks and atomic importer.
-- Five thousand rows amortize REST overhead without growing a request unboundedly.
do $$
declare definition text := pg_get_functiondef('public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb)'::regprocedure);
begin
  if position('jsonb_array_length(p_rows)>1000' in definition)=0
    and position('jsonb_array_length(p_rows)>5000' in definition)=0 then
    raise exception 'ERP_SYNC_APPEND_CONTRACT_CHANGED';
  end if;
  definition := replace(definition,'jsonb_array_length(p_rows)>1000','jsonb_array_length(p_rows)>5000');
  execute definition;
end;
$$;
alter function public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb) set statement_timeout='120s';

revoke all on function public.claim_erp_sync_job_v2(text,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_erp_sync_request_step_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.release_erp_sync_request_step_v1(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_erp_sync_job_v2(text,text,boolean) to service_role;
grant execute on function public.claim_erp_sync_request_step_v1(uuid,text) to service_role;
grant execute on function public.release_erp_sync_request_step_v1(uuid,uuid,integer) to service_role;
commit;
