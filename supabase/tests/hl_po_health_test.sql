-- Disposable fixtures: health reads must never refresh source dates or balances.
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
create temporary table po_health_checks(description text);
create function pg_temp.po_health_check(value boolean,description text) returns void language plpgsql as $$
begin
 if value is distinct from true then raise exception 'PO health: %',description; end if;
 insert into po_health_checks values(description);
end $$;

do $$
declare id_value uuid:=gen_random_uuid(); snapshot jsonb; original jsonb; lines jsonb;
begin
 lines:='[{"item_code":"HEALTH-A","size":"#3","lot":"27.F1","po_ordered":15,"po_remain":12},
          {"item_code":"HEALTH-B","size":"#3","lot":"27.F1","po_ordered":5,"po_remain":-1},
          {"item_code":"HEALTH-C","size":"#3","lot":"27.S1","po_ordered":20,"po_remain":20}]';
 insert into hl_order_private.po_imports(id,run_id,status,source_format,created_at,completed_at,
   report_date,row_count,fingerprint,receipt_cutoff,reconciled_by,reconciled_at,metadata)
 values(id_value,'health-fixture','staging','pdf',now()-interval '8 days',now()-interval '7 days',
   ((now()-interval '9 days') at time zone 'America/Chicago')::date,3,repeat('e',64),now()-interval '9 days',gen_random_uuid(),now()-interval '6 days',
   jsonb_build_object('source_file_id','health-pdf-fixture','source_file_name','Health.pdf','page_count',1,
     'fingerprint',repeat('e',64),'parser_version','fixture-v1','report_printed_at',now()-interval '9 days'));
 insert into hl_order_private.po_import_rows(import_id,source_file_id,row_index,source)
   select id_value,'health-pdf-fixture',10000+n::integer,line
   from jsonb_array_elements(lines) with ordinality as entries(line,n);
 insert into hl_order_private.po_pdf_pages values(id_value,1,lines);
 update hl_order_private.po_imports set status='reconciled' where id=id_value;
 update hl_order_private.po_control set active_import_id=id_value,active_scope=id_value::text,
   receipt_cutoff=now()-interval '9 days' where singleton;
 perform hl_order_private.po_refresh_balances();
 select jsonb_agg(to_jsonb(p) order by id) into original from public.ph_27f1_hl_po p;
 snapshot:=public.get_po_management_health_snapshot();
 perform pg_temp.po_health_check(snapshot->>'freshness_mode'='manual_pdf','confirmed PDFs use manual replacement');
 perform pg_temp.po_health_check(snapshot->'pdf_report_valid'='true','old complete confirmed PDF remains valid');
 perform pg_temp.po_health_check(snapshot->'source_authority_valid'='true','confirmed active source is authoritative');
 perform pg_temp.po_health_check(snapshot->'projection_matches_ledger'='true','both seasonal projections match');
 perform pg_temp.po_health_check((snapshot->>'row_count')::integer=3,'detail and grouped counts stay distinct');
 perform pg_temp.po_health_check((snapshot->>'review_balance_count')::integer=1,'negative report balances remain reviewable');
 perform pg_temp.po_health_check((snapshot->>'latest_built_at')::timestamptz=now()-interval '6 days','real confirmation date retained');
 perform pg_temp.po_health_check(original=(select jsonb_agg(to_jsonb(p) order by id) from public.ph_27f1_hl_po p),'health is read-only');
 insert into hl_order_private.po_imports(run_id,status,source_format) values('health-newer-pending','pending','pdf');
 snapshot:=public.get_po_management_health_snapshot();
 perform pg_temp.po_health_check(snapshot->'pdf_report_valid'='true' and (snapshot->>'pending_pdf_count')::integer=1,'new pending report does not replace confirmed source');
 update public.ph_27s1_hl_po set po_remain=19 where run_id=id_value::text;
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'projection_matches_ledger'='false','incorrect receipt-adjusted balance fails');
 perform hl_order_private.po_refresh_balances();
 update hl_order_private.po_imports set metadata=metadata||'{"page_count":2}' where id=id_value;
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'pdf_report_valid'='false','incomplete PDF pages fail');
 update hl_order_private.po_imports set metadata=metadata||'{"page_count":1}',reconciled_at=now()+interval '1 day' where id=id_value;
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'pdf_report_valid'='false','future confirmation fails');
 update hl_order_private.po_imports set reconciled_at=now()-interval '6 days' where id=id_value;
 update hl_order_private.po_control set receipt_cutoff=now() where singleton;
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'pdf_report_valid'='false','changed receipt cutoff fails');
 update hl_order_private.po_control set receipt_cutoff=now()-interval '9 days' where singleton;
 update hl_order_private.po_control set active_import_id=null where singleton;
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'source_authority_valid'='false','missing active PDF cannot downgrade to legacy');
 update hl_order_private.po_control set active_import_id=id_value where singleton;
 update hl_order_private.po_imports set metadata=metadata||'{"report_printed_at":"invalid"}' where id=id_value;
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'pdf_report_valid'='false','invalid printed timestamp fails');
 update hl_order_private.po_imports set metadata=metadata||jsonb_build_object('report_printed_at',now()+interval '1 day') where id=id_value;
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'pdf_report_valid'='false','future printed timestamp fails');
 update hl_order_private.po_imports set metadata=metadata||jsonb_build_object('report_printed_at',now()-interval '9 days') where id=id_value;
 insert into public.ph_27f1_hl_po(source_file_id,row_index,run_id,item_code,lot,size,po_remain,imported_at)
   values('health-wrong-visible-run',1,'wrong-run','HEALTH-WRONG','27.F1','#3',1,now());
 perform pg_temp.po_health_check(public.get_po_management_health_snapshot()->'projection_matches_ledger'='false','wrong latest visible report fails');
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin perform public.get_po_management_health_snapshot(); raise exception 'Expected service-only rejection';
 exception when insufficient_privilege then
   if sqlerrm<>'PO_MANAGEMENT_HEALTH_FORBIDDEN' then raise; end if;
 end;
 perform pg_temp.po_health_check(not has_function_privilege('authenticated','public.get_po_management_health_snapshot()','execute'),'no browser execution grant');
end $$;
select plan(1);
select ok((select count(*) from po_health_checks)>=18,'PDF health provenance, projection, dates, privacy and read-only checks');
select * from finish();
rollback;
