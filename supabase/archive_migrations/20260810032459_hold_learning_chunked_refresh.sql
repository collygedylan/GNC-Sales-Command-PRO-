create extension if not exists pg_cron with schema extensions;

create table if not exists public.ph_hold_learning_refresh_jobs (
  job_name text primary key,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  hold_events_upserted integer,
  release_cycles_upserted integer,
  error_message text,
  updated_at timestamptz not null default now(),
  constraint ph_hold_learning_refresh_jobs_status_check check (status in ('pending','running','running_chunked','ready_summary','summarizing','succeeded','failed','skipped'))
);

alter table public.ph_hold_learning_refresh_jobs enable row level security;

create table if not exists public.ph_hold_learning_refresh_itemcodes (
  job_name text not null,
  itemcode text not null,
  processed_at timestamptz,
  snapshot_rows integer,
  cycle_rows integer,
  error_message text,
  summary_processed_at timestamptz,
  primary key (job_name, itemcode)
);

alter table public.ph_hold_learning_refresh_itemcodes enable row level security;

alter table public.ph_hold_learning_refresh_jobs drop constraint if exists ph_hold_learning_refresh_jobs_status_check;
alter table public.ph_hold_learning_refresh_jobs add constraint ph_hold_learning_refresh_jobs_status_check
  check (status in ('pending','running','running_chunked','ready_summary','summarizing','succeeded','failed','skipped'));

alter table public.ph_hold_learning_refresh_itemcodes add column if not exists summary_processed_at timestamptz;

drop function if exists public.ph_run_hold_learning_refresh_cron_once();
drop function if exists public.ph_run_hold_learning_refresh_no_timeout_once();
drop function if exists public.ph_run_hold_learning_refresh_once_guarded(text);

CREATE OR REPLACE FUNCTION public.ph_prepare_hold_learning_refresh_chunked(p_job_name text DEFAULT 'drivearound_history_learning_refresh_20260810'::text)
 RETURNS TABLE(itemcode_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_job_name text := coalesce(nullif(trim(p_job_name), ''), 'drivearound_history_learning_refresh_20260810');
  v_count integer := 0;
begin
  truncate table public.ph_hold_stop_itemcode_snapshots;
  truncate table public.ph_hold_stop_itemcode_cycles;

  delete from public.ph_hold_learning_refresh_itemcodes where job_name = v_job_name;

  insert into public.ph_hold_learning_refresh_itemcodes (job_name, itemcode)
  select v_job_name, itemcode
  from (
    select distinct nullif(trim(itemcode), '') as itemcode
    from public.ph_hold_stop_itemcode_summaries
    union
    select distinct nullif(trim(itemcode), '') as itemcode
    from public.ph_master_inventory
  ) src
  where itemcode is not null
  on conflict (job_name, itemcode) do nothing;

  get diagnostics v_count = row_count;

  insert into public.ph_hold_learning_refresh_jobs (job_name, status, started_at, finished_at, updated_at)
  values (v_job_name, 'running_chunked', now(), null, now())
  on conflict (job_name) do update set
    status = 'running_chunked',
    started_at = coalesce(public.ph_hold_learning_refresh_jobs.started_at, now()),
    finished_at = null,
    hold_events_upserted = null,
    release_cycles_upserted = null,
    error_message = null,
    updated_at = now();

  itemcode_count := v_count;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ph_refresh_hold_learning_itemcode_batch(p_job_name text DEFAULT 'drivearound_history_learning_refresh_20260810'::text, p_batch_size integer DEFAULT 50)
 RETURNS TABLE(processed_itemcodes integer, remaining_itemcodes integer, snapshot_rows integer, cycle_rows integer, finished boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_job_name text := coalesce(nullif(trim(p_job_name), ''), 'drivearound_history_learning_refresh_20260810');
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 50), 250));
  v_processed integer := 0;
  v_remaining integer := 0;
  v_snapshot_rows integer := 0;
  v_cycle_rows integer := 0;
  v_total_snapshots integer := 0;
  v_total_cycles integer := 0;
  v_job_status text;
