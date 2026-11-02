BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
-- Available baseline is app-owned, exact-row evidence. No historical backfill or operational row writes.
ALTER TABLE public.ph_master_inventory ADD COLUMN IF NOT EXISTS eval_baseline_available numeric, ADD COLUMN IF NOT EXISTS initial_loc_photo_match numeric;
ALTER TABLE public.ph_location_sales_notes ADD COLUMN IF NOT EXISTS eval_baseline_available numeric, ADD COLUMN IF NOT EXISTS initial_loc_photo_match numeric, ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE app_sync_private.inventory_location_evidence_v1 ADD COLUMN IF NOT EXISTS eval_baseline_available numeric, ADD COLUMN IF NOT EXISTS initial_loc_photo_match numeric;
CREATE OR REPLACE FUNCTION private.live_loc_photo_match_v23142(current_available numeric,baseline_available numeric,initial_match numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT greatest(0,least(greatest(0,current_available),initial_match-greatest(0,baseline_available-greatest(0,current_available))))
$$;
REVOKE ALL ON FUNCTION private.live_loc_photo_match_v23142(numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.save_drive_evidence_v3(p_master_uid text, p_expected_itemcode text, p_expected_locationcode text, p_expected_lotcode text, p_expected_signature text, p_baseline jsonb, p_evidence jsonb, p_complete boolean, p_workflow text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles%rowtype;
  current_row public.ph_master_inventory%rowtype;
  saved_row public.ph_master_inventory%rowtype;
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  prior private.drive_evidence_idempotency%rowtype;
  payload jsonb:=coalesce(p_evidence,'{}'::jsonb);
  unexpected text[];
  stable_item text:=upper(btrim(coalesce(p_expected_itemcode,'')));
  stable_location text:=upper(btrim(coalesce(p_expected_locationcode,'')));
  workflow text:=lower(btrim(coalesce(p_workflow,'')));
  saved_at timestamptz:=clock_timestamp();
  request_hash text;
  storage_key text:='location-v3-'||md5(coalesce(p_idempotency_key,''));
  response jsonb;
  request_rows jsonb:='[]'::jsonb;
  location_rows jsonb:='[]'::jsonb;
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
begin
  actor:=private.require_drive_live_change_profile_v2392(p_master_uid,p_expected_itemcode,p_expected_locationcode,p_expected_lotcode);
  if stable_item='' or stable_location='' then raise exception using errcode='22023',message='INVALID_MASTER_IDENTITY'; end if;
  if char_length(btrim(coalesce(p_idempotency_key,''))) not between 12 and 180 then raise exception using errcode='22023',message='INVALID_IDEMPOTENCY_KEY'; end if;
  if workflow not in ('season','location','notes') then raise exception using errcode='22023',message='INVALID_DRIVE_WORKFLOW'; end if;
  if jsonb_typeof(payload)<>'object' or jsonb_typeof(coalesce(p_baseline,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='INVALID_EVIDENCE_PAYLOAD'; end if;
  select array_agg(key order by key) into unexpected from jsonb_object_keys(payload) keys(key)
  where key not in ('spec','caliper','match','loc_match_qty','initial_ptr','av_note','pick_note','comments','photo_link','photo_name');
  if coalesce(cardinality(unexpected),0)>0 then raise exception using errcode='22023',message='UNSUPPORTED_DRIVE_EVIDENCE_FIELD'; end if;
  if octet_length(payload::text)>65536 or octet_length(coalesce(p_baseline,'{}'::jsonb)::text)>65536 then raise exception using errcode='22023',message='DRIVE_EVIDENCE_PAYLOAD_TOO_LARGE'; end if;
  if payload?'match' and nullif(btrim(payload->>'match'),'') is not null
    and payload->>'match' !~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then raise exception using errcode='22023',message='INVALID_LOC_MATCH_PERCENT'; end if;
  if payload?'photo_link' and octet_length(coalesce(payload->>'photo_link',''))>16000 then raise exception using errcode='22023',message='PHOTO_REFERENCE_TOO_LARGE'; end if;
  request_hash:=md5(concat_ws('|',stable_item,stable_location,payload::text,coalesce(p_complete,false)::text,workflow));
  select * into prior from private.drive_evidence_idempotency
  where profile_id=actor.id and idempotency_key=storage_key;
  if found then
    if prior.request_hash<>request_hash then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT','canonicalConfirmed',false,'retryBlocked',true); end if;
    return jsonb_set(prior.response_payload,'{recovered}','true'::jsonb,true);
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('drive-location-idempotency:'||actor.id::text||':'||storage_key,0))
    or not pg_try_advisory_xact_lock(hashtextextended('drive-row:'||p_master_uid,0)) then
    return jsonb_build_object('ok',false,'code','DRIVE_SAVE_BUSY','canonicalConfirmed',false,'retryAfterMs',250,'retryBlocked',false);
  end if;
  select * into current_row from public.ph_master_inventory m
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if not found then return jsonb_build_object('ok',false,'code','DRIVE_ROW_NOT_FOUND','canonicalConfirmed',true,'retryBlocked',false); end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=btrim(p_master_uid);
  if not found then
    evidence.itemcode_key:=stable_item;evidence.locationcode_key:=stable_location;
    evidence.itemcode:=current_row.itemcode;evidence.locationcode:=current_row.locationcode;
    evidence.spec:=current_row.spec;evidence.caliper:=current_row.caliper;evidence.match:=current_row.match;
    evidence.loc_match_qty:=current_row.loc_match_qty;evidence.initial_ptr:=current_row.initial_ptr;
    evidence.av_note:=current_row.av_note;evidence.pic_note:=current_row.pic_note;evidence.sales_note:=current_row.sales_note;
    evidence.photo_link:=current_row.photo_link;evidence.photo_name:=current_row.photo_name;
    evidence.date_completed:=current_row.date_completed;evidence.app_tab_assignment:=current_row.app_tab_assignment;
  end if;
  if payload?'spec' then evidence.spec:=nullif(btrim(payload->>'spec'),''); end if;
  if payload?'caliper' then evidence.caliper:=nullif(btrim(payload->>'caliper'),''); end if;
  if payload?'match' then evidence.match:=nullif(btrim(payload->>'match'),''); end if;
  if payload?'loc_match_qty' then evidence.loc_match_qty:=nullif(btrim(payload->>'loc_match_qty'),''); end if;
  if payload?'initial_ptr' then evidence.initial_ptr:=nullif(btrim(payload->>'initial_ptr'),''); end if;
  if payload?'av_note' then evidence.av_note:=nullif(btrim(payload->>'av_note'),''); end if;
  if payload?'pick_note' then evidence.pic_note:=nullif(btrim(payload->>'pick_note'),''); end if;
  if payload?'comments' then evidence.sales_note:=nullif(payload->>'comments',''); end if;
  if payload?'photo_link' then evidence.photo_link:=nullif(btrim(payload->>'photo_link'),''); end if;
  if payload?'photo_name' then evidence.photo_name:=nullif(btrim(payload->>'photo_name'),''); end if;
  if coalesce(p_complete,false) then
    evidence.date_completed:=saved_at;evidence.app_tab_assignment:=workflow;
    evidence.eval_baseline_available:=greatest(0,coalesce(private.inventory_location_evidence_number_v2(current_row.ptravailable),private.inventory_location_evidence_number_v2(current_row.ptronhand),0));
    evidence.initial_loc_photo_match:=round(evidence.eval_baseline_available*coalesce(private.inventory_location_evidence_number_v2(evidence.match),0)/100);
  end if;
  evidence.source_unique_id:=current_row.unique_id;evidence.updated_at:=saved_at;evidence.updated_by:=lower(btrim(actor.username));
  insert into app_sync_private.inventory_location_evidence_v1 select (evidence).*
  on conflict(source_unique_id) do update set
    itemcode=excluded.itemcode,locationcode=excluded.locationcode,source_unique_id=excluded.source_unique_id,
    eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match,
    spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,
    initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,
    photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,
    app_tab_assignment=excluded.app_tab_assignment,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  perform set_config('gnc.inventory_edit_actor',lower(btrim(actor.username)),true);
  update public.ph_master_inventory m set
    spec=evidence.spec,caliper=evidence.caliper,match=evidence.match,
    eval_baseline_available=evidence.eval_baseline_available,initial_loc_photo_match=evidence.initial_loc_photo_match,
    loc_match_qty=(private.live_loc_photo_match_v23142(coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),private.inventory_location_evidence_number_v2(m.ptronhand),0),coalesce(evidence.eval_baseline_available,greatest(coalesce(private.inventory_location_evidence_number_v2(m.ptronhand),0),coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),0))),coalesce(evidence.initial_loc_photo_match,round(greatest(coalesce(private.inventory_location_evidence_number_v2(m.ptronhand),0),coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),0))*coalesce(private.inventory_location_evidence_number_v2(evidence.match),0)/100))))::text,
    loc_match_pct=private.reclass_numeric_v1(evidence.match),
    loc_photo_match=private.live_loc_photo_match_v23142(coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),private.inventory_location_evidence_number_v2(m.ptronhand),0),coalesce(evidence.eval_baseline_available,greatest(coalesce(private.inventory_location_evidence_number_v2(m.ptronhand),0),coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),0))),coalesce(evidence.initial_loc_photo_match,round(greatest(coalesce(private.inventory_location_evidence_number_v2(m.ptronhand),0),coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),0))*coalesce(private.inventory_location_evidence_number_v2(evidence.match),0)/100))),
    pick_note=evidence.pic_note,
    initial_ptr=evidence.initial_ptr,av_note=evidence.av_note,pic_note=evidence.pic_note,sales_note=evidence.sales_note,
    photo_link=evidence.photo_link,photo_name=evidence.photo_name,date_completed=evidence.date_completed,
    photo_url=CASE WHEN payload?'photo_link' THEN nullif(split_part(coalesce(evidence.photo_link,''),',',1),'') ELSE m.photo_url END,
    photos=CASE WHEN payload?'photo_link' THEN coalesce(to_jsonb(string_to_array(nullif(evidence.photo_link,''),',')),'[]'::jsonb) ELSE m.photos END,
    -- v23119-typed-photo-date: timestamps stay typed; the UI formats MM/DD/YY.
    photo_date=CASE WHEN payload?'photo_link' THEN CASE WHEN nullif(evidence.photo_link,'') IS NULL THEN NULL ELSE saved_at END ELSE m.photo_date END,
    app_tab_assignment=evidence.app_tab_assignment,
    av_rule_spec_updated_at=case when payload?'spec' then saved_at else m.av_rule_spec_updated_at end,
    av_rule_caliper_updated_at=case when payload?'caliper' then saved_at else m.av_rule_caliper_updated_at end,
    av_rule_match_updated_at=case when payload?'match' then saved_at else m.av_rule_match_updated_at end,
    av_rule_av_note_updated_at=case when payload?'av_note' then saved_at else m.av_rule_av_note_updated_at end,
    av_rule_photo_updated_at=case when payload?'photo_link' or payload?'photo_name' then saved_at else m.av_rule_photo_updated_at end,
    av_rule_bundle_updated_at=case when payload<>'{}'::jsonb then saved_at else m.av_rule_bundle_updated_at end,
    last_updated=saved_at
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  select * into saved_row from public.ph_master_inventory m
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  select coalesce(jsonb_agg(to_jsonb(m) order by private.eval_work_natural_sort_key_v1(m.locationcode),private.eval_work_natural_sort_key_v1(m.lotcode),m.unique_id),'[]'::jsonb)
    into location_rows from public.ph_master_inventory m
    where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;

  insert into public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,updated_by,updated_at,eval_baseline_available,initial_loc_photo_match,completed_at)
  values(saved_row.unique_id,coalesce(saved_row.source,''),saved_row.itemcode,saved_row.locationcode,coalesce(saved_row.lotcode,''),saved_row.photo_link,saved_row.photo_name,saved_row.spec,saved_row.caliper,saved_row.loc_match_pct,saved_row.av_note,saved_row.pick_note,saved_row.sales_note,actor.id,clock_timestamp(),saved_row.eval_baseline_available,saved_row.initial_loc_photo_match,saved_row.date_completed)
  on conflict(unique_id) do update set source=excluded.source,itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode,photo_link=excluded.photo_link,photo_name=excluded.photo_name,spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_by=excluded.updated_by,updated_at=excluded.updated_at,eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match,completed_at=excluded.completed_at;
  with changed as (
    update public.ph_requests_pending request set
      req_spec=evidence.spec,req_caliper=evidence.caliper,
      req_match=case when evidence.match ~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then evidence.match::numeric else null end,
      req_pic_note=evidence.pic_note,req_sales_note=evidence.sales_note,req_comments=evidence.sales_note,
      av_note=evidence.av_note,req_photo_link=evidence.photo_link,req_photo_name=evidence.photo_name,
      req_status=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then 'Complete' else request.req_status end,
      date_completed=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then saved_at::text else request.date_completed end,
      completed_by_username=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then lower(btrim(actor.username)) else request.completed_by_username end,
      completed_by_display=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then coalesce(nullif(btrim(actor.display_name),''),actor.username) else request.completed_by_display end,
      app_tab_assignment=evidence.app_tab_assignment,master_app_tab_assignment=evidence.app_tab_assignment,
      row_version=coalesce(request.row_version,0)+1,updated_at=saved_at
    where upper(btrim(coalesce(request.itemcode,'')))=stable_item
      and upper(btrim(coalesce(request.locationcode,'')))=stable_location
      and request.master_id=saved_row.unique_id
      and coalesce(request.req_archived,false)=false
      and lower(btrim(coalesce(request.req_status,'pending'))) not in ('complete','completed','done','archived','cancelled','canceled')
    returning request.*
  ) select coalesce(jsonb_agg(to_jsonb(changed) order by changed.unique_id),'[]'::jsonb) into request_rows from changed;
  response:=jsonb_build_object('ok',true,'code','SAVED','contractVersion','save-drive-evidence-v3-row-isolation',
    'row',to_jsonb(saved_row),'locationRows',location_rows,'requestRows',request_rows,'completed',coalesce(p_complete,false),
    'canonicalConfirmed',true,'mergedUnrelatedChanges',true,'retryBlocked',false,'recovered',false);
  insert into private.drive_evidence_idempotency(profile_id,idempotency_key,request_hash,response_payload,outcome_code)
  values(actor.id,storage_key,request_hash,response,'SAVED');
  return response;
