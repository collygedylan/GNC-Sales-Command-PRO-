begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create schema if not exists private;

do $retire_legacy_directory$
declare
  relation_kind "char";
begin
  select c.relkind into relation_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = '00_app_view_table_map';

  if relation_kind in ('r', 'p') and to_regclass('private.app_view_table_map_legacy_v2363') is null then
    alter table public."00_app_view_table_map" set schema private;
    alter table private."00_app_view_table_map" rename to app_view_table_map_legacy_v2363;
  elsif relation_kind = 'v' and to_regclass('private.app_view_table_map_legacy_v2363') is null then
    alter view public."00_app_view_table_map" set schema private;
    alter view private."00_app_view_table_map" rename to app_view_table_map_legacy_v2363;
  end if;
end
$retire_legacy_directory$;

create table if not exists public.ph_00_table_directory (
  sort_order integer primary key,
  module_or_view text not null,
  active_table text not null,
  history_table text not null,
  support_or_outbox_table text,
  what_it_does_and_lifecycle_rules text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ph_active_location_moves
  (like public.ph_requests_pending including all);
create table if not exists public.ph_location_moves_history
  (like public.ph_requests_completed_history including all);
create table if not exists public.ph_eval_work_history
  (like public.ph_requests_completed_history including all);

insert into public.ph_location_moves_history overriding system value
select history.*
from public.ph_requests_completed_history history
where history.unique_id like 'move_req_%'
on conflict (unique_id) do nothing;

insert into public.ph_active_location_moves overriding system value
select pending.*
from public.ph_requests_pending pending
where pending.unique_id like 'move_req_%'
  and not exists (
    select 1
    from public.ph_requests_completed_history history
    where history.unique_id = pending.unique_id
  )
on conflict (unique_id) do nothing;

insert into public.ph_eval_work_history overriding system value
select history.*
from public.ph_requests_completed_history history
where history.unique_id like 'EVAL-%'
on conflict (unique_id) do nothing;

delete from public.ph_requests_pending
where unique_id like 'move_req_%' or unique_id like 'EVAL-%';

delete from public.ph_requests_completed_history
where unique_id like 'move_req_%' or unique_id like 'EVAL-%';

with eligible as materialized (
  select retired.*
  from private.ph_active_request_retirement_v2361 retired
  where retired.unique_id like 'REQ-%'
    and coalesce(private.try_timestamptz(retired.row_snapshot->>'created_at'), retired.retired_at)
      >= timestamptz '2026-10-22 00:00:00 America/Chicago'
    and not exists (
      select 1
      from public.ph_request_delivery_outbox completed
      where lower(btrim(coalesce(completed.event_type, ''))) in ('request_completed', 'plant request completed!')
        and (
          completed.request_id = retired.unique_id
          or completed.payload->>'request_id' = retired.unique_id
          or (jsonb_typeof(completed.payload->'request_ids') = 'array' and completed.payload->'request_ids' ? retired.unique_id)
        )
    )
    and not exists (
      select 1
      from public.ph_requests_completed_history history
      where history.unique_id = retired.unique_id
        and (
            history.date_completed is not null
          or lower(btrim(coalesce(history.req_status, ''))) in ('complete', 'completed', 'fulfilled', 'archived', 'closed')
        )
        and nullif(btrim(coalesce(history.photo_url, history.req_photo_link, '')), '') is not null
        and nullif(btrim(coalesce(history.spec, history.request_spec, history.req_spec, history.desired_spec, '')), '') is not null
    )
), restored as materialized (
  select jsonb_populate_record(
    null::public.ph_requests_pending,
    eligible.row_snapshot || jsonb_build_object(
      'id', nextval(pg_get_serial_sequence('public.ph_requests_pending', 'id')),
      'unique_id', eligible.unique_id,
      'req_archived', false,
      'req_status', 'Pending',
      'status', 'Pending',
      'date_completed', null,
      'completed_by_username', null,
      'completed_by_display', null,
      'completed_by_email', null,
      'move_completed_at', null,
      'move_completed_by', null,
      'photos', case when jsonb_typeof(eligible.row_snapshot->'photos') = 'array' then eligible.row_snapshot->'photos' else '[]'::jsonb end,
      'recipient_emails', case when jsonb_typeof(eligible.row_snapshot->'recipient_emails') = 'array' then eligible.row_snapshot->'recipient_emails' else '[]'::jsonb end,
      'source_snapshot', case when jsonb_typeof(eligible.row_snapshot->'source_snapshot') = 'object' then eligible.row_snapshot->'source_snapshot' else eligible.row_snapshot end,
      'fulfillment_status', 'Pending',
      'fulfilled_qty', null,
      'fulfilled_by', null,
      'fulfillment_updated_at', null,
      'updated_at', clock_timestamp(),
      'row_version', case
        when coalesce(eligible.row_snapshot->>'row_version', '') ~ '^[0-9]{1,18}$'
          then greatest((eligible.row_snapshot->>'row_version')::bigint, 1)
        else 1
      end,
      'request_source', coalesce(nullif(eligible.row_snapshot->>'request_source', ''), 'retirement_recovery_v2363')
    )
  ) request_row
  from eligible
)
insert into public.ph_requests_pending overriding system value
select (restored.request_row).*
from restored
on conflict (unique_id) do nothing;

do $pending_request_constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ph_requests_pending'::regclass
      and conname = 'ph_requests_pending_sales_request_only_v2363'
  ) then
    alter table public.ph_requests_pending
      add constraint ph_requests_pending_sales_request_only_v2363
      check (unique_id not like 'move_req_%' and unique_id not like 'EVAL-%') not valid;
  end if;
  alter table public.ph_requests_pending
    validate constraint ph_requests_pending_sales_request_only_v2363;
