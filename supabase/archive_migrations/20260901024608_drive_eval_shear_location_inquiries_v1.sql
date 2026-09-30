begin;

-- Drive Mode Eval Work creators and the Shear Location Inquiry V2 contract.
-- Browser sessions never write these tables directly. The app-api resolves the
-- signed-in profile and invokes the service-role-only RPCs below.

create index if not exists ph_master_inventory_item_location_normalized_idx
  on public.ph_master_inventory (lower(btrim(itemcode)), lower(btrim(locationcode)));

create table if not exists public.ph_shear_location_submissions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  created_by_username text not null,
  created_by_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint ph_shear_location_submissions_key_check
    check (length(idempotency_key) between 16 and 240)
);

create table if not exists public.ph_shear_location_inquiries (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.ph_shear_location_submissions(id),
  locationcode text not null,
  location_key text generated always as (lower(btrim(locationcode))) stored,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'complete', 'cancelled')),
  revision integer not null default 1 check (revision > 0),
  item_count integer not null default 0 check (item_count >= 0),
  row_count integer not null default 0 check (row_count >= 0),
  total_on_hand numeric not null default 0 check (total_on_hand >= 0),
  total_to_shear integer not null default 0 check (total_to_shear >= 0),
  recipient_profiles jsonb not null default '[]'::jsonb
    check (jsonb_typeof(recipient_profiles) = 'array'),
  recipient_usernames text[] not null default '{}'::text[],
  recipient_emails text[] not null default '{}'::text[],
  delivery_event_id uuid references public.ph_request_delivery_outbox(event_id),
  created_by_username text not null,
  created_by_display text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_by_username text,
  completed_at timestamptz,
  cancelled_by_username text,
  cancelled_at timestamptz,
  unique (submission_id, location_key),
  constraint ph_shear_location_inquiries_recipient_count_check
    check (cardinality(recipient_usernames) between 1 and 50
      and cardinality(recipient_emails) = cardinality(recipient_usernames))
);

create unique index if not exists ph_shear_location_inquiries_one_active_location_idx
  on public.ph_shear_location_inquiries (location_key)
  where status in ('open', 'in_progress');
create index if not exists ph_shear_location_inquiries_updated_idx
  on public.ph_shear_location_inquiries (updated_at desc, id desc);

create table if not exists public.ph_shear_location_items (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.ph_shear_location_inquiries(id) on delete cascade,
  itemcode text not null,
  itemcode_key text generated always as (lower(btrim(itemcode))) stored,
  commonname text not null default '',
  percent_to_shear numeric(6,2) not null check (percent_to_shear > 0 and percent_to_shear <= 100),
  shear_type text not null check (shear_type in ('shape_shear', 'saleable_shear', 'hard_shear', 'corrective_shear')),
  instructions text not null default '' check (length(instructions) <= 4000),
  on_hand_total numeric not null default 0 check (on_hand_total >= 0),
  review_total numeric not null default 0 check (review_total >= 0),
  available_total numeric not null default 0 check (available_total >= 0),
  calculated_quantity integer not null default 0 check (calculated_quantity >= 0),
  ordinal integer not null check (ordinal > 0),
  created_at timestamptz not null default now(),
  unique (inquiry_id, itemcode_key),
  unique (inquiry_id, ordinal)
);

create index if not exists ph_shear_location_items_inquiry_idx
  on public.ph_shear_location_items (inquiry_id, ordinal);

create table if not exists public.ph_shear_location_rows (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.ph_shear_location_inquiries(id) on delete cascade,
  item_id uuid not null references public.ph_shear_location_items(id) on delete cascade,
  origin_unique_id text not null,
  itemcode text not null,
  commonname text not null default '',
  contsize text not null default '',
  locationcode text not null,
  lotcode text not null default '',
  season text not null default '',
  salesyear text not null default '',
  blockalpha text not null default '',
  blocknumber text not null default '',
  ptronhand numeric not null default 0,
  ptrreviewed numeric not null default 0,
  ptravailable numeric not null default 0,
  assignedto text not null default '',
  priority text not null default '',
  holdstopcode text not null default '',
  holdstopreason text not null default '',
  locationnote text not null default '',
  locationnotedate text not null default '',
  source text not null default '',
  ordinal integer not null check (ordinal > 0),
  snapshot_at timestamptz not null default now(),
  unique (inquiry_id, origin_unique_id),
  unique (inquiry_id, ordinal)
);

