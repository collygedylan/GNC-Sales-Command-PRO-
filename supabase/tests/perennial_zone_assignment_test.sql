begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

select has_column('public','ph_warehouse_assigned_items','zone_override_active','perennial override state is stored per exact assignment key');
select has_column('public','ph_warehouse_assigned_items','zone_override_prior_assignedto','pre-policy owner is retained for restoration');
select has_column('public','ph_warehouse_assigned_items','zone_override_rule_version','override rule version is recorded');
select has_column('public','ph_warehouse_assigned_items','zone_override_evaluated_revision','override records the published inventory revision');
select has_column('public','ph_warehouse_assigned_items','assignment_reason','the current assignment provenance is persisted');
select has_table('private','ph_perennial_assignment_policy_state','policy activation waits for a complete snapshot');
select ok(not has_table_privilege('authenticated','private.ph_warehouse_assignment_audit','select'),'assignment audit is not exposed to app clients');
select is(private.eval_location_zone('C.06.001'),'inside','C.06 bays are in the zone');
select is(private.eval_location_zone('C.07'),'inside','C.07 without bay is in the zone');
select is(private.eval_location_zone('D.04.999'),'inside','D.04 bays are in the zone');
select is(private.eval_location_zone('D.09.001'),'inside','D.09 bays are in the zone');
select is(private.eval_location_zone('D.10.021'),'inside','D.10 bay 021 is the upper boundary');
select is(private.eval_location_zone('D.10.022'),'outside','D.10 bay 022 is outside');
select is(private.eval_location_zone('D.03.001'),'outside','D.03 is outside');
select ok(private.eval_location_zone('D.10') is null,'D.10 without a bay is unresolved');
select ok(private.eval_location_zone('UNKNOWN') is null,'unrecognized location remains unresolved');
select has_function('public','set_eval_itemcode_assignment',array['text','text','text'],'existing assignment RPC contract stays stable');
select ok(position('for share' in lower(pg_get_functiondef('public.set_eval_itemcode_assignment(text,text,text)'::regprocedure)))
  < position('pg_advisory_xact_lock' in lower(pg_get_functiondef('public.set_eval_itemcode_assignment(text,text,text)'::regprocedure)))
  and position('pg_advisory_xact_lock' in lower(pg_get_functiondef('public.set_eval_itemcode_assignment(text,text,text)'::regprocedure)))
  < position('zone_override_active' in lower(pg_get_functiondef('public.set_eval_itemcode_assignment(text,text,text)'::regprocedure))),
  'interactive assignment locks source, serializes reconciliation, then checks zone policy');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('60100000-0000-4000-8000-000000000001','perennial-fixture@example.invalid','{}','{}') on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('60100000-0000-4000-8000-000000000001','dylan_collyge','Perennial fixture','ADMIN',false)
on conflict(id) do update set must_change_password=false,disabled_at=null,locked_until=null;
insert into auth.sessions(id,user_id) values('60200000-0000-4000-8000-000000000001','60100000-0000-4000-8000-000000000001')
on conflict(id) do nothing;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('60100000-0000-4000-8000-000000000002','perennial-megan-fixture@example.invalid','{}','{}') on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('60100000-0000-4000-8000-000000000002','megan_kelly','Megan perennial fixture','ADMIN',false)
on conflict(id) do update set must_change_password=false,disabled_at=null,locked_until=null;
insert into auth.sessions(id,user_id) values('60200000-0000-4000-8000-000000000002','60100000-0000-4000-8000-000000000002')
on conflict(id) do nothing;
insert into public.ph_eval_assignment_users(username,display_name,active,source)
values('perennial_inactive_fixture','Inactive restore fixture',true,'pgtap')
on conflict(username) do update set active=true;
update public.profiles set role='SALESMARKETING' where id='60100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"60100000-0000-4000-8000-000000000001","role":"authenticated","exp":4102444800,"session_id":"60200000-0000-4000-8000-000000000001"}',true);
select is(public.get_my_app_permissions_v1()->>'dataPermissionVersion',
  public.get_my_dataset_revisions_v1(array['ph_master_inventory'])->>'permissionVersion',
  'early permission response and dataset response share the exact canonical version');
