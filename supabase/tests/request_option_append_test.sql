begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_function(
  'public',
  'append_request_options_v1',
  array['uuid', 'text', 'text', 'text[]'],
  'existing Request options use a dedicated append RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.append_request_options_v1(uuid,text,text,text[])', 'execute'),
  'authenticated onsite users can invoke the protected append operation'
);
select ok(
  not has_function_privilege('anon', 'public.append_request_options_v1(uuid,text,text,text[])', 'execute')
  and not has_function_privilege('public', 'public.append_request_options_v1(uuid,text,text,text[])', 'execute'),
  'anonymous and PUBLIC callers cannot invoke the append operation'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'request_append_csr@greenleafnursery.com', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
) on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, role)
values (
  '91000000-0000-0000-0000-000000000001',
  'request_append_csr', 'Request Append CSR', 'CSR'
) on conflict (id) do update set role = excluded.role, disabled_at = null, locked_until = null;

insert into public.ph_master_inventory (
  unique_id, itemcode, commonname, contsize, locationcode, lotcode,
  ptravailable, season_supply, priority, qualitycode, field_tag_color,
  plantgroupcode, app_tab_assignment
) values
  ('REQUEST-APPEND-MASTER-1', 'REQUEST-APPEND-ITEM-1', 'Append Test Hydrangea', '#3', 'A.01.001', '27.F1', '20', 'F1', '1', 'A', 'BLUE', '100_SHRUBS', 'location'),
  ('REQUEST-APPEND-MASTER-2', 'REQUEST-APPEND-ITEM-2', 'Append Test Hydrangea', '#3', 'A.02.001', '27.U1', '12', 'U1', '2', 'A', 'BLUE', '100_SHRUBS', 'location'),
  ('REQUEST-APPEND-MASTER-3', 'REQUEST-APPEND-ITEM-3', 'Different Plant', '#1', 'A.03.001', '27.F1', '8', 'F1', '3', 'A', 'RED', '100_SHRUBS', 'location')
on conflict (unique_id) do update set commonname = excluded.commonname, contsize = excluded.contsize;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $q$select public.create_request_batch(
    '91000000-0000-0000-0000-000000000010',
    '[{"unique_id":"REQUEST-APPEND-SOURCE-1","master_id":"REQUEST-APPEND-MASTER-1","requested_by":"Persisted Rep Missing From Picker","request_folder":"REQUEST-APPEND-FOLDER-1","req_customer":"Persisted Customer","req_qty":"17","req_reserve":"YES","est_ship":"09/15/2026","desired_spec":"24 IN","desired_caliper":"2 IN","request_note":"Choose the best option"}]'::jsonb
  )$q$,
  'an authoritative source Request can be created without a current REP-directory record'
);
select is(
  (select requested_by from public.ph_active_request where unique_id = 'REQUEST-APPEND-SOURCE-1'),
  'Persisted Rep Missing From Picker',
  'the persisted source rep remains authoritative'
);

set local role postgres;
insert into public.ph_request_email_threads (
  request_folder, request_customer, sales_rep_name, sales_rep_email,
  recipients, initial_thread_id, initial_message_id, initial_email_sent_at
) values (
  'REQUEST-APPEND-FOLDER-1', 'Persisted Customer', 'Persisted Rep Missing From Picker',
  'persisted.rep@example.invalid', '["persisted.rep@example.invalid","request.owner@example.invalid"]',
  'THREAD-REQUEST-APPEND-1', 'MESSAGE-REQUEST-APPEND-1', now()
) on conflict (request_folder) do update set recipients = excluded.recipients;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $q$select public.append_request_options_v1(
    '91000000-0000-0000-0000-000000000011',
    'REQUEST-APPEND-FOLDER-1', 'REQUEST-APPEND-SOURCE-1',
    array['REQUEST-APPEND-MASTER-2', 'REQUEST-APPEND-MASTER-2']
  )$q$,
  'a compatible option appends without a REP picker selection'
);
select is(
  (public.append_request_options_v1(
    '91000000-0000-0000-0000-000000000011',
    'REQUEST-APPEND-FOLDER-1', 'REQUEST-APPEND-SOURCE-1', array['REQUEST-APPEND-MASTER-2']
  )->>'inserted_count')::integer,
  1,
  'the append result reports one inserted option'
);
select is(
  (select count(*)::integer from public.ph_active_request
   where request_folder = 'REQUEST-APPEND-FOLDER-1' and master_id = 'REQUEST-APPEND-MASTER-2'),
  1,
  'duplicate selected row identities create one Request row'
);
select is(
  (select concat_ws('|', requested_by, req_customer, req_qty, req_reserve, est_ship, desired_spec, desired_caliper, request_note)
   from public.ph_active_request
   where request_folder = 'REQUEST-APPEND-FOLDER-1' and master_id = 'REQUEST-APPEND-MASTER-2'),
  'Persisted Rep Missing From Picker|Persisted Customer|17|YES|09/15/2026|24 IN|2 IN|Choose the best option',
  'server inherits folder identity and every requested source requirement'
);
select is(
  (select concat_ws('|', request_created_by_username, request_created_by_display, request_created_by_email)
   from public.ph_active_request
   where request_folder = 'REQUEST-APPEND-FOLDER-1' and master_id = 'REQUEST-APPEND-MASTER-2'),
  'request_append_csr|Request Append CSR|request_append_csr@greenleafnursery.com',
  'the authenticated onsite employee is stamped separately from the persisted rep'
);

