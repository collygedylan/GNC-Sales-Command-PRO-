-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();

select has_column('public','ph_customer_consignee_sales_reps','raw_data','complete source rows retain all source fields');
select ok(not has_table_privilege('anon','public.ph_customer_consignee_sales_reps','select')
  and not has_table_privilege('authenticated','public.ph_customer_consignee_sales_reps','select'),'mapping table has no broad SELECT grant');
select ok(not has_column_privilege('anon','public.ph_customer_consignee_sales_reps','raw_data','select')
  and not has_column_privilege('authenticated','public.ph_customer_consignee_sales_reps','raw_data','select'),'source/contact JSON is private');
select ok(not has_function_privilege('authenticated','public.begin_customer_rep_mapping_import_v1(uuid,text,timestamptz,text,integer)','execute')
  and has_function_privilege('service_role','public.begin_customer_rep_mapping_import_v1(uuid,text,timestamptz,text,integer)','execute'),'only trusted importer can start publications');
select ok(not has_function_privilege('authenticated','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
  and has_function_privilege('service_role','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute'),'management RPC is restricted to authenticated app-api actor checks');
select ok((select coalesce(p.proconfig,'{}'::text[]) @> array['statement_timeout=55s']
  from pg_proc p where p.oid='public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure),
  'mapping finalizer has a function-local bounded statement timeout');
select ok(not has_function_privilege('authenticated','public.finalize_customer_rep_mapping_import_v1(uuid)','execute')
  and not has_function_privilege('anon','public.finalize_customer_rep_mapping_import_v1(uuid)','execute')
  and has_function_privilege('service_role','public.finalize_customer_rep_mapping_import_v1(uuid)','execute'),
  'bounded finalizer keeps its service-only execution boundary');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'sales_private.customer_rep_assignment_sources'::regclass,
  'sales_private.customer_rep_assignment_overrides'::regclass,
  'sales_private.customer_rep_assignment_receipts'::regclass))
  and not has_table_privilege('anon','sales_private.customer_rep_assignment_sources','select')
  and not has_table_privilege('authenticated','sales_private.customer_rep_assignment_overrides','select')
  and not has_table_privilege('authenticated','sales_private.customer_rep_assignment_receipts','select'),
  'assignment source, override, and receipt tables stay private under RLS');
select ok(sales_private.is_first_last_salesrep_name_v1('Zoë O’Neil - South TX')
  and sales_private.is_first_last_salesrep_name_v1('Chance Alldredge - South TX')
  and not sales_private.is_first_last_salesrep_name_v1('Interdivision')
  and not sales_private.is_first_last_salesrep_name_v1('Last, First'),
  'First Last validation accepts Unicode, compound names, and regions but rejects non-person labels');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('a9f00000-0000-4000-8000-000000000001','map-admin@example.invalid','{}','{}'),
 ('a9f00000-0000-4000-8000-000000000002','map-csr@example.invalid','{}','{}'),
 ('a9f00000-0000-4000-8000-000000000003','map-manager@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until) values
 ('a9f00000-0000-4000-8000-000000000001','map_admin','Mapping Admin','ADMIN',false,null,null),
 ('a9f00000-0000-4000-8000-000000000002','map_csr','Mapping CSR','CSR',false,null,null),
 ('a9f00000-0000-4000-8000-000000000003','map_manager','Mapping Manager','MANAGER',false,null,null)
on conflict(id) do update set role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,customername,customerstatus,
 consigneeid,consigneename,consigneestatus,salesrepid,salesrepname,raw_data) values
 ('map-test-row-1','00001','Map Customer ®','A','00009','Map Consignee ™','A','R1','Map Rep','{"PRIVATE_CONTACT":"restricted"}'),
 ('map-test-row-2','00002','Map Customer ®','A','00010','Map Consignee ™','A','R2','Other Rep','{}'),
 ('map-inactive','00003','Inactive Customer','I','00011','Inactive Consignee','A','R1','Map Rep','{}'),
 ('map-unassigned','00004','Unassigned Customer',null,'00012','Unassigned Consignee','A',null,null,'{}');
insert into sales_private.customer_rep_assignment_sources(unique_id,customeridentityid,consigneeid,salesrepid,salesrepname) values
 ('map-test-row-1','00001','00009','R1','Map Rep'),
 ('map-test-row-2','00002','00010','R2','Other Rep'),
 ('map-inactive','00003','00011','R1','Map Rep'),
 ('map-unassigned','00004','00012',null,null),
 ('map-alt-rep-1','00005','00015','R3','Ariana O’Neil'),
 ('map-alt-rep-2','00006','00016','R3','Different Name');