begin
  select j.status into v_job_status from public.ph_hold_learning_refresh_jobs j where j.job_name = v_job_name;
  if v_job_status in ('succeeded', 'ready_summary', 'summarizing') then
    processed_itemcodes := 0;
    remaining_itemcodes := 0;
    snapshot_rows := coalesce((select hold_events_upserted from public.ph_hold_learning_refresh_jobs where job_name = v_job_name), 0);
    cycle_rows := coalesce((select release_cycles_upserted from public.ph_hold_learning_refresh_jobs where job_name = v_job_name), 0);
    finished := true;
    return next;
    return;
  end if;

  if not exists (select 1 from public.ph_hold_learning_refresh_itemcodes where job_name = v_job_name) then
    perform public.ph_prepare_hold_learning_refresh_chunked(v_job_name);
  end if;

  create temp table tmp_ph_hl_batch_items on commit drop as
  select itemcode
  from public.ph_hold_learning_refresh_itemcodes
  where job_name = v_job_name
    and processed_at is null
    and error_message is null
  order by itemcode
  limit v_batch_size;

  create unique index on tmp_ph_hl_batch_items (itemcode);

  select count(*)::integer into v_processed from tmp_ph_hl_batch_items;

  if v_processed = 0 then
    update public.ph_hold_learning_refresh_itemcodes
    set summary_processed_at = null
    where job_name = v_job_name and processed_at is not null;

    update public.ph_hold_learning_refresh_jobs
    set status = 'ready_summary',
        error_message = null,
        updated_at = now()
    where job_name = v_job_name;

    processed_itemcodes := 0;
    remaining_itemcodes := 0;
    snapshot_rows := 0;
    cycle_rows := 0;
    finished := true;
    return next;
    return;
  end if;

  create temp table tmp_ph_hl_files on commit drop as
  select
    f.file_id,
    coalesce(f.canonical_report_date, f.report_date) as file_date,
    coalesce(nullif(trim(f.canonical_file_name), ''), nullif(trim(f.file_name), ''), f.file_name) as file_name,
    f.canonical_sequence,
    row_number() over (
      order by coalesce(f.canonical_report_date, f.report_date), coalesce(f.canonical_sequence, 0), coalesce(nullif(trim(f.canonical_file_name), ''), nullif(trim(f.file_name), ''), f.file_name), f.file_id
    )::integer as file_rank
  from public.ph_drive_around_report_files f
  where f.status = 'row_indexed'
    and coalesce(f.canonical_report_date, f.report_date) is not null;

  create unique index on tmp_ph_hl_files (file_id);

  delete from public.ph_hold_stop_itemcode_cycles c
  using tmp_ph_hl_batch_items i
  where c.itemcode = i.itemcode;

  delete from public.ph_hold_stop_itemcode_snapshots s
  using tmp_ph_hl_batch_items i
  where s.itemcode = i.itemcode;

  insert into public.ph_hold_stop_itemcode_snapshots (
    unique_id, itemcode, file_id, file_name, file_date, canonical_sequence, file_rank,
    commonname, genus, contsize, total_row_count, h_row_count, s_row_count,
    blocked_row_count, blank_row_count, is_blocked, first_blocked_code,
    blocked_codes, observed_holdstopcodes, holdstopreason, holdstopreasons,
    hold_reason_category, hold_reason_categories, source_row_ids, snapshot
  )
  with source_rows as (
    select
      r.itemcode,
      f.file_id,
      f.file_name,
      f.file_date,
      f.canonical_sequence,
      f.file_rank,
      nullif(trim(r.commonname), '') as commonname,
      nullif(trim(r.genus), '') as genus,
      nullif(trim(r.contsize), '') as contsize,
      upper(nullif(trim(r.holdstopcode), '')) as holdstopcode,
      nullif(trim(r.holdstopreason), '') as holdstopreason,
      coalesce(nullif(trim(r.hold_reason_category), ''), public.v2_classify_hold_reason(r.holdstopreason)) as hold_reason_category,
      r.unique_id as source_row_id
    from tmp_ph_hl_batch_items bi
    join public.ph_drive_around_report_rows r on r.itemcode = bi.itemcode
    join tmp_ph_hl_files f on f.file_id = r.file_id
    where nullif(trim(r.itemcode), '') is not null
  ), grouped as (
    select
      itemcode, file_id, file_name, file_date, canonical_sequence, file_rank,
      (array_remove(array_agg(commonname order by (commonname is null), commonname), null))[1] as commonname,
      (array_remove(array_agg(genus order by (genus is null), genus), null))[1] as genus,
      (array_remove(array_agg(contsize order by (contsize is null), contsize), null))[1] as contsize,
      count(*)::integer as total_row_count,
      count(*) filter (where holdstopcode = 'H')::integer as h_row_count,
      count(*) filter (where holdstopcode = 'S')::integer as s_row_count,
      count(*) filter (where holdstopcode in ('H', 'S'))::integer as blocked_row_count,
      count(*) filter (where coalesce(holdstopcode, '') not in ('H', 'S'))::integer as blank_row_count,
      (array_remove(array_agg(holdstopcode order by case holdstopcode when 'S' then 0 when 'H' then 1 else 2 end, holdstopcode) filter (where holdstopcode in ('H','S')), null))[1] as first_blocked_code,
      coalesce(array_agg(distinct holdstopcode order by holdstopcode) filter (where holdstopcode in ('H','S')), array[]::text[]) as blocked_codes,
      coalesce(array_agg(distinct holdstopcode order by holdstopcode) filter (where holdstopcode is not null), array[]::text[]) as observed_holdstopcodes,
      (array_remove(array_agg(holdstopreason order by (holdstopreason is null), holdstopreason), null))[1] as holdstopreason,
      coalesce(array_agg(distinct holdstopreason order by holdstopreason) filter (where holdstopreason is not null), array[]::text[]) as holdstopreasons,
      (array_remove(array_agg(hold_reason_category order by (hold_reason_category is null), hold_reason_category), null))[1] as hold_reason_category,
      coalesce(array_agg(distinct hold_reason_category order by hold_reason_category) filter (where hold_reason_category is not null), array[]::text[]) as hold_reason_categories,
      array_agg(source_row_id order by source_row_id) as source_row_ids
    from source_rows
    group by itemcode, file_id, file_name, file_date, canonical_sequence, file_rank
  )
  select
    encode(digest('ph-hs-snapshot|' || itemcode || '|' || file_id, 'sha256'), 'hex'),
    itemcode, file_id, file_name, file_date, canonical_sequence, file_rank,
    commonname, genus, contsize, total_row_count, h_row_count, s_row_count,
    blocked_row_count, blank_row_count, blocked_row_count > 0,
    first_blocked_code, blocked_codes, observed_holdstopcodes, holdstopreason,
    holdstopreasons, hold_reason_category, hold_reason_categories, source_row_ids,
    jsonb_build_object('refresh_mode','chunked_itemcode','itemcode',itemcode,'file_id',file_id,'file_rank',file_rank,'blocked_row_count',blocked_row_count)
  from grouped;

  get diagnostics v_snapshot_rows = row_count;

  create temp table tmp_ph_hl_starts on commit drop as
  with ordered as (
    select s.*, lag(s.is_blocked, 1, false) over (partition by s.itemcode order by s.file_rank) as previous_is_blocked
    from public.ph_hold_stop_itemcode_snapshots s
    join tmp_ph_hl_batch_items i on i.itemcode = s.itemcode
  )
  select ordered.itemcode, ordered.file_rank, row_number() over (partition by ordered.itemcode order by ordered.file_rank)::integer as episode_number
  from ordered
  where is_blocked and not previous_is_blocked;

  create index on tmp_ph_hl_starts (itemcode, file_rank);

  insert into public.ph_hold_stop_itemcode_cycles (
    unique_id, itemcode, episode_number, blocked_code, episode_start_date,
    start_file_id, start_file_name, start_canonical_sequence, start_file_rank,
    episode_release_date, release_file_id, release_file_name, release_canonical_sequence,
    release_file_rank, days_blocked, snapshot_count, commonname, genus, contsize,
    holdstopreason, holdstopreasons, hold_reason_category, hold_reason_categories,
    blocked_codes, gdd_base_50_to_release, source_snapshot_ids, source_file_ids,
    source_file_names, snapshot
  )
  select
    encode(digest('ph-hs-cycle|' || st.itemcode || '|' || st.episode_number::text || '|' || ss.file_id, 'sha256'), 'hex'),
    ss.itemcode,
    st.episode_number,
    coalesce(ss.first_blocked_code, 'H'),
    ss.file_date,
    ss.file_id,
    ss.file_name,
    ss.canonical_sequence,
    ss.file_rank,
    rel.file_date,
    rel.file_id,
    rel.file_name,
    rel.canonical_sequence,
    rel.file_rank,
    case when rel.file_date is null then null else greatest(rel.file_date - ss.file_date, 0) end,
    agg.snapshot_count,
    agg.commonname,
    agg.genus,
    agg.contsize,
    agg.holdstopreason,
    agg.holdstopreasons,
    agg.hold_reason_category,
    agg.hold_reason_categories,
    agg.blocked_codes,
    case when rel.file_date is null then null else coalesce(w.gdd_base_50_to_release, 0) end,
    agg.source_snapshot_ids,
    agg.source_file_ids,
    agg.source_file_names,
    jsonb_build_object('refresh_mode','chunked_itemcode','itemcode',ss.itemcode,'episode_number',st.episode_number,'start_file_rank',ss.file_rank,'release_file_rank',rel.file_rank)
  from tmp_ph_hl_starts st
  join public.ph_hold_stop_itemcode_snapshots ss on ss.itemcode = st.itemcode and ss.file_rank = st.file_rank
  left join lateral (
    select r.*
    from public.ph_hold_stop_itemcode_snapshots r
    where r.itemcode = ss.itemcode and r.file_rank > ss.file_rank and r.is_blocked = false
    order by r.file_rank
    limit 1
  ) rel on true
  join lateral (
    select
      count(*)::integer as snapshot_count,
      (array_remove(array_agg(s.commonname order by (s.commonname is null), s.file_rank), null))[1] as commonname,
      (array_remove(array_agg(s.genus order by (s.genus is null), s.file_rank), null))[1] as genus,
      (array_remove(array_agg(s.contsize order by (s.contsize is null), s.file_rank), null))[1] as contsize,
      (array_remove(array_agg(s.holdstopreason order by (s.holdstopreason is null), s.file_rank), null))[1] as holdstopreason,
      coalesce(array_agg(distinct s.holdstopreason order by s.holdstopreason) filter (where s.holdstopreason is not null), array[]::text[]) as holdstopreasons,
      (array_remove(array_agg(s.hold_reason_category order by (s.hold_reason_category is null), s.file_rank), null))[1] as hold_reason_category,
      coalesce(array_agg(distinct s.hold_reason_category order by s.hold_reason_category) filter (where s.hold_reason_category is not null), array[]::text[]) as hold_reason_categories,
      coalesce(array_agg(distinct s.first_blocked_code order by s.first_blocked_code) filter (where s.first_blocked_code in ('H','S')), array[]::text[]) as blocked_codes,
      array_agg(s.unique_id order by s.file_rank) as source_snapshot_ids,
      array_agg(s.file_id order by s.file_rank) as source_file_ids,
      array_agg(s.file_name order by s.file_rank) as source_file_names
    from public.ph_hold_stop_itemcode_snapshots s
    where s.itemcode = ss.itemcode
      and s.file_rank >= ss.file_rank
      and s.file_rank < coalesce(rel.file_rank, 2147483647)
  ) agg on true
  left join lateral (
    select round(sum(coalesce(daily_gdd_base_50, greatest(((coalesce(temperature_high_f,0) + coalesce(temperature_low_f,0)) / 2.0) - 50.0, 0))), 2) as gdd_base_50_to_release
    from public.ph_weather_daily
    where rel.file_date is not null
      and lower(coalesce(station_key, 'park_hill_ok')) = 'park_hill_ok'
      and date > ss.file_date
      and date <= rel.file_date
  ) w on true;

  get diagnostics v_cycle_rows = row_count;

  update public.ph_hold_learning_refresh_itemcodes w
  set processed_at = now(), snapshot_rows = coalesce(v_snapshot_rows, 0), cycle_rows = coalesce(v_cycle_rows, 0), error_message = null
  from tmp_ph_hl_batch_items i
  where w.job_name = v_job_name and w.itemcode = i.itemcode;

  select count(*)::integer into v_remaining
  from public.ph_hold_learning_refresh_itemcodes
  where job_name = v_job_name and processed_at is null and error_message is null;

  update public.ph_hold_learning_refresh_jobs
  set status = case when v_remaining = 0 then 'running_chunked' else 'running_chunked' end,
      hold_events_upserted = coalesce(hold_events_upserted, 0) + coalesce(v_snapshot_rows, 0),
      release_cycles_upserted = coalesce(release_cycles_upserted, 0) + coalesce(v_cycle_rows, 0),
      updated_at = now()
  where job_name = v_job_name;

  processed_itemcodes := v_processed;
  remaining_itemcodes := v_remaining;
  snapshot_rows := coalesce(v_snapshot_rows, 0);
  cycle_rows := coalesce(v_cycle_rows, 0);
  finished := false;
  return next;
