-- Keep the scheduled weather/hold learning refresh inside the hosted RPC
-- statement budget. Both refreshes preserve their existing signatures and
-- service-role-only access.

create or replace function public.v2_refresh_hold_learning_weather_features(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  refreshed integer := 0;
begin
  with selected_events as materialized (
    select
      e.unique_id,
      e.weather_station_key,
      e.hold_started_on,
      ((e.hold_started_on + 1)::timestamp at time zone 'America/Chicago') as event_end,
      (make_date(extract(year from e.hold_started_on)::int, 1, 1)::timestamp at time zone 'America/Chicago') as season_start
    from public.ph_hold_learning_events e
    where e.hold_started_on is not null
    order by coalesce(e.weather_features_refreshed_at, '1900-01-01'::timestamptz), e.hold_started_on desc
    limit greatest(1, coalesce(p_limit, 1000))
  ),
  distinct_windows as materialized (
    select distinct weather_station_key, event_end, season_start
    from selected_events
  ),
  weather_rollups as materialized (
    select
      w.weather_station_key,
      w.event_end,
      w.season_start,
      coalesce(sum(h.gdd_base_50) filter (where h.observed_at >= w.event_end - interval '7 days'), 0) as gdd_7,
      coalesce(sum(h.gdd_base_50) filter (where h.observed_at >= w.event_end - interval '14 days'), 0) as gdd_14,
      coalesce(sum(h.gdd_base_50) filter (where h.observed_at >= w.event_end - interval '30 days'), 0) as gdd_30,
      coalesce(sum(h.gdd_base_50), 0) as gdd_season,
      coalesce(sum(h.chill_hours) filter (where h.observed_at >= w.event_end - interval '7 days'), 0) as chill_7,
      coalesce(sum(h.chill_hours) filter (where h.observed_at >= w.event_end - interval '14 days'), 0) as chill_14,
      coalesce(sum(h.chill_hours) filter (where h.observed_at >= w.event_end - interval '30 days'), 0) as chill_30,
      coalesce(sum(h.chill_hours), 0) as chill_season,
      coalesce(sum(h.precipitation_in) filter (where h.observed_at >= w.event_end - interval '7 days'), 0) as precip_7,
      coalesce(sum(h.precipitation_in) filter (where h.observed_at >= w.event_end - interval '14 days'), 0) as precip_14,
      coalesce(sum(h.precipitation_in) filter (where h.observed_at >= w.event_end - interval '30 days'), 0) as precip_30,
      avg(h.temperature_f) filter (where h.observed_at >= w.event_end - interval '7 days') as avg_temp_7,
      avg(h.temperature_f) filter (where h.observed_at >= w.event_end - interval '14 days') as avg_temp_14,
      avg(h.temperature_f) filter (where h.observed_at >= w.event_end - interval '30 days') as avg_temp_30
    from distinct_windows w
    left join public.ph_weather_hourly h
      on h.station_key = w.weather_station_key
     and h.observed_at >= w.season_start
     and h.observed_at < w.event_end
    group by w.weather_station_key, w.event_end, w.season_start
  ),
  updated as (
    update public.ph_hold_learning_events e
    set
      gdd_base_50_7d = round(r.gdd_7, 3),
      gdd_base_50_14d = round(r.gdd_14, 3),
      gdd_base_50_30d = round(r.gdd_30, 3),
      gdd_base_50_season = round(r.gdd_season, 3),
      chill_hours_7d = round(r.chill_7, 3),
      chill_hours_14d = round(r.chill_14, 3),
      chill_hours_30d = round(r.chill_30, 3),
      chill_hours_season = round(r.chill_season, 3),
      precipitation_in_7d = round(r.precip_7, 3),
      precipitation_in_14d = round(r.precip_14, 3),
      precipitation_in_30d = round(r.precip_30, 3),
      avg_temperature_f_7d = round(r.avg_temp_7, 2),
      avg_temperature_f_14d = round(r.avg_temp_14, 2),
      avg_temperature_f_30d = round(r.avg_temp_30, 2),
      weather_features_refreshed_at = now(),
      updated_at = now()
    from selected_events s
    join weather_rollups r
      on r.weather_station_key is not distinct from s.weather_station_key
     and r.event_end = s.event_end
     and r.season_start = s.season_start
    where e.unique_id = s.unique_id
    returning 1
  )
  select count(*)::integer into refreshed from updated;

  return refreshed;
end;
$function$;

create or replace function public.v2_refresh_hold_learning_profiles()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  refreshed integer := 0;
begin
  drop table if exists pg_temp.hold_learning_profile_refresh_stage;

  create temporary table hold_learning_profile_refresh_stage
  on commit drop
  as
  with event_base as materialized (
    select
      lower(trim(coalesce(e.itemcode, ''))) as itemcode_key,
      lower(trim(coalesce(e.commonname, 'unknown'))) as common_key,
      lower(trim(coalesce(e.contsize, ''))) as contsize_key,
      coalesce(nullif(trim(e.hold_reason_category), ''), 'unknown') as reason_key,
      coalesce(nullif(trim(e.commonname), ''), 'Unknown') as commonname_display,
      nullif(trim(e.genus), '') as genus_display,
      nullif(trim(e.contsize), '') as contsize_display,
      e.hold_started_on,
      e.gdd_base_50_7d,
      e.gdd_base_50_14d,
      e.gdd_base_50_30d,
      e.gdd_base_50_season,
      e.chill_hours_30d,
      e.chill_hours_season,
      e.precipitation_in_30d,
      e.avg_temperature_f_30d
    from public.ph_hold_learning_events e
    where e.commonname is not null
      and e.hold_reason_category is not null
      and e.weather_features_refreshed_at is not null
  ),
  release_base as materialized (
    select
      lower(trim(coalesce(c.itemcode, ''))) as itemcode_key,
      lower(trim(coalesce(c.commonname, 'unknown'))) as common_key,
      lower(trim(coalesce(c.contsize, ''))) as contsize_key,
      coalesce(nullif(trim(c.hold_reason_category), ''), 'unknown') as reason_key,
      c.gdd_base_50_to_release,
      c.hold_days
    from public.ph_hold_release_cycles c
    where c.hold_released_on is not null
      and c.commonname is not null
      and c.hold_reason_category is not null
      and (c.gdd_base_50_to_release is not null or c.hold_days is not null)
  ),
  item_event_stats as (
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
    where itemcode_key <> ''
    group by itemcode_key, common_key, contsize_key, reason_key
  ),
  common_event_stats as (
    select
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
    group by common_key, contsize_key, reason_key
  ),
  item_release_stats as (
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
    where itemcode_key <> ''
    group by itemcode_key, common_key, contsize_key, reason_key
  ),
  common_release_stats as (
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
    'hold_profile_item_' || encode(digest(concat_ws('|', e.itemcode_key, e.common_key, e.contsize_key, e.reason_key), 'sha256'), 'hex') as unique_id,
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
    now() as updated_at
  from item_event_stats e
  left join item_release_stats r
    on r.itemcode_key = e.itemcode_key
   and r.common_key = e.common_key
   and r.contsize_key = e.contsize_key
   and r.reason_key = e.reason_key
  union all
  select
    'hold_profile_' || encode(digest(concat_ws('|', e.common_key, e.contsize_key, e.reason_key), 'sha256'), 'hex') as unique_id,
    null::text as itemcode,
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
    now() as updated_at
  from common_event_stats e
  left join common_release_stats r
    on r.common_key = e.common_key
   and r.contsize_key = e.contsize_key
   and r.reason_key = e.reason_key;

  insert into public.ph_hold_learning_profiles (
    unique_id, itemcode, commonname, genus, contsize, hold_reason_category,
    sample_count, first_hold_on, last_hold_on,
    avg_gdd_base_50_7d, avg_gdd_base_50_14d, avg_gdd_base_50_30d, avg_gdd_base_50_season,
    median_gdd_base_50_30d, avg_chill_hours_30d, avg_chill_hours_season,
    avg_precipitation_in_30d, avg_temperature_f_30d, release_sample_count,
    avg_gdd_base_50_to_release, median_gdd_base_50_to_release, avg_days_to_release, updated_at
  )
  select *
  from pg_temp.hold_learning_profile_refresh_stage
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
    updated_at = now()
  where (
    ph_hold_learning_profiles.itemcode,
    ph_hold_learning_profiles.commonname,
    ph_hold_learning_profiles.genus,
    ph_hold_learning_profiles.contsize,
    ph_hold_learning_profiles.hold_reason_category,
    ph_hold_learning_profiles.sample_count,
    ph_hold_learning_profiles.first_hold_on,
    ph_hold_learning_profiles.last_hold_on,
    ph_hold_learning_profiles.avg_gdd_base_50_7d,
    ph_hold_learning_profiles.avg_gdd_base_50_14d,
    ph_hold_learning_profiles.avg_gdd_base_50_30d,
    ph_hold_learning_profiles.avg_gdd_base_50_season,
    ph_hold_learning_profiles.median_gdd_base_50_30d,
    ph_hold_learning_profiles.avg_chill_hours_30d,
    ph_hold_learning_profiles.avg_chill_hours_season,
    ph_hold_learning_profiles.avg_precipitation_in_30d,
    ph_hold_learning_profiles.avg_temperature_f_30d,
    ph_hold_learning_profiles.release_sample_count,
    ph_hold_learning_profiles.avg_gdd_base_50_to_release,
    ph_hold_learning_profiles.median_gdd_base_50_to_release,
    ph_hold_learning_profiles.avg_days_to_release
  ) is distinct from (
    excluded.itemcode,
    excluded.commonname,
    excluded.genus,
    excluded.contsize,
    excluded.hold_reason_category,
    excluded.sample_count,
    excluded.first_hold_on,
    excluded.last_hold_on,
    excluded.avg_gdd_base_50_7d,
    excluded.avg_gdd_base_50_14d,
    excluded.avg_gdd_base_50_30d,
    excluded.avg_gdd_base_50_season,
    excluded.median_gdd_base_50_30d,
    excluded.avg_chill_hours_30d,
    excluded.avg_chill_hours_season,
    excluded.avg_precipitation_in_30d,
    excluded.avg_temperature_f_30d,
    excluded.release_sample_count,
    excluded.avg_gdd_base_50_to_release,
    excluded.median_gdd_base_50_to_release,
    excluded.avg_days_to_release
  );

  delete from public.ph_hold_learning_profiles p
  where not exists (
    select 1
    from pg_temp.hold_learning_profile_refresh_stage s
    where s.unique_id = p.unique_id
  );

  select count(*)::integer into refreshed
  from pg_temp.hold_learning_profile_refresh_stage;

  return refreshed;
end;
$function$;

revoke all on function public.v2_refresh_hold_learning_weather_features(integer) from public, anon, authenticated;
revoke all on function public.v2_refresh_hold_learning_profiles() from public, anon, authenticated;
grant execute on function public.v2_refresh_hold_learning_weather_features(integer) to service_role;
grant execute on function public.v2_refresh_hold_learning_profiles() to service_role;

comment on function public.v2_refresh_hold_learning_weather_features(integer) is
  'Set-based weather rollup refresh that computes each station/date window once per batch.';
comment on function public.v2_refresh_hold_learning_profiles() is
  'Set-based profile refresh that stages normalized aggregates and writes only changed rows.';
