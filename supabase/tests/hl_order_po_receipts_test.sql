-- Disposable local/CI fixture. Exercise real command bodies; roll back all data.
begin;
create temporary table hl_checks(id integer generated always as identity,description text) on commit drop;
create function pg_temp.hl_check(ok boolean,description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'HL lifecycle: %',description; end if;
  insert into hl_checks(description) values(description);
end $$;
create function pg_temp.hl_command(action text,payload jsonb,command_id uuid default gen_random_uuid(),expected bigint default null)
returns jsonb language plpgsql as $$
begin
  return public.hl_order_command(command_id,action,payload,coalesce(expected,(public.hl_order_state()->>'revision')::bigint));
end $$;
create function pg_temp.hl_reject(action text,payload jsonb,error_message text) returns void language plpgsql as $$
begin
  begin perform pg_temp.hl_command(action,payload);
    raise exception 'Expected rejection: %',error_message;
  exception when others then if sqlerrm<>error_message then raise; end if; end;
  perform pg_temp.hl_check(true,error_message||' rejects invalid '||action);
end $$;
create function pg_temp.hl_confirm(event_id uuid) returns void language plpgsql as $$
declare lease uuid:=gen_random_uuid(); old_claims text:=current_setting('request.jwt.claims',true); old_role text:=current_setting('request.jwt.claim.role',true);
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  update public.ph_request_delivery_outbox set status='processing',lease_token=lease,lease_expires_at=now()+interval '2 minutes' where ph_request_delivery_outbox.event_id=hl_confirm.event_id;
  perform public.hl_order_delivery_record_v1(event_id,lease,'sending','{}');
  perform public.hl_order_delivery_record_v1(event_id,lease,'sent',jsonb_build_object('gmail_message_id','fixture-'||event_id,'thread_id','fixture-thread'));
  perform set_config('request.jwt.claims',old_claims,true);
  perform set_config('request.jwt.claim.role',old_role,true);
end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('97000000-0000-0000-0000-000000000001','hl-lifecycle@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password)
values('97000000-0000-0000-0000-000000000001','dylan_collyge','HL Lifecycle','ADMIN',false);
insert into auth.sessions(id,user_id,not_after)
values('97000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001',now()+interval '1 hour');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','97000000-0000-0000-0000-000000000001',
  'iss','https://kzrnyjsosryejjejliii.supabase.co/auth/v1','session_id','97000000-0000-0000-0000-000000000002','exp',extract(epoch from now()+interval '1 hour'))::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,stopnumber,planstart,transactionnumber,customername,ptravailable)
select id,id,'#3','C.12.4','27.S1',qty,'D1','S1','2026-09-15','ORDER-'||id,'Fixture customer','999'
from (values('HL-A','10'),('HL-B','20'),('HL-CHANGE','12'),('HL-REPLACE','10'),('HL-INVALID','1,2'),('HL-FRACTION','2.5'),('HL-THOUSAND','1,250')) f(id,qty);
insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,quantityordered,dock,invoicedate)
values('HL-INVOICED','HL-INVOICED','#3','C.05','10','D1','2026-09-10'),
 ('HL-BLANK','','','C.05','10','D1',null),('HL-NODOCK','HL-NODOCK','#3','C.05','10',null,null);
insert into public.ph_master_inventory(unique_id,itemcode,contsize,locationcode,lotcode,ptravailable)
values('HL-INV-A','HL-A','#3','C.12.4','27.S1','0'),('HL-INV-B','HL-B','#3','C.12.4','27.S1',null);

