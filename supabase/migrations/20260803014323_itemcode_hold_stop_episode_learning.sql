create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ph_hold_stop_itemcode_snapshots (
  unique_id text primary key,
  itemcode text not null,
  file_id text not null,
  file_name text not null,
  file_date date not null,
  canonical_sequence integer,
  file_rank integer not null,
  commonname text,
  genus text,
  contsize text,
  total_row_count integer not null default 0,
  h_row_count integer not null default 0,
  s_row_count integer not null default 0,
  blocked_row_count integer not null default 0,
  blank_row_count integer not null default 0,
  is_blocked boolean not null default false,
  first_blocked_code text,
  blocked_codes text[] not null default '{}'::text[],
  observed_holdstopcodes text[] not null default '{}'::text[],
  holdstopreason text,
  holdstopreasons text[] not null default '{}'::text[],
  hold_reason_category text,
  hold_reason_categories text[] not null default '{}'::text[],
  source_row_ids text[] not null default '{}'::text[],
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ph_hold_stop_itemcode_snapshots_item_file_unique unique (itemcode, file_id),
  constraint ph_hold_stop_itemcode_snapshots_blocked_code_check
    check (first_blocked_code is null or first_blocked_code in ('H', 'S'))
);

create table if not exists public.ph_hold_stop_itemcode_cycles (
  unique_id text primary key,
  itemcode text not null,
  episode_number integer not null,
  blocked_code text not null,
  episode_start_date date not null,
  start_file_id text,
  start_file_name text,
  start_canonical_sequence integer,
  start_file_rank integer not null,
  episode_release_date date,
  release_file_id text,
  release_file_name text,
  release_canonical_sequence integer,
  release_file_rank integer,
  days_blocked integer,
  snapshot_count integer not null default 0,
  commonname text,
  genus text,
  contsize text,
  holdstopreason text,
  holdstopreasons text[] not null default '{}'::text[],
  hold_reason_category text,
  hold_reason_categories text[] not null default '{}'::text[],
  blocked_codes text[] not null default '{}'::text[],
  gdd_base_50_to_release numeric,
  source_snapshot_ids text[] not null default '{}'::text[],
  source_file_ids text[] not null default '{}'::text[],
  source_file_names text[] not null default '{}'::text[],
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ph_hold_stop_itemcode_cycles_item_episode_unique unique (itemcode, episode_number),
  constraint ph_hold_stop_itemcode_cycles_blocked_code_check check (blocked_code in ('H', 'S')),
  constraint ph_hold_stop_itemcode_cycles_days_check check (days_blocked is null or days_blocked >= 0)
);

create index if not exists ph_hold_stop_itemcode_snapshots_item_rank_idx
  on public.ph_hold_stop_itemcode_snapshots (itemcode, file_rank);

create index if not exists ph_hold_stop_itemcode_snapshots_file_idx
  on public.ph_hold_stop_itemcode_snapshots (file_date, canonical_sequence, file_name);

create index if not exists ph_hold_stop_itemcode_snapshots_blocked_idx
  on public.ph_hold_stop_itemcode_snapshots (is_blocked, file_date);

create index if not exists ph_hold_stop_itemcode_cycles_item_start_idx
  on public.ph_hold_stop_itemcode_cycles (itemcode, episode_start_date desc);

create index if not exists ph_hold_stop_itemcode_cycles_reason_idx
  on public.ph_hold_stop_itemcode_cycles (hold_reason_category, episode_start_date desc);

create index if not exists ph_hold_stop_itemcode_cycles_release_idx
  on public.ph_hold_stop_itemcode_cycles (episode_release_date desc);

