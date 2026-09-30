begin;

-- SALES/MARKETING is a deliberately limited role. Its role default is Drive
-- plus Tasks; the client further constrains Tasks to Season Sales Notes.
insert into private.app_access_role_grants
  (policy_id, role_key, permission_key, allowed, access_scope, updated_at)
select v.id, 'SALESMARKETING', p.permission_key, true, null, now()
from private.app_access_policy_versions v
join private.app_access_permissions p
  on p.permission_key in ('module.drive.view', 'module.tasks.view')
where v.status in ('draft', 'reviewed', 'active')
on conflict (policy_id, role_key, permission_key) do update set
  allowed = true,
  access_scope = null,
  updated_at = now();

create table if not exists private.app_limited_live_overrides (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  permission_key text not null references private.app_access_permissions(permission_key) on delete restrict,
  allowed boolean not null,
  updated_by_username text not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, permission_key),
  constraint app_limited_live_override_actor_format
    check (updated_by_username = lower(btrim(updated_by_username)))
);

create table if not exists private.app_limited_access_state (
  singleton boolean primary key default true check (singleton),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

insert into private.app_limited_access_state (singleton, revision)
values (true, 1)
on conflict (singleton) do nothing;

create table if not exists private.app_limited_access_events (
  id bigint generated always as identity primary key,
  actor_username text not null,
  target_username text not null,
  target_role text not null,
  permission_key text not null,
  previous_value jsonb,
  next_value jsonb,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint app_limited_access_event_reason_length
    check (char_length(reason) between 4 and 500),
  constraint app_limited_access_event_value_size
    check (
      octet_length(coalesce(previous_value, '{}'::jsonb)::text) <= 2048
      and octet_length(coalesce(next_value, '{}'::jsonb)::text) <= 2048
    )
);

create index if not exists app_limited_live_overrides_permission_idx
  on private.app_limited_live_overrides (permission_key, profile_id);
create index if not exists app_limited_access_events_created_idx
  on private.app_limited_access_events (created_at desc);

alter table private.app_limited_live_overrides enable row level security;
alter table private.app_limited_access_state enable row level security;
alter table private.app_limited_access_events enable row level security;

revoke all on table private.app_limited_live_overrides from public, anon, authenticated;
revoke all on table private.app_limited_access_state from public, anon, authenticated;
revoke all on table private.app_limited_access_events from public, anon, authenticated;

create or replace function private.is_kayla_limited_access_manager_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and lower(btrim(p.username)) = 'kayla_knepp'
      and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
  )
$$;

create or replace function private.is_kayla_managed_role_v1(p_role text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.normalized_profile_role(p_role) in ('CSR', 'SALESREP', 'SALESMARKETING')
$$;

create or replace function private.is_kayla_managed_permission_v1(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.app_access_permissions p
    where p.permission_key = lower(btrim(coalesce(p_permission_key, '')))
      and p.active
      and p.permission_kind = 'module'
      and p.module_key not in ('managers', 'access-control', 'disease-pest', 'pest-management')
  )
$$;

-- Apply the narrow live overrides only to the three roles Kayla is permitted
-- to administer. The rest of centralized Access Control remains in audit mode.
create or replace function public.get_my_app_permissions_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles;
  state private.app_access_runtime_state;
  policy private.app_access_policy_versions;
  permissions jsonb;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'APP_ACCESS_PROFILE_REQUIRED';
  end if;

  select * into state from private.app_access_runtime_state where singleton;
  select * into policy
  from private.app_access_policy_versions
  where id = private.resolve_app_access_policy_id_v1(false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionKey', e.permission_key,
    'kind', e.permission_kind,
    'moduleKey', e.module_key,
    'label', e.label,
    'allowed', case
      when private.is_kayla_managed_role_v1(profile.role)
        and o.permission_key is not null then o.allowed
      else e.allowed
    end,
    'scope', e.access_scope,
    'source', case
      when private.is_kayla_managed_role_v1(profile.role)
        and o.permission_key is not null then 'limited-user'
      else e.decision_source
    end
  ) order by e.sort_order, e.permission_key), '[]'::jsonb)
  into permissions
  from private.get_effective_app_permissions_v1(profile.id, policy.id) e
  left join private.app_limited_live_overrides o
    on o.profile_id = profile.id
   and o.permission_key = e.permission_key;

  return jsonb_build_object(
    'contractVersion', 'app-access-v1',
    'enforcementMode', state.enforcement_mode,
    'policyVersion', policy.version_number,
    'policyRevision', policy.revision,
    'username', lower(btrim(profile.username)),
    'role', profile.role,
    'permissions', permissions
  );
