begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

select has_table('public', 'ph_pikes_order_batches', 'Pikes batch ledger exists');
select has_table('public', 'ph_pikes_order_source_rows', 'approved Pikes source rows exist');
select has_table('public', 'ph_pikes_order_inventory_rows', 'frozen inventory snapshots exist');
select has_table('public', 'ph_pikes_order_assignment_repair_audit', 'Pikes assignment repairs have a private audit ledger');
select has_column('public', 'ph_pikes_order_inventory_rows', 'assignment_authority_key', 'snapshot records assignment authority key');
select has_column('public', 'ph_pikes_order_inventory_rows', 'assignment_authority_assigned_at', 'snapshot records assignment authority time');
select has_column('public', 'ph_pikes_order_inventory_rows', 'assignment_match_method', 'snapshot records assignment match method');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_pikes_order_batches'::regclass), 'Pikes batches have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_pikes_order_source_rows'::regclass), 'Pikes source rows have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.ph_pikes_order_inventory_rows'::regclass), 'Pikes inventory rows have RLS');
select ok(not has_table_privilege('anon', 'public.ph_pikes_order_batches', 'select'), 'anonymous callers cannot read batches');
select ok(not has_table_privilege('authenticated', 'public.ph_pikes_order_batches', 'insert'), 'authenticated callers cannot insert batches');
select ok(not has_table_privilege('authenticated', 'public.ph_pikes_order_source_rows', 'update'), 'authenticated callers cannot update source rows');
select ok(has_table_privilege('service_role', 'public.ph_pikes_order_inventory_rows', 'insert'), 'service role can write snapshots');

select has_function('public', 'prepare_pikes_order_import', array['text', 'text', 'text', 'bigint', 'uuid'], 'prepare RPC exists');
select has_function('public', 'prepare_manager_order_import_v2', array['text', 'text', 'text', 'text', 'bigint', 'uuid'], 'generic manager-order prepare RPC exists');
select has_function('public', 'append_manager_order_source_rows_v1', array['uuid', 'jsonb'], 'bounded source-row upload RPC exists');
select has_function('public', 'finalize_pikes_order_import', array['text', 'text', 'text', 'integer', 'integer'], 'finalize RPC exists');
select has_function('public', 'mark_pikes_order_file_archived', array['text', 'text'], 'archive RPC exists');
select has_function('public', 'record_pikes_order_import_failure', array['text', 'text', 'text'], 'failure RPC exists');
select has_function('public', 'get_manager_order_sources_v1', array[]::text[], 'source summary RPC exists');
select has_function('public', 'get_manager_order_batches_v1', array['text', 'timestamp with time zone', 'uuid', 'integer'], 'batch history RPC exists');
select has_function('public', 'get_manager_order_batch_v1', array['uuid', 'text[]', 'text', 'text', 'integer'], 'batch detail RPC exists');
select has_function('public', 'repair_pikes_order_batch_assignments_v1', array['uuid', 'boolean', 'text'], 'historical assignment repair RPC exists');
select has_function('public', 'get_pikes_order_assignment_health_v1', array[]::text[], 'Pikes assignment health RPC exists');
select ok(has_function_privilege('authenticated', 'public.get_manager_order_batches_v1(text,timestamp with time zone,uuid,integer)', 'execute'), 'authenticated may call guarded read RPC');
select ok(not has_function_privilege('authenticated', 'public.prepare_pikes_order_import(text,text,text,bigint,uuid)', 'execute'), 'authenticated cannot call import RPC');
select ok(has_function_privilege('service_role', 'public.prepare_pikes_order_import(text,text,text,bigint,uuid)', 'execute'), 'service role can call import RPC');
select ok(not has_function_privilege('authenticated', 'public.prepare_manager_order_import_v2(text,text,text,text,bigint,uuid)', 'execute'), 'authenticated cannot call generic import RPC');
select ok(has_function_privilege('service_role', 'public.prepare_manager_order_import_v2(text,text,text,text,bigint,uuid)', 'execute'), 'service role can call generic import RPC');
select ok(not has_function_privilege('authenticated', 'public.append_manager_order_source_rows_v1(uuid,jsonb)', 'execute'), 'authenticated cannot upload manager-order source rows');
select ok(has_function_privilege('service_role', 'public.append_manager_order_source_rows_v1(uuid,jsonb)', 'execute'), 'service role can upload manager-order source rows');
select ok(not has_function_privilege('authenticated', 'public.repair_pikes_order_batch_assignments_v1(uuid,boolean,text)', 'execute'), 'authenticated cannot repair historical assignments');
select ok(has_function_privilege('service_role', 'public.repair_pikes_order_batch_assignments_v1(uuid,boolean,text)', 'execute'), 'service role can repair historical assignments');
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
select is((select count(*)::integer from private.app_access_legacy_checks where check_key = 'apps_script.stine_lumber_orders'), 1, 'Stine Apps Script surface is registered in the access audit');

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
  unique_id, itemcode, genusname, commonname, contsize, locationcode, lotcode,
  assignedto, ptronhand, ptrreviewed, ptravailable, season, blockalpha, blocknumber
) values
  ('PIKES-MASTER-1', 'PIKES-ITEM-1', 'Pikesgenus', 'Pikes Fixture', '#3', 'A.01.001', '27.F1', 'stale_master_user', '5', '1', '4', 'F1', 'A', '01'),
  ('PIKES-MASTER-2', 'pikes-item-1', 'Pikesgenus', 'Pikes Fixture', '#3', 'A.01.002', '27.F1', null, '3', '0', '3', 'F1', 'A', '01')