end
$pending_request_constraint$;

alter table public.ph_active_location_moves enable row level security;
alter table public.ph_location_moves_history enable row level security;
alter table public.ph_eval_work_history enable row level security;
revoke all on public.ph_active_location_moves, public.ph_location_moves_history,
  public.ph_eval_work_history from public, anon, authenticated;
grant select, insert, update, delete on public.ph_active_location_moves,
  public.ph_location_moves_history, public.ph_eval_work_history to service_role;

insert into public.ph_chat_conversations(
  id, title, is_group, created_by, created_at, updated_at, last_message_at
)
select thread.id, thread.thread_name, coalesce(thread.is_group, false), 'legacy',
  coalesce(thread.created_at, now()), coalesce(thread.last_message_at, thread.created_at, now()),
  thread.last_message_at
from public.ph_chat_threads thread
where not exists (
  select 1 from public.ph_chat_conversations conversation where conversation.id = thread.id
);

insert into public.ph_chat_participants(
  conversation_id, username, joined_at, last_read_at
)
select member.thread_id, member.username, coalesce(member.last_read_at, now()), member.last_read_at
from public.ph_chat_members member
where member.thread_id is not null
  and exists (select 1 from public.ph_chat_conversations conversation where conversation.id = member.thread_id)
  and not exists (
    select 1 from public.ph_chat_participants participant
    where participant.conversation_id = member.thread_id
      and lower(btrim(participant.username)) = lower(btrim(member.username))
  );

do $retire_chat_tables$
begin
  if to_regclass('public.ph_chat_threads') is not null
     and to_regclass('private.ph_chat_threads_legacy_v2363') is null then
    alter table public.ph_chat_threads set schema private;
    alter table private.ph_chat_threads rename to ph_chat_threads_legacy_v2363;
  end if;
  if to_regclass('public.ph_chat_members') is not null
     and to_regclass('private.ph_chat_members_legacy_v2363') is null then
    alter table public.ph_chat_members set schema private;
    alter table private.ph_chat_members rename to ph_chat_members_legacy_v2363;
  end if;
  if to_regclass('public.ph_hold_learning_cursors') is not null
     and to_regclass('private.ph_hold_learning_cursors_legacy_v2363') is null then
    alter table public.ph_hold_learning_cursors set schema private;
    alter table private.ph_hold_learning_cursors rename to ph_hold_learning_cursors_legacy_v2363;
  end if;
end
$retire_chat_tables$;

create or replace view public."00_app_view_table_map" with (security_invoker = true) as
select * from private.app_view_table_map_legacy_v2363;
create or replace view public.ph_chat_threads with (security_invoker = true) as
select * from private.ph_chat_threads_legacy_v2363;
create or replace view public.ph_chat_members with (security_invoker = true) as
select * from private.ph_chat_members_legacy_v2363;
create or replace view public.ph_hold_learning_cursors with (security_invoker = true) as
select * from private.ph_hold_learning_cursors_legacy_v2363;

