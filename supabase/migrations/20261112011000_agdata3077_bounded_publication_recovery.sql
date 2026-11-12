begin;
set local statement_timeout = '120s';
set local lock_timeout = '15s';

alter table private.erp_stage_publication_jobs_v3042
  add column last_progress_at timestamptz not null default clock_timestamp(),
  add column last_attempt_at timestamptz,
  add column recovery_count integer not null default 0 check(recovery_count between 0 and 1),
  add column last_error_message text,
  add column last_error_detail text,
  add column last_error_context text,
  add column last_error_phase text;
update private.erp_stage_publication_jobs_v3042 j set last_progress_at=s.created_at
from private.fast_erp_stage_runs_v1 s where s.stage_id=j.stage_id;

create function private.prepare_erp_publication_v3077(p_stage_id uuid)
returns boolean language plpgsql set search_path = '' as $prepare$
declare stage private.fast_erp_stage_runs_v1%rowtype; job private.erp_stage_publication_jobs_v3042%rowtype; prepared jsonb;
begin
  select * into strict stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  select * into strict job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id;
  if job.prepared_rows<stage.expected_rows then
    update private.erp_stage_publication_jobs_v3042 set payload=null,failures=0,last_error=null,
      last_progress_at=clock_timestamp(),
      prepared_rows=job.prepared_rows+private.prepare_erp_publication_part_v3064(p_stage_id,job.prepared_rows,stage.expected_rows)
    where stage_id=p_stage_id;
    return false;
  end if;
  if stage.dataset_key<>'drive_around' and job.payload is null then
    select ('['||string_agg(body,',' order by first_row)||']')::jsonb into prepared
    from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id;
    if coalesce(jsonb_array_length(prepared),0)<>stage.expected_rows then raise exception 'FAST_ERP_STAGE_INCOMPLETE'; end if;
    update private.erp_stage_publication_jobs_v3042 set payload=prepared,failures=0,last_error=null,
      last_progress_at=clock_timestamp() where stage_id=p_stage_id;
    return false;
  end if;
  return true;
end
$prepare$;
revoke all on function private.prepare_erp_publication_v3077(uuid) from public,anon,authenticated,service_role;

-- Preparation errors must reach the one attempt owner. Previously a caught
-- preload timeout fell through into a second complete publication attempt.
do $preload$
declare definition text:=pg_get_functiondef('private.load_drive_erp_publication_input_v3042(uuid)'::regprocedure);
  prior text:=$old$  exception when query_canceled or others then
    update private.erp_stage_publication_jobs_v3042 set failures=attempt+1,
      next_attempt_at=clock_timestamp()+least(60,5*2^attempt)*interval '1 second',last_error=SQLSTATE
      where stage_id=p_stage_id;
$old$;
begin
  if cardinality(string_to_array(definition,prior))<>2 then raise exception 'ERP_PUBLICATION_PRELOAD_CHANGED'; end if;
  definition:=replace(definition,'declare attempt integer;'||chr(10),'');
  definition:=replace(definition,'  select j.failures into attempt','  perform 1');
  execute replace(definition,prior,'');
end
$preload$;

create or replace function private.run_erp_stage_publication_v3042(p_stage_id uuid)
returns void language plpgsql set search_path = '' set work_mem = '64MB' as $worker$
declare
  stage private.fast_erp_stage_runs_v1%rowtype; job private.erp_stage_publication_jobs_v3042%rowtype;
  receipt jsonb; phase text:='prepare'; message text; detail text; context text;
  job_name text:='agdata-erp-publication-'||p_stage_id;
