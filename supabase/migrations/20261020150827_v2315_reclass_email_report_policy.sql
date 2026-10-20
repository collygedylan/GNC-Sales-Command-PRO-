begin;

-- Resolve fixed Reclass recipients from active profiles and confirmed Auth
-- addresses; never trust a client-supplied email list.
create or replace function private.reclass_delivery_recipients_v1(p_actor_username text)
returns text[] language plpgsql stable security definer set search_path = '' as $function$
declare
  actor_key text := lower(btrim(coalesce(p_actor_username, '')));
  actor public.profiles%rowtype;
  recipients text[];
  required_count integer;
  expected_count integer := case when actor_key in ('dylan_collyge', 'megan_kelly') then 2 else 3 end;
begin
  if actor_key = '' then raise exception using errcode='22023',message='RECLASS_RECIPIENT_ACTOR_REQUIRED'; end if;
  select p.* into actor from public.profiles p
  where lower(btrim(p.username))=actor_key and p.disabled_at is null
    and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password limit 1;
  if actor.id is null then raise exception using errcode='42501',message='RECLASS_RECIPIENT_ACTOR_INACTIVE'; end if;
  select array_agg(distinct lower(btrim(u.email)) order by lower(btrim(u.email))),count(distinct lower(btrim(p.username)))::integer
    into recipients,required_count
  from public.profiles p join auth.users u on u.id=p.id
  where lower(btrim(p.username))=any(array['dylan_collyge','megan_kelly',actor_key])
    and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password
    and u.email_confirmed_at is not null
    and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
  if coalesce(cardinality(recipients),0)<1 or cardinality(recipients)>3
     or required_count<>expected_count
     or not exists (
       select 1 from public.profiles p join auth.users u on u.id=p.id
       where lower(btrim(p.username))='dylan_collyge' and p.disabled_at is null
         and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password
         and u.email_confirmed_at is not null
         and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     )
     or not exists (
       select 1 from public.profiles p join auth.users u on u.id=p.id
       where lower(btrim(p.username))='megan_kelly' and p.disabled_at is null
         and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password
         and u.email_confirmed_at is not null
         and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     ) then
    raise exception using errcode='40001',message='RECLASS_REQUIRED_RECIPIENTS_UNAVAILABLE';
  end if;
  return recipients;
end
$function$;
revoke all on function private.reclass_delivery_recipients_v1(text) from public,anon,authenticated,service_role;

create or replace function public.get_reclass_delivery_recipients_v1(p_actor_username text)
returns text[] language plpgsql stable security definer set search_path = '' as $function$
begin
  if not private.is_service_role_request() then raise exception using errcode='42501',message='RECLASS_RECIPIENTS_FORBIDDEN'; end if;
  return private.reclass_delivery_recipients_v1(p_actor_username);
end
$function$;
revoke all on function public.get_reclass_delivery_recipients_v1(text) from public,anon,authenticated;
grant execute on function public.get_reclass_delivery_recipients_v1(text) to service_role;

create or replace function public.get_eval_report2_direct_inquiry_recipients_v1(p_actor_username text)
returns text[] language plpgsql stable security definer set search_path = '' as $function$
declare
  actor public.profiles%rowtype;
  actor_key text;
begin
  actor:=private.eval_work_assert_actor_v1(p_actor_username);
  actor_key:=lower(btrim(actor.username));
  if actor_key not in ('dylan_collyge','megan_kelly','jd_jones') then
    raise exception using errcode='42501',message='eval_report2_direct_inquiry_forbidden';
  end if;
  return private.reclass_delivery_recipients_v1(actor_key);
