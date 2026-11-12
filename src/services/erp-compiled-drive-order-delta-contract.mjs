export const erpCompiledDriveOrderDeltaMigration = '20261112060000_agdata3078_compiled_drive_order_delta.sql';

export function erpCompiledDriveOrderDeltaContract() {
  return `select exists(select 1 from pg_proc compiled
    join pg_proc capture on capture.oid=to_regprocedure('private.capture_drive_order_delta_v3078()')
    join pg_proc owner on owner.oid=to_regprocedure('private.apply_inventory_live_overrides_bulk_v1(uuid)')
    where compiled.oid=to_regprocedure('private.build_compiled_drive_order_delta_v3078()')
      and not compiled.prosecdef and not capture.prosecdef and owner.prosecdef
      and pg_get_userbyid(compiled.proowner)='postgres' and pg_get_userbyid(capture.proowner)='postgres'
      and 'enable_nestloop=off'=any(compiled.proconfig)
      and not has_function_privilege('anon',compiled.oid,'EXECUTE')
      and not has_function_privilege('authenticated',compiled.oid,'EXECUTE')
      and not has_function_privilege('service_role',compiled.oid,'EXECUTE')
      and not has_function_privilege('anon',capture.oid,'EXECUTE')
      and not has_function_privilege('authenticated',capture.oid,'EXECUTE')
      and not has_function_privilege('service_role',capture.oid,'EXECUTE')
      and position('perform private.capture_drive_order_delta_v3078();' in owner.prosrc)>0
      and position('create temp table erp_order_delta_v23196' in owner.prosrc)=0
      and position('agdata.erp.prepared_drive' in capture.prosrc)>0
      and position('private.has_drive_work_binding_v3078()' in capture.prosrc)>0
      and position('perform private.build_compiled_drive_order_delta_v3078();' in capture.prosrc)>0
      and position('private.inventory_location_evidence_number_v2(s.raw_values->>''ptronhand'')' in capture.prosrc)>0
      and position('private.inventory_location_evidence_number_v2(s.raw_values->>''ptrreviewed'')' in capture.prosrc)>0
      and position('mapped_stock as materialized' in compiled.prosrc)>0
      and position('stock_overrides as materialized' in compiled.prosrc)>0
      and position('raw as materialized' in compiled.prosrc)>0
      and position('where map.candidate_count=1' in compiled.prosrc)>0
      and position('coalesce(s.frozen_erp_on_hand_v3048,0) new_oh' in compiled.prosrc)>0
      and position('coalesce(s.frozen_erp_review_v3048,0) new_review' in compiled.prosrc)>0
      and position('s.raw_values' in compiled.prosrc)=0
      and position('case when (old_oh,old_review)=(new_oh,new_review) then 0::numeric' in compiled.prosrc)>0
      and position('private.erp_order_delta_v23196(old_oh,old_review,new_oh,new_review,pending_out)' in compiled.prosrc)>0
      and position('coalesce(m.photo_date,m.av_rule_photo_updated_at,m.date_completed) photo_date' in compiled.prosrc)>0
  ) as installed`;
}
