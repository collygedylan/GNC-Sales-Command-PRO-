-- Prove the migration restored every synthetic pending row and corrected the quantity.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or (select count(*) from public.ph_request_delivery_outbox event
           cross join lateral jsonb_array_elements(event.payload->'requests') payload(row)
           join public.ph_active_request active on active.unique_id=payload.row->>'unique_id'
             and active.itemcode=payload.row->>'itemcode' and active.locationcode=payload.row->>'locationcode'
           where event.event_key='ci:request-replay' and active.request_folder='ci-request-replay'
             and active.req_status='Pending' and not active.req_archived and active.date_completed is null
             and active.req_qty=case active.itemcode when '008280.150.1' then '4' else payload.row->>'req_qty' end)<>7 then
    raise exception 'CANONICAL_REQUEST_REPLAY_RESTORATION_FAILED';
  end if;
end;
$fixture$;
