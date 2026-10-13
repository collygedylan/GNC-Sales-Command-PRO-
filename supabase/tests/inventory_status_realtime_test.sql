-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(15);
-- The historical CI table predates native-auth RLS. Reproduce the existing
-- production session boundary inside this rollback-only fixture.
-- Its sales-only policy is also absent from production and reads profiles
-- directly. Production uses current_active_profile through the session policy.
drop policy if exists sales_rep_inventory_read_v1 on public.ph_master_inventory;
alter table public.ph_master_inventory enable row level security;
do $fixture$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='ph_master_inventory' and policyname='scheduled_handover_active_session') then
    create policy scheduled_handover_active_session on public.ph_master_inventory
      as restrictive for all to authenticated
      using ((select (private.current_active_profile()).id) is not null)
      with check ((select (private.current_active_profile()).id) is not null);
  end if;
end
$fixture$;
select ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='ph_master_inventory'), 'inventory UPDATE publication is present');
select ok((select pubupdate from pg_publication where pubname='supabase_realtime'), 'publication emits UPDATE events');
select ok((select relrowsecurity from pg_class where oid='public.ph_master_inventory'::regclass), 'RLS remains enabled');
select ok(exists(select 1 from pg_policies where tablename='ph_master_inventory'
  and policyname='scheduled_handover_active_session' and permissive='RESTRICTIVE'), 'existing restrictive session policy remains');
select ok(exists(select 1 from pg_policies where tablename='ph_master_inventory'
  and policyname='inventory_status_realtime_read_v1' and cmd='SELECT'), 'the migration installed its authorized identifier policy');
select ok(has_column_privilege('authenticated','public.ph_master_inventory','unique_id','SELECT')
  and has_column_privilege('authenticated','public.ph_master_inventory','itemcode','SELECT')
  and has_column_privilege('authenticated','public.ph_master_inventory','locationcode','SELECT'), 'authenticated events can carry the primary key and pair');

-- Historical fixtures also grant full reads in an independent sales migration.
-- REVOKE SELECT also removes column grants. Restore the migration's three key
-- grants after removing historical full reads to model the production ACL.
revoke select on public.ph_master_inventory from authenticated;
grant select (unique_id,itemcode,locationcode) on public.ph_master_inventory to authenticated;
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
