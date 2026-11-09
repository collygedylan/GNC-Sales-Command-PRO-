-- Remove only fixtures after the historical queue and ledger guards have run.
begin;
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or not exists(select 1 from public.ph_request_delivery_outbox where event_key='ci:request-replay')
     or (select count(*) from public.ph_location_moves_history where request_folder='ci-request-replay-classification')<>4
     or (select count(*) from public.ph_eval_work_history where request_folder='ci-request-replay-classification')<>7 then
    raise exception 'CANONICAL_REQUEST_REPLAY_CLEANUP_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

set local agdata.archive_dedup='on';
delete from public.ph_requests_pending pending using public.ph_request_delivery_outbox event,
  lateral jsonb_array_elements(event.payload->'requests') payload(row)
where event.event_key='ci:request-replay' and pending.request_folder='ci-request-replay'
  and pending.unique_id=payload.row->>'unique_id';
delete from public.ph_requests_pending
where request_folder='ci-request-replay-identity' and unique_id ~ '^REQ-ci-identity-[1-3]$';
delete from public.ph_requests_completed_history
where request_folder='ci-request-replay-history' and unique_id ~ '^ci-request-history-[0-9]+$';
delete from public.ph_requests_completed_history
where request_folder='Digger Odell Nursery - Digger Odell Nursery - 10/26/26'
  and unique_id='REQ-mvp9cdc5mc3uk7hltrd';
delete from public.ph_master_inventory where unique_id='ci-blue-shadow-master' and itemcode='002194.030.1';
delete from public.ph_location_moves_history
where request_folder='ci-request-replay-classification' and unique_id ~ '^move_req_ci_[1-4]$';
delete from public.ph_eval_work_history
where request_folder='ci-request-replay-classification' and unique_id ~ '^EVAL-ci-[1-7]$';
delete from public.ph_request_delivery_outbox
where (status='delivered' and event_key in ('ci:request-replay','ci:request-receipt-membership'))
  or (status='suppressed' and event_key='ci:request-receipt')
  or (request_folder='Digger Odell Nursery - Digger Odell Nursery - 10/26/26' and event_type='request_completed'
    and payload->>'contractVersion'='request-folder-completion-v2')
  or (status in ('delivered','suppressed') and request_folder='ci-request-replay-history'
    and event_key ~ '^ci:request-history:(created|completed):[0-9]+$');
delete from public.ph_customer_consignee_sales_reps where unique_id='ci-request-replay-mapping';
commit;
