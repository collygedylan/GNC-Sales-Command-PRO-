-- @test-runtime: canonical
-- The CLI mounts only the selected test file. Load the two exact pg_temp
-- function definitions captured by canonical migration replay into this session.
do $bootstrap$
declare migration_statements text[]; definition text; loaded_count integer:=0;
begin
  select statements into strict migration_statements
  from supabase_migrations.schema_migrations
  where name='transpose_imported_salesrep_names';
  foreach definition in array migration_statements loop
    if position('create or replace function pg_temp.rewrite_salesrep_queue_json_v1(' in lower(definition))>0
      or position('create or replace function pg_temp.transpose_imported_salesrep_names_v1(' in lower(definition))>0 then
      execute definition;
      loaded_count:=loaded_count+1;
    end if;
  end loop;
  if loaded_count<>2 then raise exception 'SALESREP_NAME_MIGRATION_FUNCTION_COUNT_%',loaded_count; end if;
end
$bootstrap$;
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();

-- Use a synthetic imported row so the test exercises the same migration
-- routine that performs the one-time production cleanup.
insert into public.app_dataset_revisions(key,revision,state)
values('ph_customer_consignee_sales_reps',1,'ready')
on conflict(key) do update set state='ready';
insert into public.ph_customer_consignee_sales_reps(
 unique_id,customeridentityid,customername,customerstatus,consigneeid,consigneename,consigneestatus,
 salesrepid,salesrepname,filename,source_file_name,source_row_number,row_hash,imported_at,raw_data,
 mapping_revision,mapping_updated_by)
values('name-fix-test-source','90001','Fixture Customer','A','90009','Fixture Consignee','A',
 'S12','Lee, Troy','CONS List 261009.xlsx','CONS List 261009.xlsx',1,'source-hash',now(),
 '{"SALESREPNAME":" Lee, Troy ","FIXTURE_SOURCE":"keep me"}'::jsonb,4,null),
('name-fix-test-southtx','90002','South Customer','A','90010','South Consignee','A',
 'S17','Alldredge, Chance - South TX','CONS List 261009.xlsx','CONS List 261009.xlsx',2,'source-hash-2',now(),
 '{"SALESREPNAME":"Alldredge, Chance - South TX"}'::jsonb,1,null),
('name-fix-test-inhouse','90003','Office Customer','A','90011','Office Consignee','A',
 'S01','InHouse Sales','CONS List 261009.xlsx','CONS List 261009.xlsx',3,'source-hash-3',now(),
 '{"SALESREPNAME":"InHouse Sales"}'::jsonb,1,null),
('name-fix-test-malformed','90004','Malformed Customer','A','90012','Malformed Consignee','A',
 'S55','Lee, Troy, Jr.','CONS List 261009.xlsx','CONS List 261009.xlsx',4,'source-hash-4',now(),
 '{"SALESREPNAME":"Lee, Troy, Jr."}'::jsonb,1,null),
('name-fix-test-malformed-component','90008','Malformed Component Customer','A','90016','Malformed Component Consignee','A',
 'S59','Lee, Troy 123','CONS List 261009.xlsx','CONS List 261009.xlsx',8,'source-hash-8',now(),
 '{"SALESREPNAME":"Lee, Troy 123"}'::jsonb,1,null),
('name-fix-test-nonperson','90005','Nonperson Customer','A','90013','Nonperson Consignee','A',
 'S56','Company, Sales','CONS List 261009.xlsx','CONS List 261009.xlsx',5,'source-hash-5',now(),
 '{"SALESREPNAME":"Company, Sales"}'::jsonb,1,null),
('name-fix-test-blank','90006','Blank Customer','A','90014','Blank Consignee','A',
 'S57','','CONS List 261009.xlsx','CONS List 261009.xlsx',6,'source-hash-6',now(),
 '{"SALESREPNAME":"  "}'::jsonb,1,null),
