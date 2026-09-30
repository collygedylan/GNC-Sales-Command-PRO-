begin;
set local lock_timeout = '3s';
set local statement_timeout = '8s';

-- Existing partial assignment indexes exclude rows this view must retain.
-- Include all roster rows without changing assignment matching or eligibility.
create index if not exists manager_season_priority_assignment_lookup
  on public.ph_warehouse_assigned_items
  (upper(btrim(coalesce(itemcode_normalized, itemcode, ''))))
  include (assignedto);

create or replace function private.manager_season_priority_scope_v1(p_itemcode text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  -- Keep the frozen scope byte-for-byte identical while avoiding repeated
  -- whole-row JSON conversion and lineage hashing after subquery flattening.
  with scope_rows as materialized (
    select to_jsonb(m) row_json
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = upper(btrim(coalesce(p_itemcode, '')))
  ), hashed_rows as materialized (
    select row_json, private.manager_season_priority_lineage_v1(row_json) lineage_hash
    from scope_rows
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceUid', row_json->>'unique_id',
    'lineageHash', lineage_hash,
    'warehouse', coalesce(row_json->>'warehouseid', row_json->>'warehousei', ''),
    'itemcode', coalesce(row_json->>'itemcode', ''),
    'contsize', coalesce(row_json->>'contsize', ''),
    'locationcode', coalesce(row_json->>'locationcode', ''),
    'lotcode', coalesce(row_json->>'lotcode', ''),
    'source', coalesce(row_json->>'source', ''),
    'desigitem', coalesce(row_json->>'desigitem', ''),
    'desigcust', coalesce(row_json->>'desigcust', ''),
    'desigloc', coalesce(row_json->>'desigloc', ''),
    'priority', btrim(coalesce(row_json->>'priority', '')),
    'ptronhand', coalesce(row_json->>'ptronhand', ''),
    'ptravailable', coalesce(row_json->>'ptravailable', '')
  ) order by lineage_hash, row_json->>'unique_id'), '[]'::jsonb)
  from hashed_rows
$function$;


notify pgrst, 'reload schema';
commit;
