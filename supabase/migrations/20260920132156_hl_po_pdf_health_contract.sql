-- PDF reports remain authoritative until explicitly replaced. Validate their
-- saved provenance and current receipt accounting without touching business data.
begin;

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
  imp hl_order_private.po_imports; control hl_order_private.po_control;
  pdf_valid boolean := false; projection_valid boolean := false; s1_access boolean := false;
  page_count integer := 0; pdf_rows bigint := 0; expected_count bigint := 0; review_count bigint := 0;
  pending_count bigint := 0; latest_f1 text; latest_s1 text;
  authority_valid boolean := false; printed_at timestamptz;
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


  select * into control from hl_order_private.po_control where singleton;
  select * into imp from hl_order_private.po_imports where id=control.active_import_id;
  if imp.source_format='pdf' then
    begin
      printed_at:=(imp.metadata->>'report_printed_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then printed_at:=null;
    end;
    page_count:=case when imp.metadata->>'page_count' ~ '^[1-9][0-9]{0,3}$'
      then (imp.metadata->>'page_count')::integer else 0 end;
    select count(*) into pdf_rows from hl_order_private.po_import_rows where import_id=imp.id;
    pdf_valid:=coalesce(imp.status='reconciled' and control.active_scope=imp.id::text
      and imp.reconciled_by is not null and imp.receipt_cutoff=control.receipt_cutoff
      and imp.receipt_cutoff<=imp.created_at and imp.created_at<=imp.completed_at
      and imp.completed_at<=imp.reconciled_at and imp.reconciled_at<=now()
      and imp.report_date is not null and imp.report_date<=current_date
      and nullif(btrim(imp.metadata->>'source_file_id'),'') is not null
      and nullif(btrim(imp.metadata->>'parser_version'),'') is not null
      and isfinite(printed_at) and printed_at<=imp.created_at
      and imp.report_date=(printed_at at time zone 'America/Chicago')::date
      and imp.fingerprint ~ '^[a-f0-9]{64}$' and imp.fingerprint=imp.metadata->>'fingerprint'
      and page_count>0 and pdf_rows=imp.row_count and pdf_rows>0
      and (select count(*)=page_count and min(page)=1 and max(page)=page_count
        and sum(jsonb_array_length(rows))=pdf_rows
        from hl_order_private.po_pdf_pages where import_id=imp.id),false);

    -- Compare the complete active projection with the authoritative ledger.
    -- EXCEPT ALL also detects duplicate rows and preserves zero/NULL/negative values.
    with expected as materialized (
      select itemcode,size,lot,po_ordered,imported,remaining,status
      from hl_order_private.po_balances_v2()
    ), projected as materialized (
      select item_code,size,lot,po_ordered,imported_po_remain,po_remain,run_id,source_file_id,'27.F1'::text table_lot
        from public.ph_27f1_hl_po where run_id=imp.id::text or source_file_id='pdf:'||imp.id
      union all
      select item_code,size,lot,po_ordered,imported_po_remain,po_remain,run_id,source_file_id,'27.S1'::text table_lot
        from public.ph_27s1_hl_po where run_id=imp.id::text or source_file_id='pdf:'||imp.id
    ), differences as (
      (select itemcode,size,lot,po_ordered,imported,remaining,imp.id::text,'pdf:'||imp.id,lot from expected
        except all select * from projected)
      union all
      (select * from projected except all
        select itemcode,size,lot,po_ordered,imported,remaining,imp.id::text,'pdf:'||imp.id,lot from expected)
    )
    select not exists(select 1 from differences),(select count(*) from expected),
      (select count(*) from expected where status='review')
      into projection_valid,expected_count,review_count;

    -- The presentation views still select the latest run per season. An old
    -- season must not silently remain visible when a replacement has no rows.
    select run_id into latest_f1 from public.ph_27f1_hl_po order by imported_at desc,id desc limit 1;
    select run_id into latest_s1 from public.ph_27s1_hl_po order by imported_at desc,id desc limit 1;
    projection_valid:=projection_valid and (latest_f1 is null or latest_f1=imp.id::text)
      and (latest_s1 is null or latest_s1=imp.id::text);
    s1_access:=has_table_privilege('authenticated','public.ph_27s1_hl_po','SELECT')
      and has_table_privilege('authenticated','public.ph_view_po_27s1_hl','SELECT')
      and not has_table_privilege('anon','public.ph_27s1_hl_po','SELECT')
      and not has_table_privilege('anon','public.ph_view_po_27s1_hl','SELECT')
      and not has_table_privilege('authenticated','public.ph_27s1_hl_po','INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated','public.ph_view_po_27s1_hl','INSERT,UPDATE,DELETE')
      and exists(select 1 from pg_catalog.pg_policies where schemaname='public'
        and tablename='ph_27s1_hl_po' and policyname='ph_27s1_hl_po_manager_read' and cmd='SELECT'
        and 'authenticated'=any(roles))
      and coalesce((select reloptions @> array['security_invoker=true']::text[]
        from pg_catalog.pg_class where oid='public.ph_view_po_27s1_hl'::regclass),false);
    row_count_value:=expected_count;
    latest_built_at_value:=imp.reconciled_at;
    authority_valid:=pdf_valid;
  else
    -- A missing PDF/control must not be reclassified as a fresh legacy import.
    authority_valid:=coalesce(control.singleton and nullif(control.active_scope,'') is not null
      and (control.active_import_id is null or (imp.source_format='legacy' and imp.status='reconciled'))
      and control.active_scope=(select coalesce(nullif(run_id,''),source_file_id)
        from public.ph_27f1_hl_po order by imported_at desc,id desc limit 1)
      and not exists(select 1 from public.ph_27f1_hl_po
        where source_file_id like 'pdf:%'
          and coalesce(nullif(run_id,''),source_file_id)=control.active_scope),false);
  end if;
  select count(*) into pending_count from hl_order_private.po_imports
    where source_format='pdf' and status='pending';

  return jsonb_build_object(
    'contract_version', 'po-management-native-auth-v1',
    'row_count', row_count_value,
    'source_authority_valid', authority_valid, 'report_printed_at', printed_at,
    'source_format', coalesce(imp.source_format,'legacy'),
    'freshness_mode', case when imp.source_format='pdf' then 'manual_pdf' else 'scheduled_import' end,
    'pdf_health_contract', 'confirmed-pdf-ledger-v1',
    'pdf_report_valid', pdf_valid, 'projection_matches_ledger', projection_valid,
    'season_access_healthy', s1_access, 'pending_pdf_count', pending_count,
    'review_balance_count', review_count, 'report_date', imp.report_date,
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
  'Read-only PO health: confirmed PDF provenance and seasonal ledger parity; report age is informational for manually replaced PDFs.';

notify pgrst, 'reload schema';

commit;