create or replace view public.ph_active_request with (security_invoker = true) as
select * from public.ph_requests_pending where unique_id like 'REQ-%'
with local check option;
create or replace view public.ph_request_history with (security_invoker = true) as
select * from public.ph_requests_completed_history
where unique_id not like 'move_req_%' and unique_id not like 'EVAL-%'
with local check option;
create or replace view public.ph_active_drive_mode with (security_invoker = true) as
select * from public.ph_master_inventory;
create or replace view public.ph_drive_mode_history with (security_invoker = true) as
select * from public.ph_drive_around_report_rows;
create or replace view public.ph_active_suspend with (security_invoker = true) as
select * from public.ph_soc_master;
create or replace view public.ph_suspend_history with (security_invoker = true) as
select * from public.ph_productivity_history
where lower(coalesce(source_kind, '')) like '%suspend%'
   or lower(coalesce(source_table, '')) like '%suspend%';

create or replace view public.ph_active_recount with (security_invoker = true) as
with ranked as (
  select job.*,
    row_number() over (
      partition by upper(btrim(job.itemcode)), upper(btrim(job.locationcode))
      order by job.requested_at, job.created_at, job.id
    ) as identity_rank
  from public.ph_reclass_recount_jobs job
  where job.status = 'pending'
)
select job.id, job.source_event_id, job.itemcode,
  coalesce(
    nullif(btrim(case when lower(btrim(job.commonname)) = 'unknown' then '' else job.commonname end), ''),
    (select nullif(btrim(master.commonname), '') from public.ph_master_inventory master
      where upper(btrim(master.itemcode)) = upper(btrim(job.itemcode))
        and nullif(btrim(master.commonname), '') is not null limit 1),
    (select nullif(btrim(history.commonname), '') from public.ph_historical_inventory_dimensions history
      where upper(btrim(history.itemcode)) = upper(btrim(job.itemcode))
        and nullif(btrim(history.commonname), '') is not null limit 1),
    (select nullif(btrim(master.commonname), '') from public.ph_master_inventory master
      where left(regexp_replace(master.itemcode, '[^0-9]', '', 'g'), 6)
        = left(regexp_replace(job.itemcode, '[^0-9]', '', 'g'), 6)
        and nullif(btrim(master.commonname), '') is not null
      order by master.itemcode limit 1),
    (select nullif(btrim(history.commonname), '') from public.ph_historical_inventory_dimensions history
      where left(regexp_replace(history.itemcode, '[^0-9]', '', 'g'), 6)
        = left(regexp_replace(job.itemcode, '[^0-9]', '', 'g'), 6)
        and nullif(btrim(history.commonname), '') is not null
      order by history.itemcode limit 1),
    'Item ' || job.itemcode
  ) as commonname,
  coalesce(
    nullif(btrim(job.contsize), ''),
    (select nullif(btrim(master.contsize), '') from public.ph_master_inventory master
      where upper(btrim(master.itemcode)) = upper(btrim(job.itemcode))
        and nullif(btrim(master.contsize), '') is not null limit 1),
    (select nullif(btrim(history.contsize), '') from public.ph_historical_inventory_dimensions history
      where upper(btrim(history.itemcode)) = upper(btrim(job.itemcode))
        and nullif(btrim(history.contsize), '') is not null limit 1),
    case split_part(job.itemcode, '.', 2)
      when '250' then '#25' when '150' then '#15' when '100' then '#10'
      when '070' then '#7' when '050' then '#5' when '030' then '#3'
      when '031' then '3DP' when '021' then '2DP' when '020' then '#2'
      when '013' then '1GP' when '011' then '#1' when '010' then '#1'
      else '' end
  ) as contsize,
  job.locationcode, job.requested_by_username, job.requested_at, job.system_on_hand,
  job.status, job.counted_total, job.variance, job.completed_by_username, job.completed_at,
  job.completion_command_id, job.delivery_event_id, job.created_at, job.updated_at
from ranked job
where job.identity_rank = 1;

