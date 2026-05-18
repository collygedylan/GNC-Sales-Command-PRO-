-- Drive Around row history -> Hold Risk learning bridge.
-- Safe to run more than once.
--
-- Purpose:
--   1. Use the large historical table public.v2_drive_around_report_rows as
--      the source of truth for when rows went on hold and came off hold.
--   2. Match those hold periods to public.v2_weather_daily for Park Hill GDD.
--   3. Refresh the compact learning tables the PWA reads quickly:
--      public.v2_hold_learning_events
--      public.v2_hold_release_cycles
--      public.v2_hold_learning_profiles

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.v2_hold_learning_events (
  unique_id text primary key,
  source_table text not null default 'v2_master_inventory',
  source_unique_id text not null,
  import_file_name text,
  hold_started_on date not null,
  hold_detected_at timestamptz not null default now(),
  itemcode text,
  commonname text,
  genus text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  blockalpha text,
  salesyear text,
  holdstopcode text,
  holdstopreason text,
  holdstopbegindate_raw text,
  hold_reason_category text,
  weather_station_key text not null default 'park_hill_ok',
  gdd_base_50_7d numeric,
  gdd_base_50_14d numeric,
  gdd_base_50_30d numeric,
  gdd_base_50_season numeric,
  chill_hours_7d numeric,
  chill_hours_14d numeric,
  chill_hours_30d numeric,
  chill_hours_season numeric,
  precipitation_in_7d numeric,
  precipitation_in_14d numeric,
  precipitation_in_30d numeric,
  avg_temperature_f_7d numeric,
  avg_temperature_f_14d numeric,
  avg_temperature_f_30d numeric,
  weather_features_refreshed_at timestamptz,
  released_on date,
  gdd_base_50_to_release numeric,
  hold_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v2_hold_release_cycles (
  unique_id text primary key,
  item_key text not null,
  itemcode text,
  commonname text,
  genus text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  blockalpha text,
  salesyear text,
  holdstopreason text,
  hold_reason_category text,
  hold_started_on date not null,
  hold_released_on date,
  hold_days integer,
  gdd_base_50_to_release numeric,
  start_file_id text,
  start_file_name text,
  release_file_id text,
  release_file_name text,
  source_file_ids text[] not null default '{}'::text[],
  source_file_names text[] not null default '{}'::text[],
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v2_hold_learning_profiles (
  unique_id text primary key,
  commonname text not null,
  genus text,
  contsize text,
  hold_reason_category text not null,
  sample_count integer not null default 0,
  first_hold_on date,
  last_hold_on date,
  avg_gdd_base_50_7d numeric,
  avg_gdd_base_50_14d numeric,
  avg_gdd_base_50_30d numeric,
  avg_gdd_base_50_season numeric,
  median_gdd_base_50_30d numeric,
  avg_chill_hours_30d numeric,
  avg_chill_hours_season numeric,
  avg_precipitation_in_30d numeric,
  avg_temperature_f_30d numeric,
  release_sample_count integer not null default 0,
  avg_gdd_base_50_to_release numeric,
  median_gdd_base_50_to_release numeric,
  avg_days_to_release numeric,
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_drive_around_report_rows_item_key_date_hold
  on public.v2_drive_around_report_rows (item_key, report_date, holdstopcode);

create index if not exists idx_v2_drive_around_report_rows_date_item_key
  on public.v2_drive_around_report_rows (report_date, item_key);

create index if not exists idx_v2_hold_learning_events_source_rows
  on public.v2_hold_learning_events (source_table, source_unique_id);

create index if not exists idx_v2_hold_learning_events_rows_reason
  on public.v2_hold_learning_events (hold_reason_category, hold_started_on desc);

create index if not exists idx_v2_hold_release_cycles_rows_item
  on public.v2_hold_release_cycles (item_key, hold_started_on desc);

create index if not exists idx_v2_hold_release_cycles_rows_reason
  on public.v2_hold_release_cycles (hold_reason_category, hold_started_on desc);

create or replace function public.v2_classify_hold_reason(p_reason text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_reason, '')) ~ '(aphid|mite|scale|thrip|snail|caterpillar|insect|bug|pest|borer|beetle)' then 'pest'
    when lower(coalesce(p_reason, '')) ~ '(fung|disease|leaf spot|phytophthora|rhizoctonia|botrytis|canker|mildew|rot|rust|anthracnose|blight|phomopsis|sclerotinia)' then 'fungal_disease'
    when lower(coalesce(p_reason, '')) ~ '(leaf quality|leaf|foliar|chlorosis|yellow|necrosis|spotting|burn)' then 'leaf_quality'
    when lower(coalesce(p_reason, '')) ~ '(shear|sheared|trim|cutback|cut back|prune|pruned)' then 'sheared'
    when lower(coalesce(p_reason, '')) ~ '(freeze|frost|cold|heat|hail|weather|wind|drought|wet)' then 'weather_stress'
    when trim(coalesce(p_reason, '')) = '' then 'unknown'
    else 'other'
  end;
$$;

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows(p_limit integer default 100000)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  event_count integer := 0;
  cycle_count integer := 0;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 100000), 500000));