end
$function$;
revoke all on function public.get_eval_report2_direct_inquiry_recipients_v1(text) from public,anon,authenticated;
grant execute on function public.get_eval_report2_direct_inquiry_recipients_v1(text) to service_role;

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
  applied_rows jsonb;
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

  -- Resolve the server-owned Dylan + Megan + active actor policy; never trust
  -- any recipient address from the request payload.
  recipient_emails := private.reclass_delivery_recipients_v1(actor_username);
  if actor_email <> all(recipient_emails) then raise exception using errcode='P0001',message='INVENTORY_RECLASS_REQUIRED_RECIPIENT_POLICY_INVALID'; end if;

  move_request_id := nullif(result_value->>'requestId', '')::uuid;
  if move_request_id is null then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING'; end if;
  select b.child_request_ids, b.result->'rows' into child_ids, applied_rows from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.actor_id = p_actor_id and b.command_id = p_command_id and b.request_id = move_request_id;
  if child_ids is null or jsonb_typeof(applied_rows) is distinct from 'array' or jsonb_array_length(applied_rows) < 1 then
    raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', m.direction,
      'destinationSeason', m.destination_season,
      'quantity', m.quantity,
      'source', jsonb_build_object('unique_id',m.source_unique_id,'itemcode', m.source_identity->>'itemcode',
        'commonname', coalesce(m.source_before->>'commonname', ''),
        'contsize', m.source_identity->>'contsize', 'locationcode', m.source_identity->>'locationcode',
        'lotcode', m.source_identity->>'lotcode', 'season', m.source_identity->>'season'),
      'destination', jsonb_build_object('unique_id',m.destination_unique_id,'itemcode', m.destination_identity->>'itemcode',
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
        'actorEmail', actor_email, 'revision',result_value->>'revision','moves',moves_value,'appliedRows',applied_rows,'deliveryRecipients',to_jsonb(recipient_emails)),
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
  expected_recipients text[];
  actor_username text;
  actor_email text;
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
    or receipt.result->>'requestId' is distinct from payload_value->>'requestId'
    or jsonb_typeof(receipt.result->'rows') is distinct from 'array'
    or jsonb_array_length(receipt.result->'rows') < 1 then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_INVALID';
  end if;
  actor_username := lower(btrim(coalesce(payload_value->>'actorUsername', '')));
  select lower(btrim(u.email)) into actor_email
  from public.profiles pr join auth.users u on u.id = pr.id
  where pr.id = (payload_value->>'actorProfileId')::uuid
    and lower(btrim(pr.username)) = actor_username
    and pr.disabled_at is null and (pr.locked_until is null or pr.locked_until <= now())
    and not pr.must_change_password and u.email_confirmed_at is not null
    and btrim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
  if actor_email is null then raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_MOVE_ACTOR_EMAIL_UNAVAILABLE'; end if;
  expected_recipients := private.reclass_delivery_recipients_v1(actor_username);
  if actor_email <> all(expected_recipients) then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_MOVE_RECIPIENTS_INVALID';
  end if;
  payload_value := payload_value || jsonb_build_object(
    'actorEmail', actor_email,
    'deliveryRecipients', to_jsonb(expected_recipients),
    'appliedRows', receipt.result->'rows'
  );
  update public.ph_request_delivery_outbox o set payload = payload_value, updated_at = clock_timestamp()
  where o.event_id = event_row.event_id and o.status = 'processing' and o.lease_token = p_lease_token;
  if not found then raise exception using errcode = '42501', message = 'DELIVERY_LEASE_LOST'; end if;
  return payload_value;
end;
$function$;

revoke all on function public.prepare_inventory_reclass_move_delivery_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_inventory_reclass_move_delivery_v1(uuid, uuid) to service_role;

