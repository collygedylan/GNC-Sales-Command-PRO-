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
declare s jsonb; p jsonb; first_order jsonb; first_id uuid; first_number text; first_pdf jsonb;
  add_event uuid; add_batch uuid; add_line uuid; old_line uuid; cmd uuid; rev bigint; saved jsonb;
begin
  perform pg_temp.hl_check(hl_order_private.ship_date('2026-09-15')='2026-09-15'::date,'date-only does not shift time zone');
  perform pg_temp.hl_check(hl_order_private.ship_date('Tue Sep 15 2026 10:00:00 GMT-0500 (Central Daylight Time)')='2026-09-15'::date,'existing Apps Script ship date parses');
  perform pg_temp.hl_check(hl_order_private.ship_date('2026-09-16T02:00:00Z')='2026-09-15'::date,'timestamp groups by Chicago calendar day');
  perform pg_temp.hl_check(hl_order_private.ship_date('2026-02-30') is null and hl_order_private.ship_date('nonsense') is null,'invalid dates are never guessed');
  update public.ph_soc_master set planstart='2026-09-16' where unique_id='HL-CHANGE';
  update public.ph_soc_master set planstart='Tue Sep 15 2026 10:00:00 GMT-0500 (Central Daylight Time)' where unique_id='HL-A';
  s:=pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":6},{"source_id":"HL-B","quantity":5},{"source_id":"HL-CHANGE","quantity":4}]}');
  perform pg_temp.hl_check((select count(*)=2 from jsonb_array_elements(s->'draft') d where d->>'ship_date'='2026-09-15'),'equivalent formats share persistent date group');
  perform pg_temp.hl_reject('preview','{}','HL_ORDER_SELECT_SHIP_DATE');
  p:=pg_temp.hl_command('preview','{"ship_date":"2026-09-15"}')->'preview'; first_pdf:=p->'report';
  perform pg_temp.hl_check(first_pdf->>'ship_date'='2026-09-15' and jsonb_array_length(first_pdf->'lines')=2 and first_pdf->>'kind'='submission','preview contains only selected date');
  cmd:=gen_random_uuid(); rev:=(public.hl_order_state()->>'revision')::bigint;
  saved:=pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->>'id'),cmd,rev);
  perform pg_temp.hl_check(pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->>'id'),cmd,rev)=saved,'submission retry replays one saved batch');
  first_order:=saved->'orders'->0; first_id:=(first_order->>'id')::uuid; first_number:=first_order->>'order_number';
  perform pg_temp.hl_confirm((first_order->>'event_id')::uuid);
  perform pg_temp.hl_check((select count(*)=1 from hl_order_private.drafts where source_id='HL-CHANGE'),'confirmation preserves another date draft');
  s:=pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-REPLACE","quantity":7}]}');
  perform pg_temp.hl_check((select d->>'target_order_id'=first_id::text and d->>'target_order_number'=first_number from jsonb_array_elements(s->'draft') d where d->>'source_id'='HL-REPLACE'),'same-date addition targets original number');
  p:=pg_temp.hl_command('preview','{"ship_date":"2026-09-15"}')->'preview';
  perform pg_temp.hl_check(p->'report'->>'kind'='addition' and p->'report'->>'order_number'=first_number and jsonb_array_length(p->'report'->'lines')=1 and p->'report'->'lines'->0->>'source_id'='HL-REPLACE','ADDITIONS preview contains new rows only');
  add_batch:=(p->'report'->>'batch_id')::uuid;
  perform pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->>'id'));
  select event_id into add_event from hl_order_private.submission_batches where id=add_batch;
  select id into add_line from hl_order_private.order_lines where batch_id=add_batch;
  select id into old_line from hl_order_private.order_lines where order_id=first_id and source_id='HL-A';
  perform pg_temp.hl_check((select count(*)=1 from hl_order_private.orders) and (select count(*)=2 from hl_order_private.submission_batches),'addition appends independent batch to one order');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',first_id,'lines',jsonb_build_array(jsonb_build_object('line_id',old_line,'received_quantity',2))));
  perform pg_temp.hl_reject('receive',jsonb_build_object('order_id',first_id,'lines',jsonb_build_array(jsonb_build_object('line_id',add_line,'received_quantity',1))),'HL_ORDER_NOT_SENT');
  perform pg_temp.hl_reject('cancellation_preview',jsonb_build_object('order_id',first_id,'reason','pending cannot cancel','lines',jsonb_build_array(jsonb_build_object('line_id',add_line,'quantity',1))),'HL_ORDER_NOT_SENT');
  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-THOUSAND","quantity":1}]}');
  perform pg_temp.hl_reject('preview','{"ship_date":"2026-09-15"}','HL_ORDER_DELIVERY_UNKNOWN');
  perform pg_temp.hl_check((select report=first_pdf from public.ph_hl_order_previews where id=(first_order->>'preview_id')::uuid),'addition never rewrites original PDF');
  perform pg_temp.hl_confirm(add_event);
  perform pg_temp.hl_check((select status='sent' from hl_order_private.submission_batches where id=add_batch) and (select received_quantity=2 from hl_order_private.order_lines where id=old_line),'addition confirmation preserves prior receipt');
  perform pg_temp.hl_check(not exists(select 1 from hl_order_private.drafts where source_id='HL-REPLACE') and (select count(*)=2 from hl_order_private.drafts where source_id in ('HL-CHANGE','HL-THOUSAND')),'confirmation clears only delivered batch, not later pending additions');
  perform pg_temp.hl_confirm(add_event);
  perform pg_temp.hl_check((select count(*)=3 from hl_order_private.order_lines) and (select count(*)=1 from hl_order_private.receipts),'duplicate confirmation cannot duplicate lines or receipts');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',first_id,'lines',(select jsonb_agg(jsonb_build_object('line_id',id,'received_quantity',quantity)) from hl_order_private.order_lines where order_id=first_id)));
  perform pg_temp.hl_check(hl_order_private.order_json(first_id)->>'fulfillment_status'='received','all confirmed lines complete the order');
  p:=pg_temp.hl_command('preview','{"ship_date":"2026-09-15"}')->'preview';
  perform pg_temp.hl_check(p->'report'->>'kind'='submission' and p->'report'->>'order_number'<>first_number,'same date after completion gets new number');
  perform pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->>'id'));
  perform pg_temp.hl_command('draft_clear','{"source_ids":["HL-CHANGE"]}');
  update public.ph_soc_master set itemcode='HL-UNDATED',contsize='#3' where unique_id='HL-BLANK';
  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-BLANK","quantity":1}]}');
  perform pg_temp.hl_reject('preview','{}','HL_ORDER_SHIP_DATE_REQUIRED');
  perform pg_temp.hl_check((select ship_date is null from hl_order_private.drafts where source_id='HL-BLANK'),'undated demand stays saved for correction');
end $test$;
select '1..'||count(*)::text as tap from hl_checks;
select 'ok '||id::text||' - '||description as tap from hl_checks order by id;
rollback;
