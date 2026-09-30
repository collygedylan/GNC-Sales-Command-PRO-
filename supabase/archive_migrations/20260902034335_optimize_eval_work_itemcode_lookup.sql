begin;

-- Eval Work and Eval Reports #2 normalize ITEMCODE with COALESCE before trim.
-- Earlier indexes omitted that expression, so PostgreSQL scanned the complete
-- inventory and assignment tables several times for every selected ITEMCODE.
create index if not exists idx_ph_master_inventory_eval_itemcode_lookup
  on public.ph_master_inventory (upper(btrim(coalesce(itemcode, ''))))
  where nullif(btrim(coalesce(unique_id, '')), '') is not null;

create index if not exists idx_ph_warehouse_assigned_items_eval_itemcode_lookup
  on public.ph_warehouse_assigned_items (
    upper(btrim(coalesce(itemcode_normalized, itemcode, '')))
  )
  include (assignedto)
  where coalesce(present_in_drive, true);

analyze public.ph_master_inventory;
analyze public.ph_warehouse_assigned_items;

commit;
