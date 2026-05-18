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
