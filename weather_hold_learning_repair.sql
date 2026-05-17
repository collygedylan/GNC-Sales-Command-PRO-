-- Repair Weather / Hold Risk learning functions.
-- Run this once in Supabase SQL Editor if the GitHub weather workflow fails with:
--   function digest(text, unknown) does not exist

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regprocedure('public.v2_capture_hold_learning_event()') is not null then
    execute 'alter function public.v2_capture_hold_learning_event() set search_path = public, extensions';
  end if;

  if to_regprocedure('public.v2_refresh_hold_learning_weather_features(integer)') is not null then
    execute 'alter function public.v2_refresh_hold_learning_weather_features(integer) set search_path = public, extensions';
  end if;

  if to_regprocedure('public.v2_refresh_hold_learning_profiles()') is not null then
    execute 'alter function public.v2_refresh_hold_learning_profiles() set search_path = public, extensions';
  end if;
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
  alter table public.v2_hold_learning_profiles
    add column if not exists release_sample_count integer not null default 0,
    add column if not exists avg_gdd_base_50_to_release numeric,
    add column if not exists median_gdd_base_50_to_release numeric,
    add column if not exists avg_days_to_release numeric;

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
    release_sample_count,
    avg_gdd_base_50_to_release,
    median_gdd_base_50_to_release,
    avg_days_to_release,
    updated_at
  )
  with event_base as (
    select
      lower(trim(coalesce(commonname, 'unknown'))) as common_key,
      coalesce(nullif(trim(commonname), ''), 'Unknown') as commonname_display,
      nullif(trim(genus), '') as genus_display,
      nullif(trim(contsize), '') as contsize_key,
      coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as reason_key,
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
      and weather_features_refreshed_at is not null
  ),
  event_stats as (
    select
      'hold_profile_' || encode(digest(concat_ws('|',
        common_key,
        lower(coalesce(contsize_key, '')),
        lower(reason_key)
      ), 'sha256'), 'hex') as unique_id,
      min(commonname_display) as commonname,
      max(genus_display) as genus,
      contsize_key as contsize,
      reason_key as hold_reason_category,
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
      common_key
    from event_base
    group by common_key, contsize_key, reason_key
  ),
  release_base as (
    select
      lower(trim(coalesce(commonname, 'unknown'))) as common_key,
      nullif(trim(contsize), '') as contsize_key,
      coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as reason_key,
      gdd_base_50_to_release,
      hold_days
    from public.v2_hold_release_cycles
    where hold_released_on is not null
  ),
  release_stats as (
    select
      common_key,
      contsize_key,
      reason_key,
      count(*)::integer as release_sample_count,
      round(avg(gdd_base_50_to_release), 3) as avg_gdd_base_50_to_release,
      round((percentile_cont(0.5) within group (order by gdd_base_50_to_release))::numeric, 3) as median_gdd_base_50_to_release,
      round(avg(hold_days), 2) as avg_days_to_release
    from release_base
    group by common_key, contsize_key, reason_key
  )
  select
    event_stats.unique_id,
    event_stats.commonname,
    event_stats.genus,
    event_stats.contsize,
    event_stats.hold_reason_category,
    event_stats.sample_count,
    event_stats.first_hold_on,
    event_stats.last_hold_on,
    event_stats.avg_gdd_base_50_7d,
    event_stats.avg_gdd_base_50_14d,
    event_stats.avg_gdd_base_50_30d,
    event_stats.avg_gdd_base_50_season,
    event_stats.median_gdd_base_50_30d,
    event_stats.avg_chill_hours_30d,
    event_stats.avg_chill_hours_season,
    event_stats.avg_precipitation_in_30d,
    event_stats.avg_temperature_f_30d,
    coalesce(release_stats.release_sample_count, 0),
    release_stats.avg_gdd_base_50_to_release,
    release_stats.median_gdd_base_50_to_release,
    release_stats.avg_days_to_release,
    now()
  from event_stats
  left join release_stats
    on release_stats.common_key = event_stats.common_key
   and release_stats.contsize_key is not distinct from event_stats.contsize
   and release_stats.reason_key = event_stats.hold_reason_category
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
    release_sample_count = excluded.release_sample_count,
    avg_gdd_base_50_to_release = excluded.avg_gdd_base_50_to_release,
    median_gdd_base_50_to_release = excluded.median_gdd_base_50_to_release,
    avg_days_to_release = excluded.avg_days_to_release,
    updated_at = now();

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;

select public.v2_refresh_hold_learning_profiles() as refreshed_hold_learning_profiles;
