begin;

-- Eval Work V2 keeps the V1 parent row readable by cached clients while the
-- authoritative set of physical origins is service-owned and row-scoped.
alter table public.ph_eval_work
  drop constraint if exists ph_eval_work_contract_version_check;
alter table public.ph_eval_work
  add constraint ph_eval_work_contract_version_check
  check (contract_version in ('eval-work-v1', 'eval-work-v2-multi-origin'));
alter table public.ph_eval_work
  add column if not exists origin_count integer not null default 1 check (origin_count > 0),
  add column if not exists assigned_to_users text[] not null default '{}'::text[];

create table if not exists public.ph_eval_work_origin_rows (
  eval_work_id uuid not null references public.ph_eval_work(id) on delete cascade,
  origin_unique_id text not null,
  itemcode text not null,
  locationcode text not null default '',
  lotcode text not null default '',
  source text not null default '',
  block_alpha text not null default '',
  block_number text not null default '',
  ordinal integer not null check (ordinal > 0),
  origin_snapshot jsonb not null,
  evidence_draft jsonb not null default '{}'::jsonb,
  submitted_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (eval_work_id, origin_unique_id),
  unique (eval_work_id, ordinal)
);

comment on table public.ph_eval_work_origin_rows is
  'Service-owned authoritative physical origins and per-origin evidence for eval-work-v2-multi-origin.';

create index if not exists ph_eval_work_origin_block_idx
  on public.ph_eval_work_origin_rows (block_alpha, block_number, eval_work_id);
create index if not exists ph_eval_work_origin_uid_idx
  on public.ph_eval_work_origin_rows (origin_unique_id, eval_work_id);

alter table public.ph_eval_work_origin_rows enable row level security;
revoke all on table public.ph_eval_work_origin_rows from public, anon, authenticated;
grant all on table public.ph_eval_work_origin_rows to service_role;

create or replace function private.eval_normalize_user_v2(p_value text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select trim(both '_' from lower(regexp_replace(trim(coalesce(p_value, '')), '[^a-zA-Z0-9]+', '_', 'g')))
$function$;

create or replace function private.eval_work_required_manager_emails_v2()
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(distinct lower(trim(u.email)) order by lower(trim(u.email))), '{}'::text[])
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) in ('dylan_collyge', 'megan_kelly')
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and trim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
$function$;

create or replace function private.eval_work_block_alpha_v2(p_location text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select coalesce(nullif(upper(substring(trim(coalesce(p_location, '')) from '^([A-Za-z]+)')), ''), 'No Block Alpha')
$function$;

create or replace function private.eval_work_block_number_v2(p_location text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select coalesce(nullif(substring(trim(coalesce(p_location, '')) from '^[A-Za-z]+[.]?([0-9]+)'), ''), 'No Block Number')
$function$;

create or replace function private.eval_work_context_rows_for_origins_v2(p_origin_ids text[])
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
  ) order by private.eval_work_block_alpha_v2(m.locationcode),
             private.eval_work_block_number_v2(m.locationcode),
             m.locationcode nulls last, m.lotcode nulls last, m.unique_id), '[]'::jsonb)
  from public.ph_master_inventory m
  where m.unique_id = any(coalesce(p_origin_ids, '{}'::text[]))
$function$;

