begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rep_test@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'csr_test@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dylan_collyge@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'abigail_vazquez@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'rep_test', 'Rep Test', 'REP'),
  ('10000000-0000-0000-0000-000000000002', 'csr_test', 'CSR Test', 'CSR'),
  ('10000000-0000-0000-0000-000000000003', 'dylan_collyge', 'Dylan Collyge', 'ADMIN'),
  ('10000000-0000-0000-0000-000000000004', 'abigail_vazquez', 'Abigail Vazquez', 'EVAL')
on conflict (id) do update set role = excluded.role, disabled_at = null, locked_until = null;

insert into public.ph_master_inventory (
  unique_id, itemcode, genusname, commonname, contsize, locationcode, lotcode,
  ptravailable, priority, holdstopcode, holdstopreason, app_tab_assignment
) values (
  'MASTER-TEST-1', 'ITEM-TEST-1', 'Test Genus', 'Drive Canonical Name', '#3', 'A-1', 'LOT-1',
  '20', '1', '', '', 'location'
) on conflict (unique_id) do update set commonname = excluded.commonname;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $q$select public.create_av_request_batch(
    '20000000-0000-0000-0000-000000000001',
    '[{"unique_id":"REQ-REP-AV-1","master_id":"MASTER-TEST-1","requested_by":"Rep Test","request_folder":"REP-FOLDER","req_customer":"Customer","req_qty":"1"}]'::jsonb
  )$q$,
  'sales rep can create an AV request batch'
);

select throws_ok(
  $q$select public.create_request_batch(
    '20000000-0000-0000-0000-000000000002',
    '[{"unique_id":"REQ-REP-GENERAL-1","master_id":"MASTER-TEST-1"}]'::jsonb
  )$q$,
  '42501', 'GENERAL_REQUEST_CREATE_FORBIDDEN',
  'sales rep cannot call general request creation'
);

select is((select request_source from public.ph_active_request where unique_id = 'REQ-REP-AV-1'), 'av', 'AV RPC forces AV source');
select is((select commonname from public.ph_active_request_live_rows where unique_id = 'REQ-REP-AV-1'), 'Drive Canonical Name', 'live view uses current Drive value');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $q$select public.create_request_batch(
    '20000000-0000-0000-0000-000000000003',
    '[{"unique_id":"REQ-CSR-1","master_id":"MASTER-TEST-1","requested_by":"Rep Test","request_folder":"CSR-FOLDER","req_customer":"Customer","req_qty":"2"}]'::jsonb
  )$q$,
  'CSR can use general request creation'
);

select is((select count(*)::integer from public.ph_active_request where unique_id = 'REQ-CSR-1'), 1, 'batch retry key created exactly one request row');
select is((select count(*)::integer from public.ph_request_history where unique_id = 'REQ-CSR-1'), 1, 'creation transaction persisted History snapshot');
set local role postgres;
select is((select count(*)::integer from public.ph_request_delivery_outbox where event_key = 'request-created:20000000-0000-0000-0000-000000000003'), 1, 'creation transaction persisted delivery outbox');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);

select is(
  (select count(*)::integer from public.ph_request_queue_live_rows where unique_id = 'REQ-CSR-1'),
  1,
  'completed request remains visible while its delivery is pending'
);

select throws_ok(
  $q$select * from public.claim_request_delivery_events(1, 'untrusted-client')$q$,
  '42501', 'permission denied for function claim_request_delivery_events',
  'authenticated clients cannot claim service delivery work'
);

select lives_ok(
  $q$select public.create_request_batch(
    '20000000-0000-0000-0000-000000000003',
    '[{"unique_id":"REQ-CSR-1","master_id":"MASTER-TEST-1","requested_by":"Rep Test","request_folder":"CSR-FOLDER","req_customer":"Customer","req_qty":"2"}]'::jsonb
  )$q$,
  'idempotent batch retry succeeds'
);
select is((select count(*)::integer from public.ph_active_request where unique_id = 'REQ-CSR-1'), 1, 'idempotent retry did not duplicate the request');

select throws_ok(
  $q$select public.save_request_work('REQ-CSR-1', 99, '{}'::jsonb, false)$q$,
  '40001', 'REQUEST_VERSION_CONFLICT',
  'stale request version is rejected'
);

select lives_ok(
  $q$select public.save_request_work(
    'REQ-CSR-1', 1,
    '{"req_match":"50","req_spec":"24 IN","req_photo_link":"https://example.invalid/photo.jpg","req_photo_name":"photo.jpg","loc_match_qty":"10"}'::jsonb,
    true
  )$q$,
  'exact-version completion commits'
);
select is((select req_status from public.ph_active_request where unique_id = 'REQ-CSR-1'), 'Complete', 'completion persisted request state');
select is((select match from public.ph_master_inventory where unique_id = 'MASTER-TEST-1'), '50', 'completion updated shared Drive AV data');
select is((select last_event from public.ph_request_history where unique_id = 'REQ-CSR-1'), 'completed', 'completion froze final History');
select is(
  (public.save_request_work('REQ-CSR-1', 1, '{}'::jsonb, false)->>'delivery_state'),
  'pending',
  'completed request retry returns the committed delivery state without another write'
);
select is(
  (select row_version from public.ph_active_request where unique_id = 'REQ-CSR-1'),
  2::bigint,
  'stale completed request acknowledgement leaves the canonical version unchanged'
);
set local role postgres;
select is((select count(*)::integer from public.ph_request_delivery_outbox where request_id = 'REQ-CSR-1' and event_type = 'request_completed'), 1, 'completion queued one delivery event');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $q$select public.upsert_my_push_subscription(
    '{"endpoint":"https://push.invalid/test","keys":{"p256dh":"p256dh-test","auth":"auth-test"},"device_label":"CI"}'::jsonb
  )$q$,
  'authenticated caller can register own push subscription'
);
select is((select username from public.ph_push_subscriptions where endpoint = 'https://push.invalid/test'), 'csr_test', 'push identity comes from caller profile');

