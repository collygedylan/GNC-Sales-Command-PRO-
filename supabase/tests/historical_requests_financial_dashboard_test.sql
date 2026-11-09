-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(33);

select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=2s']
  from pg_proc where oid='public.historical_requests_read_v1(jsonb)'::regprocedure),
  'the historical dashboard uses a bounded, pinned security definer');
select ok(has_function_privilege('authenticated','public.historical_requests_read_v1(jsonb)','execute')
  and not has_function_privilege('anon','public.historical_requests_read_v1(jsonb)','execute')
  and not has_function_privilege('service_role','public.historical_requests_read_v1(jsonb)','execute'),
  'only the signed-in historical dashboard can call its user-bound RPC');
select ok(has_function_privilege('service_role','public.historical_request_archive_read_v3039(uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','public.historical_request_archive_read_v3039(uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.historical_request_archive_read_v3039(uuid,jsonb)','execute'),
  'the five-level archive reader requires the trusted actor boundary');
select ok(not has_table_privilege('authenticated','private.request_financial_admins_v1','insert'),
  'clients cannot designate themselves as financial admins');

create temp table history_actors(kind text primary key,actor_id uuid,username text,role_name text) on commit drop;
insert into history_actors values
 ('rep','e7410000-0000-4000-8000-000000000001','hist_rep_a','REP'),
 ('other-rep','e7410000-0000-4000-8000-000000000002','hist_rep_b','SALESREP'),
 ('financial','e7410000-0000-4000-8000-000000000004','hist_finance','ADMIN'),
 ('ordinary-admin','e7410000-0000-4000-8000-000000000005','hist_admin','ADMINISTRATOR'),
 ('disabled','e7410000-0000-4000-8000-000000000006','hist_inactive','REP');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select actor_id,username||'@example.invalid','{}','{}' from history_actors;
insert into public.profiles(id,username,display_name,role,must_change_password)
select actor_id,username,username,role_name,false from history_actors;
insert into private.request_financial_admins_v1(profile_id) select actor_id from history_actors where kind='financial';
update public.profiles set disabled_at=now() where username='hist_inactive';
insert into public.app_dataset_revisions(key,revision,state)
values ('ph_requests_pending',1,'ready'),('ph_requests_completed_history',1,'ready')
on conflict(key) do update set state='ready';

insert into public.ph_requests_completed_history
  (id,unique_id,assigned_rep_id,customeridentityid,customer_name,consigneeidentityid,consignee_name,
   itemcode,commonname,request_folder,requested_at,date_completed,request_qty,effective_qty,is_default_qty,
   unit_list_price,line_dollar_value,sales_rep,customer_consignee_label,req_spec,req_photo_link,snapshot)
select f.id,f.uid,a.actor_id,f.customer_id,f.customer,f.consignee_id,f.consignee,
  '00012',f.title,f.folder,f.stamp,f.stamp+interval '1 second',f.request_qty,f.qty,f.request_qty is null,
  f.price,f.qty*f.price,a.username,f.customer||' / '||f.consignee,f.spec,f.photo,f.snapshot
from (values
 (-741001,'REQ-hist-owned-priced','rep','cust-1','Acme Customer','cons-1','North Consignee',
  'Owned archive plant','Legacy folder witness','2026-03-01 05:59:59+00'::timestamptz,2,2,15,
  '8 feet','https://example.invalid/request.jpg','{"dock":"0"}'::jsonb),
 (-741002,'REQ-hist-owned-default','rep','cust-1','Acme Customer','cons-2','South Consignee',
  'Default archive plant','Archive South','2026-03-01 06:00:00+00'::timestamptz,null,25,2.5,null,null,'{"dock":"1"}'),
 (-741003,'REQ-hist-other-rep','other-rep','cust-2','Acme Customer','cons-3','North Consignee',
  'Other owner archive plant','Other Archive','2026-03-02 12:00:00+00'::timestamptz,4,4,20,null,null,'{}'),
 (-741004,'REQ-hist-dst-start','rep','cust-1','Acme Customer','cons-1','North Consignee',
  'DST first','DST first','2026-03-08 06:00:00+00'::timestamptz,1,1,1,null,null,'{"dock":"2"}'),
 (-741005,'REQ-hist-dst-end','rep','cust-1','Acme Customer','cons-1','North Consignee',
  'DST last','DST last','2026-03-09 04:59:59+00'::timestamptz,1,1,1,null,null,'{"dock":"2"}'),
 (-741006,'REQ-hist-dst-next','rep','cust-1','Acme Customer','cons-1','North Consignee',
  'DST next','DST next','2026-03-09 05:00:00+00'::timestamptz,1,1,1,null,null,'{"dock":"2"}')
) f(id,uid,owner,customer_id,customer,consignee_id,consignee,title,folder,stamp,request_qty,qty,price,spec,photo,snapshot)
join history_actors a on a.kind=f.owner;

