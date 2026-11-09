-- Disposable inputs for the three exact historical identity corrections.
begin;

do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.ph_requests_pending where request_folder='ci-request-replay-identity') then
    raise exception 'CANONICAL_REQUEST_IDENTITY_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

-- Import the synthetic legacy rows through the same service-role policy as the outbox.
set local request.jwt.claims='{"role":"service_role"}';
select setval(pg_get_serial_sequence('public.ph_requests_pending','id'),coalesce(max(id),0)+1,false)
from public.ph_requests_pending;
insert into public.ph_requests_pending(unique_id,itemcode,locationcode,lotcode,request_folder,req_status,
  request_source,created_at,sales_rep,customer_name,effective_qty,is_default_qty,req_qty,
  requested_by,request_selected_rep_username,request_selected_rep_display)
values ('REQ-ci-identity-1','004103.010.1','C.15.000','27.S1','ci-request-replay-identity','Pending',
          'ci-replay','2026-10-23T12:00:00Z','CI Legacy Rep','CI Customer',1,false,'1',
          'dylan_collyge','troy_lee','Troy Lee'),
       ('REQ-ci-identity-2','004103.010.1','F.16.000','27.S1','ci-request-replay-identity','Pending',
          'ci-replay','2026-10-23T12:00:00Z','CI Legacy Rep','CI Customer',1,false,'1',
          'dylan_collyge','troy_lee','Troy Lee'),
       ('REQ-ci-identity-3','001777.030.1','D.22.000','27.F1','ci-request-replay-identity','Pending',
          'ci-replay','2026-10-23T12:00:00Z','CI Legacy Rep','CI Customer',1,false,'1',
          'nelly_aguilar','annette_hancock','Annette Hancock');

commit;
