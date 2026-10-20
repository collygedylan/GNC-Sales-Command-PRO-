-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(32);
-- Delivery resolves the fixed Dylan/Megan identities plus the submitting Rep.
-- These synthetic confirmed recipients exist only in this rollback transaction.
create temporary table rep_operations_fixed_recipients(username text primary key,id uuid not null,email text not null) on commit drop;
insert into rep_operations_fixed_recipients values
 ('dylan_collyge',gen_random_uuid(),'rep-operations-dylan-'||gen_random_uuid()::text||'@example.invalid'),
 ('megan_kelly',gen_random_uuid(),'rep-operations-megan-'||gen_random_uuid()::text||'@example.invalid');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,email,now(),'{}'::jsonb,'{}'::jsonb from rep_operations_fixed_recipients;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select id,username,username,'ADMIN',false,null,null from rep_operations_fixed_recipients;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('f7160000-0000-4000-8000-000000000001','operations-rep@example.invalid',now(),'{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('f7160000-0000-4000-8000-000000000001','operations_rep','Operations Rep',E'\nREP\r\n',false);
insert into private.navigation_view_catalog(view_key,label,selectable) values('drive','Drive',true) on conflict(view_key) do nothing;
insert into private.navigation_view_overrides(profile_id,view_key,allowed) values('f7160000-0000-4000-8000-000000000001','drive',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,priority,source,season,saleyear,spec,photo_link)
values('rep-operations-source','REP-OPERATIONS','Synthetic operations plant','#3','R.01.001','27.U3','10','9','2','PH','U3','27','Synthetic spec','https://example.invalid/rep.jpg');
update public.app_dataset_revisions set state='ready',revision=greatest(revision,1) where key='ph_master_inventory';
select set_config('request.jwt.claim.sub','f7160000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f7160000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select ok(has_table_privilege('authenticated','public.ph_master_inventory','select'),'Authenticated rep has inventory SELECT');
select ok(not has_table_privilege('authenticated','public.ph_master_inventory','update'),'Raw inventory mutation remains denied');
select ok(not has_function_privilege('authenticated','public.enqueue_drive_reclass_inquiry_v7(jsonb)','execute'),'Browser cannot forge an operational actor');
select ok(not has_function_privilege('authenticated','private.sales_rep_operation_scope_v1(uuid)','execute'),'Browser cannot invoke private operation scope');
select ok(not has_function_privilege('service_role','private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)','execute')
  and not has_function_privilege('authenticated','private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)','execute')
  and not has_function_privilege('anon','private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)','execute'),
  'Canonical delivery implementation is callable only through its secured wrapper');
set local role authenticated;
select is((select spec from public.ph_master_inventory where unique_id='rep-operations-source'),'Synthetic spec','REP reads specifications even on U3');
select is((select photo_link from public.ph_master_inventory where unique_id='rep-operations-source'),'https://example.invalid/rep.jpg','REP reads inventory images');
reset role;
update public.profiles set disabled_at=now() where username='operations_rep';
set local role authenticated;
select is((select count(*)::integer from public.ph_master_inventory where unique_id='rep-operations-source'),0,'Disabled account loses inventory access');
reset role;
update public.profiles set disabled_at=null where username='operations_rep';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
select is(private.sales_rep_operation_scope_v1('f7160000-0000-4000-8000-000000000001'),false,'Absent scope is false rather than nullable');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v1('{"actorUsername":"operations_rep"}'::jsonb)$$,
 '42501','DRIVE_RECLASS_FORBIDDEN','Legacy entry point cannot inherit rep operations without V7 validation');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7('{"actorUsername":"operations_rep"}'::jsonb)$$,
 '42501','DRIVE_RECLASS_FORBIDDEN','V7 rejects non-service callers before opening any operation scope');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.rep_operations_payload(p_token text,p_action text default 'hold') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v7-editable-fields-20261009',
    'idempotencyToken',p_token,'actorUsername','operations_rep','sourceContext',jsonb_build_object('sourceMode','drive'),
    'source',jsonb_build_object('unique_id',m.unique_id,'source_table','ph_master_inventory','itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode),
    'transaction',jsonb_build_object('requestActions',case when m.priority is distinct from '8' then jsonb_build_array(p_action,'priority_change') else jsonb_build_array(p_action) end,
      'holdStopProposals',jsonb_build_array(jsonb_build_object('action',p_action,'reason',case when p_action in ('take_off_hold','off_stop_ship') then '' else 'Rep field inspection' end,'sourceUid',m.unique_id)), 'scope','{}'::jsonb),
    'rowOverlays',jsonb_build_array(jsonb_build_object('unique_id',m.unique_id,'resolution','done',
      'expected',jsonb_build_object('itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode,'ptronhand',m.ptronhand,
        'desigitem',coalesce(m.desigitem,''),'priority',m.priority,'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason),
      'proposals',case when m.priority is distinct from '8' then jsonb_build_array(jsonb_build_object('action','priority_change','priority','8')) else '[]'::jsonb end,'fieldEdits','[]'::jsonb)))
  from public.ph_master_inventory m where unique_id='rep-operations-source'
$$;
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7(jsonb_set(
  pg_temp.rep_operations_payload('rep-operations-off-drive-0008'),'{sourceContext,sourceMode}','"item-inquiry"'))$$,
 '42501','SALES_REP_OPERATION_FORBIDDEN','Rep operation scope cannot authorize another source mode');
