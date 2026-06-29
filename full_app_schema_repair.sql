-- GNC App Full Schema Repair
-- Generated from the repo migration files so you can run one SQL script in Supabase.
-- Safe behavior: creates/repairs missing tables, columns, policies, functions, indexes, buckets, and views.
-- Destructive behavior: this script intentionally does NOT drop unknown tables. Some included migrations prune transient live-event rows or duplicate join rows only.
-- Cleanup help: after running, inspect public.v2_app_schema_cleanup_candidates for objects to review manually.
-- Run in Supabase SQL Editor as the project owner/postgres role.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;


-- ============================================================================
-- Source: app_live_events_migration.sql
-- ============================================================================

-- Quota-safe live update index for the GNC app.
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.v2_app_live_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  area text not null,
  source_table text not null,
  row_ids text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  actor_username text,
  actor_display text,
  client_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_v2_app_live_events_created_at
  on public.v2_app_live_events (created_at desc);

create index if not exists idx_v2_app_live_events_area_created_at
  on public.v2_app_live_events (area, created_at desc);

create index if not exists idx_v2_app_live_events_source_created_at
  on public.v2_app_live_events (source_table, created_at desc);

alter table public.v2_app_live_events replica identity full;

alter table public.v2_app_live_events enable row level security;

drop policy if exists "Allow app live event reads" on public.v2_app_live_events;
create policy "Allow app live event reads"
  on public.v2_app_live_events
  for select
  using (true);

drop policy if exists "Allow app live event inserts" on public.v2_app_live_events;
create policy "Allow app live event inserts"
  on public.v2_app_live_events
  for insert
  with check (true);

drop policy if exists "Allow app live event cleanup" on public.v2_app_live_events;
create policy "Allow app live event cleanup"
  on public.v2_app_live_events
  for delete
  using (true);

do $$
begin
  alter publication supabase_realtime add table public.v2_app_live_events;
exception
  when duplicate_object then null;
end $$;

create or replace function public.prune_v2_app_live_events(retention_days integer default 10)
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from public.v2_app_live_events
  where created_at < now() - make_interval(days => greatest(retention_days, 1));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

select public.prune_v2_app_live_events(10);


-- ============================================================================
-- Source: push_notifications_migration.sql
-- ============================================================================

create table if not exists public.v2_push_subscriptions (
    id bigint generated always as identity primary key,
    username text not null,
    display_name text,
    role text,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    device_label text,
    user_agent text,
    app_build text,
    notifications_enabled boolean not null default true,
    wants_new_request boolean not null default true,
    wants_request_complete boolean not null default true,
    subscription_json jsonb not null default '{}'::jsonb,
    last_seen timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_push_subscriptions_username on public.v2_push_subscriptions (lower(username));
create index if not exists idx_v2_push_subscriptions_enabled on public.v2_push_subscriptions (notifications_enabled);

alter table public.v2_push_subscriptions
    add column if not exists wants_new_request boolean not null default true,
    add column if not exists wants_request_complete boolean not null default true,
    add column if not exists notifications_enabled boolean not null default true,
    add column if not exists subscription_json jsonb not null default '{}'::jsonb,
    add column if not exists last_seen timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

alter table public.v2_push_subscriptions
    alter column wants_new_request set default true,
    alter column wants_request_complete set default true;

update public.v2_push_subscriptions
set wants_new_request = true,
    wants_request_complete = true,
    notifications_enabled = true
where notifications_enabled = true
   or notifications_enabled is null;

create or replace function public.set_v2_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_v2_push_subscriptions_updated_at on public.v2_push_subscriptions;
create trigger trg_v2_push_subscriptions_updated_at
before update on public.v2_push_subscriptions
for each row
execute function public.set_v2_push_subscriptions_updated_at();


-- ============================================================================
-- Source: quota_safe_live_sync_migration.sql
-- ============================================================================

-- Quota-safe Supabase Realtime setup for the GNC app.
-- Run this in Supabase SQL Editor after deploying PWA shell V2026.05.11.10.
--
-- Goal:
--   1. Keep one tiny live signal stream: public.v2_app_live_events.
--   2. Keep direct realtime only for chat/walkie communication tables.
--   3. Remove high-volume inventory/request/task tables from direct Realtime.

create extension if not exists pgcrypto;

create table if not exists public.v2_app_live_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  area text not null,
  source_table text not null,
  row_ids text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  actor_username text,
  actor_display text,
  client_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_v2_app_live_events_created_at
  on public.v2_app_live_events (created_at desc);

create index if not exists idx_v2_app_live_events_area_created_at
  on public.v2_app_live_events (area, created_at desc);

create index if not exists idx_v2_app_live_events_source_created_at
  on public.v2_app_live_events (source_table, created_at desc);

alter table public.v2_app_live_events replica identity full;
alter table public.v2_app_live_events enable row level security;

drop policy if exists "Allow app live event reads" on public.v2_app_live_events;
create policy "Allow app live event reads"
  on public.v2_app_live_events
  for select
  using (true);

drop policy if exists "Allow app live event inserts" on public.v2_app_live_events;
create policy "Allow app live event inserts"
  on public.v2_app_live_events
  for insert
  with check (true);

drop policy if exists "Allow app live event cleanup" on public.v2_app_live_events;
create policy "Allow app live event cleanup"
  on public.v2_app_live_events
  for delete
  using (true);

create or replace function public.prune_v2_app_live_events(retention_days integer default 3)
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from public.v2_app_live_events
  where created_at < now() - make_interval(days => greatest(retention_days, 1));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.v2_app_live_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
declare
  target_table text;
  direct_realtime_tables text[] := array[
    'v2_chat_conversations',
    'v2_chat_participants',
    'v2_chat_messages',
    'v2_walkie_channels',
    'v2_walkie_channel_members',
    'v2_walkie_calls',
    'v2_walkie_call_members',
    'v2_walkie_signal_events'
  ];
begin
  foreach target_table in array direct_realtime_tables loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = target_table
    )
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end $$;

do $$
declare
  target_table text;
  high_volume_tables text[] := array[
    'v2_master_inventory',
    'v2_active_request',
    'v2_request_history',
    'v2_sales_office',
    'v2_flyer_folder_rows',
    'v2_flyer_folder_history',
    'v2_take_back_queue',
    'v2_dock_team_status',
    'v2_dock_item_status',
    'v2_dock_issue_status',
    'v2_dock_issue_allocations',
    'v2_reserves',
    'v2_soc_master',
    'v2_cav_import',
    'v2_av_notes',
    'v2_ml_image_jobs',
    'v2_labor_hours',
    'marketing_materials'
  ];
begin
  foreach target_table in array high_volume_tables loop
    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', target_table);
    end if;
  end loop;
end $$;

select public.prune_v2_app_live_events(3);

select
  schemaname,
  tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;


-- ============================================================================
-- Source: request_history_migration.sql
-- ============================================================================

-- Request and Flyer folder history tables
-- Keeps folder rows and photo references available after rows leave active/pending queues.