create or replace view public.ph_recount_history with (security_invoker = true) as
select * from public.ph_reclass_recount_jobs where status = 'completed';
create or replace view public.ph_active_count_review with (security_invoker = true) as
select * from public.ph_bunch_counts where counted_at is null;
create or replace view public.ph_count_review_history with (security_invoker = true) as
select * from public.ph_bunch_counts where counted_at is not null;
create or replace view public.ph_active_shear_list with (security_invoker = true) as
select * from public.ph_shear_list where status = 'open';
create or replace view public.ph_shear_list_history with (security_invoker = true) as
select * from public.ph_shear_list where status in ('complete', 'cancelled');
create or replace view public.ph_active_eval_work with (security_invoker = true) as
select * from public.ph_eval_work where status in ('open', 'in_progress');
create or replace view public.ph_active_bunch_notes with (security_invoker = true) as
select * from bunch_note_private.jobs where status = 'open';
create or replace view public.ph_bunch_notes_history with (security_invoker = true) as
select * from bunch_note_private.jobs where status in ('complete', 'cancelled');
create or replace view public.ph_active_docks with (security_invoker = true) as
select * from public.ph_dock_trip_status;
create or replace view public.ph_docks_history with (security_invoker = true) as
select * from public.ph_dock_trip_status_audit;
create or replace view public.ph_active_orders with (security_invoker = true) as
select * from public.ph_soc_master;
create or replace view public.ph_orders_history with (security_invoker = true) as
select * from public.ph_historical_orders;
create or replace view public.ph_active_reserves with (security_invoker = true) as
select * from public.ph_reserves;
create or replace view public.ph_reserves_history with (security_invoker = true) as
select * from public.ph_productivity_history
where lower(coalesce(source_kind, '')) like '%reserve%'
   or lower(coalesce(source_table, '')) like '%reserve%';
create or replace view public.ph_active_hl_order with (security_invoker = true) as
select * from public.ph_hl_po;
create or replace view public.ph_hl_order_history with (security_invoker = true) as
select * from public.ph_hl_order_previews;
create or replace view public.ph_active_sales_office with (security_invoker = true) as
select * from public.ph_sales_office;
create or replace view public.ph_sales_office_history with (security_invoker = true) as
select * from public.ph_season_sales_office_events;
create or replace view public.ph_active_flyer with (security_invoker = true) as
select * from public.ph_flyer_folder_rows;
create or replace view public.ph_flyer_history with (security_invoker = true) as
select * from public.ph_flyer_folder_history;
create or replace view public.ph_active_crop_roll with (security_invoker = true) as
select * from public.ph_crop_roll_drive_rows;
create or replace view public.ph_crop_roll_history with (security_invoker = true) as
select * from public.ph_crop_roll_runs;
create or replace view public.ph_active_production with (security_invoker = true) as
select * from public.ph_production_workflow_rows;
create or replace view public.ph_production_history with (security_invoker = true) as
select * from public.ph_productivity_history
where lower(coalesce(source_kind, '')) like '%production%'
   or lower(coalesce(source_table, '')) like '%production%';
create or replace view public.ph_active_production_schedule with (security_invoker = true) as
select * from public.production_schedule_active;
create or replace view public.ph_production_schedule_history with (security_invoker = true) as
select * from public.production_schedule_snapshots;
create or replace view public.ph_active_hold_learning with (security_invoker = true) as
select * from public.ph_hold_learning_profiles;
create or replace view public.ph_hold_learning_history with (security_invoker = true) as
select * from public.ph_hold_learning_events;
create or replace view public.ph_active_chat with (security_invoker = true) as
select * from public.ph_chat_conversations;
create or replace view public.ph_chat_history with (security_invoker = true) as
select * from public.ph_chat_messages;
create or replace view public.ph_active_walkie with (security_invoker = true) as
select * from public.ph_walkie_channels;
create or replace view public.ph_walkie_history with (security_invoker = true) as
select * from public.ph_walkie_calls;
create or replace view public.ph_delivery_outbox with (security_invoker = true) as
select * from public.ph_request_delivery_outbox;

create or replace view public.ph_hr_employees with (security_invoker = true) as
select * from public.core_employees;
create or replace view public.ph_hr_events with (security_invoker = true) as
select * from public.hr_events;
create or replace view public.ph_hr_job_codes with (security_invoker = true) as
select * from public.hr_job_codes;
create or replace view public.ph_hr_timesheets with (security_invoker = true) as
select * from public.labor_timesheets;
create or replace view public.ph_hr_calendar_outbox with (security_invoker = true) as
select * from public.hr_calendar_reminder_outbox;
create or replace view public.ph_marketing_materials with (security_invoker = true) as
select * from public.marketing_materials;
create or replace view public.ph_active_inventory_projects with (security_invoker = true) as
select * from public.inventory_projects;
create or replace view public.ph_inventory_project_rows with (security_invoker = true) as
select * from public.inventory_project_rows;
create or replace view public.ph_user_access_control with (security_invoker = true) as
select * from public.user_access_control;
create or replace view public.ph_role_access_baselines with (security_invoker = true) as
select * from public.role_access_baselines;
create or replace view public.ph_watchdog_events with (security_invoker = true) as
select * from public.app_runtime_watchdog_events;
create or replace view public.ph_dataset_revisions with (security_invoker = true) as
select * from public.app_dataset_revisions;
create or replace view public.ph_manual_sync_status with (security_invoker = true) as
select * from public.app_manual_sync_status;
create or replace view public.ph_aura_domain_glossary with (security_invoker = true) as
select * from public.aura_domain_glossary;

