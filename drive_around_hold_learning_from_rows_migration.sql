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
  itemcode text,
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

alter table public.v2_hold_learning_profiles
  add column if not exists itemcode text;

create index if not exists idx_v2_drive_around_report_rows_item_key_date_hold
  on public.v2_drive_around_report_rows (item_key, report_date, holdstopcode);

create index if not exists idx_v2_drive_around_report_rows_date_item_key
  on public.v2_drive_around_report_rows (report_date, item_key);

create index if not exists idx_v2_drive_around_report_rows_item_order
  on public.v2_drive_around_report_rows (item_key, report_date, file_name, row_number);

create index if not exists idx_v2_drive_around_report_rows_hold_date_item_partial
  on public.v2_drive_around_report_rows (report_date desc, item_key)
  where upper(trim(coalesce(holdstopcode, ''))) = 'H';

create index if not exists idx_v2_hold_learning_events_source_rows
  on public.v2_hold_learning_events (source_table, source_unique_id);

create index if not exists idx_v2_hold_learning_events_rows_reason
  on public.v2_hold_learning_events (hold_reason_category, hold_started_on desc);

create index if not exists idx_v2_hold_release_cycles_rows_item
  on public.v2_hold_release_cycles (item_key, hold_started_on desc);

create index if not exists idx_v2_hold_release_cycles_rows_reason
  on public.v2_hold_release_cycles (hold_reason_category, hold_started_on desc);

create index if not exists idx_v2_hold_learning_profiles_item_reason
  on public.v2_hold_learning_profiles (itemcode, hold_reason_category);

create index if not exists idx_v2_hold_learning_profiles_item_size_reason
  on public.v2_hold_learning_profiles (itemcode, contsize, hold_reason_category);

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
      coalesce(c.unique_id, ''),
      coalesce(c.release_unique_id, ''),
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

