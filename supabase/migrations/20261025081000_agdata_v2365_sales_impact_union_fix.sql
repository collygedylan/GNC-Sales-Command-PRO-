begin;

create or replace function public.get_request_sales_impact_v2()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
  with completed as materialized (
    select history.unique_id, history.request_folder, history.created_at, history.sales_rep,
      history.customer_name, history.consignee_name, history.itemcode, history.commonname,
      history.contsize, history.lotcode, history.locationcode, history.request_qty,
      history.effective_qty, history.unit_list_price, history.listprice, history.line_dollar_value,
      'ph_request_history'::text canonical_source_table
    from public.ph_request_history history
    union all
    select history.unique_id, history.request_folder, history.created_at, history.sales_rep,
      history.customer_name, history.consignee_name, history.itemcode, history.commonname,
      history.contsize, history.lotcode, history.locationcode, history.request_qty,
      history.effective_qty, history.unit_list_price, history.listprice, history.line_dollar_value,
      'ph_location_moves_history'::text canonical_source_table
    from public.ph_location_moves_history history
    union all
    select history.unique_id, history.request_folder, history.created_at, history.sales_rep,
      history.customer_name, history.consignee_name, history.itemcode, history.commonname,
      history.contsize, history.lotcode, history.locationcode, history.request_qty,
      history.effective_qty, history.unit_list_price, history.listprice, history.line_dollar_value,
      'ph_eval_work_history'::text canonical_source_table
    from public.ph_eval_work_history history
  ), lines as materialized (
    select history.canonical_source_table || ':' || history.unique_id line_identity_key,
      coalesce(nullif(history.request_folder, ''), history.unique_id) request_identity,
      history.unique_id, history.request_folder folder_id, history.unique_id source_row_id,
      history.canonical_source_table source_table, array[history.canonical_source_table]::text[] source_tables,
      1 row_index, history.created_at request_date, 'Completed'::text status,
      coalesce(nullif(history.sales_rep, ''), 'Unassigned') sales_rep,
      coalesce(nullif(history.customer_name, ''), 'Unknown Customer') customer_name,
      coalesce(nullif(history.consignee_name, ''), 'N/A') consignee_name,
      history.itemcode, history.commonname, history.contsize, history.lotcode, history.locationcode,
      history.request_qty raw_qty, coalesce(history.effective_qty, history.request_qty, 25) effective_qty,
      coalesce(history.unit_list_price, history.listprice, 0) list_price,
      'canonical_history_v2363'::text price_source,
      round(coalesce(history.line_dollar_value,
        coalesce(history.effective_qty, history.request_qty, 25) * coalesce(history.unit_list_price, history.listprice, 0)), 2) line_dollar_value
    from completed history
    union all
    select 'ph_active_request:' || pending.unique_id,
      coalesce(nullif(pending.request_folder, ''), pending.unique_id), pending.unique_id,
      pending.request_folder, pending.unique_id, 'ph_active_request', array['ph_active_request']::text[],
      1, pending.created_at, 'Pending', coalesce(nullif(pending.sales_rep, ''), 'Unassigned'),
      coalesce(nullif(pending.customer_name, ''), 'Unknown Customer'),
      coalesce(nullif(pending.consignee_name, ''), 'N/A'), pending.itemcode, pending.commonname,
      pending.contsize, pending.lotcode, pending.locationcode, pending.request_qty,
      coalesce(pending.effective_qty, pending.request_qty, 25), coalesce(pending.unit_list_price, 0),
      'canonical_pending_v2363', round(coalesce(pending.line_dollar_value,
        coalesce(pending.effective_qty, pending.request_qty, 25) * coalesce(pending.unit_list_price, 0)), 2)
    from public.ph_active_request pending
    where pending.date_completed is null
  ), summary as (
    select round(coalesce(sum(line_dollar_value), 0), 2) total_dollar_value,
      round(coalesce(sum(line_dollar_value) filter (where status = 'Completed'), 0), 2) completed_dollar_value,
      round(coalesce(sum(line_dollar_value) filter (where status = 'Pending'), 0), 2) pending_dollar_value,
      count(distinct request_identity)::integer total_requests, count(*)::integer total_line_items,
      round(coalesce(sum(effective_qty), 0), 2) total_units_requested,
      count(*) filter (where raw_qty is not null)::integer explicit_qty_line_count,
      count(*) filter (where raw_qty is null)::integer default_25_qty_line_count
    from lines
  )
  select jsonb_build_object(
    'dedupe_contract', 'canonical-active-history-v2363',
    'summary', (select to_jsonb(summary) from summary),
    'by_sales_rep', coalesce((select jsonb_agg(to_jsonb(rollup) order by rollup.total_dollar_value desc, rollup.sales_rep)
      from (select sales_rep, count(distinct request_identity)::integer request_count, count(*)::integer line_item_count,
        round(sum(effective_qty), 2) total_units, round(sum(line_dollar_value), 2) total_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Completed'), 0), 2) completed_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Pending'), 0), 2) pending_dollar_value
        from lines group by sales_rep) rollup), '[]'::jsonb),
    'by_customer_consignee', coalesce((select jsonb_agg(to_jsonb(rollup) order by rollup.total_dollar_value desc, rollup.customer_name, rollup.consignee_name)
      from (select customer_name, consignee_name, customer_name || ' / ' || consignee_name customer_consignee_label,
        min(sales_rep) sales_rep, count(distinct request_identity)::integer request_count,
        count(*)::integer line_item_count, round(sum(effective_qty), 2) total_units,
        round(sum(line_dollar_value), 2) total_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Completed'), 0), 2) completed_dollar_value,
        round(coalesce(sum(line_dollar_value) filter (where status = 'Pending'), 0), 2) pending_dollar_value
        from lines group by customer_name, consignee_name) rollup), '[]'::jsonb),
    'line_items', coalesce((select jsonb_agg(to_jsonb(lines) || jsonb_build_object(
      'customer_consignee_label', customer_name || ' / ' || consignee_name,
      'is_default_qty', raw_qty is null, 'unit_list_price', list_price)
      order by request_date desc nulls last, line_identity_key) from lines), '[]'::jsonb),
    'source_table_audit', jsonb_build_object(
      'dedupe_contract', 'canonical-active-history-v2363',
      'union_contract', 'explicit-completed-history-union-v2365',
      'inventory_table', 'ph_active_drive_mode', 'pending_table', 'ph_active_request',
      'completed_table', 'ph_request_history', 'line_count', (select count(*) from lines),
      'distinct_unique_ids', (select count(distinct unique_id) from lines),
      'completed_count', (select count(*) from lines where status = 'Completed'),
      'pending_count', (select count(*) from lines where status = 'Pending'),
      'formula', '(request_qty > 0 ? request_qty : 25) * unit_list_price'))
$function$;

revoke all on function public.get_request_sales_impact_v2() from public, anon, authenticated;
grant execute on function public.get_request_sales_impact_v2() to service_role;

do $verify$
declare
  impact jsonb;
begin
  if position('select history.*' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure)) > 0 then
    raise exception 'REQUEST_SALES_IMPACT_WILDCARD_UNION_REMAINED';
  end if;
  impact := public.get_request_sales_impact_v2();
  if impact->>'dedupe_contract' <> 'canonical-active-history-v2363'
    or impact->'source_table_audit'->>'union_contract' <> 'explicit-completed-history-union-v2365'
    or coalesce((impact->'summary'->>'completed_dollar_value')::numeric, 0) < 6067786.53 then
    raise exception 'REQUEST_SALES_IMPACT_V2365_CONTRACT_FAILED';
  end if;
end
$verify$;

commit;
