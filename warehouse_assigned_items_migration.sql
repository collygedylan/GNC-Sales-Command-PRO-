begin;

create extension if not exists pgcrypto;

create table if not exists public.v2_warehouse_assigned_items (
  unique_id text primary key,
  id uuid not null default gen_random_uuid(),
  assignedto text,
  warehousei text,
  itemcode text,
  contsize text,
  commonname text,
  locationcode text,
  source text,
  genusname text,
  sheet_row_number integer,
  import_batch text,
  filename text,
  last_updated timestamptz,
  concat text,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.v2_warehouse_assigned_items is
  'Imported Google Sheet rows for warehouse assigned item data.';

comment on column public.v2_warehouse_assigned_items.assignedto is 'Google Sheet header: AssignedTo';
comment on column public.v2_warehouse_assigned_items.warehousei is 'Google Sheet header: WAREHOUSEI';
comment on column public.v2_warehouse_assigned_items.itemcode is 'Google Sheet header: ITEMCODE';
comment on column public.v2_warehouse_assigned_items.contsize is 'Google Sheet header: CONTSIZE';
comment on column public.v2_warehouse_assigned_items.commonname is 'Google Sheet header: COMMONNAME';
comment on column public.v2_warehouse_assigned_items.locationcode is 'Google Sheet header: LOCATIONCODE';
comment on column public.v2_warehouse_assigned_items.source is 'Google Sheet header: SOURCE';
comment on column public.v2_warehouse_assigned_items.genusname is 'Google Sheet header: GENUSNAME';

create unique index if not exists idx_v2_warehouse_assigned_items_id
  on public.v2_warehouse_assigned_items (id);

create index if not exists idx_v2_warehouse_assigned_items_assignedto
  on public.v2_warehouse_assigned_items (assignedto);

create index if not exists idx_v2_warehouse_assigned_items_itemcode
  on public.v2_warehouse_assigned_items (itemcode);

create index if not exists idx_v2_warehouse_assigned_items_location_source
  on public.v2_warehouse_assigned_items (locationcode, source);

create index if not exists idx_v2_warehouse_assigned_items_warehousei
  on public.v2_warehouse_assigned_items (warehousei);

create index if not exists idx_v2_warehouse_assigned_items_import_batch
  on public.v2_warehouse_assigned_items (import_batch);

create index if not exists idx_v2_warehouse_assigned_items_last_updated
  on public.v2_warehouse_assigned_items (last_updated desc);

create or replace function public.set_v2_warehouse_assigned_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_warehouse_assigned_items_updated_at on public.v2_warehouse_assigned_items;
create trigger trg_v2_warehouse_assigned_items_updated_at
before update on public.v2_warehouse_assigned_items
for each row execute function public.set_v2_warehouse_assigned_items_updated_at();

alter table public.v2_warehouse_assigned_items enable row level security;

drop policy if exists "v2_warehouse_assigned_items_select_authenticated"
  on public.v2_warehouse_assigned_items;
create policy "v2_warehouse_assigned_items_select_authenticated"
  on public.v2_warehouse_assigned_items
  for select
  to authenticated
  using (true);

drop policy if exists "v2_warehouse_assigned_items_insert_authenticated"
  on public.v2_warehouse_assigned_items;
create policy "v2_warehouse_assigned_items_insert_authenticated"
  on public.v2_warehouse_assigned_items
  for insert
  to authenticated
  with check (true);

drop policy if exists "v2_warehouse_assigned_items_update_authenticated"
  on public.v2_warehouse_assigned_items;
create policy "v2_warehouse_assigned_items_update_authenticated"
  on public.v2_warehouse_assigned_items
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "v2_warehouse_assigned_items_delete_authenticated"
  on public.v2_warehouse_assigned_items;
create policy "v2_warehouse_assigned_items_delete_authenticated"
  on public.v2_warehouse_assigned_items
  for delete
  to authenticated
  using (true);

grant select, insert, update, delete on public.v2_warehouse_assigned_items to authenticated, service_role;

commit;
