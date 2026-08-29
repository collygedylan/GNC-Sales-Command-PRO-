begin;

-- New Eval Work created through Eval Reports #2 is scoped to the complete,
-- authoritative ITEMCODE membership. Existing V1/V2 work has no scope marker
-- and deliberately retains its previous origin set and draft semantics.

create or replace function private.eval_work_natural_sort_key_v1(p_value text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select coalesce(string_agg(
    case
      when part[1] ~ '^[0-9]+$' then lpad(part[1], 24, '0')
      else lower(part[1])
    end,
    '' order by ordinal
  ), '')
  from regexp_matches(coalesce(p_value, ''), '([0-9]+|[^0-9]+)', 'g') with ordinality as token(part, ordinal)
$function$;

create or replace function private.eval_work_itemcode_context_rows_v1(p_itemcode text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'unique_id', m.unique_id, 'itemcode', m.itemcode, 'commonname', m.commonname,
    'contsize', m.contsize, 'locationcode', m.locationcode, 'lotcode', m.lotcode,
    'source', m.source, 'season', m.season, 'saleyear', m.saleyear,
    'ptronhand', m.ptronhand, 'ptravailable', m.ptravailable,
    'ptrreviewed', coalesce(to_jsonb(m)->>'ptrreviewed', to_jsonb(m)->>'PTRREVIEWED', ''),
    'priority', m.priority, 'holdstopcode', m.holdstopcode,
    'holdstopreason', m.holdstopreason, 'locationnotedate', m.locationnotedate,
    'locationnote', m.locationnote, 'spec', m.spec, 'caliper', m.caliper,
    'match', m.match, 'loc_match_qty', m.loc_match_qty, 'initial_ptr', m.initial_ptr,
    'av_note', m.av_note, 'pic_note', m.pic_note, 'sales_note', m.sales_note,
    'photo_link', m.photo_link, 'photo_name', m.photo_name,
    'blockAlpha', private.eval_work_block_alpha_v2(m.locationcode),
    'blockNumber', private.eval_work_block_number_v2(m.locationcode)
  ) order by private.eval_work_natural_sort_key_v1(m.locationcode),
             private.eval_work_natural_sort_key_v1(m.lotcode),
             private.eval_work_natural_sort_key_v1(m.source),
             m.unique_id), '[]'::jsonb)
  from public.ph_master_inventory m
  where upper(trim(coalesce(m.itemcode, ''))) = upper(trim(coalesce(p_itemcode, '')))
    and trim(coalesce(m.unique_id, '')) <> ''
$function$;

create or replace function private.eval_work_membership_signature_v1(p_context_rows jsonb)
returns text
language sql
immutable
set search_path = ''
as $function$
  select md5(coalesce(jsonb_agg(jsonb_build_object(
    'unique_id', value->>'unique_id',
    'itemcode', value->>'itemcode',
    'locationcode', value->>'locationcode',
    'lotcode', value->>'lotcode',
    'source', value->>'source',
    'ptronhand', value->>'ptronhand'
  ) order by ordinality)::text, '[]'))
  from jsonb_array_elements(coalesce(p_context_rows, '[]'::jsonb)) with ordinality
$function$;

