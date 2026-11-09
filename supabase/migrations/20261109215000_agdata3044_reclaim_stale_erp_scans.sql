begin;
set local lock_timeout='3s';
set local statement_timeout='15s';

create function private.erp_sync_recovery_due_v3044(p_status jsonb,p_started timestamptz,p_updated timestamptz,p_now timestamptz)
returns boolean language sql stable set search_path='' as $due$
  select case when coalesce(nullif(p_status->>'retryNotBefore','')::numeric,0)>extract(epoch from p_now)*1000 then false
    when p_status->>'currentStage' in ('queued','scanning')
      or (p_status->>'currentStage'='drive' and p_status#>>'{continuationCursor,fileContinuation}' is null
        and coalesce(p_status->'sourceProgress'->'drive'->>'stage','checking') in ('queued','checking')
        and coalesce(p_status->'continuationCursor'->>'stageIndex','0')='0')
    then p_now-greatest(p_started,nullif(p_status->>'recoveryClaimedAt','')::timestamptz)>=interval '25 seconds'
    else p_now-greatest(coalesce(nullif(p_status->'sourceProgress'->(p_status->>'currentStage')->>'updatedAt','')::timestamptz,p_updated),
      nullif(p_status->>'recoveryClaimedAt','')::timestamptz)>=interval '90 seconds' end
$due$;
revoke all on function private.erp_sync_recovery_due_v3044(jsonb,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

do $claim$
declare d text:=pg_get_functiondef('public.claim_erp_sync_request_step_v1(uuid,text)'::regprocedure);
  guard_text text:='if not job.active or job.request_lease_until>stamp then';
  update_text text:='    status=status||jsonb_build_object(''status'',''running'',''worker'',''supabase_request'',';
begin
  if strpos(d,guard_text)=0 or strpos(d,update_text)=0
    or strpos(d,'pg_try_advisory_xact_lock')=0 then raise exception 'ERP_SYNC_CLAIM_RECOVERY_ANCHOR_MISSING'; end if;
  d:=replace(d,guard_text,$guard$if not job.active or (job.request_lease_until>stamp
      and not private.erp_sync_recovery_due_v3044(job.status,job.started_at,job.updated_at,stamp)) then$guard$);
  execute replace(d,update_text,$stamp$    status=status||case when private.erp_sync_recovery_due_v3044(job.status,job.started_at,job.updated_at,stamp)
      then jsonb_build_object('recoveryClaimedAt',stamp,'message','Reclaiming the saved sync checkpoint.') else '{}'::jsonb end
      ||jsonb_build_object('status','running','worker','supabase_request',$stamp$);
end
$claim$;

do $fence$
declare d text:=pg_get_functiondef('public.update_erp_sync_job_v1(uuid,jsonb)'::regprocedure);
  guard_text text:='  if not existing.active then return existing.status; end if;';
  merge_text text:='existing.status || p_status || jsonb_build_object';
begin
  if strpos(d,guard_text)=0 or strpos(d,merge_text)=0 then raise exception 'ERP_SYNC_STATUS_FENCE_ANCHOR_MISSING'; end if;
  d:=replace(d,guard_text,guard_text||$guard$
  if p_status ? '_workerLeaseId' and (existing.worker_id::text is distinct from p_status->>'_workerLeaseId'
      or existing.request_lease_until is null or existing.request_lease_until<=clock_timestamp()) then
    raise exception 'ERP_SYNC_WORKER_LEASE_INVALID';
  end if;
$guard$);
  execute replace(d,merge_text,'existing.status || (p_status - ''_workerLeaseId'') || jsonb_build_object');
end
$fence$;

do $status$
declare d text:=pg_get_functiondef('public.get_erp_sync_status_v1()'::regprocedure);
  anchor text:='''workerActive'',active and coalesce(request_lease_until>statement_timestamp(),false),';
begin
  if strpos(d,anchor)=0 then raise exception 'ERP_SYNC_RECOVERY_STATUS_ANCHOR_MISSING'; end if;
  execute replace(d,anchor,anchor||chr(10)||
    '    ''recoveryDue'',active and private.erp_sync_recovery_due_v3044(status,started_at,updated_at,statement_timestamp()),');
end
$status$;

do $wake$
declare d text:=pg_get_functiondef('private.wake_erp_sync_job_v23116()'::regprocedure);
  anchor text:='(request_lease_until is null or request_lease_until <= clock_timestamp())';
begin
  if strpos(d,anchor)=0 then raise exception 'ERP_SYNC_WAKE_RECOVERY_ANCHOR_MISSING'; end if;
  execute replace(d,anchor,$eligible$(request_lease_until is null or request_lease_until <= clock_timestamp()
      or private.erp_sync_recovery_due_v3044(status,started_at,updated_at,clock_timestamp()))$eligible$);
end
$wake$;

commit;