create temporary table mapping_before on commit drop as
 select revision from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps';

select is((public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000002','options',
 '{"page":0,"pageSize":10,"salesrepId":"R1"}')->>'total')::integer,1,'Request options exclude inactive and unassigned mappings');
select is((public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000002','options',
 '{"page":0,"pageSize":10,"salesrepId":"R1","customerId":"00002"}')->>'total')::integer,0,'dependent options intersect rep and external customer ID');
select ok(not ((public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000002','options',
 '{"page":0,"pageSize":10,"salesrepId":"R1"}')->'rows'->0) ? 'raw_data'),'Request options omit source details');
select is(jsonb_array_length(public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','list',
 '{"page":1,"pageSize":1,"sort":"salesrepid","direction":"asc","filters":{"status":"active"}}')->'rows'),1,'pagination is applied before JSON aggregation');
select is(public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','detail',
 '{"id":"map-test-row-1"}')->'row'->'raw_data'->>'PRIVATE_CONTACT','restricted','authorized management detail includes source fields');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000002','list','{}')$$,
 '42501','CUSTOMER_REP_MAPPING_FORBIDDEN','CSR cannot manage mappings');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000002','detail','{"id":"map-test-row-1"}')$$,
 '42501','CUSTOMER_REP_MAPPING_FORBIDDEN','CSR cannot read source details');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000002','reps','{}')$$,
 '42501','CUSTOMER_REP_MAPPING_FORBIDDEN','CSR cannot read assignment rep catalog');
select ok((public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','reps','{"q":"R1"}')
  ->'rows'->0->>'salesrepName')='Map Rep'
  and (public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','reps','{"q":"R3"}')
  ->>'total')='0'
  and (public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','reps','{"q":"S99"}')
  ->>'total')='0', 'rep catalog keeps canonical names and excludes ambiguous IDs and S99');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','save',
 '{"id":"map-test-row-1","expectedRevision":"1","salesrepId":"UNKNOWN","salesrepName":"Unknown Rep","customerName":"Manual Customer","consigneeName":"Map Consignee ™"}')$$,
 '22023','CUSTOMER_REP_MAPPING_REP_UNVERIFIED','unknown external rep cannot be invented by a mapping correction');
-- Each RPC is a separate HTTP transaction in production. This rollback fixture
-- shares one transaction, so reset only its per-request revision deduplicator.
select set_config('app_sync.touched','{}',true);
select is(public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','save',
 '{"id":"map-test-row-1","expectedRevision":"1","salesrepId":"R1","salesrepName":"Map Rep","customerName":"Manual Customer","consigneeName":"Map Consignee ™"}')->'row'->>'revision','2','Admin can correct a mapped external rep without requiring an app login for that rep');
select is((select mapping_updated_by from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'map_admin','editor is stamped from the stored profile');
select ok((select revision>(select revision from mapping_before) from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'),'confirmed save publishes a dataset revision');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','save',
 '{"id":"map-test-row-1","expectedRevision":"1","salesrepId":"R1","salesrepName":"Map Rep","customerName":"Stale","consigneeName":"Map Consignee ™"}')$$,
 '40001','CUSTOMER_REP_MAPPING_CONFLICT','stale writes are rejected');
select lives_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000003','save',
 '{"id":"map-inactive","expectedRevision":"1","salesrepId":"R1","salesrepName":"Map Rep","customerName":"Corrected Inactive Customer","consigneeName":"Inactive Consignee"}')$$,
 'Manager may correct display mappings without activating an inactive customer');
select is((select customerstatus from public.ph_customer_consignee_sales_reps where unique_id='map-inactive'),'I','editing never activates an inactive customer');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','save',
 '{"id":"map-test-row-1","expectedRevision":"2","salesrepId":"R3","salesrepName":"Ariana O’Neil","customerName":"Manual Customer","consigneeName":"Map Consignee ™"}')$$,
 '22023','CUSTOMER_REP_MAPPING_REP_UNVERIFIED','legacy save cannot use a rep ID with ambiguous canonical names');

select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok($$insert into public.ph_active_request(unique_id,requested_by,request_source,customeridentityid,customername,consigneeidentityid,consigneename)
 values('map-request-valid','Map Rep','general','00001','Manual Customer','00009','Map Consignee ™')$$,'valid mapped Request is accepted');
