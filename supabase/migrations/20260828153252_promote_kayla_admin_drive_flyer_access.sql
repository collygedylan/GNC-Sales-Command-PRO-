begin;

create schema if not exists private;

create table if not exists private.role_access_change_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  legacy_user_id integer not null references public.ph_app_users(id) on delete restrict,
  username text not null,
  previous_role text not null,
  next_role text not null,
  reason_code text not null,
  changed_at timestamptz not null default now(),
  constraint role_access_change_events_username_check
    check (username = lower(btrim(username)) and char_length(username) between 3 and 120),
  constraint role_access_change_events_role_check
    check (char_length(previous_role) between 2 and 80 and char_length(next_role) between 2 and 80),
  constraint role_access_change_events_reason_check
    check (reason_code ~ '^[A-Z][A-Z0-9_]{3,79}$')
);

alter table private.role_access_change_events enable row level security;
revoke all on table private.role_access_change_events from public, anon, authenticated;

do $promote_kayla$
declare
  v_profile public.profiles%rowtype;
  v_legacy public.ph_app_users%rowtype;
  v_previous_role text;
begin
  select * into strict v_profile
  from public.profiles
  where lower(btrim(username)) = 'kayla_knepp'
  for update;

  if v_profile.disabled_at is not null
     or (v_profile.locked_until is not null and v_profile.locked_until > now()) then
    raise exception using errcode = '42501', message = 'KAYLA_PROFILE_NOT_ACTIVE';
  end if;
  if v_profile.legacy_user_id is null then
    raise exception using errcode = '23514', message = 'KAYLA_LEGACY_IDENTITY_MISSING';
  end if;

  select * into strict v_legacy
  from public.ph_app_users
  where id = v_profile.legacy_user_id
    and lower(btrim(username)) = 'kayla_knepp'
  for update;

  if v_legacy.disabled_at is not null
     or (v_legacy.locked_until is not null and v_legacy.locked_until > now()) then
    raise exception using errcode = '42501', message = 'KAYLA_LEGACY_PROFILE_NOT_ACTIVE';
  end if;

  v_previous_role := v_profile.role;

  update public.profiles
  set role = 'ADMIN', updated_at = now()
  where id = v_profile.id;

  update public.ph_app_users
  set role = 'ADMIN'
  where id = v_legacy.id;

  if upper(btrim(coalesce(v_previous_role, ''))) <> 'ADMIN'
     or upper(btrim(coalesce(v_legacy.role, ''))) <> 'ADMIN' then
    insert into private.role_access_change_events
      (profile_id, legacy_user_id, username, previous_role, next_role, reason_code)
    values
      (v_profile.id, v_legacy.id, 'kayla_knepp', coalesce(v_previous_role, 'UNKNOWN'), 'ADMIN', 'PROMOTE_STANDARD_ADMIN');
  end if;
end
$promote_kayla$;

create table if not exists private.drive_evidence_idempotency (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, idempotency_key),
  constraint drive_evidence_idempotency_key_check
    check (char_length(idempotency_key) between 12 and 180),
  constraint drive_evidence_idempotency_response_size_check
    check (octet_length(response_payload::text) <= 131072)
);

create table if not exists private.flyer_folder_batch_idempotency (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, idempotency_key),
  constraint flyer_folder_batch_idempotency_key_check
    check (char_length(idempotency_key) between 12 and 180),
  constraint flyer_folder_batch_idempotency_response_size_check
    check (octet_length(response_payload::text) <= 524288)
);

alter table private.drive_evidence_idempotency enable row level security;
alter table private.flyer_folder_batch_idempotency enable row level security;
revoke all on table private.drive_evidence_idempotency from public, anon, authenticated;
revoke all on table private.flyer_folder_batch_idempotency from public, anon, authenticated;

create or replace function private.require_active_admin_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found
     or v_profile.disabled_at is not null
     or (v_profile.locked_until is not null and v_profile.locked_until > now())
     or upper(btrim(coalesce(v_profile.role, ''))) not in ('ADMIN', 'ADMINISTRATOR') then
    raise exception using errcode = '42501', message = 'ACTIVE_ADMIN_REQUIRED';
  end if;

  return v_profile;
end
$function$;

