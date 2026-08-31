begin;

alter table public.ph_eval_work
  add column if not exists assignee_usernames text[] not null default '{}'::text[],
  add column if not exists assignee_profiles jsonb not null default '[]'::jsonb;

update public.ph_eval_work
set assignee_usernames = array[lower(trim(assignee_username))],
    assignee_profiles = jsonb_build_array(jsonb_build_object(
      'username', lower(trim(assignee_username)),
      'display', assignee_display,
      'email', lower(trim(assignee_email))
    ))
where cardinality(assignee_usernames) = 0
   or jsonb_array_length(assignee_profiles) = 0;

alter table public.ph_eval_work
  add constraint ph_eval_work_assignee_usernames_count_check
    check (cardinality(assignee_usernames) between 1 and 20),
  add constraint ph_eval_work_assignee_profiles_check
    check (jsonb_typeof(assignee_profiles) = 'array' and jsonb_array_length(assignee_profiles) between 1 and 20);

create index if not exists ph_eval_work_assignee_usernames_gin_idx
  on public.ph_eval_work using gin (assignee_usernames);

drop policy if exists "Authorized users read Eval Work" on public.ph_eval_work;
create policy "Authorized users read Eval Work"
on public.ph_eval_work for select to authenticated
using (
  lower((private.current_active_profile()).username) in ('dylan_collyge', 'megan_kelly')
  or lower((private.current_active_profile()).username) = any(assignee_usernames)
);

drop policy if exists "Authorized users read Eval Work events" on public.ph_eval_work_events;
create policy "Authorized users read Eval Work events"
on public.ph_eval_work_events for select to authenticated
using (
  exists (
    select 1
    from public.ph_eval_work work
    where work.id = ph_eval_work_events.eval_work_id
      and (
        lower((private.current_active_profile()).username) in ('dylan_collyge', 'megan_kelly')
        or lower((private.current_active_profile()).username) = any(work.assignee_usernames)
      )
  )
);

create or replace function private.eval_work_normalize_assignees_v1(p_assignees jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  entry jsonb;
  actor public.profiles;
  username_value text;
  email_value text;
  usernames text[] := '{}'::text[];
  emails text[] := '{}'::text[];
  profiles jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_assignees, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_assignees) < 1
     or jsonb_array_length(p_assignees) > 20 then
    raise exception using errcode = '22023', message = 'eval_work_assignees_invalid';
  end if;
  for entry in select value from jsonb_array_elements(p_assignees) loop
    username_value := lower(trim(coalesce(entry->>'username', '')));
    email_value := lower(trim(coalesce(entry->>'email', '')));
    actor := private.eval_work_assert_actor_v1(username_value);
    if username_value = any(usernames) then
      raise exception using errcode = '22023', message = 'eval_work_assignee_duplicate';
    end if;
    if email_value !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'eval_work_assignee_email_invalid';
    end if;
    usernames := array_append(usernames, username_value);
    emails := array_append(emails, email_value);
    profiles := profiles || jsonb_build_array(jsonb_build_object(
      'username', username_value,
      'display', coalesce(nullif(actor.display_name, ''), actor.username),
      'email', email_value
    ));
  end loop;
  return jsonb_build_object('usernames', to_jsonb(usernames), 'emails', to_jsonb(emails), 'profiles', profiles);
end
$function$;

create or replace function public.create_eval_work_multi_v1(p_payload jsonb)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized jsonb := private.eval_work_normalize_assignees_v1(p_payload->'assignees');
  usernames text[];
  emails text[];
  profiles jsonb;
  primary_assignee jsonb;
  assignment_recipients text[];
  work public.ph_eval_work;
begin
  select array_agg(value order by ordinality) into usernames
  from jsonb_array_elements_text(normalized->'usernames') with ordinality;
  select array_agg(value order by ordinality) into emails
  from jsonb_array_elements_text(normalized->'emails') with ordinality;
  profiles := normalized->'profiles';
  primary_assignee := profiles->0;
  work := public.create_eval_work_v1(p_payload || jsonb_build_object(
    'assigneeUsername', primary_assignee->>'username',
    'assigneeEmail', primary_assignee->>'email'
  ));
  if cardinality(work.assignee_usernames) > 0 and work.assignee_usernames is distinct from usernames then
    raise exception using errcode = '40001', message = 'eval_work_create_token_assignees_conflict';
  end if;
  select array_agg(distinct value order by value) into assignment_recipients
  from unnest(private.eval_work_required_manager_emails_v2() || emails) value;
  update public.ph_eval_work
    set assignee_usernames = usernames, assignee_profiles = profiles
    where id = work.id returning * into work;
  update public.ph_request_delivery_outbox
    set payload = payload || jsonb_build_object(
      'assigneeUsernames', to_jsonb(usernames),
      'assignees', profiles,
      'assignmentRecipients', to_jsonb(assignment_recipients)
    ), updated_at = now()
    where event_id = work.assignment_event_id;
  return work;
