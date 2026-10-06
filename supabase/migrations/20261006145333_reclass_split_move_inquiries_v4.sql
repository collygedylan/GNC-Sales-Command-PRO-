begin;

-- Split instructions remain an inquiry only. This projection reuses legacy
-- validation; delivery and Requested audit snapshots retain the complete V4
-- split lists and per-direction hold instructions.
create or replace function private.project_reclass_split_move_v4(p_payload jsonb, p_allow_incomplete boolean)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  row_overlay jsonb;
  proposal jsonb;
  split_item jsonb;
  projected_rows jsonb := '[]'::jsonb;
  projected_proposals jsonb;
  projected_overlay jsonb;
  projected_payload jsonb;
  action_name text;
  hold_reason text;
  quantity numeric;
  split_count integer;
  move_actions_seen text[];
  quantity_text text;
  destination_text text;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'workflowPolicyVersion' <> 'reclass-action-workflow-v4-split-moves-20261006'
     or jsonb_typeof(coalesce(p_payload->'transaction','{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'rowOverlays','null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_SHAPE_INVALID';
  end if;

  for row_overlay in select value from jsonb_array_elements(p_payload->'rowOverlays') loop
    if jsonb_typeof(row_overlay) <> 'object'
       or jsonb_typeof(coalesce(row_overlay->'proposals','[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_ROW_INVALID';
    end if;
    projected_proposals := '[]'::jsonb;
    move_actions_seen := '{}'::text[];
    for proposal in select value from jsonb_array_elements(coalesce(row_overlay->'proposals','[]'::jsonb)) loop
      action_name := lower(btrim(coalesce(proposal->>'action','')));
      if action_name in ('move_up','move_down') then
        if action_name = any(move_actions_seen) then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_DUPLICATE_MOVE_ACTION';
        end if;
        move_actions_seen := array_append(move_actions_seen,action_name);
        if (select count(*) from jsonb_object_keys(proposal)) <> 4
           or not (proposal ?& array['action','splits','applyHold','holdReason'])
           or jsonb_typeof(proposal->'splits') <> 'array'
           or jsonb_typeof(proposal->'applyHold') <> 'boolean'
           or jsonb_typeof(proposal->'holdReason') <> 'string' then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_MOVE_FIELDS_INVALID';
        end if;
        split_count := jsonb_array_length(proposal->'splits');
        if (not p_allow_incomplete and split_count < 1) or split_count > 100 then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_SPLIT_COUNT_INVALID';
        end if;
        hold_reason := proposal->>'holdReason';
        if length(hold_reason) > 1000 then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_HOLD_REASON_INVALID';
        end if;
        if (proposal->>'applyHold')::boolean then
          if not p_allow_incomplete and (hold_reason = '' or btrim(hold_reason) <> hold_reason or lower(hold_reason) <> hold_reason) then
            raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_HOLD_REASON_INVALID';
          end if;
        elsif not p_allow_incomplete and hold_reason <> '' then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_HOLD_REASON_INVALID';
        end if;
        for split_item in select value from jsonb_array_elements(proposal->'splits') loop
          if jsonb_typeof(split_item) <> 'object'
             or (select count(*) from jsonb_object_keys(split_item)) <> 2
             or not (split_item ?& array['quantity','destinationSeason'])
             or jsonb_typeof(split_item->'quantity') not in ('number','string')
             or jsonb_typeof(split_item->'destinationSeason') <> 'string' then
            raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_SPLIT_INVALID';
          end if;
          quantity_text := btrim(split_item->>'quantity');
          destination_text := split_item->>'destinationSeason';
          if p_allow_incomplete and (nullif(btrim(split_item->>'quantity'),'') is null or nullif(btrim(split_item->>'destinationSeason'),'') is null) then
            if length(coalesce(split_item->>'quantity','')) > 32 or length(coalesce(destination_text,'')) > 8
               or (quantity_text <> '' and quantity_text !~ '^[0-9]+$')
               or (destination_text <> '' and (btrim(destination_text) <> destination_text or upper(destination_text) <> destination_text
                   or destination_text not in ('F1','S1','U1','U2','U3','X','Y','Z'))) then
              raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_SPLIT_INVALID';
            end if;
            continue;
          end if;
          if jsonb_typeof(split_item->'quantity') <> 'number' and not p_allow_incomplete then
            raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_SPLIT_INVALID';
          end if;
          quantity := quantity_text::numeric;
          if quantity < 1 or quantity <> trunc(quantity)
             or btrim(destination_text) <> destination_text
             or upper(destination_text) <> destination_text
             or destination_text not in ('F1','S1','U1','U2','U3','X','Y','Z') then
            raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_SPLIT_INVALID';
          end if;
          projected_proposals := projected_proposals || jsonb_build_array(jsonb_build_object(
            'action', action_name, 'moveQuantity', quantity, 'destinationSeason', destination_text
          ));
        end loop;
      else
        projected_proposals := projected_proposals || jsonb_build_array(proposal);
      end if;
    end loop;
    projected_overlay := row_overlay || jsonb_build_object('proposals', projected_proposals);
    projected_rows := projected_rows || jsonb_build_array(projected_overlay);
  end loop;
  projected_payload := p_payload || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v3-row-actions-20260826',
    'rowOverlays',projected_rows
  );
  return projected_payload;
end
$function$;

create or replace function private.project_reclass_split_move_v4(p_payload jsonb)
returns jsonb language sql immutable security definer set search_path = ''
as $function$ select private.project_reclass_split_move_v4(p_payload,false) $function$;

revoke all on function private.project_reclass_split_move_v4(jsonb,boolean) from public, anon, authenticated;
grant execute on function private.project_reclass_split_move_v4(jsonb,boolean) to service_role;
revoke all on function private.project_reclass_split_move_v4(jsonb) from public, anon, authenticated;
grant execute on function private.project_reclass_split_move_v4(jsonb) to service_role;

alter function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb)
  rename to validate_eval_work_inquiry_legacy_v1;

create or replace function private.validate_eval_work_inquiry_v1(
  p_inquiry jsonb, p_itemcode text, p_context_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  projected jsonb;
  overlay jsonb;
  current_row jsonb;
  uid text;
begin
  if coalesce(p_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v4-split-moves-20261006' then
    for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays','[]'::jsonb)) loop
      uid := btrim(coalesce(overlay->>'unique_id',''));
      select value into current_row from jsonb_array_elements(coalesce(p_context_rows,'[]'::jsonb))
      where value->>'unique_id' = uid limit 1;
      if current_row is null then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
      if overlay->'expected' ? 'ptronhand' and exists (
        select 1 from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) proposal
        where proposal->>'action' in ('move_up','move_down')
      ) and overlay #>> '{expected,ptronhand}' is distinct from current_row->>'ptronhand' then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
    end loop;
    projected := private.project_reclass_split_move_v4(p_inquiry,true);
    perform private.validate_eval_work_inquiry_legacy_v1(projected,p_itemcode,p_context_rows);
  else
    perform private.validate_eval_work_inquiry_legacy_v1(p_inquiry,p_itemcode,p_context_rows);
  end if;
end
$function$;

revoke all on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) to service_role;

create or replace function private.validate_reclass_v4_move_seasons(p_inquiry jsonb,p_context_rows jsonb)
returns void language plpgsql security definer set search_path = ''
as $function$
declare overlay jsonb; current_row jsonb; proposal jsonb; split_item jsonb; uid text; current_season text;
begin
  for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays','[]'::jsonb)) loop
    uid := btrim(coalesce(overlay->>'unique_id',''));
    select value into current_row from jsonb_array_elements(coalesce(p_context_rows,'[]'::jsonb))
    where value->>'unique_id' = uid limit 1;
    current_season := upper(btrim(coalesce(nullif(current_row->>'season',''),nullif(regexp_replace(coalesce(current_row->>'lotcode',''), '^.*[.]', ''),''),'')));
    for proposal in select value from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) loop
      if proposal->>'action' in ('move_up','move_down') then
        for split_item in select value from jsonb_array_elements(coalesce(proposal->'splits','[]'::jsonb)) loop
          if nullif(split_item->>'destinationSeason','') is not null
             and upper(btrim(split_item->>'destinationSeason')) = current_season then
            raise exception using errcode = '22023', message = 'eval_work_move_destination_same_season';
          end if;
        end loop;
      end if;
    end loop;
  end loop;
end
$function$;
revoke all on function private.validate_reclass_v4_move_seasons(jsonb,jsonb) from public, anon, authenticated;
grant execute on function private.validate_reclass_v4_move_seasons(jsonb,jsonb) to service_role;

create or replace function private.validate_eval_work_inquiry_v4_strict(
  p_inquiry jsonb, p_itemcode text, p_context_rows jsonb
)
returns void language plpgsql security definer set search_path = ''
as $function$
declare projected jsonb; overlay jsonb; current_row jsonb; uid text;
begin
  if coalesce(p_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v4-split-moves-20261006' then
    perform private.validate_reclass_v4_move_seasons(p_inquiry,p_context_rows);
    for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays','[]'::jsonb)) loop
      uid := btrim(coalesce(overlay->>'unique_id',''));
      select value into current_row from jsonb_array_elements(coalesce(p_context_rows,'[]'::jsonb))
      where value->>'unique_id' = uid limit 1;
      if current_row is null then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
      if exists (
        select 1 from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) proposal
        where proposal->>'action' in ('move_up','move_down')
      ) and (not coalesce(overlay->'expected' ? 'ptronhand',false)
        or overlay #>> '{expected,ptronhand}' is distinct from current_row->>'ptronhand') then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
    end loop;
    projected := private.project_reclass_split_move_v4(p_inquiry,false);
    perform private.validate_eval_work_inquiry_legacy_v1(projected,p_itemcode,p_context_rows);
  else
    perform private.validate_eval_work_inquiry_legacy_v1(p_inquiry,p_itemcode,p_context_rows);
  end if;
end
$function$;
revoke all on function private.validate_eval_work_inquiry_v4_strict(jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function private.validate_eval_work_inquiry_v4_strict(jsonb,text,jsonb) to service_role;

create or replace function private.validate_drive_reclass_split_move_v4(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  itemcode_value text;
  context_rows jsonb;
  overlay_count integer;
  unique_count integer;
  row_overlay jsonb;
  locked_row public.ph_master_inventory;
begin
  perform private.project_reclass_split_move_v4(p_payload,false);
  select m.itemcode into itemcode_value
  from public.ph_master_inventory m
  where btrim(coalesce(m.unique_id,'')) = btrim(coalesce(p_payload #>> '{source,unique_id}', p_payload #>> '{source,uniqueId}', ''))
  limit 1;
  select count(*), count(distinct value->>'unique_id') into overlay_count, unique_count
  from jsonb_array_elements(p_payload->'rowOverlays');
  if overlay_count <> unique_count then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_DUPLICATE_ROW';
  end if;
  for row_overlay in select value from jsonb_array_elements(p_payload->'rowOverlays') loop
    select m.* into locked_row
    from public.ph_master_inventory m
    where btrim(coalesce(m.unique_id,'')) = btrim(coalesce(row_overlay->>'unique_id',''))
    for share;
    if locked_row.unique_id is null then
      raise exception using errcode = '40001', message = 'DRIVE_RECLASS_SOURCE_CHANGED';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(row_overlay->'proposals','[]'::jsonb)) proposal
      where proposal->>'action' in ('move_up','move_down')
    ) and (not coalesce(row_overlay->'expected' ? 'ptronhand',false)
      or row_overlay #>> '{expected,ptronhand}' is distinct from to_jsonb(locked_row)->>'ptronhand') then
      raise exception using errcode = '40001', message = 'DRIVE_RECLASS_SOURCE_CHANGED';
    end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into context_rows
  from public.ph_master_inventory m
  where exists (
    select 1 from jsonb_array_elements(p_payload->'rowOverlays') item
    where btrim(coalesce(item->>'unique_id','')) <> ''
      and btrim(coalesce(m.unique_id,'')) = btrim(item->>'unique_id')
  );
  if itemcode_value is null then
    raise exception using errcode = '40001', message = 'DRIVE_RECLASS_SOURCE_MISSING';
  end if;
  perform private.validate_reclass_v4_move_seasons(p_payload,context_rows);
  perform private.validate_eval_work_inquiry_legacy_v1(private.project_reclass_split_move_v4(p_payload,false),itemcode_value,context_rows);
end
$function$;

revoke all on function private.validate_drive_reclass_split_move_v4(jsonb) from public, anon, authenticated;
grant execute on function private.validate_drive_reclass_split_move_v4(jsonb) to service_role;

create or replace function public.enqueue_drive_reclass_inquiry_v4(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  legacy_envelope jsonb;
  result_value jsonb;
  event_row public.ph_request_delivery_outbox;
  actor_username text := lower(btrim(coalesce(p_payload->>'actorUsername','')));
  token text := btrim(coalesce(p_payload->>'idempotencyToken',p_payload->>'idempotency_token',''));
  event_key_value text;
  fingerprint text;
  saved_fingerprint text;
  final_payload jsonb;
  actor_profile public.profiles;
  actor_role text;
  access_scope text;
begin
  if actor_username = '' or length(token) < 12 or length(token) > 180 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_TOKEN_INVALID';
  end if;
  perform private.project_reclass_split_move_v4(p_payload);
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'workflowPolicyVersion', p_payload->>'workflowPolicyVersion',
    'source', p_payload->'source', 'transaction', p_payload->'transaction', 'rowOverlays', p_payload->'rowOverlays'
  )::text,'UTF8'),'sha256'),'hex');
  event_key_value := 'reclass-inquiry:' || left(encode(extensions.digest(token,'sha256'),'hex'),40);
  perform pg_advisory_xact_lock(hashtextextended(event_key_value,0));
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key = event_key_value and o.event_type = 'reclass_inquiry' for update;
  if event_row.event_id is not null then
    if lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}',''))) <> actor_username then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    select p.* into actor_profile from public.profiles p
    where lower(btrim(p.username)) = actor_username and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password limit 1;
    if actor_profile.id is null then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PROFILE_NOT_ACTIVE';
    end if;
    actor_role := private.normalized_profile_role(actor_profile.role);
    if actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR') and actor_role not like '%EVAL%' then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_FORBIDDEN';
    end if;
    select e.access_scope into access_scope
    from private.get_effective_app_permissions_v1(actor_profile.id, private.resolve_app_access_policy_id_v1(false)) e
    where e.permission_key = 'drive.reclass.submit' and e.allowed limit 1;
    if access_scope is null then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PERMISSION_REQUIRED';
    end if;
    saved_fingerprint := event_row.payload #>> '{reclassPayload,protectedDelivery,requestFingerprint}';
    if event_row.payload #>> '{reclassPayload,workflowPolicyVersion}' <> 'reclass-action-workflow-v4-split-moves-20261006'
       or saved_fingerprint is distinct from fingerprint then
      raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_TOKEN_CONFLICT';
    end if;
    return private.drive_reclass_delivery_result_v1(event_row) || jsonb_build_object('duplicate',true);
  end if;
  -- Reuse V1 authorization, recipients and its Requested audit INSERT trigger.
  -- Keep the original proposal data so that trigger records every split/hold.
  -- Only the compatibility envelope is V3: the final outbox becomes V4 below
  -- before this transaction commits. Any validation failure rolls both back.
  legacy_envelope := p_payload || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v3-row-actions-20260826',
    'actorUsername',actor_username,'idempotencyToken',token
  );
  result_value := public.enqueue_drive_reclass_inquiry_v1(legacy_envelope);
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key = event_key_value and o.event_type = 'reclass_inquiry' for update;
  if event_row.event_id is null or lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}',''))) <> actor_username then
    raise exception using errcode = '42501', message = 'DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
  end if;
  if coalesce(result_value->>'duplicate','false') = 'true' then
    raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_TOKEN_CONFLICT';
  end if;
  perform private.validate_drive_reclass_split_move_v4(p_payload);
  final_payload := jsonb_set(event_row.payload, '{reclassPayload}',
      (event_row.payload->'reclassPayload') || jsonb_build_object(
        'workflowPolicyVersion','reclass-action-workflow-v4-split-moves-20261006',
        'transaction',p_payload->'transaction', 'rowOverlays',p_payload->'rowOverlays',
        'protectedDelivery',(event_row.payload->'reclassPayload'->'protectedDelivery') || jsonb_build_object('requestFingerprint',fingerprint)
      ), false);
  if octet_length(convert_to(final_payload::text,'UTF8')) > 4 * 1024 * 1024 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V4_PAYLOAD_TOO_LARGE';
  end if;
  update public.ph_request_delivery_outbox o
  set payload = final_payload, updated_at = now()
  where o.event_id = event_row.event_id
  returning * into event_row;
  return private.drive_reclass_delivery_result_v1(event_row)
    || jsonb_build_object('duplicate',false,'unavailableUsernames',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,unavailableUsernames}','[]'::jsonb));
end
$function$;

revoke all on function public.enqueue_drive_reclass_inquiry_v4(jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_drive_reclass_inquiry_v4(jsonb) to service_role;

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('edge.drive.reclass.v4', 'drive.reclass.submit', 'edge', 'The app API routes split-move V4 through the authenticated service-only enqueue RPC.'),
  ('rpc.drive.reclass.v4', 'drive.reclass.submit', 'rpc', 'V4 split instructions are validated against current inventory and queued atomically without inventory mutation.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;



notify pgrst, 'reload schema';

commit;
