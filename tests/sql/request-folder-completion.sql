create trigger enqueue_completed_request_email_trg after update or delete on public.ph_requests_pending
for each row execute function private.enqueue_completed_request_email_trg();
create trigger enqueue_completed_request_email_trg after insert or update on public.ph_requests_completed_history
for each row execute function private.enqueue_completed_request_email_trg();
create trigger route_legacy_request_completion_v2 before insert on public.ph_request_delivery_outbox
for each row execute function private.route_legacy_request_completion_v2();
select set_config('request.jwt.claim.role','service_role',false);
insert into public.ph_requests_pending(unique_id,request_folder,req_status,itemcode,locationcode,lotcode,req_spec,req_photo_link)
select 'REQ-'||n,'three','Pending','000808.050.1','I.11.000','27.S1','spec-'||n,'https://fixture/'||n||'.jpg'
from generate_series(1,3) n;
insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status)
values('created-three','request_created','three','{"request_ids":["REQ-1","REQ-2","REQ-3"]}','delivered');
update public.ph_requests_pending set req_status='Complete',date_completed=now()::text where unique_id='REQ-1';
do $$begin
  assert (select count(*)=0 from public.ph_request_delivery_outbox where event_type='request_completed'),'partial email after 1 of 3';
end$$;
update public.ph_requests_pending set req_status='Complete',date_completed=now()::text where unique_id='REQ-2';
do $$begin
  assert (select count(*)=0 from public.ph_request_delivery_outbox where event_type='request_completed'),'partial email after 2 of 3';
end$$;
update public.ph_requests_pending set req_status='Complete',date_completed=now()::text where unique_id='REQ-3';
select private.enqueue_completed_request_email_v316('REQ-3');
delete from public.ph_requests_pending where unique_id in ('REQ-1','REQ-2','REQ-3');
do $$declare e uuid; receipt jsonb; begin
  assert (select count(*)=1 from public.ph_request_delivery_outbox where event_type='request_completed' and status='pending'),'completion must be idempotent';
  select event_id into e from public.ph_request_delivery_outbox where event_type='request_completed' and status='pending';
  receipt:=public.request_completion_dispatch_rows_v3065(e);
  assert receipt->>'ready'='true' and jsonb_array_length(receipt->'rows')=3,'worker must receive all three';
  assert receipt->'rows'->0->>'req_photo_link'='https://fixture/1.jpg','working photo preview retained';
  assert receipt->'rows'->2->>'req_spec'='spec-3','all specs retained';
end$$;
insert into public.ph_requests_pending(unique_id,request_folder,req_status) values('REQ-LATE','three','Pending');
do $$declare e uuid; begin
  select event_id into e from public.ph_request_delivery_outbox where event_type='request_completed' and status='pending';
  assert public.request_completion_dispatch_rows_v3065(e)->>'ready'='false','dispatch must reject changed membership';
end$$;
select set_config('request.jwt.claim.role','authenticated',false);
do $$begin
  begin
    perform public.request_completion_dispatch_rows_v3065(null);
    raise exception 'authenticated worker access accepted';
  exception when insufficient_privilege then null; end;
end$$;
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,photo_link)
values('f1','000808.050.1','I.11.000','27.F1','https://fixture/f1.jpg'),
 ('s1','000808.050.1','I.11.000','27.S1','');
insert into public.ph_location_sales_notes(unique_id,itemcode,locationcode,lotcode,photo_link)
values('loose','000808.050.1','I.11.000','','https://fixture/loose.jpg'),
 ('other-s1','000808.050.1','I.11.000','27.S1','https://fixture/other.jpg');
do $$declare links text; begin
  links:=private.collect_item_detail_photo_links_v308('000808.050.1','I.11.000','27.S1','[{"unique_id":"s1"}]');
  assert links='','S1 must not inherit F1, blank-lot, or other UID photos';
  links:=private.collect_item_detail_photo_links_v308('000808.050.1','I.11.000','27.F1','[{"unique_id":"f1"}]');
  assert links='https://fixture/f1.jpg','exact photo must survive';
  links:=private.collect_item_detail_photo_links_v308(null,null,null,'[{"itemcode":"x","lotcode":"27.S1","photo_link":"https://fixture/explicit.jpg"}]');
  assert links='https://fixture/explicit.jpg','explicit transport evidence must survive null lookup identity';
end$$;