on conflict (unique_id) do nothing;

insert into public.ph_warehouse_assigned_items (
  unique_id, itemcode, itemcode_normalized, genusname, genusname_normalized,
  concat, assignment_key, assignedto, assigned_at, present_in_drive,
  source, raw_row, first_seen_at, last_seen_at, updated_at
) values (
  'PIKES-AUTHORITY-1', 'PIKES-ITEM-1', 'PIKES-ITEM-1', 'Pikesgenus', 'pikesgenus',
  'PIKES-ITEM-1Pikesgenus', private.normalize_eval_assignment_key('PIKES-ITEM-1', 'Pikesgenus'),
  'pikes_user', now() - interval '1 day', true, 'pikes_test_authority',
  '{"authority":"test"}'::jsonb, now() - interval '1 day', now() - interval '1 day', now() - interval '1 day'
)
on conflict (assignment_key) where assignment_key is not null do update
set assignedto = excluded.assignedto,
    assigned_at = excluded.assigned_at,
    present_in_drive = true,
    updated_at = excluded.updated_at;

select lives_ok(
  $q$select public.prepare_pikes_order_import(
    'pikes-ci-drive-file', 'pikes-ci.csv', repeat('b', 64), 200,
    '70000000-0000-4000-8000-000000000010'::uuid
  )$q$,
  'service import can prepare a Drive file manifest'
);

select lives_ok(
  $q$select public.append_manager_order_source_rows_v1(
    '70000000-0000-4000-8000-000000000010'::uuid,
    '[{"sourceRowNumber":2,"itemcode":"PIKES-ITEM-1","itemcodeNormalized":"PIKES-ITEM-1","orderTot":"10","pickNotes":"first row"},{"sourceRowNumber":3,"itemcode":"pikes-item-1","itemcodeNormalized":"PIKES-ITEM-1","orderTot":"20","pickNotes":"repeated Item"},{"sourceRowNumber":4,"itemcode":"PIKES-MISSING","itemcodeNormalized":"PIKES-MISSING","orderTot":"30","pickNotes":"unmatched"}]'::jsonb
  )$q$,
  'bounded upload accepts Pikes source rows'
);

