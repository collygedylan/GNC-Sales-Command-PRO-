begin;
set local session_replication_role=replica;
insert into private.inventory_row_assignment_input_generation(singleton) values(true);
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000076'),('00000000-0000-0000-0000-000000000077');
update auth.users set email='fixture-admin@example.invalid',email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000076';
with recipients(username) as (values ('dylan_collyge'),('megan_kelly'),('sharon_combs'))
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
select gen_random_uuid(),username||'@example.invalid',now(),'{}','{}' from recipients;
insert into public.profiles(id,username,role,must_change_password)
select id,split_part(email,'@',1),'ADMIN',false from auth.users where email in
 ('dylan_collyge@example.invalid','megan_kelly@example.invalid','sharon_combs@example.invalid');
insert into public.ph_app_users(id,username,password,role,must_change_password)
values (3076,'fixture_admin','','ADMIN',false),(3077,'fixture_other_admin','','ADMIN',false);
insert into public.profiles(id,legacy_user_id,username,role,must_change_password)
values ('00000000-0000-0000-0000-000000000076',3076,'fixture_admin','REP',false),
 ('00000000-0000-0000-0000-000000000077',3077,'fixture_other_admin','ADMIN',false);
insert into public.user_access(profile_id,username,display_name,role,userrole,submit_reclass,edit_any_row)
values ('00000000-0000-0000-0000-000000000076','fixture_admin','Fixture Admin','ADMIN','ADMIN','N','N'),
 ('00000000-0000-0000-0000-000000000077','fixture_other_admin','Other Admin','ADMIN','ADMIN','N','N');
insert into public.user_access_control(profile_id,username,canonical_role,active)
values ('00000000-0000-0000-0000-000000000076','fixture_admin','admin',true),
 ('00000000-0000-0000-0000-000000000077','fixture_other_admin','admin',true);
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,season,saleyear,ptronhand,ptravailable,ptrreviewed,s_lts,source,contsize)
values ('fixture-y','FIXTURE','A.01','27.Y','Y','2027','50','50','0','50','PH','#3'),
 ('fixture-bare-y','FIXTURE','A.02','Y','Y','2027','50','50','0','50','PH','#3'),
 ('fixture-single-y','SINGLE','A.04','Y','Y','2027','50','50','0','50','PH','#3'),
 ('fixture-staff-y','STAFF','A.05','27.Y','Y','2027','50','50','0','50','PH','#3'),
 ('fixture-staff-bare-y','STAFF','A.06','Y','Y','2027','50','50','0','50','PH','#3'),
 ('fixture-f1','FIXTURE','A.03','27.F1','F1','2027','50','50','0','50','PH','#3');
-- Fixture role changes stay isolated from unrelated ERP dataset-registration triggers.
set local request.jwt.claim.role='service_role';
set local session_replication_role=origin;
create function pg_temp.reject_reclass_scope_v3076() returns trigger language plpgsql as $fn$
begin
 if new.unique_id='fixture-y' and new.locationnote='Force local scoped failure' then raise exception 'FIXTURE_RECLASS_SCOPE_FAILURE'; end if;
 return new;