select throws_ok(
  $q$select public.set_eval_itemcode_assignment('ITEM-TEST-1', 'Test Genus', 'abigail_vazquez')$q$,
  '42501', 'EVAL_ASSIGNMENT_FORBIDDEN',
  'unauthorized user cannot assign Eval ItemCodes'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $q$select public.set_eval_itemcode_assignment('ITEM-TEST-1', 'Test Genus', 'abigail_vazquez')$q$,
  'Dylan can assign an ItemCode + GenusName to a roster user'
);
select is(
  (select assignedto || '|' || assignment_key from public.ph_warehouse_assigned_items where itemcode_normalized = 'ITEM-TEST-1'),
  'abigail_vazquez|ITEM-TEST-1|test genus',
  'Eval assignment persisted under the composite key'
);
select is(
  (select count(distinct assignedto)::integer from public.ph_warehouse_assigned_items where assignedto is not null),
  10,
  'complete assignment backfill includes all ten managed usernames'
);
select is(
  (select count(*)::integer from (
    select assignment_key
    from public.ph_warehouse_assigned_items
    where assignment_key is not null
    group by assignment_key
    having count(*) > 1
  ) duplicate_keys),
  0,
  'ItemCode + GenusName assignments remain unique after the complete backfill'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $q$select public.get_eval_report_settings()$q$,
  '42501', 'EVAL_REPORT_SETTINGS_FORBIDDEN',
  'sales reps cannot read Eval Report settings'
);
select throws_ok(
  $q$select public.set_eval_report_settings(140, 6, 11)$q$,
  '42501', 'EVAL_REPORT_SETTINGS_FORBIDDEN',
  'sales reps cannot update Eval Report settings'
);
select ok(
  not has_table_privilege('authenticated', 'public.ph_eval_report_settings', 'UPDATE'),
  'authenticated clients cannot write the Eval Report settings table directly'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $q$select public.get_eval_report_settings()$q$,
  'Dylan can read Eval Report settings'
);
select lives_ok(
  $q$select public.set_eval_report_settings(140, 6, 11)$q$,
  'Dylan can update validated Eval Report settings'
);
select is(
  (select low_stock_max_slts::text || '|' || hold_age_days::text || '|' || location_note_age_days::text || '|' || updated_by
   from public.ph_eval_report_settings where singleton),
  '140|6|11|dylan_collyge',
  'Eval Report settings persist with the authenticated manager audit identity'
);
select throws_ok(
  $q$select public.set_eval_report_settings(-1, 5, 10)$q$,
  '22023', 'EVAL_REPORT_LOW_STOCK_LIMIT_INVALID',
  'invalid Eval Report thresholds are rejected'
);

select throws_ok(
  $q$select public.get_hosted_health_snapshot()$q$,
  '42501', 'permission denied for function get_hosted_health_snapshot',
  'authenticated clients cannot execute the hosted service health snapshot'
);

set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $q$select public.get_hosted_health_snapshot()$q$,
  'service role can record and read the sanitized hosted health snapshot'
);
select has_table(
  'public', 'ph_request_email_threads',
  'the supported migration chain creates durable request email thread state'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.ph_request_email_threads'::regclass),
  true,
  'request email thread state has row-level security enabled'
);
update public.ph_request_delivery_outbox
set next_attempt_at = now() + interval '1 day'
where status = 'pending';
insert into public.ph_request_delivery_outbox (
  event_key, event_type, payload, status, next_attempt_at
) values (
  'ci:delivery-lease', 'delivery_canary', '{}'::jsonb, 'pending', now()
);

select is(
  (select count(*)::integer from public.claim_request_delivery_events(1, 'ci-worker-a')),
  1,
  'service worker atomically claims one due delivery event'
);
select is(
  (select count(*)::integer from public.claim_request_delivery_events(1, 'ci-worker-b')),
  0,
  'a second worker cannot claim the active lease'
);
select lives_ok(
  $q$select public.record_request_delivery_channel_result(
    (select event_id from public.ph_request_delivery_outbox where event_key = 'ci:delivery-lease'),
    (select lease_token from public.ph_request_delivery_outbox where event_key = 'ci:delivery-lease'),
    '{"email":{"delivered_at":"2026-08-20T20:00:00Z","gmail_message_id":"ci-message","thread_id":"ci-thread","message_id_header":"<ci@test>"}}'::jsonb
  )$q$,
  'worker durably records a channel result before final acknowledgment'
);
select lives_ok(
  $q$select public.complete_request_delivery_event(
    (select event_id from public.ph_request_delivery_outbox where event_key = 'ci:delivery-lease'),
    (select lease_token from public.ph_request_delivery_outbox where event_key = 'ci:delivery-lease'),
    '{"push":{"delivered_at":"2026-08-20T20:00:01Z"}}'::jsonb
  )$q$,
  'worker acknowledges a leased event after channel delivery'
);
select is(
  (select status || '|' || gmail_message_id from public.ph_request_delivery_outbox where event_key = 'ci:delivery-lease'),
  'delivered|ci-message',
  'delivery acknowledgment preserves the idempotent Gmail result'
);

select * from finish();
rollback;
