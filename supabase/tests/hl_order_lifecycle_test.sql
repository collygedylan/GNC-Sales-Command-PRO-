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

do $test$
<<hl_test>>
declare s jsonb; first_result jsonb; preview jsonb; frozen jsonb; ord jsonb; cancellation jsonb;
  command_id uuid:=gen_random_uuid(); event_id uuid; line_id uuid; order_id uuid; rev bigint; before_soc jsonb; before_inventory jsonb;
begin
  select jsonb_agg(to_jsonb(t) order by unique_id) into before_soc from public.ph_soc_master t;
  select jsonb_agg(to_jsonb(t) order by unique_id) into before_inventory from public.ph_master_inventory t;
  s:=public.hl_order_state(); rev:=(s->>'revision')::bigint;
  perform pg_temp.hl_check(exists(select 1 from jsonb_array_elements(s->'actionable_rows') x where x->>'source_id'='HL-BLANK'),'blank item remains visible under original eligibility');
  perform pg_temp.hl_check(not exists(select 1 from jsonb_array_elements(s->'actionable_rows') x where x->>'source_id' in ('HL-INVOICED','HL-NODOCK')),'invoice and dock/plan eligibility enforced');
  perform pg_temp.hl_reject('draft_save','{"rows":[{"source_id":"HL-INVALID","quantity":1}]}','HL_ORDER_INVALID_QUANTITY');
  perform pg_temp.hl_reject('draft_save','{"rows":[{"source_id":"HL-FRACTION","quantity":1}]}','HL_ORDER_INVALID_QUANTITY');
  perform pg_temp.hl_reject('draft_save','{"rows":[{"source_id":"HL-A","quantity":1.5}]}','HL_ORDER_INVALID_QUANTITY');
  perform pg_temp.hl_reject('draft_save','{"rows":[{"source_id":"HL-A","quantity":11}]}','HL_ORDER_INVALID_QUANTITY');
  first_result:=pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":6}]}',command_id,rev);
  perform pg_temp.hl_check(pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":6}]}',command_id,rev)=first_result,'same command replays exact response before stale revision check');
  begin perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":5}]}',command_id,rev); raise exception 'Expected command conflict';
  exception when sqlstate '22023' then perform pg_temp.hl_check(sqlerrm='HL_ORDER_COMMAND_ID_CONFLICT','same command ID cannot change payload'); end;
  begin perform pg_temp.hl_command('draft_clear','{"source_ids":["HL-A"]}',gen_random_uuid(),rev); raise exception 'Expected revision conflict';
  exception when sqlstate '40001' then perform pg_temp.hl_check(sqlerrm='HL_ORDER_REVISION_CONFLICT','stale tab cannot overwrite a draft'); end;
  s:=pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-B","quantity":20},{"source_id":"HL-THOUSAND","quantity":"1,250"}]}');
  perform pg_temp.hl_check(jsonb_array_length(s->'draft')=3,'draft_save upserts without deleting prior rows and accepts proper thousands');
  perform pg_temp.hl_command('draft_clear','{"source_ids":["HL-THOUSAND"]}');
  preview:=pg_temp.hl_command('preview','{}')->'preview'; frozen:=preview->'report';
  perform pg_temp.hl_check(frozen->>'contract_version'='hl-order-report-v1' and (frozen->>'total_quantity')::numeric=26,'preview freezes report contract, order number and exact total');
  perform pg_temp.hl_check((select x->'ptravailable'='0'::jsonb from jsonb_array_elements(frozen->'lines') x where x->>'source_id'='HL-A'),'zero inventory availability is numeric zero');
  perform pg_temp.hl_check((select x->'ptravailable'='null'::jsonb from jsonb_array_elements(frozen->'lines') x where x->>'source_id'='HL-B'),'unknown inventory availability stays null despite stale SOC 999');
  perform pg_temp.hl_check((select report=frozen from public.ph_hl_order_previews where id=(preview->>'id')::uuid),'persisted preview equals client preview exactly');
  s:=pg_temp.hl_command('submit',jsonb_build_object('preview_id',preview->>'id'));
  ord:=s->'orders'->0; order_id:=(ord->>'id')::uuid; event_id:=(ord->>'event_id')::uuid;
  select (x->>'id')::uuid into line_id from jsonb_array_elements(ord->'lines') x where x->>'source_id'='HL-A';
  perform pg_temp.hl_check(ord->>'status'='queued' and jsonb_array_length(s->'draft')=2,'queued send preserves saved draft until confirmation');
  perform pg_temp.hl_check((select count(*)=2 from jsonb_array_elements(s->'actionable_rows') x where x->>'source_id' in ('HL-A','HL-B')),'queued sources remain in Needed until confirmation');
  perform pg_temp.hl_reject('draft_save','{"rows":[{"source_id":"HL-A","quantity":1}]}','HL_ORDER_DELIVERY_UNKNOWN');
  perform pg_temp.hl_confirm(event_id);
  s:=public.hl_order_state(); ord:=s->'orders'->0;
  perform pg_temp.hl_check(ord->>'status'='sent' and s->'draft'='[]'::jsonb,'durable Gmail confirmation transitions order and clears submitted draft');
  perform pg_temp.hl_check(not exists(select 1 from jsonb_array_elements(s->'actionable_rows') x where x->>'source_id' in ('HL-A','HL-B')),'confirmed send removes sources durably');
  perform pg_temp.hl_check((select status='handled' and available_quantity=0 from hl_order_private.dispositions where source_id='HL-A'),'reduced quantity handles unsent remainder locally');
  s:=pg_temp.hl_command('receive',jsonb_build_object('order_id',order_id,'lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',3))));
  perform pg_temp.hl_check((select received_quantity=3 from hl_order_private.order_lines where id=line_id),'partial receipt sets total received');
  perform pg_temp.hl_reject('receive',jsonb_build_object('order_id',order_id,'lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',2))),'HL_ORDER_CORRECTION_REASON_REQUIRED');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',order_id,'reason','One counted twice','lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',2))));
  perform pg_temp.hl_check(exists(select 1 from hl_order_private.receipts r where r.line_id=hl_test.line_id and quantity_delta=-1 and reason='One counted twice'),'receipt correction retains negative delta and reason');
  perform pg_temp.hl_reject('receive',jsonb_build_object('order_id',order_id,'lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',7))),'HL_ORDER_INVALID_QUANTITY');
  cancellation:=pg_temp.hl_command('cancellation_preview',jsonb_build_object('order_id',order_id,'reason','Need a replacement source','lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'quantity',2))))->'preview';
  perform pg_temp.hl_check(cancellation->'report'->>'original_order_number'=ord->>'order_number','cancellation PDF references original order number');
  perform pg_temp.hl_command('cancellation_submit',jsonb_build_object('preview_id',cancellation->>'id'));
  select c.event_id into event_id from hl_order_private.cancellations c where c.id=(cancellation->'report'->>'cancellation_id')::uuid;
  perform pg_temp.hl_reject('receive',jsonb_build_object('order_id',order_id,'lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'received_quantity',5))),'HL_ORDER_INVALID_QUANTITY');
  perform pg_temp.hl_check((select cancelled_quantity=0 from hl_order_private.order_lines where id=line_id),'pending cancellation reserves balance without premature cancellation');
  perform pg_temp.hl_confirm(event_id);
  perform pg_temp.hl_check((select cancelled_quantity=2 from hl_order_private.order_lines where id=line_id),'confirmed cancellation applies balance once');
  perform pg_temp.hl_check((select status='needs_review' and available_quantity=2 from hl_order_private.dispositions where source_id='HL-A'),'confirmed cancellation reopens only cancelled plants for review');
  perform pg_temp.hl_command('resolve_review','{"source_id":"HL-A","resolution":"needed"}');
  perform pg_temp.hl_reject('draft_save','{"rows":[{"source_id":"HL-A","quantity":3}]}','HL_ORDER_INVALID_QUANTITY');
  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":2}]}');
  perform pg_temp.hl_command('draft_clear','{"source_ids":["HL-A"]}');
  perform pg_temp.hl_check((select jsonb_agg(to_jsonb(t) order by unique_id)=before_soc from public.ph_soc_master t),'orders, receipts and cancellations never mutate SOC');
  perform pg_temp.hl_check((select jsonb_agg(to_jsonb(t) order by unique_id)=before_inventory from public.ph_master_inventory t),'orders and receipts never mutate inventory');

  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-CHANGE","quantity":5}]}');
  preview:=pg_temp.hl_command('preview','{}')->'preview';
  insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,transactionnumber,customername)
    values('HL-LIVE-SIBLING','HL-CHANGE','#3','C.12.4','27.S2','7','D2','ORDER-HL-CHANGE','Fixture customer');
  update public.ph_soc_master set quantityordered='14' where unique_id='HL-CHANGE';
  s:=public.hl_order_state();
  perform pg_temp.hl_check((select x->>'status'='needs_review' from jsonb_array_elements(s->'draft') x where x->>'source_id'='HL-CHANGE'),'changed source retains draft and blocks it for review');
  perform pg_temp.hl_check((select x->'current_source' is distinct from 'null'::jsonb and x->'replacement_candidates'='[]'::jsonb
    from jsonb_array_elements(s->'dispositions') x where x->>'source_id'='HL-CHANGE'),
    'live original with a same-reference sibling does not suggest replacing itself');
  perform pg_temp.hl_check(exists(select 1 from jsonb_array_elements(s->'actionable_rows') x where x->>'source_id'='HL-LIVE-SIBLING'),
    'same-reference live sibling remains independent actionable demand');
  perform pg_temp.hl_reject('submit',jsonb_build_object('preview_id',preview->>'id'),'HL_ORDER_PREVIEW_STALE');
  perform pg_temp.hl_command('resolve_review','{"source_id":"HL-CHANGE","resolution":"needed"}');
  perform pg_temp.hl_command('dismiss','{"source_ids":["HL-CHANGE"]}');
  s:=public.hl_order_state();
  perform pg_temp.hl_check((select status='removed' from hl_order_private.dispositions where source_id='HL-CHANGE'),'remove is durable across reloads');
  perform pg_temp.hl_command('restore','{"source_ids":["HL-CHANGE"]}');
  perform pg_temp.hl_check((select status='needed' from hl_order_private.dispositions where source_id='HL-CHANGE'),'undo restores an unchanged removed source');

  perform pg_temp.hl_command('dismiss','{"source_ids":["HL-REPLACE"]}');
  update public.ph_soc_master set unique_id='HL-REPLACEMENT' where unique_id='HL-REPLACE';
  s:=public.hl_order_state();
  perform pg_temp.hl_check((select count(*)=2 from hl_order_private.dispositions where source_id in ('HL-REPLACE','HL-REPLACEMENT') and status='needs_review'),'changed source ID quarantines old and replacement rows');
  perform pg_temp.hl_check((select x->'current_source'='null'::jsonb and jsonb_array_length(x->'replacement_candidates')=1
    and x->'replacement_candidates'->0->>'source_id'='HL-REPLACEMENT'
    from jsonb_array_elements(s->'dispositions') x where x->>'source_id'='HL-REPLACE'),
    'missing original retains its eligible same-reference replacement suggestion');
  perform pg_temp.hl_check((select x->'replacement_candidates'='[]'::jsonb
    from jsonb_array_elements(s->'dispositions') x where x->>'source_id'='HL-REPLACEMENT'),
    'live possible replacement does not expose reverse replacement suggestions');
  perform pg_temp.hl_reject('resolve_review','{"source_id":"HL-REPLACEMENT","resolution":"needed"}','HL_ORDER_REPLACEMENT_REVIEW_REQUIRED');
  perform pg_temp.hl_command('resolve_review','{"source_id":"HL-REPLACE","resolution":"needed","replacement_source_id":"HL-REPLACEMENT"}');
  perform pg_temp.hl_check((select available_quantity=10 and status='needed' from hl_order_private.dispositions where source_id='HL-REPLACEMENT'),'explicit replacement carries uncovered quantity');
  update public.ph_soc_master set quantityordered='22' where unique_id='HL-B';
  perform public.hl_order_state();
  perform pg_temp.hl_command('resolve_review','{"source_id":"HL-B","resolution":"needed"}');
  perform pg_temp.hl_check((select available_quantity=2 from hl_order_private.dispositions where source_id='HL-B'),'changed handled demand can reorder only increased demand, not live ordered balance');
  perform pg_temp.hl_command('receive',jsonb_build_object('order_id',order_id,'lines',
    (select jsonb_agg(jsonb_build_object('line_id',l.id,'received_quantity',l.quantity-l.cancelled_quantity))
      from hl_order_private.order_lines l where l.order_id=hl_test.order_id)));
  perform pg_temp.hl_check(hl_order_private.order_json(order_id)->>'fulfillment_status'='received_and_cancelled','mixed fulfilled order does not claim all plants were received');

  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":2}]}');
  insert into public.ph_master_inventory(unique_id,itemcode,contsize,locationcode,lotcode,ptravailable)
    values('HL-INV-A-DUP','HL-A','#3','C.12.4','27.S1','100');
  preview:=pg_temp.hl_command('preview','{}')->'preview';
  perform pg_temp.hl_check((select x->'ptravailable'='null'::jsonb from jsonb_array_elements(preview->'report'->'lines') x where x->>'source_id'='HL-A'),'ambiguous exact inventory never supplies a guessed availability');
  insert into public.ph_hl_order_previews(id,created_by,expires_at,state_revision,source_fingerprint,report)
    select gen_random_uuid(),created_by,now()-interval '1 second',state_revision,source_fingerprint,report
    from public.ph_hl_order_previews where id=(preview->>'id')::uuid returning jsonb_build_object('id',id) into frozen;
  perform pg_temp.hl_reject('submit',jsonb_build_object('preview_id',frozen->>'id'),'HL_ORDER_PREVIEW_STALE');
  begin update public.ph_hl_order_previews set report='{}' where id=(preview->>'id')::uuid; raise exception 'Expected immutable report';
  exception when sqlstate '55000' then perform pg_temp.hl_check(sqlerrm='HL_ORDER_HISTORY_IMMUTABLE','historical PDF cannot be altered'); end;
  perform pg_temp.hl_command('submit',jsonb_build_object('preview_id',preview->>'id'));
  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-B","quantity":2}]}');
  preview:=pg_temp.hl_command('preview','{}')->'preview';
  perform pg_temp.hl_check(jsonb_array_length(preview->'report'->'lines')=1 and preview->'report'->'lines'->0->>'source_id'='HL-B',
    'older submitting draft does not block an unrelated ready preview or join its PDF');
  s:=pg_temp.hl_command('submit',jsonb_build_object('preview_id',preview->>'id'));
  perform pg_temp.hl_check((select count(*)=2 from jsonb_array_elements(s->'draft') x where x->>'status'='submitting'),
    'unrelated submissions retain independent locked drafts awaiting confirmation');

  insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,transactionnumber)
    values('HL-LATE-CANCEL','HL-LATE-CANCEL','#3','C.12.4','27.S1','10','D1','LATE-CANCEL-ORDER');
  perform pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-LATE-CANCEL","quantity":6}]}');
  preview:=pg_temp.hl_command('preview','{}')->'preview';
  perform pg_temp.hl_command('submit',jsonb_build_object('preview_id',preview->>'id'));
  select o.id,o.event_id,l.id into order_id,event_id,line_id from hl_order_private.orders o
    join hl_order_private.order_lines l on l.order_id=o.id where l.source_id='HL-LATE-CANCEL';
  perform pg_temp.hl_confirm(event_id);
  update public.ph_soc_master set unique_id='HL-LATE-SUCCESSOR',quantityordered='12' where unique_id='HL-LATE-CANCEL';
  perform public.hl_order_state();
  perform pg_temp.hl_command('resolve_review','{"source_id":"HL-LATE-CANCEL","resolution":"needed","replacement_source_id":"HL-LATE-SUCCESSOR"}');
  perform pg_temp.hl_check((select status='needed' and available_quantity=2 from hl_order_private.dispositions where source_id='HL-LATE-SUCCESSOR'),
    'reviewed replacement preserves live order and local coverage');
  cancellation:=pg_temp.hl_command('cancellation_preview',jsonb_build_object('order_id',order_id,'reason','Cancel two after import replacement',
    'lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'quantity',2))))->'preview';
  perform pg_temp.hl_command('cancellation_submit',jsonb_build_object('preview_id',cancellation->>'id'));
  select c.event_id into event_id from hl_order_private.cancellations c where c.id=(cancellation->'report'->>'cancellation_id')::uuid;
  perform pg_temp.hl_confirm(event_id);
  perform pg_temp.hl_check((select status='needs_review' and available_quantity=4 from hl_order_private.dispositions where source_id='HL-LATE-SUCCESSOR'),
    'later cancellation reopens only canceled quantity on reviewed successor');
  perform pg_temp.hl_check((select status='removed' and available_quantity=0 from hl_order_private.dispositions where source_id='HL-LATE-CANCEL'),
    'late cancellation never revives retired source ID');
  insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,transactionnumber)
    values('HL-LATE-CANCEL','HL-LATE-CANCEL','#3','C.12.4','27.S1','20','D1','LATE-CANCEL-ORDER');
  perform public.hl_order_state();
  perform pg_temp.hl_reject('resolve_review','{"source_id":"HL-LATE-CANCEL","resolution":"needed"}','HL_ORDER_REPLACEMENT_REVIEW_REQUIRED');
  perform pg_temp.hl_command('resolve_review','{"source_id":"HL-LATE-CANCEL","resolution":"removed"}');
  perform pg_temp.hl_reject('restore','{"source_ids":["HL-LATE-CANCEL"]}','HL_ORDER_SOURCE_REVIEW_REQUIRED');
end $test$;
select '1..'||count(*)::text as tap from hl_checks;
select 'ok '||id::text||' - '||description as tap from hl_checks order by id;
rollback;