create table if not exists public.v2_request_history (
    unique_id text primary key,
    master_id text,
    master_unique_id text,
    source_table text default 'v2_active_request',
    request_folder text not null default 'Unassigned',
    request_customer text,
    requested_by text,
    req_status text default 'Pending',
    req_archived boolean default false,
    req_rep_action text,
    req_qty text,
    req_reserve text,
    req_match text,
    req_spec text,
    req_caliper text,
    req_pic_note text,
    req_comments text,
    av_note text,
    date_completed timestamptz,
    itemcode text,
    commonname text,
    contsize text,
    locationcode text,
    lotcode text,
    priority text,
    ptronhand text,
    ptrreviewed text,
    ptravailable text,
    s_lts text,
    holdstopcode text,
    season text,
    photo_link text,
    photo_name text,
    completed_by_username text,
    completed_by_display text,
    completed_by_email text,
    snapshot jsonb not null default '{}'::jsonb,
    last_event text,
    created_by_username text,
    created_by_display text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_request_history_folder on public.v2_request_history (request_folder);
create index if not exists idx_v2_request_history_requested_by on public.v2_request_history (requested_by);
create index if not exists idx_v2_request_history_completed_by_username on public.v2_request_history (completed_by_username);
create index if not exists idx_v2_request_history_updated_at on public.v2_request_history (updated_at desc);
create index if not exists idx_v2_request_history_date_completed on public.v2_request_history (date_completed desc);

alter table public.v2_request_history enable row level security;

drop policy if exists "Allow app read request history" on public.v2_request_history;
create policy "Allow app read request history"
on public.v2_request_history
for select
using (true);

drop policy if exists "Allow app write request history" on public.v2_request_history;
create policy "Allow app write request history"
on public.v2_request_history
for all
using (true)
with check (true);

create table if not exists public.v2_flyer_folder_history (
    unique_id text primary key,
    master_unique_id text,
    source_table text default 'v2_master_inventory',
    flyer_title text not null default 'Unassigned',
    folder_name text,
    folder_tab text not null default 'active',
    history_state text not null default 'active',
    flyer_assigned text,
    flyer_cat text,
    flyer_inst text,
    flyer_notes text,
    flyer_completed timestamptz,
    assignedto text,
    date_completed timestamptz,
    itemcode text,
    commonname text,
    contsize text,
    locationcode text,
    lotcode text,
    priority text,
    ptravailable text,
    s_lts text,
    holdstopcode text,
    plantgroupcode text,
    locationnote text,
    av_note text,
    match numeric,
    loc_match_qty numeric,
    spec text,
    caliper text,
    pick text,
    initial_ptr numeric,
    flyer_av_note text,
    flyer_match numeric,
    flyer_loc_match_qty numeric,
    flyer_spec text,
    flyer_caliper text,
    flyer_pick text,
    flyer_initial_ptr numeric,
    flyer_photo_link text,
    flyer_photo_name text,
    snapshot jsonb not null default '{}'::jsonb,
    last_event text,
    created_by_username text,
    created_by_display text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_flyer_folder_history_folder on public.v2_flyer_folder_history (folder_name);
create index if not exists idx_v2_flyer_folder_history_tab on public.v2_flyer_folder_history (folder_tab);
create index if not exists idx_v2_flyer_folder_history_master on public.v2_flyer_folder_history (master_unique_id);
create index if not exists idx_v2_flyer_folder_history_updated_at on public.v2_flyer_folder_history (updated_at desc);

alter table public.v2_flyer_folder_history enable row level security;

drop policy if exists "Allow app read flyer folder history" on public.v2_flyer_folder_history;
create policy "Allow app read flyer folder history"
on public.v2_flyer_folder_history
for select
using (true);

drop policy if exists "Allow app write flyer folder history" on public.v2_flyer_folder_history;
create policy "Allow app write flyer folder history"
on public.v2_flyer_folder_history
for all
using (true)
with check (true);

create or replace function public.touch_history_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_v2_request_history_updated_at on public.v2_request_history;
create trigger trg_touch_v2_request_history_updated_at
before update on public.v2_request_history
for each row
execute function public.touch_history_updated_at();

drop trigger if exists trg_touch_v2_flyer_folder_history_updated_at on public.v2_flyer_folder_history;
create trigger trg_touch_v2_flyer_folder_history_updated_at
before update on public.v2_flyer_folder_history
for each row
execute function public.touch_history_updated_at();

do $$
begin
    alter publication supabase_realtime add table public.v2_request_history;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.v2_flyer_folder_history;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;


-- ============================================================================
-- Source: request_photo_mode_migration.sql
-- ============================================================================

alter table if exists public.v2_active_request
    add column if not exists req_photo_mode text null;


-- ============================================================================
-- Source: request_completion_users_migration.sql
-- ============================================================================

-- Request completion user tracking
-- Adds the completing user to each active request row so the final folder reply
-- can show who completed each row and include those users on the email thread.

alter table public.v2_active_request
    add column if not exists completed_by_username text,
    add column if not exists completed_by_display text,
    add column if not exists completed_by_email text;

create index if not exists idx_v2_active_request_completed_by_username
on public.v2_active_request (completed_by_username);

create index if not exists idx_v2_active_request_completed_at_user
on public.v2_active_request (date_completed desc, completed_by_username);

do $$
begin
    if to_regclass('public.v2_request_history') is not null then
        execute 'alter table public.v2_request_history add column if not exists completed_by_username text';
        execute 'alter table public.v2_request_history add column if not exists completed_by_display text';
        execute 'alter table public.v2_request_history add column if not exists completed_by_email text';
        execute 'alter table public.v2_request_history add column if not exists ptronhand text';
        execute 'alter table public.v2_request_history add column if not exists ptrreviewed text';
        execute 'alter table public.v2_request_history add column if not exists ptravailable text';

        execute 'create index if not exists idx_v2_request_history_completed_by_username on public.v2_request_history (completed_by_username)';
    end if;
end $$;


-- ============================================================================
-- Source: request_email_threads_migration.sql
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.v2_request_email_threads (
    id uuid primary key default gen_random_uuid(),
    request_folder text not null unique,
    request_customer text null,
    sales_rep_name text null,
    sales_rep_email text null,
    recipients jsonb not null default '[]'::jsonb,
    initial_thread_id text null,
    initial_message_id text null,
    initial_email_sent_at timestamptz null,
    last_reply_sent_at timestamptz null,
    status text not null default 'open',
    metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_v2_request_email_threads_folder_status
    on public.v2_request_email_threads (request_folder, status);

create index if not exists idx_v2_request_email_threads_initial_email_sent_at
    on public.v2_request_email_threads (initial_email_sent_at desc);


-- ============================================================================
-- Source: flyer_folder_rows_migration.sql
-- ============================================================================

create table if not exists public.v2_flyer_folder_rows (
  unique_id text primary key,
  master_unique_id text,
  source_table text default 'v2_master_inventory',
  flyer_title text not null,
  flyer_assigned text,
  flyer_cat text,
  flyer_inst text,
  flyer_notes text,
  flyer_completed timestamptz,
  assignedto text,
  date_completed timestamptz,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  priority text,
  ptravailable text,
  s_lts text,
  holdstopcode text,
  plantgroupcode text,
  locationnote text,
  av_note text,
  match numeric,
  loc_match_qty numeric,
  spec text,
  caliper text,
  pick text,
  initial_ptr numeric,
  flyer_av_note text,
  flyer_match numeric,
  flyer_loc_match_qty numeric,
  flyer_spec text,
  flyer_caliper text,
  flyer_pick text,
  flyer_initial_ptr numeric,
  flyer_photo_link text,
  flyer_photo_name text,
  snapshot jsonb not null default '{}'::jsonb,
  created_by_username text,
  created_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_flyer_folder_rows_folder
  on public.v2_flyer_folder_rows (flyer_title);

create index if not exists idx_v2_flyer_folder_rows_master
  on public.v2_flyer_folder_rows (master_unique_id);

create index if not exists idx_v2_flyer_folder_rows_itemcode
  on public.v2_flyer_folder_rows (itemcode);

create index if not exists idx_v2_flyer_folder_rows_updated
  on public.v2_flyer_folder_rows (updated_at desc);

create or replace function public.v2_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_flyer_folder_rows_updated_at on public.v2_flyer_folder_rows;
create trigger trg_v2_flyer_folder_rows_updated_at
before update on public.v2_flyer_folder_rows
for each row
execute function public.v2_touch_updated_at();

alter table public.v2_flyer_folder_rows enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'v2_flyer_folder_rows'
      and policyname = 'Allow all access to flyer folder rows'
  ) then
    create policy "Allow all access to flyer folder rows"
      on public.v2_flyer_folder_rows
      for all
      using (true)
      with check (true);
  end if;
end;
$$;

alter table public.v2_flyer_folder_rows replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_flyer_folder_rows;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;


-- ============================================================================
-- Source: flyer_photo_fields_migration.sql
-- ============================================================================

alter table public.v2_master_inventory
    add column if not exists flyer_av_note text,
    add column if not exists flyer_match numeric,
    add column if not exists flyer_loc_match_qty numeric,
    add column if not exists flyer_spec text,
    add column if not exists flyer_caliper text,
    add column if not exists flyer_pick text,
    add column if not exists flyer_initial_ptr numeric,
    add column if not exists flyer_photo_link text,
    add column if not exists flyer_photo_name text;

comment on column public.v2_master_inventory.flyer_photo_link is 'Flyer-folder-owned photo URLs. Kept separate from shared AV photos so invalid AV photos do not bleed into flyer folders.';
comment on column public.v2_master_inventory.flyer_photo_name is 'Flyer-folder-owned photo file names aligned with flyer_photo_link.';


-- ============================================================================
-- Source: marketing_materials_migration.sql
-- ============================================================================

-- Marketing material exports for the Advertisement editor.
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.marketing_materials (
  unique_id text primary key,
  title text,
  format text not null default 'png',
  image_url text,
  image_path text,
  design_json jsonb not null default '{}'::jsonb,
  created_by_username text,
  created_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketing_materials_created_at
  on public.marketing_materials (created_at desc);

create index if not exists idx_marketing_materials_created_by
  on public.marketing_materials (created_by_username);

create or replace function public.v2_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_marketing_materials_updated_at on public.marketing_materials;
create trigger trg_marketing_materials_updated_at
before update on public.marketing_materials
for each row
execute function public.v2_touch_updated_at();

alter table public.marketing_materials enable row level security;

drop policy if exists "Allow app access to marketing materials" on public.marketing_materials;
create policy "Allow app access to marketing materials"
  on public.marketing_materials
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('marketing_materials', 'marketing_materials', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow marketing material public reads" on storage.objects;
create policy "Allow marketing material public reads"
  on storage.objects
  for select
  using (bucket_id = 'marketing_materials');

drop policy if exists "Allow marketing material uploads" on storage.objects;
create policy "Allow marketing material uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'marketing_materials');

drop policy if exists "Allow marketing material updates" on storage.objects;
create policy "Allow marketing material updates"
  on storage.objects
  for update
  using (bucket_id = 'marketing_materials')
  with check (bucket_id = 'marketing_materials');

alter table public.marketing_materials replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.marketing_materials;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- ============================================================================
-- Source: take_back_migration.sql
-- ============================================================================

create table if not exists public.v2_take_back_queue (
  unique_id text primary key,
  master_unique_id text not null,
  source_table text not null default 'v2_master_inventory',
  status text not null default 'open' check (status in ('open', 'done')),
  added_by_username text,
  added_by_display text,
  added_at timestamptz not null default now(),
  completed_by_username text,
  completed_by_display text,
  completed_at timestamptz,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  priority text,
  ptravailable text,
  s_lts text,
  holdstopcode text,
  photo_link text,
  photo_name text,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_take_back_queue_status_added_at
  on public.v2_take_back_queue (status, added_at desc);

create index if not exists idx_v2_take_back_queue_master_unique_id
  on public.v2_take_back_queue (master_unique_id);

alter table public.v2_take_back_queue replica identity full;

create or replace function public.set_v2_take_back_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_take_back_queue_updated_at on public.v2_take_back_queue;

create trigger trg_v2_take_back_queue_updated_at
before update on public.v2_take_back_queue
for each row
execute function public.set_v2_take_back_queue_updated_at();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'v2_take_back_queue'
    ) then
      alter publication supabase_realtime add table public.v2_take_back_queue;
    end if;
  end if;
end $$;


-- ============================================================================
-- Source: shear_list_migration.sql
-- ============================================================================

-- Shear List queue for Production.
-- Run this in Supabase SQL Editor before using the Shear action in Bloom Picker.

create table if not exists public.v2_shear_list (
    unique_id text primary key,
    source_table text not null default 'v2_master_inventory',
    source_unique_id text not null,
    status text not null default 'open',
    percent_to_shear numeric not null default 100,
    itemcode text,
    commonname text,
    contsize text,
    locationcode text,
    lotcode text,
    season text,
    blockalpha text,
    ptravailable numeric,
    holdstopcode text,
    holdstopreason text,
    snapshot jsonb not null default '{}'::jsonb,
    created_by_username text,
    created_by_display text,
    created_at timestamptz not null default now(),
    updated_by_username text,
    updated_by_display text,
    updated_at timestamptz not null default now(),
    completed_by_username text,
    completed_by_display text,
    completed_at timestamptz,
    constraint v2_shear_list_status_check check (status in ('open', 'complete', 'cancelled')),
    constraint v2_shear_list_percent_check check (percent_to_shear >= 0 and percent_to_shear <= 100)
);

create unique index if not exists idx_v2_shear_list_source_unique
    on public.v2_shear_list (source_unique_id);

create index if not exists idx_v2_shear_list_status_created
    on public.v2_shear_list (status, created_at desc);

create index if not exists idx_v2_shear_list_commonname
    on public.v2_shear_list (commonname);

create or replace function public.touch_v2_shear_list_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_v2_shear_list_updated_at on public.v2_shear_list;
create trigger trg_touch_v2_shear_list_updated_at
before update on public.v2_shear_list
for each row
execute function public.touch_v2_shear_list_updated_at();

alter table public.v2_shear_list enable row level security;

drop policy if exists "v2_shear_list_select_app" on public.v2_shear_list;
create policy "v2_shear_list_select_app"
on public.v2_shear_list
for select
using (true);

drop policy if exists "v2_shear_list_insert_app" on public.v2_shear_list;
create policy "v2_shear_list_insert_app"
on public.v2_shear_list
for insert
with check (true);

drop policy if exists "v2_shear_list_update_app" on public.v2_shear_list;
create policy "v2_shear_list_update_app"
on public.v2_shear_list
for update
using (true)
with check (true);

-- Realtime for this table is signaled through public.v2_app_live_events.
-- Run supabase_pro_realtime_budget_migration.sql after schema changes to keep
-- the publication inside the Supabase Pro realtime budget.


-- ============================================================================
-- Source: ncr_approval_requester_migration.sql
-- ============================================================================

alter table public.v2_master_inventory
    add column if not exists ncr_approval_type text,
    add column if not exists ncr_requested_by_username text,
    add column if not exists ncr_requested_by_display text,
    add column if not exists ncr_requested_by_email text,
    add column if not exists ncr_requested_at timestamptz,
    add column if not exists ncr_approval_message text;

create index if not exists idx_v2_master_inventory_ncr_approval_type
    on public.v2_master_inventory (ncr_approval_type);

create index if not exists idx_v2_master_inventory_ncr_requested_by_username
    on public.v2_master_inventory (ncr_requested_by_username);

create index if not exists idx_v2_master_inventory_ncr_requested_at
    on public.v2_master_inventory (ncr_requested_at);


-- ============================================================================
-- Source: ncr_completions_migration.sql
-- ============================================================================

create table if not exists public.v2_ncr_completions (
    source_unique_id text primary key,
    itemcode text,
    locationcode text,
    completed_by text,
    completed_at timestamptz not null default now(),
    emailed_jd boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_v2_ncr_completions_itemcode on public.v2_ncr_completions (itemcode);
create index if not exists idx_v2_ncr_completions_completed_at on public.v2_ncr_completions (completed_at desc);


-- ============================================================================
-- Source: hold_release_override_migration.sql
-- ============================================================================

alter table public.v2_master_inventory
    add column if not exists hold_release_approved_at timestamptz,
    add column if not exists hold_release_approved_by text,
    add column if not exists hold_release_approved_by_display text,
    add column if not exists hold_release_approved_holdstopbegindate text;

create index if not exists idx_v2_master_inventory_hold_release_approved_at
    on public.v2_master_inventory (hold_release_approved_at);

create index if not exists idx_v2_master_inventory_hold_release_approved_by
    on public.v2_master_inventory (hold_release_approved_by);


-- ============================================================================
-- Source: hold_weather_learning_migration.sql
-- ============================================================================

-- Hold-stop learning and Park Hill weather feature tables.
-- Run once in the Supabase SQL Editor.
--
-- This adds:
--   1. Hourly Park Hill, OK weather observations from the GitHub weather sync.
--   2. Hold learning events whenever v2_master_inventory receives H in holdstopcode.
--   3. Growing degree day base 50 and chill-hour rollups for each hold event.

create extension if not exists pgcrypto;

create table if not exists public.v2_weather_hourly (
  unique_id text primary key,
  station_key text not null default 'park_hill_ok',
  latitude numeric,
  longitude numeric,
  timezone text not null default 'America/Chicago',
  observed_at timestamptz not null,
  local_time text,
  temperature_f numeric,
  relative_humidity numeric,
  precipitation_in numeric,
  wind_speed_mph numeric,
  gdd_base_50 numeric not null default 0,
  chill_hours numeric not null default 0,
  source text not null default 'open-meteo',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_weather_hourly_station_observed_unique unique (station_key, observed_at)
);

create index if not exists idx_v2_weather_hourly_station_time
  on public.v2_weather_hourly (station_key, observed_at desc);

create table if not exists public.v2_hold_learning_events (
  unique_id text primary key,
  source_table text not null default 'v2_master_inventory',
  source_unique_id text not null,
  import_file_name text,
  hold_started_on date not null,
  hold_detected_at timestamptz not null default now(),
  itemcode text,
  commonname text,
  genus text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  blockalpha text,
  salesyear text,
  holdstopcode text,
  holdstopreason text,
  holdstopbegindate_raw text,
  hold_reason_category text,
  weather_station_key text not null default 'park_hill_ok',
  gdd_base_50_7d numeric,
  gdd_base_50_14d numeric,
  gdd_base_50_30d numeric,
  gdd_base_50_season numeric,
  chill_hours_7d numeric,
  chill_hours_14d numeric,
  chill_hours_30d numeric,
  chill_hours_season numeric,
  precipitation_in_7d numeric,
  precipitation_in_14d numeric,
  precipitation_in_30d numeric,
  avg_temperature_f_7d numeric,
  avg_temperature_f_14d numeric,
  avg_temperature_f_30d numeric,
  weather_features_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v2_hold_learning_profiles (
  unique_id text primary key,
  commonname text not null,
  genus text,
  contsize text,
  hold_reason_category text not null,
  sample_count integer not null default 0,
  first_hold_on date,
  last_hold_on date,
  avg_gdd_base_50_7d numeric,
  avg_gdd_base_50_14d numeric,
  avg_gdd_base_50_30d numeric,
  avg_gdd_base_50_season numeric,
  median_gdd_base_50_30d numeric,
  avg_chill_hours_30d numeric,
  avg_chill_hours_season numeric,
  avg_precipitation_in_30d numeric,
  avg_temperature_f_30d numeric,
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_hold_learning_events_hold_started
  on public.v2_hold_learning_events (hold_started_on desc);

create index if not exists idx_v2_hold_learning_events_item
  on public.v2_hold_learning_events (itemcode, commonname, contsize);

create index if not exists idx_v2_hold_learning_events_reason
  on public.v2_hold_learning_events (hold_reason_category, hold_started_on desc);

create index if not exists idx_v2_hold_learning_events_source
  on public.v2_hold_learning_events (source_table, source_unique_id);

create index if not exists idx_v2_hold_learning_profiles_lookup
  on public.v2_hold_learning_profiles (hold_reason_category, commonname, contsize);

create or replace function public.v2_touch_hold_weather_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_weather_hourly_updated_at on public.v2_weather_hourly;
create trigger trg_v2_weather_hourly_updated_at
before update on public.v2_weather_hourly
for each row
execute function public.v2_touch_hold_weather_updated_at();

drop trigger if exists trg_v2_hold_learning_events_updated_at on public.v2_hold_learning_events;
create trigger trg_v2_hold_learning_events_updated_at
before update on public.v2_hold_learning_events
for each row
execute function public.v2_touch_hold_weather_updated_at();

drop trigger if exists trg_v2_hold_learning_profiles_updated_at on public.v2_hold_learning_profiles;
create trigger trg_v2_hold_learning_profiles_updated_at
before update on public.v2_hold_learning_profiles
for each row
execute function public.v2_touch_hold_weather_updated_at();

create or replace function public.v2_parse_hold_file_date(p_value text)
returns date
language plpgsql
immutable
as $$
declare
  v text := coalesce(p_value, '');
  m text[];
begin
  m := regexp_match(v, '(20[0-9]{2})[-_\. ]?([01]?[0-9])[-_\. ]?([0-3]?[0-9])');
  if m is not null then
    begin
      return make_date(m[1]::int, m[2]::int, m[3]::int);
    exception when others then
      return null;
    end;
  end if;

  m := regexp_match(v, '([01]?[0-9])[-_\. ]([0-3]?[0-9])[-_\. ](20[0-9]{2})');
  if m is not null then
    begin
      return make_date(m[3]::int, m[1]::int, m[2]::int);
    exception when others then
      return null;
    end;
  end if;

  return null;
end;
$$;

create or replace function public.v2_get_hold_event_date(
  p_holdstopbegindate text,
  p_filename text,
  p_fallback timestamptz default now()
)
returns date
language plpgsql
stable
as $$
declare
  v text := trim(coalesce(p_holdstopbegindate, ''));
  parsed_date date;
begin
  if v <> '' then
    begin
      if v ~ '^[0-9]+(\.[0-9]+)?$' then
        return date '1899-12-30' + floor(v::numeric)::int;
      end if;
      if v ~ '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}' then
        return replace(left(v, 10), '/', '-')::date;
      end if;
      if v ~ '^[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{4}' then
        return to_date(replace(left(v, 10), '-', '/'), 'MM/DD/YYYY');
      end if;
    exception when others then
      null;
    end;
  end if;

  parsed_date := public.v2_parse_hold_file_date(p_filename);
  if parsed_date is not null then
    return parsed_date;
  end if;

  return coalesce(p_fallback, now())::date;
end;
$$;

create or replace function public.v2_classify_hold_reason(p_reason text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_reason, '')) ~ '(aphid|mite|scale|thrip|snail|caterpillar|insect|bug|pest|borer|beetle)' then 'pest'
    when lower(coalesce(p_reason, '')) ~ '(fung|disease|leaf spot|phytophthora|rhizoctonia|botrytis|canker|mildew|rot|rust|anthracnose|blight|phomopsis|sclerotinia)' then 'fungal_disease'
    when lower(coalesce(p_reason, '')) ~ '(leaf quality|leaf|foliar|chlorosis|yellow|necrosis|spotting|burn)' then 'leaf_quality'
    when lower(coalesce(p_reason, '')) ~ '(shear|sheared|trim|cutback|cut back|prune|pruned)' then 'sheared'
    when lower(coalesce(p_reason, '')) ~ '(freeze|frost|cold|heat|hail|weather|wind|drought|wet)' then 'weather_stress'
    when trim(coalesce(p_reason, '')) = '' then 'unknown'
    else 'other'
  end;
$$;

create or replace function public.v2_capture_hold_learning_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  event_date date;
  event_id text;
  reason text;
begin
  if upper(trim(coalesce(new.holdstopcode::text, ''))) <> 'H' then
    return new;
  end if;

  event_date := public.v2_get_hold_event_date(new.holdstopbegindate::text, new.filename::text, now());
  reason := nullif(trim(coalesce(new.holdstopreason::text, '')), '');
  event_id := 'hold_' || encode(digest(concat_ws('|',
    'v2_master_inventory',
    coalesce(new.unique_id::text, ''),
    coalesce(event_date::text, ''),
    lower(coalesce(reason, ''))
  ), 'sha256'), 'hex');

  insert into public.v2_hold_learning_events (
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
    weather_station_key
  )
  values (
    event_id,
    'v2_master_inventory',
    new.unique_id::text,
    new.filename::text,
    event_date,
    now(),
    new.itemcode::text,
    new.commonname::text,
    new.genusname::text,
    new.contsize::text,
    new.locationcode::text,
    new.lotcode::text,
    new.season::text,
    new.blockalpha::text,
    new.saleyear::text,
    new.holdstopcode::text,
    reason,
    new.holdstopbegindate::text,
    public.v2_classify_hold_reason(reason),
    'park_hill_ok'
  )
  on conflict (unique_id) do update set
    import_file_name = excluded.import_file_name,
    hold_detected_at = now(),
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    genus = excluded.genus,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    season = excluded.season,
    blockalpha = excluded.blockalpha,
    salesyear = excluded.salesyear,
    holdstopcode = excluded.holdstopcode,
    holdstopreason = excluded.holdstopreason,
    holdstopbegindate_raw = excluded.holdstopbegindate_raw,
    hold_reason_category = excluded.hold_reason_category,
    updated_at = now();

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.v2_master_inventory') is not null then
    drop trigger if exists trg_v2_capture_hold_learning_event on public.v2_master_inventory;
    create trigger trg_v2_capture_hold_learning_event
    after insert or update of holdstopcode, holdstopreason, holdstopbegindate, filename
    on public.v2_master_inventory
    for each row
    execute function public.v2_capture_hold_learning_event();
  end if;
end;
$$;

create or replace function public.v2_refresh_hold_learning_weather_features(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ev record;
  refreshed integer := 0;
  event_end timestamptz;
  season_start timestamptz;
  gdd_7 numeric;
  gdd_14 numeric;
  gdd_30 numeric;
  gdd_season numeric;
  chill_7 numeric;
  chill_14 numeric;
  chill_30 numeric;
  chill_season numeric;
  precip_7 numeric;
  precip_14 numeric;
  precip_30 numeric;
  avg_temp_7 numeric;
  avg_temp_14 numeric;
  avg_temp_30 numeric;
begin
  for ev in
    select *
    from public.v2_hold_learning_events
    where hold_started_on is not null
    order by coalesce(weather_features_refreshed_at, '1900-01-01'::timestamptz), hold_started_on desc
    limit greatest(1, coalesce(p_limit, 1000))
  loop
    event_end := ((ev.hold_started_on + 1)::timestamp at time zone 'America/Chicago');
    season_start := (make_date(extract(year from ev.hold_started_on)::int, 1, 1)::timestamp at time zone 'America/Chicago');

    select
      coalesce(sum(gdd_base_50) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end), 0),
      coalesce(sum(gdd_base_50) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end), 0),
      coalesce(sum(gdd_base_50) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end), 0),
      coalesce(sum(gdd_base_50) filter (where observed_at >= season_start and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end), 0),
      coalesce(sum(chill_hours) filter (where observed_at >= season_start and observed_at < event_end), 0),
      coalesce(sum(precipitation_in) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end), 0),
      coalesce(sum(precipitation_in) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end), 0),
      coalesce(sum(precipitation_in) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end), 0),
      avg(temperature_f) filter (where observed_at >= event_end - interval '7 days' and observed_at < event_end),
      avg(temperature_f) filter (where observed_at >= event_end - interval '14 days' and observed_at < event_end),
      avg(temperature_f) filter (where observed_at >= event_end - interval '30 days' and observed_at < event_end)
    into
      gdd_7, gdd_14, gdd_30, gdd_season,
      chill_7, chill_14, chill_30, chill_season,
      precip_7, precip_14, precip_30,
      avg_temp_7, avg_temp_14, avg_temp_30
    from public.v2_weather_hourly
    where station_key = ev.weather_station_key
      and observed_at >= season_start
      and observed_at < event_end;

    update public.v2_hold_learning_events
    set
      gdd_base_50_7d = round(gdd_7, 3),
      gdd_base_50_14d = round(gdd_14, 3),
      gdd_base_50_30d = round(gdd_30, 3),
      gdd_base_50_season = round(gdd_season, 3),
      chill_hours_7d = round(chill_7, 3),
      chill_hours_14d = round(chill_14, 3),
      chill_hours_30d = round(chill_30, 3),
      chill_hours_season = round(chill_season, 3),
      precipitation_in_7d = round(precip_7, 3),
      precipitation_in_14d = round(precip_14, 3),
      precipitation_in_30d = round(precip_30, 3),
      avg_temperature_f_7d = round(avg_temp_7, 2),
      avg_temperature_f_14d = round(avg_temp_14, 2),
      avg_temperature_f_30d = round(avg_temp_30, 2),
      weather_features_refreshed_at = now(),
      updated_at = now()
    where unique_id = ev.unique_id;

    refreshed := refreshed + 1;
  end loop;

  return refreshed;
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
    updated_at
  )
  select
    'hold_profile_' || encode(digest(concat_ws('|',
      lower(trim(coalesce(commonname, 'unknown'))),
      lower(trim(coalesce(contsize, ''))),
      lower(trim(coalesce(hold_reason_category, 'unknown')))
    ), 'sha256'), 'hex') as unique_id,
    coalesce(nullif(trim(commonname), ''), 'Unknown') as commonname,
    nullif(trim(max(genus)), '') as genus,
    nullif(trim(contsize), '') as contsize,
    coalesce(nullif(trim(hold_reason_category), ''), 'unknown') as hold_reason_category,
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
    now()
  from public.v2_hold_learning_events
  where commonname is not null
    and hold_reason_category is not null
    and weather_features_refreshed_at is not null
  group by
    lower(trim(coalesce(commonname, 'unknown'))),
    coalesce(nullif(trim(commonname), ''), 'Unknown'),
    nullif(trim(contsize), ''),
    coalesce(nullif(trim(hold_reason_category), ''), 'unknown')
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
    updated_at = now();

  get diagnostics refreshed = row_count;
  return refreshed;
end;
$$;

do $$
begin
  if to_regclass('public.v2_master_inventory') is not null then
    insert into public.v2_hold_learning_events (
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
      weather_station_key
    )
    select
      'hold_' || encode(digest(concat_ws('|',
        'v2_master_inventory',
        coalesce(unique_id::text, ''),
        coalesce(public.v2_get_hold_event_date(holdstopbegindate::text, filename::text, now())::text, ''),
        lower(coalesce(nullif(trim(holdstopreason::text), ''), ''))
      ), 'sha256'), 'hex'),
      'v2_master_inventory',
      unique_id::text,
      filename::text,
      public.v2_get_hold_event_date(holdstopbegindate::text, filename::text, now()),
      now(),
      itemcode::text,
      commonname::text,
      genusname::text,
      contsize::text,
      locationcode::text,
      lotcode::text,
      season::text,
      blockalpha::text,
      saleyear::text,
      holdstopcode::text,
      nullif(trim(holdstopreason::text), ''),
      holdstopbegindate::text,
      public.v2_classify_hold_reason(holdstopreason::text),
      'park_hill_ok'
    from public.v2_master_inventory
    where upper(trim(coalesce(holdstopcode::text, ''))) = 'H'
    on conflict (unique_id) do nothing;
  end if;
end;
$$;

alter table public.v2_weather_hourly enable row level security;
alter table public.v2_hold_learning_events enable row level security;
alter table public.v2_hold_learning_profiles enable row level security;

drop policy if exists "Allow app read weather hourly" on public.v2_weather_hourly;
create policy "Allow app read weather hourly"
  on public.v2_weather_hourly
  for select
  using (true);

drop policy if exists "Allow service write weather hourly" on public.v2_weather_hourly;
create policy "Allow service write weather hourly"
  on public.v2_weather_hourly
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Allow app read hold learning events" on public.v2_hold_learning_events;
create policy "Allow app read hold learning events"
  on public.v2_hold_learning_events
  for select
  using (true);

drop policy if exists "Allow service write hold learning events" on public.v2_hold_learning_events;
create policy "Allow service write hold learning events"
  on public.v2_hold_learning_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Allow app read hold learning profiles" on public.v2_hold_learning_profiles;
create policy "Allow app read hold learning profiles"
  on public.v2_hold_learning_profiles
  for select
  using (true);

drop policy if exists "Allow service write hold learning profiles" on public.v2_hold_learning_profiles;
create policy "Allow service write hold learning profiles"
  on public.v2_hold_learning_profiles
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.v2_weather_hourly replica identity full;
alter table public.v2_hold_learning_events replica identity full;
alter table public.v2_hold_learning_profiles replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_weather_hourly;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.v2_hold_learning_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.v2_hold_learning_profiles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- ============================================================================
-- Source: ml_pipeline_migration.sql
-- ============================================================================

-- Agricultural AI pipeline tables and storage.
-- Run once in the Supabase SQL Editor before enabling AI Capture in production.

create extension if not exists pgcrypto;

create table if not exists public.v2_ml_image_jobs (
  unique_id text primary key,
  status text not null default 'pending_ml',
  image_bucket text not null default 'ml_capture_photos',
  image_path text not null,
  image_url text,
  source_table text,
  source_unique_id text,
  season text,
  block text,
  itemcode text,
  genus text,
  common_name text,
  contsize text,
  locationcode text,
  lotcode text,
  ptravailable numeric,
  ml_genus text,
  ml_common_name text,
  ml_grade_raw text,
  ml_grade text,
  ml_confidence numeric,
  matched_inventory_key text,
  diagnosis text,
  recommended_treatment text,
  manual_review boolean not null default false,
  approved_s1 numeric not null default 0,
  approved_f1 numeric not null default 0,
  approved_u1 numeric not null default 0,
  approved_u2 numeric not null default 0,
  approved_u3 numeric not null default 0,
  approved_x numeric not null default 0,
  approved_by_username text,
  approved_by_display text,
  approved_at timestamptz,
  worker_id text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  ml_completed_at timestamptz,
  last_error text,
  created_by_username text,
  created_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_ml_image_jobs_status_check
    check (status in ('pending_ml', 'processing', 'pending_approval', 'approved', 'ml_failed'))
);

create index if not exists idx_v2_ml_image_jobs_status
  on public.v2_ml_image_jobs (status, updated_at desc);

create index if not exists idx_v2_ml_image_jobs_created_at
  on public.v2_ml_image_jobs (created_at desc);

create index if not exists idx_v2_ml_image_jobs_created_by
  on public.v2_ml_image_jobs (created_by_username);

create index if not exists idx_v2_ml_image_jobs_source
  on public.v2_ml_image_jobs (source_table, source_unique_id);

create index if not exists idx_v2_ml_image_jobs_block
  on public.v2_ml_image_jobs (block);

create or replace function public.v2_touch_ml_image_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_ml_image_jobs_updated_at on public.v2_ml_image_jobs;
create trigger trg_v2_ml_image_jobs_updated_at
before update on public.v2_ml_image_jobs
for each row
execute function public.v2_touch_ml_image_jobs_updated_at();

alter table public.v2_ml_image_jobs enable row level security;

drop policy if exists "Allow app read ml image jobs" on public.v2_ml_image_jobs;
create policy "Allow app read ml image jobs"
  on public.v2_ml_image_jobs
  for select
  using (true);

drop policy if exists "Allow app write ml image jobs" on public.v2_ml_image_jobs;
create policy "Allow app write ml image jobs"
  on public.v2_ml_image_jobs
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('ml_capture_photos', 'ml_capture_photos', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow ml capture photo public reads" on storage.objects;
create policy "Allow ml capture photo public reads"
  on storage.objects
  for select
  using (bucket_id = 'ml_capture_photos');

drop policy if exists "Allow ml capture photo uploads" on storage.objects;
create policy "Allow ml capture photo uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'ml_capture_photos');

drop policy if exists "Allow ml capture photo updates" on storage.objects;
create policy "Allow ml capture photo updates"
  on storage.objects
  for update
  using (bucket_id = 'ml_capture_photos')
  with check (bucket_id = 'ml_capture_photos');

alter table public.v2_ml_image_jobs replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_ml_image_jobs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- ============================================================================
-- Source: github_ml_worker_dispatch_migration.sql
-- ============================================================================

-- Wake the GitHub Actions ML worker when Supabase receives new ML work.
--
-- What this does:
-- 1. Keeps the scheduled GitHub worker as the backup.
-- 2. Sends a throttled repository_dispatch event to GitHub when new pending work appears.
-- 3. Prevents one GitHub Action run per photo by throttling dispatches to one per minute.
--
-- Before running:
-- - Create a GitHub fine-grained token or classic PAT that can dispatch workflows for this repo.
-- - Store it in Supabase Vault with the name GITHUB_ML_WORKER_PAT.
--   Example, run once and replace the placeholder:
--   select vault.create_secret('github_pat_REPLACE_ME', 'GITHUB_ML_WORKER_PAT');

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.v2_ml_github_dispatch_state (
    dispatch_key text primary key,
    last_dispatched_at timestamptz not null default now(),
    last_event_type text,
    last_table_name text,
    last_row_id text,
    dispatch_count integer not null default 0,
    updated_at timestamptz not null default now()
);

alter table public.v2_ml_github_dispatch_state enable row level security;

drop policy if exists "v2_ml_github_dispatch_state service only" on public.v2_ml_github_dispatch_state;
create policy "v2_ml_github_dispatch_state service only"
on public.v2_ml_github_dispatch_state
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.dispatch_github_ml_worker()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
    github_owner text := 'collygedylan';
    github_repo text := 'GNC-Sales-Command-PRO-';
    github_token text;
    event_type text := 'supabase-ml-queue';
    row_id text := coalesce(new.unique_id::text, '');
    should_dispatch boolean := false;
    prior_dispatch_at timestamptz;
    request_id bigint;
begin
    if tg_table_name = 'v2_ml_image_jobs' then
        if coalesce(new.status, '') <> 'pending_ml' then
            return new;
        end if;
        if tg_op = 'INSERT' then
            should_dispatch := true;
        elsif coalesce(old.status, '') is distinct from coalesce(new.status, '') then
            should_dispatch := true;
        end if;
        event_type := 'ml-photo-created';
    elsif tg_table_name = 'v2_disease_training_assets' then
        if coalesce(new.processed_status, '') <> 'pending_ml' then
            return new;
        end if;
        if tg_op = 'INSERT' then
            should_dispatch := true;
        elsif coalesce(old.processed_status, '') is distinct from coalesce(new.processed_status, '') then
            should_dispatch := true;
        end if;
        event_type := 'ml-training-asset-created';
    elsif tg_table_name = 'v2_grower_scout_reports' then
        if coalesce(new.status, '') <> 'pending_ai' then
            return new;
        end if;
        if tg_op = 'INSERT' then
            should_dispatch := true;
        elsif coalesce(old.status, '') is distinct from coalesce(new.status, '') then
            should_dispatch := true;
        end if;
        event_type := 'grower-scout-report-created';
    end if;

    if not should_dispatch then
        return new;
    end if;

    select last_dispatched_at
    into prior_dispatch_at
    from public.v2_ml_github_dispatch_state
    where dispatch_key = 'ml-worker';

    -- GitHub Actions is the worker, not one run per row. One wake-up per minute is enough.
    if prior_dispatch_at is not null and prior_dispatch_at > now() - interval '60 seconds' then
        return new;
    end if;

    select decrypted_secret
    into github_token
    from vault.decrypted_secrets
    where name = 'GITHUB_ML_WORKER_PAT'
    limit 1;

    if github_token is null or length(trim(github_token)) = 0 then
        raise warning 'GITHUB_ML_WORKER_PAT is not set in Supabase Vault. GitHub ML worker dispatch skipped.';
        return new;
    end if;

    insert into public.v2_ml_github_dispatch_state (
        dispatch_key,
        last_dispatched_at,
        last_event_type,
        last_table_name,
        last_row_id,
        dispatch_count,
        updated_at
    )
    values (
        'ml-worker',
        now(),
        event_type,
        tg_table_name,
        row_id,
        1,
        now()
    )
    on conflict (dispatch_key)
    do update set
        last_dispatched_at = excluded.last_dispatched_at,
        last_event_type = excluded.last_event_type,
        last_table_name = excluded.last_table_name,
        last_row_id = excluded.last_row_id,
        dispatch_count = public.v2_ml_github_dispatch_state.dispatch_count + 1,
        updated_at = now();

    select net.http_post(
        url := format('https://api.github.com/repos/%s/%s/dispatches', github_owner, github_repo),
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || github_token,
            'Accept', 'application/vnd.github+json',
            'X-GitHub-Api-Version', '2022-11-28',
            'User-Agent', 'gnc-supabase-ml-dispatch'
        ),
        body := jsonb_build_object(
            'event_type', event_type,
            'client_payload', jsonb_build_object(
                'table', tg_table_name,
                'unique_id', row_id,
                'created_at', now()
            )
        ),
        timeout_milliseconds := 5000
    )
    into request_id;

    return new;
exception
    when others then
        raise warning 'GitHub ML worker dispatch failed: %', sqlerrm;
        return new;
end;
$$;

do $$
begin
    if to_regclass('public.v2_ml_image_jobs') is not null then
        drop trigger if exists trg_dispatch_github_ml_worker_jobs on public.v2_ml_image_jobs;
        create trigger trg_dispatch_github_ml_worker_jobs
        after insert or update of status on public.v2_ml_image_jobs
        for each row
        execute function public.dispatch_github_ml_worker();
    end if;

    if to_regclass('public.v2_disease_training_assets') is not null then
        drop trigger if exists trg_dispatch_github_ml_worker_disease_assets on public.v2_disease_training_assets;
        create trigger trg_dispatch_github_ml_worker_disease_assets
        after insert or update of processed_status on public.v2_disease_training_assets
        for each row
        execute function public.dispatch_github_ml_worker();
    end if;

    if to_regclass('public.v2_grower_scout_reports') is not null then
        drop trigger if exists trg_dispatch_github_ml_worker_grower_reports on public.v2_grower_scout_reports;
        create trigger trg_dispatch_github_ml_worker_grower_reports
        after insert or update of status on public.v2_grower_scout_reports
        for each row
        execute function public.dispatch_github_ml_worker();
    end if;
end;
$$;


-- ============================================================================
-- Source: ml_live_dispatch_setup.sql
-- ============================================================================

-- Optional near-live ML dispatch trigger.
-- Replace the two placeholders below before running this file:
--   1. REPLACE_WITH_PROJECT_REF, for example kzrnyjsosryejjejliii
--   2. REPLACE_WITH_LONG_RANDOM_DISPATCH_SECRET, the same value set as ML_DISPATCH_SECRET on the ml-dispatch Edge Function.
--
-- This trigger wakes the GitHub Actions ML worker when a pending ML photo job
-- or pending disease training asset is inserted. The scheduled worker remains
-- as a backup if GitHub is temporarily slow.

create extension if not exists pg_net with schema extensions;

create or replace function public.v2_dispatch_ml_worker_for_image_job()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  dispatch_url text := 'https://REPLACE_WITH_PROJECT_REF.supabase.co/functions/v1/ml-dispatch';
  dispatch_secret text := 'REPLACE_WITH_LONG_RANDOM_DISPATCH_SECRET';
  request_id bigint;
begin
  if coalesce(new.status, '') <> 'pending_ml' then
    return new;
  end if;

  select net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || dispatch_secret
    ),
    body := jsonb_build_object(
      'source', 'v2_ml_image_jobs',
      'event_type', 'ml-photo-created',
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  )
  into request_id;

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists trg_v2_dispatch_ml_worker_for_image_job on public.v2_ml_image_jobs;
create trigger trg_v2_dispatch_ml_worker_for_image_job
after insert or update of status on public.v2_ml_image_jobs
for each row
execute function public.v2_dispatch_ml_worker_for_image_job();