select set_config('request.jwt.claim.sub',(select actor_id::text from history_actors where kind='rep'),true);
select is(public.historical_requests_read_v1('{"operation":"summary"}')->>'scope','own','Rep receives only own history');
select is((public.historical_requests_read_v1('{"operation":"summary"}')#>>'{summary,requestCount}')::integer,5,'own history includes each assigned archive row');
select ok(public.historical_requests_read_v1('{"operation":"summary"}')#>'{summary,totalValue}'='null'::jsonb,'Rep aggregate redacts money');
select ok(not exists(select from jsonb_array_elements(public.historical_requests_read_v1('{"operation":"customers"}')->'rows') r
  where r->>'totalValue' is not null or r->>'unpricedCount' is not null),'Rep group totals redact money');
select is(public.historical_requests_read_v1('{"operation":"reps"}')#>>'{rows,0,key}',
  'rep:e7410000-0000-4000-8000-000000000001','Rep list binds the actor identity');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"folders","repKey":"rep:e7410000-0000-4000-8000-000000000002"}')$$,
  '42501','HISTORICAL_REQUESTS_REP_FORBIDDEN','forged rep selection cannot expose another owner');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"months"}')$$,
  '42501','HISTORICAL_REQUESTS_FINANCIAL_FORBIDDEN','Rep cannot ask for monthly financial values');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers","unexpected":true}')$$,
  '22023','HISTORICAL_REQUESTS_QUERY_INVALID','unknown query keys are rejected');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"customers","pageSize":101}')$$,
  '22023','HISTORICAL_REQUESTS_QUERY_INVALID','page size remains bounded');
select is((public.historical_requests_read_v1('{"operation":"summary"}')->>'revision'),
  (select 'history-fast-v2366:'||string_agg(key||':'||revision::text,',' order by key)
   from public.app_dataset_revisions where key in ('ph_requests_pending','ph_requests_completed_history')),
  'the revision includes the actual pending and completed sources');

select set_config('request.jwt.claim.sub',(select actor_id::text from history_actors where kind='financial'),true);
select ok((public.historical_requests_read_v1('{"operation":"summary"}')->>'financials')::boolean,'a designated active administrator sees financials');
select is((select count(distinct r->>'key')::int from jsonb_array_elements(
  public.historical_requests_read_v1('{"operation":"customers"}')->'rows') r
  where r->>'key' in (private.historical_request_customer_key_v2366('cust-1','Acme Customer'),
                      private.historical_request_customer_key_v2366('cust-2','Acme Customer'))),2,
  'equal customer labels do not collapse different external customer IDs');
select is(jsonb_array_length(public.historical_requests_read_v1('{"operation":"customers","pageSize":1}')->'rows'),1,
  'the result includes only the requested page');
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders","dateFrom":"2026-02-28","dateTo":"2026-02-28"}')
  #>>'{summary,totalValue}')::numeric,30::numeric,'Chicago report day retains its last second and archived price');
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders","dateFrom":"2026-03-01","dateTo":"2026-03-01"}')
  #>>'{summary,totalValue}')::numeric,62.5::numeric,'Chicago midnight starts the next report day');
select is((public.historical_requests_read_v1('{"operation":"summary","recordKind":"orders","dateFrom":"2026-03-08","dateTo":"2026-03-08"}')
  #>>'{summary,requestCount}')::integer,2,'Chicago daylight-saving day includes exactly its 23-hour interval');
select is((public.historical_requests_read_v1('{"operation":"months","recordKind":"orders"}')->>'total')::integer,2,
  'monthly rollup distinguishes February from March');
select throws_ok($$select public.historical_requests_read_v1('{"operation":"months","dateFrom":"2026-02-29"}')$$,
  '22008','date/time field value out of range: "2026-02-29"','invalid calendar date is rejected');

create temp table archive_results(kind text, result jsonb) on commit drop;
insert into archive_results select kind,public.historical_request_archive_read_v3039(actor_id,
  '{"recordKind":"requests","operation":"archive-search","query":"Legacy folder witness"}')
from history_actors where kind in ('rep','other-rep','financial','ordinary-admin');
select is((select (result->>'total')::int from archive_results where kind='rep'),1,'legacy folder text still finds the exact completed row');
select is((select (result->>'total')::int from archive_results where kind='other-rep'),0,'archive search preserves rep scope');
select is((select (result->>'total')::int from archive_results where kind='ordinary-admin'),0,'ordinary administrator does not inherit global archive scope');
select ok((select result#>'{rows,0,unitListPrice}'='null'::jsonb
  and result#>'{rows,0,lineDollarValue}'='null'::jsonb from archive_results where kind='rep'),
  'the archive record itself redacts prices and totals');
select is((select (result#>>'{rows,0,lineDollarValue}')::numeric from archive_results where kind='financial'),30::numeric,
  'the trusted financial reader returns the archived line value');
select is((select result#>>'{rows,0,photoLinks,0}' from archive_results where kind='rep'),
  'https://example.invalid/request.jpg','archive retains the full-resolution source link');
select is((select result#>>'{rows,0,facts,Spec}' from archive_results where kind='rep'),'8 feet','archive retains the row specification');
select is((select result#>>'{rows,0,itemcode}' from archive_results where kind='rep'),'00012','archive preserves textual item codes');

update private.request_financial_admins_v1 set active=false where profile_id=(select actor_id from history_actors where kind='financial');
select ok(not (public.historical_requests_read_v1('{"operation":"summary"}')->>'financials')::boolean,
  'revoking a designation immediately removes financial scope');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.historical_requests_read_v1('{"operation":"summary"}')$$,
  '42501','HISTORICAL_REQUESTS_AUTH_REQUIRED','dashboard rejects missing auth');
select throws_ok($$select public.historical_request_archive_read_v3039('e7410000-0000-4000-8000-000000000006',
  '{"recordKind":"requests","operation":"archive-folders"}')$$,'42501',null,'disabled actor cannot use the archive');
select * from finish();
rollback;
