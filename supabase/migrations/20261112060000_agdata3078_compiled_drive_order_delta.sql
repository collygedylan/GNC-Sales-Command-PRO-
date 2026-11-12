begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

-- Only incoming ERP stock is frozen. Read current canonical stock, live
-- overrides, pending Reclass quantities and photo evidence in this statement.
-- Each uniquely mapped live row still produces its reconciliation witness.
create function private.build_compiled_drive_order_delta_v3078()
returns void language plpgsql set search_path='' set enable_nestloop=off as $compiled$
begin
  create temp table erp_order_delta_v23196 on commit drop as
  with mapped_stock as materialized (
    select s.row_number,map.canonical_unique_id,s.frozen_erp_on_hand_v3048,s.frozen_erp_review_v3048
    from pg_temp.ph_master_bulk_map_v1 map join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
    where map.candidate_count=1
  ), stock_overrides as materialized (
    select canonical_unique_id,field_name,pending,latest_erp_value,erp_baseline_value,app_override_value
    from app_sync_private.inventory_live_overrides_v1 where field_name in('ptronhand','ptrreviewed')
  ), raw as materialized (
    select s.row_number,m.unique_id,
      coalesce(m.erp_on_hand,private.inventory_location_evidence_number_v2(oh.latest_erp_value#>>'{}'),
        private.inventory_location_evidence_number_v2(m.ptronhand),0) old_oh,
      coalesce(m.erp_ptrreview,private.inventory_location_evidence_number_v2(rv.latest_erp_value#>>'{}'),
        private.inventory_location_evidence_number_v2(m.ptrreviewed),0) old_review,
      coalesce(s.frozen_erp_on_hand_v3048,0) new_oh,
      coalesce(s.frozen_erp_review_v3048,0) new_review,
      case when oh.pending then greatest(0,coalesce(
        private.inventory_location_evidence_number_v2(oh.erp_baseline_value#>>'{}')-
        private.inventory_location_evidence_number_v2(oh.app_override_value#>>'{}'),0)) else 0 end pending_out,
      coalesce(m.loc_photo_match,private.inventory_location_evidence_number_v2(m.loc_match_qty),0) old_match,
      coalesce(m.photo_date,m.av_rule_photo_updated_at,m.date_completed) photo_date
    from mapped_stock s join public.ph_master_inventory m on m.unique_id=s.canonical_unique_id
    left join stock_overrides oh on oh.canonical_unique_id=m.unique_id and oh.field_name='ptronhand'
    left join stock_overrides rv on rv.canonical_unique_id=m.unique_id and rv.field_name='ptrreviewed'
  )
  select raw.*,case when (old_oh,old_review)=(new_oh,new_review) then 0::numeric
    else private.erp_order_delta_v23196(old_oh,old_review,new_oh,new_review,pending_out) end order_delta
  from raw;
end
$compiled$;
revoke all on function private.build_compiled_drive_order_delta_v3078() from public,anon,authenticated,service_role;

-- Extract the installed raw snapshot unchanged. Keep the old drop, canonical
-- import-run check, subsequent overlay mutations and completion receipt in
-- their original owner. Both readers produce the same temp relation contract.
do $wire$
declare owner_def text:=pg_get_functiondef('private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure);
  start_at integer:=strpos(owner_def,'  create temp table erp_order_delta_v23196 on commit drop as');
  suffix text:=' order_delta from raw;'; stop_at integer:=strpos(owner_def,suffix);
  raw_snapshot text;
begin
  if start_at=0 or stop_at<=start_at or cardinality(string_to_array(owner_def,suffix))<>2 then
    raise exception 'ERP_ORDER_DELTA_SNAPSHOT_OWNER_CHANGED';
  end if;
  raw_snapshot:=substring(owner_def from start_at for stop_at+length(suffix)-start_at);
  if strpos(raw_snapshot,'private.inventory_location_evidence_number_v2(s.raw_values->>''ptronhand'')')=0
    or strpos(raw_snapshot,'private.inventory_location_evidence_number_v2(s.raw_values->>''ptrreviewed'')')=0
    or strpos(raw_snapshot,'where map.candidate_count=1')=0 then raise exception 'ERP_ORDER_DELTA_RAW_STOCK_CHANGED'; end if;
  execute 'create function private.capture_drive_order_delta_v3078() returns void language plpgsql set search_path='''' as $capture$'||chr(10)||
    'begin'||chr(10)||'  if current_setting(''agdata.erp.prepared_drive'',true)=''on'' and private.has_drive_work_binding_v3078() then'||chr(10)||
    '    perform private.build_compiled_drive_order_delta_v3078();'||chr(10)||'    return;'||chr(10)||'  end if;'||chr(10)||
    raw_snapshot||chr(10)||'end'||chr(10)||'$capture$';
  execute overlay(owner_def placing '  perform private.capture_drive_order_delta_v3078();' from start_at for length(raw_snapshot));
end
$wire$;
revoke all on function private.capture_drive_order_delta_v3078() from public,anon,authenticated,service_role;
commit;