create or replace function public.v2_dispatch_ml_worker_for_disease_asset()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  dispatch_url text := 'https://REPLACE_WITH_PROJECT_REF.supabase.co/functions/v1/ml-dispatch';
  dispatch_secret text := 'REPLACE_WITH_LONG_RANDOM_DISPATCH_SECRET';
  request_id bigint;
begin
  if coalesce(new.processed_status, '') <> 'pending_ml' then
    return new;
  end if;

  select net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || dispatch_secret
    ),
    body := jsonb_build_object(
      'source', 'v2_disease_training_assets',
      'event_type', 'ml-training-asset-created',
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  )
  into request_id;

  return new;
exception
  when undefined_table then
    return new;
  when others then
    return new;
end;
$$;

drop trigger if exists trg_v2_dispatch_ml_worker_for_disease_asset on public.v2_disease_training_assets;
create trigger trg_v2_dispatch_ml_worker_for_disease_asset
after insert or update of processed_status on public.v2_disease_training_assets
for each row
execute function public.v2_dispatch_ml_worker_for_disease_asset();


-- ============================================================================
-- Source: ml_disease_training_assets_migration.sql
-- ============================================================================

-- Disease and lab-report asset mirror for the GNC ML pipeline.
-- Run once in the Supabase SQL Editor before syncing disease folders from Google Drive.