('name-fix-test-outside-file','90007','Other Customer','A','90015','Other Consignee','A',
 'S58','Lee, Troy','Other.xlsx','Other.xlsx',7,'source-hash-7',now(),
 '{"SALESREPNAME":"Lee, Troy"}'::jsonb,1,null);

insert into public.ph_active_request(unique_id,requested_by,request_folder,req_status,req_archived,
 request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,request_selected_salesrep_id,
 customeridentityid,customername,consigneeidentityid,consigneename,request_source)
values('name-fix-test-pending','Lee, Troy','name-fix-test-folder','Pending',false,
 null,'Lee, Troy','lee_troy@greenleafnursery.com','S12',
 '90001','Fixture Customer','90009','Fixture Consignee','general');
insert into public.ph_active_request(unique_id,requested_by,request_folder,req_status,req_archived,
 request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,request_selected_salesrep_id,
 customeridentityid,customername,consigneeidentityid,consigneename,request_source)
values('name-fix-test-completed','Lee, Troy','name-fix-test-completed-folder','Complete',false,
 null,'Lee, Troy','troy_lee@greenleafnursery.com','S12',
 '90001','Fixture Customer','90009','Fixture Consignee','general');
insert into public.ph_active_request(unique_id,requested_by,request_folder,req_status,req_archived,
 request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,request_selected_salesrep_id,
 customeridentityid,customername,consigneeidentityid,consigneename,request_source)
values('name-fix-test-southtx-request','Alldredge, Chance - South TX','name-fix-test-southtx-folder','Pending',false,
 null,'Alldredge, Chance - South TX','alldredge_chance_south_tx@greenleafnursery.com','S17',
 '90002','South Customer','90010','South Consignee','general');
insert into public.ph_active_request(unique_id,requested_by,request_folder,req_status,req_archived,
 request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,request_selected_salesrep_id,
 customeridentityid,customername,consigneeidentityid,consigneename,request_source)
values('name-fix-test-active-lease-request','Troy Lee','name-fix-test-active-lease-folder','Pending',false,
 null,'Troy Lee','troy_lee@greenleafnursery.com','S12',
 '90001','Fixture Customer','90009','Fixture Consignee','general');

insert into public.ph_request_email_threads(request_folder,request_customer,sales_rep_name,sales_rep_email,recipients,status,metadata)
values('name-fix-test-folder','Fixture Customer','Lee, Troy','lee_troy@greenleafnursery.com',
 '["lee_troy@greenleafnursery.com"]'::jsonb,'open','{"custom":"preserve"}'::jsonb);
insert into public.ph_request_email_threads(request_folder,request_customer,sales_rep_name,sales_rep_email,recipients,
 initial_thread_id,initial_message_id,status,metadata)
values('name-fix-test-completed-folder','Fixture Customer','Lee, Troy','lee_troy@greenleafnursery.com',
 '["lee_troy@greenleafnursery.com"]'::jsonb,'thread-already-sent','message-already-sent','completed','{}'::jsonb);
insert into public.ph_request_email_threads(request_folder,request_customer,sales_rep_name,sales_rep_email,recipients,status)
values('name-fix-test-active-lease-folder','Fixture Customer','Lee, Troy','lee_troy@greenleafnursery.com',
 '["lee_troy@greenleafnursery.com"]'::jsonb,'open');
insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,request_id,request_folder,payload,status,
 attempt_count,channel_results)