end $fn$;
create trigger fixture_reclass_scope_failure before update on public.ph_master_inventory
for each row execute function pg_temp.reject_reclass_scope_v3076();
do $test$
declare actor uuid:='00000000-0000-0000-0000-000000000076'; command jsonb; result jsonb; child jsonb; scope text;
begin
 command:='{"action":"drive_reclass_inquiry","operation":"create","actorUsername":"fixture_admin","idempotencyToken":"fixture-y-inquiry-3076","workflowPolicyVersion":"reclass-action-workflow-v7-editable-fields-20261009","source":{"unique_id":"fixture-f1","source_table":"ph_master_inventory","itemcode":"FIXTURE","lotcode":"27.F1","locationcode":"A.03"},"sourceContext":{"sourceMode":"drive"},"transaction":{"requestActions":["inventory_fields"],"holdStopProposals":[],"scope":{}},"rowOverlays":[{"unique_id":"fixture-f1","expected":{"itemcode":"FIXTURE","lotcode":"27.F1","locationcode":"A.03","ptronhand":"50"},"proposals":[],"fieldEdits":[]},{"unique_id":"fixture-y","expected":{"itemcode":"FIXTURE","lotcode":"27.Y","locationcode":"A.01","ptronhand":"50"},"proposals":[],"fieldEdits":[{"field":"locationnote","expected":null,"value":"Y secondary reviewed"}]}]}';
 if not public.authorize_reclass_command_v3076(actor,command) then raise exception 'Y_SECONDARY_CONTEXT_DENIED'; end if;
 result:=public.enqueue_drive_reclass_inquiry_v7(command-'action'-'operation');
 if not coalesce((result->>'ok')::boolean,false) then raise exception 'NESTED_Y_INQUIRY_FAILED'; end if;
 if (select locationnote from public.ph_master_inventory where unique_id='fixture-y')<>'Y secondary reviewed'
   or (select locationnote from public.ph_master_inventory where unique_id='fixture-f1') is not null then raise exception 'INQUIRY_CONTEXT_ROW_MUTATED'; end if;
 if nullif(current_setting('gnc.reclass_parent_scope_v3076',true),'') is not null then raise exception 'PARENT_SCOPE_LEAKED'; end if;
 begin
   perform public.enqueue_drive_reclass_inquiry_v7(jsonb_set(command-'action'-'operation',
     '{rowOverlays,1,fieldEdits,0,value}','"Force local scoped failure"')||'{"idempotencyToken":"fixture-y-inquiry-failure-3076"}');
   raise exception 'EXPECTED_INQUIRY_FAILURE_NOT_OBSERVED';
 exception when others then
   if sqlerrm<>'FIXTURE_RECLASS_SCOPE_FAILURE' then raise; end if;
 end;
 if nullif(current_setting('gnc.reclass_parent_scope_v3076',true),'') is not null then raise exception 'FAILED_PARENT_SCOPE_LEAKED'; end if;
 scope:=jsonb_build_object('actor',actor,'token','fixture-y-inquiry-3076','sourceUid','fixture-f1','ids',jsonb_build_array('fixture-y'))::text;
 perform set_config('gnc.reclass_parent_scope_v3076',scope,true);
 child:=(command-'workflowPolicyVersion')||jsonb_build_object('transaction','{"requestActions":[],"holdStopProposals":[]}'::jsonb,'rowOverlays','[]'::jsonb);
 if not private.reclass_parent_scope_v3076(actor,child) then raise exception 'VERIFIED_READ_ONLY_CHILD_DENIED'; end if;
 if private.reclass_parent_scope_v3076('00000000-0000-0000-0000-000000000077',child)
   or private.reclass_parent_scope_v3076(actor,child||'{"idempotencyToken":"unrelated-command-3076"}')
   or private.reclass_parent_scope_v3076(actor,jsonb_set(child,'{source,unique_id}','"fixture-staff-y"')) then raise exception 'PARENT_SCOPE_CROSSED_IDENTITY'; end if;
 perform set_config('gnc.reclass_parent_scope_v3076','',true);