create extension if not exists pgcrypto;

create table if not exists public.v2_disease_training_assets (
  unique_id text primary key,
  drive_file_id text not null unique,
  drive_parent_id text,
  drive_path text,
  folder_path text,
  label text,
  asset_kind text not null default 'diagnostic_photo',
  bucket text not null default 'disease_training_assets',
  storage_path text not null,
  public_url text,
  mime_type text,
  file_name text,
  file_size bigint,
  checksum text,
  processed_status text not null default 'pending_ml',
  diagnosis text,
  recommended_treatment text,
  confidence numeric,
  worker_id text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_disease_training_assets_kind_check
    check (asset_kind in ('diagnostic_photo', 'lab_report', 'other')),
  constraint v2_disease_training_assets_status_check
    check (processed_status in ('pending_ml', 'processing', 'processed', 'failed', 'ignored'))
);

create index if not exists idx_v2_disease_training_assets_status
  on public.v2_disease_training_assets (processed_status, updated_at desc);

create index if not exists idx_v2_disease_training_assets_label
  on public.v2_disease_training_assets (label);

create index if not exists idx_v2_disease_training_assets_folder
  on public.v2_disease_training_assets (folder_path);

create index if not exists idx_v2_disease_training_assets_created_at
  on public.v2_disease_training_assets (created_at desc);

