create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ph_hold_stop_itemcode_summaries (
  unique_id text primary key,
  itemcode text not null,
  commonname text,
  genus text,
  contsize text,
  current_rows integer not null default 0,
  current_blocked_rows integer not null default 0,
  current_h_rows integer not null default 0,
  current_s_rows integer not null default 0,
  current_is_blocked boolean not null default false,
  current_blocked_code text,
  current_holdstopreason text,
  current_holdstopreasons text[] not null default '{}'::text[],
  current_reason_category text,
  total_cycle_count integer not null default 0,
  released_cycle_count integer not null default 0,
  open_cycle_count integer not null default 0,
  hold_sample_count integer not null default 0,
  profile_count integer not null default 0,
  first_episode_start_date date,
  last_episode_start_date date,
  last_release_date date,
  open_episode_start_date date,
  open_episode_file_name text,
  open_episode_reason text,
  primary_reason_category text,
  avg_days_to_release numeric,
  median_days_to_release numeric,
  avg_gdd_base_50_to_release numeric,
  median_gdd_base_50_to_release numeric,
  history_first_file_date date,
  history_last_file_date date,
  history_file_count integer not null default 0,
  parsed_history_first_file_date date,
  parsed_history_last_file_date date,
  parsed_history_file_count integer not null default 0,
  rows_file_count integer not null default 0,
  row_history_first_file_date date,
  row_history_last_file_date date,
  updated_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb,
  constraint ph_hold_stop_itemcode_summaries_itemcode_unique unique (itemcode),
  constraint ph_hold_stop_itemcode_summaries_current_code_check
    check (current_blocked_code is null or current_blocked_code in ('H', 'S'))
);

create index if not exists ph_hold_stop_itemcode_summaries_blocked_idx
  on public.ph_hold_stop_itemcode_summaries (current_is_blocked, current_blocked_code, last_episode_start_date desc);

create index if not exists ph_hold_stop_itemcode_summaries_cycles_idx
  on public.ph_hold_stop_itemcode_summaries (total_cycle_count desc, released_cycle_count desc);

create index if not exists ph_hold_stop_itemcode_summaries_last_release_idx
  on public.ph_hold_stop_itemcode_summaries (last_release_date desc);

alter table public.ph_hold_stop_itemcode_summaries enable row level security;

alter table public.ph_hold_stop_itemcode_summaries
  add column if not exists parsed_history_first_file_date date,
  add column if not exists parsed_history_last_file_date date,
  add column if not exists parsed_history_file_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ph_hold_stop_itemcode_summaries'
      and policyname = 'ph_hold_stop_itemcode_summaries_select'
  ) then
    create policy ph_hold_stop_itemcode_summaries_select
      on public.ph_hold_stop_itemcode_summaries
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ph_hold_stop_itemcode_summaries'
      and policyname = 'ph_hold_stop_itemcode_summaries_service_role_all'
  ) then
    create policy ph_hold_stop_itemcode_summaries_service_role_all
      on public.ph_hold_stop_itemcode_summaries
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

revoke all on table public.ph_hold_stop_itemcode_summaries from anon, authenticated;
grant select on table public.ph_hold_stop_itemcode_summaries to anon, authenticated;
grant all on table public.ph_hold_stop_itemcode_summaries to service_role;

