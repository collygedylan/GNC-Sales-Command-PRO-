-- Weather & Hold Risk recovery learning repair.
-- Safe to run more than once after the base Weather/Hold and Drive Around scripts.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.v2_hold_learning_profiles
  add column if not exists itemcode text,
  add column if not exists release_sample_count integer not null default 0,
  add column if not exists avg_gdd_base_50_to_release numeric,
  add column if not exists median_gdd_base_50_to_release numeric,
  add column if not exists avg_days_to_release numeric;

create index if not exists idx_v2_hold_learning_profiles_item_reason
  on public.v2_hold_learning_profiles (itemcode, hold_reason_category);

create index if not exists idx_v2_hold_learning_profiles_item_size_reason
  on public.v2_hold_learning_profiles (itemcode, contsize, hold_reason_category);

update public.v2_weather_daily
set daily_gdd_base_50 = round(
  greatest(((coalesce(temperature_high_f, 0) + coalesce(temperature_low_f, 0)) / 2.0) - 50.0, 0),
  5
)
where temperature_high_f is not null
  and temperature_low_f is not null;

create or replace function public.v2_classify_hold_reason(p_reason text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_reason, '')) ~ '(aphid|mite|scale|thrip|snail|caterpillar|insect|bug|pest|borer|beetle)' then 'pest'
    when lower(coalesce(p_reason, '')) ~ '(fung|disease|leaf spot|phytophthora|rhizoctonia|botrytis|canker|mildew|rot|rust|anthracnose|blight|phomopsis|sclerotinia)' then 'fungal_disease'
    when lower(coalesce(p_reason, '')) ~ '(size|sizing|spec|height|too small|too short|too tall|caliper|under[ -]?size|undersized|not ready|not saleable|not ready to ship)' then 'size'
    when lower(coalesce(p_reason, '')) ~ '(leaf quality|leaf|foliar|chlorosis|yellow|necrosis|spotting|burn)' then 'leaf_quality'
    when lower(coalesce(p_reason, '')) ~ '(shear|sheared|trim|cutback|cut back|prune|pruned)' then 'sheared'
    when lower(coalesce(p_reason, '')) ~ '(freeze|frost|cold|heat|hail|weather|wind|drought|wet)' then 'weather_stress'
    when trim(coalesce(p_reason, '')) = '' then 'unknown'
    else 'other'
  end;
$$;

update public.v2_hold_learning_events
set
  hold_reason_category = public.v2_classify_hold_reason(holdstopreason),
  updated_at = now()
where nullif(trim(coalesce(holdstopreason, '')), '') is not null;

update public.v2_hold_release_cycles
set
  hold_reason_category = public.v2_classify_hold_reason(holdstopreason),
  updated_at = now()
where nullif(trim(coalesce(holdstopreason, '')), '') is not null;

update public.v2_drive_around_report_rows
set hold_reason_category = public.v2_classify_hold_reason(holdstopreason)
where nullif(trim(coalesce(holdstopreason, '')), '') is not null;

create or replace function public.v2_drive_around_report_rows_classify_hold_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(trim(coalesce(new.holdstopreason, '')), '') is not null then
    new.hold_reason_category := public.v2_classify_hold_reason(new.holdstopreason);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_v2_drive_around_report_rows_classify_hold_reason
  on public.v2_drive_around_report_rows;

create trigger trg_v2_drive_around_report_rows_classify_hold_reason
before insert or update of holdstopreason, hold_reason_category
on public.v2_drive_around_report_rows
for each row
execute function public.v2_drive_around_report_rows_classify_hold_reason();

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
    add column if not exists itemcode text,
    add column if not exists release_sample_count integer not null default 0,
    add column if not exists avg_gdd_base_50_to_release numeric,
    add column if not exists median_gdd_base_50_to_release numeric,
    add column if not exists avg_days_to_release numeric;

  with event_base as (
    select
      lower(trim(coalesce(itemcode, ''))) as itemcode_key,
      lower(trim(coalesce(commonname, 'unknown'))) as common_key,
      lower(trim(coalesce(contsize, ''))) as contsize_key,
      coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as reason_key,
      coalesce(nullif(trim(commonname), ''), 'Unknown') as commonname_display,
      nullif(trim(genus), '') as genus_display,
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
      and weather_features_refreshed_at is not null
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
      and (gdd_base_50_to_release is not null or hold_days is not null)
  ),
  item_events as (
    select
      itemcode_key,
      common_key,
      contsize_key,
      reason_key,
      max(commonname_display) as commonname,
      max(genus_display) as genus,
      max(contsize_display) as contsize,
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
  item_releases as (
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
  common_events as (
    select
      common_key,
      contsize_key,
      reason_key,
      max(commonname_display) as commonname,
      max(genus_display) as genus,
      max(contsize_display) as contsize,
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
  common_releases as (
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
  ),
  profile_rows as (
    select
      'hold_profile_item_' || encode(digest(concat_ws('|', e.itemcode_key, e.common_key, e.contsize_key, e.reason_key), 'sha256'), 'hex') as unique_id,
      e.itemcode_key as itemcode,
      e.commonname,
      e.genus,
      e.contsize,
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
      r.avg_days_to_release
    from item_events e
    left join item_releases r
      on r.itemcode_key = e.itemcode_key
     and r.common_key = e.common_key
     and r.contsize_key = e.contsize_key
     and r.reason_key = e.reason_key
    union all
    select
      'hold_profile_' || encode(digest(concat_ws('|', e.common_key, e.contsize_key, e.reason_key), 'sha256'), 'hex') as unique_id,
      null::text as itemcode,
      e.commonname,
      e.genus,
      e.contsize,
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
      r.avg_days_to_release
    from common_events e
    left join common_releases r
      on r.common_key = e.common_key
     and r.contsize_key = e.contsize_key
     and r.reason_key = e.reason_key
  ),
  upserted as (
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
    select
      unique_id,
      nullif(itemcode, '') as itemcode,
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
      now()
    from profile_rows
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
    returning 1
  )
  select count(*)::integer into refreshed from upserted;

  return refreshed;
end;
$$;

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows(p_limit integer default 100000)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  safe_start date;
  safe_end date;
begin
  select min(report_date), max(report_date)
  into safe_start, safe_end
  from public.v2_drive_around_report_rows
  where report_date is not null;

  return query
  select *
  from public.v2_refresh_hold_learning_from_drive_around_rows_range(
    safe_start,
    safe_end,
    greatest(1, least(coalesce(p_limit, 100000), 500000))
  );
end;
$$;

grant execute on function public.v2_refresh_hold_learning_profiles() to anon, authenticated, service_role;
grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) to anon, authenticated, service_role;

select *
from public.v2_refresh_hold_learning_from_drive_around_rows(100000);
