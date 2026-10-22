begin;

do $migration$
declare
  function_oid oid;
  function_definition text;
  anchor text := $anchor$
  insert into app_sync_private.ph_master_bulk_import_source_v1(
    canonical_unique_id, source_unique_id, source_hash, import_run_id
  )
  select coalesce(c.canonical_unique_id, priority_seen.canonical_unique_id,
    item6_seen.canonical_unique_id, c.source_unique_id), c.source_unique_id, c.source_hash, p_run_id
  from app_sync_private.ph_master_bulk_import_context_v1 c
  left join app_sync_private.ph_master_inventory_import_lineage_seen priority_seen
    on priority_seen.run_id = c.run_id and priority_seen.imported_unique_id = c.source_unique_id
  left join app_sync_private.ph_master_inventory_item6_alias_seen_v7 item6_seen
    on item6_seen.run_id = c.run_id and item6_seen.imported_unique_id = c.source_unique_id
  where c.run_id = p_run_id and c.request_id = p_request_id
    and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()
  on conflict (canonical_unique_id) do update set
    source_unique_id = excluded.source_unique_id, source_hash = excluded.source_hash,
    import_run_id = excluded.import_run_id, updated_at = clock_timestamp()
  where app_sync_private.ph_master_bulk_import_source_v1.source_hash is distinct from excluded.source_hash
     or app_sync_private.ph_master_bulk_import_source_v1.source_unique_id is distinct from excluded.source_unique_id;
$anchor$;
  replacement text := $replacement$
  insert into app_sync_private.ph_master_bulk_import_source_v1(
    canonical_unique_id, source_unique_id, source_hash, import_run_id
  )
  select resolved.canonical_unique_id, resolved.source_unique_id, resolved.source_hash, p_run_id
  from (
    select distinct on (coalesce(c.canonical_unique_id, priority_seen.canonical_unique_id,
      item6_seen.canonical_unique_id, c.source_unique_id))
      coalesce(c.canonical_unique_id, priority_seen.canonical_unique_id,
        item6_seen.canonical_unique_id, c.source_unique_id) as canonical_unique_id,
      c.source_unique_id, c.source_hash
    from app_sync_private.ph_master_bulk_import_context_v1 c
    left join app_sync_private.ph_master_inventory_import_lineage_seen priority_seen
      on priority_seen.run_id = c.run_id and priority_seen.imported_unique_id = c.source_unique_id
    left join app_sync_private.ph_master_inventory_item6_alias_seen_v7 item6_seen
      on item6_seen.run_id = c.run_id and item6_seen.imported_unique_id = c.source_unique_id
    where c.run_id = p_run_id and c.request_id = p_request_id
      and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()
    order by coalesce(c.canonical_unique_id, priority_seen.canonical_unique_id,
      item6_seen.canonical_unique_id, c.source_unique_id), c.source_unique_id
  ) resolved
  on conflict (canonical_unique_id) do update set
    source_unique_id = excluded.source_unique_id, source_hash = excluded.source_hash,
    import_run_id = excluded.import_run_id, updated_at = clock_timestamp()
  where app_sync_private.ph_master_bulk_import_source_v1.source_hash is distinct from excluded.source_hash
     or app_sync_private.ph_master_bulk_import_source_v1.source_unique_id is distinct from excluded.source_unique_id;
$replacement$;
begin
  foreach function_oid in array array[
    'public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure,
    'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure
  ] loop
    select pg_get_functiondef(function_oid) into function_definition;
    if length(function_definition) - length(replace(function_definition, anchor, '')) <> length(anchor) then
      raise exception 'MASTER_SNAPSHOT_SOURCE_DEDUP_ANCHOR_INVALID';
    end if;
    execute replace(function_definition, anchor, replacement);
  end loop;
end
$migration$;

commit;