create or replace function public.v2_refresh_hold_learning_profiles()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  refreshed integer := 0;
begin
  insert into public.v2_hold_learning_profiles (
    unique_id,
    itemcode,
    commonname,
    genus,
    contsize,
    hold_reason_category,
    sample_count,
    first_hold_on,
    last_hold_on,
    avg_gdd_base_50_7d,
    avg_gdd_base_50_14d,
    avg_gdd_base_50_30d,
    avg_gdd_base_50_season,
    median_gdd_base_50_30d,
    avg_chill_hours_30d,
    avg_chill_hours_season,
    avg_precipitation_in_30d,
    avg_temperature_f_30d,
    release_sample_count,
    avg_gdd_base_50_to_release,
    median_gdd_base_50_to_release,
    avg_days_to_release,
    updated_at
  )
  with event_base as (
    select
      lower(trim(coalesce(itemcode, ''))) as itemcode_key,
      lower(trim(coalesce(commonname, 'unknown'))) as common_key,
      lower(trim(coalesce(contsize, ''))) as contsize_key,
      coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as reason_key,
      coalesce(nullif(trim(commonname), ''), 'Unknown') as commonname_display,
      nullif(trim(max(genus) over (
        partition by
          lower(trim(coalesce(itemcode, ''))),
          lower(trim(coalesce(commonname, 'unknown'))),
          lower(trim(coalesce(contsize, ''))),
          coalesce(nullif(trim(hold_reason_category), ''), 'unknown')
      )), '') as genus_display,
      nullif(trim(contsize), '') as contsize_display,
      hold_started_on,
      gdd_base_50_7d,
      gdd_base_50_14d,
      gdd_base_50_30d,
      gdd_base_50_season,
      chill_hours_30d,
      chill_hours_season,
      precipitation_in_30d,
      avg_temperature_f_30d
    from public.v2_hold_learning_events
    where commonname is not null
      and hold_reason_category is not null
  ),
  event_stats as (
    select
      itemcode_key,
      common_key,
      contsize_key,
      reason_key,
      max(commonname_display) as commonname_display,
      max(genus_display) as genus_display,
      max(contsize_display) as contsize_display,
      count(*)::integer as sample_count,
      min(hold_started_on) as first_hold_on,
      max(hold_started_on) as last_hold_on,
      round(avg(gdd_base_50_7d), 3) as avg_gdd_base_50_7d,
      round(avg(gdd_base_50_14d), 3) as avg_gdd_base_50_14d,
      round(avg(gdd_base_50_30d), 3) as avg_gdd_base_50_30d,
      round(avg(gdd_base_50_season), 3) as avg_gdd_base_50_season,
      round((percentile_cont(0.5) within group (order by gdd_base_50_30d))::numeric, 3) as median_gdd_base_50_30d,
      round(avg(chill_hours_30d), 3) as avg_chill_hours_30d,
      round(avg(chill_hours_season), 3) as avg_chill_hours_season,
      round(avg(precipitation_in_30d), 3) as avg_precipitation_in_30d,
      round(avg(avg_temperature_f_30d), 2) as avg_temperature_f_30d
    from event_base
    group by itemcode_key, common_key, contsize_key, reason_key
  ),
  release_base as (
    select
      lower(trim(coalesce(itemcode, ''))) as itemcode_key,
      lower(trim(coalesce(commonname, 'unknown'))) as common_key,
      lower(trim(coalesce(contsize, ''))) as contsize_key,
      coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as reason_key,
      gdd_base_50_to_release,
      hold_days
    from public.v2_hold_release_cycles
    where hold_released_on is not null
      and commonname is not null
      and hold_reason_category is not null
      and (
        gdd_base_50_to_release is not null
        or hold_days is not null
      )
  ),
  release_stats as (
    select
      itemcode_key,
      common_key,
      contsize_key,
      reason_key,
      count(*)::integer as release_sample_count,
      round(avg(gdd_base_50_to_release), 3) as avg_gdd_base_50_to_release,
      round((percentile_cont(0.5) within group (order by gdd_base_50_to_release))::numeric, 3) as median_gdd_base_50_to_release,
      round(avg(hold_days), 2) as avg_days_to_release
    from release_base
    group by itemcode_key, common_key, contsize_key, reason_key
  )
  select
    'hold_profile_' || encode(digest(concat_ws('|',
      e.itemcode_key,
      e.common_key,
      e.contsize_key,
      e.reason_key
    ), 'sha256'), 'hex') as unique_id,
    nullif(e.itemcode_key, '') as itemcode,
    e.commonname_display as commonname,
    e.genus_display as genus,
    e.contsize_display as contsize,
    e.reason_key as hold_reason_category,
    e.sample_count,
    e.first_hold_on,
    e.last_hold_on,
    e.avg_gdd_base_50_7d,
    e.avg_gdd_base_50_14d,
    e.avg_gdd_base_50_30d,
    e.avg_gdd_base_50_season,
    e.median_gdd_base_50_30d,
    e.avg_chill_hours_30d,
    e.avg_chill_hours_season,
    e.avg_precipitation_in_30d,
    e.avg_temperature_f_30d,
    coalesce(r.release_sample_count, 0) as release_sample_count,
    r.avg_gdd_base_50_to_release,
    r.median_gdd_base_50_to_release,
    r.avg_days_to_release,
    now()
  from event_stats e
  left join release_stats r
    on r.itemcode_key = e.itemcode_key
   and r.common_key = e.common_key
   and r.contsize_key = e.contsize_key
   and r.reason_key = e.reason_key
  on conflict (unique_id) do update set
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    genus = excluded.genus,
    contsize = excluded.contsize,
    hold_reason_category = excluded.hold_reason_category,
    sample_count = excluded.sample_count,
    first_hold_on = excluded.first_hold_on,
    last_hold_on = excluded.last_hold_on,
    avg_gdd_base_50_7d = excluded.avg_gdd_base_50_7d,
    avg_gdd_base_50_14d = excluded.avg_gdd_base_50_14d,
    avg_gdd_base_50_30d = excluded.avg_gdd_base_50_30d,
    avg_gdd_base_50_season = excluded.avg_gdd_base_50_season,
    median_gdd_base_50_30d = excluded.median_gdd_base_50_30d,
    avg_chill_hours_30d = excluded.avg_chill_hours_30d,
    avg_chill_hours_season = excluded.avg_chill_hours_season,
    avg_precipitation_in_30d = excluded.avg_precipitation_in_30d,
    avg_temperature_f_30d = excluded.avg_temperature_f_30d,
    release_sample_count = excluded.release_sample_count,
    avg_gdd_base_50_to_release = excluded.avg_gdd_base_50_to_release,
    median_gdd_base_50_to_release = excluded.median_gdd_base_50_to_release,
    avg_days_to_release = excluded.avg_days_to_release,
    updated_at = now();

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows_range(
  p_start_date date,
  p_end_date date,
  p_limit integer default 15000
)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  event_count integer := 0;
  cycle_count integer := 0;
  safe_start date := coalesce(p_start_date, current_date - 180);
  safe_end date := coalesce(p_end_date, current_date);
  safe_limit integer := greatest(1, least(coalesce(p_limit, 15000), 50000));
