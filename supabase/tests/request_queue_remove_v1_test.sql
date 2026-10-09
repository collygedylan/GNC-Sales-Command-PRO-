-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(35);

select has_function('public','request_queue_remove_v1',array['uuid','text','bigint','timestamp with time zone','uuid'],'permanent pending-queue removal has a dedicated RPC');
select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=15s'] from pg_proc where oid='public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)'::regprocedure),'removal RPC is bounded and search-path pinned');
select ok(not has_function_privilege('anon','public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)','execute')
  and not has_function_privilege('authenticated','public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)','execute')
  and has_function_privilege('service_role','public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)','execute'),'only app-api service role can execute permanent removal');
select ok(not has_table_privilege('service_role','private.ph_request_queue_removal_commands','select')
  and not has_table_privilege('authenticated','private.ph_request_queue_removal_commands','select'),'retry ledger is private from clients and service callers');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values
  ('9f8b0000-0000-4000-8000-000000000091','queue-remove-fixture@example.invalid','{}','{}'),
  ('9f8b0000-0000-4000-8000-000000000092','queue-remove-denied@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000091','queue_remove_fixture','Queue Remove Fixture','ADMIN',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000092','queue_remove_denied','Queue Remove Denied','USER',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
insert into public.ph_active_request(unique_id,commonname,contsize,request_folder,req_status,req_archived,updated_at,row_version)
values('queue-remove-target','Queue Remove Plant','#3','queue-remove-folder','Pending',false,'2026-10-09T12:00:00Z',7),
      ('queue-remove-sibling','Queue Remove Sibling','#3','queue-remove-folder','Pending',false,'2026-10-09T12:00:00Z',2),
      ('queue-remove-completed','Already Complete','#3','queue-remove-done-folder','Completed',false,'2026-10-09T12:00:00Z',3),
      ('queue-remove-archived','Already Archived','#3','queue-remove-archived-folder','Pending',true,'2026-10-09T12:00:00Z',4),
      ('queue-remove-legacy','Legacy Pending','#3','queue-remove-legacy-folder','Pending',false,'2026-10-09T12:00:00Z',5);

insert into public.ph_request_history(unique_id,snapshot,last_event,delivery_state)
values('queue-remove-target','{"keep":"historical snapshot"}'::jsonb,'created','delivered')
on conflict do nothing;
-- Force the legacy case to have no historical row even if active-row triggers create one.
delete from public.ph_request_history where unique_id='queue-remove-legacy';

-- A real created-membership event keeps a completed sibling in the same
-- folder. Removing the final pending row should reconcile completion against
-- the retained member list, never the deleted UID.
insert into public.ph_active_request(unique_id,commonname,contsize,request_folder,req_status,req_archived,updated_at,row_version,date_completed)
values('queue-remove-final-pending','Queue Remove Final Pending','#3','queue-remove-final-folder','Pending',false,'2026-10-09T13:00:00Z',11,null),
      ('queue-remove-final-complete','Queue Remove Final Complete','#3','queue-remove-final-folder','Completed',false,'2026-10-09T13:01:00Z',12,'2026-10-08');
insert into public.ph_request_history(unique_id,snapshot,last_event,delivery_state)
values('queue-remove-final-pending','{"preserve":"pending history"}'::jsonb,'created','delivered'),
      ('queue-remove-final-complete','{"preserve":"completed history"}'::jsonb,'created','delivered')
on conflict do nothing;
insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,delivered_at)
values('queue-remove-final-created','request_created','queue-remove-final-folder',
  '{"request_ids":["queue-remove-final-pending","queue-remove-final-complete"]}'::jsonb,'delivered',now());

-- The history trigger adds canonical customer/consignee snapshot fields. Save
-- the complete committed fixture state, then prove removal changes none of it.
create temporary table queue_remove_history_before on commit drop as
select h.unique_id, to_jsonb(h) as stored_row from public.ph_request_history h
where h.unique_id in ('queue-remove-target','queue-remove-final-pending');