create or replace function public.v2_touch_disease_training_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_disease_training_assets_updated_at on public.v2_disease_training_assets;
create trigger trg_v2_disease_training_assets_updated_at
before update on public.v2_disease_training_assets
for each row
execute function public.v2_touch_disease_training_assets_updated_at();

alter table public.v2_disease_training_assets enable row level security;

drop policy if exists "Allow app read disease training assets" on public.v2_disease_training_assets;
create policy "Allow app read disease training assets"
  on public.v2_disease_training_assets
  for select
  using (true);

drop policy if exists "Allow app write disease training assets" on public.v2_disease_training_assets;
create policy "Allow app write disease training assets"
  on public.v2_disease_training_assets
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('disease_training_assets', 'disease_training_assets', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow disease training asset public reads" on storage.objects;
create policy "Allow disease training asset public reads"
  on storage.objects
  for select
  using (bucket_id = 'disease_training_assets');

drop policy if exists "Allow disease training asset uploads" on storage.objects;
create policy "Allow disease training asset uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'disease_training_assets');

drop policy if exists "Allow disease training asset updates" on storage.objects;
create policy "Allow disease training asset updates"
  on storage.objects
  for update
  using (bucket_id = 'disease_training_assets')
  with check (bucket_id = 'disease_training_assets');

alter table public.v2_disease_training_assets replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_disease_training_assets;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- ============================================================================
-- Source: disease_training_asset_filename_fields_migration.sql
-- ============================================================================

-- Adds parsed plant/photo filename fields to the disease training asset mirror.
-- Run after ml_disease_training_assets_migration.sql and before the updated
-- disease_drive_sync_code.gs sync is run.

alter table public.v2_disease_training_assets
  add column if not exists plant_folder text,
  add column if not exists source_file_title text,
  add column if not exists commonname text,
  add column if not exists locationcode text,
  add column if not exists lotcode text,
  add column if not exists contsize text,
  add column if not exists itemcode text;

create index if not exists idx_v2_disease_training_assets_plant_folder
  on public.v2_disease_training_assets (plant_folder);

create index if not exists idx_v2_disease_training_assets_commonname
  on public.v2_disease_training_assets (commonname);

create index if not exists idx_v2_disease_training_assets_locationcode
  on public.v2_disease_training_assets (locationcode);

create index if not exists idx_v2_disease_training_assets_lotcode
  on public.v2_disease_training_assets (lotcode);

create index if not exists idx_v2_disease_training_assets_contsize
  on public.v2_disease_training_assets (contsize);

create index if not exists idx_v2_disease_training_assets_itemcode
  on public.v2_disease_training_assets (itemcode);

update public.v2_disease_training_assets
set
  source_file_title = coalesce(source_file_title, file_name),
  plant_folder = coalesce(
    plant_folder,
    nullif(split_part(coalesce(folder_path, ''), '/', 1), ''),
    label
  )
where source_file_title is null
   or plant_folder is null;


-- ============================================================================
-- Source: diagnostic_reference_report_migration.sql
-- ============================================================================

-- Diagnostic lab report reference fields.
-- Run once in Supabase SQL Editor before relying on lab-report tabs in the app.

alter table public.v2_disease_training_assets
  add column if not exists report_text text,
  add column if not exists report_rewrite text;

alter table public.v2_ml_image_jobs
  add column if not exists diagnostic_reference_asset_id text,
  add column if not exists diagnostic_reference_kind text,
  add column if not exists diagnostic_reference_file_name text,
  add column if not exists diagnostic_reference_public_url text,
  add column if not exists diagnostic_reference_label text,
  add column if not exists diagnostic_reference_score numeric,
  add column if not exists diagnostic_reference_report_text text,
  add column if not exists diagnostic_reference_report_rewrite text;

create index if not exists idx_v2_ml_image_jobs_diagnostic_reference
  on public.v2_ml_image_jobs (diagnostic_reference_asset_id);

create index if not exists idx_v2_disease_training_assets_report_lookup
  on public.v2_disease_training_assets (asset_kind, label);

-- Reprocess lab reports so the worker extracts readable text/rewrites from existing PDFs.
update public.v2_disease_training_assets
set processed_status = 'pending_ml',
    processing_started_at = null,
    worker_id = null,
    last_error = null
where asset_kind = 'lab_report'
  and coalesce(report_rewrite, '') = '';


-- ============================================================================
-- Source: diagnostic_review_feedback_migration.sql
-- ============================================================================

-- Diagnostic review feedback and lab-case workflow.
-- Run after ml_pipeline_migration.sql, ml_disease_training_assets_migration.sql,
-- disease_training_asset_filename_fields_migration.sql, and diagnostic_reference_report_migration.sql.

create extension if not exists pgcrypto;

alter table public.v2_ml_image_jobs
  add column if not exists diagnostic_review_decision text,
  add column if not exists diagnostic_reviewer_report text,
  add column if not exists diagnostic_reviewer_diagnosis text,
  add column if not exists diagnostic_reviewer_treatment text,
  add column if not exists diagnostic_reviewed_by_username text,
  add column if not exists diagnostic_reviewed_by_display text,
  add column if not exists diagnostic_reviewed_at timestamptz,
  add column if not exists diagnostic_lab_case_id text,
  add column if not exists diagnostic_lab_status text,
  add column if not exists diagnostic_lab_label_printed_at timestamptz,
  add column if not exists diagnostic_lab_report_bucket text,
  add column if not exists diagnostic_lab_report_path text,
  add column if not exists diagnostic_lab_report_url text,
  add column if not exists diagnostic_lab_report_uploaded_at timestamptz,
  add column if not exists diagnostic_lab_report_uploaded_by text,
  add column if not exists diagnostic_learning_scope text not null default 'genus_commonname_all_contsizes';

create index if not exists idx_v2_ml_image_jobs_diagnostic_review_decision
  on public.v2_ml_image_jobs (diagnostic_review_decision, updated_at desc);

create index if not exists idx_v2_ml_image_jobs_diagnostic_lab_case_id
  on public.v2_ml_image_jobs (diagnostic_lab_case_id);

create table if not exists public.v2_diagnostic_lab_cases (
  unique_id text primary key,
  ml_job_id text not null,
  case_label text not null,
  status text not null default 'pending_lab_report',
  source_table text,
  source_unique_id text,
  itemcode text,
  genus text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  block text,
  image_url text,
  photo_link text,
  model_diagnosis text,
  model_treatment text,
  model_confidence numeric,
  reviewer_report text,
  reviewer_diagnosis text,
  reviewer_treatment text,
  reviewer_username text,
  reviewer_display text,
  reviewed_at timestamptz,
  lab_report_bucket text,
  lab_report_path text,
  lab_report_url text,
  lab_report_uploaded_by text,
  lab_report_uploaded_at timestamptz,
  learning_scope text not null default 'genus_commonname_all_contsizes',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_diagnostic_lab_cases_status_check
    check (status in ('pending_lab_report', 'lab_report_uploaded', 'learned', 'closed', 'cancelled'))
);

create index if not exists idx_v2_diagnostic_lab_cases_status
  on public.v2_diagnostic_lab_cases (status, updated_at desc);

create index if not exists idx_v2_diagnostic_lab_cases_ml_job_id
  on public.v2_diagnostic_lab_cases (ml_job_id);

create index if not exists idx_v2_diagnostic_lab_cases_common_lookup
  on public.v2_diagnostic_lab_cases (genus, commonname);

create or replace function public.v2_touch_diagnostic_lab_cases_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_diagnostic_lab_cases_updated_at on public.v2_diagnostic_lab_cases;
create trigger trg_v2_diagnostic_lab_cases_updated_at
before update on public.v2_diagnostic_lab_cases
for each row
execute function public.v2_touch_diagnostic_lab_cases_updated_at();

alter table public.v2_diagnostic_lab_cases enable row level security;

drop policy if exists "Allow app read diagnostic lab cases" on public.v2_diagnostic_lab_cases;
create policy "Allow app read diagnostic lab cases"
  on public.v2_diagnostic_lab_cases
  for select
  using (true);

drop policy if exists "Allow app write diagnostic lab cases" on public.v2_diagnostic_lab_cases;
create policy "Allow app write diagnostic lab cases"
  on public.v2_diagnostic_lab_cases
  for all
  using (true)
  with check (true);

alter table public.v2_disease_training_assets
  add column if not exists genus text,
  add column if not exists source_ml_job_id text,
  add column if not exists lab_case_id text,
  add column if not exists reviewer_report text,
  add column if not exists reviewer_username text,
  add column if not exists reviewer_display text,
  add column if not exists review_decision text,
  add column if not exists learning_scope text not null default 'genus_commonname_all_contsizes';

alter table public.v2_disease_training_assets
  drop constraint if exists v2_disease_training_assets_kind_check;

alter table public.v2_disease_training_assets
  add constraint v2_disease_training_assets_kind_check
  check (asset_kind in ('diagnostic_photo', 'lab_report', 'lab_report_photo', 'review_feedback', 'other'));

create index if not exists idx_v2_disease_training_assets_genus_common
  on public.v2_disease_training_assets (genus, commonname);

create index if not exists idx_v2_disease_training_assets_lab_case
  on public.v2_disease_training_assets (lab_case_id);

insert into storage.buckets (id, name, public)
values ('diagnostic_lab_reports', 'diagnostic_lab_reports', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow diagnostic lab report public reads" on storage.objects;
create policy "Allow diagnostic lab report public reads"
  on storage.objects
  for select
  using (bucket_id = 'diagnostic_lab_reports');

drop policy if exists "Allow diagnostic lab report uploads" on storage.objects;
create policy "Allow diagnostic lab report uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'diagnostic_lab_reports');

drop policy if exists "Allow diagnostic lab report updates" on storage.objects;
create policy "Allow diagnostic lab report updates"
  on storage.objects
  for update
  using (bucket_id = 'diagnostic_lab_reports')
  with check (bucket_id = 'diagnostic_lab_reports');

alter table public.v2_diagnostic_lab_cases replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_diagnostic_lab_cases;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- ============================================================================
-- Source: grower_scouting_migration.sql
-- ============================================================================

-- Grower scouting and pest-management review workflow.
-- Run this in the Supabase SQL Editor before enabling the Grower/Pest Management tabs.

create extension if not exists pgcrypto;

create table if not exists public.v2_grower_scout_reports (
  unique_id text primary key,
  status text not null default 'pending_ai',
  report_language text not null default 'en',
  block text,
  blockalpha text,
  locationcode text,
  itemcode text,
  genus text,
  common_name text,
  contsize text,
  season text,
  salesyear numeric,
  manual_note text,
  audio_bucket text,
  audio_path text,
  audio_url text,
  audio_mime_type text,
  audio_duration_seconds integer,
  transcript text,
  ai_summary text,
  summary_json jsonb not null default '{}'::jsonb,
  pest_issue boolean not null default false,
  disease_issue boolean not null default false,
  nutrient_issue boolean not null default false,
  manual_review boolean not null default false,
  issue_type text,
  severity text not null default 'none',
  diagnosis text,
  recommended_treatment text,
  follow_up_date date,
  review_status text not null default 'pending',
  reviewer_note text,
  reviewed_by_username text,
  reviewed_by_display text,
  reviewed_at timestamptz,
  created_by_username text,
  created_by_display text,
  worker_id text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  ai_completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_grower_scout_reports_status_check
    check (status in ('pending_ai', 'processing', 'ai_complete', 'dylan_review', 'reviewed', 'closed', 'ai_failed')),
  constraint v2_grower_scout_reports_severity_check
    check (severity in ('none', 'low', 'medium', 'high', 'critical')),
  constraint v2_grower_scout_reports_review_status_check
    check (review_status in ('pending', 'reviewed', 'no_issue', 'needs_follow_up', 'closed'))
);

create table if not exists public.v2_grower_scout_assets (
  unique_id text primary key,
  report_id text not null references public.v2_grower_scout_reports(unique_id) on delete cascade,
  asset_kind text not null default 'photo',
  bucket text not null,
  storage_path text not null,
  public_url text,
  mime_type text,
  file_name text,
  file_size_bytes bigint,
  created_by_username text,
  created_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_grower_scout_assets_kind_check
    check (asset_kind in ('audio', 'photo', 'file'))
);

create index if not exists idx_v2_grower_scout_reports_status
  on public.v2_grower_scout_reports (status, updated_at desc);

create index if not exists idx_v2_grower_scout_reports_review
  on public.v2_grower_scout_reports (review_status, severity, updated_at desc);

create index if not exists idx_v2_grower_scout_reports_created_at
  on public.v2_grower_scout_reports (created_at desc);

create index if not exists idx_v2_grower_scout_reports_created_by
  on public.v2_grower_scout_reports (created_by_username);

create index if not exists idx_v2_grower_scout_reports_block
  on public.v2_grower_scout_reports (block, locationcode);

create index if not exists idx_v2_grower_scout_assets_report
  on public.v2_grower_scout_assets (report_id, asset_kind, created_at desc);

create or replace function public.v2_touch_grower_scout_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_grower_scout_reports_updated_at on public.v2_grower_scout_reports;
create trigger trg_v2_grower_scout_reports_updated_at
before update on public.v2_grower_scout_reports
for each row
execute function public.v2_touch_grower_scout_updated_at();

drop trigger if exists trg_v2_grower_scout_assets_updated_at on public.v2_grower_scout_assets;
create trigger trg_v2_grower_scout_assets_updated_at
before update on public.v2_grower_scout_assets
for each row
execute function public.v2_touch_grower_scout_updated_at();

alter table public.v2_grower_scout_reports enable row level security;
alter table public.v2_grower_scout_assets enable row level security;

drop policy if exists "Allow app read grower scout reports" on public.v2_grower_scout_reports;
create policy "Allow app read grower scout reports"
  on public.v2_grower_scout_reports
  for select
  using (true);

drop policy if exists "Allow app write grower scout reports" on public.v2_grower_scout_reports;
create policy "Allow app write grower scout reports"
  on public.v2_grower_scout_reports
  for all
  using (true)
  with check (true);

drop policy if exists "Allow app read grower scout assets" on public.v2_grower_scout_assets;
create policy "Allow app read grower scout assets"
  on public.v2_grower_scout_assets
  for select
  using (true);

drop policy if exists "Allow app write grower scout assets" on public.v2_grower_scout_assets;
create policy "Allow app write grower scout assets"
  on public.v2_grower_scout_assets
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'grower_scout_audio',
  'grower_scout_audio',
  true,
  52428800,
  array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'grower_scout_photos',
  'grower_scout_photos',
  true,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'grower_scout_files',
  'grower_scout_files',
  true,
  52428800
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "Allow grower scout storage reads" on storage.objects;
create policy "Allow grower scout storage reads"
  on storage.objects
  for select
  using (bucket_id in ('grower_scout_audio', 'grower_scout_photos', 'grower_scout_files'));

drop policy if exists "Allow grower scout storage uploads" on storage.objects;
create policy "Allow grower scout storage uploads"
  on storage.objects
  for insert
  with check (bucket_id in ('grower_scout_audio', 'grower_scout_photos', 'grower_scout_files'));

drop policy if exists "Allow grower scout storage updates" on storage.objects;
create policy "Allow grower scout storage updates"
  on storage.objects
  for update
  using (bucket_id in ('grower_scout_audio', 'grower_scout_photos', 'grower_scout_files'))
  with check (bucket_id in ('grower_scout_audio', 'grower_scout_photos', 'grower_scout_files'));

drop policy if exists "Allow grower scout storage deletes" on storage.objects;
create policy "Allow grower scout storage deletes"
  on storage.objects
  for delete
  using (bucket_id in ('grower_scout_audio', 'grower_scout_photos', 'grower_scout_files'));

alter table public.v2_grower_scout_reports replica identity full;
alter table public.v2_grower_scout_assets replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_grower_scout_reports;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.v2_grower_scout_assets;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- ============================================================================
-- Source: chat_messaging_migration.sql
-- ============================================================================

-- Safe, repeatable chat schema migration for Supabase.
-- This file is intentionally idempotent: it can be run after a clean install,
-- after an older chat schema, or after a partial failed run.

create extension if not exists pgcrypto;

create table if not exists public.v2_chat_conversations (
    id uuid primary key default gen_random_uuid()
);

alter table public.v2_chat_conversations add column if not exists id uuid;
alter table public.v2_chat_conversations add column if not exists title text;
alter table public.v2_chat_conversations add column if not exists is_group boolean;
alter table public.v2_chat_conversations add column if not exists created_by text;
alter table public.v2_chat_conversations add column if not exists created_by_display text;
alter table public.v2_chat_conversations add column if not exists created_at timestamptz;
alter table public.v2_chat_conversations add column if not exists updated_at timestamptz;
alter table public.v2_chat_conversations add column if not exists last_message_at timestamptz;
alter table public.v2_chat_conversations add column if not exists last_message_preview text;
alter table public.v2_chat_conversations add column if not exists last_message_sender text;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v2_chat_conversations'
          and column_name = 'id'
          and data_type = 'uuid'
    ) then
        alter table public.v2_chat_conversations alter column id set default gen_random_uuid();
        update public.v2_chat_conversations set id = gen_random_uuid() where id is null;
    end if;
end $$;

update public.v2_chat_conversations
set
    is_group = coalesce(is_group, false),
    created_by = coalesce(nullif(created_by, ''), 'legacy'),
    created_by_display = coalesce(created_by_display, created_by, 'Legacy Chat'),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, created_at, now()),
    last_message_preview = coalesce(last_message_preview, ''),
    last_message_sender = coalesce(last_message_sender, '');

