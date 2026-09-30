begin;

-- Mobile Codex Operations V1. Both rollout flags are deliberately seeded off.
-- This migration creates a private control plane; it does not grant Codex or
-- authenticated clients direct access to repository, policy, or evidence data.

create table if not exists private.codex_ops_tasks (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_by_username text not null check (created_by_username = lower(btrim(created_by_username))),
  client_idempotency_key uuid not null,
  status text not null default 'queued' check (status in (
    'queued', 'diagnosing', 'needs_input', 'fixing', 'testing',
    'ready_for_approval', 'deploying', 'live', 'blocked', 'failed',
    'reverted', 'cancelled', 'needs_escalation'
  )),
  revision integer not null default 1 check (revision > 0),
  title text not null default '',
  description text not null check (char_length(description) between 4 and 12000),
  incident_fingerprint text,
  risk_level text check (risk_level is null or risk_level in ('low', 'medium', 'high', 'complex')),
  sanitized_diagnosis jsonb not null default '{}'::jsonb,
  sanitized_repair_summary jsonb not null default '{}'::jsonb,
  changed_files text[] not null default '{}'::text[],
  test_summary jsonb not null default '[]'::jsonb,
  branch_name text,
  pull_request_number bigint,
  pull_request_url text,
  head_sha text check (head_sha is null or head_sha ~ '^[0-9a-f]{40}$'),
  approved_sha text check (approved_sha is null or approved_sha ~ '^[0-9a-f]{40}$'),
  merged_sha text check (merged_sha is null or merged_sha ~ '^[0-9a-f]{40}$'),
  path_policy_passed boolean not null default false,
  required_checks_passed boolean not null default false,
  repair_attempts integer not null default 0 check (repair_attempts between 0 and 2),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz,
  unique (created_by, client_idempotency_key),
  constraint codex_ops_task_json_bounds check (
    octet_length(sanitized_diagnosis::text) <= 32768
    and octet_length(sanitized_repair_summary::text) <= 32768
    and octet_length(test_summary::text) <= 32768
  ),
  constraint codex_ops_task_path_bounds check (cardinality(changed_files) <= 200)
);

create index if not exists codex_ops_tasks_created_idx
  on private.codex_ops_tasks (created_at desc, id desc);
create index if not exists codex_ops_tasks_status_idx
  on private.codex_ops_tasks (status, updated_at);
create unique index if not exists codex_ops_one_processing_task_idx
  on private.codex_ops_tasks ((true))
  where status in ('diagnosing', 'fixing', 'testing', 'deploying');

create table if not exists private.codex_ops_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references private.codex_ops_tasks(id) on delete restrict,
  sequence bigint generated always as identity,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_username text,
  model text,
  body text not null check (char_length(body) between 1 and 12000),
  sanitized boolean not null default true,
  client_idempotency_key uuid,
  created_at timestamptz not null default now(),
  unique (task_id, sequence)
);

create index if not exists codex_ops_messages_task_idx
  on private.codex_ops_messages (task_id, sequence);
create unique index if not exists codex_ops_messages_idempotency_idx
  on private.codex_ops_messages (task_id, client_idempotency_key)
  where client_idempotency_key is not null;

create table if not exists private.codex_ops_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references private.codex_ops_tasks(id) on delete restrict,
  revision integer not null check (revision > 0),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  sanitized_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint codex_ops_event_payload_bound check (octet_length(sanitized_payload::text) <= 32768)
);

create index if not exists codex_ops_events_task_idx
  on private.codex_ops_events (task_id, id);

create table if not exists private.codex_ops_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references private.codex_ops_tasks(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  client_idempotency_key uuid not null,
  media_kind text not null check (media_kind in ('image', 'video')),
  original_name text not null check (char_length(original_name) between 1 and 240),
  declared_mime text not null,
  detected_mime text,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 157286400),
  object_path text not null unique,
  object_etag text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'deleted')),
  rejection_code text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz,
  unique (task_id, client_idempotency_key),
  constraint codex_ops_attachment_path check (
    object_path ~ ('^tasks/' || task_id::text || '/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,180}$')
  )
);

create index if not exists codex_ops_attachments_expiry_idx
  on private.codex_ops_attachments (expires_at)
  where status = 'verified' and expires_at is not null;

create table if not exists private.codex_ops_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references private.codex_ops_tasks(id) on delete restrict,
  task_revision integer not null check (task_revision > 0),
  head_sha text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_by_username text not null check (approved_by_username = 'dylan_collyge'),
  client_idempotency_key uuid not null,
  rollback_authorized boolean not null default true,
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  unique (task_id, task_revision, head_sha),
  unique (approved_by, client_idempotency_key)
);

create table if not exists private.codex_ops_dispatches (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references private.codex_ops_tasks(id) on delete restrict,
  task_revision integer not null check (task_revision > 0),
  action text not null check (action in ('diagnose', 'repair', 'sol_review', 'publish', 'verify', 'rollback', 'cleanup')),
  status text not null default 'queued' check (status in ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled')),
  client_idempotency_key uuid not null,
  github_run_id bigint,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (task_id, client_idempotency_key)
);

create index if not exists codex_ops_dispatches_task_idx
  on private.codex_ops_dispatches (task_id, created_at desc);

create table if not exists private.codex_ops_audit_events (
  id bigint generated always as identity primary key,
  task_id uuid references private.codex_ops_tasks(id) on delete restrict,
  actor_type text not null check (actor_type in ('user', 'runner', 'publisher', 'github_app', 'system')),
  actor_key text not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,99}$'),
  outcome text not null check (outcome in ('allowed', 'denied', 'succeeded', 'failed')),
  sanitized_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint codex_ops_audit_payload_bound check (octet_length(sanitized_metadata::text) <= 16384)
);

