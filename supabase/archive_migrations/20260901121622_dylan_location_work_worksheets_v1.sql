begin;

-- Dylan-only Bloom Picker Location Work worksheets. Browser sessions are
-- deliberately denied table and RPC access; app-api authenticates the actor,
-- resolves verified recipients, and calls these service-role-only operations.

create index if not exists ph_master_inventory_location_work_match_idx
  on public.ph_master_inventory (
    lower(btrim(itemcode)), lower(btrim(saleyear)), lower(btrim(locationcode)), unique_id
  );

create table public.ph_location_work_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  title text not null check (length(btrim(title)) between 1 and 240),
  general_instructions text not null check (length(btrim(general_instructions)) between 1 and 8000),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'complete', 'cancelled')),
  revision integer not null default 1 check (revision > 0),
  line_count integer not null default 0 check (line_count >= 0),
  resolved_line_count integer not null default 0
    check (resolved_line_count >= 0 and resolved_line_count <= line_count),
  assigned_usernames text[] not null default '{}'::text[],
  assignment_event_id uuid references public.ph_request_delivery_outbox(event_id),
  completion_event_id uuid references public.ph_request_delivery_outbox(event_id),
  completion_recipient jsonb not null check (jsonb_typeof(completion_recipient) = 'object'),
  created_by_profile_id uuid not null references public.profiles(id),
  created_by_username text not null,
  created_by_display text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_by_username text,
  completed_at timestamptz,
  cancelled_by_username text,
  cancelled_at timestamptz,
  constraint ph_location_work_jobs_idempotency_check
    check (length(idempotency_key) between 16 and 240),
  constraint ph_location_work_jobs_assignees_check
    check (cardinality(assigned_usernames) between 1 and 50)
);

create index ph_location_work_jobs_status_updated_idx
  on public.ph_location_work_jobs (status, updated_at desc, id desc);
create index ph_location_work_jobs_assignees_idx
  on public.ph_location_work_jobs using gin (assigned_usernames);

create table public.ph_location_work_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ph_location_work_jobs(id) on delete cascade,
  source_unique_id text not null,
  itemcode text not null,
  commonname text not null default '',
  contsize text not null default '',
  salesyear text not null,
  source_locationcode text not null,
  snapshotted_on_hand integer not null check (snapshotted_on_hand >= 0),
  action_type text not null check (action_type in ('ta', 'move', 'grade', 'save')),
  planned_qty integer not null check (planned_qty > 0 and planned_qty <= snapshotted_on_hand),
  destination_locationcode text,
  destination_matching_rows integer not null default 0 check (destination_matching_rows >= 0),
  destination_on_hand numeric not null default 0 check (destination_on_hand >= 0),
  instructions text not null default '' check (length(instructions) <= 4000),
  resolution_status text not null default 'pending'
    check (resolution_status in ('pending', 'done', 'not_completed')),
  actual_qty integer check (actual_qty is null or actual_qty >= 0),
  variance_confirmed boolean not null default false,
  not_completed_reason text,
  resolved_by_username text,
  resolved_at timestamptz,
  ordinal integer not null check (ordinal > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, source_unique_id),
  unique (job_id, ordinal),
  constraint ph_location_work_lines_destination_check check (
    (action_type = 'move' and nullif(btrim(destination_locationcode), '') is not null)
    or (action_type = 'ta' and nullif(btrim(destination_locationcode), '') is null)
    or action_type in ('grade', 'save')
  ),
  constraint ph_location_work_lines_resolution_check check (
    (resolution_status = 'pending' and actual_qty is null and not_completed_reason is null
      and resolved_by_username is null and resolved_at is null)
    or (resolution_status = 'done' and actual_qty is not null
      and not_completed_reason is null and resolved_by_username is not null and resolved_at is not null)
    or (resolution_status = 'not_completed' and actual_qty is null
      and length(btrim(not_completed_reason)) between 1 and 2000
      and resolved_by_username is not null and resolved_at is not null)
  ),
  constraint ph_location_work_lines_variance_check
    check (actual_qty is null or actual_qty <= planned_qty or variance_confirmed)
);

