begin;
create temporary table sales_history_docks_checks(description text);
create function pg_temp.history_check(ok boolean,description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Sales history/Docks: %',description; end if;
  insert into sales_history_docks_checks values(description);
end $$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('97100000-0000-4000-8000-000000000001','history-ben@example.invalid','{}','{}'),
('97100000-0000-4000-8000-000000000002','history-other@example.invalid','{}','{}'),
('97100000-0000-4000-8000-000000000003','history-new@example.invalid','{}','{}'),
('97100000-0000-4000-8000-000000000004','history-duplicate@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
('97100000-0000-4000-8000-000000000001','history_ben_brown','History Ben Brown','REP',false),
('97100000-0000-4000-8000-000000000002','history_other_rep','History Other Rep','REP',false);
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true);

-- Imported ID is initially unknown; no name-only fallback can claim the shipment.
insert into public.ph_soc_master(unique_id,customeridentityid,customername,consigneeidentityid,consigneename,salesrepid,salesrepname,itemcode,invoicedate)
values('HD-PAST','HD-C','Identical Customer','HD-CN','North Destination','HD-REP','Brown, History Ben','HD-PINE','2018-01-01'),
('HD-PENDING-REP','HD-C','Identical Customer','HD-CN','North Destination','HD-NEW','New, History','HD-OAK',null);
select pg_temp.history_check((select assigned_rep_id is null from public.ph_credit_sources where source_id='HD-PAST'),'unverified external ID stays unassigned');
insert into public.ph_customer_consignee_sales_reps(unique_id,salesrepid,salesrepname)
values('HD-MAP','HD-REP','Brown, History Ben'),('HD-MAP-NEW','HD-NEW','New, History');
select pg_temp.history_check((select assigned_rep_id='97100000-0000-4000-8000-000000000001'::uuid from public.ph_credit_sources where source_id='HD-PAST'),'mapping import repairs already archived older invoice');
select pg_temp.history_check(sales_private.assigned_rep('{"salesrepname":"Brown, History Ben"}')='97100000-0000-4000-8000-000000000001'::uuid,'exact comma inversion identifies rep');
select pg_temp.history_check(sales_private.assigned_rep('{"salesrepname":"Brown, History"}') is null,'partial names fail closed');
insert into public.profiles(id,username,display_name,role,must_change_password)
values('97100000-0000-4000-8000-000000000003','history_new','History New','REP',false);
select pg_temp.history_check((select assigned_rep_id='97100000-0000-4000-8000-000000000003'::uuid from public.ph_credit_sources where source_id='HD-PENDING-REP'),'new profile automatically repairs prior null ownership');

do $$
declare rep uuid:='97100000-0000-4000-8000-000000000001'; other uuid:='97100000-0000-4000-8000-000000000002';
  source public.ph_credit_sources; response jsonb; initial_versions integer; old_events integer; search_term text;
begin
  select * into source from public.ph_credit_sources where source_id='HD-PAST';
  select count(*) into initial_versions from sales_private.source_versions where source_id=source.id;
  select count(*) into old_events from public.ph_request_delivery_outbox;
  perform sales_private.capture_source('docks',source.snapshot);
  perform sales_private.refresh_rep_identities();
  perform pg_temp.history_check((select count(*)=initial_versions from sales_private.source_versions where source_id=source.id),'unchanged repeat recovery does not duplicate source versions');
  update public.ph_credit_sources set assigned_rep_id=null where id=source.id;
  perform sales_private.capture_source('docks',source.snapshot);
  perform pg_temp.history_check((select assigned_rep_id=rep and revision=source.revision from public.ph_credit_sources where id=source.id),'unchanged snapshot acquires missing verified owner without a false source revision');
  response:=public.sales_credit_command_v1(rep,'source','{"sourceKind":"docks","sourceUniqueId":"HD-PAST"}');
  perform pg_temp.history_check(response#>>'{source,id}'=source.id::text and response#>>'{folder,consigneename}'='North Destination','exact Docks lookup returns source and folder');
  perform pg_temp.history_check(response->'source'=(public.sales_credit_command_v1(rep,'sources','{"sourceKind":"docks","query":"HD-PINE"}')#>'{rows,0}'),'exact lookup uses the same source-row contract');
  begin
    perform public.sales_credit_command_v1(other,'source','{"sourceKind":"docks","sourceUniqueId":"HD-PAST"}');
    raise exception 'Expected CREDIT_SOURCE_FORBIDDEN';
  exception when others then if sqlerrm<>'CREDIT_SOURCE_FORBIDDEN' then raise; end if; end;
  perform pg_temp.history_check(true,'other rep denied exact-source lookup');
  begin
    perform public.sales_credit_command_v1(rep,'source','{"sourceKind":"docks","sourceUniqueId":"MISSING"}');
    raise exception 'Expected CREDIT_SOURCE_FORBIDDEN';
  exception when others then if sqlerrm<>'CREDIT_SOURCE_FORBIDDEN' then raise; end if; end;
  perform pg_temp.history_check(not exists(select 1 from public.ph_credit_sources where source_id='MISSING'),'missing source read never archives/writes');
  update public.ph_soc_master set quantityordered='17' where unique_id='HD-PAST';
  perform pg_temp.history_check((select count(*)=initial_versions+1 from sales_private.source_versions where source_id=source.id),'changed shipment preserves prior snapshot');
  delete from public.ph_soc_master where unique_id='HD-PAST';
  perform pg_temp.history_check(exists(select 1 from public.ph_credit_sources where id=source.id),'source survives active deletion');
  update public.ph_customer_consignee_sales_reps set salesrepname='Rep, History Other' where unique_id='HD-MAP';
  perform pg_temp.history_check((select assigned_rep_id=rep from public.ph_credit_sources where id=source.id),'customer reassignment preserves archived owner');
  insert into public.ph_soc_master(unique_id,salesrepid,salesrepname) values('HD-NEXT','HD-REP','Rep, History Other');
  perform pg_temp.history_check((select assigned_rep_id=other from public.ph_credit_sources where source_id='HD-NEXT'),'new shipments use current verified mapping');
  insert into public.ph_customer_consignee_sales_reps(unique_id,salesrepid,salesrepname) values('HD-CONFLICT','HD-REP','Brown, History Ben');
  perform pg_temp.history_check(sales_private.assigned_rep('{"salesrepid":"HD-REP","salesrepname":"Brown, History Ben"}') is null,'conflicting external IDs cannot fall through to a display name');
  insert into public.ph_soc_master(unique_id,salesrepid,salesrepname) values('HD-UNRESOLVED','HD-REP','Brown, History Ben');
  perform pg_temp.history_check(exists(select 1 from public.sales_history_unresolved_sources_v1() where source_id='HD-UNRESOLVED'),'unresolved report includes conflicted source');
  perform pg_temp.history_check((select count(*)=old_events from public.ph_request_delivery_outbox),'recovery and ownership repair send no request emails');
  perform pg_temp.history_check(not has_function_privilege('authenticated','public.sales_history_unresolved_sources_v1()','execute'),'unresolved report is service-only');
end $$;

-- Conflicting exact names cannot silently choose the first profile.
insert into public.profiles(id,username,display_name,role,must_change_password)
values('97100000-0000-4000-8000-000000000004','history_duplicate','History New','REP',false);
select pg_temp.history_check(sales_private.assigned_rep('{"salesrepname":"New, History"}') is null,'duplicate normalized names fail closed');
select pg_temp.history_check((select assigned_rep_id='97100000-0000-4000-8000-000000000003'::uuid from public.ph_credit_sources where source_id='HD-PENDING-REP'),'later identity ambiguity does not rewrite established historical owner');

-- Durable context in ordinary creation, live view, history, completion, and credit.
select private.insert_request_batch('97100000-0000-4000-8000-000000000010','[
 {"unique_id":"HD-REQUEST","requested_by":"History Ben Brown","request_selected_rep_username":"history_ben_brown","request_created_by_username":"office_csr","request_folder":"HD-FOLDER","customeridentityid":"HD-C","customername":"Identical Customer","consigneeidentityid":"HD-SOUTH","consigneename":"South Destination","itemcode":"HD-ITEM","commonname":"Hydrangea","req_status":"Pending"},
 {"unique_id":"HD-LEGACY","requested_by":"History Ben Brown","request_selected_rep_username":"history_ben_brown","req_customer":"Legacy Customer","req_status":"Pending"}
]'::jsonb,'general');
select pg_temp.history_check((select customeridentityid='HD-C' and consigneeidentityid='HD-SOUTH' from public.ph_active_request_live_rows where unique_id='HD-REQUEST'),'creation and active read retain customer/consignee IDs');
select pg_temp.history_check((select customername='Identical Customer' and snapshot->>'consigneename'='South Destination' from public.ph_request_history where unique_id='HD-REQUEST'),'history and snapshot retain context from same request ID');
select pg_temp.history_check((select customername='Legacy Customer' and consigneeidentityid is null from public.ph_request_history where unique_id='HD-LEGACY'),'older clients preserve known names without inventing identity');
do $$
declare rep uuid:='97100000-0000-4000-8000-000000000001'; term text; response jsonb; row_value jsonb;
begin
  foreach term in array array['Identical Customer','South Destination','HD-ITEM','HD-FOLDER','Hydrangea'] loop
    response:=public.request_history_command_v1(rep,'search',jsonb_build_object('query',term));
    perform pg_temp.history_check(jsonb_array_length(response->'rows')=1 and response#>>'{rows,0,unique_id}'='HD-REQUEST','All-default history searches pending '||term);
  end loop;
  perform pg_temp.history_check(jsonb_array_length(public.request_history_command_v1(rep,'search','{"status":"completed","query":"HD-FOLDER"}')->'rows')=0,'completed filter excludes pending request');
end $$;
update public.ph_active_request set req_status='Complete',date_completed='2026-09-24T10:00:00Z' where unique_id='HD-REQUEST';
select private.upsert_request_history('HD-REQUEST','completed','not_queued',false);
delete from public.ph_active_request where unique_id='HD-REQUEST';
select pg_temp.history_check((select snapshot->>'consigneeidentityid'='HD-SOUTH' and assigned_rep_id='97100000-0000-4000-8000-000000000001'::uuid from public.ph_credit_sources where source_kind='request_history' and source_id='HD-REQUEST'),'completed request credit context survives active deletion');
select pg_temp.history_check(jsonb_array_length(public.sales_credit_command_v1('97100000-0000-4000-8000-000000000001','sources','{"sourceKind":"request_history"}')->'rows')=1,'completed-request tab excludes Docks sources');
select pg_temp.history_check(public.sales_credit_command_v1('97100000-0000-4000-8000-000000000001','source','{"sourceKind":"request_history","sourceUniqueId":"HD-REQUEST"}')#>>'{source,source_id}'='HD-REQUEST','exact completed-request lookup resolves the archived source');
insert into private.navigation_view_overrides(profile_id,view_key,allowed) values('97100000-0000-4000-8000-000000000001','sales-credit',false);
select pg_temp.history_check(public.request_history_command_v1('97100000-0000-4000-8000-000000000001','search','{"query":"HD-FOLDER"}')#>>'{rows,0,canRequestCredit}'='false','history hides credit actions when Credit module is denied');
delete from private.navigation_view_overrides where profile_id='97100000-0000-4000-8000-000000000001' and view_key='sales-credit';
insert into public.ph_request_history(unique_id,request_selected_rep_username,req_status,snapshot)
values('HD-UPPER','history_ben_brown','Pending','{"CUSTOMERIDENTITYID":"UP-C","CUSTOMERNAME":"Upper Customer","CONSIGNEEIDENTITYID":"UP-S","CONSIGNEENAME":"Upper Store"}');
select pg_temp.history_check((select customeridentityid='UP-C' and consigneeidentityid='UP-S' and consigneename='Upper Store' from public.ph_request_history where unique_id='HD-UPPER'),'older uppercase snapshots retain exact context');
insert into public.ph_request_history(unique_id,request_created_by_username,request_selected_rep_username,req_status,request_folder)
values('HD-CREATED-FOR-OTHER','history_ben_brown','history_other_rep','Complete','HD-CREATOR-FOLDER');
select pg_temp.history_check(jsonb_array_length(public.request_history_command_v1('97100000-0000-4000-8000-000000000001','search','{"query":"HD-CREATOR-FOLDER"}')->'rows')=1,'creator can see their request assigned to another rep');
select pg_temp.history_check(public.request_history_command_v1('97100000-0000-4000-8000-000000000001','search','{"query":"HD-CREATOR-FOLDER"}')#>>'{rows,0,canRequestCredit}'='false','creator-only history does not advertise another rep credit eligibility');
do $$ begin
  begin
    perform public.sales_credit_command_v1('97100000-0000-4000-8000-000000000001','source','{"sourceKind":"request_history","sourceUniqueId":"HD-CREATED-FOR-OTHER"}');
    raise exception 'Creator must not inherit another rep credit ownership';
  exception when insufficient_privilege then null; end;
  begin
    perform public.sales_credit_command_v1('97100000-0000-4000-8000-000000000001','source','{"sourceKind":"request_history","sourceUniqueId":"HD-LEGACY"}');
    raise exception 'Pending requests must not be credit sources';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.history_check(not exists(select 1 from jsonb_array_elements(public.sales_credit_command_v1('97100000-0000-4000-8000-000000000001','sources','{"sourceKind":"docks"}')->'rows') r where r->>'source_kind'<>'docks'),'Docks tab excludes completed requests');

-- Search is evaluated against all permitted records before applying pagination.
insert into public.ph_request_history(unique_id,request_selected_rep_username,req_status,request_folder,customeridentityid,customername,consigneeidentityid,consigneename,itemcode,created_at)
select 'HD-PAGE-'||lpad(i::text,3,'0'),'history_ben_brown','Pending','HD-PAGINATION','HD-PC','Page Customer','HD-PN','Page Destination',case when i=1 then 'HD-DEEP' else 'HD-COMMON' end,'2026-09-01'::timestamptz from generate_series(1,105)i;
select pg_temp.history_check(jsonb_array_length(public.request_history_command_v1('97100000-0000-4000-8000-000000000001','search','{"query":"HD-DEEP","limit":1}')->'rows')=1,'item search finds row beyond initial hundred results');
do $$ declare response jsonb; next_page jsonb; begin
  response:=public.request_history_command_v1('97100000-0000-4000-8000-000000000001','search','{"query":"HD-PAGINATION","limit":100}');
  next_page:=public.request_history_command_v1('97100000-0000-4000-8000-000000000001','search',jsonb_build_object('query','HD-PAGINATION','limit',100,'cursor',response->'nextCursor'));
  perform pg_temp.history_check(jsonb_array_length(response->'rows')=100 and jsonb_array_length(next_page->'rows')=5,'expanded history search retains stable pagination');
end $$;
-- Simulate separate HTTP import batches with their real token and publication API.
-- The first batch appears unique, but the second reveals a conflicting rep.
create temporary table sales_history_import_baseline as
select (select count(*) from public.ph_request_delivery_outbox) deliveries,
  (select count(*) from public.ph_sales_credit_requests) claims;
insert into public.ph_customer_consignee_sales_reps(unique_id,salesrepid,salesrepname)
values('HD-FENCE-STABLE-MAP','HD-FENCE-STABLE','Brown, History Ben');
insert into public.ph_soc_master(unique_id,salesrepid) values
('HD-FENCE-ESTABLISHED','HD-FENCE-STABLE'),('HD-FENCE-WAITING','HD-FENCE-SPLIT');
select public.begin_dataset_import_v1(array['ph_customer_consignee_sales_reps'],'97100000-0000-4000-8000-000000000020');
select set_config('request.headers','{"x-gnc-import-run-id":"97100000-0000-4000-8000-000000000020","x-test-retained":"yes"}',true);
select set_config('app_sync.touched','{}',true);
insert into public.ph_customer_consignee_sales_reps(unique_id,salesrepid,salesrepname)
values('HD-FENCE-SPLIT-A','HD-FENCE-SPLIT','Brown, History Ben');
select pg_temp.history_check((select assigned_rep_id is null from public.ph_credit_sources where source_id='HD-FENCE-WAITING'),'partial first mapping batch cannot permanently assign waiting history');
select pg_temp.history_check(sales_private.assigned_rep('{"salesrepid":"HD-FENCE-STABLE"}') is null,'importing map blocks stale external aliases for new assignments');
update public.profiles set display_name=display_name where username='history_ben_brown';
select pg_temp.history_check((select assigned_rep_id is null from public.ph_credit_sources where source_id='HD-FENCE-WAITING'),'profile refresh cannot repair against partial import');
insert into public.ph_soc_master(unique_id,salesrepid) values('HD-FENCE-NEW-DURING','HD-FENCE-STABLE');
select pg_temp.history_check((select assigned_rep_id is null from public.ph_credit_sources where source_id='HD-FENCE-NEW-DURING'),'Docks capture during import defers external ownership');
select set_config('app_sync.touched','{}',true);
insert into public.ph_customer_consignee_sales_reps(unique_id,salesrepid,salesrepname)
values('HD-FENCE-SPLIT-B','HD-FENCE-SPLIT','Rep, History Other');
select public.finish_dataset_import_v1('97100000-0000-4000-8000-000000000020');
select pg_temp.history_check((select assigned_rep_id is null from public.ph_credit_sources where source_id='HD-FENCE-WAITING'),'successful finish evaluates both batches and leaves conflicting history unresolved');
select pg_temp.history_check((select assigned_rep_id='97100000-0000-4000-8000-000000000001'::uuid from public.ph_credit_sources where source_id='HD-FENCE-NEW-DURING'),'successful finish repairs null owners without another source write');
select pg_temp.history_check((select assigned_rep_id='97100000-0000-4000-8000-000000000001'::uuid from public.ph_credit_sources where source_id='HD-FENCE-ESTABLISHED'),'import fence preserves established historical owner');
select pg_temp.history_check(current_setting('request.headers')::jsonb='{"x-gnc-import-run-id":"97100000-0000-4000-8000-000000000020","x-test-retained":"yes"}'::jsonb,'finish-derived repair restores exact caller headers');
select set_config('app_sync.touched','{}',true);
do $$ begin
  begin
    update public.ph_customer_consignee_sales_reps set salesrepname=salesrepname where unique_id='HD-FENCE-SPLIT-A';
    raise exception 'Closed import token must not write another mapping batch';
  exception when others then if sqlerrm<>'DATASET_IMPORT_FENCE_LOST' then raise; end if; end;
end $$;
select pg_temp.history_check(true,'restored closed token still rejects later batch writes');
select public.finish_dataset_import_v1('97100000-0000-4000-8000-000000000020');
select set_config('request.headers','{}',true);
select set_config('app_sync.touched','{}',true);
insert into public.ph_soc_master(unique_id,salesrepid) values('HD-FENCE-FAILED','HD-FENCE-FAIL');
select public.begin_dataset_import_v1(array['ph_customer_consignee_sales_reps'],'97100000-0000-4000-8000-000000000021');
select set_config('request.headers','{"x-gnc-import-run-id":"97100000-0000-4000-8000-000000000021"}',true);
select set_config('app_sync.touched','{}',true);
insert into public.ph_customer_consignee_sales_reps(unique_id,salesrepid,salesrepname)
values('HD-FENCE-FAIL-MAP','HD-FENCE-FAIL','Brown, History Ben');
select public.fail_dataset_import_v1('97100000-0000-4000-8000-000000000021');
select set_config('request.headers','{}',true);
select set_config('app_sync.touched','{}',true);
select sales_private.refresh_rep_identities();
update public.profiles set display_name=display_name where username='history_ben_brown';
select pg_temp.history_check((select assigned_rep_id is null from public.ph_credit_sources where source_id='HD-FENCE-FAILED'),'failed/import-interrupted mapping cannot repair history even through profile/manual refresh');
select pg_temp.history_check(sales_private.assigned_rep('{"salesrepid":"HD-FENCE-STABLE"}') is null,'interrupted map blocks stale external aliases');
insert into public.ph_soc_master(unique_id,salesrepid) values('HD-FENCE-INTERRUPTED','HD-FENCE-STABLE');
select pg_temp.history_check((select assigned_rep_id is null from public.ph_credit_sources where source_id='HD-FENCE-INTERRUPTED'),'Docks capture after failed import remains unassigned');
select public.begin_dataset_import_v1(array['ph_customer_consignee_sales_reps'],'97100000-0000-4000-8000-000000000022');
select set_config('request.headers','{"x-gnc-import-run-id":"97100000-0000-4000-8000-000000000022"}',true);
select set_config('app_sync.touched','{}',true);
select public.finish_dataset_import_v1('97100000-0000-4000-8000-000000000022');
select pg_temp.history_check((select assigned_rep_id='97100000-0000-4000-8000-000000000001'::uuid from public.ph_credit_sources where source_id='HD-FENCE-FAILED'),'validated zero-delta recovery repairs owner after failed import');
select pg_temp.history_check((select assigned_rep_id='97100000-0000-4000-8000-000000000001'::uuid from public.ph_credit_sources where source_id='HD-FENCE-INTERRUPTED'),'validated recovery repairs shipments captured while interrupted');
select pg_temp.history_check((select deliveries=(select count(*) from public.ph_request_delivery_outbox)
  and claims=(select count(*) from public.ph_sales_credit_requests) from sales_history_import_baseline),'import publication ownership repairs create no claims or notifications');
select set_config('request.headers','{}',true);
select public.begin_dataset_import_v1(array['ph_customer_consignee_sales_reps','ph_active_request'],'97100000-0000-4000-8000-000000000023');
select pg_temp.history_check((select source_keys=array['ph_active_request','ph_customer_consignee_sales_reps']
  and canonical_keys=array['ph_active_request','ph_customer_consignee_sales_reps'] from app_sync_private.import_runs
  where id='97100000-0000-4000-8000-000000000023'),'map-first locking preserves the mixed-import sorted source and canonical key contract');
select public.finish_dataset_import_v1('97100000-0000-4000-8000-000000000023');
select pg_temp.history_check((select bool_and(state='ready') from public.app_dataset_revisions
  where key in ('ph_active_request','ph_customer_consignee_sales_reps')),'mixed import publishes both datasets with unchanged finish contract');
select count(*) as sales_history_docks_checks from sales_history_docks_checks;
rollback;
