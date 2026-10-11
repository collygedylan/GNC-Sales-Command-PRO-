-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(34);

select has_function('public','historical_requests_read_v1',array['jsonb'],'authenticated historical requests RPC is installed');
select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=10s']
  from pg_proc where oid='public.historical_requests_read_v1(jsonb)'::regprocedure),'RPC is a bounded security definer with an empty search path');
select ok(has_function_privilege('authenticated','public.historical_requests_read_v1(jsonb)','execute')
  and not has_function_privilege('anon','public.historical_requests_read_v1(jsonb)','execute')
  and not has_function_privilege('service_role','public.historical_requests_read_v1(jsonb)','execute'),
  'only signed-in authenticated clients can call this user-bound RPC');
select ok(exists(select 1 from private.navigation_view_catalog where view_key='historical-requests' and parent_key='sales' and selectable),
  'the sales navigation catalog contains the new view');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values
 ('e7410000-0000-4000-8000-000000000001','hist-rep-a@example.invalid','{}','{}'),
 ('e7410000-0000-4000-8000-000000000002','hist-rep-b@example.invalid','{}','{}'),
 ('e7410000-0000-4000-8000-000000000003','hist-manager@example.invalid','{}','{}'),
 ('e7410000-0000-4000-8000-000000000004','hist-dylan@example.invalid','{}','{}'),
 ('e7410000-0000-4000-8000-000000000005','hist-admin@example.invalid','{}','{}'),
 ('e7410000-0000-4000-8000-000000000006','hist-inactive@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values
 ('e7410000-0000-4000-8000-000000000001','hist_rep_a','History Rep A','REP',false),
 ('e7410000-0000-4000-8000-000000000002','hist_rep_b','History Rep B','SALESREP',false),
 ('e7410000-0000-4000-8000-000000000003','hist_manager','History Manager','MANAGER',false),
 ('e7410000-0000-4000-8000-000000000004','dylan_collyge','History Dylan','User',false),
 ('e7410000-0000-4000-8000-000000000005','hist_admin','History Admin','ADMINISTRATOR',false),
 ('e7410000-0000-4000-8000-000000000006','hist_inactive','Inactive Rep','REP',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
update public.profiles set disabled_at=clock_timestamp() where id='e7410000-0000-4000-8000-000000000006';
insert into sales_private.rep_identities(kind,identity_key,profile_id)
values ('username',sales_private.identity_key('hist_rep_a'),'e7410000-0000-4000-8000-000000000001'),
  ('username',sales_private.identity_key('hist_rep_b'),'e7410000-0000-4000-8000-000000000002')
on conflict(kind,identity_key) do update set profile_id=excluded.profile_id;
insert into private.navigation_view_overrides(profile_id,view_key,allowed)
values('e7410000-0000-4000-8000-000000000003','historical-requests',true)
on conflict(profile_id,view_key) do update set allowed=excluded.allowed;
insert into public.app_dataset_revisions(key,revision,state)
values ('ph_active_request',1,'ready'),('ph_master_inventory',1,'ready'),('ph_request_history',1,'ready')
on conflict(key) do update set state='ready';

insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,listprice)
values ('hist-master-a','HIST-A','History Plant A','1 gal','A','L1','10.00'),
  ('hist-master-b','HIST-B','History Plant B','2 gal','B','L2','$2.50'),
  ('hist-master-badprice','HIST-C','History Plant C','3 gal','C','L3','no price');

insert into public.ph_request_history(unique_id,master_id,master_unique_id,assigned_rep_id,
  customeridentityid,customername,consigneeidentityid,consigneename,itemcode,commonname,locationcode,
  req_qty,req_status,created_at,snapshot)
values
 ('hist-owned-priced','hist-master-a','hist-master-a','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-A','History Plant A','A','2','Complete','2026-01-01T12:00:00Z','{}'),
 ('hist-owned-zero','hist-master-b','hist-master-b','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-2','South Consignee','HIST-B','History Plant B','B','0','Complete','2026-01-02T12:00:00Z','{}'),
 ('hist-owned-blank','hist-master-a','hist-master-a','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-A','History Plant A','A','','Complete','2026-01-03T12:00:00Z','{}'),
 ('hist-owned-badqty','hist-master-a','hist-master-a','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-A','History Plant A','A','not-a-number','Complete','2026-01-04T12:00:00Z','{}'),
 ('hist-owned-badprice','hist-master-badprice','hist-master-badprice','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-C','History Plant C','C','3','Complete','2026-01-05T12:00:00Z','{}'),
 ('hist-other-rep','hist-master-a','hist-master-a','e7410000-0000-4000-8000-000000000002','cust-2','Other Customer','cons-3','Other Consignee','HIST-A','History Plant A','A','4','Complete','2026-01-06T12:00:00Z','{}'),
 ('hist-no-price-row','missing-master','missing-master','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-M','Missing Master','M','3','Complete','2026-01-07T12:00:00Z','{}');

-- Active general-request inserts are subject to the live mapped-relationship
-- guard, so seed only the two exact customer/consignee/rep tuples used below.
insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,customername,customerstatus,
  consigneeid,consigneename,consigneestatus,salesrepid,salesrepname,raw_data)
