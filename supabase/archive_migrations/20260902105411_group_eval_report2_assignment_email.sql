begin;

-- A multi-ITEMCODE Eval Reports #2 submission is one user action. Keep one
-- Eval Work record per ITEMCODE, but replace the per-item assignment delivery
-- events with one idempotent envelope. Apps Script renders one PDF for every
-- envelope member and attaches all PDFs to the same email.
create or replace function private.eval_report2_group_assignment_delivery_v1(
  p_work_rows jsonb,
  p_batch_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  work_ids uuid[];
  event_ids uuid[];
  work_count integer := 0;
  event_count integer := 0;
  assignment_payloads jsonb := '[]'::jsonb;
  assignment_recipients text[] := '{}'::text[];
  envelope public.ph_request_delivery_outbox;
  envelope_key text;
  refreshed_rows jsonb := '[]'::jsonb;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'EVAL_WORK_ASSIGNMENT_BATCH_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_work_rows, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'EVAL_WORK_ASSIGNMENT_BATCH_INVALID';
  end if;

  select array_agg(work_id order by first_ordinal)
  into work_ids
  from (
    select (row_payload->>'id')::uuid as work_id, min(ordinality) as first_ordinal
    from jsonb_array_elements(p_work_rows) with ordinality selected(row_payload, ordinality)
    where coalesce(row_payload->>'id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    group by (row_payload->>'id')::uuid
  ) normalized;
  work_count := coalesce(cardinality(work_ids), 0);
  if work_count <= 1 then
    return coalesce(p_work_rows, '[]'::jsonb);
  end if;
  if length(btrim(coalesce(p_batch_token, ''))) < 16
     or length(btrim(coalesce(p_batch_token, ''))) > 240 then
    raise exception using errcode = '22023', message = 'EVAL_WORK_ASSIGNMENT_BATCH_TOKEN_INVALID';
  end if;

  select
    array_agg(distinct work.assignment_event_id) filter (where work.assignment_event_id is not null),
    count(*)::integer
  into event_ids, event_count
  from public.ph_eval_work work
  where work.id = any(work_ids)
    and work.batch_token = btrim(p_batch_token);
  if event_count <> work_count or coalesce(cardinality(event_ids), 0) < 1 then
    raise exception using errcode = '40001', message = 'EVAL_WORK_ASSIGNMENT_BATCH_MEMBERSHIP_CONFLICT';
  end if;

  if cardinality(event_ids) = 1 then
    select * into envelope
    from public.ph_request_delivery_outbox outbox
    where outbox.event_id = event_ids[1]
    for update;
    if envelope.payload->>'contractVersion' = 'eval-work-assignment-batch-v1' then
      select coalesce(jsonb_agg(to_jsonb(work) order by array_position(work_ids, work.id)), '[]'::jsonb)
      into refreshed_rows
      from public.ph_eval_work work
      where work.id = any(work_ids);
      return refreshed_rows;
    end if;
  end if;

  if exists (
    select 1
    from public.ph_request_delivery_outbox outbox
    where outbox.event_id = any(event_ids)
      and (outbox.status = 'processing' or outbox.email_delivered_at is not null or outbox.status = 'delivered')
  ) then
    -- Never regroup an earlier submission that has already started delivery;
    -- doing so could create another message for a historical retry.
    return p_work_rows;
  end if;

  select coalesce(jsonb_agg(outbox.payload order by work.itemcode, work.id), '[]'::jsonb)
  into assignment_payloads
  from public.ph_eval_work work
  join public.ph_request_delivery_outbox outbox
    on outbox.event_id = work.assignment_event_id
   and outbox.event_type = 'eval_work_assignment'
  where work.id = any(work_ids)
    and work.batch_token = btrim(p_batch_token);

  select coalesce(
    array_agg(distinct lower(btrim(recipient.email)) order by lower(btrim(recipient.email))),
    '{}'::text[]
  )
  into assignment_recipients
  from public.ph_eval_work work
  join public.ph_request_delivery_outbox outbox
    on outbox.event_id = work.assignment_event_id
   and outbox.event_type = 'eval_work_assignment'
  cross join lateral jsonb_array_elements_text(
    coalesce(outbox.payload->'assignmentRecipients', '[]'::jsonb)
  ) recipient(email)
  where work.id = any(work_ids)
    and work.batch_token = btrim(p_batch_token)
    and lower(btrim(recipient.email))
      ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';

  if jsonb_array_length(assignment_payloads) <> work_count
     or cardinality(assignment_recipients) < 1 then
    raise exception using errcode = '40001', message = 'EVAL_WORK_ASSIGNMENT_BATCH_PAYLOAD_CONFLICT';
  end if;

  envelope_key := 'eval-report2-batch:' || md5(btrim(p_batch_token)) || ':assignment:v1';
  insert into public.ph_request_delivery_outbox(
    event_key, event_type, request_id, payload, status, next_attempt_at
  ) values (
    envelope_key,
    'eval_work_assignment',
    work_ids[1]::text,
    jsonb_build_object(
      'contractVersion', 'eval-work-assignment-batch-v1',
      'deliveryKind', 'assignment',
      'assignmentCount', work_count,
      'evalWorkIds', to_jsonb(work_ids),
      'assignmentRecipients', to_jsonb(assignment_recipients),
      'assignments', assignment_payloads
    ),
    'pending',
    now()
  )
  on conflict (event_key) do update
    set updated_at = now()
  returning * into envelope;

  if envelope.payload->>'contractVersion' <> 'eval-work-assignment-batch-v1'
     or coalesce((envelope.payload->>'assignmentCount')::integer, 0) <> work_count then
    raise exception using errcode = '40001', message = 'EVAL_WORK_ASSIGNMENT_BATCH_REPLAY_CONFLICT';
  end if;

  update public.ph_request_delivery_outbox outbox
  set status = 'suppressed',
      sanitized_error_code = 'EVAL_WORK_ASSIGNMENT_GROUPED',
      updated_at = now()
  where outbox.event_id = any(event_ids)
    and outbox.event_id <> envelope.event_id
    and outbox.status in ('pending', 'failed', 'unknown');

  update public.ph_eval_work work
  set assignment_event_id = envelope.event_id,
      updated_at = now()
  where work.id = any(work_ids)
    and work.batch_token = btrim(p_batch_token);

  select coalesce(jsonb_agg(to_jsonb(work) order by array_position(work_ids, work.id)), '[]'::jsonb)
  into refreshed_rows
  from public.ph_eval_work work
  where work.id = any(work_ids);
  return refreshed_rows;
end
$function$;

-- Insert the grouping step after the optional JD recipient has been added to
-- each item payload and before the response computes its recipient summary.
do $block$
declare
  definition text;
  anchor text;
  replacement text;
begin
  select pg_get_functiondef('public.create_eval_report2_batch_v1(jsonb)'::regprocedure)
  into definition;
  if position('private.eval_report2_group_assignment_delivery_v1' in definition) > 0 then
    return;
  end if;
  anchor := '  select coalesce(array_agg(distinct lower(btrim(value)) order by lower(btrim(value))), ''{}''::text[])';
  replacement := E'  work_rows := private.eval_report2_group_assignment_delivery_v1(\n    work_rows,\n    p_payload->>''batchToken''\n  );\n\n' || anchor;
  if position(anchor in definition) = 0 then
    raise exception 'eval_report2_batch_assignment_anchor_changed';
  end if;
  execute replace(definition, anchor, replacement);
end
$block$;

-- A shared envelope must finish delivery before one member can be reassigned
-- or cancelled, otherwise the already-built message could describe stale work.
do $block$
declare
  function_name text;
  function_signature regprocedure;
  definition text;
  old_guard text;
  new_guard text;
begin
  old_guard := E'  if exists (\n    select 1 from public.ph_request_delivery_outbox o\n    where o.event_id = work.assignment_event_id and o.status = ''processing''\n  ) then';
  new_guard := E'  if exists (\n    select 1 from public.ph_request_delivery_outbox o\n    where o.event_id = work.assignment_event_id\n      and (\n        o.status = ''processing''\n        or (\n          o.status in (''pending'', ''failed'', ''unknown'')\n          and exists (\n            select 1\n            from public.ph_eval_work sibling\n            where sibling.assignment_event_id = work.assignment_event_id\n              and sibling.id <> work.id\n          )\n        )\n      )\n  ) then';

  foreach function_name in array array['reassign_eval_work_v1', 'cancel_eval_work_v1'] loop
    function_signature := case function_name
      when 'reassign_eval_work_v1' then
        'public.reassign_eval_work_v1(uuid,text,integer,text,text)'::regprocedure
      else
        'public.cancel_eval_work_v1(uuid,text,integer)'::regprocedure
    end;
    select pg_get_functiondef(function_signature) into definition;
    if position('from public.ph_eval_work sibling' in definition) > 0 then
      continue;
    end if;
    if position(old_guard in definition) = 0 then
      raise exception 'eval_work_assignment_guard_changed:%', function_name;
    end if;
    execute replace(definition, old_guard, new_guard);
  end loop;
end
$block$;

create or replace function public.get_eval_work_assignment_batch_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  create_definition text;
  reassign_definition text;
  cancel_definition text;
  create_healthy boolean;
  reassign_healthy boolean;
  cancel_healthy boolean;
  envelope_violation_count bigint := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'EVAL_WORK_ASSIGNMENT_BATCH_HEALTH_FORBIDDEN';
  end if;
  select pg_get_functiondef('public.create_eval_report2_batch_v1(jsonb)'::regprocedure) into create_definition;
  select pg_get_functiondef('public.reassign_eval_work_v1(uuid,text,integer,text,text)'::regprocedure) into reassign_definition;
  select pg_get_functiondef('public.cancel_eval_work_v1(uuid,text,integer)'::regprocedure) into cancel_definition;
  create_healthy := position('private.eval_report2_group_assignment_delivery_v1' in create_definition) > 0;
  reassign_healthy := position('from public.ph_eval_work sibling' in reassign_definition) > 0;
  cancel_healthy := position('from public.ph_eval_work sibling' in cancel_definition) > 0;
  select count(*)
  into envelope_violation_count
  from public.ph_request_delivery_outbox outbox
  where outbox.event_type = 'eval_work_assignment'
    and outbox.payload->>'contractVersion' = 'eval-work-assignment-batch-v1'
    and (
      jsonb_typeof(outbox.payload->'assignments') <> 'array'
      or jsonb_typeof(outbox.payload->'assignmentRecipients') <> 'array'
      or coalesce(outbox.payload->>'assignmentCount', '') !~ '^[2-9][0-9]*$'
      or case
        when coalesce(outbox.payload->>'assignmentCount', '') ~ '^[2-9][0-9]*$'
          then (outbox.payload->>'assignmentCount')::integer
        else -1
      end <> case
        when jsonb_typeof(outbox.payload->'assignments') = 'array'
          then jsonb_array_length(outbox.payload->'assignments')
        else -1
      end
      or case
        when coalesce(outbox.payload->>'assignmentCount', '') ~ '^[2-9][0-9]*$'
          then (outbox.payload->>'assignmentCount')::integer
        else -1
      end <> (
        select count(*)::integer
        from public.ph_eval_work work
        where work.assignment_event_id = outbox.event_id
      )
    );
  return jsonb_build_object(
    'contractVersion', 'eval-work-assignment-batch-v1',
    'createGrouped', create_healthy,
    'reassignGuarded', reassign_healthy,
    'cancelGuarded', cancel_healthy,
    'envelopeViolationCount', envelope_violation_count,
    'healthy', create_healthy and reassign_healthy and cancel_healthy and envelope_violation_count = 0
  );
end
$function$;

revoke all on function private.eval_report2_group_assignment_delivery_v1(jsonb, text)
  from public, anon, authenticated;
grant execute on function private.eval_report2_group_assignment_delivery_v1(jsonb, text)
  to service_role;
revoke all on function public.create_eval_report2_batch_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_eval_report2_batch_v1(jsonb)
  to service_role;
revoke all on function public.reassign_eval_work_v1(uuid, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.reassign_eval_work_v1(uuid, text, integer, text, text)
  to service_role;
revoke all on function public.cancel_eval_work_v1(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.cancel_eval_work_v1(uuid, text, integer)
  to service_role;
revoke all on function public.get_eval_work_assignment_batch_health_v1()
  from public, anon, authenticated;
grant execute on function public.get_eval_work_assignment_batch_health_v1()
  to service_role;

commit;