alter table public.ph_hold_stop_itemcode_snapshots enable row level security;
alter table public.ph_hold_stop_itemcode_cycles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.ph_hold_stop_itemcode_snapshots'::regclass
      and polname = 'Allow app read hold stop itemcode snapshots'
  ) then
    create policy "Allow app read hold stop itemcode snapshots"
      on public.ph_hold_stop_itemcode_snapshots
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.ph_hold_stop_itemcode_snapshots'::regclass
      and polname = 'Allow service write hold stop itemcode snapshots'
  ) then
    create policy "Allow service write hold stop itemcode snapshots"
      on public.ph_hold_stop_itemcode_snapshots
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.ph_hold_stop_itemcode_cycles'::regclass
      and polname = 'Allow app read hold stop itemcode cycles'
  ) then
    create policy "Allow app read hold stop itemcode cycles"
      on public.ph_hold_stop_itemcode_cycles
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.ph_hold_stop_itemcode_cycles'::regclass
      and polname = 'Allow service write hold stop itemcode cycles'
  ) then
    create policy "Allow service write hold stop itemcode cycles"
      on public.ph_hold_stop_itemcode_cycles
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

revoke all on table public.ph_hold_stop_itemcode_snapshots from anon, authenticated;
revoke all on table public.ph_hold_stop_itemcode_cycles from anon, authenticated;
grant select on table public.ph_hold_stop_itemcode_snapshots to anon, authenticated;
grant select on table public.ph_hold_stop_itemcode_cycles to anon, authenticated;
grant all on public.ph_hold_stop_itemcode_snapshots to service_role;
grant all on public.ph_hold_stop_itemcode_cycles to service_role;

alter table public.ph_hold_release_cycles
  add column if not exists holdstopcode text,
  add column if not exists episode_number integer,
  add column if not exists cycle_source text;

create index if not exists idx_ph_hold_release_cycles_item_start
  on public.ph_hold_release_cycles (itemcode, hold_started_on desc);

alter table public.ph_hold_learning_profiles
  add column if not exists itemcode text,
  add column if not exists release_sample_count integer not null default 0,
  add column if not exists avg_gdd_base_50_to_release numeric,
  add column if not exists median_gdd_base_50_to_release numeric,
  add column if not exists avg_days_to_release numeric;

create index if not exists idx_ph_hold_learning_profiles_item_reason
  on public.ph_hold_learning_profiles (itemcode, hold_reason_category);

