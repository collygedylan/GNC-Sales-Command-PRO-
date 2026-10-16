-- @test-runtime: canonical
-- Verifies revision-only publication and source-change invalidation. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

with expected(key, modules, dylan_only) as (
  values
    ('ph_company_directory_contacts', array['managers']::text[], true),
    ('ph_company_directory_blocks', array['managers']::text[], true),
    ('ph_company_directory_beds', array['managers']::text[], true),
    ('ph_company_directory_codes', array['managers']::text[], true),
    ('production_schedule_active', array['managers']::text[], false),
    ('core_employees', array['managers']::text[], true),
    ('hr_job_codes', array['managers']::text[], true),
    ('labor_timesheets', array['managers']::text[], true)
)
select is((select count(*)::integer from app_sync_private.sources s join expected e using(key)
  where s.modules=e.modules and s.client_enabled and s.dylan_only=e.dylan_only), 8,
  'all manager sources have exact module and identity scopes');

select is((select count(*)::integer from public.app_dataset_revisions
  where key=any(array['ph_company_directory_contacts','ph_company_directory_blocks','ph_company_directory_beds',
    'ph_company_directory_codes','production_schedule_active','core_employees','hr_job_codes','labor_timesheets']::text[])),
  8, 'each manager source has a revision row');

select is((select count(*)::integer from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid
  where n.nspname='public' and c.relname=any(array[
    'ph_company_directory_contacts','ph_company_directory_blocks','ph_company_directory_beds',
    'ph_company_directory_codes','production_schedule_active','core_employees','hr_job_codes','labor_timesheets']::text[])
    and t.tgname in ('app_dataset_revision_inserted','app_dataset_revision_updated',
      'app_dataset_revision_deleted','app_dataset_revision_truncated')
    and not t.tgisinternal and t.tgenabled='O' and p.proname='touch_source'
    and ((t.tgname='app_dataset_revision_inserted' and t.tgtype=4)
      or (t.tgname='app_dataset_revision_updated' and t.tgtype=16)
      or (t.tgname='app_dataset_revision_deleted' and t.tgtype=8)
      or (t.tgname='app_dataset_revision_truncated' and t.tgtype=32))),
  32, 'every source change operation has an enabled statement trigger');

select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='app_dataset_revisions'), 'revision rows retain RLS');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='app_dataset_revisions'
  and policyname='app_dataset_revision_read' and 'authenticated'=any(roles)
  and coalesce(qual,'') like '%can_read_source%'), 'authenticated revision policy remains visibility filtered');
select ok(has_table_privilege('authenticated','public.app_dataset_revisions','select'), 'authenticated can read permitted revisions');
select ok(not has_table_privilege('anon','public.app_dataset_revisions','select'), 'anonymous has no revision access');

select ok(exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='app_dataset_revisions'), 'opaque revision metadata is published');
select is((select count(*)::integer from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename=any(array[
    'ph_company_directory_contacts','ph_company_directory_blocks','ph_company_directory_beds',
    'ph_company_directory_codes','production_schedule_active','core_employees','hr_job_codes','labor_timesheets']::text[])),
  0, 'Realtime never publishes the protected manager source rows');

create temporary table manager_revision_before(value bigint) on commit drop;
insert into manager_revision_before select revision from public.app_dataset_revisions where key='ph_company_directory_contacts';
insert into public.ph_company_directory_contacts(id,name,location)
values ('f7000000-0000-0000-0000-000000000001','Revision Signal Fixture','test-only');
select is((select revision from public.app_dataset_revisions where key='ph_company_directory_contacts'),
  (select value+1 from manager_revision_before), 'insert advances only through the opaque source revision');
-- touch_source intentionally coalesces repeated same-source changes inside one
-- transaction. Reset its transaction-local marker to model the next committed
-- write transaction while keeping this fixture itself rollback-only.
select set_config('app_sync.touched','{}',true);
update public.ph_company_directory_contacts set name='Revision Signal Updated'
where id='f7000000-0000-0000-0000-000000000001';
select is((select revision from public.app_dataset_revisions where key='ph_company_directory_contacts'),
  (select value+2 from manager_revision_before), 'update advances the source revision');
select set_config('app_sync.touched','{}',true);
delete from public.ph_company_directory_contacts where id='f7000000-0000-0000-0000-000000000001';
select is((select revision from public.app_dataset_revisions where key='ph_company_directory_contacts'),
  (select value+3 from manager_revision_before), 'delete advances the source revision');

select * from finish();
rollback;
