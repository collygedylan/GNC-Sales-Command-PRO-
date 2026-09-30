begin;

-- A Terra run that discovers high or complex risk must stop without producing
-- a publisher patch. Keep the original V1 event dispatcher stable and route
-- only repair results through this additive V2 service contract.
create or replace function public.apply_codex_ops_repair_result_service_v2(
  p_task_id uuid,
  p_expected_revision integer,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task private.codex_ops_tasks%rowtype;
  changed text[];
  message_body text;
  recent_repair_attempts integer;
begin
  select * into task
  from private.codex_ops_tasks t
  where t.id = p_task_id
  for update;
  if task.id is null then
    raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND';
  end if;
  if task.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'CODEX_OPS_REVISION_CONFLICT';
  end if;
  if task.status <> 'fixing' then
    raise exception using errcode = '55000', message = 'CODEX_OPS_REPAIR_NOT_ALLOWED';
  end if;
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 131072 then
    raise exception using errcode = '22023', message = 'CODEX_OPS_PAYLOAD_TOO_LARGE';
  end if;
  if task.repair_attempts >= 2 then
    raise exception using errcode = '54000', message = 'CODEX_OPS_REPAIR_LIMIT';
  end if;
  if task.incident_fingerprint is not null then
    select coalesce(sum(t.repair_attempts), 0)::integer
    into recent_repair_attempts
    from private.codex_ops_tasks t
    where t.incident_fingerprint = task.incident_fingerprint
      and t.updated_at >= now() - interval '60 minutes';
    if recent_repair_attempts >= 2 then
      raise exception using errcode = '54000', message = 'CODEX_OPS_FINGERPRINT_REPAIR_LIMIT';
    end if;
  end if;

  changed := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_payload->'changedFiles', '[]'::jsonb))),
    '{}'::text[]
  );
  message_body := left(btrim(coalesce(p_payload->>'summary', 'Repair prepared.')), 12000);
  if coalesce((p_payload->>'escalationRequired')::boolean, false)
     or p_payload->>'risk' in ('high', 'complex') then
    update private.codex_ops_tasks set
      status = 'needs_escalation',
      repair_attempts = repair_attempts + 1,
      risk_level = case
        when p_payload->>'risk' in ('high', 'complex') then p_payload->>'risk'
        else risk_level
      end,
      sanitized_repair_summary = p_payload,
      changed_files = '{}'::text[],
      updated_at = now()
    where id = task.id
    returning * into task;
  else
    update private.codex_ops_tasks set
      status = 'testing',
      repair_attempts = repair_attempts + 1,
      sanitized_repair_summary = p_payload,
      changed_files = changed,
      updated_at = now()
    where id = task.id
    returning * into task;
  end if;

  insert into private.codex_ops_messages
    (task_id, actor_type, actor_username, model, body)
  values
    (task.id, 'agent', 'terra', 'gpt-5.6-terra', message_body);
  insert into private.codex_ops_events
    (task_id, revision, event_type, sanitized_payload)
  values
    (task.id, task.revision, 'repair.result', jsonb_build_object('status', task.status));
  insert into private.codex_ops_audit_events
    (task_id, actor_type, actor_key, action, outcome)
  values
    (task.id, 'runner', 'github-oidc', 'repair.result', 'succeeded');

  return jsonb_build_object(
    'taskId', task.id,
    'revision', task.revision,
    'status', task.status,
    'headSha', task.head_sha
  );
end;
$$;

revoke all on function public.apply_codex_ops_repair_result_service_v2(uuid, integer, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.apply_codex_ops_repair_result_service_v2(uuid, integer, jsonb)
to service_role;

comment on function public.apply_codex_ops_repair_result_service_v2(uuid, integer, jsonb) is
  'Consumes one sanitized Terra result and stops at Needs Escalation when risk is high or complex.';

commit;