update public.ph_reclass_recount_jobs job
set commonname = active.commonname,
  contsize = active.contsize,
  updated_at = clock_timestamp()
from public.ph_active_recount active
where active.id = job.id
  and (job.commonname is distinct from active.commonname or job.contsize is distinct from active.contsize);

insert into public.ph_00_table_directory(
  sort_order, module_or_view, active_table, history_table,
  support_or_outbox_table, what_it_does_and_lifecycle_rules, updated_at
)
values
  (10, 'Requests', 'public.ph_active_request', 'public.ph_request_history', 'public.ph_delivery_outbox', 'Only REQ-* sales requests are active; completed request evidence and permanent sales-impact values remain in history.', now()),
  (20, 'Drive Mode and AV', 'public.ph_active_drive_mode', 'public.ph_drive_mode_history', 'public.ph_historical_inventory_dimensions', 'Current master inventory feeds Drive Mode and AV; completed DriveAround snapshots remain historical.', now()),
  (30, 'Location Moves', 'public.ph_active_location_moves', 'public.ph_location_moves_history', 'public.ph_location_work_jobs', 'Legacy move_req_* rows are isolated here while Location Work jobs remain the supported worksheet source.', now()),
  (40, 'Suspend', 'public.ph_active_suspend', 'public.ph_suspend_history', 'public.ph_master_inventory', 'Current SOC suspend rows stay active and hydrate numeric inventory metrics from the master snapshot.', now()),
  (50, 'Recount', 'public.ph_active_recount', 'public.ph_recount_history', 'public.ph_reclass_recount_lines', 'Active rows are one normalized itemcode and locationcode card with master and historical name fallback.', now()),
  (60, 'Count Review', 'public.ph_active_count_review', 'public.ph_count_review_history', 'public.ph_bunch_counts', 'Uncounted rows are active and counted rows are historical.', now()),
  (70, 'Shear List', 'public.ph_active_shear_list', 'public.ph_shear_list_history', 'public.ph_shear_location_inquiries', 'Open shear rows are active; complete and cancelled rows remain historical.', now()),
  (80, 'Eval Work', 'public.ph_active_eval_work', 'public.ph_eval_work_history', 'public.ph_eval_work_events', 'Open Eval Work remains active and legacy EVAL-* request snapshots are retained in dedicated history.', now()),
  (90, 'Bunch Notes', 'public.ph_active_bunch_notes', 'public.ph_bunch_notes_history', 'bunch_note_private.previews', 'Open Bunch Notes are active; complete and cancelled jobs remain historical.', now()),
  (100, 'Docks', 'public.ph_active_docks', 'public.ph_docks_history', 'public.ph_dock_item_status', 'Current trip state is active and append-only trip audits are historical.', now()),
  (110, 'Orders', 'public.ph_active_orders', 'public.ph_orders_history', 'public.ph_pikes_order_batches', 'Current SOC order rows are active and imported historical orders remain read-only history.', now()),
  (120, 'Reserves', 'public.ph_active_reserves', 'public.ph_reserves_history', 'public.ph_master_inventory', 'Current reserves are active and completed reserve productivity events remain historical.', now()),
  (130, 'HL Order', 'public.ph_active_hl_order', 'public.ph_hl_order_history', 'public.ph_27f1_hl_po, public.ph_27s1_hl_po', 'Current HL purchase-order rows are active and generated previews remain historical.', now()),
  (140, 'Sales Office', 'public.ph_active_sales_office', 'public.ph_sales_office_history', 'public.ph_season_sales_office_state', 'Current Sales Office work is active and immutable workflow events are historical.', now()),
  (150, 'Flyer', 'public.ph_active_flyer', 'public.ph_flyer_history', 'public.ph_delivery_outbox', 'Current flyer folders are active and completed folder snapshots remain historical.', now()),
  (160, 'Crop Roll', 'public.ph_active_crop_roll', 'public.ph_crop_roll_history', 'public.ph_crop_roll_rows', 'Current Drive crop-roll rows are active and completed runs remain historical.', now()),
  (170, 'Production', 'public.ph_active_production', 'public.ph_production_history', 'public.ph_productivity_history', 'Current production workflow rows are active and completed productivity events remain historical.', now()),
  (180, 'Production Schedule', 'public.ph_active_production_schedule', 'public.ph_production_schedule_history', 'public.production_schedule_rows', 'The selected production snapshot is active and every import snapshot remains historical.', now()),
  (190, 'Hold Learning', 'public.ph_active_hold_learning', 'public.ph_hold_learning_history', 'public.ph_hold_stop_itemcode_summaries', 'Current learning profiles are active and hold observations remain historical.', now()),
  (200, 'Chat', 'public.ph_active_chat', 'public.ph_chat_history', 'public.ph_chat_participants', 'Conversations are active and messages are permanent history; legacy thread tables are private compatibility stores.', now()),
  (210, 'Walkie', 'public.ph_active_walkie', 'public.ph_walkie_history', 'public.ph_walkie_signal_events', 'Channels are active and completed calls remain historical.', now())