create index if not exists ph_shear_location_rows_item_idx
  on public.ph_shear_location_rows (item_id, ordinal);

create table if not exists public.ph_shear_location_events (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.ph_shear_location_inquiries(id) on delete cascade,
  event_type text not null,
  actor_username text not null,
  revision integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ph_shear_location_events_inquiry_idx
  on public.ph_shear_location_events (inquiry_id, id);

alter table public.ph_shear_location_submissions enable row level security;
alter table public.ph_shear_location_inquiries enable row level security;
alter table public.ph_shear_location_items enable row level security;
alter table public.ph_shear_location_rows enable row level security;
alter table public.ph_shear_location_events enable row level security;

revoke all on table public.ph_shear_location_submissions from public, anon, authenticated;
revoke all on table public.ph_shear_location_inquiries from public, anon, authenticated;
revoke all on table public.ph_shear_location_items from public, anon, authenticated;
revoke all on table public.ph_shear_location_rows from public, anon, authenticated;
revoke all on table public.ph_shear_location_events from public, anon, authenticated;
grant all on table public.ph_shear_location_submissions to service_role;
grant all on table public.ph_shear_location_inquiries to service_role;
grant all on table public.ph_shear_location_items to service_role;
grant all on table public.ph_shear_location_rows to service_role;
grant all on table public.ph_shear_location_events to service_role;
grant usage, select on sequence public.ph_shear_location_events_id_seq to service_role;

create or replace function private.shear_numeric_v1(p_value text)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case
    when btrim(coalesce(p_value, '')) ~ '^-?[0-9]+([.][0-9]+)?$'
      then btrim(p_value)::numeric
    else 0::numeric
  end
$function$;

create or replace function private.shear_assert_active_actor_v1(p_username text)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
begin
  select * into actor
  from public.profiles
  where username = lower(btrim(coalesce(p_username, '')))
  limit 1;
  if actor.id is null or actor.disabled_at is not null
     or (actor.locked_until is not null and actor.locked_until > now())
     or coalesce(actor.must_change_password, false) then
    raise exception using errcode = '42501', message = 'shear_actor_not_active';
  end if;
  return actor;
end
$function$;

create or replace function public.create_shear_location_inquiries_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  submission public.ph_shear_location_submissions;
  inquiry public.ph_shear_location_inquiries;
  item_row public.ph_shear_location_items;
  inventory_row public.ph_master_inventory;
  location_record record;
  decision_record record;
  recipient_record record;
  delivery public.ph_request_delivery_outbox;
  selections jsonb := coalesce(p_payload->'selections', '[]'::jsonb);
  recipients jsonb := coalesce(p_payload->'recipients', '[]'::jsonb);
  idempotency_value text := btrim(coalesce(p_payload->>'idempotencyKey', ''));
  recipient_profiles jsonb := '[]'::jsonb;
  recipient_usernames text[] := '{}'::text[];
  recipient_emails text[] := '{}'::text[];
  item_ordinal integer;
  row_ordinal integer;
  matched_selection_count integer;
  total_items integer;
  total_rows integer;
  total_on_hand_value numeric;
  review_total_value numeric;
  available_total_value numeric;
  total_to_shear_value integer;
  event_payload jsonb;
  result jsonb;
begin
  actor := private.shear_assert_active_actor_v1(p_payload->>'actorUsername');
  if actor.username <> 'dylan_collyge' then
    raise exception using errcode = '42501', message = 'shear_create_forbidden';
  end if;
  if length(idempotency_value) < 16 or length(idempotency_value) > 240
     or jsonb_typeof(selections) <> 'array' or jsonb_array_length(selections) < 1 or jsonb_array_length(selections) > 100
     or jsonb_typeof(recipients) <> 'array' or jsonb_array_length(recipients) < 1 or jsonb_array_length(recipients) > 50 then
    raise exception using errcode = '22023', message = 'shear_create_payload_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shear-location:' || idempotency_value, 0));
  select * into submission from public.ph_shear_location_submissions where idempotency_key = idempotency_value;
  if submission.id is not null then
    if submission.created_by_username <> actor.username then
      raise exception using errcode = '42501', message = 'shear_idempotency_forbidden';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'locationcode', q.locationcode, 'status', q.status, 'revision', q.revision,
      'itemCount', q.item_count, 'rowCount', q.row_count, 'totalOnHand', q.total_on_hand,
      'totalToShear', q.total_to_shear, 'deliveryEventId', q.delivery_event_id
    ) order by q.location_key), '[]'::jsonb) into result
    from public.ph_shear_location_inquiries q where q.submission_id = submission.id;
    return jsonb_build_object('idempotentReplay', true, 'inquiries', result);
  end if;

  for recipient_record in
    select value as recipient from jsonb_array_elements(recipients)
  loop
    if not exists (
      select 1 from public.profiles p
      where p.id = nullif(recipient_record.recipient->>'profileId', '')::uuid
        and p.username = lower(btrim(recipient_record.recipient->>'username'))
        and p.disabled_at is null
        and (p.locked_until is null or p.locked_until <= now())
        and not coalesce(p.must_change_password, false)
    ) or lower(btrim(coalesce(recipient_record.recipient->>'email', ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'shear_recipient_invalid';
    end if;
    if lower(btrim(recipient_record.recipient->>'username')) = any(recipient_usernames) then
      raise exception using errcode = '22023', message = 'shear_recipient_duplicate';
    end if;
    recipient_profiles := recipient_profiles || jsonb_build_array(jsonb_build_object(
      'profileId', recipient_record.recipient->>'profileId',
      'username', lower(btrim(recipient_record.recipient->>'username')),
      'display', left(btrim(coalesce(recipient_record.recipient->>'display', recipient_record.recipient->>'username')), 200),
      'email', lower(btrim(recipient_record.recipient->>'email'))
    ));
    recipient_usernames := array_append(recipient_usernames, lower(btrim(recipient_record.recipient->>'username')));
    recipient_emails := array_append(recipient_emails, lower(btrim(recipient_record.recipient->>'email')));
  end loop;

  select count(*) into matched_selection_count
  from jsonb_array_elements(selections) selected
  join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
  where btrim(coalesce(m.itemcode, '')) <> '' and btrim(coalesce(m.locationcode, '')) <> ''
    and private.shear_numeric_v1(selected->>'percent') > 0
    and private.shear_numeric_v1(selected->>'percent') <= 100
    and lower(replace(btrim(coalesce(selected->>'shearType', '')), ' ', '_'))
      in ('shape_shear', 'saleable_shear', 'hard_shear', 'corrective_shear')
    and length(coalesce(selected->>'instructions', '')) <= 4000;
  if matched_selection_count <> jsonb_array_length(selections) then
    raise exception using errcode = '40001', message = 'shear_selection_refresh_required';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(selections) selected
    join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
    group by lower(btrim(m.locationcode)), lower(btrim(m.itemcode))
    having count(distinct concat_ws('|',
      private.shear_numeric_v1(selected->>'percent')::text,
      lower(replace(btrim(selected->>'shearType'), ' ', '_')),
      coalesce(selected->>'instructions', ''))) > 1
  ) then
    raise exception using errcode = '22023', message = 'shear_item_decision_conflict';
  end if;

  insert into public.ph_shear_location_submissions(idempotency_key, created_by_username, created_by_profile_id)
  values (idempotency_value, actor.username, actor.id) returning * into submission;

  for location_record in
    select lower(btrim(m.locationcode)) as location_key, min(btrim(m.locationcode)) as locationcode
    from jsonb_array_elements(selections) selected
    join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
    group by lower(btrim(m.locationcode))
    order by lower(btrim(m.locationcode))
  loop
    perform pg_advisory_xact_lock(hashtextextended('shear-active-location:' || location_record.location_key, 0));
    if exists (select 1 from public.ph_shear_location_inquiries q
      where q.location_key = location_record.location_key and q.status in ('open', 'in_progress')) then
      raise exception using errcode = '40001', message = 'shear_location_already_active';
    end if;
    insert into public.ph_shear_location_inquiries(
      submission_id, locationcode, recipient_profiles, recipient_usernames, recipient_emails,
      created_by_username, created_by_display
    ) values (
      submission.id, location_record.locationcode, recipient_profiles, recipient_usernames, recipient_emails,
      actor.username, coalesce(nullif(actor.display_name, ''), actor.username)
    ) returning * into inquiry;

    item_ordinal := 0;
    row_ordinal := 0;
    for decision_record in
      select lower(btrim(m.itemcode)) as itemcode_key,
        min(btrim(m.itemcode)) as itemcode,
        min(coalesce(m.commonname, '')) as commonname,
        min(private.shear_numeric_v1(selected->>'percent')) as percent_to_shear,
        min(lower(replace(btrim(selected->>'shearType'), ' ', '_'))) as shear_type,
        min(coalesce(selected->>'instructions', '')) as instructions
      from jsonb_array_elements(selections) selected
      join public.ph_master_inventory m on m.unique_id = btrim(selected->>'sourceUniqueId')
      where lower(btrim(m.locationcode)) = location_record.location_key
      group by lower(btrim(m.itemcode))
      order by lower(btrim(m.itemcode))
    loop
      item_ordinal := item_ordinal + 1;
      -- Lock the exact current membership before calculating totals so the
      -- frozen rows, PDF totals, and half-up quantities all describe one
      -- transactionally consistent inventory state.
      perform m.unique_id
      from public.ph_master_inventory m
      where lower(btrim(m.itemcode)) = decision_record.itemcode_key
        and lower(btrim(m.locationcode)) = location_record.location_key
      order by m.unique_id
      for update;
      select coalesce(sum(greatest(private.shear_numeric_v1(m.ptronhand), 0)), 0),
        coalesce(sum(greatest(private.shear_numeric_v1(m.ptrreviewed), 0)), 0),
        coalesce(sum(greatest(private.shear_numeric_v1(m.ptravailable), 0)), 0),
        count(*)
      into total_on_hand_value, review_total_value, available_total_value, matched_selection_count
      from public.ph_master_inventory m
      where lower(btrim(m.itemcode)) = decision_record.itemcode_key
        and lower(btrim(m.locationcode)) = location_record.location_key;

      insert into public.ph_shear_location_items(
        inquiry_id, itemcode, commonname, percent_to_shear, shear_type, instructions,
        on_hand_total, review_total, available_total, calculated_quantity, ordinal
      ) values (
        inquiry.id, decision_record.itemcode, decision_record.commonname,
        decision_record.percent_to_shear, decision_record.shear_type, decision_record.instructions,
        total_on_hand_value, review_total_value, available_total_value,
        floor((total_on_hand_value * decision_record.percent_to_shear / 100) + 0.5)::integer,
        item_ordinal
      ) returning * into item_row;

      for inventory_row in
        select m.* from public.ph_master_inventory m
        where lower(btrim(m.itemcode)) = decision_record.itemcode_key
          and lower(btrim(m.locationcode)) = location_record.location_key
        order by coalesce(m.season, ''), coalesce(m.lotcode, ''), m.unique_id
        for update
      loop
        row_ordinal := row_ordinal + 1;
        insert into public.ph_shear_location_rows(
          inquiry_id, item_id, origin_unique_id, itemcode, commonname, contsize, locationcode,
          lotcode, season, salesyear, blockalpha, blocknumber, ptronhand, ptrreviewed,
          ptravailable, assignedto, priority, holdstopcode, holdstopreason, locationnote,
          locationnotedate, source, ordinal
        ) values (
          inquiry.id, item_row.id, inventory_row.unique_id, inventory_row.itemcode,
          coalesce(inventory_row.commonname, ''), coalesce(inventory_row.contsize, ''), inventory_row.locationcode,
          coalesce(inventory_row.lotcode, ''), coalesce(inventory_row.season, ''), coalesce(inventory_row.saleyear, ''),
          coalesce(inventory_row.blockalpha, ''), coalesce(inventory_row.blocknumber, ''),
          greatest(private.shear_numeric_v1(inventory_row.ptronhand), 0),
          greatest(private.shear_numeric_v1(inventory_row.ptrreviewed), 0),
          greatest(private.shear_numeric_v1(inventory_row.ptravailable), 0),
          coalesce(inventory_row.assignedto, ''), coalesce(inventory_row.priority, ''),
          coalesce(inventory_row.holdstopcode, ''), coalesce(inventory_row.holdstopreason, ''),
          coalesce(inventory_row.locationnote, ''), coalesce(inventory_row.locationnotedate, ''),
          coalesce(inventory_row.source, ''), row_ordinal
        );
      end loop;
    end loop;

    select count(*), coalesce(sum(i.on_hand_total), 0), coalesce(sum(i.calculated_quantity), 0)
      into total_items, total_on_hand_value, total_to_shear_value
    from public.ph_shear_location_items i where i.inquiry_id = inquiry.id;
    select count(*) into total_rows from public.ph_shear_location_rows r where r.inquiry_id = inquiry.id;
    if total_items < 1 or total_rows < 1 or total_rows > 2000 then
      raise exception using errcode = '40001', message = 'shear_location_membership_invalid';
    end if;
    update public.ph_shear_location_inquiries set
      item_count = total_items, row_count = total_rows,
      total_on_hand = total_on_hand_value, total_to_shear = total_to_shear_value,
      updated_at = now()
    where id = inquiry.id returning * into inquiry;

    select jsonb_build_object(
      'contractVersion', 'shear-location-inquiry-v1',
      'deliveryKind', 'created',
      'inquiryId', inquiry.id,
      'locationcode', inquiry.locationcode,
      'createdByUsername', inquiry.created_by_username,
      'createdByDisplay', inquiry.created_by_display,
      'createdAt', inquiry.created_at,
      'recipientProfiles', inquiry.recipient_profiles,
      'recipientEmails', to_jsonb(inquiry.recipient_emails),
      'itemCount', inquiry.item_count,
      'rowCount', inquiry.row_count,
      'totalOnHand', inquiry.total_on_hand,
      'totalToShear', inquiry.total_to_shear,
      'items', coalesce(jsonb_agg(
        jsonb_build_object(
          'itemcode', i.itemcode, 'commonname', i.commonname,
          'percentToShear', i.percent_to_shear, 'shearType', i.shear_type,
          'instructions', i.instructions, 'onHandTotal', i.on_hand_total,
          'reviewTotal', i.review_total, 'availableTotal', i.available_total,
          'calculatedQuantity', i.calculated_quantity,
          'rows', (select coalesce(jsonb_agg(jsonb_build_object(
            'originUniqueId', r.origin_unique_id, 'itemcode', r.itemcode, 'commonname', r.commonname,
            'contsize', r.contsize, 'locationcode', r.locationcode, 'lotcode', r.lotcode,
            'season', r.season, 'salesyear', r.salesyear, 'blockalpha', r.blockalpha,
            'blocknumber', r.blocknumber, 'ptronhand', r.ptronhand, 'ptrreviewed', r.ptrreviewed,
            'ptravailable', r.ptravailable, 'assignedto', r.assignedto, 'priority', r.priority,
            'holdstopcode', r.holdstopcode, 'holdstopreason', r.holdstopreason,
            'locationnote', r.locationnote, 'locationnotedate', r.locationnotedate,
            'source', r.source
          ) order by r.ordinal), '[]'::jsonb) from public.ph_shear_location_rows r where r.item_id = i.id)
        ) order by i.ordinal
      ), '[]'::jsonb)
    ) into event_payload
    from public.ph_shear_location_items i where i.inquiry_id = inquiry.id;

    insert into public.ph_request_delivery_outbox(
      event_key, event_type, request_id, request_folder, payload, status, next_attempt_at
    ) values (
      'shear-location:' || inquiry.id::text || ':created:v1', 'shear_location_inquiry',
      inquiry.id::text, inquiry.locationcode, event_payload, 'pending', now()
    ) on conflict (event_key) do update set payload = excluded.payload, updated_at = now()
    returning * into delivery;
    update public.ph_shear_location_inquiries set delivery_event_id = delivery.event_id
      where id = inquiry.id returning * into inquiry;
    insert into public.ph_shear_location_events(inquiry_id, event_type, actor_username, revision, metadata)
    values (inquiry.id, 'created', actor.username, inquiry.revision,
      jsonb_build_object('itemCount', inquiry.item_count, 'rowCount', inquiry.row_count,
        'deliveryEventId', inquiry.delivery_event_id));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'locationcode', q.locationcode, 'status', q.status, 'revision', q.revision,
    'itemCount', q.item_count, 'rowCount', q.row_count, 'totalOnHand', q.total_on_hand,
    'totalToShear', q.total_to_shear, 'deliveryEventId', q.delivery_event_id
  ) order by q.location_key), '[]'::jsonb) into result
  from public.ph_shear_location_inquiries q where q.submission_id = submission.id;
  return jsonb_build_object('idempotentReplay', false, 'inquiries', result);
