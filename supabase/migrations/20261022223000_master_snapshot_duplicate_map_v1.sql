begin;

do $migration$
declare
  function_oid oid := 'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
  function_definition text;
  anchor text := $anchor$  update pg_temp.ph_master_bulk_map_v1 mapped
  set canonical_unique_id = mapped.source_unique_id
  where mapped.canonical_unique_id is null;$anchor$;
  replacement text := anchor || $replacement$

  with duplicate_canonical as materialized (
    select distinct on (duplicate_mapped.row_number)
      duplicate_mapped.row_number, keeper_mapped.canonical_unique_id
    from pg_temp.ph_master_bulk_map_v1 duplicate_mapped
    join pg_temp.ph_master_bulk_stage_v1 duplicate_s using (row_number)
    join pg_temp.ph_master_bulk_stage_v1 keeper_s
      on keeper_s.unique_id < duplicate_s.unique_id
     and (keeper_s.lineage_key = duplicate_s.lineage_key
       or keeper_s.stable_identity_key = duplicate_s.stable_identity_key)
    join pg_temp.ph_master_bulk_map_v1 keeper_mapped on keeper_mapped.row_number = keeper_s.row_number
    join public.ph_master_inventory keeper_live on keeper_live.unique_id = keeper_mapped.canonical_unique_id
    where not exists (
      select 1 from public.ph_master_inventory duplicate_live
      where duplicate_live.unique_id = duplicate_mapped.canonical_unique_id
    )
    order by duplicate_mapped.row_number, keeper_s.unique_id
  )
  update pg_temp.ph_master_bulk_map_v1 duplicate_mapped
  set canonical_unique_id = duplicate_canonical.canonical_unique_id
  from duplicate_canonical
  where duplicate_mapped.row_number = duplicate_canonical.row_number;$replacement$;
begin
  select pg_get_functiondef(function_oid) into function_definition;
  if length(function_definition) - length(replace(function_definition, anchor, '')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_DUPLICATE_MAP_ANCHOR_INVALID';
  end if;
  execute replace(function_definition, anchor, replacement);
end
$migration$;

commit;
