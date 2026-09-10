begin;

-- Only the authenticated App API calls these functions. No table grants and no
-- historical review/outbox mutations: all decisions are frozen at creation.
create or replace function private.eval_work_review_setup_v1(p_payload jsonb, p_lock boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  origin public.ph_master_inventory;
  assignment public.ph_warehouse_assigned_items;
  assignment_count integer := 0;
  assignment_key_value text;
  assigned_username text;
  assigned_profile public.profiles;
  assigned_email text;
  source_json jsonb;
  evaluator_json jsonb;
  revision_value text;
begin
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly', 'jd_jones')
     or actor.must_change_password then
    raise exception using errcode = '42501', message = 'eval_work_create_forbidden';
  end if;
  if coalesce(p_payload#>>'{source,source_table}', '') <> 'ph_master_inventory' then
    raise exception using errcode = '22023', message = 'REVIEW_SOURCE_STALE';
  end if;
  if p_lock then
    select m.* into origin from public.ph_master_inventory m
    where m.unique_id = btrim(coalesce(p_payload#>>'{source,unique_id}', '')) for share;
  else
    select m.* into origin from public.ph_master_inventory m
    where m.unique_id = btrim(coalesce(p_payload#>>'{source,unique_id}', ''));
  end if;
  if origin.unique_id is null then
    raise exception using errcode = '22023', message = 'REVIEW_SOURCE_MISSING';
  end if;
  if upper(btrim(coalesce(origin.itemcode, ''))) <> upper(btrim(coalesce(p_payload#>>'{source,itemcode}', '')))
     or btrim(coalesce(origin.locationcode, '')) <> btrim(coalesce(p_payload#>>'{source,locationcode}', ''))
     or btrim(coalesce(origin.lotcode, '')) <> btrim(coalesce(p_payload#>>'{source,lotcode}', '')) then
    raise exception using errcode = '22023', message = 'REVIEW_SOURCE_STALE';
  end if;
  assignment_key_value := private.normalize_eval_assignment_key(origin.itemcode, origin.genusname);
  -- This uses idx_ph_warehouse_assigned_key, not an ITEMCODE-wide representative.
  if p_lock then
    for assignment in select a.* from public.ph_warehouse_assigned_items a
      where a.assignment_key = assignment_key_value and a.present_in_drive for share
    loop assignment_count := assignment_count + 1; end loop;
  else
    for assignment in select a.* from public.ph_warehouse_assigned_items a
      where a.assignment_key = assignment_key_value and a.present_in_drive
    loop assignment_count := assignment_count + 1; end loop;
  end if;
  if assignment_count = 0 or btrim(coalesce(assignment.assignedto, '')) = '' then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNMENT_MISSING';
  end if;
  if assignment_count <> 1 or assignment.assignedto ~ '[,;|/]' then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNMENT_AMBIGUOUS';
  end if;
  assigned_username := private.eval_normalize_user_v2(assignment.assignedto);
  -- Same evaluator eligibility as the existing authenticated Eval Work API.
  if assigned_username <> all(array['josh_vann','jorge_colunga','abigail_vazquez','bobby_adair',
      'charley_robertson','ellen_ward','zoe_green','mitch_kaiser','dylan_collyge','megan_kelly',
      'kayla_knepp','jd_jones']) then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNEE_INELIGIBLE';
  end if;
  if p_lock then
    select p.* into assigned_profile from public.profiles p
    where lower(p.username) = assigned_username for share;
  else
    select p.* into assigned_profile from public.profiles p where lower(p.username) = assigned_username;
  end if;
  if assigned_profile.id is null or assigned_profile.disabled_at is not null
     or assigned_profile.locked_until > now() then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNEE_INACTIVE';
  end if;
  if p_lock then
    select lower(btrim(u.email)) into assigned_email from auth.users u where u.id = assigned_profile.id for share;
  else
    select lower(btrim(u.email)) into assigned_email from auth.users u where u.id = assigned_profile.id;
  end if;
  if coalesce(assigned_email, '') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNEE_EMAIL_MISSING';
  end if;
  source_json := jsonb_build_object('unique_id', origin.unique_id, 'source_table', 'ph_master_inventory',
    'itemcode', origin.itemcode, 'genusname', origin.genusname, 'locationcode', origin.locationcode,
    'lotcode', origin.lotcode, 'source', origin.source, 'commonname', origin.commonname, 'contsize', origin.contsize);
  evaluator_json := jsonb_build_object('username', assigned_username,
    'displayName', coalesce(nullif(btrim(assigned_profile.display_name), ''), assigned_profile.username),
    'email', assigned_email);
  revision_value := md5(jsonb_build_array(source_json, assignment_key_value, assignment.assigned_at,
    assigned_profile.id, assigned_username, assigned_email)::text);
  return jsonb_build_object('source', source_json, 'evaluator', evaluator_json,
    'assignmentRevision', revision_value, 'completionRecipients', jsonb_build_array(assigned_email),
    'completionRecipientNames', jsonb_build_array(evaluator_json->>'displayName'));
end
$function$;

create or replace function public.get_eval_work_review_setup_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'eval_work_create_forbidden';
  end if;
  -- No row locks, writes, events, or notifications during setup.
  return private.eval_work_review_setup_v1(p_payload, false);
end
$function$;

-- Clone the FINAL composed v1 body, including the required assignee arrays at
-- INSERT. Do not replace the public base used by legacy/batch entrypoints. Two
-- latent single-review blockers are repaired only in this private clone: the
-- over-escaped email dot and JD's existing App API/UI creator authorization.
do $migration$
declare
  definition text := pg_get_functiondef('public.create_eval_work_v1(jsonb)'::regprocedure);
begin
  if position('normalized_usernames, normalized_profiles' in definition) = 0
     or position('assignee_usernames, assignee_profiles' in definition) = 0 then
    raise exception 'review_base_assignee_insert_contract_missing';
  end if;
  definition := replace(definition, 'public.create_eval_work_v1(', 'private.create_eval_work_review_base_v1(');
  definition := replace(definition, chr(92) || chr(92) || '.', '[.]');
  definition := replace(definition, 'not in (''dylan_collyge'', ''megan_kelly'')',
    'not in (''dylan_collyge'', ''megan_kelly'', ''jd_jones'')');
  execute definition;
end
$migration$;

create or replace function public.create_eval_work_multi_v1(p_payload jsonb)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  token_value text := btrim(coalesce(p_payload->>'createToken', ''));
  setup jsonb;
  evaluator jsonb;
  extras jsonb := coalesce(p_payload->'additionalCompletionRecipients', '[]'::jsonb);
  entry jsonb;
  email_value text;
  recipient_profile public.profiles;
  recipients text[];
  recipient_profiles jsonb;
  assignment_recipients text[];
  work public.ph_eval_work;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'eval_work_create_forbidden';
  end if;
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly', 'jd_jones') or actor.must_change_password then
    raise exception using errcode = '42501', message = 'eval_work_create_forbidden';
  end if;
  if length(token_value) < 16 or length(token_value) > 240 then
    raise exception using errcode = '22023', message = 'eval_work_create_token_invalid';
  end if;
  -- Serialize only retries of this token, never a global creation lock. A retry
  -- returns the frozen work before reading today's assignment or recipients.
  perform pg_advisory_xact_lock(hashtextextended('eval-review-create:' || token_value, 0));
  select w.* into work from public.ph_eval_work w where w.create_token = token_value;
  if work.id is not null then
    if lower(work.creator_username) <> lower(actor.username) then
      raise exception using errcode = '42501', message = 'eval_work_create_token_forbidden';
    end if;
    return work;
  end if;
  if btrim(coalesce(p_payload->>'expectedAssignmentRevision', '')) = '' then
    raise exception using errcode = '22023', message = 'REVIEW_CONFIRMATION_REQUIRED';
  end if;
  setup := private.eval_work_review_setup_v1(p_payload, true);
  if p_payload->>'expectedAssignmentRevision' <> setup->>'assignmentRevision' then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNMENT_CHANGED';
  end if;
  evaluator := setup->'evaluator';
  recipients := array[evaluator->>'email'];
  recipient_profiles := jsonb_build_array(evaluator);
  if jsonb_typeof(extras) <> 'array' or jsonb_array_length(extras) > 100 then
    raise exception using errcode = '22023', message = 'REVIEW_RECIPIENT_INVALID';
  end if;
  for entry in select value from jsonb_array_elements(extras) loop
    if jsonb_typeof(entry) <> 'string' then
      raise exception using errcode = '22023', message = 'REVIEW_RECIPIENT_INVALID';
    end if;
    email_value := lower(btrim(entry #>> '{}'));
    if email_value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'REVIEW_RECIPIENT_INVALID';
    end if;
    if email_value = any(recipients) then continue; end if;
    select p.* into recipient_profile from public.profiles p
    join auth.users u on u.id = p.id
    where lower(btrim(u.email)) = email_value and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now()) for share of p, u;
    if recipient_profile.id is null then
      raise exception using errcode = '22023', message = 'REVIEW_RECIPIENT_INVALID';
    end if;
    recipients := array_append(recipients, email_value);
    recipient_profiles := recipient_profiles || jsonb_build_array(jsonb_build_object(
      'username', lower(recipient_profile.username),
      'displayName', coalesce(nullif(btrim(recipient_profile.display_name), ''), recipient_profile.username),
      'email', email_value));
  end loop;
  -- Construct the base payload from an allowlist. Manual assignees, recipient
  -- arrays, and browser actor fields cannot override the authoritative result.
  work := private.create_eval_work_review_base_v1(jsonb_build_object(
    'actorUsername', lower(actor.username), 'createToken', token_value,
    'source', setup->'source',
    'instructions', p_payload->>'instructions',
    'assigneeUsername', evaluator->>'username', 'assigneeEmail', evaluator->>'email',
    'completionRecipients', to_jsonb(recipients)
  ) || case when p_payload->'inquiry' is null or p_payload->'inquiry' = 'null'::jsonb
       then '{}'::jsonb else jsonb_build_object('inquiry', p_payload->'inquiry') end);
  update public.ph_eval_work set source_context = coalesce(source_context, '{}'::jsonb) ||
    jsonb_build_object('reviewAssignment', jsonb_build_object('evaluator', evaluator,
      'completionRecipients', recipient_profiles, 'assignmentRevision', setup->>'assignmentRevision'))
    where id = work.id returning * into work;
  -- Preserve the existing assignment-copy policy. Use a correctly escaped
  -- address check here without changing the shared batch/completion helper.
  select array_agg(distinct email order by email) into assignment_recipients from (
    select evaluator->>'email' as email
    union all
    select lower(btrim(u.email)) from public.profiles p join auth.users u on u.id = p.id
    where lower(p.username) in ('dylan_collyge','megan_kelly') and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) addresses;
  update public.ph_request_delivery_outbox
    set payload = payload || jsonb_build_object(
      'assigneeUsernames', to_jsonb(work.assignee_usernames), 'assignees', work.assignee_profiles,
      'assignmentRecipients', to_jsonb(assignment_recipients)), updated_at = now()
    where event_id = work.assignment_event_id;
  return work;
end
$function$;

revoke all on function private.eval_work_review_setup_v1(jsonb,boolean) from public, anon, authenticated, service_role;
revoke all on function private.create_eval_work_review_base_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.get_eval_work_review_setup_v1(jsonb) from public, anon, authenticated;
revoke all on function public.create_eval_work_multi_v1(jsonb) from public, anon, authenticated;
grant execute on function public.get_eval_work_review_setup_v1(jsonb) to service_role;
grant execute on function public.create_eval_work_multi_v1(jsonb) to service_role;

commit;