create or replace function public.ph_refresh_hold_stop_itemcode_summaries()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  refreshed integer := 0;
begin
  truncate table public.ph_hold_stop_itemcode_summaries;

  with current_base as (
    select
      nullif(trim(itemcode), '') as itemcode,
      nullif(trim(commonname), '') as commonname,
      nullif(trim(genusname), '') as genus,
      nullif(trim(contsize), '') as contsize,
      upper(nullif(trim(coalesce(holdstopcode, '')), '')) as holdstopcode,
      nullif(trim(holdstopreason), '') as holdstopreason,
      unique_id
    from public.ph_master_inventory
    where nullif(trim(itemcode), '') is not null
  ),
  current_status as (
    select
      itemcode,
      (array_agg(commonname order by unique_id) filter (where commonname is not null))[1] as commonname,
      (array_agg(genus order by unique_id) filter (where genus is not null))[1] as genus,
      (array_agg(contsize order by unique_id) filter (where contsize is not null))[1] as contsize,
      count(*)::integer as current_rows,
      count(*) filter (where holdstopcode in ('H', 'S'))::integer as current_blocked_rows,
      count(*) filter (where holdstopcode = 'H')::integer as current_h_rows,
      count(*) filter (where holdstopcode = 'S')::integer as current_s_rows,
      (count(*) filter (where holdstopcode in ('H', 'S')) > 0) as current_is_blocked,
      case
        when count(*) filter (where holdstopcode = 'S') > 0 then 'S'
        when count(*) filter (where holdstopcode = 'H') > 0 then 'H'
        else null
      end as current_blocked_code,
      (array_agg(holdstopreason order by unique_id) filter (where holdstopcode in ('H', 'S') and holdstopreason is not null))[1] as current_holdstopreason,
      coalesce(array_agg(distinct holdstopreason) filter (where holdstopcode in ('H', 'S') and holdstopreason is not null), '{}'::text[]) as current_holdstopreasons
    from current_base
    group by itemcode
  ),
  cycle_stats as (
    select
      itemcode,
      count(*)::integer as total_cycle_count,
      count(*) filter (where episode_release_date is not null)::integer as released_cycle_count,
      count(*) filter (where episode_release_date is null)::integer as open_cycle_count,
      min(episode_start_date) as first_episode_start_date,
      max(episode_start_date) as last_episode_start_date,
      max(episode_release_date) as last_release_date,
      round(avg(days_blocked) filter (where episode_release_date is not null and days_blocked is not null), 2) as avg_days_to_release,
      round((percentile_cont(0.5) within group (order by days_blocked) filter (where episode_release_date is not null and days_blocked is not null))::numeric, 2) as median_days_to_release,
      round(avg(gdd_base_50_to_release) filter (where episode_release_date is not null and gdd_base_50_to_release is not null), 3) as avg_gdd_base_50_to_release,
      round((percentile_cont(0.5) within group (order by gdd_base_50_to_release) filter (where episode_release_date is not null and gdd_base_50_to_release is not null))::numeric, 3) as median_gdd_base_50_to_release,
      (array_agg(episode_start_date order by episode_start_date desc, episode_number desc) filter (where episode_release_date is null))[1] as open_episode_start_date,
      (array_agg(start_file_name order by episode_start_date desc, episode_number desc) filter (where episode_release_date is null))[1] as open_episode_file_name,
      (array_agg(holdstopreason order by episode_start_date desc, episode_number desc) filter (where episode_release_date is null and holdstopreason is not null))[1] as open_episode_reason,
      (array_agg(hold_reason_category order by episode_start_date desc, episode_number desc) filter (where hold_reason_category is not null))[1] as primary_reason_category
    from public.ph_hold_stop_itemcode_cycles
    where nullif(trim(itemcode), '') is not null
    group by itemcode
  ),
  profile_stats as (
    select
      itemcode,
      count(*)::integer as profile_count,
      coalesce(sum(sample_count), 0)::integer as hold_sample_count
    from public.ph_hold_learning_profiles
    where nullif(trim(itemcode), '') is not null
    group by itemcode
  ),
  snapshot_stats as (
    select
      itemcode,
      count(distinct file_id)::integer as rows_file_count,
      min(file_date) as row_history_first_file_date,
      max(file_date) as row_history_last_file_date
    from public.ph_hold_stop_itemcode_snapshots
    where nullif(trim(itemcode), '') is not null
    group by itemcode
  ),
  history_coverage as (
    select
      count(distinct file_id)::integer as history_file_count,
      min(coalesce(canonical_report_date, report_date)) as history_first_file_date,
      max(coalesce(canonical_report_date, report_date)) as history_last_file_date
    from public.ph_drive_around_report_files
    where coalesce(canonical_report_date, report_date) is not null
  ),
  row_history_coverage as (
    select
      count(distinct file_id)::integer as parsed_history_file_count,
      min(report_date) as parsed_history_first_file_date,
      max(report_date) as parsed_history_last_file_date
    from public.ph_drive_around_report_rows
    where report_date is not null
  ),
  itemcodes as (
    select itemcode from current_status
    union
    select itemcode from cycle_stats
    union
    select itemcode from profile_stats
    union
    select itemcode from snapshot_stats
  ),
  inserted as (
    insert into public.ph_hold_stop_itemcode_summaries (
      unique_id,
      itemcode,
      commonname,
      genus,
      contsize,
      current_rows,
      current_blocked_rows,
      current_h_rows,
      current_s_rows,
      current_is_blocked,
      current_blocked_code,
      current_holdstopreason,
      current_holdstopreasons,
      current_reason_category,
      total_cycle_count,
      released_cycle_count,
      open_cycle_count,
      hold_sample_count,
      profile_count,
      first_episode_start_date,
      last_episode_start_date,
      last_release_date,
      open_episode_start_date,
      open_episode_file_name,
      open_episode_reason,
      primary_reason_category,
      avg_days_to_release,
      median_days_to_release,
      avg_gdd_base_50_to_release,
      median_gdd_base_50_to_release,
      history_first_file_date,
      history_last_file_date,
      history_file_count,
      parsed_history_first_file_date,
      parsed_history_last_file_date,
      parsed_history_file_count,
      rows_file_count,
      row_history_first_file_date,
      row_history_last_file_date,
      updated_at,
      snapshot
    )
    select
      'hold_stop_itemcode_summary_' || encode(digest(i.itemcode, 'sha256'), 'hex') as unique_id,
      i.itemcode,
      coalesce(cs.commonname, (array_agg(cy.commonname order by cy.episode_start_date desc) filter (where cy.commonname is not null))[1]) as commonname,
      coalesce(cs.genus, (array_agg(cy.genus order by cy.episode_start_date desc) filter (where cy.genus is not null))[1]) as genus,
      coalesce(cs.contsize, (array_agg(cy.contsize order by cy.episode_start_date desc) filter (where cy.contsize is not null))[1]) as contsize,
      coalesce(cs.current_rows, 0) as current_rows,
      coalesce(cs.current_blocked_rows, 0) as current_blocked_rows,
      coalesce(cs.current_h_rows, 0) as current_h_rows,
      coalesce(cs.current_s_rows, 0) as current_s_rows,
      coalesce(cs.current_is_blocked, false) as current_is_blocked,
      cs.current_blocked_code,
      cs.current_holdstopreason,
      coalesce(cs.current_holdstopreasons, '{}'::text[]) as current_holdstopreasons,
      case
        when coalesce(cs.current_is_blocked, false) then public.v2_classify_hold_reason(coalesce(cs.current_holdstopreason, ''))
        else null
      end as current_reason_category,
      coalesce(cst.total_cycle_count, 0) as total_cycle_count,
      coalesce(cst.released_cycle_count, 0) as released_cycle_count,
      coalesce(cst.open_cycle_count, 0) as open_cycle_count,
      coalesce(ps.hold_sample_count, 0) as hold_sample_count,
      coalesce(ps.profile_count, 0) as profile_count,
      cst.first_episode_start_date,
      cst.last_episode_start_date,
      cst.last_release_date,
      cst.open_episode_start_date,
      cst.open_episode_file_name,
      cst.open_episode_reason,
      cst.primary_reason_category,
      cst.avg_days_to_release,
      cst.median_days_to_release,
      cst.avg_gdd_base_50_to_release,
      cst.median_gdd_base_50_to_release,
      hc.history_first_file_date,
      hc.history_last_file_date,
      coalesce(hc.history_file_count, 0) as history_file_count,
      rhc.parsed_history_first_file_date,
      rhc.parsed_history_last_file_date,
      coalesce(rhc.parsed_history_file_count, 0) as parsed_history_file_count,
      coalesce(ss.rows_file_count, 0) as rows_file_count,
      ss.row_history_first_file_date,
      ss.row_history_last_file_date,
      now() as updated_at,
      jsonb_build_object(
        'source', 'ph_refresh_hold_stop_itemcode_summaries',
        'current_status_source', 'ph_master_inventory',
        'cycle_source', 'ph_hold_stop_itemcode_cycles',
        'history_file_count', coalesce(hc.history_file_count, 0),
        'parsed_history_file_count', coalesce(rhc.parsed_history_file_count, 0),
        'rows_file_count', coalesce(ss.rows_file_count, 0)
      ) as snapshot
    from itemcodes i
    left join current_status cs on cs.itemcode = i.itemcode
    left join cycle_stats cst on cst.itemcode = i.itemcode
    left join profile_stats ps on ps.itemcode = i.itemcode
    left join snapshot_stats ss on ss.itemcode = i.itemcode
    cross join history_coverage hc
    cross join row_history_coverage rhc
    left join public.ph_hold_stop_itemcode_cycles cy on cy.itemcode = i.itemcode
    group by
      i.itemcode,
      cs.commonname,
      cs.genus,
      cs.contsize,
      cs.current_rows,
      cs.current_blocked_rows,
      cs.current_h_rows,
      cs.current_s_rows,
      cs.current_is_blocked,
      cs.current_blocked_code,
      cs.current_holdstopreason,
      cs.current_holdstopreasons,
      cst.total_cycle_count,
      cst.released_cycle_count,
      cst.open_cycle_count,
      cst.first_episode_start_date,
      cst.last_episode_start_date,
      cst.last_release_date,
      cst.open_episode_start_date,
      cst.open_episode_file_name,
      cst.open_episode_reason,
      cst.primary_reason_category,
      cst.avg_days_to_release,
      cst.median_days_to_release,
      cst.avg_gdd_base_50_to_release,
      cst.median_gdd_base_50_to_release,
      ps.hold_sample_count,
      ps.profile_count,
      hc.history_first_file_date,
      hc.history_last_file_date,
      hc.history_file_count,
      rhc.parsed_history_first_file_date,
      rhc.parsed_history_last_file_date,
      rhc.parsed_history_file_count,
      ss.rows_file_count,
      ss.row_history_first_file_date,
      ss.row_history_last_file_date
    returning 1
  )
  select count(*)::integer into refreshed from inserted;

  return refreshed;
