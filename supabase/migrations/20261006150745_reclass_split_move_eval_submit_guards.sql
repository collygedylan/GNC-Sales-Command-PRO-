begin;

alter table public.ph_eval_work
  add column if not exists submission_request_fingerprint text;

alter function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)
  rename to submit_eval_work_legacy_v1;
alter function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)
  rename to submit_eval_work_legacy_v2;

create or replace function public.submit_eval_work_v1(
  p_work_id uuid, p_actor_username text, p_expected_version integer,
  p_inquiry jsonb, p_evidence jsonb, p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  final_inquiry jsonb;
  current_rows jsonb;
  fingerprint text;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or lower(work.assignee_username) <> lower(actor.username) then
    raise exception using errcode = '42501', message = 'eval_work_submit_forbidden';
  end if;
  final_inquiry := coalesce(p_inquiry,work.inquiry_draft);
  if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if coalesce(final_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v4-split-moves-20261006' then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
    if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
      if work.submission_request_fingerprint is distinct from fingerprint then
        raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
      end if;
      return work;
    end if;
    if work.status not in ('open','in_progress') or work.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'eval_work_version_conflict';
    end if;
    current_rows := private.eval_work_context_rows_v1(work.itemcode);
    perform private.validate_eval_work_inquiry_v4_strict(final_inquiry,work.itemcode,current_rows);
  elsif work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
    return work;
  end if;
  submitted := public.submit_eval_work_legacy_v1(
    p_work_id,p_actor_username,p_expected_version,p_inquiry,p_evidence,p_submission_token
  );
  if fingerprint is not null then
    update public.ph_eval_work set submission_request_fingerprint = fingerprint where id = submitted.id returning * into submitted;
  end if;
  return submitted;
end
$function$;

create or replace function public.submit_eval_work_v2(
  p_work_id uuid, p_actor_username text, p_expected_version integer,
  p_inquiry jsonb, p_evidence_by_origin jsonb, p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  final_inquiry jsonb;
  current_rows jsonb;
  origin_ids text[];
  fingerprint text;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or work.contract_version <> 'eval-work-v2-multi-origin'
     or not (lower(actor.username) = any(coalesce(work.assignee_usernames,array[lower(work.assignee_username)]))) then
    raise exception using errcode = '42501', message = 'eval_work_submit_forbidden';
  end if;
  final_inquiry := coalesce(p_inquiry,work.inquiry_draft);
  if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence_by_origin)::text,'UTF8'),'sha256'),'hex');
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if coalesce(final_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v4-split-moves-20261006' then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence_by_origin)::text,'UTF8'),'sha256'),'hex');
    if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
      if work.submission_request_fingerprint is distinct from fingerprint then
        raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
      end if;
      return work;
    end if;
    if work.status not in ('open','in_progress') or work.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'eval_work_version_conflict';
    end if;
    if coalesce(work.source_context->>'scopeContract','') = 'itemcode-all-rows-v1' then
      current_rows := private.eval_work_assert_itemcode_membership_v1(p_work_id);
    else
      select array_agg(origin_unique_id order by ordinal) into origin_ids
      from public.ph_eval_work_origin_rows where eval_work_id = work.id;
      current_rows := private.eval_work_context_rows_for_origins_v2(origin_ids);
    end if;
    perform private.validate_eval_work_inquiry_v4_strict(final_inquiry,work.itemcode,current_rows);
  elsif work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
    return work;
  end if;
  submitted := public.submit_eval_work_legacy_v2(
    p_work_id,p_actor_username,p_expected_version,p_inquiry,p_evidence_by_origin,p_submission_token
  );
  if fingerprint is not null then
    update public.ph_eval_work set submission_request_fingerprint = fingerprint where id = submitted.id returning * into submitted;
  end if;
  return submitted;
end
$function$;

revoke all on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) to service_role;
revoke all on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) to service_role;
revoke all on function public.submit_eval_work_legacy_v1(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.submit_eval_work_legacy_v2(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
