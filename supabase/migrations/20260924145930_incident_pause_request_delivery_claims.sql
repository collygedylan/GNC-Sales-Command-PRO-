-- Emergency incident pause of the shared Edge-worker claim entry point.
-- Prevents direct health-check invocations from bypassing the wake/cron pause.
-- No requests, shipments, queued events, receipts, or photos are changed.
-- Restore only after incident review and user-approved delivery resumption.
set local lock_timeout='3s';
set local statement_timeout='8s';
revoke execute on function public.claim_request_delivery_events(integer,text) from service_role;
do $$ begin
  if has_function_privilege('service_role','public.claim_request_delivery_events(integer,text)','EXECUTE') then
    raise exception 'INCIDENT_DELIVERY_CLAIM_PAUSE_FAILED';
  end if;
end $$;