values
 ('hist-map-cust1-cons1','cust-1','Acme Customer','A','cons-1','North Consignee','A','HIST-A','History Rep A','{}'),
 ('hist-map-cust2-cons3','cust-2','Other Customer','A','cons-3','Other Consignee','A','HIST-B','History Rep B','{}');

insert into public.ph_active_request(unique_id,master_id,request_selected_rep_username,request_selected_rep_display,request_created_by_username,
  customeridentityid,customername,consigneeidentityid,consigneename,itemcode,commonname,locationcode,req_qty,req_status,created_at)
values
 ('hist-owned-priced','hist-master-b','hist_rep_a','History Rep A','hist_rep_a','cust-1','Acme Customer','cons-1','North Consignee','HIST-B','SHOULD BE DEDUPED','B','100','Pending','2026-02-01T12:00:00Z'),
 ('hist-active-priced','hist-master-a','hist_rep_a','History Rep A','hist_rep_a','cust-1','Acme Customer','cons-1','North Consignee','HIST-A','History Plant A','A','1','Pending','2026-02-02T12:00:00Z'),
 ('hist-active-other-rep','hist-master-a','hist_rep_b','History Rep B','hist_rep_a','cust-2','Other Customer','cons-3','Other Consignee','HIST-A','Creator Must Not Grant Access','A','9','Pending','2026-02-03T12:00:00Z');

select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000001',true);
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{scope}'),'own','REP receives own scope');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{summary,requestCount}')::integer,7,
  'REP sees only history assigned to their UUID and active rows resolved to their profile');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{summary,totalValue}')::numeric,342.5,
  'summary uses current exact master price, applies blank/zero quantity fallback, and excludes unresolved value');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{summary,unpricedCount}')::integer,3,
  'invalid quantity, missing master, and invalid current price are counted as unresolved');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{rows,0,requestCount}')::integer,7,
  'customer groups count all of this rep’s historical and active requests');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{revision}'),
  (select string_agg(key||':'||revision::text,',' order by key) from public.app_dataset_revisions
    where key=any(array['ph_active_request','ph_master_inventory','ph_request_history'])),
  'revision reports the locked source dataset revisions');
select is((public.historical_requests_read_v1(jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
  'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-1')))#>>'{total}')::integer,6,
  'request detail filters on stable customer and consignee identity keys');
select is((select (entry->>'requestQty')::numeric from jsonb_array_elements(public.historical_requests_read_v1(
  jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
    'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-1')))#>'{rows}') entry
  where entry->>'id'='hist-owned-priced'),2::numeric,'history-first dedup preserves historical row instead of its active duplicate');
select is((public.historical_requests_read_v1(jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
  'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-2')))#>>'{rows,0,effectiveQty}')::numeric,25::numeric,
  'literal zero quantity follows the 25-unit default');
select is((select (entry->>'totalValue')::numeric from jsonb_array_elements(public.historical_requests_read_v1(
  jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
    'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-1')))#>'{rows}') entry
  where entry->>'id'='hist-owned-priced'),20::numeric,'request value uses exact current master list price');
select is((public.historical_requests_read_v1(jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
  'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-2')))#>>'{rows,0,totalValue}')::numeric,62.5,
  'dollar-formatted current list price and zero fallback are parsed exactly');
