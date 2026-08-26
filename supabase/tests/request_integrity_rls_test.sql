begin;
create extension if not exists pgtap with schema extensions;
select plan(75);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rep_test@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'csr_test@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dylan_collyge@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'abigail_vazquez@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chance_alldredge@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kayla_knepp@greenleafnursery.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'rep_test', 'Rep Test', 'REP'),
  ('10000000-0000-0000-0000-000000000002', 'csr_test', 'CSR Test', 'CSR'),
  ('10000000-0000-0000-0000-000000000003', 'dylan_collyge', 'Dylan Collyge', 'ADMIN'),
  ('10000000-0000-0000-0000-000000000004', 'abigail_vazquez', 'Abigail Vazquez', 'EVAL'),
  ('10000000-0000-0000-0000-000000000005', 'chance_alldredge', 'Chance Alldredge', E'\nREP'),
  ('10000000-0000-0000-0000-000000000006', 'kayla_knepp', 'Kayla Knepp', E'\nSalesRep')
on conflict (id) do update set role = excluded.role, disabled_at = null, locked_until = null;

insert into public.ph_master_inventory (
  unique_id, itemcode, genusname, commonname, contsize, locationcode, lotcode,
  ptravailable, priority, holdstopcode, holdstopreason, app_tab_assignment
) values (
  'MASTER-TEST-1', 'ITEM-TEST-1', 'Test Genus', 'Drive Canonical Name', '#3', 'A-1', 'LOT-1',
  '20', '1', '', '', 'location'
) on conflict (unique_id) do update set commonname = excluded.commonname;

insert into public.ph_drive_around_report_rows (
  unique_id, file_id, file_name, report_date, row_number, item_key,
  itemcode, commonname, genus, contsize, locationcode, lotcode,
  season, salesyear, ptravailable, holdstopcode, holdstopreason,
  warehousei, plantgroupcode, holdstopbegindate, salesnote_1, source_schema_version
) values
  ('HISTORY-TEST-1', 'HISTORY-FILE-1', 'DriveAround-20260629.xlsx', '2026-06-29', 1, 'ITEM-HISTORY-1',
   'ITEM-HISTORY-1', 'Test Historical Grass', 'Calamagrostis', '#1', 'A.01.001', '27.F1',
   'F1', '27', 12, 'H', 'size', '10', '300_GRASS', '6/20/2026', 'second sales note', 1),
  ('HISTORY-TEST-2', 'HISTORY-FILE-2', 'DriveAround-20260630.xlsx', '2026-06-30', 1, 'ITEM-HISTORY-1',
   'ITEM-HISTORY-1', 'Test Historical Grass', 'Calamagrostis', '#1', 'A.01.001', '27.F1',
   'F1', '27', 12, '', '', '10', '300_GRASS', '', '', 1)
