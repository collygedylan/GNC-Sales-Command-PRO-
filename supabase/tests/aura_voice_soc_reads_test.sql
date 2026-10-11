-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(54);

select has_function('public','aura_voice_context_v1',array[]::text[],'Aura returns the caller-bound active season context');
select has_function('public','aura_voice_soc_read_v1',array['text','jsonb','jsonb','integer'],'Aura exposes the bounded SOC reader');
select ok((select prosecdef and proconfig @> array['search_path=pg_catalog, public, private, sales_private, app_sync_private','statement_timeout=6s']
  from pg_proc where oid='public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure),'SOC reader is a bounded security definer with a fixed search path');
select ok(has_function_privilege('authenticated','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','execute')
  and not has_function_privilege('anon','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','execute')
  and not has_function_privilege('service_role','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','execute'),
  'SOC reader is authenticated-only and derives actor from auth.uid');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('f7110000-0000-4000-8000-000000000001','soc-rep-a@example.invalid','{}','{}'),
 ('f7110000-0000-4000-8000-000000000002','soc-rep-b@example.invalid','{}','{}'),
 ('f7110000-0000-4000-8000-000000000003','soc-dylan@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until) values
 ('f7110000-0000-4000-8000-000000000001','soc_rep_a','SOC Rep A','REP',false,null,null),
 ('f7110000-0000-4000-8000-000000000002','soc_rep_b','SOC Rep B','SALESREP',false,null,null),
 ('f7110000-0000-4000-8000-000000000003','dylan_collyge','SOC Dylan','FOREMAN',false,null,null)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into private.navigation_view_catalog(view_key,label,selectable)
values ('reserves','Reserves',true),('docks','Docks',true)
on conflict(view_key) do nothing;
insert into private.navigation_view_overrides(profile_id,view_key,allowed) values
 ('f7110000-0000-4000-8000-000000000001','reserves',true),
 ('f7110000-0000-4000-8000-000000000002','docks',true),
 ('f7110000-0000-4000-8000-000000000003','reserves',true),
 ('f7110000-0000-4000-8000-000000000003','docks',true)
on conflict(profile_id,view_key) do update set allowed=excluded.allowed;
insert into sales_private.rep_identities(kind,identity_key,profile_id) values
 ('external_id',sales_private.key('SOC-A'),'f7110000-0000-4000-8000-000000000001'),
 ('external_id',sales_private.key('SOC-B'),'f7110000-0000-4000-8000-000000000002')
on conflict(kind,identity_key) do update set profile_id=excluded.profile_id;
insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27,"revision":43}'::jsonb,'soc_rep_a',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
insert into public.app_dataset_revisions(key,revision,state)
values ('ph_reserves',11,'ready'),('ph_soc_master',12,'ready'),('ph_customer_consignee_sales_reps',13,'ready')
on conflict(key) do update set revision=excluded.revision,state='ready';

insert into public.ph_reserves(unique_id,itemcode,commonname,contsize,season,locationcode,lotcode,
  customeridentityid,customername,consigneeidentityid,consigneename,salesrepid,salesrepname,quantityordered,quantityshipped)
values
 ('soc-r-a1','SOC-A1','Maple','#5','U1','A','L1','C-1','Twin Customer','N-1','North','SOC-A','SOC Rep A','10','3'),
 ('soc-r-a2','SOC-A2','Maple','#5','U1','A','L2','C-2','Twin Customer','N-1','North','SOC-A','SOC Rep A','4','1'),
 ('soc-r-a3','SOC-A4','Maple','#5','U1','A','L2','C-1','Twin Customer','N-2','North','SOC-A','SOC Rep A','1','1'),
 ('soc-r-tree','SOC-A3','Maple Tree','#5','U1','A','L3','C-1','Twin Customer','N-1','North','SOC-A','SOC Rep A','8','2'),
 ('soc-r-b','SOC-B1','Maple','#5','U1','B','L4','C-3','Other Customer','N-3','West','SOC-B','SOC Rep B','50','10'),
 ('soc-r-b2','SOC-B2','Maple','#5','U1','B','L5','C-3','Other Customer','N-4','West','SOC-B','SOC Rep B','1','1');
insert into public.ph_soc_master(unique_id,itemcode,commonname,contsize,season,locationcode,lotcode,
  customeridentityid,customername,consigneeidentityid,consigneename,salesrepid,salesrepname,quantityordered,quantityshipped,invoicedate)
values
 ('soc-o-a1','SOC-O1','Maple','#5','U1','A','O1','C-1','Twin Customer','N-1','North','SOC-A','SOC Rep A','20','8',null),
 ('soc-o-a2','SOC-O2','Maple','#5','U1','A','O2','C-1','Twin Customer','N-2','North','SOC-A','SOC Rep A','5','0',null),
 ('soc-o-tree','SOC-O3','Maple Tree','#5','U1','A','O3','C-1','Twin Customer','N-1','North','SOC-A','SOC Rep A','9','1',null),
 ('soc-o-invoiced','SOC-O4','Maple','#5','U1','A','O4','C-1','Twin Customer','N-1','North','SOC-A','SOC Rep A','99','0','2026-10-01'),
 ('soc-o-b','SOC-O5','Maple','#5','U1','B','O5','C-3','Other Customer','N-3','West','SOC-B','SOC Rep B','50','10',null);
update public.app_dataset_revisions set state='ready' where key in ('ph_reserves','ph_soc_master','ph_customer_consignee_sales_reps');

select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":43}',null,50)$$,
  '42501','AURA_ACTOR_FORBIDDEN','unauthenticated SOC reads are rejected');
select set_config('request.jwt.claim.sub','f7110000-0000-4000-8000-000000000001',true);
select is((public.aura_voice_access_v1()#>>'{capabilities,socReserves}'),'true','Reserves navigation grants only the reserve capability');
select is((public.aura_voice_access_v1()#>>'{capabilities,socOpenOrders}'),'false','Reserves-only actor does not receive the Docks capability');
select is((public.aura_voice_context_v1()->>'season'),'F1','app context returns active season');
select is((public.aura_voice_context_v1()->>'settingRevision')::bigint,43::bigint,'app context returns the setting revision');
select throws_ok($$select public.aura_voice_soc_read_v1('soc_open_orders','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":43}',null,50)$$,
  '42501','AURA_MODULE_FORBIDDEN','the row function rechecks Docks navigation directly');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'metric'),'remaining_quantity',
  'reserves expose the ordered-minus-shipped metric');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43,"customerId":"C-1"}',null,50)->>'total')::numeric,7::numeric,
  'REP total contains only rows assigned to its authenticated UUID');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'season'),'U1',
  'explicit spoken SOC season is honored without a sales-year filter');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'yearFilterApplied'),'false',
  'SOC explicitly reports that sales-year filtering does not apply');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'mappingRevision')::bigint,
  (select revision from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'),'response freezes rep mapping revision');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'datasetRevision')::bigint,
  (select revision from public.app_dataset_revisions where key='ph_reserves'),'response freezes source dataset revision');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'choiceKind'),'customer',
  'duplicate display names return a customer identity choice');
