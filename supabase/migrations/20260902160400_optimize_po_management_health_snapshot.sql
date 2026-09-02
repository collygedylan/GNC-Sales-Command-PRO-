begin;

-- The health check only needs the latest imported PO scope. Counting the live
-- presentation view rebuilt its inventory and SOC joins and could exceed the
-- hosted eight-second statement limit.
create index if not exists ph_27f1_hl_po_latest_import_idx
  on public.ph_27f1_hl_po (imported_at desc, id desc)
  include (run_id, source_file_id);

create index if not exists ph_27f1_hl_po_scope_key_idx
  on public.ph_27f1_hl_po ((coalesce(nullif(run_id, ''), source_file_id)))
  include (item_code, imported_at, created_at);

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

  with latest_scope as materialized (
    select coalesce(nullif(p.run_id, ''), p.source_file_id) as scope_key
    from public.ph_27f1_hl_po p
    where coalesce(nullif(p.run_id, ''), p.source_file_id) is not null
    order by p.imported_at desc, p.id desc
    limit 1
  )
  select
    count(*) filter (where nullif(btrim(p.item_code), '') is not null)::bigint,
    max(coalesce(p.imported_at, p.created_at))
  into row_count_value, latest_built_at_value
  from public.ph_27f1_hl_po p
  join latest_scope latest
    on coalesce(nullif(p.run_id, ''), p.source_file_id) = latest.scope_key;

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
  'Service-role PO contract health derived from the latest source scope without rebuilding the live presentation view.';

notify pgrst, 'reload schema';

commit;
