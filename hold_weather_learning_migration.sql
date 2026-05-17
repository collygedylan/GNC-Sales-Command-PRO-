-- Hold-stop learning and Park Hill weather feature tables.
-- Run once in the Supabase SQL Editor.
--
-- This adds:
--   1. Hourly Park Hill, OK weather observations from the GitHub weather sync.
--   2. Hold learning events whenever v2_master_inventory receives H in holdstopcode.
--   3. Growing degree day base 50 and chill-hour rollups for each hold event.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.v2_weather_hourly (
  unique_id text primary key,
  station_key text not null default 'park_hill_ok',
  latitude numeric,
  longitude numeric,
  timezone text not null default 'America/Chicago',
  observed_at timestamptz not null,
  local_time text,
  temperature_f numeric,
  relative_humidity numeric,
  precipitation_in numeric,
  wind_speed_mph numeric,
  gdd_base_50 numeric not null default 0,
  chill_hours numeric not null default 0,
  source text not null default 'open-meteo',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_weather_hourly_station_observed_unique unique (station_key, observed_at)
);

create index if not exists idx_v2_weather_hourly_station_time
  on public.v2_weather_hourly (station_key, observed_at desc);

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
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_hold_learning_events_hold_started
  on public.v2_hold_learning_events (hold_started_on desc);

create index if not exists idx_v2_hold_learning_events_item
  on public.v2_hold_learning_events (itemcode, commonname, contsize);

create index if not exists idx_v2_hold_learning_events_reason
  on public.v2_hold_learning_events (hold_reason_category, hold_started_on desc);

create index if not exists idx_v2_hold_learning_events_source
  on public.v2_hold_learning_events (source_table, source_unique_id);

create index if not exists idx_v2_hold_learning_profiles_lookup
  on public.v2_hold_learning_profiles (hold_reason_category, commonname, contsize);

create or replace function public.v2_touch_hold_weather_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_weather_hourly_updated_at on public.v2_weather_hourly;
create trigger trg_v2_weather_hourly_updated_at
before update on public.v2_weather_hourly
for each row
execute function public.v2_touch_hold_weather_updated_at();

drop trigger if exists trg_v2_hold_learning_events_updated_at on public.v2_hold_learning_events;
create trigger trg_v2_hold_learning_events_updated_at
before update on public.v2_hold_learning_events
for each row
execute function public.v2_touch_hold_weather_updated_at();

drop trigger if exists trg_v2_hold_learning_profiles_updated_at on public.v2_hold_learning_profiles;
create trigger trg_v2_hold_learning_profiles_updated_at
before update on public.v2_hold_learning_profiles
for each row
execute function public.v2_touch_hold_weather_updated_at();

create or replace function public.v2_parse_hold_file_date(p_value text)
returns date
language plpgsql
immutable
as $$
declare
  v text := coalesce(p_value, '');
  m text[];
begin
  m := regexp_match(v, '(20[0-9]{2})[-_\. ]?([01]?[0-9])[-_\. ]?([0-3]?[0-9])');
  if m is not null then
    begin
      return make_date(m[1]::int, m[2]::int, m[3]::int);
    exception when others then
      return null;
    end;
  end if;

  m := regexp_match(v, '([01]?[0-9])[-_\. ]([0-3]?[0-9])[-_\. ](20[0-9]{2})');
  if m is not null then
    begin
      return make_date(m[3]::int, m[1]::int, m[2]::int);
    exception when others then
      return null;
    end;
  end if;

  return null;
end;
$$;

create or replace function public.v2_get_hold_event_date(
  p_holdstopbegindate text,
  p_filename text,
  p_fallback timestamptz default now()
)
returns date
language plpgsql
stable
as $$
declare
  v text := trim(coalesce(p_holdstopbegindate, ''));
  parsed_date date;
begin
  if v <> '' then
    begin
      if v ~ '^[0-9]+(\.[0-9]+)?$' then
        return date '1899-12-30' + floor(v::numeric)::int;
      end if;
      if v ~ '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}' then
        return replace(left(v, 10), '/', '-')::date;
      end if;
      if v ~ '^[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{4}' then
        return to_date(replace(left(v, 10), '-', '/'), 'MM/DD/YYYY');
      end if;
    exception when others then
      null;
    end;
  end if;

  parsed_date := public.v2_parse_hold_file_date(p_filename);
  if parsed_date is not null then
    return parsed_date;
  end if;

  return coalesce(p_fallback, now())::date;
