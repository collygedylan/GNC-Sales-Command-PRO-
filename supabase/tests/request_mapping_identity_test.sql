-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
select has_column('public','ph_active_request','request_selected_salesrep_id','Request stores the external sales rep ID');
select has_column('public','ph_active_request_live_rows','request_selected_salesrep_id','active projection carries rep identity');
select has_column('public','ph_request_queue_live_rows','request_selected_salesrep_id','queue projection carries rep identity');
select ok(not has_function_privilege('anon','sales_private.request_mapping_rep_allowed_v1(uuid,text)','execute')
  and not has_function_privilege('authenticated','sales_private.request_mapping_rep_allowed_v1(uuid,text)','execute'),'identity guard is private');
select ok((select position('request_selected_salesrep_id' in prosrc)>0 from pg_proc where oid='private.insert_request_batch(uuid,jsonb,text)'::regprocedure),'real batch insert projects external identity');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('ae110000-0000-4000-8000-000000000001','identity-rep@example.invalid','{}','{}'),
 ('ae110000-0000-4000-8000-000000000002','identity-admin@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('ae110000-0000-4000-8000-000000000001','identity_rep','Identity Rep','REP',false),
 ('ae110000-0000-4000-8000-000000000002','identity_admin','Identity Admin','ADMIN',false);
insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,customername,consigneeid,consigneename,customerstatus,consigneestatus,salesrepid,salesrepname) values
 ('identity-map-1','000041','Shared Customer','000071','Shared Consignee','A','A','ID01','Rep, Identity'),
 ('identity-map-2','000042','Shared Customer','000072','Shared Consignee','A','A','ID01','Rep, Identity'),
 ('identity-map-3','000043','Other Customer','000073','Other Consignee','A','A','ID02','Other Identity Rep');
insert into sales_private.rep_identities(kind,identity_key,profile_id) values('external_id',sales_private.key('ID01'),'ae110000-0000-4000-8000-000000000001')
 on conflict(kind,identity_key) do update set profile_id=excluded.profile_id;
select is((public.customer_rep_mapping_manage_v1('ae110000-0000-4000-8000-000000000001','options','{"salesrepId":"ID01","pageSize":1}')->>'total')::integer,2,'rep query retains both external customer identities with duplicate labels');
select is(public.customer_rep_mapping_manage_v1('ae110000-0000-4000-8000-000000000001','options','{"salesrepId":"ID01","page":1,"pageSize":1}')->'rows'->0->>'customeridentityid','000042','RPC pagination preserves leading-zero IDs');
select is((public.customer_rep_mapping_manage_v1('ae110000-0000-4000-8000-000000000001','options','{"salesrepId":"ID02"}')->>'total')::integer,0,'rep cannot select another rep customer');
select is((public.customer_rep_mapping_manage_v1('ae110000-0000-4000-8000-000000000002','options','{"salesrepId":"ID02"}')->>'total')::integer,1,'Admin retains the authorized rep picker');
select * from finish();
rollback;