end $test$;
drop trigger fixture_reclass_scope_failure on public.ph_master_inventory;
set local session_replication_role=replica;
do $test$
declare actor uuid:='00000000-0000-0000-0000-000000000076'; command jsonb; attempt jsonb;
begin
 if not private.is_reclass_administrator_v3076(actor) then raise exception 'ACTUAL_ADMIN_NOT_RESOLVED'; end if;
 perform private.require_reclass_explanations_v303(actor,'{}',array['fixture-y']);
 command:='{"action":"inventory_reclass_move","commandId":"fixture-y-command-3076","moves":[{"source":{"uniqueId":"fixture-y"},"lines":[{"direction":"move_up","destinationSeason":"F1","quantity":1}]}]}';
 if not public.can_reclass_y_administrator_v3076(actor,command) then raise exception 'DOTTED_Y_ADMIN_DENIED'; end if;
 attempt:=jsonb_set(command,'{moves,0,source,uniqueId}','"fixture-bare-y"');
 if not public.can_reclass_y_administrator_v3076(actor,attempt) then raise exception 'BARE_Y_ADMIN_DENIED'; end if;
 for attempt in select value from jsonb_array_elements(jsonb_build_array(
   jsonb_set(command,'{moves,0,source,uniqueId}','"missing"'),jsonb_set(command,'{moves,0,source,uniqueId}','"fixture-f1"'),
   jsonb_set(command,'{moves}','[]'),jsonb_set(command,'{moves}',(command->'moves')||(command->'moves')),
   command||'{"role":"super-admin"}',command||'{"operation":"delete"}',command||'{"action":"manager_table_management"}',
   jsonb_set(command,'{moves}',(command->'moves')||jsonb_set(command->'moves'->0,'{source,uniqueId}','"fixture-f1"')))) loop
   if public.can_reclass_y_administrator_v3076(actor,attempt) then raise exception 'UNSAFE_Y_EXCEPTION_ACCEPTED: %',attempt; end if;
 end loop;
 update public.user_access set role='REP' where profile_id=actor;
 if private.is_reclass_administrator_v3076(actor) or public.can_reclass_y_administrator_v3076(actor,command) then raise exception 'CURRENT_ROLE_DOWNGRADE_IGNORED'; end if;
 begin perform private.require_reclass_explanations_v303(actor,'{}',array['fixture-y']);
   raise exception 'NONADMIN_BLANK_EXPLANATION_ACCEPTED'; exception when invalid_parameter_value then null; end;
 perform private.require_reclass_explanations_v303(actor,'{"fixture-y":"Reviewed"}',array['fixture-y']);
 update public.user_access set role='super-admin' where profile_id=actor;
 if not private.is_reclass_administrator_v3076(actor) then raise exception 'SUPERADMIN_NOT_RESOLVED'; end if;
 update public.user_access set role='a-d-m-i-n' where profile_id=actor;
 if private.is_reclass_administrator_v3076(actor) then raise exception 'MALFORMED_ADMIN_ROLE_ACCEPTED'; end if;
 update public.user_access set role='ADMIN' where profile_id=actor;
 update public.user_access_control set permission_overrides='{"can_access_drive_mode":false,"can_access_av":false,"can_access_que":false,"can_access_manager_tab":false,"can_access_eval_reports_2":false}' where profile_id=actor;
 if public.can_reclass_y_administrator_v3076(actor,command) then raise exception 'MODULE_DENY_IGNORED'; end if;
 update public.user_access_control set permission_overrides='{}' where profile_id=actor;
 update public.ph_app_users set disabled_at=now() where id=3076;
 if private.is_reclass_administrator_v3076(actor) then raise exception 'DISABLED_ACCOUNT_ACCEPTED'; end if;
end $test$;
update public.ph_app_users set disabled_at=null where id=3076;
do $test$
declare actual jsonb; sample record; actor uuid:='00000000-0000-0000-0000-000000000076';
begin
 actual:=private.reclass_source_lot_v3076('Y','Y','2027',actor);
 if actual<>'{"season":"Y","stem":"27"}' then raise exception 'BARE_Y_YEAR_NOT_PRESERVED'; end if;
 if private.reclass_source_lot_v3076('lot.segment.Y','Y','2027',actor)->>'stem'<>'lot.segment' then raise exception 'PHYSICAL_PREFIX_CHANGED'; end if;
 for sample in select * from (values ('Y','Y',null::text),('Y','Y','2027.5'),('Y','Y',''),('Y','F1','2027'),('F1','F1','2027'),('27.Y','F1','2027')) s(lot,season,salesyear) loop
   begin perform private.reclass_source_lot_v3076(sample.lot,sample.season,sample.salesyear,actor);
     raise exception 'UNPROVEN_LOT_ACCEPTED'; exception when invalid_parameter_value then null; end;
 end loop;