on conflict (sort_order) do update set
  module_or_view = excluded.module_or_view,
  active_table = excluded.active_table,
  history_table = excluded.history_table,
  support_or_outbox_table = excluded.support_or_outbox_table,
  what_it_does_and_lifecycle_rules = excluded.what_it_does_and_lifecycle_rules,
  updated_at = excluded.updated_at;

create or replace function public.get_request_sales_impact_v2()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
  with completed as materialized (
    select history.*, 'ph_request_history'::text canonical_source_table
    from public.ph_request_history history
    union all
    select history.*, 'ph_location_moves_history'::text canonical_source_table
    from public.ph_location_moves_history history
    union all
    select history.*, 'ph_eval_work_history'::text canonical_source_table
    from public.ph_eval_work_history history
  ), lines as materialized (
    select history.canonical_source_table || ':' || history.unique_id line_identity_key,
      coalesce(nullif(history.request_folder, ''), history.unique_id) request_identity,
      history.unique_id, history.request_folder folder_id, history.unique_id source_row_id,
      history.canonical_source_table source_table, array[history.canonical_source_table]::text[] source_tables,
      1 row_index, history.created_at request_date, 'Completed'::text status,
      coalesce(nullif(history.sales_rep, ''), 'Unassigned') sales_rep,
      coalesce(nullif(history.customer_name, ''), 'Unknown Customer') customer_name,
      coalesce(nullif(history.consignee_name, ''), 'N/A') consignee_name,
      history.itemcode, history.commonname, history.contsize, history.lotcode, history.locationcode,
      history.request_qty raw_qty, coalesce(history.effective_qty, history.request_qty, 25) effective_qty,
      coalesce(history.unit_list_price, history.listprice, 0) list_price,
      'canonical_history_v2363'::text price_source,
      round(coalesce(history.line_dollar_value,
        coalesce(history.effective_qty, history.request_qty, 25) * coalesce(history.unit_list_price, history.listprice, 0)), 2) line_dollar_value
    from completed history
    union all
    select 'ph_active_request:' || pending.unique_id,
      coalesce(nullif(pending.request_folder, ''), pending.unique_id), pending.unique_id,
      pending.request_folder, pending.unique_id, 'ph_active_request', array['ph_active_request']::text[],
      1, pending.created_at, 'Pending', coalesce(nullif(pending.sales_rep, ''), 'Unassigned'),
      coalesce(nullif(pending.customer_name, ''), 'Unknown Customer'),
      coalesce(nullif(pending.consignee_name, ''), 'N/A'), pending.itemcode, pending.commonname,
      pending.contsize, pending.lotcode, pending.locationcode, pending.request_qty,
      coalesce(pending.effective_qty, pending.request_qty, 25), coalesce(pending.unit_list_price, 0),
      'canonical_pending_v2363', round(coalesce(pending.line_dollar_value,
        coalesce(pending.effective_qty, pending.request_qty, 25) * coalesce(pending.unit_list_price, 0)), 2)
    from public.ph_active_request pending
    where pending.date_completed is null
  ), summary as (
    select round(coalesce(sum(line_dollar_value), 0), 2) total_dollar_value,
      round(coalesce(sum(line_dollar_value) filter (where status = 'Completed'), 0), 2) completed_dollar_value,
      round(coalesce(sum(line_dollar_value) filter (where status = 'Pending'), 0), 2) pending_dollar_value,
      count(distinct request_identity)::integer total_requests, count(*)::integer total_line_items,
      round(coalesce(sum(effective_qty), 0), 2) total_units_requested,
      count(*) filter (where raw_qty is not null)::integer explicit_qty_line_count,
      count(*) filter (where raw_qty is null)::integer default_25_qty_line_count
    from lines
  )
  select jsonb_build_object(
    'dedupe_contract', 'canonical-active-history-v2363',
    'summary', (select to_jsonb(summary) from summary),
    'by_sales_rep', coalesce((select jsonb_agg(to_jsonb(rollup) order by rollup.total_dollar_value desc, rollup.sales_rep)
      from (select sales_rep, count(distinct request_identity)::integer request_count, count(*)::integer line_item_count,
        round(sum(effective_qty), 2) total_units, round(sum(line_dollar_value), 2) total_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Completed'), 0), 2) completed_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Pending'), 0), 2) pending_dollar_value
        from lines group by sales_rep) rollup), '[]'::jsonb),
    'by_customer_consignee', coalesce((select jsonb_agg(to_jsonb(rollup) order by rollup.total_dollar_value desc, rollup.customer_name, rollup.consignee_name)
      from (select customer_name, consignee_name, customer_name || ' / ' || consignee_name customer_consignee_label,
        min(sales_rep) sales_rep, count(distinct request_identity)::integer request_count,
        count(*)::integer line_item_count, round(sum(effective_qty), 2) total_units,
        round(sum(line_dollar_value), 2) total_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Completed'), 0), 2) completed_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Pending'), 0), 2) pending_dollar_value
        from lines group by customer_name, consignee_name) rollup), '[]'::jsonb),
    'line_items', coalesce((select jsonb_agg(to_jsonb(lines) || jsonb_build_object(
      'customer_consignee_label', customer_name || ' / ' || consignee_name,
      'is_default_qty', raw_qty is null, 'unit_list_price', list_price)
      order by request_date desc nulls last, line_identity_key) from lines), '[]'::jsonb),
    'source_table_audit', jsonb_build_object(
      'dedupe_contract', 'canonical-active-history-v2363', 'inventory_table', 'ph_active_drive_mode',
      'pending_table', 'ph_active_request', 'completed_table', 'ph_request_history',
      'line_count', (select count(*) from lines), 'distinct_unique_ids', (select count(distinct unique_id) from lines),
      'completed_count', (select count(*) from lines where status = 'Completed'),
      'pending_count', (select count(*) from lines where status = 'Pending'),
      'formula', '(request_qty > 0 ? request_qty : 25) * unit_list_price'))