revoke all on function private.require_active_admin_profile() from public, anon, authenticated;

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
  v_unexpected_keys text[];
  v_workflow text := lower(btrim(coalesce(p_workflow, '')));
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
  where key not in (
    'spec', 'caliper', 'match', 'loc_match_qty', 'initial_ptr',
    'av_note', 'pick_note', 'comments', 'photo_link', 'photo_name'
  );
  if coalesce(cardinality(v_unexpected_keys), 0) > 0 then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_DRIVE_EVIDENCE_FIELD';
  end if;
  if octet_length(v_payload::text) > 65536 then
    raise exception using errcode = '22023', message = 'DRIVE_EVIDENCE_PAYLOAD_TOO_LARGE';
  end if;

  v_request_hash := md5(concat_ws('|',
    btrim(p_master_uid), btrim(coalesce(p_expected_itemcode, '')),
    btrim(coalesce(p_expected_locationcode, '')), btrim(coalesce(p_expected_lotcode, '')),
    btrim(coalesce(p_expected_signature, '')), v_payload::text,
    coalesce(p_complete, false)::text, v_workflow
  ));

  select * into v_existing
  from private.drive_evidence_idempotency
  where profile_id = v_actor.id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '40001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_set(v_existing.response_payload, '{recovered}', 'true'::jsonb, true);
  end if;

  select * into v_row
  from public.ph_master_inventory
  where unique_id = btrim(p_master_uid)
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DRIVE_ROW_NOT_FOUND';
  end if;

  if upper(btrim(coalesce(v_row.itemcode, ''))) <> upper(btrim(coalesce(p_expected_itemcode, '')))
     or upper(btrim(coalesce(v_row.locationcode, ''))) <> upper(btrim(coalesce(p_expected_locationcode, '')))
     or upper(btrim(coalesce(v_row.lotcode, ''))) <> upper(btrim(coalesce(p_expected_lotcode, ''))) then
    raise exception using errcode = '40001', message = 'DRIVE_ROW_IDENTITY_CONFLICT';
  end if;
  if btrim(coalesce(p_expected_signature, '')) <> ''
     and v_row.last_updated is distinct from p_expected_signature::timestamptz then
    raise exception using errcode = '40001', message = 'DRIVE_ROW_STALE';
  end if;

  if v_payload ? 'match'
     and nullif(btrim(v_payload ->> 'match'), '') is not null
     and (v_payload ->> 'match') !~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then
    raise exception using errcode = '22023', message = 'INVALID_LOC_MATCH_PERCENT';
  end if;
  if v_payload ? 'photo_link' and octet_length(coalesce(v_payload ->> 'photo_link', '')) > 16000 then
    raise exception using errcode = '22023', message = 'PHOTO_REFERENCE_TOO_LARGE';
  end if;

  update public.ph_master_inventory
  set
    spec = case when v_payload ? 'spec' then nullif(btrim(v_payload ->> 'spec'), '') else spec end,
    caliper = case when v_payload ? 'caliper' then nullif(btrim(v_payload ->> 'caliper'), '') else caliper end,
    match = case when v_payload ? 'match' then nullif(btrim(v_payload ->> 'match'), '') else match end,
    loc_match_qty = case when v_payload ? 'loc_match_qty' then nullif(btrim(v_payload ->> 'loc_match_qty'), '') else loc_match_qty end,
    initial_ptr = case when v_payload ? 'initial_ptr' then nullif(btrim(v_payload ->> 'initial_ptr'), '') else initial_ptr end,
    av_note = case when v_payload ? 'av_note' then nullif(btrim(v_payload ->> 'av_note'), '') else av_note end,
    pic_note = case when v_payload ? 'pick_note' then nullif(btrim(v_payload ->> 'pick_note'), '') else pic_note end,
    sales_note = case when v_payload ? 'comments' then nullif(v_payload ->> 'comments', '') else sales_note end,
    photo_link = case when v_payload ? 'photo_link' then nullif(btrim(v_payload ->> 'photo_link'), '') else photo_link end,
    photo_name = case when v_payload ? 'photo_name' then nullif(btrim(v_payload ->> 'photo_name'), '') else photo_name end,
    date_completed = case when coalesce(p_complete, false) then now() else date_completed end,
    app_tab_assignment = case when coalesce(p_complete, false) then v_workflow else app_tab_assignment end
  where unique_id = v_row.unique_id
  returning * into v_saved;

  update public.ph_active_request
  set
    req_spec = case when v_payload ? 'spec' then nullif(btrim(v_payload ->> 'spec'), '') else req_spec end,
    req_caliper = case when v_payload ? 'caliper' then nullif(btrim(v_payload ->> 'caliper'), '') else req_caliper end,
    req_match = case when v_payload ? 'match' then nullif(btrim(v_payload ->> 'match'), '')::numeric else req_match end,
    req_pic_note = case when v_payload ? 'pick_note' then nullif(btrim(v_payload ->> 'pick_note'), '') else req_pic_note end,
    req_comments = case when v_payload ? 'comments' then nullif(v_payload ->> 'comments', '') else req_comments end,
    av_note = case when v_payload ? 'av_note' then nullif(btrim(v_payload ->> 'av_note'), '') else av_note end,
    req_photo_link = case when v_payload ? 'photo_link' then nullif(btrim(v_payload ->> 'photo_link'), '') else req_photo_link end,
    req_photo_name = case when v_payload ? 'photo_name' then nullif(btrim(v_payload ->> 'photo_name'), '') else req_photo_name end,
    req_status = case when coalesce(p_complete, false) then 'Complete' else req_status end,
    date_completed = case when coalesce(p_complete, false) then now()::text else date_completed end,
    completed_by_username = case when coalesce(p_complete, false) then lower(btrim(v_actor.username)) else completed_by_username end,
    completed_by_display = case when coalesce(p_complete, false) then coalesce(nullif(btrim(v_actor.display_name), ''), v_actor.username) else completed_by_display end,
    row_version = coalesce(row_version, 0) + 1,
    updated_at = now()
  where master_id = v_row.unique_id
    and upper(btrim(coalesce(itemcode, ''))) = upper(btrim(coalesce(v_row.itemcode, '')))
    and upper(btrim(coalesce(locationcode, ''))) = upper(btrim(coalesce(v_row.locationcode, '')))
    and upper(btrim(coalesce(lotcode, ''))) = upper(btrim(coalesce(v_row.lotcode, '')))
    and lower(btrim(coalesce(req_status, 'pending'))) not in ('complete', 'completed', 'done', 'archived', 'cancelled');

  v_response := jsonb_build_object(
    'ok', true,
    'contractVersion', 'save-drive-evidence-v1',
    'row', to_jsonb(v_saved),
    'completed', coalesce(p_complete, false),
    'recovered', false
  );

  insert into private.drive_evidence_idempotency
    (profile_id, idempotency_key, request_hash, response_payload)
  values
    (v_actor.id, btrim(p_idempotency_key), v_request_hash, v_response);

  return v_response;
