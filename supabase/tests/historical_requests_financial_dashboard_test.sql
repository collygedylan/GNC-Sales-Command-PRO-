-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(69);
-- Pricing assertions execute through the sole financial principal, while the original rep isolation assertions remain user-bound.
create function pg_temp.history_financial(p_query jsonb) returns jsonb language plpgsql as $$
declare prior text:=current_setting('request.jwt.claim.sub',true); result jsonb;
begin
  perform set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000004',true);
  result:=public.historical_requests_read_v1(p_query||jsonb_build_object('repKey','rep:e7410000-0000-4000-8000-000000000001'));
  perform set_config('request.jwt.claim.sub',coalesce(prior,''),true); return result;
exception when others then perform set_config('request.jwt.claim.sub',coalesce(prior,''),true); raise;
end $$;


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
 ('e7410000-0000-4000-8000-000000000004','dylan_collyge','History Dylan','ADMIN',false),
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
select is((pg_temp.history_financial('{"operation":"customers"}')#>>'{summary,totalValue}')::numeric,342.5,
  'summary uses current exact master price, applies blank/zero quantity fallback, and excludes unresolved value');
select is((pg_temp.history_financial('{"operation":"customers"}')#>>'{summary,unpricedCount}')::integer,3,
  'invalid quantity, missing master, and invalid current price are counted as unresolved');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{rows,0,requestCount}')::integer,7,
  'customer groups count all of this rep’s historical and active requests');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{revision}'),
  (select 'history-v3:'||md5('hist_rep_a:REP')||':'||string_agg(key||':'||revision::text,',' order by key) from public.app_dataset_revisions
    where key=any(array['ph_active_request','ph_customer_consignee_sales_reps','ph_master_inventory','ph_request_history'])),
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
select is((select (entry->>'totalValue')::numeric from jsonb_array_elements(pg_temp.history_financial(
  jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
    'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-1')))#>'{rows}') entry
  where entry->>'id'='hist-owned-priced'),20::numeric,'request value uses exact current master list price');
select is((pg_temp.history_financial(jsonb_build_object('operation','requests','customerKey','customer:id:'||md5('cust-1'),
  'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-2')))#>>'{rows,0,totalValue}')::numeric,62.5,
  'dollar-formatted current list price and zero fallback are parsed exactly');
