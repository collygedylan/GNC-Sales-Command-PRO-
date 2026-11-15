begin;
set local test.request_service='true';
insert into public.ph_requests_completed_history values
  ('REQ-A','ready','pending',now(),'completed'),('REQ-B','ready','pending',now(),'request_completed');
insert into private.ph_request_folder_delivery_state values('ready',2);
insert into public.ph_request_delivery_outbox(event_id,event_key,status) values
  ('86860000-0000-4000-8000-000000000002','created-ready','delivered');
insert into public.ph_request_delivery_outbox(event_id,request_folder,payload,status,lease_token) values
  ('86860000-0000-4000-8000-000000000001','ready',jsonb_build_object('contractVersion','request-folder-completion-v2',
    'activeRequestIds',jsonb_build_array('REQ-A','REQ-B'),'dependencyEventKeys',jsonb_build_array('created-ready'),
    'membershipSignature',md5('REQ-A'||chr(10)||'REQ-B')),'processing','86860000-0000-4000-8000-000000000003');
do $$declare receipt jsonb;begin
  receipt:=public.prepare_request_folder_completion_v2('86860000-0000-4000-8000-000000000001','86860000-0000-4000-8000-000000000003');
  if receipt->>'ready'<>'true' or jsonb_array_length(receipt->'requestIds')<>2 then
    raise exception 'VALID_COMPLETED_MEMBERS_REJECTED'; end if;
  begin
    perform public.prepare_request_folder_completion_v2('86860000-0000-4000-8000-000000000001',gen_random_uuid());
    raise exception 'WRONG_LEASE_ACCEPTED';
  exception when no_data_found then null; end;
end$$;
set local test.request_service='false';
do $$begin
  begin
    perform public.prepare_request_folder_completion_v2('86860000-0000-4000-8000-000000000001','86860000-0000-4000-8000-000000000003');
    raise exception 'NON_SERVICE_ACTOR_ACCEPTED';
  exception when insufficient_privilege then null; end;
end$$;
set local test.request_service='true';
update public.ph_request_delivery_outbox set payload=jsonb_set(payload,'{membershipSignature}','"wrong"') where request_folder='ready';
do $$declare receipt jsonb;begin
  receipt:=public.prepare_request_folder_completion_v2('86860000-0000-4000-8000-000000000001','86860000-0000-4000-8000-000000000003');
  if receipt->>'code'<>'FOLDER_COMPLETION_STALE' or receipt->>'terminal'<>'true' then raise exception 'FALSE_SIGNATURE_ACCEPTED'; end if;
  if not exists(select 1 from public.ph_request_delivery_outbox where request_folder='ready' and status='suppressed' and lease_token is null) then
    raise exception 'STALE_LEASE_NOT_RELEASED'; end if;
end$$;
insert into public.ph_requests_pending values('REQ-C','ready','pending',null,false);
update public.ph_request_delivery_outbox set status='processing',lease_token='86860000-0000-4000-8000-000000000003',
  payload=jsonb_set(jsonb_set(payload,'{membershipSignature}',to_jsonb(md5('REQ-A'||chr(10)||'REQ-B'||chr(10)||'REQ-C'))),
    '{activeRequestIds}','["REQ-A","REQ-B","REQ-C"]') where request_folder='ready';
do $$declare receipt jsonb;begin
  receipt:=public.prepare_request_folder_completion_v2('86860000-0000-4000-8000-000000000001','86860000-0000-4000-8000-000000000003');
  if receipt->>'ready'<>'false' then raise exception 'INCOMPLETE_SIBLING_ACCEPTED'; end if;
end$$;
delete from public.ph_requests_pending where unique_id='REQ-C';
update public.ph_request_delivery_outbox set status='pending' where event_key='created-ready';
update public.ph_request_delivery_outbox set status='processing',lease_token='86860000-0000-4000-8000-000000000003',
  payload=jsonb_set(jsonb_set(payload,'{membershipSignature}',to_jsonb(md5('REQ-A'||chr(10)||'REQ-B'))),
    '{activeRequestIds}','["REQ-A","REQ-B"]') where request_folder='ready';
do $$declare receipt jsonb;begin
  receipt:=public.prepare_request_folder_completion_v2('86860000-0000-4000-8000-000000000001','86860000-0000-4000-8000-000000000003');
  if receipt->>'code'<>'WAITING_FOR_REQUEST_CREATED' or receipt->>'terminal'<>'false' then raise exception 'DEPENDENCY_GUARD_BYPASSED'; end if;
  if not exists(select 1 from public.ph_request_delivery_outbox where request_folder='ready' and next_attempt_at>now() and lease_token is null) then
    raise exception 'DEPENDENCY_WAIT_NOT_BOUNDED'; end if;
end$$;
rollback;
select 'Completed history, multiline signature, service actor, lease, stale membership, incomplete sibling and dependency wait PASS' result;