create index if not exists codex_ops_audit_task_idx
  on private.codex_ops_audit_events (task_id, id);

alter table private.codex_ops_tasks enable row level security;
alter table private.codex_ops_messages enable row level security;
alter table private.codex_ops_events enable row level security;
alter table private.codex_ops_attachments enable row level security;
alter table private.codex_ops_approvals enable row level security;
alter table private.codex_ops_dispatches enable row level security;
alter table private.codex_ops_audit_events enable row level security;

revoke all on table private.codex_ops_tasks from public, anon, authenticated;
revoke all on table private.codex_ops_messages from public, anon, authenticated;
revoke all on table private.codex_ops_events from public, anon, authenticated;
revoke all on table private.codex_ops_attachments from public, anon, authenticated;
revoke all on table private.codex_ops_approvals from public, anon, authenticated;
revoke all on table private.codex_ops_dispatches from public, anon, authenticated;
revoke all on table private.codex_ops_audit_events from public, anon, authenticated;
grant all on table private.codex_ops_tasks to service_role;
grant all on table private.codex_ops_messages to service_role;
grant all on table private.codex_ops_events to service_role;
grant all on table private.codex_ops_attachments to service_role;
grant all on table private.codex_ops_approvals to service_role;
grant all on table private.codex_ops_dispatches to service_role;
grant all on table private.codex_ops_audit_events to service_role;
grant usage, select on all sequences in schema private to service_role;

create or replace function private.reject_codex_ops_delete_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'CODEX_OPS_APPEND_ONLY';
end;
$$;

create or replace function private.reject_codex_ops_immutable_update_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'CODEX_OPS_EVENT_IMMUTABLE';
end;
$$;

drop trigger if exists codex_ops_tasks_no_delete on private.codex_ops_tasks;
create trigger codex_ops_tasks_no_delete before delete on private.codex_ops_tasks
for each row execute function private.reject_codex_ops_delete_v1();
drop trigger if exists codex_ops_messages_immutable on private.codex_ops_messages;
create trigger codex_ops_messages_immutable before update or delete on private.codex_ops_messages
for each row execute function private.reject_codex_ops_immutable_update_v1();
drop trigger if exists codex_ops_events_immutable on private.codex_ops_events;
create trigger codex_ops_events_immutable before update or delete on private.codex_ops_events
for each row execute function private.reject_codex_ops_immutable_update_v1();
drop trigger if exists codex_ops_approvals_immutable on private.codex_ops_approvals;
create trigger codex_ops_approvals_immutable before update or delete on private.codex_ops_approvals
for each row execute function private.reject_codex_ops_immutable_update_v1();
drop trigger if exists codex_ops_audit_immutable on private.codex_ops_audit_events;
create trigger codex_ops_audit_immutable before update or delete on private.codex_ops_audit_events
for each row execute function private.reject_codex_ops_immutable_update_v1();
drop trigger if exists codex_ops_dispatches_no_delete on private.codex_ops_dispatches;
create trigger codex_ops_dispatches_no_delete before delete on private.codex_ops_dispatches
for each row execute function private.reject_codex_ops_delete_v1();
drop trigger if exists codex_ops_attachments_no_delete on private.codex_ops_attachments;
create trigger codex_ops_attachments_no_delete before delete on private.codex_ops_attachments
for each row execute function private.reject_codex_ops_delete_v1();

create or replace function private.require_codex_ops_dylan_v1()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'CODEX_OPS_AUTH_REQUIRED';
  end if;
  select p.* into profile
  from public.profiles p
  where p.id = auth.uid()
    and lower(btrim(p.username)) = 'dylan_collyge'
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now());
  if profile.id is null then
    raise exception using errcode = '42501', message = 'CODEX_OPS_DYLAN_ONLY';
  end if;
  return profile;
end;
$$;

create or replace function private.codex_ops_flag_enabled_v1(p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select f.enabled and f.rollout_percent = 100
    from public.ph_runtime_feature_flags f
    where f.flag_key = p_flag
  ), false)
$$;

insert into public.ph_runtime_feature_flags (flag_key, enabled, rollout_percent, config)
values
  ('codex_ops_enabled', false, 0, '{"contract":"mobile-codex-ops-v1","mode":"disabled"}'::jsonb),
  ('codex_ops_deploy_enabled', false, 0, '{"contract":"mobile-codex-ops-v1","mode":"disabled"}'::jsonb)
on conflict (flag_key) do nothing;

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order)
values
  ('module.codex_ops.view', 'module', 'codex_ops', 'Codex Operations', 'View Dylan-only mobile Codex operations.', '{}'::text[], 980),
  ('codex_ops.submit', 'action', 'codex_ops', 'Submit Codex work', 'Submit and converse on guarded Codex tasks.', '{}'::text[], 981),
  ('codex_ops.approve', 'action', 'codex_ops', 'Approve exact commit', 'Approve one reviewed task revision and exact PR head SHA.', '{}'::text[], 982)
