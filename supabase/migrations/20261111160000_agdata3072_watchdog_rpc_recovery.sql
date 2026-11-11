begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Receipt reads retain creator, batch and durable-outbox proof. Index only
-- the completed batch arm that previously had to scan protected history.
create index if not exists ph_request_history_batch_completed_v3072
  on public.ph_requests_completed_history(client_batch_id)
  where date_completed is not null;

do $migration$
declare
  prior text := pg_get_functiondef('public.unlock_drive_evidence_v1(text,text)'::regprocedure);
  changed text;
  busy constant text := ' IF NOT pg_try_advisory_xact_lock(hashtextextended(''drive-row:''||p_master_uid,0)) THEN RAISE EXCEPTION ''DRIVE_SAVE_BUSY'' USING ERRCODE=''40001''; END IF;';
  stale constant text := ' IF nullif(p_expected_signature,'''') IS NOT NULL AND m.last_updated IS DISTINCT FROM p_expected_signature::timestamptz THEN RAISE EXCEPTION ''DRIVE_ROW_STALE'' USING ERRCODE=''40001''; END IF;';
begin
  if position('pg_try_advisory_xact_lock' in prior)=0
     and position('private.wait_item_detail_lock_v308' in prior)>0 then return; end if;
  if position(busy in prior)=0 or position(stale in prior)=0 then
    raise exception 'WATCHDOG_UNLOCK_BASELINE_CHANGED';
  end if;
  changed := replace(prior,busy,
    ' PERFORM private.wait_item_detail_lock_v308(hashtextextended(''drive-row:''||p_master_uid,0));');
  -- An explicit authorized unlock clears completion on the exact current UID.
  -- ERP timestamp drift is not an authorization or evidence conflict.
  changed := replace(changed,stale,'');
  execute changed;
end
$migration$;

alter function public.unlock_drive_evidence_v1(text,text) set lock_timeout='8s';
alter function public.unlock_drive_evidence_v1(text,text) set statement_timeout='12s';
alter function public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text) set lock_timeout='8s';
alter function public.save_request_work(text,bigint,jsonb,boolean) set lock_timeout='8s';
alter function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean) set lock_timeout='8s';

notify pgrst, 'reload schema';
commit;
