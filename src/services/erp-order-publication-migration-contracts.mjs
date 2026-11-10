export function erpDeferredOrderHistoryContract() {
  return `select
    to_regclass('private.erp_order_history_rows_v3046') is not null
    and not has_table_privilege('authenticated',to_regclass('private.erp_order_history_rows_v3046'),'SELECT')
    and not has_function_privilege('service_role',to_regprocedure('private.drain_erp_order_history_v3046()'),'EXECUTE')
    and position('freeze_erp_order_history_rows_v3046' in pg_get_functiondef(to_regprocedure(
      'private.fast_finish_live_ingest_v2369(text,jsonb,jsonb,text[],boolean)')))>0
    and position('read_erp_order_history_row_v3046' in pg_get_functiondef(to_regprocedure(
      'private.refresh_soc_order_history_v2366(text)')))>0
    and position('read_erp_order_history_row_v3046' in pg_get_functiondef(to_regprocedure(
      'private.refresh_reserve_history_v2366(text)')))>0 as installed`;
}

export function erpReserveHandoverGuardContract() {
  return erpOrderHandoverGuardContract('ph_reserves', ['assigned_to', 'assignedto', 'flyer_assigned']);
}

export function erpSocHandoverGuardContract() {
  return erpOrderHandoverGuardContract('ph_soc_master', ['assignedto', 'flyer_assigned']);
}

export function erpOrderHistoryWholeRowContract() {
  return `select strpos(prosrc,'source.unique_id,to_jsonb(source.*)')>0
    and strpos(prosrc,'to_jsonb(source)')=0
    and strpos(prosrc,'on conflict(dataset_key,file_id,source_uid) do nothing')>0
    and not has_function_privilege('service_role',oid,'EXECUTE') as installed
    from pg_proc where oid=to_regprocedure('private.freeze_erp_order_history_rows_v3046(text,text)')`;
}

function erpOrderHandoverGuardContract(table, fields) {
  const columns = fields.map(field => `'${field}'`).join(',');
  const predicate = fields.map(field => `new.${field}isnotnull`).join('or');
  return `select exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.${table}')
    and t.tgname='scheduled_handover_normalize_assignment' and t.tgtype=23 and t.tgenabled='O'
    and t.tgfoid=to_regprocedure('private.handover_normalize_assignment_v1()')
    and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
      where a.attrelid=t.tgrelid and a.attnum=any(t.tgattr::smallint[]))=array[${columns}]
    and regexp_replace(substring(lower(pg_get_triggerdef(t.oid,true)) from ' when (.*) execute function '),
      '[()[:space:]]','','g')='${predicate}') as installed`;
}
