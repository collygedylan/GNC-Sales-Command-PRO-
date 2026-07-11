create table if not exists public.v2_inventory_transactions (
  unique_id text primary key,
  created_at timestamptz not null default now(),
  action text not null,
  actor_username text,
  actor_display text,
  actor_email text,
  source_table text,
  source_unique_id text,
  destination_table text,
  destination_unique_id text,
  source_itemcode text,
  source_lotcode text,
  source_locationcode text,
  destination_itemcode text,
  destination_lotcode text,
  destination_locationcode text,
  quantity numeric,
  source_before jsonb,
  source_after jsonb,
  destination_before jsonb,
  destination_after jsonb,
  raw_payload jsonb,
  status text not null default 'applied'
);

create index if not exists v2_inventory_transactions_created_at_idx
  on public.v2_inventory_transactions (created_at desc);

create index if not exists v2_inventory_transactions_source_uid_idx
  on public.v2_inventory_transactions (source_unique_id);

create index if not exists v2_inventory_transactions_destination_uid_idx
  on public.v2_inventory_transactions (destination_unique_id);
