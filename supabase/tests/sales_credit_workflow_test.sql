begin;
create temporary table sales_checks(description text);
create function pg_temp.sales_check(ok boolean, description text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Sales workflow: %',description; end if; insert into sales_checks values(description); end $$;
select pg_temp.sales_check(sales_private.key(E'\t Hydrangea \n')='hydrangea','name matching trims tabs/newlines and folds case');
create function pg_temp.sales_reject(actor uuid,op text,payload jsonb,rev bigint,expected text) returns void language plpgsql as $$
begin
  begin perform public.sales_credit_command_v1(actor,op,payload,gen_random_uuid(),rev); raise exception 'Expected %',expected;
  exception when others then if sqlerrm<>expected then raise; end if; end;
  perform pg_temp.sales_check(true,expected);
end $$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('97000000-0000-4000-8000-000000000001','sales-review@example.invalid','{}','{}'),
('97000000-0000-4000-8000-000000000002','sales-rep@example.invalid','{}','{}'),
('97000000-0000-4000-8000-000000000003','sales-other@example.invalid','{}','{}'),
('97000000-0000-4000-8000-000000000004','sales-csr@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
('97000000-0000-4000-8000-000000000001','dylan_collyge','Dylan','ADMIN',false),
('97000000-0000-4000-8000-000000000002','credit_rep','Credit Rep','REP',false),
('97000000-0000-4000-8000-000000000003','credit_other','Credit Other','REP',false),
('97000000-0000-4000-8000-000000000004','credit_csr','Credit CSR','CSR',false);
insert into sales_private.rep_identities(kind,identity_key,profile_id) values
('username','credit_rep','97000000-0000-4000-8000-000000000002'),
('name','credit_rep','97000000-0000-4000-8000-000000000002'),
('external_id','cr1','97000000-0000-4000-8000-000000000002'),
('username','credit_other','97000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_soc_master(unique_id,itemcode,commonname,contsize,locationcode,lotcode,quantityordered,dock,stopnumber,transactionnumber,customeridentityid,customername,consigneeidentityid,consigneename,salesrepid)
values ('CR-A','CR-I',' Hydrangea ','#3','D.08.001','26.F1','12','Dock 1','1','CR-SHIP-1','CR-C','Same name','CR-CN','Destination','cr1'),
('CR-B','CR-I','HYDRANGEA','#3','D.08.002','26.F1','20','Dock 2','1','CR-SHIP-2','CR-C','Same name','CR-CN','Destination','cr1'),
('CR-C','OTHER','Other','#3','D.08.003','26.F1','5','Dock 3','1','CR-SHIP-3','OTHER-C','Same name','CR-CN','Destination','cr1');

do $$
declare reviewer uuid:='97000000-0000-4000-8000-000000000001'; rep uuid:='97000000-0000-4000-8000-000000000002'; other uuid:='97000000-0000-4000-8000-000000000003';
  csr uuid:='97000000-0000-4000-8000-000000000004'; a public.ph_credit_sources; b public.ph_credit_sources; c public.ph_credit_sources;
  body jsonb; saved jsonb; submitted jsonb; response jsonb; command uuid; draft_id uuid:=gen_random_uuid(); first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid();
  second_draft uuid:=gen_random_uuid(); next_id uuid:=gen_random_uuid(); old_snapshot jsonb; total_sources integer; count_lines integer; old_outbox integer;
begin
  select * into a from public.ph_credit_sources where source_id='CR-A' and source_kind='docks';
  select * into b from public.ph_credit_sources where source_id='CR-B' and source_kind='docks';
  select * into c from public.ph_credit_sources where source_id='CR-C' and source_kind='docks';
  perform pg_temp.sales_check(a.id is not null and b.id is not null and c.id is not null,'import trigger archives without opening Credit');
  perform pg_temp.sales_check(a.id<>b.id and a.customer_key=b.customer_key and a.customer_key<>c.customer_key,'shipments remain distinct and customer IDs prevent name collision');
  perform pg_temp.sales_check(sales_private.assigned_rep(jsonb_build_object('request_selected_rep_username','credit_rep','request_created_by_username','credit_csr'))=rep,'CSR creator does not replace selected rep');
  perform pg_temp.sales_check(sales_private.assigned_rep('{"requested_by":"Credit Rep extra"}') is null,'partial names never assign ownership');
  perform pg_temp.sales_check(not sales_private.can_read_source(other,a.assigned_rep_id) and not sales_private.can_read_source(other,null),'another rep and unmapped ownership are denied');
  perform pg_temp.sales_check(jsonb_array_length(public.sales_credit_command_v1(other,'sources','{}')->'rows')=0,'unauthorized source searches reveal no records');
  select count(*) into old_outbox from public.ph_request_delivery_outbox;
  body:=jsonb_build_object('id',draft_id,'customerKey',a.customer_key,'lines',jsonb_build_array(
    jsonb_build_object('id',first_id,'sourceId',a.id,'quantity','','explanation','','attachmentIds','[]'::jsonb),
    jsonb_build_object('id',second_id,'sourceId',b.id,'quantity','3','explanation','Damage','attachmentIds','[]'::jsonb)));
  command:=gen_random_uuid(); saved:=public.sales_credit_command_v1(rep,'save_draft',body,command,0);
  perform pg_temp.sales_check(saved=public.sales_credit_command_v1(rep,'save_draft',body,command,0),'lost save acknowledgement replays same draft');
  perform pg_temp.sales_check(jsonb_array_length(saved#>'{draft,lines}')=2,'incomplete multi-line drafts persist');
  perform pg_temp.sales_reject(other,'detail',jsonb_build_object('id',draft_id),null,'CREDIT_DRAFT_FORBIDDEN');
  perform pg_temp.sales_reject(rep,'submit',jsonb_build_object('id',draft_id),1,'CREDIT_QUANTITY_REQUIRED');
  perform pg_temp.sales_reject(rep,'save_draft',body,0,'CREDIT_REVISION_CONFLICT');
  body:=jsonb_set(jsonb_set(body,'{lines,0,quantity}','"2"'),'{lines,0,explanation}','"Broken stems"');
  saved:=public.sales_credit_command_v1(rep,'save_draft',body,gen_random_uuid(),1);
  command:=gen_random_uuid(); submitted:=public.sales_credit_command_v1(rep,'submit',jsonb_build_object('id',draft_id),command,2);
  perform pg_temp.sales_check(submitted=public.sales_credit_command_v1(rep,'submit',jsonb_build_object('id',draft_id),command,2),'lost submission acknowledgement cannot duplicate lines');
  perform pg_temp.sales_check((select count(*)=2 from public.ph_sales_credit_requests where submission_id=draft_id),'one saved line per selected shipment');
  perform pg_temp.sales_reject(rep,'review_line',jsonb_build_object('lineId',first_id,'decision','approved'),1,'CREDIT_REVIEW_FORBIDDEN');
  perform pg_temp.sales_reject(reviewer,'review_line',jsonb_build_object('lineId',second_id,'decision','denied'),1,'CREDIT_DENIAL_REASON_REQUIRED');
  perform public.sales_credit_command_v1(reviewer,'review_line',jsonb_build_object('lineId',first_id,'decision','approved'),gen_random_uuid(),1);
  perform public.sales_credit_command_v1(reviewer,'review_line',jsonb_build_object('lineId',second_id,'decision','denied','reason','No damage evidence in explanation'),gen_random_uuid(),1);
  perform pg_temp.sales_reject(reviewer,'review_line',jsonb_build_object('lineId',first_id,'decision','denied','reason','Second reviewer stale'),1,'CREDIT_REVISION_CONFLICT');
  perform pg_temp.sales_check(jsonb_array_length(public.sales_credit_command_v1(rep,'submissions','{"status":"approved"}')->'rows')=1
    and jsonb_array_length(public.sales_credit_command_v1(rep,'submissions','{"status":"denied"}')->'rows')=1,'mixed decisions appear under both statuses');
  perform pg_temp.sales_check(jsonb_array_length(public.sales_credit_command_v1(other,'submissions','{"status":"approved"}')->'rows')=0,'another rep cannot list approved evidence');
  body:=jsonb_build_object('id',second_draft,'customerKey',a.customer_key,'lines',jsonb_build_array(jsonb_build_object('id',next_id,'sourceId',a.id,'quantity','1','explanation','Additional damage','attachmentIds','[]'::jsonb)));
  perform public.sales_credit_command_v1(rep,'save_draft',body,gen_random_uuid(),0);
  perform pg_temp.sales_reject(rep,'submit',jsonb_build_object('id',second_draft),1,'CREDIT_REPEAT_AUTHORIZATION_REQUIRED');
  perform public.sales_credit_command_v1(reviewer,'authorize_repeat',jsonb_build_object('sourceId',a.id,'requesterId',rep,'reason','Separate damaged group confirmed'),gen_random_uuid(),a.revision);
  perform public.sales_credit_command_v1(rep,'submit',jsonb_build_object('id',second_draft),gen_random_uuid(),1);
  perform pg_temp.sales_check((select count(*)=1 from sales_private.repeat_authorizations where consumed_by=next_id::text),'additional authorization consumed once');
  perform public.sales_credit_command_v1(reviewer,'amend_line',jsonb_build_object('lineId',first_id,'quantity','1','explanation','One damaged plant','reason','Corrected customer count'),gen_random_uuid(),2);
  perform pg_temp.sales_check((select credit_status='pending' and credit_qty='1' from public.ph_sales_credit_requests where unique_id=first_id::text),'reviewed amendment resets pending without deleting history');
  perform pg_temp.sales_check((select count(*)=3 from sales_private.review_events where line_id=first_id::text),'submission, review, and amendment retained');
  select snapshot into old_snapshot from public.ph_sales_credit_requests where unique_id=first_id::text;
  update public.ph_soc_master set quantityordered='99',invoicedate='2026-09-20' where unique_id='CR-A';
  delete from public.ph_soc_master where unique_id='CR-A';
  perform pg_temp.sales_check(exists(select 1 from public.ph_credit_sources where id=a.id),'archive survives invoice and source deletion');
  perform pg_temp.sales_check((select snapshot=old_snapshot from public.ph_sales_credit_requests where unique_id=first_id::text),'source refresh never rewrites submitted evidence');
  select count(*) into total_sources from public.ph_credit_sources;
  insert into public.ph_soc_master(unique_id,invoicedate) values('CR-PAST','2020-01-01');
  perform pg_temp.sales_check((select count(*)=total_sources from public.ph_credit_sources),'old invoiced rows do not enter credit archive');
  perform pg_temp.sales_check((select count(*)=old_outbox from public.ph_request_delivery_outbox),'credit changes never send automatic emails');
  perform pg_temp.sales_check(not has_table_privilege('authenticated','public.ph_sales_credit_requests','select') and not has_table_privilege('anon','public.ph_sales_credit_requests','insert'),'direct legacy credit access removed');
  perform pg_temp.sales_check(not has_function_privilege('authenticated','public.sales_credit_command_v1(uuid,text,jsonb,uuid,bigint)','execute'),'browser cannot impersonate actor through RPC');
  perform pg_temp.sales_check(not has_schema_privilege('authenticated','sales_private','usage'),'private reviews and command history inaccessible');
end $$;
-- Real history pagination, completion persistence, and all supported rep aliases.
insert into public.ph_request_history(unique_id,commonname,req_customer,request_selected_rep_username,request_created_by_username,req_status,created_at,date_completed)
select 'CR-H-'||lpad(i::text,3,'0'),'  Mixed Hydrangea  ','History Customer','credit_rep','credit_csr','Complete',
  '2026-09-01'::timestamptz,'2026-09-20'::timestamptz from generate_series(1,105)i;
do $$
declare rep uuid:='97000000-0000-4000-8000-000000000002'; other uuid:='97000000-0000-4000-8000-000000000003';
  reviewer uuid:='97000000-0000-4000-8000-000000000001'; csr uuid:='97000000-0000-4000-8000-000000000004';
  response jsonb; next_page jsonb; role_alias text; a public.ph_credit_sources; b public.ph_credit_sources; body jsonb; saved jsonb; submitted jsonb;
  batch uuid:=gen_random_uuid(); command uuid:=gen_random_uuid(); old_events integer;
begin
  response:=public.request_history_command_v1(rep,'search','{"query":" mixed HYDRANGEA ","limit":100}');
  next_page:=public.request_history_command_v1(rep,'search',jsonb_build_object('query','mixed hydrangea','limit',100,'cursor',response->'nextCursor'));
  perform pg_temp.sales_check(jsonb_array_length(response->'rows')=100 and jsonb_array_length(next_page->'rows')=5,'common-name search covers all pages');
  perform pg_temp.sales_check(response#>>'{rows,0,unique_id}'='CR-H-105' and next_page#>>'{rows,0,unique_id}'='CR-H-005','stable identity tie-breaker prevents pagination duplicates');
  perform pg_temp.sales_check(jsonb_array_length(public.request_history_command_v1(other,'search','{"query":"mixed hydrangea"}')->'rows')=0,'history search scopes by assigned rep, not CSR creator');
  foreach role_alias in array array['REP','SALES','SALE','SALESUSER','SALESROLE','SALES REP','Senior SalesRep','SALESREPRESENTATIVE'] loop
    update public.profiles set role=role_alias where id=other;
    perform pg_temp.sales_check(not sales_private.can_read_source(other,rep) and not sales_private.can_read_source(other,null),'rep alias cannot read another/unmapped rep: '||role_alias);
  end loop;
  update public.profiles set role='REP' where id=other;
  insert into private.navigation_view_overrides(profile_id,view_key,allowed) values(rep,'request-history',false);
  begin perform public.request_history_command_v1(rep,'search','{}'); raise exception 'Expected revoked history permission';
  exception when others then if sqlerrm<>'SALES_MODULE_FORBIDDEN' then raise; end if; end;
  perform pg_temp.sales_check(true,'live history revocation enforced by API');
  delete from private.navigation_view_overrides where profile_id=rep and view_key='request-history';
  insert into public.ph_active_request(unique_id,master_id,commonname,req_status,requested_by,request_selected_rep_username,request_created_by_username)
  values('CR-COMPLETE',null,'Atomic History','Pending','Credit Rep','credit_rep','credit_csr');
  select count(*) into old_events from public.ph_request_delivery_outbox;
  update public.ph_active_request set req_status='Complete',date_completed='2026-09-20T12:00:00Z' where unique_id='CR-COMPLETE';
  perform pg_temp.sales_check(exists(select 1 from public.ph_request_history where unique_id='CR-COMPLETE' and assigned_rep_id=rep),'completion transaction writes durable assigned history');
  update public.ph_active_request set req_status='Complete' where unique_id='CR-COMPLETE';
  perform pg_temp.sales_check((select count(*)=old_events+1 from public.ph_request_delivery_outbox),'history integration does not replay completion emails');
  delete from public.ph_active_request where unique_id='CR-COMPLETE';
  perform pg_temp.sales_check(exists(select 1 from public.ph_request_history where unique_id='CR-COMPLETE'),'completed history survives active-row deletion');
  insert into public.ph_soc_master(unique_id,itemcode,commonname,customeridentityid,customername,consigneeidentityid,consigneename,salesrepname)
  values('CR-OTHER-SOURCE','OTHER-REP','Private Other Plant','CR-C','Same name','CR-CN','Destination','credit_other');
  select * into a from public.ph_credit_sources where source_kind='docks' and source_id='CR-B';
  select * into b from public.ph_credit_sources where source_kind='docks' and source_id='CR-OTHER-SOURCE';
  body:=jsonb_build_object('id',batch,'customerKey',a.customer_key,'lines',jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'sourceId',a.id,'quantity','1','explanation','Rep A evidence'),
    jsonb_build_object('id',gen_random_uuid(),'sourceId',b.id,'quantity','1','explanation','Rep B private evidence')));
  saved:=public.sales_credit_command_v1(csr,'save_draft',body,command,0);
  submitted:=public.sales_credit_command_v1(csr,'submit',jsonb_build_object('id',batch),gen_random_uuid(),1);
  response:=public.sales_credit_command_v1(rep,'detail',jsonb_build_object('id',batch));
  perform pg_temp.sales_check(jsonb_array_length(response->'lines')=1 and not(response->'submission'?'draft_lines'),'mixed-rep submission parent cannot leak filtered line evidence');
  perform pg_temp.sales_check(response#>>'{lines,0,credit_reason}'='Rep A evidence','rep only sees assigned line in CSR submission');
  insert into private.navigation_view_overrides(profile_id,view_key,allowed) values(rep,'sales-credit',false);
  perform pg_temp.sales_reject(rep,'sources','{}',null,'SALES_MODULE_FORBIDDEN');
  delete from private.navigation_view_overrides where profile_id=rep and view_key='sales-credit';
end $$;
select count(*) as sales_workflow_checks from sales_checks;
rollback;
