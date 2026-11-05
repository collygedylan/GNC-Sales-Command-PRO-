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
  if current_row.date_completed is not null
    and (nullif(btrim(current_row.photo_link),'') is not null or nullif(btrim(current_row.photo_url),'') is not null or jsonb_array_length(coalesce(current_row.photos,'[]'::jsonb))>0)
    and coalesce(current_row.loc_photo_match,private.reclass_numeric_v1(current_row.loc_match_qty),0)>0 and not (
      coalesce(current_setting('role',true),'') = 'service_role'
      and coalesce(current_setting('app.suspend_evidence_uid',true),'') = current_row.unique_id
      and not coalesce(p_complete,false)
    ) then
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
        then round(greatest(0,coalesce(private.inventory_location_evidence_number_v2(source_row.ptronhand),0))*new.loc_match_pct/100)
      else null
    end;
    new.current_photo_match_qty:=private.inventory_location_evidence_qty_v2(
      new.baseline_on_hand,new.initial_photo_match_qty,current_on_hand
    );
    new.loc_match_qty:=new.current_photo_match_qty::text;
    new.initial_ptr:=coalesce(new.baseline_on_hand::text,new.initial_ptr);
    new.expires_at:=new.evaluated_at + interval '10 days';
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
  if new.source_unique_id=nullif(current_setting('app.suspend_evidence_uid',true),'')
    and nullif(current_setting('app.suspend_observed_match',true),'') is not null
    and new.match is not null and current_on_hand is not null then
    new.eval_baseline_available:=current_on_hand;
    new.initial_loc_photo_match:=current_setting('app.suspend_observed_match')::numeric;
    new.baseline_on_hand:=current_on_hand;
    new.initial_photo_match_qty:=new.initial_loc_photo_match;
    new.current_photo_match_qty:=least(current_on_hand,new.initial_loc_photo_match);
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
$function$;

