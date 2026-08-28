-- Restore Native Auth access to the live PO Management view without routing
-- browser reads through the retired service-role database proxy.

create or replace function private.can_view_po_management()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (profile_row).id is not null
    and upper(regexp_replace(coalesce((profile_row).role, ''), '[^A-Za-z0-9]+', '', 'g'))
      = any (array['ADMIN', 'MANAGER']::text[]),
    false
  )
  from (select private.current_active_profile() as profile_row) active_profile
$$;

revoke all on function private.can_view_po_management()
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_view_po_management()
  to authenticated;

comment on function private.can_view_po_management() is
  'Returns true only for an active trusted ADMIN or MANAGER profile.';

alter table public.ph_27f1_hl_po enable row level security;

revoke all on table public.ph_27f1_hl_po from public, anon, authenticated;
grant select on table public.ph_27f1_hl_po to authenticated;

drop policy if exists ph_27f1_hl_po_manager_read on public.ph_27f1_hl_po;
create policy ph_27f1_hl_po_manager_read
on public.ph_27f1_hl_po
for select
to authenticated
using ((select private.can_view_po_management()));

alter view public.ph_view_po_27f1_hl set (security_invoker = true);
revoke all on table public.ph_view_po_27f1_hl from public, anon, authenticated;
grant select on table public.ph_view_po_27f1_hl to authenticated;

-- Service-only aggregate used by hosted monitoring. It contains no PO rows,
-- customer values, item details, filenames, or other business content.
create or replace function public.get_po_management_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_count_value bigint := 0;
  latest_built_at_value timestamptz := null;
  source_authenticated_select boolean := false;
  view_authenticated_select boolean := false;
  anon_source_select boolean := false;
  anon_view_select boolean := false;
  authenticated_write_access boolean := false;
  policy_present boolean := false;
  security_invoker_enabled boolean := false;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'PO_MANAGEMENT_HEALTH_FORBIDDEN';
  end if;

  select count(*)::bigint, max(built_at)
    into row_count_value, latest_built_at_value
  from public.ph_view_po_27f1_hl;

  source_authenticated_select := has_table_privilege(
    'authenticated', 'public.ph_27f1_hl_po', 'SELECT'
  );
  view_authenticated_select := has_table_privilege(
    'authenticated', 'public.ph_view_po_27f1_hl', 'SELECT'
  );
  anon_source_select := has_table_privilege(
    'anon', 'public.ph_27f1_hl_po', 'SELECT'
  );
  anon_view_select := has_table_privilege(
    'anon', 'public.ph_view_po_27f1_hl', 'SELECT'
  );
  authenticated_write_access :=
    has_table_privilege('authenticated', 'public.ph_27f1_hl_po', 'INSERT')
    or has_table_privilege('authenticated', 'public.ph_27f1_hl_po', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ph_27f1_hl_po', 'DELETE')
    or has_table_privilege('authenticated', 'public.ph_view_po_27f1_hl', 'INSERT')
    or has_table_privilege('authenticated', 'public.ph_view_po_27f1_hl', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ph_view_po_27f1_hl', 'DELETE');

  select exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'ph_27f1_hl_po'
      and policyname = 'ph_27f1_hl_po_manager_read'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
  ) into policy_present;

  select coalesce(c.reloptions @> array['security_invoker=true']::text[], false)
    into security_invoker_enabled
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'ph_view_po_27f1_hl'
    and c.relkind = 'v';

  return jsonb_build_object(
    'contract_version', 'po-management-native-auth-v1',
    'row_count', row_count_value,
    'latest_built_at', latest_built_at_value,
    'source_authenticated_select', source_authenticated_select,
    'view_authenticated_select', view_authenticated_select,
    'anonymous_access_denied', not anon_source_select and not anon_view_select,
    'authenticated_writes_denied', not authenticated_write_access,
    'manager_policy_present', policy_present,
    'security_invoker_enabled', security_invoker_enabled
  );
end;
$$;

revoke all on function public.get_po_management_health_snapshot()
  from public, anon, authenticated;
grant execute on function public.get_po_management_health_snapshot()
  to service_role;

comment on function public.get_po_management_health_snapshot() is
  'Service-only sanitized PO Management availability and authorization snapshot.';

notify pgrst, 'reload schema';
