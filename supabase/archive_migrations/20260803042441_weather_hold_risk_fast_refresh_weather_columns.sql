create or replace function public.ph_refresh_hold_stop_itemcode_cycles_fast(
  p_start_date date default null,
  p_end_date date default null
)
returns table(snapshot_rows integer, itemcode_cycles integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start_date date;
  v_end_date date;
  v_snapshot_rows integer := 0;
  v_cycle_rows integer := 0;
begin
  select coalesce(p_start_date, min(report_date)), coalesce(p_end_date, max(report_date))
    into v_start_date, v_end_date
  from public.ph_drive_around_report_rows
  where report_date is not null;

  truncate table public.ph_hold_stop_itemcode_snapshots;
  truncate table public.ph_hold_stop_itemcode_cycles;

  if v_start_date is null or v_end_date is null then
    perform public.ph_refresh_hold_stop_itemcode_summaries();
    snapshot_rows := 0;
    itemcode_cycles := 0;
    return next;
    return;
  end if;

  create temp table tmp_ph_hs_files on commit drop as
  with row_files as (
    select file_id, min(report_date) as report_date, min(file_name) as file_name
    from public.ph_drive_around_report_rows
    where report_date between v_start_date and v_end_date
    group by file_id
  )
  select
    rf.file_id,
    coalesce(f.canonical_report_date, f.report_date, rf.report_date) as file_date,
    coalesce(nullif(trim(f.canonical_file_name), ''), nullif(trim(f.file_name), ''), rf.file_name) as file_name,
    f.canonical_sequence,
    row_number() over (
      order by coalesce(f.canonical_report_date, f.report_date, rf.report_date), coalesce(f.canonical_sequence, 0), coalesce(nullif(trim(f.canonical_file_name), ''), nullif(trim(f.file_name), ''), rf.file_name), rf.file_id
    )::integer as file_rank
  from row_files rf
  left join public.ph_drive_around_report_files f on f.file_id = rf.file_id
  where coalesce(f.canonical_report_date, f.report_date, rf.report_date) between v_start_date and v_end_date;

  create index on tmp_ph_hs_files (file_id);

  insert into public.ph_hold_stop_itemcode_snapshots (
    unique_id, itemcode, file_id, file_name, file_date, canonical_sequence, file_rank,
    commonname, genus, contsize, total_row_count, h_row_count, s_row_count,
    blocked_row_count, blank_row_count, is_blocked, first_blocked_code,
    blocked_codes, observed_holdstopcodes, holdstopreason, holdstopreasons,
    hold_reason_category, hold_reason_categories, source_row_ids, snapshot
  )
  with source_rows as (
    select
      upper(trim(r.itemcode)) as itemcode,
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
    from public.ph_drive_around_report_rows r
    join tmp_ph_hs_files f on f.file_id = r.file_id
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
    jsonb_build_object('refresh_mode','fast_itemcode','itemcode',itemcode,'file_id',file_id,'file_rank',file_rank,'blocked_row_count',blocked_row_count)
  from grouped;

  get diagnostics v_snapshot_rows = row_count;

  create temp table tmp_ph_hs_starts on commit drop as
  with ordered as (
    select s.*, lag(is_blocked, 1, false) over (partition by itemcode order by file_rank) as previous_is_blocked
    from public.ph_hold_stop_itemcode_snapshots s
  )
  select itemcode, file_rank, row_number() over (partition by itemcode order by file_rank)::integer as episode_number
  from ordered
  where is_blocked and not previous_is_blocked;

  create index on tmp_ph_hs_starts (itemcode, file_rank);

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
    jsonb_build_object('refresh_mode','fast_itemcode','itemcode',ss.itemcode,'episode_number',st.episode_number,'start_file_rank',ss.file_rank,'release_file_rank',rel.file_rank)
  from tmp_ph_hs_starts st
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
  perform public.ph_refresh_hold_stop_itemcode_summaries();

  snapshot_rows := v_snapshot_rows;
  itemcode_cycles := v_cycle_rows;
  return next;
end;
$$;

revoke all on function public.ph_refresh_hold_stop_itemcode_cycles_fast(date, date) from public, anon, authenticated;
grant execute on function public.ph_refresh_hold_stop_itemcode_cycles_fast(date, date) to service_role;