exception
  when unique_violation then
    raise exception using errcode = '40001', message = 'shear_location_already_active';
end
$function$;

create or replace function public.complete_shear_location_inquiry_v1(
  p_inquiry_id uuid, p_actor_username text, p_expected_revision integer
)
returns public.ph_shear_location_inquiries
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  inquiry public.ph_shear_location_inquiries;
begin
  actor := private.shear_assert_active_actor_v1(p_actor_username);
  select * into inquiry from public.ph_shear_location_inquiries where id = p_inquiry_id for update;
  if inquiry.id is null then raise exception using errcode = '22023', message = 'shear_inquiry_not_found'; end if;
  if inquiry.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'shear_revision_conflict'; end if;
  if inquiry.status not in ('open', 'in_progress') then raise exception using errcode = '40001', message = 'shear_status_conflict'; end if;
  update public.ph_shear_location_inquiries set status = 'complete', revision = revision + 1,
    completed_by_username = actor.username, completed_at = now(), updated_at = now()
  where id = inquiry.id returning * into inquiry;
  insert into public.ph_shear_location_events(inquiry_id, event_type, actor_username, revision)
  values (inquiry.id, 'completed', actor.username, inquiry.revision);
  return inquiry;
end
$function$;

create or replace function public.cancel_shear_location_inquiry_v1(
  p_inquiry_id uuid, p_actor_username text, p_expected_revision integer
)
returns public.ph_shear_location_inquiries
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  inquiry public.ph_shear_location_inquiries;
begin
  actor := private.shear_assert_active_actor_v1(p_actor_username);
  if actor.username <> 'dylan_collyge' then raise exception using errcode = '42501', message = 'shear_cancel_forbidden'; end if;
  select * into inquiry from public.ph_shear_location_inquiries where id = p_inquiry_id for update;
  if inquiry.id is null then raise exception using errcode = '22023', message = 'shear_inquiry_not_found'; end if;
  if inquiry.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'shear_revision_conflict'; end if;
  if inquiry.status not in ('open', 'in_progress') then raise exception using errcode = '40001', message = 'shear_status_conflict'; end if;
  update public.ph_shear_location_inquiries set status = 'cancelled', revision = revision + 1,
    cancelled_by_username = actor.username, cancelled_at = now(), updated_at = now()
  where id = inquiry.id returning * into inquiry;
  update public.ph_request_delivery_outbox set status = 'suppressed', updated_at = now()
  where event_id = inquiry.delivery_event_id and status in ('pending', 'failed', 'unknown');
  insert into public.ph_shear_location_events(inquiry_id, event_type, actor_username, revision)
  values (inquiry.id, 'cancelled', actor.username, inquiry.revision);
  return inquiry;
