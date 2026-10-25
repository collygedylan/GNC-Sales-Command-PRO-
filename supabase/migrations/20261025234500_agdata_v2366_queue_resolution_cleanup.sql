begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(hashtextextended('agdata-v2366-queue-resolution-cleanup', 0));

lock table public.ph_reclass_recount_jobs,
  public.ph_reclass_recount_lines,
  bunch_note_private.jobs,
  bunch_note_private.bunch_note_work_cards,
  public.ph_sales_office
in share row exclusive mode;
lock table public.ph_request_delivery_outbox in share mode;

create temporary table queue_cleanup_recount_jobs_v2366 on commit drop as
select job.id
from public.ph_reclass_recount_jobs job
where job.status = 'pending';

alter table queue_cleanup_recount_jobs_v2366 add primary key (id);

create temporary table queue_cleanup_bunch_jobs_v2366 on commit drop as
select job.id
from bunch_note_private.jobs job
where job.status = 'open';

alter table queue_cleanup_bunch_jobs_v2366 add primary key (id);

create temporary table queue_cleanup_master_recounts_v2366 on commit drop as
select master.unique_id
from public.ph_master_inventory master
where lower(btrim(coalesce(master.app_tab_assignment, ''))) like '%recount%'
  and lower(btrim(coalesce(master.app_tab_assignment, ''))) like '%inventory%';

alter table queue_cleanup_master_recounts_v2366 add primary key (unique_id);

create temporary table queue_cleanup_sales_recounts_v2366 on commit drop as
with candidates as (
  select sales.unique_id,
    concat_ws(E'\n', sales.sales_note, sales.av_note) as note_text,
    coalesce(
      private.reclass_numeric_v1(sales.move_actual_qty::text),
      private.reclass_numeric_v1(sales.order_qty::text),
      0
    ) + coalesce(private.reclass_numeric_v1(sales.order_reserve::text), 0) as moved_total,
    coalesce(
      private.reclass_numeric_v1((regexp_match(
        concat_ws(E'\n', sales.sales_note, sales.av_note),
        'PTR\s+On\s+Hand\s+(-?[0-9]+(?:\.[0-9]+)?)',
        'i'
      ))[1]),
      private.reclass_numeric_v1(sales.ptravailable::text)
    ) as comparison_total
  from public.ph_sales_office sales
  where lower(btrim(coalesce(sales.so_source, ''))) in ('move', 'moves')
    and lower(btrim(coalesce(sales.order_status, ''))) in ('inventory office', 'pending review', 'pending')
)
select candidate.unique_id
from candidates candidate
where candidate.note_text ~* 'recount\s+required|move\s+overage|over\s+planned|over\s+ptr'
  or candidate.comparison_total is not null
    and candidate.moved_total > candidate.comparison_total;

alter table queue_cleanup_sales_recounts_v2366 add primary key (unique_id);

do $cleanup$
declare
  cleanup_at timestamptz := clock_timestamp();
  expected_request_ids text[] := array[
    'REQ-mvk1xgv2ty9fttuqj2',
    'REQ-mvlbp5hkkk58akaubms',
    'REQ-mvlfib5eqwa3typzcqq',
    'REQ-mvlfib5evawvlvvx09',
    'REQ-mvlg4t85vlzf7053pv',
    'REQ-mvlgbfl7p8r8zxrj97j'
  ];
  recount_target_count bigint;
  recount_line_count bigint;
  recount_history_count bigint;
  bunch_target_count bigint;
  bunch_card_count bigint;
  bunch_history_count bigint;
  master_target_count bigint;
  sales_target_count bigint;
  request_count bigint;
  request_hash text;
  suspend_count bigint;
  suspend_hash text;
  preview_hash text;
  bunch_count_hash text;
  request_outbox_count bigint;
  delivery_outbox_count bigint;
