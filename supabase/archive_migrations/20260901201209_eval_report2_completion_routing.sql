begin;

alter table public.ph_eval_work
  add column if not exists submitted_by_username text;

comment on column public.ph_eval_work.submitted_by_username is
  'Normalized authenticated evaluator who submitted the completed Item Inquiry. This may differ from the compatibility lead evaluator.';

create or replace function private.eval_work_report2_completion_emails_v4(p_submitter_username text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  with wanted(username) as (
    values ('dylan_collyge'), ('megan_kelly'), ('sharon_combs')
    union all
    select 'jd_jones'
    where private.eval_normalize_user_v2(p_submitter_username) = 'jd_jones'
  )
  select coalesce(array_agg(distinct lower(btrim(u.email)) order by lower(btrim(u.email))), '{}'::text[])
  from wanted w
  join public.profiles p on lower(p.username) = w.username
  join auth.users u on u.id = p.id
  where p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and u.email_confirmed_at is not null
    and btrim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
$function$;

revoke all on function private.eval_work_report2_completion_emails_v4(text)
  from public, anon, authenticated;
grant execute on function private.eval_work_report2_completion_emails_v4(text)
  to service_role;

-- Multi-assignee work keeps the original lead evaluator for compatibility, but
-- any server-validated assigned evaluator must be able to submit as themselves.
-- Patch the retained implementation because the public V2 wrapper delegates the
-- evidence transaction to it.
do $block$
declare
  definition text;
  old_authorization text := 'or lower(work.assignee_username) <> lower(actor.username) then';
  new_authorization text := 'or not (lower(actor.username) = any(coalesce(work.assignee_usernames, array[lower(work.assignee_username)]))) then';
  old_submission text := 'status = ''submitted'',';
  new_submission text := 'status = ''submitted'', submitted_by_username = lower(actor.username),';
begin
  select pg_get_functiondef(
    'public.submit_eval_work_v2_legacy_impl(uuid,text,integer,jsonb,jsonb,text)'::regprocedure
  ) into definition;

  if position(old_authorization in definition) = 0 then
    raise exception 'eval_work_legacy_submit_authorization_clause_not_found';
  end if;
  if position(old_submission in definition) = 0 then
    raise exception 'eval_work_legacy_submit_status_clause_not_found';
  end if;

  definition := replace(definition, old_authorization, new_authorization);
  definition := replace(definition, old_submission, new_submission);
  execute definition;
end
$block$;

create or replace function private.enforce_eval_work_row_resolution_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  context_rows jsonb := coalesce(new.context_rows, '[]'::jsonb);
  overlays jsonb := coalesce(new.submitted_inquiry->'rowOverlays', '[]'::jsonb);
  current_row jsonb;
  overlay jsonb;
  uid text;
  resolution_value text;
  overlay_matches integer;
  required_recipients text[];
  submitter_username text := private.eval_normalize_user_v2(new.submitted_by_username);
  report_context jsonb := coalesce(new.source_context->'report', '{}'::jsonb);
  is_eval_report_2 boolean := false;
  expected_recipient_count integer;
begin
  if new.contract_version <> 'eval-work-v2-multi-origin'
     or new.status <> 'submitted'
     or old.status = 'submitted' then
    return new;
  end if;

  if jsonb_typeof(context_rows) <> 'array'
     or jsonb_typeof(overlays) <> 'array'
     or jsonb_array_length(context_rows) <> new.origin_count
     or jsonb_array_length(overlays) <> new.origin_count then
    raise exception using errcode = '22023', message = 'eval_work_all_rows_resolution_required';
  end if;

  for current_row in select value from jsonb_array_elements(context_rows) loop
    uid := btrim(coalesce(current_row->>'unique_id', ''));
    select count(*)
      into overlay_matches
    from jsonb_array_elements(overlays)
    where btrim(coalesce(value->>'unique_id', '')) = uid;
    select value
      into overlay
    from jsonb_array_elements(overlays)
    where btrim(coalesce(value->>'unique_id', '')) = uid
    limit 1;

    if uid = '' or overlay_matches <> 1 or overlay is null then
      raise exception using errcode = '22023', message = 'eval_work_all_rows_resolution_required';
    end if;

    resolution_value := lower(btrim(coalesce(overlay->>'resolution', '')));
    if resolution_value not in ('done', 'no_action') then
      raise exception using errcode = '22023', message = 'eval_work_row_resolution_invalid';
    end if;
    if resolution_value = 'no_action'
       and jsonb_array_length(coalesce(overlay->'proposals', '[]'::jsonb)) <> 0 then
      raise exception using errcode = '22023', message = 'eval_work_no_action_has_proposals';
    end if;
  end loop;

  is_eval_report_2 := coalesce(report_context->>'sourceMode', '') = 'eval-report-2'
    or (
      coalesce(new.source_context->>'scopeContract', '') = 'itemcode-all-rows-v1'
      and btrim(coalesce(report_context->>'reportId', '')) <> ''
      and coalesce(report_context->>'reportId', '') <> 'drive-mode'
    );

  if is_eval_report_2 then
    if submitter_username = '' then
      raise exception using errcode = '22023', message = 'eval_work_submitter_required';
    end if;
    required_recipients := private.eval_work_report2_completion_emails_v4(submitter_username);
    expected_recipient_count := case when submitter_username = 'jd_jones' then 4 else 3 end;
    if cardinality(required_recipients) <> expected_recipient_count then
      raise exception using errcode = '40001', message = 'eval_work_report2_completion_recipient_unavailable';
    end if;
    new.completion_recipients := required_recipients;
  else
    required_recipients := private.eval_work_required_manager_emails_v2();
    if cardinality(required_recipients) <> 2 then
      raise exception using errcode = '40001', message = 'eval_work_required_manager_recipient_unavailable';
    end if;
    select array_agg(distinct value order by value)
      into new.completion_recipients
    from unnest(coalesce(new.completion_recipients, '{}'::text[]) || required_recipients) value;
  end if;

  return new;
end
$function$;

revoke all on function private.enforce_eval_work_row_resolution_v3()
  from public, anon, authenticated;
grant execute on function private.enforce_eval_work_row_resolution_v3()
  to service_role;

comment on function private.eval_work_report2_completion_emails_v4(text) is
  'Returns the exact verified Eval Reports #2 completion recipients: Dylan, Megan, Sharon, plus JD only when JD submits.';
comment on function private.enforce_eval_work_row_resolution_v3() is
  'Requires one done/no_action disposition per authoritative row and assigns server-authoritative completion recipients for Eval Reports #2.';

commit;
