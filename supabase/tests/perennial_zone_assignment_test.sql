-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

select has_table('private','ph_inventory_row_assignment_policy_state','row policy activation is tracked atomically');
select has_table('public','ph_itemcode_default_owners','defaults persist independently of physical rows');
select has_column('public','ph_itemcode_default_owners','assigned_at','default owner changes have an effective timestamp');
select has_table('public','ph_inventory_row_assignments','effective authority is stored per physical inventory row');
select has_column('public','ph_inventory_row_assignments','master_unique_id','row identity is the authority key');
select has_column('public','ph_inventory_row_assignments','review_required','unresolved/inactive rows remain visible for review');
select ok(not has_table_privilege('authenticated','private.ph_itemcode_default_owner_audit','select'),
  'default-owner audit is not exposed to app clients');
select ok(not has_table_privilege('authenticated','public.ph_inventory_row_assignments','insert'),
  'authenticated clients cannot write row authority directly');
select ok(has_function_privilege('authenticated','public.set_itemcode_default_owners_v1(jsonb,uuid)','execute'),
  'authenticated RPC is callable and enforces its own manager/session checks');
select ok(not has_function_privilege('anon','public.set_itemcode_default_owners_v1(jsonb,uuid)','execute'),
  'anonymous callers cannot change defaults');
select ok(not has_function_privilege('authenticated','public.set_eval_itemcode_assignment(text,text,text)','execute'),
  'legacy group-level setter is retired');
select is(private.eval_location_zone('C.06.001'),'inside','C.06 bays are in the zone');
select is(private.eval_location_zone('C.07'),'inside','C.07 without bay is in the zone');
select is(private.eval_location_zone('D.04.999'),'inside','D.04 bays are in the zone');
select is(private.eval_location_zone('D.09.001'),'inside','D.09 bays are in the zone');
select is(private.eval_location_zone('D.10.021'),'inside','D.10 bay 021 is the upper boundary');
select is(private.eval_location_zone('D.10.000'),'inside','D.10 bay 000 is the lower boundary');
select is(private.eval_location_zone('D.10.022'),'outside','D.10 bay 022 is outside');
select is(private.eval_location_zone('D.03.001'),'outside','D.03 is outside');
select ok(private.eval_location_zone('D.10') is null,'D.10 without a bay is unresolved');
select ok(private.eval_location_zone('UNKNOWN') is null,'unrecognized location remains unresolved');

-- Isolated identities and sessions exercise the same native-profile checks as
-- the authenticated RPC. Every fixture is rolled back at the end of this file.
do $$
declare u record; actor_id uuid;
begin
  for u in select * from (values
    ('dylan_collyge','row-dylan@example.invalid'), ('megan_kelly','row-megan@example.invalid'),
    ('zoe_green','row-zoe@example.invalid'), ('mitch_kaiser','row-mitch@example.invalid'),
    ('row_test_worker','row-worker@example.invalid')
  ) v(username,email) loop
    select p.id into actor_id from public.profiles p where lower(p.username)=u.username limit 1;
    if actor_id is null then
      actor_id := gen_random_uuid();
      insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values(actor_id,u.email,'{}','{}');
      insert into public.profiles(id,username,display_name,role,must_change_password)
      values(actor_id,u.username,u.username,'ADMIN',false);
    else
      update public.profiles set disabled_at=null,locked_until=null,must_change_password=false
      where id=actor_id;
    end if;
    insert into public.ph_eval_assignment_users(username,display_name,active,source)
    values(u.username,u.username,true,'pgtap_row_assignment')
    on conflict(username) do update set active=true,display_name=excluded.display_name;
  end loop;
end;
$$;
create temporary table row_assignment_test_sessions(username text primary key,user_id uuid,session_id uuid) on commit drop;
insert into row_assignment_test_sessions
select lower(p.username),p.id,gen_random_uuid() from public.profiles p
where lower(p.username) in ('dylan_collyge','megan_kelly','zoe_green','mitch_kaiser','row_test_worker');
insert into auth.sessions(id,user_id) select session_id,user_id from row_assignment_test_sessions;

delete from public.ph_master_inventory where unique_id like 'row-assignment-test-%';
delete from public.ph_warehouse_assigned_items where unique_id='row-assignment-test-legacy-group';
insert into public.ph_warehouse_assigned_items(
  unique_id,itemcode,itemcode_normalized,genusname,genusname_normalized,assignment_key,assignedto,present_in_drive
) values(
  'row-assignment-test-legacy-group','ROW-TEST-UNKNOWN','ROW-TEST-UNKNOWN','Perennial','PERENNIAL',
  private.normalize_eval_assignment_key('ROW-TEST-UNKNOWN','Perennial'),'row_test_worker',true
);
insert into public.ph_master_inventory(unique_id,itemcode,genusname,commonname,contsize,locationcode,plantgroupcode) values
  ('row-assignment-test-zone','ROW-TEST-1','Perennial','Zone row','1 gal','C.06.001','151_PEREN'),
  ('row-assignment-test-outside','ROW-TEST-1','Perennial','Outside row','1 gal','A.01.001','151_PEREN'),
  ('row-assignment-test-rose','ROW-TEST-ROSE','Perennial','Rose row','1 gal','D.04.001','135_ROSES'),
  ('row-assignment-test-unresolved','ROW-TEST-UNKNOWN','Perennial','Unknown row','1 gal','UNKNOWN','151_PEREN'),
  ('row-assignment-test-zone-revoke','ROW-TEST-REVOKE','Perennial','Revocation row','1 gal','D.05.001','151_PEREN');