end
$$;

create or replace function public.get_limited_access_control_matrix_v1(
  p_query jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query_value jsonb := coalesce(p_query, '{}'::jsonb);
  policy private.app_access_policy_versions;
  access_state private.app_limited_access_state;
  search_value text := lower(left(btrim(coalesce(query_value->>'search', '')), 100));
  role_filter text := private.normalized_profile_role(left(btrim(coalesce(query_value->>'role', '')), 80));
  module_filter text := lower(left(btrim(coalesce(query_value->>'module', '')), 100));
  subject_offset_value integer := greatest(0, least(100000, coalesce((query_value->>'subjectOffset')::integer, 0)));
  subject_limit_value integer := greatest(1, least(100, coalesce((query_value->>'subjectLimit')::integer, 24)));
  permission_offset_value integer := greatest(0, least(100000, coalesce((query_value->>'permissionOffset')::integer, 0)));
  permission_limit_value integer := greatest(1, least(24, coalesce((query_value->>'permissionLimit')::integer, 8)));
  permission_rows jsonb := '[]'::jsonb;
  user_rows jsonb := '[]'::jsonb;
  module_rows jsonb := '[]'::jsonb;
  filtered_subject_count bigint := 0;
  filtered_permission_count bigint := 0;
begin
  if not private.is_kayla_limited_access_manager_v1() then
    raise exception using errcode = '42501', message = 'LIMITED_ACCESS_CONTROL_FORBIDDEN';
  end if;
  if jsonb_typeof(query_value) <> 'object' then
    raise exception using errcode = '22023', message = 'LIMITED_ACCESS_CONTROL_QUERY_INVALID';
  end if;

  select * into policy
  from private.app_access_policy_versions v
  where v.id = private.resolve_app_access_policy_id_v1(false)
  limit 1;
  select * into access_state from private.app_limited_access_state where singleton;

  select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
  into module_rows
  from (
    select distinct p.module_key
    from private.app_access_permissions p
    where private.is_kayla_managed_permission_v1(p.permission_key)
  ) x;

  with filtered_permissions as (
    select p.*
    from private.app_access_permissions p
    where private.is_kayla_managed_permission_v1(p.permission_key)
      and (module_filter in ('', 'all') or p.module_key = module_filter)
  ), page_permissions as (
    select * from filtered_permissions
    order by sort_order, permission_key
    offset permission_offset_value limit permission_limit_value
  )
  select
    (select count(*) from filtered_permissions),
    coalesce(jsonb_agg(jsonb_build_object(
      'permissionKey', p.permission_key,
      'kind', p.permission_kind,
      'moduleKey', p.module_key,
      'label', p.label,
      'description', p.description,
      'scopeOptions', to_jsonb(p.scope_options),
      'sortOrder', p.sort_order
    ) order by p.sort_order, p.permission_key), '[]'::jsonb)
  into filtered_permission_count, permission_rows
  from page_permissions p;

  with filtered_profiles as (
    select p.*
    from public.profiles p
    where p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and private.is_kayla_managed_role_v1(p.role)
      and (role_filter = '' or private.normalized_profile_role(p.role) = role_filter)
      and (
        search_value = ''
        or lower(coalesce(p.username, '') || ' ' || coalesce(p.display_name, '') || ' ' || coalesce(p.role, '')) like '%' || search_value || '%'
      )
  ), page_profiles as (
    select p.* from filtered_profiles p
    order by lower(coalesce(nullif(p.display_name, ''), p.username)), lower(p.username)
    offset subject_offset_value limit subject_limit_value
  ), decisions as (
    select p.id as profile_id, e.permission_key,
           coalesce(o.allowed, e.allowed) as allowed,
           e.access_scope,
           case when o.permission_key is not null then 'limited-user' else e.decision_source end as decision_source
    from page_profiles p
    cross join lateral private.get_effective_app_permissions_v1(p.id, policy.id) e
    left join private.app_limited_live_overrides o
      on o.profile_id = p.id and o.permission_key = e.permission_key
    where e.permission_key in (
      select page_perm."permissionKey"
      from jsonb_to_recordset(permission_rows) as page_perm("permissionKey" text)
    )
  ), user_decisions as (
    select d.profile_id,
           jsonb_object_agg(d.permission_key, jsonb_build_object(
             'allowed', d.allowed,
             'scope', d.access_scope,
             'source', d.decision_source,
             'baselinePresent', true,
             'mismatch', false
           )) as decisions
    from decisions d group by d.profile_id
  )
  select
    (select count(*) from filtered_profiles),
    coalesce(jsonb_agg(jsonb_build_object(
      'username', lower(btrim(p.username)),
      'displayName', coalesce(nullif(p.display_name, ''), p.username),
      'role', p.role,
      'roleKey', private.normalized_profile_role(p.role),
      'decisions', coalesce(d.decisions, '{}'::jsonb)
    ) order by lower(coalesce(nullif(p.display_name, ''), p.username)), lower(p.username)), '[]'::jsonb)
  into filtered_subject_count, user_rows
  from page_profiles p
  left join user_decisions d on d.profile_id = p.id;

  return jsonb_build_object(
    'contractVersion', 'app-access-view-v2',
    'enforcementMode', 'limited-live',
    'capabilities', jsonb_build_object(
      'canView', true,
      'canEdit', true,
      'canPublish', false,
      'editScope', 'limited-users',
      'liveChanges', true,
      'managedRoleKeys', jsonb_build_array('CSR', 'SALESREP', 'SALESMARKETING')
    ),
    'policy', jsonb_build_object(
      'id', policy.id,
      'version', policy.version_number,
      'revision', access_state.revision,
      'status', 'limited-live'
    ),
    'permissions', permission_rows,
    'users', user_rows,
    'roles', '[]'::jsonb,
    'filters', jsonb_build_object(
      'modules', module_rows,
      'roles', jsonb_build_array('CSR', 'SALESREP', 'SALESMARKETING')
    ),
    'page', jsonb_build_object(
      'subjectType', 'users',
      'subjectOffset', subject_offset_value,
      'subjectLimit', subject_limit_value,
      'subjectTotal', filtered_subject_count,
      'permissionOffset', permission_offset_value,
      'permissionLimit', permission_limit_value,
      'permissionTotal', filtered_permission_count
    ),
    'summary', jsonb_build_object(
      'userCount', filtered_subject_count,
      'permissionCount', filtered_permission_count,
      'mismatchCount', 0,
      'baselineMissingCount', 0
    )
  );
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'LIMITED_ACCESS_CONTROL_QUERY_INVALID';
end
$$;

create or replace function public.save_limited_access_override_v1(
  p_expected_revision integer,
  p_changes jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  access_state private.app_limited_access_state;
  change_row jsonb;
  target_type_value text;
  target_key_value text;
  permission_key_value text;
  decision_value text;
  target_profile public.profiles;
  previous_value jsonb;
  next_value jsonb;
  applied_count integer := 0;
begin
  actor := private.current_active_profile();
  if actor.id is null or not private.is_kayla_limited_access_manager_v1() then
    raise exception using errcode = '42501', message = 'LIMITED_ACCESS_CONTROL_FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 4 and 500 then
    raise exception using errcode = '22023', message = 'LIMITED_ACCESS_CONTROL_REASON_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_changes, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_changes) < 1
     or jsonb_array_length(p_changes) > 100 then
    raise exception using errcode = '22023', message = 'LIMITED_ACCESS_CONTROL_CHANGES_INVALID';
  end if;

  select * into access_state
  from private.app_limited_access_state
  where singleton
  for update;
  if access_state.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'LIMITED_ACCESS_CONTROL_VERSION_CONFLICT';
  end if;

  for change_row in select value from jsonb_array_elements(p_changes) loop
    target_type_value := lower(btrim(coalesce(change_row->>'targetType', '')));
    target_key_value := lower(btrim(coalesce(change_row->>'targetKey', '')));
    permission_key_value := lower(btrim(coalesce(change_row->>'permissionKey', '')));
    decision_value := lower(btrim(coalesce(change_row->>'decision', '')));

    if target_type_value <> 'user' or decision_value not in ('inherit', 'allow', 'deny') then
      raise exception using errcode = '22023', message = 'LIMITED_ACCESS_CONTROL_CHANGE_INVALID';
    end if;
    if not private.is_kayla_managed_permission_v1(permission_key_value) then
      raise exception using errcode = '42501', message = 'LIMITED_ACCESS_CONTROL_PERMISSION_FORBIDDEN';
    end if;

    select p.* into target_profile
    from public.profiles p
    where lower(btrim(p.username)) = target_key_value
      and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
    limit 1
    for update;
    if target_profile.id is null or not private.is_kayla_managed_role_v1(target_profile.role) then
      raise exception using errcode = '42501', message = 'LIMITED_ACCESS_CONTROL_TARGET_FORBIDDEN';
    end if;

    select jsonb_build_object('allowed', o.allowed)
      into previous_value
    from private.app_limited_live_overrides o
    where o.profile_id = target_profile.id
      and o.permission_key = permission_key_value;

    if decision_value = 'inherit' then
      delete from private.app_limited_live_overrides
      where profile_id = target_profile.id
        and permission_key = permission_key_value;
      next_value := null;
    else
      insert into private.app_limited_live_overrides
        (profile_id, permission_key, allowed, updated_by_username, updated_at)
      values
        (target_profile.id, permission_key_value, decision_value = 'allow', lower(btrim(actor.username)), now())
      on conflict (profile_id, permission_key) do update set
        allowed = excluded.allowed,
        updated_by_username = excluded.updated_by_username,
        updated_at = now();
      next_value := jsonb_build_object('allowed', decision_value = 'allow');
    end if;

    if previous_value is distinct from next_value then
      insert into private.app_limited_access_events
        (actor_username, target_username, target_role, permission_key,
         previous_value, next_value, reason)
      values
        (lower(btrim(actor.username)), target_key_value,
         private.normalized_profile_role(target_profile.role), permission_key_value,
         previous_value, next_value, btrim(p_reason));
      applied_count := applied_count + 1;
    end if;
  end loop;

  if applied_count > 0 then
    update private.app_limited_access_state
    set revision = revision + 1,
        updated_at = now()
    where singleton
    returning * into access_state;
  end if;

  return jsonb_build_object(
    'contractVersion', 'app-limited-access-v1',
    'revision', access_state.revision,
    'appliedCount', applied_count,
    'enforcementMode', 'limited-live'
  );
end
$$;

revoke all on function private.is_kayla_limited_access_manager_v1() from public, anon, authenticated;
revoke all on function private.is_kayla_managed_role_v1(text) from public, anon, authenticated;
revoke all on function private.is_kayla_managed_permission_v1(text) from public, anon, authenticated;
revoke all on function public.get_limited_access_control_matrix_v1(jsonb) from public, anon, authenticated;
revoke all on function public.save_limited_access_override_v1(integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.get_limited_access_control_matrix_v1(jsonb) to authenticated;
grant execute on function public.save_limited_access_override_v1(integer, jsonb, text) to authenticated;

comment on function public.get_limited_access_control_matrix_v1(jsonb) is
  'Returns only active CSR, SALESREP, and SALES/MARKETING profiles and safe module permissions to Kayla Knepp.';
comment on function public.save_limited_access_override_v1(integer, jsonb, text) is
  'Applies audited live module overrides only when Kayla Knepp targets an active CSR, SALESREP, or SALES/MARKETING profile.';

commit;