create index ph_location_work_lines_job_idx
  on public.ph_location_work_lines (job_id, ordinal);
create index ph_location_work_lines_source_group_idx
  on public.ph_location_work_lines (job_id, lower(btrim(source_locationcode)), ordinal);

create table public.ph_location_work_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ph_location_work_jobs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  username text not null,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  unique (job_id, profile_id),
  unique (job_id, username)
);

create index ph_location_work_assignments_username_idx
  on public.ph_location_work_assignments (username, job_id);

create table public.ph_location_work_delivery_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.ph_location_work_jobs(id) on delete cascade,
  delivery_kind text not null check (delivery_kind in ('assignment', 'completion')),
  job_revision integer not null check (job_revision > 0),
  outbox_event_id uuid not null references public.ph_request_delivery_outbox(event_id),
  created_at timestamptz not null default now(),
  unique (job_id, delivery_kind, job_revision),
  unique (outbox_event_id)
);

create table public.ph_location_work_audit (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.ph_location_work_jobs(id) on delete cascade,
  line_id uuid references public.ph_location_work_lines(id) on delete set null,
  event_type text not null,
  actor_username text not null,
  job_revision integer not null check (job_revision > 0),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  created_at timestamptz not null default now()
);

create index ph_location_work_audit_job_idx
  on public.ph_location_work_audit (job_id, id);

alter table public.ph_location_work_jobs enable row level security;
alter table public.ph_location_work_lines enable row level security;
alter table public.ph_location_work_assignments enable row level security;
alter table public.ph_location_work_delivery_events enable row level security;
alter table public.ph_location_work_audit enable row level security;

revoke all on table public.ph_location_work_jobs from public, anon, authenticated;
revoke all on table public.ph_location_work_lines from public, anon, authenticated;
revoke all on table public.ph_location_work_assignments from public, anon, authenticated;
revoke all on table public.ph_location_work_delivery_events from public, anon, authenticated;
revoke all on table public.ph_location_work_audit from public, anon, authenticated;
grant all on table public.ph_location_work_jobs to service_role;
grant all on table public.ph_location_work_lines to service_role;
grant all on table public.ph_location_work_assignments to service_role;
grant all on table public.ph_location_work_delivery_events to service_role;
grant all on table public.ph_location_work_audit to service_role;
grant usage, select on sequence public.ph_location_work_delivery_events_id_seq to service_role;
grant usage, select on sequence public.ph_location_work_audit_id_seq to service_role;

create or replace function private.location_work_numeric_v1(p_value text)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case when btrim(coalesce(p_value, '')) ~ '^-?[0-9]+([.][0-9]+)?$'
    then btrim(p_value)::numeric else 0::numeric end
$function$;

create or replace function private.location_work_active_actor_v1(p_username text)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where username = lower(btrim(coalesce(p_username, ''))) limit 1;
  if actor.id is null or actor.disabled_at is not null
     or (actor.locked_until is not null and actor.locked_until > now())
     or coalesce(actor.must_change_password, false) then
    raise exception using errcode = '42501', message = 'location_work_actor_not_active';
  end if;
  return actor;
end
$function$;

create or replace function private.location_work_event_payload_v1(
  p_job_id uuid, p_delivery_kind text, p_recipient_emails text[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'contractVersion', 'location-work-v1',
    'deliveryKind', p_delivery_kind,
    'jobId', j.id,
    'jobRevision', j.revision,
    'title', j.title,
    'generalInstructions', j.general_instructions,
    'createdByUsername', j.created_by_username,
    'createdByDisplay', j.created_by_display,
    'createdAt', j.created_at,
    'completedAt', j.completed_at,
    'recipientEmails', to_jsonb(p_recipient_emails),
    'lineCount', j.line_count,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineId', l.id,
        'sourceUniqueId', l.source_unique_id,
        'itemcode', l.itemcode,
        'commonname', l.commonname,
        'contsize', l.contsize,
        'salesyear', l.salesyear,
        'sourceLocationcode', l.source_locationcode,
        'actionType', l.action_type,
        'plannedQty', l.planned_qty,
        'destinationLocationcode', coalesce(l.destination_locationcode, ''),
        'instructions', l.instructions,
        'resolutionStatus', l.resolution_status,
        'actualQty', l.actual_qty,
        'notCompletedReason', coalesce(l.not_completed_reason, ''),
        'resolvedByUsername', coalesce(l.resolved_by_username, ''),
        'resolvedAt', l.resolved_at
      ) order by lower(btrim(l.source_locationcode)), l.ordinal)
      from public.ph_location_work_lines l where l.job_id = j.id
    ), '[]'::jsonb)
  )
  from public.ph_location_work_jobs j where j.id = p_job_id