select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone'),
  'zoe_green','in-zone authority is assigned per physical row');
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-outside'),
  null::text,'a matching outside row does not inherit the zone row owner');
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-rose'),
  'mitch_kaiser','only in-zone 135_ROSES rows use Mitch');
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-unresolved'),
  null::text,'new unresolved rows remain unassigned even when their itemcode has a present legacy group');
select ok((select review_required and assignment_reason='unresolved_new'
  from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-unresolved'),
  'unresolved rows are flagged for review without inferred assignment');

update public.ph_master_inventory set plantgroupcode='135_ROSES'
where unique_id='row-assignment-test-zone';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone'),
  'mitch_kaiser','a newly classified in-zone rose switches to Mitch');
update public.ph_master_inventory set plantgroupcode='151_PEREN'
where unique_id='row-assignment-test-zone';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone'),
  'zoe_green','a rose classification change restores the ordinary in-zone owner');

select is((private.reconcile_inventory_row_assignments_v1(null::uuid)->>'status'),'completed',
  'repeat reconciliation completes against a ready master snapshot');
create temporary table row_assignment_audit_count(value bigint) on commit drop;
insert into row_assignment_audit_count
select count(*) from private.ph_inventory_row_assignment_audit
where master_unique_id='row-assignment-test-unresolved';
select is((private.reconcile_inventory_row_assignments_v1(null::uuid)->>'status'),'completed',
  'a second unchanged reconciliation also completes');
select is((select count(*) from private.ph_inventory_row_assignment_audit
  where master_unique_id='row-assignment-test-unresolved'),
  (select value from row_assignment_audit_count),'unchanged reconciliation does not duplicate row audit events');

select set_config('request.jwt.claims',(
  select jsonb_build_object('sub',user_id,'role','authenticated','exp',4102444800,'session_id',session_id)::text
  from row_assignment_test_sessions where username='dylan_collyge'),true);
create temporary table row_assignment_first_command(result jsonb) on commit drop;
insert into row_assignment_first_command
select public.set_itemcode_default_owners_v1(
  '[{"itemcode":"ROW-TEST-1","assignedto":"row_test_worker","expectedRevision":0},{"itemcode":"ROW-TEST-NULL","assignedto":null,"expectedRevision":0}]'::jsonb,
  '61000000-0000-4000-8000-000000000001'::uuid);
select is((select result->>'contractVersion' from row_assignment_first_command),
  'inventory-row-assignments-v1','default changes return the canonical row-ownership contract');
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-outside'),
  'row_test_worker','default applies to the outside row only');
update public.ph_master_inventory set locationcode='UNKNOWN'
where unique_id='row-assignment-test-outside';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-outside'),
  'row_test_worker','same-identity unresolved rows preserve their last confirmed owner');
select is((select assignment_reason from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-outside'),
  'unresolved_preserved','preserved unresolved owners are marked for review');
update public.ph_master_inventory set locationcode='A.01.001'
where unique_id='row-assignment-test-outside';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone'),
  'zoe_green','default does not override the independent zone row');
select ok(exists(select 1 from public.ph_itemcode_default_owners where itemcode_normalized='ROW-TEST-NULL'
  and assignedto is null),'explicit null creates a persistent default-owner record');
select is(public.set_itemcode_default_owners_v1(
  '[{"itemcode":"ROW-TEST-1","assignedto":"row_test_worker","expectedRevision":0},{"itemcode":"ROW-TEST-NULL","assignedto":null,"expectedRevision":0}]'::jsonb,
  '61000000-0000-4000-8000-000000000001'::uuid)::text,
  (select result::text from row_assignment_first_command),'exact command retry returns its immutable result');
select throws_ok($q$select public.set_itemcode_default_owners_v1('[{"itemcode":"ROW-TEST-1","assignedto":null,"expectedRevision":0}]'::jsonb,'61000000-0000-4000-8000-000000000001'::uuid)$q$,
  '40001','ITEMCODE_DEFAULT_OWNER_IDEMPOTENCY_CONFLICT','reused request ID with changed payload is rejected');
select throws_ok($q$select public.set_itemcode_default_owners_v1('[{"itemcode":"ROW-TEST-1","assignedto":"megan_kelly","expectedRevision":0}]'::jsonb,'61000000-0000-4000-8000-000000000002'::uuid)$q$,
  '40001','ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT','stale default revision is rejected');

create temporary table row_assignment_revision_before(value bigint) on commit drop;
insert into row_assignment_revision_before select revision from public.ph_inventory_row_assignments
where master_unique_id='row-assignment-test-zone';
update public.ph_master_inventory set locationcode='A.01.001' where unique_id='row-assignment-test-zone';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone'),
  'row_test_worker','a real location move recomputes only the moved physical row');