select ok((select entry->>'unresolvedReason' is not null and entry->>'requestQty' is null and entry->>'effectiveQty' is null
  from jsonb_array_elements(pg_temp.history_financial(
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
select is((public.historical_requests_read_v1('{"operation":"reps"}')#>>'{scope}'),'own',
  'REP rep list remains limited to their own identity');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000005',true);
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{scope}'),'own','Other administrators cannot receive Dylan financial scope');
select is((public.historical_requests_read_v1('{"operation":"customers"}')#>>'{summary,requestCount}')::integer,0,
  'Other administrator sees only rows assigned to their own identity');
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
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000004',true);
select is((public.historical_requests_read_v1('{"operation":"customers","page":0,"pageSize":25}')#>>'{total}')::integer,32,
  'different customer IDs remain separate groups even when their display labels match');
select is(jsonb_array_length(public.historical_requests_read_v1('{"operation":"customers","page":0,"pageSize":25}')->'rows'),25,
  'group listing returns only the requested bounded page');
select is(jsonb_array_length(public.historical_requests_read_v1('{"operation":"customers","page":1,"pageSize":25}')->'rows'),7,
  'stable pagination returns the remaining groups on the next page');

-- Executive reporting regressions share the disposable fixture above.
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000001',true);
select ok(public.historical_requests_read_v1('{"operation":"summary"}')#>'{summary,totalValue}'='null'::jsonb,
  'rep aggregate dollars are redacted by the database');
select ok(not exists(select 1 from jsonb_array_elements(public.historical_requests_read_v1('{"operation":"customers"}')->'rows') r
  where r->>'totalValue' is not null or r->>'unpricedCount' is not null),'rep group financial values are redacted');
select is(public.historical_requests_read_v1('{"operation":"reps"}')#>>'{rows,0,key}',
  'rep:e7410000-0000-4000-8000-000000000001','rep directory defaults to the authenticated identity');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"folders","repKey":"rep:e7410000-0000-4000-8000-000000000002"}')$$,
  '42501','HISTORICAL_REQUESTS_REP_FORBIDDEN','forged rep filter cannot expose another rep');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"months"}')$$,
  '42501','HISTORICAL_REQUESTS_FINANCIAL_FORBIDDEN','rep cannot query monthly dollar totals');
select ok(not has_table_privilege('authenticated','public.ph_request_history','select'),
  'raw historical snapshots cannot bypass financial redaction');
select ok(not has_table_privilege('authenticated','private.request_financial_values_v1','select')
  and not has_table_privilege('authenticated','private.request_financial_admins_v1','insert'),
  'clients cannot read private amounts or designate themselves as financial admins');

insert into public.ph_request_history(unique_id,assigned_rep_id,customeridentityid,customername,consigneeidentityid,consigneename,
  itemcode,req_qty,req_status,created_at,master_id,locationcode,lotcode,contsize,snapshot)
values('hist-executive-archived','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee',
  'HIST-A','3','Complete','2026-03-01T05:59:59Z','obsolete-master','OLD','25.F1','#30',
  '{"dock":"0","req_spec":"8 feet","req_photo_link":"https://example.invalid/request.jpg","date_completed":"2026-03-01T06:00:00Z"}');
insert into public.ph_active_request(unique_id,master_id,request_selected_rep_username,request_selected_rep_display,
  request_created_by_username,customeridentityid,customername,consigneeidentityid,consigneename,itemcode,req_qty,req_status,created_at,dock)
values('hist-executive-active','hist-master-a','hist_rep_a','History Rep A','hist_rep_a','cust-1','Acme Customer','cons-1','North Consignee',
  'HIST-A','2','Pending','2026-03-01T06:00:00Z','');
select is(private.history_catalog_price_v1('HIST-A'),10::numeric,'item-code base price disregards obsolete lot, size and master identity');
select is((select total_value from private.request_financial_values_v1 where source_table='ph_request_history' and request_id='hist-executive-archived'),
  30::numeric,'incoming archived request financial value is calculated immediately');
select is((select total_value from private.request_financial_values_v1 where source_table='ph_active_request' and request_id='hist-executive-active'),
  20::numeric,'incoming active request financial value is calculated immediately');

select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000004',true);
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders"}')#>>'{summary,requestCount}')::integer,
  2,'zero and empty-string dock assignments both count as Orders');
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders","dateFrom":"2026-02-28","dateTo":"2026-02-28"}')#>>'{summary,totalValue}')::numeric,
  30::numeric,'Chicago through date includes the final second of the local day');
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders","dateFrom":"2026-03-01","dateTo":"2026-03-01"}')#>>'{summary,totalValue}')::numeric,
  20::numeric,'Chicago from date includes midnight and excludes the preceding local day');
select is((public.historical_requests_read_v1('{"operation":"months","recordKind":"orders"}')#>>'{total}')::integer,
  2,'monthly totals use Chicago calendar months');
select is((public.historical_requests_read_v1('{"operation":"months","recordKind":"orders"}')#>>'{summary,totalValue}')::numeric,
  50::numeric,'grouped and aggregate totals use the same complete filtered rows');
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders","repKey":"rep:e7410000-0000-4000-8000-000000000002"}')#>>'{summary,requestCount}')::integer,
  0,'rep slice excludes all other assigned requests');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"months","dateFrom":"2026-02-29"}')$$,
  '22023','HISTORICAL_REQUESTS_QUERY_INVALID','invalid calendar date is rejected');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"months","dateFrom":"2026-10-02","dateTo":"2026-10-01"}')$$,
  '22023','HISTORICAL_REQUESTS_QUERY_INVALID','reversed report range is rejected');
select ok(exists(select 1 from jsonb_array_elements(public.historical_requests_read_v1(jsonb_build_object('operation','requests',
  'customerKey','customer:id:'||md5('cust-1'),'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-1'),
  'recordKind','orders'))->'rows') r where r->>'id'='hist-executive-archived' and r->>'spec'='8 feet'
  and r#>>'{photoLinks,0}'='https://example.invalid/request.jpg' and r->>'sentAt' is not null),
  'archived specs, photos and sent metadata survive missing normalized columns');

select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000005',true);
select ok(not (public.historical_requests_read_v1('{"operation":"summary"}')->>'financials')::boolean,
  'ordinary administrator is not a financial principal');
insert into private.request_financial_admins_v1(profile_id) values('e7410000-0000-4000-8000-000000000005');
select ok((public.historical_requests_read_v1('{"operation":"summary"}')->>'financials')::boolean,
  'explicitly designated active administrator can see reporting totals');
update private.request_financial_admins_v1 set active=false where profile_id='e7410000-0000-4000-8000-000000000005';
select ok(not (public.historical_requests_read_v1('{"operation":"summary"}')->>'financials')::boolean,
  'revoking designation immediately redacts reporting totals');
