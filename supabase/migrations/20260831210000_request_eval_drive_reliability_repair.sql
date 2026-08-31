begin;

-- A qualified reference is required here. The previous implementation allowed
-- the inner outbox request_id column to shadow the unnested active request id,
-- which prevented a fully completed folder from producing its V2 event.
create or replace function private.reconcile_request_folder_completion_v2(p_request_folder text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  folder_value text := trim(coalesce(p_request_folder, ''));
  request_ids text[];
  membership_signature_value text;
  state_row private.ph_request_folder_delivery_state;
  all_complete boolean := false;
  dependency_keys text[];
  creation_dependency_coverage boolean := false;
  event_key_value text;
  completion_event public.ph_request_delivery_outbox;
begin
  if folder_value = '' then return jsonb_build_object('queued', false, 'reason', 'folder_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('request-folder-v2:' || folder_value, 0));

  select coalesce(array_agg(r.unique_id order by r.unique_id), '{}'::text[]),
         coalesce(bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
           or nullif(trim(coalesce(r.date_completed, '')), '') is not null), false)
    into request_ids, all_complete
  from public.ph_active_request r
  where trim(coalesce(r.request_folder, '')) = folder_value
    and coalesce(r.req_archived, false) = false
    and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled');

  membership_signature_value := md5(coalesce(array_to_string(request_ids, E'\n'), 'empty'));
  select * into state_row from private.ph_request_folder_delivery_state
  where request_folder = folder_value for update;

  if state_row.request_folder is null then
    insert into private.ph_request_folder_delivery_state(
      request_folder, membership_version, membership_signature, active_request_ids)
    values (folder_value, 1, membership_signature_value, request_ids)
    returning * into state_row;
  elsif state_row.membership_signature <> membership_signature_value then
    update private.ph_request_folder_delivery_state set
      membership_version = membership_version + 1,
      membership_signature = membership_signature_value,
      active_request_ids = request_ids,
      completion_event_key = null,
      updated_at = now()
    where request_folder = folder_value returning * into state_row;
  else
    update private.ph_request_folder_delivery_state set active_request_ids = request_ids, updated_at = now()
    where request_folder = folder_value returning * into state_row;
  end if;

  update public.ph_request_delivery_outbox o set status = 'suppressed',
    sanitized_error_code = 'FOLDER_MEMBERSHIP_SUPERSEDED', updated_at = now()
  where o.request_folder = folder_value and o.event_type = 'request_completed'
    and o.status in ('pending','failed','unknown')
    and coalesce(o.payload->>'contractVersion', '') = 'request-folder-completion-v2'
    and coalesce((o.payload->>'membershipVersion')::bigint, 0) <> state_row.membership_version;

  if cardinality(request_ids) = 0 or not all_complete then
    return jsonb_build_object('queued', false, 'membershipVersion', state_row.membership_version,
      'activeCount', cardinality(request_ids), 'reason', 'folder_incomplete');
  end if;

  select coalesce(array_agg(o.event_key order by o.created_at, o.event_key), '{}'::text[])
    into dependency_keys
  from public.ph_request_delivery_outbox o
  where o.request_folder = folder_value and o.event_type = 'request_created'
    and coalesce(o.payload->'request_ids', '[]'::jsonb) ?| request_ids;

  select coalesce(bool_and(exists (
    select 1 from public.ph_request_delivery_outbox created
    where created.request_folder = folder_value
      and created.event_type = 'request_created'
      and coalesce(created.payload->'request_ids', '[]'::jsonb) ? active_request.request_id
  )), false) into creation_dependency_coverage
  from unnest(request_ids) as active_request(request_id);

  if not creation_dependency_coverage then
    return jsonb_build_object('queued', false, 'membershipVersion', state_row.membership_version,
      'activeCount', cardinality(request_ids), 'reason', 'waiting_for_request_created_event');
  end if;

  event_key_value := 'request-folder-completed:' || md5(folder_value) || ':v' || state_row.membership_version::text;
  insert into public.ph_request_delivery_outbox(
    event_key, event_type, request_folder, payload, status, next_attempt_at)
  values (
    event_key_value, 'request_completed', folder_value,
    jsonb_build_object(
      'contractVersion', 'request-folder-completion-v2',
      'activeRequestIds', to_jsonb(request_ids), 'request_ids', to_jsonb(request_ids),
      'membershipVersion', state_row.membership_version,
      'membershipSignature', state_row.membership_signature,
      'dependencyEventKeys', to_jsonb(dependency_keys),
      'updatedCompletion', state_row.last_delivered_version > 0
    ), 'pending', now()
  ) on conflict (event_key) do update set
      payload = excluded.payload,
      status = case when public.ph_request_delivery_outbox.status = 'suppressed' then 'pending' else public.ph_request_delivery_outbox.status end,
      next_attempt_at = least(public.ph_request_delivery_outbox.next_attempt_at, now()),
      updated_at = now()
  returning * into completion_event;

  update private.ph_request_folder_delivery_state set completion_event_key = event_key_value, updated_at = now()
  where request_folder = folder_value;

  return jsonb_build_object('queued', true, 'eventId', completion_event.event_id,
    'membershipVersion', state_row.membership_version, 'activeCount', cardinality(request_ids));
end
$function$;

create or replace function public.reconcile_request_folder_completion_window_v2(
  p_from timestamptz,
  p_to timestamptz,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate record;
  result jsonb;
  eligible_count integer := 0;
  eligible_row_count integer := 0;
  queued_count integer := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'REQUEST_COMPLETION_RECONCILE_FORBIDDEN';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '8 days' then
    raise exception using errcode = '22023', message = 'REQUEST_COMPLETION_RECONCILE_WINDOW_INVALID';
  end if;

  for candidate in
    with active as (
      select trim(r.request_folder) as request_folder,
             count(*)::integer as active_count,
             bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
               or nullif(trim(coalesce(r.date_completed, '')), '') is not null) as all_complete,
             max(private.try_timestamptz(r.date_completed)) as completed_at
      from public.ph_active_request r
      where trim(coalesce(r.request_folder, '')) <> ''
        and coalesce(r.req_archived, false) = false
        and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled')
      group by trim(r.request_folder)
    )
    select active.request_folder, active.active_count
    from active
    left join private.ph_request_folder_delivery_state state
      on state.request_folder = active.request_folder
    where active.all_complete
      and active.completed_at >= p_from and active.completed_at < p_to
      and not exists (
        select 1
        from public.ph_request_delivery_outbox completion
        where completion.request_folder = active.request_folder
          and completion.event_type = 'request_completed'
          and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
          and completion.status <> 'suppressed'
          and (state.request_folder is null
            or coalesce((completion.payload->>'membershipVersion')::bigint, 0) = state.membership_version)
      )
    order by active.request_folder
  loop
    eligible_count := eligible_count + 1;
    eligible_row_count := eligible_row_count + candidate.active_count;
    if not coalesce(p_dry_run, true) then
      result := private.reconcile_request_folder_completion_v2(candidate.request_folder);
      if coalesce((result->>'queued')::boolean, false) then queued_count := queued_count + 1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'contract_version', 'request-folder-completion-reconcile-v2',
    'dry_run', coalesce(p_dry_run, true),
    'eligible_folder_count', eligible_count,
    'eligible_row_count', eligible_row_count,
    'queued_folder_count', queued_count
  );