on conflict (unique_id) do update set
  report_date = excluded.report_date,
  holdstopcode = excluded.holdstopcode,
  holdstopreason = excluded.holdstopreason,
  warehousei = excluded.warehousei,
  plantgroupcode = excluded.plantgroupcode,
  holdstopbegindate = excluded.holdstopbegindate,
  salesnote_1 = excluded.salesnote_1,
  source_schema_version = excluded.source_schema_version;

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

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select is((public.get_request_capabilities()->>'scope'), 'own', 'Chance receives create-and-own Request scope');
select ok((public.get_request_capabilities()->>'can_create_general')::boolean, 'Chance can create general and plant requests');
select ok((public.get_request_capabilities()->>'can_create_av')::boolean, 'Chance can create AV requests');
select lives_ok(
  $q$select public.create_request_batch(
    '20000000-0000-0000-0000-000000000005',
    '[{"unique_id":"REQ-CHANCE-1","master_id":"MASTER-TEST-1","requested_by":"Chance Alldredge","request_folder":"CHANCE-FOLDER","req_customer":"Customer","req_qty":"1"}]'::jsonb
  )$q$,
  'Chance can create a general request batch'
);
select is((select count(*)::integer from public.ph_active_request where unique_id = 'REQ-CHANCE-1'), 1, 'Chance can read the Request row he created');
select is((select request_created_by_username from public.ph_active_request where unique_id = 'REQ-CHANCE-1'), 'chance_alldredge', 'Chance creator identity is stamped by the server');
select is((select count(*)::integer from public.ph_active_request where unique_id = 'REQ-CSR-1'), 0, 'Chance cannot read another user Request row');
select throws_ok(
  $q$select public.save_request_work('REQ-CSR-1', 1, '{}'::jsonb, false)$q$,
  '42501', 'REQUEST_ROW_FORBIDDEN',
  'Chance cannot mutate another user Request row'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', true);
select is((public.get_request_capabilities()->>'contract_version')::integer, 2, 'Kayla receives Request capability contract version 2');
select is((public.get_request_capabilities()->>'scope'), 'global', 'Kayla retains global Request scope despite her SalesRep role');
select ok((public.get_request_capabilities()->>'can_create_general')::boolean, 'Kayla can create general and plant requests');
select ok((public.get_request_capabilities()->>'can_create_av')::boolean, 'Kayla can create AV requests');
select ok((public.get_request_capabilities()->>'can_view_queue')::boolean, 'Kayla can view the Request queue');
select ok((public.get_request_capabilities()->>'can_take_photo')::boolean, 'Kayla can add Request photos');
select ok((public.get_request_capabilities()->>'can_edit')::boolean, 'Kayla can edit Request work');
select ok((public.get_request_capabilities()->>'can_complete')::boolean, 'Kayla can complete Request work');
select ok((public.get_request_capabilities()->>'can_archive')::boolean, 'Kayla can archive Request work');
select lives_ok(
  $q$select public.create_request_batch(
    '20000000-0000-0000-0000-000000000006',
    '[{"unique_id":"REQ-KAYLA-GENERAL-1","master_id":"MASTER-TEST-1","requested_by":"Kayla Knepp","request_folder":"KAYLA-FOLDER","req_customer":"Customer","req_qty":"1"}]'::jsonb
  )$q$,
  'Kayla can create a general request batch'
);
select lives_ok(
  $q$select public.create_av_request_batch(
    '20000000-0000-0000-0000-000000000007',
    '[{"unique_id":"REQ-KAYLA-AV-1","master_id":"MASTER-TEST-1","requested_by":"Kayla Knepp","request_folder":"KAYLA-AV","req_customer":"Customer","req_qty":"1"}]'::jsonb
  )$q$,
  'Kayla can create an AV request batch'
);
select lives_ok(
  $q$select public.save_request_work(
    'REQ-KAYLA-GENERAL-1', 1,
    '{"req_photo_link":"https://example.invalid/kayla-request-photo.jpg","req_photo_name":"kayla-request-photo.jpg","req_comments":"Kayla request edit"}'::jsonb,
    false
  )$q$,
  'Kayla can save Request edits and photo references'
);
select is(
  (select req_photo_name from public.ph_active_request where unique_id = 'REQ-KAYLA-GENERAL-1'),
  'kayla-request-photo.jpg',
  'Kayla Request photo edit is stored on her Request row'
);
select lives_ok(
  $q$select public.save_request_work('REQ-KAYLA-GENERAL-1', 2, '{}'::jsonb, true)$q$,
  'Kayla can complete Request work'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
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
select throws_ok(
  $q$select public.search_historical_inventory_common_names('historical grass', 25)$q$,
  '42501', 'HISTORICAL_REPORT_FORBIDDEN',
  'sales reps cannot search Manager Historical Reports'
);
select is(
  (select count(*)::integer from public.ph_historical_inventory_dimensions where itemcode_key = 'ITEM-HISTORY-1'),
  0,
  'sales reps cannot read the historical drill-down dimension directly'
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
select lives_ok(
  $q$select public.search_historical_inventory_common_names('historical grass', 25)$q$,
  'Dylan can search historical Common Names'
);
select is(
  (public.search_historical_inventory_common_names('historical grass', 25)->0->>'commonname'),
  'Test Historical Grass',
  'historical Common Name search returns the matching drill-down bucket'
);
select ok(
  jsonb_array_length(public.search_historical_inventory_common_names('', 100)) > 0,
  'historical Common Names browse immediately without a search term'
);
select is(
  (public.get_historical_inventory_container_sizes('Test Historical Grass')->0->>'contsize'),
  '#1',
  'historical Common Name drills into ContSize'
);
select is(
  jsonb_array_length(public.get_historical_inventory_rows(
    'Test Historical Grass', '#1', array['report_date','holdstopcode','holdstopreason'],
    '2026-06-29', '2026-06-29', null, null, 100
  )->'rows'),
  1,
  'historical row RPC applies the selected date range'
);
select is(
  (public.get_historical_inventory_rows(
    'Test Historical Grass', '#1', array['report_date','holdstopcode','holdstopreason'],
    '2026-06-29', '2026-06-29', null, null, 100
  )->'rows'->0->'values'->>'holdstopcode'),
  'H',
  'historical row RPC preserves requested hold data'
);
select is(
  (public.get_historical_inventory_rows(
    'Test Historical Grass', '#1', array['warehousei','plantgroupcode','holdstopbegindate','salesnote_1'],
    '2026-06-29', '2026-06-29', null, null, 100
  )->'rows'->0->'values'->>'warehousei') || '|' ||
  (public.get_historical_inventory_rows(
    'Test Historical Grass', '#1', array['warehousei','plantgroupcode','holdstopbegindate','salesnote_1'],
    '2026-06-29', '2026-06-29', null, null, 100
  )->'rows'->0->'values'->>'plantgroupcode') || '|' ||
  (public.get_historical_inventory_rows(
    'Test Historical Grass', '#1', array['warehousei','plantgroupcode','holdstopbegindate','salesnote_1'],
    '2026-06-29', '2026-06-29', null, null, 100
  )->'rows'->0->'values'->>'holdstopbegindate') || '|' ||
  (public.get_historical_inventory_rows(
    'Test Historical Grass', '#1', array['warehousei','plantgroupcode','holdstopbegindate','salesnote_1'],
    '2026-06-29', '2026-06-29', null, null, 100
  )->'rows'->0->'values'->>'salesnote_1'),
  '10|300_GRASS|6/20/2026|second sales note',
  'historical row RPC returns the expanded source column projection'
);
select throws_ok(
  $q$select public.get_historical_inventory_rows(
    'Test Historical Grass', '#1', array['report_date','not_a_real_column'],
    null, null, null, null, 100
  )$q$,
  '22023', 'HISTORICAL_REPORT_COLUMN_INVALID',
  'historical row RPC rejects non-allowlisted columns'
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
