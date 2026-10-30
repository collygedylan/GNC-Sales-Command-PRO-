begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
CREATE OR REPLACE FUNCTION public.claim_erp_sync_request_step_v1(p_run_id uuid, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare job private.erp_sync_jobs%rowtype; stamp timestamptz:=clock_timestamp();
begin
  select * into job from private.erp_sync_jobs where run_id=p_run_id for update;
  if not found then raise exception 'ERP_SYNC_JOB_NOT_FOUND'; end if;
  if job.requested_by is distinct from nullif(btrim(p_actor),'') then raise exception 'ERP_SYNC_COMMAND_ACTOR_MISMATCH'; end if;
  if not job.active or job.request_lease_until>stamp then
    return job.status||jsonb_build_object('claimed',false,'continuationStep',job.continuation_step,'retryAfterMs',1000);
  end if;
  update private.erp_sync_jobs set worker_id=gen_random_uuid(),request_lease_until=stamp+interval '4 seconds',
    continuation_step=continuation_step+1,updated_at=stamp,
    status=status||jsonb_build_object('status','running','worker','supabase_request',
      'continuationStep',continuation_step+1,'updatedAt',stamp)
    where run_id=p_run_id returning * into job;
  return job.status||jsonb_build_object('claimed',true,'workerId',job.worker_id,'continuationStep',job.continuation_step);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.assert_erp_sync_worker_v1(p_run_id uuid, p_worker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare result jsonb; stamp timestamptz:=clock_timestamp();
begin
  update private.erp_sync_jobs set updated_at=stamp,request_lease_until=case when request_lease_until is null then null
      else stamp+interval '4 seconds' end
    where run_id=p_run_id and worker_id=p_worker_id and active
      and (request_lease_until is null or request_lease_until>stamp)
    returning status into result;
  if result is null then raise exception 'ERP_SYNC_WORKER_LEASE_INVALID'; end if;
  return result;
end;
$function$
;
create or replace function public.get_my_erp_sync_progress_v23116() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; result jsonb;
begin
  actor:=private.current_active_profile();
  if actor.id is null then
    raise exception using errcode='42501',message='ERP_SYNC_PROGRESS_FORBIDDEN';
  end if;
  select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) into result
    from jsonb_each(public.get_erp_sync_status_v1()) e(k,v)
    where k=any(array['active','status','runId','currentStage','currentStageLabel','stageIndex','stageOrder','stageResults','sourceProgress','startedAt','updatedAt','finishedAt','error','errorCode','message']);
  result:=result||jsonb_build_object('sourceProgress',coalesce((select jsonb_object_agg(s.source,
    jsonb_build_object('fileName',r.source_file_name,'updatedAt',r.source_imported_at,'stage','idle','percent',0,'rowsPublished',0)
      ||coalesce(result->'sourceProgress'->s.source,'{}'::jsonb))
    from (values ('drive','ph_master_inventory'),('cav','ph_cav_import'),('reserves','ph_reserves'),('soc','ph_soc_master'),('hl_po','ph_hl_po_parsed')) s(source,key)
    left join public.app_dataset_revisions r on r.key=s.key),'{}'::jsonb)||coalesce(result->'sourceProgress','{}'::jsonb));
  return result;
end $$;
revoke all on function public.get_my_erp_sync_progress_v23116() from public,anon;
grant execute on function public.get_my_erp_sync_progress_v23116() to authenticated;
notify pgrst,'reload schema';
commit;