select lives_ok(
  $q$select public.finalize_pikes_order_import('pikes-ci-drive-file', repeat('b', 64), 'CSV', 1, 3)$q$,
  'finalize snapshots matching Drive Mode rows transactionally'
);
select is((select source_row_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 3, 'every source order row is retained');
select is((select distinct_item_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 2, 'repeated Items count once for matching');
select is((select unmatched_item_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 1, 'unmatched Item is summarized');
select is((select inventory_row_count from public.ph_pikes_order_batches where drive_file_id = 'pikes-ci-drive-file'), 2, 'every matching Drive row is frozen once');
select is((select count(*)::integer from public.ph_pikes_order_inventory_rows where batch_id = '70000000-0000-4000-8000-000000000010' and assignedto = 'pikes_user'), 2, 'future snapshots ignore stale master assignments and use authority');
select is((select count(*)::integer from public.ph_pikes_order_inventory_rows where batch_id = '70000000-0000-4000-8000-000000000010' and assignment_authority_key is not null), 2, 'future snapshots retain authority keys');
select is((select count(*)::integer from public.ph_pikes_order_inventory_rows where batch_id = '70000000-0000-4000-8000-000000000010' and assignment_match_method = 'exact'), 2, 'future snapshots record exact assignment provenance');

update public.ph_pikes_order_inventory_rows
set assignedto = null,
    assignment_authority_key = null,
    assignment_authority_assigned_at = null,
    assignment_match_method = null
where batch_id = '70000000-0000-4000-8000-000000000010';
delete from public.ph_master_inventory where unique_id = 'PIKES-MASTER-2';

select is(
  (public.repair_pikes_order_batch_assignments_v1(
    '70000000-0000-4000-8000-000000000010', true, 'pikes-test-repair-v1'
  )->>'eligibleCount')::integer,
  2,
  'repair dry-run proves exact and unambiguous orphan corrections'
);
select is(
  (public.repair_pikes_order_batch_assignments_v1(
    '70000000-0000-4000-8000-000000000010', true, 'pikes-test-repair-v1'
  )->>'ambiguousCount')::integer,
  0,
  'repair dry-run rejects no rows as ambiguous in the safe fixture'
);
select is(
  (public.repair_pikes_order_batch_assignments_v1(
    '70000000-0000-4000-8000-000000000010', false, 'pikes-test-repair-v1'
  )->>'correctedCount')::integer,
  2,
  'historical repair corrects only the proven blank assignments'
);
select is((select count(*)::integer from public.ph_pikes_order_inventory_rows where batch_id = '70000000-0000-4000-8000-000000000010' and assignedto = 'pikes_user'), 2, 'historical repair applies exact and unique-ItemCode assignments');
select is((select count(*)::integer from public.ph_pikes_order_assignment_repair_audit where batch_id = '70000000-0000-4000-8000-000000000010'), 1, 'historical repair records one sanitized audit event');
select is(
  (public.repair_pikes_order_batch_assignments_v1(
    '70000000-0000-4000-8000-000000000010', false, 'pikes-test-repair-v1'
  )->>'replayed')::boolean,
  true,
  'repair idempotency replays the stored result without a second mutation'
);
select is((public.get_pikes_order_assignment_health_v1()->>'falseUnassignedCount')::integer, 0, 'hosted Pikes health finds no false unassigned snapshots after repair');
select is((public.reconcile_eval_itemcodes()->>'status')::text, 'completed', 'incremental assignment reconciliation completes');

select lives_ok(
  $q$select public.prepare_manager_order_import_v2(
    'stine_lumber', 'stine-ci-drive-file', 'stine-ci.xlsx', repeat('c', 64), 300,
    '70000000-0000-4000-8000-000000000020'::uuid
  )$q$,
  'service import can prepare a Stine Lumber Drive file manifest'
);
select is((select source_key from public.ph_pikes_order_batches where drive_file_id = 'stine-ci-drive-file'), 'stine_lumber', 'Stine batch retains its independent source key');
select lives_ok(
  $q$select public.append_manager_order_source_rows_v1(
    '70000000-0000-4000-8000-000000000020'::uuid,
    '[{"sourceRowNumber":2,"itemcode":"PIKES-ITEM-1","itemcodeNormalized":"PIKES-ITEM-1","orderTot":"12","pickNotes":"Stine fixture"}]'::jsonb
  )$q$,
  'bounded upload accepts Stine source rows'
);
select lives_ok(
  $q$select public.finalize_pikes_order_import('stine-ci-drive-file', repeat('c', 64), 'Sheet1', 1, 1)$q$,
  'shared finalizer freezes Stine inventory without mixing sources'
);
select matches((select display_name from public.ph_pikes_order_batches where drive_file_id = 'stine-ci-drive-file'), '^Stine Lumber [0-9]{2}-[0-9]{2}-[0-9]{4}$', 'Stine history receives its own dated label');

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
select ok(private.can_view_manager_orders(), 'active Admin can view Orders');
select lives_ok($q$select public.get_manager_order_batch_v1('70000000-0000-4000-8000-000000000010', array['pikes_user'], null, null, 100)$q$, 'active Admin can use assignee-filtered history RPC');
select ok(public.get_manager_order_sources_v1()->'sources' @> '[{"sourceKey":"stine_lumber","label":"Stine Lumber"}]'::jsonb, 'active Admin sees the Stine Lumber source');
select is(public.get_manager_order_batches_v1('stine_lumber', null, null, 25)->>'sourceLabel', 'Stine Lumber', 'active Admin can browse independent Stine history');

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
select ok(not private.can_view_manager_orders(), 'regular user cannot view Orders');

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000003', true);
select ok(not private.can_view_manager_orders(), 'locked Manager cannot view Orders');

select * from finish();
rollback;