on conflict (permission_key) do update set
  label = excluded.label,
  description = excluded.description,
  active = true;

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('client.managers.codex_ops.view', 'module.codex_ops.view', 'client', 'Audit-only catalog entry; Dylan-only server helper is authoritative in V1.'),
  ('edge.codex_ops.submit', 'codex_ops.submit', 'edge', 'Native Auth and active Dylan profile required.'),
  ('edge.codex_ops.approve', 'codex_ops.approve', 'edge', 'Exact revision and SHA approval enforced by server and GitHub App.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  notes = excluded.notes;

create or replace function public.get_codex_ops_capabilities_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  submission_enabled boolean;
  deployment_enabled boolean;
begin
  profile := private.require_codex_ops_dylan_v1();
  submission_enabled := private.codex_ops_flag_enabled_v1('codex_ops_enabled');
  deployment_enabled := private.codex_ops_flag_enabled_v1('codex_ops_deploy_enabled');
  return jsonb_build_object(
    'contractVersion', 'mobile-codex-ops-v1',
    'canView', true,
    'canSubmit', submission_enabled,
    'canApprove', deployment_enabled,
    'submissionEnabled', submission_enabled,
    'deploymentEnabled', deployment_enabled,
    'maxImages', 10,
    'maxVideos', 2,
    'maxImageBytes', 15728640,
    'maxVideoBytes', 157286400,
    'oneActiveTask', true
  );
end;
$$;

create or replace function public.list_codex_ops_tasks_v1(
  p_before timestamptz default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  bounded_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  profile := private.require_codex_ops_dylan_v1();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'status', t.status,
      'revision', t.revision,
      'title', t.title,
      'description', t.description,
      'risk', t.risk_level,
      'fingerprint', t.incident_fingerprint,
      'changedFiles', t.changed_files,
      'tests', t.test_summary,
      'branch', t.branch_name,
      'pullRequestNumber', t.pull_request_number,
      'pullRequestUrl', t.pull_request_url,
      'headSha', t.head_sha,
      'pathPolicyPassed', t.path_policy_passed,
      'requiredChecksPassed', t.required_checks_passed,
      'repairAttempts', t.repair_attempts,
      'createdAt', t.created_at,
      'updatedAt', t.updated_at,
      'terminalAt', t.terminal_at
    ) order by t.created_at desc, t.id desc)
    from (
      select task.*
      from private.codex_ops_tasks task
      where task.created_by = profile.id
        and (p_before is null or task.created_at < p_before)
      order by task.created_at desc, task.id desc
      limit bounded_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_codex_ops_task_v1(
  p_task_id uuid,
  p_after_event_id bigint default 0,
  p_event_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  task private.codex_ops_tasks%rowtype;
  bounded_limit integer := least(greatest(coalesce(p_event_limit, 100), 1), 250);
begin
  profile := private.require_codex_ops_dylan_v1();
  select * into task from private.codex_ops_tasks t
  where t.id = p_task_id and t.created_by = profile.id;
  if task.id is null then
    raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', task.id, 'status', task.status, 'revision', task.revision,
      'title', task.title, 'description', task.description,
      'diagnosis', task.sanitized_diagnosis,
      'repairSummary', task.sanitized_repair_summary,
      'risk', task.risk_level, 'fingerprint', task.incident_fingerprint,
      'changedFiles', task.changed_files, 'tests', task.test_summary,
      'branch', task.branch_name, 'pullRequestNumber', task.pull_request_number,
      'pullRequestUrl', task.pull_request_url, 'headSha', task.head_sha,
      'pathPolicyPassed', task.path_policy_passed,
      'requiredChecksPassed', task.required_checks_passed,
      'repairAttempts', task.repair_attempts,
      'lastErrorCode', task.last_error_code,
      'createdAt', task.created_at, 'updatedAt', task.updated_at,
      'terminalAt', task.terminal_at
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'sequence', m.sequence, 'actorType', m.actor_type,
        'actorUsername', m.actor_username, 'model', m.model,
        'body', m.body, 'createdAt', m.created_at
      ) order by m.sequence)
      from private.codex_ops_messages m where m.task_id = task.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'revision', e.revision, 'type', e.event_type,
        'payload', e.sanitized_payload, 'createdAt', e.created_at
      ) order by e.id)
      from (
        select event.* from private.codex_ops_events event
        where event.task_id = task.id and event.id > coalesce(p_after_event_id, 0)
        order by event.id limit bounded_limit
      ) e
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'mediaKind', a.media_kind, 'name', a.original_name,
        'mime', coalesce(a.detected_mime, a.declared_mime),
        'sizeBytes', a.size_bytes, 'status', a.status, 'createdAt', a.created_at
      ) order by a.created_at)
      from private.codex_ops_attachments a
      where a.task_id = task.id and a.status <> 'deleted'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_codex_ops_task_v1(
  p_description text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  task private.codex_ops_tasks%rowtype;
  clean_description text := btrim(coalesce(p_description, ''));
begin
  profile := private.require_codex_ops_dylan_v1();
  if not private.codex_ops_flag_enabled_v1('codex_ops_enabled') then
    raise exception using errcode = '42501', message = 'CODEX_OPS_SUBMISSION_DISABLED';
  end if;
  if char_length(clean_description) not between 4 and 12000 then
    raise exception using errcode = '22023', message = 'CODEX_OPS_DESCRIPTION_INVALID';
  end if;
  select * into task from private.codex_ops_tasks t
  where t.created_by = profile.id and t.client_idempotency_key = p_idempotency_key;
  if task.id is null then
    insert into private.codex_ops_tasks (
      created_by, created_by_username, client_idempotency_key,
      title, description
    ) values (
      profile.id, 'dylan_collyge', p_idempotency_key,
      left(regexp_replace(clean_description, E'[\\n\\r]+', ' ', 'g'), 120),
      clean_description
    ) returning * into task;
    insert into private.codex_ops_messages (
      task_id, actor_type, actor_username, body, client_idempotency_key
    ) values (task.id, 'user', 'dylan_collyge', clean_description, p_idempotency_key);
    insert into private.codex_ops_events (task_id, revision, event_type, sanitized_payload)
    values (task.id, task.revision, 'task.created', jsonb_build_object('status', task.status));
    insert into private.codex_ops_audit_events (task_id, actor_type, actor_key, action, outcome)
    values (task.id, 'user', 'dylan_collyge', 'task.create', 'succeeded');
  end if;
  return jsonb_build_object('id', task.id, 'status', task.status, 'revision', task.revision);
end;
$$;

create or replace function public.add_codex_ops_message_v1(
  p_task_id uuid,
  p_expected_revision integer,
  p_body text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  task private.codex_ops_tasks%rowtype;
  message private.codex_ops_messages%rowtype;
  clean_body text := btrim(coalesce(p_body, ''));
begin
  profile := private.require_codex_ops_dylan_v1();
  if not private.codex_ops_flag_enabled_v1('codex_ops_enabled') then
    raise exception using errcode = '42501', message = 'CODEX_OPS_SUBMISSION_DISABLED';
  end if;
  if char_length(clean_body) not between 1 and 12000 then
    raise exception using errcode = '22023', message = 'CODEX_OPS_MESSAGE_INVALID';
  end if;
  select * into task from private.codex_ops_tasks t where t.id = p_task_id and t.created_by = profile.id for update;
  if task.id is null then raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND'; end if;
  select * into message from private.codex_ops_messages m
  where m.task_id = task.id and m.client_idempotency_key = p_idempotency_key;
  if message.id is not null then
    return jsonb_build_object('id', message.id, 'taskId', task.id, 'revision', task.revision, 'recovered', true);
  end if;
  if task.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'CODEX_OPS_REVISION_CONFLICT';
  end if;
  if task.status in ('diagnosing', 'fixing', 'testing', 'deploying', 'live', 'reverted', 'cancelled') then
    raise exception using errcode = '55000', message = 'CODEX_OPS_TASK_BUSY_OR_TERMINAL';
  end if;
  insert into private.codex_ops_messages (task_id, actor_type, actor_username, body, client_idempotency_key)
  values (task.id, 'user', 'dylan_collyge', clean_body, p_idempotency_key)
  returning * into message;
  update private.codex_ops_tasks
  set revision = revision + 1,
      status = case when status in ('needs_input', 'blocked', 'failed', 'needs_escalation', 'ready_for_approval') then 'queued' else status end,
      approved_sha = null,
      branch_name = case when status = 'ready_for_approval' then null else branch_name end,
      pull_request_number = case when status = 'ready_for_approval' then null else pull_request_number end,
      pull_request_url = case when status = 'ready_for_approval' then null else pull_request_url end,
      head_sha = case when status = 'ready_for_approval' then null else head_sha end,
      path_policy_passed = case when status = 'ready_for_approval' then false else path_policy_passed end,
      required_checks_passed = case when status = 'ready_for_approval' then false else required_checks_passed end,
      terminal_at = null,
      updated_at = now()
  where id = task.id returning * into task;
  insert into private.codex_ops_events (task_id, revision, event_type, sanitized_payload)
  values (task.id, task.revision, 'message.added', '{}'::jsonb);
  return jsonb_build_object('id', message.id, 'taskId', task.id, 'revision', task.revision, 'recovered', false);
end;
$$;

create or replace function public.cancel_codex_ops_task_v1(
  p_task_id uuid,
  p_expected_revision integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  task private.codex_ops_tasks%rowtype;
begin
  profile := private.require_codex_ops_dylan_v1();
  select * into task from private.codex_ops_tasks t where t.id = p_task_id and t.created_by = profile.id for update;
  if task.id is null then raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND'; end if;
  if task.status = 'cancelled' then return jsonb_build_object('id', task.id, 'status', task.status, 'revision', task.revision); end if;
  if task.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'CODEX_OPS_REVISION_CONFLICT'; end if;
  if task.status in ('deploying', 'live', 'reverted') then raise exception using errcode = '55000', message = 'CODEX_OPS_TASK_TERMINAL'; end if;
  update private.codex_ops_tasks set
    status = 'cancelled', revision = revision + 1, approved_sha = null,
    updated_at = now(), terminal_at = now()
  where id = task.id returning * into task;
  update private.codex_ops_attachments set expires_at = now() + interval '30 days'
  where task_id = task.id and status = 'verified' and expires_at is null;
  insert into private.codex_ops_events (task_id, revision, event_type, sanitized_payload)
  values (task.id, task.revision, 'task.cancelled', jsonb_build_object('idempotencyKey', p_idempotency_key));
  return jsonb_build_object('id', task.id, 'status', task.status, 'revision', task.revision);
end;
$$;

create or replace function public.request_codex_ops_escalation_v1(
  p_task_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  task private.codex_ops_tasks%rowtype;
begin
  profile := private.require_codex_ops_dylan_v1();
  select * into task from private.codex_ops_tasks t where t.id = p_task_id and t.created_by = profile.id for update;
  if task.id is null then raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND'; end if;
  if task.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'CODEX_OPS_REVISION_CONFLICT'; end if;
  if task.status <> 'needs_escalation' then raise exception using errcode = '55000', message = 'CODEX_OPS_ESCALATION_NOT_AVAILABLE'; end if;
  insert into private.codex_ops_messages (task_id, actor_type, actor_username, body, client_idempotency_key)
  values (task.id, 'user', 'dylan_collyge', left(btrim(coalesce(p_reason, 'Request read-only Sol review.')), 12000), p_idempotency_key);
  update private.codex_ops_tasks set revision = revision + 1, status = 'queued', updated_at = now()
  where id = task.id returning * into task;
  insert into private.codex_ops_events (task_id, revision, event_type, sanitized_payload)
  values (task.id, task.revision, 'escalation.requested', jsonb_build_object('model', 'gpt-5.6-sol', 'mode', 'read-only'));
  return jsonb_build_object('id', task.id, 'status', task.status, 'revision', task.revision, 'action', 'sol_review');
end;
$$;

create or replace function public.approve_codex_ops_deployment_v1(
  p_task_id uuid,
  p_expected_revision integer,
  p_head_sha text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  task private.codex_ops_tasks%rowtype;
  approval private.codex_ops_approvals%rowtype;
  normalized_sha text := lower(btrim(coalesce(p_head_sha, '')));
begin
  profile := private.require_codex_ops_dylan_v1();
  if not private.codex_ops_flag_enabled_v1('codex_ops_deploy_enabled') then
    raise exception using errcode = '42501', message = 'CODEX_OPS_DEPLOYMENT_DISABLED';
  end if;
  if normalized_sha !~ '^[0-9a-f]{40}$' then raise exception using errcode = '22023', message = 'CODEX_OPS_SHA_INVALID'; end if;
  select * into task from private.codex_ops_tasks t where t.id = p_task_id and t.created_by = profile.id for update;
  if task.id is null then raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND'; end if;
  select * into approval from private.codex_ops_approvals a
  where a.approved_by = profile.id and a.client_idempotency_key = p_idempotency_key;
  if approval.id is not null then
    return jsonb_build_object('approvalId', approval.id, 'taskId', task.id, 'revision', approval.task_revision, 'headSha', approval.head_sha, 'recovered', true);
  end if;
  if task.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'CODEX_OPS_REVISION_CONFLICT'; end if;
  if task.status <> 'ready_for_approval' then raise exception using errcode = '55000', message = 'CODEX_OPS_NOT_READY'; end if;
  if task.head_sha is distinct from normalized_sha then raise exception using errcode = '40001', message = 'CODEX_OPS_HEAD_CHANGED'; end if;
  if not task.path_policy_passed or not task.required_checks_passed then raise exception using errcode = '55000', message = 'CODEX_OPS_CHECKS_INCOMPLETE'; end if;
  insert into private.codex_ops_approvals (
    task_id, task_revision, head_sha, approved_by, approved_by_username, client_idempotency_key
  ) values (task.id, task.revision, normalized_sha, profile.id, 'dylan_collyge', p_idempotency_key)
  returning * into approval;
  update private.codex_ops_tasks set approved_sha = normalized_sha, status = 'deploying', updated_at = now()
  where id = task.id;
  insert into private.codex_ops_events (task_id, revision, event_type, sanitized_payload)
  values (task.id, task.revision, 'deployment.approved', jsonb_build_object('headSha', normalized_sha));
  insert into private.codex_ops_audit_events (task_id, actor_type, actor_key, action, outcome, sanitized_metadata)
  values (task.id, 'user', 'dylan_collyge', 'deployment.approve', 'succeeded', jsonb_build_object('revision', task.revision, 'headSha', normalized_sha));
  return jsonb_build_object('approvalId', approval.id, 'taskId', task.id, 'revision', approval.task_revision, 'headSha', approval.head_sha, 'recovered', false);
end;
$$;

create or replace function public.get_codex_ops_runner_context_service_v1(
  p_task_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task private.codex_ops_tasks%rowtype;
begin
  select * into task from private.codex_ops_tasks t where t.id = p_task_id;
  if task.id is null then raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND'; end if;
  if task.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'CODEX_OPS_REVISION_CONFLICT'; end if;
  if task.status in ('cancelled', 'live', 'reverted') then raise exception using errcode = '55000', message = 'CODEX_OPS_TASK_TERMINAL'; end if;
  return jsonb_build_object(
    'contractVersion', 'mobile-codex-ops-v1',
    'taskId', task.id,
    'revision', task.revision,
    'status', task.status,
    'description', task.description,
    'risk', task.risk_level,
    'fingerprint', task.incident_fingerprint,
    'diagnosis', task.sanitized_diagnosis,
    'headSha', task.head_sha,
    'approvedSha', task.approved_sha,
    'mergedSha', task.merged_sha,
    'pullRequestNumber', task.pull_request_number,
    'rollbackAuthorized', exists (
      select 1 from private.codex_ops_approvals approval
      where approval.task_id = task.id
        and approval.task_revision = task.revision
        and approval.head_sha = task.approved_sha
        and approval.rollback_authorized
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence', m.sequence, 'actorType', m.actor_type,
        'body', m.body, 'model', m.model
      ) order by m.sequence)
      from private.codex_ops_messages m where m.task_id = task.id
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.media_kind, 'name', a.original_name,
        'mime', a.detected_mime, 'sizeBytes', a.size_bytes,
        'objectPath', a.object_path
      ) order by a.created_at)
      from private.codex_ops_attachments a
      where a.task_id = task.id and a.status = 'verified'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.apply_codex_ops_service_event_v1(
  p_task_id uuid,
  p_expected_revision integer,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task private.codex_ops_tasks%rowtype;
  attachment_id uuid;
  media_kind text;
  message_body text;
  next_status text;
  changed text[];
  new_revision integer;
  image_count integer;
  video_count integer;
  recent_repair_attempts integer;
begin
  select * into task from private.codex_ops_tasks t where t.id = p_task_id for update;
  if task.id is null then raise exception using errcode = 'P0002', message = 'CODEX_OPS_TASK_NOT_FOUND'; end if;
  if task.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'CODEX_OPS_REVISION_CONFLICT'; end if;
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 131072 then
    raise exception using errcode = '22023', message = 'CODEX_OPS_PAYLOAD_TOO_LARGE';
  end if;

  if p_action = 'attachment.register' then
    attachment_id := coalesce(nullif(p_payload->>'id', '')::uuid, gen_random_uuid());
    media_kind := lower(coalesce(p_payload->>'mediaKind', ''));
    if media_kind not in ('image', 'video') then raise exception using errcode = '22023', message = 'CODEX_OPS_MEDIA_INVALID'; end if;
    select count(*) filter (where a.media_kind = 'image'), count(*) filter (where a.media_kind = 'video')
    into image_count, video_count
    from private.codex_ops_attachments a where a.task_id = task.id and a.status <> 'deleted';
    if (media_kind = 'image' and image_count >= 10) or (media_kind = 'video' and video_count >= 2) then
      raise exception using errcode = '22023', message = 'CODEX_OPS_ATTACHMENT_LIMIT';
    end if;
    insert into private.codex_ops_attachments (
      id, task_id, uploaded_by, client_idempotency_key, media_kind,
      original_name, declared_mime, object_path
    ) values (
      attachment_id, task.id, task.created_by,
      (p_payload->>'idempotencyKey')::uuid, media_kind,
      left(coalesce(p_payload->>'name', 'evidence'), 240),
      left(coalesce(p_payload->>'declaredMime', 'application/octet-stream'), 120),
      p_payload->>'objectPath'
    ) on conflict (task_id, client_idempotency_key) do nothing;
    return jsonb_build_object('taskId', task.id, 'revision', task.revision, 'attachmentId', attachment_id);

  elsif p_action in ('attachment.verify', 'attachment.reject', 'attachment.delete') then
    attachment_id := (p_payload->>'attachmentId')::uuid;
    update private.codex_ops_attachments a set
      status = case p_action when 'attachment.verify' then 'verified' when 'attachment.reject' then 'rejected' else 'deleted' end,
      detected_mime = case when p_action = 'attachment.verify' then p_payload->>'detectedMime' else a.detected_mime end,
      size_bytes = case when p_action = 'attachment.verify' then (p_payload->>'sizeBytes')::bigint else a.size_bytes end,
      object_etag = case when p_action = 'attachment.verify' then left(coalesce(p_payload->>'etag', ''), 240) else a.object_etag end,
      rejection_code = case when p_action = 'attachment.reject' then left(coalesce(p_payload->>'rejectionCode', 'SIGNATURE_MISMATCH'), 120) else a.rejection_code end,
      verified_at = case when p_action = 'attachment.verify' then now() else a.verified_at end,
      deleted_at = case when p_action = 'attachment.delete' then now() else a.deleted_at end
    where a.id = attachment_id and a.task_id = task.id;
    if not found then raise exception using errcode = 'P0002', message = 'CODEX_OPS_ATTACHMENT_NOT_FOUND'; end if;
    return jsonb_build_object('taskId', task.id, 'revision', task.revision, 'attachmentId', attachment_id, 'action', p_action);

  elsif p_action = 'dispatch.queue' then
    if exists (select 1 from private.codex_ops_attachments a where a.task_id = task.id and a.status = 'pending') then
      raise exception using errcode = '55000', message = 'CODEX_OPS_ATTACHMENTS_PENDING';
    end if;
    insert into private.codex_ops_dispatches (
      task_id, task_revision, action, client_idempotency_key
    ) values (
      task.id, task.revision, p_payload->>'dispatchAction', (p_payload->>'idempotencyKey')::uuid
    ) on conflict (task_id, client_idempotency_key) do nothing;
    insert into private.codex_ops_events (task_id, revision, event_type, sanitized_payload)
    values (task.id, task.revision, 'dispatch.queued', jsonb_build_object('action', p_payload->>'dispatchAction'));
    return jsonb_build_object('taskId', task.id, 'revision', task.revision, 'status', task.status);

  elsif p_action = 'runner.claim' then
    if task.status = 'diagnosing' then
      return jsonb_build_object('taskId', task.id, 'revision', task.revision, 'status', task.status, 'recovered', true);
    end if;
    if task.status <> 'queued' then raise exception using errcode = '55000', message = 'CODEX_OPS_TASK_NOT_QUEUED'; end if;
    next_status := case when p_payload->>'dispatchAction' = 'sol_review' then 'diagnosing' else 'diagnosing' end;
    update private.codex_ops_tasks set status = next_status, updated_at = now() where id = task.id returning * into task;

  elsif p_action = 'diagnosis.result' then
    message_body := left(btrim(coalesce(p_payload->>'summary', 'Diagnosis completed.')), 12000);
    next_status := case
      when coalesce((p_payload->>'needsInput')::boolean, false) then 'needs_input'
      when coalesce((p_payload->>'escalationRequired')::boolean, false) then 'needs_escalation'
      when not coalesce((p_payload->>'reproduced')::boolean, false) then 'blocked'
      when not coalesce((p_payload->>'repairAllowed')::boolean, false) then 'needs_escalation'
      else 'fixing'
    end;
    update private.codex_ops_tasks set
      status = next_status,
      incident_fingerprint = left(nullif(p_payload->>'fingerprint', ''), 240),
      risk_level = case when p_payload->>'risk' in ('low', 'medium', 'high', 'complex') then p_payload->>'risk' else 'medium' end,
      sanitized_diagnosis = p_payload,
      updated_at = now(),
      terminal_at = case when next_status = 'blocked' then now() else null end
    where id = task.id returning * into task;
    insert into private.codex_ops_messages (task_id, actor_type, actor_username, model, body)
    values (task.id, 'agent', 'luna', 'gpt-5.6-luna', message_body);

  elsif p_action = 'repair.result' then
    if task.status <> 'fixing' then raise exception using errcode = '55000', message = 'CODEX_OPS_REPAIR_NOT_ALLOWED'; end if;
    if task.repair_attempts >= 2 then raise exception using errcode = '54000', message = 'CODEX_OPS_REPAIR_LIMIT'; end if;
    if task.incident_fingerprint is not null then
      select coalesce(sum(t.repair_attempts), 0)::integer
      into recent_repair_attempts
      from private.codex_ops_tasks t
      where t.incident_fingerprint = task.incident_fingerprint
        and t.updated_at >= now() - interval '60 minutes';
      if recent_repair_attempts >= 2 then
        raise exception using errcode = '54000', message = 'CODEX_OPS_FINGERPRINT_REPAIR_LIMIT';
      end if;
    end if;
    changed := coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'changedFiles', '[]'::jsonb))), '{}'::text[]);
    message_body := left(btrim(coalesce(p_payload->>'summary', 'Repair prepared.')), 12000);
    update private.codex_ops_tasks set
      status = 'testing', repair_attempts = repair_attempts + 1,
      sanitized_repair_summary = p_payload,
      changed_files = changed,
      updated_at = now()
    where id = task.id returning * into task;
    insert into private.codex_ops_messages (task_id, actor_type, actor_username, model, body)
    values (task.id, 'agent', 'terra', 'gpt-5.6-terra', message_body);

  elsif p_action = 'publish.result' then
    if not coalesce((p_payload->>'pathPolicyPassed')::boolean, false) then
      next_status := 'blocked';
    elsif not coalesce((p_payload->>'requiredChecksPassed')::boolean, false) then
      next_status := 'failed';
    else
      next_status := 'ready_for_approval';
    end if;
    new_revision := task.revision + 1;
    update private.codex_ops_tasks set
      revision = new_revision,
      status = next_status,
      branch_name = left(nullif(p_payload->>'branch', ''), 240),
      pull_request_number = nullif(p_payload->>'pullRequestNumber', '')::bigint,
      pull_request_url = left(nullif(p_payload->>'pullRequestUrl', ''), 1000),
      head_sha = lower(nullif(p_payload->>'headSha', '')),
      approved_sha = null,
      path_policy_passed = coalesce((p_payload->>'pathPolicyPassed')::boolean, false),
      required_checks_passed = coalesce((p_payload->>'requiredChecksPassed')::boolean, false),
      test_summary = coalesce(p_payload->'tests', '[]'::jsonb),
      last_error_code = nullif(p_payload->>'errorCode', ''),
      updated_at = now(),
      terminal_at = case when next_status in ('blocked', 'failed') then now() else null end
    where id = task.id returning * into task;

  elsif p_action = 'deployment.merged' then
    if task.status <> 'deploying' or task.approved_sha is null then
      raise exception using errcode = '55000', message = 'CODEX_OPS_DEPLOYMENT_NOT_APPROVED';
    end if;
    update private.codex_ops_tasks set
      merged_sha = lower(nullif(p_payload->>'mergedSha', '')),
      updated_at = now()
    where id = task.id returning * into task;

  elsif p_action in ('deployment.live', 'deployment.failed', 'deployment.reverted') then
    next_status := case p_action when 'deployment.live' then 'live' when 'deployment.reverted' then 'reverted' else 'failed' end;
    update private.codex_ops_tasks set
      status = next_status,
      merged_sha = case when p_action = 'deployment.live' then lower(nullif(p_payload->>'mergedSha', '')) else merged_sha end,
      last_error_code = nullif(p_payload->>'errorCode', ''),
      updated_at = now(), terminal_at = now()
    where id = task.id returning * into task;
    update private.codex_ops_attachments set expires_at = now() + interval '30 days'
    where task_id = task.id and status = 'verified' and expires_at is null;
  else
    raise exception using errcode = '22023', message = 'CODEX_OPS_SERVICE_ACTION_INVALID';
  end if;

  insert into private.codex_ops_events (task_id, revision, event_type, sanitized_payload)
  values (task.id, task.revision, p_action, jsonb_build_object('status', task.status));
  insert into private.codex_ops_audit_events (task_id, actor_type, actor_key, action, outcome)
  values (task.id, 'runner', 'github-oidc', p_action, 'succeeded');
  return jsonb_build_object('taskId', task.id, 'revision', task.revision, 'status', task.status, 'headSha', task.head_sha);
end;
$$;

create or replace function public.list_expired_codex_ops_evidence_service_v1(p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId', a.id, 'taskId', a.task_id, 'revision', t.revision, 'objectPath', a.object_path
  )), '[]'::jsonb)
  from (
    select attachment.* from private.codex_ops_attachments attachment
    where attachment.status = 'verified'
      and attachment.expires_at is not null
      and attachment.expires_at <= now()
    order by attachment.expires_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) a
  join private.codex_ops_tasks t on t.id = a.task_id