select throws_ok($$insert into public.ph_active_request(unique_id,requested_by,request_source,customeridentityid,customername,consigneeidentityid,consigneename)
 values('map-request-invalid','Map Rep','general','00001','Manual Customer','00010','Map Consignee ™')$$,
 '22023','REQUEST_CUSTOMER_MAPPING_REQUIRED','same display name with a different consignee ID cannot bypass the relation');
select throws_ok($$insert into public.ph_active_request(unique_id,requested_by,request_source,customeridentityid,customername,consigneeidentityid,consigneename)
 values('map-request-spoof-source','Map Rep','internal','00001','Manual Customer','00009','Map Consignee ™')$$,
 '22023','REQUEST_CUSTOMER_MAPPING_REQUIRED','authenticated callers cannot spoof an internal source');
select throws_ok($$update public.ph_active_request set request_selected_rep_display='Other Rep' where unique_id='map-request-valid'$$,
 '22023','REQUEST_CUSTOMER_MAPPING_REQUIRED','changing only the selected rep revalidates membership');
select throws_ok($$update public.ph_active_request set requested_by='Other Rep' where unique_id='map-request-valid'$$,
 '22023','REQUEST_CUSTOMER_MAPPING_REQUIRED','changing the requested rep revalidates membership');

select is(public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000003','assign',
 '{"id":"map-test-row-1","expectedRevision":"2","requestId":"4d59b4e8-7847-4a66-9cb7-dc9fcbb74c24","salesrepId":"R2"}')
  ->'row'->>'salesrepname','Other Rep','manager assignment uses canonical ID/name from source');
select is((select count(*)::integer from sales_private.customer_rep_assignment_overrides
  where customeridentityid='00001' and consigneeid='00009'),1,'manual assignment is stored by stable customer/consignee IDs');
select is(public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000003','assign',
 '{"id":"map-test-row-1","expectedRevision":"2","requestId":"4d59b4e8-7847-4a66-9cb7-dc9fcbb74c24","salesrepId":"R2"}')
  ->'row'->>'revision','3','exact assignment retry returns its original result');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000003','assign',
 '{"id":"map-test-row-1","expectedRevision":"2","requestId":"4d59b4e8-7847-4a66-9cb7-dc9fcbb74c24","salesrepId":"R1"}')$$,
 '22023','CUSTOMER_REP_MAPPING_VALUE_INVALID','request ID cannot be reused for a different assignment');
select throws_ok($$select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000003','assign',
 '{"id":"map-test-row-1","expectedRevision":"3","requestId":"4d59b4e8-7847-4a66-9cb7-dc9fcbb74c25","salesrepId":"S99"}')$$,
 '22023','CUSTOMER_REP_MAPPING_REP_UNVERIFIED','S99 cannot be selected for a new assignment');
insert into sales_private.customer_rep_assignment_overrides(customeridentityid,consigneeid,salesrepid,salesrepname,updated_by)
 values('DORMANT-CUSTOMER','DORMANT-CONSIGNEE','R1','Map Rep','map_manager');

-- Reusable synthetic source record: unknown fields, Unicode and leading zeros
-- remain raw text; no production customer data is part of this fixture.
create function pg_temp.mapping_source(uid text,row_no integer,cid text,cname text,did text,dname text,rid text,rname text,cstatus text default 'A')
returns jsonb language sql as $source$
 select jsonb_build_object('unique_id',uid,'source_row_number',row_no,
 'raw_data',jsonb_build_object('CUSTOMERIDENTITYID',cid,'CUSTOMERNAME',cname,'CONSIGNEEID',did,'CONSIGNEENAME',dname,
 'SALESREPID',coalesce(rid,''),'SALESREPNAME',coalesce(rname,''),'CUSTOMERSTATUS',coalesce(cstatus,''),'CONSIGNEESTATUS','A','UNKNOWN_CONTACT_FIELD','原文 00007'),
 'row',jsonb_build_object('unique_id',uid,'customeridentityid',cid,'customername',cname,'consigneeid',did,'consigneename',dname,
 'salesrepid',rid,'salesrepname',rname,'customerstatus',cstatus,'consigneestatus','A','source_row_number',row_no,
 'filename','synthetic.csv','source_file_name','synthetic.csv','row_hash','source-'||uid,'imported_at','2026-10-10T12:00:00Z','updated_at','2026-10-10T12:00:00Z'))
