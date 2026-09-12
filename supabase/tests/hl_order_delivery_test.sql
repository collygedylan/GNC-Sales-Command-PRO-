-- Synthetic, disposable delivery/auth fixture. No email or production data.
begin;
create temporary table hl_delivery_checks(id integer generated always as identity,description text) on commit drop;
create function pg_temp.hld_check(ok boolean,description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'HL delivery: %',description; end if;
  insert into hl_delivery_checks(description) values(description);
end $$;
create function pg_temp.hld_identity(actor text default 'dylan') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role',case when actor='service' then 'service_role' else 'authenticated' end,true);
  perform set_config('request.jwt.claims',case when actor='service' then '{"role":"service_role"}' else
    jsonb_build_object('role','authenticated','sub',case when actor='manager' then '98000000-0000-0000-0000-000000000003' else '98000000-0000-0000-0000-000000000001' end,
      'iss','https://kzrnyjsosryejjejliii.supabase.co/auth/v1','session_id',case when actor='manager' then '98000000-0000-0000-0000-000000000004' else '98000000-0000-0000-0000-000000000002' end,
      'exp',extract(epoch from now()+interval '1 hour'))::text end,true);
end $$;
create function pg_temp.hld_command(action text,payload jsonb) returns jsonb language plpgsql as $$
begin return public.hl_order_command(gen_random_uuid(),action,payload,(public.hl_order_state()->>'revision')::bigint); end $$;
create function pg_temp.hld_reject(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; raise exception 'Expected rejection: %',expected;
  exception when others then if sqlerrm<>expected then raise; end if; end;
  perform pg_temp.hld_check(true,expected||' rejects unsafe operation');
end $$;
-- This test-only helper is intentionally invoker, so statements exercise the
-- selected role's actual grants/RLS. Only its assertion storage is granted.
grant all on hl_delivery_checks to authenticated,anon,service_role;
grant usage on sequence hl_delivery_checks_id_seq to authenticated,anon,service_role;
create temporary table hl_delivery_context(event_id uuid,order_id uuid,line_id uuid,preview_id uuid,cancellation_event_id uuid) on commit drop;
grant select on hl_delivery_context to authenticated,anon,service_role;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('98000000-0000-0000-0000-000000000001','hl-delivery@example.invalid','{}','{}'),
 ('98000000-0000-0000-0000-000000000003','hl-manager@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('98000000-0000-0000-0000-000000000001','dylan_collyge','HL Delivery','ADMIN',false),
 ('98000000-0000-0000-0000-000000000003','jd_jones','HL Manager','ADMIN',false);
insert into auth.sessions(id,user_id,not_after) values
 ('98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000001',now()+interval '1 hour'),
 ('98000000-0000-0000-0000-000000000004','98000000-0000-0000-0000-000000000003',now()+interval '1 hour');
insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,stopnumber,planstart)
values('HL-DELIVERY-SOC','HL-DELIVERY','#3','C.12.4','27.S1','20','Dock 2','Stop 3','2026-09-15');
insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,status,payload)
values('98000000-0000-0000-0000-000000000005','hl-test-normal','request_created','failed','{}');

select pg_temp.hld_identity();
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
declare preview jsonb; state jsonb; expired uuid:=gen_random_uuid(); event_id uuid; order_id uuid; line_id uuid;
begin
  perform pg_temp.hld_command('draft_save','{"rows":[{"source_id":"HL-DELIVERY-SOC","quantity":12}]}');
  preview:=pg_temp.hld_command('preview','{}')->'preview';
  insert into public.ph_hl_order_previews(id,created_by,expires_at,state_revision,source_fingerprint,report)
    select expired,created_by,now()-interval '1 minute',state_revision,source_fingerprint,report
      from public.ph_hl_order_previews where id=(preview->>'id')::uuid;
  perform pg_temp.hld_reject(format('select pg_temp.hld_command(''submit'',%L::jsonb)',jsonb_build_object('preview_id',expired)),'HL_ORDER_PREVIEW_STALE');
  perform pg_temp.hld_reject(format('select pg_temp.hld_command(''submit'',%L::jsonb)',jsonb_build_object('preview_id',preview->>'id','recipients',jsonb_build_array('injected@example.invalid'))),'HL_ORDER_INVALID_COMMAND');
  state:=pg_temp.hld_command('submit',jsonb_build_object('preview_id',preview->>'id'));
  event_id:=(state->'orders'->0->>'event_id')::uuid; order_id:=(state->'orders'->0->>'id')::uuid;
  line_id:=(state->'orders'->0->'lines'->0->>'id')::uuid;
  insert into hl_delivery_context values(event_id,order_id,line_id,(preview->>'id')::uuid,null);
  perform pg_temp.hld_check(state->'orders'->0->>'status'='queued' and jsonb_array_length(state->'draft')=1,'submission stays queued and keeps draft until Gmail receipt');
  perform pg_temp.hld_check(not has_function_privilege('authenticated','public.hl_order_delivery_lookup_v1(uuid)','EXECUTE')
    and not has_function_privilege('authenticated','public.hl_order_delivery_record_v1(uuid,uuid,text,jsonb)','EXECUTE'),'authenticated cannot call delivery authority RPCs');
  perform pg_temp.hld_check(not has_table_privilege('authenticated','public.ph_hl_order_previews','SELECT')
    and not has_schema_privilege('authenticated','hl_order_private','USAGE'),'client cannot read raw reports or private order tables');
end $test$;

-- Actual SQL roles, not merely claims or has_*_privilege introspection.
select pg_temp.hld_identity('manager');
set local role authenticated;
select pg_temp.hld_check((select count(*)=0 from public.ph_request_delivery_outbox where event_type like 'hl_order_%'),'manager raw outbox SELECT sees no HL events');
select pg_temp.hld_check((select count(*)=1 from public.ph_request_delivery_outbox where event_id='98000000-0000-0000-0000-000000000005'),'manager retains ordinary request metadata access');
select pg_temp.hld_check((select count(*)=0 from public.get_request_delivery_recovery_queue() where event_type like 'hl_order_%'),'manager definer recovery queue excludes HL');
select pg_temp.hld_check((select count(*)=1 from public.get_request_delivery_recovery_queue() where event_id='98000000-0000-0000-0000-000000000005'),'manager recovery queue retains ordinary failed request');
select pg_temp.hld_reject('select public.hl_order_state()','HL_ORDER_FORBIDDEN');
select pg_temp.hld_reject('select public.requeue_request_delivery(event_id) from hl_delivery_context','DELIVERY_EVENT_NOT_RECOVERABLE');
select pg_temp.hld_check(public.requeue_request_delivery('98000000-0000-0000-0000-000000000005')->>'status'='pending','ordinary request recovery remains usable');
reset role;
update public.ph_request_delivery_outbox set status='failed' where event_id='98000000-0000-0000-0000-000000000005';

select pg_temp.hld_identity();
set local role authenticated;
select pg_temp.hld_check((select count(*)=1 from public.ph_request_delivery_outbox where event_type='hl_order_submission'),'native active Dylan can read HL delivery metadata');
select pg_temp.hld_reject('select public.requeue_request_delivery(event_id) from hl_delivery_context','DELIVERY_EVENT_NOT_RECOVERABLE');
do $$ begin
  begin perform id from public.ph_hl_order_previews; raise exception 'Expected preview SELECT denial';
  exception when insufficient_privilege then perform pg_temp.hld_check(true,'Dylan cannot bypass protected preview rendering with direct SELECT'); end;
  begin perform public.hl_order_delivery_lookup_v1(event_id) from hl_delivery_context; raise exception 'Expected service-only denial';
  exception when insufficient_privilege then perform pg_temp.hld_check(true,'Dylan cannot execute service-only delivery lookup'); end;
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{session_id}','"98000000-0000-0000-0000-000000000099"')::text,true);
set local role authenticated;
select pg_temp.hld_check((select count(*)=0 from public.ph_request_delivery_outbox where event_type like 'hl_order_%'),'Dylan with revoked native session sees no HL outbox rows');
select pg_temp.hld_reject('select public.hl_order_state()','HL_ORDER_FORBIDDEN');
reset role;
select pg_temp.hld_identity();
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{iss}','"https://untrusted.invalid/auth/v1"')::text,true);
select pg_temp.hld_reject('select public.hl_order_state()','HL_ORDER_FORBIDDEN');
select pg_temp.hld_identity();
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{exp}','1')::text,true);
select pg_temp.hld_reject('select public.hl_order_state()','HL_ORDER_FORBIDDEN');
select pg_temp.hld_identity();
update public.profiles set must_change_password=true where username='dylan_collyge';
select pg_temp.hld_reject('select public.hl_order_state()','HL_ORDER_FORBIDDEN');
update public.profiles set must_change_password=false where username='dylan_collyge';
set local role anon;
do $$ begin
  begin perform event_id from public.ph_request_delivery_outbox; raise exception 'Expected anonymous denial';
  exception when insufficient_privilege then perform pg_temp.hld_check(true,'anonymous role cannot read outbox metadata'); end;
end $$;
reset role;

select pg_temp.hld_identity('service');
do $test$
declare ctx hl_delivery_context; lookup jsonb; result jsonb; claimed public.ph_request_delivery_outbox; saved_event_key text; history_count bigint; cancellation jsonb;
begin
  select * into ctx from hl_delivery_context;
  lookup:=public.hl_order_delivery_lookup_v1(ctx.event_id); saved_event_key:=lookup->>'event_key';
  perform pg_temp.hld_check(lookup->'recipients'='["dylan_collyge@greenleafnursery.com"]'::jsonb
    and lookup->'report'=(select report from public.ph_hl_order_previews where id=ctx.preview_id),'service lookup freezes report and singleton existing Dylan recipient');
  select * into claimed from public.claim_request_delivery_events(1,'hl-synthetic-fixture');
  perform pg_temp.hld_check(claimed.event_id=ctx.event_id and claimed.lease_token is not null,'real shared worker claim grants HL event a live lease');
  perform pg_temp.hld_reject(format('select public.hl_order_delivery_record_v1(%L,%L,''sending'',''{}'')',ctx.event_id,gen_random_uuid()),'HL_ORDER_DELIVERY_LEASE_LOST');
  perform pg_temp.hld_identity();
  perform pg_temp.hld_reject(format('select pg_temp.hld_command(''reconcile_delivery'',%L::jsonb)',jsonb_build_object('event_id',ctx.event_id)),'HL_ORDER_DELIVERY_BUSY');
  perform pg_temp.hld_identity('service');
  result:=public.hl_order_delivery_record_v1(ctx.event_id,claimed.lease_token,'sending','{"message_id_header":"<hl-fixture@invalid>"}');
  perform pg_temp.hld_check(result->'allow_send'='true'::jsonb,'first durable intent authorizes exactly one send');
  result:=public.hl_order_delivery_record_v1(ctx.event_id,claimed.lease_token,'sending','{}');
  perform pg_temp.hld_check(result->'allow_send'='false'::jsonb and result->'reconciliation_only'='true'::jsonb,'duplicate sending intent is reconcile-only');
  perform pg_temp.hld_reject(format('select public.hl_order_delivery_record_v1(%L,%L,''failed'',''{"safe_to_retry":true}'')',ctx.event_id,claimed.lease_token),'HL_ORDER_DELIVERY_UNKNOWN');
  perform public.record_request_delivery_channel_result(ctx.event_id,claimed.lease_token,'{"email":{"status":"failed","safe_to_retry":true}}');
  perform pg_temp.hld_check((select channel_results->'email'->>'status'='sending' and channel_results->'email'->'safe_to_retry'='false'::jsonb
    from public.ph_request_delivery_outbox where event_id=ctx.event_id),'generic channel update cannot make an existing send intent retryable');
  update public.ph_request_delivery_outbox set status='failed' where event_id=ctx.event_id;
  perform pg_temp.hld_check((select status='delivery_unknown' from hl_order_private.orders where id=ctx.order_id),'worker failure after sending intent is explicitly unknown in business state');
  update public.ph_request_delivery_outbox set status='processing' where event_id=ctx.event_id;
  perform public.hl_order_delivery_record_v1(ctx.event_id,claimed.lease_token,'unknown','{"code":"GMAIL_ACK_LOST"}');
  perform pg_temp.hld_check((select status='delivery_unknown' from hl_order_private.orders where id=ctx.order_id)
    and (select count(*)=1 from hl_order_private.drafts),'uncertain Gmail outcome retains draft and explicitly marks order unknown');
  perform pg_temp.hld_reject(format('select public.hl_order_delivery_record_v1(%L,%L,''failed'',''{"safe_to_retry":true}'')',ctx.event_id,claimed.lease_token),'HL_ORDER_DELIVERY_UNKNOWN');
  result:=public.hl_order_delivery_record_v1(ctx.event_id,claimed.lease_token,'sending','{}');
  perform pg_temp.hld_check(result->'allow_send'='false'::jsonb,'unknown outcome prohibits blind resend');
  -- Simulate worker stopping after ambiguous network delivery; it must keep the intent.
  update public.ph_request_delivery_outbox set status='failed',attempt_count=8,lease_token=null,lease_expires_at=null where event_id=ctx.event_id;
  perform pg_temp.hld_identity();
  perform pg_temp.hld_command('reconcile_delivery',jsonb_build_object('event_id',ctx.event_id));
  perform pg_temp.hld_check((select o.event_key=saved_event_key and o.attempt_count=0 and o.channel_results->'email'->>'status'='unknown'
    from public.ph_request_delivery_outbox o where o.event_id=ctx.event_id),'explicit reconciliation reuses original event and preserves unknown intent');
  perform pg_temp.hld_identity('service');
  select * into claimed from public.claim_request_delivery_events(1,'hl-synthetic-fixture');
  lookup:=public.hl_order_delivery_lookup_v1(ctx.event_id);
  perform pg_temp.hld_check(lookup->'reconciliation_only'='true'::jsonb and lookup->>'event_key'=saved_event_key,'reclaimed unknown event is still reconcile-only with stable identity');
  perform pg_temp.hld_reject(format('select public.hl_order_delivery_record_v1(%L,%L,''sent'',''{}'')',ctx.event_id,claimed.lease_token),'HL_ORDER_DELIVERY_RECEIPT_REQUIRED');
  perform public.hl_order_delivery_record_v1(ctx.event_id,claimed.lease_token,'sent','{"gmail_message_id":"hl-synthetic-gmail","thread_id":"hl-synthetic-thread","message_id_header":"<hl-fixture@invalid>"}');
  perform pg_temp.hld_check((select status='sent' and delivery_receipt->>'gmail_message_id'='hl-synthetic-gmail' from hl_order_private.orders where id=ctx.order_id)
    and not exists(select 1 from hl_order_private.drafts),'confirmed Sent-mail reconciliation persists receipt and clears draft');
  perform pg_temp.hld_check((select status='handled' from hl_order_private.dispositions where source_id='HL-DELIVERY-SOC'),'only confirmed delivery handles source');
  select count(*) into history_count from hl_order_private.history where action='delivery_sent';
  result:=public.hl_order_delivery_record_v1(ctx.event_id,claimed.lease_token,'unknown','{"code":"WORKER_ACK_LOST"}');
  perform pg_temp.hld_check(result->>'status'='sent' and result->'allow_send'='false'::jsonb,'worker acknowledgement loss cannot downgrade durable sent receipt');
  perform public.record_request_delivery_channel_result(ctx.event_id,claimed.lease_token,'{"email":{"mode":"worker_ack"}}');
  perform pg_temp.hld_check((select channel_results->'email'->>'status'='sent' and gmail_message_id='hl-synthetic-gmail' from public.ph_request_delivery_outbox where event_id=ctx.event_id),'generic channel acknowledgement cannot erase HL proof');
  perform public.complete_request_delivery_event(ctx.event_id,claimed.lease_token,'{}');
  perform pg_temp.hld_check((select count(*)=history_count from hl_order_private.history where action='delivery_sent'),'later completion never duplicates business delivery transition');
  perform pg_temp.hld_reject(format('update public.ph_request_delivery_outbox set payload=''{}'' where event_id=%L',ctx.event_id),'HL_ORDER_HISTORY_IMMUTABLE');
  -- Cancellation uses the same durable protocol and does not reopen quantities early.
  perform pg_temp.hld_identity();
  cancellation:=pg_temp.hld_command('cancellation_preview',jsonb_build_object('order_id',ctx.order_id,'reason','Synthetic cancellation','lines',jsonb_build_array(jsonb_build_object('line_id',ctx.line_id,'quantity',4))))->'preview';
  perform pg_temp.hld_command('cancellation_submit',jsonb_build_object('preview_id',cancellation->>'id'));
  select event_id into ctx.cancellation_event_id from hl_order_private.cancellations where id=(cancellation->'report'->>'cancellation_id')::uuid;
  update hl_delivery_context set cancellation_event_id=ctx.cancellation_event_id;
  perform pg_temp.hld_identity('service');
  lookup:=public.hl_order_delivery_lookup_v1(ctx.cancellation_event_id);
  perform pg_temp.hld_check(lookup->>'event_type'='hl_order_cancellation' and lookup->'report'->>'original_order_number'=cancellation->'report'->>'original_order_number','cancellation lookup preserves original order identity and frozen report');
  select * into claimed from public.claim_request_delivery_events(1,'hl-synthetic-fixture');
  perform pg_temp.hld_reject(format('select public.hl_order_delivery_record_v1(%L,%L,''failed'',''{}'')',claimed.event_id,claimed.lease_token),'HL_ORDER_DELIVERY_UNKNOWN');
  perform public.hl_order_delivery_record_v1(claimed.event_id,claimed.lease_token,'failed','{"safe_to_retry":true,"code":"PDF_PRE_SEND_FAILED"}');
  perform pg_temp.hld_check((select cancelled_quantity=0 from hl_order_private.order_lines where id=ctx.line_id),'known pre-send cancellation failure does not cancel plants');
  result:=public.hl_order_delivery_record_v1(claimed.event_id,claimed.lease_token,'sending','{}');
  perform pg_temp.hld_check(result->'allow_send'='true'::jsonb,'explicitly known pre-send failure permits a later send');
  perform public.hl_order_delivery_record_v1(claimed.event_id,claimed.lease_token,'sent','{"gmail_message_id":"hl-synthetic-cancellation"}');
  perform public.complete_request_delivery_event(claimed.event_id,claimed.lease_token,'{}');
  perform pg_temp.hld_check((select cancelled_quantity=4 from hl_order_private.order_lines where id=ctx.line_id)
    and (select available_quantity=4 and status='needs_review' from hl_order_private.dispositions where source_id='HL-DELIVERY-SOC'),'confirmed cancellation applies exact quantity once and reopens review');
end $test$;

-- Both HL event kinds are private, including failed/recoverable ones.
update public.ph_request_delivery_outbox set status='failed' where event_type in ('hl_order_submission','hl_order_cancellation');
select pg_temp.hld_identity('manager');
set local role authenticated;
select pg_temp.hld_check((select count(*)=0 from public.ph_request_delivery_outbox where event_type like 'hl_order_%'),'manager cannot see submission or cancellation metadata');
select pg_temp.hld_check((select count(*)=0 from public.get_request_delivery_recovery_queue() where event_type like 'hl_order_%'),'definer recovery hides failed submission and cancellation');
select pg_temp.hld_reject('select public.requeue_request_delivery(cancellation_event_id) from hl_delivery_context','DELIVERY_EVENT_NOT_RECOVERABLE');
reset role;
select '1..'||count(*)::text as tap from hl_delivery_checks;
select 'ok '||id::text||' - '||description as tap from hl_delivery_checks order by id;
rollback;
