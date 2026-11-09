begin;
-- These installed predecessor definitions match the exact v3.0.16 source hashes.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_EXPLICIT_NOTE_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
-- Preserve the installed body checksum without trailing whitespace in this file.
do $replay$ begin
  execute replace($captured$CREATE OR REPLACE FUNCTION suspend_tag_private.command(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare actor public.profiles; s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; inventory_result jsonb:='{}'; was_denied boolean; event_id uuid; approval_id uuid; decision text;
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation='approval' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion')) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','canDecide',(a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) and a.status='pending'
      and exists(select 1 from suspend_tag_private.workflows x join public.ph_soc_master r on r.unique_id=x.source_uid
        where x.current_approval_id=a.id and x.status='awaiting_rep' and r.last_updated is not distinct from a.source_revision and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR','INVENTORY','INVENTORYMANAGER') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
  if p_operation='rows' then
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]') from public.ph_soc_master r
      where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
  input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
  select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
  if found then
    if receipt.request<>input then return suspend_tag_private.command(p_actor_id,p_operation,p_payload,md5(p_command_id::text||input::text)::uuid,null); end if;
    return receipt.response;
  end if;
  uid:=case when p_operation in ('save','complete') then suspend_tag_private.resolve_edit_source_v23107(p_payload) else p_payload->>'sourceUid' end;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    uid:=a.source_uid;
  end if;
  if p_operation in ('save','complete') then
    perform pg_advisory_xact_lock(hashtextextended('suspend-tag-review-item:'||r.itemcode,0))
      from public.ph_soc_master r where r.unique_id=uid;
  end if;
  select * into s from public.ph_soc_master where unique_id=uid for update;
  if not found or not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
  insert into suspend_tag_private.workflows(source_uid,source_revision) values(uid,s.last_updated) on conflict do nothing;
  select * into w from suspend_tag_private.workflows where source_uid=uid for update;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=a.id for update;
    decision:=p_payload->>'decision';
    if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
    if a.source_revision is distinct from s.last_updated or w.current_approval_id is distinct from a.id then raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='PT409'; end if;
    if a.status<>'pending' then
      if a.status<>(case when decision='approve' then 'approved' else 'denied' end) then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='PT409'; end if;
    else
      update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,decided_at=now(),decided_by=actor.id where id=a.id returning * into a;
      update suspend_tag_private.workflows set status=a.status,version=version+1,updated_at=now() where source_uid=uid;
      if decision='deny' then update public.ph_soc_master set date_completed=null where unique_id=uid; end if;
      insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
        values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),now()) returning public.ph_request_delivery_outbox.event_id into event_id;
      update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
    end if;
    result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
  else
@CI_V316_BLANK@
@CI_V316_BLANK@
    if w.source_revision is distinct from s.last_updated then
      update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
      update suspend_tag_private.workflows set source_revision=s.last_updated,status='pending',completed_by=null,completed_at=null,current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
    end if;
    if p_operation in ('save','complete') then
      if w.status in ('awaiting_rep','approved') then
        update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
        update suspend_tag_private.workflows set status='pending',current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
      end if;
      was_denied:=w.status='denied'; patch:=coalesce(p_payload->'patch','{}');
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k<>all(array['force_clear_photos','dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','av_note','match','loc_match_qty','initial_ptr','pick_note','sales_note'])) then raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
      IF patch->'force_clear_photos'='true'::jsonb OR (patch?'match' AND private.request_numeric_v2362(patch->>'match')=0) THEN PERFORM set_config('app.eval_force_clear_photos','on',true); END IF;
      patch:=patch-'force_clear_photos';
      -- Preserve concurrent photos while allowing field edits on the latest locked source.
      if patch ? 'dock_photo_link' and current_setting('app.eval_force_clear_photos',true) IS DISTINCT FROM 'on' then
        patch:=jsonb_set(patch,'{dock_photo_link}',to_jsonb(coalesce((select string_agg(distinct btrim(link),',') from unnest(string_to_array(concat_ws(',',nullif(s.dock_photo_link,''),nullif(patch->>'dock_photo_link','')),',')) link where btrim(link)<>''),'')),true);
      end if;
      patch:=patch||jsonb_build_object('dock_spec',coalesce(nullif(btrim(patch->>'dock_spec'),''),nullif(btrim(s.dock_spec),''),'N/A'),
        'dock_photo_link',CASE WHEN current_setting('app.eval_force_clear_photos',true)='on' THEN coalesce(patch->>'dock_photo_link','') ELSE private.collect_item_detail_photo_links_v308(s.itemcode,s.locationcode,s.lotcode,jsonb_build_array(to_jsonb(s),patch)) END);
      p_payload:=jsonb_set(p_payload,'{patch}',patch,true);
      edited:=jsonb_populate_record(s,patch);
      if p_operation='complete' then edited:=suspend_tag_private.existing_review(edited); end if;
      -- Completion needs no evidence. Sending for rep approval still validates its snapshot.
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr,pick_note=edited.pick_note,sales_note=edited.sales_note where unique_id=uid returning * into s;
   inventory_result:=suspend_tag_private.publish_inventory_evidence_v23119(p_actor_id,s,p_payload,p_command_id);
      if p_operation='complete' then
        -- Completing a review never closes the physical Suspend Tag. Only group_command close does.
        update public.ph_soc_master set date_completed=null where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=clock_timestamp(),version=version+1,updated_at=now() where source_uid=uid;
        if was_denied then approval_id:=suspend_tag_private.request_approval(uid); end if;
      end if;
    elsif p_operation='send' then
      approval_id:=suspend_tag_private.request_approval(uid);
    elsif p_operation='retry' then
      if w.current_approval_id is null then raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023'; end if;
      update public.ph_request_delivery_outbox as outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null
        where outbox.event_id in(select request_event_id from suspend_tag_private.approvals where id=w.current_approval_id) and outbox.status='failed';
    else raise exception 'SUSPEND_TAG_OPERATION_INVALID' using errcode='22023';
    end if;
    result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
  end if;
  result:=result||inventory_result;
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $function$$captured$, '@CI_V316_BLANK@', repeat(' ',4));
end $replay$;

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
  IF current_setting('app.eval_force_clear_photos',true)='on' THEN evidence:=jsonb_build_object('force_clear_photos',true); END IF;
  IF patch?'dock_spec' THEN evidence:=evidence||jsonb_build_object('spec',s.dock_spec); END IF;
  IF patch?'dock_caliper' THEN evidence:=evidence||jsonb_build_object('caliper',s.dock_caliper); END IF;
  IF patch?'av_note' THEN evidence:=evidence||jsonb_build_object('av_note',s.av_note); END IF;
  IF patch?'dock_note' OR patch?'sales_note' THEN evidence:=evidence||jsonb_build_object('comments',coalesce(patch->>'sales_note',s.dock_note)); END IF;
  IF patch?'pick_note' THEN evidence:=evidence||jsonb_build_object('pick_note',s.pick_note); END IF;
  IF patch?'dock_photo_link' THEN evidence:=evidence||jsonb_build_object('photo_link',CASE WHEN current_setting('app.eval_force_clear_photos',true)='on' THEN coalesce(s.dock_photo_link,'') ELSE coalesce((SELECT string_agg(link,',' ORDER BY first_seen) FROM (SELECT btrim(link) link,min(n) first_seen FROM unnest(string_to_array(concat_ws(',',m.photo_link,s.dock_photo_link),',')) WITH ORDINALITY a(link,n) WHERE btrim(link)<>'' GROUP BY btrim(link)) photos),'') END); END IF;
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
END $function$;
commit;