begin
  if to_regclass('public.v2_drive_around_report_rows') is null then
    raise exception 'public.v2_drive_around_report_rows does not exist. Run drive_around_report_rows_migration.sql and import Drive Around history first.';
  end if;

  create temp table tmp_v2_drive_around_hold_starts on commit drop as
  with ordered as (
    select
      r.*,
      (upper(trim(coalesce(r.holdstopcode, ''))) = 'H') as is_hold,
      lag(upper(trim(coalesce(r.holdstopcode, ''))) = 'H') over (
        partition by r.item_key
        order by r.report_date, r.file_name, r.row_number
      ) as previous_is_hold
    from public.v2_drive_around_report_rows r
    where r.report_date is not null
      and nullif(trim(coalesce(r.item_key, '')), '') is not null
  )
  select *
  from ordered
  where is_hold = true
    and coalesce(previous_is_hold, false) = false
  order by report_date desc, file_name desc, row_number desc
  limit safe_limit;

  insert into public.v2_hold_learning_events (
    unique_id,
    source_table,
    source_unique_id,
    import_file_name,
    hold_started_on,
    hold_detected_at,
    itemcode,
    commonname,
    genus,
    contsize,
    locationcode,
    lotcode,
    season,
    blockalpha,
    salesyear,
    holdstopcode,
    holdstopreason,
    holdstopbegindate_raw,
    hold_reason_category,
    weather_station_key,
    created_at,
    updated_at
  )
  select
    'hold_history_' || encode(digest(concat_ws('|',
      s.item_key,
      s.report_date::text,
      coalesce(s.file_id, ''),
      coalesce(s.row_number::text, ''),
      lower(coalesce(s.holdstopreason, ''))
    ), 'sha256'), 'hex') as unique_id,
    'v2_drive_around_report_rows' as source_table,
    s.unique_id as source_unique_id,
    s.file_name as import_file_name,
    s.report_date as hold_started_on,
    now() as hold_detected_at,
    nullif(trim(s.itemcode), '') as itemcode,
    nullif(trim(s.commonname), '') as commonname,
    nullif(trim(s.genus), '') as genus,
    nullif(trim(s.contsize), '') as contsize,
    nullif(trim(s.locationcode), '') as locationcode,
    nullif(trim(s.lotcode), '') as lotcode,
    nullif(trim(s.season), '') as season,
    nullif(trim(s.blockalpha), '') as blockalpha,
    nullif(trim(s.salesyear), '') as salesyear,
    'H' as holdstopcode,
    nullif(trim(s.holdstopreason), '') as holdstopreason,
    nullif(trim(s.holdstopbegindate_raw), '') as holdstopbegindate_raw,
    coalesce(nullif(trim(s.hold_reason_category), ''), public.v2_classify_hold_reason(s.holdstopreason)) as hold_reason_category,
    'park_hill_ok' as weather_station_key,
    now() as created_at,
    now() as updated_at
  from tmp_v2_drive_around_hold_starts s
  on conflict (unique_id) do update set
    source_table = excluded.source_table,
    source_unique_id = excluded.source_unique_id,
    import_file_name = excluded.import_file_name,
    hold_started_on = excluded.hold_started_on,
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    genus = excluded.genus,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    season = excluded.season,
    blockalpha = excluded.blockalpha,
    salesyear = excluded.salesyear,
    holdstopcode = excluded.holdstopcode,
    holdstopreason = excluded.holdstopreason,
    holdstopbegindate_raw = excluded.holdstopbegindate_raw,
    hold_reason_category = excluded.hold_reason_category,
    weather_station_key = excluded.weather_station_key,
    updated_at = now();

  get diagnostics event_count = row_count;

  create temp table tmp_v2_drive_around_hold_cycles on commit drop as
  select
    s.*,
    release_row.unique_id as release_unique_id,
    release_row.file_id as release_file_id,
    release_row.file_name as release_file_name,
    release_row.report_date as hold_released_on,
    greatest((release_row.report_date - s.report_date), 0) as hold_days,
    coalesce((
      select round(sum(coalesce(d.daily_gdd_base_50, 0))::numeric, 3)
      from public.v2_weather_daily d
      where d.station_key = 'park_hill_ok'
        and d.date >= s.report_date
        and d.date <= release_row.report_date
    ), 0) as gdd_base_50_to_release
  from tmp_v2_drive_around_hold_starts s
  join lateral (
    select r.*
    from public.v2_drive_around_report_rows r
    where r.item_key = s.item_key
      and r.report_date > s.report_date
      and upper(trim(coalesce(r.holdstopcode, ''))) <> 'H'
    order by r.report_date asc, r.file_name asc, r.row_number asc
    limit 1
  ) release_row on true;

  insert into public.v2_hold_release_cycles (
    unique_id,
    item_key,
    itemcode,
    commonname,
    genus,
    contsize,
    locationcode,
    lotcode,
    season,
    blockalpha,
    salesyear,
    holdstopreason,
    hold_reason_category,
    hold_started_on,
    hold_released_on,
    hold_days,
    gdd_base_50_to_release,
    start_file_id,
    start_file_name,
    release_file_id,
    release_file_name,
    source_file_ids,
    source_file_names,
    snapshot,
    created_at,
    updated_at
  )
  select
    'hold_cycle_history_' || encode(digest(concat_ws('|',
      c.item_key,
      c.report_date::text,
      coalesce(c.file_id, ''),
      coalesce(c.release_file_id, ''),
      lower(coalesce(c.holdstopreason, ''))
    ), 'sha256'), 'hex') as unique_id,
    c.item_key,
    nullif(trim(c.itemcode), '') as itemcode,
    nullif(trim(c.commonname), '') as commonname,
    nullif(trim(c.genus), '') as genus,
    nullif(trim(c.contsize), '') as contsize,
    nullif(trim(c.locationcode), '') as locationcode,
    nullif(trim(c.lotcode), '') as lotcode,
    nullif(trim(c.season), '') as season,
    nullif(trim(c.blockalpha), '') as blockalpha,
    nullif(trim(c.salesyear), '') as salesyear,
    nullif(trim(c.holdstopreason), '') as holdstopreason,
    coalesce(nullif(trim(c.hold_reason_category), ''), public.v2_classify_hold_reason(c.holdstopreason)) as hold_reason_category,
    c.report_date as hold_started_on,
    c.hold_released_on,
    c.hold_days,
    c.gdd_base_50_to_release,
    c.file_id as start_file_id,
    c.file_name as start_file_name,
    c.release_file_id,
    c.release_file_name,
    array_remove(array[c.file_id, c.release_file_id]::text[], null::text) as source_file_ids,
    array_remove(array[c.file_name, c.release_file_name]::text[], null::text) as source_file_names,
    jsonb_build_object(
      'source', 'v2_drive_around_report_rows',
      'start_unique_id', c.unique_id,
      'release_unique_id', c.release_unique_id,
      'start_raw', coalesce(c.raw, '{}'::jsonb)
    ) as snapshot,
    now() as created_at,
    now() as updated_at
  from tmp_v2_drive_around_hold_cycles c
  on conflict (unique_id) do update set
    item_key = excluded.item_key,
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    genus = excluded.genus,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    season = excluded.season,
    blockalpha = excluded.blockalpha,
    salesyear = excluded.salesyear,
    holdstopreason = excluded.holdstopreason,
    hold_reason_category = excluded.hold_reason_category,
    hold_started_on = excluded.hold_started_on,
    hold_released_on = excluded.hold_released_on,
    hold_days = excluded.hold_days,
    gdd_base_50_to_release = excluded.gdd_base_50_to_release,
    start_file_id = excluded.start_file_id,
    start_file_name = excluded.start_file_name,
    release_file_id = excluded.release_file_id,
    release_file_name = excluded.release_file_name,
    source_file_ids = excluded.source_file_ids,
    source_file_names = excluded.source_file_names,
    snapshot = excluded.snapshot,
    updated_at = now();

  get diagnostics cycle_count = row_count;

  update public.v2_hold_learning_events e
  set
    released_on = c.hold_released_on,
    hold_days = c.hold_days,
    gdd_base_50_to_release = c.gdd_base_50_to_release,
    updated_at = now()
  from tmp_v2_drive_around_hold_cycles c
  where e.source_table = 'v2_drive_around_report_rows'
    and e.source_unique_id = c.unique_id;

  if to_regprocedure('public.v2_refresh_hold_learning_weather_features(integer)') is not null then
    perform public.v2_refresh_hold_learning_weather_features(least(safe_limit, 5000));
  end if;

  if to_regprocedure('public.v2_refresh_hold_learning_profiles()') is not null then
    perform public.v2_refresh_hold_learning_profiles();
  end if;

  hold_events_upserted := event_count;
  release_cycles_upserted := cycle_count;
  return next;
