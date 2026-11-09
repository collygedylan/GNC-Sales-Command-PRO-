-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(16);

select ok((select prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='public.save_request_work(text,bigint,jsonb,boolean)'::regprocedure),
  'request save wrapper remains security definer with a pinned search path');
select ok((select prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure),
  'request save implementation remains security definer with a pinned search path');
select ok((select prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='public.inventory_location_on_hand_read_v1(uuid,jsonb,text)'::regprocedure),
  'inventory reader remains security definer with a pinned search path');
select ok(not has_function_privilege('authenticated','public.save_request_work(text,bigint,jsonb,boolean)','execute')
  and has_function_privilege('service_role','public.save_request_work(text,bigint,jsonb,boolean)','execute')
  and not has_function_privilege('anon','public.save_request_work(text,bigint,jsonb,boolean)','execute'),
  'request save wrapper is available only through the service boundary');
select ok(not has_function_privilege('authenticated','public.save_request_work_v1(text,bigint,jsonb,boolean)','execute')
  and has_function_privilege('service_role','public.save_request_work_v1(text,bigint,jsonb,boolean)','execute')
  and not has_function_privilege('anon','public.save_request_work_v1(text,bigint,jsonb,boolean)','execute'),
  'request save implementation retains service-only grants');
select ok(not has_function_privilege('authenticated','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute')
  and has_function_privilege('service_role','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute')
  and not has_function_privilege('anon','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute'),
  'inventory reader retains service-only grants');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000009901','conflict-http-status@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000009901','conflict_http_fixture','Conflict HTTP Fixture','CSR',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,customername,
  consigneeid,consigneename,salesrepid,salesrepname,customerstatus,consigneestatus)
values('CONFLICT-HTTP-MAP','CONFLICT-HTTP-CUSTOMER','Conflict Customer','CONFLICT-HTTP-CONSIGNEE',
  'Conflict Consignee','CONFLICT-HTTP-REP','Conflict HTTP Fixture','A','A');
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,priority)
values('CONFLICT-HTTP-MASTER','CONFLICT-HTTP-ITEM','Conflict Test Plant','#3','C.01.001','27.F1','10','1')
on conflict(unique_id) do update set itemcode=excluded.itemcode,commonname=excluded.commonname,
  contsize=excluded.contsize,locationcode=excluded.locationcode,lotcode=excluded.lotcode,
  ptravailable=excluded.ptravailable,priority=excluded.priority;
update public.app_dataset_revisions set state='ready',revision=greatest(revision,1)
where key='ph_master_inventory';

set local role authenticated;
select set_config('request.jwt.claim.sub','9f8b0000-0000-4000-8000-000000009901',true);
select lives_ok($q$select public.create_request_batch(
  '9f8b0000-0000-4000-8000-000000009911',
  '[{"unique_id":"CONFLICT-HTTP-REQUEST","master_id":"CONFLICT-HTTP-MASTER","requested_by":"Conflict HTTP Fixture",
    "request_folder":"CONFLICT-HTTP-FOLDER","req_customer":"Conflict Customer","req_qty":"1",
    "customeridentityid":"CONFLICT-HTTP-CUSTOMER","customername":"Conflict Customer",
    "consigneeidentityid":"CONFLICT-HTTP-CONSIGNEE","consigneename":"Conflict Consignee",
    "request_selected_salesrep_id":"CONFLICT-HTTP-REP","request_selected_rep_display":"Conflict HTTP Fixture"}]'::jsonb
)$q$,'isolated fixture request is created through the authorized request API');
select throws_ok($q$select public.save_request_work('CONFLICT-HTTP-REQUEST',1,'{"req_comments":"saved"}'::jsonb,false)$q$,
  '42501',null,'browser role cannot bypass the service save boundary');

set local role service_role;
select lives_ok($q$select public.save_request_work('CONFLICT-HTTP-REQUEST',1,'{"req_comments":"saved"}'::jsonb,false)$q$,
  'current request version still saves successfully');
reset role;
select cmp_ok((select row_version from public.ph_requests_pending where unique_id='CONFLICT-HTTP-REQUEST'),'>',1::bigint,
  'successful request save advances its row version');
set local role service_role;
select throws_ok($q$select public.save_request_work('CONFLICT-HTTP-REQUEST',1,'{}'::jsonb,false)$q$,
  'PT409','REQUEST_VERSION_CONFLICT','stale save wrapper returns the application conflict code');
select lives_ok($q$select public.save_request_work_v1('CONFLICT-HTTP-REQUEST',1,'{"req_comments":"latest"}'::jsonb,false)$q$,
  'the authorized Request writer accepts a stale client version');
reset role;
select is((select req_comments from public.ph_requests_pending where unique_id='CONFLICT-HTTP-REQUEST'),
  'latest','the latest successful Request work is durable');
set local role service_role;
select lives_ok($q$select public.inventory_location_on_hand_read_v1(
  '9f8b0000-0000-4000-8000-000000009901',
  '[{"itemcode":"CONFLICT-HTTP-ITEM","locationcode":"C.01.001"}]'::jsonb,
  (select revision::text from public.app_dataset_revisions where key='ph_master_inventory'))$q$,
  'inventory aggregate read succeeds with the current source revision');
select ok(public.inventory_location_on_hand_read_v1(
  '9f8b0000-0000-4000-8000-000000009901','[]'::jsonb,'stale-revision')
  @> '{"retained":true,"retryable":true,"revisionChanged":true,"rows":[]}'::jsonb,
  'stale inventory revision asks the caller to retain and retry');
update public.app_dataset_revisions set state='importing' where key='ph_master_inventory';
select ok(public.inventory_location_on_hand_read_v1(
  '9f8b0000-0000-4000-8000-000000009901','[]'::jsonb,null)
  @> '{"retained":true,"retryable":true,"sourceNotReady":true,"rows":[]}'::jsonb,
  'an unready source keeps the existing UI data available for retry');

select * from finish();
rollback;