select ok((select entry->>'unresolvedReason' is not null and entry->>'requestQty' is null and entry->>'effectiveQty' is null
  from jsonb_array_elements(public.historical_requests_read_v1(
    jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
      'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-1')))#>'{rows}') entry
  where entry->>'id'='hist-owned-badqty'),
  'malformed quantity is returned as unresolved rather than priced');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000003',true);
select ok(not private.navigation_module_allowed_v1('e7410000-0000-4000-8000-000000000003','historical-requests'),
  'nav override cannot grant the protected report to a manager');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers"}')$$,'42501','HISTORICAL_REQUESTS_FORBIDDEN',
  'Manager is denied even when a user override tries to grant the view');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000002',true);
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{summary,requestCount}')::integer,2,
  'SALESREP scope is limited to the two rows owned by its profile UUID, not creator attribution');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"reps"}')$$,'42501','HISTORICAL_REQUESTS_REPS_FORBIDDEN',
  'REP may not access global rep rollups');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000005',true);
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{scope}'),'all','ADMINISTRATOR receives global financial scope');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{summary,requestCount}')::integer,9,
  'administrator aggregate includes all deduplicated authorized rows');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000004',true);
select is((public.historical_requests_read_v1('{"operation":"summary"}')#>>'{scope}'),'all','exact Dylan username receives global financial scope');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers"}')$$,'42501','SALES_ACTOR_NOT_ACTIVE',
  'disabled REP cannot use the RPC');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers"}')$$,'42501','HISTORICAL_REQUESTS_AUTH_REQUIRED',
  'RPC requires an authenticated UUID');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.historical_requests_read_v1('{}')$$,'22023','HISTORICAL_REQUESTS_OPERATION_INVALID',
  'missing operation is rejected');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers","unexpected":true}')$$,'22023','HISTORICAL_REQUESTS_QUERY_INVALID',
  'unknown query keys are rejected');
insert into private.navigation_view_overrides(profile_id,view_key,allowed)
values('e7410000-0000-4000-8000-000000000001','historical-requests',false)
on conflict(profile_id,view_key) do update set allowed=excluded.allowed;
select ok(not private.navigation_module_allowed_v1('e7410000-0000-4000-8000-000000000001','historical-requests'),
  'an explicit per-user deny remains effective for an otherwise eligible REP');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers"}')$$,'42501','HISTORICAL_REQUESTS_FORBIDDEN',
  'the RPC enforces the same explicit navigation deny as the UI');
delete from private.navigation_view_overrides where profile_id='e7410000-0000-4000-8000-000000000001' and view_key='historical-requests';
select ok(private.navigation_module_allowed_v1('e7410000-0000-4000-8000-000000000004','historical-requests'),
  'exact Dylan username receives the protected navigation capability');
update public.app_dataset_revisions set state='importing' where key='ph_request_history';
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers"}')$$,'55000','HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED',
  'report fails closed when a required source revision is not ready');
update public.app_dataset_revisions set state='ready' where key='ph_request_history';

insert into public.ph_request_history(unique_id,master_id,master_unique_id,assigned_rep_id,
  customeridentityid,customername,consigneeidentityid,consigneename,itemcode,commonname,locationcode,
  req_qty,req_status,created_at,snapshot)
select 'hist-collision-'||g,'hist-master-a','hist-master-a','e7410000-0000-4000-8000-000000000001',
  'same-label-customer-'||g,'Same Label Customer','same-label-consignee-'||g,'Same Label Consignee',
  'HIST-A','History Plant A','A','1','Complete','2026-03-01T12:00:00Z'::timestamptz+g*interval '1 second','{}'::jsonb
from generate_series(1,30) g;
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000005',true);
select is((public.historical_requests_read_v1('{"operation":"customers","page":0,"pageSize":25}')#>>'{total}')::integer,32,
  'different customer IDs remain separate groups even when their display labels match');
select is(jsonb_array_length(public.historical_requests_read_v1('{"operation":"customers","page":0,"pageSize":25}')->'rows'),25,
  'group listing returns only the requested bounded page');
select is(jsonb_array_length(public.historical_requests_read_v1('{"operation":"customers","page":1,"pageSize":25}')->'rows'),7,
  'stable pagination returns the remaining groups on the next page');
