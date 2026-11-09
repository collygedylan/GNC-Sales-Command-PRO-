-- Exercise the acknowledgment migration's already-completed receipt path.
begin;
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.ph_requests_completed_history where unique_id='REQ-mvp9cdc5mc3uk7hltrd')
     or exists(select 1 from public.ph_master_inventory where itemcode='002194.030.1' and locationcode='E.11.000') then
    raise exception 'CANONICAL_REQUEST_RECEIPT_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

set local gnc.inventory_edit_actor='ci-replay';
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,ptronhand,ptravailable,
  spec,photo_link,photo_date,loc_match_qty,loc_match_pct,av_note)
values ('ci-blue-shadow-master','002194.030.1','E.11.000','27.F1','#3','44','44',
  '18-20" H','https://fixture.invalid/blue-shadow.jpg',clock_timestamp(),'31',70,'FULL TOPS');

insert into public.ph_requests_completed_history(unique_id,itemcode,locationcode,lotcode,request_folder,
  req_status,req_archived,req_spec,date_completed,loc_match_pct,loc_photo_match,av_note,
  effective_qty,sales_rep,customer_name,customer_consignee_label,is_default_qty)
values ('REQ-mvp9cdc5mc3uk7hltrd','002194.030.1','E.11.000','27.F1','Digger Odell Nursery - Digger Odell Nursery - 10/26/26',
  'Complete',true,'18-20" H',clock_timestamp(),70,31,'FULL TOPS',
  25,'CI Rep','CI Customer','CI Customer / N/A',true);

insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status)
values ('ci:request-receipt','request_completed','REQ-mvp9cdc5mc3uk7hltrd','Digger Odell Nursery - Digger Odell Nursery - 10/26/26',
  jsonb_build_object('request_ids',jsonb_build_array('REQ-mvp9cdc5mc3uk7hltrd')),'suppressed'),
  ('ci:request-receipt-membership','request_created','REQ-mvp9cdc5mc3uk7hltrd','Digger Odell Nursery - Digger Odell Nursery - 10/26/26',
  jsonb_build_object('request_ids',jsonb_build_array('REQ-mvp9cdc5mc3uk7hltrd')),'delivered');
commit;