$source$;
create temporary table mapping_source_rows(seq integer,payload jsonb) on commit drop;
insert into mapping_source_rows values
 (1,pg_temp.mapping_source('map-test-row-1',3,'00001','Master Customer ®','00009','Map Consignee ™','R1','Map Rep')),
 (2,pg_temp.mapping_source('map-import-unassigned',5,'00005','Unassigned Master','00013','Master Consignee',null,null,null));
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000100',
 'empty.csv','2026-10-10T12:00:00Z',repeat('a',64),0)$$,'22023','CUSTOMER_REP_IMPORT_MANIFEST_INVALID','empty snapshots cannot begin publication');
select is((public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000101',
 'synthetic.csv','2026-10-10T12:00:00Z',repeat('a',64),2)->>'stagedRows')::integer,0,'new run starts at zero');
select is((public.stage_customer_rep_mapping_rows_v1('a9f00000-0000-4000-8000-000000000101',
 (select jsonb_agg(payload) from mapping_source_rows where seq=1))->>'stagedRows')::integer,1,'staging advances the durable cursor');
select is((public.stage_customer_rep_mapping_rows_v1('a9f00000-0000-4000-8000-000000000101',
 (select jsonb_agg(payload) from mapping_source_rows where seq=1))->>'stagedRows')::integer,1,'exact staged retry is idempotent');
select is(public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000102',
 'synthetic.csv','2026-10-10T12:00:00Z',repeat('a',64),2)->>'runId','a9f00000-0000-4000-8000-000000000101','same manifest resumes its original run');
select is((public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000102',
 'synthetic.csv','2026-10-10T12:00:00Z',repeat('a',64),2)->>'stagedRows')::integer,1,'resume returns the authoritative prefix length');
select throws_ok($$select public.finalize_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000101')$$,
 '22023','CUSTOMER_REP_IMPORT_INCOMPLETE','incomplete snapshots cannot publish or delete');