begin
  select * into job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update skip locked;
  if not found then
    if not exists(select 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id) then
      perform cron.unschedule(job_name);
    end if;
    return;
  end if;
  if job.next_attempt_at>clock_timestamp() then return; end if;
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.stage_state='committed' or stage.expires_at<=clock_timestamp() or job.failures>=6 then
    if stage.stage_state='committed' then delete from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id; end if;
    perform cron.unschedule(job_name);
    return;
  end if;
  update private.erp_stage_publication_jobs_v3042 set last_attempt_at=clock_timestamp() where stage_id=p_stage_id;
  begin
    if not private.prepare_erp_publication_v3077(p_stage_id) then return; end if;
    perform private.load_drive_erp_publication_input_v3042(p_stage_id);
    phase:='publish';
    perform set_config('request.jwt.claim.role','service_role',true);
    perform set_config('application_name','agdata_erp_publication',true);
    receipt:=public.fast_commit_erp_stage_swap_v1(p_stage_id);
    if coalesce((receipt->>'busy')::boolean,false) then return; end if;
    if not coalesce((receipt->>'ok')::boolean,false) then raise exception 'FAST_ERP_STAGE_COMMIT_UNCONFIRMED'; end if;
    delete from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id;
    perform cron.unschedule(job_name);
  exception when query_canceled or others then
    get stacked diagnostics message=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL,context=PG_EXCEPTION_CONTEXT;
    update private.erp_stage_publication_jobs_v3042 set failures=job.failures+1,
      next_attempt_at=clock_timestamp()+least(60,5*2^job.failures)*interval '1 second',last_error=SQLSTATE,
      last_error_message=left(message,1000),last_error_detail=left(detail,2000),
      last_error_context=left(context,6000),last_error_phase=phase where stage_id=p_stage_id;
  end;
end
$worker$;
revoke all on function private.run_erp_stage_publication_v3042(uuid) from public,anon,authenticated,service_role;

create or replace function private.schedule_erp_stage_publication_v3057(p_stage_id uuid)
returns bigint language sql set search_path = '' as $schedule$
  select cron.schedule('agdata-erp-publication-'||p_stage_id,'2 seconds',format(
    'begin; set local statement_timeout = ''120s''; set local lock_timeout = ''15s''; select private.run_erp_stage_publication_v3042(%L::uuid); commit',p_stage_id));
$schedule$;
revoke all on function private.schedule_erp_stage_publication_v3057(uuid) from public,anon,authenticated,service_role;

