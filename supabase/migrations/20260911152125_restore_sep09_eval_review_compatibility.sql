begin;

-- Preserve the Sep 9 manual-assignee contract alongside the current AssignedTo
-- review RPC. Source: 9a29cbe6dbc043a624ffdb6693ea160568a0da34,
-- 20260831030457_eval_work_multi_assignee_v1.sql:create_eval_work_multi_v1.
-- Its dependencies remain intact, including the Sep 2 base INSERT repair.
-- No existing function, table grant, stored work, or migration history is reset.
create function public.create_eval_work_legacy_sep09_v1(p_payload jsonb)
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
  -- The App API supplies authenticated actor and verified evaluator emails.
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'eval_work_create_forbidden';
  end if;
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
  -- A retry originating in a newer open client may reuse its saved create token
  -- after a rollback. Keep that review's already-frozen assignment and recipients.
  if coalesce(work.source_context, '{}'::jsonb) ? 'reviewAssignment' then
    return work;
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

revoke all on function public.create_eval_work_legacy_sep09_v1(jsonb) from public, anon, authenticated;
grant execute on function public.create_eval_work_legacy_sep09_v1(jsonb) to service_role;
comment on function public.create_eval_work_legacy_sep09_v1(jsonb) is
  'Service-only Sep 9 manual-assignee creation contract. Preserves baseline actor, token, source, inquiry and recipient checks; frozen modern review retries remain unchanged.';

commit;
