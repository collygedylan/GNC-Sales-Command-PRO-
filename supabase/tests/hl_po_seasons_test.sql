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

insert into public.ph_master_inventory(unique_id,itemcode,contsize,locationcode,lotcode,ptravailable,app_tab_assignment)
values('sea-f1','000310.030.1','#3','C.12.001','27.F1','154',null),('sea-other','000310.030.1','#3','C.12.002','26.F1','999',null),
 ('sea-hidden','000310.030.1','#3','C.12.003','27.S1','999','not_on_inventory_dylan');
update public.app_dataset_revisions set state='ready',revision=revision+1,changed_at=clock_timestamp() where key='ph_master_inventory';
update hl_order_private.po_control set receipt_cutoff='1970-01-01T00:00:00Z';
insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,planstart)
values('SEA-F1','000310.030.1','#3','C.05','27.F1','10','1','2026-09-15'),
 ('SEA-S1','000310.030.1','#3','C.05','27.S1','10','1','2026-09-15'),
 ('SEA-OTHER','000310.030.1','#3','C.05','26.F1','10','1','2026-09-15');

do $test$
declare meta jsonb:=jsonb_build_object('source_file_id','pdf-fixture','source_file_name','PO HL.pdf','fingerprint',repeat('a',64),'page_count',3,
 'report_printed_at','2026-09-11T16:17:26-05:00','report_date','2026-09-11','parser_version','fixture-v1');
 line jsonb:=jsonb_build_object('item_code','000310.030.1','size','#3','common_name','Sea Green Juniper','vendor','823517','po_number','10C00258');
 f1 jsonb;s1 jsonb;imp jsonb;p jsonb;s jsonb;item jsonb;snap jsonb;r jsonb;o jsonb;source_id_value text;line_id uuid;before_rev bigint;cmd uuid:=gen_random_uuid();payload jsonb;dup jsonb;
