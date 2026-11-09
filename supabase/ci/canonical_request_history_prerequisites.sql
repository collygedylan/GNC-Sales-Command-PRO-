-- Exercise the historical ledger volume and totals using generated local Request history.
begin;

do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.ph_request_delivery_outbox where request_folder='ci-request-replay-history') then
    raise exception 'CANONICAL_REQUEST_HISTORY_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

create temp table ci_canonical_request_history on commit drop as
select n,case when n<=8982 then 'ci-request-history-'||n
  when n<=8986 then 'move_req_ci_'||(n-8982) else 'EVAL-ci-'||(n-8986) end unique_id,
  case when n<=8982 then 'ci-request-replay-history' else 'ci-request-replay-classification' end folder
from generate_series(1,8993) n;

insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,created_at,delivered_at)
select 'ci:request-history:completed:'||((n-1)/50),'request_completed','ci-request-replay-history',
  jsonb_build_object('request_ids',jsonb_agg(unique_id order by n)),
  'suppressed','2026-10-21T13:00:00Z',null
from ci_canonical_request_history group by (n-1)/50;

insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,created_at,delivered_at)
select 'ci:request-history:created:'||((n-1)/50),'request_created','ci-request-replay-history',
  jsonb_build_object('requests',jsonb_agg(jsonb_build_object(
    'unique_id',unique_id,'itemcode','CI-HISTORY-ITEM','commonname','CI History Plant',
    'contsize','#1','locationcode','CI.HISTORY','req_qty','25','list_price','50','req_status','Complete',
    'req_archived',true,'date_completed','2026-10-21T13:00:00Z','request_folder',folder
  ) order by n)), 'delivered','2026-10-21T12:00:00Z','2026-10-21T12:00:00Z'
from ci_canonical_request_history group by (n-1)/50;

commit;
