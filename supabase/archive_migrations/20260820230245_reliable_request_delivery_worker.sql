-- Independent, leased request-delivery worker. Delivery is no longer coupled
-- to the Google Drive synchronization trigger.

alter table public.ph_request_delivery_outbox
  add column if not exists lease_token uuid,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists first_attempt_at timestamptz,
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id text,
  add column if not exists message_id_header text,
  add column if not exists delivery_mode text,
  add column if not exists channel_results jsonb not null default '{}'::jsonb;

create index if not exists idx_ph_request_delivery_outbox_lease
  on public.ph_request_delivery_outbox (status, lease_expires_at)
  where status = 'processing';

create index if not exists idx_ph_request_delivery_outbox_stalled
  on public.ph_request_delivery_outbox (next_attempt_at, created_at)
  where status = 'pending';

create table if not exists public.ph_request_delivery_worker_state (
  worker_id text primary key,
  last_heartbeat_at timestamptz not null default now(),
  last_claimed_count integer not null default 0,
  last_delivered_count integer not null default 0,
  last_failed_count integer not null default 0,
  last_canary_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ph_request_delivery_worker_state enable row level security;
revoke all on table public.ph_request_delivery_worker_state from public, anon, authenticated;
grant all on table public.ph_request_delivery_worker_state to service_role;
grant select on table public.ph_request_delivery_worker_state to authenticated;

drop policy if exists ph_request_delivery_worker_manager_read
  on public.ph_request_delivery_worker_state;
create policy ph_request_delivery_worker_manager_read
on public.ph_request_delivery_worker_state for select to authenticated
using (private.can_manage_requests());

create or replace function private.is_service_role_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt()->>'role',
    ''
  ) = 'service_role'
$$;

revoke all on function private.is_service_role_request()
  from public, anon, authenticated;
grant execute on function private.is_service_role_request() to service_role;

create or replace function public.claim_request_delivery_events(
  p_limit integer default 20,
  p_worker_id text default 'request-delivery-worker'
)
returns setof public.ph_request_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  safe_worker text := left(coalesce(nullif(btrim(p_worker_id), ''), 'request-delivery-worker'), 120);
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;

  return query
  with candidates as (
    select o.event_id
    from public.ph_request_delivery_outbox o
    where (
        o.status = 'pending'
        and o.next_attempt_at <= now()
      ) or (
        o.status = 'processing'
        and coalesce(o.lease_expires_at, o.last_attempt_at, o.updated_at, o.created_at)
            <= now()
      )
    order by o.created_at, o.event_id
    for update skip locked
    limit safe_limit
  )
  update public.ph_request_delivery_outbox o
  set status = 'processing',
      lease_token = extensions.gen_random_uuid(),
      lease_owner = safe_worker,
      lease_expires_at = now() + interval '2 minutes',
      first_attempt_at = coalesce(o.first_attempt_at, now()),
      last_attempt_at = now(),
      sanitized_error_code = null
  from candidates c
  where o.event_id = c.event_id
  returning o.*;
end;
$$;