select is(jsonb_array_length(public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->'candidateChoices'),2,
  'customer choices distinguish different external identity IDs');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43,"customerId":"C-1"}',null,50)->>'total')::numeric,7::numeric,
  'server-selected customer ID narrows exact party scope');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43,"customerId":"C-1","consigneeName":"North"}',null,50)->>'choiceKind'),'consignee',
  'duplicate consignee names return an identity choice inside the selected customer');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#6","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'total')::numeric,0::numeric,
  'container size is an exact normalized match');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple Tree","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'total')::numeric,0::numeric,
  'Cone/Tree/Espalier variants are excluded unless explicitly spoken');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple Tree","contSize":"#5","customerName":"Twin Customer","season":"U1","requestedVariants":["tree"],"expectedSettingRevision":43}',null,50)->>'total')::numeric,6::numeric,
  'explicitly spoken tree variant is retained');
select throws_ok($$select public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":42}',null,50)$$,
  '40001','AURA_APP_CONTEXT_STALE','a changed app context invalidates stale SOC work');
select throws_ok($$select public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":43,"requestedVariants":["rose"]}',null,50)$$,
  '22023','AURA_VARIANT_FILTER_INVALID','unapproved variant arguments are rejected');
select throws_ok($$select public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":43,"unexpected":true}',null,50)$$,
  '22023','AURA_FILTER_INVALID','unknown filter keys are rejected');
