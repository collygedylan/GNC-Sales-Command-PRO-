-- Emergency containment: keep new notifications queued without waking the sender.
-- This changes no request, shipment, outbox payload, receipt, or delivery status.
-- Resume requires explicit incident review, re-enabling these two triggers,
-- and reactivating the gnc-request-delivery-worker cron job.
set local lock_timeout='3s';
set local statement_timeout='8s';
alter table public.ph_request_delivery_outbox disable trigger ph_request_delivery_outbox_wake;
alter table public.ph_request_delivery_outbox disable trigger ph_request_delivery_outbox_requeue_wake;
-- Some isolated stacks omit pg_cron; the two notification triggers still exist.
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.alter_job(job_id:=jobid, active:=false)
    from cron.job where jobname='gnc-request-delivery-worker';
  end if;
end $$;
