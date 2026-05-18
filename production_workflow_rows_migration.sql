create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.v2_production_workflow_rows (
    unique_id text primary key,
    workflow_type text not null,
    source_unique_id text not null,
    status text not null default 'open',
    itemcode text,
    commonname text,
    genus text,
    contsize text,
    locationcode text,
    lotcode text,
    season text,
    blockalpha text,
    ptravailable numeric,
    quantity numeric,
    baynumber text,
    instructions text,
    created_by_username text,
    created_by_display text,
    completed_by_username text,
    completed_by_display text,
    completed_at timestamptz,
    updated_by_username text,
    updated_by_display text,
    snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint v2_production_workflow_type_check check (workflow_type in ('propagation', 'planting')),
    constraint v2_production_workflow_status_check check (status in ('open', 'complete')),
    constraint v2_production_workflow_quantity_check check (quantity is null or quantity >= 0)
);

create unique index if not exists idx_v2_production_workflow_open_source
    on public.v2_production_workflow_rows (workflow_type, source_unique_id)
    where status = 'open';

create index if not exists idx_v2_production_workflow_type_status
    on public.v2_production_workflow_rows (workflow_type, status, updated_at desc);

create index if not exists idx_v2_production_workflow_block_location
    on public.v2_production_workflow_rows (workflow_type, status, blockalpha, locationcode);

create index if not exists idx_v2_production_workflow_itemcode
    on public.v2_production_workflow_rows (itemcode);

create or replace function public.touch_v2_production_workflow_rows_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_v2_production_workflow_rows_updated_at
on public.v2_production_workflow_rows;

create trigger trg_touch_v2_production_workflow_rows_updated_at
before update on public.v2_production_workflow_rows
for each row
execute function public.touch_v2_production_workflow_rows_updated_at();

alter table public.v2_production_workflow_rows enable row level security;

drop policy if exists "v2_production_workflow_rows_read" on public.v2_production_workflow_rows;
create policy "v2_production_workflow_rows_read"
on public.v2_production_workflow_rows
for select
using (true);

drop policy if exists "v2_production_workflow_rows_insert" on public.v2_production_workflow_rows;
create policy "v2_production_workflow_rows_insert"
on public.v2_production_workflow_rows
for insert
with check (true);

drop policy if exists "v2_production_workflow_rows_update" on public.v2_production_workflow_rows;
create policy "v2_production_workflow_rows_update"
on public.v2_production_workflow_rows
for update
using (true)
with check (true);

drop policy if exists "v2_production_workflow_rows_delete" on public.v2_production_workflow_rows;
create policy "v2_production_workflow_rows_delete"
on public.v2_production_workflow_rows
for delete
using (true);

grant select, insert, update, delete on public.v2_production_workflow_rows to anon, authenticated, service_role;

do $$
begin
    alter publication supabase_realtime add table public.v2_production_workflow_rows;
exception
    when duplicate_object then null;
    when undefined_object then null;
end;
$$;