select throws_ok($$select public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":43}',null,51)$$,
  '22023','AURA_LIMIT_INVALID','SOC page size has a strict maximum of fifty');

select set_config('request.jwt.claim.sub','f7110000-0000-4000-8000-000000000002',true);
select is((public.aura_voice_access_v1()#>>'{capabilities,socOpenOrders}'),'true','Docks navigation grants open-order capability');
select throws_ok($$select public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":43}',null,50)$$,
  '42501','AURA_MODULE_FORBIDDEN','the row function rechecks Reserves navigation directly');
select is((public.aura_voice_soc_read_v1('soc_open_orders','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'metric'),'ordered_quantity',
  'SOC open orders use total ordered quantity as the primary metric');
select is((public.aura_voice_soc_read_v1('soc_open_orders','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'total')::numeric,0::numeric,
  'a REP does not see another rep’s SOC open-order rows');
select ok((public.aura_voice_conversation_v1('f7110000-0000-4000-8000-000000000002','begin',null,
  '4c110000-0000-4000-8000-000000000002',null,'{"text":"SOC open orders question","source":"typed"}'::jsonb)->>'turnId') is not null,
  'a Docks-only user can create their own conversation');

select set_config('request.jwt.claim.sub','f7110000-0000-4000-8000-000000000003',true);
select is((public.aura_voice_access_v1()#>>'{capabilities,socReserves}'),'true','exact Dylan keeps the legacy-role exception');
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Other Customer","consigneeName":"West","season":"U1","expectedSettingRevision":43}',null,50)->>'choiceKind'),'consignee',
  'a unique customer name still resolves duplicate consignee identities before totaling');

select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Other Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'total')::numeric,40::numeric,
  'exact Dylan can read an other-rep reserve total');
select is((public.aura_voice_soc_read_v1('soc_open_orders','{"commonName":"Maple","contSize":"#5","customerName":"Other Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'total')::numeric,50::numeric,
  'Dylan sees another rep’s orders while invoiced SOC rows remain excluded');
select ok((public.aura_voice_conversation_v1('f7110000-0000-4000-8000-000000000001','begin',null,
  '4c110000-0000-4000-8000-000000000001',null,'{"text":"SOC reserves question","source":"typed"}'::jsonb)->>'turnId') is not null,
  'a reserves-only user can create their own conversation');
select is((select count(*) from public.ph_reserves where unique_id in ('soc-r-a1','soc-r-a2','soc-r-a3','soc-r-tree','soc-r-b','soc-r-b2')),6::bigint,
  'SOC reads are read-only and do not mutate source rows');


-- Totals are independent of bounded result pages and use ordered, not remaining,
-- quantities for the published open-order feed.
select is((public.aura_voice_soc_read_v1('soc_open_orders','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}',null,1)->>'total')::numeric,25::numeric,
  'open-order total uses ordered quantity and excludes invoiced rows before pagination');
select is((public.aura_voice_soc_read_v1('soc_open_orders','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","season":"U1","expectedSettingRevision":43}','{"offset":1}',1)->>'total')::numeric,25::numeric,
  'a later page retains the full authorized order total');

create function pg_temp.soc_reserve_fixture() returns jsonb language sql as $$
  select public.aura_voice_soc_read_v1('reserves',
    '{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","customerId":"C-1","season":"U1","expectedSettingRevision":43}',null,50)
$$;
select set_config('request.jwt.claim.sub','f7110000-0000-4000-8000-000000000001',true);
update public.ph_reserves set quantityshipped=null where unique_id='soc-r-a1';
select is(pg_temp.soc_reserve_fixture()->>'complete','false','missing shipped quantity is incomplete, never an assumed zero');
select ok((pg_temp.soc_reserve_fixture()->>'total') is null,'missing shipped quantity suppresses the reserve total');
update public.ph_reserves set quantityshipped='bad' where unique_id='soc-r-a1';
select is(pg_temp.soc_reserve_fixture()->>'unresolvedCount','1','malformed shipped quantities are counted within authorized scope');
update public.ph_reserves set quantityshipped='3',quantityordered='bad' where unique_id='soc-r-a1';
select ok((pg_temp.soc_reserve_fixture()->>'total') is null,'malformed ordered quantity suppresses the reserve total');
update public.ph_reserves set quantityordered='-5' where unique_id='soc-r-a1';
select is((pg_temp.soc_reserve_fixture()->>'total')::numeric,(-8)::numeric,'signed remaining quantities are preserved');
update public.ph_reserves set quantityordered='10' where unique_id='soc-r-a1';
update public.profiles set role='ADMIN' where id='f7110000-0000-4000-8000-000000000001';
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Other Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'total')::numeric,0::numeric,
  'non-Dylan Admin does not inherit another rep customer');
update public.profiles set role='MANAGER' where id='f7110000-0000-4000-8000-000000000001';
select is((public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Other Customer","season":"U1","expectedSettingRevision":43}',null,50)->>'total')::numeric,0::numeric,
  'non-Dylan Manager does not inherit another rep customer');
update public.profiles set role='REP' where id='f7110000-0000-4000-8000-000000000001';
insert into public.ph_reserves(unique_id,itemcode,commonname,contsize,season,customeridentityid,customername,consigneeidentityid,consigneename,salesrepid,salesrepname,quantityordered,quantityshipped)
values('soc-unresolved-owner','UNKNOWN','Maple','#5','U1','C-1','Twin Customer','N-1','North','SOC-UNKNOWN','', '1000','0');
select is((pg_temp.soc_reserve_fixture()->>'total')::numeric,7::numeric,'unresolved rep ownership grants no access');
select is(jsonb_array_length(pg_temp.soc_reserve_fixture()->'rows'),2,'unresolved ownership is excluded before returned rows');
update public.app_dataset_revisions set state='interrupted' where key='ph_reserves';
select throws_ok($$select pg_temp.soc_reserve_fixture()$$,'55000','AURA_SOC_SOURCE_REFRESH_REQUIRED','interrupted source publication cannot claim complete data');
update public.app_dataset_revisions set state='ready' where key='ph_reserves';
update public.app_dataset_revisions set state='importing' where key='ph_customer_consignee_sales_reps';
select throws_ok($$select pg_temp.soc_reserve_fixture()$$,'55000','AURA_SOC_MAPPING_REFRESH_REQUIRED','an importing ownership mapping cannot grant access');
update public.app_dataset_revisions set state='ready' where key='ph_customer_consignee_sales_reps';
select throws_ok($$select public.aura_voice_soc_read_v1('reserves','{"commonName":"Maple","contSize":"#5","customerName":"Twin Customer","expectedSettingRevision":43,"salesYear":27}',null,50)$$,
  '22023','AURA_FILTER_INVALID','SOC RPC accepts no unsupported year predicate');
update public.profiles set must_change_password=true where id='f7110000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.soc_reserve_fixture()$$,'42501','AURA_ACTOR_FORBIDDEN','SOC rechecks account restrictions directly');
update public.profiles set must_change_password=false where id='f7110000-0000-4000-8000-000000000001';
delete from public.ph_app_settings where key='current_season_salesyear';
select throws_ok($$select public.aura_voice_context_v1()$$,'55000','AURA_APP_CONTEXT_UNAVAILABLE','missing current season is an explicit service failure');

select * from finish();
rollback;
