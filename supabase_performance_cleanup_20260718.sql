-- Production performance cleanup for the app shell V2026.07.18.03.
--
-- Goals:
--   1. Keep Drive Around reporting fast by retaining only the hot row-copy
--      window in v2_drive_around_report_rows.
--   2. Preserve an archive manifest for older Drive source files so the
--      original Google Drive reports can still be found.
--   3. Keep large historical row copies out of Supabase Realtime.
--   4. Compact v2_reserves and add small lookup indexes used by the app.
--
-- This migration intentionally drops old imported Drive row copies after the
-- compact table is swapped in. It does not delete the original Google Drive
-- files or their metadata in v2_drive_around_report_files.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.v2_drive_around_report_rows_archive_manifest (
  file_id text primary key,
  file_name text,
  report_date date,
  drive_modified_time timestamptz,
  web_view_link text,
  row_count integer,
  hold_row_count integer,
  archived_policy text not null default 'keep latest 45 days from newest report_date',
  archived_at timestamptz not null default now()
);

insert into public.v2_drive_around_report_rows_archive_manifest (
  file_id,
  file_name,
  report_date,
  drive_modified_time,
  web_view_link,
  row_count,
  hold_row_count,
  archived_policy,
  archived_at
)
select
  f.file_id,
  f.file_name,
  f.report_date,
  f.drive_modified_time,
  f.web_view_link,
  f.row_count,
  f.hold_row_count,
  'keep latest 45 days from newest report_date',
  now()
from public.v2_drive_around_report_files f
where f.report_date < (
  select max(report_date) - interval '45 days'
  from public.v2_drive_around_report_files
  where report_date is not null
)
on conflict (file_id) do update
set
  file_name = excluded.file_name,
  report_date = excluded.report_date,
  drive_modified_time = excluded.drive_modified_time,
  web_view_link = excluded.web_view_link,
  row_count = excluded.row_count,
  hold_row_count = excluded.hold_row_count,
  archived_policy = excluded.archived_policy,
  archived_at = excluded.archived_at;

grant select on public.v2_drive_around_report_rows_archive_manifest to anon, authenticated;

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

drop table if exists public.v2_drive_around_report_rows_compact_20260718;

create table public.v2_drive_around_report_rows_compact_20260718
(like public.v2_drive_around_report_rows including defaults);

insert into public.v2_drive_around_report_rows_compact_20260718
select r.*
from public.v2_drive_around_report_rows r
join public.v2_drive_around_report_files f on f.file_id = r.file_id
where f.report_date >= (
  select max(report_date) - interval '45 days'
  from public.v2_drive_around_report_files
  where report_date is not null
);

alter table public.v2_drive_around_report_rows_compact_20260718
  add constraint v2_drive_around_report_rows_compact_20260718_pkey primary key (unique_id);

alter table public.v2_drive_around_report_rows_compact_20260718
  add constraint v2_drive_around_report_rows_compact_20260718_file_row_unique unique (file_id, row_number);

create index v2_drive_around_report_rows_compact_20260718_file_idx
  on public.v2_drive_around_report_rows_compact_20260718 (file_id, row_number);

create index v2_drive_around_report_rows_compact_20260718_report_date_idx
  on public.v2_drive_around_report_rows_compact_20260718 (report_date desc);

create index v2_drive_around_report_rows_compact_20260718_item_idx
  on public.v2_drive_around_report_rows_compact_20260718 (itemcode, commonname, contsize, locationcode, lotcode);

create index v2_drive_around_report_rows_compact_20260718_hold_idx
  on public.v2_drive_around_report_rows_compact_20260718 (holdstopcode, hold_reason_category, report_date desc);

create index v2_drive_around_report_rows_compact_20260718_item_key_idx
  on public.v2_drive_around_report_rows_compact_20260718 (item_key, report_date desc);

create index v2_drive_around_report_rows_compact_20260718_date_item_key_idx
  on public.v2_drive_around_report_rows_compact_20260718 (report_date, item_key);

create index v2_drive_around_report_rows_compact_20260718_item_key_date_hold
  on public.v2_drive_around_report_rows_compact_20260718 (item_key, report_date, holdstopcode);

create index v2_drive_around_report_rows_compact_20260718_item_order_idx
  on public.v2_drive_around_report_rows_compact_20260718 (item_key, report_date, file_name, row_number);

