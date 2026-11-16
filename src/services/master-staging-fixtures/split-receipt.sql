create or replace function pg_temp.v2313_split_receipt(v_prefix text,v_rows jsonb,v_before jsonb,v_after jsonb,
 v_response jsonb,v_state text,v_error text,v_run uuid) returns jsonb language sql as $receipt$
select jsonb_build_object('state',v_state,'error',v_error,'response',v_response,
   'liveRows',(select count(*) from public.ph_master_inventory where unique_id like v_prefix||'%'),
   'newPresent',exists(select 1 from public.ph_master_inventory where unique_id=v_prefix||'new'),
   'atomicUnchanged',v_before=v_after,
   'appPreserved',(select count(*)=2 and bool_and(
    row(m.holdstopcode,m.holdstopreason,m.locationnote,m.photo_link,m.photo_name,m.assignedto)
     is not distinct from row('APP-'||right(m.unique_id,1),'App reason '||right(m.unique_id,1),
      'App note '||right(m.unique_id,1),'https://example.invalid/'||right(m.unique_id,1)||'.jpg',
      'photo-'||right(m.unique_id,1),'dylan_collyge'))
    from public.ph_master_inventory m where m.unique_id in(v_prefix||'a',v_prefix||'b')),
   'quantityMetadataExact',(select count(*)=3 and bool_and(
    row(m.ptronhand,m.ptravailable,m.filename,m.last_updated)
     is not distinct from row(expected.ptronhand,expected.ptravailable,'split-canary.xlsx',
      '2026-10-19T20:00:00Z'::timestamptz))
    from public.ph_master_inventory m join(values('a','11','10'),('b','22','20'),('new','33','30'))
     expected(suffix,ptronhand,ptravailable) on m.unique_id=v_prefix||expected.suffix),
   'sourceRows',v_rows,'siblingsBefore',v_before,'siblingsAfter',v_after,
   'publishedRows',(select jsonb_agg(to_jsonb(m) order by m.unique_id)
    from public.ph_master_inventory m where m.unique_id like v_prefix||'%'))
||jsonb_build_object('designationReceipt',(
 select jsonb_build_object('uid',a.canonical_unique_id,'status',a.reconciliation_status,
  'absorbed',a.absorbed_by_erp,'same_run',a.sync_run_id=v_run and d.import_run_id=v_run,
  'app_value',d.app_update_row->>'desigcust','erp_value',d.report_update_row->>'desigcust')
 from public.app_row_actions a join public.ph_action_discrepancies d on d.action_id=a.id
 where a.canonical_unique_id=v_prefix||'a' and a.changed_fields @> array['desigcust']
 order by a.id desc limit 1));
$receipt$;
