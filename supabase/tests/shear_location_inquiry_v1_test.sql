begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

select has_table('public', 'ph_shear_location_submissions', 'Shear submission ledger exists');
select has_table('public', 'ph_shear_location_inquiries', 'Location inquiry headers exist');
select has_table('public', 'ph_shear_location_items', 'Per-ITEMCODE decisions exist');
select has_table('public', 'ph_shear_location_rows', 'Frozen location rows exist');
select has_table('public', 'ph_shear_location_events', 'Shear audit events exist');

select ok((select relrowsecurity from pg_class where oid = 'public.ph_shear_location_submissions'::regclass), 'Submission ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_shear_location_inquiries'::regclass), 'Inquiry headers have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_shear_location_items'::regclass), 'ITEMCODE decisions have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_shear_location_rows'::regclass), 'Frozen rows have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_shear_location_events'::regclass), 'Audit events have RLS');

select ok(not has_table_privilege('anon', 'public.ph_shear_location_inquiries', 'select'), 'anonymous callers cannot read inquiry headers');
select ok(not has_table_privilege('authenticated', 'public.ph_shear_location_inquiries', 'select'), 'browser sessions cannot read inquiry headers directly');
select ok(not has_table_privilege('authenticated', 'public.ph_shear_location_submissions', 'insert'), 'browser sessions cannot create submissions directly');
select ok(not has_table_privilege('authenticated', 'public.ph_shear_location_inquiries', 'update'), 'browser sessions cannot mutate inquiry status directly');
select ok(has_table_privilege('service_role', 'public.ph_shear_location_rows', 'insert'), 'service role can freeze inventory rows');

select has_function('public', 'create_shear_location_inquiries_v1', array['jsonb'], 'creation RPC exists');
select has_function('public', 'complete_shear_location_inquiry_v1', array['uuid', 'text', 'integer'], 'completion RPC exists');
select has_function('public', 'cancel_shear_location_inquiry_v1', array['uuid', 'text', 'integer'], 'cancellation RPC exists');
select has_function('public', 'retry_shear_location_delivery_v1', array['uuid', 'text', 'integer'], 'delivery retry RPC exists');

select ok(not has_function_privilege('authenticated', 'public.create_shear_location_inquiries_v1(jsonb)', 'execute'), 'authenticated cannot execute creation directly');
select ok(not has_function_privilege('authenticated', 'public.complete_shear_location_inquiry_v1(uuid,text,integer)', 'execute'), 'authenticated cannot execute completion directly');
select ok(not has_function_privilege('authenticated', 'public.cancel_shear_location_inquiry_v1(uuid,text,integer)', 'execute'), 'authenticated cannot execute cancellation directly');
select ok(not has_function_privilege('authenticated', 'public.retry_shear_location_delivery_v1(uuid,text,integer)', 'execute'), 'authenticated cannot execute retry directly');
select ok(has_function_privilege('service_role', 'public.create_shear_location_inquiries_v1(jsonb)', 'execute'), 'service role can execute creation');
select ok(has_function_privilege('service_role', 'public.complete_shear_location_inquiry_v1(uuid,text,integer)', 'execute'), 'service role can execute completion');
select ok(has_function_privilege('service_role', 'public.cancel_shear_location_inquiry_v1(uuid,text,integer)', 'execute'), 'service role can execute cancellation');
select ok(has_function_privilege('service_role', 'public.retry_shear_location_delivery_v1(uuid,text,integer)', 'execute'), 'service role can execute retry');

select has_index('public', 'ph_shear_location_inquiries', 'ph_shear_location_inquiries_one_active_location_idx', 'one-active-inquiry location index exists');
select is((select count(*)::integer from private.app_access_permissions where permission_key = 'eval_work.create.drive' and active), 1, 'Drive Eval Work permission is cataloged');
select is((select count(*)::integer from private.app_access_permissions where permission_key = 'shear_location.create' and active), 1, 'Shear location permission is cataloged');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'shear-dylan@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
) on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, role, must_change_password, disabled_at, locked_until)
values ('71000000-0000-0000-0000-000000000001', 'dylan_collyge', 'Dylan', 'ADMIN', false, null, null)
on conflict (username) do update set must_change_password = false, disabled_at = null, locked_until = null;

