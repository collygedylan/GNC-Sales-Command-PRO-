begin;
set local lock_timeout = '5s';

-- Private workflow state is never writable through the Data API. Source data
-- remains in SOC; each sent approval keeps an immutable review snapshot.
create schema if not exists suspend_tag_private;
create table suspend_tag_private.workflows (
  source_uid text primary key,
  source_revision timestamptz,
  version bigint not null default 0,
  status text not null default 'pending' check (status in ('pending','completed','awaiting_rep','approved','denied')),
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  current_approval_id uuid,
  round integer not null default 0,
  updated_at timestamptz not null default now()
);
create table suspend_tag_private.approvals (
  id uuid primary key default gen_random_uuid(),
  source_uid text not null,
  source_revision timestamptz,
  round integer not null,
  completed_by uuid not null references public.profiles(id),
  rep_id uuid not null references public.profiles(id),
  snapshot jsonb not null,
  submitter_email text not null,
  rep_email text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','superseded')),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  request_event_id uuid,
  decision_event_id uuid,
  created_at timestamptz not null default now(),
  unique(source_uid,round)
);
create index suspend_tag_approvals_rep_idx on suspend_tag_private.approvals(rep_id,status,created_at);
create table suspend_tag_private.commands (
  actor_id uuid not null references public.profiles(id),
  command_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,command_id)
);
alter table suspend_tag_private.workflows enable row level security;
alter table suspend_tag_private.approvals enable row level security;
alter table suspend_tag_private.commands enable row level security;
create table suspend_tag_private.push_receipts (
  approval_id uuid not null references suspend_tag_private.approvals(id),
  endpoint_hash text not null,
  delivered_at timestamptz not null default now(),
  primary key(approval_id,endpoint_hash)
);
alter table suspend_tag_private.push_receipts enable row level security;
revoke all on all tables in schema suspend_tag_private from public,anon,authenticated;

create or replace function suspend_tag_private.active_profile(p_actor_id uuid)
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id=p_actor_id;
  if p.id is null or p.username is null or p.disabled_at is not null or p.must_change_password is distinct from false
     or (p.locked_until is not null and p.locked_until>now())
     or private.scheduled_handover_cutoff_reached_v1(p.username,now())
     or (p.legacy_user_id is not null and not exists(select 1 from public.ph_app_users u
       where u.id=p.legacy_user_id and u.username=p.username and u.disabled_at is null
       and (u.locked_until is null or u.locked_until<=now()))) then
    raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
  end if;
  return p;
end $$;

create or replace function suspend_tag_private.actor(p_actor_id uuid)
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; claims jsonb := auth.jwt();
begin
  if not private.is_service_role_request() then
    if p_actor_id is distinct from auth.uid() or auth.uid() is null
       or claims->>'iss' is distinct from 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1'
       or claims->>'role' is distinct from 'authenticated'
       or coalesce((claims->>'exp')::numeric,0) <= extract(epoch from now())
       or not exists (select 1 from auth.sessions s where s.id::text=claims->>'session_id'
         and s.user_id=p_actor_id and (s.not_after is null or s.not_after>now())) then
      raise exception 'SUSPEND_TAG_SESSION_REQUIRED' using errcode='42501';
    end if;
  end if;
  return suspend_tag_private.active_profile(p_actor_id);
end $$;

create or replace function suspend_tag_private.can_edit()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  p:=suspend_tag_private.actor(auth.uid());
  return p.username in ('dylan_collyge','megan_kelly','dan_mccuistion');
exception when insufficient_privilege then return false;
end $$;
create or replace function suspend_tag_private.eligible(p_suspend text,p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_suspend,'') ~* '^[[:space:]  -     　﻿]*[sſ]uspend[[:space:]  -     　﻿]*$'
     and regexp_replace(lower(coalesce(p_to,'')),'[^a-z0-9]+','','g')='dc'
