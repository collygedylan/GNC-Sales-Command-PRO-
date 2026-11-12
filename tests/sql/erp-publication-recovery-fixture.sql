select set_config('request.jwt.claim.role','service_role',true);
create temp table erp77_commit_calls(stage_id uuid);

-- Faults run only in this disposable transaction. A preload failure must not
-- reach the canonical commit, and its exact SQL context must remain observable.
create or replace function private.load_drive_erp_publication_input_v3042(p_stage_id uuid)
returns void language plpgsql set search_path = '' as $fault$
begin
  raise exception using errcode='57014',message='ERP77_PRELOAD_TIMEOUT',detail='isolated timeout fixture';
end
$fault$;
create or replace function public.fast_commit_erp_stage_swap_v1(p_stage_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $commit$
begin
  insert into pg_temp.erp77_commit_calls values(p_stage_id);
  update private.fast_erp_stage_runs_v1 set stage_state='committed',committed_result='{"ok":true,"fixture":true}'
  where stage_id=p_stage_id;
  return '{"ok":true,"fixture":true}';
end
$commit$;

do $failure$
declare stage uuid:='e3077000-0000-4000-8000-000000000001'; response jsonb; rejected boolean;
begin
  insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
    values(stage,'cav','{"file_name":"ERP77.xlsx"}','sealed-fingerprint',1,1);
  insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows,payload,last_progress_at)
    values(stage,1,'[{"unique_id":"ERP77"}]',clock_timestamp()-interval '2 minutes');
  perform private.run_erp_stage_publication_v3042(stage);
  assert not exists(select 1 from pg_temp.erp77_commit_calls),'failed preload cannot fall through';
  assert (select failures=1 and last_error='57014' and last_error_message='ERP77_PRELOAD_TIMEOUT'
    and last_error_detail='isolated timeout fixture' and last_error_context like '%load_drive_erp_publication_input%'
    and last_error_phase='prepare' from private.erp_stage_publication_jobs_v3042 where stage_id=stage);
  assert (select stage_state='staging' and committed_result is null from private.fast_erp_stage_runs_v1 where stage_id=stage);
  response:=public.resume_erp_stage_publication_v3077(stage);
  assert response->>'recoveryAccepted'='true' and response->>'stage_id'=stage::text;
  update private.erp_stage_publication_jobs_v3042 set failures=2 where stage_id=stage;
  response:=public.resume_erp_stage_publication_v3077(stage);
  assert (select recovery_count=1 and failures=2 and prepared_rows=1 and payload='[{"unique_id":"ERP77"}]'
    from private.erp_stage_publication_jobs_v3042 where stage_id=stage),'lost-response replay cannot reset attempts';
  assert (select source_fingerprint='sealed-fingerprint' from private.fast_erp_stage_runs_v1 where stage_id=stage);
  update private.erp_stage_publication_jobs_v3042 set failures=6 where stage_id=stage;
  rejected:=false;
  begin perform public.resume_erp_stage_publication_v3077(stage);
  exception when sqlstate '55000' then rejected:=SQLERRM='ERP_PUBLICATION_RECOVERY_EXHAUSTED'; end;
  assert rejected,'one recovery is a durable bounded budget';
end
$failure$;

create or replace function private.load_drive_erp_publication_input_v3042(p_stage_id uuid)
returns void language plpgsql set search_path = '' as $safe$
begin
  if not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id) then raise exception 'WRONG_STAGE'; end if;
end
$safe$;

do $safe$
declare stage uuid:='e3077000-0000-4000-8000-000000000001'; response jsonb; rejected boolean;
begin
  update private.erp_stage_publication_jobs_v3042 set failures=0,next_attempt_at=clock_timestamp() where stage_id=stage;
  perform private.run_erp_stage_publication_v3042(stage);
  assert (select count(*)=1 from pg_temp.erp77_commit_calls);
  assert not exists(select 1 from private.erp_stage_publication_jobs_v3042 where stage_id=stage);
  response:=public.resume_erp_stage_publication_v3077(stage);
  assert response->>'fixture'='true' and response->>'stage_id'=stage::text and response->>'stage_replayed'='true';
  perform set_config('request.jwt.claim.role','authenticated',true);
  rejected:=false;
  begin perform public.resume_erp_stage_publication_v3077(stage);
  exception when insufficient_privilege then rejected:=true; end;
  assert rejected,'committed replay still requires service authorization';
  perform set_config('request.jwt.claim.role','service_role',true);
  rejected:=false;
  begin perform public.resume_erp_stage_publication_v3077(gen_random_uuid());
  exception when sqlstate '55000' then rejected:=true; end;
  assert rejected,'unknown stage cannot schedule publication';
