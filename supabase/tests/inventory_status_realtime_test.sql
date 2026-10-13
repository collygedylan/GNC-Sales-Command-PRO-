-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(14);
select ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='ph_master_inventory'), 'inventory UPDATE publication is present');
select ok((select pubupdate from pg_publication where pubname='supabase_realtime'), 'publication emits UPDATE events');
select ok((select relrowsecurity from pg_class where oid='public.ph_master_inventory'::regclass), 'RLS remains enabled');
select ok(exists(select 1 from pg_policies where tablename='ph_master_inventory'
  and policyname='scheduled_handover_active_session' and permissive='RESTRICTIVE'), 'existing restrictive session policy remains');

-- Historical fixtures also grant full reads in an independent sales migration.
-- Remove that table grant inside this rollback fixture to reproduce production's
-- API-only boundary and verify the new column grants suffice for Realtime.
revoke select on public.ph_master_inventory from authenticated;
select ok(has_column_privilege('authenticated','public.ph_master_inventory','unique_id','SELECT')
  and has_column_privilege('authenticated','public.ph_master_inventory','itemcode','SELECT')
  and has_column_privilege('authenticated','public.ph_master_inventory','locationcode','SELECT'), 'authenticated events can carry the primary key and pair');
select ok(not has_column_privilege('authenticated','public.ph_master_inventory','holdstopreason','SELECT'), 'status content stays behind inventory_read');
select ok(not has_any_column_privilege('anon','public.ph_master_inventory','SELECT'), 'anonymous clients cannot receive inventory identifiers');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('9f8b0000-0000-4000-8000-000000000291','status-sync@example.invalid',now(),'{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password)
values ('9f8b0000-0000-4000-8000-000000000291','status_sync_fixture','Status Sync','MANAGER',false);
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,priority)
values ('STATUS-SYNC-1','STATUS.SYNC','A.01.001','26.F1','1'), ('STATUS-SYNC-2','STATUS.SYNC','B.01.001','25.F1',null);
select set_config('request.jwt.claims','{"sub":"9f8b0000-0000-4000-8000-000000000291","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where itemcode='STATUS.SYNC'),2::bigint,'active Manager receives both pair identifiers');
reset role;
update public.profiles set role='EVAL' where id='9f8b0000-0000-4000-8000-000000000291';
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where itemcode='STATUS.SYNC'),2::bigint,'active Eval receives both pair identifiers');
reset role;
update public.profiles set role='REP' where id='9f8b0000-0000-4000-8000-000000000291';
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where itemcode='STATUS.SYNC'),2::bigint,'active Rep receives both pair identifiers');
reset role;
update public.profiles set role='QC' where id='9f8b0000-0000-4000-8000-000000000291';
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where itemcode='STATUS.SYNC'),2::bigint,'active QC receives both pair identifiers');
reset role;
update public.profiles set role='FOREMAN' where id='9f8b0000-0000-4000-8000-000000000291';
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where itemcode='STATUS.SYNC'),1::bigint,'Foreman retains priority row restrictions');
reset role;
update public.profiles set must_change_password=true where id='9f8b0000-0000-4000-8000-000000000291';
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where itemcode='STATUS.SYNC'),0::bigint,'forced password change receives no rows');
reset role;
update public.profiles set must_change_password=false,disabled_at=now() where id='9f8b0000-0000-4000-8000-000000000291';
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where itemcode='STATUS.SYNC'),0::bigint,'disabled account receives no rows');
reset role;
select * from finish();
rollback;