$$;
create or replace function suspend_tag_private.editable(p_uid text,p_revision timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from suspend_tag_private.workflows w where w.source_uid=p_uid
    and w.source_revision is not distinct from p_revision and w.status in ('awaiting_rep','approved'))
$$;

-- Only an original successful completion receipt with an exact source revision
-- and timestamp proves who completed a legacy row. Everything else needs review.
do $backfill$
begin
  if to_regclass('suspend_tag_private.completion_commands') is not null then
    execute $sql$
      insert into suspend_tag_private.workflows(source_uid,source_revision,status,completed_by,completed_at)
      select distinct on(s.unique_id) s.unique_id,s.last_updated,'completed',p.id,s.date_completed
      from public.ph_soc_master s join suspend_tag_private.completion_commands c on c.source_uid=s.unique_id
        and c.source_last_updated is not distinct from s.last_updated and c.completed_at=s.date_completed
      join public.profiles p on p.id=c.actor_id
      where c.response->>'alreadyCompleted'='false' and s.date_completed is not null
        and p.username in ('dylan_collyge','megan_kelly','dan_mccuistion')
        and suspend_tag_private.eligible(s.suspend,s.suspend_to)
      order by s.unique_id,c.created_at
      on conflict do nothing
    $sql$;
  end if;
end $backfill$;
revoke all on public.ph_soc_master from anon;
alter table public.ph_soc_master enable row level security;
revoke update on public.ph_soc_master from authenticated;
grant select on public.ph_soc_master to authenticated;
grant update(dock_spec,dock_caliper,dock_note,dock_photo_link,dock_photo_name,av_note,match,loc_match_qty,initial_ptr)
  on public.ph_soc_master to authenticated;
create policy suspend_tag_read on public.ph_soc_master for select to authenticated
  using ((select suspend_tag_private.can_edit()) and suspend_tag_private.eligible(suspend,suspend_to));
create policy suspend_tag_review_update on public.ph_soc_master for update to authenticated
  using ((select suspend_tag_private.can_edit()) and suspend_tag_private.eligible(suspend,suspend_to)
    and suspend_tag_private.editable(unique_id,last_updated))
  with check ((select suspend_tag_private.can_edit()) and suspend_tag_private.eligible(suspend,suspend_to)
    and suspend_tag_private.editable(unique_id,last_updated));

create or replace function suspend_tag_private.row_json(p_uid text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) || jsonb_build_object(
    'suspend_tag_status',case when w.source_revision is not distinct from s.last_updated then coalesce(w.status,case when s.date_completed is null then 'pending' else 'completed' end)
      else case when s.date_completed is null then 'pending' else 'completed' end end,
    'suspend_tag_version',coalesce(w.version,0),
    'suspend_tag_approval_id',case when w.source_revision is not distinct from s.last_updated then w.current_approval_id end,
    'suspend_tag_completed_by',case when w.source_revision is not distinct from s.last_updated then p.username end,
    'suspend_tag_delivery_status',o.status,
    'suspend_tag_email_delivered_at',o.email_delivered_at,
    'suspend_tag_push_delivered_at',o.push_delivered_at)
  from public.ph_soc_master s left join suspend_tag_private.workflows w on w.source_uid=s.unique_id
  left join public.profiles p on p.id=w.completed_by
  left join suspend_tag_private.approvals a on a.id=w.current_approval_id
  left join public.ph_request_delivery_outbox o on o.event_id=a.request_event_id where s.unique_id=p_uid
$$;