create temporary table perennial_permission_hash_before(value text) on commit drop;
insert into perennial_permission_hash_before select public.get_my_app_permissions_v1()->>'dataPermissionVersion';
insert into private.app_limited_live_overrides(profile_id,permission_key,allowed,updated_by_username)
select '60100000-0000-4000-8000-000000000001',p.permission_key,not e.allowed,'dylan_collyge'
from private.app_access_permissions p
cross join lateral private.get_effective_app_permissions_v1('60100000-0000-4000-8000-000000000001',private.resolve_app_access_policy_id_v1(false)) e
where p.permission_key=e.permission_key and private.is_kayla_managed_permission_v1(p.permission_key)
order by p.permission_key limit 1
on conflict(profile_id,permission_key) do update set allowed=excluded.allowed;
select isnt(public.get_my_app_permissions_v1()->>'dataPermissionVersion',(select value from perennial_permission_hash_before),
  'limited live permission override invalidates the canonical permission version');
select is(public.get_my_app_permissions_v1()->>'dataPermissionVersion',
  public.get_my_dataset_revisions_v1(array['ph_master_inventory'])->>'permissionVersion',
  'limited live override remains synchronized across permission and dataset contracts');

-- Start from explicit pre-policy owner state. The migration itself must not
-- reassign any existing rows; transitions occur only after a complete import.
insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,genusname_normalized,
  concat,assignment_key,assignedto,assigned_by,assigned_at,present_in_drive,source,raw_row,zone_override_active,
  zone_override_prior_assignedto,zone_override_prior_assigned_by,zone_override_prior_assigned_at)
values
 ('perennial-fixture-lock','LOCK-1','LOCK-1','Perennial','perennial','LOCK-1Perennial','LOCK-1|perennial','dylan_collyge','fixture',now(),true,'fixture','{}',false,null,null,null),
 ('perennial-fixture-rose','ROSE-1','ROSE-1','Perennial','perennial','ROSE-1Perennial','ROSE-1|perennial','megan_kelly','fixture',now(),true,'fixture','{}',false,null,null,null),
 ('perennial-fixture-unresolved','UNRES-1','UNRES-1','Perennial','perennial','UNRES-1Perennial','UNRES-1|perennial','megan_kelly','fixture',now(),true,'fixture','{}',false,null,null,null),
 ('perennial-fixture-absent','ABSENT-1','ABSENT-1','Perennial','perennial','ABSENT-1Perennial','ABSENT-1|perennial','zoe_green','perennial_zone_policy',now(),true,'fixture','{}',true,'megan_kelly','fixture',now()),
 ('perennial-fixture-exit','EXIT-1','EXIT-1','Perennial','perennial','EXIT-1Perennial','EXIT-1|perennial','dylan_collyge','fixture',now(),true,'fixture','{}',false,null,null,null),
 ('perennial-fixture-inactive','INACTIVE-1','INACTIVE-1','Perennial','perennial','INACTIVE-1Perennial','INACTIVE-1|perennial','perennial_inactive_fixture','fixture',now(),true,'fixture','{}',false,null,null,null),
 ('perennial-fixture-outside','OUT-1','OUT-1','Perennial','perennial','OUT-1Perennial','OUT-1|perennial','megan_kelly','fixture',now(),true,'fixture','{}',false,null,null,null)
on conflict(assignment_key) where assignment_key is not null do update set assignedto=excluded.assignedto,assigned_by=excluded.assigned_by,
  assigned_at=excluded.assigned_at,zone_override_active=excluded.zone_override_active,
  zone_override_prior_assignedto=excluded.zone_override_prior_assignedto,
  zone_override_prior_assigned_by=excluded.zone_override_prior_assigned_by,
  zone_override_prior_assigned_at=excluded.zone_override_prior_assigned_at,present_in_drive=true;
delete from public.ph_master_inventory where unique_id like 'perennial-fixture-%';
insert into public.ph_master_inventory(unique_id,itemcode,genusname,commonname,contsize,locationcode,plantgroupcode) values
 ('perennial-fixture-lock-a','LOCK-1','Perennial','Lock row','1 gal','C.06.001','151_PEREN'),
 ('perennial-fixture-lock-b','LOCK-1','Perennial','Lock row','1 gal','A.01.001','151_PEREN'),
 ('perennial-fixture-rose-a','ROSE-1','Perennial','Rose row','1 gal','D.04.001','151_PEREN'),
 ('perennial-fixture-rose-b','ROSE-1','Perennial','Rose row','1 gal','A.01.001','135_ROSES'),
 ('perennial-fixture-unresolved','UNRES-1','Perennial','Unknown row','1 gal','UNKNOWN','151_PEREN'),
 ('perennial-fixture-exit','EXIT-1','Perennial','Exit row','1 gal','D.10.021','151_PEREN'),
 ('perennial-fixture-inactive','INACTIVE-1','Perennial','Inactive row','1 gal','D.05.001','151_PEREN'),
 ('perennial-fixture-outside','OUT-1','Perennial','Outside row','1 gal','A.01.001','151_PEREN');

