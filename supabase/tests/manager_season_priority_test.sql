-- Isolated acceptance coverage for Manager Season Priority. All fixtures roll back.
begin;
create temporary table season_priority_checks(description text);
create function pg_temp.sp_check(ok boolean, description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Season Priority: %', description; end if;
  insert into season_priority_checks values(description);
end $$;
create function pg_temp.sp_reject(command text, expected text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlerrm=expected then perform pg_temp.sp_check(true,expected); return; end if;
    raise;
  end;
  raise exception 'Expected rejection: %',expected;
end $$;

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('98004000-0000-0000-0000-000000000001','spmanager1@example.invalid',now(),'{}','{}'),
('98004000-0000-0000-0000-000000000002','spmanager2@example.invalid',now(),'{}','{}'),
('98004000-0000-0000-0000-000000000003','sprep@example.invalid',now(),'{}','{}'),
('98004000-0000-0000-0000-000000000004','dylan-sp@example.invalid',now(),'{}','{}'),
('98004000-0000-0000-0000-000000000005','megan-sp@example.invalid',now(),'{}','{}'),
('98004000-0000-0000-0000-000000000006','sharon-sp@example.invalid',now(),'{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
('98004000-0000-0000-0000-000000000001','sp_manager_1','SP Manager One','MANAGER',false),
('98004000-0000-0000-0000-000000000002','sp_manager_2','SP Manager Two','ADMIN',false),
('98004000-0000-0000-0000-000000000003','sp_rep','SP Rep','REP',false),
('98004000-0000-0000-0000-000000000004','dylan_collyge','Dylan Fixture','ADMIN',false),
('98004000-0000-0000-0000-000000000005','megan_kelly','Megan Fixture','MANAGER',false),
('98004000-0000-0000-0000-000000000006','sharon_combs','Sharon Fixture','MANAGER',false);

insert into public.ph_app_settings(key,value)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27}'::jsonb)
on conflict(key) do update set value=excluded.value;

insert into public.ph_cav_import(unique_id,itemcode,commonname,contsize,season,holdstopreason)
values
('SP-CAV-X','SP-ITEM-X','Season Priority Plant','#3','F1',''),
('SP-CAV-2','SP-ITEM-2','Season Priority Two','#3','F1','NULL'),
('SP-CAV-4','SP-ITEM-4','Season Priority Four','#3','F1',''),
('SP-CAV-A','SP-ITEM-AMBIG','Season Priority Ambiguous','#3','F1',''),
('SP-CAV-S','SP-ITEM-STALE','Season Priority Stale','#3','F1',''),
('SP-CAV-R','SP-ITEM-RECIP','Season Priority Recipient','#3','F1','');
insert into public.ph_master_inventory(
  unique_id,itemcode,genusname,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,blockalpha,desigitem,desigloc,assignedto,app_tab_assignment
) values
('SP-X-1A','SP-ITEM-X','Acer','Season Priority Plant','#3','A.01.001','27.F1','10','9','1','PH','F1','27','A','D1','L1','sp_manager_1','season'),
('SP-X-1B','SP-ITEM-X','Acer','Season Priority Plant','#3','B.01.001','27.F1','11','10','1','PH','F1','27','B','D2','L2','sp_manager_1','season'),
('SP-X-3','SP-ITEM-X','Acer','Season Priority Plant','#3','C.01.001','27.F1','100','99','3','PH','F1','27','C','D3','L3','sp_manager_1','season'),
('SP-X-4','SP-ITEM-X','Acer','Season Priority Plant','#3','D.01.001','27.F1','13','12','4','PH','F1','27','D','D4','L4','sp_manager_1','season'),
('SP-X-5','SP-ITEM-X','Acer','Season Priority Plant','#3','E.01.001','27.F1','14','13','5','PH','F1','27','E','D5','L5','sp_manager_1','season'),
('SP-X-BLANK','SP-ITEM-X','Acer','Season Priority Plant','#3','F.01.001','27.F1','15','14','','PH','F1','27','F','D6','L6','sp_manager_1','season'),
('SP-2-1','SP-ITEM-2','Acer','Season Priority Two','#3','A.02.001','27.F1','5','4','1','PH','F1','27','A','D1','L1','','season'),
('SP-2-2','SP-ITEM-2','Acer','Season Priority Two','#3','B.02.001','27.F1','20','19','2','PH','F1','27','B','D2','L2','','season'),
('SP-4-1','SP-ITEM-4','Acer','Season Priority Four','#3','A.04.001','27.F1','5','4','1','PH','F1','27','A','D1','L1','','season'),
('SP-4-2','SP-ITEM-4','Acer','Season Priority Four','#3','B.04.001','27.F1','6','5','2','PH','F1','27','B','D2','L2','','season'),
('SP-4-3','SP-ITEM-4','Acer','Season Priority Four','#3','C.04.001','27.F1','7','6','3','PH','F1','27','C','D3','L3','','season'),
('SP-4-4','SP-ITEM-4','Acer','Season Priority Four','#3','D.04.001','27.F1','30','29','4','PH','F1','27','D','D4','L4','','season'),
('SP-A-1','SP-ITEM-AMBIG','Acer','Season Priority Ambiguous','#3','A.09.001','27.F1','20','19','3','PH','F1','27','A','SAME','SAME','','season'),
('SP-A-2','SP-ITEM-AMBIG','Acer','Season Priority Ambiguous','#3','A.09.001','27.F1','20','19','3','PH','F1','27','A','SAME','SAME','','season'),
('SP-S-1','SP-ITEM-STALE','Acer','Season Priority Stale','#3','A.07.001','27.F1','5','4','1','PH','F1','27','A','D1','L1','','season'),
('SP-S-2','SP-ITEM-STALE','Acer','Season Priority Stale','#3','B.07.001','27.F1','20','19','2','PH','F1','27','B','D2','L2','','season'),
('SP-R-1','SP-ITEM-RECIP','Acer','Season Priority Recipient','#3','A.08.001','27.F1','5','4','1','PH','F1','27','A','D1','L1','','season'),
('SP-R-2','SP-ITEM-RECIP','Acer','Season Priority Recipient','#3','B.08.001','27.F1','20','19','2','PH','F1','27','B','D2','L2','','season');
update public.ph_master_inventory set date_completed=now() where unique_id='SP-X-3';
insert into public.ph_warehouse_assigned_items(
  assignedto,itemcode,itemcode_normalized,genusname,source,present_in_drive,unique_id
) values('sp_manager_1','SP-ITEM-X','SP-ITEM-X','Acer','fixture',true,'SP-ASSIGN-X');
update public.app_dataset_revisions
set state='ready', revision=greatest(revision,1)
where key in ('ph_master_inventory','ph_cav_import','ph_warehouse_assigned_items');

do $$
declare
  manager1 uuid:='98004000-0000-0000-0000-000000000001';
  manager2 uuid:='98004000-0000-0000-0000-000000000002';
  rep uuid:='98004000-0000-0000-0000-000000000003';
  listed jsonb; submitted jsonb; duplicate_result jsonb; state_result jsonb;
  scope_fingerprint text; before_inventory jsonb; overlays jsonb; v_event_id uuid;
begin
  listed:=public.manager_season_priority_list_v1(manager1,'sp_manager_1');
  perform pg_temp.sp_check(listed->>'contractVersion'='manager-season-priority-v1','list returns the protected contract');
  perform pg_temp.sp_check((
    select count(*)=1
    from jsonb_array_elements(listed->'rows') value
    where value->>'itemcode'='SP-ITEM-X' and value->>'sourceUid'='SP-X-3'
  ),'ITEM-X winner is selected before Priority 2-4 and includes completed rows');
  perform pg_temp.sp_check(listed#>>'{rows,0,warehouseAssignedTo,0}'='sp_manager_1','authoritative warehouse assignment is returned');
  perform pg_temp.sp_check(listed#>>'{rows,0,currentAssignment}'='season','current Season Sales assignment is returned');
  delete from public.ph_warehouse_assigned_items;
  listed:=public.manager_season_priority_list_v1(manager1,'sp_manager_1');
  perform pg_temp.sp_check(listed#>>'{rows,0,assignmentAuthoritative}'='false' and listed#>>'{rows,0,resolvedAssignedTo,0}'='sp_manager_1','empty roster falls back to normalized imported assignment');
  insert into public.ph_warehouse_assigned_items(assignedto,itemcode,itemcode_normalized,genusname,source,present_in_drive,unique_id)
  values('sp_manager_2','SP-OTHER','SP-OTHER','Acer','fixture',true,'SP-ASSIGN-OTHER');
  listed:=public.manager_season_priority_list_v1(manager1,'sp_manager_1');
  perform pg_temp.sp_check(not exists(
    select 1 from jsonb_array_elements(listed->'rows') value where value->>'itemcode'='SP-ITEM-X'
  ),'loaded roster without a matching ITEM-X assignment does not expose its imported owner');
  listed:=public.manager_season_priority_list_v1(manager1,'__unassigned__');
  perform pg_temp.sp_check((
    select count(*)=1
    from jsonb_array_elements(listed->'rows') value
    where value->>'itemcode'='SP-ITEM-X'
      and value->>'assignmentAuthoritative'='true'
      and value->'resolvedAssignedTo'='[]'::jsonb
  ),'loaded roster without a matching item makes ITEM-X explicitly unassigned');
  delete from public.ph_warehouse_assigned_items;
  insert into public.ph_warehouse_assigned_items(assignedto,itemcode,itemcode_normalized,genusname,source,present_in_drive,unique_id)
  values('sp_manager_1','SP-ITEM-X','SP-ITEM-X','Acer','fixture',true,'SP-ASSIGN-X-RESTORED');
  update public.app_dataset_revisions set state='ready' where key='ph_warehouse_assigned_items';
  select value->>'scopeFingerprint' into scope_fingerprint
  from jsonb_array_elements(listed->'rows') value where value->>'sourceUid'='SP-X-3';
  select jsonb_agg(to_jsonb(m) order by m.unique_id) into before_inventory
  from public.ph_master_inventory m where m.itemcode='SP-ITEM-X';

  submitted:=public.submit_manager_season_priority_v1(manager1,'SP-X-3',3,scope_fingerprint,'season-priority-token-0001');
  v_event_id:=(submitted->>'eventId')::uuid;
  select payload#>'{reclassPayload,rowOverlays}' into overlays
  from public.ph_request_delivery_outbox o where o.event_id=v_event_id;
  perform pg_temp.sp_check(submitted->>'duplicate'='false' and submitted->>'lifecycleStatus'='queued','first submit queues one inquiry');
  perform pg_temp.sp_check(jsonb_array_length(overlays)=6,'frozen contract includes every same-item row');
  perform pg_temp.sp_check((select value#>>'{proposals,0,priority}'='1' from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-X-3'),'selected Priority 3 rotates to 1');
  perform pg_temp.sp_check((select bool_and(value#>>'{proposals,0,priority}'='2') from jsonb_array_elements(overlays) value where value->>'unique_id' in ('SP-X-1A','SP-X-1B')),'duplicate Priority 1 rows both rotate to 2');
  perform pg_temp.sp_check((select value->'proposals'='[]'::jsonb from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-X-4'),'rank above selected is unchanged');
  perform pg_temp.sp_check((select value->'proposals'='[]'::jsonb from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-X-BLANK'),'nonnumeric priority is unchanged');
  perform pg_temp.sp_check(before_inventory=(select jsonb_agg(to_jsonb(m) order by m.unique_id) from public.ph_master_inventory m where m.itemcode='SP-ITEM-X'),'submit never writes inventory priority');

  duplicate_result:=public.submit_manager_season_priority_v1(manager2,'SP-X-3',3,scope_fingerprint,'season-priority-token-0002');
  perform pg_temp.sp_check(duplicate_result->>'duplicate'='true' and duplicate_result->>'eventId'=submitted->>'eventId','cross-manager duplicate reuses one event');
  perform pg_temp.sp_check((select count(*)=1 from private.manager_season_priority_receipts where itemcode_normalized='SP-ITEM-X'),'one active receipt exists');
  perform pg_temp.sp_check((select count(*)=1 from public.ph_request_delivery_outbox where payload#>>'{reclassPayload,source,itemcode}'='SP-ITEM-X'),'dedupe creates one outbox event');
  perform pg_temp.sp_check((select count(*)=1 from public.ph_inventory_transactions t where t.delivery_event_id=v_event_id and t.status='requested'),'dedupe creates one requested audit');

  perform pg_temp.sp_reject(format('select public.submit_manager_season_priority_v1(%L,%L,%L,%L,%L)',manager1,'SP-X-3',2,scope_fingerprint,'season-priority-token-0004'),'SEASON_PRIORITY_SOURCE_STALE');
  perform pg_temp.sp_reject(format('select public.submit_manager_season_priority_v1(%L,%L,%L,%L,%L)',manager1,'SP-X-3',3,repeat('0',64),'season-priority-token-0005'),'SEASON_PRIORITY_SCOPE_CHANGED');
  perform pg_temp.sp_reject(format('select public.manager_season_priority_list_v1(%L,%L)',rep,'all'),'SEASON_PRIORITY_FORBIDDEN');

  update public.ph_request_delivery_outbox o set status='delivered',delivered_at=now() where o.event_id=v_event_id;
  update public.app_dataset_revisions set revision=revision+1,state='ready' where key='ph_master_inventory';
  state_result:=public.manager_season_priority_state_v1(manager1,array['SP-ITEM-X']);
  perform pg_temp.sp_check(state_result#>>'{requests,0,lifecycleStatus}'='awaiting_import','unchanged later import stays pending');

  update public.ph_master_inventory set
    priority=case when unique_id in ('SP-X-1A','SP-X-1B') then '2' when unique_id='SP-X-3' then '1' else priority end,
    unique_id=case when unique_id='SP-X-3' then 'SP-X-3-NEW' else unique_id end
  where itemcode='SP-ITEM-X';
  update public.app_dataset_revisions set revision=revision+1,state='ready' where key='ph_master_inventory';
  state_result:=public.manager_season_priority_state_v1(manager1,array['SP-ITEM-X']);
  perform pg_temp.sp_check(state_result#>>'{requests,0,lifecycleStatus}'='fulfilled','changed UID fulfills by priority-independent lineage');
  update public.ph_master_inventory set priority='4' where unique_id='SP-X-3-NEW';
  update public.app_dataset_revisions set revision=revision+1,state='ready' where key='ph_master_inventory';
  state_result:=public.manager_season_priority_state_v1(manager1,array['SP-ITEM-X']);
  perform pg_temp.sp_check(state_result#>>'{requests,0,lifecycleStatus}'='fulfilled','terminal fulfillment never resurrects');
end $$;

do $$
declare
  manager1 uuid:='98004000-0000-0000-0000-000000000001';
  fingerprint text; result jsonb; overlays jsonb; v_event_id uuid; state_result jsonb;
begin
  fingerprint:=private.manager_season_priority_scope_fingerprint_v1('SP-ITEM-2');
  result:=public.submit_manager_season_priority_v1(manager1,'SP-2-2',2,fingerprint,'season-priority-token-rank2');
  v_event_id:=(result->>'eventId')::uuid;
  select o.payload#>'{reclassPayload,rowOverlays}' into overlays from public.ph_request_delivery_outbox o where o.event_id=(result->>'eventId')::uuid;
  perform pg_temp.sp_check((select value#>>'{proposals,0,priority}'='1' from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-2-2'),'Priority 2 source rotates to 1');
  perform pg_temp.sp_check((select value#>>'{proposals,0,priority}'='2' from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-2-1'),'Priority 2 rotation increments Priority 1');
  update public.ph_request_delivery_outbox o
  set status='failed', sanitized_error_code='EMAIL_SEND_FAILED'
  where o.event_id=v_event_id;
  update public.ph_master_inventory m
  set priority=case when m.unique_id='SP-2-2' then '1' when m.unique_id='SP-2-1' then '2' else m.priority end
  where m.itemcode='SP-ITEM-2';
  update public.app_dataset_revisions r set revision=revision+1,state='ready' where r.key='ph_master_inventory';
  state_result:=public.manager_season_priority_state_v1(manager1,array['SP-ITEM-2']);
  perform pg_temp.sp_check(state_result#>>'{requests,0,lifecycleStatus}'='fulfilled','matching later import fulfills despite failed email delivery');

  fingerprint:=private.manager_season_priority_scope_fingerprint_v1('SP-ITEM-4');
  result:=public.submit_manager_season_priority_v1(manager1,'SP-4-4',4,fingerprint,'season-priority-token-rank4');
  select o.payload#>'{reclassPayload,rowOverlays}' into overlays from public.ph_request_delivery_outbox o where o.event_id=(result->>'eventId')::uuid;
  perform pg_temp.sp_check((select value#>>'{proposals,0,priority}'='1' from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-4-4'),'Priority 4 source rotates to 1');
  perform pg_temp.sp_check((select value#>>'{proposals,0,priority}'='2' from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-4-1'),'Priority 4 rotation maps 1 to 2');
  perform pg_temp.sp_check((select value#>>'{proposals,0,priority}'='3' from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-4-2'),'Priority 4 rotation maps 2 to 3');
  perform pg_temp.sp_check((select value#>>'{proposals,0,priority}'='4' from jsonb_array_elements(overlays) value where value->>'unique_id'='SP-4-3'),'Priority 4 rotation maps 3 to 4');

  fingerprint:=private.manager_season_priority_scope_fingerprint_v1('SP-ITEM-AMBIG');
  perform pg_temp.sp_reject(format('select public.submit_manager_season_priority_v1(%L,%L,%L,%L,%L)',manager1,'SP-A-1',3,fingerprint,'season-priority-token-ambig'),'SEASON_PRIORITY_LINEAGE_AMBIGUOUS');
  perform pg_temp.sp_check(not exists(select 1 from public.ph_request_delivery_outbox o where o.payload#>>'{reclassPayload,source,itemcode}'='SP-ITEM-AMBIG'),'ambiguous lineage aborts before outbox and audit');

  fingerprint:=private.manager_season_priority_scope_fingerprint_v1('SP-ITEM-STALE');
  result:=public.submit_manager_season_priority_v1(manager1,'SP-S-2',2,fingerprint,'season-priority-token-stale');
  v_event_id:=(result->>'eventId')::uuid;
  update public.ph_request_delivery_outbox o set status='delivered',delivered_at=now() where o.event_id=v_event_id;
  update public.ph_master_inventory m set priority='4' where m.unique_id='SP-S-2';
  update public.app_dataset_revisions r set revision=revision+1,state='ready' where r.key='ph_master_inventory';
  state_result:=public.manager_season_priority_state_v1(manager1,array['SP-ITEM-STALE']);
  perform pg_temp.sp_check(state_result#>>'{requests,0,lifecycleStatus}'='superseded','conflicting later import requires fresh review');

  update auth.users u set email_confirmed_at=null where u.id in (
    manager1,
    '98004000-0000-0000-0000-000000000004'::uuid,
    '98004000-0000-0000-0000-000000000005'::uuid,
    '98004000-0000-0000-0000-000000000006'::uuid
  );
  fingerprint:=private.manager_season_priority_scope_fingerprint_v1('SP-ITEM-RECIP');
  perform pg_temp.sp_reject(format('select public.submit_manager_season_priority_v1(%L,%L,%L,%L,%L)',manager1,'SP-R-2',2,fingerprint,'season-priority-token-recipient'),'DRIVE_RECLASS_RECIPIENTS_UNAVAILABLE');
  perform pg_temp.sp_check(not exists(select 1 from private.manager_season_priority_receipts r where r.itemcode_normalized='SP-ITEM-RECIP')
    and not exists(select 1 from public.ph_request_delivery_outbox o where o.payload#>>'{reclassPayload,source,itemcode}'='SP-ITEM-RECIP'),'recipient failure rolls back outbox, audit, and receipt');
end $$;

create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions,pg_temp;
select plan(1);
select ok((select count(*) >= 35 from season_priority_checks), 'Manager Season Priority acceptance checks completed');
select * from finish();
rollback;