-- Direct review PATCHes retain the same grants as the UI save path, but cannot
-- mutate a frozen round or leave a previously completed review looking current.
create or replace function suspend_tag_private.review_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(new.dock_spec,new.dock_caliper,new.dock_note,new.dock_photo_link,new.dock_photo_name,new.av_note,new.match,new.loc_match_qty,new.initial_ptr)
     is distinct from row(old.dock_spec,old.dock_caliper,old.dock_note,old.dock_photo_link,old.dock_photo_name,old.av_note,old.match,old.loc_match_qty,old.initial_ptr)
     and suspend_tag_private.eligible(new.suspend,new.suspend_to) then
    if not private.is_service_role_request() and auth.uid() is not null and not suspend_tag_private.editable(old.unique_id,old.last_updated) then
      raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501';
    end if;
    insert into suspend_tag_private.workflows(source_uid,source_revision) values(new.unique_id,new.last_updated) on conflict do nothing;
    update suspend_tag_private.workflows set version=version+1,updated_at=now(),
      status=case when status='completed' then 'pending' else status end
      where source_uid=new.unique_id and source_revision is not distinct from new.last_updated;
    if exists(select 1 from suspend_tag_private.workflows where source_uid=new.unique_id and status in ('pending','denied')) then new.date_completed:=null; end if;
  end if;
  return new;
end $$;
create trigger suspend_tag_review_changed before update on public.ph_soc_master for each row execute function suspend_tag_private.review_changed();

-- Wake the existing SOC dataset revision/realtime path when only private
-- approval or delivery metadata changes. Review values remain untouched.
create or replace function suspend_tag_private.signal_source_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid text;
begin
  if pg_trigger_depth()>1 then return new; end if;
  if tg_table_schema='suspend_tag_private' then uid:=new.source_uid;
  else select source_uid into uid from suspend_tag_private.approvals where request_event_id=new.event_id; end if;
  if uid is not null then update public.ph_soc_master set date_completed=date_completed where unique_id=uid; end if;
  return new;
end $$;
create trigger suspend_tag_workflow_signal after update on suspend_tag_private.workflows
  for each row execute function suspend_tag_private.signal_source_change();
create trigger suspend_tag_delivery_signal after update of status,email_delivered_at,push_delivered_at on public.ph_request_delivery_outbox
  for each row when(new.event_type='suspend_tag_approval_requested') execute function suspend_tag_private.signal_source_change();

create or replace function suspend_tag_private.validate_review(s public.ph_soc_master)
returns void language plpgsql stable set search_path = '' as $$
declare hold_code text:=coalesce(s.holdstopcode,''); pct numeric;
begin
  if nullif(btrim(s.dock_photo_link),'') is null then raise exception 'SUSPEND_TAG_PHOTO_REQUIRED' using errcode='22023'; end if;
  if coalesce(s.match,'') !~ '^\s*[0-9]+(\.[0-9]+)?\s*%?\s*$' then raise exception 'SUSPEND_TAG_MATCH_REQUIRED' using errcode='22023'; end if;
  pct:=replace(s.match,'%','')::numeric;
  if pct<0 or pct>100 then raise exception 'SUSPEND_TAG_MATCH_REQUIRED' using errcode='22023'; end if;
  select hold_code || coalesce(string_agg(m.holdstopcode,''),'') into hold_code from public.ph_master_inventory m
    where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'');
  if upper(hold_code) !~ '[HS]' and nullif(btrim(s.av_note),'') is null then raise exception 'SUSPEND_TAG_AV_NOTE_REQUIRED' using errcode='22023'; end if;
end $$;

