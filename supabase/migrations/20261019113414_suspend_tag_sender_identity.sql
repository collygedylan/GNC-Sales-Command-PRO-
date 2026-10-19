begin;

-- Preserve the completed worker separately from the authenticated user who
-- explicitly requested the Sales Rep approval email.
alter table suspend_tag_private.approvals
  add column if not exists sent_by uuid references public.profiles(id);
alter table suspend_tag_private.approvals
  add column if not exists decision_message text;

update suspend_tag_private.approvals
   set sent_by = completed_by
 where sent_by is null;

alter table suspend_tag_private.approvals
  alter column sent_by set not null;

create index if not exists suspend_tag_approvals_sender_idx
  on suspend_tag_private.approvals(sent_by, status, created_at desc);

create table if not exists suspend_tag_private.approval_recipients (
  approval_id uuid primary key references suspend_tag_private.approvals(id) on delete cascade,
  request_email text not null check (request_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  decision_emails text[] not null check (cardinality(decision_emails) between 1 and 16),
  created_at timestamptz not null default now()
);
alter table suspend_tag_private.approval_recipients enable row level security;
revoke all on table suspend_tag_private.approval_recipients from public, anon, authenticated;
insert into suspend_tag_private.approval_recipients(approval_id, request_email, decision_emails)
select a.id, lower(a.rep_email), array(
  select distinct lower(r.email)
    from (
      select a.submitter_email as email
      union all
      select u.email
        from public.profiles p join auth.users u on u.id = p.id and u.email_confirmed_at is not null
       where lower(p.username) = any(array['dan_mccuistion','dylan_collyge','megan_kelly','jd_jones'])
    ) r
   where r.email is not null and r.email <> ''
)
  from suspend_tag_private.approvals a
on conflict (approval_id) do update set
  request_email = excluded.request_email,
  decision_emails = excluded.decision_emails;

do $$
begin
  if exists (
    select required.username
      from (values ('dan_mccuistion'),('dylan_collyge'),('megan_kelly'),('jd_jones')) as required(username)
      left join public.profiles p on lower(p.username) = required.username
      left join auth.users u on u.id = p.id and u.email_confirmed_at is not null
     where p.id is null or u.email is null or u.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  ) then
    raise exception 'SUSPEND_TAG_APPROVAL_RECIPIENTS_NOT_READY';
  end if;
end;
$$;

create or replace function suspend_tag_private.capture_decision_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'denied') then
    new.decision_message := nullif(left(btrim(coalesce(current_setting('app.suspend_tag_decision_message', true), '')), 1000), '');
  end if;
  return new;
end;
$$;
revoke all on function suspend_tag_private.capture_decision_message() from public, anon, authenticated;
drop trigger if exists suspend_tag_capture_decision_message on suspend_tag_private.approvals;
create trigger suspend_tag_capture_decision_message
before update of status on suspend_tag_private.approvals
for each row execute function suspend_tag_private.capture_decision_message();