select is((select customername from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'Manual Customer','staging/incomplete publication leave corrections intact');
select throws_ok($$select public.stage_customer_rep_mapping_rows_v1('a9f00000-0000-4000-8000-000000000101',
 jsonb_build_array(pg_temp.mapping_source('out-of-order',2,'C0','C','D0','D','R1','Map Rep')))$$,
 '22023','CUSTOMER_REP_IMPORT_ROWS_OUT_OF_ORDER','new chunks cannot insert before an acknowledged prefix');
select is((public.stage_customer_rep_mapping_rows_v1('a9f00000-0000-4000-8000-000000000101',
 (select jsonb_agg(payload) from mapping_source_rows where seq=2))->>'stagedRows')::integer,2,'blank physical row gaps do not break prefix resume');
select is((public.finalize_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000101')->>'rowCount')::integer,2,'complete snapshot publishes atomically');
select is((select customername from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'Master Customer ®','successful source publication replaces manual correction');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'Other Rep','manual assignment wins over later full import');
select is((select count(*)::integer from sales_private.customer_rep_assignment_sources),'2','successful import atomically replaces latest-source snapshot');
select is((select count(*)::integer from sales_private.customer_rep_assignment_overrides
  where customeridentityid='DORMANT-CUSTOMER' and consigneeid='DORMANT-CONSIGNEE'),1,'override remains dormant when a future snapshot omits its pair');
select is((select count(*)::integer from public.ph_customer_consignee_sales_reps),2,'relationships absent from the new full snapshot are removed');
select is((select raw_data->>'UNKNOWN_CONTACT_FIELD' from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'原文 00007','unknown source fields preserve Unicode and leading zeros');
select is((select customeridentityid from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'00001','typed external identity retains leading zeros');
select is((public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000002','options','{}')->>'total')::integer,1,'retained blank status/unassigned rows remain unselectable');
select is(public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000003','reset',
 jsonb_build_object('id','map-test-row-1','expectedRevision',(select mapping_revision::text from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),
  'requestId','4d59b4e8-7847-4a66-9cb7-dc9fcbb74c26'))->'row'->>'salesrepname','Map Rep','reset restores the newest imported rep including source-only choices');
select is((select count(*)::integer from sales_private.customer_rep_assignment_overrides
  where customeridentityid='00001' and consigneeid='00009'),0,'reset removes the persistent override');
select lives_ok($$update public.ph_active_request set request_note='Historical note survives new mapping' where unique_id='map-request-valid'$$,'existing queued Request survives mapping replacement');
select is((select customername from public.ph_active_request where unique_id='map-request-valid'),'Manual Customer','historical Request snapshot remains unchanged');

-- The finalizer's import token is transaction-local; a later management call
-- arrives in a fresh request without that token in production.
select set_config('request.headers','{}',true);
select set_config('app_sync.touched','{}',true);
select public.customer_rep_mapping_manage_v1('a9f00000-0000-4000-8000-000000000001','save',
 jsonb_build_object('id','map-test-row-1','expectedRevision',(select mapping_revision::text from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),
 'salesrepId','R1','salesrepName','Map Rep','customerName','After Publish Correction','consigneeName','Map Consignee ™'));
select is(public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000103',
 'synthetic.csv','2026-10-10T12:00:00Z',repeat('a',64),2)->>'alreadyPublished','true','archive retry recognizes already published source');
select is(public.finalize_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000101')->>'idempotent','true','finalize retry does not import again');
select is((select customername from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'After Publish Correction','archive retry cannot erase newer manual changes');
select throws_ok($$select public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000104',
 'older.csv','2026-10-09T12:00:00Z',repeat('b',64),2)$$,'22023','CUSTOMER_REP_IMPORT_STALE_SOURCE','older source cannot restore stale mappings');

select public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000105',
 'malformed.csv','2026-10-11T12:00:00Z',repeat('c',64),2);
select throws_ok($$select public.stage_customer_rep_mapping_rows_v1('a9f00000-0000-4000-8000-000000000105',
 jsonb_build_array(pg_temp.mapping_source('missing-header',3,'C0','C','D0','D','R1','Map Rep') #- '{raw_data,CONSIGNEESTATUS}'))$$,
 '22023','CUSTOMER_REP_IMPORT_REQUIRED_SOURCE_FIELD_MISSING','missing required source headers are rejected in SQL');
select public.stage_customer_rep_mapping_rows_v1('a9f00000-0000-4000-8000-000000000105',
 jsonb_build_array(pg_temp.mapping_source('duplicate-1',3,'DUPC','C','DUPD','D','R1','Map Rep'),
 pg_temp.mapping_source('duplicate-2',4,'DUPC','C','DUPD','D','R1','Map Rep')));
select throws_ok($$select public.finalize_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000105')$$,
 '23505','CUSTOMER_REP_IMPORT_DUPLICATE_RELATIONSHIP','different row IDs cannot hide duplicate source relationships');
select is((select customername from public.ph_customer_consignee_sales_reps where unique_id='map-test-row-1'),'After Publish Correction','rejected malformed snapshots preserve the live corrected directory');

update sales_private.customer_rep_mapping_import_runs set status='failed',finished_at=clock_timestamp()
 where run_id='a9f00000-0000-4000-8000-000000000105';
delete from sales_private.customer_rep_mapping_import_stage where run_id='a9f00000-0000-4000-8000-000000000105';
insert into sales_private.customer_rep_assignment_overrides(customeridentityid,consigneeid,salesrepid,salesrepname,updated_by)
 values('DUP-OVERRIDE-CUSTOMER','DUP-OVERRIDE-CONSIGNEE','R1','Map Rep','map_manager');
select public.begin_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000106',
 'ambiguous-override.csv','2026-10-12T12:00:00Z',repeat('d',64),2);
select public.stage_customer_rep_mapping_rows_v1('a9f00000-0000-4000-8000-000000000106',jsonb_build_array(
 pg_temp.mapping_source('override-source-1',3,'DUP-OVERRIDE-CUSTOMER','C','DUP-OVERRIDE-CONSIGNEE','D','R1','Map Rep'),
 pg_temp.mapping_source('override-source-2',4,'DUP-OVERRIDE-CUSTOMER','C','DUP-OVERRIDE-CONSIGNEE','D','R2','Other Rep')));
select throws_ok($$select public.finalize_customer_rep_mapping_import_v1('a9f00000-0000-4000-8000-000000000106')$$,
 '23505','CUSTOMER_REP_ASSIGNMENT_IMPORT_AMBIGUOUS_OVERRIDE','ambiguous duplicate pair cannot replace source rows under an override');
select is((select count(*)::integer from public.ph_customer_consignee_sales_reps),2,'ambiguous overridden import leaves the published mapping intact');

select * from finish();
rollback;