end;
$$;

create or replace function public.v2_classify_hold_reason(p_reason text)
returns text
language sql
immutable
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

create or replace function public.v2_capture_hold_learning_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  event_date date;
  event_id text;
  reason text;
begin
  if upper(trim(coalesce(new.holdstopcode::text, ''))) <> 'H' then
    return new;
  end if;

  event_date := public.v2_get_hold_event_date(new.holdstopbegindate::text, new.filename::text, now());
  reason := nullif(trim(coalesce(new.holdstopreason::text, '')), '');
  event_id := 'hold_' || encode(digest(concat_ws('|',
    'v2_master_inventory',
    coalesce(new.unique_id::text, ''),
    coalesce(event_date::text, ''),
    lower(coalesce(reason, ''))
  ), 'sha256'), 'hex');

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
    weather_station_key
  )
  values (
    event_id,
    'v2_master_inventory',
    new.unique_id::text,
    new.filename::text,
    event_date,
    now(),
    new.itemcode::text,
    new.commonname::text,
    new.genusname::text,
    new.contsize::text,
    new.locationcode::text,
    new.lotcode::text,
    new.season::text,
    new.blockalpha::text,
    new.saleyear::text,
    new.holdstopcode::text,
    reason,
    new.holdstopbegindate::text,
    public.v2_classify_hold_reason(reason),
    'park_hill_ok'
  )
  on conflict (unique_id) do update set
    import_file_name = excluded.import_file_name,
    hold_detected_at = now(),
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
    updated_at = now();

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.v2_master_inventory') is not null then
    drop trigger if exists trg_v2_capture_hold_learning_event on public.v2_master_inventory;
    create trigger trg_v2_capture_hold_learning_event
    after insert or update of holdstopcode, holdstopreason, holdstopbegindate, filename
    on public.v2_master_inventory
    for each row
    execute function public.v2_capture_hold_learning_event();
  end if;
end;
$$;

create or replace function public.v2_refresh_hold_learning_weather_features(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ev record;
  refreshed integer := 0;
  event_end timestamptz;
  season_start timestamptz;
  gdd_7 numeric;
  gdd_14 numeric;
  gdd_30 numeric;
  gdd_season numeric;
  chill_7 numeric;
  chill_14 numeric;
  chill_30 numeric;
  chill_season numeric;
  precip_7 numeric;
  precip_14 numeric;
  precip_30 numeric;
  avg_temp_7 numeric;
  avg_temp_14 numeric;
  avg_temp_30 numeric;
begin
  for ev in
    select *
    from public.v2_hold_learning_events
    where hold_started_on is not null
    order by coalesce(weather_features_refreshed_at, '1900-01-01'::timestamptz), hold_started_on desc
    limit greatest(1, coalesce(p_limit, 1000))
  loop
    event_end := ((ev.hold_started_on + 1)::timestamp at time zone 'America/Chicago');
    season_start := (make_date(extract(year from ev.hold_started_on)::int, 1, 1)::timestamp at time zone 'America/Chicago');

    select
      coalesce(sum(gdd_base_50) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end), 0),
      coalesce(sum(gdd_base_50) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end), 0),
      coalesce(sum(gdd_base_50) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end), 0),
      coalesce(sum(gdd_base_50) filter (where observed_at >= season_start and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= season_start and observed_at < event_end), 0),
      coalesce(sum(precipitation_in) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end), 0),
      coalesce(sum(precipitation_in) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end), 0),
      coalesce(sum(precipitation_in) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end), 0),
      avg(temperature_f) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end),
      avg(temperature_f) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end),
      avg(temperature_f) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end)
    into
      gdd_7, gdd_14, gdd_30, gdd_season,
      chill_7, chill_14, chill_30, chill_season,
      precip_7, precip_14, precip_30,
      avg_temp_7, avg_temp_14, avg_temp_30
    from public.v2_weather_hourly
    where station_key = ev.weather_station_key
      and observed_at >= season_start
      and observed_at < event_end;

    update public.v2_hold_learning_events
    set
      gdd_base_50_7d = round(gdd_7, 3),
      gdd_base_50_14d = round(gdd_14, 3),
      gdd_base_50_30d = round(gdd_30, 3),
      gdd_base_50_season = round(gdd_season, 3),
      chill_hours_7d = round(chill_7, 3),
      chill_hours_14d = round(chill_14, 3),
      chill_hours_30d = round(chill_30, 3),
      chill_hours_season = round(chill_season, 3),
      precipitation_in_7d = round(precip_7, 3),
      precipitation_in_14d = round(precip_14, 3),
      precipitation_in_30d = round(precip_30, 3),
      avg_temperature_f_7d = round(avg_temp_7, 2),
      avg_temperature_f_14d = round(avg_temp_14, 2),
      avg_temperature_f_30d = round(avg_temp_30, 2),
      weather_features_refreshed_at = now(),
      updated_at = now()
    where unique_id = ev.unique_id;

    refreshed := refreshed + 1;
  end loop;

  return refreshed;
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
    updated_at
  )
  select
    'hold_profile_' || encode(digest(concat_ws('|',
      lower(trim(coalesce(commonname, 'unknown'))),
      lower(trim(coalesce(contsize, ''))),
      lower(trim(coalesce(hold_reason_category, 'unknown')))
    ), 'sha256'), 'hex') as unique_id,
    coalesce(nullif(trim(commonname), ''), 'Unknown') as commonname,
    nullif(trim(max(genus)), '') as genus,
    nullif(trim(contsize), '') as contsize,
    coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as hold_reason_category,
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
    round(avg(avg_temperature_f_30d), 2) as avg_temperature_f_30d,
    now()
  from public.v2_hold_learning_events
  where commonname is not null
    and hold_reason_category is not null
    and weather_features_refreshed_at is not null
  group by
    lower(trim(coalesce(commonname, 'unknown'))),
    coalesce(nullif(trim(commonname), ''), 'Unknown'),
    nullif(trim(contsize), ''),
    coalesce(nullif(trim(hold_reason_category), ''), 'unknown')
  on conflict (unique_id) do update set
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
    updated_at = now();

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;

