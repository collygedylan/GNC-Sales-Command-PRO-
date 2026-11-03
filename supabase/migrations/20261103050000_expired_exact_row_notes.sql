BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '15s';
CREATE OR REPLACE FUNCTION public.reconcile_inventory_location_evidence_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
declare
  affected integer:=0;
  evidence_updated integer:=0;
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
begin
  with resolved as (
    select e.itemcode_key,e.locationcode_key,e.source_unique_id,m.lotcode source_lotcode,
      private.inventory_location_evidence_number_v2(m.ptronhand) current_on_hand,
      coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),private.inventory_location_evidence_number_v2(m.ptronhand),0) current_available
    from app_sync_private.inventory_location_evidence_v1 e
    left join lateral (
      select m.* from public.ph_master_inventory m
      where m.unique_id=e.source_unique_id
      order by (m.unique_id=e.source_unique_id) desc,
        (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(e.source_lotcode,'')))) desc,
        m.last_updated desc nulls last,m.unique_id limit 1
    ) m on true
  ), calculated as (
    select e.itemcode_key,e.locationcode_key,r.source_unique_id,r.source_lotcode,
      coalesce(private.live_loc_photo_match_v23142(r.current_available,coalesce(e.eval_baseline_available,greatest(r.current_on_hand,r.current_available)),coalesce(e.initial_loc_photo_match,e.initial_photo_match_qty,round(greatest(r.current_on_hand,r.current_available)*coalesce(private.inventory_location_evidence_number_v2(e.match),0)/100))),e.current_photo_match_qty) current_photo_match_qty,
      e.cleared_at is not null
        or (e.initial_photo_match_qty is not null and coalesce(private.live_loc_photo_match_v23142(r.current_available,coalesce(e.eval_baseline_available,greatest(r.current_on_hand,r.current_available)),coalesce(e.initial_loc_photo_match,e.initial_photo_match_qty,round(greatest(r.current_on_hand,r.current_available)*coalesce(private.inventory_location_evidence_number_v2(e.match),0)/100))),e.current_photo_match_qty,0)<=0)
        or (e.expires_at is not null and clock_timestamp()>e.expires_at) must_clear,
      case when e.clear_reason is not null then e.clear_reason
        when e.expires_at is not null and clock_timestamp()>e.expires_at then 'expired'
        when e.initial_photo_match_qty is not null and coalesce(private.live_loc_photo_match_v23142(r.current_available,coalesce(e.eval_baseline_available,greatest(r.current_on_hand,r.current_available)),coalesce(e.initial_loc_photo_match,e.initial_photo_match_qty,round(greatest(r.current_on_hand,r.current_available)*coalesce(private.inventory_location_evidence_number_v2(e.match),0)/100))),e.current_photo_match_qty,0)<=0 then 'depleted' end clear_reason
    from app_sync_private.inventory_location_evidence_v1 e
    join resolved r using(source_unique_id)
  )
  update app_sync_private.inventory_location_evidence_v1 e set
    source_unique_id=coalesce(c.source_unique_id,e.source_unique_id),
    source_lotcode=coalesce(c.source_lotcode,e.source_lotcode),
    current_photo_match_qty=c.current_photo_match_qty,
    loc_match_qty=case when c.must_clear then null else c.current_photo_match_qty::text end,
    spec=case when c.must_clear then null else e.spec end,
    match=case when c.must_clear then null else e.match end,
    av_note=case when c.must_clear then null else e.av_note end,
    pic_note=case when c.must_clear then null else e.pic_note end,
    sales_note=case when c.must_clear then null else e.sales_note end,
    photo_link=case when c.must_clear then null else e.photo_link end,
    photo_name=case when c.must_clear then null else e.photo_name end,
    date_completed=case when c.must_clear then null else e.date_completed end,
    cleared_at=case when c.must_clear then coalesce(e.cleared_at,clock_timestamp()) else null end,
    clear_reason=case when c.must_clear then c.clear_reason else null end,
    updated_at=clock_timestamp()
  from calculated c
  where e.source_unique_id=c.source_unique_id
    and (e.source_unique_id,e.source_lotcode,e.current_photo_match_qty,e.loc_match_qty,e.spec,e.match,
      e.av_note,e.pic_note,e.sales_note,e.photo_link,e.photo_name,e.date_completed,e.cleared_at,e.clear_reason)
      is distinct from
      (coalesce(c.source_unique_id,e.source_unique_id),coalesce(c.source_lotcode,e.source_lotcode),
      c.current_photo_match_qty,case when c.must_clear then null else c.current_photo_match_qty::text end,
      case when c.must_clear then null else e.spec end,case when c.must_clear then null else e.match end,
      case when c.must_clear then null else e.av_note end,case when c.must_clear then null else e.pic_note end,
      case when c.must_clear then null else e.sales_note end,case when c.must_clear then null else e.photo_link end,
      case when c.must_clear then null else e.photo_name end,case when c.must_clear then null else e.date_completed end,
      case when c.must_clear then coalesce(e.cleared_at,clock_timestamp()) else null end,
      case when c.must_clear then c.clear_reason else null end);
  get diagnostics evidence_updated=row_count;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  with desired as (
    select m.unique_id,e.spec,e.caliper,e.match,e.initial_ptr,e.av_note,e.pic_note,e.sales_note,
      e.photo_link,e.photo_name,e.date_completed,e.app_tab_assignment,e.updated_at,e.eval_baseline_available,e.initial_loc_photo_match,
      case when e.cleared_at is not null then null
        when m.unique_id=e.source_unique_id
          or upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(e.source_lotcode,'')))
          then e.current_photo_match_qty::text
        else private.inventory_location_match_qty_v1(m.ptronhand,e.match,e.loc_match_qty) end loc_match_qty
    from public.ph_master_inventory m
    join app_sync_private.inventory_location_evidence_v1 e
      on e.source_unique_id=m.unique_id
  )
  update public.ph_master_inventory m set
    eval_baseline_available=d.eval_baseline_available,initial_loc_photo_match=d.initial_loc_photo_match,loc_photo_match=private.inventory_location_evidence_number_v2(d.loc_match_qty),
    spec=d.spec,caliper=d.caliper,match=d.match,loc_match_qty=d.loc_match_qty,
    initial_ptr=d.initial_ptr,av_note=d.av_note,pic_note=d.pic_note,sales_note=d.sales_note,
    photo_link=d.photo_link,photo_name=d.photo_name,date_completed=d.date_completed,
    photo_url=case when d.photo_link is null then null else m.photo_url end, photos=case when d.photo_link is null then '[]'::jsonb else m.photos end,
    app_tab_assignment=d.app_tab_assignment,last_updated=greatest(m.last_updated,d.updated_at)
  from desired d
  where m.unique_id=d.unique_id
    and (m.eval_baseline_available,m.initial_loc_photo_match,m.loc_photo_match,m.spec,m.caliper,m.match,m.loc_match_qty,m.initial_ptr,m.av_note,m.pic_note,m.sales_note,
      m.photo_link,m.photo_name,m.date_completed,m.app_tab_assignment) is distinct from
      (d.eval_baseline_available,d.initial_loc_photo_match,private.inventory_location_evidence_number_v2(d.loc_match_qty),d.spec,d.caliper,d.match,d.loc_match_qty,d.initial_ptr,d.av_note,d.pic_note,d.sales_note,
      d.photo_link,d.photo_name,d.date_completed,d.app_tab_assignment);
  get diagnostics affected=row_count;
  -- Clear the exact location-note mirror only while the durable row is retired.
  -- A newer note and Dock-owned evidence have separate lifecycles.
  update public.ph_location_sales_notes n
  set photo_link=null, photo_name=null, completed_at=null, spec=null, caliper=null,
      loc_match_pct=null, av_note=null, pick_note=null, sales_note=null,
      eval_baseline_available=null, initial_loc_photo_match=null
  from app_sync_private.inventory_location_evidence_v1 e
  where n.unique_id=e.source_unique_id and e.clear_reason in ('expired','depleted')
    and e.cleared_at is not null and (n.updated_at is null or n.updated_at<=e.cleared_at)
    and lower(coalesce(n.source,'')) not in ('dock','docks','ph_dock_assignments')
    and coalesce(n.photo_link,n.photo_name,n.completed_at::text,n.spec,n.caliper,n.loc_match_pct::text,
                 n.av_note,n.pick_note,n.sales_note,n.eval_baseline_available::text,n.initial_loc_photo_match::text) is not null;

  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return jsonb_build_object('ok',true,'affected',affected,'evidenceUpdated',evidence_updated,
    'cleared',(select count(*) from app_sync_private.inventory_location_evidence_v1 where cleared_at is not null));
end
$function$;
COMMIT;