-- Explicit current PO fixture; never infer membership from SOC in production.
do $po$ begin
 if to_regclass('hl_order_private.po_control') is not null then
  insert into public.ph_27f1_hl_po(source_file_id,row_index,run_id,item_code,size,lot,po_remain,imported_po_remain)
  select 'hl-fixture',row_number() over(order by itemcode)::int,'hl-fixture',itemcode,'#3','27.F1',2000,2000
  from (select distinct itemcode from public.ph_soc_master where nullif(itemcode,'') is not null union select 'HL-LATE-CANCEL' union select 'HL-UNDATED') q
  on conflict(source_file_id,row_index) do update set item_code=excluded.item_code,po_remain=2000,imported_po_remain=2000;
  update hl_order_private.po_control set active_scope='hl-fixture',receipt_cutoff='1970-01-01' where singleton;
 end if;
end $po$;

do $test$
declare s jsonb; p jsonb; o jsonb; line_a uuid; line_b uuid; event_id uuid; result jsonb; rev bigint; cmd uuid;
  run text:='receipt-import-one'; imp jsonb; imp2 jsonb; duplicate jsonb; ip jsonb; cutoff timestamptz; import_rows jsonb;
  baseline_scope text; before_pdf jsonb; before_number text;
begin
  update public.ph_27f1_hl_po set po_remain=10,imported_po_remain=10 where item_code='HL-A';
  update public.ph_27f1_hl_po set po_remain=1,imported_po_remain=1 where item_code='HL-B';
  insert into public.ph_27f1_hl_po(source_file_id,row_index,run_id,item_code,size,lot,po_remain,imported_po_remain)
    values('hl-fixture',100,'hl-fixture','HL-A','#3','27.F1',10,10),('hl-fixture',101,'hl-fixture','HL-A','#3','26.F1',77,77);
  insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,quantityordered,dock,planstart)
    values('HL-NOT-PO','NOT-IN-PO','#3','C.05','10','D1','2026-09-15');
  s:=public.hl_order_state();
  perform pg_temp.hl_check(not exists(select 1 from jsonb_array_elements(s->'actionable_rows') a where a->>'source_id'='HL-NOT-PO'),'latest PO membership required');
  perform pg_temp.hl_check((hl_order_private.po_balance('{"itemcode":"HL-A","contsize":"#3"}')->>'remaining')::numeric=10,'duplicate PO rows share one balance');
  perform pg_temp.hl_reject('draft_save','{"rows":[{"source_id":"HL-NOT-PO","quantity":1}]}','HL_ORDER_SOURCE_REVIEW_REQUIRED');
  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":10},{"source_id":"HL-B","quantity":20}]}');
  perform pg_temp.hl_check((select min(po_remain)=10 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'draft does not deduct');
  p:=pg_temp.hl_command('preview','{}')->'preview'; before_pdf:=p->'report';
  s:=pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->>'id')); o:=s->'orders'->0; before_number:=o->>'order_number';
  event_id:=(o->>'event_id')::uuid;
  select id into line_a from hl_order_private.order_lines where order_id=(o->>'id')::uuid and source_id='HL-A';
  select id into line_b from hl_order_private.order_lines where order_id=(o->>'id')::uuid and source_id='HL-B';
  perform pg_temp.hl_check((select min(po_remain)=10 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'submit does not deduct');
  perform pg_temp.hl_confirm(event_id);
  perform pg_temp.hl_check((select min(po_remain)=10 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'delivery confirmation does not deduct');
  rev:=(public.hl_order_state()->>'revision')::bigint; cmd:=gen_random_uuid();
  result:=pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','lines',jsonb_build_array(jsonb_build_object('line_id',line_a,'received_quantity',5))),cmd,rev);
  perform pg_temp.hl_check((select count(*)=2 and min(po_remain)=5 and max(po_remain)=5 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'receipt decrements duplicate copies once');
  perform pg_temp.hl_check(pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','lines',jsonb_build_array(jsonb_build_object('line_id',line_a,'received_quantity',5))),cmd,rev)=result,'receipt retry returns saved result');
  perform pg_temp.hl_check((select count(*)=1 from hl_order_private.po_receipt_adjustments),'receipt retry creates one adjustment');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','lines',jsonb_build_array(jsonb_build_object('line_id',line_a,'received_quantity',8))));
  perform pg_temp.hl_check((select min(po_remain)=2 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'5 to 8 deducts only another 3');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','reason','Count correction','lines',jsonb_build_array(jsonb_build_object('line_id',line_a,'received_quantity',6))));
  perform pg_temp.hl_check((select min(po_remain)=4 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'8 to 6 restores 2');
  perform pg_temp.hl_check((select po_remain=77 from public.ph_27f1_hl_po where item_code='HL-A' and lot='26.F1'),'SOC lot does not redirect receipt away from 27.F1');
  perform pg_temp.hl_check((select min(imported_po_remain)=10 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'original imported balance retained');
  select max(created_at) into cutoff from hl_order_private.po_receipt_adjustments;
  select active_scope into baseline_scope from hl_order_private.po_control;
  import_rows:=jsonb_build_array(jsonb_build_object('source_file_id','po-report','row_index',1,'item_code','HL-A','size','#3','lot','27.F1',
    'po_remain',7,'report_date','2026-09-11','source_values',jsonb_build_object('po_remain',' 7 ')));
  imp:=public.hl_po_import_stage(run,import_rows,false);
  perform pg_temp.hl_check(imp->>'status'='staging' and (select active_scope=baseline_scope from hl_order_private.po_control),'incomplete import leaves active report unchanged');
  perform pg_temp.hl_reject('po_import_preview',jsonb_build_object('import_id',imp->>'id','receipt_cutoff',cutoff),'HL_PO_IMPORT_NOT_PENDING');
  imp:=public.hl_po_import_stage(run,'[]',true);
  perform pg_temp.hl_check(imp->>'status'='pending' and (select min(po_remain)=4 from public.ph_27f1_hl_po where item_code='HL-A' and lot='27.F1'),'completed import awaits Dylan without resetting receipt deductions');
  perform pg_temp.hl_reject('po_import_preview',jsonb_build_object('import_id',imp->>'id','receipt_cutoff',clock_timestamp()+interval '1 hour'),'HL_PO_INVALID_CUTOFF');
  ip:=pg_temp.hl_command('po_import_preview',jsonb_build_object('import_id',imp->>'id','receipt_cutoff',cutoff))->'po_import_preview';
  perform pg_temp.hl_check((ip->'balances'->0->>'remaining')::numeric=7,'inclusive cutoff does not rededuct already included receipts');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','lines',jsonb_build_array(jsonb_build_object('line_id',line_a,'received_quantity',8))));
  perform pg_temp.hl_reject('po_import_confirm',jsonb_build_object('preview_id',ip->>'id'),'HL_PO_PREVIEW_STALE');
  ip:=pg_temp.hl_command('po_import_preview',jsonb_build_object('import_id',imp->>'id','receipt_cutoff',cutoff))->'po_import_preview';
  perform pg_temp.hl_check((ip->'balances'->0->>'remaining')::numeric=5 and (ip->'balances'->0->>'receipt_adjustment')::numeric=2,'later receipt delta remains deducted from new baseline');
  perform pg_temp.hl_command('po_import_confirm',jsonb_build_object('preview_id',ip->>'id'));
  perform pg_temp.hl_check((select po_remain=5 and imported_po_remain=7 from public.ph_27f1_hl_po where source_file_id='po-report'),'confirmation atomically installs adjusted raw column');
  perform pg_temp.hl_check((select source->'source_values'->>'po_remain'=' 7 ' from hl_order_private.po_import_rows where import_id=(imp->>'id')::uuid),'original imported source values preserved');
  duplicate:=public.hl_po_import_stage('receipt-import-copy',jsonb_set(import_rows,'{0,source_file_id}','"new-drive-copy"'),true);
  perform pg_temp.hl_check(duplicate->>'status'='duplicate' and duplicate->>'duplicate_of'=imp->>'id','copy of same report deduplicates regardless of Drive ID');
  perform pg_temp.hl_check((select po_remain=5 from public.ph_27f1_hl_po where source_file_id='po-report'),'duplicate import cannot reset balance');
  imp2:=public.hl_po_import_stage('receipt-import-two',jsonb_set(import_rows,'{0,po_remain}','9'),true);
  perform pg_temp.hl_reject('po_import_preview',jsonb_build_object('import_id',imp2->>'id','receipt_cutoff',cutoff-interval '1 second'),'HL_PO_INVALID_CUTOFF');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','lines',jsonb_build_array(jsonb_build_object('line_id',line_b,'received_quantity',2))));
  perform pg_temp.hl_check((hl_order_private.po_balance('{"itemcode":"HL-B","contsize":"#3"}')->>'status')='missing','saved unmatched line remains receivable with unresolved ledger adjustment');
  perform pg_temp.hl_check(exists(select 1 from hl_order_private.po_receipt_adjustments where itemcode='HL-B' and quantity_delta=2),'unmatched receipt retains audit');
  -- A newer reconciled report must not expose an older pending report again.
  duplicate:=public.hl_po_import_stage('receipt-import-three',jsonb_set(import_rows,'{0,po_remain}','1'),true);
  ip:=pg_temp.hl_command('po_import_preview',jsonb_build_object('import_id',duplicate->>'id','receipt_cutoff',cutoff))->'po_import_preview';
  perform pg_temp.hl_command('po_import_confirm',jsonb_build_object('preview_id',ip->>'id'));
  perform pg_temp.hl_check((select po_remain=-1 from public.ph_27f1_hl_po where source_file_id='po-report'),'negative remaining is retained without clamping');
  perform pg_temp.hl_reject('po_import_preview',jsonb_build_object('import_id',imp2->>'id','receipt_cutoff',cutoff),'HL_PO_IMPORT_SUPERSEDED');
  perform pg_temp.hl_check((public.hl_order_state()->'po_imports')='[]'::jsonb,'older pending imports stay unavailable after newer confirmation');
  perform pg_temp.hl_check((select report=before_pdf from public.ph_hl_order_previews where id=(p->>'id')::uuid),'saved order PDF remains unchanged');
  perform pg_temp.hl_check((select order_number=before_number from hl_order_private.orders where id=(o->>'id')::uuid),'saved order number remains unchanged');
  -- Unknown/contradictory balances are never converted into invented values.
  insert into public.ph_27f1_hl_po(source_file_id,row_index,run_id,item_code,size,lot,po_remain,imported_po_remain)
    select 'extra-copy',1,active_scope,'HL-A','#3','27.F1',null,null from hl_order_private.po_control;
  perform pg_temp.hl_check(hl_order_private.po_balance('{"itemcode":"HL-A","contsize":"#3"}')->>'status'='unknown','mixed blank and numeric copies remain unknown');
  update public.ph_27f1_hl_po set imported_po_remain=99 where source_file_id='extra-copy';
  perform pg_temp.hl_check(hl_order_private.po_balance('{"itemcode":"HL-A","contsize":"#3"}')->>'status'='conflict','conflicting copied balances require reconciliation');
  perform pg_temp.hl_check(not has_table_privilege('authenticated','public.ph_27f1_hl_po','UPDATE')
    and not has_table_privilege('service_role','public.ph_27f1_hl_po','UPDATE'),'direct balance mutation is not exposed');
  perform pg_temp.hl_check(not has_function_privilege('authenticated','public.hl_po_import_stage(text,jsonb,boolean)','EXECUTE')
    and has_function_privilege('service_role','public.hl_po_import_stage(text,jsonb,boolean)','EXECUTE'),'import staging is service-only');
end $test$;
select '1..'||count(*) from hl_checks;
select 'ok '||id||' - '||description from hl_checks order by id;
rollback;