begin
  select count(*) into recount_target_count from queue_cleanup_recount_jobs_v2366;
  select count(*) into recount_line_count
  from public.ph_reclass_recount_lines line
  join queue_cleanup_recount_jobs_v2366 target on target.id = line.job_id;
  select count(*) into recount_history_count from public.ph_recount_history;
  select count(*) into bunch_target_count from queue_cleanup_bunch_jobs_v2366;
  select count(*) into bunch_card_count
  from bunch_note_private.bunch_note_work_cards card
  join bunch_note_private.bunch_notes note on note.id = card.bunch_note_id
  join queue_cleanup_bunch_jobs_v2366 target on target.id = note.job_id;
  select count(*) into bunch_history_count from public.ph_bunch_notes_history;
  select count(*) into master_target_count from queue_cleanup_master_recounts_v2366;
  select count(*) into sales_target_count from queue_cleanup_sales_recounts_v2366;

  select count(*), md5(coalesce(string_agg(to_jsonb(request_row)::text, E'\n' order by request_row.unique_id), ''))
  into request_count, request_hash
  from public.ph_requests_pending request_row;

  select count(*), md5(coalesce(string_agg(to_jsonb(suspend_row)::text, E'\n' order by suspend_row.unique_id), ''))
  into suspend_count, suspend_hash
  from public.ph_soc_master suspend_row
  where suspend_row.commonname = 'Pink Delight Butterfly Bush'
    and suspend_row.locationcode = 'D.26.000';

  select md5(coalesce(string_agg(to_jsonb(preview)::text, E'\n' order by preview.id), ''))
  into preview_hash
  from bunch_note_private.previews preview
  join queue_cleanup_bunch_jobs_v2366 target on target.id = preview.job_id;

  select md5(coalesce(string_agg(to_jsonb(bunch_count)::text, E'\n' order by bunch_count.unique_id), ''))
  into bunch_count_hash
  from public.ph_bunch_counts bunch_count;

  select count(*) into request_outbox_count from public.ph_request_delivery_outbox;
  select count(*) into delivery_outbox_count from public.ph_delivery_outbox;

  if recount_target_count + bunch_target_count + master_target_count + sales_target_count > 0 then
    if request_count <> 6 or (
      select count(*) from public.ph_active_request active_request
      where active_request.unique_id = any(expected_request_ids)
    ) <> 6 then
      raise exception 'QUEUE_CLEANUP_REQUEST_GUARD_FAILED';
    end if;
    if suspend_count < 1 then
      raise exception 'QUEUE_CLEANUP_SUSPEND_GUARD_FAILED';
    end if;
  end if;

  insert into public.ph_ncr_completions(
    source_unique_id, itemcode, locationcode, completed_by, completed_at, emailed_jd
  )
  select distinct line.source_unique_id, line.itemcode, line.locationcode,
    'dylan_collyge', cleanup_at, false
  from public.ph_reclass_recount_lines line
  join queue_cleanup_recount_jobs_v2366 target on target.id = line.job_id
  where nullif(btrim(line.source_unique_id), '') is not null
  on conflict(source_unique_id) do nothing;

  insert into public.ph_ncr_completions(
    source_unique_id, itemcode, locationcode, completed_by, completed_at, emailed_jd
  )
  select master.unique_id, master.itemcode, master.locationcode,
    'dylan_collyge', cleanup_at, false
  from public.ph_master_inventory master
  join queue_cleanup_master_recounts_v2366 target on target.unique_id = master.unique_id
  on conflict(source_unique_id) do nothing;

  insert into public.ph_ncr_completions(
    source_unique_id, itemcode, locationcode, completed_by, completed_at, emailed_jd
  )
  select coalesce(nullif(btrim(sales.master_id), ''), sales.unique_id),
    sales.itemcode, sales.locationcode, 'dylan_collyge', cleanup_at, false
  from public.ph_sales_office sales
  join queue_cleanup_sales_recounts_v2366 target on target.unique_id = sales.unique_id
  on conflict(source_unique_id) do nothing;

  update public.ph_reclass_recount_jobs job
  set status = 'completed',
    completed_by_username = 'dylan_collyge',
    completed_at = coalesce(job.completed_at, cleanup_at),
    updated_at = cleanup_at
  from queue_cleanup_recount_jobs_v2366 target
  where job.id = target.id;

  update public.ph_master_inventory master
  set app_tab_assignment = 'recount_complete'
  from queue_cleanup_master_recounts_v2366 target
  where master.unique_id = target.unique_id;

  update public.ph_sales_office sales
  set order_status = 'Completed',
    workflow_status = 'completed',
    state_revision = coalesce(sales.state_revision, 0) + 1,
    completed_by = coalesce(nullif(btrim(sales.completed_by), ''), 'dylan_collyge'),
    completed_at = coalesce(sales.completed_at, cleanup_at),
    updated_at = cleanup_at
  from queue_cleanup_sales_recounts_v2366 target
  where sales.unique_id = target.unique_id;

  perform set_config('bunch_note.card_command', 'on', true);

  update bunch_note_private.bunch_note_work_cards card
  set status = case when card.status = 'open' then 'retired' else card.status end,
    active = false,
    revision = card.revision + 1,
    updated_at = cleanup_at
  from bunch_note_private.bunch_notes note,
    queue_cleanup_bunch_jobs_v2366 target
  where note.id = card.bunch_note_id
    and target.id = note.job_id
    and card.active;

  update bunch_note_private.count_reviews review
  set status = 'resolved',
    revision = review.revision + 1,
    updated_at = cleanup_at,
    resolved_at = coalesce(review.resolved_at, cleanup_at)
  from queue_cleanup_bunch_jobs_v2366 target
  where review.job_id = target.id
    and review.status <> 'resolved';

  update bunch_note_private.jobs job
  set status = 'cancelled',
    revision = job.revision + 1,
    updated_at = cleanup_at
  from queue_cleanup_bunch_jobs_v2366 target
  where job.id = target.id;

  if exists(select 1 from public.ph_active_recount) then
    raise exception 'QUEUE_CLEANUP_RECOUNT_ACTIVE_ROWS_REMAIN';
  end if;
  if exists(select 1 from public.ph_active_bunch_notes) then
    raise exception 'QUEUE_CLEANUP_BUNCH_ACTIVE_ROWS_REMAIN';
  end if;
  if exists(
    select 1
    from bunch_note_private.bunch_note_work_cards card
    join bunch_note_private.bunch_notes note on note.id = card.bunch_note_id
    join bunch_note_private.jobs job on job.id = note.job_id
    where card.active and card.status = 'open' and job.status = 'open'
  ) then
    raise exception 'QUEUE_CLEANUP_BUNCH_ACTIVE_CARDS_REMAIN';
  end if;
  if exists(
    select 1
    from public.ph_sales_office sales
    join queue_cleanup_sales_recounts_v2366 target on target.unique_id = sales.unique_id
    where lower(btrim(coalesce(sales.order_status, ''))) in ('inventory office', 'pending review', 'pending')
  ) then
    raise exception 'QUEUE_CLEANUP_SALES_RECOUNT_REMAINED';
  end if;
  if exists(
    select 1
    from public.ph_master_inventory master
    join queue_cleanup_master_recounts_v2366 target on target.unique_id = master.unique_id
    where lower(btrim(coalesce(master.app_tab_assignment, ''))) like '%inventory%'
  ) then
    raise exception 'QUEUE_CLEANUP_MASTER_RECOUNT_REMAINED';
  end if;
  if exists(
    select 1
    from public.ph_reclass_recount_lines line
    join queue_cleanup_recount_jobs_v2366 target on target.id = line.job_id
    left join public.ph_ncr_completions completion on completion.source_unique_id = line.source_unique_id
    where completion.source_unique_id is null
  ) then
    raise exception 'QUEUE_CLEANUP_RECOUNT_COMPLETION_MISSING';
  end if;
  if (select count(*) from public.ph_recount_history) <> recount_history_count + recount_target_count then
    raise exception 'QUEUE_CLEANUP_RECOUNT_HISTORY_MISMATCH';
  end if;
  if (select count(*) from public.ph_bunch_notes_history) <> bunch_history_count + bunch_target_count then
    raise exception 'QUEUE_CLEANUP_BUNCH_HISTORY_MISMATCH';
  end if;
  if (
    select count(*)
    from public.ph_reclass_recount_lines line
    join queue_cleanup_recount_jobs_v2366 target on target.id = line.job_id
  ) <> recount_line_count then
    raise exception 'QUEUE_CLEANUP_RECOUNT_LINES_CHANGED';
  end if;
  if (
    select count(*)
    from bunch_note_private.bunch_note_work_cards card
    join bunch_note_private.bunch_notes note on note.id = card.bunch_note_id
    join queue_cleanup_bunch_jobs_v2366 target on target.id = note.job_id
  ) <> bunch_card_count then
    raise exception 'QUEUE_CLEANUP_BUNCH_CARDS_CHANGED';
  end if;
  if (
    select md5(coalesce(string_agg(to_jsonb(preview)::text, E'\n' order by preview.id), ''))
    from bunch_note_private.previews preview
    join queue_cleanup_bunch_jobs_v2366 target on target.id = preview.job_id
  ) is distinct from preview_hash then
    raise exception 'QUEUE_CLEANUP_BUNCH_PREVIEWS_CHANGED';
  end if;
  if (
    select md5(coalesce(string_agg(to_jsonb(bunch_count)::text, E'\n' order by bunch_count.unique_id), ''))
    from public.ph_bunch_counts bunch_count
  ) is distinct from bunch_count_hash then
    raise exception 'QUEUE_CLEANUP_BUNCH_COUNTS_CHANGED';
  end if;
  if (
    select count(*) from public.ph_requests_pending
  ) <> request_count or (
    select md5(coalesce(string_agg(to_jsonb(request_row)::text, E'\n' order by request_row.unique_id), ''))
    from public.ph_requests_pending request_row
  ) is distinct from request_hash then
    raise exception 'QUEUE_CLEANUP_REQUEST_DATA_CHANGED';
  end if;
  if (
    select count(*)
    from public.ph_soc_master suspend_row
    where suspend_row.commonname = 'Pink Delight Butterfly Bush'
      and suspend_row.locationcode = 'D.26.000'
  ) <> suspend_count or (
    select md5(coalesce(string_agg(to_jsonb(suspend_row)::text, E'\n' order by suspend_row.unique_id), ''))
    from public.ph_soc_master suspend_row
    where suspend_row.commonname = 'Pink Delight Butterfly Bush'
      and suspend_row.locationcode = 'D.26.000'
  ) is distinct from suspend_hash then
    raise exception 'QUEUE_CLEANUP_SUSPEND_DATA_CHANGED';
  end if;
  if (select count(*) from public.ph_request_delivery_outbox) <> request_outbox_count
    or (select count(*) from public.ph_delivery_outbox) <> delivery_outbox_count then
    raise exception 'QUEUE_CLEANUP_OUTBOX_CHANGED';
  end if;
end
$cleanup$;

comment on view public.ph_recount_history is
  'Completed Recount jobs, including the silent queue-resolution cleanup retained by queue-resolution-cleanup-v2366.';
comment on view public.ph_bunch_notes_history is
  'Completed and cancelled Bunch Note jobs, including the silent queue-resolution cleanup retained by queue-resolution-cleanup-v2366.';

commit;
