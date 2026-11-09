begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Pending Reclass movements resolve a canonical UID through the map, then
-- read the corresponding typed source row by its ordinal.
do $ordinals$
declare
  definition text := pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
  uid_index text := '  create unique index ph_master_bulk_stage_v1_uidx on pg_temp.ph_master_bulk_stage_v1(unique_id);';
  overlay_call text := '  perform private.apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id);';
  unused_wide_row text := 'm.unique_id, to_jsonb(m) old_row,';
begin
  if strpos(definition,uid_index)=0 then raise exception 'ERP_RECLASS_ORDINAL_INDEX_ANCHOR_MISSING'; end if;
  execute replace(definition,uid_index,$index$  create unique index ph_master_bulk_stage_v1_ordinal_uidx on pg_temp.ph_master_bulk_stage_v1(row_number);
  analyze pg_temp.ph_master_bulk_stage_v1 (row_number);
$index$||uid_index);

  definition:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  if strpos(definition,overlay_call)=0 then raise exception 'ERP_RECLASS_ORDINAL_STATS_ANCHOR_MISSING'; end if;
  execute replace(definition,overlay_call,
    '  analyze pg_temp.ph_master_bulk_map_v1 (canonical_unique_id,row_number);'||chr(10)||overlay_call);

  -- The subsequent reconciliation consumes typed stock deltas, never this
  -- full prior-row JSON. Keep the rest of the order/depletion snapshot intact.
  definition:=pg_get_functiondef('private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure);
  if strpos(definition,unused_wide_row)=0 then raise exception 'ERP_ORDER_DELTA_ROW_ANCHOR_MISSING'; end if;
  execute replace(definition,unused_wide_row,'m.unique_id,');
end
$ordinals$;
commit;
