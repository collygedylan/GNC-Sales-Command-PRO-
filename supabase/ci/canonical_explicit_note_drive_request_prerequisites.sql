begin;
-- These installed predecessor definitions match the exact v3.0.16 source hashes.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_EXPLICIT_NOTE_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
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
  IF payload->'force_clear_photos'='true'::jsonb OR (payload?'match' AND private.request_numeric_v2362(payload->>'match')=0) THEN PERFORM set_config('app.eval_force_clear_photos','on',true); END IF;
  payload:=payload-'force_clear_photos';
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
  if not private.wait_item_detail_lock_v308(hashtextextended('drive-location-idempotency:'||actor.id::text||':'||storage_key,0))
    or not private.wait_item_detail_lock_v308(hashtextextended('drive-row:'||p_master_uid,0)) then
    return jsonb_build_object('ok',false,'code','DRIVE_SAVE_BUSY','canonicalConfirmed',false,'retryAfterMs',250,'retryBlocked',false);
  end if;
  select * into current_row from public.ph_master_inventory m
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if not found then return jsonb_build_object('ok',false,'code','DRIVE_ROW_NOT_FOUND','canonicalConfirmed',true,'retryBlocked',false); end if;
  -- v3.0.8: the authorized editor can complete again with optional evidence.
  payload:=payload||jsonb_build_object('spec',coalesce(nullif(btrim(payload->>'spec'),''),nullif(btrim(current_row.spec),''),'N/A'),
    'photo_link',CASE WHEN p_evidence->'force_clear_photos'='true'::jsonb THEN coalesce(payload->>'photo_link','') ELSE private.collect_item_detail_photo_links_v308(current_row.itemcode,current_row.locationcode,current_row.lotcode,jsonb_build_array(to_jsonb(current_row),payload)) END);
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
    evidence.initial_loc_photo_match:=round(greatest(0,coalesce(private.inventory_location_evidence_number_v2(current_row.ptronhand),0))*coalesce(private.inventory_location_evidence_number_v2(evidence.match),0)/100);
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
  perform private.sync_item_detail_photos_v308(p_master_uid,evidence.photo_link);
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
$function$;