create temporary table rep_operations_input(payload jsonb);
insert into rep_operations_input values(pg_temp.rep_operations_payload('rep-operations-token-0001'));
create temporary table rep_operations_result as select public.enqueue_drive_reclass_inquiry_v7(payload) result from rep_operations_input;
select is((select priority from public.ph_master_inventory where unique_id='rep-operations-source'),'8','Rep priority change commits');
select is((select holdstopcode from public.ph_master_inventory where unique_id='rep-operations-source'),'H','Rep hold commits');
select is((select holdstopreason from public.ph_master_inventory where unique_id='rep-operations-source'),'Rep field inspection','Rep hold reason commits');
select is((select ptronhand from public.ph_master_inventory where unique_id='rep-operations-source'),'10','Operations preserve inventory quantity');
select is((select result->>'duplicate' from rep_operations_result),'false','Audited delivery is newly queued');
select is((select array_agg(email order by email) from public.ph_request_delivery_outbox o,
  jsonb_array_elements_text(o.payload #> '{reclassPayload,recipientEmails}') recipients(email)
  where o.event_type='reclass_inquiry' and o.payload #>> '{reclassPayload,actor,username}'='operations_rep'),
  (select array_agg(email order by email) from (
    select email from rep_operations_fixed_recipients union all select 'operations-rep@example.invalid') expected),
  'Queued Rep operation routes exactly to Dylan, Megan, and the submitting Rep');
select is((select public.enqueue_drive_reclass_inquiry_v7(payload)->>'duplicate' from rep_operations_input),'true','Rep retry is idempotent');
select is(coalesce(current_setting('gnc.sales_rep_operation_actor',true),''),'','Scoped authorization is removed after success');
create temporary table rep_stop_result as select public.enqueue_drive_reclass_inquiry_v7(pg_temp.rep_operations_payload('rep-operations-stop-0005','stop_ship'));
select is((select holdstopcode from public.ph_master_inventory where unique_id='rep-operations-source'),'HS','Rep stop shipping preserves the existing Hold');
select is((select holdstopbegindate from public.ph_master_inventory where unique_id='rep-operations-source'),to_char(now() at time zone 'America/Chicago','YYYY-MM-DD'),'Rep stop date is stamped by the server');
create temporary table rep_clear_result as select public.enqueue_drive_reclass_inquiry_v7(pg_temp.rep_operations_payload('rep-operations-clear-0006','off_stop_ship'));
select is((select holdstopcode from public.ph_master_inventory where unique_id='rep-operations-source'),'H','Rep can clear stop shipping while retaining Hold');
select is((select holdstopbegindate from public.ph_master_inventory where unique_id='rep-operations-source'),to_char(now() at time zone 'America/Chicago','YYYY-MM-DD'),'Remaining Hold retains its date');
create temporary table rep_hold_clear_result as select public.enqueue_drive_reclass_inquiry_v7(pg_temp.rep_operations_payload('rep-operations-hold-clear-0007','take_off_hold'));
select is((select holdstopcode from public.ph_master_inventory where unique_id='rep-operations-source'),null::text,'Rep can remove the remaining Hold');
select is((select holdstopbegindate from public.ph_master_inventory where unique_id='rep-operations-source'),null::text,'Final removal clears the Hold/Stop date');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7(jsonb_set(jsonb_set(pg_temp.rep_operations_payload('rep-operations-fields-0002'),'{transaction,requestActions}','["hold","inventory_fields"]'),'{rowOverlays,0,fieldEdits}','[{"field":"locationnote","expected":null,"value":"Forbidden edit"}]'))$$,
 '42501','SALES_REP_OPERATION_FORBIDDEN','Rep cannot turn operational access into inventory field edits');
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
values(private.resolve_app_access_policy_id_v1(false),'f7160000-0000-4000-8000-000000000001','drive.reclass.submit',false,'global');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7(pg_temp.rep_operations_payload('rep-operations-denied-0004'))$$,
 '42501','DRIVE_RECLASS_FORBIDDEN','An explicit administrator denial remains effective');
delete from private.app_access_user_overrides where profile_id='f7160000-0000-4000-8000-000000000001';
update private.navigation_view_overrides set allowed=false where profile_id='f7160000-0000-4000-8000-000000000001' and view_key='drive';
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7(pg_temp.rep_operations_payload('rep-operations-no-drive-0009'))$$,
 '42501','DRIVE_RECLASS_FORBIDDEN','Revoked Drive navigation prevents Rep operations');
update private.navigation_view_overrides set allowed=true where profile_id='f7160000-0000-4000-8000-000000000001' and view_key='drive';
update public.profiles set locked_until=now()+interval '1 day' where username='operations_rep';
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7(pg_temp.rep_operations_payload('rep-operations-locked-0003'))$$,
 '42501','DRIVE_RECLASS_PROFILE_NOT_ACTIVE','Locked actor cannot submit operations');
select is(coalesce(current_setting('gnc.sales_rep_operation_actor',true),''),'','Scoped authorization is removed after failure');
select ok(not has_function_privilege('authenticated','private.ph_holdstop_strict_reduction_v1(text,text)','execute'),'Import helper remains hidden from browser');
select * from finish();
rollback;
