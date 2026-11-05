-- Test-only: fresh authorized exact-row notes survive zero/expired photo-match cleanup.
BEGIN;
CREATE OR REPLACE FUNCTION test_private.apply_inventory_location_evidence_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  evidence test_app_sync_private.inventory_location_evidence_v1%rowtype;
  evidence_changed boolean:=false;
  source_row boolean:=false;
  current_qty numeric;
  active_evidence boolean:=false;
  guard_enabled boolean:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'')='on';
begin
  if tg_table_schema='public' and tg_table_name in ('test_ph_master_inventory','test_ph_drive_around_report_rows')
     and coalesce(auth.role(),'')='service_role'
     and current_setting('agdata.bulk_import.'||tg_table_name,true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if nullif(btrim(coalesce(new.itemcode,'')),'') is null
    or nullif(btrim(coalesce(new.locationcode,'')),'') is null then return new; end if;
  if tg_op='UPDATE' and not guard_enabled then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if test_private.ph_master_inventory_import_run_v1() is null and evidence_changed then return new; end if;
  end if;
  select * into evidence from test_app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=new.unique_id;
  if not found then return new; end if;
  source_row:=new.unique_id=evidence.source_unique_id;
  current_qty:=evidence.current_photo_match_qty;
  if source_row then
    current_qty:=test_private.live_loc_photo_match_v23142(
      coalesce(test_private.inventory_location_evidence_number_v2(new.ptravailable),test_private.inventory_location_evidence_number_v2(new.ptronhand),0),
      coalesce(evidence.eval_baseline_available,greatest(coalesce(test_private.inventory_location_evidence_number_v2(new.ptronhand),0),coalesce(test_private.inventory_location_evidence_number_v2(new.ptravailable),0))),
      coalesce(evidence.initial_loc_photo_match,evidence.initial_photo_match_qty,round(greatest(coalesce(test_private.inventory_location_evidence_number_v2(new.ptronhand),0),coalesce(test_private.inventory_location_evidence_number_v2(new.ptravailable),0))*coalesce(test_private.inventory_location_evidence_number_v2(evidence.match),0)/100)));
  end if;
  active_evidence:=evidence.cleared_at is null
    and (evidence.expires_at is null or clock_timestamp()<=evidence.expires_at)
    and (evidence.initial_photo_match_qty is null or evidence.initial_photo_match_qty<=0 or coalesce(current_qty,0)>0);
  new.spec:=case when active_evidence then evidence.spec else null end;
  new.caliper:=evidence.caliper;
  new.match:=case when active_evidence then evidence.match else null end;
  new.loc_match_qty:=case when not active_evidence then null when source_row then current_qty::text
    else test_private.inventory_location_match_qty_v1(new.ptronhand,evidence.match,evidence.loc_match_qty) end;
  new.eval_baseline_available:=evidence.eval_baseline_available;
  new.initial_loc_photo_match:=evidence.initial_loc_photo_match;
  new.loc_photo_match:=case when active_evidence then current_qty else null end;
  new.initial_ptr:=evidence.initial_ptr;
  new.av_note:=case when active_evidence or (guard_enabled and new.unique_id=evidence.source_unique_id and evidence.updated_at>=transaction_timestamp()) then evidence.av_note else null end;
  new.pic_note:=case when active_evidence then evidence.pic_note else null end;
  new.sales_note:=case when active_evidence then evidence.sales_note else null end;
  new.photo_link:=case when active_evidence then evidence.photo_link else null end;
  new.photo_name:=case when active_evidence then evidence.photo_name else null end;
  new.date_completed:=case when active_evidence then evidence.date_completed else null end;
  new.app_tab_assignment:=evidence.app_tab_assignment;
  return new;
end
$function$;
CREATE OR REPLACE FUNCTION test_private.sync_master_inventory_canonical_v2362()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare evidence test_app_sync_private.inventory_location_evidence_v1%rowtype;
declare current_on_hand numeric;
declare canonical_baseline numeric;
declare canonical_match numeric;
declare canonical_initial numeric;
declare canonical_current numeric;
declare canonical_photo_date timestamptz;
declare canonical_expiry timestamptz;
declare canonical_photo_url text;
declare active_evidence boolean;
declare evidence_changed boolean:=false;
declare guard_enabled boolean:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'')='on';
begin
  if tg_table_schema='public' and tg_table_name in ('test_ph_master_inventory','test_ph_drive_around_report_rows')
     and coalesce(auth.role(),'')='service_role'
     and current_setting('agdata.bulk_import.'||tg_table_name,true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='UPDATE' and not guard_enabled
      and test_private.ph_master_inventory_import_run_v1() is null then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if evidence_changed then return new; end if;
  end if;
  select * into evidence from test_app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=new.unique_id;
  current_on_hand:=test_private.request_numeric_v2362(new.ptronhand);
  canonical_baseline:=coalesce(evidence.baseline_on_hand,new.baseline_on_hand,
    test_private.request_numeric_v2362(new.initial_ptr),current_on_hand);
  canonical_match:=coalesce(evidence.loc_match_pct,new.loc_match_pct,
    test_private.request_numeric_v2362(new.match));
  canonical_initial:=coalesce(evidence.initial_photo_match_qty,new.initial_photo_match_qty,
    case when canonical_baseline is not null and canonical_match between 0 and 100
      then round(canonical_baseline*canonical_match/100.0) end);
  canonical_current:=case
    when new.unique_id=evidence.source_unique_id
      or upper(btrim(coalesce(new.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')))
      then coalesce(test_private.inventory_location_evidence_qty_v2(
        canonical_baseline,canonical_initial,current_on_hand),evidence.current_photo_match_qty,
        new.loc_photo_match,test_private.request_numeric_v2362(new.loc_match_qty))
    else coalesce(evidence.current_photo_match_qty,new.loc_photo_match,
        test_private.request_numeric_v2362(new.loc_match_qty),
        test_private.inventory_location_evidence_qty_v2(canonical_baseline,canonical_initial,current_on_hand))
  end;
  -- v2379_non_source_evidence_qty
  canonical_photo_date:=coalesce(evidence.evaluated_at,new.photo_date,new.date_completed,
    new.av_rule_photo_updated_at,new.av_rule_bundle_updated_at);
  canonical_expiry:=coalesce(evidence.expires_at,new.photo_expires_at,
    test_private.inventory_location_evidence_expiry_v2(canonical_photo_date));
  canonical_photo_url:=coalesce(nullif(btrim(coalesce(new.photo_url,'')),''),
    nullif(btrim(coalesce(evidence.photo_link,'')),''),nullif(btrim(coalesce(new.photo_link,'')),''));
  active_evidence:=evidence.cleared_at is null
    and coalesce(canonical_current,0)>0
    and (canonical_expiry is null or clock_timestamp()<=canonical_expiry)
    and coalesce(canonical_photo_url,nullif(btrim(coalesce(new.spec,'')),''),
      nullif(btrim(coalesce(evidence.spec,'')),''),nullif(btrim(coalesce(new.caliper,'')),''),
      nullif(btrim(coalesce(evidence.caliper,'')),''),nullif(btrim(coalesce(new.match,'')),''),
      nullif(btrim(coalesce(evidence.match,'')),''),nullif(btrim(coalesce(new.av_note,'')),''),
      nullif(btrim(coalesce(evidence.av_note,'')),''),nullif(btrim(coalesce(new.pic_note,'')),''),
      nullif(btrim(coalesce(evidence.pic_note,'')),''),nullif(btrim(coalesce(new.sales_note,'')),''),
      nullif(btrim(coalesce(evidence.sales_note,'')),'')) is not null;
  new.baseline_on_hand:=canonical_baseline;
  new.loc_match_pct:=canonical_match;
  new.initial_photo_match_qty:=canonical_initial;
  new.photo_expires_at:=canonical_expiry;
  if active_evidence then
    new.loc_photo_match:=canonical_current;
    new.photo_url:=canonical_photo_url;
    new.photo_date:=canonical_photo_date;
    new.photos:=test_private.request_photo_array_v2362(new.photos,canonical_photo_url,
      coalesce(evidence.photo_name,new.photo_name));
    new.pick_note:=coalesce(nullif(new.pick_note,''),nullif(evidence.pic_note,''),nullif(new.pic_note,''));
    new.spec:=coalesce(nullif(new.spec,''),nullif(evidence.spec,''));
    new.caliper:=coalesce(nullif(new.caliper,''),nullif(evidence.caliper,''));
    new.av_note:=coalesce(nullif(new.av_note,''),nullif(evidence.av_note,''));
    new.sales_note:=coalesce(nullif(new.sales_note,''),nullif(evidence.sales_note,''));
  else
    new.photos:='[]'::jsonb;
    new.photo_url:=null;
    new.photo_date:=case
      when nullif(btrim(concat_ws(',',new.photo_link,new.dock_photo_link,new.flyer_photo_link)),'') is not null
      then coalesce(canonical_photo_date,new.date_completed,new.last_updated)
      else null
    end;
    new.spec:=null;
    new.caliper:=null;
    new.loc_match_pct:=null;
    new.baseline_on_hand:=null;
    new.initial_photo_match_qty:=null;
    new.loc_photo_match:=null;
    new.pick_note:=null;
    new.av_note:=case when guard_enabled and new.unique_id=evidence.source_unique_id and evidence.updated_at>=transaction_timestamp() then evidence.av_note else null end;
    new.sales_note:=null;
    new.photo_expires_at:=null;
  end if;
  return new;
end
$function$;
COMMIT;
