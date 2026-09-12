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

insert into public.ph_27f1_hl_po(source_file_id,row_index,run_id,item_code,size,lot,common_name,po_ordered,po_remain,imported_po_remain)
values('restock-fixture',1,'restock-fixture','REST.A','#3','27.F1','Restock A',100,100,100),
 ('restock-fixture',2,'restock-fixture','REST.A','#3','27.F1','Restock A',100,100,100),
 ('restock-fixture',3,'restock-fixture','REST.EMPTY','#3','27.F1','No current rows',101,100,100),
 ('restock-fixture',4,'restock-fixture','REST.UNKNOWN','#3','27.F1','Unknown stock',100,100,100),
 ('restock-fixture',5,'restock-fixture','REST.NEGATIVE','#3','27.F1','Negative stock',100,100,100),
 ('restock-fixture',6,'restock-fixture','REST.CONFLICT','#3','27.F1','Conflicting PO',100,100,100),
 ('restock-fixture',7,'restock-fixture','REST.CONFLICT','#3','27.F1','Conflicting PO',200,100,100),
 ('restock-fixture',8,'restock-fixture','REST.ZERO','#3','27.F1','Zero stock',100,100,100),
 ('restock-fixture',9,'old-restock-fixture','REST.OLD','#3','27.F1','Old report',100,100,100);
update hl_order_private.po_control set active_scope='restock-fixture',receipt_cutoff='1970-01-01' where singleton;
insert into public.ph_master_inventory(unique_id,itemcode,contsize,locationcode,lotcode,ptravailable,app_tab_assignment)
values('restock-master-a','REST.A','#3','C.12.001','27.F1','10',null),
 ('restock-master-b','REST.A','#3','B.10.001','27.F1','5',null),
 ('restock-master-season','REST.A','#3','C.12.001','26.F1','999',null),
 ('restock-master-size','REST.A','#7','C.12.001','27.F1','999',null),
 ('restock-master-hidden','REST.A','#3','C.12.003','27.F1','999','not_on_inventory_dylan'),
 ('restock-master-unknown','REST.UNKNOWN','#3','C.12.001','27.F1',null,null),
 ('restock-master-negative','REST.NEGATIVE','#3','C.12.001','27.F1','-1',null),
 ('restock-master-zero','REST.ZERO','#3','C.12.001','27.F1','0',null);
insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,planstart)
values('REST-SOC','REST.A','#3','C.05','27.F1','10','1','2026-09-15');
update public.app_dataset_revisions set state='ready',revision=revision+1,changed_at=clock_timestamp() where key='ph_master_inventory';

create function pg_temp.restock_item(code text) returns jsonb language sql as $$
  select i from jsonb_array_elements(public.hl_order_restock_state()->'items') i where i->>'itemcode'=code
$$;
create function pg_temp.restock_save(code text,qty numeric,day text default '2026-09-15',id text default null) returns jsonb language plpgsql as $$
declare s jsonb:=public.hl_order_restock_state();
begin
 return public.hl_order_command(gen_random_uuid(),'restock_draft_save',jsonb_build_object('ship_date',day,'inventory_snapshot',s->'inventory_snapshot',
   'rows',jsonb_build_array(jsonb_build_object('itemcode',code,'size','#3','quantity',qty)||case when id is null then '{}'::jsonb else jsonb_build_object('source_id',id) end)),(s->>'revision')::bigint);
end $$;

do $test$
declare s jsonb; snap jsonb; item jsonb; p jsonb; result jsonb; cmd uuid; rev bigint; source_id_value text; second_id text; o jsonb; line_id uuid;
  saved_request jsonb; order_id_value uuid; original_number text; watermark bigint; claims text;
