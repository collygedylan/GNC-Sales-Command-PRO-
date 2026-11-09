-- Synthetic retained Gmail receipts for the disposable delivery-order replay.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_DELIVERY_RECEIPT_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

with rows(n,event_id,dependency_key) as (values
  (1,'7f0335e7-e798-49ed-8b6f-53b0364213f1'::uuid,'request-created:aa7fe2ee-4ae1-4975-bd5c-9c93262acdbb'),
  (2,'b64c2bc5-d01a-4c6f-b344-767b33dcc0a0'::uuid,'request-created:c20a6c65-9bb4-4748-b2b1-2421ae423dde')
)
insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,request_folder,payload,status,delivered_at,channel_results)
select event_id,'ci:request-delivery-order:'||n,'request_completed','ci-request-delivery-order-'||n,
  jsonb_build_object('contractVersion','request-folder-completion-v2','dependencyEventKeys',jsonb_build_array(dependency_key)),
  'delivered','2026-11-02T12:00:00Z',jsonb_build_object('email',jsonb_build_object(
    'thread_id','ci-thread-'||n,'reply_to_message_id','ci-message-'||n,'mode','gmail_api_threaded')) from rows;

insert into public.ph_request_email_threads(request_folder,initial_email_sent_at,initial_thread_id,initial_message_id,metadata)
select request_folder,'2026-11-02T11:00:00Z',channel_results#>>'{email,thread_id}',
  channel_results#>>'{email,reply_to_message_id}',jsonb_build_object('delivery_event_id',event_id)
from public.ph_request_delivery_outbox where event_key in ('ci:request-delivery-order:1','ci:request-delivery-order:2');