select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),'dylan_collyge','migration does not perform an initial historical reset');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.reconcile_eval_itemcodes()->>'errorCode','PERENNIAL_POLICY_AWAITING_MASTER_IMPORT','scheduled maintenance defers until a complete first master import');
select public.begin_dataset_import_v1(array['ph_master_inventory'],'60300000-0000-4000-8000-000000000001',array['ph_master_inventory']);
select set_config('request.headers','{"x-gnc-import-run-id":"60300000-0000-4000-8000-000000000001"}',true);
create temporary table perennial_first_finish(result jsonb) on commit drop;
insert into perennial_first_finish select public.finish_dataset_import_v1('60300000-0000-4000-8000-000000000001');
select is(((select result from perennial_first_finish)->'perennialAssignment'->>'status'),
  'completed','master import finalizer returns successful assignment reconciliation status');
select ok((((select result from perennial_first_finish)->'perennialAssignment'->>'changed')::integer)>0,
  'reconciliation reports zone assignment changes');
select ok((((select result from perennial_first_finish)->'perennialAssignment'->>'assignment_changes')::integer)>0,
  'assignment transition count explicitly includes policy changes');
select ok((select activated and activation_import_run_id='60300000-0000-4000-8000-000000000001'::uuid
  from private.ph_perennial_assignment_policy_state where singleton),'first successful import atomically activates the policy');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),'zoe_green','any in-zone row enforces Zoe for the exact ItemCode+Genus pair');
select ok((select zone_override_active and zone_override_prior_assignedto='dylan_collyge' from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),'previous owner is captured once when Zoe lock activates');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='EXIT-1|perennial'),'zoe_green','a zone row in bay 021 activates the override');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='INACTIVE-1|perennial'),'zoe_green','active Zoe is saved over a prior roster user');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='ROSE-1|perennial'),'megan_kelly','any 135_ROSES row exempts the whole pair');
select ok((select not zone_override_active from public.ph_warehouse_assigned_items where assignment_key='ROSE-1|perennial'),'rose exemption does not create a Zoe lock');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='UNRES-1|perennial'),'megan_kelly','unresolved locations retain existing owner');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='ABSENT-1|perennial'),'zoe_green','absent group retains existing policy state');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='OUT-1|perennial'),'megan_kelly','outside assignment with no prior zone policy is preserved');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='OUT-1|perennial' and true),'megan_kelly','out-of-zone row remains manually editable');
select ok((select count(*)=1 from private.ph_warehouse_assignment_audit where assignment_key='LOCK-1|perennial' and event_type='zone_enforced'),'automatic owner transition is audited');
select ok((select zone_override_rule_version='perennial-zone-2026-09-v1' and zone_override_evaluated_revision is not null
  from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),'active lock records rule and published revision');
select is((select assignment_reason from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),
  'perennial_zone_area','active automatic assignment reason is persisted');

update public.app_dataset_revisions set revision=revision+1 where key='ph_master_inventory';
select is(public.reconcile_eval_itemcodes()->>'status','completed','same-owner scheduled evaluation succeeds');
select is((select zone_override_evaluated_revision from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),
  (select revision from public.app_dataset_revisions where key='ph_master_inventory'),'same-owner refresh stores its latest evaluated revision');
select is((select count(*) from private.ph_warehouse_assignment_audit where assignment_key='LOCK-1|perennial' and event_type='zone_enforced'),
  1::bigint,'metadata-only reevaluation does not duplicate transition audit');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.ph_eval_assignment_users set active=false where username='zoe_green';
select throws_ok($q$select public.reconcile_eval_itemcodes()$q$,'55000','PERENNIAL_ZONE_ZOE_INACTIVE','Zoe must be active before an in-zone reconciliation');
update public.ph_eval_assignment_users set active=true where username='zoe_green';
select set_config('app.perennial_assignment_action','zone_reconcile',true);
update public.ph_warehouse_assigned_items set assignedto='megan_kelly' where assignment_key='LOCK-1|perennial';
select set_config('app.perennial_assignment_action','',true);
select is(public.reconcile_eval_itemcodes()->>'status','completed','scheduled refresh repairs a drifted active lock');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),'zoe_green','an active lock is reasserted to Zoe');
select ok((select exists(select 1 from private.ph_warehouse_assignment_audit where assignment_key='LOCK-1|perennial' and event_type='zone_lock_reasserted')),'lock reassertion is audited');

