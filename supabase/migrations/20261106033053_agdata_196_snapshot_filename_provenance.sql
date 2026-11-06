ALTER TABLE public.ph_master_inventory ADD COLUMN IF NOT EXISTS erp_source_filename text,ADD COLUMN IF NOT EXISTS erp_source_present boolean;
CREATE OR REPLACE FUNCTION public.bulk_import_master_snapshot_v1(p_run_id uuid, p_request_id uuid, p_rows jsonb, p_source_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '180s'
 SET lock_timeout TO '60s'
AS $function$
declare result_value jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='BULK_MASTER_IMPORT_FORBIDDEN'; end if;
  perform set_config('agdata.bulk_import.ph_master_inventory','on',true);
  begin
    result_value:=public.bulk_import_master_snapshot_v2374_base(p_run_id,p_request_id,p_rows,p_source_digest);

    if to_regclass('pg_temp.erp_order_delta_v23196') is not null then
      insert into private.inventory_order_reconciliation_v23196(run_id,canonical_unique_id,old_erp_on_hand,new_erp_on_hand,old_erp_ptrreview,new_erp_ptrreview,pending_reclass_out_qty,order_delta,old_loc_photo_match,new_loc_photo_match,photo_expired)
      select p_run_id,d.unique_id,d.old_oh,d.new_oh,d.old_review,d.new_review,d.pending_out,d.order_delta,d.old_match,greatest(0,d.old_match-d.order_delta),
        (d.old_match>0 and greatest(0,d.old_match-d.order_delta)=0) or d.photo_date<=clock_timestamp()-interval '10 days'
      from pg_temp.erp_order_delta_v23196 d on conflict do nothing;
      update app_sync_private.inventory_location_evidence_v1 e set current_photo_match_qty=a.new_loc_photo_match,
        loc_match_qty=a.new_loc_photo_match::text,initial_loc_photo_match=a.new_loc_photo_match,eval_baseline_available=private.inventory_location_evidence_number_v2(m.ptravailable),
        cleared_at=case when a.photo_expired then coalesce(e.cleared_at,clock_timestamp()) else e.cleared_at end,
        clear_reason=case when a.photo_expired then 'ERP_ORDER_OR_TEN_DAY_EXPIRY' else e.clear_reason end
      from private.inventory_order_reconciliation_v23196 a join public.ph_master_inventory m on m.unique_id=a.canonical_unique_id
      where a.run_id=p_run_id and e.source_unique_id=a.canonical_unique_id and e.cleared_at is null;
      update public.ph_master_inventory m set erp_on_hand=private.inventory_location_evidence_number_v2(s.raw_values->>'ptronhand'),erp_ptrreview=private.inventory_location_evidence_number_v2(s.raw_values->>'ptrreviewed'),erp_available=private.inventory_location_evidence_number_v2(s.raw_values->>'ptravailable'),filename=coalesce(s.raw_values->>'filename',m.filename),erp_source_filename=coalesce(s.raw_values->>'filename',m.filename),erp_source_present=true
      from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 map using(row_number) where m.unique_id=map.canonical_unique_id;
      update public.ph_master_inventory m set erp_source_filename=coalesce(m.erp_source_filename,m.filename),erp_source_present=false,
        filename=(select s.raw_values->>'filename' from pg_temp.ph_master_bulk_stage_v1 s limit 1)
      where not exists(select 1 from pg_temp.ph_master_bulk_map_v1 map where map.canonical_unique_id=m.unique_id)
        and m.filename is distinct from (select s.raw_values->>'filename' from pg_temp.ph_master_bulk_stage_v1 s limit 1);
      update public.ph_master_inventory m set loc_photo_match=a.new_loc_photo_match,loc_match_qty=a.new_loc_photo_match::text,
        initial_loc_photo_match=a.new_loc_photo_match,eval_baseline_available=private.inventory_location_evidence_number_v2(m.ptravailable),
        photo_link=case when a.photo_expired then null else m.photo_link end,photo_name=case when a.photo_expired then null else m.photo_name end,
        photo_url=case when a.photo_expired then null else m.photo_url end,photos=case when a.photo_expired then '[]'::jsonb else m.photos end,
        date_completed=case when a.photo_expired then null else m.date_completed end,
        eval_task_completed_at=case when a.photo_expired then null else m.eval_task_completed_at end
      from private.inventory_order_reconciliation_v23196 a where a.run_id=p_run_id and a.canonical_unique_id=m.unique_id
        and (a.old_loc_photo_match>0 or a.photo_expired);
    end if;


  exception when others then
    perform set_config('agdata.bulk_import.ph_master_inventory','off',true);
    raise;
  end;
  perform set_config('agdata.bulk_import.ph_master_inventory','off',true);
  perform private.normalize_soc_itemcode_from_pairs_v23104(p_rows);
  return result_value;
end
$function$
;
