-- Drive Around historical row snapshots.
-- Run this before running startDriveAroundHistoryBackfill() or runDriveAroundHistoryOnly().

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.v2_drive_around_report_rows (
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
  row_hash text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_drive_around_report_rows_file_row_unique unique (file_id, row_number)
);

create index if not exists idx_v2_drive_around_report_rows_file
  on public.v2_drive_around_report_rows (file_id, row_number);

create index if not exists idx_v2_drive_around_report_rows_report_date
  on public.v2_drive_around_report_rows (report_date desc);

create index if not exists idx_v2_drive_around_report_rows_item
  on public.v2_drive_around_report_rows (itemcode, commonname, contsize, locationcode, lotcode);

create index if not exists idx_v2_drive_around_report_rows_hold
  on public.v2_drive_around_report_rows (holdstopcode, hold_reason_category, report_date desc);

create index if not exists idx_v2_drive_around_report_rows_item_key
  on public.v2_drive_around_report_rows (item_key, report_date desc);

create or replace function public.touch_v2_drive_around_report_rows_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_v2_drive_around_report_rows_updated_at
  on public.v2_drive_around_report_rows;

create trigger trg_touch_v2_drive_around_report_rows_updated_at
before update on public.v2_drive_around_report_rows
for each row
execute function public.touch_v2_drive_around_report_rows_updated_at();

alter table public.v2_drive_around_report_rows enable row level security;

drop policy if exists "Allow app read drive around report rows"
  on public.v2_drive_around_report_rows;

create policy "Allow app read drive around report rows"
  on public.v2_drive_around_report_rows
  for select
  using (true);

drop policy if exists "Allow service write drive around report rows"
  on public.v2_drive_around_report_rows;

create policy "Allow service write drive around report rows"
  on public.v2_drive_around_report_rows
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.v2_drive_around_report_rows replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_drive_around_report_rows;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
