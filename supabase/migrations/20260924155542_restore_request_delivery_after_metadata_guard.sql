begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
-- Apply only after reviewing held events. This never retries or requeues any
-- delivered, unknown, failed, or suppressed historical event.
do $$ begin
  if position('request-metadata-notification-guard-v1' in
    pg_get_functiondef('private.reconcile_request_folder_from_request_v2()'::regprocedure))=0 then
    raise exception 'DELIVERY_RESTORE_REQUIRES_METADATA_GUARD';
  end if;
  if exists(select 1 from public.ph_request_delivery_outbox where status='processing') then
    raise exception 'DELIVERY_RESTORE_REQUIRES_NO_IN_FLIGHT_EVENTS';
  end if;
end $$;
grant execute on function public.claim_request_delivery_events(integer,text) to service_role;
alter table public.ph_request_delivery_outbox enable trigger ph_request_delivery_outbox_wake;
alter table public.ph_request_delivery_outbox enable trigger ph_request_delivery_outbox_requeue_wake;
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.alter_job(job_id:=jobid,active:=true)
    from cron.job where jobname='gnc-request-delivery-worker';
  end if;
end $$;
commit;