alter table public.v2_chat_conversations alter column is_group set default false;
alter table public.v2_chat_conversations alter column is_group set not null;
alter table public.v2_chat_conversations alter column created_by set default 'legacy';
alter table public.v2_chat_conversations alter column created_by set not null;
alter table public.v2_chat_conversations alter column created_at set default now();
alter table public.v2_chat_conversations alter column created_at set not null;
alter table public.v2_chat_conversations alter column updated_at set default now();
alter table public.v2_chat_conversations alter column updated_at set not null;

create unique index if not exists uq_v2_chat_conversations_id
    on public.v2_chat_conversations (id);

create table if not exists public.v2_chat_participants (
    id uuid primary key default gen_random_uuid()
);

alter table public.v2_chat_participants add column if not exists id uuid;
alter table public.v2_chat_participants add column if not exists conversation_id uuid;
alter table public.v2_chat_participants add column if not exists username text;
alter table public.v2_chat_participants add column if not exists display_name text;
alter table public.v2_chat_participants add column if not exists joined_at timestamptz;
alter table public.v2_chat_participants add column if not exists last_read_at timestamptz;
alter table public.v2_chat_participants add column if not exists is_archived boolean;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v2_chat_participants'
          and column_name = 'id'
          and data_type = 'uuid'
    ) then
        alter table public.v2_chat_participants alter column id set default gen_random_uuid();
        update public.v2_chat_participants set id = gen_random_uuid() where id is null;
    end if;