exception when others then
  update public.ph_hold_learning_refresh_jobs
  set status = 'failed', error_message = sqlerrm, finished_at = now(), updated_at = now()
  where job_name = v_job_name;
  raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ph_refresh_hold_learning_summary_batch(p_job_name text DEFAULT 'drivearound_history_learning_refresh_20260810'::text, p_batch_size integer DEFAULT 500)
 RETURNS TABLE(processed_itemcodes integer, remaining_itemcodes integer, inserted_summaries integer, finished boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_job_name text := coalesce(nullif(trim(p_job_name), ''), 'drivearound_history_learning_refresh_20260810');
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 500), 1000));
  v_processed integer := 0;
  v_remaining integer := 0;
  v_inserted integer := 0;
  v_job_status text;
begin
  select status into v_job_status from public.ph_hold_learning_refresh_jobs where job_name = v_job_name;

  if v_job_status = 'succeeded' then
    processed_itemcodes := 0;
    remaining_itemcodes := 0;
    inserted_summaries := coalesce((select count(*)::integer from public.ph_hold_stop_itemcode_summaries), 0);
    finished := true;
    return next;
    return;
  end if;

  if v_job_status not in ('ready_summary', 'summarizing') then
    processed_itemcodes := 0;
    remaining_itemcodes := coalesce((select count(*)::integer from public.ph_hold_learning_refresh_itemcodes where job_name = v_job_name and processed_at is not null and summary_processed_at is null), 0);
    inserted_summaries := coalesce((select count(*)::integer from public.ph_hold_stop_itemcode_summaries), 0);
    finished := false;
    return next;
    return;
  end if;

  if v_job_status = 'ready_summary' then
    truncate table public.ph_hold_stop_itemcode_summaries;
    update public.ph_hold_learning_refresh_itemcodes
    set summary_processed_at = null
    where job_name = v_job_name;
    update public.ph_hold_learning_refresh_jobs
    set status = 'summarizing', error_message = null, updated_at = now()
    where job_name = v_job_name;
  end if;

  create temp table tmp_ph_hl_summary_items on commit drop as
  select itemcode
  from public.ph_hold_learning_refresh_itemcodes
  where job_name = v_job_name
    and processed_at is not null
    and summary_processed_at is null
    and error_message is null
  order by itemcode
  limit v_batch_size;

  create unique index on tmp_ph_hl_summary_items (itemcode);
  select count(*)::integer into v_processed from tmp_ph_hl_summary_items;

  if v_processed = 0 then
    update public.ph_hold_learning_refresh_jobs
    set status = 'succeeded',
        finished_at = now(),
        hold_events_upserted = (select count(*)::integer from public.ph_hold_stop_itemcode_snapshots),
        release_cycles_upserted = (select count(*)::integer from public.ph_hold_stop_itemcode_cycles),
        error_message = null,
        updated_at = now()
    where job_name = v_job_name;

    processed_itemcodes := 0;
    remaining_itemcodes := 0;
    inserted_summaries := (select count(*)::integer from public.ph_hold_stop_itemcode_summaries);
    finished := true;
    return next;
    return;
  end if;

  with current_base as (
    select
      nullif(trim(mi.itemcode), '') as itemcode,
      nullif(trim(mi.commonname), '') as commonname,
      nullif(trim(mi.genusname), '') as genus,
      nullif(trim(mi.contsize), '') as contsize,
      upper(nullif(trim(coalesce(mi.holdstopcode, '')), '')) as holdstopcode,
      nullif(trim(mi.holdstopreason), '') as holdstopreason,
      mi.unique_id
    from public.ph_master_inventory mi
    join tmp_ph_hl_summary_items i on i.itemcode = nullif(trim(mi.itemcode), '')
    where nullif(trim(mi.itemcode), '') is not null
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
      c.itemcode,
      count(*)::integer as total_cycle_count,
      count(*) filter (where c.episode_release_date is not null)::integer as released_cycle_count,
      count(*) filter (where c.episode_release_date is null)::integer as open_cycle_count,
      min(c.episode_start_date) as first_episode_start_date,
      max(c.episode_start_date) as last_episode_start_date,
      max(c.episode_release_date) as last_release_date,
      round(avg(c.days_blocked) filter (where c.episode_release_date is not null and c.days_blocked is not null), 2) as avg_days_to_release,
      round((percentile_cont(0.5) within group (order by c.days_blocked) filter (where c.episode_release_date is not null and c.days_blocked is not null))::numeric, 2) as median_days_to_release,
      round(avg(c.gdd_base_50_to_release) filter (where c.episode_release_date is not null and c.gdd_base_50_to_release is not null), 3) as avg_gdd_base_50_to_release,
      round((percentile_cont(0.5) within group (order by c.gdd_base_50_to_release) filter (where c.episode_release_date is not null and c.gdd_base_50_to_release is not null))::numeric, 3) as median_gdd_base_50_to_release,
      (array_agg(c.episode_start_date order by c.episode_start_date desc, c.episode_number desc) filter (where c.episode_release_date is null))[1] as open_episode_start_date,
      (array_agg(c.start_file_name order by c.episode_start_date desc, c.episode_number desc) filter (where c.episode_release_date is null))[1] as open_episode_file_name,
      (array_agg(c.holdstopreason order by c.episode_start_date desc, c.episode_number desc) filter (where c.episode_release_date is null and c.holdstopreason is not null))[1] as open_episode_reason,
      (array_agg(c.hold_reason_category order by c.episode_start_date desc, c.episode_number desc) filter (where c.hold_reason_category is not null))[1] as primary_reason_category
    from public.ph_hold_stop_itemcode_cycles c
    join tmp_ph_hl_summary_items i on i.itemcode = c.itemcode
    where nullif(trim(c.itemcode), '') is not null
    group by c.itemcode
  ),
  profile_stats as (
    select p.itemcode,
      count(*)::integer as profile_count,
      coalesce(sum(p.sample_count), 0)::integer as hold_sample_count
    from public.ph_hold_learning_profiles p
    join tmp_ph_hl_summary_items i on i.itemcode = p.itemcode
    where nullif(trim(p.itemcode), '') is not null
    group by p.itemcode
  ),
  snapshot_stats as (
    select s.itemcode,
      count(distinct s.file_id)::integer as rows_file_count,
      min(s.file_date) as row_history_first_file_date,
      max(s.file_date) as row_history_last_file_date
    from public.ph_hold_stop_itemcode_snapshots s
    join tmp_ph_hl_summary_items i on i.itemcode = s.itemcode
    where nullif(trim(s.itemcode), '') is not null
    group by s.itemcode
  ),
  history_coverage as (
    select
      count(distinct f.file_id)::integer as history_file_count,
      min(coalesce(f.canonical_report_date, f.report_date)) as history_first_file_date,
      max(coalesce(f.canonical_report_date, f.report_date)) as history_last_file_date
    from public.ph_drive_around_report_files f
    where f.status = 'row_indexed'
      and coalesce(f.canonical_report_date, f.report_date) is not null
  ),
  row_history_coverage as (
    select
      count(distinct f.file_id)::integer as parsed_history_file_count,
      min(coalesce(f.canonical_report_date, f.report_date)) as parsed_history_first_file_date,
      max(coalesce(f.canonical_report_date, f.report_date)) as parsed_history_last_file_date
    from public.ph_drive_around_report_files f
    where f.status = 'row_indexed'
      and coalesce(f.canonical_report_date, f.report_date) is not null
  ),
  inserted as (
    insert into public.ph_hold_stop_itemcode_summaries (
      unique_id, itemcode, commonname, genus, contsize, current_rows,
      current_blocked_rows, current_h_rows, current_s_rows, current_is_blocked,
      current_blocked_code, current_holdstopreason, current_holdstopreasons,
      current_reason_category, total_cycle_count, released_cycle_count, open_cycle_count,
      hold_sample_count, profile_count, first_episode_start_date, last_episode_start_date,
      last_release_date, open_episode_start_date, open_episode_file_name, open_episode_reason,
      primary_reason_category, avg_days_to_release, median_days_to_release,
      avg_gdd_base_50_to_release, median_gdd_base_50_to_release,
      history_first_file_date, history_last_file_date, history_file_count,
      parsed_history_first_file_date, parsed_history_last_file_date, parsed_history_file_count,
      rows_file_count, row_history_first_file_date, row_history_last_file_date, updated_at, snapshot
    )
    select
      'hold_stop_itemcode_summary_' || encode(digest(i.itemcode, 'sha256'), 'hex') as unique_id,
      i.itemcode,
      coalesce(cs.commonname, (array_agg(cy.commonname order by cy.episode_start_date desc) filter (where cy.commonname is not null))[1]) as commonname,
      coalesce(cs.genus, (array_agg(cy.genus order by cy.episode_start_date desc) filter (where cy.genus is not null))[1]) as genus,
      coalesce(cs.contsize, (array_agg(cy.contsize order by cy.episode_start_date desc) filter (where cy.contsize is not null))[1]) as contsize,
      coalesce(cs.current_rows, 0),
      coalesce(cs.current_blocked_rows, 0),
      coalesce(cs.current_h_rows, 0),
      coalesce(cs.current_s_rows, 0),
      coalesce(cs.current_is_blocked, false),
      cs.current_blocked_code,
      cs.current_holdstopreason,
      coalesce(cs.current_holdstopreasons, '{}'::text[]),
      case when coalesce(cs.current_is_blocked, false) then public.v2_classify_hold_reason(coalesce(cs.current_holdstopreason, '')) else null end,
      coalesce(cst.total_cycle_count, 0),
      coalesce(cst.released_cycle_count, 0),
      coalesce(cst.open_cycle_count, 0),
      coalesce(ps.hold_sample_count, 0),
      coalesce(ps.profile_count, 0),
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
      coalesce(hc.history_file_count, 0),
      rhc.parsed_history_first_file_date,
      rhc.parsed_history_last_file_date,
      coalesce(rhc.parsed_history_file_count, 0),
      coalesce(ss.rows_file_count, 0),
      ss.row_history_first_file_date,
      ss.row_history_last_file_date,
      now(),
      jsonb_build_object('source','ph_refresh_hold_learning_summary_batch','current_status_source','ph_master_inventory','cycle_source','ph_hold_stop_itemcode_cycles','history_file_count',coalesce(hc.history_file_count,0),'parsed_history_file_count',coalesce(rhc.parsed_history_file_count,0),'rows_file_count',coalesce(ss.rows_file_count,0))
    from tmp_ph_hl_summary_items i
    left join current_status cs on cs.itemcode = i.itemcode
    left join cycle_stats cst on cst.itemcode = i.itemcode
    left join profile_stats ps on ps.itemcode = i.itemcode
    left join snapshot_stats ss on ss.itemcode = i.itemcode
    cross join history_coverage hc
    cross join row_history_coverage rhc
    left join public.ph_hold_stop_itemcode_cycles cy on cy.itemcode = i.itemcode
    group by i.itemcode, cs.commonname, cs.genus, cs.contsize, cs.current_rows,
      cs.current_blocked_rows, cs.current_h_rows, cs.current_s_rows, cs.current_is_blocked,
      cs.current_blocked_code, cs.current_holdstopreason, cs.current_holdstopreasons,
      cst.total_cycle_count, cst.released_cycle_count, cst.open_cycle_count,
      cst.first_episode_start_date, cst.last_episode_start_date, cst.last_release_date,
      cst.open_episode_start_date, cst.open_episode_file_name, cst.open_episode_reason,
      cst.primary_reason_category, cst.avg_days_to_release, cst.median_days_to_release,
      cst.avg_gdd_base_50_to_release, cst.median_gdd_base_50_to_release,
      ps.hold_sample_count, ps.profile_count, hc.history_first_file_date,
      hc.history_last_file_date, hc.history_file_count, rhc.parsed_history_first_file_date,
      rhc.parsed_history_last_file_date, rhc.parsed_history_file_count,
      ss.rows_file_count, ss.row_history_first_file_date, ss.row_history_last_file_date
    on conflict (itemcode) do update set
      commonname = excluded.commonname,
      genus = excluded.genus,
      contsize = excluded.contsize,
      current_rows = excluded.current_rows,
      current_blocked_rows = excluded.current_blocked_rows,
      current_h_rows = excluded.current_h_rows,
      current_s_rows = excluded.current_s_rows,
      current_is_blocked = excluded.current_is_blocked,
      current_blocked_code = excluded.current_blocked_code,
      current_holdstopreason = excluded.current_holdstopreason,
      current_holdstopreasons = excluded.current_holdstopreasons,
      current_reason_category = excluded.current_reason_category,
      total_cycle_count = excluded.total_cycle_count,
      released_cycle_count = excluded.released_cycle_count,
      open_cycle_count = excluded.open_cycle_count,
      hold_sample_count = excluded.hold_sample_count,
      profile_count = excluded.profile_count,
      first_episode_start_date = excluded.first_episode_start_date,
      last_episode_start_date = excluded.last_episode_start_date,
      last_release_date = excluded.last_release_date,
      open_episode_start_date = excluded.open_episode_start_date,
      open_episode_file_name = excluded.open_episode_file_name,
      open_episode_reason = excluded.open_episode_reason,
      primary_reason_category = excluded.primary_reason_category,
      avg_days_to_release = excluded.avg_days_to_release,
      median_days_to_release = excluded.median_days_to_release,
      avg_gdd_base_50_to_release = excluded.avg_gdd_base_50_to_release,
      median_gdd_base_50_to_release = excluded.median_gdd_base_50_to_release,
      history_first_file_date = excluded.history_first_file_date,
      history_last_file_date = excluded.history_last_file_date,
      history_file_count = excluded.history_file_count,
      parsed_history_first_file_date = excluded.parsed_history_first_file_date,
      parsed_history_last_file_date = excluded.parsed_history_last_file_date,
      parsed_history_file_count = excluded.parsed_history_file_count,
      rows_file_count = excluded.rows_file_count,
      row_history_first_file_date = excluded.row_history_first_file_date,
      row_history_last_file_date = excluded.row_history_last_file_date,
      updated_at = excluded.updated_at,
      snapshot = excluded.snapshot
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  update public.ph_hold_learning_refresh_itemcodes w
  set summary_processed_at = now()
  from tmp_ph_hl_summary_items i
  where w.job_name = v_job_name and w.itemcode = i.itemcode;

  select count(*)::integer into v_remaining
  from public.ph_hold_learning_refresh_itemcodes
  where job_name = v_job_name
    and processed_at is not null
    and summary_processed_at is null
    and error_message is null;

  update public.ph_hold_learning_refresh_jobs
  set status = 'summarizing', updated_at = now()
  where job_name = v_job_name;

  processed_itemcodes := v_processed;
  remaining_itemcodes := v_remaining;
  inserted_summaries := v_inserted;
  finished := false;
  return next;
exception when others then
  update public.ph_hold_learning_refresh_jobs
  set status = 'failed', error_message = sqlerrm, finished_at = now(), updated_at = now()
  where job_name = v_job_name;
  raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ph_start_hold_learning_refresh_chunked(p_job_name text DEFAULT 'drivearound_history_learning_refresh'::text, p_item_batch_size integer DEFAULT 200, p_summary_batch_size integer DEFAULT 1000)
 RETURNS TABLE(job_name text, itemcode_count integer, item_job_id bigint, summary_job_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_job_name text := coalesce(nullif(trim(p_job_name), ''), 'drivearound_history_learning_refresh');
  v_item_batch integer := greatest(1, least(coalesce(p_item_batch_size, 200), 250));
  v_summary_batch integer := greatest(1, least(coalesce(p_summary_batch_size, 1000), 1000));
  v_count integer := 0;
  v_item_job bigint;
  v_summary_job bigint;
begin
  select p.itemcode_count into v_count
  from public.ph_prepare_hold_learning_refresh_chunked(v_job_name) p;

  perform cron.unschedule('ph_hold_learning_refresh_batch')
  where exists (select 1 from cron.job where jobname = 'ph_hold_learning_refresh_batch');
  perform cron.unschedule('ph_hold_learning_summary_batch')
  where exists (select 1 from cron.job where jobname = 'ph_hold_learning_summary_batch');

  select cron.schedule(
    'ph_hold_learning_refresh_batch',
    '* * * * *',
    format('select * from public.ph_refresh_hold_learning_itemcode_batch(%L, %s);', v_job_name, v_item_batch)
  ) into v_item_job;

  select cron.schedule(
    'ph_hold_learning_summary_batch',
    '* * * * *',
    format('select * from public.ph_refresh_hold_learning_summary_batch(%L, %s);', v_job_name, v_summary_batch)
  ) into v_summary_job;

  job_name := v_job_name;
  itemcode_count := coalesce(v_count, 0);
  item_job_id := v_item_job;
  summary_job_id := v_summary_job;
  return next;
end;
$function$;