set local role postgres;
select is(
  (select recipients::text from public.ph_request_email_threads where request_folder = 'REQUEST-APPEND-FOLDER-1'),
  '["persisted.rep@example.invalid", "request.owner@example.invalid"]',
  'the append does not alter original recipients or thread state'
);
select is(
  (select status || '|' || delivery_mode from public.ph_request_delivery_outbox
   where event_key = 'request-options-appended:91000000-0000-0000-0000-000000000011'),
  'delivered|internal_silent_append',
  'append membership is terminal internal work rather than queued delivery'
);
select ok(
  (select email_delivered_at is null and push_delivered_at is null
   from public.ph_request_delivery_outbox
   where event_key = 'request-options-appended:91000000-0000-0000-0000-000000000011'),
  'silent append does not claim an email or push delivery'
);
select is(
  (select count(*)::integer from public.ph_request_delivery_outbox
   where request_folder = 'REQUEST-APPEND-FOLDER-1' and event_type = 'request_created'),
  1,
  'append does not queue another request-created assignment email'
);
select is(
  (select delivery_state from public.ph_request_history
   where request_folder = 'REQUEST-APPEND-FOLDER-1' and master_id = 'REQUEST-APPEND-MASTER-2'),
  'delivered',
  'the appended Request history row is not shown as pending email work'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);

select ok(
  (public.append_request_options_v1(
    '91000000-0000-0000-0000-000000000011',
    'REQUEST-APPEND-FOLDER-1', 'REQUEST-APPEND-SOURCE-1', array['REQUEST-APPEND-MASTER-2']
  )->>'idempotent_replay')::boolean,
  'same-batch retries return the committed result'
);
select is(
  (select count(*)::integer from public.ph_active_request
   where request_folder = 'REQUEST-APPEND-FOLDER-1' and master_id = 'REQUEST-APPEND-MASTER-2'),
  1,
  'same-batch retries cannot duplicate the Request option'
);
select is(
  (select count(*)::integer from public.ph_request_delivery_outbox
   where event_key = 'request-options-appended:91000000-0000-0000-0000-000000000011'),
  1,
  'same-batch retries cannot duplicate the internal append event'
);
select is(
  (public.append_request_options_v1(
    '91000000-0000-0000-0000-000000000012',
    'REQUEST-APPEND-FOLDER-1', 'REQUEST-APPEND-SOURCE-1', array['REQUEST-APPEND-MASTER-2']
  )->>'status'),
  'already_in_request',
  'a new batch reports an option already present instead of duplicating it'
);
select is(
  (select count(*)::integer from public.ph_request_delivery_outbox
   where event_key = 'request-options-appended:91000000-0000-0000-0000-000000000012'),
  0,
  'an all-duplicate append does not create a membership or delivery event'
);
select throws_ok(
  $q$select public.append_request_options_v1(
    '91000000-0000-0000-0000-000000000013',
    'REQUEST-APPEND-FOLDER-1', 'REQUEST-APPEND-SOURCE-1', array['REQUEST-APPEND-MASTER-3']
  )$q$,
  '22023', 'REQUEST_OPTION_NOT_COMPATIBLE',
  'unrelated plant and size rows cannot be appended'
);

select lives_ok(
  $q$select public.create_request_batch(
    '91000000-0000-0000-0000-000000000020',
    '[{"unique_id":"REQUEST-APPEND-COMPLETE-1","master_id":"REQUEST-APPEND-MASTER-1","requested_by":"Persisted Rep Missing From Picker","request_folder":"REQUEST-APPEND-COMPLETE-FOLDER","req_customer":"Persisted Customer","req_qty":"1"}]'::jsonb
  )$q$,
  'a second source Request is available for completed-folder rejection'
);
set local role postgres;
update public.ph_active_request
set req_status = 'Complete', date_completed = now()::text
where unique_id = 'REQUEST-APPEND-COMPLETE-1';
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $q$select public.append_request_options_v1(
    '91000000-0000-0000-0000-000000000021',
    'REQUEST-APPEND-COMPLETE-FOLDER', 'REQUEST-APPEND-COMPLETE-1', array['REQUEST-APPEND-MASTER-2']
  )$q$,
  '55000', 'REQUEST_FOLDER_ALREADY_COMPLETED',
  'fully completed folders cannot be silently reopened'
);

set local role postgres;
update public.ph_active_request
set req_status = 'Complete', date_completed = now()::text
where request_folder = 'REQUEST-APPEND-FOLDER-1';
select is(
  (select jsonb_array_length(payload->'activeRequestIds')
   from public.ph_request_delivery_outbox
   where request_folder = 'REQUEST-APPEND-FOLDER-1'
     and event_type = 'request_completed'
     and payload->>'contractVersion' = 'request-folder-completion-v2'
   order by created_at desc limit 1),
  2,
  'one final completion event covers the original and silently appended rows'
);
select is(
  (select jsonb_array_length(payload->'dependencyEventKeys')
   from public.ph_request_delivery_outbox
   where request_folder = 'REQUEST-APPEND-FOLDER-1'
     and event_type = 'request_completed'
     and payload->>'contractVersion' = 'request-folder-completion-v2'
   order by created_at desc limit 1),
  2,
  'completion waits on the original assignment event and the committed append event'
);

select * from finish();
rollback;