$$;

create or replace function public.get_codex_ops_health_snapshot_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract_version', 'mobile-codex-ops-v1',
    'submission_enabled', private.codex_ops_flag_enabled_v1('codex_ops_enabled'),
    'deployment_enabled', private.codex_ops_flag_enabled_v1('codex_ops_deploy_enabled'),
    'private_table_count', 7,
    'anonymous_table_access_denied', not exists (
      select 1 from (values
        ('private.codex_ops_tasks'), ('private.codex_ops_messages'),
        ('private.codex_ops_events'), ('private.codex_ops_attachments'),
        ('private.codex_ops_approvals'), ('private.codex_ops_dispatches'),
        ('private.codex_ops_audit_events')
      ) as tables(table_name)
      where has_table_privilege('anon', tables.table_name, 'select,insert,update,delete')
    ),
    'authenticated_table_access_denied', not exists (
      select 1 from (values
        ('private.codex_ops_tasks'), ('private.codex_ops_messages'),
        ('private.codex_ops_events'), ('private.codex_ops_attachments'),
        ('private.codex_ops_approvals'), ('private.codex_ops_dispatches'),
        ('private.codex_ops_audit_events')
      ) as tables(table_name)
      where has_table_privilege('authenticated', tables.table_name, 'select,insert,update,delete')
    ),
    'pending_attachment_count', (
      select count(*) from private.codex_ops_attachments where status = 'pending'
    ),
    'active_task_count', (
      select count(*) from private.codex_ops_tasks
      where status in ('diagnosing', 'fixing', 'testing', 'deploying')
    )
  )
