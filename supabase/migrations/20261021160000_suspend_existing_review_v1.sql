begin;
-- Reuse saved plant evidence without changing physical tag or approval identity.
create or replace function suspend_tag_private.existing_review(s public.ph_soc_master)
returns public.ph_soc_master language plpgsql security definer set search_path='' as $fn$
declare evidence jsonb; qty numeric; result public.ph_soc_master;
begin
  select candidate into evidence from (
    select jsonb_build_object('dock_photo_link',s.dock_photo_link,'dock_photo_name',s.dock_photo_name,
      'dock_spec',s.dock_spec,'av_note',s.av_note,'match',s.match) candidate, 0 rank, '' tie
    union all
    select jsonb_build_object('dock_photo_link',m.photo_link,'dock_photo_name',m.photo_name,
      'dock_spec',m.spec,'av_note',m.av_note,'match',m.match),
      case when m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'') then 1 when m.locationcode=s.locationcode then 2 else 4 end,m.unique_id
      from public.ph_master_inventory m where m.itemcode=s.itemcode
    union all
    select jsonb_build_object('dock_photo_link',r.dock_photo_link,'dock_photo_name',r.dock_photo_name,
      'dock_spec',r.dock_spec,'av_note',r.av_note,'match',r.match),
      case when r.locationcode=s.locationcode then 3 else 5 end,r.unique_id
      from public.ph_soc_master r where r.itemcode=s.itemcode and r.unique_id<>s.unique_id
  ) candidates
  where nullif(btrim(candidate->>'dock_photo_link'),'') is not null
    and coalesce(nullif(btrim(candidate->>'dock_spec'),''),nullif(btrim(candidate->>'av_note'),'')) is not null
  order by rank,tie limit 1;
  if evidence is null then return s; end if;
  result:=s;
  result.dock_photo_link:=coalesce(nullif(s.dock_photo_link,''),evidence->>'dock_photo_link');
  result.dock_photo_name:=coalesce(nullif(s.dock_photo_name,''),evidence->>'dock_photo_name');
  result.dock_spec:=coalesce(nullif(s.dock_spec,''),evidence->>'dock_spec');
  result.av_note:=coalesce(nullif(s.av_note,''),nullif(evidence->>'av_note',''),'SPEC - '||result.dock_spec);
  result.match:=coalesce(nullif(s.match,''),nullif(evidence->>'match',''),'100');
  select sum(case when m.ptronhand ~ '^[0-9]+([.][0-9]+)?$' then m.ptronhand::numeric else 0 end)
    into qty from public.ph_master_inventory m where m.itemcode=s.itemcode and m.locationcode=s.locationcode;
  if coalesce(qty,0)<=0 and s.ptronhand ~ '^[0-9]+([.][0-9]+)?$' then qty:=s.ptronhand::numeric; end if;
  if result.match ~ '^[0-9]+([.][0-9]+)?%?$' then
    result.loc_match_qty:=coalesce(nullif(s.loc_match_qty,''),(qty*replace(result.match,'%','')::numeric/100)::text);
  end if;
  return result;
end $fn$;
revoke all on function suspend_tag_private.existing_review(public.ph_soc_master) from public,anon,authenticated;
grant execute on function suspend_tag_private.existing_review(public.ph_soc_master) to service_role;

CREATE OR REPLACE FUNCTION suspend_tag_private.command(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; was_denied boolean; event_id uuid; approval_id uuid; decision text;
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation='approval' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion')) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','canDecide',(a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) and a.status='pending'
      and exists(select 1 from suspend_tag_private.workflows x join public.ph_soc_master r on r.unique_id=x.source_uid
        where x.current_approval_id=a.id and x.status='awaiting_rep' and r.last_updated is not distinct from a.source_revision and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
  if p_operation='rows' then
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]') from public.ph_soc_master r
      where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
  input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
  select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
  if found then
    if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
    return receipt.response;
  end if;
  uid:=p_payload->>'sourceUid';
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
    if a.source_revision is distinct from s.last_updated or w.current_approval_id is distinct from a.id then raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='40001'; end if;
    if a.status<>'pending' then
      if a.status<>(case when decision='approve' then 'approved' else 'denied' end) then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='40001'; end if;
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
    if not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz then raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='40001'; end if;
    if p_expected_version is not null and w.version<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='40001'; end if;
    if w.source_revision is distinct from s.last_updated then
      update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
      update suspend_tag_private.workflows set source_revision=s.last_updated,status='pending',completed_by=null,completed_at=null,current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
    end if;
    if p_operation in ('save','complete') then
      if w.status in ('awaiting_rep','approved') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;
      was_denied:=w.status='denied'; patch:=coalesce(p_payload->'patch','{}');
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','av_note','match','loc_match_qty','initial_ptr'])) then raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
      edited:=jsonb_populate_record(s,patch);
      if p_operation='complete' then edited:=suspend_tag_private.existing_review(edited); end if;
      if p_operation='complete' then perform suspend_tag_private.validate_review(edited); end if;
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr where unique_id=uid returning * into s;
      -- Share evidence only; each physical tag keeps its own completion/approval state.
      update public.ph_soc_master sibling set
        dock_photo_link=coalesce(nullif(s.dock_photo_link,''),sibling.dock_photo_link),
        dock_photo_name=coalesce(nullif(s.dock_photo_name,''),sibling.dock_photo_name),
        dock_spec=coalesce(nullif(s.dock_spec,''),sibling.dock_spec),
        av_note=coalesce(nullif(s.av_note,''),sibling.av_note),
        match=coalesce(nullif(s.match,''),sibling.match)
      where sibling.itemcode=s.itemcode and sibling.unique_id<>uid
        and suspend_tag_private.eligible(sibling.suspend,sibling.suspend_to)
        and sibling.date_completed is null
        and not exists(select 1 from suspend_tag_private.workflows locked
          where locked.source_uid=sibling.unique_id and locked.status in ('awaiting_rep','approved'));
      -- Sync only the exact inventory identity; lifecycle state stays in Suspend Tag.
      update public.ph_master_inventory m set spec=coalesce(nullif(s.dock_spec,''),m.spec),caliper=coalesce(nullif(s.dock_caliper,''),m.caliper),
        av_note=coalesce(nullif(s.av_note,''),m.av_note),match=coalesce(nullif(s.match,''),m.match),
        photo_link=coalesce(nullif(s.dock_photo_link,''),m.photo_link),photo_name=coalesce(nullif(s.dock_photo_name,''),m.photo_name),
        loc_match_qty=coalesce(nullif(s.loc_match_qty,''),m.loc_match_qty),initial_ptr=coalesce(nullif(s.initial_ptr,''),m.initial_ptr)
        where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'');
      if p_operation='complete' then
        update public.ph_soc_master set date_completed=clock_timestamp() where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=s.date_completed,version=version+1,updated_at=now() where source_uid=uid;
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
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $function$

commit;
