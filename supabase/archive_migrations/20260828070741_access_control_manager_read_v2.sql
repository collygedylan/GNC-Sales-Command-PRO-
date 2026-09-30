begin;

create or replace function private.can_view_access_control_v2()
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
      and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and private.normalized_profile_role(p.role) in ('ADMIN', 'MANAGER')
  )
$$;

create or replace function public.get_access_control_capabilities_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contractVersion', 'app-access-view-v2',
    'canView', private.can_view_access_control_v2(),
    'canEdit', private.is_access_control_maintainer(),
    'enforcementMode', coalesce((select s.enforcement_mode from private.app_access_runtime_state s where s.singleton), 'audit')
  )
$$;

create or replace function public.get_access_control_matrix_v2(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query_value jsonb := coalesce(p_query, '{}'::jsonb);
  policy private.app_access_policy_versions;
  runtime_state private.app_access_runtime_state;
  subject_type text := case when lower(coalesce(query_value->>'subjectType', 'users')) = 'roles' then 'roles' else 'users' end;
  search_value text := lower(left(btrim(coalesce(query_value->>'search', '')), 100));
  permission_search_value text := lower(left(btrim(coalesce(query_value->>'permissionSearch', '')), 100));
  role_filter text := upper(left(btrim(coalesce(query_value->>'role', '')), 80));
  module_filter text := lower(left(btrim(coalesce(query_value->>'module', '')), 100));
  subject_offset_value integer := greatest(0, least(100000, coalesce((query_value->>'subjectOffset')::integer, 0)));
  subject_limit_value integer := greatest(1, least(100, coalesce((query_value->>'subjectLimit')::integer, 24)));
  permission_offset_value integer := greatest(0, least(100000, coalesce((query_value->>'permissionOffset')::integer, 0)));
  permission_limit_value integer := greatest(1, least(24, coalesce((query_value->>'permissionLimit')::integer, 8)));
  permission_rows jsonb := '[]'::jsonb;
  user_rows jsonb := '[]'::jsonb;
  role_rows jsonb := '[]'::jsonb;
  module_rows jsonb := '[]'::jsonb;
  role_filter_rows jsonb := '[]'::jsonb;
  active_user_count bigint := 0;
  filtered_subject_count bigint := 0;
  active_permission_count bigint := 0;
  filtered_permission_count bigint := 0;
  mismatch_count bigint := 0;
  baseline_missing_count bigint := 0;
begin
  if not private.can_view_access_control_v2() then
    raise exception using errcode = '42501', message = 'ACCESS_CONTROL_VIEW_FORBIDDEN';
  end if;

  if jsonb_typeof(query_value) <> 'object' then
    raise exception using errcode = '22023', message = 'ACCESS_CONTROL_QUERY_INVALID';
  end if;

  select * into runtime_state from private.app_access_runtime_state where singleton;
  select * into policy
  from private.app_access_policy_versions v
  where v.id = coalesce(nullif(query_value->>'policyVersionId', '')::bigint, private.resolve_app_access_policy_id_v1(true))
  limit 1;
  if policy.id is null then
    raise exception using errcode = '22023', message = 'ACCESS_CONTROL_POLICY_NOT_FOUND';
  end if;

  select count(*) into active_user_count
  from public.profiles p
  where p.disabled_at is null and (p.locked_until is null or p.locked_until <= now());

  select count(*) into active_permission_count
  from private.app_access_permissions p where p.active;

  select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
  into module_rows
  from (select distinct p.module_key from private.app_access_permissions p where p.active) x;

  select coalesce(jsonb_agg(x.role_key order by x.role_key), '[]'::jsonb)
  into role_filter_rows
  from (
    select distinct private.normalized_profile_role(p.role) as role_key
    from public.profiles p
    where p.disabled_at is null and private.normalized_profile_role(p.role) <> ''
  ) x;

  with filtered_permissions as (
    select p.*
    from private.app_access_permissions p
    where p.active
      and (module_filter in ('', 'all') or p.module_key = module_filter)
      and (permission_search_value = '' or lower(p.permission_key || ' ' || p.label || ' ' || p.description || ' ' || p.module_key) like '%' || permission_search_value || '%')
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

  if subject_type = 'roles' then
    with filtered_roles as (
      select r.role_key
      from (
        select distinct private.normalized_profile_role(p.role) as role_key
        from public.profiles p
        where p.disabled_at is null
        union
        select distinct g.role_key from private.app_access_role_grants g where g.policy_id = policy.id
      ) r
      where r.role_key <> ''
        and (role_filter in ('', 'ALL') or r.role_key = role_filter)
        and (search_value = '' or lower(r.role_key) like '%' || search_value || '%')
    ), page_roles as (
      select r.role_key from filtered_roles r order by r.role_key
      offset subject_offset_value limit subject_limit_value
    ), role_decisions as (
      select r.role_key,
             jsonb_object_agg(perm.permission_key, jsonb_build_object(
               'allowed', coalesce(g.allowed, false),
               'scope', g.access_scope,
               'source', case when g.permission_key is null then 'default-deny' else 'role' end
             )) as decisions
      from page_roles r
      cross join lateral jsonb_to_recordset(permission_rows) as page_perm("permissionKey" text, "sortOrder" integer)
      join private.app_access_permissions perm on perm.permission_key = page_perm."permissionKey"
      left join private.app_access_role_grants g
        on g.policy_id = policy.id and g.role_key = r.role_key and g.permission_key = perm.permission_key
      group by r.role_key
    )
    select
      (select count(*) from filtered_roles),
      coalesce(jsonb_agg(jsonb_build_object('roleKey', d.role_key, 'decisions', d.decisions) order by d.role_key), '[]'::jsonb)
    into filtered_subject_count, role_rows
    from role_decisions d;
  else
    with filtered_profiles as (
      select p.*
      from public.profiles p
      where p.disabled_at is null
        and (p.locked_until is null or p.locked_until <= now())
        and (role_filter in ('', 'ALL') or private.normalized_profile_role(p.role) = role_filter)
        and (search_value = '' or lower(coalesce(p.username, '') || ' ' || coalesce(p.display_name, '') || ' ' || coalesce(p.role, '')) like '%' || search_value || '%')
    ), page_profiles as (
      select p.* from filtered_profiles p
      order by lower(coalesce(nullif(p.display_name, ''), p.username)), lower(p.username)
      offset subject_offset_value limit subject_limit_value
    ), decisions as (
      select p.id as profile_id, e.*,
             b.allowed as legacy_allowed,
             b.access_scope as legacy_scope,
             b.permission_key is not null as baseline_present
      from page_profiles p
      cross join lateral private.get_effective_app_permissions_v1(p.id, policy.id) e
      join private.app_access_permissions perm on perm.permission_key = e.permission_key
      left join private.app_access_legacy_baseline b on b.profile_id = p.id and b.permission_key = e.permission_key
      where perm.permission_key in (
        select page_perm."permissionKey"
        from jsonb_to_recordset(permission_rows) as page_perm("permissionKey" text)
      )
    ), user_decisions as (
      select d.profile_id,
             jsonb_object_agg(d.permission_key, jsonb_build_object(
               'allowed', d.allowed,
               'scope', d.access_scope,
               'source', d.decision_source,
               'legacyAllowed', d.legacy_allowed,
               'legacyScope', d.legacy_scope,
               'baselinePresent', d.baseline_present,
               'mismatch', d.baseline_present and (d.allowed is distinct from d.legacy_allowed or d.access_scope is distinct from d.legacy_scope)
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
    from page_profiles p left join user_decisions d on d.profile_id = p.id;
  end if;

  select count(*) filter (
           where b.permission_key is not null
             and (e.allowed is distinct from b.allowed or e.access_scope is distinct from b.access_scope)
         ),
         count(*) filter (where b.permission_key is null)
    into mismatch_count, baseline_missing_count
  from public.profiles p
  cross join lateral private.get_effective_app_permissions_v1(p.id, policy.id) e
  left join private.app_access_legacy_baseline b on b.profile_id = p.id and b.permission_key = e.permission_key
  where p.disabled_at is null and (p.locked_until is null or p.locked_until <= now());

  return jsonb_build_object(
    'contractVersion', 'app-access-view-v2',
    'enforcementMode', runtime_state.enforcement_mode,
    'capabilities', jsonb_build_object('canView', true, 'canEdit', private.is_access_control_maintainer()),
    'policy', jsonb_build_object(
      'id', policy.id, 'version', policy.version_number, 'revision', policy.revision,
      'status', policy.status, 'reviewedAt', policy.reviewed_at, 'reviewedBy', policy.reviewed_by_username
    ),
    'permissions', permission_rows,
    'users', user_rows,
    'roles', role_rows,
    'filters', jsonb_build_object('modules', module_rows, 'roles', role_filter_rows),
    'page', jsonb_build_object(
      'subjectType', subject_type,
      'subjectOffset', subject_offset_value,
      'subjectLimit', subject_limit_value,
      'subjectTotal', filtered_subject_count,
      'permissionOffset', permission_offset_value,
      'permissionLimit', permission_limit_value,
      'permissionTotal', filtered_permission_count
    ),
    'summary', jsonb_build_object(
      'userCount', active_user_count,
      'permissionCount', active_permission_count,
      'mismatchCount', mismatch_count,
      'baselineMissingCount', baseline_missing_count
    )
  );
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'ACCESS_CONTROL_QUERY_INVALID';
end
$$;

revoke all on function private.can_view_access_control_v2() from public, anon, authenticated;
revoke all on function public.get_access_control_capabilities_v1() from public, anon, authenticated;
revoke all on function public.get_access_control_matrix_v2(jsonb) from public, anon, authenticated;
grant execute on function public.get_access_control_capabilities_v1() to authenticated;
grant execute on function public.get_access_control_matrix_v2(jsonb) to authenticated;

comment on function public.get_access_control_capabilities_v1() is
  'Returns trusted Access Control view/edit capabilities for the active authenticated profile.';
comment on function public.get_access_control_matrix_v2(jsonb) is
  'Returns a bounded Access Control matrix page to active ADMIN/MANAGER profiles; draft writes remain maintainer-only.';

commit;