end
$function$;

create or replace function public.retry_shear_location_delivery_v1(
  p_inquiry_id uuid, p_actor_username text, p_expected_revision integer
)
returns public.ph_shear_location_inquiries
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  inquiry public.ph_shear_location_inquiries;
begin
  actor := private.shear_assert_active_actor_v1(p_actor_username);
  if actor.username <> 'dylan_collyge' then raise exception using errcode = '42501', message = 'shear_retry_forbidden'; end if;
  select * into inquiry from public.ph_shear_location_inquiries where id = p_inquiry_id for update;
  if inquiry.id is null then raise exception using errcode = '22023', message = 'shear_inquiry_not_found'; end if;
  if inquiry.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'shear_revision_conflict'; end if;
  if not exists (select 1 from public.ph_request_delivery_outbox d
    where d.event_id = inquiry.delivery_event_id and d.status in ('failed', 'unknown')) then
    raise exception using errcode = '40001', message = 'shear_delivery_not_retryable';
  end if;
  update public.ph_request_delivery_outbox set status = 'pending', next_attempt_at = now(),
    sanitized_error_code = null, lease_token = null, lease_owner = null, lease_expires_at = null,
    updated_at = now()
  where event_id = inquiry.delivery_event_id;
  update public.ph_shear_location_inquiries set revision = revision + 1, updated_at = now()
  where id = inquiry.id returning * into inquiry;
  insert into public.ph_shear_location_events(inquiry_id, event_type, actor_username, revision)
  values (inquiry.id, 'delivery_retried', actor.username, inquiry.revision);
  return inquiry;