end
$safe$;

do $not_due$
declare stage uuid:='e3077000-0000-4000-8000-000000000002'; response jsonb;
begin
  insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
    values(stage,'cav','{"file_name":"ERP77-not-due.xlsx"}','another-fingerprint',1,1);
  insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows,payload)
    values(stage,1,'[{"unique_id":"ERP77-not-due"}]');
  response:=public.resume_erp_stage_publication_v3077(stage);
  assert response->>'recoveryDue'='false' and not response ? 'recoveryAccepted';
  assert (select recovery_count=0 from private.erp_stage_publication_jobs_v3042 where stage_id=stage);
  assert not exists(select 1 from cron.job where jobname='agdata-erp-publication-'||stage);
end
$not_due$;

do $run$
declare run uuid:='e3077000-0000-4000-8000-000000000003'; stage uuid:='e3077000-0000-4000-8000-000000000004';
  checkpoint jsonb; rejected boolean; response jsonb;
begin
  checkpoint:=jsonb_build_object('stageIndex',0,'fileContinuation',jsonb_build_object(
    'file',jsonb_build_object('id','ERP77-file'),
    'state',jsonb_build_object('stageId',stage,'phase','finalize','nextOffset',9610)));
  insert into private.erp_sync_jobs(run_id,command_id,requested_by,active,status)
    values(run,run::text,'fixture',false,jsonb_build_object('errorCode','ERP_PUBLICATION_RETRY_EXHAUSTED',
      'continuationCursor',checkpoint,'stageIndex',4,'currentStage','idle'));
  insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
    values(stage,'drive_around',jsonb_build_object('file_name','ERP77.xlsx','file_id','ERP77-file','sync_run_id',run),
      'ERP77-sealed-9610',9610,9610);
  insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows,last_progress_at,failures)
    values(stage,9610,clock_timestamp()-interval '2 minutes',6);
  rejected:=false;
  begin perform public.resume_failed_erp_sync_run_v3077(run,'wrong-actor');
  exception when others then rejected:=SQLERRM='ERP_SYNC_RUN_IDENTITY_MISMATCH'; end;
  assert rejected,'recovery cannot transfer actor authority';
  update private.fast_erp_stage_runs_v1 set file_meta=file_meta||'{"file_id":"wrong-file"}' where stage_id=stage;
  rejected:=false;
  begin perform public.resume_failed_erp_sync_run_v3077(run,'fixture');
  exception when others then rejected:=SQLERRM='ERP_SYNC_STAGE_IDENTITY_MISMATCH'; end;
  assert rejected,'recovery cannot attach another workbook';
  update private.fast_erp_stage_runs_v1 set file_meta=file_meta||'{"file_id":"ERP77-file"}' where stage_id=stage;
  response:=public.resume_failed_erp_sync_run_v3077(run,'fixture');
  assert response->>'resumed'='true' and response->>'runId'=run::text and response->>'stage_id'=stage::text;
  assert (select active and status->>'stageIndex'='0' and status->>'currentStage'='drive'
    and status->'continuationCursor'=checkpoint and finished_at is null and worker_id is null
    from private.erp_sync_jobs where run_id=run),'restoration retains exact saved checkpoint';
  assert (select recovery_count=1 and failures=0 and prepared_rows=9610
    from private.erp_stage_publication_jobs_v3042 where stage_id=stage);
  response:=public.resume_failed_erp_sync_run_v3077(run,'fixture');
  assert response->>'run_replayed'='true','active replay must not reset lease or attempts';
end
$run$;