values('91000000-0000-4000-8000-000000000001','name-fix-test-pending-event','request_created',
 'name-fix-test-pending','name-fix-test-folder',
 '{"repName":"Lee, Troy","repEmail":"lee_troy@greenleafnursery.com","recipients":["lee_troy@greenleafnursery.com"],"recipientEmails":["lee_troy@greenleafnursery.com"],"requestCreator":{"selectedRepDisplay":"Lee, Troy","selectedRepEmail":"lee_troy@greenleafnursery.com"},"requests":[{"unique_id":"name-fix-test-pending","requested_by":"Lee, Troy","request_selected_rep_display":"Lee, Troy","request_selected_rep_email":"lee_troy@greenleafnursery.com","request_selected_salesrep_id":"S12","customeridentityid":"90001","consigneeidentityid":"90009"}]}'::jsonb,
 'pending',0,'{}'::jsonb),
 ('91000000-0000-4000-8000-000000000004','name-fix-test-completion-pending','request_completed',
 'name-fix-test-completed','name-fix-test-completed-folder',
 -- Match the current folder version so reconciliation keeps this unsent event eligible.
 '{"contractVersion":"request-folder-completion-v2","membershipVersion":1,"repName":"Lee, Troy","repEmail":"lee_troy@greenleafnursery.com","requests":[{"unique_id":"name-fix-test-completed","requested_by":"Lee, Troy","request_selected_rep_display":"Lee, Troy","request_selected_rep_email":"lee_troy@greenleafnursery.com","request_selected_salesrep_id":"S12","customeridentityid":"90001","consigneeidentityid":"90009"}]}'::jsonb,
 'pending',0,'{}'::jsonb),
 ('91000000-0000-4000-8000-000000000002','name-fix-test-completed-event','request_created',
 'name-fix-test-completed','name-fix-test-completed-folder',
 '{"request_ids":["name-fix-test-completed"],"repName":"Lee, Troy","repEmail":"lee_troy@greenleafnursery.com","requests":[{"unique_id":"name-fix-test-completed","requested_by":"Lee, Troy","request_selected_rep_display":"Lee, Troy","request_selected_rep_email":"lee_troy@greenleafnursery.com","request_selected_salesrep_id":"S12","customeridentityid":"90001","consigneeidentityid":"90009"}]}'::jsonb,
 'delivered',1,'{"email":{"delivered_at":"2026-01-01T00:00:00Z"}}'::jsonb);
insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,request_id,request_folder,payload,status,
 attempt_count,channel_results)
values('91000000-0000-4000-8000-000000000005','name-fix-test-southtx-event','request_created',
 'name-fix-test-southtx-request','name-fix-test-southtx-folder',
 '{"repName":"Alldredge, Chance - South TX","repEmail":"alldredge_chance_south_tx@greenleafnursery.com","requests":[{"unique_id":"name-fix-test-southtx-request","requested_by":"Alldredge, Chance - South TX","request_selected_rep_display":"Alldredge, Chance - South TX","request_selected_rep_email":"alldredge_chance_south_tx@greenleafnursery.com","request_selected_salesrep_id":"S17","customeridentityid":"90002","consigneeidentityid":"90010"}]}'::jsonb,
 'pending',0,'{}'::jsonb);
insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,request_id,request_folder,payload,status,
 lease_token,lease_owner,lease_expires_at,channel_results)
values('91000000-0000-4000-8000-000000000006','name-fix-test-thread-lease-event','request_created',
 'name-fix-test-active-lease-request','name-fix-test-active-lease-folder',
 '{"repName":"Troy Lee","repEmail":"troy_lee@greenleafnursery.com","requests":[{"unique_id":"name-fix-test-active-lease-request","requested_by":"Troy Lee","request_selected_rep_display":"Troy Lee","request_selected_rep_email":"troy_lee@greenleafnursery.com","request_selected_salesrep_id":"S12","customeridentityid":"90001","consigneeidentityid":"90009"}]}'::jsonb,
 'processing','92000000-0000-4000-8000-000000000006','test-worker',now()+interval '1 minute','{}'::jsonb);

select lives_ok($$select pg_temp.transpose_imported_salesrep_names_v1()$$,
 'scoped maintenance routine transposes the imported name');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),
 'Troy Lee','single-comma name is trimmed and transposed');
