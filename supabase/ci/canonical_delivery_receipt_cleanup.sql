-- Release only synthetic proof after the migration has verified both receipts.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or (select count(*) from private.request_delivery_order_reconciliations_v23133 evidence
         join public.ph_request_delivery_outbox event on event.event_id=evidence.completion_event_id
         where event.event_key in ('ci:request-delivery-order:1','ci:request-delivery-order:2'))<>2 then
    raise exception 'CANONICAL_DELIVERY_RECEIPT_UNVERIFIED';
  end if;
end;
$fixture$;

delete from private.request_delivery_order_reconciliations_v23133 evidence using public.ph_request_delivery_outbox event
where event.event_id=evidence.completion_event_id and event.event_key in ('ci:request-delivery-order:1','ci:request-delivery-order:2');
delete from public.ph_request_email_threads where request_folder in ('ci-request-delivery-order-1','ci-request-delivery-order-2');
delete from public.ph_request_delivery_outbox where event_key in ('ci:request-delivery-order:1','ci:request-delivery-order:2');