$function$;

create or replace function public.create_location_work_job_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  job public.ph_location_work_jobs;
  source_row public.ph_master_inventory;
  recipient_record record;
  line_record record;
  delivery public.ph_request_delivery_outbox;
  lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  recipients jsonb := coalesce(p_payload->'recipients', '[]'::jsonb);
  completion_recipient jsonb := coalesce(p_payload->'completionRecipient', '{}'::jsonb);
  idempotency_value text := btrim(coalesce(p_payload->>'idempotencyKey', ''));
  title_value text := btrim(coalesce(p_payload->>'title', ''));
  instructions_value text := btrim(coalesce(p_payload->>'generalInstructions', ''));
  assigned_usernames text[] := '{}'::text[];
  recipient_emails text[] := '{}'::text[];
  action_value text;
  qty_value integer;
  source_on_hand integer;
  destination_value text;
  destination_count integer;
  destination_on_hand numeric;
  line_ordinal integer := 0;
  event_payload jsonb;
begin
  actor := private.location_work_active_actor_v1(p_payload->>'actorUsername');
  if actor.username <> 'dylan_collyge' then
    raise exception using errcode = '42501', message = 'location_work_create_forbidden';
  end if;
  if length(idempotency_value) < 16 or length(idempotency_value) > 240
     or length(title_value) < 1 or length(title_value) > 240
     or length(instructions_value) < 1 or length(instructions_value) > 8000
     or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) < 1 or jsonb_array_length(lines) > 500
     or jsonb_typeof(recipients) <> 'array' or jsonb_array_length(recipients) < 1 or jsonb_array_length(recipients) > 50 then
    raise exception using errcode = '22023', message = 'location_work_payload_invalid';
  end if;
  if lower(btrim(coalesce(completion_recipient->>'username', ''))) <> 'dylan_collyge'
     or lower(btrim(coalesce(completion_recipient->>'email', ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'location_work_completion_recipient_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('location-work:' || idempotency_value, 0));
  select * into job from public.ph_location_work_jobs where idempotency_key = idempotency_value;
  if job.id is not null then
    if job.created_by_username <> actor.username then
      raise exception using errcode = '42501', message = 'location_work_idempotency_forbidden';
    end if;
    return jsonb_build_object('idempotentReplay', true, 'jobId', job.id,
      'status', job.status, 'revision', job.revision, 'lineCount', job.line_count,
      'assignmentEventId', job.assignment_event_id);
  end if;

  if exists (
    select 1 from jsonb_array_elements(lines) value
    group by btrim(value->>'sourceUniqueId') having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'location_work_duplicate_source';
  end if;

  for recipient_record in select value as recipient from jsonb_array_elements(recipients)
  loop
    if not exists (
      select 1 from public.profiles p
      where p.id = nullif(recipient_record.recipient->>'profileId', '')::uuid
        and p.username = lower(btrim(recipient_record.recipient->>'username'))
        and p.disabled_at is null
        and (p.locked_until is null or p.locked_until <= now())
        and not coalesce(p.must_change_password, false)
    ) or lower(btrim(coalesce(recipient_record.recipient->>'email', ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'location_work_recipient_invalid';
    end if;
    if lower(btrim(recipient_record.recipient->>'username')) = any(assigned_usernames) then
      raise exception using errcode = '22023', message = 'location_work_recipient_duplicate';
    end if;
    assigned_usernames := array_append(assigned_usernames, lower(btrim(recipient_record.recipient->>'username')));
    recipient_emails := array_append(recipient_emails, lower(btrim(recipient_record.recipient->>'email')));
  end loop;

  insert into public.ph_location_work_jobs(
    idempotency_key, title, general_instructions, assigned_usernames, completion_recipient,
    created_by_profile_id, created_by_username, created_by_display
  ) values (
    idempotency_value, title_value, instructions_value, assigned_usernames, completion_recipient,
    actor.id, actor.username, coalesce(nullif(actor.display_name, ''), actor.username)
  ) returning * into job;

  for recipient_record in select value as recipient from jsonb_array_elements(recipients)
  loop
    insert into public.ph_location_work_assignments(job_id, profile_id, username, display_name, email)
    values (job.id, (recipient_record.recipient->>'profileId')::uuid,
      lower(btrim(recipient_record.recipient->>'username')),
      left(btrim(coalesce(recipient_record.recipient->>'display', recipient_record.recipient->>'username')), 200),
      lower(btrim(recipient_record.recipient->>'email')));
  end loop;

  for line_record in select value as line from jsonb_array_elements(lines)
  loop
    line_ordinal := line_ordinal + 1;
    select * into source_row from public.ph_master_inventory m
      where m.unique_id = btrim(line_record.line->>'sourceUniqueId') for update;
    if source_row.unique_id is null or btrim(coalesce(source_row.itemcode, '')) = ''
       or btrim(coalesce(source_row.locationcode, '')) = ''
       or btrim(coalesce(source_row.saleyear, '')) = '' then
      raise exception using errcode = '40001', message = 'location_work_source_refresh_required';
    end if;
    action_value := lower(btrim(coalesce(line_record.line->>'actionType', '')));
    if action_value not in ('ta', 'move', 'grade', 'save')
       or coalesce(line_record.line->>'plannedQty', '') !~ '^[0-9]+$'
       or length(coalesce(line_record.line->>'instructions', '')) > 4000 then
      raise exception using errcode = '22023', message = 'location_work_line_invalid';
    end if;
    qty_value := (line_record.line->>'plannedQty')::integer;
    source_on_hand := floor(greatest(private.location_work_numeric_v1(source_row.ptronhand), 0))::integer;
    if qty_value < 1 or qty_value > source_on_hand then
      raise exception using errcode = '22023', message = 'location_work_quantity_invalid';
    end if;
    destination_value := nullif(btrim(coalesce(line_record.line->>'destinationLocationcode', '')), '');
    if (action_value = 'move' and destination_value is null)
       or (action_value = 'ta' and destination_value is not null) then
      raise exception using errcode = '22023', message = 'location_work_destination_invalid';
    end if;
    destination_count := 0;
    destination_on_hand := 0;
    if destination_value is not null then
      perform m.unique_id from public.ph_master_inventory m
      where lower(btrim(m.itemcode)) = lower(btrim(source_row.itemcode))
        and lower(btrim(m.saleyear)) = lower(btrim(source_row.saleyear))
        and lower(btrim(m.locationcode)) = lower(btrim(destination_value))
        and lower(btrim(m.locationcode)) <> lower(btrim(source_row.locationcode))
      order by m.unique_id for update;
      select count(*), coalesce(sum(greatest(private.location_work_numeric_v1(m.ptronhand), 0)), 0)
        into destination_count, destination_on_hand
      from public.ph_master_inventory m
      where lower(btrim(m.itemcode)) = lower(btrim(source_row.itemcode))
        and lower(btrim(m.saleyear)) = lower(btrim(source_row.saleyear))
        and lower(btrim(m.locationcode)) = lower(btrim(destination_value))
        and lower(btrim(m.locationcode)) <> lower(btrim(source_row.locationcode));
      if destination_count < 1 then
        raise exception using errcode = '40001', message = 'location_work_destination_refresh_required';
      end if;
    end if;

    insert into public.ph_location_work_lines(
      job_id, source_unique_id, itemcode, commonname, contsize, salesyear,
      source_locationcode, snapshotted_on_hand, action_type, planned_qty,
      destination_locationcode, destination_matching_rows, destination_on_hand,
      instructions, ordinal
    ) values (
      job.id, source_row.unique_id, source_row.itemcode, coalesce(source_row.commonname, ''),
      coalesce(source_row.contsize, ''), source_row.saleyear, source_row.locationcode,
      source_on_hand, action_value, qty_value, destination_value, destination_count,
      destination_on_hand, btrim(coalesce(line_record.line->>'instructions', '')), line_ordinal
    );
  end loop;

  update public.ph_location_work_jobs set line_count = line_ordinal, updated_at = now()
    where id = job.id returning * into job;
  event_payload := private.location_work_event_payload_v1(job.id, 'assignment', recipient_emails);
  insert into public.ph_request_delivery_outbox(
    event_key, event_type, request_id, request_folder, payload, status, next_attempt_at
  ) values (
    'location-work:' || job.id::text || ':assignment:r' || job.revision::text,
    'location_work_assignment', job.id::text, job.title, event_payload, 'pending', now()
  ) returning * into delivery;
  insert into public.ph_location_work_delivery_events(job_id, delivery_kind, job_revision, outbox_event_id)
    values (job.id, 'assignment', job.revision, delivery.event_id);
  update public.ph_location_work_jobs set assignment_event_id = delivery.event_id, updated_at = now()
    where id = job.id returning * into job;
  insert into public.ph_location_work_audit(job_id, event_type, actor_username, job_revision, metadata)
    values (job.id, 'created', actor.username, job.revision,
      jsonb_build_object('lineCount', job.line_count, 'assigneeCount', cardinality(job.assigned_usernames)));
  return jsonb_build_object('idempotentReplay', false, 'jobId', job.id,
    'status', job.status, 'revision', job.revision, 'lineCount', job.line_count,
    'assignmentEventId', job.assignment_event_id);
end
$function$;

create or replace function public.resolve_location_work_line_v1(
  p_job_id uuid, p_line_id uuid, p_actor_username text, p_expected_revision integer,
  p_resolution_status text, p_actual_qty integer default null,
  p_not_completed_reason text default null, p_variance_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  job public.ph_location_work_jobs;
  line public.ph_location_work_lines;
  delivery public.ph_request_delivery_outbox;
  resolved_count integer;
  recipient_email text;
  event_payload jsonb;
  resolution_value text := lower(btrim(coalesce(p_resolution_status, '')));
begin
  actor := private.location_work_active_actor_v1(p_actor_username);
  select * into job from public.ph_location_work_jobs where id = p_job_id for update;
  if job.id is null then raise exception using errcode = '22023', message = 'location_work_job_not_found'; end if;
  if actor.username <> 'dylan_collyge' and not (actor.username = any(job.assigned_usernames)) then
    raise exception using errcode = '42501', message = 'location_work_complete_forbidden';
  end if;
  if job.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'location_work_revision_conflict';
  end if;
  if job.status not in ('open', 'in_progress') then
    raise exception using errcode = '40001', message = 'location_work_status_conflict';
  end if;
  select * into line from public.ph_location_work_lines
    where id = p_line_id and job_id = job.id for update;
  if line.id is null then raise exception using errcode = '22023', message = 'location_work_line_not_found'; end if;
  if line.resolution_status <> 'pending' then
    raise exception using errcode = '40001', message = 'location_work_line_already_resolved';
  end if;
  if resolution_value = 'done' then
    if p_actual_qty is null or p_actual_qty < 0
       or (p_actual_qty > line.planned_qty and not coalesce(p_variance_confirmed, false)) then
      raise exception using errcode = '22023', message = 'location_work_actual_qty_invalid';
    end if;
    update public.ph_location_work_lines set resolution_status = 'done', actual_qty = p_actual_qty,
      variance_confirmed = coalesce(p_variance_confirmed, false), resolved_by_username = actor.username,
      resolved_at = now(), updated_at = now() where id = line.id returning * into line;
  elsif resolution_value = 'not_completed' then
    if length(btrim(coalesce(p_not_completed_reason, ''))) < 1
       or length(btrim(coalesce(p_not_completed_reason, ''))) > 2000 then
      raise exception using errcode = '22023', message = 'location_work_reason_required';
    end if;
    update public.ph_location_work_lines set resolution_status = 'not_completed', actual_qty = null,
      variance_confirmed = false, not_completed_reason = btrim(p_not_completed_reason),
      resolved_by_username = actor.username, resolved_at = now(), updated_at = now()
      where id = line.id returning * into line;
  else
    raise exception using errcode = '22023', message = 'location_work_resolution_invalid';
  end if;

  select count(*) into resolved_count from public.ph_location_work_lines l
    where l.job_id = job.id and l.resolution_status <> 'pending';
  update public.ph_location_work_jobs set
    resolved_line_count = resolved_count,
    status = case when resolved_count = line_count then 'complete' else 'in_progress' end,
    revision = revision + 1,
    completed_by_username = case when resolved_count = line_count then actor.username else completed_by_username end,
    completed_at = case when resolved_count = line_count then now() else completed_at end,
    updated_at = now()
  where id = job.id returning * into job;
  insert into public.ph_location_work_audit(job_id, line_id, event_type, actor_username, job_revision, metadata)
    values (job.id, line.id, 'line_' || resolution_value, actor.username, job.revision,
      jsonb_build_object('varianceConfirmed', line.variance_confirmed));

  if job.status = 'complete' and job.completion_event_id is null then
    recipient_email := lower(btrim(job.completion_recipient->>'email'));
    event_payload := private.location_work_event_payload_v1(job.id, 'completion', array[recipient_email]);
    insert into public.ph_request_delivery_outbox(
      event_key, event_type, request_id, request_folder, payload, status, next_attempt_at
    ) values (
      'location-work:' || job.id::text || ':completion:v1', 'location_work_completion',
      job.id::text, job.title, event_payload, 'pending', now()
    ) on conflict (event_key) do update set payload = excluded.payload, updated_at = now()
    returning * into delivery;
    insert into public.ph_location_work_delivery_events(job_id, delivery_kind, job_revision, outbox_event_id)
      values (job.id, 'completion', job.revision, delivery.event_id)
      on conflict (outbox_event_id) do nothing;
    update public.ph_location_work_jobs set completion_event_id = delivery.event_id, updated_at = now()
      where id = job.id returning * into job;
    insert into public.ph_location_work_audit(job_id, event_type, actor_username, job_revision, metadata)
      values (job.id, 'completed', actor.username, job.revision,
        jsonb_build_object('resolvedLineCount', job.resolved_line_count));
  end if;
  return jsonb_build_object('jobId', job.id, 'status', job.status, 'revision', job.revision,
    'lineId', line.id, 'lineStatus', line.resolution_status,
    'resolvedLineCount', job.resolved_line_count, 'lineCount', job.line_count,
    'completionEventId', job.completion_event_id);
end
$function$;

create or replace function public.update_location_work_job_v1(
  p_job_id uuid, p_actor_username text, p_expected_revision integer,
  p_title text, p_general_instructions text
)
returns public.ph_location_work_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  job public.ph_location_work_jobs;
  delivery public.ph_request_delivery_outbox;
  recipient_emails text[];
  event_payload jsonb;
begin
  actor := private.location_work_active_actor_v1(p_actor_username);
  if actor.username <> 'dylan_collyge' then
    raise exception using errcode = '42501', message = 'location_work_edit_forbidden';
  end if;
  select * into job from public.ph_location_work_jobs where id = p_job_id for update;
  if job.id is null then raise exception using errcode = '22023', message = 'location_work_job_not_found'; end if;
  if job.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'location_work_revision_conflict'; end if;
  if job.status <> 'open' or job.resolved_line_count <> 0 then
    raise exception using errcode = '40001', message = 'location_work_edit_after_start_forbidden';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 1 or length(btrim(p_title)) > 240
     or length(btrim(coalesce(p_general_instructions, ''))) < 1
     or length(btrim(p_general_instructions)) > 8000 then
    raise exception using errcode = '22023', message = 'location_work_payload_invalid';
  end if;
  update public.ph_request_delivery_outbox set status = 'suppressed', updated_at = now()
    where event_id = job.assignment_event_id and status in ('pending', 'failed', 'unknown');
  update public.ph_location_work_jobs set title = btrim(p_title),
    general_instructions = btrim(p_general_instructions), revision = revision + 1, updated_at = now()
    where id = job.id returning * into job;
  select array_agg(a.email order by a.display_name, a.username) into recipient_emails
    from public.ph_location_work_assignments a where a.job_id = job.id;
  event_payload := private.location_work_event_payload_v1(job.id, 'assignment', coalesce(recipient_emails, '{}'::text[]));
  insert into public.ph_request_delivery_outbox(
    event_key, event_type, request_id, request_folder, payload, status, next_attempt_at
  ) values (
    'location-work:' || job.id::text || ':assignment:r' || job.revision::text,
    'location_work_assignment', job.id::text, job.title, event_payload, 'pending', now()
  ) returning * into delivery;
  insert into public.ph_location_work_delivery_events(job_id, delivery_kind, job_revision, outbox_event_id)
    values (job.id, 'assignment', job.revision, delivery.event_id);
  update public.ph_location_work_jobs set assignment_event_id = delivery.event_id, updated_at = now()
    where id = job.id returning * into job;
  insert into public.ph_location_work_audit(job_id, event_type, actor_username, job_revision)
    values (job.id, 'edited', actor.username, job.revision);
  return job;
end
$function$;

create or replace function public.cancel_location_work_job_v1(
  p_job_id uuid, p_actor_username text, p_expected_revision integer
)
returns public.ph_location_work_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare actor public.profiles; job public.ph_location_work_jobs;
begin
  actor := private.location_work_active_actor_v1(p_actor_username);
  if actor.username <> 'dylan_collyge' then
    raise exception using errcode = '42501', message = 'location_work_cancel_forbidden';
  end if;
  select * into job from public.ph_location_work_jobs where id = p_job_id for update;
  if job.id is null then raise exception using errcode = '22023', message = 'location_work_job_not_found'; end if;
  if job.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'location_work_revision_conflict'; end if;
  if job.status not in ('open', 'in_progress') then raise exception using errcode = '40001', message = 'location_work_status_conflict'; end if;
  update public.ph_location_work_jobs set status = 'cancelled', revision = revision + 1,
    cancelled_by_username = actor.username, cancelled_at = now(), updated_at = now()
    where id = job.id returning * into job;
  update public.ph_request_delivery_outbox set status = 'suppressed', updated_at = now()
    where event_id in (job.assignment_event_id, job.completion_event_id)
      and status in ('pending', 'failed', 'unknown');
  insert into public.ph_location_work_audit(job_id, event_type, actor_username, job_revision)
    values (job.id, 'cancelled', actor.username, job.revision);
  return job;
end
$function$;

create or replace function public.retry_location_work_delivery_v1(
  p_job_id uuid, p_actor_username text, p_expected_revision integer, p_delivery_kind text
)
returns public.ph_location_work_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  job public.ph_location_work_jobs;
  event_id_value uuid;
  delivery_kind_value text := lower(btrim(coalesce(p_delivery_kind, '')));
begin
  actor := private.location_work_active_actor_v1(p_actor_username);
  if actor.username <> 'dylan_collyge' then
    raise exception using errcode = '42501', message = 'location_work_retry_forbidden';
  end if;
  select * into job from public.ph_location_work_jobs where id = p_job_id for update;
  if job.id is null then raise exception using errcode = '22023', message = 'location_work_job_not_found'; end if;
  if job.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'location_work_revision_conflict'; end if;
  event_id_value := case when delivery_kind_value = 'assignment' then job.assignment_event_id
    when delivery_kind_value = 'completion' then job.completion_event_id else null end;
  if event_id_value is null or not exists (
    select 1 from public.ph_request_delivery_outbox d
      where d.event_id = event_id_value and d.status in ('failed', 'unknown')
  ) then raise exception using errcode = '40001', message = 'location_work_delivery_not_retryable'; end if;
  update public.ph_request_delivery_outbox set status = 'pending', next_attempt_at = now(),
    sanitized_error_code = null, lease_token = null, lease_owner = null,
    lease_expires_at = null, updated_at = now() where event_id = event_id_value;
  update public.ph_location_work_jobs set revision = revision + 1, updated_at = now()
    where id = job.id returning * into job;
  insert into public.ph_location_work_audit(job_id, event_type, actor_username, job_revision, metadata)
    values (job.id, 'delivery_retried', actor.username, job.revision,
      jsonb_build_object('deliveryKind', delivery_kind_value));
  return job;
end
$function$;

revoke all on function private.location_work_numeric_v1(text) from public, anon, authenticated;
revoke all on function private.location_work_active_actor_v1(text) from public, anon, authenticated;
revoke all on function private.location_work_event_payload_v1(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.create_location_work_job_v1(jsonb) from public, anon, authenticated;
revoke all on function public.update_location_work_job_v1(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.resolve_location_work_line_v1(uuid, uuid, text, integer, text, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.cancel_location_work_job_v1(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.retry_location_work_delivery_v1(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function private.location_work_numeric_v1(text) to service_role;
grant execute on function private.location_work_active_actor_v1(text) to service_role;
grant execute on function private.location_work_event_payload_v1(uuid, text, text[]) to service_role;
grant execute on function public.create_location_work_job_v1(jsonb) to service_role;
grant execute on function public.update_location_work_job_v1(uuid, text, integer, text, text) to service_role;
grant execute on function public.resolve_location_work_line_v1(uuid, uuid, text, integer, text, integer, text, boolean) to service_role;
grant execute on function public.cancel_location_work_job_v1(uuid, text, integer) to service_role;
grant execute on function public.retry_location_work_delivery_v1(uuid, text, integer, text) to service_role;

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values
  ('location_work.create', 'action', 'drive', 'Create Location Work',
    'Dylan-only creation and management of Bloom Picker Location Work worksheets.', '{}', 1482, true),
  ('location_work.complete', 'action', 'queue', 'Complete Location Work',
    'Assigned active users may resolve Location Work worksheet lines.', '{}', 1483, true)
on conflict (permission_key) do update set
  label = excluded.label, description = excluded.description,
  scope_options = excluded.scope_options, sort_order = excluded.sort_order, active = true;

insert into private.app_access_legacy_checks(check_key, permission_key, enforcement_surface, notes)
values
  ('client.location_work.create', 'location_work.create', 'client', 'Dylan-only Bloom Picker action visibility.'),
  ('rpc.location_work.create', 'location_work.create', 'rpc', 'Service-role-only transactional creation RPC and Dylan assertion.'),
  ('client.location_work.complete', 'location_work.complete', 'client', 'Assigned-user Queue worksheet completion.'),
  ('rpc.location_work.complete', 'location_work.complete', 'rpc', 'Server validates active assignment before line resolution.'),
  ('rls.location_work.tables', 'location_work.create', 'rls', 'Direct browser table access is denied for all Location Work tables.')
on conflict (check_key) do update set permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface, notes = excluded.notes;

comment on table public.ph_location_work_jobs is
  'Historical Bloom Picker Location Work worksheets. Inventory evidence is frozen at creation and completion never mutates inventory.';
comment on function public.create_location_work_job_v1(jsonb) is
  'Dylan-only idempotent creation that locks source/destination rows, freezes one line per selected row, and queues one assignment PDF.';
comment on function public.resolve_location_work_line_v1(uuid, uuid, text, integer, text, integer, text, boolean) is
  'Assigned-user optimistic line resolution. The final resolution queues one completion PDF to Dylan without changing inventory.';

commit;
