-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('fc100000-0000-4000-8000-000000000001','field-admin@example.invalid','{}','{}'),
 ('fc100000-0000-4000-8000-000000000002','field-csr@example.invalid','{}','{}'),
 ('fc100000-0000-4000-8000-000000000003','field-dylan@example.invalid','{}','{}') on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('fc100000-0000-4000-8000-000000000001','field_admin','Field Admin','ADMIN',false),
 ('fc100000-0000-4000-8000-000000000002','field_csr','Field CSR','CSR',false) on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('fc100000-0000-4000-8000-000000000003','dylan_collyge','Dylan','ADMIN',false)
 on conflict(username) do update set disabled_at=null,locked_until=null,must_change_password=false;
update auth.users set email='field-dylan@example.invalid' where id=(select id from public.profiles where username='dylan_collyge');
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,season,ptronhand,photo_link,spec) values
 ('FIELD-ONE','00021','Oak ®','3 gal','FC','FC.01.000','LOT-1','F1','12','keep-photo','keep-spec'),
 ('FIELD-TWO','00021','Oak ®','3 gal','FC','FC.01.000','LOT-2','S1','23',null,null),
 ('FIELD-OTHER','00022','Maple ™','5 gal','FC','FC.02.000','LOT-3','F1','30',null,null);
insert into public.app_dataset_revisions(key,state) values('ph_master_inventory','ready') on conflict(key) do update set state='ready';
create temporary table field_payload(payload jsonb) on commit drop;
insert into field_payload values ('{"countType":"bunch","scope":{"block":"FC","location":"FC.01.000"},"direction":"north_south","entries":[{"sourceUid":"FIELD-ONE","countedQty":0,"note":"No plants on first row","expectedUpdatedAt":null,"rowOrder":1},{"sourceUid":"FIELD-TWO","countedQty":22,"note":"Checked ®","expectedUpdatedAt":null,"rowOrder":2}]}');

