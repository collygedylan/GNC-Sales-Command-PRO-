-- CI-only baseline for the legacy Drive Around history relation.
-- Production owns the canonical table; isolated migration tests need the
-- supported columns and access behavior before the Manager report migration.

create table if not exists public.ph_drive_around_report_rows (
  unique_id text primary key,
  file_id text not null,
  file_name text not null,
  report_date date,
  row_number integer not null,
  item_key text,
  itemcode text,
  commonname text,
  genus text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  blockalpha text,
  salesyear text,
  ptravailable numeric,
  holdstopcode text,
  holdstopreason text,
  holdstopbegindate_raw text,
  hold_reason_category text,
  unique (file_id, row_number)
);

create index if not exists idx_ph_drive_around_report_rows_item_date
  on public.ph_drive_around_report_rows (itemcode, report_date desc);

alter table public.ph_drive_around_report_rows enable row level security;

revoke all on table public.ph_drive_around_report_rows from public, anon;
grant select on table public.ph_drive_around_report_rows to authenticated, service_role;
grant insert, update, delete on table public.ph_drive_around_report_rows to service_role;

drop policy if exists "Authenticated read Drive Around history" on public.ph_drive_around_report_rows;
create policy "Authenticated read Drive Around history"
on public.ph_drive_around_report_rows
for select
to authenticated
using (true);