create or replace function private.eval_work_assert_assignment_scope_v2(
  p_itemcode text,
  p_selected_users text[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  assigned_value text;
  normalized_users text[];
begin
  select coalesce(array_agg(distinct private.eval_normalize_user_v2(value)), '{}'::text[])
    into normalized_users
  from unnest(coalesce(p_selected_users, '{}'::text[])) value
  where trim(coalesce(value, '')) <> '';
  if cardinality(normalized_users) = 0 then
    raise exception using errcode = '22023', message = 'eval_work_selected_users_required';
  end if;
  select private.eval_normalize_user_v2(a.assignedto) into assigned_value
  from public.ph_warehouse_assigned_items a
  where upper(trim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(trim(coalesce(p_itemcode, '')))
    and coalesce(a.present_in_drive, true)
  order by a.updated_at desc nulls last
  limit 1;
  if coalesce(assigned_value, '') = '' then assigned_value := 'unassigned'; end if;
  if assigned_value <> all(normalized_users)
     and not (assigned_value = 'unassigned' and normalized_users && array['unassigned','all_users'])
     and not (normalized_users && array['all','all_users']) then
    raise exception using errcode = '40001', message = 'eval_work_assignment_scope_conflict';
  end if;
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
  origin_input jsonb;
  origin public.ph_master_inventory;
  first_origin public.ph_master_inventory;
  work public.ph_eval_work;
  delivery public.ph_request_delivery_outbox;
  items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  origins jsonb;
  inquiry jsonb;
  context_rows jsonb;
  settings jsonb;
  origin_ids text[];
  selected_users text[];
  extra_recipients text[];
  required_recipients text[];
  completion_recipients text[];
  assignment_recipients text[];
  create_token_value text;
  batch_token_value text := trim(coalesce(p_payload->>'batchToken', ''));
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

  -- Validate the complete batch before creating anything.
  for item in select value from jsonb_array_elements(items) loop
    origins := coalesce(item->'origins', '[]'::jsonb);
    inquiry := coalesce(item->'inquiry', '{}'::jsonb);
    create_token_value := trim(coalesce(item->>'createToken', ''));
    if length(create_token_value) < 16 or length(create_token_value) > 240
       or jsonb_typeof(origins) <> 'array' or jsonb_array_length(origins) < 1 or jsonb_array_length(origins) > 100 then
      raise exception using errcode = '22023', message = 'eval_work_multi_origin_item_invalid';
    end if;
    select coalesce(array_agg(distinct private.eval_normalize_user_v2(value)), '{}'::text[])
      into selected_users
    from jsonb_array_elements_text(coalesce(item#>'{reportContext,assignedToUsers}', '[]'::jsonb));
    perform private.eval_work_assert_assignment_scope_v2(item->>'itemcode', selected_users);
    origin_ids := '{}'::text[];
    for origin_input in select value from jsonb_array_elements(origins) loop
      select * into origin from public.ph_master_inventory
      where unique_id = trim(coalesce(origin_input->>'unique_id', '')) limit 1;
      if origin.unique_id is null
         or upper(trim(coalesce(origin.itemcode, ''))) <> upper(trim(coalesce(item->>'itemcode', '')))
         or trim(coalesce(origin.locationcode, '')) <> trim(coalesce(origin_input->>'locationcode', ''))
         or trim(coalesce(origin.lotcode, '')) <> trim(coalesce(origin_input->>'lotcode', ''))
         or origin.unique_id = any(origin_ids) then
        raise exception using errcode = '40001', message = 'eval_work_multi_origin_identity_conflict';
      end if;
      origin_ids := array_append(origin_ids, origin.unique_id);
    end loop;
    context_rows := private.eval_work_context_rows_for_origins_v2(origin_ids);
    if jsonb_array_length(context_rows) <> cardinality(origin_ids) then
      raise exception using errcode = '40001', message = 'eval_work_multi_origin_snapshot_conflict';
    end if;
    perform private.validate_eval_work_inquiry_v1(inquiry, item->>'itemcode', context_rows);
    if jsonb_array_length(coalesce(inquiry->'rowOverlays', '[]'::jsonb)) <> cardinality(origin_ids)
       or (select count(distinct value->>'unique_id') from jsonb_array_elements(coalesce(inquiry->'rowOverlays', '[]'::jsonb))) <> cardinality(origin_ids) then
      raise exception using errcode = '40001', message = 'eval_work_selected_origin_overlay_set_required';
    end if;
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
    origins := item->'origins';
    select array_agg(value->>'unique_id' order by ordinality) into origin_ids
    from jsonb_array_elements(origins) with ordinality;
    select * into first_origin from public.ph_master_inventory where unique_id = origin_ids[1];
    context_rows := private.eval_work_context_rows_for_origins_v2(origin_ids);
    inquiry := item->'inquiry';
    select coalesce(array_agg(distinct private.eval_normalize_user_v2(value)), '{}'::text[])
      into selected_users
    from jsonb_array_elements_text(coalesce(item#>'{reportContext,assignedToUsers}', '[]'::jsonb));
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
      to_jsonb(first_origin), context_rows, md5(context_rows::text), md5(settings::text), inquiry,
      cardinality(origin_ids), selected_users, batch_token_value,
      jsonb_build_object('report', coalesce(item->'reportContext', '{}'::jsonb),
        'inventorySignature', left(coalesce(p_payload->>'inventorySignature', ''), 512),
        'settingsSignature', left(coalesce(p_payload->>'settingsSignature', ''), 1024))
    ) returning * into work;

    ordinal_value := 0;
    for origin_input in select value from jsonb_array_elements(origins) loop
      ordinal_value := ordinal_value + 1;
      select * into origin from public.ph_master_inventory where unique_id = origin_input->>'unique_id';
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
      jsonb_build_object('originCount', work.origin_count,
        'proposalCount', coalesce(jsonb_array_length(inquiry#>'{transaction,requestActions}'), 0)));

    insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
    values (
      'eval-work:' || work.id::text || ':assignment:v' || work.version::text,
      'eval_work_assignment', work.id::text,
      jsonb_build_object(
        'contractVersion', 'eval-work-v2-multi-origin', 'deliveryKind', 'assignment',
        'evalWorkId', work.id, 'assigneeUsername', work.assignee_username,
        'assigneeDisplay', work.assignee_display, 'assigneeEmail', work.assignee_email,
        'assignmentRecipients', to_jsonb(assignment_recipients),
        'lockedManagerRecipients', jsonb_build_array('dylan_collyge', 'megan_kelly'),
        'creatorUsername', work.creator_username, 'creatorDisplay', work.creator_display,
        'instructions', work.instructions, 'itemcode', work.itemcode,
        'commonname', work.commonname, 'contsize', work.contsize,
        'source', jsonb_build_object('unique_id', work.origin_unique_id, 'itemcode', work.itemcode,
          'locationcode', work.origin_locationcode, 'lotcode', work.origin_lotcode, 'source_table', 'ph_master_inventory'),
        'origins', context_rows, 'assignedToUsers', to_jsonb(work.assigned_to_users), 'inquiry', work.inquiry_draft
      ), 'pending', now()
    ) on conflict (event_key) do update set payload = excluded.payload, updated_at = now()
    returning * into delivery;
    update public.ph_eval_work set assignment_event_id = delivery.event_id where id = work.id returning * into work;
    return next work;
  end loop;
  return;
end
$function$;

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
  actor public.profiles;
  work public.ph_eval_work;
  origin_row public.ph_eval_work_origin_rows;
  current_origin public.ph_master_inventory;
  current_rows jsonb;
  origin_ids text[];
  evidence jsonb;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or work.contract_version <> 'eval-work-v2-multi-origin'
     or lower(work.assignee_username) <> lower(actor.username) then
    raise exception using errcode = '42501', message = 'eval_work_edit_forbidden';
  end if;
  if work.status not in ('open', 'in_progress') then raise exception using errcode = '22023', message = 'eval_work_not_editable'; end if;
  if work.version <> p_expected_version then raise exception using errcode = '40001', message = 'eval_work_version_conflict'; end if;
  if jsonb_typeof(coalesce(p_evidence_by_origin, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'eval_work_evidence_map_invalid';
  end if;
  select array_agg(origin_unique_id order by ordinal) into origin_ids
  from public.ph_eval_work_origin_rows where eval_work_id = work.id;
  current_rows := private.eval_work_context_rows_for_origins_v2(origin_ids);
  if jsonb_array_length(current_rows) <> work.origin_count then
    raise exception using errcode = '40001', message = 'eval_work_origin_identity_conflict';
  end if;
  for origin_row in select * from public.ph_eval_work_origin_rows where eval_work_id = work.id order by ordinal for update loop
    select * into current_origin from public.ph_master_inventory where unique_id = origin_row.origin_unique_id;
    if current_origin.unique_id is null
       or upper(trim(coalesce(current_origin.itemcode, ''))) <> upper(trim(origin_row.itemcode))
       or coalesce(current_origin.locationcode, '') <> origin_row.locationcode
       or coalesce(current_origin.lotcode, '') <> origin_row.lotcode
       or coalesce(to_jsonb(current_origin)->>'ptronhand', '') <> coalesce(origin_row.origin_snapshot->>'ptronhand', '') then
      raise exception using errcode = '40001', message = 'eval_work_origin_identity_conflict';
    end if;
    evidence := coalesce(p_evidence_by_origin->(origin_row.origin_unique_id), origin_row.evidence_draft, '{}'::jsonb);
    update public.ph_eval_work_origin_rows
      set evidence_draft = evidence, updated_at = now()
      where eval_work_id = work.id and origin_unique_id = origin_row.origin_unique_id;
  end loop;
  if exists (select 1 from jsonb_object_keys(p_evidence_by_origin) key where not (key = any(origin_ids))) then
    raise exception using errcode = '22023', message = 'eval_work_evidence_origin_invalid';
  end if;
  perform private.validate_eval_work_inquiry_v1(coalesce(p_inquiry, work.inquiry_draft), work.itemcode, current_rows);
  update public.ph_eval_work set inquiry_draft = coalesce(p_inquiry, inquiry_draft),
    evidence_draft = coalesce(p_evidence_by_origin, evidence_draft), context_rows = current_rows,
    inventory_signature = md5(current_rows::text), status = 'in_progress',
    started_at = coalesce(started_at, now()), version = version + 1, updated_at = now()
  where id = work.id returning * into work;
  insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
  values (work.id, 'draft_saved', lower(actor.username), work.version,
    jsonb_build_object('originCount', work.origin_count));
  return work;
end
$function$;

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
  actor public.profiles;
  work public.ph_eval_work;
  origin_row public.ph_eval_work_origin_rows;
  origin public.ph_master_inventory;
  current_rows jsonb;
  settings jsonb;
  origin_ids text[];
  evidence jsonb;
  photos jsonb;
  photo jsonb;
  photo_path text;
  photo_links text;
  photo_names text;
  spec_value text;
  av_note_value text;
  match_value numeric;
  ptr_value numeric;
  delivery public.ph_request_delivery_outbox;
  result_origins jsonb;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or work.contract_version <> 'eval-work-v2-multi-origin'
     or lower(work.assignee_username) <> lower(actor.username) then
    raise exception using errcode = '42501', message = 'eval_work_submit_forbidden';
  end if;
  if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token, '')) then return work; end if;
  if length(trim(coalesce(p_submission_token, ''))) < 16 or length(trim(coalesce(p_submission_token, ''))) > 240 then
    raise exception using errcode = '22023', message = 'eval_work_submission_token_invalid';
  end if;
  if work.status not in ('open', 'in_progress') or work.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'eval_work_version_conflict';
  end if;
  if jsonb_typeof(coalesce(p_evidence_by_origin, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'eval_work_evidence_map_invalid';
  end if;
  settings := private.eval_work_settings_v1();
  if md5(settings::text) <> work.settings_signature then
    raise exception using errcode = '40001', message = 'eval_work_settings_conflict';
  end if;
  select array_agg(origin_unique_id order by ordinal) into origin_ids
  from public.ph_eval_work_origin_rows where eval_work_id = work.id;
  if cardinality(origin_ids) <> work.origin_count
     or (select count(*) from jsonb_object_keys(p_evidence_by_origin)) <> work.origin_count then
    raise exception using errcode = '22023', message = 'eval_work_all_origin_evidence_required';
  end if;
  current_rows := private.eval_work_context_rows_for_origins_v2(origin_ids);
  perform private.validate_eval_work_inquiry_v1(coalesce(p_inquiry, work.inquiry_draft), work.itemcode, current_rows);

  for origin_row in select * from public.ph_eval_work_origin_rows where eval_work_id = work.id order by ordinal for update loop
    select * into origin from public.ph_master_inventory where unique_id = origin_row.origin_unique_id for update;
    if origin.unique_id is null
       or upper(trim(coalesce(origin.itemcode, ''))) <> upper(trim(origin_row.itemcode))
       or coalesce(origin.locationcode, '') <> origin_row.locationcode
       or coalesce(origin.lotcode, '') <> origin_row.lotcode
       or coalesce(to_jsonb(origin)->>'ptronhand', '') <> coalesce(origin_row.origin_snapshot->>'ptronhand', '') then
      raise exception using errcode = '40001', message = 'eval_work_origin_identity_conflict';
    end if;
    evidence := p_evidence_by_origin->(origin_row.origin_unique_id);
    photos := coalesce(evidence->'photos', '[]'::jsonb);
    spec_value := trim(coalesce(evidence->>'spec', ''));
    av_note_value := trim(coalesce(evidence->>'avNote', evidence->>'av_note', ''));
    if jsonb_typeof(photos) <> 'array' or jsonb_array_length(photos) = 0 then raise exception using errcode = '22023', message = 'eval_work_photo_required'; end if;
    if spec_value = '' then raise exception using errcode = '22023', message = 'eval_work_spec_required'; end if;
    if av_note_value = '' then raise exception using errcode = '22023', message = 'eval_work_av_note_required'; end if;
    begin match_value := trim(coalesce(evidence->>'locMatchPercent', evidence->>'loc_match_percent', ''))::numeric;
    exception when others then raise exception using errcode = '22023', message = 'eval_work_loc_match_invalid'; end;
    if match_value < 0 or match_value > 100 then raise exception using errcode = '22023', message = 'eval_work_loc_match_invalid'; end if;
    for photo in select value from jsonb_array_elements(photos) loop
      photo_path := trim(coalesce(photo->>'filePath', photo->>'file_path', photo->>'path', ''));
      if left(photo_path, length('eval/' || work.id::text || '/' || origin_row.origin_unique_id || '/'))
           <> 'eval/' || work.id::text || '/' || origin_row.origin_unique_id || '/'
         or position('..' in photo_path) > 0 then
        raise exception using errcode = '22023', message = 'eval_work_photo_scope_invalid';
      end if;
    end loop;
    select string_agg(trim(value->>'url'), E'\n' order by ordinality),
           string_agg(trim(coalesce(value->>'name', 'eval-photo')), E'\n' order by ordinality)
      into photo_links, photo_names
    from jsonb_array_elements(photos) with ordinality
    where trim(coalesce(value->>'url', '')) <> '';
    if coalesce(photo_links, '') = '' then raise exception using errcode = '22023', message = 'eval_work_committed_photo_required'; end if;
    begin ptr_value := nullif(regexp_replace(coalesce(origin.ptravailable, ''), '[^0-9.-]', '', 'g'), '')::numeric; exception when others then ptr_value := null; end;
    update public.ph_master_inventory set
      spec = spec_value, match = trim(to_char(match_value, 'FM999990.##')),
      initial_ptr = case when trim(coalesce(initial_ptr, '')) <> '' or ptr_value is null then initial_ptr else trim(to_char(ptr_value, 'FM999999990.##')) end,
      loc_match_qty = case when ptr_value is null then loc_match_qty else round(ptr_value * match_value / 100)::text end,
      av_note = av_note_value,
      caliper = case when trim(coalesce(evidence->>'caliper', '')) = '' then caliper else trim(evidence->>'caliper') end,
      pic_note = case when trim(coalesce(evidence->>'pickNote', evidence->>'pick_note', '')) = '' then pic_note else trim(coalesce(evidence->>'pickNote', evidence->>'pick_note')) end,
      sales_note = case when trim(coalesce(evidence->>'comments', '')) = '' then sales_note else trim(evidence->>'comments') end,
      photo_link = photo_links, photo_name = photo_names, last_updated = now()
    where unique_id = origin.unique_id;
    update public.ph_eval_work_origin_rows set evidence_draft = evidence,
      submitted_evidence = evidence, updated_at = now()
    where eval_work_id = work.id and origin_unique_id = origin_row.origin_unique_id;
  end loop;

  update public.ph_eval_work set inquiry_draft = coalesce(p_inquiry, inquiry_draft),
    evidence_draft = p_evidence_by_origin, submitted_inquiry = coalesce(p_inquiry, inquiry_draft),
    submitted_evidence = p_evidence_by_origin, context_rows = current_rows,
    inventory_signature = md5(current_rows::text), status = 'submitted',
    submission_token = trim(p_submission_token), submitted_at = now(),
    version = version + 1, updated_at = now()
  where id = work.id returning * into work;
  insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
  values (work.id, 'submitted', lower(actor.username), work.version,
    jsonb_build_object('originCount', work.origin_count, 'proposalCount',
      coalesce(jsonb_array_length(work.submitted_inquiry#>'{transaction,requestActions}'), 0)));
  select jsonb_agg((origin_snapshot || jsonb_build_object(
      'unique_id', origin_unique_id, 'itemcode', itemcode, 'locationcode', locationcode,
      'lotcode', lotcode, 'source', source, 'blockAlpha', block_alpha,
      'blockNumber', block_number, 'evidence', submitted_evidence)) order by ordinal)
    into result_origins
  from public.ph_eval_work_origin_rows where eval_work_id = work.id;
  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
  values (
    'eval-work:' || work.id::text || ':completion:v' || work.version::text,
    'eval_work_completion', work.id::text,
    jsonb_build_object(
      'contractVersion', 'eval-work-v2-multi-origin', 'deliveryKind', 'completion',
      'evalWorkId', work.id, 'assigneeUsername', work.assignee_username,
      'assigneeDisplay', work.assignee_display, 'creatorUsername', work.creator_username,
      'creatorDisplay', work.creator_display, 'completionRecipients', to_jsonb(work.completion_recipients),
      'lockedManagerRecipients', jsonb_build_array('dylan_collyge', 'megan_kelly'),
      'instructions', work.instructions, 'itemcode', work.itemcode,
      'commonname', work.commonname, 'contsize', work.contsize,
      'source', jsonb_build_object('unique_id', work.origin_unique_id, 'itemcode', work.itemcode,
        'locationcode', work.origin_locationcode, 'lotcode', work.origin_lotcode, 'source_table', 'ph_master_inventory'),
      'origins', result_origins, 'assignedToUsers', to_jsonb(work.assigned_to_users),
      'inquiry', work.submitted_inquiry, 'evidenceByOrigin', work.submitted_evidence
    ), 'pending', now()
  ) on conflict (event_key) do update set payload = excluded.payload, updated_at = now()
  returning * into delivery;
  update public.ph_eval_work set completion_event_id = delivery.event_id where id = work.id returning * into work;
  return work;
end
$function$;

revoke all on function public.create_eval_work_batch_v2(jsonb) from public, anon, authenticated;
revoke all on function public.save_eval_work_v2(uuid, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.submit_eval_work_v2(uuid, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_eval_work_batch_v2(jsonb) to service_role;
grant execute on function public.save_eval_work_v2(uuid, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.submit_eval_work_v2(uuid, text, integer, jsonb, jsonb, text) to service_role;

-- Folder completion V2 is a private membership reconciler. The public worker
-- may only prepare and acknowledge a leased event through service-only RPCs.
create table if not exists private.ph_request_folder_delivery_state (
  request_folder text primary key,
  membership_version bigint not null default 0,
  membership_signature text not null default '',
  active_request_ids text[] not null default '{}'::text[],
  completion_event_key text,
  last_delivered_version bigint not null default 0,
  last_delivered_signature text,
  updated_at timestamptz not null default now()
);
revoke all on table private.ph_request_folder_delivery_state from public, anon, authenticated;
grant all on table private.ph_request_folder_delivery_state to service_role;

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
    select 1 from public.ph_request_delivery_outbox o
    where o.request_folder = folder_value and o.event_type = 'request_created'
      and coalesce(o.payload->'request_ids', '[]'::jsonb) ? request_id
  )), false) into creation_dependency_coverage
  from unnest(request_ids) request_id;
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

create or replace function public.prepare_request_folder_completion_v2(
  p_event_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event_row public.ph_request_delivery_outbox;
  state_row private.ph_request_folder_delivery_state;
  current_ids text[];
  current_signature text;
  all_complete boolean;
  dependencies_ready boolean;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;
  select * into event_row from public.ph_request_delivery_outbox
  where event_id = p_event_id and lease_token = p_lease_token and status = 'processing' for update;
  if event_row.event_id is null or event_row.payload->>'contractVersion' <> 'request-folder-completion-v2' then
    raise exception using errcode = 'P0002', message = 'FOLDER_COMPLETION_EVENT_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('request-folder-v2:' || event_row.request_folder, 0));
  select coalesce(array_agg(r.unique_id order by r.unique_id), '{}'::text[]),
         coalesce(bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
           or nullif(trim(coalesce(r.date_completed, '')), '') is not null), false)
    into current_ids, all_complete
  from public.ph_active_request r
  where trim(coalesce(r.request_folder, '')) = trim(event_row.request_folder)
    and coalesce(r.req_archived, false) = false
    and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled');
  current_signature := md5(coalesce(array_to_string(current_ids, E'\n'), 'empty'));
  select * into state_row from private.ph_request_folder_delivery_state
  where request_folder = event_row.request_folder;
  if state_row.request_folder is null or current_signature <> event_row.payload->>'membershipSignature'
     or current_ids <> array(select jsonb_array_elements_text(event_row.payload->'activeRequestIds'))
     or not all_complete then
    update public.ph_request_delivery_outbox set status = 'suppressed',
      sanitized_error_code = 'FOLDER_COMPLETION_STALE', lease_token = null,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where event_id = event_row.event_id;
    perform private.reconcile_request_folder_completion_v2(event_row.request_folder);
    return jsonb_build_object('ready', false, 'terminal', true, 'code', 'FOLDER_COMPLETION_STALE');
  end if;
  select not exists (
    select 1 from jsonb_array_elements_text(coalesce(event_row.payload->'dependencyEventKeys', '[]'::jsonb)) dep(event_key)
    left join public.ph_request_delivery_outbox created on created.event_key = dep.event_key
    where created.event_key is null or created.status <> 'delivered'
  ) into dependencies_ready;
  if not dependencies_ready then
    update public.ph_request_delivery_outbox set status = 'pending', next_attempt_at = now() + interval '10 seconds',
      sanitized_error_code = 'WAITING_FOR_REQUEST_CREATED', lease_token = null,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where event_id = event_row.event_id;
    return jsonb_build_object('ready', false, 'terminal', false, 'code', 'WAITING_FOR_REQUEST_CREATED');
  end if;
  return jsonb_build_object('ready', true, 'requestIds', to_jsonb(current_ids),
    'membershipVersion', state_row.membership_version,
    'updatedCompletion', coalesce((event_row.payload->>'updatedCompletion')::boolean, false));
end
$function$;

create or replace function public.acknowledge_request_folder_completion_v2(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event_row public.ph_request_delivery_outbox;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;
  select * into event_row from public.ph_request_delivery_outbox
  where event_id = p_event_id and status = 'delivered'
    and payload->>'contractVersion' = 'request-folder-completion-v2';
  if event_row.event_id is null then return; end if;
  update private.ph_request_folder_delivery_state set
    last_delivered_version = (event_row.payload->>'membershipVersion')::bigint,
    last_delivered_signature = event_row.payload->>'membershipSignature',
    updated_at = now()
  where request_folder = event_row.request_folder;
end
$function$;

create or replace function private.route_legacy_request_completion_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.event_type = 'request_completed'
     and coalesce(new.payload->>'contractVersion', '') <> 'request-folder-completion-v2' then
    perform private.reconcile_request_folder_completion_v2(new.request_folder);
    new.status := 'suppressed';
    new.sanitized_error_code := 'FOLDER_COMPLETION_V2_SUPERSEDED';
  end if;
  return new;
end
$function$;

drop trigger if exists route_legacy_request_completion_v2 on public.ph_request_delivery_outbox;
create trigger route_legacy_request_completion_v2
before insert on public.ph_request_delivery_outbox
for each row execute function private.route_legacy_request_completion_v2();

create or replace function private.reconcile_request_folder_from_request_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    perform private.reconcile_request_folder_completion_v2(old.request_folder);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.request_folder is distinct from new.request_folder then
    perform private.reconcile_request_folder_completion_v2(old.request_folder);
  end if;
  perform private.reconcile_request_folder_completion_v2(new.request_folder);
  return new;
end
$function$;

drop trigger if exists reconcile_request_folder_from_request_v2 on public.ph_active_request;
create trigger reconcile_request_folder_from_request_v2
after insert or update or delete
on public.ph_active_request
for each row execute function private.reconcile_request_folder_from_request_v2();

create or replace function private.reconcile_request_folder_after_created_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.event_type = 'request_created' then
    perform private.reconcile_request_folder_completion_v2(new.request_folder);
  end if;
  return new;
end
$function$;

drop trigger if exists reconcile_request_folder_after_created_v2 on public.ph_request_delivery_outbox;
create trigger reconcile_request_folder_after_created_v2
after insert or update on public.ph_request_delivery_outbox
for each row when (new.event_type = 'request_created')
execute function private.reconcile_request_folder_after_created_v2();

revoke all on function private.eval_normalize_user_v2(text) from public, anon, authenticated;
revoke all on function private.eval_work_required_manager_emails_v2() from public, anon, authenticated;
revoke all on function private.eval_work_context_rows_for_origins_v2(text[]) from public, anon, authenticated;
revoke all on function private.eval_work_assert_assignment_scope_v2(text, text[]) from public, anon, authenticated;
revoke all on function private.reconcile_request_folder_completion_v2(text) from public, anon, authenticated;
revoke all on function public.prepare_request_folder_completion_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function public.acknowledge_request_folder_completion_v2(uuid) from public, anon, authenticated;
grant execute on function public.prepare_request_folder_completion_v2(uuid, uuid) to service_role;
grant execute on function public.acknowledge_request_folder_completion_v2(uuid) to service_role;

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
      where created.event_id is null
         or created.status <> 'delivered'
         or created.delivered_at is null
         or completion.delivered_at is null
         or created.delivered_at > completion.delivered_at
    );

  select count(*) into membership_mismatches
  from public.ph_request_delivery_outbox completion
  join private.ph_request_folder_delivery_state state
    on state.request_folder = completion.request_folder
  where completion.event_type = 'request_completed'
    and completion.status <> 'suppressed'
    and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
    and (
      coalesce((completion.payload->>'membershipVersion')::bigint, 0) <> state.membership_version
      or coalesce(completion.payload->>'membershipSignature', '') <> state.membership_signature
      or coalesce(jsonb_array_length(completion.payload->'activeRequestIds'), 0) <> cardinality(state.active_request_ids)
    );

  select count(*) into eval_origin_mismatches
  from public.ph_eval_work work
  where work.contract_version = 'eval-work-v2-multi-origin'
    and (
      work.origin_count <> (select count(*) from public.ph_eval_work_origin_rows origin where origin.eval_work_id = work.id)
      or exists (
        select 1 from public.ph_request_delivery_outbox delivery
        where delivery.request_id = work.id::text
          and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
          and delivery.payload->>'contractVersion' = 'eval-work-v2-multi-origin'
          and coalesce(jsonb_array_length(delivery.payload->'origins'), 0) <> work.origin_count
      )
    );

  select count(*) into eval_recipient_violations
  from public.ph_request_delivery_outbox delivery
  where delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
    and delivery.payload->>'contractVersion' = 'eval-work-v2-multi-origin'
    and not (
      required_manager_emails <@ coalesce(array(
        select lower(trim(value))
        from jsonb_array_elements_text(case
          when delivery.event_type = 'eval_work_assignment' then coalesce(delivery.payload->'assignmentRecipients', '[]'::jsonb)
          else coalesce(delivery.payload->'completionRecipients', '[]'::jsonb)
        end) value
      ), '{}'::text[])
    );

  return jsonb_build_object(
    'contract_version', 'eval-request-delivery-health-v2',
    'required_manager_recipient_count', cardinality(required_manager_emails),
    'creation_order_violation_count', creation_order_violations,
    'completion_membership_mismatch_count', membership_mismatches,
    'eval_origin_scope_mismatch_count', eval_origin_mismatches,
    'eval_required_recipient_violation_count', eval_recipient_violations
  );
end
$function$;

revoke all on function public.get_eval_request_delivery_health_snapshot_v2()
  from public, anon, authenticated;
grant execute on function public.get_eval_request_delivery_health_snapshot_v2()
  to service_role;

comment on function public.create_eval_work_batch_v2(jsonb) is
  'Service-only atomic Eval Work V2 batch creator. One ITEMCODE assignment may contain multiple authoritative origins.';
comment on function public.prepare_request_folder_completion_v2(uuid, uuid) is
  'Service-only final membership and request-created dependency gate immediately before folder completion delivery.';
comment on function public.get_eval_request_delivery_health_snapshot_v2() is
  'Service-only sanitized contract audit for multi-origin Eval delivery and folder-wide Request completion.';

commit;
