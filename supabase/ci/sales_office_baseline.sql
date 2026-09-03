-- The production Sales Office table predates the checked-in migration history.
-- Recreate its legacy shape only inside the isolated CI database so migrations
-- and RLS tests exercise the same dependency that exists in production.

create table if not exists public.ph_sales_office (
  unique_id text primary key,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  ptravailable text,
  priority text,
  sales_note text,
  photo_link text,
  completed_by text,
  completed_at timestamptz default now(),
  master_id text,
  so_source text default 'season',
  order_folder text,
  order_number text,
  order_customer text,
  order_qty text,
  order_desired_spec text,
  order_desired_caliper text,
  order_reserve text,
  order_submitted_by text,
  order_submitted_at timestamptz,
  order_status text default 'Pending Review',
  av_note text,
  spec text,
  caliper text,
  photo_name text,
  move_batch_id text,
  move_from_locationcode text,
  move_to_locationcode text,
  move_actual_qty numeric
);

alter table public.ph_sales_office enable row level security;

revoke all on table public.ph_sales_office from public, anon, authenticated;
grant select on table public.ph_sales_office to anon, authenticated;
grant all on table public.ph_sales_office to service_role;

drop policy if exists "Authenticated users read Sales Office" on public.ph_sales_office;
create policy "Authenticated users read Sales Office"
on public.ph_sales_office for select to authenticated
using (true);

-- The Custom AV import table is another production-era dependency that is
-- intentionally read-only in this test baseline.
create table if not exists public.ph_cav_import (
  unique_id text primary key,
  last_updated timestamptz,
  filename text,
  itemcode text,
  commonname text,
  contsize text,
  season text,
  ptravailable text,
  brand text,
  spec text,
  hz text,
  unitprice text,
  holdstopreason text,
  ordertotal text,
  product_description text,
  brand_code text,
  h text,
  available text,
  reserved_qty text,
  order_qty text,
  unit_price text,
  n_star text,
  hot_price text,
  hold_reason text,
  ext_item_total text,
  created_at timestamptz not null default now()
);

alter table public.ph_cav_import enable row level security;
revoke all on table public.ph_cav_import from public, anon, authenticated;
grant select on table public.ph_cav_import to anon, authenticated;
grant all on table public.ph_cav_import to service_role;

drop policy if exists "Authenticated users read Custom AV imports" on public.ph_cav_import;
create policy "Authenticated users read Custom AV imports"
on public.ph_cav_import for select to authenticated
using (true);
