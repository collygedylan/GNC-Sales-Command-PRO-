begin;

create index if not exists idx_ph_active_request_open_folder_append_v1
  on public.ph_active_request (
    (btrim(coalesce(request_folder, ''))),
    created_at,
    unique_id
  )
  where coalesce(req_archived, false) = false
    and lower(btrim(coalesce(req_status, 'pending'))) not in ('archived', 'cancelled', 'canceled');

create index if not exists idx_ph_request_delivery_outbox_folder_type_created_v1
  on public.ph_request_delivery_outbox (request_folder, event_type, created_at, event_key);

-- Existing request folders own their REP, customer, requirements, and email
-- thread. Appending a better inventory option must not depend on the REP picker
-- or create another assignment email.
create or replace function public.append_request_options_v1(
  p_client_batch_id uuid,
  p_request_folder text,
  p_source_request_id text,
  p_inventory_row_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles%rowtype;
  actor_email text;
  source_request public.ph_active_request%rowtype;
  source_master public.ph_master_inventory%rowtype;
  candidate public.ph_master_inventory%rowtype;
  thread_row public.ph_request_email_threads%rowtype;
  existing_event public.ph_request_delivery_outbox%rowtype;
  selected_ids text[];
  inserted_ids text[] := '{}'::text[];
  snapshots jsonb := '[]'::jsonb;
  folder_value text := btrim(coalesce(p_request_folder, ''));
  source_id_value text := btrim(coalesce(p_source_request_id, ''));
  candidate_id text;
  request_id text;
  rep_name text;
  customer_name text;
  selected_rep_username text;
  selected_rep_display text;
  selected_rep_email text;
  rep_context_count integer := 0;
  customer_context_count integer := 0;
  active_count integer := 0;
  completed_count integer := 0;
  inserted_count integer := 0;
  skipped_duplicate_count integer := 0;
  source_itemcode_key text;
  source_commonname_key text;
  source_contsize_key text;
  candidate_itemcode_key text;
  candidate_commonname_key text;
  candidate_contsize_key text;
begin
  actor := private.current_active_profile();
  if actor.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;
  if not private.can_create_general_requests() then
    raise exception using errcode = '42501', message = 'REQUEST_OPTION_APPEND_FORBIDDEN';
  end if;
  if p_client_batch_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_OPTION_BATCH_ID_REQUIRED';
  end if;
  if folder_value = '' or source_id_value = '' then
    raise exception using errcode = '22023', message = 'REQUEST_OPTION_SOURCE_REQUIRED';
  end if;

  select coalesce(array_agg(distinct btrim(value) order by btrim(value)), '{}'::text[])
    into selected_ids
  from unnest(coalesce(p_inventory_row_ids, '{}'::text[])) value
  where btrim(coalesce(value, '')) <> '';

  if cardinality(selected_ids) < 1 or cardinality(selected_ids) > 100 then
    raise exception using errcode = '22023', message = 'REQUEST_OPTION_SELECTION_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('request-option-append:' || folder_value, 0));

  select * into existing_event
  from public.ph_request_delivery_outbox event
  where event.event_key = 'request-options-appended:' || p_client_batch_id::text
  limit 1;

  if existing_event.event_id is not null then
    if existing_event.request_folder is distinct from folder_value
       or coalesce(existing_event.payload->>'sourceRequestId', '') is distinct from source_id_value then
      raise exception using errcode = '23505', message = 'REQUEST_OPTION_BATCH_CONFLICT';
    end if;
    select coalesce(jsonb_agg(private.canonical_request_json(request.unique_id) order by request.created_at, request.unique_id), '[]'::jsonb)
      into snapshots
    from public.ph_active_request request
    where request.client_batch_id = p_client_batch_id
      and btrim(coalesce(request.request_folder, '')) = folder_value;
    return jsonb_build_object(
      'status', 'options_added',
      'request_folder', folder_value,
      'inserted_count', coalesce(nullif(existing_event.payload->>'insertedCount', '')::integer, jsonb_array_length(snapshots)),
      'skipped_duplicate_count', coalesce(nullif(existing_event.payload->>'skippedDuplicateCount', '')::integer, 0),
      'rows', snapshots,
      'delivery_state', 'silent_until_completion',
      'idempotent_replay', true
    );
  end if;

  perform 1
  from public.ph_active_request request
  where btrim(coalesce(request.request_folder, '')) = folder_value
  order by request.unique_id
  for update;

  select * into source_request
  from public.ph_active_request request
  where request.unique_id = source_id_value
    and btrim(coalesce(request.request_folder, '')) = folder_value
    and coalesce(request.req_archived, false) = false
    and lower(btrim(coalesce(request.req_status, 'pending'))) not in ('archived', 'cancelled', 'canceled')
  for update;

  if source_request.unique_id is null then
    raise exception using errcode = 'P0002', message = 'REQUEST_OPTION_SOURCE_NOT_FOUND';
  end if;

  select count(*), count(*) filter (
    where lower(btrim(coalesce(request.req_status, ''))) in ('complete', 'completed', 'done')
       or nullif(btrim(coalesce(request.date_completed, '')), '') is not null
  )
    into active_count, completed_count
  from public.ph_active_request request
  where btrim(coalesce(request.request_folder, '')) = folder_value
    and coalesce(request.req_archived, false) = false
    and lower(btrim(coalesce(request.req_status, 'pending'))) not in ('archived', 'cancelled', 'canceled');

  if active_count < 1 then
    raise exception using errcode = 'P0002', message = 'REQUEST_FOLDER_NOT_FOUND';
  end if;
  if completed_count = active_count then
    raise exception using errcode = '55000', message = 'REQUEST_FOLDER_ALREADY_COMPLETED';
  end if;

  select count(distinct context.rep_key) filter (where context.rep_key is not null),
         count(distinct context.customer_key) filter (where context.customer_key is not null)
    into rep_context_count, customer_context_count
  from (
    select
      nullif(regexp_replace(lower(coalesce(
        nullif(btrim(request.requested_by), ''),
        nullif(btrim(request.request_selected_rep_display), ''),
        nullif(btrim(request.request_selected_rep_username), '')
      )), '[^a-z0-9]+', '', 'g'), '') as rep_key,
      nullif(regexp_replace(lower(coalesce(nullif(btrim(request.req_customer), ''), '')), '[^a-z0-9]+', '', 'g'), '') as customer_key
    from public.ph_active_request request
    where btrim(coalesce(request.request_folder, '')) = folder_value
      and coalesce(request.req_archived, false) = false
      and lower(btrim(coalesce(request.req_status, 'pending'))) not in ('archived', 'cancelled', 'canceled')
  ) context;

  if rep_context_count > 1 or customer_context_count > 1 then
    raise exception using errcode = '40001', message = 'REQUEST_FOLDER_CONTEXT_CONFLICT';
  end if;

  select * into thread_row
  from public.ph_request_email_threads thread
  where btrim(coalesce(thread.request_folder, '')) = folder_value
  limit 1;

  select * into source_master
  from public.ph_master_inventory master
  where master.unique_id = source_request.master_id
  limit 1;

  select
    coalesce(
      nullif(btrim(source_request.requested_by), ''),
      nullif(btrim(source_request.request_selected_rep_display), ''),
      nullif(btrim(source_request.request_selected_rep_username), ''),
      (
        select coalesce(
          nullif(btrim(request.requested_by), ''),
          nullif(btrim(request.request_selected_rep_display), ''),
          nullif(btrim(request.request_selected_rep_username), '')
        )
        from public.ph_active_request request
        where btrim(coalesce(request.request_folder, '')) = folder_value
        order by request.created_at, request.unique_id
        limit 1
      ),
      nullif(btrim(thread_row.sales_rep_name), '')
    ),
    coalesce(
      nullif(btrim(source_request.req_customer), ''),
      (
        select nullif(btrim(request.req_customer), '')
        from public.ph_active_request request
        where btrim(coalesce(request.request_folder, '')) = folder_value
          and nullif(btrim(coalesce(request.req_customer, '')), '') is not null
        order by request.created_at, request.unique_id
        limit 1
      ),
      nullif(btrim(thread_row.request_customer), '')
    ),
    coalesce(
      nullif(btrim(source_request.request_selected_rep_username), ''),
      (
        select nullif(btrim(request.request_selected_rep_username), '')
        from public.ph_active_request request
        where btrim(coalesce(request.request_folder, '')) = folder_value
          and nullif(btrim(coalesce(request.request_selected_rep_username, '')), '') is not null
        order by request.created_at, request.unique_id
        limit 1
      )
    ),
    coalesce(
      nullif(btrim(source_request.request_selected_rep_display), ''),
      nullif(btrim(source_request.requested_by), ''),
      nullif(btrim(thread_row.sales_rep_name), '')
    ),
    coalesce(
      nullif(btrim(source_request.request_selected_rep_email), ''),
      (
        select nullif(btrim(request.request_selected_rep_email), '')
        from public.ph_active_request request
        where btrim(coalesce(request.request_folder, '')) = folder_value
          and nullif(btrim(coalesce(request.request_selected_rep_email, '')), '') is not null
        order by request.created_at, request.unique_id
        limit 1
      ),
      nullif(btrim(thread_row.sales_rep_email), '')
    )
  into rep_name, customer_name, selected_rep_username, selected_rep_display, selected_rep_email;

  if nullif(btrim(coalesce(rep_name, '')), '') is null then
    raise exception using errcode = '40001', message = 'REQUEST_FOLDER_REP_MISSING';
  end if;
  if nullif(btrim(coalesce(customer_name, '')), '') is null then
    raise exception using errcode = '40001', message = 'REQUEST_FOLDER_CUSTOMER_MISSING';
  end if;

  if nullif(btrim(coalesce(thread_row.sales_rep_name, '')), '') is not null
     and regexp_replace(lower(rep_name), '[^a-z0-9]+', '', 'g')
       <> regexp_replace(lower(thread_row.sales_rep_name), '[^a-z0-9]+', '', 'g') then
    raise exception using errcode = '40001', message = 'REQUEST_FOLDER_CONTEXT_CONFLICT';
  end if;
  if nullif(btrim(coalesce(thread_row.request_customer, '')), '') is not null
     and regexp_replace(lower(customer_name), '[^a-z0-9]+', '', 'g')
       <> regexp_replace(lower(thread_row.request_customer), '[^a-z0-9]+', '', 'g') then
    raise exception using errcode = '40001', message = 'REQUEST_FOLDER_CONTEXT_CONFLICT';
  end if;

  select email into actor_email from auth.users where id = actor.id;

  source_itemcode_key := upper(btrim(coalesce(source_master.itemcode, source_request.itemcode, '')));
  source_commonname_key := btrim(regexp_replace(lower(btrim(coalesce(source_master.commonname, source_request.commonname, ''))), '[^a-z0-9]+', ' ', 'g'));
  source_contsize_key := lower(btrim(coalesce(source_master.contsize, source_request.contsize, '')));

  foreach candidate_id in array selected_ids
  loop
    select * into candidate
    from public.ph_master_inventory master
    where master.unique_id = candidate_id
    for update;

    if candidate.unique_id is null then
      raise exception using errcode = 'P0002', message = 'REQUEST_OPTION_INVENTORY_ROW_NOT_FOUND';
    end if;

    candidate_itemcode_key := upper(btrim(coalesce(candidate.itemcode, '')));
    candidate_commonname_key := btrim(regexp_replace(lower(btrim(coalesce(candidate.commonname, ''))), '[^a-z0-9]+', ' ', 'g'));
    candidate_contsize_key := lower(btrim(coalesce(candidate.contsize, '')));

    if not (
      source_itemcode_key <> '' and candidate_itemcode_key = source_itemcode_key
      or (
        source_commonname_key <> ''
        and candidate_commonname_key = source_commonname_key
        and (source_contsize_key = '' or candidate_contsize_key = source_contsize_key)
      )
    ) then
      raise exception using errcode = '22023', message = 'REQUEST_OPTION_NOT_COMPATIBLE';
    end if;

    if exists (
      select 1
      from public.ph_active_request request
      where btrim(coalesce(request.request_folder, '')) = folder_value
        and (
          request.master_id = candidate.unique_id
          or (
            upper(btrim(coalesce(request.itemcode, ''))) = candidate_itemcode_key
            and upper(btrim(coalesce(request.locationcode, ''))) = upper(btrim(coalesce(candidate.locationcode, '')))
            and upper(btrim(coalesce(request.lotcode, ''))) = upper(btrim(coalesce(candidate.lotcode, '')))
          )
        )
    ) then
      skipped_duplicate_count := skipped_duplicate_count + 1;
      continue;
    end if;

    request_id := 'REQ-' || replace(extensions.gen_random_uuid()::text, '-', '');
    insert into public.ph_active_request (
      unique_id, master_id, commonname, contsize, locationcode, lotcode,
      itemcode, ptravailable, season_supply, priority, qualitycode,
      field_tag_color, plantgroupcode, requested_by, request_folder,
      req_customer, req_qty, desired_spec, desired_caliper, est_ship,
      req_reserve, req_photo_link, req_photo_name, req_archived, req_status,
      req_rep_action, created_at, req_match, req_spec, req_caliper,
      req_pic_note, req_sales_note, req_comments, av_note, date_completed,
      completed_by_username, completed_by_display, completed_by_email,
      req_photo_mode, request_note, request_created_by_username,
      request_created_by_display, request_created_by_email,
      request_selected_rep_username, request_selected_rep_display,
      request_selected_rep_email, app_tab_assignment,
      master_app_tab_assignment, request_source, client_batch_id, row_version
    ) values (
      request_id, candidate.unique_id, candidate.commonname, candidate.contsize,
      candidate.locationcode, candidate.lotcode, candidate.itemcode,
      candidate.ptravailable, candidate.season_supply, candidate.priority,
      candidate.qualitycode, candidate.field_tag_color, candidate.plantgroupcode,
      rep_name, folder_value, customer_name, source_request.req_qty,
      source_request.desired_spec, source_request.desired_caliper,
      source_request.est_ship, coalesce(nullif(source_request.req_reserve, ''), 'NO'),
      '', '', false, 'Pending', null, now(), null, null, null, null, null,
      null, null, null, null, null, null, null, source_request.request_note,
      actor.username, coalesce(nullif(actor.display_name, ''), actor.username),
      actor_email, selected_rep_username, coalesce(selected_rep_display, rep_name),
      selected_rep_email, candidate.app_tab_assignment,
      candidate.app_tab_assignment, 'general', p_client_batch_id, 1
    );

    perform private.upsert_request_history(request_id, 'created', 'delivered', false);
    inserted_ids := array_append(inserted_ids, request_id);
    inserted_count := inserted_count + 1;
  end loop;

  if inserted_count = 0 then
    return jsonb_build_object(
      'status', 'already_in_request',
      'request_folder', folder_value,
      'inserted_count', 0,
      'skipped_duplicate_count', skipped_duplicate_count,
      'rows', '[]'::jsonb,
      'delivery_state', 'silent_until_completion',
      'idempotent_replay', false
    );
  end if;

  select coalesce(jsonb_agg(private.canonical_request_json(request_id_value) order by request_id_value), '[]'::jsonb)
    into snapshots
  from unnest(inserted_ids) request_id_value;

  insert into public.ph_request_delivery_outbox (
    event_key, event_type, request_folder, payload, status,
    delivered_at, delivery_mode, channel_results
  ) values (
    'request-options-appended:' || p_client_batch_id::text,
    'request_options_appended',
    folder_value,
    jsonb_build_object(
      'contractVersion', 'request-options-appended-v1',
      'clientBatchId', p_client_batch_id,
      'sourceRequestId', source_id_value,
      'request_ids', to_jsonb(inserted_ids),
      'insertedCount', inserted_count,
      'skippedDuplicateCount', skipped_duplicate_count,
      'threadContextPreserved', thread_row.request_folder is not null,
      'deliveryPolicy', 'silent_until_completion'
    ),
    'delivered', now(), 'internal_silent_append',
    jsonb_build_object('internal', jsonb_build_object('recorded_at', now()))
  );

  perform private.reconcile_request_folder_completion_v2(folder_value);

  return jsonb_build_object(
    'status', 'options_added',
    'request_folder', folder_value,
    'inserted_count', inserted_count,
    'skipped_duplicate_count', skipped_duplicate_count,
    'rows', snapshots,
    'delivery_state', 'silent_until_completion',
    'idempotent_replay', false
  );
end
$function$;

revoke all on function public.append_request_options_v1(uuid, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.append_request_options_v1(uuid, text, text, text[])
  to authenticated;

-- Completion membership now accepts ordinary delivered creation events and
-- terminal internal append events. Only ordinary creation/completion events
-- are ever delivered through email or push channels.
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
  where o.request_folder = folder_value
    and o.event_type in ('request_created', 'request_options_appended')
    and coalesce(o.payload->'request_ids', '[]'::jsonb) ?| request_ids;

  select coalesce(bool_and(exists (
    select 1 from public.ph_request_delivery_outbox membership
    where membership.request_folder = folder_value
      and membership.event_type in ('request_created', 'request_options_appended')
      and coalesce(membership.payload->'request_ids', '[]'::jsonb) ? active_request.request_id
  )), false) into creation_dependency_coverage
  from unnest(request_ids) as active_request(request_id);

  if not creation_dependency_coverage then
    return jsonb_build_object('queued', false, 'membershipVersion', state_row.membership_version,
      'activeCount', cardinality(request_ids), 'reason', 'waiting_for_request_membership_event');
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

create or replace function private.reconcile_request_folder_after_created_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.event_type in ('request_created', 'request_options_appended') then
    perform private.reconcile_request_folder_completion_v2(new.request_folder);
  end if;
  return new;
end
$function$;

drop trigger if exists reconcile_request_folder_after_created_v2 on public.ph_request_delivery_outbox;
create trigger reconcile_request_folder_after_created_v2
after insert or update on public.ph_request_delivery_outbox
for each row when (new.event_type in ('request_created', 'request_options_appended'))
execute function private.reconcile_request_folder_after_created_v2();

revoke all on function private.reconcile_request_folder_completion_v2(text)
  from public, anon, authenticated;
revoke all on function private.reconcile_request_folder_after_created_v2()
  from public, anon, authenticated;

comment on function public.append_request_options_v1(uuid, text, text, text[]) is
  'Appends compatible current inventory rows to an open Request folder using server-authoritative folder context. The append is silent until folder completion.';

commit;
