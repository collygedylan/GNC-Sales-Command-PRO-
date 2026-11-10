-- Run on disposable local PostgreSQL inside a transaction that is rolled back.
set local lock_timeout='4s';
set local statement_timeout='15s';
set local request.jwt.claim.role='service_role';

do $seed$
declare
  actor uuid := gen_random_uuid();
  app_session uuid := gen_random_uuid();
  actor_name text := 'request_autosave_fixture_'||replace(actor::text,'-','');
  request_uid text := 'REQ-autosave-fixture';
  master_uid text := 'master-autosave-fixture';
begin
  insert into auth.users(id) values(actor);
  insert into public.profiles(id,username,role) values(actor,actor_name,'Manager');
  insert into auth.sessions(id,user_id) values(app_session,actor);
  insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,priority,season,ptronhand,ptravailable)
  values (master_uid,'990001.001.1','T.01.001','28.F1','1','F1','210','210');
  insert into public.ph_requests_pending(id,unique_id,master_id,itemcode,locationcode,lotcode,priority,
    request_folder,request_source,request_created_by_username,requested_by,sales_rep,customer_name,req_qty,effective_qty,is_default_qty)
  values (-30482350,request_uid,master_uid,'990001.001.1','T.01.001','28.F1','1',
    'request-autosave-fixture','eval_work',actor_name,actor_name,actor_name,'N/A',1,1,false);
  perform set_config('fixture.request_autosave_actor',actor::text,true);
  perform set_config('fixture.request_autosave_session',app_session::text,true);
end
$seed$;

set local role service_role;
do $pending$
declare
  actor uuid := current_setting('fixture.request_autosave_actor')::uuid;
  app_session uuid := current_setting('fixture.request_autosave_session')::uuid;
  request_uid text := 'REQ-autosave-fixture';
  photo text := 'https://example.invalid/request-autosave-fixture.jpg';
  receipt jsonb;
begin
  receipt:=public.request_work_command_v1(actor,app_session,'save',request_uid,1,
    jsonb_build_object('req_spec','16-18" H','req_match',40,'req_photo_link',photo,'req_photo_name','fixture.jpg'),false);
  if receipt->>'lifecycle_state' is distinct from 'pending_active'
    or not exists(select 1 from public.ph_active_request where unique_id=request_uid and req_match=40 and date_completed is null) then
    raise exception 'REQUEST_AUTOSAVE_PENDING_RECEIPT_MISSING';
  end if;
  if exists(select 1 from public.ph_requests_completed_history where unique_id=request_uid)
    or exists(select 1 from public.ph_request_delivery_outbox where request_id=request_uid and event_type='request_completed') then
    raise exception 'REQUEST_AUTOSAVE_CREATED_COMPLETED_HISTORY';
  end if;
end
$pending$;

reset role;
-- Model one existing legacy shadow without removing or updating it on autosave.
do $shadow$
begin
  perform private.upsert_request_history('REQ-autosave-fixture','updated','not_queued',false);
  perform set_config('fixture.request_autosave_legacy_history',
    (select to_jsonb(history)::text from public.ph_requests_completed_history history where unique_id='REQ-autosave-fixture'),true);
end
$shadow$;

set local role service_role;
do $completion$
declare
  actor uuid := current_setting('fixture.request_autosave_actor')::uuid;
  app_session uuid := current_setting('fixture.request_autosave_session')::uuid;
  request_uid text := 'REQ-autosave-fixture';
  receipt jsonb;
  saved_version bigint;
  outbox_proof jsonb;
begin
  receipt:=public.request_work_command_v1(actor,app_session,'save',request_uid,2,'{"req_comments":"fixture draft"}',false);
  saved_version:=(receipt->>'row_version')::bigint;
  if receipt->>'lifecycle_state' is distinct from 'pending_active'
    or (select to_jsonb(history) from public.ph_requests_completed_history history where unique_id=request_uid)
      is distinct from current_setting('fixture.request_autosave_legacy_history')::jsonb then
    raise exception 'REQUEST_AUTOSAVE_MODIFIED_RETAINED_HISTORY';
  end if;
  receipt:=public.request_work_command_v1(actor,app_session,'save',request_uid,saved_version,'{}',true);
  if receipt->>'lifecycle_state' is distinct from 'completed_history'
    or exists(select 1 from public.ph_requests_pending where unique_id=request_uid)
    or not exists(select 1 from public.ph_requests_completed_history where unique_id=request_uid
      and date_completed is not null and req_match='40' and req_comments='fixture draft'
      and req_photo_link like '%request-autosave-fixture.jpg%')
    or (select count(*) from public.ph_request_delivery_outbox where request_id=request_uid
      and event_type='request_completed' and status<>'suppressed')<>1
    or not exists(select 1 from public.ph_request_delivery_outbox where request_id=request_uid
      and event_key='request-row-completed:'||request_uid and payload->>'contractVersion'='request-row-completion-v316') then
    raise exception 'REQUEST_MARK_DONE_ATOMIC_RECEIPT_CHANGED';
  end if;
  select jsonb_agg(to_jsonb(event) order by event.event_key) into outbox_proof
  from public.ph_request_delivery_outbox event where event.request_id=request_uid;
  receipt:=public.request_work_command_v1(actor,app_session,'save',request_uid,saved_version,'{}',true);
  if receipt->>'idempotent_replay' is distinct from 'true'
    or (select jsonb_agg(to_jsonb(event) order by event.event_key) from public.ph_request_delivery_outbox event
      where event.request_id=request_uid) is distinct from outbox_proof then
    raise exception 'REQUEST_MARK_DONE_REPLAY_CHANGED';
  end if;
end
$completion$;
reset role;