update public.profiles set role='SUPERADMIN' where id='e7410000-0000-4000-8000-000000000005';
select ok(not private.navigation_module_allowed_v1('e7410000-0000-4000-8000-000000000005','historical-requests'),
  'a super-admin role alone does not designate financial access');
update private.request_financial_admins_v1 set active=true where profile_id='e7410000-0000-4000-8000-000000000005';
select ok((public.historical_requests_read_v1('{"operation":"summary"}')->>'financials')::boolean,
  'explicitly designated super-admin can use the financial reporting RPC');
insert into private.navigation_view_overrides(profile_id,view_key,allowed)
values('e7410000-0000-4000-8000-000000000005','historical-requests',false);
select throws_ok($$select public.historical_requests_read_v1('{"operation":"summary"}')$$,'42501','HISTORICAL_REQUESTS_FORBIDDEN',
  'explicit navigation denial remains effective for designated super-admins');
update public.profiles set role='User' where id='e7410000-0000-4000-8000-000000000004';
select ok(not private.history_dylan_financial_v1('e7410000-0000-4000-8000-000000000004'),
  'Dylan username without an admin role cannot receive financial authority');
update public.profiles set role='ADMIN' where id='e7410000-0000-4000-8000-000000000004';
select ok(private.history_dylan_financial_v1('e7410000-0000-4000-8000-000000000004'),
  'verified active Dylan admin retains financial authority');

select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000004',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,listprice)
values('hist-leading-zero','00012','Leading Zero Plant','7'),('hist-no-leading-zero','12','Different Plant','99');
select is(private.history_catalog_price_v1('00012'),7::numeric,'textual item codes preserve leading zeroes');
update public.ph_master_inventory set listprice='12' where unique_id='hist-master-a';
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders"}')#>>'{summary,totalValue}')::numeric,
  60::numeric,'reports immediately use updated current catalog prices');
update public.ph_active_request set req_qty='4' where unique_id='hist-executive-active';
select is((select total_value from private.request_financial_values_v1 where source_table='ph_active_request' and request_id='hist-executive-active'),
  48::numeric,'incoming request edits refresh private calculated values');
update public.ph_master_inventory set listprice='10' where unique_id='hist-master-a';

insert into public.ph_request_history(unique_id,assigned_rep_id,customeridentityid,customername,consigneeidentityid,consigneename,itemcode,req_qty,created_at,snapshot)
values('hist-dst-start','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-A','1','2026-03-08T06:00:00Z','{"dock":"1"}'),
  ('hist-dst-end','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-A','1','2026-03-09T04:59:59Z','{"dock":"1"}'),
  ('hist-dst-next','e7410000-0000-4000-8000-000000000001','cust-1','Acme Customer','cons-1','North Consignee','HIST-A','1','2026-03-09T05:00:00Z','{"dock":"1"}');
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders","dateFrom":"2026-03-08","dateTo":"2026-03-08"}')#>>'{summary,requestCount}')::integer,
  2,'Chicago daylight-saving report day includes its actual 23-hour interval');
select is(private.history_redact_financial_v1('{"snapshot":{"LIST_PRICE":10,"total_value":20,"quantity":2},"rows":[{"unitprice":5,"status":"Pending"}]}'),
  '{"snapshot":{"quantity":2},"rows":[{"status":"Pending"}]}'::jsonb,'legacy nested snapshots redact monetary fields recursively');
select ok(not exists(select 1 from jsonb_array_elements(public.historical_requests_read_v1(jsonb_build_object('operation','customers',
  'customerKey','customer:id:'||md5('cust-1')))->'rows') r where r->>'customerKey'<>'customer:id:'||md5('cust-1')),
  'customer report slice does not append unrelated mapping directory groups');
select is((public.historical_requests_read_v1('{"operation":"folders","repKey":"rep:e7410000-0000-4000-8000-000000000001"}')#>>'{rows,0,customerId}'),
  'cust-1','folder response includes its stable external customer identity');
select set_config('request.jwt.claim.sub','e7410000-0000-4000-8000-000000000001',true);
select ok(not exists(select 1 from jsonb_array_elements(public.historical_requests_read_v1(jsonb_build_object('operation','requests',
  'customerKey','customer:id:'||md5('cust-1'),'consigneeKey','customer:id:'||md5('cust-1')||'|consignee:id:'||md5('cons-1')))->'rows') r
  where r->>'listPrice' is not null or r->>'totalValue' is not null or r->>'unresolvedReason' is not null),
  'rep drill-down contains no price, dollar totals or financial explanations');