begin
  s:=public.hl_order_restock_state(); item:=pg_temp.restock_item('REST.A');
  perform pg_temp.hl_check((item->>'po_ordered')::numeric=100 and (item->>'target')::numeric=30,'duplicate PO rows are copies of one ordered balance');
  perform pg_temp.hl_check((item->>'available')::numeric=15 and (item->>'suggested_quantity')::numeric=15,'full visible matching size and season sums individual master IDs');
  perform pg_temp.hl_check((pg_temp.restock_item('REST.EMPTY')->>'target')::numeric=31 and (pg_temp.restock_item('REST.EMPTY')->>'available')::numeric=0,'target rounds up and verified absent matching inventory means zero');
  perform pg_temp.hl_check(pg_temp.restock_item('REST.UNKNOWN')->>'status'='inventory_unknown','null availability blocks restocking');
  perform pg_temp.hl_check(pg_temp.restock_item('REST.NEGATIVE')->>'status'='inventory_unknown','negative availability blocks restocking');
  perform pg_temp.hl_check(pg_temp.restock_item('REST.CONFLICT')->>'status'='po_unknown','conflicting duplicate ordered balances are unknown');
  perform pg_temp.hl_check((pg_temp.restock_item('REST.ZERO')->>'available')::numeric=0,'zero availability is preserved');
  perform pg_temp.hl_check(pg_temp.restock_item('REST.OLD') is null,'previous PO report is excluded');
  claims:=current_setting('request.jwt.claims');
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  begin perform public.hl_order_restock_state(); raise exception 'unauthorized restock succeeded';
  exception when insufficient_privilege then perform pg_temp.hl_check(sqlerrm='HL_ORDER_FORBIDDEN','restock read requires protected Dylan session'); end;
  perform set_config('request.jwt.claims',claims,true);
  perform pg_temp.hl_check(not has_function_privilege('anon','public.hl_order_restock_state()','EXECUTE'),'anonymous RPC grant is denied');
  perform pg_temp.hl_check(not has_table_privilege('authenticated','hl_order_private.restock_intents','INSERT'),'clients cannot create unprotected intents');

  snap:=s->'inventory_snapshot';
  update public.app_dataset_revisions set state='importing',revision=revision+1 where key='ph_master_inventory';
  perform pg_temp.hl_check(pg_temp.restock_item('REST.A')->>'status'='inventory_verifying','unfinished master import blocks numeric ordering');
  perform pg_temp.hl_reject('restock_draft_save',jsonb_build_object('ship_date','2026-09-15','inventory_snapshot',snap,'rows','[{"itemcode":"REST.A","size":"#3","quantity":5}]'::jsonb),'HL_RESTOCK_INVENTORY_STALE');
  update public.app_dataset_revisions set state='ready',revision=revision+1,changed_at=clock_timestamp() where key='ph_master_inventory';
  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"REST-SOC","quantity":10}]}');
  perform pg_temp.hl_check((pg_temp.restock_item('REST.A')->>'suggested_quantity')::numeric=15,'SOC drafts do not reserve restock target');
  s:=public.hl_order_restock_state(); cmd:=gen_random_uuid(); rev:=(s->>'revision')::bigint;
  saved_request:=jsonb_build_object('ship_date','2026-09-15','inventory_snapshot',s->'inventory_snapshot','rows','[{"itemcode":"REST.A","size":"#3","quantity":5}]'::jsonb);
  result:=public.hl_order_command(cmd,'restock_draft_save',saved_request,rev);
  perform pg_temp.hl_check(public.hl_order_command(cmd,'restock_draft_save',saved_request,rev)=result,'restock command replay returns exact response');
  source_id_value:=pg_temp.restock_item('REST.A')->>'source_id';
  perform pg_temp.hl_check(source_id_value like 'restock:%' and not exists(select 1 from public.ph_soc_master where unique_id=source_id_value),'intent has genuine private identity without synthetic SOC row');
  perform pg_temp.hl_check((pg_temp.restock_item('REST.A')->>'saved_quantity')::numeric=5 and (pg_temp.restock_item('REST.A')->>'suggested_quantity')::numeric=10,'draft reservations deducted once');
  begin perform public.hl_order_command(gen_random_uuid(),'restock_draft_save',saved_request,rev); raise exception 'stale revision accepted';
  exception when serialization_failure then perform pg_temp.hl_check(sqlerrm='HL_ORDER_REVISION_CONFLICT','competing save with stale revision fails'); end;
  perform pg_temp.restock_save('REST.A',3);
  perform pg_temp.hl_check((select quantity=8 from hl_order_private.drafts where source_id=source_id_value),'same-date selections add to existing intent');
  perform pg_temp.restock_save('REST.A',2,'2026-09-16');
  select source_id into second_id from hl_order_private.drafts where source_kind='restock' and ship_date='2026-09-16';
  perform pg_temp.hl_check(second_id<>source_id_value and (pg_temp.restock_item('REST.A')->>'saved_quantity')::numeric=10,'different-date drafts remain separate reservations');
  perform pg_temp.restock_save('REST.A',7,'2026-09-15',source_id_value);
  perform pg_temp.hl_check((select quantity=7 from hl_order_private.drafts where source_id=source_id_value),'explicit saved edit replaces that reservation');
  perform public.hl_order_state();
  perform pg_temp.hl_check((select status='draft' from hl_order_private.dispositions where source_id=source_id_value),'SOC source reconciliation ignores genuine restock intents');
  perform pg_temp.hl_command('draft_clear',jsonb_build_object('source_ids',jsonb_build_array(second_id)));
  perform pg_temp.hl_check((pg_temp.restock_item('REST.A')->>'saved_quantity')::numeric=7,'clearing restock draft restores available reservation');
  p:=pg_temp.hl_command('preview','{"ship_date":"2026-09-15"}');
  perform pg_temp.hl_check(p->'preview'->'report'->>'contract_version'='hl-order-report-v3','mixed SOC and restock preview uses v3');
  perform pg_temp.hl_check((select count(*)=2 and bool_and(value->>'source_kind' in ('soc','restock')) from jsonb_array_elements(p->'preview'->'report'->'lines')),'every mixed report line identifies purpose');
  perform pg_temp.hl_check((select bool_and(value->>'dock'='' and value->>'customername'='') from jsonb_array_elements(p->'preview'->'report'->'lines') where value->>'source_kind'='restock'),'restock report does not fabricate SOC/customer fields');
  update public.app_dataset_revisions set revision=revision+1,changed_at=clock_timestamp() where key='ph_master_inventory';
  perform pg_temp.hl_reject('submit',jsonb_build_object('preview_id',p->'preview'->>'id'),'HL_RESTOCK_REVIEW_REQUIRED');
  perform pg_temp.restock_save('REST.A',7,'2026-09-15',source_id_value);
  p:=pg_temp.hl_command('preview','{"ship_date":"2026-09-15"}');
  result:=pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->'preview'->>'id'));
  o:=result->'orders'->0; order_id_value:=(o->>'id')::uuid; original_number:=o->>'order_number';
  perform pg_temp.hl_check((pg_temp.restock_item('REST.A')->>'saved_quantity')::numeric=0 and (pg_temp.restock_item('REST.A')->>'incoming_quantity')::numeric=7,'queued restock line and reserved draft count once; SOC incoming excluded');
  perform pg_temp.hl_check((hl_order_private.po_balance('{"itemcode":"REST.A","contsize":"#3"}')->>'remaining')::numeric=100,'saving and sending do not deduct PO remaining');
  perform pg_temp.hl_confirm((o->>'event_id')::uuid);
  perform pg_temp.restock_save('REST.A',2);
  p:=pg_temp.hl_command('preview','{"ship_date":"2026-09-15"}');
  perform pg_temp.hl_check(p->'preview'->'report'->>'kind'='addition' and p->'preview'->'report'->>'order_number'=original_number,'same-date restock addition retains open order number');
  perform pg_temp.hl_check((p->'preview'->'report'->>'total_quantity')::numeric=2,'addition contains only newly ordered quantity');
  perform pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->'preview'->>'id'));
  perform pg_temp.hl_confirm((select event_id from hl_order_private.submission_batches where kind='addition' and order_id=order_id_value order by created_at desc,id desc limit 1));
  select id into line_id from hl_order_private.order_lines where source_id=source_id_value;
  result:=pg_temp.hl_command('receive',jsonb_build_object('order_id',order_id_value,'lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',3))));
  item:=pg_temp.restock_item('REST.A'); watermark:=(item->>'receipt_watermark')::bigint;
  perform pg_temp.hl_check(item->>'status'='receipt_pending' and (item->>'incoming_quantity')::numeric=6,'restock receipt pauses recomputation until newer inventory confirmation');
  perform pg_temp.hl_check((hl_order_private.po_balance('{"itemcode":"REST.A","contsize":"#3"}')->>'remaining')::numeric=97,'restock receipt uses existing PO ledger once');
  s:=public.hl_order_restock_state();
  perform pg_temp.hl_reject('restock_inventory_confirm',jsonb_build_object('itemcode','REST.A','size','#3','inventory_snapshot',s->'inventory_snapshot','receipt_watermark',watermark),'HL_RESTOCK_CONFIRMATION_STALE');
  update public.ph_master_inventory set ptravailable='13' where unique_id='restock-master-a';
  update public.app_dataset_revisions set revision=revision+1,changed_at=clock_timestamp() where key='ph_master_inventory';
  item:=pg_temp.restock_item('REST.A');
  perform pg_temp.hl_check((item->>'can_confirm_inventory')::boolean,'newer complete master snapshot permits explicit receipt confirmation');
  s:=public.hl_order_restock_state();
  perform pg_temp.hl_reject('restock_inventory_confirm',jsonb_build_object('itemcode','REST.A','size','#3','inventory_snapshot',s->'inventory_snapshot','receipt_watermark',watermark-1),'HL_RESTOCK_CONFIRMATION_STALE');
  perform pg_temp.hl_command('restock_inventory_confirm',jsonb_build_object('itemcode','REST.A','size','#3','inventory_snapshot',s->'inventory_snapshot','receipt_watermark',watermark));
  perform pg_temp.hl_check(pg_temp.restock_item('REST.A')->>'status'='ready' and (pg_temp.restock_item('REST.A')->>'suggested_quantity')::numeric=6,'confirmation combines new available stock and remaining incoming without receipt double count');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',order_id_value,'reason','Correct count','lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',2))));
  perform pg_temp.hl_check(pg_temp.restock_item('REST.A')->>'status'='receipt_pending' and (hl_order_private.po_balance('{"itemcode":"REST.A","contsize":"#3"}')->>'remaining')::numeric=98,'downward receipt correction restores PO balance and pauses restocking again');
end $test$;
select '1..'||count(*)::text as tap from hl_checks;
select 'ok '||id::text||' - '||description as tap from hl_checks order by id;
rollback;
