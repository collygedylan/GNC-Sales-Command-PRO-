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