CREATE OR REPLACE FUNCTION private.sync_master_inventory_canonical_v2362()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare evidence app_sync_private.inventory_location_evidence_v1%rowtype;
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
  if tg_table_schema='public' and tg_table_name in ('ph_master_inventory','ph_drive_around_report_rows')
     and coalesce(auth.role(),'')='service_role'
     and current_setting('agdata.bulk_import.'||tg_table_name,true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='UPDATE' and not guard_enabled
      and private.ph_master_inventory_import_run_v1() is null then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=new.unique_id;
  current_on_hand:=private.request_numeric_v2362(new.ptravailable);
  canonical_baseline:=coalesce(evidence.baseline_on_hand,new.baseline_on_hand,
    private.request_numeric_v2362(new.initial_ptr),current_on_hand);
  canonical_match:=coalesce(evidence.loc_match_pct,new.loc_match_pct,
    private.request_numeric_v2362(new.match));
  canonical_initial:=coalesce(evidence.initial_photo_match_qty,new.initial_photo_match_qty,
    case when canonical_baseline is not null and canonical_match between 0 and 100
      then round(canonical_baseline*canonical_match/100.0) end);
  canonical_current:=case
    when new.unique_id=evidence.source_unique_id
      or upper(btrim(coalesce(new.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')))
      then coalesce(private.inventory_location_evidence_qty_v2(
        canonical_baseline,canonical_initial,current_on_hand),evidence.current_photo_match_qty,
        new.loc_photo_match,private.request_numeric_v2362(new.loc_match_qty))
    else coalesce(evidence.current_photo_match_qty,new.loc_photo_match,
        private.request_numeric_v2362(new.loc_match_qty),
        private.inventory_location_evidence_qty_v2(canonical_baseline,canonical_initial,current_on_hand))
  end;
  -- v2379_non_source_evidence_qty
  canonical_photo_date:=coalesce(evidence.evaluated_at,new.photo_date,new.date_completed,
    new.av_rule_photo_updated_at,new.av_rule_bundle_updated_at);
  canonical_expiry:=coalesce(evidence.expires_at,new.photo_expires_at,
    private.inventory_location_evidence_expiry_v2(canonical_photo_date));
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
    new.photos:=private.request_photo_array_v2362(new.photos,canonical_photo_url,
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
    new.av_note:=null;
    new.sales_note:=null;
    new.photo_expires_at:=null;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.inventory_master_identity_batch_read_v1(p_actor_id uuid, p_queue_identities jsonb, p_expected_revision text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
declare
  actor public.profiles;
  revision_text text;
  revision_number bigint;
  revision_state text;
  lkg_proof jsonb;
  results jsonb;
begin
  select p.* into actor from public.profiles p
  where p.id=p_actor_id and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now());
  if not found or actor.must_change_password then
    raise exception using errcode='42501',message='MASTER_IDENTITY_ACTOR_FORBIDDEN';
  end if;
  if jsonb_typeof(p_queue_identities) is distinct from 'array' then
    raise exception using errcode='22023',message='MASTER_IDENTITY_QUEUE_INVALID';
  end if;
  if jsonb_array_length(p_queue_identities) < 1 or jsonb_array_length(p_queue_identities) > 100
    or exists (
      select 1 from jsonb_array_elements(p_queue_identities) i(value)
      where jsonb_typeof(value) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(case when jsonb_typeof(value)='object' then value else '{}'::jsonb end) k(key)
          where key not in ('masterUid','itemCode','locationCode','lotCode','source','season','salesYear','priority','desigItem'))
        or length(coalesce(value->>'masterUid',''))>240
        or length(coalesce(value->>'itemCode',''))>240
        or length(coalesce(value->>'locationCode',''))>160
        or length(coalesce(value->>'lotCode',''))>240
        or length(coalesce(value->>'source',''))>240
        or not (value ? 'lotCode')
        or jsonb_typeof(value->'lotCode') is distinct from 'string'
        or (nullif(btrim(value->>'masterUid'),'') is null and (
          nullif(btrim(value->>'itemCode'),'') is null
          or nullif(btrim(value->>'locationCode'),'') is null))
    ) then
    raise exception using errcode='22023',message='MASTER_IDENTITY_QUEUE_INVALID';
  end if;

  select r.revision::text,r.revision,r.state into revision_text,revision_number,revision_state
  from public.app_dataset_revisions r where r.key='ph_master_inventory';
  lkg_proof := app_sync_private.published_snapshot_read_proof('ph_master_inventory',revision_number);
  if revision_state is distinct from 'ready'
     and not coalesce((lkg_proof->>'publishedReadable')::boolean,false) then
    return jsonb_build_object('inventoryRevision',revision_text,'rows','[]'::jsonb,
      'retained',true,'retryable',true,'sourceNotReady',true);
  end if;
  if nullif(p_expected_revision,'') is not null
     and p_expected_revision<>revision_text
     and p_expected_revision is distinct from lkg_proof->>'publishedRevision' then
    return jsonb_build_object('inventoryRevision',revision_text,'rows','[]'::jsonb,
      'retained',true,'retryable',true,'revisionChanged',true);
  end if;

  with input_rows as materialized (
    select ordinality::integer as input_index, value as identity,
      nullif(btrim(value->>'masterUid'),'') as master_uid,
      private.master_identity_item_key_v1(rtrim(btrim(value->>'itemCode'),'.')) as item_key,
      private.master_identity_location_key_v1(value->>'locationCode') as location_key,
      upper(btrim(value->>'lotCode')) as lot_key,
      case when upper(btrim(coalesce(value->>'source',''))) in ('','DOCK','DOCKS','SOC') then null
        else upper(btrim(value->>'source')) end as source_key
    from jsonb_array_elements(p_queue_identities) with ordinality q(value,ordinality)
  ), matched as (
    select i.input_index, m.unique_id, to_jsonb(m) as full_row
    from input_rows i
    left join lateral (
      select candidate.* from (
        select inv.* from public.ph_master_inventory inv
        where i.master_uid is not null and inv.unique_id=i.master_uid
          and (regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') not like '%FOREMAN%'
            or (inv.priority is not null and inv.priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
        union all
        select inv.* from public.ph_master_inventory inv
        where i.master_uid is null
          and private.master_identity_item_key_v1(inv.itemcode)=i.item_key
          and private.master_identity_location_key_v1(inv.locationcode)=i.location_key
          and upper(btrim(coalesce(inv.lotcode,'')))=i.lot_key
          and (i.source_key is null or upper(btrim(coalesce(inv.source,'')))=i.source_key)
          and (nullif(i.identity->>'priority','') is null or btrim(inv.priority)=i.identity->>'priority')
          and (nullif(i.identity->>'season','') is null or upper(btrim(inv.season))=upper(i.identity->>'season'))
          and (nullif(i.identity->>'salesYear','') is null or right(coalesce(nullif(inv.saleyear,''),split_part(inv.lotcode,'.',1)),2)=right(i.identity->>'salesYear',2))
          and (nullif(i.identity->>'desigItem','') is null or upper(btrim(inv.desigitem))=upper(i.identity->>'desigItem'))
          and (regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') not like '%FOREMAN%'
            or (inv.priority is not null and inv.priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
      ) candidate
      order by candidate.unique_id
      limit 2
    ) m on true
  ), grouped as (
    select input_index,count(unique_id)::integer as match_count,
      case when count(unique_id)=1 then (array_agg(full_row) filter(where unique_id is not null))[1] else null end as row
    from matched group by input_index
  )
  select coalesce(jsonb_agg(jsonb_build_object('inputIndex',input_index-1,
    'matchCount',least(match_count,2),'row',row) order by input_index),'[]'::jsonb)
  into results from grouped;

  return jsonb_build_object('inventoryRevision',revision_text,
    'publishedReadable',coalesce((lkg_proof->>'publishedReadable')::boolean,false),
    'publishedRevision',lkg_proof->>'publishedRevision','publishedAt',lkg_proof->>'publishedAt','rows',results);
end
$function$
;
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create temporary table row_evaluation_recovery on commit drop as
select selected.*,coalesce(nullif(pct,0),nullif((master->>'loc_match_pct')::numeric,0),nullif((evidence->>'loc_match_pct')::numeric,0),100) recovered_pct,
case when origin='notes' and pg_input_is_valid(evidence->>'evaluated_at','timestamptz') and (evidence->>'evaluated_at')::timestamptz>=now()-interval '10 days' then (evidence->>'evaluated_at')::timestamptz else ts end photo_at
from (
with raw as (
 select 'notes' origin,to_jsonb(t) j from public.ph_location_sales_notes t
 union all select 'history',to_jsonb(t) from public.ph_requests_completed_history t
 union all select 'request',to_jsonb(t) from public.ph_requests_pending t
 union all select 'suspend',to_jsonb(t) from public.ph_active_suspend t
 union all select 'eval',coalesce(t.origin_snapshot,'{}'::jsonb)||coalesce(t.submitted_evidence,'{}'::jsonb)||to_jsonb(t) from public.ph_eval_work t where t.submitted_at is not null
), normalized as (
 select origin,j,
 coalesce(nullif(j->>'master_unique_id',''),nullif(j->>'master_id',''),nullif(j->>'origin_unique_id',''),case when origin in ('notes','suspend') then nullif(j->>'unique_id','') end) uid,
 upper(rtrim(btrim(j->>'itemcode'),'.')) item,
 upper(btrim(coalesce(j->>'locationcode',j->>'origin_locationcode'))) loc,
 upper(btrim(coalesce(nullif(j->>'lotcode',''),j->>'origin_lotcode'))) lot,
 upper(btrim(coalesce(nullif(j->>'season',''),substring(j->>'lotcode' from '\.([A-Za-z][0-9])$')))) season,
 right(coalesce(nullif(j->>'saleyear',''),substring(j->>'lotcode' from '^([0-9]{2,4})\.')),2) yr,
 nullif(btrim(coalesce(nullif(j->>'priority',''),j->>'pri')),'') pri,
 coalesce(nullif(j->>'req_photo_link',''),nullif(j->>'photo_link',''),nullif(j->>'photo_url',''),
 case when jsonb_typeof(j->'photos')='array' then (select string_agg(coalesce(p->>'url',p->>'publicUrl',p->>'photo_url',case when jsonb_typeof(p)='string' then p#>>'{}' end),',') from jsonb_array_elements(j->'photos')p) end) photos,
 coalesce(nullif(j->>'photo_date',''),nullif(j->>'date_completed',''),nullif(j->>'completed_at',''),nullif(j->>'submitted_at',''),nullif(j->>'updated_at',''),nullif(j->>'last_updated','')) stamp,
 coalesce(nullif(j->>'req_match',''),nullif(j->>'loc_match_pct',''),nullif(j->>'match','')) pct_text
 from raw
), recent as (
 select *,case when pg_input_is_valid(stamp,'timestamptz') then stamp::timestamptz end ts,
 private.inventory_location_evidence_number_v2(pct_text) pct
 from normalized where photos ~* '^https?://'
), matches as (
 select r.*,m.unique_id target,count(*) over(partition by r.origin,r.j->>'unique_id',r.j->>'id') matches
 from recent r join public.ph_master_inventory m on upper(rtrim(btrim(m.itemcode),'.'))=r.item and upper(btrim(m.locationcode))=r.loc
 and (m.unique_id=r.uid or (
 not exists(select 1 from public.ph_master_inventory x where x.unique_id=r.uid)
 and r.pri is not null and r.yr is not null and r.season is not null and r.lot is not null
 and upper(btrim(m.lotcode))=r.lot and upper(btrim(m.season))=r.season
 and right(coalesce(nullif(m.saleyear,''),substring(m.lotcode from '^([0-9]{2,4})\.')),2)=r.yr
 and btrim(m.priority)=r.pri
 and coalesce(upper(btrim(m.desigitem)),'')=coalesce(upper(btrim(r.j->>'desigitem')),'')))
 where r.ts between now()-interval '10 days' and now()
), latest as (
 select distinct on(target) * from matches where matches=1 order by target,ts desc,origin
), assessed as (
 select r.*,to_jsonb(m) master,to_jsonb(e) evidence,
 private.inventory_location_evidence_number_v2(m.ptronhand) oh,
 private.inventory_location_evidence_number_v2(m.ptravailable) avail,
 case
 when e.cleared_at is not null and e.cleared_at>=r.ts then 'cleared'
 when coalesce(e.initial_loc_photo_match,e.initial_photo_match_qty,0)>0
 and private.live_loc_photo_match_v23142(coalesce(private.inventory_location_evidence_number_v2(m.ptravailable),0),coalesce(e.eval_baseline_available,e.baseline_on_hand,0),coalesce(e.initial_loc_photo_match,e.initial_photo_match_qty))<=0
 and coalesce(e.evaluated_at,r.ts)>=r.ts-interval '1 second' then 'depleted'
 when coalesce(m.photo_date,m.av_rule_photo_updated_at,m.date_completed)>r.ts+interval '1 second' and coalesce(m.photo_link,m.photo_url,'')~*'^https?://' then 'newer_master'
 when private.inventory_location_evidence_number_v2(m.ptronhand)<=0 or private.inventory_location_evidence_number_v2(m.ptravailable)<=0 then 'no_stock'
 else 'eligible' end decision
 from latest r join public.ph_master_inventory m on m.unique_id=r.target
 left join app_sync_private.inventory_location_evidence_v1 e on e.source_unique_id=r.target
)
select * from assessed where decision='eligible' and coalesce(evidence->>'cleared_at','')='' and oh>0 and avail>0 and
(coalesce((master->>'loc_photo_match')::numeric,0)<=0 or coalesce(nullif(master->>'photo_link',''),master->>'photo_url','') !~* '^https?://')) selected;
alter table row_evaluation_recovery add column recovered_qty numeric;
update row_evaluation_recovery set recovered_qty=least(avail,coalesce(nullif((master->>'loc_photo_match')::numeric,0),greatest(1,round(oh*recovered_pct/100))));
create temporary table row_evaluation_siblings on commit drop as
select m.unique_id,md5(to_jsonb(m)::text) checksum from public.ph_master_inventory m
where exists(select 1 from row_evaluation_recovery r where m.itemcode=r.master->>'itemcode' and m.locationcode=r.master->>'locationcode')
and not exists(select 1 from row_evaluation_recovery r where r.target=m.unique_id);
insert into app_sync_private.inventory_location_evidence_v1 as saved
(itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,source_lotcode,spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,photo_link,photo_name,date_completed,app_tab_assignment,updated_at,updated_by,eval_baseline_available,initial_loc_photo_match)
select upper(master->>'itemcode'),upper(master->>'locationcode'),master->>'itemcode',master->>'locationcode',target,master->>'lotcode',
coalesce(nullif(j->>'req_spec',''),nullif(j->>'spec',''),master->>'spec'),
coalesce(nullif(j->>'req_caliper',''),nullif(j->>'caliper',''),master->>'caliper'),
recovered_pct::text,recovered_qty::text,oh::text,
coalesce(nullif(j->>'av_note',''),master->>'av_note'),
coalesce(nullif(j->>'req_pic_note',''),nullif(j->>'pick_note',''),nullif(j->>'pic_note',''),master->>'pick_note',master->>'pic_note'),
coalesce(nullif(j->>'req_comments',''),nullif(j->>'comments',''),nullif(j->>'sales_note',''),master->>'sales_note'),
photos,coalesce(nullif(j->>'req_photo_name',''),j->>'photo_name'),photo_at,coalesce(master->>'app_tab_assignment','location'),photo_at,'authorized_row_evaluation_recovery',avail,recovered_qty
from row_evaluation_recovery
on conflict(source_unique_id) do update set spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,updated_at=excluded.updated_at,updated_by=excluded.updated_by,eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match;
update app_sync_private.inventory_location_evidence_v1 e set
evaluated_at=r.photo_at,expires_at=r.photo_at+interval '10 days',baseline_on_hand=r.avail,initial_photo_match_qty=r.recovered_qty,current_photo_match_qty=r.recovered_qty,
eval_baseline_available=r.avail,initial_loc_photo_match=r.recovered_qty,cleared_at=null,clear_reason=null
from row_evaluation_recovery r where e.source_unique_id=r.target;
set local gnc.inventory_location_evidence_apply='on';
update public.ph_master_inventory m set
spec=e.spec,caliper=e.caliper,match=e.match,loc_match_pct=e.loc_match_pct,loc_match_qty=e.loc_match_qty,loc_photo_match=e.current_photo_match_qty,
baseline_on_hand=e.baseline_on_hand,initial_photo_match_qty=e.initial_photo_match_qty,eval_baseline_available=e.eval_baseline_available,initial_loc_photo_match=e.initial_loc_photo_match,
av_note=e.av_note,pic_note=e.pic_note,pick_note=e.pic_note,sales_note=e.sales_note,
photo_link=e.photo_link,photo_name=e.photo_name,photo_url=split_part(e.photo_link,',',1),photos=private.request_photo_array_v2362('[]'::jsonb,e.photo_link,e.photo_name),
photo_date=e.evaluated_at,photo_expires_at=e.expires_at,av_rule_photo_updated_at=e.evaluated_at,date_completed=e.date_completed,last_updated=clock_timestamp()
from app_sync_private.inventory_location_evidence_v1 e join row_evaluation_recovery r on r.target=e.source_unique_id where m.unique_id=r.target;
insert into public.ph_location_sales_notes as notes
(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,updated_at,completed_at,eval_baseline_available,initial_loc_photo_match)
select m.unique_id,coalesce(m.source,''),m.itemcode,m.locationcode,coalesce(m.lotcode,''),m.photo_link,m.photo_name,m.spec,m.caliper,m.loc_match_pct,m.av_note,m.pick_note,m.sales_note,r.photo_at,r.photo_at,m.eval_baseline_available,m.initial_loc_photo_match
from public.ph_master_inventory m join row_evaluation_recovery r on r.target=m.unique_id
on conflict(unique_id) do update set photo_link=excluded.photo_link,photo_name=excluded.photo_name,spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_at=excluded.updated_at,completed_at=excluded.completed_at,eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match;
do $verify$
begin
if exists(select 1 from row_evaluation_siblings b join public.ph_master_inventory m using(unique_id) where b.checksum<>md5(to_jsonb(m)::text)) then raise exception 'SIBLING_EVIDENCE_CHANGED'; end if;
if exists(select 1 from row_evaluation_recovery r join public.ph_master_inventory m on m.unique_id=r.target where m.loc_photo_match<=0 or m.photo_date is distinct from r.photo_at or m.photo_link is distinct from r.photos) then raise exception 'RECOVERY_RECEIPT_MISMATCH';end if;
end $verify$;
select count(*) recovered,coalesce(jsonb_agg(jsonb_build_object('uid',target,'photo_at',photo_at,'match',recovered_qty)),'[]'::jsonb) receipts from row_evaluation_recovery;
commit;
CREATE OR REPLACE FUNCTION suspend_tag_private.publish_inventory_evidence_v23119(p_actor_id uuid, s ph_soc_master, p_payload jsonb, p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE wanted_uid text:=nullif(btrim(p_payload->'sourceIdentity'->>'masterUid'),''); m public.ph_master_inventory; patch jsonb:=coalesce(p_payload->'patch','{}'); evidence jsonb; result jsonb; rows jsonb:='[]'; pct numeric; stock numeric; old_sub text:=current_setting('request.jwt.claim.sub',true); old_claims text:=current_setting('request.jwt.claims',true);
BEGIN
 -- The service wrapper has already verified the native session, physical tag, command and source revision.
 IF p_actor_id IS DISTINCT FROM nullif(current_setting('app.suspend_tag_actor_id',true),'')::uuid THEN RAISE EXCEPTION 'SUSPEND_TAG_SESSION_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 IF NOT suspend_tag_private.is_false_block_v2378(s.locationcode) AND (wanted_uid IS NOT NULL OR nullif(btrim(s.lotcode),'') IS NOT NULL) THEN
  BEGIN
   SELECT candidate.* INTO STRICT m FROM public.ph_master_inventory candidate
   WHERE upper(btrim(candidate.itemcode)) = upper(btrim(s.itemcode))
     AND upper(btrim(candidate.locationcode)) = upper(btrim(s.locationcode))
     AND (wanted_uid IS NULL OR candidate.unique_id=wanted_uid)
     AND (wanted_uid IS NOT NULL AND nullif(btrim(s.lotcode),'') IS NULL
          OR upper(btrim(candidate.lotcode))=upper(btrim(s.lotcode)))
   FOR UPDATE;
  EXCEPTION WHEN no_data_found THEN
    IF wanted_uid IS NOT NULL THEN RAISE EXCEPTION 'SUSPEND_TAG_MASTER_IDENTITY_CHANGED' USING ERRCODE='22023'; END IF;
    m:=NULL;
    WHEN too_many_rows THEN RAISE EXCEPTION 'SUSPEND_TAG_AMBIGUOUS_MASTER' USING ERRCODE='22023';
  END;
  evidence:='{}';
  IF patch?'dock_spec' THEN evidence:=evidence||jsonb_build_object('spec',s.dock_spec); END IF;
  IF patch?'dock_caliper' THEN evidence:=evidence||jsonb_build_object('caliper',s.dock_caliper); END IF;
  IF patch?'av_note' THEN evidence:=evidence||jsonb_build_object('av_note',s.av_note); END IF;
  IF patch?'dock_note' OR patch?'sales_note' THEN evidence:=evidence||jsonb_build_object('comments',coalesce(patch->>'sales_note',s.dock_note)); END IF;
  IF patch?'pick_note' THEN evidence:=evidence||jsonb_build_object('pick_note',s.pick_note); END IF;
  IF patch?'dock_photo_link' THEN evidence:=evidence||jsonb_build_object('photo_link',coalesce((SELECT string_agg(link,',' ORDER BY first_seen) FROM (SELECT btrim(link) link,min(n) first_seen FROM unnest(string_to_array(concat_ws(',',m.photo_link,s.dock_photo_link),',')) WITH ORDINALITY a(link,n) WHERE btrim(link)<>'' GROUP BY btrim(link)) photos),'')); END IF;
  IF patch?'dock_photo_name' THEN evidence:=evidence||jsonb_build_object('photo_name',concat_ws(',',nullif(m.photo_name,''),nullif(s.dock_photo_name,''))); END IF;
  IF patch?'match' THEN
   pct:=private.reclass_numeric_v1(s.match);stock:=greatest(0,coalesce(private.reclass_numeric_v1(m.ptronhand),0));
   evidence:=evidence||jsonb_build_object('match',s.match,'loc_match_qty',CASE WHEN pct>0 AND stock>0 THEN round(pct*stock/100)::text ELSE s.loc_match_qty END);
  END IF;
  IF m.unique_id IS NOT NULL AND evidence<>'{}' THEN
  PERFORM set_config('app.suspend_observed_match',CASE WHEN patch?'match' AND pct BETWEEN 0 AND 100 AND stock>0 THEN round(stock*pct/100)::text ELSE '' END,true);
  PERFORM set_config('app.suspend_evidence_uid',m.unique_id,true);
  result:=public.save_drive_evidence_v3(m.unique_id,m.itemcode,m.locationcode,m.lotcode,m.last_updated::text,'{}',evidence,(patch?'pick_note' AND patch?'sales_note'),'location','suspend-'||p_command_id||'-'||md5(m.unique_id));
  PERFORM set_config('app.suspend_evidence_uid','',true);
  IF (result->>'ok')::boolean IS DISTINCT FROM true OR result->'row'->>'unique_id' IS DISTINCT FROM m.unique_id THEN
    RAISE EXCEPTION 'SUSPEND_TAG_EVIDENCE_UNCONFIRMED' USING ERRCODE='PT409';
  END IF;
  rows:=rows||jsonb_build_array(result->'row');
  END IF;
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
 RETURN jsonb_build_object('inventoryRows',rows,'inventoryRow',rows->0);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);RAISE;
END $function$
;