begin
  if to_regclass('public.v2_drive_around_report_rows') is null then
    raise exception 'public.v2_drive_around_report_rows does not exist. Run drive_around_report_rows_migration.sql and import Drive Around history first.';
  end if;

  if safe_start > safe_end then
    raise exception 'Start date % must be on or before end date %.', safe_start, safe_end;
  end if;

  create temp table tmp_v2_drive_around_hold_starts on commit drop as
  with hold_candidates as (
    select r.*
    from public.v2_drive_around_report_rows r
    where r.report_date >= safe_start
      and r.report_date <= safe_end
      and nullif(trim(coalesce(r.item_key, '')), '') is not null
      and upper(trim(coalesce(r.holdstopcode, ''))) = 'H'
    order by r.report_date desc, r.file_name desc, r.row_number desc
    limit safe_limit
  )
  select h.*
  from hold_candidates h
  left join lateral (
    select p.holdstopcode
    from public.v2_drive_around_report_rows p
    where p.item_key = h.item_key
      and (
        p.report_date < h.report_date
        or (
          p.report_date = h.report_date
          and (
            p.file_name < h.file_name
            or (p.file_name = h.file_name and p.row_number < h.row_number)
          )
        )
      )
    order by p.report_date desc, p.file_name desc, p.row_number desc
    limit 1
  ) previous_row on true
  where coalesce(upper(trim(previous_row.holdstopcode)), '') <> 'H';

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
      and upper(trim(coalesce(r.holdstopcode, ''))) <> 'H'
      and (
        r.report_date > s.report_date
        or (
          r.report_date = s.report_date
          and (
            r.file_name > s.file_name
            or (r.file_name = s.file_name and r.row_number > s.row_number)
          )
        )
      )
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
      coalesce(c.unique_id, ''),
      coalesce(c.release_unique_id, ''),
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

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows(p_limit integer default 15000)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select *
  from public.v2_refresh_hold_learning_from_drive_around_rows_range(
    (current_date - interval '180 days')::date,
    current_date,
    least(coalesce(p_limit, 15000), 15000)
  );
end;
$$;

grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) to anon, authenticated, service_role;
grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows_range(date, date, integer) to anon, authenticated, service_role;

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

-- Dashboard-safe starter refresh. This processes recent history only.
-- For older history, run the date-range examples below one at a time.
select *
from public.v2_refresh_hold_learning_from_drive_around_rows(15000);

-- Optional historical backfill examples. Run one line at a time if you need
-- to fill older years through the Supabase SQL Editor timeout window.
--
-- select * from public.v2_refresh_hold_learning_from_drive_around_rows_range('2026-01-01', '2026-05-18', 15000);
-- select * from public.v2_refresh_hold_learning_from_drive_around_rows_range('2025-07-01', '2025-12-31', 15000);
-- select * from public.v2_refresh_hold_learning_from_drive_around_rows_range('2025-01-01', '2025-06-30', 15000);
-- select * from public.v2_refresh_hold_learning_from_drive_around_rows_range('2024-07-01', '2024-12-31', 15000);
-- select * from public.v2_refresh_hold_learning_from_drive_around_rows_range('2024-01-01', '2024-06-30', 15000);