create or replace function private.eval_work_assignment_users_v1(p_itemcode text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  with matched as (
    select distinct coalesce(
      nullif(private.eval_normalize_user_v2(a.assignedto), ''),
      'unassigned'
    ) as username
    from public.ph_warehouse_assigned_items a
    where upper(trim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(trim(coalesce(p_itemcode, '')))
      and coalesce(a.present_in_drive, true)
  )
  select case
    when exists (select 1 from matched)
      then coalesce((select array_agg(username order by username) from matched), '{}'::text[])
    else array['unassigned']::text[]
  end
$function$;

create or replace function private.eval_work_match_assignment_users_v1(
  p_itemcode text,
  p_selected_filters text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  assignment_users text[] := private.eval_work_assignment_users_v1(p_itemcode);
  normalized_filters text[];
  matched text[];
begin
  select coalesce(array_agg(distinct normalized order by normalized), '{}'::text[])
    into normalized_filters
  from (
    select private.eval_normalize_user_v2(value) as normalized
    from unnest(coalesce(p_selected_filters, '{}'::text[])) value
  ) filters
  where normalized <> '';

  if cardinality(normalized_filters) = 0
     or normalized_filters && array['all', 'all_users']::text[] then
    return assignment_users;
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[])
    into matched
  from unnest(assignment_users) value
  where value = any(normalized_filters);

  if cardinality(matched) = 0 then
    raise exception using errcode = '40001', message = 'eval_work_assignment_scope_conflict';
  end if;
  return matched;
end
$function$;

create or replace function private.eval_work_expand_inquiry_rows_v1(
  p_inquiry jsonb,
  p_context_rows jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  inquiry jsonb := coalesce(p_inquiry, '{}'::jsonb);
  supplied jsonb := coalesce(p_inquiry->'rowOverlays', '[]'::jsonb);
  expanded jsonb := '[]'::jsonb;
  current_row jsonb;
  overlay jsonb;
  uid text;
begin
  if jsonb_typeof(inquiry) <> 'object' or jsonb_typeof(supplied) <> 'array' then
    raise exception using errcode = '22023', message = 'eval_work_inquiry_shape_invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(supplied) candidate
    where trim(coalesce(candidate->>'unique_id', '')) = ''
       or not exists (
         select 1 from jsonb_array_elements(coalesce(p_context_rows, '[]'::jsonb)) current_candidate
         where current_candidate->>'unique_id' = candidate->>'unique_id'
       )
  ) or (
    select count(*) from jsonb_array_elements(supplied)
  ) <> (
    select count(distinct candidate->>'unique_id') from jsonb_array_elements(supplied) candidate
  ) then
    raise exception using errcode = '40001', message = 'eval_work_row_identity_conflict';
  end if;

  for current_row in select value from jsonb_array_elements(coalesce(p_context_rows, '[]'::jsonb)) loop
    uid := current_row->>'unique_id';
    select value into overlay
    from jsonb_array_elements(supplied)
    where value->>'unique_id' = uid
    limit 1;
    if overlay is null then
      overlay := jsonb_build_object(
        'unique_id', uid,
        'expected', jsonb_build_object(
          'itemcode', coalesce(current_row->>'itemcode', ''),
          'locationcode', coalesce(current_row->>'locationcode', ''),
          'lotcode', coalesce(current_row->>'lotcode', ''),
          'ptronhand', coalesce(current_row->>'ptronhand', '')
        ),
        'proposals', '[]'::jsonb
      );
    end if;
    expanded := expanded || jsonb_build_array(overlay);
  end loop;
  return jsonb_set(inquiry, '{rowOverlays}', expanded, true);
end
$function$;

create or replace function private.eval_work_assert_itemcode_membership_v1(p_work_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  current_rows jsonb;
  current_ids text[];
  stored_ids text[];
  current_signature text;
  selected_filters text[];
  matched_users text[];
begin
  select * into work from public.ph_eval_work where id = p_work_id;
  if work.id is null then
    raise exception using errcode = '22023', message = 'eval_work_not_found';
  end if;
  if coalesce(work.source_context->>'scopeContract', '') <> 'itemcode-all-rows-v1' then
    select array_agg(origin_unique_id order by ordinal) into stored_ids
    from public.ph_eval_work_origin_rows where eval_work_id = work.id;
    return private.eval_work_context_rows_for_origins_v2(stored_ids);
  end if;

  current_rows := private.eval_work_itemcode_context_rows_v1(work.itemcode);
  if jsonb_array_length(current_rows) < 1 or jsonb_array_length(current_rows) > 100 then
    raise exception using errcode = '40001', message = 'eval_work_itemcode_row_limit_conflict';
  end if;
  select array_agg(value->>'unique_id' order by ordinality) into current_ids
  from jsonb_array_elements(current_rows) with ordinality;
  select array_agg(origin_unique_id order by ordinal) into stored_ids
  from public.ph_eval_work_origin_rows where eval_work_id = work.id;
  current_signature := private.eval_work_membership_signature_v1(current_rows);
  if cardinality(current_ids) <> work.origin_count
     or cardinality(stored_ids) <> work.origin_count
     or current_ids is distinct from stored_ids
     or current_signature <> coalesce(work.source_context->>'membershipSignature', '') then
    raise exception using errcode = '40001', message = 'eval_work_itemcode_membership_conflict';
  end if;

  select coalesce(array_agg(value), '{}'::text[]) into selected_filters
  from jsonb_array_elements_text(coalesce(work.source_context#>'{report,selectedUserFilters}', '[]'::jsonb)) value;
  matched_users := private.eval_work_match_assignment_users_v1(work.itemcode, selected_filters);
  if matched_users is distinct from work.assigned_to_users then
    raise exception using errcode = '40001', message = 'eval_work_assignment_scope_conflict';
  end if;
  return current_rows;
end
$function$;

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

  -- Validate every requested ITEMCODE before creating any assignment.
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
    select coalesce(array_agg(distinct private.eval_normalize_user_v2(value) order by private.eval_normalize_user_v2(value)), '{}'::text[])
      into hinted_users
    from jsonb_array_elements_text(coalesce(item#>'{reportContext,matchedAssignedToUsers}', '[]'::jsonb)) value
    where private.eval_normalize_user_v2(value) <> '';
    if cardinality(hinted_users) > 0 and hinted_users is distinct from matched_users then
      raise exception using errcode = '40001', message = 'eval_work_assignment_scope_conflict';
    end if;
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
        'report', coalesce(item->'reportContext', '{}'::jsonb) || jsonb_build_object(
          'selectedUserFilters', to_jsonb(selected_filters),
          'matchedAssignedToUsers', to_jsonb(matched_users)
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
        'proposalCount', coalesce(jsonb_array_length(inquiry#>'{transaction,requestActions}'), 0)));

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

-- Membership validation is intentionally injected into the existing V2 save
-- and submit functions by wrapping the original service-only entry points.
alter function public.save_eval_work_v2(uuid, text, integer, jsonb, jsonb) rename to save_eval_work_v2_legacy_impl;

create or replace function public.save_eval_work_v2(
  p_work_id uuid,
  p_actor_username text,
  p_expected_version integer,
  p_inquiry jsonb,
  p_evidence_by_origin jsonb
)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  current_rows jsonb;
  settings jsonb;
begin
  select * into work from public.ph_eval_work where id = p_work_id;
  if coalesce(work.source_context->>'scopeContract', '') = 'itemcode-all-rows-v1' then
    current_rows := private.eval_work_assert_itemcode_membership_v1(p_work_id);
    settings := private.eval_work_settings_v1();
    if md5(settings::text) <> work.settings_signature then
      raise exception using errcode = '40001', message = 'eval_work_settings_conflict';
    end if;
    if jsonb_array_length(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb)) <> work.origin_count
       or (select count(distinct value->>'unique_id') from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb))) <> work.origin_count then
      raise exception using errcode = '40001', message = 'eval_work_itemcode_overlay_membership_conflict';
    end if;
  end if;
  return public.save_eval_work_v2_legacy_impl(
    p_work_id, p_actor_username, p_expected_version, p_inquiry, p_evidence_by_origin
  );
end
$function$;

alter function public.submit_eval_work_v2(uuid, text, integer, jsonb, jsonb, text) rename to submit_eval_work_v2_legacy_impl;

create or replace function public.submit_eval_work_v2(
  p_work_id uuid,
  p_actor_username text,
  p_expected_version integer,
  p_inquiry jsonb,
  p_evidence_by_origin jsonb,
  p_submission_token text
)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  current_rows jsonb;
  submitted public.ph_eval_work;
  delivery public.ph_request_delivery_outbox;
begin
  select * into work from public.ph_eval_work where id = p_work_id;
  if coalesce(work.source_context->>'scopeContract', '') = 'itemcode-all-rows-v1' then
    current_rows := private.eval_work_assert_itemcode_membership_v1(p_work_id);
    if jsonb_array_length(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb)) <> work.origin_count
       or (select count(distinct value->>'unique_id') from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb))) <> work.origin_count then
      raise exception using errcode = '40001', message = 'eval_work_itemcode_overlay_membership_conflict';
    end if;
  end if;
  submitted := public.submit_eval_work_v2_legacy_impl(
    p_work_id, p_actor_username, p_expected_version, p_inquiry, p_evidence_by_origin, p_submission_token
  );
  if coalesce(submitted.source_context->>'scopeContract', '') = 'itemcode-all-rows-v1' then
    select * into delivery from public.ph_request_delivery_outbox where event_id = submitted.completion_event_id for update;
    update public.ph_request_delivery_outbox
      set payload = payload || jsonb_build_object(
        'scopeContract', 'itemcode-all-rows-v1',
        'membershipSignature', submitted.source_context->>'membershipSignature',
        'membershipCount', submitted.origin_count,
        'selectedUserFilters', coalesce(submitted.source_context#>'{report,selectedUserFilters}', '[]'::jsonb),
        'matchedAssignedToUsers', to_jsonb(submitted.assigned_to_users)
      ), updated_at = now()
      where event_id = submitted.completion_event_id;
  end if;
  return submitted;
end
$function$;

create or replace function public.validate_eval_work_delivery_v1(
  p_work_id uuid,
  p_event_type text,
  p_membership_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  current_rows jsonb;
  settings jsonb;
  safe_event_type text := lower(trim(coalesce(p_event_type, '')));
begin
  select * into work from public.ph_eval_work where id = p_work_id;
  if work.id is null or coalesce(work.source_context->>'scopeContract', '') <> 'itemcode-all-rows-v1' then
    raise exception using errcode = '40001', message = 'eval_work_delivery_scope_conflict';
  end if;
  if trim(coalesce(p_membership_signature, '')) <> coalesce(work.source_context->>'membershipSignature', '') then
    raise exception using errcode = '40001', message = 'eval_work_delivery_membership_conflict';
  end if;
  if safe_event_type = 'eval_work_completion' and work.status <> 'submitted' then
    raise exception using errcode = '40001', message = 'eval_work_delivery_status_conflict';
  elsif safe_event_type = 'eval_work_assignment' and work.status = 'cancelled' then
    raise exception using errcode = '40001', message = 'eval_work_delivery_status_conflict';
  elsif safe_event_type not in ('eval_work_assignment', 'eval_work_completion') then
    raise exception using errcode = '22023', message = 'eval_work_delivery_type_invalid';
  end if;
  current_rows := private.eval_work_assert_itemcode_membership_v1(work.id);
  settings := private.eval_work_settings_v1();
  if md5(settings::text) <> work.settings_signature then
    raise exception using errcode = '40001', message = 'eval_work_settings_conflict';
  end if;
  return jsonb_build_object(
    'ok', true,
    'scopeContract', 'itemcode-all-rows-v1',
    'originCount', jsonb_array_length(current_rows),
    'membershipSignature', private.eval_work_membership_signature_v1(current_rows)
  );
end
$function$;

create or replace function public.get_eval_itemcode_work_health_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  scoped_assignments bigint := 0;
  stored_membership_mismatches bigint := 0;
  pdf_origin_mismatches bigint := 0;
  excel_attachment_violations bigint := 0;
  over_limit_assignments bigint := 0;
  largest_origin_count integer := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'EVAL_ITEMCODE_HEALTH_FORBIDDEN';
  end if;

  select count(*), coalesce(max(work.origin_count), 0),
    count(*) filter (where work.origin_count > 100)
  into scoped_assignments, largest_origin_count, over_limit_assignments
  from public.ph_eval_work work
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1';

  select count(*) into stored_membership_mismatches
  from public.ph_eval_work work
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
    and (
      coalesce((work.source_context->>'membershipCount')::integer, -1) <> work.origin_count
      or coalesce(work.source_context->>'membershipSignature', '') = ''
      or work.origin_count <> (
        select count(*) from public.ph_eval_work_origin_rows origin where origin.eval_work_id = work.id
      )
    );

  select count(*) into pdf_origin_mismatches
  from public.ph_request_delivery_outbox delivery
  join public.ph_eval_work work on work.id::text = delivery.request_id
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
    and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
    and delivery.status <> 'suppressed'
    and (
      coalesce(delivery.payload->>'scopeContract', '') <> 'itemcode-all-rows-v1'
      or coalesce(
        (delivery.payload->>'originCount')::integer,
        (delivery.payload->>'membershipCount')::integer,
        -1
      ) <> work.origin_count
      or coalesce(jsonb_array_length(delivery.payload->'origins'), 0) <> work.origin_count
    );

  select count(*) into excel_attachment_violations
  from public.ph_request_delivery_outbox delivery
  join public.ph_eval_work work on work.id::text = delivery.request_id
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
    and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
    and delivery.status <> 'suppressed'
    and lower(delivery.payload::text) ~ '(\.xlsx|\.xls\"|spreadsheetml|excelattachment)';

  return jsonb_build_object(
    'contract_version', 'eval-itemcode-work-health-v1',
    'scope_contract', 'itemcode-all-rows-v1',
    'scoped_assignment_count', scoped_assignments,
    'stored_membership_mismatch_count', stored_membership_mismatches,
    'pdf_origin_mismatch_count', pdf_origin_mismatches,
    'excel_attachment_violation_count', excel_attachment_violations,
    'over_limit_assignment_count', over_limit_assignments,
    'largest_origin_count', largest_origin_count
  );
end
$function$;

revoke all on function private.eval_work_natural_sort_key_v1(text) from public, anon, authenticated;
revoke all on function private.eval_work_itemcode_context_rows_v1(text) from public, anon, authenticated;
revoke all on function private.eval_work_membership_signature_v1(jsonb) from public, anon, authenticated;
revoke all on function private.eval_work_assignment_users_v1(text) from public, anon, authenticated;
revoke all on function private.eval_work_match_assignment_users_v1(text, text[]) from public, anon, authenticated;
revoke all on function private.eval_work_expand_inquiry_rows_v1(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.eval_work_assert_itemcode_membership_v1(uuid) from public, anon, authenticated;
revoke all on function public.create_eval_work_batch_v2(jsonb) from public, anon, authenticated;
revoke all on function public.save_eval_work_v2(uuid, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.submit_eval_work_v2(uuid, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.validate_eval_work_delivery_v1(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_eval_itemcode_work_health_snapshot_v1() from public, anon, authenticated;
revoke all on function public.save_eval_work_v2_legacy_impl(uuid, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.submit_eval_work_v2_legacy_impl(uuid, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_eval_work_batch_v2(jsonb) to service_role;
grant execute on function public.save_eval_work_v2(uuid, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.submit_eval_work_v2(uuid, text, integer, jsonb, jsonb, text) to service_role;
grant execute on function public.validate_eval_work_delivery_v1(uuid, text, text) to service_role;
grant execute on function public.get_eval_itemcode_work_health_snapshot_v1() to service_role;
grant execute on function public.save_eval_work_v2_legacy_impl(uuid, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.submit_eval_work_v2_legacy_impl(uuid, text, integer, jsonb, jsonb, text) to service_role;

comment on function public.create_eval_work_batch_v2(jsonb) is
  'Service-only atomic batch creation. New work derives every current ITEMCODE row and stores itemcode-all-rows-v1 membership.';
comment on function private.eval_work_assert_itemcode_membership_v1(uuid) is
  'Rejects membership, identity, OH, or assignment-owner drift for itemcode-all-rows-v1 without changing legacy work.';
comment on function public.validate_eval_work_delivery_v1(uuid, text, text) is
  'Service-only delivery preflight for ITEMCODE-wide membership, assignment ownership, and settings.';
comment on function public.get_eval_itemcode_work_health_snapshot_v1() is
  'Service-only sanitized audit for ITEMCODE-wide origin, PDF, Queue, and PDF-only delivery parity.';

commit;
