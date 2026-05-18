create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.v2_spread_counts (
    unique_id text primary key,
    count_type text not null default 'spread',
    source_unique_id text not null,
    itemcode text,
    commonname text,
    genus text,
    contsize text,
    locationcode text,
    lotcode text,
    season text,
    blockalpha text,
    direction text not null default 'north_south',
    row_order integer not null default 1,
    counted_qty numeric,
    counted_by_username text,
    counted_by_display text,
    counted_at timestamptz,
    updated_by_username text,
    updated_by_display text,
    snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint v2_spread_counts_count_type_check check (count_type in ('spread', 'bunch')),
    constraint v2_spread_counts_direction_check check (direction in ('north_south', 'south_north', 'east_west', 'west_east')),
    constraint v2_spread_counts_row_order_check check (row_order >= 1),
    constraint v2_spread_counts_counted_qty_check check (counted_qty is null or counted_qty >= 0)
);

create unique index if not exists idx_v2_spread_counts_count_type_source_unique_id
    on public.v2_spread_counts (count_type, source_unique_id);

create index if not exists idx_v2_spread_counts_block_location_order
    on public.v2_spread_counts (blockalpha, locationcode, row_order);

create index if not exists idx_v2_spread_counts_count_type_block_location_order
    on public.v2_spread_counts (count_type, blockalpha, locationcode, row_order);

create index if not exists idx_v2_spread_counts_itemcode
    on public.v2_spread_counts (itemcode);

create index if not exists idx_v2_spread_counts_counted_at
    on public.v2_spread_counts (counted_at desc);

create or replace function public.touch_v2_spread_counts_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_v2_spread_counts_updated_at
on public.v2_spread_counts;

create trigger trg_touch_v2_spread_counts_updated_at
before update on public.v2_spread_counts
for each row
execute function public.touch_v2_spread_counts_updated_at();

alter table public.v2_spread_counts enable row level security;

drop policy if exists "v2_spread_counts_read" on public.v2_spread_counts;
create policy "v2_spread_counts_read"
on public.v2_spread_counts
for select
using (true);

drop policy if exists "v2_spread_counts_insert" on public.v2_spread_counts;
create policy "v2_spread_counts_insert"
on public.v2_spread_counts
for insert
with check (true);

drop policy if exists "v2_spread_counts_update" on public.v2_spread_counts;
create policy "v2_spread_counts_update"
on public.v2_spread_counts
for update
using (true)
with check (true);

drop policy if exists "v2_spread_counts_delete" on public.v2_spread_counts;
create policy "v2_spread_counts_delete"
on public.v2_spread_counts
for delete
using (true);

grant select, insert, update, delete on public.v2_spread_counts to anon, authenticated, service_role;

do $$
begin
    alter publication supabase_realtime add table public.v2_spread_counts;
exception
    when duplicate_object then null;
    when undefined_object then null;
end;
$$;