end
$function$;

-- The latest Eval Work function intentionally keeps the client assignment
-- preview advisory. Extend its exact creator allowlist to JD without copying a
-- long security-definer function and risking drift from the reliability patch.
do $migration$
declare
  definition text;
  original_clause text := 'not in (''dylan_collyge'', ''megan_kelly'')';
begin
  select pg_get_functiondef('public.create_eval_work_batch_v2(jsonb)'::regprocedure) into definition;
  if position(original_clause in definition) = 0 then
    raise exception 'eval_work_creator_allowlist_clause_not_found';
  end if;
  execute replace(definition, original_clause,
    'not in (''dylan_collyge'', ''megan_kelly'', ''jd_jones'')');
end
$migration$;

revoke all on function private.shear_numeric_v1(text) from public, anon, authenticated;
revoke all on function private.shear_assert_active_actor_v1(text) from public, anon, authenticated;
revoke all on function public.create_shear_location_inquiries_v1(jsonb) from public, anon, authenticated;
revoke all on function public.complete_shear_location_inquiry_v1(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.cancel_shear_location_inquiry_v1(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.retry_shear_location_delivery_v1(uuid, text, integer) from public, anon, authenticated;
grant execute on function private.shear_numeric_v1(text) to service_role;
grant execute on function private.shear_assert_active_actor_v1(text) to service_role;
grant execute on function public.create_shear_location_inquiries_v1(jsonb) to service_role;
grant execute on function public.complete_shear_location_inquiry_v1(uuid, text, integer) to service_role;
grant execute on function public.cancel_shear_location_inquiry_v1(uuid, text, integer) to service_role;
grant execute on function public.retry_shear_location_delivery_v1(uuid, text, integer) to service_role;

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values
  ('eval_work.create.drive', 'action', 'drive', 'Send Drive rows to Eval Work',
    'Dylan, Megan, and JD may create ITEMCODE-wide Eval Work from Drive Mode.', '{}', 1480, true),
  ('shear_location.create', 'action', 'drive', 'Create Shear Location Inquiry',
    'Dylan-only creation of location-grouped Shear inquiries.', '{}', 1481, true)
on conflict (permission_key) do update set
  label = excluded.label, description = excluded.description,
  scope_options = excluded.scope_options, sort_order = excluded.sort_order, active = true;

insert into private.app_access_legacy_checks(check_key, permission_key, enforcement_surface, notes)
values
  ('client.eval_work.drive_create', 'eval_work.create.drive', 'client', 'Drive Mode action visibility for Dylan, Megan, and JD.'),
  ('rpc.eval_work.drive_create', 'eval_work.create.drive', 'rpc', 'Server profile allowlist remains authoritative.'),
  ('client.shear_location.create', 'shear_location.create', 'client', 'Dylan-only Shear action visibility.'),
  ('rpc.shear_location.create', 'shear_location.create', 'rpc', 'Service-role-only transactional creation RPC.'),
  ('rls.shear_location.tables', 'shear_location.create', 'rls', 'No direct browser writes to V2 Shear tables.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;

comment on table public.ph_shear_location_inquiries is
  'One immutable-at-creation, location-wide Shear inquiry. Only its workflow status and delivery retry metadata change.';
comment on function public.create_shear_location_inquiries_v1(jsonb) is
  'Dylan-only, idempotent transaction that derives current ITEMCODE/location membership, freezes all rows, and queues one delivery per location.';

commit;
