BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION private.normalize_inventory_location_evidence_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source_row public.ph_master_inventory%rowtype;
  current_on_hand numeric;
  evaluation_event boolean:=false;
  has_evidence boolean:=false;
begin
  has_evidence:=coalesce(new.spec,new.match,new.loc_match_qty,new.av_note,new.pic_note,
    new.sales_note,new.photo_link,new.photo_name,new.date_completed::text) is not null;
  select * into source_row from public.ph_master_inventory m
  where m.unique_id=new.source_unique_id
  order by (m.unique_id=new.source_unique_id) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(new.source_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if found then
    new.source_unique_id:=source_row.unique_id;
    new.source_lotcode:=source_row.lotcode;
    current_on_hand:=coalesce(private.inventory_location_evidence_number_v2(source_row.ptravailable),private.inventory_location_evidence_number_v2(source_row.ptronhand));
  end if;
  if tg_op='INSERT' then
    evaluation_event:=has_evidence;
  else
    evaluation_event:=has_evidence and (
      new.date_completed is distinct from old.date_completed
      or new.photo_link is distinct from old.photo_link
      or new.photo_name is distinct from old.photo_name
      or new.spec is distinct from old.spec
      or new.match is distinct from old.match
      or old.evaluated_at is null
    );
  end if;
  if evaluation_event then
    new.evaluated_at:=case
      when tg_op='UPDATE' and new.date_completed is distinct from old.date_completed
        and new.date_completed is not null then new.date_completed
      when tg_op='INSERT' and new.date_completed is not null then new.date_completed
      else clock_timestamp()
    end;
    -- v23144: only explicit Mark Done supplies date_completed; photos and drafts never complete.
    new.baseline_on_hand:=current_on_hand;
    new.loc_match_pct:=private.inventory_location_evidence_number_v2(new.match);
    new.initial_photo_match_qty:=case
      when new.baseline_on_hand is not null and new.loc_match_pct between 0 and 100
        then round(new.baseline_on_hand*new.loc_match_pct/100)
      else null
    end;
    new.current_photo_match_qty:=private.inventory_location_evidence_qty_v2(
      new.baseline_on_hand,new.initial_photo_match_qty,current_on_hand
    );
    new.loc_match_qty:=new.current_photo_match_qty::text;
    new.initial_ptr:=coalesce(new.baseline_on_hand::text,new.initial_ptr);
    new.expires_at:=private.inventory_location_evidence_expiry_v2(new.evaluated_at);
    new.cleared_at:=null;
    new.clear_reason:=null;
  elsif new.evaluated_at is not null then
    new.current_photo_match_qty:=coalesce(
      private.inventory_location_evidence_qty_v2(
        new.baseline_on_hand,new.initial_photo_match_qty,current_on_hand
      ),new.current_photo_match_qty
    );
    new.loc_match_qty:=new.current_photo_match_qty::text;
  end if;
  if new.cleared_at is not null
    or (new.initial_photo_match_qty is not null and coalesce(new.current_photo_match_qty,0)<=0)
    or (new.expires_at is not null and clock_timestamp()>new.expires_at) then
    new.spec:=null;new.match:=null;new.loc_match_qty:=null;new.av_note:=null;
    new.pic_note:=null;new.sales_note:=null;new.photo_link:=null;new.photo_name:=null;
    new.date_completed:=null;
    if new.cleared_at is null then new.cleared_at:=clock_timestamp(); end if;
    if new.clear_reason is null then
      new.clear_reason:=case when new.expires_at is not null and clock_timestamp()>new.expires_at
        then 'expired' else 'depleted' end;
    end if;
  end if;
  return new;
end
$function$
;

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
  if octet_length((payload-'photo_link'-'photo_name')::text)>65536 or octet_length((coalesce(p_baseline,'{}'::jsonb)-'photo_link'-'photo_name')::text)>65536 then raise exception using errcode='22023',message='DRIVE_EVIDENCE_PAYLOAD_TOO_LARGE'; end if;
  if payload?'match' and nullif(btrim(payload->>'match'),'') is not null
    and payload->>'match' !~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then raise exception using errcode='22023',message='INVALID_LOC_MATCH_PERCENT'; end if;
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
  if current_row.date_completed is not null then
    raise exception using errcode='42501',message='DRIVE_ROW_COMPLETED_UNLOCK_REQUIRED';
  end if;
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
  select * into evidence from app_sync_private.inventory_location_evidence_v1 where source_unique_id=p_master_uid;
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
    photo_url=CASE WHEN evidence.cleared_at IS NOT NULL THEN NULL WHEN payload?'photo_link' THEN nullif(split_part(coalesce(evidence.photo_link,''),',',1),'') ELSE m.photo_url END,
    photos=CASE WHEN evidence.cleared_at IS NOT NULL THEN '[]'::jsonb WHEN payload?'photo_link' THEN coalesce(to_jsonb(string_to_array(nullif(evidence.photo_link,''),',')),'[]'::jsonb) ELSE m.photos END,
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
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return jsonb_build_object('ok',true,'affected',affected,'evidenceUpdated',evidence_updated,
    'cleared',(select count(*) from app_sync_private.inventory_location_evidence_v1 where cleared_at is not null));
end
$function$
;

-- Explicit unlock repeats the exact-row gate and narrows it to owner/Admin, never edit-any-row alone.
CREATE OR REPLACE FUNCTION public.unlock_drive_evidence_v1(p_master_uid text,p_expected_signature text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; m public.ph_master_inventory; guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('drive-row:'||p_master_uid,0)) THEN RAISE EXCEPTION 'DRIVE_SAVE_BUSY' USING ERRCODE='40001'; END IF;
 SELECT * INTO m FROM public.ph_master_inventory WHERE unique_id=p_master_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DRIVE_ROW_NOT_FOUND' USING ERRCODE='22023'; END IF;
 actor:=private.require_drive_live_change_profile_v2392(m.unique_id,m.itemcode,m.locationcode,m.lotcode);
 IF NOT (lower(actor.username)='dylan_collyge' OR private.normalized_profile_role(actor.role) IN ('ADMIN','ADMINISTRATOR','MANAGER','SUPER_ADMIN','SUPER-ADMIN')
    OR private.inventory_row_assigned_to_actor_v2392(private.normalize_inventory_live_change_username_v2392(actor.username),m.unique_id,m.itemcode)) THEN
   RAISE EXCEPTION 'DRIVE_UNLOCK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF nullif(p_expected_signature,'') IS NOT NULL AND m.last_updated IS DISTINCT FROM p_expected_signature::timestamptz THEN RAISE EXCEPTION 'DRIVE_ROW_STALE' USING ERRCODE='40001'; END IF;
 PERFORM set_config('gnc.inventory_location_evidence_apply','on',true);
 UPDATE app_sync_private.inventory_location_evidence_v1 SET date_completed=NULL WHERE source_unique_id=m.unique_id;
 UPDATE public.ph_master_inventory SET date_completed=NULL,last_updated=clock_timestamp() WHERE unique_id=m.unique_id RETURNING * INTO m;
 UPDATE public.ph_location_sales_notes SET completed_at=NULL WHERE unique_id=m.unique_id;
 PERFORM set_config('gnc.inventory_location_evidence_apply',guard,true);
 RETURN jsonb_build_object('ok',true,'canonicalConfirmed',true,'writeConfirmed',true,'row',to_jsonb(m),'locationRows',jsonb_build_array(to_jsonb(m)),'requestRows','[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.unlock_drive_evidence_v1(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.unlock_drive_evidence_v1(text,text) TO authenticated;

-- One native-authenticated transaction stores bytes and invokes the canonical evidence save.
-- No network probe, anonymous mutation, caller-supplied actor, or sibling-location write.
CREATE OR REPLACE FUNCTION public.attach_drive_photo_blob_v1(p_path text,p_content text,p_content_type text,p_workflow text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ph_master_inventory; actor public.profiles; stored jsonb; receipt jsonb; prior jsonb; uid text; link text; links text; names text;
BEGIN
 IF NOT public.can_upload_drive_evidence_v23115(p_path) THEN RAISE EXCEPTION 'DRIVE_PHOTO_FORBIDDEN' USING ERRCODE='42501'; END IF;
 uid:=convert_from(decode(split_part(p_path,'/',2),'hex'),'UTF8');
 IF NOT pg_try_advisory_xact_lock(hashtextextended('drive-row:'||uid,0)) THEN RAISE EXCEPTION 'DRIVE_SAVE_BUSY' USING ERRCODE='40001'; END IF;
 SELECT * INTO m FROM public.ph_master_inventory WHERE unique_id=uid FOR UPDATE;
 actor:=private.require_drive_live_change_profile_v2392(m.unique_id,m.itemcode,m.locationcode,m.lotcode);
 stored:=public.store_drive_photo_blob_v1(p_path,p_content,p_content_type);
 link:='https://kzrnyjsosryejjejliii.supabase.co/functions/v1/app-api?photo_blob='||(stored->>'id');
 SELECT response_payload INTO prior FROM private.drive_evidence_idempotency WHERE profile_id=actor.id AND idempotency_key='location-v3-'||md5(p_idempotency_key);
 IF prior IS NOT NULL THEN
   IF prior->'row'->>'unique_id'<>uid OR NOT (link=ANY(string_to_array(prior->'row'->>'photo_link',','))) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
   RETURN stored||jsonb_build_object('receipt',prior);
 END IF;
 IF m.date_completed IS NOT NULL THEN RAISE EXCEPTION 'DRIVE_ROW_COMPLETED_UNLOCK_REQUIRED' USING ERRCODE='42501'; END IF;
 links:=concat_ws(',',nullif(m.photo_link,''),link);
 names:=concat_ws(',',nullif(m.photo_name,''),regexp_replace(p_path,'^.*/',''));
 receipt:=public.save_drive_evidence_v3(m.unique_id,m.itemcode,m.locationcode,m.lotcode,m.last_updated::text,
   jsonb_build_object('photo_link',m.photo_link,'photo_name',m.photo_name),jsonb_build_object('photo_link',links,'photo_name',names),false,p_workflow,p_idempotency_key);
 IF coalesce((receipt->>'ok')::boolean,false)=false THEN RAISE EXCEPTION '%',coalesce(receipt->>'code','PHOTO_SAVE_FAILED'); END IF;
 RETURN stored||jsonb_build_object('receipt',receipt);
END $$;
REVOKE ALL ON FUNCTION public.attach_drive_photo_blob_v1(text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attach_drive_photo_blob_v1(text,text,text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION private.publish_drive_evidence_to_soc_v23142() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.ph_soc_master s SET photo_link=n.photo_link,photo_name=n.photo_name,photo_url=n.photo_url,photos=n.photos,
   dock_photo_link=CASE WHEN n.photo_link IS NULL THEN s.dock_photo_link ELSE n.photo_link END,dock_photo_name=CASE WHEN n.photo_link IS NULL THEN s.dock_photo_name ELSE n.photo_name END,
   dock_spec=CASE WHEN n.photo_link IS NULL THEN s.dock_spec ELSE n.spec END,dock_caliper=CASE WHEN n.photo_link IS NULL THEN s.dock_caliper ELSE n.caliper END,
   av_note=n.av_note,pick_note=n.pick_note,match=n.match,loc_match_qty=n.loc_match_qty,date_completed=CASE WHEN n.photo_link IS NULL THEN s.date_completed ELSE n.date_completed END
 FROM new_drive_evidence n JOIN old_drive_evidence o USING(unique_id)
 WHERE (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed) IS DISTINCT FROM
       (o.photo_link,o.spec,o.caliper,o.av_note,o.pick_note,o.match,o.loc_match_qty,o.date_completed)
   AND s.itemcode=n.itemcode AND s.locationcode=n.locationcode AND coalesce(s.lotcode,'')=coalesce(n.lotcode,'')
   AND n.locationcode!~'^0+[.]0+[.]111$'
   AND (s.photo_link,s.dock_spec,s.dock_caliper,s.av_note,s.pick_note,s.match,s.loc_match_qty,s.date_completed) IS DISTINCT FROM
       (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed);
 RETURN NULL;
END $$;
COMMIT;