end $$;

update public.v2_chat_participants
set
    username = nullif(username, ''),
    display_name = coalesce(display_name, username),
    joined_at = coalesce(joined_at, now()),
    is_archived = coalesce(is_archived, false);

alter table public.v2_chat_participants alter column joined_at set default now();
alter table public.v2_chat_participants alter column joined_at set not null;
alter table public.v2_chat_participants alter column is_archived set default false;
alter table public.v2_chat_participants alter column is_archived set not null;

delete from public.v2_chat_participants a
using public.v2_chat_participants b
where a.conversation_id is not null
  and b.conversation_id is not null
  and a.username is not null
  and b.username is not null
  and a.conversation_id = b.conversation_id
  and a.username = b.username
  and (
    a.joined_at > b.joined_at
    or (a.joined_at = b.joined_at and a.id > b.id)
  );

create unique index if not exists uq_v2_chat_participants_conversation_username
    on public.v2_chat_participants (conversation_id, username);

create table if not exists public.v2_chat_messages (
    id uuid primary key default gen_random_uuid()
);

alter table public.v2_chat_messages add column if not exists id uuid;
alter table public.v2_chat_messages add column if not exists conversation_id uuid;
alter table public.v2_chat_messages add column if not exists sender_username text;
alter table public.v2_chat_messages add column if not exists sender_display_name text;
alter table public.v2_chat_messages add column if not exists body text;
alter table public.v2_chat_messages add column if not exists created_at timestamptz;
alter table public.v2_chat_messages add column if not exists client_id text;
alter table public.v2_chat_messages add column if not exists thread_id uuid;
alter table public.v2_chat_messages add column if not exists sender_name text;
alter table public.v2_chat_messages add column if not exists message_text text;
alter table public.v2_chat_messages add column if not exists message_type text;
alter table public.v2_chat_messages add column if not exists audio_url text;
alter table public.v2_chat_messages add column if not exists audio_storage_path text;
alter table public.v2_chat_messages add column if not exists audio_duration_seconds integer;
alter table public.v2_chat_messages add column if not exists audio_mime_type text;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v2_chat_messages'
          and column_name = 'id'
          and data_type = 'uuid'
    ) then
        alter table public.v2_chat_messages alter column id set default gen_random_uuid();
        update public.v2_chat_messages set id = gen_random_uuid() where id is null;
    end if;
end $$;

do $$
declare
    conversation_id_type text;
    thread_id_type text;
begin
    select data_type
    into conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'conversation_id';

    select data_type
    into thread_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'thread_id';

    if conversation_id_type = 'uuid' and thread_id_type = 'uuid' then
        update public.v2_chat_messages
        set conversation_id = thread_id
        where conversation_id is null and thread_id is not null;
    elsif conversation_id_type = 'uuid' and thread_id_type is not null then
        update public.v2_chat_messages
        set conversation_id = thread_id::text::uuid
        where conversation_id is null
          and thread_id is not null
          and thread_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    elsif conversation_id_type in ('text', 'character varying') and thread_id_type is not null then
        update public.v2_chat_messages
        set conversation_id = thread_id::text
        where conversation_id is null and thread_id is not null;
    end if;
end $$;

update public.v2_chat_messages
set
    sender_display_name = coalesce(sender_display_name, sender_name),
    sender_username = coalesce(
        sender_username,
        nullif(trim(both '_' from regexp_replace(lower(coalesce(sender_name, '')), '[^a-z0-9]+', '_', 'g')), '')
    ),
    body = coalesce(body, message_text),
    created_at = coalesce(created_at, now()),
    message_type = case
        when coalesce(message_type, '') <> '' then message_type
        when coalesce(audio_url, '') <> '' then 'voice'
        else 'text'
    end
where
    sender_display_name is null
    or sender_username is null
    or body is null
    or created_at is null
    or coalesce(message_type, '') = '';

alter table public.v2_chat_messages alter column created_at set default now();
alter table public.v2_chat_messages alter column created_at set not null;
alter table public.v2_chat_messages alter column message_type set default 'text';
alter table public.v2_chat_messages alter column message_type set not null;

create unique index if not exists uq_v2_chat_messages_id
    on public.v2_chat_messages (id);

drop trigger if exists trigger_new_chat on public.v2_chat_messages;
drop trigger if exists chat_push_trigger on public.v2_chat_messages;
drop function if exists public.notify_new_chat() cascade;

do $$
declare
    conversation_id_type text;
    conversation_row_id_type text;
    legacy_id_expr text;
    legacy_guard text := '';
begin
    select data_type
    into conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'conversation_id';

    select data_type
    into conversation_row_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_conversations'
      and column_name = 'id';

    if conversation_row_id_type = 'uuid' and conversation_id_type = 'uuid' then
        legacy_id_expr := 'conversation_id';
    elsif conversation_row_id_type = 'uuid' and conversation_id_type in ('text', 'character varying') then
        legacy_id_expr := 'conversation_id::uuid';
        legacy_guard := ' and conversation_id::text ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
    elsif conversation_row_id_type in ('text', 'character varying') and conversation_id_type is not null then
        legacy_id_expr := 'conversation_id::text';
    end if;

    if legacy_id_expr is not null then
        execute format($legacy$
            with legacy_conversations as (
                select
                    %1$s as id,
                    min(created_at) as created_at,
                    max(created_at) as last_message_at
                from public.v2_chat_messages
                where conversation_id is not null %2$s
                group by %1$s
            ),
            legacy_latest as (
                select distinct on (%1$s)
                    %1$s as id,
                    body,
                    sender_display_name,
                    created_at
                from public.v2_chat_messages
                where conversation_id is not null %2$s
                order by %1$s, created_at desc
            )
            insert into public.v2_chat_conversations (
                id,
                title,
                is_group,
                created_by,
                created_by_display,
                created_at,
                updated_at,
                last_message_at,
                last_message_preview,
                last_message_sender
            )
            select
                lc.id,
                'Legacy Chat',
                true,
                'legacy',
                'Legacy Chat',
                lc.created_at,
                lc.last_message_at,
                lc.last_message_at,
                left(coalesce(ll.body, ''), 160),
                coalesce(ll.sender_display_name, '')
            from legacy_conversations lc
            left join legacy_latest ll on ll.id = lc.id
            on conflict (id) do nothing
        $legacy$, legacy_id_expr, legacy_guard);
    end if;
end $$;

do $$
declare
    message_conversation_id_type text;
    participant_conversation_id_type text;
    participant_conversation_expr text;
    participant_guard text := '';
begin
    select data_type
    into message_conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'conversation_id';

    select data_type
    into participant_conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_participants'
      and column_name = 'conversation_id';

    if participant_conversation_id_type = 'uuid' and message_conversation_id_type = 'uuid' then
        participant_conversation_expr := 'conversation_id';
    elsif participant_conversation_id_type = 'uuid' and message_conversation_id_type in ('text', 'character varying') then
        participant_conversation_expr := 'conversation_id::uuid';
        participant_guard := ' and conversation_id::text ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
    elsif participant_conversation_id_type in ('text', 'character varying') and message_conversation_id_type is not null then
        participant_conversation_expr := 'conversation_id::text';
    end if;

    if participant_conversation_expr is not null then
        execute format($participants$
            insert into public.v2_chat_participants (conversation_id, username, display_name, joined_at, last_read_at, is_archived)
            select distinct
                %1$s,
                sender_username,
                coalesce(sender_display_name, sender_username),
                min(created_at) over (partition by %1$s, sender_username),
                now(),
                false
            from public.v2_chat_messages
            where conversation_id is not null
              and sender_username is not null
              %2$s
            on conflict (conversation_id, username) do nothing
        $participants$, participant_conversation_expr, participant_guard);
    end if;
end $$;

create index if not exists idx_v2_chat_participants_username
    on public.v2_chat_participants (lower(username));
create index if not exists idx_v2_chat_participants_conversation
    on public.v2_chat_participants (conversation_id);
create index if not exists idx_v2_chat_messages_conversation_created
    on public.v2_chat_messages (conversation_id, created_at desc);
create index if not exists idx_v2_chat_conversations_last_message
    on public.v2_chat_conversations (last_message_at desc nulls last);

create or replace function public.set_v2_chat_conversations_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_v2_chat_conversations_updated_at on public.v2_chat_conversations;
create trigger trg_v2_chat_conversations_updated_at
before update on public.v2_chat_conversations
for each row
execute function public.set_v2_chat_conversations_updated_at();

alter table public.v2_chat_conversations replica identity full;
alter table public.v2_chat_participants replica identity full;
alter table public.v2_chat_messages replica identity full;

alter table public.v2_chat_conversations enable row level security;
alter table public.v2_chat_participants enable row level security;
alter table public.v2_chat_messages enable row level security;

drop policy if exists "Allow app chat conversations" on public.v2_chat_conversations;
create policy "Allow app chat conversations"
    on public.v2_chat_conversations
    for all
    using (true)
    with check (true);

drop policy if exists "Allow app chat participants" on public.v2_chat_participants;
create policy "Allow app chat participants"
    on public.v2_chat_participants
    for all
    using (true)
    with check (true);

drop policy if exists "Allow app chat messages" on public.v2_chat_messages;
create policy "Allow app chat messages"
    on public.v2_chat_messages
    for all
    using (true)
    with check (true);

do $$
declare
    realtime_table_name text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach realtime_table_name in array array['v2_chat_conversations', 'v2_chat_participants', 'v2_chat_messages']
        loop
            if not exists (
                select 1
                from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and schemaname = 'public'
                  and tablename = realtime_table_name
            ) then
                begin
                    execute format('alter publication supabase_realtime add table public.%I', realtime_table_name);
                exception
                    when duplicate_object then null;
                    when invalid_parameter_value then null;
                    when object_not_in_prerequisite_state then null;
                end;
            end if;
        end loop;
    end if;
end $$;

do $$
begin
    if not exists (select 1 from storage.buckets where id = 'chat_voice_notes') then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values (
            'chat_voice_notes',
            'chat_voice_notes',
            true,
            10485760,
            array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
        );
    else
        update storage.buckets
        set
            public = true,
            file_size_limit = coalesce(file_size_limit, 10485760),
            allowed_mime_types = coalesce(
                allowed_mime_types,
                array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
            )
        where id = 'chat_voice_notes';
    end if;
end $$;

