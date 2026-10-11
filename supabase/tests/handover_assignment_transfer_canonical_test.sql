-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, bunch_note_private, extensions, pg_temp;
select plan(27);

select has_function('private','transfer_remaining_handover_assignments_v1',array['text','integer'],
  'bounded handover assignment transfer exists');
select ok(has_function_privilege('service_role',
  'private.transfer_remaining_handover_assignments_v1(text,integer)','execute')
  and not has_function_privilege('authenticated',
  'private.transfer_remaining_handover_assignments_v1(text,integer)','execute')
  and not has_function_privilege('anon',
  'private.transfer_remaining_handover_assignments_v1(text,integer)','execute'),
  'handover transfer is callable only by the server role');
select ok((select prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='private.transfer_remaining_handover_assignments_v1(text,integer)'::regprocedure),
  'handover transfer is security definer with a pinned empty search path');

-- The canonical migration fixture supplies synthetic Nelly. Add only a synthetic
-- Kayla identity so the production migration and its fixed transition key are
-- exercised without copying account data into the disposable schema.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('e2584b32-472c-4888-b592-394235050b5b','authenticated','authenticated',
  'kayla.baseline.fixture@local.invalid','',now(),
  '{"provider":"email","providers":["email"],"fixture":true}'::jsonb,
  '{"fixture":"canonical-handover-test"}'::jsonb,now(),now())
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp','Kayla (synthetic CI)','Admin',false)
on conflict(id) do nothing;
select ok(exists(select 1 from public.profiles where id='e2584b32-472c-4888-b592-394235050b5b'::uuid)
  and exists(select 1 from public.profiles where id='961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid),
  'synthetic source and successor profiles exist');

-- Seed live assignments before the scheduled row. The future-assignment
-- normalizer must not rewrite fixture data before the transfer worker runs.
insert into public.ph_eval_assignment_rules(id,sheet_row_number,assignedto,active)
values(990000000000001,1,'kayla_knepp',true);

insert into public.ph_location_work_jobs(id,idempotency_key,title,general_instructions,
  status,assigned_usernames,completion_recipient,created_by_profile_id,
  created_by_username,created_by_display)
values('9f8b0000-0000-4000-8000-000000000101','canonical-handover-location-01',
  'Canonical handover assignment','Transfer this synthetic location task.',
  'open',array['kayla_knepp'],'{}'::jsonb,
  'e2584b32-472c-4888-b592-394235050b5b','kayla_knepp','Kayla (synthetic CI)');

insert into public.ph_shear_location_submissions(id,idempotency_key,created_by_username,created_by_profile_id)
values('9f8b0000-0000-4000-8000-000000000102','canonical-handover-shear-01',
  'kayla_knepp','e2584b32-472c-4888-b592-394235050b5b');
insert into public.ph_shear_location_inquiries(id,submission_id,locationcode,
  recipient_profiles,recipient_usernames,recipient_emails,created_by_username,created_by_display)
values('9f8b0000-0000-4000-8000-000000000103','9f8b0000-0000-4000-8000-000000000102',
  'CI-HANDOVER-01',
  '[{"profileId":"e2584b32-472c-4888-b592-394235050b5b","username":"kayla_knepp","display":"Kayla (synthetic CI)","email":"kayla.baseline.fixture@local.invalid"}]'::jsonb,
  array['kayla_knepp'],array['kayla.baseline.fixture@local.invalid'],
  'kayla_knepp','Kayla (synthetic CI)');

insert into public.ph_master_inventory(unique_id,itemcode,commonname,assignedto,genusname)
values('ci-handover-master-01','CI-HANDOVER-01','Synthetic Handover Plant',null,'Acer');
insert into public.ph_master_inventory_user_assignments(master_unique_id,assignedto,
  assignment_source,source_assignedto,itemcode,locationcode,source)
values('ci-handover-master-01','kayla_knepp','assignedto_final','Kayla Knepp',
  'CI-HANDOVER-01','CI-HANDOVER-01','canonical-handover-fixture');

-- A legacy Bunch Note job exercises the separate owner_id loop while avoiding
-- the per-card command guard (format_version is intentionally absent).
insert into bunch_note_private.batches(id,created_by,block,body)
values('9f8b0000-0000-4000-8000-000000000104',
  'e2584b32-472c-4888-b592-394235050b5b','CI-HANDOVER','{"locations":[]}');
insert into bunch_note_private.jobs(id,batch_id,note_number,block,location,owner_id,
  body,created_by)
values('9f8b0000-0000-4000-8000-000000000105',
  '9f8b0000-0000-4000-8000-000000000104','CI-HANDOVER-01','CI-HANDOVER',
  'CI-HANDOVER-01','e2584b32-472c-4888-b592-394235050b5b','{}'::jsonb,
  'e2584b32-472c-4888-b592-394235050b5b');

-- Add the fixed schedule only after every Kayla assignment fixture is in place.
insert into private.scheduled_account_handover_v1(
  transition_key,departing_profile_id,successor_profile_id,effective_at)
values('kayla_knepp_to_nelly_aguilar_20261002',
  'e2584b32-472c-4888-b592-394235050b5b',
  '961b0a0f-11a6-4db5-b066-582f772ab8e7','2026-10-03 04:00:00+00'::timestamptz);

create temporary table handover_transfer_results(call_number integer primary key,result jsonb not null);

-- An exception in an enclosing transaction block rolls back already completed
-- row updates and their audit events as a unit.
do $rollback_check$
begin
  begin
    if private.transfer_remaining_handover_assignments_v1(
      'kayla_knepp_to_nelly_aguilar_20261002',2)->>'changed' <> '2' then
      raise exception 'HANDOVER_TEST_EXPECTED_TWO_ROLLBACK_ROWS';
    end if;
    raise exception 'HANDOVER_TEST_FORCE_ROLLBACK';
  exception when others then
    if sqlerrm <> 'HANDOVER_TEST_FORCE_ROLLBACK' then raise; end if;
  end;
end;
$rollback_check$;

select is((select assignedto from public.ph_eval_assignment_rules where id=990000000000001),
  'kayla_knepp','exception rollback restores the dynamic target');
select is((select assigned_usernames from public.ph_location_work_jobs
  where id='9f8b0000-0000-4000-8000-000000000101'),array['kayla_knepp']::text[],
  'exception rollback restores the location assignment');
select is((select count(*)::integer from private.scheduled_account_handover_audit_v1
  where transition_key='kayla_knepp_to_nelly_aguilar_20261002' and event_type='assignment_transferred'),
  0,'exception rollback removes partial transfer audit records');

insert into handover_transfer_results
select 1,private.transfer_remaining_handover_assignments_v1('kayla_knepp_to_nelly_aguilar_20261002',2);
insert into handover_transfer_results
select 2,private.transfer_remaining_handover_assignments_v1('kayla_knepp_to_nelly_aguilar_20261002',2);
insert into handover_transfer_results
select 3,private.transfer_remaining_handover_assignments_v1('kayla_knepp_to_nelly_aguilar_20261002',2);
insert into handover_transfer_results
select 4,private.transfer_remaining_handover_assignments_v1('kayla_knepp_to_nelly_aguilar_20261002',2);

select is((select (result->>'changed')::integer from handover_transfer_results where call_number=1),
  2,'first bounded call transfers no more than its cap');
select ok((select (result->>'remaining')::boolean from handover_transfer_results where call_number=1),
  'first bounded call reports unprocessed assignments');
select is((select (result->>'changed')::integer from handover_transfer_results where call_number=2),
  2,'second bounded call resumes on remaining heterogeneous targets');
select ok((select (result->>'remaining')::boolean from handover_transfer_results where call_number=2),
  'second bounded call still reports the final target');
select is((select (result->>'changed')::integer from handover_transfer_results where call_number=3),
  1,'third bounded call transfers the last target');
select ok(not (select (result->>'remaining')::boolean from handover_transfer_results where call_number=3),
  'third bounded call reports convergence');
select is((select (result->>'changed')::integer from handover_transfer_results where call_number=4),
  0,'repeat call is idempotent after convergence');
select ok(not (select (result->>'remaining')::boolean from handover_transfer_results where call_number=4),
  'idempotent repeat reports no remaining assignments');

select is((select assignedto from public.ph_eval_assignment_rules where id=990000000000001),
  'nelly_aguilar','dynamic assignment target transfers');
select is((select assigned_usernames from public.ph_location_work_jobs
  where id='9f8b0000-0000-4000-8000-000000000101'),array['nelly_aguilar']::text[],
  'location work usernames transfer and deduplicate');
select is((select count(*)::integer from public.ph_location_work_assignments
  where job_id='9f8b0000-0000-4000-8000-000000000101'
    and profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'),
  1,'location work receives the live successor assignment link');
select is((select recipient_usernames from public.ph_shear_location_inquiries
  where id='9f8b0000-0000-4000-8000-000000000103'),array['nelly_aguilar']::text[],
  'Shear recipients transfer');
select is((select recipient_emails from public.ph_shear_location_inquiries
  where id='9f8b0000-0000-4000-8000-000000000103'),
  array[(select email from auth.users where id='961b0a0f-11a6-4db5-b066-582f772ab8e7')]::text[],
  'Shear recipient email remains aligned with the transferred username');
select is((select count(*)::integer from public.ph_master_inventory_user_assignments
  where master_unique_id='ci-handover-master-01' and assignedto='nelly_aguilar'),
  1,'inventory assignment link transfers to the successor');
select is((select source_assignedto from public.ph_master_inventory_user_assignments
  where master_unique_id='ci-handover-master-01' and assignedto='nelly_aguilar'),
  'Kayla Knepp','inventory source assignment snapshot is preserved');
select is((select owner_id from bunch_note_private.jobs
  where id='9f8b0000-0000-4000-8000-000000000105'),
  '961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid,'legacy Bunch Note owner transfers');
select is((select count(*)::integer from private.scheduled_account_handover_audit_v1
  where transition_key='kayla_knepp_to_nelly_aguilar_20261002' and event_key like 'transfer:%'
    and event_type='assignment_transferred'),
  5,'each worker-transferred heterogeneous assignment has one transfer audit event');
-- The worker already assigns the successor, so it does not trigger a second
-- normalization event. Exercise a genuinely new departing-user assignment.
insert into public.ph_eval_assignment_rules(id,sheet_row_number,assignedto,active)
values(990000000000002,2,'kayla_knepp',true);
select is((select assignedto from public.ph_eval_assignment_rules where id=990000000000002),
  'nelly_aguilar','future assignments are normalized after the scheduled cutoff');
select is((select count(*)::integer from private.scheduled_account_handover_audit_v1
  where transition_key='kayla_knepp_to_nelly_aguilar_20261002'
    and event_key like 'future:ph_eval_assignment_rules:%'),
  1,'the active future-assignment guard records its own normalization audit once');
select is((select count(distinct event_key)::integer from private.scheduled_account_handover_audit_v1
  where transition_key='kayla_knepp_to_nelly_aguilar_20261002' and event_key like 'transfer:%'
    and event_type='assignment_transferred'),
  5,'worker transfer audit event keys remain unique across retries');

select * from finish();
rollback;