create or replace function public.enqueue_drive_reclass_inquiry_v7(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  actor_username text := lower(btrim(coalesce(p_payload->>'actorUsername','')));
  token text := btrim(coalesce(p_payload->>'idempotencyToken',p_payload->>'idempotency_token',''));
  source_mode text := lower(btrim(coalesce(p_payload #>> '{sourceContext,sourceMode}','drive')));
  event_key_value text;
  fingerprint text;
  projected jsonb;
  prepared jsonb;
  v6_payload jsonb;
  v5_payload jsonb;
  v3_payload jsonb;
  trio_result jsonb;
  field_result jsonb;
  underlying jsonb;
  event_row public.ph_request_delivery_outbox;
  actor_profile public.profiles;
  recipients text[] := '{}'::text[];
  current_live jsonb;
  final_payload jsonb;
  live_rows jsonb := '[]'::jsonb;
  live_uid text;
  live_uids text[] := '{}'::text[];
  row_value public.ph_master_inventory;
  inventory_revision bigint;
  existing_fingerprint text;
  source_itemcode text;
  source_row public.ph_master_inventory;
  v6_live_scope jsonb := '{}'::jsonb;
  request_fingerprint text;
  old_tx jsonb;
begin
  if actor_username='' or length(token)<12 or length(token)>180 then
    raise exception using errcode='22023',message='DRIVE_RECLASS_TOKEN_INVALID';
  end if;
  projected:=private.project_reclass_editable_fields_v7(p_payload);
  if source_mode not in ('drive','item-inquiry','eval-report-2') then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_MODE_INVALID';
  end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('workflowPolicyVersion',projected->>'workflowPolicyVersion','source',projected->'source','sourceContext',projected->'sourceContext','recipientPolicy','reclass-dylan-megan-submitter-v1','transaction',projected->'transaction','rowOverlays',projected->'rowOverlays')::text,'UTF8'),'sha256'),'hex');
  event_key_value:='reclass-inquiry:'||left(encode(extensions.digest(token,'sha256'),'hex'),40);
  perform pg_advisory_xact_lock(hashtextextended(event_key_value,0));
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is not null then
    if lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}','')))<>actor_username then
      raise exception using errcode='42501',message='DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    select p.* into actor_profile from public.profiles p where lower(btrim(p.username))=actor_username
      and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password limit 1;
    if actor_profile.id is null then raise exception using errcode='42501',message='DRIVE_RECLASS_PROFILE_NOT_ACTIVE'; end if;
    if event_row.payload #>> '{reclassPayload,workflowPolicyVersion}'<>'reclass-action-workflow-v7-editable-fields-20261009'
       or event_row.payload #>> '{reclassPayload,protectedDelivery,requestFingerprint}' is distinct from fingerprint then
      raise exception using errcode='P0001',message='DRIVE_RECLASS_TOKEN_CONFLICT';
    end if;
    return private.drive_reclass_delivery_result_v1(event_row) || jsonb_build_object(
      'duplicate',true,
      'liveEdits',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,liveEdits}','[]'::jsonb),
      'inventoryRevision',event_row.payload #>> '{reclassPayload,protectedDelivery,inventoryRevision}',
      'liveEditScope',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,liveEditScope}','{}'::jsonb),
      'inventoryFields',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,inventoryFields}','[]'::jsonb),
      'v7Scope',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,v7Scope}','{}'::jsonb)
    );
  end if;

  perform private.lock_ph_master_inventory_for_live_edit_v6();
  prepared:=private.prepare_reclass_editable_fields_v7(projected,actor_username);
  v6_payload:=prepared->'v6Payload';
  v5_payload:=prepared->'v5Payload';
  source_itemcode:=upper(btrim(coalesce(projected #>> '{source,itemcode}','')));
  select m.* into source_row from public.ph_master_inventory m
  where m.unique_id=btrim(coalesce(projected #>> '{source,unique_id}',projected #>> '{source,uniqueId}',''));
  if source_row.unique_id is null or source_itemcode='' or upper(btrim(coalesce(source_row.itemcode,'')))<>source_itemcode then
    raise exception using errcode='40001',message='DRIVE_RECLASS_V7_SOURCE_CHANGED';
  end if;
  if source_mode='eval-report-2' then
    if lower(btrim(coalesce(projected #>> '{sourceContext,itemcode}','')))<>source_itemcode or not private.eval_report2_item_qualifies_v1(projected #>> '{sourceContext,reportId}',source_itemcode,now()) then raise exception using errcode='42501',message='DRIVE_RECLASS_V7_REPORT_SCOPE_FORBIDDEN'; end if;
  elsif source_mode='item-inquiry' and actor_username not in ('dylan_collyge','jd_jones','megan_kelly') then
    raise exception using errcode='42501',message='DRIVE_RECLASS_V7_ITEM_INQUIRY_FORBIDDEN';
  end if;
  recipients:=private.reclass_delivery_recipients_v1(actor_username);

  if coalesce((prepared->'v6Prepared'->'edits') is not null,false) then
    underlying:=public.enqueue_drive_reclass_inquiry_v6(v6_payload);
  elsif cardinality(array(select jsonb_array_elements_text(v5_payload #> '{transaction,requestActions}')))>0 then
    underlying:=public.enqueue_drive_reclass_inquiry_v5(v5_payload);
  else
    v3_payload:=v5_payload || jsonb_build_object(
      'workflowPolicyVersion','reclass-action-workflow-v3-row-actions-20260826',
      'transaction',(v5_payload->'transaction')||jsonb_build_object('requestActions','[]'::jsonb,'holdStopProposals','[]'::jsonb),
      'rowOverlays',(select coalesce(jsonb_agg(
        (value - 'proposals') || jsonb_build_object('proposals','[]'::jsonb,'expected',
          (value->'expected') - 'ptronhand' - 'desigitem' || jsonb_build_object(
            'ptronhand',value #>> '{expected,ptronhand}','desigitem',value #>> '{expected,desigitem}'))
        order by ordinality),'[]'::jsonb) from jsonb_array_elements(v5_payload->'rowOverlays') with ordinality a(value,ordinality))
    );
    underlying:=public.enqueue_drive_reclass_inquiry_v1(v3_payload || jsonb_build_object('actorUsername',actor_username,'idempotencyToken',token));
  end if;
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is null or lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}','')))<>actor_username then
    raise exception using errcode='42501',message='DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
  end if;
  if coalesce(underlying->>'duplicate','false')='true' then raise exception using errcode='P0001',message='DRIVE_RECLASS_TOKEN_CONFLICT'; end if;

  trio_result:=coalesce(underlying,'{}'::jsonb);
  field_result:=private.apply_reclass_editable_fields_v7(prepared->'fieldRows',actor_username,prepared->>'stampTime');
  select r.revision into inventory_revision from public.app_dataset_revisions r where r.key='ph_master_inventory';
  if inventory_revision is null then raise exception using errcode='55000',message='RECLASS_V7_INVENTORY_REVISION_MISSING'; end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into live_uids
  from (
    select value->>'unique_id' x from jsonb_array_elements(coalesce(trio_result->'liveEdits','[]'::jsonb))
    union select value->>'unique_id' from jsonb_array_elements(coalesce(field_result->'inventoryFields','[]'::jsonb))
  ) all_ids where nullif(x,'') is not null;
  for live_uid in select unnest(live_uids) loop
    select m.* into row_value from public.ph_master_inventory m where m.unique_id=live_uid;
    if row_value.unique_id is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_ROW_MISSING'; end if;
    live_rows:=live_rows||jsonb_build_array(jsonb_build_object(
      'unique_id',row_value.unique_id,'priority',row_value.priority,'holdstopcode',row_value.holdstopcode,
      'holdstopreason',row_value.holdstopreason,'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
      'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,'last_updated',row_value.last_updated,
      'evidence',jsonb_build_object(
        'unique_id',row_value.unique_id,'itemcode',row_value.itemcode,'locationcode',row_value.locationcode,'lotcode',row_value.lotcode,
        'last_updated',row_value.last_updated,'photo_link',row_value.photo_link,'photo_name',row_value.photo_name,
        'match',row_value.match,'spec',row_value.spec,'caliper',row_value.caliper,'initial_ptr',row_value.initial_ptr,
        'loc_match_qty',row_value.loc_match_qty,'ptravailable',row_value.ptravailable,'av_note',row_value.av_note,
        'pic_note',row_value.pic_note,'sales_note',row_value.sales_note,'date_completed',row_value.date_completed,
        'app_tab_assignment',row_value.app_tab_assignment,'av_rule_av_note_updated_at',row_value.av_rule_av_note_updated_at,
        'av_rule_bundle_updated_at',row_value.av_rule_bundle_updated_at,'av_rule_caliper_updated_at',row_value.av_rule_caliper_updated_at,
        'av_rule_holdstop_snapshot',row_value.av_rule_holdstop_snapshot,'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
        'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,'av_rule_match_updated_at',row_value.av_rule_match_updated_at,
        'av_rule_photo_updated_at',row_value.av_rule_photo_updated_at,'av_rule_priority_snapshot',row_value.av_rule_priority_snapshot,
        'av_rule_spec_updated_at',row_value.av_rule_spec_updated_at
      )
    ));
  end loop;

  update public.ph_request_delivery_outbox o set payload=jsonb_set(o.payload,'{reclassPayload}',(o.payload->'reclassPayload')||jsonb_build_object('sourceContext',projected->'sourceContext','recipientEmails',to_jsonb(recipients),'emailRecipients',to_jsonb(recipients),'recipients',(select coalesce(jsonb_agg(jsonb_build_object('email',email,'role','reclass_delivery') order by email),'[]'::jsonb) from unnest(recipients) email))) where o.event_id=event_row.event_id returning * into event_row;
  final_payload:=jsonb_set(event_row.payload,'{reclassPayload}',
    (event_row.payload->'reclassPayload')||jsonb_build_object(
      'workflowPolicyVersion','reclass-action-workflow-v7-editable-fields-20261009',
      'sourceContext',coalesce(projected->'sourceContext',jsonb_build_object('sourceMode','drive')),
      'transaction',projected->'transaction','rowOverlays',projected->'rowOverlays',
      'protectedDelivery',(coalesce(event_row.payload #> '{reclassPayload,protectedDelivery}','{}'::jsonb))||jsonb_build_object(
        'contractVersion','drive-reclass-protected-v1','requestFingerprint',fingerprint,
        'v7FrozenRows',prepared->'v7FrozenRows','liveEdits',live_rows,
        'inventoryFields',field_result->'inventoryFields','inventoryRevision',inventory_revision::text,
        'liveEditScope',coalesce(trio_result->'liveEditScope','{}'::jsonb),
        'v7Scope',jsonb_build_object('sourceMode',source_mode,'reportStamps',prepared->'reportStamps',
          'reportId',case when source_mode='eval-report-2' then projected #>> '{sourceContext,reportId}' else null end,
          'itemcode',source_itemcode)
      )
    ),false);
  if octet_length(convert_to(final_payload::text,'UTF8'))>4*1024*1024 then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_PAYLOAD_TOO_LARGE';
  end if;
  update public.ph_request_delivery_outbox o set payload=final_payload,updated_at=clock_timestamp()
  where o.event_id=event_row.event_id returning * into event_row;
  update public.ph_inventory_transactions t set raw_payload=jsonb_build_object(
    'workflowPolicyVersion',event_row.payload #>> '{reclassPayload,workflowPolicyVersion}',
    'transaction',event_row.payload #> '{reclassPayload,transaction}',
    'rowOverlays',event_row.payload #> '{reclassPayload,rowOverlays}',
    'protectedDelivery',event_row.payload #> '{reclassPayload,protectedDelivery}'
  ) where t.delivery_event_id=event_row.event_id and t.status='requested' and t.event_type='inventory_change_request';
  if not found then raise exception using errcode='55000',message='DRIVE_RECLASS_V7_REQUESTED_AUDIT_MISSING'; end if;
  return private.drive_reclass_delivery_result_v1(event_row)||jsonb_build_object(
    'duplicate',false,'liveEdits',live_rows,'inventoryFields',field_result->'inventoryFields',
    'inventoryRevision',inventory_revision::text,'liveEditScope',coalesce(trio_result->'liveEditScope','{}'::jsonb),
    'v7Scope',final_payload #> '{reclassPayload,protectedDelivery,v7Scope}'
  );
end
$function$;
revoke all on function public.enqueue_drive_reclass_inquiry_v7(jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_drive_reclass_inquiry_v7(jsonb) to service_role;

notify pgrst,'reload schema';
commit;