end
$function$;

create or replace function public.create_eval_work_batch_multi_v2(p_payload jsonb)
returns setof public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized jsonb := private.eval_work_normalize_assignees_v1(p_payload->'assignees');
  usernames text[];
  emails text[];
  profiles jsonb;
  primary_assignee jsonb;
  assignment_recipients text[];
  work public.ph_eval_work;
begin
  select array_agg(value order by ordinality) into usernames
  from jsonb_array_elements_text(normalized->'usernames') with ordinality;
  select array_agg(value order by ordinality) into emails
  from jsonb_array_elements_text(normalized->'emails') with ordinality;
  profiles := normalized->'profiles';
  primary_assignee := profiles->0;
  select array_agg(distinct value order by value) into assignment_recipients
  from unnest(private.eval_work_required_manager_emails_v2() || emails) value;
  for work in
    select * from public.create_eval_work_batch_v2(p_payload || jsonb_build_object(
      'assigneeUsername', primary_assignee->>'username',
      'assigneeEmail', primary_assignee->>'email'
    ))
  loop
    if cardinality(work.assignee_usernames) > 0 and work.assignee_usernames is distinct from usernames then
      raise exception using errcode = '40001', message = 'eval_work_create_token_assignees_conflict';
    end if;
    update public.ph_eval_work
      set assignee_usernames = usernames, assignee_profiles = profiles
      where id = work.id returning * into work;
    update public.ph_request_delivery_outbox
      set payload = payload || jsonb_build_object(
        'assigneeUsernames', to_jsonb(usernames),
        'assignees', profiles,
        'assignmentRecipients', to_jsonb(assignment_recipients)
      ), updated_at = now()
      where event_id = work.assignment_event_id;
    return next work;
  end loop;
  return;
end
$function$;

create or replace function public.reassign_eval_work_v2(p_payload jsonb)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized jsonb := private.eval_work_normalize_assignees_v1(p_payload->'assignees');
  usernames text[];
  emails text[];
  profiles jsonb;
  primary_assignee jsonb;
  assignment_recipients text[];
  work public.ph_eval_work;
begin
  select array_agg(value order by ordinality) into usernames
  from jsonb_array_elements_text(normalized->'usernames') with ordinality;
  select array_agg(value order by ordinality) into emails
  from jsonb_array_elements_text(normalized->'emails') with ordinality;
  profiles := normalized->'profiles';
  primary_assignee := profiles->0;
  work := public.reassign_eval_work_v1(
    (p_payload->>'workId')::uuid,
    p_payload->>'actorUsername',
    (p_payload->>'expectedVersion')::integer,
    primary_assignee->>'username',
    primary_assignee->>'email'
  );
  select array_agg(distinct value order by value) into assignment_recipients
  from unnest(private.eval_work_required_manager_emails_v2() || emails) value;
  update public.ph_eval_work
    set assignee_usernames = usernames, assignee_profiles = profiles
    where id = work.id returning * into work;
  update public.ph_request_delivery_outbox
    set payload = payload || jsonb_build_object(
      'assigneeUsernames', to_jsonb(usernames),
      'assignees', profiles,
      'assignmentRecipients', to_jsonb(assignment_recipients)
    ), updated_at = now()
    where event_id = work.assignment_event_id;
  return work;
end
$function$;

revoke all on function private.eval_work_normalize_assignees_v1(jsonb) from public, anon, authenticated;
revoke all on function public.create_eval_work_multi_v1(jsonb) from public, anon, authenticated;
revoke all on function public.create_eval_work_batch_multi_v2(jsonb) from public, anon, authenticated;
revoke all on function public.reassign_eval_work_v2(jsonb) from public, anon, authenticated;
grant execute on function private.eval_work_normalize_assignees_v1(jsonb) to service_role;
grant execute on function public.create_eval_work_multi_v1(jsonb) to service_role;
grant execute on function public.create_eval_work_batch_multi_v2(jsonb) to service_role;
grant execute on function public.reassign_eval_work_v2(jsonb) to service_role;

comment on column public.ph_eval_work.assignee_usernames is
  'Authoritative normalized Eval Work evaluator membership. The singular assignee columns remain the compatibility lead evaluator.';
comment on column public.ph_eval_work.assignee_profiles is
  'Creation or reassignment snapshot of evaluator username, display name, and email for deterministic delivery.';

commit;
