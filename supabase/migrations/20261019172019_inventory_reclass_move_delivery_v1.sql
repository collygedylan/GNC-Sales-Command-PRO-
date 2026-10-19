begin;

-- Movement and its notification intent are one transaction. The existing
-- movement RPC remains the sole authority that changes inventory.
create or replace function public.apply_inventory_reclass_moves_with_delivery_v1(
  p_actor_id uuid,
  p_command_id text,
  p_expected_revision bigint,
  p_moves jsonb,
  p_receipt_encoding text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
set lock_timeout = '2s'
as $function$
declare
  batch_receipt private.ph_inventory_reclass_batch_receipts_v1%rowtype;
  actor_profile public.profiles%rowtype;
  result_value jsonb;
  event_row public.ph_request_delivery_outbox%rowtype;
  event_key_value text;
  actor_username text;
  actor_email text;
  recipient_emails text[];
  fixed_recipient_emails text[] := array[
    'sunday_ellis@greenleafnursery.com', 'sharon_combs@greenleafnursery.com',
    'mitch_kaiser@greenleafnursery.com', 'jd_jones@greenleafnursery.com',
    'megan_kelly@greenleafnursery.com'
  ];
  moves_value jsonb;
  child_ids uuid[];
  move_request_id uuid;
  existing_command boolean := false;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_FORBIDDEN';
  end if;
  if p_actor_id is null or p_command_id is null or p_command_id !~ '^[A-Za-z0-9:_.-]{12,180}$'
    or p_expected_revision is null or p_expected_revision < 1
    or jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) < 1
    or jsonb_array_length(p_moves) > 100
    or (p_receipt_encoding is not null and p_receipt_encoding <> 'master-null-elision-v1') then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_PAYLOAD_INVALID';
  end if;

  -- Match the movement RPC's actor/command lock so receipt lookup, movement,
  -- and event insertion cannot race a retry of the same command.
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':' || p_command_id, 0));
  select * into batch_receipt from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.actor_id = p_actor_id and b.command_id = p_command_id for update;
  existing_command := found;

  if p_receipt_encoding = 'master-null-elision-v1' then
    result_value := public.apply_inventory_reclass_moves_compact_v1(p_actor_id, p_command_id, p_expected_revision, p_moves);
  else
    result_value := public.apply_inventory_reclass_moves_v1(p_actor_id, p_command_id, p_expected_revision, p_moves);
  end if;

  -- A command created before this delivery contract is not retroactively
  -- emailed. Newly applied commands always have their outbox intent below.
  if existing_command then
    event_key_value := 'inventory-reclass-move-completed:' || p_actor_id::text || ':' || p_command_id;
    select * into event_row from public.ph_request_delivery_outbox o
      where o.event_key = event_key_value and o.event_type = 'inventory_reclass_move_completed';
    return result_value || jsonb_build_object('duplicate', true, 'emailQueued', event_row.event_id is not null,
      'deliveryEventId', event_row.event_id);
  end if;

  if coalesce(result_value->>'status', '') <> 'applied' then
    return result_value;
  end if;

  select * into actor_profile from public.profiles p where p.id = p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password;
  if actor_profile.id is null then raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_PROFILE_INACTIVE'; end if;
  actor_username := lower(btrim(actor_profile.username));
  select lower(btrim(u.email)) into actor_email from auth.users u
    where u.id = p_actor_id and u.email_confirmed_at is not null
      and btrim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
  if actor_email is null then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_ACTOR_EMAIL_UNAVAILABLE'; end if;

  -- Freeze the existing trusted Reclass recipients plus the authenticated
  -- actor. Recipient addresses are server-owned and never caller-supplied.
  -- Keep the established Code.gs Reclass required-recipient policy. Freeze its
  -- trusted addresses in the durable event and add only the active actor.
  recipient_emails := array(
    select distinct lower(btrim(email)) from unnest(fixed_recipient_emails || actor_email) as e(email)
    order by lower(btrim(email))
  );
  if cardinality(fixed_recipient_emails) <> 5 or cardinality(recipient_emails) < 5 then
    raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_REQUIRED_RECIPIENT_POLICY_INVALID';
  end if;

  move_request_id := nullif(result_value->>'requestId', '')::uuid;
  if move_request_id is null then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING'; end if;
  select b.child_request_ids into child_ids from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.actor_id = p_actor_id and b.command_id = p_command_id and b.request_id = move_request_id;
  if child_ids is null then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', m.direction,
      'destinationSeason', m.destination_season,
      'quantity', m.quantity,
      'source', jsonb_build_object('itemcode', m.source_identity->>'itemcode',
        'commonname', coalesce(m.source_before->>'commonname', ''),
        'contsize', m.source_identity->>'contsize', 'locationcode', m.source_identity->>'locationcode',
        'lotcode', m.source_identity->>'lotcode', 'season', m.source_identity->>'season'),
      'destination', jsonb_build_object('itemcode', m.destination_identity->>'itemcode',
        'commonname', coalesce(m.source_before->>'commonname', ''),
        'contsize', m.destination_identity->>'contsize', 'locationcode', m.destination_identity->>'locationcode',
        'lotcode', m.destination_identity->>'lotcode', 'season', m.destination_identity->>'season')
    ) order by m.request_id, m.line_index), '[]'::jsonb)
    into moves_value from private.ph_inventory_reclass_movements_v1 m where m.request_id = any(child_ids);
  if jsonb_array_length(moves_value) < 1 then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING'; end if;

  event_key_value := 'inventory-reclass-move-completed:' || p_actor_id::text || ':' || p_command_id;
  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
    values(event_key_value, 'inventory_reclass_move_completed', move_request_id::text,
      jsonb_build_object('contractVersion', 'inventory-reclass-move-completed-v1',
        'commandId', p_command_id, 'requestId', move_request_id, 'actorProfileId', p_actor_id,
        'actorUsername', actor_username, 'actorDisplayName', coalesce(nullif(btrim(actor_profile.display_name), ''), actor_username),
        'actorEmail', actor_email, 'revision', result_value->>'revision', 'moves', moves_value,
        'deliveryRecipients', to_jsonb(recipient_emails)),
      'pending', now()) returning * into event_row;

  return result_value || jsonb_build_object('duplicate', false, 'emailQueued', true, 'deliveryEventId', event_row.event_id);
