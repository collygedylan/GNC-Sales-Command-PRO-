-- Dispose of only the historical repair fixtures in this workspace.
begin;
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or (select count(*) from public.ph_master_inventory where unique_id like 'ci-reclass-%')<>11 then
    raise exception 'CANONICAL_RECLASS_FIXTURE_CLEANUP_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

delete from app_sync_private.inventory_location_evidence_v1
where itemcode_key='010585.031.1' and locationcode_key='D.21.000';
delete from app_sync_private.inventory_live_overrides_v1
where canonical_unique_id like 'ci-reclass-%' or canonical_unique_id='010585_031_1-3DP-D_21_000-27_S1-LD----';
delete from app_sync_private.inventory_season_stock_overrides_v1
where itemcode in ('004103.010.1','004424.010.1','010585.031.1') and season in ('F1','S1');
delete from public.ph_master_inventory where unique_id like 'ci-reclass-%'
  or unique_id='010585_031_1-3DP-D_21_000-27_S1-LD----';
commit;