do $$
begin
  if to_regclass('public.v2_master_inventory') is not null then
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
      weather_station_key
    )
    select
      'hold_' || encode(digest(concat_ws('|',
        'v2_master_inventory',
        coalesce(unique_id::text, ''),
        coalesce(public.v2_get_hold_event_date(holdstopbegindate::text, filename::text, now())::text, ''),
        lower(coalesce(nullif(trim(holdstopreason::text), ''), ''))
      ), 'sha256'), 'hex'),
      'v2_master_inventory',
      unique_id::text,
      filename::text,
      public.v2_get_hold_event_date(holdstopbegindate::text, filename::text, now()),
      now(),
      itemcode::text,
      commonname::text,
      genusname::text,
      contsize::text,
      locationcode::text,
      lotcode::text,
      season::text,
      blockalpha::text,
      saleyear::text,
      holdstopcode::text,
      nullif(trim(holdstopreason::text), ''),
      holdstopbegindate::text,
      public.v2_classify_hold_reason(holdstopreason::text),
      'park_hill_ok'
    from public.v2_master_inventory
    where upper(trim(coalesce(holdstopcode::text, ''))) = 'H'
    on conflict (unique_id) do nothing;
  end if;
end;
$$;

alter table public.v2_weather_hourly enable row level security;
alter table public.v2_hold_learning_events enable row level security;
alter table public.v2_hold_learning_profiles enable row level security;

drop policy if exists "Allow app read weather hourly" on public.v2_weather_hourly;
create policy "Allow app read weather hourly"
  on public.v2_weather_hourly
  for select
  using (true);

drop policy if exists "Allow service write weather hourly" on public.v2_weather_hourly;
create policy "Allow service write weather hourly"
  on public.v2_weather_hourly
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Allow app read hold learning events" on public.v2_hold_learning_events;
create policy "Allow app read hold learning events"
  on public.v2_hold_learning_events
  for select
  using (true);

drop policy if exists "Allow service write hold learning events" on public.v2_hold_learning_events;
create policy "Allow service write hold learning events"
  on public.v2_hold_learning_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Allow app read hold learning profiles" on public.v2_hold_learning_profiles;
create policy "Allow app read hold learning profiles"
  on public.v2_hold_learning_profiles
  for select
  using (true);

drop policy if exists "Allow service write hold learning profiles" on public.v2_hold_learning_profiles;
create policy "Allow service write hold learning profiles"
  on public.v2_hold_learning_profiles
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.v2_weather_hourly replica identity full;
alter table public.v2_hold_learning_events replica identity full;
alter table public.v2_hold_learning_profiles replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_weather_hourly;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

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