insert into public.ph_master_inventory (
  unique_id, itemcode, commonname, contsize, locationcode, lotcode, season,
  ptronhand, ptrreviewed, ptravailable, assignedto, blockalpha, blocknumber
) values
  ('SHEAR-TEST-A1', 'SHEAR-TEST-A', 'Shear Fixture A', '#3', 'Z.99.999', '27.F1', 'F1', '5', '1', '4', 'dylan_collyge', 'Z', '99'),
  ('SHEAR-TEST-A2', ' shear-test-a ', 'Shear Fixture A', '#3', 'z.99.999 ', '27.U1', 'U1', '4', '0', '4', 'dylan_collyge', 'Z', '99'),
  ('SHEAR-TEST-B1', 'SHEAR-TEST-B', 'Shear Fixture B', '#5', 'Z.99.999', '27.X', 'X', '3', '0', '3', 'dylan_collyge', 'Z', '99')
on conflict (unique_id) do update set ptronhand = excluded.ptronhand, ptrreviewed = excluded.ptrreviewed, ptravailable = excluded.ptravailable;

create temporary table shear_test_payload(payload jsonb) on commit drop;
insert into shear_test_payload(payload)
select jsonb_build_object(
  'actorUsername', 'dylan_collyge',
  'idempotencyKey', 'shear-location-pgtap-create-0001',
  'selections', jsonb_build_array(
    jsonb_build_object('sourceUniqueId', 'SHEAR-TEST-A1', 'percent', 50, 'shearType', 'corrective_shear', 'instructions', 'Shape evenly'),
    jsonb_build_object('sourceUniqueId', 'SHEAR-TEST-B1', 'percent', 50, 'shearType', 'hard_shear', 'instructions', '')
  ),
  'recipients', jsonb_build_array(jsonb_build_object(
    'profileId', p.id::text, 'username', p.username, 'display', p.display_name,
    'email', 'shear-dylan@example.invalid'
  ))
)
from public.profiles p where p.username = 'dylan_collyge';

select lives_ok(
  format('select public.create_shear_location_inquiries_v1(%L::jsonb)', payload::text),
  'Dylan can atomically create one location inquiry'
) from shear_test_payload;

select is((select item_count from public.ph_shear_location_inquiries where location_key = 'z.99.999'), 2, 'each normalized ITEMCODE appears once');
select is((select row_count from public.ph_shear_location_inquiries where location_key = 'z.99.999'), 3, 'every season and lot row is frozen once');
select is((select total_on_hand from public.ph_shear_location_inquiries where location_key = 'z.99.999'), 12::numeric, 'location On Hand sums selected ITEMCODE membership');
select is((select total_to_shear from public.ph_shear_location_inquiries where location_key = 'z.99.999'), 7, 'half-up ITEMCODE quantities sum to the location total');
select is((select count(*)::integer from public.ph_shear_location_rows where locationcode ilike 'z.99.999%'), 3, 'frozen rows do not duplicate physical inventory IDs');
select is((select public.create_shear_location_inquiries_v1(payload)->>'idempotentReplay' from shear_test_payload), 'true', 'same idempotency key replays without duplicate delivery');

select throws_ok(
  format('select public.create_shear_location_inquiries_v1((%L::jsonb) || jsonb_build_object(''idempotencyKey'', ''shear-location-pgtap-create-0002''))', payload::text),
  '40001', 'shear_location_already_active',
  'a second active inquiry for the same location is rejected'
) from shear_test_payload;

select is((
  select status
  from public.complete_shear_location_inquiry_v1(
    (select id from public.ph_shear_location_inquiries where location_key = 'z.99.999'),
    'dylan_collyge', 1
  )
), 'complete', 'authorized workers can complete the whole location inquiry');

select * from finish();
rollback;
