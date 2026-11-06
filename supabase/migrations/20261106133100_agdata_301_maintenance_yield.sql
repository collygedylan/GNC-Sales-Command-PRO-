set local lock_timeout='15s';
do $guard$
declare fn record; definition text; changed text;
begin
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname='run_historical_state_dedup_v2366')
      or (n.nspname='public' and p.proname='reconcile_inventory_location_evidence_v1') loop
    definition:=pg_get_functiondef(fn.oid);
    changed:=regexp_replace(definition,E'\\mbegin\\M',E'begin
  -- Scheduled maintenance yields; inline publication reconciliation keeps its contract.
  if current_setting(''application_name'',true)=''pg_cron'' then
    if exists(select 1 from private.erp_sync_jobs where active)
      or not pg_try_advisory_xact_lock(hashtext(''agdata_erp_sync_tick'')) then
      return jsonb_build_object(''ok'',true,''deferred'',true,''reason'',''operational_sync_active'');
    end if;
  end if;');
    if changed=definition then raise exception 'ERP_MAINTENANCE_PATCH_ANCHOR_MISSING'; end if;
    execute changed;
  end loop;
end $guard$;