end
$function$
;
CREATE OR REPLACE FUNCTION private.apply_inventory_location_evidence_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  evidence_changed boolean:=false;
  source_row boolean:=false;
  current_qty numeric;
  active_evidence boolean:=false;
  guard_enabled boolean:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'')='on';
begin
  if tg_table_schema='public' and tg_table_name in ('ph_master_inventory','ph_drive_around_report_rows')
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
    if private.ph_master_inventory_import_run_v1() is null and evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=new.unique_id;
  if not found then return new; end if;
  source_row:=new.unique_id=evidence.source_unique_id;
  current_qty:=evidence.current_photo_match_qty;
  if source_row then
    current_qty:=private.live_loc_photo_match_v23142(
      coalesce(private.inventory_location_evidence_number_v2(new.ptravailable),private.inventory_location_evidence_number_v2(new.ptronhand),0),
      coalesce(evidence.eval_baseline_available,greatest(coalesce(private.inventory_location_evidence_number_v2(new.ptronhand),0),coalesce(private.inventory_location_evidence_number_v2(new.ptravailable),0))),
      coalesce(evidence.initial_loc_photo_match,evidence.initial_photo_match_qty,round(greatest(coalesce(private.inventory_location_evidence_number_v2(new.ptronhand),0),coalesce(private.inventory_location_evidence_number_v2(new.ptravailable),0))*coalesce(private.inventory_location_evidence_number_v2(evidence.match),0)/100)));
  end if;
  active_evidence:=evidence.cleared_at is null
    and (evidence.expires_at is null or clock_timestamp()<=evidence.expires_at)
    and (evidence.initial_photo_match_qty is null or evidence.initial_photo_match_qty<=0 or coalesce(current_qty,0)>0);
  new.spec:=case when active_evidence then evidence.spec else null end;
  new.caliper:=evidence.caliper;
  new.match:=case when active_evidence then evidence.match else null end;
  new.loc_match_qty:=case when not active_evidence then null when source_row then current_qty::text
    else private.inventory_location_match_qty_v1(new.ptronhand,evidence.match,evidence.loc_match_qty) end;
  new.eval_baseline_available:=evidence.eval_baseline_available;
  new.initial_loc_photo_match:=evidence.initial_loc_photo_match;
  new.loc_photo_match:=case when active_evidence then current_qty else null end;
  new.initial_ptr:=evidence.initial_ptr;
  new.av_note:=case when active_evidence then evidence.av_note else null end;
  new.pic_note:=case when active_evidence then evidence.pic_note else null end;
  new.sales_note:=case when active_evidence then evidence.sales_note else null end;
  new.photo_link:=case when active_evidence then evidence.photo_link else null end;
  new.photo_name:=case when active_evidence then evidence.photo_name else null end;
  new.date_completed:=case when active_evidence then evidence.date_completed else null end;
  new.app_tab_assignment:=evidence.app_tab_assignment;
  return new;
