-- CI-only baseline for the legacy Drive Around history relation.
-- Production owns the canonical table; isolated migration tests need the
-- supported columns and access behavior before the Manager report migration.

begin;

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

-- These two production baseline sources are read by the photo-history
-- refresh function before the historical migration chain starts. Keep their
-- CI definitions faithful to the baseline schema and ACL/RLS behavior; no
-- production data is copied into the isolated database.
create table if not exists public.ph_flyer_folder_history (
  unique_id text primary key,
  master_unique_id text,
  source_table text default 'v2_master_inventory'::text,
  flyer_title text default 'Unassigned'::text not null,
  folder_name text,
  folder_tab text default 'active'::text not null,
  history_state text default 'active'::text not null,
  flyer_assigned text,
  flyer_cat text,
  flyer_inst text,
  flyer_notes text,
  flyer_completed timestamptz,
  assignedto text,
  date_completed timestamptz,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  priority text,
  ptravailable text,
  s_lts text,
  holdstopcode text,
  plantgroupcode text,
  locationnote text,
  av_note text,
  match numeric,
  loc_match_qty numeric,
  spec text,
  caliper text,
  pick text,
  initial_ptr numeric,
  flyer_av_note text,
  flyer_match numeric,
  flyer_loc_match_qty numeric,
  flyer_spec text,
  flyer_caliper text,
  flyer_pick text,
  flyer_initial_ptr numeric,
  flyer_photo_link text,
  flyer_photo_name text,
  snapshot jsonb default '{}'::jsonb not null,
  last_event text,
  created_by_username text,
  created_by_display text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.ph_flyer_folder_history enable row level security;
revoke all on table public.ph_flyer_folder_history from public, anon, authenticated, service_role;
grant select, maintain on table public.ph_flyer_folder_history to anon, authenticated;
grant all on table public.ph_flyer_folder_history to service_role;
drop policy if exists "Allow app read flyer folder history" on public.ph_flyer_folder_history;
create policy "Allow app read flyer folder history"
  on public.ph_flyer_folder_history for select using (true);
drop policy if exists "Allow app write flyer folder history" on public.ph_flyer_folder_history;
create policy "Allow app write flyer folder history"
  on public.ph_flyer_folder_history using (true) with check (true);

create table if not exists public.ph_productivity_history (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  completed_by_username text not null,
  completed_by_display text not null,
  completed_at timestamptz not null,
  source_table text not null,
  source_kind text not null,
  source_unique_id text not null,
  source_assignment text,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  customer_name text,
  request_folder text,
  snapshot jsonb not null
);

alter table public.ph_productivity_history enable row level security;
revoke all on table public.ph_productivity_history from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain
  on table public.ph_productivity_history to anon, authenticated;
grant all on table public.ph_productivity_history to service_role;

commit;