end $test$;
create function pg_temp.reclass_y_source(uid text) returns jsonb language sql stable as $fn$
 select jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object('unique_id',m.unique_id,
   'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
   'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)) from public.ph_master_inventory m where m.unique_id=uid
$fn$;
set local session_replication_role=origin;
do $test$
declare actor uuid:='00000000-0000-0000-0000-000000000076'; source jsonb; result jsonb; replay jsonb; revision bigint;
begin
 source:=pg_temp.reclass_y_source('fixture-single-y');
 select r.revision into revision from public.app_dataset_revisions r where key='ph_master_inventory';
 result:=public.apply_inventory_reclass_move_v1(actor,'test:y-single-3076',revision,'fixture-single-y',source->'identity',
   '[{"direction":"move_up","destinationSeason":"F1","quantity":2}]');
 if result->>'status'<>'applied' or (select lotcode from public.ph_master_inventory where unique_id='fixture-single-y')<>'Y'
   or not exists(select 1 from public.ph_master_inventory where itemcode='SINGLE' and lotcode='27.F1' and ptronhand='2') then
   raise exception 'SINGLE_BARE_Y_MOVEMENT_NOT_PROVEN'; end if;
 replay:=public.apply_inventory_reclass_move_v1(actor,'test:y-single-3076',revision,'fixture-single-y',source->'identity',
   '[{"direction":"move_up","destinationSeason":"F1","quantity":2}]');
 if replay->'requestId' is distinct from result->'requestId' or (select ptronhand from public.ph_master_inventory where unique_id='fixture-single-y')<>'48' then
   raise exception 'SINGLE_Y_REPLAY_REPEATED_MOVE'; end if;
end $test$;
do $test$
declare actor uuid:='00000000-0000-0000-0000-000000000076'; moves jsonb; result jsonb; replay jsonb; status jsonb; revision bigint;
begin
 select jsonb_agg(jsonb_build_object('source',pg_temp.reclass_y_source(uid),
   'lines','[{"direction":"move_up","destinationSeason":"F1","quantity":3}]'::jsonb)) into moves
   from unnest(array['fixture-y','fixture-bare-y']) uid;
 select r.revision into revision from public.app_dataset_revisions r where key='ph_master_inventory';
 result:=public.apply_inventory_reclass_moves_with_delivery_v1(actor,'test:y-batch-3076',revision,moves,null);
 if result->>'status'<>'applied' or jsonb_array_length(result->'movements')<>2 then raise exception 'BATCH_Y_RECEIPTS_MISSING'; end if;
 if (select count(*) from public.ph_master_inventory where itemcode='FIXTURE' and lotcode='27.F1' and ptronhand='3')<>2 then raise exception 'BATCH_Y_DESTINATION_PREFIX_WRONG'; end if;
 replay:=public.apply_inventory_reclass_moves_with_delivery_v1(actor,'test:y-batch-3076',revision,moves,null);
 if replay->'requestId' is distinct from result->'requestId' or replay->>'duplicate'<>'true'
   or (select sum(ptronhand::numeric) from public.ph_master_inventory where unique_id in ('fixture-y','fixture-bare-y'))<>94 then raise exception 'BATCH_Y_REPLAY_REPEATED_MOVE'; end if;
 status:='{"action":"inventory_reclass_move","operation":"status","commandId":"test:y-batch-3076"}';
 if not public.can_reclass_y_administrator_v3076(actor,status) then raise exception 'OWN_Y_STATUS_DENIED'; end if;
 if public.get_inventory_reclass_move_status_v1('00000000-0000-0000-0000-000000000077','test:y-batch-3076')->>'status'<>'missing' then raise exception 'FOREIGN_Y_STATUS_LEAKED'; end if;
 insert into private.ph_inventory_reclass_batch_receipts_v1(actor_id,command_id,request)
   values(actor,'test:y-pending-3076','{}');
 if not public.can_reclass_y_administrator_v3076(actor,jsonb_set(status,'{commandId}','"test:y-pending-3076"'))
   or public.get_inventory_reclass_move_status_v1(actor,'test:y-pending-3076')->>'status'<>'pending' then raise exception 'OWN_PENDING_STATUS_FENCED'; end if;
end $test$;
set local session_replication_role=replica;
update public.user_access set role='REP',edit_any_row='Y' where profile_id='00000000-0000-0000-0000-000000000076';
update public.profiles set role='REP' where id='00000000-0000-0000-0000-000000000076';
update public.ph_app_users set role='REP' where id=3076;
update public.user_access_control set permission_overrides='{"can_submit_reclass":true}' where profile_id='00000000-0000-0000-0000-000000000076';
set local session_replication_role=origin;
do $test$
declare actor uuid:='00000000-0000-0000-0000-000000000076'; moves jsonb; revision bigint; result jsonb;
begin
 select r.revision into revision from public.app_dataset_revisions r where key='ph_master_inventory';
 moves:=jsonb_build_array(jsonb_build_object('source',pg_temp.reclass_y_source('fixture-staff-y'),
   'lines','[{"direction":"move_up","destinationSeason":"F1","quantity":2}]'::jsonb));
 perform private.require_reclass_explanations_v303(actor,'{"fixture-staff-y":"Reviewed"}',array['fixture-staff-y']);
 result:=public.apply_inventory_reclass_moves_v1(actor,'test:y-staff-3076',revision,moves);
 if result->>'status'<>'applied' then raise exception 'STANDARD_STAFF_DOTTED_Y_REGRESSED'; end if;
 begin
   perform public.apply_inventory_reclass_moves_with_delivery_v1(actor,'test:staff-admin-only-3076',revision,moves,null);
   raise exception 'STANDARD_STAFF_ADMIN_EXCLUSIVE_ACCEPTED';
 exception when insufficient_privilege then
   if sqlerrm<>'INVENTORY_RECLASS_TEST_ADMIN_REQUIRED' then raise; end if;
 end;
 begin
   moves:=jsonb_build_array(jsonb_build_object('source',pg_temp.reclass_y_source('fixture-staff-bare-y'),
     'lines','[{"direction":"move_up","destinationSeason":"F1","quantity":2}]'::jsonb));
   perform private.require_reclass_explanations_v303(actor,'{"fixture-staff-bare-y":"Reviewed"}',array['fixture-staff-bare-y']);
   perform public.apply_inventory_reclass_moves_v1(actor,'test:y-staff-bare-3076',revision,moves);
   raise exception 'NONADMIN_NEW_BARE_Y_ALLOWANCE';
 exception when invalid_parameter_value then
   if sqlerrm<>'INVENTORY_RECLASS_LOT_INVALID' then raise; end if;
 end;
end $test$;
set local session_replication_role=replica;
update public.user_access set role='REP',edit_any_row='N',edit_assigned_rows_only='Y',flyer_folder_access='Y'
where profile_id='00000000-0000-0000-0000-000000000076';
insert into public.ph_inventory_row_assignments(master_unique_id,unique_id,itemcode,locationcode,lotcode,assignedto,assignment_reason,present_in_drive)
values ('fixture-f1','fixture-f1','FIXTURE','A.03','27.F1','fixture_admin','itemcode_default',true);
insert into public.ph_flyer_folder_rows(unique_id,master_unique_id) values('fixture-flyer-f1','fixture-f1');
set local session_replication_role=origin;
do $test$
declare actor uuid:='00000000-0000-0000-0000-000000000076'; command jsonb;
begin
 command:=jsonb_build_object('action','inventory_reclass_move','commandId','test:assigned-rep-f1-3076',
   'moves',jsonb_build_array(jsonb_build_object('source',pg_temp.reclass_y_source('fixture-f1'),
     'lines','[{"direction":"move_up","destinationSeason":"S1","quantity":1}]'::jsonb)));
 if not private.reclass_rows_allowed_v3076(actor,array['fixture-f1']) then raise exception 'REP_ASSIGNMENT_FIXTURE_NOT_PROVEN'; end if;
 if public.authorize_reclass_command_v3076(actor,command) then raise exception 'REP_PHYSICAL_ROLE_ELIGIBILITY_WIDENED'; end if;
 perform set_config('session_replication_role','replica',true);
 update public.user_access set role='EVAL',edit_assigned_rows_only='N' where profile_id=actor;
 update public.ph_inventory_row_assignments set assignedto='fixture_other_admin' where master_unique_id='fixture-f1';
 perform set_config('session_replication_role','origin',true);
 if not private.reclass_rows_allowed_v3076(actor,array['fixture-f1']) then raise exception 'FLYER_GRANT_FIXTURE_NOT_PROVEN'; end if;
 if public.authorize_reclass_command_v3076(actor,command) then raise exception 'EVAL_FLYER_REPLACED_PHYSICAL_OWNERSHIP'; end if;
end $test$;
select 'RECLASS_Y_AUTHORITY_PASS';
commit;