CREATE OR REPLACE FUNCTION public.request_work_command_v1_pre_state_machine_v2359(p_actor_id uuid, p_session_id uuid, p_operation text, p_request_id text DEFAULT NULL::text, p_expected_version bigint DEFAULT NULL::bigint, p_patch jsonb DEFAULT '{}'::jsonb, p_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
 SET statement_timeout TO '30s'
AS $function$
declare result jsonb; clean jsonb; request_row public.ph_requests_pending%rowtype; master_row public.ph_master_inventory%rowtype; qty numeric; pct numeric;
begin
 if not private.is_service_role_request() or not suspend_tag_private.session_active(p_actor_id,p_session_id) then raise exception 'REQUEST_WORK_SESSION_REQUIRED' using errcode='42501'; end if;
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated','session_id',p_session_id)::text,true);
 if p_operation='capabilities' then return public.get_request_capabilities(); end if;
 if p_operation not in ('save','append_photo') or jsonb_typeof(p_patch)<>'object' then raise exception 'REQUEST_WORK_OPERATION_INVALID' using errcode='22023'; end if;
 if not private.can_save_request_work() then raise exception 'REQUEST_SAVE_FORBIDDEN' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('force_clear_photos','req_match','req_spec','req_caliper','req_pic_note','req_sales_note','req_comments','av_note','req_reserve','req_photo_link','req_photo_name','req_photo_mode','req_rep_action','request_note','loc_match_qty','drive_photo_link','drive_photo_name','req_status','date_completed','req_archived','requested_by','request_folder','req_customer')) then raise exception 'REQUEST_WORK_FIELD_FORBIDDEN' using errcode='22023'; end if;
 select * into request_row from public.ph_requests_pending where unique_id=p_request_id;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='P0002'; end if;
 if not private.can_work_request_identity(request_row.request_created_by_username,request_row.request_selected_rep_username,request_row.requested_by) then raise exception 'REQUEST_ROW_FORBIDDEN' using errcode='42501'; end if;
 -- Match the import trigger lock order: master first, then its operational request.
 select * into master_row from public.ph_master_inventory where unique_id=request_row.master_id for update;
 if master_row.unique_id is null then
   if nullif(btrim(request_row.master_id),'') is not null then raise exception 'REQUEST_MASTER_NOT_FOUND' using errcode='P0002'; end if;
   if nullif(btrim(request_row.master_id),'') is null then
     select min(candidate.unique_id) into master_row.unique_id from public.ph_master_inventory candidate
       where candidate.itemcode=request_row.itemcode and candidate.locationcode=request_row.locationcode
         and (nullif(btrim(request_row.priority),'') is null or candidate.priority=request_row.priority)
         and (nullif(btrim(request_row.lotcode),'') is not null and candidate.lotcode=request_row.lotcode
           or nullif(btrim(request_row.lotcode),'') is null and nullif(btrim(request_row.priority),'') is not null
            and (nullif(btrim(request_row.source_snapshot->>'season'),'') is not null or nullif(btrim(request_row.source_snapshot->>'saleyear'),'') is not null)
            and (nullif(btrim(request_row.source_snapshot->>'season'),'') is null or candidate.season=request_row.source_snapshot->>'season')
            and (nullif(btrim(request_row.source_snapshot->>'saleyear'),'') is null or candidate.saleyear=request_row.source_snapshot->>'saleyear'))
       having count(*)=1;
     if master_row.unique_id is not null then
       select m.* into master_row from public.ph_master_inventory m where m.unique_id=master_row.unique_id for update;
     end if;
   end if;
   if master_row.unique_id is not null then
     update public.ph_requests_pending set master_id=master_row.unique_id where unique_id=p_request_id;
     request_row.master_id:=master_row.unique_id;
   end if;
 end if;
 select * into request_row from public.ph_requests_pending where unique_id=p_request_id for update;
 if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='P0002'; end if;
 if not private.can_work_request_identity(request_row.request_created_by_username,request_row.request_selected_rep_username,request_row.requested_by) then raise exception 'REQUEST_ROW_FORBIDDEN' using errcode='42501'; end if;
 clean:=p_patch - 'req_status' - 'date_completed' - 'req_archived' - 'loc_match_qty' - 'drive_photo_link' - 'drive_photo_name' - 'requested_by' - 'request_folder' - 'req_customer';
 if p_complete then
   clean:=jsonb_strip_nulls(jsonb_build_object('req_spec',request_row.req_spec,'req_match',request_row.req_match,'req_caliper',request_row.req_caliper,'req_pic_note',request_row.req_pic_note,'av_note',request_row.av_note,'req_photo_link',request_row.req_photo_link,'req_photo_name',request_row.req_photo_name))||clean;
 end if;
 if clean ? 'req_spec' then clean:=jsonb_set(clean,'{req_spec}',to_jsonb(replace(replace(coalesce(clean->>'req_spec',''),chr(92)||chr(39),chr(39)),chr(92)||chr(34),chr(34)))); end if;
 if clean ? 'av_note' then clean:=jsonb_set(clean,'{av_note}',to_jsonb(replace(replace(coalesce(clean->>'av_note',''),chr(92)||chr(39),chr(39)),chr(92)||chr(34),chr(34)))); end if;
 if p_complete and coalesce(nullif(btrim(clean->>'av_note'),''),nullif(btrim(request_row.av_note),'')) is null and nullif(btrim(coalesce(clean->>'req_spec',request_row.req_spec)), '') is not null then clean:=clean||jsonb_build_object('av_note','SPEC - '||coalesce(clean->>'req_spec',request_row.req_spec)); end if;
 if clean ? 'req_photo_link' then clean:=clean||jsonb_build_object('drive_photo_link',clean->>'req_photo_link'); end if;
 if clean ? 'req_photo_name' then clean:=clean||jsonb_build_object('drive_photo_name',clean->>'req_photo_name'); end if;
 if clean ? 'req_match' and coalesce(clean->>'req_match','') ~ '^[0-9]+([.][0-9]+)?$' then
 pct:=(clean->>'req_match')::numeric;
 if pct>100 then raise exception 'REQUEST_MATCH_INVALID' using errcode='22023'; end if;
 if coalesce(master_row.ptronhand,'') ~ '^[0-9]+([.][0-9]+)?$' then qty:=master_row.ptronhand::numeric;
 elsif coalesce(request_row.ptravailable,'') ~ '^[0-9]+([.][0-9]+)?$' then qty:=request_row.ptravailable::numeric; end if;
 if qty is not null then clean:=clean||jsonb_build_object('loc_match_qty',round(qty*pct/100)::text); end if;
 end if;
 if p_operation='append_photo' then
   if p_complete or (p_patch - 'req_photo_link' - 'req_photo_name') <> '{}'::jsonb or coalesce(p_patch->>'req_photo_link','') !~ '^https://[^,[:space:]]+$'
      or nullif(btrim(p_patch->>'req_photo_name'),'') is null or position(',' in p_patch->>'req_photo_name')>0 then
     raise exception 'REQUEST_WORK_PHOTO_INVALID' using errcode='22023';
   end if;
   if master_row.unique_id is null then raise exception 'REQUEST_MASTER_NOT_FOUND' using errcode='P0002'; end if;
   if (p_patch->>'req_photo_link')=any(string_to_array(coalesce(request_row.req_photo_link,''),','))
      and (p_patch->>'req_photo_link')=any(string_to_array(coalesce(master_row.photo_link,''),',')) then
     return jsonb_build_object('ok',true,'lifecycle_state','pending_active','row',to_jsonb(request_row),'row_version',request_row.row_version,'master_row',to_jsonb(master_row));
   end if;
   p_expected_version:=request_row.row_version;
   -- The master and request are both locked. A replay appends each URL at most once.
   clean:=jsonb_build_object(
     'req_photo_link',request_row.req_photo_link,'req_photo_name',request_row.req_photo_name,
     'drive_photo_link',master_row.photo_link,'drive_photo_name',master_row.photo_name);
   if not (p_patch->>'req_photo_link'=any(string_to_array(coalesce(request_row.req_photo_link,''),','))) then
     clean:=clean||jsonb_build_object('req_photo_link',concat_ws(',',nullif(request_row.req_photo_link,''),p_patch->>'req_photo_link'),
       'req_photo_name',concat_ws(',',nullif(request_row.req_photo_name,''),p_patch->>'req_photo_name'));
   end if;
   if not (p_patch->>'req_photo_link'=any(string_to_array(coalesce(master_row.photo_link,''),','))) then
     clean:=clean||jsonb_build_object('drive_photo_link',concat_ws(',',nullif(master_row.photo_link,''),p_patch->>'req_photo_link'),
       'drive_photo_name',concat_ws(',',nullif(master_row.photo_name,''),p_patch->>'req_photo_name'));
   end if;
 end if;
 result:=public.save_request_work(p_request_id,p_expected_version,clean,p_complete);
 select * into master_row from public.ph_master_inventory where unique_id=request_row.master_id;
 return result||jsonb_build_object('master_row',case when master_row.unique_id is null then null else to_jsonb(master_row) end);
end $function$;
commit;
