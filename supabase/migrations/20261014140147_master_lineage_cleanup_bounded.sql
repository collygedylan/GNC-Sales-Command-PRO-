begin;

-- Housekeeping must not scan both lineage ledgers for every imported row.
-- Retained leases protect partial snapshots, including interrupted imports.
create or replace function private.prune_expired_master_lineage_v1(p_run_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if p_run_id is null or current_setting('gnc.master_lineage_cleanup_run', true) = p_run_id::text then
    return;
  end if;
  perform set_config('gnc.master_lineage_cleanup_run', p_run_id::text, true);

  delete from app_sync_private.ph_master_inventory_import_lineage_seen s
  using (
    select expired.ctid
    from app_sync_private.ph_master_inventory_import_lineage_seen expired
    where expired.seen_at < statement_timestamp() - interval '3 days'
      and expired.run_id <> p_run_id
      and not exists (select 1 from app_sync_private.import_leases l where l.run_id = expired.run_id)
    order by expired.seen_at
    limit 500
    for update of expired skip locked
  ) batch
  where s.ctid = batch.ctid;

  delete from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
  using (
    select expired.ctid
    from app_sync_private.ph_master_inventory_item6_alias_seen_v7 expired
    where expired.seen_at < statement_timestamp() - interval '3 days'
      and expired.run_id <> p_run_id
      and not exists (select 1 from app_sync_private.import_leases l where l.run_id = expired.run_id)
    order by expired.seen_at
    limit 500
    for update of expired skip locked
  ) batch
  where s.ctid = batch.ctid;
end
$function$;
revoke all on function private.prune_expired_master_lineage_v1(uuid) from public, anon, authenticated, service_role;

-- Preserve the deployed guards verbatim except for their housekeeping sites.
-- Fail closed on an unexpected body rather than silently losing a protection.
do $migration$
declare
  signature text;
  definition text;
  old_sweep text;
  replacement text;
begin
  for signature, old_sweep, replacement in values
    ('private.guard_ph_master_inventory_priority_hold_v1()',
     E'delete from app_sync_private.ph_master_inventory_import_lineage_seen s\n      where s.seen_at < clock_timestamp() - interval ''3 days'';',
     'perform private.prune_expired_master_lineage_v1(import_run_id);'),
    ('private.resolve_ph_master_inventory_item6_alias_v7()',
     E'delete from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s\n  where s.seen_at < clock_timestamp()-interval ''3 days'';',
     'perform private.prune_expired_master_lineage_v1(v_run_id);')
  loop
    definition := replace(pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n');
    if position(old_sweep in definition) > 0 then
      execute replace(definition, old_sweep, replacement);
    elsif position(replacement in definition) = 0 then
      raise exception 'MASTER_LINEAGE_CLEANUP_GUARD_MISMATCH: %', signature;
    end if;
  end loop;
end
$migration$;

commit;
