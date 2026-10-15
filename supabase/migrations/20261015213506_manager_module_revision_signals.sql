begin;
set local lock_timeout = '5s';

-- These sources publish only opaque revision metadata. The protected table
-- rows remain behind their existing RLS policies and are never added to the
-- Realtime publication.
insert into app_sync_private.sources(key, modules, client_enabled, dylan_only) values
  ('ph_company_directory_contacts', '{managers}', true, true),
  ('ph_company_directory_blocks', '{managers}', true, true),
  ('ph_company_directory_beds', '{managers}', true, true),
  ('ph_company_directory_codes', '{managers}', true, true),
  ('production_schedule_active', '{managers}', true, false),
  ('core_employees', '{managers}', true, true),
  ('hr_job_codes', '{managers}', true, true),
  ('labor_timesheets', '{managers}', true, true)
on conflict (key) do nothing;

insert into public.app_dataset_revisions(key)
select source.key
from app_sync_private.sources source
where source.key in (
  'ph_company_directory_contacts', 'ph_company_directory_blocks',
  'ph_company_directory_beds', 'ph_company_directory_codes',
  'production_schedule_active', 'core_employees', 'hr_job_codes', 'labor_timesheets'
)
on conflict (key) do nothing;

create trigger app_dataset_revision_inserted
after insert on public.ph_company_directory_contacts
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.ph_company_directory_contacts
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.ph_company_directory_contacts
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.ph_company_directory_contacts
for each statement execute function app_sync_private.touch_source();

create trigger app_dataset_revision_inserted
after insert on public.ph_company_directory_blocks
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.ph_company_directory_blocks
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.ph_company_directory_blocks
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.ph_company_directory_blocks
for each statement execute function app_sync_private.touch_source();

create trigger app_dataset_revision_inserted
after insert on public.ph_company_directory_beds
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.ph_company_directory_beds
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.ph_company_directory_beds
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.ph_company_directory_beds
for each statement execute function app_sync_private.touch_source();

create trigger app_dataset_revision_inserted
after insert on public.ph_company_directory_codes
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.ph_company_directory_codes
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.ph_company_directory_codes
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.ph_company_directory_codes
for each statement execute function app_sync_private.touch_source();

create trigger app_dataset_revision_inserted
after insert on public.production_schedule_active
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.production_schedule_active
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.production_schedule_active
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.production_schedule_active
for each statement execute function app_sync_private.touch_source();

create trigger app_dataset_revision_inserted
after insert on public.core_employees
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.core_employees
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.core_employees
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.core_employees
for each statement execute function app_sync_private.touch_source();

create trigger app_dataset_revision_inserted
after insert on public.hr_job_codes
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.hr_job_codes
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.hr_job_codes
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.hr_job_codes
for each statement execute function app_sync_private.touch_source();

create trigger app_dataset_revision_inserted
after insert on public.labor_timesheets
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated
after update on public.labor_timesheets
referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted
after delete on public.labor_timesheets
referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated
after truncate on public.labor_timesheets
for each statement execute function app_sync_private.touch_source();

do $publication$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'SUPABASE_REALTIME_PUBLICATION_MISSING';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'app_dataset_revisions'
  ) then
    alter publication supabase_realtime add table public.app_dataset_revisions;
  end if;
end
$publication$;

commit;