revoke all on function public.claim_request_delivery_events(integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_request_delivery_events(integer, text)
  to service_role;

create or replace function public.record_request_delivery_channel_result(
  p_event_id uuid,
  p_lease_token uuid,
  p_channel_results jsonb
)
returns public.ph_request_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_event public.ph_request_delivery_outbox%rowtype;
  email_result jsonb := coalesce(p_channel_results->'email', '{}'::jsonb);
  push_result jsonb := coalesce(p_channel_results->'push', '{}'::jsonb);
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;
  if p_channel_results is null or jsonb_typeof(p_channel_results) <> 'object' then
    raise exception using errcode = '22023', message = 'DELIVERY_CHANNEL_RESULT_INVALID';
  end if;

  update public.ph_request_delivery_outbox o
  set email_delivered_at = case
        when nullif(email_result->>'delivered_at', '') is not null
          then (email_result->>'delivered_at')::timestamptz
        else o.email_delivered_at end,
      push_delivered_at = case
        when nullif(push_result->>'delivered_at', '') is not null
          then (push_result->>'delivered_at')::timestamptz
        else o.push_delivered_at end,
      gmail_message_id = coalesce(nullif(email_result->>'gmail_message_id', ''), o.gmail_message_id),
      gmail_thread_id = coalesce(nullif(email_result->>'thread_id', ''), o.gmail_thread_id),
      message_id_header = coalesce(nullif(email_result->>'message_id_header', ''), o.message_id_header),
      delivery_mode = coalesce(nullif(email_result->>'mode', ''), nullif(push_result->>'mode', ''), o.delivery_mode),
      channel_results = coalesce(o.channel_results, '{}'::jsonb) || p_channel_results,
      lease_expires_at = now() + interval '2 minutes'
  where o.event_id = p_event_id
    and o.status = 'processing'
    and o.lease_token = p_lease_token
  returning o.* into updated_event;

  if not found then
    raise exception using errcode = '40001', message = 'DELIVERY_LEASE_LOST';
  end if;
  return updated_event;
end;
$$;

revoke all on function public.record_request_delivery_channel_result(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_request_delivery_channel_result(uuid, uuid, jsonb)
  to service_role;

create or replace function public.complete_request_delivery_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_channel_results jsonb default '{}'::jsonb
)
returns public.ph_request_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_event public.ph_request_delivery_outbox%rowtype;
  email_result jsonb := coalesce(p_channel_results->'email', '{}'::jsonb);
  event_recipients jsonb := coalesce(email_result->'recipients', '[]'::jsonb);
  initial_message_id text := nullif(email_result->>'reply_to_message_id', '');
  thread_customer text;
  thread_rep_name text;
  thread_rep_email text;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;

  perform public.record_request_delivery_channel_result(
    p_event_id, p_lease_token, coalesce(p_channel_results, '{}'::jsonb)
  );

  update public.ph_request_delivery_outbox o
  set status = 'delivered',
      delivered_at = now(),
      sanitized_error_code = null,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null
  where o.event_id = p_event_id
    and o.status = 'processing'
    and o.lease_token = p_lease_token
  returning o.* into updated_event;

  if not found then
    raise exception using errcode = '40001', message = 'DELIVERY_LEASE_LOST';
  end if;

  if updated_event.request_id is not null then
    update public.ph_request_history
    set delivery_state = 'delivered', updated_at = now()
    where unique_id = updated_event.request_id;
  end if;

  if updated_event.event_type in ('request_created', 'request_completed')
     and nullif(btrim(coalesce(updated_event.request_folder, '')), '') is not null
     and nullif(btrim(coalesce(updated_event.gmail_thread_id, '')), '') is not null then
    select
      coalesce(h.req_customer, a.req_customer, ''),
      coalesce(h.requested_by, a.requested_by, ''),
      coalesce(
        h.request_selected_rep_email, h.request_created_by_email,
        a.request_selected_rep_email, a.request_created_by_email, ''
      )
    into thread_customer, thread_rep_name, thread_rep_email
    from (values (1)) seed(n)
    left join public.ph_request_history h on h.unique_id = updated_event.request_id
    left join public.ph_active_request a on a.unique_id = updated_event.request_id
    limit 1;

    insert into public.ph_request_email_threads (
      request_folder, request_customer, sales_rep_name, sales_rep_email,
      recipients, initial_thread_id, initial_message_id,
      initial_email_sent_at, last_reply_sent_at, status, metadata
    )
    values (
      updated_event.request_folder,
      coalesce(thread_customer, ''),
      coalesce(thread_rep_name, ''),
      coalesce(thread_rep_email, ''),
      event_recipients,
      updated_event.gmail_thread_id,
      coalesce(
        case when updated_event.event_type = 'request_created'
          then nullif(email_result->>'message_id', '') end,
        initial_message_id,
        nullif(email_result->>'message_id', '')
      ),
      case when updated_event.event_type = 'request_created' then now() else null end,
      case when updated_event.event_type = 'request_completed' then now() else null end,
      case when updated_event.event_type = 'request_completed' then 'completed' else 'open' end,
      jsonb_build_object(
        'authority', 'request_delivery_worker',
        'delivery_event_id', updated_event.event_id,
        'delivery_mode', updated_event.delivery_mode
      )
    )
    on conflict (request_folder) do update set
      request_customer = coalesce(nullif(excluded.request_customer, ''), public.ph_request_email_threads.request_customer),
      sales_rep_name = coalesce(nullif(excluded.sales_rep_name, ''), public.ph_request_email_threads.sales_rep_name),
      sales_rep_email = coalesce(nullif(excluded.sales_rep_email, ''), public.ph_request_email_threads.sales_rep_email),
      recipients = case when excluded.recipients <> '[]'::jsonb then excluded.recipients else public.ph_request_email_threads.recipients end,
      initial_thread_id = coalesce(nullif(public.ph_request_email_threads.initial_thread_id, ''), excluded.initial_thread_id),
      initial_message_id = coalesce(nullif(public.ph_request_email_threads.initial_message_id, ''), excluded.initial_message_id),
      initial_email_sent_at = coalesce(public.ph_request_email_threads.initial_email_sent_at, excluded.initial_email_sent_at),
      last_reply_sent_at = coalesce(excluded.last_reply_sent_at, public.ph_request_email_threads.last_reply_sent_at),
      status = excluded.status,
      metadata = coalesce(public.ph_request_email_threads.metadata, '{}'::jsonb) || excluded.metadata;
  end if;

  return updated_event;
end;
$$;

revoke all on function public.complete_request_delivery_event(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_request_delivery_event(uuid, uuid, jsonb)
  to service_role;

create or replace function public.fail_request_delivery_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns public.ph_request_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_event public.ph_request_delivery_outbox%rowtype;
  next_attempt_count integer;
  safe_error text := upper(left(regexp_replace(coalesce(p_error_code, 'DELIVERY_WORKER_FAILED'), '[^A-Za-z0-9_]+', '_', 'g'), 120));
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;

  select attempt_count + 1 into next_attempt_count
  from public.ph_request_delivery_outbox
  where event_id = p_event_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'DELIVERY_LEASE_LOST';
  end if;

  update public.ph_request_delivery_outbox o
  set status = case when next_attempt_count >= 8 then 'failed' else 'pending' end,
      attempt_count = next_attempt_count,
      next_attempt_at = now() + make_interval(mins => least(360, power(2, least(next_attempt_count, 6))::integer)),
      sanitized_error_code = coalesce(nullif(safe_error, ''), 'DELIVERY_WORKER_FAILED'),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null
  where o.event_id = p_event_id
  returning o.* into updated_event;

  if updated_event.request_id is not null then
    update public.ph_request_history
    set delivery_state = case when updated_event.status = 'failed' then 'failed' else 'pending' end,
        updated_at = now()
    where unique_id = updated_event.request_id;
  end if;
  return updated_event;
end;
$$;

revoke all on function public.fail_request_delivery_event(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_request_delivery_event(uuid, uuid, text)
  to service_role;

create or replace function public.heartbeat_request_delivery_worker(
  p_worker_id text,
  p_claimed integer default 0,
  p_delivered integer default 0,
  p_failed integer default 0,
  p_canary boolean default false,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;
  insert into public.ph_request_delivery_worker_state (
    worker_id, last_heartbeat_at, last_claimed_count, last_delivered_count,
    last_failed_count, last_canary_at, last_error_code, updated_at
  ) values (
    left(coalesce(nullif(btrim(p_worker_id), ''), 'request-delivery-worker'), 120),
    now(), greatest(coalesce(p_claimed, 0), 0), greatest(coalesce(p_delivered, 0), 0),
    greatest(coalesce(p_failed, 0), 0), case when p_canary then now() else null end,
    nullif(left(coalesce(p_error_code, ''), 120), ''), now()
  )
  on conflict (worker_id) do update set
    last_heartbeat_at = excluded.last_heartbeat_at,
    last_claimed_count = excluded.last_claimed_count,
    last_delivered_count = excluded.last_delivered_count,
    last_failed_count = excluded.last_failed_count,
    last_canary_at = coalesce(excluded.last_canary_at, public.ph_request_delivery_worker_state.last_canary_at),
    last_error_code = excluded.last_error_code,
    updated_at = now();
end;
$$;

revoke all on function public.heartbeat_request_delivery_worker(text, integer, integer, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.heartbeat_request_delivery_worker(text, integer, integer, integer, boolean, text)
  to service_role;

-- Authenticated users may read only delivery metadata. The payload and channel
-- result columns remain unavailable; managers use the recovery RPC instead.
revoke select on table public.ph_request_delivery_outbox from authenticated;
grant select (
  event_id, event_type, request_id, request_folder, status, attempt_count,
  next_attempt_at, last_attempt_at, sanitized_error_code, email_delivered_at,
  push_delivered_at, delivered_at, created_at, updated_at, first_attempt_at,
  lease_expires_at, delivery_mode
) on public.ph_request_delivery_outbox to authenticated;

drop policy if exists ph_request_delivery_manager_read on public.ph_request_delivery_outbox;
drop policy if exists ph_request_delivery_active_profile_read on public.ph_request_delivery_outbox;
create policy ph_request_delivery_active_profile_read
on public.ph_request_delivery_outbox for select to authenticated
using ((private.current_active_profile()).id is not null);

create or replace view public.ph_request_delivery_status
with (security_invoker = true)
as
select distinct on (o.request_id, o.event_type)
  o.event_id,
  o.request_id,
  o.request_folder,
  o.event_type,
  o.status as delivery_status,
  o.attempt_count as delivery_attempt_count,
  o.next_attempt_at as delivery_next_attempt_at,
  o.first_attempt_at as delivery_first_attempt_at,
  o.last_attempt_at as delivery_last_attempt_at,
  o.lease_expires_at as delivery_lease_expires_at,
  o.sanitized_error_code as delivery_error_code,
  o.email_delivered_at,
  o.push_delivered_at,
  o.delivered_at,
  o.delivery_mode,
  extract(epoch from (now() - o.created_at))::bigint as delivery_age_seconds,
  case
    when o.status in ('pending', 'processing') then 'sending'
    when o.status = 'failed' then 'needs_attention'
    when o.status = 'delivered' then 'delivered'
    else o.status
  end as delivery_display_state
from public.ph_request_delivery_outbox o
where o.request_id is not null
order by o.request_id, o.event_type, o.created_at desc, o.event_id desc;

revoke all on table public.ph_request_delivery_status from public, anon;
grant select on table public.ph_request_delivery_status to authenticated, service_role;

create or replace view public.ph_request_queue_live_rows
with (security_invoker = true)
as
select r.*,
       s.event_id as delivery_event_id,
       s.delivery_status,
       s.delivery_attempt_count,
       s.delivery_next_attempt_at,
       s.delivery_first_attempt_at,
       s.delivery_last_attempt_at,
       s.delivery_lease_expires_at,
       s.delivery_error_code,
       s.email_delivered_at as delivery_email_delivered_at,
       s.push_delivered_at as delivery_push_delivered_at,
       s.delivered_at as delivery_delivered_at,
       s.delivery_mode,
       s.delivery_age_seconds,
       s.delivery_display_state
from public.ph_active_request_live_rows r
left join public.ph_request_delivery_status s
  on s.request_id = r.unique_id and s.event_type = 'request_completed'
where nullif(btrim(coalesce(r.date_completed, '')), '') is null
   or s.delivery_status in ('pending', 'processing', 'failed');

revoke all on table public.ph_request_queue_live_rows from public, anon;
grant select on table public.ph_request_queue_live_rows to authenticated, service_role;

drop function if exists public.get_request_delivery_recovery_queue();
create function public.get_request_delivery_recovery_queue()
returns table (
  event_id uuid,
  event_type text,
  request_id text,
  request_folder text,
  status text,
  attempt_count integer,
  next_attempt_at timestamptz,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  lease_expires_at timestamptz,
  sanitized_error_code text,
  email_delivered_at timestamptz,
  push_delivered_at timestamptz,
  delivery_mode text,
  created_at timestamptz,
  pending_age_seconds bigint,
  history_snapshot jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_requests() then
    raise exception using errcode = '42501', message = 'REQUEST_RECOVERY_FORBIDDEN';
  end if;
  return query
  select o.event_id, o.event_type, o.request_id, o.request_folder,
         o.status, o.attempt_count, o.next_attempt_at, o.first_attempt_at,
         o.last_attempt_at, o.lease_expires_at, o.sanitized_error_code,
         o.email_delivered_at, o.push_delivered_at, o.delivery_mode,
         o.created_at, extract(epoch from (now() - o.created_at))::bigint,
         h.snapshot
  from public.ph_request_delivery_outbox o
  left join public.ph_request_history h on h.unique_id = o.request_id
  where o.status in ('unknown', 'failed')
     or (o.status = 'pending' and o.next_attempt_at <= now() - interval '2 minutes')
     or (o.status = 'processing' and coalesce(o.lease_expires_at, o.last_attempt_at) <= now())
  order by o.created_at desc;
end;
$$;

revoke all on function public.get_request_delivery_recovery_queue()
  from public, anon;
grant execute on function public.get_request_delivery_recovery_queue()
  to authenticated;

create or replace function public.requeue_request_delivery(delivery_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare updated_event public.ph_request_delivery_outbox%rowtype;
begin
  if not private.can_manage_requests() then
    raise exception using errcode = '42501', message = 'REQUEST_RECOVERY_FORBIDDEN';
  end if;
  update public.ph_request_delivery_outbox
  set status = 'pending', next_attempt_at = now(), sanitized_error_code = null,
      lease_token = null, lease_owner = null, lease_expires_at = null
  where event_id = delivery_event_id
    and (
      status in ('unknown', 'failed')
      or (status = 'pending' and next_attempt_at <= now())
      or (status = 'processing' and coalesce(lease_expires_at, last_attempt_at) <= now())
    )
  returning * into updated_event;
  if not found then
    raise exception using errcode = 'P0002', message = 'DELIVERY_EVENT_NOT_RECOVERABLE';
  end if;
  return to_jsonb(updated_event) - 'payload' - 'channel_results';
end;
$$;

revoke all on function public.requeue_request_delivery(uuid) from public, anon;
grant execute on function public.requeue_request_delivery(uuid) to authenticated;

-- Server authority stamps the authenticated completing profile. Client-provided
-- completion identity fields are deliberately ignored.
create or replace function public.save_request_work(
  request_id text,
  expected_version bigint,
  patch jsonb,
  complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.ph_active_request%rowtype;
  profile public.profiles%rowtype;
  profile_email text;
  canonical jsonb;
  safe_patch jsonb;
begin
  if not private.can_save_request_work() then
    raise exception using errcode = '42501', message = 'REQUEST_SAVE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(request_id, '')), '') is null or expected_version is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_AND_VERSION_REQUIRED';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PATCH_INVALID';
  end if;

  select * into existing from public.ph_active_request where unique_id = request_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;
  if lower(coalesce(existing.req_status, '')) in ('complete', 'completed')
     or nullif(btrim(coalesce(existing.date_completed, '')), '') is not null then
    canonical := coalesce(private.canonical_request_json(request_id), to_jsonb(existing));
    return jsonb_build_object(
      'row', canonical, 'row_version', existing.row_version,
      'delivery_state', coalesce((
        select o.status from public.ph_request_delivery_outbox o
        where o.request_id = existing.unique_id and o.event_type = 'request_completed'
        order by o.created_at desc limit 1
      ), 'already_completed'),
      'acknowledged', true
    );
  end if;
  if existing.row_version <> expected_version then
    raise exception using errcode = '40001', message = 'REQUEST_VERSION_CONFLICT',
      detail = jsonb_build_object('current_version', existing.row_version)::text;
  end if;

  safe_patch := patch - 'completed_by_username' - 'completed_by_display' - 'completed_by_email';
  if complete then
    profile := private.current_active_profile();
    if profile.id is null then
      raise exception using errcode = '42501', message = 'REQUEST_COMPLETER_PROFILE_REQUIRED';
    end if;
    select u.email into profile_email from auth.users u where u.id = profile.id;
    safe_patch := safe_patch || jsonb_build_object(
      'completed_by_username', profile.username,
      'completed_by_display', coalesce(nullif(profile.display_name, ''), profile.username),
      'completed_by_email', coalesce(profile_email, '')
    );
  end if;

  return public.save_request_work_v1(request_id, expected_version, safe_patch, complete);
end;
$$;

revoke all on function public.save_request_work(text, bigint, jsonb, boolean)
  from public, anon;
grant execute on function public.save_request_work(text, bigint, jsonb, boolean)
  to authenticated;

create or replace function private.guard_direct_request_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role')
     and (
       (
         lower(coalesce(new.req_status, '')) in ('complete', 'completed')
         and lower(coalesce(old.req_status, '')) not in ('complete', 'completed')
       )
       or (
         nullif(btrim(coalesce(new.date_completed, '')), '') is not null
         and nullif(btrim(coalesce(old.date_completed, '')), '') is null
       )
       or new.completed_by_username is distinct from old.completed_by_username
       or new.completed_by_display is distinct from old.completed_by_display
       or new.completed_by_email is distinct from old.completed_by_email
     ) then
    raise exception using errcode = '42501', message = 'REQUEST_COMPLETION_RPC_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists ph_active_request_completion_rpc_guard on public.ph_active_request;
create trigger ph_active_request_completion_rpc_guard
before update of req_status, date_completed, completed_by_username, completed_by_display, completed_by_email
on public.ph_active_request
for each row execute function private.guard_direct_request_completion();

-- Asynchronous wake-up. Deployment stores the URL and cron secret in Vault;
-- missing secrets cause a safe no-op and never roll back request commits.
create or replace function private.wake_request_delivery_worker_now(p_source text default 'database')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into worker_url
  from vault.decrypted_secrets where name = 'request_delivery_worker_url' limit 1;
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets where name = 'request_delivery_cron_secret' limit 1;
  if nullif(worker_url, '') is null or nullif(cron_secret, '') is null then
    return null;
  end if;
  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-delivery-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', left(coalesce(p_source, 'database'), 40)),
    timeout_milliseconds := 15000
  ) into request_id;
  return request_id;
exception when others then
  return null;
end;
$$;

revoke all on function private.wake_request_delivery_worker_now(text)
  from public, anon, authenticated;
grant execute on function private.wake_request_delivery_worker_now(text) to service_role;

create or replace function private.wake_request_delivery_worker_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.wake_request_delivery_worker_now('outbox_insert');
  return null;
end;
$$;

drop trigger if exists ph_request_delivery_outbox_wake on public.ph_request_delivery_outbox;
create trigger ph_request_delivery_outbox_wake
after insert on public.ph_request_delivery_outbox
for each statement execute function private.wake_request_delivery_worker_after_insert();

create or replace function private.wake_request_delivery_worker_after_requeue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.wake_request_delivery_worker_now('manual_requeue');
  return null;
end;
$$;

drop trigger if exists ph_request_delivery_outbox_requeue_wake on public.ph_request_delivery_outbox;
create trigger ph_request_delivery_outbox_requeue_wake
after update of status, next_attempt_at on public.ph_request_delivery_outbox
for each row
when (new.status = 'pending' and new.next_attempt_at <= now())
execute function private.wake_request_delivery_worker_after_requeue();

do $$
declare existing_job bigint;
begin
  -- Local/isolated Supabase stacks may not install pg_cron. The worker still
  -- wakes immediately through pg_net, while hosted production keeps the
  -- one-minute cron fallback below.
  if to_regclass('cron.job') is null then
    return;
  end if;

  for existing_job in
    select jobid from cron.job where jobname = 'gnc-request-delivery-worker'
  loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'gnc-request-delivery-worker',
    '* * * * *',
    $cron$select private.wake_request_delivery_worker_now('cron')$cron$
  );
end
$$;

create or replace function private.record_request_health_audit()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing_history integer;
  missing_drive integer;
  exhausted_delivery integer;
  stalled_delivery integer;
  expired_leases integer;
  missing_threads integer;
  worker_stale integer;
  canary_stale integer;
  unassigned integer;
  active_codes integer;
  oldest_pending_seconds bigint;
  health_code text;
  health_severity text;
begin
  select count(*) into missing_history
  from public.ph_active_request r
  where (lower(coalesce(r.req_status, '')) in ('complete', 'completed')
         or nullif(btrim(coalesce(r.date_completed, '')), '') is not null)
    and not exists (select 1 from public.ph_request_history h where h.unique_id = r.unique_id);

  select count(*) into missing_drive
  from public.ph_active_request r
  where coalesce(r.req_archived, false) = false
    and lower(coalesce(r.req_status, 'pending')) not in ('complete', 'completed')
    and not exists (select 1 from public.ph_master_inventory m where m.unique_id = r.master_id);

  select count(*) into exhausted_delivery
  from public.ph_request_delivery_outbox where status = 'failed' and attempt_count >= 8;
  select count(*), coalesce(max(extract(epoch from (now() - created_at)))::bigint, 0)
    into stalled_delivery, oldest_pending_seconds
  from public.ph_request_delivery_outbox
  where status = 'pending' and next_attempt_at <= now() - interval '2 minutes';
  select count(*) into expired_leases
  from public.ph_request_delivery_outbox
  where status = 'processing' and coalesce(lease_expires_at, last_attempt_at) <= now();
  select count(*) into missing_threads
  from public.ph_request_delivery_outbox o
  where o.event_type = 'request_created' and o.status = 'delivered'
    and o.created_at >= now() - interval '24 hours'
    and not exists (
      select 1 from public.ph_request_email_threads t
      where t.request_folder = o.request_folder
        and nullif(btrim(coalesce(t.initial_thread_id, '')), '') is not null
    );
  select case when exists (
    select 1 from public.ph_request_delivery_worker_state
    where last_heartbeat_at >= now() - interval '3 minutes'
  ) then 0 else 1 end into worker_stale;
  select case when exists (
    select 1 from public.ph_request_delivery_outbox
    where event_type = 'delivery_canary' and status = 'delivered'
      and delivered_at >= now() - interval '10 minutes'
  ) then 0 else 1 end into canary_stale;
  select count(*) into unassigned from public.ph_warehouse_assigned_items
    where present_in_drive and nullif(btrim(coalesce(assignedto, '')), '') is null;
  select count(*) into active_codes from public.ph_warehouse_assigned_items where present_in_drive;

  health_code := case
    when stalled_delivery > 0 or worker_stale > 0 or canary_stale > 0 then 'DELIVERY_WORKER_STALLED'
    when expired_leases > 0 then 'DELIVERY_LEASE_EXPIRED'
    when exhausted_delivery > 0 then 'DELIVERY_RETRY_EXHAUSTED'
    when missing_threads > 0 then 'DELIVERY_THREAD_MISSING'
    when missing_history > 0 then 'MISSING_HISTORY'
    when missing_drive > 0 then 'DRIVE_ROW_MISSING'
    when unassigned > 0 then 'EVAL_ASSIGNMENT_GAP'
    else 'HEALTHY' end;
  health_severity := case
    when stalled_delivery > 0 or worker_stale > 0 or canary_stale > 0
      or expired_leases > 0 or exhausted_delivery > 0 or missing_history > 0 then 'error'
    when missing_threads > 0 or missing_drive > 0 or unassigned > 0 then 'warning'
    else 'info' end;

  insert into public.ph_app_health_events (
    event_name, area, severity, sanitized_code, sample_rate, metadata
  ) values (
    'scheduled_request_health_audit', 'request_integrity', health_severity,
    health_code, 1,
    jsonb_build_object(
      'missing_history_count', missing_history,
      'missing_drive_row_count', missing_drive,
      'delivery_retry_exhausted_count', exhausted_delivery,
      'delivery_stalled_count', stalled_delivery,
      'delivery_expired_lease_count', expired_leases,
      'delivery_missing_thread_count', missing_threads,
      'delivery_worker_stale_count', worker_stale,
      'delivery_canary_stale_count', canary_stale,
      'oldest_pending_seconds', oldest_pending_seconds,
      'unassigned_itemcode_count', unassigned,
      'drive_itemcode_count', active_codes
    )
  );

  return jsonb_build_object(
    'health_code', health_code,
    'missing_history_count', missing_history,
    'missing_drive_row_count', missing_drive,
    'delivery_retry_exhausted_count', exhausted_delivery,
    'delivery_stalled_count', stalled_delivery,
    'delivery_expired_lease_count', expired_leases,
    'delivery_missing_thread_count', missing_threads,
    'delivery_worker_stale_count', worker_stale,
    'delivery_canary_stale_count', canary_stale,
    'oldest_pending_seconds', oldest_pending_seconds,
    'unassigned_itemcode_count', unassigned,
    'drive_itemcode_count', active_codes
  );
end;
$$;

comment on function public.claim_request_delivery_events(integer, text) is
  'Service-only SKIP LOCKED lease claim for independent request delivery workers.';
comment on view public.ph_request_queue_live_rows is
  'Canonical pending request rows plus completed rows whose delivery is sending or needs attention.';