select is((select raw_data->>'SALESREPNAME' from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),
 ' Lee, Troy ','original source text stays intact');
select is((select mapping_revision from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),5::bigint,
 'mapping revision advances once');
select is((select mapping_updated_by from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),
 'maintenance:salesrep-name-order','maintenance attribution is recorded');
select is((select row_hash from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),
 'mapping-edit-pending:5','existing mapping edit hash invalidation convention is used');
select is((select customeridentityid||'|'||consigneeid||'|'||salesrepid||'|'||filename||'|'||source_file_name||'|'||source_row_number
 from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),
 '90001|90009|S12|CONS List 261009.xlsx|CONS List 261009.xlsx|1','external IDs and import provenance stay intact');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-southtx'),
 'Chance Alldredge - South TX','confirmed South TX source label preserves its territory suffix');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-inhouse'),
 'InHouse Sales','non-person label remains unchanged');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-malformed'),
 'Lee, Troy, Jr.','multi-comma name remains unchanged');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-malformed-component'),
 'Lee, Troy 123','malformed single-comma component remains unchanged');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-nonperson'),
 'Company, Sales','non-person comma label remains unchanged');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-blank'),
 '','blank name remains unchanged');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-outside-file'),
 'Lee, Troy','rows outside the identified workbook remain unchanged');
create temporary table _salesrep_outbox_after_first_run on commit drop as
select event_id,payload,updated_at from public.ph_request_delivery_outbox
where event_id in ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000004',
  '91000000-0000-4000-8000-000000000005');
select lives_ok($$select pg_temp.transpose_imported_salesrep_names_v1()$$,
 'rerunning maintenance is safe');
select is((select mapping_revision from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),5::bigint,
 'second run does not revise an already transposed row');
select is((select count(*)::integer from _salesrep_outbox_after_first_run s
 join public.ph_request_delivery_outbox o using(event_id)
 where s.payload=o.payload and s.updated_at=o.updated_at),3,
 'second run leaves already-correct pending event payloads and timestamps unchanged');

select is((select requested_by||'|'||request_selected_rep_display||'|'||request_selected_rep_email
 from public.ph_active_request where unique_id='name-fix-test-pending'),
 'Troy Lee|Troy Lee|troy_lee@greenleafnursery.com','eligible pending request uses normalized name and address');
select is((select (payload->>'repName')||'|'||(payload->>'repEmail')||'|'||((payload->'recipients')->>0)||'|'||((payload->'recipientEmails')->>0)
 from public.ph_request_delivery_outbox where event_id='91000000-0000-4000-8000-000000000001'),
 'Troy Lee|troy_lee@greenleafnursery.com|troy_lee@greenleafnursery.com|troy_lee@greenleafnursery.com','pending payload recipient and display snapshot are repaired');
select is((select ((payload->'requests')->0->>'request_selected_rep_display')||'|'||((payload->'requests')->0->>'request_selected_rep_email')
 from public.ph_request_delivery_outbox where event_id='91000000-0000-4000-8000-000000000001'),
 'Troy Lee|troy_lee@greenleafnursery.com','pending request snapshot is repaired');
select is((select (payload->'requestCreator'->>'selectedRepDisplay')||'|'||(payload->'requestCreator'->>'selectedRepEmail')
 from public.ph_request_delivery_outbox where event_id='91000000-0000-4000-8000-000000000001'),
 'Troy Lee|troy_lee@greenleafnursery.com','request creator snapshot uses the same name and email correction without request identifiers');
select is((select event_id||'|'||event_key||'|'||attempt_count from public.ph_request_delivery_outbox
 where event_id='91000000-0000-4000-8000-000000000001'),
 '91000000-0000-4000-8000-000000000001|name-fix-test-pending-event|0','delivery identifiers and attempt count are preserved');
