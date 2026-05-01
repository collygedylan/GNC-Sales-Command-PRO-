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