select is((public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-target',7,'2026-10-09T12:00:00Z','9f8b0000-0000-4000-8000-000000000101')->>'state'),'removed','a current pending row is removed');
select ok(not exists(select 1 from public.ph_active_request where unique_id='queue-remove-target'),'removed UID leaves the active queue');
select is((select to_jsonb(h) from public.ph_request_history h where unique_id='queue-remove-target'),
  (select stored_row from queue_remove_history_before where unique_id='queue-remove-target'),'existing history is preserved unchanged');
select is((select last_event from public.ph_request_history where unique_id='queue-remove-target'),'created','existing history event remains unchanged');
select ok(exists(select 1 from public.ph_active_request where unique_id='queue-remove-sibling' and request_folder='queue-remove-folder'),'other folder members remain active');
select is((select count(*)::integer from public.ph_request_delivery_outbox where request_folder='queue-remove-folder' and event_type='request_completed'),0,'removing one row cannot enqueue folder completion while another remains');
select is((public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-target',7,'2026-10-09T12:00:00Z','9f8b0000-0000-4000-8000-000000000101')->>'replayed'),'true','an exact retry replays its stored receipt after the active row is gone');
select throws_ok($$select public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-sibling',2,'2026-10-09T12:00:00Z','9f8b0000-0000-4000-8000-000000000101')$$,'PT409','REQUEST_REMOVE_IDEMPOTENCY_CONFLICT','a reused key with a changed command is rejected');
select is((public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-legacy',5,(select updated_at from public.ph_active_request where unique_id='queue-remove-legacy'),'9f8b0000-0000-4000-8000-000000000102')->>'state'),'removed','legacy pending row can be removed');
select ok(exists(select 1 from public.ph_request_history where unique_id='queue-remove-legacy'),'legacy row receives a history record before removal');
select is((select last_event from public.ph_request_history where unique_id='queue-remove-legacy'),'removed_from_queue','legacy history identifies queue removal');
select throws_ok($$select public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-sibling',1,(select updated_at from public.ph_active_request where unique_id='queue-remove-sibling'),'9f8b0000-0000-4000-8000-000000000103')$$,'PT409','REQUEST_REMOVE_STALE_REVISION','stale row version is rejected');
select throws_ok($$select public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-sibling',2,(select updated_at+interval '1 microsecond' from public.ph_active_request where unique_id='queue-remove-sibling'),'9f8b0000-0000-4000-8000-000000000104')$$,'PT409','REQUEST_REMOVE_STALE_REVISION','stale microsecond timestamp is rejected independently');
select throws_ok($$select public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-completed',3,(select updated_at from public.ph_active_request where unique_id='queue-remove-completed'),'9f8b0000-0000-4000-8000-000000000105')$$,'PT409','REQUEST_REMOVE_PENDING_REQUIRED','completed request cannot be removed');
select throws_ok($$select public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-archived',4,(select updated_at from public.ph_active_request where unique_id='queue-remove-archived'),'9f8b0000-0000-4000-8000-000000000106')$$,'PT409','REQUEST_REMOVE_PENDING_REQUIRED','archived request cannot be removed');
select throws_ok($$select public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','missing-queue-remove-row',1,now(),'9f8b0000-0000-4000-8000-000000000107')$$,'PT404','REQUEST_REMOVE_NOT_FOUND','missing request returns not found');
select throws_ok($$select public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000092','queue-remove-sibling',2,(select updated_at from public.ph_active_request where unique_id='queue-remove-sibling'),'9f8b0000-0000-4000-8000-000000000108')$$,'42501','REQUEST_REMOVE_FORBIDDEN','inactive non-manager actor is denied');

select is((select count(*)::integer from private.ph_request_queue_removal_commands where request_uid in ('queue-remove-target','queue-remove-legacy')),2,'only the two committed removals are recorded in the private retry ledger');
select is((select count(*)::integer from public.ph_active_request where unique_id in ('queue-remove-completed','queue-remove-archived','queue-remove-sibling')),3,'stale, completed, archived, and sibling rows remain untouched');
select is((select count(*)::integer from public.ph_request_delivery_outbox where event_type='request_completed' and request_folder in ('queue-remove-folder','queue-remove-legacy-folder') and payload::text like '%queue-remove-target%'),0,'folder delivery payloads do not mention the removed UID');
select is((select count(*)::integer from public.ph_request_history where unique_id='queue-remove-target'),1,'queue removal does not duplicate existing history');
select ok(not has_table_privilege('authenticated','private.ph_request_queue_removal_commands','insert')
  and not has_table_privilege('authenticated','private.ph_request_queue_removal_commands','update')
  and not has_table_privilege('authenticated','private.ph_request_queue_removal_commands','delete'),'clients cannot alter retry receipts');
select ok((select request_uid='queue-remove-target' and actor_id='9f8b0000-0000-4000-8000-000000000091'::uuid
  from private.ph_request_queue_removal_commands where idempotency_key='9f8b0000-0000-4000-8000-000000000101'),'retry receipt binds actor and exact request identity');

select is((public.request_queue_remove_v1('9f8b0000-0000-4000-8000-000000000091','queue-remove-final-pending',11,'2026-10-09T13:00:00Z','9f8b0000-0000-4000-8000-000000000109')->>'state'),'removed','removing the final pending row succeeds when a completed sibling remains');
select ok(not exists(select 1 from public.ph_active_request where unique_id='queue-remove-final-pending'),'the pending member is removed from the active table');
select is((select active_request_ids from private.ph_request_folder_delivery_state where request_folder='queue-remove-final-folder'),array['queue-remove-final-complete']::text[],'folder membership contains only the retained completed member');
select is((select count(*)::integer from public.ph_request_delivery_outbox where request_folder='queue-remove-final-folder' and event_type='request_completed' and payload->>'contractVersion'='request-folder-completion-v2' and status='pending'),1,'deletion reconciles one active V2 folder-completion event');
select is((select payload->'activeRequestIds' from public.ph_request_delivery_outbox where request_folder='queue-remove-final-folder' and event_type='request_completed' and payload->>'contractVersion'='request-folder-completion-v2'), '["queue-remove-final-complete"]'::jsonb,'V2 completion payload active IDs contain only the retained member');
select is((select payload->'request_ids' from public.ph_request_delivery_outbox where request_folder='queue-remove-final-folder' and event_type='request_completed' and payload->>'contractVersion'='request-folder-completion-v2'), '["queue-remove-final-complete"]'::jsonb,'V2 completion payload request IDs contain only the retained member');
select ok(not exists(select 1 from public.ph_request_delivery_outbox where request_folder='queue-remove-final-folder' and event_type='request_completed' and payload::text like '%queue-remove-final-pending%'),'the removed UID is absent from completion payloads');
select is((select to_jsonb(h) from public.ph_request_history h where unique_id='queue-remove-final-pending'),
  (select stored_row from queue_remove_history_before where unique_id='queue-remove-final-pending'),'removal preserves the row history without rewriting it as completed');

select * from finish();
rollback;
