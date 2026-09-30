-- Drive-canonical request integrity, durable delivery, Eval assignments, and
-- sanitized health monitoring for V2026.08.20.

begin;

create schema if not exists private;

-- The hosted 2026.08.17.09 client already emits the two assignment fields.
-- Keep the snapshot columns on the request, but Drive remains authoritative in
-- the live read model below.
alter table public.ph_active_request
  add column if not exists app_tab_assignment text,
  add column if not exists master_app_tab_assignment text,
  add column if not exists request_source text not null default 'general',
  add column if not exists client_batch_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists row_version bigint not null default 1;

create unique index if not exists idx_ph_active_request_unique_id
  on public.ph_active_request (unique_id);
create index if not exists idx_ph_active_request_master_id
  on public.ph_active_request (master_id);
create index if not exists idx_ph_active_request_batch
  on public.ph_active_request (client_batch_id);

alter table public.ph_request_history
  add column if not exists request_source text not null default 'general',
  add column if not exists client_batch_id uuid,
  add column if not exists row_version bigint not null default 1,
  add column if not exists delivery_state text not null default 'unknown',
  add column if not exists recovered_at timestamptz,
  add column if not exists app_tab_assignment text,
  add column if not exists master_app_tab_assignment text;

alter table public.ph_master_inventory
  add column if not exists av_rule_bundle_updated_at timestamptz,
  add column if not exists av_rule_av_note_updated_at timestamptz,
  add column if not exists av_rule_spec_updated_at timestamptz,
  add column if not exists av_rule_match_updated_at timestamptz,
  add column if not exists av_rule_caliper_updated_at timestamptz,
  add column if not exists av_rule_photo_updated_at timestamptz,
  add column if not exists av_rule_priority_snapshot text,
  add column if not exists av_rule_holdstop_snapshot text,
  add column if not exists av_rule_last_clear_reason text,
  add column if not exists av_rule_last_cleared_at timestamptz;

create table if not exists public.ph_request_delivery_outbox (
  event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  request_id text,
  request_folder text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed', 'unknown')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sanitized_error_code text,
  email_delivered_at timestamptz,
  push_delivered_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ph_request_delivery_outbox_drain
  on public.ph_request_delivery_outbox (status, next_attempt_at, created_at);
create index if not exists idx_ph_request_delivery_outbox_request
  on public.ph_request_delivery_outbox (request_id, created_at desc);

create table if not exists public.ph_app_health_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  profile_id uuid references public.profiles(id) on delete set null,
  username text,
  event_name text not null,
  area text not null default 'app',
  severity text not null default 'error'
    check (severity in ('info', 'warning', 'error', 'critical')),
  sanitized_code text,
  duration_ms integer,
  sample_rate numeric(5,4) not null default 1,
  app_build text,
  metadata jsonb not null default '{}'::jsonb,
  constraint ph_app_health_events_metadata_size
    check (octet_length(metadata::text) <= 4096)
);

create index if not exists idx_ph_app_health_events_recent
  on public.ph_app_health_events (occurred_at desc, event_name);
create index if not exists idx_ph_app_health_events_profile
  on public.ph_app_health_events (profile_id);

-- One normalized row per ItemCode. Legacy sheet-specific columns are retained
-- for compatibility, but no longer determine identity or delete eligibility.
alter table public.ph_warehouse_assigned_items
  add column if not exists itemcode_normalized text,
  add column if not exists assigned_by text,
  add column if not exists assigned_at timestamptz,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists present_in_drive boolean not null default true,
  add column if not exists unassigned_notified_at timestamptz;

update public.ph_warehouse_assigned_items
set itemcode_normalized = upper(btrim(itemcode))
where nullif(btrim(coalesce(itemcode_normalized, '')), '') is null
  and nullif(btrim(coalesce(itemcode, '')), '') is not null;

-- Preserve the oldest assignment if legacy imports produced duplicate codes.
with ranked as (
  select id,
         row_number() over (
           partition by itemcode_normalized
           order by (nullif(btrim(coalesce(assignedto, '')), '') is not null) desc,
                    updated_at desc nulls last,
                    created_at asc nulls last,
                    id
         ) as rn
  from public.ph_warehouse_assigned_items
  where itemcode_normalized is not null
)
delete from public.ph_warehouse_assigned_items a
using ranked r
where a.id = r.id and r.rn > 1;

create unique index if not exists idx_ph_warehouse_assigned_itemcode
  on public.ph_warehouse_assigned_items (itemcode_normalized)
  where itemcode_normalized is not null;

create or replace function private.normalized_profile_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_role, ''), '[^A-Za-z0-9]+', '', 'g'))
$$;

create or replace function private.current_active_profile()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p
  from public.profiles p
  where p.id = (select auth.uid())
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
  limit 1
$$;

create or replace function private.is_sales_request_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.normalized_profile_role((private.current_active_profile()).role)
    in ('REP', 'SALESREP', 'SALES'), false)
$$;

create or replace function private.can_create_general_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.current_active_profile()).id is not null
     and not private.is_sales_request_role()
     and (
       lower(btrim((private.current_active_profile()).username)) in
         ('dylan_collyge', 'jd_jones', 'megan_kelly', 'kayla_knepp')
       or private.normalized_profile_role((private.current_active_profile()).role) not like 'QC%'
     )
$$;

create or replace function private.can_create_av_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.current_active_profile()).id is not null
     and (
       private.is_sales_request_role()
       or private.can_create_general_requests()
     )
$$;

create or replace function private.can_save_request_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.current_active_profile()).id is not null
     and (
       lower(btrim((private.current_active_profile()).username)) in
         ('dylan_collyge', 'jd_jones', 'megan_kelly', 'kayla_knepp')
       or private.normalized_profile_role((private.current_active_profile()).role) not like 'QC%'
     )
$$;

create or replace function private.can_manage_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.current_active_profile()).id is not null
     and (
       lower(btrim((private.current_active_profile()).username)) = 'kayla_knepp'
       or lower(btrim((private.current_active_profile()).username)) in
         ('dylan_collyge', 'jd_jones', 'megan_kelly')
       or private.normalized_profile_role((private.current_active_profile()).role)
         in ('ADMIN', 'ADMINISTRATOR')
     )
$$;

create or replace function private.can_manage_eval_assignments()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(coalesce((private.current_active_profile()).username, '')))
    in ('dylan_collyge', 'megan_kelly')
$$;

revoke all on function private.normalized_profile_role(text) from public, anon, authenticated;
revoke all on function private.current_active_profile() from public, anon, authenticated;
revoke all on function private.is_sales_request_role() from public, anon, authenticated;
revoke all on function private.can_create_av_requests() from public, anon, authenticated;
revoke all on function private.can_create_general_requests() from public, anon, authenticated;
revoke all on function private.can_save_request_work() from public, anon, authenticated;
revoke all on function private.can_manage_requests() from public, anon, authenticated;
revoke all on function private.can_manage_eval_assignments() from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.current_active_profile() to authenticated;
grant execute on function private.is_sales_request_role() to authenticated;
grant execute on function private.can_create_av_requests() to authenticated;
grant execute on function private.can_create_general_requests() to authenticated;
grant execute on function private.can_save_request_work() to authenticated;
grant execute on function private.can_manage_requests() to authenticated;
grant execute on function private.can_manage_eval_assignments() to authenticated;

-- Remove legacy request side effects. Completion is now atomic in
-- save_request_work and delivery happens only through the durable outbox.
drop trigger if exists trigger_archive_request on public.ph_active_request;
drop trigger if exists trigger_completed_request on public.ph_active_request;
drop trigger if exists trigger_new_request on public.ph_active_request;

