begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- New source aliases must carry immutable ERP stock through the guarded UPSERT,
-- just as known physical identities do through the direct UPDATE.
do $alias$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  anchor text := '    alias_select_values := replace(select_values, ''s.unique_id'', ''coalesce(mapped.canonical_unique_id,s.unique_id)'');';
  condition_anchor text := ') and (%s)) or private.ph_master_bulk_pending_ack_v1(mapped.canonical_unique_id, s.raw_values))';
  stock_delta text := '(target.erp_on_hand,target.erp_ptrreview,target.erp_available,target.erp_source_present) is distinct from (excluded.erp_on_hand,excluded.erp_ptrreview,excluded.erp_available,true)';
  existing_delta text := '(existing.erp_on_hand,existing.erp_ptrreview,existing.erp_available,existing.erp_source_present) is distinct from (s.frozen_erp_on_hand_v3048,s.frozen_erp_review_v3048,s.frozen_erp_available_v3048,true)';
begin
  if strpos(definition,anchor)=0 or strpos(definition,condition_anchor)=0 then
    raise exception 'ERP_ALIAS_STOCK_UPDATE_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,condition_anchor,left(condition_anchor,-1)||' or ('||existing_delta||'))');
  execute replace(definition,anchor,$insert$
    column_names := column_names || ',erp_on_hand,erp_ptrreview,erp_available,erp_source_filename,erp_source_present';
    select_values := select_values || ',s.frozen_erp_on_hand_v3048,s.frozen_erp_review_v3048,s.frozen_erp_available_v3048,
      coalesce(s.raw_values->>''filename'',s.filename),true';
    set_values := set_values || ',erp_on_hand=excluded.erp_on_hand,erp_ptrreview=excluded.erp_ptrreview,
      erp_available=excluded.erp_available,erp_source_present=true,erp_source_filename=case when $insert$||stock_delta||$insert$
      then coalesce(excluded.erp_source_filename,' || case when 'filename'=any(tuple_value.field_keys)
        then 'excluded.filename' else 'target.filename' end || ') else target.erp_source_filename end';
    changed_predicate := changed_predicate || ' or ($insert$||stock_delta||$insert$)';
$insert$||anchor);
end
$alias$;

commit;
