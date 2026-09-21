-- Isolated database acceptance only. All fixtures and trigger changes roll back.
begin;
create temporary table workflow_checks(description text);
create function pg_temp.wf_check(ok boolean,description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Workflow: %',description; end if;
  insert into workflow_checks values(description);
end $$;
create function pg_temp.wf_reject(command text,expected text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlerrm=expected then perform pg_temp.wf_check(true,expected); return; end if;
    raise;
  end;
  raise exception 'Expected rejection: %',expected;
end $$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('97003000-0000-0000-0000-000000000001','wfmanager@example.invalid','{}','{}'),
('97003000-0000-0000-0000-000000000002','wfgrower@example.invalid','{}','{}'),
('97003000-0000-0000-0000-000000000003','wfrep@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
('97003000-0000-0000-0000-000000000001','wf_manager','Workflow manager','MANAGER',false),
('97003000-0000-0000-0000-000000000002','wf_grower','Workflow grower','GROWER',false),
('97003000-0000-0000-0000-000000000003','wf_rep','Workflow sales rep','REP',false);
insert into auth.sessions(id,user_id,not_after) values
('97003000-0000-0000-0000-000000000011','97003000-0000-0000-0000-000000000001',now()+interval '1 hour'),
('97003000-0000-0000-0000-000000000012','97003000-0000-0000-0000-000000000002',now()+interval '1 hour'),
('97003000-0000-0000-0000-000000000013','97003000-0000-0000-0000-000000000003',now()+interval '1 hour');
insert into private.navigation_view_overrides(profile_id,view_key,allowed) values
('97003000-0000-0000-0000-000000000001','inventory-transaction-history',true),
('97003000-0000-0000-0000-000000000003','production-workflow',false);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptrreviewed,ptravailable)
values('WF-SOURCE-A','WF-ITEM','Workflow Plant','#3','D','D.08.001','27.F1','20','20','15'),
('WF-SOURCE-B','WF-ITEM','Workflow Plant','#3','D','D.08.002','27.F1','5','5',null);

do $$
declare manager uuid:='97003000-0000-0000-0000-000000000001'; grower uuid:='97003000-0000-0000-0000-000000000002';
  rep uuid:='97003000-0000-0000-0000-000000000003'; input jsonb; created jsonb; completed jsonb; next_row jsonb; stock jsonb;
begin
  select jsonb_agg(to_jsonb(m) order by m.unique_id) into stock from public.ph_master_inventory m where unique_id like 'WF-SOURCE-%';
  input:=jsonb_build_object('workflow_type','planting','source_unique_id','WF-SOURCE-A','quantity',5,'baynumber','001','instructions','Keep tags',
    'source_identity',jsonb_build_object('unique_id','WF-SOURCE-A','itemcode','WF-ITEM','contsize','#3','locationcode','D.08.001','lotcode','27.F1'),
    'command_id','workflow-add-command-1','expected_revision',0,'created_by_username','attacker');
  created:=public.production_workflow_command_v1(grower,'add',input);
  perform pg_temp.wf_check(created#>>'{row,created_by_username}'='wf_grower','creator comes from trusted profile');
  perform pg_temp.wf_check(created#>>'{row,locationcode}'='D.08.001' and created#>>'{row,baynumber}'='001','full bay identity and instructions preserved');
  perform pg_temp.wf_check(created#>>'{row,snapshot,ptravailable}'='15','source snapshot comes from current inventory');
  perform pg_temp.wf_check(public.production_workflow_command_v1(grower,'add',input)->'row'=created->'row','lost add acknowledgement replays original row');
  perform pg_temp.wf_check((select count(*)=1 from public.ph_production_workflow_rows where source_unique_id='WF-SOURCE-A'),'no duplicate source after command replay');
  perform pg_temp.wf_reject(format('select public.production_workflow_command_v1(%L,%L,%L)',grower,'add',input||'{"quantity":6}'),'WORKFLOW_COMMAND_CONFLICT');
  perform pg_temp.wf_reject(format('select public.production_workflow_command_v1(%L,%L,%L)',grower,'add',input||'{"command_id":"workflow-second-add"}'),'PRODUCTION_ALREADY_OPEN');
  perform pg_temp.wf_reject(format('select public.production_workflow_command_v1(%L,%L,%L)',grower,'add',input||'{"command_id":"workflow-invalid-qty","quantity":-1}'),'PRODUCTION_QUANTITY_REQUIRED');
  input:=jsonb_build_object('workflow_type','planting','unique_id',created#>>'{row,unique_id}','command_id','workflow-complete-1','expected_revision',1);
  perform pg_temp.wf_reject(format('select public.production_workflow_command_v1(%L,%L,%L)',rep,'complete',input),'PRODUCTION_FORBIDDEN');
  completed:=public.production_workflow_command_v1(grower,'complete',input);
  perform pg_temp.wf_check(completed#>>'{row,status}'='complete' and completed#>>'{row,revision}'='2','completion advances exactly one revision');
  perform pg_temp.wf_check(public.production_workflow_command_v1(grower,'complete',input)->'row'=completed->'row','lost completion acknowledgement is idempotent');
  perform pg_temp.wf_reject(format('select public.production_workflow_command_v1(%L,%L,%L)',grower,'complete',input||'{"command_id":"workflow-stale-complete"}'),'WORKFLOW_REVISION_CONFLICT');
  input:=jsonb_build_object('workflow_type','planting','source_unique_id','WF-SOURCE-A','quantity',5,'source_identity',created#>'{row,snapshot}',
    'command_id','workflow-new-cycle-1','expected_revision',0);
  next_row:=public.production_workflow_command_v1(grower,'add',input);
  perform pg_temp.wf_check(next_row#>>'{row,unique_id}'<>created#>>'{row,unique_id}','new production cycle does not overwrite completed history');
  perform pg_temp.wf_check((select count(*)=2 from public.ph_production_workflow_rows where source_unique_id='WF-SOURCE-A'),'completed and open cycles both retained');
  next_row:=public.production_workflow_command_v1(grower,'add',jsonb_build_object('workflow_type','propagation','source_unique_id','WF-SOURCE-B',
    'quantity',2,'command_id','workflow-unknown-stock','expected_revision',0,'source_identity',jsonb_build_object('unique_id','WF-SOURCE-B','itemcode','WF-ITEM','contsize','#3','locationcode','D.08.002','lotcode','27.F1')));
  perform pg_temp.wf_check(next_row#>'{row,ptravailable}'='null'::jsonb,'unknown source availability remains unknown');
  perform pg_temp.wf_check(stock=(select jsonb_agg(to_jsonb(m) order by m.unique_id) from public.ph_master_inventory m where unique_id like 'WF-SOURCE-%'),'production commands do not alter inventory');
  insert into private.navigation_view_overrides(profile_id,view_key,allowed) values(grower,'production:planting',false);
  perform pg_temp.wf_reject(format('select public.production_workflow_command_v1(%L,%L,%L)',grower,'list','{"workflow_type":"planting"}'),'PRODUCTION_FORBIDDEN');
  update public.profiles set disabled_at=now() where id=grower;
  perform pg_temp.wf_reject(format('select public.production_workflow_command_v1(%L,%L,%L)',grower,'list','{"workflow_type":"propagation"}'),'WORKFLOW_PROFILE_INACTIVE');
  perform pg_temp.wf_reject(format('select public.inventory_workflow_session_actor_v1(%L,%L)',manager,'97003000-0000-0000-0000-000000000013'),'WORKFLOW_PROFILE_INACTIVE');
  perform pg_temp.wf_check(public.inventory_workflow_session_actor_v1(manager,'97003000-0000-0000-0000-000000000011')->>'username'='wf_manager','session owner verified');
  perform pg_temp.wf_check(not has_table_privilege('authenticated','public.ph_production_workflow_rows','insert'),'direct client production writes denied');
  perform pg_temp.wf_check(not has_table_privilege('authenticated','public.ph_inventory_transactions','select'),'direct audit reads denied');
  perform pg_temp.wf_check(not has_function_privilege('authenticated','public.production_workflow_command_v1(uuid,text,jsonb)','execute'),'cannot impersonate actor through direct RPC');
  perform pg_temp.wf_check(not has_function_privilege('anon','public.apply_inventory_transaction_v1(uuid,text,jsonb,jsonb,jsonb)','execute'),'anonymous mutation bridge denied');
end $$;

create function pg_temp.fail_inventory_audit() returns trigger language plpgsql as $$
begin
  if current_setting('workflow_test.fail_audit',true)='on' then raise exception 'FIXTURE_AUDIT_FAILURE'; end if;
  return new;
end $$;
create trigger workflow_test_audit_failure before insert on public.ph_inventory_transactions for each row execute function pg_temp.fail_inventory_audit();
do $$
declare manager uuid:='97003000-0000-0000-0000-000000000001'; rep uuid:='97003000-0000-0000-0000-000000000003';
  before_row jsonb; operations jsonb; audit jsonb; result jsonb; request jsonb:='{"action":"qty","fixture":true}';
begin
  select to_jsonb(m) into before_row from public.ph_master_inventory m where unique_id='WF-SOURCE-A';
  operations:=jsonb_build_array(jsonb_build_object('kind','update','table','ph_master_inventory','unique_id','WF-SOURCE-A','expected',before_row,
    'patch',jsonb_build_object('ptronhand','8','ptrreviewed','8','ptravailable','8')));
  audit:=jsonb_build_object('action','qty','source_table','ph_master_inventory','source_unique_id','WF-SOURCE-A','source_itemcode','WF-ITEM',
    'source_locationcode','D.08.001','source_lotcode','27.F1','quantity',8,'source_before',before_row,'actor_username','forged');
  perform set_config('workflow_test.fail_audit','on',true);
  perform pg_temp.wf_reject(format('select public.apply_inventory_transaction_v1(%L,%L,%L,%L,%L)',manager,'atomic-inventory-command',request,operations,audit),'FIXTURE_AUDIT_FAILURE');
  perform pg_temp.wf_check(before_row=(select to_jsonb(m) from public.ph_master_inventory m where unique_id='WF-SOURCE-A'),'audit failure rolls back stock mutation');
  perform pg_temp.wf_check(not exists(select 1 from workflow_private.commands where actor_id=manager and command_id='atomic-inventory-command'),'audit failure rolls back command receipt');
  perform set_config('workflow_test.fail_audit','off',true);
  result:=public.apply_inventory_transaction_v1(manager,'atomic-inventory-command',request,operations,audit);
  perform pg_temp.wf_check(result#>>'{audit,actor_username}'='wf_manager' and result#>>'{audit,status}'='applied','audit actor and applied status are server-owned');
  perform pg_temp.wf_check(result#>>'{audit,source_after,ptronhand}'='8','audit and stock contain the same committed quantity');
  perform pg_temp.wf_check(public.apply_inventory_transaction_v1(manager,'atomic-inventory-command',request,operations,audit)->>'duplicate'='true','mutation replay returns receipt despite old source snapshot');
  perform pg_temp.wf_check((select count(*)=1 from public.ph_inventory_transactions where actor_id=manager and status='applied'),'replayed mutation has exactly one audit');
  perform pg_temp.wf_reject(format('select public.apply_inventory_transaction_v1(%L,%L,%L,%L,%L)',manager,'stale-inventory-command',request,operations,audit),'INVENTORY_SOURCE_CHANGED');
  perform pg_temp.wf_reject(format('select public.apply_inventory_transaction_v1(%L,%L,%L,%L,%L)',rep,'rep-inventory-command',request,operations,audit),'INVENTORY_MANAGER_REQUIRED');
  perform pg_temp.wf_check((public.inventory_transaction_history_v1(manager,'{"search":"WF-ITEM","action":"qty","limit":1,"offset":0}')->>'count')::integer=1,'server search finds matching audit before pagination');
  insert into public.ph_request_delivery_outbox(event_key,event_type,payload) values('workflow-report-test','reclass_inquiry',jsonb_build_object('reclassPayload',jsonb_build_object(
    'protectedDelivery',jsonb_build_object('contractVersion','drive-reclass-protected-v1','actorProfileId',manager),
    'source',jsonb_build_object('unique_id','WF-SOURCE-A','itemcode','WF-ITEM','locationcode','D.08.001','lotcode','27.F1'),
    'transaction',jsonb_build_object('requestActions',jsonb_build_array('priority_change')))));
  perform pg_temp.wf_check((select count(*)=1 from public.ph_inventory_transactions where actor_id=manager and action='priority_change' and status='requested'),'report-only priority request never appears applied');
  perform pg_temp.wf_check((select ptronhand::numeric=8 from public.ph_master_inventory where unique_id='WF-SOURCE-A'),'request-report audit does not mutate inventory');
end $$;
select count(*) as production_workflow_checks_passed from workflow_checks;
rollback;