create index v2_drive_around_report_rows_compact_20260718_hold_date_item_par
  on public.v2_drive_around_report_rows_compact_20260718 (report_date desc, item_key)
  where nullif(btrim(coalesce(holdstopcode, '')), '') is not null;

drop trigger if exists trg_touch_v2_drive_around_report_rows_updated_at
  on public.v2_drive_around_report_rows_compact_20260718;

create trigger trg_touch_v2_drive_around_report_rows_updated_at
before update on public.v2_drive_around_report_rows_compact_20260718
for each row
execute function public.touch_v2_drive_around_report_rows_updated_at();

alter table public.v2_drive_around_report_rows_compact_20260718 enable row level security;

drop policy if exists "Allow app read drive around compact rows"
  on public.v2_drive_around_report_rows_compact_20260718;

create policy "Allow app read drive around compact rows"
  on public.v2_drive_around_report_rows_compact_20260718
  for select
  using (true);

drop policy if exists "Allow service write drive around compact rows"
  on public.v2_drive_around_report_rows_compact_20260718;

create policy "Allow service write drive around compact rows"
  on public.v2_drive_around_report_rows_compact_20260718
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.v2_drive_around_report_rows_compact_20260718 to anon, authenticated;
grant all on public.v2_drive_around_report_rows_compact_20260718 to service_role;

do $$
begin
  if to_regclass('public.v2_drive_around_report_rows_full_20260718') is not null then
    execute 'drop table public.v2_drive_around_report_rows_full_20260718';
  end if;

  execute 'alter table public.v2_drive_around_report_rows rename to v2_drive_around_report_rows_full_20260718';
  execute 'alter table public.v2_drive_around_report_rows_compact_20260718 rename to v2_drive_around_report_rows';
  execute 'drop table public.v2_drive_around_report_rows_full_20260718';
end $$;

alter table public.v2_drive_around_report_rows
  rename constraint v2_drive_around_report_rows_compact_20260718_pkey to v2_drive_around_report_rows_pkey;

alter table public.v2_drive_around_report_rows
  rename constraint v2_drive_around_report_rows_compact_20260718_file_row_unique to v2_drive_around_report_rows_file_row_unique;

alter index if exists public.v2_drive_around_report_rows_compact_20260718_date_item_key_idx rename to idx_v2_drive_around_report_rows_date_item_key;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_file_idx rename to idx_v2_drive_around_report_rows_file;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_hold_date_item_par rename to idx_v2_drive_around_report_rows_hold_date_item_partial;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_hold_idx rename to idx_v2_drive_around_report_rows_hold;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_item_idx rename to idx_v2_drive_around_report_rows_item;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_item_key_date_hold rename to idx_v2_drive_around_report_rows_item_key_date_hold;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_item_key_idx rename to idx_v2_drive_around_report_rows_item_key;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_item_order_idx rename to idx_v2_drive_around_report_rows_item_order;
alter index if exists public.v2_drive_around_report_rows_compact_20260718_report_date_idx rename to idx_v2_drive_around_report_rows_report_date;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'v2_drive_around_report_rows'
  ) then
    alter publication supabase_realtime drop table public.v2_drive_around_report_rows;
  end if;
exception
  when undefined_object then null;
end $$;

create index if not exists idx_v2_reserves_item_lot_season
  on public.v2_reserves (itemcode, lotcode, season);

create index if not exists idx_v2_reserves_loc_item_lot_cont
  on public.v2_reserves (locationcode, itemcode, lotcode, contsize);

create index if not exists idx_v2_reserves_salesrepname
  on public.v2_reserves (salesrepname);

create index if not exists idx_v2_reserves_salesrepname_trgm
  on public.v2_reserves using gin (salesrepname extensions.gin_trgm_ops);

create index if not exists idx_v2_av_notes_commonname_norm
  on public.v2_av_notes (upper(btrim(commonname)));

-- VACUUM cannot run inside an explicit transaction block.
vacuum (full, analyze) public.v2_reserves;
analyze public.v2_av_notes;
analyze public.v2_active_request;
analyze public.v2_app_live_events;
analyze public.v2_crop_roll_drive_rows;
analyze public.v2_crop_roll_rows;
analyze public.v2_crop_roll_completed_drive_keys;
analyze public.v2_drive_around_report_rows;
analyze public.v2_master_inventory;

notify pgrst, 'reload schema';