select is((select sales_rep_name||'|'||sales_rep_email||'|'||(recipients->>0)||'|'||(metadata->>'custom')
 from public.ph_request_email_threads where request_folder='name-fix-test-folder'),
 'Troy Lee|troy_lee@greenleafnursery.com|troy_lee@greenleafnursery.com|preserve','unsent thread fields and recipient string update while unrelated metadata remains intact');
select is((select requested_by||'|'||request_selected_rep_display||'|'||request_selected_rep_email
 from public.ph_active_request where unique_id='name-fix-test-completed'),
 'Lee, Troy|Lee, Troy|troy_lee@greenleafnursery.com','completed requests remain untouched');
select is((select (payload->>'repName')||'|'||(payload->>'repEmail')||'|'||((payload->'requests')->0->>'request_selected_rep_display')
 from public.ph_request_delivery_outbox where event_id='91000000-0000-4000-8000-000000000004'),
 'Troy Lee|troy_lee@greenleafnursery.com|Troy Lee','pending completion payload is corrected without changing completed request fields');
select is((select (payload->>'repName')||'|'||(payload->>'repEmail')||'|'||status||'|'||attempt_count
 from public.ph_request_delivery_outbox where event_id='91000000-0000-4000-8000-000000000002'),
 'Lee, Troy|lee_troy@greenleafnursery.com|delivered|1','delivered queue event remains untouched');
select is((select (payload->>'repName')||'|'||(payload->>'repEmail')||'|'||((payload->'requests')->0->>'request_selected_rep_email')
 from public.ph_request_delivery_outbox where event_id='91000000-0000-4000-8000-000000000005'),
 'Chance Alldredge - South TX|chance_alldredge@greenleafnursery.com|chance_alldredge@greenleafnursery.com',
 'South TX exception repairs its known destination address');
select is((select sales_rep_name||'|'||sales_rep_email||'|'||initial_thread_id||'|'||initial_message_id||'|'||status
 from public.ph_request_email_threads where request_folder='name-fix-test-completed-folder'),
 'Lee, Troy|lee_troy@greenleafnursery.com|thread-already-sent|message-already-sent|completed',
 'completed thread with recorded Gmail identifiers is preserved');
select is((select sales_rep_name||'|'||sales_rep_email||'|'||(recipients->>0)
 from public.ph_request_email_threads where request_folder='name-fix-test-active-lease-folder'),
 'Lee, Troy|lee_troy@greenleafnursery.com|lee_troy@greenleafnursery.com',
 'thread metadata is not changed while its associated event has an active delivery lease');

-- An affected active lease is a hard stop; pgTAP rolls back the failed call.
insert into public.ph_active_request(unique_id,requested_by,request_folder,req_status,req_archived,
 request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,request_selected_salesrep_id,
 customeridentityid,customername,consigneeidentityid,consigneename,request_source)
values('name-fix-test-leased','Lee, Troy','name-fix-test-leased-folder','Pending',false,
 null,'Lee, Troy','lee_troy@greenleafnursery.com','S12','90001','Fixture Customer','90009','Fixture Consignee','general');
insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,request_id,request_folder,payload,status,
 lease_token,lease_owner,lease_expires_at,channel_results)
values('91000000-0000-4000-8000-000000000003','name-fix-test-leased-event','request_created',
 'name-fix-test-leased','name-fix-test-leased-folder','{"repName":"Lee, Troy","repEmail":"lee_troy@greenleafnursery.com"}'::jsonb,
 'processing','92000000-0000-4000-8000-000000000001','test-worker',now()+interval '1 minute','{}'::jsonb);
select throws_ok($$select pg_temp.transpose_imported_salesrep_names_v1()$$,
 '55000','SALESREP_NAME_ACTIVE_DELIVERY_LEASE','affected active lease blocks cleanup');
select is((select salesrepname from public.ph_customer_consignee_sales_reps where unique_id='name-fix-test-source'),
 'Troy Lee','lease rejection rolls back all cleanup side effects');

select * from finish();
rollback;