end;
$$;

grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) to anon, authenticated, service_role;

alter table public.v2_hold_learning_events enable row level security;
alter table public.v2_hold_release_cycles enable row level security;
alter table public.v2_hold_learning_profiles enable row level security;

drop policy if exists "Allow app read hold learning events" on public.v2_hold_learning_events;
create policy "Allow app read hold learning events" on public.v2_hold_learning_events for select using (true);

drop policy if exists "Allow service write hold learning events" on public.v2_hold_learning_events;
create policy "Allow service write hold learning events" on public.v2_hold_learning_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "Allow app read hold release cycles" on public.v2_hold_release_cycles;
create policy "Allow app read hold release cycles" on public.v2_hold_release_cycles for select using (true);

drop policy if exists "Allow service write hold release cycles" on public.v2_hold_release_cycles;
create policy "Allow service write hold release cycles" on public.v2_hold_release_cycles for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "Allow app read hold learning profiles" on public.v2_hold_learning_profiles;
create policy "Allow app read hold learning profiles" on public.v2_hold_learning_profiles for select using (true);

drop policy if exists "Allow service write hold learning profiles" on public.v2_hold_learning_profiles;
create policy "Allow service write hold learning profiles" on public.v2_hold_learning_profiles for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

do $$
begin
  alter publication supabase_realtime add table public.v2_hold_learning_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.v2_hold_learning_profiles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.v2_hold_release_cycles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

select *
from public.v2_refresh_hold_learning_from_drive_around_rows(100000);
