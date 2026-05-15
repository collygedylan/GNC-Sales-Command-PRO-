alter table public.v2_master_inventory
    add column if not exists hold_release_approved_at timestamptz,
    add column if not exists hold_release_approved_by text,
    add column if not exists hold_release_approved_by_display text,
    add column if not exists hold_release_approved_holdstopbegindate text;

create index if not exists idx_v2_master_inventory_hold_release_approved_at
    on public.v2_master_inventory (hold_release_approved_at);

create index if not exists idx_v2_master_inventory_hold_release_approved_by
    on public.v2_master_inventory (hold_release_approved_by);