end
$function$;

revoke all on function public.save_drive_evidence_v1(text, text, text, text, text, jsonb, boolean, text, text) from public, anon;
grant execute on function public.save_drive_evidence_v1(text, text, text, text, text, jsonb, boolean, text, text) to authenticated;

create or replace function public.create_flyer_folder_batch_v1(
  p_folder_name text,
  p_master_uids text[],
  p_assignee_usernames text[],
  p_add_to_existing boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.profiles%rowtype;
  v_existing private.flyer_folder_batch_idempotency%rowtype;
  v_folder text := regexp_replace(btrim(coalesce(p_folder_name, '')), '\s+', ' ', 'g');
  v_master_uids text[];
  v_assignees text[];
  v_assignee_display text;
  v_primary_assignee text;
  v_request_hash text;
  v_response jsonb;
  v_rows jsonb;
  v_expected_count integer;
  v_found_count integer;
  v_assignee_count integer;
  v_now timestamptz := now();
begin
  v_actor := private.require_active_admin_profile();

  if char_length(v_folder) not between 1 and 160 or v_folder ~ '^\[ARCHIVED\]' then
    raise exception using errcode = '22023', message = 'INVALID_FLYER_FOLDER_NAME';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 12 and 180 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[]) into v_master_uids
  from (select distinct btrim(value) value from unnest(coalesce(p_master_uids, '{}'::text[])) value where btrim(value) <> '') q;
  select coalesce(array_agg(value order by value), '{}'::text[]) into v_assignees
  from (select distinct lower(btrim(value)) value from unnest(coalesce(p_assignee_usernames, '{}'::text[])) value where btrim(value) <> '') q;

  v_expected_count := cardinality(v_master_uids);
  if v_expected_count not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_FLYER_ROW_COUNT';
  end if;
  if cardinality(v_assignees) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'INVALID_FLYER_ASSIGNEE_COUNT';
  end if;

  v_request_hash := md5(concat_ws('|', v_folder, array_to_string(v_master_uids, ','), array_to_string(v_assignees, ','), coalesce(p_add_to_existing, false)::text));
  select * into v_existing
  from private.flyer_folder_batch_idempotency
  where profile_id = v_actor.id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '40001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_set(v_existing.response_payload, '{recovered}', 'true'::jsonb, true);
  end if;

  select count(*) into v_assignee_count
  from public.profiles
  where lower(btrim(username)) = any(v_assignees)
    and disabled_at is null
    and (locked_until is null or locked_until <= now());
  if v_assignee_count <> cardinality(v_assignees) then
    raise exception using errcode = '22023', message = 'INVALID_FLYER_ASSIGNEE';
  end if;

  select string_agg(coalesce(nullif(btrim(display_name), ''), username), ', ' order by array_position(v_assignees, lower(btrim(username)))),
         min(lower(btrim(username))) filter (where lower(btrim(username)) = v_assignees[1])
  into v_assignee_display, v_primary_assignee
  from public.profiles
  where lower(btrim(username)) = any(v_assignees);
  v_primary_assignee := coalesce(v_primary_assignee, v_assignees[1]);

  select count(*) into v_found_count
  from public.ph_master_inventory
  where unique_id = any(v_master_uids);
  if v_found_count <> v_expected_count then
    raise exception using errcode = '40001', message = 'FLYER_SOURCE_ROW_CONFLICT';
  end if;

  if coalesce(p_add_to_existing, false) then
    if not exists (
      select 1 from public.ph_flyer_folder_rows
      where lower(btrim(flyer_title)) = lower(v_folder)
    ) then
      raise exception using errcode = '40001', message = 'FLYER_FOLDER_NOT_OPEN';
    end if;
  elsif exists (
    select 1 from public.ph_flyer_folder_rows
    where lower(btrim(flyer_title)) = lower(v_folder)
  ) then
    raise exception using errcode = '40001', message = 'FLYER_FOLDER_ALREADY_EXISTS';
  end if;
  if exists (
    select 1 from public.ph_flyer_folder_history
    where lower(btrim(coalesce(folder_name, flyer_title))) = lower(v_folder)
      and folder_tab = 'archive'
  ) then
    raise exception using errcode = '40001', message = 'FLYER_FOLDER_ARCHIVED';
  end if;

  with sources as (
    select m.*,
      'FF-' || left(regexp_replace(v_folder, '[^a-zA-Z0-9]+', '-', 'g'), 90) || '-' ||
        left(regexp_replace(m.unique_id, '[^a-zA-Z0-9]+', '-', 'g'), 90) as flyer_unique_id,
      jsonb_build_object(
        'UNIQUE_ID', m.unique_id, 'SOURCE_TABLE', 'ph_master_inventory', 'SOURCE', m.source,
        'ITEMCODE', m.itemcode, 'COMMONNAME', m.commonname, 'CONTSIZE', m.contsize,
        'LOCATIONCODE', m.locationcode, 'LOTCODE', m.lotcode, 'PRIORITY', m.priority,
        'PTRAVAILABLE', m.ptravailable, 'S_LTS', m.s_lts, 'HOLDSTOPCODE', m.holdstopcode,
        'PLANTGROUPCODE', m.plantgroupcode, 'LOCATIONNOTE', m.locationnote,
        'AV_NOTE', m.av_note, 'MATCH', m.match, 'LOC_MATCH_QTY', m.loc_match_qty,
        'SPEC', m.spec, 'CALIPER', m.caliper, 'PICK', m.pic_note,
        'INITIAL_PTR', m.initial_ptr, 'PHOTO_LINK', m.photo_link, 'PHOTO_NAME', m.photo_name,
        'PRODUCTIVITY_ORIGIN_ASSIGNMENT', m.app_tab_assignment
      ) as snapshot_json
    from public.ph_master_inventory m
    where m.unique_id = any(v_master_uids)
  ), inserted as (
    insert into public.ph_flyer_folder_rows (
      unique_id, master_unique_id, source_table, flyer_title, flyer_assigned, assignedto,
      itemcode, commonname, contsize, locationcode, lotcode, priority, ptravailable, s_lts,
      holdstopcode, plantgroupcode, locationnote, av_note, match, loc_match_qty, spec, caliper,
      pick, initial_ptr, flyer_av_note, flyer_match, flyer_loc_match_qty, flyer_spec,
      flyer_caliper, flyer_pick, flyer_initial_ptr, flyer_photo_link, flyer_photo_name,
      snapshot, created_by_username, created_by_display, created_at, updated_at
    )
    select
      s.flyer_unique_id, s.unique_id, 'ph_master_inventory', v_folder, v_assignee_display, v_primary_assignee,
      s.itemcode, s.commonname, s.contsize, s.locationcode, s.lotcode, s.priority, s.ptravailable, s.s_lts,
      s.holdstopcode, s.plantgroupcode, s.locationnote, s.av_note,
      case when regexp_replace(coalesce(s.match, ''), '[^0-9.-]+', '', 'g') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(s.match, '[^0-9.-]+', '', 'g')::numeric end,
      case when regexp_replace(coalesce(s.loc_match_qty, ''), '[^0-9.-]+', '', 'g') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(s.loc_match_qty, '[^0-9.-]+', '', 'g')::numeric end,
      s.spec, s.caliper, s.pic_note,
      case when regexp_replace(coalesce(s.initial_ptr, ''), '[^0-9.-]+', '', 'g') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(s.initial_ptr, '[^0-9.-]+', '', 'g')::numeric end,
      s.av_note,
      case when regexp_replace(coalesce(s.match, ''), '[^0-9.-]+', '', 'g') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(s.match, '[^0-9.-]+', '', 'g')::numeric end,
      case when regexp_replace(coalesce(s.loc_match_qty, ''), '[^0-9.-]+', '', 'g') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(s.loc_match_qty, '[^0-9.-]+', '', 'g')::numeric end,
      s.spec, s.caliper, s.pic_note,
      case when regexp_replace(coalesce(s.initial_ptr, ''), '[^0-9.-]+', '', 'g') ~ '^-?[0-9]+([.][0-9]+)?$' then regexp_replace(s.initial_ptr, '[^0-9.-]+', '', 'g')::numeric end,
      s.photo_link, s.photo_name, s.snapshot_json,
      lower(btrim(v_actor.username)), coalesce(nullif(btrim(v_actor.display_name), ''), v_actor.username), v_now, v_now
    from sources s
    on conflict (unique_id) do update set
      flyer_assigned = excluded.flyer_assigned,
      assignedto = excluded.assignedto,
      updated_at = excluded.updated_at
    returning *
  ), history_rows as (
    insert into public.ph_flyer_folder_history (
      unique_id, master_unique_id, source_table, flyer_title, flyer_assigned, assignedto,
      itemcode, commonname, contsize, locationcode, lotcode, priority, ptravailable, s_lts,
      holdstopcode, plantgroupcode, locationnote, av_note, match, loc_match_qty, spec, caliper,
      pick, initial_ptr, flyer_av_note, flyer_match, flyer_loc_match_qty, flyer_spec,
      flyer_caliper, flyer_pick, flyer_initial_ptr, flyer_photo_link, flyer_photo_name,
      snapshot, created_by_username, created_by_display, created_at, updated_at,
      folder_name, folder_tab, history_state, last_event
    )
    select
      i.unique_id, i.master_unique_id, i.source_table, i.flyer_title, i.flyer_assigned, i.assignedto,
      i.itemcode, i.commonname, i.contsize, i.locationcode, i.lotcode, i.priority, i.ptravailable, i.s_lts,
      i.holdstopcode, i.plantgroupcode, i.locationnote, i.av_note, i.match, i.loc_match_qty, i.spec, i.caliper,
      i.pick, i.initial_ptr, i.flyer_av_note, i.flyer_match, i.flyer_loc_match_qty, i.flyer_spec,
      i.flyer_caliper, i.flyer_pick, i.flyer_initial_ptr, i.flyer_photo_link, i.flyer_photo_name,
      i.snapshot, i.created_by_username, i.created_by_display, i.created_at, i.updated_at,
      v_folder, 'active', 'active', 'created'
    from inserted i
    on conflict (unique_id) do update set
      flyer_assigned = excluded.flyer_assigned,
      assignedto = excluded.assignedto,
      updated_at = excluded.updated_at,
      last_event = 'rows_added'
    returning unique_id
  )
  select jsonb_agg(to_jsonb(i) order by i.locationcode, i.lotcode, i.unique_id)
  into v_rows
  from inserted i;

  v_response := jsonb_build_object(
    'ok', true,
    'contractVersion', 'create-flyer-folder-batch-v1',
    'folderName', v_folder,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'rowCount', v_expected_count,
    'assigneeUsernames', to_jsonb(v_assignees),
    'assigneeDisplay', v_assignee_display,
    'recovered', false
  );

  insert into private.flyer_folder_batch_idempotency
    (profile_id, idempotency_key, request_hash, response_payload)
  values
    (v_actor.id, btrim(p_idempotency_key), v_request_hash, v_response);

  return v_response;
end
$function$;

revoke all on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text) from public, anon;
grant execute on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text) to authenticated;

revoke insert, update, delete, truncate, references, trigger on public.ph_master_inventory from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.ph_flyer_folder_rows from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.ph_flyer_folder_history from anon, authenticated;

comment on function public.save_drive_evidence_v1(text, text, text, text, text, jsonb, boolean, text, text)
  is 'Admin-only exact-row Drive evidence writer. Contract save-drive-evidence-v1.';
comment on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text)
  is 'Admin-only server-authoritative Flyer folder batch writer. Contract create-flyer-folder-batch-v1.';

commit;