$$;

revoke all on function public.get_codex_ops_capabilities_v1() from public, anon, authenticated;
revoke all on function public.list_codex_ops_tasks_v1(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.get_codex_ops_task_v1(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.create_codex_ops_task_v1(text, uuid) from public, anon, authenticated;
revoke all on function public.add_codex_ops_message_v1(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.cancel_codex_ops_task_v1(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.request_codex_ops_escalation_v1(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.approve_codex_ops_deployment_v1(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.get_codex_ops_runner_context_service_v1(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.apply_codex_ops_service_event_v1(uuid, integer, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.list_expired_codex_ops_evidence_service_v1(integer) from public, anon, authenticated, service_role;
revoke all on function public.get_codex_ops_health_snapshot_v1() from public, anon, authenticated, service_role;
grant execute on function public.get_codex_ops_capabilities_v1() to authenticated;
grant execute on function public.list_codex_ops_tasks_v1(timestamptz, integer) to authenticated;
grant execute on function public.get_codex_ops_task_v1(uuid, bigint, integer) to authenticated;
grant execute on function public.create_codex_ops_task_v1(text, uuid) to authenticated;
grant execute on function public.add_codex_ops_message_v1(uuid, integer, text, uuid) to authenticated;
grant execute on function public.cancel_codex_ops_task_v1(uuid, integer, uuid) to authenticated;
grant execute on function public.request_codex_ops_escalation_v1(uuid, integer, text, uuid) to authenticated;
grant execute on function public.approve_codex_ops_deployment_v1(uuid, integer, text, uuid) to authenticated;
grant execute on function public.get_codex_ops_runner_context_service_v1(uuid, integer) to service_role;
grant execute on function public.apply_codex_ops_service_event_v1(uuid, integer, text, jsonb) to service_role;
grant execute on function public.list_expired_codex_ops_evidence_service_v1(integer) to service_role;
grant execute on function public.get_codex_ops_health_snapshot_v1() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'codex-ops-evidence-v1',
  'codex-ops-evidence-v1',
  false,
  157286400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table private.codex_ops_tasks is 'Dylan-only mobile Codex task projection. No direct client access.';
comment on table private.codex_ops_messages is 'Append-only sanitized task conversation; raw runner logs are never stored.';
comment on table private.codex_ops_attachments is 'Private task-scoped evidence metadata; Storage access is signed and server mediated.';
comment on function public.approve_codex_ops_deployment_v1(uuid, integer, text, uuid) is
  'Binds Dylan approval to one task revision and exact PR head SHA; any task or head change invalidates it.';

commit;
