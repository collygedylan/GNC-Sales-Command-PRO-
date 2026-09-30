begin;

-- The lookup functions use `trim(unique_id) <> ''`; PostgreSQL cannot prove
-- that predicate implies the earlier NULLIF-based partial-index predicate.
-- Keep the normalized ITEMCODE index unconditional so every exact lookup can
-- use it without a full inventory scan.
drop index if exists public.idx_ph_master_inventory_eval_itemcode_lookup;
create index idx_ph_master_inventory_eval_itemcode_lookup
  on public.ph_master_inventory (upper(btrim(coalesce(itemcode, ''))));

analyze public.ph_master_inventory;

commit;
