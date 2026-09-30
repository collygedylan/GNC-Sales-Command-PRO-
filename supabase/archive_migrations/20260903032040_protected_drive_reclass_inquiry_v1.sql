begin;

-- Drive Mode Reclass is an authenticated, service-owned delivery surface.
-- The browser never supplies the actor or final recipients to this function.

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values
  ('drive.reclass.submit', 'action', 'drive', 'Submit Reclass inquiry',
   'Managers may submit any Drive row; evaluators are limited to their authoritative assignments.',
   array['assigned', 'global']::text[], 614, true)
on conflict (permission_key) do update set
  permission_kind = excluded.permission_kind,
  module_key = excluded.module_key,
  label = excluded.label,
  description = excluded.description,
  scope_options = excluded.scope_options,
  sort_order = excluded.sort_order,
  active = true;

insert into private.app_access_role_grants
  (policy_id, role_key, permission_key, allowed, access_scope)
select policy.id, role.role_key, 'drive.reclass.submit', true, role.access_scope
from private.app_access_policy_versions policy
cross join (values
  ('ADMIN', 'global'),
  ('ADMINISTRATOR', 'global'),
  ('MANAGER', 'global'),
  ('EVAL', 'assigned'),
  ('EVALUATOR', 'assigned')
) role(role_key, access_scope)
on conflict (policy_id, role_key, permission_key) do update set
  allowed = excluded.allowed,
  access_scope = excluded.access_scope,
  updated_at = now();

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('client.drive.reclass.v3', 'drive.reclass.submit', 'client',
   'Drive Mode renders only the V3 row action editor and posts through the authenticated app API.'),
  ('edge.drive.reclass.v3', 'drive.reclass.submit', 'edge',
   'The app API discards browser actor and recipient values before invoking the service-only RPC.'),
  ('rpc.drive.reclass.v3', 'drive.reclass.submit', 'rpc',
   'Service-only enqueue/status/retry operations validate actor, role, assignment, source row, and frozen recipients.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;

create or replace function private.drive_reclass_delivery_result_v1(p_event public.ph_request_delivery_outbox)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'ok', p_event.status not in ('failed', 'unknown'),
    'jobId', p_event.event_id,
    'status', case
      when p_event.status = 'delivered' then 'delivered'
      when p_event.status = 'processing' then 'processing'
      when p_event.status in ('failed', 'unknown')
        and upper(coalesce(p_event.sanitized_error_code, '')) like 'RECLASS_CONFLICT%' then 'conflict'
      when p_event.status in ('failed', 'unknown') then 'failed'
      else 'queued'
    end,
    'queuedAt', p_event.created_at,
    'deliveredAt', coalesce(p_event.delivered_at, p_event.email_delivered_at),
    'attemptCount', p_event.attempt_count,
    'errorCode', coalesce(p_event.sanitized_error_code, ''),
    'unavailableUsernames', coalesce(p_event.payload #> '{reclassPayload,protectedDelivery,unavailableUsernames}', '[]'::jsonb),
    'message', case
      when p_event.status = 'delivered' then 'Reclass Item Inquiry email delivered.'
      when p_event.status in ('failed', 'unknown')
        and upper(coalesce(p_event.sanitized_error_code, '')) like 'RECLASS_CONFLICT%' then 'Inventory changed before delivery. Reopen the inquiry against current inventory.'
      when p_event.status in ('failed', 'unknown') then 'Email delivery failed. Retry uses the same inquiry.'
      else 'Reclass Item Inquiry queued.'
    end
  )
$function$;

create or replace function public.enqueue_drive_reclass_inquiry_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  actor_username text := lower(btrim(coalesce(p_payload->>'actorUsername', '')));
  actor_role text;
  access_scope text;
  source_uid text := btrim(coalesce(p_payload #>> '{source,unique_id}', p_payload #>> '{source,uniqueId}', ''));
  source_row public.ph_master_inventory;
  source_json jsonb;
  token text := btrim(coalesce(p_payload->>'idempotencyToken', p_payload->>'idempotency_token', ''));
  event_key_value text;
  event_row public.ph_request_delivery_outbox;
  is_manager boolean := false;
  is_evaluator boolean := false;
  assigned_to_actor boolean := false;
  required_usernames text[];
  recipient_emails text[] := '{}'::text[];
  unavailable_usernames text[] := '{}'::text[];
  safe_payload jsonb;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_PAYLOAD_INVALID';
  end if;
  if actor_username = '' then
    raise exception using errcode = '42501', message = 'DRIVE_RECLASS_ACTOR_REQUIRED';
  end if;
  select p.* into actor
  from public.profiles p
  where lower(btrim(p.username)) = actor_username
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and not p.must_change_password
  limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PROFILE_NOT_ACTIVE';
  end if;

  actor_role := private.normalized_profile_role(actor.role);
  is_manager := actor_role in ('ADMIN', 'ADMINISTRATOR', 'MANAGER');
  is_evaluator := actor_role in ('EVAL', 'EVALUATOR') or actor_role like '%EVAL%';
  if not is_manager and not is_evaluator then
    raise exception using errcode = '42501', message = 'DRIVE_RECLASS_FORBIDDEN';
  end if;

  select e.access_scope into access_scope
  from private.get_effective_app_permissions_v1(
    actor.id,
    private.resolve_app_access_policy_id_v1(false)
  ) e
  where e.permission_key = 'drive.reclass.submit'
    and e.allowed
  limit 1;
  if access_scope is null then
    raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PERMISSION_REQUIRED';
  end if;

  if coalesce(p_payload->>'workflowPolicyVersion', '') <> 'reclass-action-workflow-v3-row-actions-20260826' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V3_REQUIRED';
  end if;
  if length(token) < 12 or length(token) > 180 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_TOKEN_INVALID';
  end if;
  if source_uid = '' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_SOURCE_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_payload->'transaction', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'rowOverlays', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_ACTIONS_INVALID';
  end if;

  select m.* into source_row
  from public.ph_master_inventory m
  where btrim(coalesce(m.unique_id, '')) = source_uid
  limit 1
  for share;
  if source_row.unique_id is null then
    raise exception using errcode = '40001', message = 'DRIVE_RECLASS_SOURCE_MISSING';
  end if;
  source_json := to_jsonb(source_row);
  if nullif(btrim(coalesce(p_payload #>> '{source,itemcode}', '')), '') is not null
     and upper(btrim(p_payload #>> '{source,itemcode}')) <> upper(btrim(coalesce(source_row.itemcode, ''))) then
    raise exception using errcode = '40001', message = 'DRIVE_RECLASS_SOURCE_CHANGED';
  end if;
  if nullif(btrim(coalesce(p_payload #>> '{source,lotcode}', '')), '') is not null
     and upper(btrim(p_payload #>> '{source,lotcode}')) <> upper(btrim(coalesce(source_json->>'lotcode', ''))) then
    raise exception using errcode = '40001', message = 'DRIVE_RECLASS_SOURCE_CHANGED';
  end if;
  if nullif(btrim(coalesce(p_payload #>> '{source,locationcode}', '')), '') is not null
     and upper(btrim(p_payload #>> '{source,locationcode}')) <> upper(btrim(coalesce(source_json->>'locationcode', ''))) then
    raise exception using errcode = '40001', message = 'DRIVE_RECLASS_SOURCE_CHANGED';
  end if;

  if is_evaluator and not is_manager then
    select exists (
      select 1
      from public.ph_warehouse_assigned_items a
      where a.present_in_drive
        and upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(btrim(coalesce(source_row.itemcode, '')))
        and lower(regexp_replace(btrim(coalesce(a.genusname_normalized, a.genusname, '')), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(btrim(coalesce(source_json->>'genusname', '')), '[[:space:]]+', ' ', 'g'))
        and lower(regexp_replace(btrim(coalesce(a.assignedto, '')), '[^a-z0-9]+', '_', 'g')) = actor_username
    ) into assigned_to_actor;
    if not assigned_to_actor then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_ROW_NOT_ASSIGNED';
    end if;
  end if;

  required_usernames := array['dylan_collyge', 'megan_kelly', 'sharon_combs', actor_username];
  with wanted as (
    select lower(btrim(value)) as username, min(ordinality) as ordinal
    from unnest(required_usernames) with ordinality entry(value, ordinality)
    where btrim(coalesce(value, '')) <> ''
    group by lower(btrim(value))
  ), resolved as (
    select w.username, w.ordinal, lower(btrim(u.email)) as email
    from wanted w
    join public.profiles p on lower(btrim(p.username)) = w.username
    join auth.users u on u.id = p.id
    where p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and not p.must_change_password
      and u.email_confirmed_at is not null
      and btrim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  )
  select
    coalesce(array_agg(distinct r.email order by r.email) filter (where r.email is not null), '{}'::text[]),
    coalesce(array_agg(w.username order by w.ordinal) filter (where r.username is null), '{}'::text[])
  into recipient_emails, unavailable_usernames
  from wanted w
  left join resolved r on r.username = w.username;

  if cardinality(recipient_emails) = 0 then
    raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_RECIPIENTS_UNAVAILABLE';
  end if;

  event_key_value := 'reclass-inquiry:' || left(encode(extensions.digest(token, 'sha256'), 'hex'), 40);
  perform pg_advisory_xact_lock(hashtextextended(event_key_value, 0));
  select o.* into event_row
  from public.ph_request_delivery_outbox o
  where o.event_key = event_key_value
    and o.event_type = 'reclass_inquiry'
  limit 1
  for update;
  if event_row.event_id is not null then
    if event_row.payload #>> '{reclassPayload,protectedDelivery,contractVersion}' <> 'drive-reclass-protected-v1' then
      raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_TOKEN_CONFLICT';
    end if;
    if lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}', ''))) <> actor_username then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    return private.drive_reclass_delivery_result_v1(event_row) || jsonb_build_object('duplicate', true);
  end if;

  safe_payload := jsonb_build_object(
    'type', 'reclass_inquiry_email',
    'action', 'reclass',
    'workflowPolicyVersion', 'reclass-action-workflow-v3-row-actions-20260826',
    'idempotencyToken', token,
    'actor', jsonb_build_object(
      'username', actor_username,
      'display', coalesce(nullif(btrim(actor.display_name), ''), actor.username),
      'role', actor.role
    ),
    'source', jsonb_build_object(
      'unique_id', source_row.unique_id,
      'source_table', 'ph_master_inventory',
      'itemcode', source_row.itemcode,
      'lotcode', source_json->>'lotcode',
      'locationcode', source_json->>'locationcode',
      'season', source_json->>'season',
      'saleyear', source_json->>'saleyear'
    ),
    'transaction', p_payload->'transaction',
    'rowOverlays', p_payload->'rowOverlays',
    'clientVersion', left(btrim(coalesce(p_payload->>'clientVersion', '')), 80),
    'sourceContext', jsonb_build_object('sourceMode', 'drive'),
    'recipientEmails', to_jsonb(recipient_emails),
    'emailRecipients', to_jsonb(recipient_emails),
    'recipients', (
      select coalesce(jsonb_agg(jsonb_build_object('email', email, 'role', 'required_drive_reclass') order by email), '[]'::jsonb)
      from unnest(recipient_emails) email
    ),
    'protectedDelivery', jsonb_build_object(
      'contractVersion', 'drive-reclass-protected-v1',
      'actorProfileId', actor.id,
      'unavailableUsernames', to_jsonb(unavailable_usernames)
    )
  );
  if octet_length(safe_payload::text) > 4 * 1024 * 1024 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_PAYLOAD_TOO_LARGE';
  end if;

  insert into public.ph_request_delivery_outbox
    (event_key, event_type, request_id, request_folder, payload, status, next_attempt_at)
  values
    (event_key_value, 'reclass_inquiry', null, null, jsonb_build_object('reclassPayload', safe_payload), 'pending', now())
  returning * into event_row;

  return private.drive_reclass_delivery_result_v1(event_row)
    || jsonb_build_object('duplicate', false, 'unavailableUsernames', to_jsonb(unavailable_usernames));
end
$function$;

create or replace function public.get_drive_reclass_inquiry_status_v1(
  p_actor_username text,
  p_idempotency_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_username text := lower(btrim(coalesce(p_actor_username, '')));
  token text := btrim(coalesce(p_idempotency_token, ''));
  event_row public.ph_request_delivery_outbox;
begin
  if actor_username = '' or length(token) < 12 or length(token) > 180 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_STATUS_INVALID';
  end if;
  select o.* into event_row
  from public.ph_request_delivery_outbox o
  where o.event_key = 'reclass-inquiry:' || left(encode(extensions.digest(token, 'sha256'), 'hex'), 40)
    and o.event_type = 'reclass_inquiry'
    and lower(btrim(coalesce(o.payload #>> '{reclassPayload,actor,username}', ''))) = actor_username
    and o.payload #>> '{reclassPayload,protectedDelivery,contractVersion}' = 'drive-reclass-protected-v1'
  limit 1;
  if event_row.event_id is null then
    return jsonb_build_object('ok', false, 'status', 'missing', 'message', 'This inquiry was not found.');
  end if;
  return private.drive_reclass_delivery_result_v1(event_row);
end
$function$;

create or replace function public.retry_drive_reclass_inquiry_v1(
  p_actor_username text,
  p_idempotency_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_username text := lower(btrim(coalesce(p_actor_username, '')));
  token text := btrim(coalesce(p_idempotency_token, ''));
  event_row public.ph_request_delivery_outbox;
begin
  if actor_username = '' or length(token) < 12 or length(token) > 180 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_RETRY_INVALID';
  end if;
  select o.* into event_row
  from public.ph_request_delivery_outbox o
  where o.event_key = 'reclass-inquiry:' || left(encode(extensions.digest(token, 'sha256'), 'hex'), 40)
    and o.event_type = 'reclass_inquiry'
    and lower(btrim(coalesce(o.payload #>> '{reclassPayload,actor,username}', ''))) = actor_username
    and o.payload #>> '{reclassPayload,protectedDelivery,contractVersion}' = 'drive-reclass-protected-v1'
  limit 1
  for update;
  if event_row.event_id is null then
    return jsonb_build_object('ok', false, 'status', 'missing', 'message', 'This inquiry was not found.');
  end if;
  if event_row.status = 'delivered' or event_row.status in ('pending', 'processing') then
    return private.drive_reclass_delivery_result_v1(event_row);
  end if;
  if upper(coalesce(event_row.sanitized_error_code, '')) like 'RECLASS_CONFLICT%' then
    return private.drive_reclass_delivery_result_v1(event_row);
  end if;
  update public.ph_request_delivery_outbox o
  set status = 'pending', attempt_count = 0, next_attempt_at = now(),
      sanitized_error_code = null, lease_token = null, lease_owner = null,
      lease_expires_at = null, updated_at = now()
  where o.event_id = event_row.event_id
  returning * into event_row;
  return private.drive_reclass_delivery_result_v1(event_row);
end
$function$;

revoke all on function private.drive_reclass_delivery_result_v1(public.ph_request_delivery_outbox)
  from public, anon, authenticated;
revoke all on function public.enqueue_drive_reclass_inquiry_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_drive_reclass_inquiry_status_v1(text, text)
  from public, anon, authenticated;
revoke all on function public.retry_drive_reclass_inquiry_v1(text, text)
  from public, anon, authenticated;

grant execute on function public.enqueue_drive_reclass_inquiry_v1(jsonb) to service_role;
grant execute on function public.get_drive_reclass_inquiry_status_v1(text, text) to service_role;
grant execute on function public.retry_drive_reclass_inquiry_v1(text, text) to service_role;

notify pgrst, 'reload schema';

commit;