create or replace function public.v2_refresh_hold_stop_itemcode_episode_learning(
  p_start_date date default null,
  p_end_date date default null,
  p_weather_refresh_limit integer default 5000
)
returns table(
  snapshot_rows integer,
  itemcode_cycles integer,
  hold_events_upserted integer,
  release_cycles_upserted integer,
  profiles_refreshed integer
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  safe_start date;
  safe_end date;
  snapshot_count integer := 0;
  cycle_count integer := 0;
  event_count integer := 0;
  release_count integer := 0;
  profile_count integer := 0;
begin
  select
    coalesce(p_start_date, min(coalesce(f.canonical_report_date, f.report_date))),
    coalesce(p_end_date, max(coalesce(f.canonical_report_date, f.report_date)))
  into safe_start, safe_end
  from public.ph_drive_around_report_files f;

  if safe_start is null or safe_end is null then
    snapshot_rows := 0;
    itemcode_cycles := 0;
    hold_events_upserted := 0;
    release_cycles_upserted := 0;
    profiles_refreshed := 0;
    return next;
    return;
  end if;

  if safe_start > safe_end then
    raise exception 'Start date % must be on or before end date %.', safe_start, safe_end;
  end if;

  truncate table public.ph_hold_stop_itemcode_snapshots;
  truncate table public.ph_hold_stop_itemcode_cycles;

  create temp table tmp_ph_hold_stop_files on commit drop as
  select
    f.file_id,
    coalesce(f.canonical_report_date, f.report_date) as file_date,
    coalesce(nullif(trim(f.canonical_file_name), ''), f.file_name) as file_name,
    f.canonical_sequence,
    row_number() over (
      order by
        coalesce(f.canonical_report_date, f.report_date),
        coalesce(f.canonical_sequence, 999999),
        coalesce(nullif(trim(f.canonical_file_name), ''), f.file_name),
        f.file_id
    )::integer as file_rank
  from public.ph_drive_around_report_files f
  where coalesce(f.canonical_report_date, f.report_date) >= safe_start
    and coalesce(f.canonical_report_date, f.report_date) <= safe_end
    and coalesce(f.canonical_report_date, f.report_date) is not null;

  insert into public.ph_hold_stop_itemcode_snapshots (
    unique_id,
    itemcode,
    file_id,
    file_name,
    file_date,
    canonical_sequence,
    file_rank,
    commonname,
    genus,
    contsize,
    total_row_count,
    h_row_count,
    s_row_count,
    blocked_row_count,
    blank_row_count,
    is_blocked,
    first_blocked_code,
    blocked_codes,
    observed_holdstopcodes,
    holdstopreason,
    holdstopreasons,
    hold_reason_category,
    hold_reason_categories,
    source_row_ids,
    snapshot,
    created_at,
    updated_at
  )
  with row_source as (
    select
      tf.file_id,
      tf.file_date,
      tf.file_name,
      tf.canonical_sequence,
      tf.file_rank,
      r.unique_id as source_row_id,
      r.row_number,
      upper(nullif(trim(coalesce(r.holdstopcode, '')), '')) as code,
      nullif(trim(r.holdstopreason), '') as reason,
      nullif(trim(r.itemcode), '') as itemcode,
      nullif(trim(r.commonname), '') as commonname,
      nullif(trim(r.genus), '') as genus,
      nullif(trim(r.contsize), '') as contsize,
      r.locationcode,
      r.lotcode
    from public.ph_drive_around_report_rows r
    join tmp_ph_hold_stop_files tf on tf.file_id = r.file_id
    where nullif(trim(r.itemcode), '') is not null
  ),
  grouped as (
    select
      rs.itemcode,
      rs.file_id,
      rs.file_name,
      rs.file_date,
      rs.canonical_sequence,
      rs.file_rank,
      (array_agg(rs.commonname order by rs.row_number) filter (where rs.commonname is not null))[1] as commonname,
      (array_agg(rs.genus order by rs.row_number) filter (where rs.genus is not null))[1] as genus,
      (array_agg(rs.contsize order by rs.row_number) filter (where rs.contsize is not null))[1] as contsize,
      count(*)::integer as total_row_count,
      count(*) filter (where rs.code = 'H')::integer as h_row_count,
      count(*) filter (where rs.code = 'S')::integer as s_row_count,
      count(*) filter (where rs.code in ('H', 'S'))::integer as blocked_row_count,
      count(*) filter (where rs.code is null or rs.code not in ('H', 'S'))::integer as blank_row_count,
      (count(*) filter (where rs.code in ('H', 'S')) > 0) as is_blocked,
      (array_agg(rs.code order by rs.row_number) filter (where rs.code in ('H', 'S')))[1] as first_blocked_code,
      coalesce(array_agg(distinct rs.code) filter (where rs.code in ('H', 'S')), '{}'::text[]) as blocked_codes,
      coalesce(array_agg(distinct rs.code) filter (where rs.code is not null), '{}'::text[]) as observed_holdstopcodes,
      (array_agg(rs.reason order by rs.row_number) filter (where rs.code in ('H', 'S') and rs.reason is not null))[1] as holdstopreason,
      coalesce(array_agg(distinct rs.reason) filter (where rs.code in ('H', 'S') and rs.reason is not null), '{}'::text[]) as holdstopreasons,
      coalesce(
        public.v2_classify_hold_reason((array_agg(rs.reason order by rs.row_number) filter (where rs.code in ('H', 'S') and rs.reason is not null))[1]),
        'unknown'
      ) as hold_reason_category,
      coalesce(array_agg(distinct public.v2_classify_hold_reason(rs.reason)) filter (where rs.code in ('H', 'S')), '{}'::text[]) as hold_reason_categories,
      coalesce(array_agg(rs.source_row_id order by rs.row_number), '{}'::text[]) as source_row_ids,
      jsonb_build_object(
        'source', 'ph_drive_around_report_rows',
        'locations', coalesce(array_agg(distinct rs.locationcode) filter (where nullif(trim(coalesce(rs.locationcode, '')), '') is not null), '{}'::text[]),
        'lots', coalesce(array_agg(distinct rs.lotcode) filter (where nullif(trim(coalesce(rs.lotcode, '')), '') is not null), '{}'::text[])
      ) as snapshot
    from row_source rs
    group by rs.itemcode, rs.file_id, rs.file_name, rs.file_date, rs.canonical_sequence, rs.file_rank
  )
  select
    'hold_stop_itemcode_snapshot_' || encode(digest(concat_ws('|', g.itemcode, g.file_id), 'sha256'), 'hex') as unique_id,
    g.itemcode,
    g.file_id,
    g.file_name,
    g.file_date,
    g.canonical_sequence,
    g.file_rank,
    g.commonname,
    g.genus,
    g.contsize,
    g.total_row_count,
    g.h_row_count,
    g.s_row_count,
    g.blocked_row_count,
    g.blank_row_count,
    g.is_blocked,
    g.first_blocked_code,
    g.blocked_codes,
    g.observed_holdstopcodes,
    g.holdstopreason,
    g.holdstopreasons,
    g.hold_reason_category,
    g.hold_reason_categories,
    g.source_row_ids,
    g.snapshot,
    now(),
    now()
  from grouped g;

  get diagnostics snapshot_count = row_count;

  create temp table tmp_ph_hold_stop_cycle_starts on commit drop as
  with ordered as (
    select
      s.*,
      lag(s.is_blocked) over (partition by s.itemcode order by s.file_rank) as previous_is_blocked
    from public.ph_hold_stop_itemcode_snapshots s
  )
  select
    o.*,
    row_number() over (partition by o.itemcode order by o.file_rank)::integer as episode_number
  from ordered o
  where o.is_blocked = true
    and coalesce(o.previous_is_blocked, false) = false;

  insert into public.ph_hold_stop_itemcode_cycles (
    unique_id,
    itemcode,
    episode_number,
    blocked_code,
    episode_start_date,
    start_file_id,
    start_file_name,
    start_canonical_sequence,
    start_file_rank,
    episode_release_date,
    release_file_id,
    release_file_name,
    release_canonical_sequence,
    release_file_rank,
    days_blocked,
    snapshot_count,
    commonname,
    genus,
    contsize,
    holdstopreason,
    holdstopreasons,
    hold_reason_category,
    hold_reason_categories,
    blocked_codes,
    gdd_base_50_to_release,
    source_snapshot_ids,
    source_file_ids,
    source_file_names,
    snapshot,
    created_at,
    updated_at
  )
  select
    'hold_stop_itemcode_cycle_' || encode(digest(concat_ws('|', s.itemcode, s.episode_number::text, s.file_id), 'sha256'), 'hex') as unique_id,
    s.itemcode,
    s.episode_number,
    coalesce(cycle_agg.first_blocked_code, s.first_blocked_code, 'H') as blocked_code,
    s.file_date as episode_start_date,
    s.file_id as start_file_id,
    s.file_name as start_file_name,
    s.canonical_sequence as start_canonical_sequence,
    s.file_rank as start_file_rank,
    r.file_date as episode_release_date,
    r.file_id as release_file_id,
    r.file_name as release_file_name,
    r.canonical_sequence as release_canonical_sequence,
    r.file_rank as release_file_rank,
    case when r.file_date is null then null else greatest((r.file_date - s.file_date), 0) end as days_blocked,
    coalesce(cycle_agg.snapshot_count, 1) as snapshot_count,
    s.commonname,
    s.genus,
    s.contsize,
    cycle_agg.first_holdstopreason as holdstopreason,
    coalesce(cycle_agg.holdstopreasons, '{}'::text[]) as holdstopreasons,
    coalesce(public.v2_classify_hold_reason(cycle_agg.first_holdstopreason), cycle_agg.first_hold_reason_category, 'unknown') as hold_reason_category,
    coalesce(cycle_agg.hold_reason_categories, '{}'::text[]) as hold_reason_categories,
    coalesce(cycle_agg.blocked_codes, '{}'::text[]) as blocked_codes,
    case
      when r.file_date is null then null
      else coalesce((
        select round(sum(coalesce(d.daily_gdd_base_50, greatest(((coalesce(d.temperature_high_f, 0) + coalesce(d.temperature_low_f, 0)) / 2) - 50, 0)))::numeric, 3)
        from public.ph_weather_daily d
        where d.station_key = 'park_hill_ok'
          and d.date >= s.file_date
          and d.date <= r.file_date
      ), 0)
    end as gdd_base_50_to_release,
    coalesce(cycle_agg.source_snapshot_ids, '{}'::text[]) as source_snapshot_ids,
    coalesce(cycle_agg.source_file_ids, '{}'::text[]) as source_file_ids,
    coalesce(cycle_agg.source_file_names, '{}'::text[]) as source_file_names,
    jsonb_build_object(
      'source', 'ph_hold_stop_itemcode_snapshots',
      'start_snapshot_id', s.unique_id,
      'release_snapshot_id', r.unique_id,
      'start_snapshot', s.snapshot,
      'release_snapshot', coalesce(r.snapshot, '{}'::jsonb)
    ) as snapshot,
    now(),
    now()
  from tmp_ph_hold_stop_cycle_starts s
  left join lateral (
    select rel.*
    from public.ph_hold_stop_itemcode_snapshots rel
    where rel.itemcode = s.itemcode
      and rel.file_rank > s.file_rank
      and rel.is_blocked = false
    order by rel.file_rank
    limit 1
  ) r on true
  left join lateral (
    select
      count(*)::integer as snapshot_count,
      (array_agg(m.first_blocked_code order by m.file_rank) filter (where m.is_blocked and m.first_blocked_code is not null))[1] as first_blocked_code,
      (array_agg(m.holdstopreason order by m.file_rank) filter (where m.is_blocked and m.holdstopreason is not null))[1] as first_holdstopreason,
      (array_agg(m.hold_reason_category order by m.file_rank) filter (where m.is_blocked and m.hold_reason_category is not null))[1] as first_hold_reason_category,
      coalesce(array_agg(m.unique_id order by m.file_rank), '{}'::text[]) as source_snapshot_ids,
      coalesce(array_agg(m.file_id order by m.file_rank), '{}'::text[]) as source_file_ids,
      coalesce(array_agg(m.file_name order by m.file_rank), '{}'::text[]) as source_file_names,
      coalesce(array(
        select distinct code
        from public.ph_hold_stop_itemcode_snapshots bc
        cross join unnest(bc.blocked_codes) code
        where bc.itemcode = s.itemcode
          and bc.file_rank >= s.file_rank
          and (r.file_rank is null or bc.file_rank < r.file_rank)
        order by code
      ), '{}'::text[]) as blocked_codes,
      coalesce(array(
        select distinct reason
        from public.ph_hold_stop_itemcode_snapshots br
        cross join unnest(br.holdstopreasons) reason
        where br.itemcode = s.itemcode
          and br.file_rank >= s.file_rank
          and (r.file_rank is null or br.file_rank < r.file_rank)
        order by reason
      ), '{}'::text[]) as holdstopreasons,
      coalesce(array(
        select distinct category
        from public.ph_hold_stop_itemcode_snapshots cr
        cross join unnest(cr.hold_reason_categories) category
        where cr.itemcode = s.itemcode
          and cr.file_rank >= s.file_rank
          and (r.file_rank is null or cr.file_rank < r.file_rank)
        order by category
      ), '{}'::text[]) as hold_reason_categories
    from public.ph_hold_stop_itemcode_snapshots m
    where m.itemcode = s.itemcode
      and m.file_rank >= s.file_rank
      and (r.file_rank is null or m.file_rank <= r.file_rank)
  ) cycle_agg on true
  on conflict (unique_id) do update set
    itemcode = excluded.itemcode,
    episode_number = excluded.episode_number,
    blocked_code = excluded.blocked_code,
    episode_start_date = excluded.episode_start_date,
    start_file_id = excluded.start_file_id,
    start_file_name = excluded.start_file_name,
    start_canonical_sequence = excluded.start_canonical_sequence,
    start_file_rank = excluded.start_file_rank,
    episode_release_date = excluded.episode_release_date,
    release_file_id = excluded.release_file_id,
    release_file_name = excluded.release_file_name,
    release_canonical_sequence = excluded.release_canonical_sequence,
    release_file_rank = excluded.release_file_rank,
    days_blocked = excluded.days_blocked,
    snapshot_count = excluded.snapshot_count,
    commonname = excluded.commonname,
    genus = excluded.genus,
    contsize = excluded.contsize,
    holdstopreason = excluded.holdstopreason,
    holdstopreasons = excluded.holdstopreasons,
    hold_reason_category = excluded.hold_reason_category,
    hold_reason_categories = excluded.hold_reason_categories,
    blocked_codes = excluded.blocked_codes,
    gdd_base_50_to_release = excluded.gdd_base_50_to_release,
    source_snapshot_ids = excluded.source_snapshot_ids,
    source_file_ids = excluded.source_file_ids,
    source_file_names = excluded.source_file_names,
    snapshot = excluded.snapshot,
    updated_at = now();

  get diagnostics cycle_count = row_count;

  delete from public.ph_hold_learning_events
  where source_table in ('ph_drive_around_report_rows', 'ph_hold_stop_itemcode_cycles');

  insert into public.ph_hold_learning_events (
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
    gdd_base_50_7d,
    gdd_base_50_14d,
    gdd_base_50_30d,
    gdd_base_50_season,
    chill_hours_7d,
    chill_hours_14d,
    chill_hours_30d,
    chill_hours_season,
    precipitation_in_7d,
    precipitation_in_14d,
    precipitation_in_30d,
    avg_temperature_f_7d,
    avg_temperature_f_14d,
    avg_temperature_f_30d,
    weather_features_refreshed_at,
    released_on,
    gdd_base_50_to_release,
    hold_days,
    created_at,
    updated_at
  )
  select
    'hold_event_itemcode_cycle_' || encode(digest(c.unique_id, 'sha256'), 'hex') as unique_id,
    'ph_hold_stop_itemcode_cycles' as source_table,
    c.unique_id as source_unique_id,
    c.start_file_name as import_file_name,
    c.episode_start_date as hold_started_on,
    now() as hold_detected_at,
    c.itemcode,
    c.commonname,
    c.genus,
    c.contsize,
    null::text as locationcode,
    null::text as lotcode,
    null::text as season,
    null::text as blockalpha,
    null::text as salesyear,
    c.blocked_code as holdstopcode,
    c.holdstopreason,
    null::text as holdstopbegindate_raw,
    coalesce(c.hold_reason_category, 'unknown') as hold_reason_category,
    'park_hill_ok' as weather_station_key,
    weather.gdd_7,
    weather.gdd_14,
    weather.gdd_30,
    weather.gdd_season,
    null::numeric as chill_hours_7d,
    null::numeric as chill_hours_14d,
    null::numeric as chill_hours_30d,
    null::numeric as chill_hours_season,
    weather.precip_7,
    weather.precip_14,
    weather.precip_30,
    weather.avg_temp_7,
    weather.avg_temp_14,
    weather.avg_temp_30,
    now() as weather_features_refreshed_at,
    c.episode_release_date as released_on,
    c.gdd_base_50_to_release,
    c.days_blocked as hold_days,
    now(),
    now()
  from public.ph_hold_stop_itemcode_cycles c
  left join lateral (
    select
      coalesce(round((sum(coalesce(d.daily_gdd_base_50, greatest(((coalesce(d.temperature_high_f, 0) + coalesce(d.temperature_low_f, 0)) / 2) - 50, 0))) filter (where d.date >= c.episode_start_date - 6 and d.date <= c.episode_start_date))::numeric, 3), 0) as gdd_7,
      coalesce(round((sum(coalesce(d.daily_gdd_base_50, greatest(((coalesce(d.temperature_high_f, 0) + coalesce(d.temperature_low_f, 0)) / 2) - 50, 0))) filter (where d.date >= c.episode_start_date - 13 and d.date <= c.episode_start_date))::numeric, 3), 0) as gdd_14,
      coalesce(round((sum(coalesce(d.daily_gdd_base_50, greatest(((coalesce(d.temperature_high_f, 0) + coalesce(d.temperature_low_f, 0)) / 2) - 50, 0))) filter (where d.date >= c.episode_start_date - 29 and d.date <= c.episode_start_date))::numeric, 3), 0) as gdd_30,
      coalesce(round((sum(coalesce(d.daily_gdd_base_50, greatest(((coalesce(d.temperature_high_f, 0) + coalesce(d.temperature_low_f, 0)) / 2) - 50, 0))) filter (where d.date >= make_date(extract(year from c.episode_start_date)::integer, 1, 1) and d.date <= c.episode_start_date))::numeric, 3), 0) as gdd_season,
      coalesce(round((sum(coalesce(d.precipitation_in, 0)) filter (where d.date >= c.episode_start_date - 6 and d.date <= c.episode_start_date))::numeric, 3), 0) as precip_7,
      coalesce(round((sum(coalesce(d.precipitation_in, 0)) filter (where d.date >= c.episode_start_date - 13 and d.date <= c.episode_start_date))::numeric, 3), 0) as precip_14,
      coalesce(round((sum(coalesce(d.precipitation_in, 0)) filter (where d.date >= c.episode_start_date - 29 and d.date <= c.episode_start_date))::numeric, 3), 0) as precip_30,
      round(avg(((d.temperature_high_f + d.temperature_low_f) / 2)) filter (where d.date >= c.episode_start_date - 6 and d.date <= c.episode_start_date), 2) as avg_temp_7,
      round(avg(((d.temperature_high_f + d.temperature_low_f) / 2)) filter (where d.date >= c.episode_start_date - 13 and d.date <= c.episode_start_date), 2) as avg_temp_14,
      round(avg(((d.temperature_high_f + d.temperature_low_f) / 2)) filter (where d.date >= c.episode_start_date - 29 and d.date <= c.episode_start_date), 2) as avg_temp_30
    from public.ph_weather_daily d
    where d.station_key = 'park_hill_ok'
      and d.date >= make_date(extract(year from c.episode_start_date)::integer, 1, 1)
      and d.date <= c.episode_start_date
  ) weather on true;

  get diagnostics event_count = row_count;

  delete from public.ph_hold_release_cycles
  where unique_id like 'hold_cycle_history_%'
     or unique_id like 'hold_cycle_itemcode_%';

  insert into public.ph_hold_release_cycles (
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
    holdstopcode,
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
    episode_number,
    cycle_source,
    snapshot,
    created_at,
    updated_at
  )
  select
    'hold_cycle_itemcode_' || encode(digest(c.unique_id, 'sha256'), 'hex') as unique_id,
    c.itemcode as item_key,
    c.itemcode,
    c.commonname,
    c.genus,
    c.contsize,
    null::text as locationcode,
    null::text as lotcode,
    null::text as season,
    null::text as blockalpha,
    null::text as salesyear,
    c.blocked_code as holdstopcode,
    c.holdstopreason,
    c.hold_reason_category,
    c.episode_start_date as hold_started_on,
    c.episode_release_date as hold_released_on,
    c.days_blocked as hold_days,
    c.gdd_base_50_to_release,
    c.start_file_id,
    c.start_file_name,
    c.release_file_id,
    c.release_file_name,
    c.source_file_ids,
    c.source_file_names,
    c.episode_number,
    'ph_hold_stop_itemcode_cycles' as cycle_source,
    c.snapshot,
    now(),
    now()
  from public.ph_hold_stop_itemcode_cycles c
  where c.episode_release_date is not null;

  get diagnostics release_count = row_count;

  if to_regprocedure('public.v2_refresh_hold_learning_profiles()') is not null then
    profile_count := public.v2_refresh_hold_learning_profiles();
  end if;

  snapshot_rows := snapshot_count;
  itemcode_cycles := cycle_count;
  hold_events_upserted := event_count;
  release_cycles_upserted := release_count;
  profiles_refreshed := profile_count;
  return next;
end;
$function$;

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows_range(
  p_start_date date,
  p_end_date date,
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

create or replace function public.v2_refresh_hold_learning_profiles()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  refreshed integer := 0;
begin
  delete from public.ph_hold_learning_profiles;

  with item_profile_rows as (
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
      from public.ph_hold_learning_events
      where commonname is not null
        and hold_reason_category is not null
        and nullif(trim(coalesce(itemcode, '')), '') is not null
        and weather_features_refreshed_at is not null
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
      from public.ph_hold_release_cycles
      where hold_released_on is not null
        and commonname is not null
        and hold_reason_category is not null
        and nullif(trim(coalesce(itemcode, '')), '') is not null
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
      'hold_profile_item_' || encode(digest(concat_ws('|',
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
      now() as updated_at
    from event_stats e
    left join release_stats r
      on r.itemcode_key = e.itemcode_key
     and r.common_key = e.common_key
     and r.contsize_key = e.contsize_key
     and r.reason_key = e.reason_key
  ),
  common_profile_rows as (
    with event_base as (
      select
        lower(trim(coalesce(commonname, 'unknown'))) as common_key,
        lower(trim(coalesce(contsize, ''))) as contsize_key,
        coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as reason_key,
        coalesce(nullif(trim(commonname), ''), 'Unknown') as commonname_display,
        nullif(trim(max(genus) over (
          partition by
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
      from public.ph_hold_learning_events
      where commonname is not null
        and hold_reason_category is not null
        and weather_features_refreshed_at is not null
    ),
    event_stats as (
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
    release_base as (
      select
        lower(trim(coalesce(commonname, 'unknown'))) as common_key,
        lower(trim(coalesce(contsize, ''))) as contsize_key,
        coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as reason_key,
        gdd_base_50_to_release,
        hold_days
      from public.ph_hold_release_cycles
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
      'hold_profile_' || encode(digest(concat_ws('|',
        e.common_key,
        e.contsize_key,
        e.reason_key
      ), 'sha256'), 'hex') as unique_id,
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
    from event_stats e
    left join release_stats r
      on r.common_key = e.common_key
     and r.contsize_key = e.contsize_key
     and r.reason_key = e.reason_key
  ),
  upserted as (
    insert into public.ph_hold_learning_profiles (
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
    select * from item_profile_rows
    union all
    select * from common_profile_rows
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
$function$;

revoke all on function public.v2_refresh_hold_stop_itemcode_episode_learning(date, date, integer) from public;
revoke all on function public.v2_refresh_hold_learning_from_drive_around_rows_range(date, date, integer) from public;
revoke all on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) from public;
revoke all on function public.v2_refresh_hold_learning_profiles() from public;

grant execute on function public.v2_refresh_hold_stop_itemcode_episode_learning(date, date, integer) to service_role;
grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows_range(date, date, integer) to service_role;
grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) to service_role;
grant execute on function public.v2_refresh_hold_learning_profiles() to service_role;
