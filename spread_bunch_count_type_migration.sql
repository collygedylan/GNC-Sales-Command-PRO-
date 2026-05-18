create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table if exists public.v2_spread_counts
    add column if not exists count_type text;

update public.v2_spread_counts
set count_type = 'spread'
where count_type is null
   or trim(count_type) = '';

alter table if exists public.v2_spread_counts
    alter column count_type set default 'spread';

alter table if exists public.v2_spread_counts
    alter column count_type set not null;

do $$
begin
    if to_regclass('public.v2_spread_counts') is not null
       and not exists (
           select 1
           from pg_constraint
           where conrelid = 'public.v2_spread_counts'::regclass
             and conname = 'v2_spread_counts_count_type_check'
       ) then
        alter table public.v2_spread_counts
            add constraint v2_spread_counts_count_type_check
            check (count_type in ('spread', 'bunch'));
    end if;
end;
$$;

drop index if exists public.idx_v2_spread_counts_source_unique_id;

create unique index if not exists idx_v2_spread_counts_count_type_source_unique_id
    on public.v2_spread_counts (count_type, source_unique_id);

create index if not exists idx_v2_spread_counts_count_type_block_location_order
    on public.v2_spread_counts (count_type, blockalpha, locationcode, row_order);

create index if not exists idx_v2_spread_counts_count_type_counted_at
    on public.v2_spread_counts (count_type, counted_at desc);