select ok((select revision > (select value from row_assignment_revision_before)
  from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone'),
  'a real source change advances the row revision');
truncate row_assignment_revision_before;
insert into row_assignment_revision_before select revision from public.ph_inventory_row_assignments
where master_unique_id='row-assignment-test-outside';
update public.ph_master_inventory set locationcode=locationcode where unique_id='row-assignment-test-outside';
select is((select revision from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-outside'),
  (select value from row_assignment_revision_before),'no-op source update does not churn row revision');
delete from public.ph_master_inventory where unique_id='row-assignment-test-zone';
select ok((select not present_in_drive and assignment_reason='source_missing'
  from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone'),
  'source deletion retires rather than deletes row authority');
select ok(exists(select 1 from private.ph_inventory_row_assignment_audit
  where master_unique_id='row-assignment-test-zone' and event_type='source_removed'),
  'source retirement is audited');

update public.ph_eval_assignment_users set active=false where username='row_test_worker';
select is((select assignedto from public.ph_itemcode_default_owners where itemcode_normalized='ROW-TEST-1'),
  null::text,'deactivating a default owner clears the inactive default');
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-outside'),
  null::text,'inactive default-owner rows fail closed');
select ok(exists(select 1 from private.ph_itemcode_default_owner_audit
  where itemcode_normalized='ROW-TEST-1' and actor_username='system_inactive_reconcile'),
  'system default-owner revocation is audited');
update public.ph_eval_assignment_users set active=true where username='row_test_worker';
update public.ph_eval_assignment_users set active=false where username='zoe_green';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone-revoke'),
  null::text,'inactive zone owner is unassigned without blocking roster deactivation');
select ok((select review_required and assignment_reason='zone_owner_inactive'
  from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone-revoke'),
  'inactive zone rows carry a visible review reason');
update public.ph_eval_assignment_users set active=true where username='zoe_green';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone-revoke'),
  'zoe_green','reactivating the zone owner restores policy ownership, not a default');

select set_config('request.jwt.claims',(
  select jsonb_build_object('sub',user_id,'role','authenticated','exp',4102444800,'session_id',session_id)::text
  from row_assignment_test_sessions where username='row_test_worker'),true);
select throws_ok($q$select public.set_itemcode_default_owners_v1('[{"itemcode":"ROW-TEST-1","assignedto":null,"expectedRevision":2}]'::jsonb,'61000000-0000-4000-8000-000000000003'::uuid)$q$,
  '42501','ITEMCODE_DEFAULT_OWNER_FORBIDDEN','non-manager cannot edit itemcode defaults');
delete from auth.sessions where id=(select session_id from row_assignment_test_sessions where username='row_test_worker');
select throws_ok($q$select public.set_itemcode_default_owners_v1('[{"itemcode":"ROW-TEST-1","assignedto":null,"expectedRevision":2}]'::jsonb,'61000000-0000-4000-8000-000000000004'::uuid)$q$,
  '42501','ITEMCODE_DEFAULT_OWNER_FORBIDDEN','revoked native session cannot edit itemcode defaults');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.begin_dataset_import_v1(array['ph_master_inventory'],
  '61000000-0000-4000-8000-000000000005'::uuid,array['ph_master_inventory'])->>'state'),
  'active','a master import opens a fenced assignment snapshot');
select set_config('request.headers','{"x-gnc-import-run-id":"61000000-0000-4000-8000-000000000005"}',true);
select is((private.reconcile_inventory_row_assignments_v1(null::uuid)->>'status'),'deferred',
  'scheduled reconciliation defers while the master snapshot is importing');
update public.ph_master_inventory set locationcode='UNKNOWN'
where unique_id='row-assignment-test-zone-revoke';
select is((select assignedto from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone-revoke'),
  'zoe_green','partial source writes do not publish mixed assignment state');
select is((public.finish_dataset_import_v1('61000000-0000-4000-8000-000000000005'::uuid)->>'state'),
  'completed','a completed import reconciles before publishing the snapshot');
select ok((select assignedto='zoe_green' and review_required and assignment_reason='unresolved_preserved'
  from public.ph_inventory_row_assignments where master_unique_id='row-assignment-test-zone-revoke'),
  'finished import publishes the recomputed unresolved row with its prior owner retained');
select set_config('request.headers','{}',true);

select is((public.begin_dataset_import_v1(array['ph_master_inventory'],
  '61000000-0000-4000-8000-000000000006'::uuid,array['ph_master_inventory'])->>'state'),
  'active','a subsequent master import can start after successful finish');
select set_config('request.headers','{"x-gnc-import-run-id":"61000000-0000-4000-8000-000000000006"}',true);
select is((public.fail_dataset_import_v1('61000000-0000-4000-8000-000000000006'::uuid)->>'state'),
  'failed','failed imports close without publishing derived assignment state');
select is((private.reconcile_inventory_row_assignments_v1(null::uuid)->>'status'),'deferred',
  'scheduled reconciliation remains fenced after a failed partial snapshot');
select set_config('request.headers','{}',true);

select * from finish();
rollback;
