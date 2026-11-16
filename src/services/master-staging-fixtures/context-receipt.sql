create or replace function pg_temp.v2313_context_receipt(v_run uuid,v_prefix text,v_values jsonb,
 v_rows jsonb,v_fields jsonb,v_receipt jsonb) returns jsonb language sql as $context$
select jsonb_build_object('insert',inserted_crop,'update',updated_crop,'delete',deleted_crop);
    else
      select jsonb_agg(jsonb_build_object('values',jsonb_build_object(
        'unique_id',v_prefix||g.n,'itemcode','CTX-'||p_case||'-'||g.n,
        'commonname','Context source row '||g.n,'contsize','#1','locationcode','Z.98.00'||g.n,
        'lotcode','27.CANARY','source','PH','warehouseid','10','priority','2',
        'holdstopcode','SOURCE-H','holdstopreason','Source hold reason','locationnote','Source location note',
        'desigitem','A','desigcust',null,'desigloc',null,'locationptn1','Source pattern',
        'oversellpercentage',null,'pullerresponsibility',null,'salesnote','Source note','suspend',null,
        'last_updated','2026-10-19T20:00:00Z','filename','context-canary.xlsx','concat','context-source'),
        'rawFields',v_fields) order by g.n) into v_rows from generate_series(1,3) g(n);
      insert into pg_temp.v2313_context_probe_control(race_enabled,run_id,request_id,race_uid)
      values(p_case='race',v_run,v_req,v_prefix||'3');
      execute 'create trigger aa001_v2313_context_statement_probe before insert on public.ph_master_inventory for each statement execute function pg_temp.v2313_context_statement_probe()';
      execute 'create trigger zz_v2313_context_row_probe after update on public.ph_master_inventory for each row execute function pg_temp.v2313_context_row_probe()';
      perform public.begin_dataset_import_v1(array['ph_master_inventory'],v_run,array['ph_master_inventory']);
      perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',v_run::text)::text,true);
      perform public.begin_master_snapshot_stage_v1(v_run,v_req,
        jsonb_build_array(jsonb_build_object('fileId','context-'||p_case,'modifiedAt','2026-10-19T20:00:00Z','size',1024)),repeat('e',64),3,1);
      perform public.append_master_snapshot_stage_chunk_v1(v_run,v_req,0,v_rows);
      v_receipt:=public.finalize_master_snapshot_stage_v2374_base(v_run,v_req,repeat('e',64));
      v_values:=v_rows#>'{2,values}';
      result_value:=jsonb_build_object(
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