begin
 f1:=jsonb_build_array(line||'{"lot":"27.F1","po_ordered":500,"po_received":500,"po_remain":0}'::jsonb,
  line||'{"lot":"27.F1","po_ordered":300,"po_received":0,"po_remain":300}'::jsonb);
 s1:=jsonb_build_array(line||'{"lot":"27.S1","po_ordered":397,"po_received":0,"po_remain":397}'::jsonb,
  line||'{"lot":"27.S1","po_ordered":397,"po_received":0,"po_remain":397}'::jsonb);
 imp:=public.hl_po_pdf_stage('pdf-run',meta,1,f1,false);
 begin perform public.hl_po_pdf_stage('pdf-run',meta,null,'[]',true);raise exception 'Expected incomplete rejection';
 exception when others then if sqlerrm<>'HL_PO_PDF_INCOMPLETE' then raise;end if;end;
 perform pg_temp.hl_check((select active_import_id is null from hl_order_private.po_control),'Incomplete PDF leaves active report unchanged');
 perform public.hl_po_pdf_stage('pdf-run',meta,2,s1,false);
 imp:=public.hl_po_pdf_stage('pdf-run',meta,3,jsonb_build_array(line||'{"lot":"26.F1","po_ordered":1000,"po_received":0,"po_remain":1000}'::jsonb),true);
 perform pg_temp.hl_check(imp->>'status'='pending' and (imp->>'row_count')::int=5,'Complete report stages both seasons and preserves excluded provenance');
 perform public.hl_po_pdf_stage('pdf-run',meta,1,f1,false);
 perform pg_temp.hl_check((select count(*)=5 from hl_order_private.po_import_rows),'Lost acknowledgments replay page without duplicate rows');
 p:=pg_temp.hl_command('po_import_preview',jsonb_build_object('import_id',imp->>'id','receipt_cutoff','1970-01-01T00:00:00Z'))->'po_import_preview';
 perform pg_temp.hl_check(jsonb_array_length(p->'balances')=2,'Import preview separates F1 and S1 and excludes other lots');
 perform pg_temp.hl_command('po_import_confirm',jsonb_build_object('preview_id',p->>'id'));
 perform pg_temp.hl_check((select remaining=300 from hl_order_private.po_balances_v2() where lot='27.F1'),'F1 sums genuine PO lines; blank zero is retained');
 perform pg_temp.hl_check((select remaining=794 from hl_order_private.po_balances_v2() where lot='27.S1'),'Identical legitimate S1 lines both count');
 s:=public.hl_order_restock_state();select i into item from jsonb_array_elements(s->'items') i;
 perform pg_temp.hl_check((item->>'target')::numeric=90 and (item->>'available')::numeric=154 and (item->>'suggested_quantity')::numeric=0,'F1 target90 with available154 suggests zero');
 s:=public.hl_order_restock_state_v2('27.S1');select i into item from jsonb_array_elements(s->'items') i;
 perform pg_temp.hl_check((item->>'target')::numeric=239 and (item->>'available')::numeric=0 and (item->>'suggested_quantity')::numeric=239,'S1 target239 ignores other seasons and hidden rows');
 perform pg_temp.hl_check((select count(*)=2 from hl_order_private.sources()),'SOC membership uses exact supported lot with existing location rules');
 snap:=s->'inventory_snapshot';before_rev:=(s->>'revision')::bigint;
 payload:=jsonb_build_object('lot','27.S1','ship_date','2026-09-15','inventory_snapshot',snap,'rows',jsonb_build_array(jsonb_build_object('itemcode','000310.030.1','size','#3','quantity',50)));
 r:=public.hl_order_command(cmd,'restock_draft_save',payload,before_rev);
 perform pg_temp.hl_check(public.hl_order_command(cmd,'restock_draft_save',payload,before_rev)=r,'Command replay returns same response');
 select source_id into source_id_value from hl_order_private.drafts where source_kind='restock';
 perform pg_temp.hl_check((select po_lot='27.S1' and quantity=50 from hl_order_private.drafts where source_id=source_id_value),'Saved S1 reservation has immutable accounting lot');
 perform pg_temp.hl_reject('restock_draft_save',jsonb_build_object('lot','27.F1','ship_date','2026-09-15','inventory_snapshot',snap,
 'rows',jsonb_build_array(jsonb_build_object('itemcode','000310.030.1','size','#3','quantity',1,'source_id',source_id_value))),'HL_RESTOCK_REVIEW_REQUIRED');
 p:=pg_temp.hl_command('preview','{"ship_date":"2026-09-15"}')->'preview';
 r:=pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->>'id'));o:=r->'orders'->0;
 perform pg_temp.hl_confirm((o->>'event_id')::uuid);
 select id into line_id from hl_order_private.order_lines where source_id=source_id_value;
 perform pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',5))));
 perform pg_temp.hl_check((select remaining=789 from hl_order_private.po_balances_v2() where lot='27.S1') and (select remaining=300 from hl_order_private.po_balances_v2() where lot='27.F1'),'Receipt deducts S1 exactly once; F1 remains unchanged');
 perform pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','reason','Fixture count correction','lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',3))));
 perform pg_temp.hl_check((select remaining=791 from hl_order_private.po_balances_v2() where lot='27.S1'),'Receipt correction restores difference');
 perform pg_temp.hl_check((select target=239 from hl_order_private.restock_targets where lot='27.S1'),'Receipts preserve fixed target');
 s:=public.hl_order_restock_state_v2('27.S1');select i into item from jsonb_array_elements(s->'items') i;
 perform pg_temp.hl_check(item->>'status'='receipt_pending','Receipt pauses only matching season pending inventory confirmation');
 insert into hl_order_private.restock_inventory_gates(itemcode,size,lot,receipt_watermark,receipt_revision,receipt_at)
 values('000310.030.1','#3','27.F1',1,1,clock_timestamp());
 update public.app_dataset_revisions set revision=revision+2,changed_at=clock_timestamp() where key='ph_master_inventory';
 s:=public.hl_order_restock_state_v2('27.S1');select i into item from jsonb_array_elements(s->'items') i;
 perform pg_temp.hl_command('restock_inventory_confirm',jsonb_build_object('lot','27.S1','itemcode','000310.030.1','size','#3',
 'inventory_snapshot',s->'inventory_snapshot','receipt_watermark',item->'receipt_watermark'));
 perform pg_temp.hl_check((select confirmed_watermark=0 from hl_order_private.restock_inventory_gates where lot='27.F1') and
 (select confirmed_watermark=receipt_watermark from hl_order_private.restock_inventory_gates where lot='27.S1'),'Inventory confirmation clears only its matching season gate');
 p:=pg_temp.hl_command('restock_target_preview','{"lot":"27.S1","items":[{"itemcode":"000310.030.1","size":"#3"}]}')->'restock_target_preview';
 perform pg_temp.hl_command('restock_target_confirm',jsonb_build_object('preview_id',p->>'id'));
 perform pg_temp.hl_check((select target=238 and basis_quantity=791 from hl_order_private.restock_targets where lot='27.S1'),'Explicit target reset uses current remaining with audit');
 perform pg_temp.hl_check((select count(*)=3 from hl_order_private.restock_target_history),'Target initialization/reset audit is preserved');
 meta:=meta||'{"source_file_id":"pdf-copy"}';
 perform public.hl_po_pdf_stage('pdf-copy',meta,1,f1,false);perform public.hl_po_pdf_stage('pdf-copy',meta,2,s1,false);
 dup:=public.hl_po_pdf_stage('pdf-copy',meta,3,jsonb_build_array(line||'{"lot":"26.F1","po_ordered":1000,"po_received":0,"po_remain":1000}'::jsonb),true);
 perform pg_temp.hl_check(dup->>'status'='duplicate' and dup->>'duplicate_of'=imp->>'id','Duplicate whole report cannot reset target or deductions');
 meta:=meta||jsonb_build_object('source_file_id','pdf-old','fingerprint',repeat('b',64),'report_printed_at','2026-09-10T16:17:26-05:00');
 perform public.hl_po_pdf_stage('pdf-old',meta,1,f1,false);perform public.hl_po_pdf_stage('pdf-old',meta,2,s1,false);
 dup:=public.hl_po_pdf_stage('pdf-old',meta,3,'[]',true);
 perform pg_temp.hl_reject('po_import_preview',jsonb_build_object('import_id',dup->>'id','receipt_cutoff','1970-01-01T00:00:00Z'),'HL_PO_IMPORT_SUPERSEDED');
 meta:=meta||jsonb_build_object('source_file_id','pdf-conflict','fingerprint',repeat('c',64),'report_printed_at','2026-09-11T16:17:26-05:00');
 perform public.hl_po_pdf_stage('pdf-conflict',meta,1,f1,false);perform public.hl_po_pdf_stage('pdf-conflict',meta,2,s1,false);
 dup:=public.hl_po_pdf_stage('pdf-conflict',meta,3,'[]',true);
 p:=pg_temp.hl_command('po_import_preview',jsonb_build_object('import_id',dup->>'id','receipt_cutoff','1970-01-01T00:00:00Z'))->'po_import_preview';
 perform pg_temp.hl_reject('po_import_confirm',jsonb_build_object('preview_id',p->>'id'),'HL_PO_REPORT_CONFLICT');
 perform pg_temp.hl_check((select count(*)=1 from public.ph_27f1_hl_po),'Compatibility projection stores one aggregate F1 row');
 perform pg_temp.hl_check((select po_remain=791 from public.ph_27s1_hl_po limit 1),'S1 PO read model reflects corrected ledger balance');
 perform pg_temp.hl_check(not has_function_privilege('authenticated','public.hl_po_import_capabilities()','EXECUTE') and not has_function_privilege('anon','public.hl_po_import_capabilities()','EXECUTE') and has_function_privilege('service_role','public.hl_po_import_capabilities()','EXECUTE'),'PDF authentication probe is executable only by service role');
 perform pg_temp.hl_check(not has_function_privilege('authenticated','public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)','EXECUTE'),'Authenticated client cannot stage PDF reports');
 perform pg_temp.hl_check(not has_table_privilege('authenticated','public.ph_27s1_hl_po','UPDATE'),'S1 PO read model rejects browser writes');
end $test$;
select '1..'||count(*) from hl_checks;
select 'ok '||id||' - '||description from hl_checks order by id;
rollback;