end;
$function$;

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows_range(
  p_start_date date default null,
  p_end_date date default null,
  p_limit integer default 100000
)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  safe_start date := coalesce(p_start_date, current_date - 3650);
  safe_end date := coalesce(p_end_date, current_date);
begin
  if to_regclass('public.ph_drive_around_report_rows') is null then
    raise exception 'public.ph_drive_around_report_rows does not exist. Import Drive Around history first.';
  end if;

  if safe_start > safe_end then
    raise exception 'Start date % must be on or before end date %.', safe_start, safe_end;
  end if;

  return query
  select r.hold_events_upserted, r.release_cycles_upserted
  from public.v2_refresh_hold_stop_itemcode_episode_learning(safe_start, safe_end, p_limit) r;

  perform public.ph_refresh_hold_stop_itemcode_summaries();
end;
$function$;

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows(p_limit integer default 100000)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  start_date date;
  end_date date;
begin
  select min(coalesce(f.canonical_report_date, f.report_date)), max(coalesce(f.canonical_report_date, f.report_date))
  into start_date, end_date
  from public.ph_drive_around_report_files f
  where coalesce(f.canonical_report_date, f.report_date) is not null;

  if start_date is null or end_date is null then
    hold_events_upserted := 0;
    release_cycles_upserted := 0;
    return next;
    return;
  end if;

  return query
  select * from public.v2_refresh_hold_learning_from_drive_around_rows_range(start_date, end_date, p_limit);
end;
$function$;

revoke all on function public.ph_refresh_hold_stop_itemcode_summaries() from public;
revoke all on function public.v2_refresh_hold_learning_from_drive_around_rows_range(date, date, integer) from public;
revoke all on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) from public;

grant execute on function public.ph_refresh_hold_stop_itemcode_summaries() to service_role;
grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows_range(date, date, integer) to service_role;
grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) to service_role;
