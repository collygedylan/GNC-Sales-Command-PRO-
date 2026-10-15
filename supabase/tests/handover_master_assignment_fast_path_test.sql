-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions, pg_temp;
select plan(9);

-- Use a synthetic departing identity and the canonical synthetic successor so
-- this test does not depend on a production account's profile state.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('e2584b32-472c-4888-b592-394235050b5b','authenticated','authenticated',
  'kayla.fast-path.fixture@local.invalid','',now(),
  '{"provider":"email","providers":["email"],"fixture":true}'::jsonb,
  '{"fixture":"handover-master-fast-path"}'::jsonb,now(),now())
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp','Synthetic Handover Source','Admin',false)
on conflict(id) do nothing;

insert into private.scheduled_account_handover_v1(
  transition_key,departing_profile_id,successor_profile_id,effective_at)
values('kayla_knepp_to_nelly_aguilar_20261002',
  'e2584b32-472c-4888-b592-394235050b5b',
  '961b0a0f-11a6-4db5-b066-582f772ab8e7','2026-10-03 04:00:00+00'::timestamptz)
on conflict(transition_key) do update set
  departing_profile_id=excluded.departing_profile_id,
  successor_profile_id=excluded.successor_profile_id,
  effective_at=excluded.effective_at;

insert into public.ph_master_inventory(
  unique_id,assignedto,flyer_assigned,date_completed,eval_task_completed_at,flyer_completed)
values
  ('ci-handover-master-fast-unchanged','other_user','other_user',null,null,null),
  ('ci-handover-master-fast-eligible','kayla_knepp','kayla_knepp',null,null,null),
  ('ci-handover-master-fast-completed','kayla_knepp','kayla_knepp',now(),null,now()),
  ('ci-handover-master-fast-eval-completed','kayla_knepp',null,null,now(),null),
  ('ci-handover-master-fast-null',null,null,null,null,null);

select is((select assignedto||'|'||flyer_assigned from public.ph_master_inventory
  where unique_id='ci-handover-master-fast-unchanged'),
  'other_user|other_user','unrelated assignment values remain unchanged');
select is((select assignedto||'|'||flyer_assigned from public.ph_master_inventory
  where unique_id='ci-handover-master-fast-eligible'),
  'nelly_aguilar|nelly_aguilar','eligible open master assignments are normalized');
select is((select assignedto||'|'||flyer_assigned from public.ph_master_inventory
  where unique_id='ci-handover-master-fast-completed'),
  'kayla_knepp|kayla_knepp','completed inventory and flyer assignments remain unchanged');
select is((select assignedto from public.ph_master_inventory
  where unique_id='ci-handover-master-fast-eval-completed'),
  'kayla_knepp','an eval-completed master assignment remains unchanged independently of date_completed');
select ok((select assignedto is null and flyer_assigned is null from public.ph_master_inventory
  where unique_id='ci-handover-master-fast-null'),
  'null assignment fields remain null');
select is((select count(*)::integer from private.scheduled_account_handover_audit_v1
  where transition_key='kayla_knepp_to_nelly_aguilar_20261002'
    and event_key like 'future:ph_master_inventory:ci-handover-master-fast-eligible:%'
    and event_type='assignment_transferred'
    and metadata->'after'='{"assignedto":"nelly_aguilar","flyer_assigned":"nelly_aguilar"}'::jsonb),
  1,'eligible master transfer retains its deterministic audit event');

insert into public.ph_eval_assignment_rules(id,sheet_row_number,assignedto,active)
values(990000000000501,501,'kayla_knepp',true);
select is((select assignedto from public.ph_eval_assignment_rules where id=990000000000501),
  'nelly_aguilar','generic handover target keeps using the established normalization path');
select ok(exists(select 1 from private.scheduled_account_handover_audit_v1
  where transition_key='kayla_knepp_to_nelly_aguilar_20261002'
    and event_key like 'future:ph_eval_assignment_rules:990000000000501:%'),
  'generic target audit event remains intact');
select is((select array_agg(distinct table_name order by table_name)
  from private.handover_assignment_targets_v1() where table_name<>'ph_master_inventory'),
  array['ph_eval_assignment_rules','ph_inventory_edit_requests','ph_itemcode_default_owners',
    'ph_reserves','ph_soc_master','ph_warehouse_assigned_items']::text[],
  'every generic handover target remains registered');

select * from finish();
rollback;