drop policy if exists "Allow chat voice note reads" on storage.objects;
create policy "Allow chat voice note reads"
    on storage.objects
    for select
    using (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note uploads" on storage.objects;
create policy "Allow chat voice note uploads"
    on storage.objects
    for insert
    with check (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note updates" on storage.objects;
create policy "Allow chat voice note updates"
    on storage.objects
    for update
    using (bucket_id = 'chat_voice_notes')
    with check (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note deletes" on storage.objects;
create policy "Allow chat voice note deletes"
    on storage.objects
    for delete
    using (bucket_id = 'chat_voice_notes');


-- ============================================================================
-- Source: chat_voice_notes_migration.sql
-- ============================================================================

-- Safe, repeatable voice-note add-on for chat.
-- The main chat_messaging_migration.sql also includes these columns; this file
-- remains useful if only the voice-note portion needs to be repaired.

alter table public.v2_chat_messages add column if not exists message_type text;
alter table public.v2_chat_messages add column if not exists audio_url text;
alter table public.v2_chat_messages add column if not exists audio_storage_path text;
alter table public.v2_chat_messages add column if not exists audio_duration_seconds integer;
alter table public.v2_chat_messages add column if not exists audio_mime_type text;

update public.v2_chat_messages
set message_type = case
    when coalesce(message_type, '') <> '' then message_type
    when coalesce(audio_url, '') <> '' then 'voice'
    else 'text'
end
where coalesce(message_type, '') = '';

alter table public.v2_chat_messages alter column message_type set default 'text';
alter table public.v2_chat_messages alter column message_type set not null;

do $$
begin
    if not exists (select 1 from storage.buckets where id = 'chat_voice_notes') then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values (
            'chat_voice_notes',
            'chat_voice_notes',
            true,
            10485760,
            array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
        );
    else
        update storage.buckets
        set
            public = true,
            file_size_limit = coalesce(file_size_limit, 10485760),
            allowed_mime_types = coalesce(
                allowed_mime_types,
                array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
            )
        where id = 'chat_voice_notes';
    end if;
end $$;

drop policy if exists "Allow chat voice note reads" on storage.objects;
create policy "Allow chat voice note reads"
    on storage.objects
    for select
    using (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note uploads" on storage.objects;
create policy "Allow chat voice note uploads"
    on storage.objects
    for insert
    with check (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note updates" on storage.objects;
create policy "Allow chat voice note updates"
    on storage.objects
    for update
    using (bucket_id = 'chat_voice_notes')
    with check (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note deletes" on storage.objects;
create policy "Allow chat voice note deletes"
    on storage.objects
    for delete
    using (bucket_id = 'chat_voice_notes');


-- ============================================================================
-- Source: walkie_talkie_migration.sql
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.v2_walkie_channels (
    id uuid primary key default gen_random_uuid(),
    title text,
    is_group boolean not null default false,
    created_by text not null,
    created_by_display text,
    active_call_id uuid,
    last_activity_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.v2_walkie_channel_members (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    username text not null,
    display_name text,
    joined_at timestamptz not null default now(),
    is_archived boolean not null default false,
    unique (channel_id, username)
);

create table if not exists public.v2_walkie_calls (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    started_by text not null,
    started_by_display text,
    status text not null default 'live',
    listener_cap integer not null default 6,
    active_speaker_username text,
    active_speaker_device_id text,
    active_speaker_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.v2_walkie_call_members (
    id uuid primary key default gen_random_uuid(),
    call_id uuid not null references public.v2_walkie_calls(id) on delete cascade,
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    username text not null,
    display_name text,
    device_id text not null,
    joined_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    left_at timestamptz,
    is_active boolean not null default true,
    unique (call_id, device_id)
);

create table if not exists public.v2_walkie_signal_events (
    id uuid primary key default gen_random_uuid(),
    call_id uuid not null references public.v2_walkie_calls(id) on delete cascade,
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    sender_username text not null,
    sender_device_id text not null,
    recipient_username text,
    recipient_device_id text,
    kind text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.v2_walkie_channels
    add column if not exists active_call_id uuid,
    add column if not exists last_activity_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists created_by_display text;

alter table public.v2_walkie_channel_members
    add column if not exists is_archived boolean not null default false;

alter table public.v2_walkie_calls
    add column if not exists status text not null default 'live',
    add column if not exists listener_cap integer not null default 6,
    add column if not exists active_speaker_username text,
    add column if not exists active_speaker_device_id text,
    add column if not exists active_speaker_at timestamptz,
    add column if not exists ended_at timestamptz,
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists started_by_display text;

alter table public.v2_walkie_call_members
    add column if not exists last_seen_at timestamptz not null default now(),
    add column if not exists left_at timestamptz,
    add column if not exists is_active boolean not null default true,
    add column if not exists display_name text;

alter table public.v2_walkie_signal_events
    add column if not exists recipient_username text,
    add column if not exists recipient_device_id text,
    add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists idx_v2_walkie_channel_members_username on public.v2_walkie_channel_members (lower(username));
create index if not exists idx_v2_walkie_channel_members_channel on public.v2_walkie_channel_members (channel_id);
create index if not exists idx_v2_walkie_calls_channel_status on public.v2_walkie_calls (channel_id, status, created_at desc);
create index if not exists idx_v2_walkie_call_members_call_active on public.v2_walkie_call_members (call_id, is_active, last_seen_at desc);
create index if not exists idx_v2_walkie_call_members_username on public.v2_walkie_call_members (lower(username), is_active);
create index if not exists idx_v2_walkie_signal_events_call_created on public.v2_walkie_signal_events (call_id, created_at desc);
create index if not exists idx_v2_walkie_signal_events_recipient on public.v2_walkie_signal_events (recipient_device_id, created_at desc);

create or replace function public.set_v2_walkie_channels_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    if new.last_activity_at is null then
        new.last_activity_at = now();
    end if;
    return new;
end;
$$;

create or replace function public.set_v2_walkie_calls_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_v2_walkie_channels_updated_at on public.v2_walkie_channels;
create trigger trg_v2_walkie_channels_updated_at
before update on public.v2_walkie_channels
for each row
execute function public.set_v2_walkie_channels_updated_at();

drop trigger if exists trg_v2_walkie_calls_updated_at on public.v2_walkie_calls;
create trigger trg_v2_walkie_calls_updated_at
before update on public.v2_walkie_calls
for each row
execute function public.set_v2_walkie_calls_updated_at();

alter table public.v2_walkie_channels replica identity full;
alter table public.v2_walkie_channel_members replica identity full;
alter table public.v2_walkie_calls replica identity full;
alter table public.v2_walkie_call_members replica identity full;
alter table public.v2_walkie_signal_events replica identity full;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_channels'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_channels;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_channel_members'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_channel_members;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_calls'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_calls;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_call_members'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_call_members;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_signal_events'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_signal_events;
        end if;
    end if;
end $$;


-- ============================================================================
-- Source: labor_time_cards_migration.sql
-- ============================================================================

create table if not exists public.v2_employee_time_cards (
  unique_id text primary key,
  supervisor_username text not null,
  supervisor_display text,
  employee_name text not null,
  employee_code text,
  department text,
  week_ending date not null,
  days jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_employee_time_cards_supervisor_week
  on public.v2_employee_time_cards (supervisor_username, week_ending desc);

create index if not exists idx_v2_employee_time_cards_employee_week
  on public.v2_employee_time_cards (employee_name, week_ending desc);


-- ============================================================================
-- Source: productivity_history_migration.sql
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.v2_productivity_history (
    id uuid primary key default gen_random_uuid(),
    event_key text not null unique,
    completed_by_username text not null,
    completed_by_display text not null,
    completed_at timestamptz not null,
    source_table text not null,
    source_kind text not null,
    source_unique_id text not null,
    source_assignment text null,
    itemcode text null,
    commonname text null,
    contsize text null,
    locationcode text null,
    lotcode text null,
    customer_name text null,
    request_folder text null,
    snapshot jsonb not null
);

create index if not exists idx_v2_productivity_history_user_completed_at
    on public.v2_productivity_history (completed_by_username, completed_at desc);

create index if not exists idx_v2_productivity_history_completed_at
    on public.v2_productivity_history (completed_at desc);


-- ============================================================================
-- Source: dock_issue_source_match_key_migration.sql
-- ============================================================================

alter table public.v2_dock_issue_status
add column if not exists source_match_key text;

create index if not exists idx_v2_dock_issue_status_source_match_key
on public.v2_dock_issue_status (source_match_key);

update public.v2_dock_issue_status
set source_match_key = case
  when
    trim(regexp_replace(upper(coalesce(dock_num, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(stop_number, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_customername, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_consigneename, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_salesrep, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_itemcode, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_contsize, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_locationcode, '')), '[^A-Z0-9]+', ' ', 'g')) = '' and
    trim(regexp_replace(upper(coalesce(source_lotcode, '')), '[^A-Z0-9]+', ' ', 'g')) = ''
  then ''
  else concat_ws(
    '||',
    trim(regexp_replace(regexp_replace(upper(coalesce(dock_num, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(stop_number, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_customername, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_consigneename, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_salesrep, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_itemcode, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_contsize, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_locationcode, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
    trim(regexp_replace(regexp_replace(upper(coalesce(source_lotcode, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
  )
end
where coalesce(source_match_key, '') = '';


-- ============================================================================
-- Source: av_hot_price_view.sql
-- ============================================================================

create or replace view public.v2_view_av_hot_price_keys as
with ranked_cav as (
  select
    c.unique_id,
    c.itemcode as cav_itemcode,
    c.hot_price,
    c.filename as cav_filename,
    c.last_updated as cav_last_updated,
    upper(regexp_replace(c.itemcode, '[^A-Za-z0-9]', '', 'g')) as itemcode_key,
    row_number() over (
      partition by upper(regexp_replace(c.itemcode, '[^A-Za-z0-9]', '', 'g'))
      order by c.last_updated desc nulls last, c.filename desc nulls last, c.unique_id desc
    ) as rn
  from public.v2_cav_import c
  where coalesce(trim(c.hot_price), '') <> ''
    and upper(trim(c.hot_price)) <> 'NULL'
    and coalesce(trim(c.itemcode), '') <> ''
    and upper(trim(c.itemcode)) <> 'NULL'
)
select
  itemcode_key,
  cav_itemcode,
  hot_price,
  cav_filename,
  cav_last_updated
from ranked_cav
where rn = 1;

grant select on public.v2_view_av_hot_price_keys to anon, authenticated;
notify pgrst, 'reload schema';


-- ============================================================================
-- Cleanup audit only: this view lists public tables/views that are not part of
-- the known GNC app schema list above. It DOES NOT drop anything. Review this
-- view before removing objects manually.
-- ============================================================================

create or replace view public.v2_app_schema_cleanup_candidates as
with expected_object_names(object_name) as (
    values
        ('marketing_materials'),
        ('v2_active_request'),
        ('v2_app_live_events'),
        ('v2_app_users'),
        ('v2_av_hot_price_keys'),
        ('v2_cav_import'),
        ('v2_chat_conversations'),
        ('v2_chat_messages'),
        ('v2_chat_participants'),
        ('v2_diagnostic_lab_cases'),
        ('v2_disease_training_assets'),
        ('v2_dock_issues'),
        ('v2_employee_time_cards'),
        ('v2_flyer_folder_history'),
        ('v2_flyer_folder_rows'),
        ('v2_grower_scout_assets'),
        ('v2_grower_scout_reports'),
        ('v2_hold_learning_events'),
        ('v2_hold_learning_profiles'),
        ('v2_master_inventory'),
        ('v2_ml_github_dispatch_state'),
        ('v2_ml_image_jobs'),
        ('v2_ncr_completions'),
        ('v2_productivity_history'),
        ('v2_push_subscriptions'),
        ('v2_request_email_threads'),
        ('v2_request_history'),
        ('v2_reserves'),
        ('v2_sales_office'),
        ('v2_shear_list'),
        ('v2_soc_master'),
        ('v2_take_back_queue'),
        ('v2_view_av_hot_price_keys'),
        ('v2_walkie_call_members'),
        ('v2_walkie_calls'),
        ('v2_walkie_channel_members'),
        ('v2_walkie_channels'),
        ('v2_walkie_signal_events'),
        ('v2_weather_hourly')
), public_objects as (
    select
        c.relname::text as object_name,
        case c.relkind
            when 'r' then 'table'
            when 'p' then 'partitioned table'
            when 'v' then 'view'
            when 'm' then 'materialized view'
            else c.relkind::text
        end as object_type,
        pg_total_relation_size(c.oid) as total_bytes,
        obj_description(c.oid, 'pg_class') as comment
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and c.relname not like 'pg_%'
      and c.relname not like 'supabase_%'
)
select
    p.object_name,
    p.object_type,
    p.total_bytes,
    p.comment
from public_objects p
left join expected_object_names e on e.object_name = p.object_name
where e.object_name is null
order by p.total_bytes desc nulls last, p.object_name;

comment on view public.v2_app_schema_cleanup_candidates is
'Review-only list of public tables/views not recognized by the GNC app repair script. This view intentionally does not drop data.';