select ok(not has_function_privilege('authenticated','public.field_count_command_v1(uuid,text,jsonb,uuid)','execute'),'clients cannot impersonate a field-count actor');
select ok(not has_table_privilege('authenticated','workflow_private.field_count_reports','select'),'private reports have no broad read grant');
select throws_ok($$select public.field_count_command_v1('fc100000-0000-4000-8000-000000000002','read','{"countType":"bunch"}')$$,'42501','FIELD_COUNT_FORBIDDEN','CSR cannot access manager counting scope');
select is((public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','read','{"countType":"bunch","block":"FC"}')->>'total')::integer,2,'location directory groups physical rows before pagination');
select is((public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','read','{"countType":"bunch","block":"FC","page":9}')->>'total')::integer,2,'deep empty page preserves the exact directory total');
select is((public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','read','{"countType":"bunch","block":"FC","location":"FC.01.000"}')->>'total')::integer,2,'location read does not include other locations');
select is(public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','read','{"countType":"bunch","block":"FC","location":"FC.01.000"}')#>>'{rows,0,itemcode}','00021','leading zeros and source identities survive projections');
create temporary table first_receipt as select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','save',payload,'fc200000-0000-4000-8000-000000000001') receipt from field_payload;
select is((select counted_qty from public.ph_bunch_counts where source_unique_id='FIELD-ONE'),0::numeric,'zero is a saved count, not a blank draft');
select is((select counted_by_username from public.ph_bunch_counts where source_unique_id='FIELD-TWO'),'field_admin','audit identity comes from the authenticated profile');
select is((select snapshot->>'field_note' from public.ph_bunch_counts where source_unique_id='FIELD-TWO'),'Checked ®','contextual notes preserve Unicode');
select is((select ptronhand||'|'||photo_link||'|'||spec from public.ph_master_inventory where unique_id='FIELD-ONE'),'12|keep-photo|keep-spec','counting never changes inventory quantities or evidence');
select is((select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','save',payload,'fc200000-0000-4000-8000-000000000001') from field_payload),(select receipt from first_receipt),'retry returns the same confirmed receipt');
select throws_ok($$select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','save',payload,'fc200000-0000-4000-8000-000000000002') from field_payload$$,'40001','FIELD_COUNT_REVISION_CONFLICT','stale counts cannot overwrite newer observations');
update field_payload set payload=jsonb_set(payload,'{entries}',(select jsonb_agg(e||jsonb_build_object('expectedUpdatedAt',c.updated_at) order by e->>'sourceUid') from jsonb_array_elements(payload->'entries') e join public.ph_bunch_counts c on c.source_unique_id=e->>'sourceUid'));
create temporary table completion_receipt as select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','complete',payload,'fc200000-0000-4000-8000-000000000003') receipt from field_payload;
select is((select receipt->>'deliveryStatus' from completion_receipt),'queued','completion only claims queued email');
select is((select count(*)::integer from public.ph_request_delivery_outbox where event_key='field-count:fc200000-0000-4000-8000-000000000003'),1,'one completion outbox event is committed with counts');
select is((select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','complete',payload,'fc200000-0000-4000-8000-000000000003') from field_payload),(select receipt from completion_receipt),'completion retries do not queue duplicate reports');
select ok((select recipients @> '[{"username":"dylan_collyge"}]'::jsonb from workflow_private.field_count_reports where id='fc200000-0000-4000-8000-000000000003'),'report recipients include required server-mapped supervisor');
update public.ph_master_inventory set commonname='Later import' where unique_id='FIELD-ONE';
select is((select report#>>'{rows,0,commonname}' from workflow_private.field_count_reports where id='fc200000-0000-4000-8000-000000000003'),'Oak ®','completion report is a frozen source and observation snapshot');
select is((select count(*)::integer from public.ph_spread_counts where source_unique_id like 'FIELD-%'),0,'bunch saves do not write spread counts');
select throws_ok($$select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','save',jsonb_set(payload,'{entries,0,countedQty}','-1'),'fc200000-0000-4000-8000-000000000004') from field_payload$$,'P0001','FIELD_COUNT_ENTRY_INVALID','negative counts are rejected');
select throws_ok($$select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','save',jsonb_set(payload,'{entries,0,countedQty}','1.5'),'fc200000-0000-4000-8000-000000000004') from field_payload$$,'P0001','FIELD_COUNT_ENTRY_INVALID','fractional field quantities are rejected');
select throws_ok($$select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','read','{"countType":"bunch","table":"profiles"}')$$,'P0001','FIELD_COUNT_PAYLOAD_INVALID','callers cannot name arbitrary tables');
create temporary table report_event as select event_id from workflow_private.field_count_reports where id='fc200000-0000-4000-8000-000000000003';
select is(public.field_count_delivery_lookup_v1((select event_id from report_event))->>'pdf',null,'PDF is not exposed before it is frozen');
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.field_count_freeze_pdf_v1((select event_id from report_event),'{}')$$,'42501','FIELD_COUNT_FORBIDDEN','only the delivery service can freeze a PDF');
select set_config('request.jwt.claim.role','service_role',true);
create temporary table frozen_pdf as
 select public.field_count_freeze_pdf_v1((select event_id from report_event),
   jsonb_build_object('filename','Field_Count_fc200000-0000-4000-8000-000000000003.pdf','base64','JVBERi0xLjQKZmFrZQ==')) result;
select is((select result#>>'{pdf,filename}' from frozen_pdf),'Field_Count_fc200000-0000-4000-8000-000000000003.pdf','service freezes a correctly named report PDF');
select is(public.field_count_freeze_pdf_v1((select event_id from report_event),
   jsonb_build_object('filename','Field_Count_fc200000-0000-4000-8000-000000000003.pdf','base64','JVBERi0xLjUKb3RoZXI=')),
   (select result from frozen_pdf),'retries cannot replace the original frozen PDF');
update public.ph_request_delivery_outbox set status='processing',lease_token='fc300000-0000-4000-8000-000000000001',lease_expires_at=now()+interval '10 minutes' where event_id=(select event_id from report_event);
select throws_ok($$select public.field_count_delivery_record_v1((select event_id from report_event),'fc300000-0000-4000-8000-000000000002','sending','{}')$$,'P0001','FIELD_COUNT_DELIVERY_LEASE_LOST','a different lease token cannot record delivery');
update public.ph_request_delivery_outbox set lease_expires_at=now()-interval '1 second' where event_id=(select event_id from report_event);
select throws_ok($$select public.field_count_delivery_record_v1((select event_id from report_event),'fc300000-0000-4000-8000-000000000001','sending','{}')$$,'P0001','FIELD_COUNT_DELIVERY_LEASE_LOST','an expired lease cannot record delivery');
update public.ph_request_delivery_outbox set lease_expires_at=now()+interval '10 minutes' where event_id=(select event_id from report_event);
select is((public.field_count_delivery_record_v1((select event_id from report_event),'fc300000-0000-4000-8000-000000000001','sending','{}')->>'allow_send')::boolean,true,'first durable send intent permits one send');
select is((public.field_count_delivery_record_v1((select event_id from report_event),'fc300000-0000-4000-8000-000000000001','sending','{}')->>'allow_send')::boolean,false,'repeated send intent requires reconciliation');
select throws_ok($$select public.field_count_delivery_record_v1((select event_id from report_event),'fc300000-0000-4000-8000-000000000001','failed','{"safe_to_retry":true}')$$,'P0001','FIELD_COUNT_RECONCILIATION_REQUIRED','transport failure cannot erase a saved send intent');
select lives_ok($$select public.field_count_delivery_record_v1((select event_id from report_event),'fc300000-0000-4000-8000-000000000001','sent','{"gmail_message_id":"synthetic-1"}')$$,'verified Gmail receipt completes delivery');
select is(public.field_count_delivery_lookup_v1((select event_id from report_event))#>>'{receipt,gmail_message_id}','synthetic-1','lost acknowledgement can recover the durable receipt');
update public.app_dataset_revisions set state='importing' where key='ph_master_inventory';
select throws_ok($$select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','read','{"countType":"bunch"}')$$,'55000','FIELD_COUNT_INVENTORY_UPDATING','partial imports cannot be presented as complete counting inventory');
select is((select public.field_count_command_v1('fc100000-0000-4000-8000-000000000001','complete',payload,'fc200000-0000-4000-8000-000000000003') from field_payload),(select receipt from completion_receipt),'a confirmed retry returns its receipt even during a later import');
select * from finish();
rollback;