$function$;

revoke all on function public.get_request_sales_impact_v2() from public, anon, authenticated;
grant execute on function public.get_request_sales_impact_v2() to service_role;

grant select on public.ph_00_table_directory to anon, authenticated, service_role;
grant select on public."00_app_view_table_map", public.ph_chat_threads, public.ph_chat_members,
  public.ph_hold_learning_cursors to service_role;
grant select on public.ph_active_request, public.ph_request_history, public.ph_active_drive_mode,
  public.ph_drive_mode_history, public.ph_active_suspend, public.ph_suspend_history,
  public.ph_active_recount, public.ph_recount_history, public.ph_active_count_review,
  public.ph_count_review_history, public.ph_active_shear_list, public.ph_shear_list_history,
  public.ph_active_eval_work, public.ph_active_bunch_notes, public.ph_bunch_notes_history,
  public.ph_active_docks, public.ph_docks_history, public.ph_active_orders,
  public.ph_orders_history, public.ph_active_reserves, public.ph_reserves_history,
  public.ph_active_hl_order, public.ph_hl_order_history, public.ph_active_sales_office,
  public.ph_sales_office_history, public.ph_active_flyer, public.ph_flyer_history,
  public.ph_active_crop_roll, public.ph_crop_roll_history, public.ph_active_production,
  public.ph_production_history, public.ph_active_production_schedule,
  public.ph_production_schedule_history, public.ph_active_hold_learning,
  public.ph_hold_learning_history, public.ph_active_chat, public.ph_chat_history,
  public.ph_active_walkie, public.ph_walkie_history, public.ph_delivery_outbox,
  public.ph_hr_employees, public.ph_hr_events, public.ph_hr_job_codes,
  public.ph_hr_timesheets, public.ph_hr_calendar_outbox, public.ph_marketing_materials,
  public.ph_active_inventory_projects, public.ph_inventory_project_rows,
  public.ph_user_access_control, public.ph_role_access_baselines, public.ph_watchdog_events,
  public.ph_dataset_revisions, public.ph_manual_sync_status, public.ph_aura_domain_glossary
  to service_role;

update public.app_manual_sync_status
set status = jsonb_set(
  jsonb_set(coalesce(status, '{}'::jsonb), '{active}', 'false'::jsonb, true),
  '{currentStage}', to_jsonb('idle'::text), true
)
where id = true
  and not coalesce((status->>'active')::boolean, false);

