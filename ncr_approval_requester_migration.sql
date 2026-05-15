alter table public.v2_master_inventory
    add column if not exists ncr_approval_type text,
    add column if not exists ncr_requested_by_username text,
    add column if not exists ncr_requested_by_display text,
    add column if not exists ncr_requested_by_email text,
    add column if not exists ncr_requested_at timestamptz,
    add column if not exists ncr_approval_message text;

create index if not exists idx_v2_master_inventory_ncr_approval_type
    on public.v2_master_inventory (ncr_approval_type);

create index if not exists idx_v2_master_inventory_ncr_requested_by_username
    on public.v2_master_inventory (ncr_requested_by_username);

create index if not exists idx_v2_master_inventory_ncr_requested_at
    on public.v2_master_inventory (ncr_requested_at);