end;
$function$;

revoke all on function public.apply_inventory_reclass_moves_with_delivery_v1(uuid, text, bigint, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.apply_inventory_reclass_moves_with_delivery_v1(uuid, text, bigint, jsonb, text)
  to service_role;

create or replace function public.prepare_inventory_reclass_move_delivery_v1(p_event_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '1s'
as $function$
declare
  event_row public.ph_request_delivery_outbox%rowtype;
  receipt private.ph_inventory_reclass_batch_receipts_v1%rowtype;
  payload_value jsonb;
  recipient_count integer;
  unique_recipient_count integer;
  expected_recipients text[];
  actual_recipients text[];
begin
  if not private.is_service_role_request() then raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN'; end if;
  select * into event_row from public.ph_request_delivery_outbox o
    where o.event_id = p_event_id and o.event_type = 'inventory_reclass_move_completed'
      and o.lease_token = p_lease_token and o.status = 'processing' for update;
  if not found then raise exception using errcode = '42501', message = 'DELIVERY_LEASE_LOST'; end if;
  payload_value := event_row.payload;
  if payload_value->>'contractVersion' <> 'inventory-reclass-move-completed-v1'
    or payload_value->>'requestId' is distinct from event_row.request_id then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_MOVE_DELIVERY_INVALID';
  end if;
  select * into receipt from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.request_id = event_row.request_id::uuid and b.actor_id = (payload_value->>'actorProfileId')::uuid
      and b.command_id = payload_value->>'commandId';
  if not found or receipt.result->>'status' <> 'applied'
    or receipt.result->>'requestId' is distinct from payload_value->>'requestId' then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_INVALID';
  end if;
  if jsonb_typeof(payload_value->'moves') is distinct from 'array'
    or jsonb_array_length(payload_value->'moves') < 1 or jsonb_array_length(payload_value->'moves') > 100
    or jsonb_typeof(payload_value->'deliveryRecipients') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_MOVE_DELIVERY_INVALID';
  end if;
  select count(*) filter (where email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
    count(distinct lower(email)), array_agg(lower(email) order by lower(email))
    into recipient_count, unique_recipient_count, actual_recipients
    from jsonb_array_elements_text(payload_value->'deliveryRecipients') r(email);
  expected_recipients := array(
    select distinct lower(btrim(email)) from unnest(array[
      'sunday_ellis@greenleafnursery.com', 'sharon_combs@greenleafnursery.com',
      'mitch_kaiser@greenleafnursery.com', 'jd_jones@greenleafnursery.com',
      'megan_kelly@greenleafnursery.com', payload_value->>'actorEmail'
    ]) as e(email) order by lower(btrim(email))
  );
  if recipient_count > 0 or jsonb_array_length(payload_value->'deliveryRecipients') < 1
    or jsonb_array_length(payload_value->'deliveryRecipients') > 8
    or unique_recipient_count <> jsonb_array_length(payload_value->'deliveryRecipients')
    or (payload_value->>'actorEmail') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or actual_recipients is distinct from expected_recipients then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_MOVE_RECIPIENTS_INVALID';
  end if;
  return payload_value;
end;
$function$;

revoke all on function public.prepare_inventory_reclass_move_delivery_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_inventory_reclass_move_delivery_v1(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