create or replace function suspend_tag_private.request_approval(p_uid text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w suspend_tag_private.workflows; s public.ph_soc_master; rep public.profiles; sender public.profiles;
  rep_email text; sender_email text; approval_id uuid:=gen_random_uuid(); event_id uuid; rep_key text; matches integer;
begin
  select * into s from public.ph_soc_master where unique_id=p_uid;
  select * into w from suspend_tag_private.workflows where source_uid=p_uid;
  if w.status='awaiting_rep' then return w.current_approval_id; end if;
  if w.status<>'completed' or w.completed_by is null then raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023'; end if;
  perform suspend_tag_private.validate_review(s);
  sender:=suspend_tag_private.active_profile(w.completed_by);
  rep_key:=regexp_replace(lower(coalesce(s.salesrepname,'')),'[^a-z0-9]','','g');
  select count(*) into matches from public.profiles p where rep_key<>'' and
    (regexp_replace(lower(p.username),'[^a-z0-9]','','g')=rep_key or regexp_replace(lower(coalesce(p.display_name,'')),'[^a-z0-9]','','g')=rep_key);
  if matches<>1 then raise exception 'SUSPEND_TAG_REP_EMAIL_MISSING' using errcode='22023'; end if;
  select * into rep from public.profiles p where regexp_replace(lower(p.username),'[^a-z0-9]','','g')=rep_key
    or regexp_replace(lower(coalesce(p.display_name,'')),'[^a-z0-9]','','g')=rep_key;
  rep:=suspend_tag_private.active_profile(rep.id);
  select lower(email) into rep_email from auth.users where id=rep.id and email_confirmed_at is not null;
  select lower(email) into sender_email from auth.users where id=sender.id and email_confirmed_at is not null;
  if coalesce(rep_email,'') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or coalesce(sender_email,'') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'SUSPEND_TAG_RECIPIENT_EMAIL_MISSING' using errcode='22023';
  end if;
  insert into suspend_tag_private.approvals(id,source_uid,source_revision,round,completed_by,rep_id,snapshot,submitter_email,rep_email)
    values(approval_id,p_uid,s.last_updated,w.round+1,sender.id,rep.id,to_jsonb(s)||jsonb_build_object('completed_by_username',sender.username,'completed_by_display',coalesce(sender.display_name,sender.username),'rep_username',rep.username,'rep_display',coalesce(rep.display_name,rep.username)),sender_email,rep_email);
  insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload)
    values('suspend-tag-request:'||approval_id,'suspend_tag_approval_requested',approval_id::text,'suspend-tag-'||approval_id,
      jsonb_build_object('approval_id',approval_id)) returning public.ph_request_delivery_outbox.event_id into event_id;
  update suspend_tag_private.approvals set request_event_id=event_id where id=approval_id;
  update suspend_tag_private.workflows set current_approval_id=approval_id,status='awaiting_rep',round=round+1,version=version+1,updated_at=now() where source_uid=p_uid;
  return approval_id;
end $$;

create or replace function suspend_tag_private.command(p_actor_id uuid,p_operation text,p_payload jsonb,p_command_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; was_denied boolean; event_id uuid; approval_id uuid; decision text;
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
      if p_operation='complete' then perform suspend_tag_private.validate_review(edited); end if;
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr where unique_id=uid returning * into s;
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
      update public.ph_request_delivery_outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null
        where event_id in(select request_event_id from suspend_tag_private.approvals where id=w.current_approval_id) and status='failed';
    else raise exception 'SUSPEND_TAG_OPERATION_INVALID' using errcode='22023';
    end if;
    result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
  end if;
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $$;

create or replace function suspend_tag_private.session_active(p_actor_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id and (not_after is null or not_after>now()))
$$;

create or replace function public.suspend_tag_command_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}',p_command_id uuid default null,p_expected_version bigint default null,p_session_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_service_role_request() then raise exception 'SUSPEND_TAG_SERVICE_REQUIRED' using errcode='42501'; end if;
  if not suspend_tag_private.session_active(p_actor_id,p_session_id) then
    raise exception 'SUSPEND_TAG_SESSION_REQUIRED' using errcode='42501';
  end if;
  return suspend_tag_private.command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_version);
end $$;