end
$function$;

-- Client assignment previews are advisory. The server still proves that the
-- current assignment is within the selected filter before creating any work.
create or replace function public.create_eval_work_batch_v2(p_payload jsonb)
returns setof public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  assignee public.profiles;
  item jsonb;
  origin public.ph_master_inventory;
  first_origin public.ph_master_inventory;
  work public.ph_eval_work;
  delivery public.ph_request_delivery_outbox;
  items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  inquiry jsonb;
  context_rows jsonb;
  settings jsonb;
  origin_ids text[];
  selected_filters text[];
  matched_users text[];
  hinted_users text[];
  assignment_refreshed boolean := false;
  extra_recipients text[];
  required_recipients text[];
  completion_recipients text[];
  assignment_recipients text[];
  create_token_value text;
  batch_token_value text := trim(coalesce(p_payload->>'batchToken', ''));
  membership_signature text;
  ordinal_value integer;
begin
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly') then
    raise exception using errcode = '42501', message = 'eval_work_batch_create_forbidden';
  end if;
  assignee := private.eval_work_assert_actor_v1(p_payload->>'assigneeUsername');
  if trim(coalesce(p_payload->>'assigneeEmail', '')) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'eval_work_assignee_email_invalid';
  end if;
  if length(batch_token_value) < 16 or length(batch_token_value) > 240
     or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) < 1 or jsonb_array_length(items) > 50 then
    raise exception using errcode = '22023', message = 'eval_work_batch_invalid';
  end if;

  required_recipients := private.eval_work_required_manager_emails_v2();
  if cardinality(required_recipients) <> 2 then
    raise exception using errcode = '40001', message = 'eval_work_required_manager_recipient_unavailable';
  end if;
  select coalesce(array_agg(distinct lower(trim(value))) filter (
    where trim(value) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'), '{}'::text[])
  into extra_recipients
  from jsonb_array_elements_text(coalesce(p_payload->'completionRecipients', '[]'::jsonb));
  select array_agg(distinct value order by value) into completion_recipients
  from unnest(required_recipients || coalesce(extra_recipients, '{}'::text[])) value;
  select array_agg(distinct value order by value) into assignment_recipients
  from unnest(required_recipients || array[lower(trim(p_payload->>'assigneeEmail'))]) value;

  for item in select value from jsonb_array_elements(items) loop
    create_token_value := trim(coalesce(item->>'createToken', ''));
    if length(create_token_value) < 16 or length(create_token_value) > 240
       or trim(coalesce(item->>'itemcode', '')) = '' then
      raise exception using errcode = '22023', message = 'eval_work_multi_origin_item_invalid';
    end if;
    context_rows := private.eval_work_itemcode_context_rows_v1(item->>'itemcode');
    if jsonb_array_length(context_rows) < 1 then
      raise exception using errcode = '40001', message = 'eval_work_itemcode_membership_empty';
    elsif jsonb_array_length(context_rows) > 100 then
      raise exception using errcode = '40001', message = 'eval_work_itemcode_row_limit_conflict';
    end if;
    select coalesce(array_agg(value), '{}'::text[]) into selected_filters
    from jsonb_array_elements_text(coalesce(
      item#>'{reportContext,selectedUserFilters}',
      item#>'{reportContext,assignedToUsers}',
      jsonb_build_array('all_users')
    )) value;
    matched_users := private.eval_work_match_assignment_users_v1(item->>'itemcode', selected_filters);
    inquiry := private.eval_work_expand_inquiry_rows_v1(coalesce(item->'inquiry', '{}'::jsonb), context_rows);
    perform private.validate_eval_work_inquiry_v1(inquiry, item->>'itemcode', context_rows);
  end loop;

  settings := private.eval_work_settings_v1();
  if jsonb_typeof(settings) <> 'object' or coalesce(settings->>'seasonCode', '') = '' or coalesce(settings->>'salesYear', '') = '' then
    raise exception using errcode = '40001', message = 'eval_work_settings_unavailable';
  end if;

  for item in select value from jsonb_array_elements(items) loop
    create_token_value := trim(item->>'createToken');
    select * into work from public.ph_eval_work where create_token = create_token_value limit 1;
    if work.id is not null then
      if lower(work.creator_username) <> lower(actor.username) or work.contract_version <> 'eval-work-v2-multi-origin' then
        raise exception using errcode = '42501', message = 'eval_work_create_token_forbidden';
      end if;
      return next work;
      continue;
    end if;

    context_rows := private.eval_work_itemcode_context_rows_v1(item->>'itemcode');
    select array_agg(value->>'unique_id' order by ordinality) into origin_ids
    from jsonb_array_elements(context_rows) with ordinality;
    membership_signature := private.eval_work_membership_signature_v1(context_rows);
    select * into first_origin from public.ph_master_inventory where unique_id = origin_ids[1];
    inquiry := private.eval_work_expand_inquiry_rows_v1(coalesce(item->'inquiry', '{}'::jsonb), context_rows);
    select coalesce(array_agg(value), '{}'::text[]) into selected_filters
    from jsonb_array_elements_text(coalesce(
      item#>'{reportContext,selectedUserFilters}',
      item#>'{reportContext,assignedToUsers}',
      jsonb_build_array('all_users')
    )) value;
    matched_users := private.eval_work_match_assignment_users_v1(item->>'itemcode', selected_filters);
    select coalesce(array_agg(distinct private.eval_normalize_user_v2(value) order by private.eval_normalize_user_v2(value)), '{}'::text[])
      into hinted_users
    from jsonb_array_elements_text(coalesce(item#>'{reportContext,matchedAssignedToUsers}', '[]'::jsonb)) value
    where private.eval_normalize_user_v2(value) <> '';
    assignment_refreshed := cardinality(hinted_users) > 0 and hinted_users is distinct from matched_users;

    insert into public.ph_eval_work (
      create_token, contract_version, creator_username, creator_display,
      assignee_username, assignee_display, assignee_email, instructions,
      completion_recipients, itemcode, commonname, contsize,
      origin_unique_id, origin_locationcode, origin_lotcode, origin_source,
      origin_snapshot, context_rows, inventory_signature, settings_signature,
      inquiry_draft, origin_count, assigned_to_users, batch_token, source_context
    ) values (
      create_token_value, 'eval-work-v2-multi-origin', lower(actor.username), coalesce(nullif(actor.display_name, ''), actor.username),
      lower(assignee.username), coalesce(nullif(assignee.display_name, ''), assignee.username), lower(trim(p_payload->>'assigneeEmail')),
      left(trim(coalesce(p_payload->>'instructions', '')), 4000), completion_recipients,
      first_origin.itemcode, coalesce(first_origin.commonname, ''), coalesce(first_origin.contsize, ''),
      first_origin.unique_id, coalesce(first_origin.locationcode, ''), coalesce(first_origin.lotcode, ''), coalesce(first_origin.source, ''),
      to_jsonb(first_origin), context_rows, membership_signature, md5(settings::text), inquiry,
      cardinality(origin_ids), matched_users, batch_token_value,
      jsonb_build_object(
        'scopeContract', 'itemcode-all-rows-v1',
        'membershipSignature', membership_signature,
        'membershipCount', cardinality(origin_ids),
        'assignmentRefreshed', assignment_refreshed,
        'report', coalesce(item->'reportContext', '{}'::jsonb) || jsonb_build_object(
          'selectedUserFilters', to_jsonb(selected_filters),
          'matchedAssignedToUsers', to_jsonb(matched_users),
          'assignmentRefreshed', assignment_refreshed
        ),
        'inventorySignature', left(coalesce(p_payload->>'inventorySignature', ''), 512),
        'settingsSignature', left(coalesce(p_payload->>'settingsSignature', ''), 1024)
      )
    ) returning * into work;

    ordinal_value := 0;
    for origin in
      select m.*
      from public.ph_master_inventory m
      join unnest(origin_ids) with ordinality selected(uid, ordinal) on selected.uid = m.unique_id
      order by selected.ordinal
    loop
      ordinal_value := ordinal_value + 1;
      insert into public.ph_eval_work_origin_rows (
        eval_work_id, origin_unique_id, itemcode, locationcode, lotcode, source,
        block_alpha, block_number, ordinal, origin_snapshot
      ) values (
        work.id, origin.unique_id, origin.itemcode, coalesce(origin.locationcode, ''),
        coalesce(origin.lotcode, ''), coalesce(origin.source, ''),
        private.eval_work_block_alpha_v2(origin.locationcode), private.eval_work_block_number_v2(origin.locationcode),
        ordinal_value, to_jsonb(origin)
      );
    end loop;

    insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
    values (work.id, 'created', lower(actor.username), work.version,
      jsonb_build_object('originCount', work.origin_count, 'scopeContract', 'itemcode-all-rows-v1',
        'proposalCount', coalesce(jsonb_array_length(inquiry#>'{transaction,requestActions}'), 0),
        'assignmentRefreshed', assignment_refreshed));

    insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
    values (
      'eval-work:' || work.id::text || ':assignment:v' || work.version::text,
      'eval_work_assignment', work.id::text,
      jsonb_build_object(
        'contractVersion', 'eval-work-v2-multi-origin', 'scopeContract', 'itemcode-all-rows-v1',
        'membershipSignature', membership_signature, 'membershipCount', work.origin_count,
        'deliveryKind', 'assignment', 'evalWorkId', work.id,
        'assigneeUsername', work.assignee_username, 'assigneeDisplay', work.assignee_display,
        'assigneeEmail', work.assignee_email, 'assignmentRecipients', to_jsonb(assignment_recipients),
        'lockedManagerRecipients', jsonb_build_array('dylan_collyge', 'megan_kelly'),
        'creatorUsername', work.creator_username, 'creatorDisplay', work.creator_display,
        'instructions', work.instructions, 'itemcode', work.itemcode,
        'commonname', work.commonname, 'contsize', work.contsize,
        'source', jsonb_build_object('unique_id', work.origin_unique_id, 'itemcode', work.itemcode,
          'locationcode', work.origin_locationcode, 'lotcode', work.origin_lotcode, 'source_table', 'ph_master_inventory'),
        'origins', context_rows, 'selectedUserFilters', to_jsonb(selected_filters),
        'matchedAssignedToUsers', to_jsonb(matched_users), 'assignedToUsers', to_jsonb(work.assigned_to_users),
        'assignmentRefreshed', assignment_refreshed,
        'inquiry', work.inquiry_draft
      ), 'pending', now()
    ) on conflict (event_key) do update set payload = excluded.payload, updated_at = now()
    returning * into delivery;
    update public.ph_eval_work set assignment_event_id = delivery.event_id where id = work.id returning * into work;
    return next work;
  end loop;
  return;
end
$function$;

-- Drive evidence is canonical. Linked Request rows receive the complete saved
-- evidence bundle before completion-history triggers freeze their snapshots.
create or replace function public.save_drive_evidence_v1(
  p_master_uid text,
  p_expected_itemcode text,
  p_expected_locationcode text,
  p_expected_lotcode text,
  p_expected_signature text,
  p_evidence jsonb,
  p_complete boolean,
  p_workflow text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.profiles%rowtype;
  v_row public.ph_master_inventory%rowtype;
  v_saved public.ph_master_inventory%rowtype;
  v_existing private.drive_evidence_idempotency%rowtype;
  v_payload jsonb := coalesce(p_evidence, '{}'::jsonb);
  v_request_hash text;
  v_response jsonb;
  v_request_rows jsonb := '[]'::jsonb;
  v_unexpected_keys text[];
  v_workflow text := lower(btrim(coalesce(p_workflow, '')));
  v_saved_at timestamptz := now();
begin
  v_actor := private.require_active_admin_profile();

  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 12 and 180 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if char_length(btrim(coalesce(p_master_uid, ''))) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'INVALID_MASTER_IDENTITY';
  end if;
  if v_workflow not in ('season', 'location', 'notes') then
    raise exception using errcode = '22023', message = 'INVALID_DRIVE_WORKFLOW';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_PAYLOAD';
  end if;

  select array_agg(key order by key) into v_unexpected_keys
  from jsonb_object_keys(v_payload) as keys(key)
  where key not in ('spec', 'caliper', 'match', 'loc_match_qty', 'initial_ptr',
    'av_note', 'pick_note', 'comments', 'photo_link', 'photo_name');
  if coalesce(cardinality(v_unexpected_keys), 0) > 0 then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_DRIVE_EVIDENCE_FIELD';
  end if;
  if octet_length(v_payload::text) > 65536 then
    raise exception using errcode = '22023', message = 'DRIVE_EVIDENCE_PAYLOAD_TOO_LARGE';
  end if;

  v_request_hash := md5(concat_ws('|', btrim(p_master_uid), btrim(coalesce(p_expected_itemcode, '')),
    btrim(coalesce(p_expected_locationcode, '')), btrim(coalesce(p_expected_lotcode, '')),
    btrim(coalesce(p_expected_signature, '')), v_payload::text, coalesce(p_complete, false)::text, v_workflow));

  select * into v_existing from private.drive_evidence_idempotency
  where profile_id = v_actor.id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '40001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_set(v_existing.response_payload, '{recovered}', 'true'::jsonb, true);
  end if;

  select * into v_row from public.ph_master_inventory where unique_id = btrim(p_master_uid) for update;
  if not found then raise exception using errcode = 'P0002', message = 'DRIVE_ROW_NOT_FOUND'; end if;
  if upper(btrim(coalesce(v_row.itemcode, ''))) <> upper(btrim(coalesce(p_expected_itemcode, '')))
     or upper(btrim(coalesce(v_row.locationcode, ''))) <> upper(btrim(coalesce(p_expected_locationcode, '')))
     or upper(btrim(coalesce(v_row.lotcode, ''))) <> upper(btrim(coalesce(p_expected_lotcode, ''))) then
    raise exception using errcode = '40001', message = 'DRIVE_ROW_IDENTITY_CONFLICT';
  end if;
  if btrim(coalesce(p_expected_signature, '')) <> ''
     and v_row.last_updated is distinct from p_expected_signature::timestamptz then
    raise exception using errcode = '40001', message = 'DRIVE_ROW_STALE';
  end if;
  if v_payload ? 'match' and nullif(btrim(v_payload ->> 'match'), '') is not null
     and (v_payload ->> 'match') !~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then
    raise exception using errcode = '22023', message = 'INVALID_LOC_MATCH_PERCENT';
  end if;
  if v_payload ? 'photo_link' and octet_length(coalesce(v_payload ->> 'photo_link', '')) > 16000 then
    raise exception using errcode = '22023', message = 'PHOTO_REFERENCE_TOO_LARGE';
  end if;

  update public.ph_master_inventory
  set spec = case when v_payload ? 'spec' then nullif(btrim(v_payload ->> 'spec'), '') else spec end,
      caliper = case when v_payload ? 'caliper' then nullif(btrim(v_payload ->> 'caliper'), '') else caliper end,
      match = case when v_payload ? 'match' then nullif(btrim(v_payload ->> 'match'), '') else match end,
      loc_match_qty = case when v_payload ? 'loc_match_qty' then nullif(btrim(v_payload ->> 'loc_match_qty'), '') else loc_match_qty end,
      initial_ptr = case when v_payload ? 'initial_ptr' then nullif(btrim(v_payload ->> 'initial_ptr'), '') else initial_ptr end,
      av_note = case when v_payload ? 'av_note' then nullif(btrim(v_payload ->> 'av_note'), '') else av_note end,
      pic_note = case when v_payload ? 'pick_note' then nullif(btrim(v_payload ->> 'pick_note'), '') else pic_note end,
      sales_note = case when v_payload ? 'comments' then nullif(v_payload ->> 'comments', '') else sales_note end,
      photo_link = case when v_payload ? 'photo_link' then nullif(btrim(v_payload ->> 'photo_link'), '') else photo_link end,
      photo_name = case when v_payload ? 'photo_name' then nullif(btrim(v_payload ->> 'photo_name'), '') else photo_name end,
      date_completed = case when coalesce(p_complete, false) then v_saved_at else date_completed end,
      app_tab_assignment = case when coalesce(p_complete, false) then v_workflow else app_tab_assignment end,
      av_rule_priority_snapshot = case when v_payload <> '{}'::jsonb then priority else av_rule_priority_snapshot end,
      av_rule_holdstop_snapshot = case when v_payload <> '{}'::jsonb then concat_ws('|',
        nullif(btrim(coalesce(holdstopcode, '')), ''), nullif(btrim(coalesce(holdstopreason, '')), '')) else av_rule_holdstop_snapshot end,
      av_rule_spec_updated_at = case when v_payload ? 'spec' then v_saved_at else av_rule_spec_updated_at end,
      av_rule_caliper_updated_at = case when v_payload ? 'caliper' then v_saved_at else av_rule_caliper_updated_at end,
      av_rule_match_updated_at = case when v_payload ? 'match' then v_saved_at else av_rule_match_updated_at end,
      av_rule_av_note_updated_at = case when v_payload ? 'av_note' then v_saved_at else av_rule_av_note_updated_at end,
      av_rule_photo_updated_at = case when v_payload ? 'photo_link' or v_payload ? 'photo_name' then v_saved_at else av_rule_photo_updated_at end,
      av_rule_bundle_updated_at = case when v_payload <> '{}'::jsonb then v_saved_at else av_rule_bundle_updated_at end,
      last_updated = v_saved_at
  where unique_id = v_row.unique_id
  returning * into v_saved;

  with updated_requests as (
    update public.ph_active_request request
    set req_spec = v_saved.spec,
        req_caliper = v_saved.caliper,
        req_match = private.eval_work_safe_numeric_v1(v_saved.match),
        req_pic_note = v_saved.pic_note,
        req_sales_note = v_saved.sales_note,
        req_comments = v_saved.sales_note,
        av_note = v_saved.av_note,
        req_photo_link = v_saved.photo_link,
        req_photo_name = v_saved.photo_name,
        req_status = case when coalesce(p_complete, false) then 'Complete' else request.req_status end,
        date_completed = case when coalesce(p_complete, false) then v_saved_at::text else request.date_completed end,
        completed_by_username = case when coalesce(p_complete, false) then lower(btrim(v_actor.username)) else request.completed_by_username end,
        completed_by_display = case when coalesce(p_complete, false) then coalesce(nullif(btrim(v_actor.display_name), ''), v_actor.username) else request.completed_by_display end,
        app_tab_assignment = v_saved.app_tab_assignment,
        master_app_tab_assignment = v_saved.app_tab_assignment,
        row_version = coalesce(request.row_version, 0) + 1,
        updated_at = v_saved_at
    where request.master_id = v_row.unique_id
      and upper(btrim(coalesce(request.itemcode, ''))) = upper(btrim(coalesce(v_row.itemcode, '')))
      and upper(btrim(coalesce(request.locationcode, ''))) = upper(btrim(coalesce(v_row.locationcode, '')))
      and upper(btrim(coalesce(request.lotcode, ''))) = upper(btrim(coalesce(v_row.lotcode, '')))
      and coalesce(request.req_archived, false) = false
      and lower(btrim(coalesce(request.req_status, 'pending'))) not in ('complete','completed','done','archived','cancelled','canceled')
    returning request.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated_requests) order by updated_requests.unique_id), '[]'::jsonb)
  into v_request_rows from updated_requests;

  v_response := jsonb_build_object(
    'ok', true,
    'contractVersion', 'save-drive-evidence-v2-canonical',
    'row', to_jsonb(v_saved),
    'requestRows', v_request_rows,
    'completed', coalesce(p_complete, false),
    'canonicalConfirmed', true,
    'recovered', false
  );
  insert into private.drive_evidence_idempotency(profile_id, idempotency_key, request_hash, response_payload)
  values (v_actor.id, btrim(p_idempotency_key), v_request_hash, v_response);
  return v_response;
end
$function$;

create or replace function public.get_request_drive_evidence_health_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  mismatch_count bigint := 0;
  checked_count bigint := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'REQUEST_DRIVE_HEALTH_FORBIDDEN';
  end if;
  with latest_completion as (
    select distinct on (history.master_id)
      history.*,
      master.spec as master_spec,
      master.caliper as master_caliper,
      master.match as master_match,
      master.pic_note as master_pic_note,
      master.av_note as master_av_note,
      master.photo_link as master_photo_link,
      master.photo_name as master_photo_name,
      master.av_rule_bundle_updated_at as master_bundle_updated_at
    from public.ph_request_history history
    join public.ph_master_inventory master on master.unique_id = history.master_id
    where history.date_completed >= now() - interval '48 hours'
      and lower(btrim(coalesce(history.req_status, ''))) in ('complete','completed','done')
    order by history.master_id, history.date_completed desc nulls last, history.updated_at desc nulls last
  )
  select count(*), count(*) filter (where
      coalesce(btrim(history.req_spec), '') is distinct from coalesce(btrim(master.spec), '')
      or coalesce(btrim(history.req_caliper), '') is distinct from coalesce(btrim(master.caliper), '')
      or coalesce(btrim(history.req_match), '') is distinct from coalesce(btrim(master.match), '')
      or coalesce(btrim(history.req_pic_note), '') is distinct from coalesce(btrim(master.pic_note), '')
      or coalesce(btrim(history.av_note), '') is distinct from coalesce(btrim(master.av_note), '')
      or coalesce(btrim(history.req_photo_link), '') is distinct from coalesce(btrim(master.photo_link), '')
      or coalesce(btrim(history.req_photo_name), '') is distinct from coalesce(btrim(master.photo_name), '')
    )
  into checked_count, mismatch_count
  from latest_completion history
  cross join lateral (select
    history.master_spec as spec,
    history.master_caliper as caliper,
    history.master_match as match,
    history.master_pic_note as pic_note,
    history.master_av_note as av_note,
    history.master_photo_link as photo_link,
    history.master_photo_name as photo_name,
    history.master_bundle_updated_at as av_rule_bundle_updated_at
  ) master
  where master.av_rule_bundle_updated_at is null
    or master.av_rule_bundle_updated_at <= coalesce(history.date_completed, history.updated_at);
  return jsonb_build_object(
    'contract_version', 'request-drive-evidence-health-v1',
    'recent_completed_count', checked_count,
    'evidence_mismatch_count', mismatch_count
  );
end
$function$;

create or replace function public.repair_request_drive_evidence_v1(
  p_request_ids text[],
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate record;
  eligible_count integer := 0;
  repaired_count integer := 0;
  skipped_newer_count integer := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'REQUEST_DRIVE_REPAIR_FORBIDDEN';
  end if;
  if cardinality(coalesce(p_request_ids, '{}'::text[])) < 1
     or cardinality(p_request_ids) > 100 then
    raise exception using errcode = '22023', message = 'REQUEST_DRIVE_REPAIR_SCOPE_INVALID';
  end if;

  for candidate in
    with latest_completion as (
      select distinct on (history.master_id)
        history.*,
        master.spec as master_spec,
        master.caliper as master_caliper,
        master.match as master_match,
        master.pic_note as master_pic_note,
        master.av_note as master_av_note,
        master.photo_link as master_photo_link,
        master.photo_name as master_photo_name,
        master.av_rule_bundle_updated_at
      from public.ph_request_history history
      join public.ph_master_inventory master on master.unique_id = history.master_id
      where lower(btrim(coalesce(history.req_status, ''))) in ('complete','completed','done')
      order by history.master_id, history.date_completed desc nulls last, history.updated_at desc nulls last
    )
    select history.*
    from latest_completion history
    where history.unique_id = any(p_request_ids)
      and (
        coalesce(btrim(history.req_spec), '') is distinct from coalesce(btrim(history.master_spec), '')
        or coalesce(btrim(history.req_caliper), '') is distinct from coalesce(btrim(history.master_caliper), '')
        or coalesce(btrim(history.req_match), '') is distinct from coalesce(btrim(history.master_match), '')
        or coalesce(btrim(history.req_pic_note), '') is distinct from coalesce(btrim(history.master_pic_note), '')
        or coalesce(btrim(history.av_note), '') is distinct from coalesce(btrim(history.master_av_note), '')
        or coalesce(btrim(history.req_photo_link), '') is distinct from coalesce(btrim(history.master_photo_link), '')
        or coalesce(btrim(history.req_photo_name), '') is distinct from coalesce(btrim(history.master_photo_name), '')
      )
    order by history.master_id
  loop
    eligible_count := eligible_count + 1;
    if candidate.av_rule_bundle_updated_at is not null
       and candidate.av_rule_bundle_updated_at > coalesce(candidate.date_completed, candidate.updated_at) then
      skipped_newer_count := skipped_newer_count + 1;
      continue;
    end if;
    if not coalesce(p_dry_run, true) then
      update public.ph_master_inventory
      set spec = nullif(btrim(candidate.req_spec), ''),
          caliper = nullif(btrim(candidate.req_caliper), ''),
          match = nullif(btrim(candidate.req_match), ''),
          pic_note = nullif(btrim(candidate.req_pic_note), ''),
          sales_note = nullif(candidate.req_comments, ''),
          av_note = nullif(btrim(candidate.av_note), ''),
          photo_link = nullif(btrim(candidate.req_photo_link), ''),
          photo_name = nullif(btrim(candidate.req_photo_name), ''),
          av_rule_bundle_updated_at = coalesce(candidate.date_completed, candidate.updated_at),
          av_rule_av_note_updated_at = coalesce(candidate.date_completed, candidate.updated_at),
          av_rule_spec_updated_at = coalesce(candidate.date_completed, candidate.updated_at),
          av_rule_match_updated_at = coalesce(candidate.date_completed, candidate.updated_at),
          av_rule_caliper_updated_at = coalesce(candidate.date_completed, candidate.updated_at),
          av_rule_photo_updated_at = coalesce(candidate.date_completed, candidate.updated_at),
          last_updated = now()
      where unique_id = candidate.master_id;
      repaired_count := repaired_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'contract_version', 'request-drive-evidence-repair-v1',
    'dry_run', coalesce(p_dry_run, true),
    'eligible_count', eligible_count,
    'repaired_count', repaired_count,
    'skipped_newer_count', skipped_newer_count
  );
end
$function$;

create or replace function public.get_eval_request_delivery_health_snapshot_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_manager_emails text[] := private.eval_work_required_manager_emails_v2();
  creation_order_violations bigint := 0;
  membership_mismatches bigint := 0;
  missing_completion_events bigint := 0;
  eval_origin_mismatches bigint := 0;
  eval_recipient_violations bigint := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_HEALTH_FORBIDDEN';
  end if;

  select count(*) into creation_order_violations
  from public.ph_request_delivery_outbox completion
  where completion.event_type = 'request_completed'
    and completion.status = 'delivered'
    and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(completion.payload->'dependencyEventKeys', '[]'::jsonb)) dependency(event_key)
      left join public.ph_request_delivery_outbox created on created.event_key = dependency.event_key
      where created.event_id is null or created.status <> 'delivered'
         or created.delivered_at is null or completion.delivered_at is null
         or created.delivered_at > completion.delivered_at
    );

  select count(*) into membership_mismatches
  from public.ph_request_delivery_outbox completion
  join private.ph_request_folder_delivery_state state on state.request_folder = completion.request_folder
  where completion.event_type = 'request_completed'
    and completion.status <> 'suppressed'
    and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
    and (coalesce((completion.payload->>'membershipVersion')::bigint, 0) <> state.membership_version
      or coalesce(completion.payload->>'membershipSignature', '') <> state.membership_signature
      or coalesce(jsonb_array_length(completion.payload->'activeRequestIds'), 0) <> cardinality(state.active_request_ids));

  with active as (
    select trim(r.request_folder) as request_folder,
           bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
             or nullif(trim(coalesce(r.date_completed, '')), '') is not null) as all_complete,
           max(private.try_timestamptz(r.date_completed)) as completed_at
    from public.ph_active_request r
    where trim(coalesce(r.request_folder, '')) <> ''
      and coalesce(r.req_archived, false) = false
      and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled')
    group by trim(r.request_folder)
  )
  select count(*) into missing_completion_events
  from active
  left join private.ph_request_folder_delivery_state state on state.request_folder = active.request_folder
  where active.all_complete and active.completed_at >= now() - interval '48 hours'
    and not exists (
      select 1 from public.ph_request_delivery_outbox completion
      where completion.request_folder = active.request_folder
        and completion.event_type = 'request_completed'
        and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
        and completion.status <> 'suppressed'
        and (state.request_folder is null
          or coalesce((completion.payload->>'membershipVersion')::bigint, 0) = state.membership_version)
    );

  select count(*) into eval_origin_mismatches
  from public.ph_eval_work work
  where work.contract_version = 'eval-work-v2-multi-origin'
    and (work.origin_count <> (select count(*) from public.ph_eval_work_origin_rows origin where origin.eval_work_id = work.id)
      or exists (select 1 from public.ph_request_delivery_outbox delivery
        where delivery.request_id = work.id::text
          and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
          and delivery.payload->>'contractVersion' = 'eval-work-v2-multi-origin'
          and coalesce(jsonb_array_length(delivery.payload->'origins'), 0) <> work.origin_count));

  select count(*) into eval_recipient_violations
  from public.ph_request_delivery_outbox delivery
  where delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
    and delivery.payload->>'contractVersion' = 'eval-work-v2-multi-origin'
    and not (required_manager_emails <@ coalesce(array(
      select lower(trim(value))
      from jsonb_array_elements_text(case when delivery.event_type = 'eval_work_assignment'
        then coalesce(delivery.payload->'assignmentRecipients', '[]'::jsonb)
        else coalesce(delivery.payload->'completionRecipients', '[]'::jsonb) end) value
    ), '{}'::text[]));

  return jsonb_build_object(
    'contract_version', 'eval-request-delivery-health-v2',
    'required_manager_recipient_count', cardinality(required_manager_emails),
    'creation_order_violation_count', creation_order_violations,
    'completion_membership_mismatch_count', membership_mismatches,
    'missing_completion_event_count', missing_completion_events,
    'eval_origin_scope_mismatch_count', eval_origin_mismatches,
    'eval_required_recipient_violation_count', eval_recipient_violations
  );
end
$function$;

revoke all on function private.reconcile_request_folder_completion_v2(text) from public, anon, authenticated;
revoke all on function public.reconcile_request_folder_completion_window_v2(timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.create_eval_work_batch_v2(jsonb) from public, anon, authenticated;
revoke all on function public.save_drive_evidence_v1(text, text, text, text, text, jsonb, boolean, text, text) from public, anon;
revoke all on function public.get_request_drive_evidence_health_snapshot_v1() from public, anon, authenticated;
revoke all on function public.repair_request_drive_evidence_v1(text[], boolean) from public, anon, authenticated;
revoke all on function public.get_eval_request_delivery_health_snapshot_v2() from public, anon, authenticated;

grant execute on function public.reconcile_request_folder_completion_window_v2(timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.create_eval_work_batch_v2(jsonb) to service_role;
grant execute on function public.save_drive_evidence_v1(text, text, text, text, text, jsonb, boolean, text, text) to authenticated;
grant execute on function public.get_request_drive_evidence_health_snapshot_v1() to service_role;
grant execute on function public.repair_request_drive_evidence_v1(text[], boolean) to service_role;
grant execute on function public.get_eval_request_delivery_health_snapshot_v2() to service_role;

comment on function public.reconcile_request_folder_completion_window_v2(timestamptz, timestamptz, boolean) is
  'Service-only bounded and idempotent recovery for fully completed Request folders missing their V2 completion event.';
comment on function public.save_drive_evidence_v1(text, text, text, text, text, jsonb, boolean, text, text) is
  'Authenticated Admin-only canonical Drive evidence save with linked Request parity, idempotency, and canonical response rows.';
comment on function public.get_request_drive_evidence_health_snapshot_v1() is
  'Service-only sanitized count of recent Request completion evidence that differs from canonical Drive inventory.';
comment on function public.repair_request_drive_evidence_v1(text[], boolean) is
  'Service-only guarded repair of selected completed Request evidence when no newer canonical AV edit exists.';

commit;