end
$function$
;
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
        or (e.initial_photo_match_qty>0 and coalesce(private.live_loc_photo_match_v23142(r.current_available,coalesce(e.eval_baseline_available,greatest(r.current_on_hand,r.current_available)),coalesce(e.initial_loc_photo_match,e.initial_photo_match_qty,round(greatest(r.current_on_hand,r.current_available)*coalesce(private.inventory_location_evidence_number_v2(e.match),0)/100))),e.current_photo_match_qty,0)<=0)
        or (e.expires_at is not null and clock_timestamp()>e.expires_at) must_clear,
      case when e.clear_reason is not null then e.clear_reason
        when e.expires_at is not null and clock_timestamp()>e.expires_at then 'expired'
        when e.initial_photo_match_qty>0 and coalesce(private.live_loc_photo_match_v23142(r.current_available,coalesce(e.eval_baseline_available,greatest(r.current_on_hand,r.current_available)),coalesce(e.initial_loc_photo_match,e.initial_photo_match_qty,round(greatest(r.current_on_hand,r.current_available)*coalesce(private.inventory_location_evidence_number_v2(e.match),0)/100))),e.current_photo_match_qty,0)<=0 then 'depleted' end clear_reason
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
    app_tab_assignment=d.app_tab_assignment,last_updated=greatest(m.last_updated,d.updated_at)
  from desired d
  where m.unique_id=d.unique_id
    and (m.eval_baseline_available,m.initial_loc_photo_match,m.loc_photo_match,m.spec,m.caliper,m.match,m.loc_match_qty,m.initial_ptr,m.av_note,m.pic_note,m.sales_note,
      m.photo_link,m.photo_name,m.date_completed,m.app_tab_assignment) is distinct from
      (d.eval_baseline_available,d.initial_loc_photo_match,private.inventory_location_evidence_number_v2(d.loc_match_qty),d.spec,d.caliper,d.match,d.loc_match_qty,d.initial_ptr,d.av_note,d.pic_note,d.sales_note,
      d.photo_link,d.photo_name,d.date_completed,d.app_tab_assignment);
  get diagnostics affected=row_count;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return jsonb_build_object('ok',true,'affected',affected,'evidenceUpdated',evidence_updated,
    'cleared',(select count(*) from app_sync_private.inventory_location_evidence_v1 where cleared_at is not null));
end
$function$
;

CREATE OR REPLACE FUNCTION private.can_manage_eval_assignments()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT actor.id IS NOT NULL AND (private.is_full_app_administrator_v1(actor.username)
   OR lower(regexp_replace(actor.role,'[^a-zA-Z]','','g')) IN ('admin','administrator','manager','superadmin')
   OR EXISTS(SELECT 1 FROM public.user_access a WHERE a.profile_id=actor.id AND a.manage_tables='Y'))
 FROM private.current_active_profile() actor
$$;
-- Explicit release grants; future explicit Y/N edits remain authoritative.
UPDATE public.user_access a SET edit_any_row='Y',can_edit_all_rows='Y',revision=revision+1,updated_at=clock_timestamp()
WHERE (a.username IN ('dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','morgan_anderson','melissa_dowty') OR lower(regexp_replace(a.role,'[^a-zA-Z]','','g')) IN ('admin','administrator','manager','superadmin'))
 AND (a.edit_any_row,a.can_edit_all_rows) IS DISTINCT FROM ('Y','Y');
NOTIFY pgrst,'reload schema';
COMMIT;
