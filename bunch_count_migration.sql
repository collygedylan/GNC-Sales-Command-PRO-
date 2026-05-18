create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.v2_bunch_counts (
    unique_id text primary key,
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
    constraint v2_bunch_counts_source_unique_id_unique unique (source_unique_id),
    constraint v2_bunch_counts_direction_check check (direction in ('north_south', 'south_north', 'east_west', 'west_east')),
    constraint v2_bunch_counts_row_order_check check (row_order >= 1),
    constraint v2_bunch_counts_counted_qty_check check (counted_qty is null or counted_qty >= 0)
);

create index if not exists idx_v2_bunch_counts_block_location_order
    on public.v2_bunch_counts (blockalpha, locationcode, row_order);

create index if not exists idx_v2_bunch_counts_itemcode
    on public.v2_bunch_counts (itemcode);

create index if not exists idx_v2_bunch_counts_counted_at
    on public.v2_bunch_counts (counted_at desc);

do $$
begin
    if to_regclass('public.v2_spread_counts') is not null then
        insert into public.v2_bunch_counts (
            unique_id,
            source_unique_id,
            itemcode,
            commonname,
            genus,
            contsize,
            locationcode,
            lotcode,
            season,
            blockalpha,
            direction,
            row_order,
            counted_qty,
            counted_by_username,
            counted_by_display,
            counted_at,
            updated_by_username,
            updated_by_display,
            snapshot,
            created_at,
            updated_at
        )
        select
            unique_id,
            source_unique_id,
            itemcode,
            commonname,
            genus,
            contsize,
            locationcode,
            lotcode,
            season,
            blockalpha,
            direction,
            row_order,
            counted_qty,
            counted_by_username,
            counted_by_display,
            counted_at,
            updated_by_username,
            updated_by_display,
            snapshot,
            created_at,
            updated_at
        from public.v2_spread_counts
        where count_type = 'bunch'
        on conflict (unique_id) do update set
            source_unique_id = excluded.source_unique_id,
            itemcode = excluded.itemcode,
            commonname = excluded.commonname,
            genus = excluded.genus,
            contsize = excluded.contsize,
            locationcode = excluded.locationcode,
            lotcode = excluded.lotcode,
            season = excluded.season,
            blockalpha = excluded.blockalpha,
            direction = excluded.direction,
            row_order = excluded.row_order,
            counted_qty = excluded.counted_qty,
            counted_by_username = excluded.counted_by_username,
            counted_by_display = excluded.counted_by_display,
            counted_at = excluded.counted_at,
            updated_by_username = excluded.updated_by_username,
            updated_by_display = excluded.updated_by_display,
            snapshot = excluded.snapshot,
            updated_at = excluded.updated_at;
    end if;
end;
$$;

create or replace function public.touch_v2_bunch_counts_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_v2_bunch_counts_updated_at
on public.v2_bunch_counts;

create trigger trg_touch_v2_bunch_counts_updated_at
before update on public.v2_bunch_counts
for each row
execute function public.touch_v2_bunch_counts_updated_at();

alter table public.v2_bunch_counts enable row level security;

drop policy if exists "v2_bunch_counts_read" on public.v2_bunch_counts;
create policy "v2_bunch_counts_read"
on public.v2_bunch_counts
for select
using (true);

drop policy if exists "v2_bunch_counts_insert" on public.v2_bunch_counts;
create policy "v2_bunch_counts_insert"
on public.v2_bunch_counts
for insert
with check (true);

drop policy if exists "v2_bunch_counts_update" on public.v2_bunch_counts;
create policy "v2_bunch_counts_update"
on public.v2_bunch_counts
for update
using (true)
with check (true);

drop policy if exists "v2_bunch_counts_delete" on public.v2_bunch_counts;
create policy "v2_bunch_counts_delete"
on public.v2_bunch_counts
for delete
using (true);

grant select, insert, update, delete on public.v2_bunch_counts to anon, authenticated, service_role;

do $$
begin
    alter publication supabase_realtime add table public.v2_bunch_counts;
exception
    when duplicate_object then null;
    when undefined_object then null;
end;
$$;