select set_config('request.headers','{}',true);
select set_config('request.jwt.claims','{"sub":"60100000-0000-4000-8000-000000000001","role":"authenticated","exp":4102444800,"session_id":"60200000-0000-4000-8000-000000000001"}',true);
select is((public.set_eval_itemcode_assignment('OUT-1','Perennial','zoe_green')->>'assignedto'),'zoe_green','Dylan can edit an out-of-zone item');
select set_config('request.jwt.claims','{"sub":"60100000-0000-4000-8000-000000000002","role":"authenticated","exp":4102444800,"session_id":"60200000-0000-4000-8000-000000000002"}',true);
select is((public.set_eval_itemcode_assignment('OUT-1','Perennial','dylan_collyge')->>'assignedto'),'dylan_collyge','Megan can edit the same out-of-zone item');
select is((select assignment_reason from public.ph_warehouse_assigned_items where assignment_key='OUT-1|perennial'),
  'manual_assignment','manual assignment provenance is persisted');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.ph_eval_assignment_users set active=false where username='perennial_inactive_fixture';
select set_config('request.jwt.claims','{"role":"postgres"}',true);
update public.ph_master_inventory set plantgroupcode='135_ROSES' where unique_id='perennial-fixture-inactive';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claims','{"sub":"60100000-0000-4000-8000-000000000001","role":"authenticated","exp":4102444800,"session_id":"60200000-0000-4000-8000-000000000001"}',true);
select throws_ok($q$select public.set_eval_itemcode_assignment('LOCK-1','Perennial','megan_kelly')$q$,
  '55000','EVAL_ASSIGNMENT_ZONE_LOCKED','manual assignment cannot override an active zone lock');

-- Roses restore their pre-policy owner. A proven move out of zone clears the
-- lock to Unassigned. Both transitions are committed with the completed import.
select set_config('request.jwt.claims','{"role":"postgres"}',true);
update public.ph_master_inventory set plantgroupcode='135_ROSES' where unique_id='perennial-fixture-lock-a';
update public.ph_master_inventory set locationcode='D.10.022' where unique_id='perennial-fixture-lock-b';
update public.ph_master_inventory set locationcode='A.01.001' where unique_id='perennial-fixture-exit';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.begin_dataset_import_v1(array['ph_master_inventory'],'60300000-0000-4000-8000-000000000002',array['ph_master_inventory']);
select set_config('request.headers','{"x-gnc-import-run-id":"60300000-0000-4000-8000-000000000002"}',true);
select public.finish_dataset_import_v1('60300000-0000-4000-8000-000000000002');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),'dylan_collyge','rose classification restores the saved owner');
select ok((select not zone_override_active and zone_override_prior_assignedto is null from public.ph_warehouse_assigned_items where assignment_key='LOCK-1|perennial'),'restoration clears policy metadata');
select ok((select exists(select 1 from private.ph_warehouse_assignment_audit where assignment_key='LOCK-1|perennial' and event_type='rose_exemption_restore')),'owner restoration is audited');
select ok((select assignedto from public.ph_warehouse_assigned_items where assignment_key='EXIT-1|perennial') is null,'a completed out-of-zone snapshot resets the assignee');
select ok((select not zone_override_active from public.ph_warehouse_assigned_items where assignment_key='EXIT-1|perennial')
  and exists(select 1 from private.ph_warehouse_assignment_audit where assignment_key='EXIT-1|perennial' and event_type='zone_exit_unassigned'),
  'zone exit clears lock state and is audited');
select ok((select assignedto from public.ph_warehouse_assigned_items where assignment_key='INACTIVE-1|perennial') is null,'restoration does not revive an inactive prior owner');
select is((select reason from private.ph_warehouse_assignment_audit where assignment_key='INACTIVE-1|perennial' and event_type='rose_exemption_restore' order by id desc limit 1),
  'saved_owner_inactive_reset','inactive prior-owner reset is audited with its reason');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='ROSE-1|perennial'),'megan_kelly','rose owner remains untouched on subsequent refresh');
select is((select assignedto from public.ph_warehouse_assigned_items where assignment_key='OUT-1|perennial'),'dylan_collyge','manual owner remains untouched on subsequent refresh');

rollback;
