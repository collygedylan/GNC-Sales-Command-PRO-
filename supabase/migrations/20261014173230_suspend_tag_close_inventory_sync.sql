begin;
set local lock_timeout = '5s';

create or replace function suspend_tag_private.command(p_actor_id uuid,p_operation text,p_payload jsonb,p_command_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; s public.ph_soc_master; initial_s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; master_uid text; source_code text; source_candidate text; non_master_source_labels text[]:=array[
    'DOCK','DOCKS','SOC','EVAL_TASK','EVAL TASK','EVAL_TASKS','EVAL TASKS','SEASON','LOCATION','REQUEST','REQUESTS',
    'FLYER','FLYER_FOLDER','FLYER FOLDER','BLOOM_PICKER','BLOOM PICKER','V2_ACTIVE_REQUEST','V2_MASTER_INVENTORY','V2_SALES_OFFICE'];
  was_denied boolean; event_id uuid; approval_id uuid; decision text; force_review_touch boolean;
  sync_spec boolean; sync_caliper boolean; sync_match boolean; sync_av_note boolean; sync_photo_link boolean; sync_photo_name boolean;
  sync_loc_match_qty boolean; sync_initial_ptr boolean;
  touch_spec boolean; touch_caliper boolean; touch_match boolean; touch_av_note boolean; touch_photo boolean;
  candidate_count integer; matched_inventory public.ph_master_inventory; inventory_row jsonb;
  hold_override boolean; hold_begin_value text; hold_begin_at timestamptz; hold_snapshot text;
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation='approval' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and actor.username not in ('dylan_collyge','megan_kelly','dan_mccuistion')) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','canDecide',a.rep_id=actor.id and a.status='pending'
      and exists(select 1 from suspend_tag_private.workflows x join public.ph_soc_master r on r.unique_id=x.source_uid
        where x.current_approval_id=a.id and x.status='awaiting_rep' and r.last_updated is not distinct from a.source_revision and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','dan_mccuistion') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
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
    if a.id is null or a.rep_id<>actor.id then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    uid:=a.source_uid;
  end if;
  select * into s from public.ph_soc_master where unique_id=uid for update;
  if not found or (p_operation<>'decide' and not suspend_tag_private.eligible(s.suspend,s.suspend_to)) then
    raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002';
  end if;
  initial_s:=s;
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
      if p_operation='complete' then perform suspend_tag_private.validate_review(edited); end if;
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr where unique_id=uid returning * into s;
      if p_operation='complete' then
        update public.ph_soc_master set date_completed=clock_timestamp() where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=s.date_completed,version=version+1,updated_at=now() where source_uid=uid;
        if was_denied then approval_id:=suspend_tag_private.request_approval(uid); end if;
      end if;
    elsif p_operation='close' then
      -- Closing is separate from approval: require persisted evidence, supersede any open review,
      -- and remove the row from Suspend without enqueuing mail or a decision event.
      perform suspend_tag_private.validate_review(s);
      update suspend_tag_private.approvals set status='superseded'
        where id=w.current_approval_id and status='pending';
      update public.ph_soc_master set date_completed=clock_timestamp(),suspend=null,suspend_to=null
        where unique_id=uid returning * into s;
      update suspend_tag_private.workflows set status='completed',completed_by=actor.id,
        completed_at=s.date_completed,current_approval_id=null,version=version+1,updated_at=now()
        where source_uid=uid;
    elsif p_operation='send' then
      approval_id:=suspend_tag_private.request_approval(uid);
    elsif p_operation='retry' then
      if w.current_approval_id is null then raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023'; end if;
      update public.ph_request_delivery_outbox as outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null
        where outbox.event_id in(select request_event_id from suspend_tag_private.approvals where id=w.current_approval_id) and outbox.status='failed';
    else raise exception 'SUSPEND_TAG_OPERATION_INVALID' using errcode='22023';
    end if;
    if p_operation in ('save','complete','close') then
      master_uid:=nullif(btrim(coalesce(to_jsonb(s)->>'master_unique_id',to_jsonb(s)->>'master_id')),'');
      source_code:=null;
      foreach source_candidate in array array[to_jsonb(s)->>'master_source',to_jsonb(s)->>'sourcecode',
        to_jsonb(s)->>'source_code',to_jsonb(s)->>'source'] loop
        source_candidate:=upper(nullif(btrim(source_candidate),''));
        if source_candidate is not null and source_candidate<>all(non_master_source_labels) then
          source_code:=source_candidate; exit;
        end if;
      end loop;
      force_review_touch:=p_operation='complete';
      select count(*) into candidate_count from public.ph_master_inventory m
        where ((master_uid is not null and m.unique_id=master_uid)
           or (master_uid is null and nullif(btrim(s.itemcode),'') is not null
             and nullif(btrim(s.locationcode),'') is not null
             and m.itemcode is not distinct from s.itemcode
             and m.locationcode is not distinct from s.locationcode
             and coalesce(m.lotcode,'')=coalesce(s.lotcode,'')))
          and m.itemcode is not distinct from s.itemcode
          and m.locationcode is not distinct from s.locationcode
          and coalesce(m.lotcode,'')=coalesce(s.lotcode,'')
          and (source_code is null or exists(select 1 from unnest(array[to_jsonb(m)->>'master_source',to_jsonb(m)->>'sourcecode',
            to_jsonb(m)->>'source_code',to_jsonb(m)->>'source']) candidate(value)
            where upper(nullif(btrim(candidate.value),''))=source_code));
      if candidate_count>1 and p_operation in ('complete','close') then
        raise exception 'SUSPEND_TAG_INVENTORY_AMBIGUOUS' using errcode='40001';
      end if;
      if candidate_count=1 then
        select m.* into matched_inventory from public.ph_master_inventory m
          where ((master_uid is not null and m.unique_id=master_uid)
             or (master_uid is null and nullif(btrim(s.itemcode),'') is not null
               and nullif(btrim(s.locationcode),'') is not null
               and m.itemcode is not distinct from s.itemcode
               and m.locationcode is not distinct from s.locationcode
               and coalesce(m.lotcode,'')=coalesce(s.lotcode,'')))
            and m.itemcode is not distinct from s.itemcode
            and m.locationcode is not distinct from s.locationcode
            and coalesce(m.lotcode,'')=coalesce(s.lotcode,'')
            and (source_code is null or exists(select 1 from unnest(array[to_jsonb(m)->>'master_source',to_jsonb(m)->>'sourcecode',
              to_jsonb(m)->>'source_code',to_jsonb(m)->>'source']) candidate(value)
              where upper(nullif(btrim(candidate.value),''))=source_code))
          for update;
        sync_spec:=nullif(s.dock_spec,'') is not null and (s.dock_spec is distinct from initial_s.dock_spec or nullif(matched_inventory.spec,'') is null);
        sync_caliper:=nullif(s.dock_caliper,'') is not null and (s.dock_caliper is distinct from initial_s.dock_caliper or nullif(matched_inventory.caliper,'') is null);
        sync_match:=nullif(s.match,'') is not null and (s.match is distinct from initial_s.match or nullif(matched_inventory.match,'') is null);
        sync_av_note:=nullif(s.av_note,'') is not null and (s.av_note is distinct from initial_s.av_note or nullif(matched_inventory.av_note,'') is null);
        sync_photo_link:=nullif(s.dock_photo_link,'') is not null and (s.dock_photo_link is distinct from initial_s.dock_photo_link or nullif(matched_inventory.photo_link,'') is null);
        sync_photo_name:=nullif(s.dock_photo_name,'') is not null and (s.dock_photo_name is distinct from initial_s.dock_photo_name or nullif(matched_inventory.photo_name,'') is null);
        sync_loc_match_qty:=nullif(s.loc_match_qty,'') is not null and (s.loc_match_qty is distinct from initial_s.loc_match_qty or nullif(matched_inventory.loc_match_qty,'') is null);
        sync_initial_ptr:=nullif(s.initial_ptr,'') is not null and (s.initial_ptr is distinct from initial_s.initial_ptr or nullif(matched_inventory.initial_ptr,'') is null);
        touch_spec:=sync_spec and s.dock_spec is distinct from matched_inventory.spec
          or s.dock_spec is not distinct from matched_inventory.spec and nullif(s.dock_spec,'') is not null and matched_inventory.av_rule_spec_updated_at is null
          or (force_review_touch and s.dock_spec is not distinct from matched_inventory.spec and nullif(s.dock_spec,'') is not null);
        touch_caliper:=sync_caliper and s.dock_caliper is distinct from matched_inventory.caliper
          or s.dock_caliper is not distinct from matched_inventory.caliper and nullif(s.dock_caliper,'') is not null and matched_inventory.av_rule_caliper_updated_at is null
          or (force_review_touch and s.dock_caliper is not distinct from matched_inventory.caliper and nullif(s.dock_caliper,'') is not null);
        touch_match:=sync_match and s.match is distinct from matched_inventory.match
          or s.match is not distinct from matched_inventory.match and nullif(s.match,'') is not null and matched_inventory.av_rule_match_updated_at is null
          or (force_review_touch and s.match is not distinct from matched_inventory.match and nullif(s.match,'') is not null);
        touch_av_note:=sync_av_note and s.av_note is distinct from matched_inventory.av_note
          or s.av_note is not distinct from matched_inventory.av_note and nullif(s.av_note,'') is not null and matched_inventory.av_rule_av_note_updated_at is null
          or (force_review_touch and s.av_note is not distinct from matched_inventory.av_note and nullif(s.av_note,'') is not null);
        touch_photo:=(sync_photo_link and s.dock_photo_link is distinct from matched_inventory.photo_link)
          or (sync_photo_name and s.dock_photo_name is distinct from matched_inventory.photo_name)
          or (s.dock_photo_link is not distinct from matched_inventory.photo_link and nullif(s.dock_photo_link,'') is not null and matched_inventory.av_rule_photo_updated_at is null)
          or (s.dock_photo_name is not distinct from matched_inventory.photo_name and nullif(s.dock_photo_name,'') is not null and matched_inventory.av_rule_photo_updated_at is null)
          or (force_review_touch and (s.dock_photo_link is not distinct from matched_inventory.photo_link
            or s.dock_photo_name is not distinct from matched_inventory.photo_name) and (nullif(s.dock_photo_link,'') is not null or nullif(s.dock_photo_name,'') is not null));
        hold_begin_value:=to_jsonb(matched_inventory)->>'holdstopbegindate';
        hold_begin_at:=null;
        if nullif(btrim(hold_begin_value),'') is not null and upper(btrim(hold_begin_value)) not in ('NULL','N/A','-') then
          begin
            hold_begin_at:=btrim(hold_begin_value)::timestamptz;
          exception when others then
            hold_begin_at:=null;
          end;
        end if;
        hold_override:=matched_inventory.hold_release_approved_at is not null
          and (position('H' in upper(coalesce(matched_inventory.holdstopcode,'')))>0
            or position('S' in upper(coalesce(matched_inventory.holdstopcode,'')))>0)
          and (hold_begin_at is null or hold_begin_at<=matched_inventory.hold_release_approved_at);
        hold_snapshot:=case when hold_override then ''
          when upper(btrim(coalesce(matched_inventory.holdstopcode,''))) in ('NULL','N/A','-') then ''
          else upper(btrim(coalesce(matched_inventory.holdstopcode,''))) end;
        if p_operation='close' then
          inventory_row:=to_jsonb(matched_inventory);
        else
        update public.ph_master_inventory m set
          last_updated=greatest(clock_timestamp(),coalesce(m.last_updated,'-infinity'::timestamptz)+interval '1 microsecond'),
          spec=case when sync_spec then s.dock_spec else m.spec end,
          caliper=case when sync_caliper then s.dock_caliper else m.caliper end,
          av_note=case when sync_av_note then s.av_note else m.av_note end,
          match=case when sync_match then s.match else m.match end,
          photo_link=case when sync_photo_link then s.dock_photo_link else m.photo_link end,
          photo_name=case when sync_photo_name then s.dock_photo_name else m.photo_name end,
          loc_match_qty=case when sync_loc_match_qty then s.loc_match_qty else m.loc_match_qty end,
          initial_ptr=case when sync_initial_ptr then s.initial_ptr else m.initial_ptr end,
          av_rule_priority_snapshot=case when touch_spec or touch_caliper or touch_match or touch_av_note
            then case when upper(btrim(coalesce(m.priority,''))) in ('NULL','N/A','-') then '' else btrim(coalesce(m.priority,'')) end
            else m.av_rule_priority_snapshot end,
          av_rule_holdstop_snapshot=case when touch_spec or touch_caliper or touch_match or touch_av_note
            then hold_snapshot
            else m.av_rule_holdstop_snapshot end,
          av_rule_spec_updated_at=case when touch_spec then greatest(clock_timestamp(),coalesce(m.av_rule_spec_updated_at,'-infinity'::timestamptz)+interval '1 microsecond') else m.av_rule_spec_updated_at end,
          av_rule_caliper_updated_at=case when touch_caliper then greatest(clock_timestamp(),coalesce(m.av_rule_caliper_updated_at,'-infinity'::timestamptz)+interval '1 microsecond') else m.av_rule_caliper_updated_at end,
          av_rule_match_updated_at=case when touch_match then greatest(clock_timestamp(),coalesce(m.av_rule_match_updated_at,'-infinity'::timestamptz)+interval '1 microsecond') else m.av_rule_match_updated_at end,
          av_rule_av_note_updated_at=case when touch_av_note then greatest(clock_timestamp(),coalesce(m.av_rule_av_note_updated_at,'-infinity'::timestamptz)+interval '1 microsecond') else m.av_rule_av_note_updated_at end,
          av_rule_photo_updated_at=case when touch_photo
            then greatest(clock_timestamp(),coalesce(m.av_rule_photo_updated_at,'-infinity'::timestamptz)+interval '1 microsecond') else m.av_rule_photo_updated_at end,
          av_rule_bundle_updated_at=case when touch_spec or touch_caliper or touch_match or touch_av_note or touch_photo
            then greatest(clock_timestamp(),coalesce(m.av_rule_bundle_updated_at,'-infinity'::timestamptz)+interval '1 microsecond') else m.av_rule_bundle_updated_at end
          where m.unique_id=matched_inventory.unique_id returning m.* into matched_inventory;
        inventory_row:=to_jsonb(matched_inventory);
        end if;
      else
        inventory_row:=null;
      end if;
    end if;
    result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid),'inventoryRow',inventory_row);
  end if;
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $$;

commit;