do $progress$
declare definition text:=pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'::regprocedure);
  prior text:='message=''ERP_PUBLICATION_RETRY_EXHAUSTED'',detail=error_code;';
  receipt text:=$old$'expectedRows',stage.expected_rows,'preparedRows',coalesce((select prepared_rows$old$;
begin
  if cardinality(string_to_array(definition,prior))<>2 or cardinality(string_to_array(definition,receipt))<>2 then
    raise exception 'ERP_PUBLICATION_PROGRESS_CHANGED';
  end if;
  definition:=replace(definition,prior,$new$message='ERP_PUBLICATION_RETRY_EXHAUSTED',detail=jsonb_build_object(
      'stage_id',p_stage_id,'lastError',error_code,'publicationProgressAt',(select last_progress_at
        from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id))::text;$new$);
  execute replace(definition,receipt,$new$'publicationProgressAt',(select last_progress_at
      from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id),
    'expectedRows',stage.expected_rows,'preparedRows',coalesce((select prepared_rows$new$);
end
$progress$;

create function public.resume_erp_stage_publication_v3077(p_stage_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $resume$
declare stage private.fast_erp_stage_runs_v1%rowtype; job private.erp_stage_publication_jobs_v3042%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.stage_state='committed' and stage.committed_result is not null then
    return stage.committed_result||jsonb_build_object('stage_id',p_stage_id,'stage_replayed',true);
  end if;
  if not found or stage.stage_state<>'staging' or stage.expires_at<=clock_timestamp()
    or stage.staged_rows<>stage.expected_rows then raise exception using errcode='55000',message='FAST_ERP_STAGE_INCOMPLETE'; end if;
  select * into job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update skip locked;
  if not found then
    if exists(select 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id) then
      return jsonb_build_object('ok',true,'busy',true,'stage_id',p_stage_id,'retryAfterMs',2500);
    end if;
    raise exception using errcode='55000',message='ERP_PUBLICATION_JOB_MISSING';
  end if;
  if job.recovery_count=0 then
    if job.last_progress_at>clock_timestamp()-interval '90 seconds' then
      return jsonb_build_object('ok',true,'busy',true,'stage_id',p_stage_id,'retryAfterMs',2500,'recoveryDue',false,
        'publicationProgressAt',job.last_progress_at,'preparedRows',job.prepared_rows);
    end if;
    update private.erp_stage_publication_jobs_v3042 set recovery_count=1,failures=0,
      next_attempt_at=clock_timestamp() where stage_id=p_stage_id;
    perform private.schedule_erp_stage_publication_v3057(p_stage_id);
  elsif job.failures>=6 then
    raise exception using errcode='55000',message='ERP_PUBLICATION_RECOVERY_EXHAUSTED',detail=job.last_error;
  end if;
  return jsonb_build_object('ok',true,'busy',true,'stage_id',p_stage_id,'retryAfterMs',2500,
    'preparedRows',job.prepared_rows,'expectedRows',stage.expected_rows,'recoveryAccepted',true,
    'publicationProgressAt',job.last_progress_at);
end
$resume$;
revoke all on function public.resume_erp_stage_publication_v3077(uuid) from public,anon,authenticated;
grant execute on function public.resume_erp_stage_publication_v3077(uuid) to service_role;

create function public.resume_failed_erp_sync_run_v3077(p_run_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $run$
declare run private.erp_sync_jobs%rowtype; stage private.fast_erp_stage_runs_v1%rowtype; stage_key text; resumed jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='ERP_SYNC_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agdata:manual-erp-sync',0));
  select * into run from private.erp_sync_jobs where run_id=p_run_id for update;
  if not found or run.requested_by is distinct from p_actor then raise exception 'ERP_SYNC_RUN_IDENTITY_MISMATCH'; end if;
  if run.active then return jsonb_build_object('ok',true,'runId',p_run_id,'active',true,'run_replayed',true); end if;
  if run.status->>'errorCode' is distinct from 'ERP_PUBLICATION_RETRY_EXHAUSTED'
    or run.status#>>'{continuationCursor,fileContinuation,state,phase}' is distinct from 'finalize'
    or exists(select 1 from private.erp_sync_jobs where active and run_id<>p_run_id) then
    raise exception 'ERP_SYNC_RUN_NOT_RECOVERABLE';
  end if;
  select * into stage from private.fast_erp_stage_runs_v1
    where stage_id=(run.status#>>'{continuationCursor,fileContinuation,state,stageId}')::uuid;
  if not found or stage.file_meta->>'sync_run_id' is distinct from p_run_id::text
    or stage.file_meta->>'file_id' is distinct from run.status#>>'{continuationCursor,fileContinuation,file,id}' then
    raise exception 'ERP_SYNC_STAGE_IDENTITY_MISMATCH';
  end if;
  resumed:=public.resume_erp_stage_publication_v3077(stage.stage_id);
  stage_key:=case stage.dataset_key when 'drive_around' then 'drive' else stage.dataset_key end;
  update private.erp_sync_jobs set active=true,finished_at=null,worker_id=null,request_lease_until=null,
    updated_at=clock_timestamp(),status=run.status||jsonb_build_object('active',true,'status','running','error','',
      'errorCode','','finishedAt',null,'currentStage',stage_key,'stageIndex',(run.status#>>'{continuationCursor,stageIndex}')::integer,
      'sliceFailures',0,'retryNotBefore',0,'workerActive',false,'resumable',true,'recoveryDue',true,
      'message','Resuming saved ERP publication checkpoint.') where run_id=p_run_id;
  return resumed||jsonb_build_object('runId',p_run_id,'resumed',true,'active',true);
end
$run$;
revoke all on function public.resume_failed_erp_sync_run_v3077(uuid,text) from public,anon,authenticated;
grant execute on function public.resume_failed_erp_sync_run_v3077(uuid,text) to service_role;
commit;