-- `request_approval` runs inside the private command transaction. The only
-- service-role entry point first validates the user's live session, then sets
-- this transaction-local actor context. Legacy authenticated callers use
-- auth.uid(); never silently fall back to the worker who completed the tag.
create or replace function suspend_tag_private.request_approval(p_uid text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  w suspend_tag_private.workflows;
  s public.ph_soc_master;
  rep public.profiles;
  sender public.profiles;
  completer public.profiles;
  sender_id uuid;
  rep_email text;
  sender_email text;
  target_username text;
  target_id uuid;
  target_email text;
  decision_emails text[] := array[]::text[];
  approval_id uuid := gen_random_uuid();
  event_id uuid;
  rep_key text;
  matches integer;
begin
  select * into s from public.ph_soc_master where unique_id = p_uid;
  select * into w from suspend_tag_private.workflows where source_uid = p_uid;
  if w.status = 'awaiting_rep' then return w.current_approval_id; end if;
  if w.status <> 'completed' or w.completed_by is null then
    raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode = '22023';
  end if;
  perform suspend_tag_private.validate_review(s);

  sender_id := nullif(current_setting('app.suspend_tag_actor_id', true), '')::uuid;
  if sender_id is null then sender_id := auth.uid(); end if;
  if sender_id is null then raise exception 'SUSPEND_TAG_SENDER_REQUIRED' using errcode = '42501'; end if;
  sender := suspend_tag_private.active_profile(sender_id);
  completer := suspend_tag_private.active_profile(w.completed_by);

  rep_key := regexp_replace(lower(coalesce(s.salesrepname, '')), '[^a-z0-9]', '', 'g');
  select count(*) into matches from public.profiles p where rep_key <> '' and
    (regexp_replace(lower(p.username), '[^a-z0-9]', '', 'g') = rep_key
      or regexp_replace(lower(coalesce(p.display_name, '')), '[^a-z0-9]', '', 'g') = rep_key);
  if matches <> 1 then raise exception 'SUSPEND_TAG_REP_EMAIL_MISSING' using errcode = '22023'; end if;
  select * into rep from public.profiles p where
    regexp_replace(lower(p.username), '[^a-z0-9]', '', 'g') = rep_key
    or regexp_replace(lower(coalesce(p.display_name, '')), '[^a-z0-9]', '', 'g') = rep_key;
  rep := suspend_tag_private.active_profile(rep.id);
  select lower(email) into rep_email from auth.users where id = rep.id and email_confirmed_at is not null;
  select lower(email) into sender_email from auth.users where id = sender.id and email_confirmed_at is not null;
  if coalesce(rep_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
      or coalesce(sender_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'SUSPEND_TAG_RECIPIENT_EMAIL_MISSING' using errcode = '22023';
  end if;

  -- Freeze the request to the assigned Rep only. Freeze the response thread
  -- to the configured decision team plus the authenticated sender.
  decision_emails := array[sender_email];
  foreach target_username in array array['dan_mccuistion', 'dylan_collyge', 'megan_kelly', 'jd_jones'] loop
    select count(*) into matches from public.profiles p where lower(p.username) = lower(target_username);
    if matches <> 1 then raise exception 'SUSPEND_TAG_APPROVAL_RECIPIENT_MISSING' using errcode = '22023'; end if;
    select p.id, lower(u.email) into target_id, target_email
      from public.profiles p join auth.users u on u.id = p.id
     where lower(p.username) = lower(target_username) and u.email_confirmed_at is not null;
    if target_id is null or coalesce(target_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      raise exception 'SUSPEND_TAG_APPROVAL_RECIPIENT_MISSING' using errcode = '22023';
    end if;
    perform suspend_tag_private.active_profile(target_id);
    if not (target_email = any(decision_emails)) then decision_emails := array_append(decision_emails, target_email); end if;
    target_id := null;
    target_email := null;
  end loop;

  insert into suspend_tag_private.approvals(
    id, source_uid, source_revision, round, completed_by, sent_by, rep_id,
    snapshot, submitter_email, rep_email
  ) values (
    approval_id, p_uid, s.last_updated, w.round + 1, completer.id, sender.id, rep.id,
    to_jsonb(s) || jsonb_build_object(
      'completed_by_username', completer.username,
      'completed_by_display', coalesce(completer.display_name, completer.username),
      'sent_by_username', sender.username,
      'sent_by_display', coalesce(sender.display_name, sender.username),
      'rep_username', rep.username,
      'rep_display', coalesce(rep.display_name, rep.username)
    ),
    sender_email,
    rep_email
  );
  insert into suspend_tag_private.approval_recipients(approval_id, request_email, decision_emails)
    values(approval_id, rep_email, decision_emails);
  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, request_folder, payload)
    values('suspend-tag-request:' || approval_id, 'suspend_tag_approval_requested', approval_id::text,
      'suspend-tag-' || approval_id, jsonb_build_object('approval_id', approval_id))
    returning public.ph_request_delivery_outbox.event_id into event_id;
  update suspend_tag_private.approvals set request_event_id = event_id where id = approval_id;
  update suspend_tag_private.workflows
     set current_approval_id = approval_id, status = 'awaiting_rep', round = round + 1,
         version = version + 1, updated_at = now()
   where source_uid = p_uid;
  return approval_id;
end;
$$;

-- This service-role-only RPC validates the authenticated session before
-- binding its actor id for the nested private command. `set_config(..., true)`
-- is transaction-local and cannot leak between pooled requests.
create or replace function public.suspend_tag_command_v1(
  p_actor_id uuid,
  p_operation text,
  p_payload jsonb default '{}',
  p_command_id uuid default null,
  p_expected_version bigint default null,
  p_session_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_service_role_request() then
    raise exception 'SUSPEND_TAG_SERVICE_REQUIRED' using errcode = '42501';
  end if;
  if not suspend_tag_private.session_active(p_actor_id, p_session_id) then
    raise exception 'SUSPEND_TAG_SESSION_REQUIRED' using errcode = '42501';
  end if;
  perform set_config('app.suspend_tag_actor_id', p_actor_id::text, true);
  if p_operation = 'decide' then
    if jsonb_typeof(p_payload) <> 'object'
      or (p_payload ? 'decisionMessage' and jsonb_typeof(p_payload->'decisionMessage') not in ('string', 'null'))
      or char_length(coalesce(p_payload->>'decisionMessage', '')) > 1000 then
      raise exception 'SUSPEND_TAG_DECISION_MESSAGE_INVALID' using errcode = '22023';
    end if;
    perform set_config('app.suspend_tag_decision_message', coalesce(p_payload->>'decisionMessage', ''), true);
  end if;
  return suspend_tag_private.command(p_actor_id, p_operation, p_payload, p_command_id, p_expected_version);
end;
$$;

comment on column suspend_tag_private.approvals.sent_by is
  'Active profile that explicitly sent this approval round; completed_by remains the profile that completed the tag.';

create or replace function public.prepare_suspend_tag_delivery_v1(p_event_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.ph_request_delivery_outbox;
  a suspend_tag_private.approvals;
  original public.ph_request_delivery_outbox;
  recipients text[];
begin
  if not private.is_service_role_request() then raise exception 'DELIVERY_WORKER_FORBIDDEN' using errcode = '42501'; end if;
  select * into o from public.ph_request_delivery_outbox
   where event_id = p_event_id and lease_token = p_lease_token and status = 'processing';
  if not found then raise exception 'DELIVERY_LEASE_LOST'; end if;
  select * into a from suspend_tag_private.approvals where id = (o.payload->>'approval_id')::uuid;
  if a.id is null then raise exception 'SUSPEND_TAG_SNAPSHOT_MISSING'; end if;
  if o.event_type = 'suspend_tag_approval_requested' and a.status not in ('approved','denied')
     and not exists(select 1 from suspend_tag_private.workflows w join public.ph_soc_master s on s.unique_id = w.source_uid
       where w.current_approval_id = a.id and s.last_updated is not distinct from a.source_revision
         and a.status = 'pending' and suspend_tag_private.eligible(s.suspend,s.suspend_to)) then
    update public.ph_request_delivery_outbox set status = 'suppressed', lease_token = null, lease_owner = null, lease_expires_at = null where event_id = o.event_id;
    return jsonb_build_object('suppressed', true);
  end if;
  select * into original from public.ph_request_delivery_outbox where event_id = a.request_event_id;
  if o.event_type = 'suspend_tag_approval_decided' and original.email_delivered_at is null then
    raise exception 'SUSPEND_TAG_ORIGINAL_EMAIL_PENDING';
  end if;
  select case
      when o.event_type = 'suspend_tag_approval_requested' then array[r.request_email]
      else r.decision_emails
    end
    into recipients
    from suspend_tag_private.approval_recipients r where r.approval_id = a.id;
  if recipients is null or cardinality(recipients) < 1 then raise exception 'SUSPEND_TAG_RECIPIENTS_MISSING'; end if;
  return jsonb_build_object(
    'approval', to_jsonb(a),
    'deliveryRecipients', to_jsonb(recipients),
    'decisionMessage', coalesce(a.decision_message, ''),
    'thread', jsonb_build_object('threadId', original.gmail_thread_id, 'messageId', original.message_id_header)
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