-- Older clients retain the RPC signature, but receive the same authorization
-- and completion validation. Their receipts cannot complete a new round.
create or replace function suspend_tag_private.complete(p_source_uid text,p_expected_last_updated timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r:=suspend_tag_private.command(auth.uid(),'complete',jsonb_build_object('sourceUid',p_source_uid,'expectedLastUpdated',p_expected_last_updated),p_request_id,null);
  return jsonb_build_object('ok',true,'sourceUid',p_source_uid,'sourceLastUpdated',r->'row'->'last_updated','expectedLastUpdated',p_expected_last_updated,
    'completedAt',r->'row'->'date_completed','alreadyCompleted',false);
end $$;

-- Service-only delivery preparation resolves frozen recipients and original
-- thread receipts; browser payloads cannot choose mail destinations.
create or replace function public.prepare_suspend_tag_delivery_v1(p_event_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.ph_request_delivery_outbox; a suspend_tag_private.approvals; original public.ph_request_delivery_outbox;
begin
  if not private.is_service_role_request() then raise exception 'DELIVERY_WORKER_FORBIDDEN' using errcode='42501'; end if;
  select * into o from public.ph_request_delivery_outbox where event_id=p_event_id and lease_token=p_lease_token and status='processing';
  if not found then raise exception 'DELIVERY_LEASE_LOST'; end if;
  select * into a from suspend_tag_private.approvals where id=(o.payload->>'approval_id')::uuid;
  if a.id is null then raise exception 'SUSPEND_TAG_SNAPSHOT_MISSING'; end if;
  -- A decision may arrive after Gmail accepted the request but before its
  -- receipt was persisted. Keep that original event recoverable for threading,
  -- including after a denial has already been corrected into the next round.
  if o.event_type='suspend_tag_approval_requested' and a.status not in ('approved','denied') and not exists(select 1 from suspend_tag_private.workflows w join public.ph_soc_master s on s.unique_id=w.source_uid
    where w.current_approval_id=a.id and s.last_updated is not distinct from a.source_revision and a.status='pending' and suspend_tag_private.eligible(s.suspend,s.suspend_to)) then
    update public.ph_request_delivery_outbox set status='suppressed',lease_token=null,lease_owner=null,lease_expires_at=null where event_id=o.event_id;
    return jsonb_build_object('suppressed',true);
  end if;
  select * into original from public.ph_request_delivery_outbox where event_id=a.request_event_id;
  if o.event_type='suspend_tag_approval_decided' and original.email_delivered_at is null then raise exception 'SUSPEND_TAG_ORIGINAL_EMAIL_PENDING'; end if;
  return jsonb_build_object('approval',to_jsonb(a),'thread',jsonb_build_object('threadId',original.gmail_thread_id,'messageId',original.message_id_header));
end $$;

revoke all on all functions in schema suspend_tag_private from public,anon,authenticated;
-- Channel retries skip every endpoint with a confirmed delivery receipt.
create or replace function public.suspend_tag_push_receipt_v1(p_approval_id uuid,p_endpoint text,p_delivered boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_endpoint_hash text:=encode(sha256(convert_to(p_endpoint,'UTF8')),'hex');
begin
  if not private.is_service_role_request() then raise exception 'SUSPEND_TAG_SERVICE_REQUIRED' using errcode='42501'; end if;
  if p_endpoint is null or length(p_endpoint)>4096 then raise exception 'SUSPEND_TAG_REQUEST_INVALID'; end if;
  if p_delivered then
    insert into suspend_tag_private.push_receipts(approval_id,endpoint_hash) values(p_approval_id,v_endpoint_hash) on conflict do nothing;
  end if;
  return exists(select 1 from suspend_tag_private.push_receipts r where r.approval_id=p_approval_id and r.endpoint_hash=v_endpoint_hash);
end $$;
revoke all on function public.suspend_tag_push_receipt_v1(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.suspend_tag_push_receipt_v1(uuid,text,boolean) to service_role;
grant usage on schema suspend_tag_private to authenticated,service_role;
grant execute on function suspend_tag_private.can_edit(),suspend_tag_private.eligible(text,text),suspend_tag_private.editable(text,timestamptz),suspend_tag_private.complete(text,timestamptz,uuid) to authenticated;
grant execute on all functions in schema suspend_tag_private to service_role;
revoke all on function public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid),public.prepare_suspend_tag_delivery_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid),public.prepare_suspend_tag_delivery_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
