begin;
set local statement_timeout = '90s';
set local lock_timeout = '15s';

-- pg_cron owns the long transaction. Set the timeouts before executing the
-- publication statement; a SET inside a PostgREST call cannot extend it.
create function private.schedule_erp_stage_publication_v3057(p_stage_id uuid)
returns bigint language sql set search_path = '' as $schedule$
  select cron.schedule('agdata-erp-publication-'||p_stage_id,'2 seconds',format(
    'begin; set local statement_timeout = ''90s''; set local lock_timeout = ''15s''; select private.load_drive_erp_publication_input_v3042(%1$L::uuid); select private.run_erp_stage_publication_v3042(%1$L::uuid); commit',
    p_stage_id));
$schedule$;
revoke all on function private.schedule_erp_stage_publication_v3057(uuid) from public,anon,authenticated,service_role;

create or replace function public.fast_commit_erp_stage_swap_v1(p_stage_id uuid,p_async boolean)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $enqueue$
declare stage private.fast_erp_stage_runs_v1%rowtype; prior_failures integer; error_code text;
begin
  if coalesce(auth.role(),'')<>'service_role' or p_async is distinct from true then
    raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN';
  end if;
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.stage_state='committed' and stage.committed_result is not null then
    return stage.committed_result||jsonb_build_object('stage_replayed',true);
  end if;
  if not found or stage.stage_state<>'staging' or stage.expires_at<=clock_timestamp()
     or stage.staged_rows<>stage.expected_rows then
    raise exception using errcode='55000',message='FAST_ERP_STAGE_INCOMPLETE';
  end if;
  select failures,last_error into prior_failures,error_code
  from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id;
  if prior_failures>=6 then
    raise exception using errcode='55000',message='ERP_PUBLICATION_RETRY_EXHAUSTED',detail=error_code;
  end if;
  if not found then
    insert into private.erp_stage_publication_jobs_v3042(stage_id) values(p_stage_id) on conflict do nothing;
    if found then perform private.schedule_erp_stage_publication_v3057(p_stage_id); end if;
  end if;
  return jsonb_build_object('ok',true,'busy',true,'stage_id',p_stage_id,'retryAfterMs',2500);
end
$enqueue$;

-- Parse and sort the declared raw columns once per staged row. Both the typed
-- set-based publication plan and the canonical source hash use the same array.
do $deduplicate$
declare
  definition text := pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
  fields text := 'array(select distinct jsonb_array_elements_text(e.value->''rawFields'') order by 1)';
  anchor text := '  cross join lateral jsonb_populate_record(null::public.ph_master_inventory, e.value->''values'') as typed;';
begin
  if cardinality(string_to_array(definition,fields))<>3 or cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'ERP_STAGE_RAW_FIELD_PLAN_CHANGED';
  end if;
  definition:=replace(definition,fields,'input_fields.raw_fields');
  execute replace(definition,anchor,'  cross join lateral (select '||fields||' as raw_fields offset 0) input_fields'||chr(10)||anchor);
end
$deduplicate$;

-- Recover orphaned accepted jobs without competing with a live worker or
-- bypassing the persisted retry delay. The signed Edge relay still claims
-- the existing run, lease and checkpoint before fetching any workbook rows.
create or replace function private.wake_erp_sync_job_v23116()
returns bigint language plpgsql security definer set search_path = '' as $wake$
declare target_run uuid; worker_key text; stamp timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('agdata_erp_sync_recovery_v23116')) then return null; end if;
  select run_id into target_run from private.erp_sync_jobs
  where active and started_at>stamp-interval '6 hours' and updated_at<stamp-interval '12 seconds'
    and (request_lease_until is null or request_lease_until<=stamp
      or private.erp_sync_recovery_due_v3044(status,started_at,updated_at,stamp))
    and case when status->>'retryNotBefore' ~ '^[0-9]{1,15}$'
      then (status->>'retryNotBefore')::bigint<=extract(epoch from stamp)*1000 else true end
  order by updated_at limit 1;
  if target_run is null then return null; end if;
  select decrypted_secret into worker_key from vault.decrypted_secrets where name='hr_calendar_service_role_key' limit 1;
  if coalesce(worker_key,'')='' then raise exception 'ERP_SYNC_RECOVERY_KEY_UNAVAILABLE'; end if;
  return net.http_post(
    url := 'https://kzrnyjsosryejjejliii.supabase.co/functions/v1/app-api',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_key,'apikey',worker_key),
    body := jsonb_build_object('action','erp_sync','operation','continue','runId',target_run,'relayHop',1),
    timeout_milliseconds := 10000);
end
$wake$;

do $activate$
declare recovery_job bigint;
begin
  select jobid into strict recovery_job from cron.job
  where jobname='agdata-erp-sync-recovery-v23116'
    and command='select private.wake_erp_sync_job_v23116();';
  perform cron.alter_job(recovery_job,command:='set statement_timeout = ''5s''; select private.wake_erp_sync_job_v23116();',active:=true);
end
$activate$;

-- Re-arm only the November 10 publication stopped by the old 20-second cap.
-- The sealed rows and all seven prepared parts stay in place.
do $resume$
declare recovered uuid;
begin
  update private.erp_stage_publication_jobs_v3042 p
  set failures=0,last_error=null,next_attempt_at=clock_timestamp()
  from private.fast_erp_stage_runs_v1 s
  where s.stage_id=p.stage_id and s.stage_id='2c6f8be0-687c-4002-ae3b-a60efe97d184'
    and s.file_meta->>'file_name'='DriveAroundMC-10-10405020261110104051.xlsx'
    and s.stage_state='staging' and s.expires_at>clock_timestamp()
    and s.expected_rows=9590 and s.staged_rows=s.expected_rows and p.prepared_rows=s.expected_rows
    and p.failures=6 and p.last_error='57014' and p.next_attempt_at='2026-11-10 16:59:20.109592+00'
    and exists(select 1 from private.erp_sync_jobs j where j.active
      and j.run_id='d8b9ddcc-e3a1-42e0-b9a0-712b6ca58a01'
      and j.status#>>'{continuationCursor,fileContinuation,state,stageId}'=s.stage_id::text)
  returning p.stage_id into recovered;
  if recovered is not null then perform private.schedule_erp_stage_publication_v3057(recovered); end if;
end
$resume$;
commit;
