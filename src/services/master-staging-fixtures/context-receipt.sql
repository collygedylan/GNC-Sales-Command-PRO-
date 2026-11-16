create or replace function pg_temp.v2313_context_receipt(v_run uuid,v_prefix text,v_values jsonb,
 v_rows jsonb,v_fields jsonb,v_receipt jsonb) returns jsonb language sql as $context$
select jsonb_build_object(
        'contextCount',(select context_count from pg_temp.v2313_context_probe_control),
        'provenCount',(select proven_count from pg_temp.v2313_context_probe_control),
        'witnessValid',(select witness_valid from pg_temp.v2313_context_probe_control),
        'fallbackExact',(select fallback_context=jsonb_build_object('values',v_values,'rawFields',v_fields,
          'hash',private.ph_master_bulk_source_hash_v1(v_values,array(select jsonb_array_elements_text(v_fields)))) from pg_temp.v2313_context_probe_control),
        'protected',(select holdstopcode='APP-H' and holdstopreason='App hold reason' and locationnote='App location note'
          from public.ph_master_inventory where unique_id=v_prefix||'3'),
        'baselineExact',(select count(*)=3 and bool_and(b.source_unique_id=s.row_value#>>'{values,unique_id}'
          and b.source_hash=private.ph_master_bulk_source_hash_v1(s.row_value->'values',array(select jsonb_array_elements_text(v_fields))))
          from jsonb_array_elements(v_rows) s(row_value) join app_sync_private.ph_master_bulk_import_source_v1 b
            on b.canonical_unique_id=s.row_value#>>'{values,unique_id}'),
        'contextClean',not exists(select 1 from app_sync_private.ph_master_bulk_import_context_v1 where run_id=v_run),
        'receipt',v_receipt);
$context$;