create or replace function private.touch_active_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ph_active_request_touch on public.ph_active_request;
create trigger ph_active_request_touch
before update on public.ph_active_request
for each row execute function private.touch_active_request();

create or replace function private.touch_request_outbox()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ph_request_delivery_outbox_touch on public.ph_request_delivery_outbox;
create trigger ph_request_delivery_outbox_touch
before update on public.ph_request_delivery_outbox
for each row execute function private.touch_request_outbox();

-- Drive columns occupy the original column names. Request-specific input and
-- response columns remain on the request row. If the Drive row disappears the
-- request snapshot is still returned and drive_row_missing identifies it.
create or replace view public.ph_active_request_live_rows
with (security_invoker = true)
as
select
  ar.id,
  ar.unique_id,
  ar.master_id,
  case when mi.unique_id is null then ar.commonname else mi.commonname end as commonname,
  case when mi.unique_id is null then ar.contsize else mi.contsize end as contsize,
  case when mi.unique_id is null then ar.locationcode else mi.locationcode end as locationcode,
  case when mi.unique_id is null then ar.lotcode else mi.lotcode end as lotcode,
  case when mi.unique_id is null then ar.itemcode else mi.itemcode end as itemcode,
  case when mi.unique_id is null then ar.ptravailable else mi.ptravailable end as ptravailable,
  case when mi.unique_id is null then ar.season_supply else mi.season_supply end as season_supply,
  case when mi.unique_id is null then ar.priority else mi.priority end as priority,
  case when mi.unique_id is null then ar.qualitycode else mi.qualitycode end as qualitycode,
  case when mi.unique_id is null then ar.field_tag_color else mi.field_tag_color end as field_tag_color,
  case when mi.unique_id is null then ar.plantgroupcode else mi.plantgroupcode end as plantgroupcode,
  ar.requested_by,
  ar.request_folder,
  ar.req_customer,
  ar.req_qty,
  ar.desired_spec,
  ar.desired_caliper,
  ar.est_ship,
  ar.req_reserve,
  ar.req_photo_link,
  ar.req_photo_name,
  ar.req_archived,
  ar.req_status,
  ar.req_rep_action,
  ar.created_at,
  ar.req_match,
  ar.req_spec,
  ar.req_caliper,
  ar.req_pic_note,
  ar.req_sales_note,
  ar.req_comments,
  ar.av_note,
  ar.date_completed,
  ar.completed_by_username,
  ar.completed_by_display,
  ar.completed_by_email,
  ar.req_photo_mode,
  ar.move_batch_id,
  ar.move_approval_stage,
  ar.move_status,
  ar.move_group_key,
  ar.move_from_locationcode,
  ar.move_to_locationcode,
  ar.move_planned_qty,
  ar.move_actual_qty,
  ar.move_destination_needs_row,
  ar.move_dylan_approved_at,
  ar.move_jd_approved_at,
  ar.move_completed_at,
  ar.move_completed_by,
  ar.request_note,
  ar.request_created_by_username,
  ar.request_created_by_display,
  ar.request_created_by_email,
  ar.request_selected_rep_username,
  ar.request_selected_rep_display,
  ar.request_selected_rep_email,
  case when mi.unique_id is null then ar.app_tab_assignment else mi.app_tab_assignment end as app_tab_assignment,
  case when mi.unique_id is null then ar.master_app_tab_assignment else mi.app_tab_assignment end as master_app_tab_assignment,
  ar.request_source,
  ar.client_batch_id,
  ar.updated_at,
  ar.row_version,
  (mi.unique_id is null) as drive_row_missing,
  mi.last_updated as drive_last_updated,
  mi.assignedto as drive_assignedto,
  mi.match as drive_match,
  mi.loc_match_qty as drive_loc_match_qty,
  mi.spec as drive_spec,
  mi.caliper as drive_caliper,
  mi.pic_note as drive_pic_note,
  mi.av_note as drive_av_note,
  mi.photo_link as drive_photo_link,
  mi.photo_name as drive_photo_name,
  mi.av_rule_bundle_updated_at,
  mi.av_rule_av_note_updated_at,
  mi.av_rule_spec_updated_at,
  mi.av_rule_match_updated_at,
  mi.av_rule_caliper_updated_at,
  mi.av_rule_photo_updated_at,
  mi.av_rule_priority_snapshot,
  mi.av_rule_holdstop_snapshot,
  mi.av_rule_last_clear_reason,
  mi.av_rule_last_cleared_at
from public.ph_active_request ar
left join public.ph_master_inventory mi
  on mi.unique_id = ar.master_id
where coalesce(ar.req_archived, false) = false;

comment on view public.ph_active_request_live_rows is
  'Canonical active Request read model: current Drive inventory plus durable request-owned fields; missing Drive rows fall back to the request snapshot.';

grant select on public.ph_active_request_live_rows to authenticated;

create or replace function private.propagate_drive_av_to_pending_requests()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.match is distinct from new.match
     or old.spec is distinct from new.spec
     or old.caliper is distinct from new.caliper
     or old.pic_note is distinct from new.pic_note
     or old.av_note is distinct from new.av_note then
    update public.ph_active_request ar
    set req_match = case
          when nullif(btrim(coalesce(new.match, '')), '') is null then null
          when btrim(new.match) ~ '^-?[0-9]+([.][0-9]+)?$' then btrim(new.match)::numeric
          else ar.req_match
        end,
        req_spec = new.spec,
        req_caliper = new.caliper,
        req_pic_note = new.pic_note,
        av_note = new.av_note,
        row_version = ar.row_version + 1
    where ar.master_id = new.unique_id
      and coalesce(ar.req_archived, false) = false
      and lower(coalesce(ar.req_status, 'pending')) not in ('complete', 'completed');
  end if;
  return new;
end;
$$;

drop trigger if exists ph_master_inventory_propagate_request_av on public.ph_master_inventory;
create trigger ph_master_inventory_propagate_request_av
after update of match, spec, caliper, pic_note, av_note
on public.ph_master_inventory
for each row execute function private.propagate_drive_av_to_pending_requests();

