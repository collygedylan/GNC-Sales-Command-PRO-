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
