-- Verify the historical repair ran, then remove its disposable prerequisites.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or (select count(*) from app_sync_private.inventory_season_stock_overrides_v1
         where itemcode='004502.010.1' and ((season='F1' and open_stock=577 and season_oh=634)
           or (season='S1' and open_stock=585 and season_oh=295)))<>2 then
    raise exception 'CANONICAL_FLAME_GRASS_FIXTURE_REPAIR_UNVERIFIED';
  end if;
end;
$fixture$;

delete from public.ph_master_inventory where itemcode='004502.010.1' and unique_id in
  ('ci-flame-grass-1','ci-flame-grass-2','ci-flame-grass-3','ci-flame-grass-4','ci-flame-grass-5');
delete from app_sync_private.inventory_season_stock_overrides_v1 where itemcode='004502.010.1' and season in ('F1','S1');
