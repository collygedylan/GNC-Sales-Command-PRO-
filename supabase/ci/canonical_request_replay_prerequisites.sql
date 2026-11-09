-- Local replay data only. Seed the durable source and let the migration reconstruct the queue.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.ph_request_delivery_outbox where event_key='ci:request-replay') then
    raise exception 'CANONICAL_REQUEST_REPLAY_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,customername,customerstatus,
  consigneeid,consigneename,consigneestatus,salesrepid,salesrepname)
values ('ci-request-replay-mapping','ci-request-customer','CI Customer','A',
  'ci-request-consignee','CI Consignee','A','ci-request-rep','CI Rep');

with rows(sequence,unique_id,itemcode,locationcode,quantity) as (values
  (1,'REQ-mvlgbfl7p8r8zxrj97j','009199.013.1','D.09.013','1'),
  (2,'REQ-mvlg4t85vlzf7053pv','009501.013.1','D.09.044','1'),
  (3,'REQ-mvlfib5eqwa3typzcqq','001711.030.1','D.26.000','1'),
  (4,'REQ-mvlfib5evawvlvvx09','001711.070.1','F.05.000','1'),
  (5,'REQ-mvlex5bay7ngnehzi7','001884.011.1','E.10.000','1'),
  (6,'REQ-mvlbp5hkkk58akaubms','003139.250.1','A.08.000','10'),
  (7,'REQ-mvk1xgv2ty9fttuqj2','008280.150.1','C.05.000','2')
)
insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,created_at,delivered_at)
select 'ci:request-replay','request_created','ci-request-replay',
  jsonb_build_object('requests',jsonb_agg(jsonb_build_object(
    'unique_id',unique_id,'itemcode',itemcode,'locationcode',locationcode,
    'request_folder','ci-request-replay','req_qty',quantity,'req_status','Pending','req_archived',false,
    'request_source','general','customeridentityid','ci-request-customer','customername','CI Customer',
    'consigneeidentityid','ci-request-consignee','consigneename','CI Consignee',
    'request_selected_salesrep_id','ci-request-rep','request_selected_rep_display','CI Rep'
  ) order by sequence)), 'delivered','2026-10-23T12:00:00Z','2026-10-23T12:00:00Z'
from rows;
