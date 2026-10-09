-- Canonical schema replay fixture only. The disposable workspace builder copies
-- this before known data-repair/backfill migrations; it is never an application
-- migration and contains synthetic local identities only.
begin;

do $workspace_guard$
begin
  if not exists (
    select 1 from private.ci_schema_workspace_guard
    where marker = 'canonical-baseline-replay'
  ) then
    raise exception 'CANONICAL_FIXTURE_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
  if exists (select 1 from public.profiles where id = '961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid
      or lower(btrim(username)) = 'nelly_aguilar')
    or exists (select 1 from auth.users where id = '961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid
      or lower(btrim(email)) = 'nelly.baseline.fixture@local.invalid')
    or exists (select 1 from public.app_dataset_revisions where key = 'ph_master_inventory')
    or exists (select 1 from private.app_access_policy_versions)
    or exists (select 1 from private.app_access_runtime_state where singleton) then
    raise exception 'CANONICAL_FIXTURE_EXPECTED_EMPTY_BASELINE_PREREQUISITES';
  end if;
end;
$workspace_guard$;

-- Register every physical source whose restored baseline trigger calls
-- touch_source. Missing local registrations are deliberately deny-only: they
-- are not browser-readable and grant no module visibility. Existing source
-- metadata remains authoritative. This supports statement triggers reached
-- indirectly by the synthetic profile and policy inserts below.
with tracked_sources as (
  select distinct case when relation_namespace.nspname = 'public' then relation_class.relname
      else relation_namespace.nspname || '.' || relation_class.relname end as source_key
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation_class on relation_class.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace relation_namespace on relation_namespace.oid = relation_class.relnamespace
  join pg_catalog.pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace function_namespace on function_namespace.oid = trigger_function.pronamespace
  where not trigger_row.tgisinternal
    and function_namespace.nspname = 'app_sync_private'
    and trigger_function.proname = 'touch_source'
)
insert into app_sync_private.sources(key, modules, client_enabled, dylan_only)
select source_key, '{}'::text[], false, true from tracked_sources
on conflict (key) do nothing;

with tracked_sources as (
  select distinct case when relation_namespace.nspname = 'public' then relation_class.relname
      else relation_namespace.nspname || '.' || relation_class.relname end as source_key
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation_class on relation_class.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace relation_namespace on relation_namespace.oid = relation_class.relnamespace
  join pg_catalog.pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace function_namespace on function_namespace.oid = trigger_function.pronamespace
  where not trigger_row.tgisinternal
    and function_namespace.nspname = 'app_sync_private'
    and trigger_function.proname = 'touch_source'
)
insert into public.app_dataset_revisions(key, revision, state)
select source_key, 1, 'ready' from tracked_sources
on conflict (key) do nothing;

do $tracked_source_contract$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_class on relation_class.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace relation_namespace on relation_namespace.oid = relation_class.relnamespace
    join pg_catalog.pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace function_namespace on function_namespace.oid = trigger_function.pronamespace
    left join app_sync_private.sources source on source.key = case when relation_namespace.nspname = 'public'
      then relation_class.relname else relation_namespace.nspname || '.' || relation_class.relname end
    left join public.app_dataset_revisions revision on revision.key = source.key
    where not trigger_row.tgisinternal and function_namespace.nspname = 'app_sync_private'
      and trigger_function.proname = 'touch_source' and (source.key is null or revision.key is null)
  ) then
    raise exception 'CANONICAL_FIXTURE_SOURCE_REGISTRY_INCOMPLETE';
  end if;
  if not exists (select 1 from public.app_dataset_revisions where key='ph_master_inventory' and state='ready') then
    raise exception 'CANONICAL_FIXTURE_INVENTORY_SOURCE_NOT_READY';
  end if;
end;
$tracked_source_contract$;

-- Synthetic Auth identity used only to exercise the checked-in baseline repair.
insert into auth.users(
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '961b0a0f-11a6-4db5-b066-582f772ab8e7', 'authenticated', 'authenticated',
  'nelly.baseline.fixture@local.invalid', '', now(),
  '{"provider":"email","providers":["email"],"fixture":true}'::jsonb,
  '{"fixture":"canonical-schema-replay"}'::jsonb, now(), now()
);
insert into public.profiles(id, username, display_name, role, must_change_password)
values ('961b0a0f-11a6-4db5-b066-582f772ab8e7', 'nelly_aguilar', 'Nelly (synthetic CI)', 'Admin', false);

-- Seed the smallest valid audit policy using the archived access-control seed
-- contract, plus historical protected-Reclass actions referenced by later
-- migrations. These catalog rows exist only in the guarded local workspace.
insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values
  ('module.drive.view', 'module', 'drive', 'Drive', 'Synthetic canonical replay permission.', '{}'::text[], 100, true),
  -- Exact catalog metadata from the archived access-control seed. Visibility
  -- is granted only by each behavior test's explicit actor override.
  ('module.managers.view', 'module', 'managers', 'Managers', 'Open Managers.', '{}'::text[], 190, true),
  ('request.view_queue', 'action', 'request', 'View Queue', 'Synthetic canonical replay permission.',
    array['own','assigned','division','global']::text[], 1000, true),
  -- Exact permission metadata from the archived protected Drive reclass seed.
  ('drive.reclass.submit', 'action', 'drive', 'Submit Reclass inquiry',
    'Managers may submit any Drive row; evaluators are limited to their authoritative assignments.',
    array['assigned','global']::text[], 614, true),
  -- Exact metadata from 20260922233000_manager_season_priority_inquiry_v1.sql.
  ('managers.season_priority.submit', 'action', 'managers', 'Request Season Priority change',
    'Create a protected Reclass inquiry that rotates an eligible Season Sales Notes item to Priority 1.',
    array['global']::text[], 616, true);
do $audit_policy$
declare v_policy_id bigint;
begin
  insert into private.app_access_policy_versions
    (version_number, revision, status, created_by_username, review_reason)
  values (1, 1, 'draft', 'ci_fixture', 'Synthetic canonical migration prerequisite')
  returning id into strict v_policy_id;

  insert into private.app_access_runtime_state(singleton, contract_version, enforcement_mode)
  values (true, 'app-access-v1', 'audit');

  insert into private.app_access_role_grants(policy_id, role_key, permission_key, allowed, access_scope)
  values (v_policy_id, 'ADMIN', 'module.drive.view', true, null),
         (v_policy_id, 'ADMIN', 'request.view_queue', true, 'global'),
         (v_policy_id, 'ADMIN', 'drive.reclass.submit', true, 'global');

  -- Preserve the archived Manager action's three permitted roles, without
  -- adding module visibility or granting this action to other roles.
  insert into private.app_access_role_grants(policy_id, role_key, permission_key, allowed, access_scope)
  select v_policy_id, role.role_key, 'managers.season_priority.submit', true, 'global'
  from (values ('ADMIN'), ('ADMINISTRATOR'), ('MANAGER')) role(role_key);
end;
$audit_policy$;

commit;
