begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select has_table('public', 'ph_pikes_order_batches', 'Pikes batch ledger exists');
select has_table('public', 'ph_pikes_order_source_rows', 'approved Pikes source rows exist');
select has_table('public', 'ph_pikes_order_inventory_rows', 'frozen inventory snapshots exist');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_pikes_order_batches'::regclass), 'Pikes batches have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_pikes_order_source_rows'::regclass), 'Pikes source rows have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_pikes_order_inventory_rows'::regclass), 'Pikes inventory rows have RLS');
select ok(not has_table_privilege('anon', 'public.ph_pikes_order_batches', 'select'), 'anonymous callers cannot read batches');
select ok(not has_table_privilege('authenticated', 'public.ph_pikes_order_batches', 'insert'), 'authenticated callers cannot insert batches');
select ok(not has_table_privilege('authenticated', 'public.ph_pikes_order_source_rows', 'update'), 'authenticated callers cannot update source rows');
select ok(has_table_privilege('service_role', 'public.ph_pikes_order_inventory_rows', 'insert'), 'service role can write snapshots');

select has_function('public', 'prepare_pikes_order_import', array['text', 'text', 'text', 'bigint', 'uuid'], 'prepare RPC exists');
select has_function('public', 'finalize_pikes_order_import', array['text', 'text', 'text', 'integer', 'integer'], 'finalize RPC exists');
select has_function('public', 'mark_pikes_order_file_archived', array['text', 'text'], 'archive RPC exists');
select has_function('public', 'record_pikes_order_import_failure', array['text', 'text', 'text'], 'failure RPC exists');
select has_function('public', 'get_manager_order_sources_v1', array[]::text[], 'source summary RPC exists');
select has_function('public', 'get_manager_order_batches_v1', array['text', 'timestamp with time zone', 'uuid', 'integer'], 'batch history RPC exists');
select has_function('public', 'get_manager_order_batch_v1', array['uuid', 'text[]', 'text', 'text', 'integer'], 'batch detail RPC exists');
select ok(has_function_privilege('authenticated', 'public.get_manager_order_batches_v1(text,timestamp with time zone,uuid,integer)', 'execute'), 'authenticated may call guarded read RPC');
select ok(not has_function_privilege('authenticated', 'public.prepare_pikes_order_import(text,text,text,bigint,uuid)', 'execute'), 'authenticated cannot call import RPC');
select ok(has_function_privilege('service_role', 'public.prepare_pikes_order_import(text,text,text,bigint,uuid)', 'execute'), 'service role can call import RPC');
select is((select count(*)::integer from private.app_access_permissions where permission_key = 'manager.orders.view' and active), 1, 'Orders permission is cataloged');
select is((
  select count(*)::integer
  from public.profiles p
  left join private.app_access_legacy_baseline b
    on b.profile_id = p.id
   and b.permission_key = 'manager.orders.view'
  where p.disabled_at is null
    and b.permission_key is null
), 0, 'Orders permission has an audit baseline for every existing active profile');
select has_index('public', 'ph_master_inventory', 'idx_ph_master_inventory_itemcode_normalized', 'normalized ItemCode lookup is indexed');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pikes_admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pikes_user@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pikes_locked@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, role, locked_until) values
  ('70000000-0000-0000-0000-000000000001', 'pikes_admin', 'Pikes Admin', 'ADMIN', null),
  ('70000000-0000-0000-0000-000000000002', 'pikes_user', 'Pikes User', 'User', null),
  ('70000000-0000-0000-0000-000000000003', 'pikes_locked', 'Pikes Locked', 'MANAGER', now() + interval '1 day')
on conflict (id) do update set role = excluded.role, disabled_at = null, locked_until = excluded.locked_until;

insert into public.ph_master_inventory (
  unique_id, itemcode, commonname, contsize, locationcode, lotcode,
  assignedto, ptronhand, ptrreviewed, ptravailable, season, blockalpha, blocknumber
) values
  ('PIKES-MASTER-1', 'PIKES-ITEM-1', 'Pikes Fixture', '#3', 'A.01.001', '27.F1', 'pikes_user', '5', '1', '4', 'F1', 'A', '01'),
  ('PIKES-MASTER-2', 'pikes-item-1', 'Pikes Fixture', '#3', 'A.01.002', '27.F1', null, '3', '0', '3', 'F1', 'A', '01')
on conflict (unique_id) do nothing;

select lives_ok(
  $q$select public.prepare_pikes_order_import(
    'pikes-ci-drive-file', 'pikes-ci.csv', repeat('b', 64), 200,
    '70000000-0000-4000-8000-000000000010'::uuid
  )$q$,
  'service import can prepare a Drive file manifest'
);

insert into public.ph_pikes_order_source_rows
  (batch_id, source_row_number, itemcode, itemcode_normalized, order_tot, pick_notes)
values
  ('70000000-0000-4000-8000-000000000010', 2, 'PIKES-ITEM-1', 'PIKES-ITEM-1', '10', 'first row'),
  ('70000000-0000-4000-8000-000000000010', 3, 'pikes-item-1', 'PIKES-ITEM-1', '20', 'repeated Item'),
  ('70000000-0000-4000-8000-000000000010', 4, 'PIKES-MISSING', 'PIKES-MISSING', '30', 'unmatched');

select lives_ok(
  $q$select public.finalize_pikes_order_import('pikes-ci-drive-file', repeat('b', 64), 'CSV', 1, 3)$q$,
  'finalize snapshots matching Drive Mode rows transactionally'
);
select is((select source_row_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 3, 'every source order row is retained');
select is((select distinct_item_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 2, 'repeated Items count once for matching');
select is((select unmatched_item_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 1, 'unmatched Item is summarized');
select is((select inventory_row_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 2, 'every matching Drive row is frozen once');

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
select ok(private.can_view_manager_orders(), 'active Admin can view Orders');
select lives_ok($q$select public.get_manager_order_batch_v1('70000000-0000-4000-8000-000000000010', array['pikes_user'], null, null, 100)$q$, 'active Admin can use assignee-filtered history RPC');

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
select ok(not private.can_view_manager_orders(), 'regular user cannot view Orders');

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000003', true);
select ok(not private.can_view_manager_orders(), 'locked Manager cannot view Orders');

select * from finish();
rollback;