do $verify$
declare
  directory_count integer;
  request_history_count bigint;
  sales_impact jsonb;
  sales_impact_total numeric;
  completed_sales_impact_total numeric;
begin
  select count(*) into directory_count from public.ph_00_table_directory;
  if directory_count <> 21 then raise exception 'PH_DIRECTORY_COUNT_INVALID: %', directory_count; end if;

  if exists (select 1 from public.ph_requests_pending where unique_id like 'move_req_%' or unique_id like 'EVAL-%') then
    raise exception 'NON_REQUEST_PENDING_ROWS_REMAIN';
  end if;
  if exists (select 1 from public.ph_requests_completed_history where unique_id like 'move_req_%' or unique_id like 'EVAL-%') then
    raise exception 'NON_REQUEST_HISTORY_ROWS_REMAIN';
  end if;
  if (select count(*) from public.ph_location_moves_history) < 4 then
    raise exception 'LOCATION_MOVE_HISTORY_INCOMPLETE';
  end if;
  if (select count(*) from public.ph_eval_work_history) < 7 then
    raise exception 'EVAL_WORK_HISTORY_INCOMPLETE';
  end if;
  if exists (
    select 1
    from private.ph_active_request_retirement_v2361 retired
    where retired.unique_id like 'REQ-%'
      and coalesce(private.try_timestamptz(retired.row_snapshot->>'created_at'), retired.retired_at)
        >= timestamptz '2026-10-22 00:00:00 America/Chicago'
      and not exists (
        select 1 from public.ph_request_delivery_outbox completed
        where lower(btrim(coalesce(completed.event_type, ''))) in ('request_completed', 'plant request completed!')
          and (completed.request_id = retired.unique_id or completed.payload->>'request_id' = retired.unique_id
            or (jsonb_typeof(completed.payload->'request_ids') = 'array' and completed.payload->'request_ids' ? retired.unique_id))
      )
      and not exists (
        select 1 from public.ph_requests_completed_history history
        where history.unique_id = retired.unique_id
    and (history.date_completed is not null
    or lower(btrim(coalesce(history.req_status, ''))) in ('complete', 'completed', 'fulfilled', 'archived', 'closed'))
          and nullif(btrim(coalesce(history.photo_url, history.req_photo_link, '')), '') is not null
          and nullif(btrim(coalesce(history.spec, history.request_spec, history.req_spec, history.desired_spec, '')), '') is not null
      )
      and not exists (select 1 from public.ph_active_request active where active.unique_id = retired.unique_id)
  ) then
    raise exception 'RECENT_UNFULFILLED_REQUEST_NOT_RESTORED';
  end if;

  if exists (
    select 1 from public.ph_active_recount
    group by upper(btrim(itemcode)), upper(btrim(locationcode)) having count(*) > 1
  ) then raise exception 'RECOUNT_DUPLICATES_REMAIN'; end if;
  if exists (
    select 1 from public.ph_active_recount
    where nullif(btrim(commonname), '') is null or lower(btrim(commonname)) = 'unknown'
  ) then raise exception 'RECOUNT_NAME_UNRESOLVED'; end if;

  select count(*) into request_history_count from public.ph_request_history;
  if request_history_count < 4042 then raise exception 'REQUEST_HISTORY_COUNT_LOW: %', request_history_count; end if;

  sales_impact := public.get_request_sales_impact_v2();
  sales_impact_total := round(coalesce((sales_impact->'summary'->>'total_dollar_value')::numeric, 0), 2);
  completed_sales_impact_total := round(coalesce((sales_impact->'summary'->>'completed_dollar_value')::numeric, 0), 2);
  if completed_sales_impact_total < 6067786.53 then
    raise exception 'COMPLETED_REQUEST_SALES_IMPACT_TOTAL_LOW: %', completed_sales_impact_total;
  end if;
  if sales_impact_total < 6067786.53 then raise exception 'REQUEST_SALES_IMPACT_TOTAL_LOW: %', sales_impact_total; end if;

  if exists (
    select 1 from public.app_manual_sync_status
    where id = true and (coalesce((status->>'active')::boolean, false) or coalesce(status->>'currentStage', '') <> 'idle')
  ) then raise exception 'MANUAL_SYNC_NOT_IDLE'; end if;
end
$verify$;

comment on table public.ph_00_table_directory is
  'AgData v2.3.63 canonical active/history module directory.';
comment on view public.ph_active_recount is
  'One active Recount card per normalized itemcode and locationcode with current and historical plant-name fallback.';

commit;