create or replace function private.try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then return null; end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function private.canonical_request_json(p_request_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(v)
  from public.ph_active_request_live_rows v
  where v.unique_id = p_request_id
  limit 1
$$;

create or replace function private.upsert_request_history(
  p_request_id text,
  p_event text,
  p_delivery_state text default 'pending',
  p_recovered boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.ph_active_request%rowtype;
  m public.ph_master_inventory%rowtype;
  canonical jsonb;
  history_id bigint;
begin
  select * into r
  from public.ph_active_request
  where unique_id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;

  select * into m from public.ph_master_inventory where unique_id = r.master_id;
  canonical := coalesce(private.canonical_request_json(p_request_id), to_jsonb(r));

  insert into public.ph_request_history (
    unique_id, master_id, commonname, contsize, locationcode, lotcode,
    itemcode, ptravailable, season_supply, priority, qualitycode,
    field_tag_color, plantgroupcode, requested_by, request_folder,
    req_customer, request_customer, req_qty, desired_spec, desired_caliper,
    est_ship, req_reserve, req_photo_link, req_photo_name, req_archived,
    req_status, req_rep_action, created_at, master_unique_id, source_table,
    req_match, req_spec, req_caliper, req_pic_note, req_comments, av_note,
    date_completed, s_lts, holdstopcode, season, photo_link, photo_name,
    snapshot, last_event, created_by_username, created_by_display, updated_at,
    completed_by_username, completed_by_display, completed_by_email,
    request_created_by_username, request_created_by_display,
    request_created_by_email, request_selected_rep_username,
    request_selected_rep_display, request_selected_rep_email,
    request_source, client_batch_id, row_version, delivery_state,
    recovered_at, app_tab_assignment, master_app_tab_assignment
  ) values (
    r.unique_id, r.master_id,
    coalesce(m.commonname, r.commonname), coalesce(m.contsize, r.contsize),
    coalesce(m.locationcode, r.locationcode), coalesce(m.lotcode, r.lotcode),
    coalesce(m.itemcode, r.itemcode), coalesce(m.ptravailable, r.ptravailable),
    coalesce(m.season_supply, r.season_supply), coalesce(m.priority, r.priority),
    coalesce(m.qualitycode, r.qualitycode),
    coalesce(m.field_tag_color, r.field_tag_color),
    coalesce(m.plantgroupcode, r.plantgroupcode), r.requested_by,
    r.request_folder, r.req_customer, r.req_customer, r.req_qty,
    r.desired_spec, r.desired_caliper, r.est_ship, r.req_reserve,
    r.req_photo_link, r.req_photo_name, r.req_archived, r.req_status,
    r.req_rep_action, r.created_at, r.master_id, 'ph_active_request',
    r.req_match::text, r.req_spec, r.req_caliper, r.req_pic_note,
    r.req_comments, r.av_note, private.try_timestamptz(r.date_completed),
    m.s_lts, m.holdstopcode, m.season, r.req_photo_link, r.req_photo_name,
    canonical, p_event, r.request_created_by_username,
    r.request_created_by_display, now(), r.completed_by_username,
    r.completed_by_display, r.completed_by_email,
    r.request_created_by_username, r.request_created_by_display,
    r.request_created_by_email, r.request_selected_rep_username,
    r.request_selected_rep_display, r.request_selected_rep_email,
    r.request_source, r.client_batch_id, r.row_version, p_delivery_state,
    case when p_recovered then now() else null end,
    coalesce(m.app_tab_assignment, r.app_tab_assignment),
    coalesce(m.app_tab_assignment, r.master_app_tab_assignment)
  )
  on conflict (unique_id) do update set
    master_id = excluded.master_id,
    commonname = excluded.commonname,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    itemcode = excluded.itemcode,
    ptravailable = excluded.ptravailable,
    season_supply = excluded.season_supply,
    priority = excluded.priority,
    qualitycode = excluded.qualitycode,
    field_tag_color = excluded.field_tag_color,
    plantgroupcode = excluded.plantgroupcode,
    requested_by = excluded.requested_by,
    request_folder = excluded.request_folder,
    req_customer = excluded.req_customer,
    request_customer = excluded.request_customer,
    req_qty = excluded.req_qty,
    desired_spec = excluded.desired_spec,
    desired_caliper = excluded.desired_caliper,
    est_ship = excluded.est_ship,
    req_reserve = excluded.req_reserve,
    req_photo_link = excluded.req_photo_link,
    req_photo_name = excluded.req_photo_name,
    req_archived = excluded.req_archived,
    req_status = excluded.req_status,
    req_rep_action = excluded.req_rep_action,
    req_match = excluded.req_match,
    req_spec = excluded.req_spec,
    req_caliper = excluded.req_caliper,
    req_pic_note = excluded.req_pic_note,
    req_comments = excluded.req_comments,
    av_note = excluded.av_note,
    date_completed = excluded.date_completed,
    s_lts = excluded.s_lts,
    holdstopcode = excluded.holdstopcode,
    season = excluded.season,
    photo_link = excluded.photo_link,
    photo_name = excluded.photo_name,
    snapshot = excluded.snapshot,
    last_event = excluded.last_event,
    updated_at = now(),
    completed_by_username = excluded.completed_by_username,
    completed_by_display = excluded.completed_by_display,
    completed_by_email = excluded.completed_by_email,
    request_source = excluded.request_source,
    client_batch_id = excluded.client_batch_id,
    row_version = excluded.row_version,
    delivery_state = excluded.delivery_state,
    recovered_at = coalesce(public.ph_request_history.recovered_at, excluded.recovered_at),
    app_tab_assignment = excluded.app_tab_assignment,
    master_app_tab_assignment = excluded.master_app_tab_assignment
  returning id into history_id;

  return history_id;
end;
$$;

create or replace function private.insert_request_batch(
  p_client_batch_id uuid,
  p_requests jsonb,
  p_request_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
  request_id text;
  master public.ph_master_inventory%rowtype;
  inserted_count integer := 0;
  request_ids text[] := array[]::text[];
  completed_ids text[] := array[]::text[];
  snapshots jsonb := '[]'::jsonb;
  source_name text := lower(btrim(coalesce(p_request_source, 'general')));
begin
  if p_client_batch_id is null then
    raise exception using errcode = '22023', message = 'CLIENT_BATCH_ID_REQUIRED';
  end if;
  if jsonb_typeof(p_requests) <> 'array'
     or jsonb_array_length(p_requests) < 1
     or jsonb_array_length(p_requests) > 100 then
    raise exception using errcode = '22023', message = 'REQUEST_BATCH_SIZE_INVALID';
  end if;

  for entry in select value from jsonb_array_elements(p_requests)
  loop
    request_id := nullif(btrim(coalesce(entry->>'unique_id', '')), '');
    if request_id is null then
      raise exception using errcode = '22023', message = 'REQUEST_ID_REQUIRED';
    end if;
    if request_id = any(request_ids) then
      raise exception using errcode = '23505', message = 'DUPLICATE_REQUEST_ID_IN_BATCH';
    end if;
    request_ids := array_append(request_ids, request_id);

    select * into master
    from public.ph_master_inventory
    where unique_id = nullif(btrim(coalesce(entry->>'master_id', '')), '')
    limit 1;

    insert into public.ph_active_request (
      unique_id, master_id, commonname, contsize, locationcode, lotcode,
      itemcode, ptravailable, season_supply, priority, qualitycode,
      field_tag_color, plantgroupcode, requested_by, request_folder,
      req_customer, req_qty, desired_spec, desired_caliper, est_ship,
      req_reserve, req_photo_link, req_photo_name, req_archived, req_status,
      req_rep_action, created_at, req_match, req_spec, req_caliper,
      req_pic_note, req_sales_note, req_comments, av_note, date_completed,
      completed_by_username, completed_by_display, completed_by_email,
      req_photo_mode, request_note, request_created_by_username,
      request_created_by_display, request_created_by_email,
      request_selected_rep_username, request_selected_rep_display,
      request_selected_rep_email, app_tab_assignment,
      master_app_tab_assignment, request_source, client_batch_id, row_version
    ) values (
      request_id,
      nullif(btrim(coalesce(entry->>'master_id', '')), ''),
      coalesce(master.commonname, entry->>'commonname'),
      coalesce(master.contsize, entry->>'contsize'),
      coalesce(master.locationcode, entry->>'locationcode'),
      coalesce(master.lotcode, entry->>'lotcode'),
      coalesce(master.itemcode, entry->>'itemcode'),
      coalesce(master.ptravailable, entry->>'ptravailable'),
      coalesce(master.season_supply, entry->>'season_supply'),
      coalesce(master.priority, entry->>'priority'),
      coalesce(master.qualitycode, entry->>'qualitycode'),
      coalesce(master.field_tag_color, entry->>'field_tag_color'),
      coalesce(master.plantgroupcode, entry->>'plantgroupcode'),
      entry->>'requested_by', entry->>'request_folder',
      entry->>'req_customer', entry->>'req_qty', entry->>'desired_spec',
      entry->>'desired_caliper', entry->>'est_ship',
      coalesce(entry->>'req_reserve', 'NO'), entry->>'req_photo_link',
      entry->>'req_photo_name', coalesce((entry->>'req_archived')::boolean, false),
      coalesce(entry->>'req_status', 'Pending'), entry->>'req_rep_action',
      coalesce(private.try_timestamptz(entry->>'created_at'), now()),
      case
        when nullif(btrim(coalesce(entry->>'req_match', '')), '') is null then null
        when btrim(entry->>'req_match') ~ '^-?[0-9]+([.][0-9]+)?$'
          then btrim(entry->>'req_match')::numeric
        else null
      end,
      entry->>'req_spec', entry->>'req_caliper', entry->>'req_pic_note',
      entry->>'req_sales_note', entry->>'req_comments', entry->>'av_note',
      entry->>'date_completed', entry->>'completed_by_username',
      entry->>'completed_by_display', entry->>'completed_by_email',
      entry->>'req_photo_mode', entry->>'request_note',
      entry->>'request_created_by_username', entry->>'request_created_by_display',
      entry->>'request_created_by_email', entry->>'request_selected_rep_username',
      entry->>'request_selected_rep_display', entry->>'request_selected_rep_email',
      coalesce(master.app_tab_assignment, entry->>'app_tab_assignment'),
      coalesce(master.app_tab_assignment, entry->>'master_app_tab_assignment'),
      source_name, p_client_batch_id, 1
    )
    on conflict (unique_id) do nothing;

    if found then
      inserted_count := inserted_count + 1;
      perform private.upsert_request_history(
        request_id,
        case when lower(coalesce(entry->>'req_status', 'pending')) in ('complete', 'completed')
          then 'completed' else 'created' end,
        'pending',
        false
      );
    elsif not exists (
      select 1 from public.ph_active_request
      where unique_id = request_id and client_batch_id = p_client_batch_id
    ) then
      raise exception using errcode = '23505', message = 'REQUEST_ID_ALREADY_USED';
    end if;

    if lower(coalesce(entry->>'req_status', 'pending')) in ('complete', 'completed') then
      completed_ids := array_append(completed_ids, request_id);
    end if;
  end loop;

  select coalesce(jsonb_agg(private.canonical_request_json(id)), '[]'::jsonb)
  into snapshots
  from unnest(request_ids) id;

  insert into public.ph_request_delivery_outbox (
    event_key, event_type, request_folder, payload, status
  ) values (
    'request-created:' || p_client_batch_id::text,
    'request_created',
    p_requests->0->>'request_folder',
    jsonb_build_object(
      'client_batch_id', p_client_batch_id,
      'request_ids', to_jsonb(request_ids),
      'requests', snapshots
    ),
    'pending'
  ) on conflict (event_key) do nothing;

  if cardinality(completed_ids) > 0 then
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, request_folder, payload, status
    ) values (
      'request-completed-batch:' || p_client_batch_id::text,
      'request_completed',
      p_requests->0->>'request_folder',
      jsonb_build_object(
        'client_batch_id', p_client_batch_id,
        'request_ids', to_jsonb(completed_ids)
      ),
      'pending'
    ) on conflict (event_key) do nothing;
  end if;

  return jsonb_build_object(
    'client_batch_id', p_client_batch_id,
    'inserted_count', inserted_count,
    'rows', snapshots,
    'delivery_state', 'pending'
  );
end;
$$;

create or replace function public.create_av_request_batch(
  client_batch_id uuid,
  requests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_create_av_requests() then
    raise exception using errcode = '42501', message = 'AV_REQUEST_CREATE_FORBIDDEN';
  end if;
  return private.insert_request_batch(client_batch_id, requests, 'av');
end;
$$;

create or replace function public.create_request_batch(
  client_batch_id uuid,
  requests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_create_general_requests() then
    raise exception using errcode = '42501', message = 'GENERAL_REQUEST_CREATE_FORBIDDEN';
  end if;
  return private.insert_request_batch(client_batch_id, requests, 'general');
end;
$$;

create or replace function public.get_request_schema_compatibility()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'compatible', not exists (
      select 1
      from unnest(array[
        'app_tab_assignment', 'master_app_tab_assignment', 'request_source',
        'client_batch_id', 'updated_at', 'row_version'
      ]) required(column_name)
      where not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'ph_active_request'
          and c.column_name = required.column_name
      )
    ),
    'contract_version', 2,
    'required_columns', jsonb_build_array(
      'app_tab_assignment', 'master_app_tab_assignment', 'request_source',
      'client_batch_id', 'updated_at', 'row_version'
    )
  )
$$;

revoke all on function private.insert_request_batch(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_av_request_batch(uuid, jsonb) from public, anon;
revoke all on function public.create_request_batch(uuid, jsonb) from public, anon;
revoke all on function public.get_request_schema_compatibility() from public, anon;
grant execute on function public.create_av_request_batch(uuid, jsonb) to authenticated;
grant execute on function public.create_request_batch(uuid, jsonb) to authenticated;
grant execute on function public.get_request_schema_compatibility() to authenticated;

create or replace function public.save_request_work(
  request_id text,
  expected_version bigint,
  patch jsonb,
  complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.ph_active_request%rowtype;
  saved public.ph_active_request%rowtype;
  canonical jsonb;
  completion_time text;
  delivery_status text := 'not_queued';
begin
  if not private.can_save_request_work() then
    raise exception using errcode = '42501', message = 'REQUEST_SAVE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(request_id, '')), '') is null or expected_version is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_AND_VERSION_REQUIRED';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PATCH_INVALID';
  end if;

  select * into existing
  from public.ph_active_request
  where unique_id = request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;
  if existing.row_version <> expected_version then
    raise exception using
      errcode = '40001',
      message = 'REQUEST_VERSION_CONFLICT',
      detail = jsonb_build_object('current_version', existing.row_version)::text;
  end if;

  completion_time := case
    when complete then coalesce(nullif(patch->>'date_completed', ''), now()::text)
    else existing.date_completed
  end;

  update public.ph_active_request r
  set req_match = case when patch ? 'req_match' then
        case
          when nullif(btrim(coalesce(patch->>'req_match', '')), '') is null then null
          when btrim(patch->>'req_match') ~ '^-?[0-9]+([.][0-9]+)?$'
            then btrim(patch->>'req_match')::numeric
          else r.req_match
        end
      else r.req_match end,
      req_spec = case when patch ? 'req_spec' then patch->>'req_spec' else r.req_spec end,
      req_caliper = case when patch ? 'req_caliper' then patch->>'req_caliper' else r.req_caliper end,
      req_pic_note = case when patch ? 'req_pic_note' then patch->>'req_pic_note' else r.req_pic_note end,
      req_sales_note = case when patch ? 'req_sales_note' then patch->>'req_sales_note' else r.req_sales_note end,
      req_comments = case when patch ? 'req_comments' then patch->>'req_comments' else r.req_comments end,
      av_note = case when patch ? 'av_note' then patch->>'av_note' else r.av_note end,
      req_reserve = case when patch ? 'req_reserve' then patch->>'req_reserve' else r.req_reserve end,
      req_photo_link = case when patch ? 'req_photo_link' then patch->>'req_photo_link' else r.req_photo_link end,
      req_photo_name = case when patch ? 'req_photo_name' then patch->>'req_photo_name' else r.req_photo_name end,
      req_photo_mode = case when patch ? 'req_photo_mode' then patch->>'req_photo_mode' else r.req_photo_mode end,
      req_rep_action = case when patch ? 'req_rep_action' then patch->>'req_rep_action' else r.req_rep_action end,
      request_note = case when patch ? 'request_note' then patch->>'request_note' else r.request_note end,
      completed_by_username = case when patch ? 'completed_by_username' then patch->>'completed_by_username' else r.completed_by_username end,
      completed_by_display = case when patch ? 'completed_by_display' then patch->>'completed_by_display' else r.completed_by_display end,
      completed_by_email = case when patch ? 'completed_by_email' then patch->>'completed_by_email' else r.completed_by_email end,
      req_status = case when complete then 'Complete'
        when patch ? 'req_status' then patch->>'req_status' else r.req_status end,
      date_completed = completion_time,
      req_archived = case when complete then false
        when patch ? 'req_archived' then coalesce((patch->>'req_archived')::boolean, false)
        else r.req_archived end,
      row_version = r.row_version + 1
  where r.unique_id = request_id
    and r.row_version = expected_version
  returning r.* into saved;

  if not found then
    raise exception using errcode = '40001', message = 'REQUEST_VERSION_CONFLICT';
  end if;

  -- Shared AV work is committed to Drive in the same transaction. The Drive
  -- trigger propagates these values to every other pending request for the row.
  if saved.master_id is not null then
    update public.ph_master_inventory m
    set match = case when patch ? 'req_match' then patch->>'req_match' else m.match end,
        loc_match_qty = case when patch ? 'loc_match_qty' then patch->>'loc_match_qty' else m.loc_match_qty end,
        spec = case when patch ? 'req_spec' then patch->>'req_spec' else m.spec end,
        caliper = case when patch ? 'req_caliper' then patch->>'req_caliper' else m.caliper end,
        pic_note = case when patch ? 'req_pic_note' then patch->>'req_pic_note' else m.pic_note end,
        av_note = case when patch ? 'av_note' then patch->>'av_note' else m.av_note end,
        photo_link = case when patch ? 'drive_photo_link' then patch->>'drive_photo_link' else m.photo_link end,
        photo_name = case when patch ? 'drive_photo_name' then patch->>'drive_photo_name' else m.photo_name end,
        av_rule_priority_snapshot = case
          when patch ? 'req_match' or patch ? 'req_spec' or patch ? 'req_caliper'
            or patch ? 'req_pic_note' or patch ? 'av_note'
          then m.priority else m.av_rule_priority_snapshot end,
        av_rule_holdstop_snapshot = case
          when patch ? 'req_match' or patch ? 'req_spec' or patch ? 'req_caliper'
            or patch ? 'req_pic_note' or patch ? 'av_note'
          then concat_ws('|', nullif(btrim(coalesce(m.holdstopcode, '')), ''),
                              nullif(btrim(coalesce(m.holdstopreason, '')), ''))
          else m.av_rule_holdstop_snapshot end,
        av_rule_match_updated_at = case when patch ? 'req_match' then now() else m.av_rule_match_updated_at end,
        av_rule_spec_updated_at = case when patch ? 'req_spec' then now() else m.av_rule_spec_updated_at end,
        av_rule_caliper_updated_at = case when patch ? 'req_caliper' then now() else m.av_rule_caliper_updated_at end,
        av_rule_av_note_updated_at = case when patch ? 'av_note' then now() else m.av_rule_av_note_updated_at end,
        av_rule_photo_updated_at = case
          when patch ? 'drive_photo_link' or patch ? 'drive_photo_name' then now()
          else m.av_rule_photo_updated_at end,
        av_rule_bundle_updated_at = case
          when patch ? 'req_match' or patch ? 'req_spec' or patch ? 'req_caliper'
            or patch ? 'req_pic_note' or patch ? 'av_note'
            or patch ? 'drive_photo_link' or patch ? 'drive_photo_name'
          then now() else m.av_rule_bundle_updated_at end
    where m.unique_id = saved.master_id;
  end if;

  if complete then
    perform private.upsert_request_history(request_id, 'completed', 'pending', false);
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, request_id, request_folder, payload, status
    ) values (
      'request-completed:' || request_id || ':' || saved.row_version::text,
      'request_completed', request_id, saved.request_folder,
      jsonb_build_object('request_id', request_id, 'row_version', saved.row_version),
      'pending'
    ) on conflict (event_key) do nothing;
    delivery_status := 'pending';
  else
    perform private.upsert_request_history(request_id, 'updated', 'not_queued', false);
  end if;

  canonical := coalesce(private.canonical_request_json(request_id), to_jsonb(saved));
  return jsonb_build_object(
    'row', canonical,
    'row_version', coalesce((canonical->>'row_version')::bigint, saved.row_version),
    'delivery_state', delivery_status
  );
end;
$$;

create or replace function public.get_request_delivery_recovery_queue()
returns table (
  event_id uuid,
  event_type text,
  request_id text,
  request_folder text,
  status text,
  attempt_count integer,
  next_attempt_at timestamptz,
  sanitized_error_code text,
  created_at timestamptz,
  history_snapshot jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_requests() then
    raise exception using errcode = '42501', message = 'REQUEST_RECOVERY_FORBIDDEN';
  end if;
  return query
  select o.event_id, o.event_type, o.request_id, o.request_folder,
         o.status, o.attempt_count, o.next_attempt_at,
         o.sanitized_error_code, o.created_at, h.snapshot
  from public.ph_request_delivery_outbox o
  left join public.ph_request_history h on h.unique_id = o.request_id
  where o.status in ('unknown', 'failed')
  order by o.created_at desc;
end;
$$;

create or replace function public.requeue_request_delivery(delivery_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_event public.ph_request_delivery_outbox%rowtype;
begin
  if not private.can_manage_requests() then
    raise exception using errcode = '42501', message = 'REQUEST_RECOVERY_FORBIDDEN';
  end if;
  update public.ph_request_delivery_outbox
  set status = 'pending', next_attempt_at = now(), sanitized_error_code = null
  where event_id = delivery_event_id and status in ('unknown', 'failed')
  returning * into updated_event;
  if not found then
    raise exception using errcode = 'P0002', message = 'DELIVERY_EVENT_NOT_FOUND';
  end if;
  return to_jsonb(updated_event);
end;
$$;

revoke all on function public.save_request_work(text, bigint, jsonb, boolean) from public, anon;
revoke all on function public.get_request_delivery_recovery_queue() from public, anon;
revoke all on function public.requeue_request_delivery(uuid) from public, anon;
grant execute on function public.save_request_work(text, bigint, jsonb, boolean) to authenticated;
grant execute on function public.get_request_delivery_recovery_queue() to authenticated;
grant execute on function public.requeue_request_delivery(uuid) to authenticated;

-- Initial Drive reconciliation preserves any existing assignment. The initial
-- unassigned population is represented by one summary alert, not 3,000+ pushes.
insert into public.ph_warehouse_assigned_items (
  unique_id, itemcode, itemcode_normalized, commonname, contsize,
  locationcode, source, first_seen_at, last_seen_at, present_in_drive,
  raw_row, updated_at
)
select
  'eval-itemcode-' || md5(d.itemcode_normalized),
  d.itemcode_normalized,
  d.itemcode_normalized,
  d.commonname,
  d.contsize,
  d.locationcode,
  'supabase_drive_reconcile',
  now(), now(), true,
  jsonb_build_object('authority', 'supabase', 'scope', 'global_itemcode'),
  now()
from (
  select upper(btrim(itemcode)) as itemcode_normalized,
         max(commonname) as commonname,
         max(contsize) as contsize,
         max(locationcode) as locationcode
  from public.ph_master_inventory
  where nullif(btrim(coalesce(itemcode, '')), '') is not null
  group by upper(btrim(itemcode))
) d
on conflict (itemcode_normalized) where itemcode_normalized is not null
do update set
  itemcode = excluded.itemcode,
  commonname = excluded.commonname,
  contsize = excluded.contsize,
  locationcode = excluded.locationcode,
  source = 'supabase_drive_reconcile',
  last_seen_at = now(),
  present_in_drive = true,
  updated_at = now();

update public.ph_warehouse_assigned_items
set unassigned_notified_at = now()
where itemcode_normalized is not null
  and nullif(btrim(coalesce(assignedto, '')), '') is null
  and unassigned_notified_at is null;

insert into public.ph_request_delivery_outbox (
  event_key, event_type, payload, status
)
select
  'eval-unassigned-initial-summary',
  'eval_assignment_summary',
  jsonb_build_object(
    'unassigned_count', count(*),
    'manager_usernames', jsonb_build_array('dylan_collyge', 'megan_kelly')
  ),
  'pending'
from public.ph_warehouse_assigned_items
where itemcode_normalized is not null
  and nullif(btrim(coalesce(assignedto, '')), '') is null
having count(*) > 0
on conflict (event_key) do nothing;

create or replace function public.reconcile_eval_itemcodes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  discovered integer := 0;
  alerted integer := 0;
  unassigned_total integer := 0;
begin
  update public.ph_warehouse_assigned_items
  set present_in_drive = false, updated_at = now()
  where itemcode_normalized is not null;

  with drive_codes as (
    select upper(btrim(itemcode)) as itemcode_normalized,
           max(commonname) as commonname,
           max(contsize) as contsize,
           max(locationcode) as locationcode
    from public.ph_master_inventory
    where nullif(btrim(coalesce(itemcode, '')), '') is not null
    group by upper(btrim(itemcode))
  ), written as (
    insert into public.ph_warehouse_assigned_items (
      unique_id, itemcode, itemcode_normalized, commonname, contsize,
      locationcode, source, first_seen_at, last_seen_at, present_in_drive,
      raw_row, updated_at
    )
    select 'eval-itemcode-' || md5(d.itemcode_normalized),
           d.itemcode_normalized, d.itemcode_normalized, d.commonname,
           d.contsize, d.locationcode, 'supabase_drive_reconcile',
           now(), now(), true,
           jsonb_build_object('authority', 'supabase', 'scope', 'global_itemcode'),
           now()
    from drive_codes d
    on conflict (itemcode_normalized) where itemcode_normalized is not null
    do update set
      itemcode = excluded.itemcode,
      commonname = excluded.commonname,
      contsize = excluded.contsize,
      locationcode = excluded.locationcode,
      source = 'supabase_drive_reconcile',
      last_seen_at = now(),
      present_in_drive = true,
      updated_at = now()
    returning (xmax = 0) as was_inserted
  )
  select count(*) filter (where was_inserted) into discovered from written;

  with needs_alert as (
    select id, itemcode_normalized
    from public.ph_warehouse_assigned_items
    where present_in_drive
      and nullif(btrim(coalesce(assignedto, '')), '') is null
      and unassigned_notified_at is null
    for update
  ), queued as (
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, payload, status
    )
    select 'eval-unassigned:' || itemcode_normalized,
           'eval_assignment_unassigned',
           jsonb_build_object(
             'itemcode', itemcode_normalized,
             'manager_usernames', jsonb_build_array('dylan_collyge', 'megan_kelly')
           ),
           'pending'
    from needs_alert
    on conflict (event_key) do update set
      status = case
        when public.ph_request_delivery_outbox.status = 'delivered' then 'pending'
        else public.ph_request_delivery_outbox.status end,
      next_attempt_at = now(),
      delivered_at = null,
      sanitized_error_code = null
    returning event_key
  )
  select count(*) into alerted from queued;

  update public.ph_warehouse_assigned_items
  set unassigned_notified_at = now(), updated_at = now()
  where present_in_drive
    and nullif(btrim(coalesce(assignedto, '')), '') is null
    and unassigned_notified_at is null;

  select count(*) into unassigned_total
  from public.ph_warehouse_assigned_items
  where present_in_drive
    and nullif(btrim(coalesce(assignedto, '')), '') is null;

  return jsonb_build_object(
    'discovered', discovered,
    'alerts_queued', alerted,
    'unassigned_count', unassigned_total
  );
end;
$$;

create or replace function public.set_eval_itemcode_assignment(
  itemcode text,
  assignedto text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text := upper(btrim(coalesce(itemcode, '')));
  requested_assignee text := nullif(btrim(coalesce(assignedto, '')), '');
  canonical_assignee text;
  manager_username text;
  assignment public.ph_warehouse_assigned_items%rowtype;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'EVAL_ASSIGNMENT_FORBIDDEN';
  end if;
  if normalized_code = '' then
    raise exception using errcode = '22023', message = 'ITEMCODE_REQUIRED';
  end if;

  manager_username := (private.current_active_profile()).username;
  if requested_assignee is not null then
    select p.username into canonical_assignee
    from public.profiles p
    where p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and private.normalized_profile_role(p.role) = 'EVAL'
      and (lower(btrim(p.username)) = lower(requested_assignee)
           or lower(btrim(coalesce(p.display_name, ''))) = lower(requested_assignee))
    limit 1;
    if canonical_assignee is null then
      raise exception using errcode = '22023', message = 'ASSIGNEE_MUST_BE_ACTIVE_EVAL_USER';
    end if;
  end if;

  insert into public.ph_warehouse_assigned_items (
    unique_id, itemcode, itemcode_normalized, assignedto, assigned_by,
    assigned_at, first_seen_at, last_seen_at, present_in_drive,
    source, raw_row, updated_at, unassigned_notified_at
  ) values (
    'eval-itemcode-' || md5(normalized_code), normalized_code,
    normalized_code, canonical_assignee, manager_username,
    case when canonical_assignee is null then null else now() end,
    now(), now(), exists (
      select 1 from public.ph_master_inventory
      where upper(btrim(coalesce(ph_master_inventory.itemcode, ''))) = normalized_code
    ),
    'supabase_assignment_manager',
    jsonb_build_object('authority', 'supabase', 'scope', 'global_itemcode'),
    now(), case when canonical_assignee is null then null else now() end
  )
  on conflict (itemcode_normalized) where itemcode_normalized is not null
  do update set
    assignedto = excluded.assignedto,
    assigned_by = excluded.assigned_by,
    assigned_at = excluded.assigned_at,
    updated_at = now(),
    unassigned_notified_at = case
      when excluded.assignedto is null
           and nullif(btrim(coalesce(public.ph_warehouse_assigned_items.assignedto, '')), '') is not null
        then null
      when excluded.assignedto is not null then now()
      else public.ph_warehouse_assigned_items.unassigned_notified_at
    end
  returning * into assignment;

  if canonical_assignee is null and assignment.unassigned_notified_at is null then
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, payload, status
    ) values (
      'eval-unassigned:' || normalized_code,
      'eval_assignment_unassigned',
      jsonb_build_object(
        'itemcode', normalized_code,
        'manager_usernames', jsonb_build_array('dylan_collyge', 'megan_kelly')
      ),
      'pending'
    )
    on conflict (event_key) do update set
      status = 'pending', next_attempt_at = now(), delivered_at = null,
      sanitized_error_code = null;

    update public.ph_warehouse_assigned_items
    set unassigned_notified_at = now(), updated_at = now()
    where id = assignment.id
    returning * into assignment;
  end if;

  return to_jsonb(assignment);
end;
$$;

alter table public.ph_push_subscriptions
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade;

create index if not exists idx_ph_push_subscriptions_profile
  on public.ph_push_subscriptions (profile_id);

create or replace function public.upsert_my_push_subscription(subscription jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  endpoint_value text;
  p256dh_value text;
  auth_value text;
  saved public.ph_push_subscriptions%rowtype;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if subscription is null or jsonb_typeof(subscription) <> 'object' then
    raise exception using errcode = '22023', message = 'PUSH_SUBSCRIPTION_INVALID';
  end if;
  endpoint_value := nullif(btrim(coalesce(subscription->>'endpoint', '')), '');
  p256dh_value := nullif(btrim(coalesce(subscription#>>'{keys,p256dh}', subscription->>'p256dh', '')), '');
  auth_value := nullif(btrim(coalesce(subscription#>>'{keys,auth}', subscription->>'auth', '')), '');
  if endpoint_value is null or p256dh_value is null or auth_value is null then
    raise exception using errcode = '22023', message = 'PUSH_SUBSCRIPTION_KEYS_REQUIRED';
  end if;

  insert into public.ph_push_subscriptions (
    profile_id, username, display_name, role, endpoint, p256dh, auth,
    device_label, user_agent, app_build, notifications_enabled,
    wants_new_request, wants_request_complete, subscription_json,
    last_seen, updated_at
  ) values (
    profile.id, profile.username, profile.display_name, profile.role,
    endpoint_value, p256dh_value, auth_value,
    left(coalesce(subscription->>'device_label', ''), 160),
    left(coalesce(subscription->>'user_agent', ''), 500),
    left(coalesce(subscription->>'app_build', ''), 80),
    coalesce((subscription->>'notifications_enabled')::boolean, true),
    coalesce((subscription->>'wants_new_request')::boolean, true),
    coalesce((subscription->>'wants_request_complete')::boolean, true),
    subscription, now(), now()
  )
  on conflict (endpoint) do update set
    profile_id = excluded.profile_id,
    username = excluded.username,
    display_name = excluded.display_name,
    role = excluded.role,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    device_label = excluded.device_label,
    user_agent = excluded.user_agent,
    app_build = excluded.app_build,
    notifications_enabled = excluded.notifications_enabled,
    wants_new_request = excluded.wants_new_request,
    wants_request_complete = excluded.wants_request_complete,
    subscription_json = excluded.subscription_json,
    last_seen = now(), updated_at = now()
  returning * into saved;

  return jsonb_build_object(
    'id', saved.id,
    'endpoint', saved.endpoint,
    'notifications_enabled', saved.notifications_enabled,
    'updated_at', saved.updated_at
  );
end;
$$;

revoke all on function public.reconcile_eval_itemcodes() from public, anon, authenticated;
revoke all on function public.set_eval_itemcode_assignment(text, text) from public, anon;
revoke all on function public.upsert_my_push_subscription(jsonb) from public, anon;
grant execute on function public.reconcile_eval_itemcodes() to service_role;
grant execute on function public.set_eval_itemcode_assignment(text, text) to authenticated;
grant execute on function public.upsert_my_push_subscription(jsonb) to authenticated;

create or replace function public.report_app_health_event(
  event_name text,
  area text,
  severity text,
  sanitized_code text default null,
  duration_ms integer default null,
  sample_rate numeric default 1,
  app_build text default null,
  metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  safe_metadata jsonb;
  event_id bigint;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if nullif(btrim(coalesce(event_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'HEALTH_EVENT_NAME_REQUIRED';
  end if;

  safe_metadata := case when jsonb_typeof(coalesce(metadata, '{}'::jsonb)) = 'object'
    then coalesce(metadata, '{}'::jsonb)
      - array[
          'customer', 'customer_name', 'notes', 'note', 'photo', 'photos',
          'url', 'urls', 'endpoint', 'request', 'requests', 'payload',
          'commonname', 'display_name', 'email', 'name'
        ]::text[]
    else '{}'::jsonb end;
  if octet_length(safe_metadata::text) > 4096 then
    safe_metadata := jsonb_build_object('metadata_truncated', true);
  end if;

  insert into public.ph_app_health_events (
    profile_id, username, event_name, area, severity, sanitized_code,
    duration_ms, sample_rate, app_build, metadata
  ) values (
    profile.id, profile.username, left(event_name, 120), left(coalesce(area, 'app'), 80),
    case when lower(coalesce(severity, 'error')) in ('info', 'warning', 'error', 'critical')
      then lower(coalesce(severity, 'error')) else 'error' end,
    left(sanitized_code, 160), greatest(0, duration_ms),
    least(1, greatest(0, coalesce(sample_rate, 1))), left(app_build, 80), safe_metadata
  ) returning id into event_id;
  return event_id;
end;
$$;

create or replace function private.expire_shared_av_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer := 0;
begin
  with expired as (
    select unique_id,
           case
             when av_rule_bundle_updated_at < now() - interval '10 days' then 'stale_10_day'
             when nullif(btrim(coalesce(loc_match_qty, '')), '') is not null
                  and btrim(loc_match_qty) ~ '^-?[0-9]+([.][0-9]+)?$'
                  and btrim(loc_match_qty)::numeric <= 0 then 'loc_photo_match_qty_zero'
             when av_rule_priority_snapshot is not null
                  and av_rule_priority_snapshot is distinct from priority then 'priority_changed'
             when av_rule_holdstop_snapshot is not null
                  and av_rule_holdstop_snapshot is distinct from
                    concat_ws('|', nullif(btrim(coalesce(holdstopcode, '')), ''),
                                   nullif(btrim(coalesce(holdstopreason, '')), ''))
               then 'hold_stop_changed'
           end as reason
    from public.ph_master_inventory
    where av_rule_bundle_updated_at is not null
      and (
        av_rule_bundle_updated_at < now() - interval '10 days'
        or (
          nullif(btrim(coalesce(loc_match_qty, '')), '') is not null
          and btrim(loc_match_qty) ~ '^-?[0-9]+([.][0-9]+)?$'
          and btrim(loc_match_qty)::numeric <= 0
        )
        or (av_rule_priority_snapshot is not null
            and av_rule_priority_snapshot is distinct from priority)
        or (av_rule_holdstop_snapshot is not null
            and av_rule_holdstop_snapshot is distinct from
              concat_ws('|', nullif(btrim(coalesce(holdstopcode, '')), ''),
                             nullif(btrim(coalesce(holdstopreason, '')), '')))
      )
  ), cleared as (
    update public.ph_master_inventory m
    set match = null, loc_match_qty = null, spec = null, caliper = null,
        pic_note = null, av_note = null, photo_link = null, photo_name = null,
        av_rule_bundle_updated_at = null,
        av_rule_av_note_updated_at = null,
        av_rule_spec_updated_at = null,
        av_rule_match_updated_at = null,
        av_rule_caliper_updated_at = null,
        av_rule_photo_updated_at = null,
        av_rule_priority_snapshot = m.priority,
        av_rule_holdstop_snapshot = concat_ws('|',
          nullif(btrim(coalesce(m.holdstopcode, '')), ''),
          nullif(btrim(coalesce(m.holdstopreason, '')), '')),
        av_rule_last_clear_reason = expired.reason,
        av_rule_last_cleared_at = now()
    from expired
    where m.unique_id = expired.unique_id
    returning m.unique_id
  )
  select count(*) into expired_count from cleared;
  return expired_count;
end;
$$;

create or replace function private.record_request_health_audit()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing_history integer;
  missing_drive integer;
  exhausted_delivery integer;
  unassigned integer;
  active_codes integer;
begin
  select count(*) into missing_history
  from public.ph_active_request r
  where (
      lower(coalesce(r.req_status, '')) in ('complete', 'completed')
      or nullif(btrim(coalesce(r.date_completed, '')), '') is not null
    )
    and not exists (
      select 1 from public.ph_request_history h where h.unique_id = r.unique_id
    );

  select count(*) into missing_drive
  from public.ph_active_request r
  where coalesce(r.req_archived, false) = false
    and lower(coalesce(r.req_status, 'pending')) not in ('complete', 'completed')
    and not exists (
      select 1 from public.ph_master_inventory m where m.unique_id = r.master_id
    );

  select count(*) into exhausted_delivery
  from public.ph_request_delivery_outbox
  where status = 'failed' and attempt_count >= 8;

  select count(*) into unassigned
  from public.ph_warehouse_assigned_items
  where present_in_drive
    and nullif(btrim(coalesce(assignedto, '')), '') is null;
  select count(*) into active_codes
  from public.ph_warehouse_assigned_items where present_in_drive;

  insert into public.ph_app_health_events (
    event_name, area, severity, sanitized_code, sample_rate, metadata
  ) values (
    'scheduled_request_health_audit', 'request_integrity',
    case when missing_history > 0 or exhausted_delivery > 0 then 'error'
         when missing_drive > 0 or unassigned > 0 then 'warning' else 'info' end,
    case when missing_history > 0 then 'MISSING_HISTORY'
         when exhausted_delivery > 0 then 'DELIVERY_RETRY_EXHAUSTED'
         when missing_drive > 0 then 'DRIVE_ROW_MISSING'
         when unassigned > 0 then 'EVAL_ASSIGNMENT_GAP'
         else 'HEALTHY' end,
    1,
    jsonb_build_object(
      'missing_history_count', missing_history,
      'missing_drive_row_count', missing_drive,
      'delivery_retry_exhausted_count', exhausted_delivery,
      'unassigned_itemcode_count', unassigned,
      'drive_itemcode_count', active_codes
    )
  );

  return jsonb_build_object(
    'missing_history_count', missing_history,
    'missing_drive_row_count', missing_drive,
    'delivery_retry_exhausted_count', exhausted_delivery,
    'unassigned_itemcode_count', unassigned,
    'drive_itemcode_count', active_codes
  );
end;
$$;

create or replace function public.run_request_integrity_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_result jsonb;
  audit_result jsonb;
  expired_count integer;
begin
  assignment_result := public.reconcile_eval_itemcodes();
  expired_count := private.expire_shared_av_results();
  audit_result := private.record_request_health_audit();
  return jsonb_build_object(
    'assignments', assignment_result,
    'expired_av_rows', expired_count,
    'health', audit_result
  );
end;
$$;

revoke all on function public.report_app_health_event(text, text, text, text, integer, numeric, text, jsonb) from public, anon;
revoke all on function private.expire_shared_av_results() from public, anon, authenticated;
revoke all on function private.record_request_health_audit() from public, anon, authenticated;
revoke all on function public.run_request_integrity_maintenance() from public, anon, authenticated;
grant execute on function public.report_app_health_event(text, text, text, text, integer, numeric, text, jsonb) to authenticated;
grant execute on function public.run_request_integrity_maintenance() to service_role;

-- Security boundary: logged-in users may read app data, but request History,
-- Eval assignments, push subscriptions, and delivery state mutate only through
-- the scoped RPCs above (or service-role workers).
alter table public.ph_active_request enable row level security;
alter table public.ph_request_history enable row level security;
alter table public.ph_request_delivery_outbox enable row level security;
alter table public.ph_warehouse_assigned_items enable row level security;
alter table public.ph_push_subscriptions enable row level security;
alter table public.ph_app_health_events enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'ph_active_request', 'ph_request_history',
        'ph_request_delivery_outbox', 'ph_warehouse_assigned_items',
        'ph_push_subscriptions', 'ph_app_health_events'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$$;

revoke all on table public.ph_active_request from anon;
revoke all on table public.ph_request_history from anon;
revoke all on table public.ph_request_delivery_outbox from anon;
revoke all on table public.ph_warehouse_assigned_items from anon;
revoke all on table public.ph_push_subscriptions from anon;
revoke all on table public.ph_app_health_events from anon;

revoke insert, update, delete on table public.ph_request_history from authenticated;
revoke insert, update, delete on table public.ph_request_delivery_outbox from authenticated;
revoke insert, update, delete on table public.ph_warehouse_assigned_items from authenticated;
revoke insert, update on table public.ph_push_subscriptions from authenticated;
revoke insert, update, delete on table public.ph_app_health_events from authenticated;

grant select, insert, update, delete on table public.ph_active_request to authenticated;
grant select on table public.ph_request_history to authenticated;
grant select on table public.ph_warehouse_assigned_items to authenticated;
grant select, delete on table public.ph_push_subscriptions to authenticated;
grant select on table public.ph_request_delivery_outbox to authenticated;
grant select on table public.ph_app_health_events to authenticated;
grant select on table public.ph_master_inventory to authenticated;
grant all on table public.ph_request_delivery_outbox to service_role;
grant all on table public.ph_app_health_events to service_role;
grant all on table public.ph_warehouse_assigned_items to service_role;
grant all on table public.ph_push_subscriptions to service_role;
grant all on table public.ph_active_request to service_role;
grant all on table public.ph_request_history to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy ph_active_request_authenticated_read
on public.ph_active_request for select to authenticated
using ((private.current_active_profile()).id is not null);

create policy ph_active_request_general_insert
on public.ph_active_request for insert to authenticated
with check (private.can_create_general_requests());

create policy ph_active_request_general_update
on public.ph_active_request for update to authenticated
using (private.can_create_general_requests())
with check (private.can_create_general_requests());

create policy ph_active_request_manager_delete
on public.ph_active_request for delete to authenticated
using (private.can_manage_requests());

create policy ph_request_history_authenticated_read
on public.ph_request_history for select to authenticated
using ((private.current_active_profile()).id is not null);

create policy ph_eval_assignment_authenticated_read
on public.ph_warehouse_assigned_items for select to authenticated
using ((private.current_active_profile()).id is not null);

create policy ph_push_subscription_own_read
on public.ph_push_subscriptions for select to authenticated
using (profile_id = (select auth.uid()));

create policy ph_push_subscription_own_delete
on public.ph_push_subscriptions for delete to authenticated
using (profile_id = (select auth.uid()));

create policy ph_request_delivery_manager_read
on public.ph_request_delivery_outbox for select to authenticated
using (private.can_manage_requests());

create policy ph_app_health_manager_read
on public.ph_app_health_events for select to authenticated
using (private.can_manage_requests());

-- Recover completed request snapshots that never reached History. Their
-- delivery status is deliberately unknown and no automatic resend is queued.
do $$
declare missing record;
begin
  for missing in
    select r.unique_id, r.request_folder
    from public.ph_active_request r
    where (
        lower(coalesce(r.req_status, '')) in ('complete', 'completed')
        or nullif(btrim(coalesce(r.date_completed, '')), '') is not null
      )
      and not exists (
        select 1 from public.ph_request_history h where h.unique_id = r.unique_id
      )
  loop
    perform private.upsert_request_history(missing.unique_id, 'recovered', 'unknown', true);
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, request_id, request_folder, payload, status,
      sanitized_error_code
    ) values (
      'request-recovered:' || missing.unique_id,
      'request_completed', missing.unique_id, missing.request_folder,
      jsonb_build_object('request_id', missing.unique_id, 'recovered', true),
      'unknown', 'RECOVERED_WITHOUT_DELIVERY_RECORD'
    ) on conflict (event_key) do nothing;
  end loop;
end
$$;

comment on function public.create_av_request_batch(uuid, jsonb) is
  'Idempotent AV-only request batch entry point; sales roles use this function.';
comment on function public.create_request_batch(uuid, jsonb) is
  'Idempotent non-sales request batch entry point; sales roles are rejected.';
comment on function public.save_request_work(text, bigint, jsonb, boolean) is
  'Optimistic-concurrency Request save; atomically updates Drive AV fields, History, and delivery outbox.';
comment on function public.set_eval_itemcode_assignment(text, text) is
  'Secured global ItemCode assignment function for dylan_collyge and megan_kelly.';
comment on function public.upsert_my_push_subscription(jsonb) is
  'Registers the authenticated caller push subscription without trusting client identity fields.';

commit;
