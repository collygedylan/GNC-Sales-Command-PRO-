-- The initial Eval backfill is represented by one summary alert. Preserve any
-- accidentally queued per-ItemCode rows for audit, but never deliver them.
alter table public.ph_request_delivery_outbox
  drop constraint if exists ph_request_delivery_outbox_status_check;

alter table public.ph_request_delivery_outbox
  add constraint ph_request_delivery_outbox_status_check
  check (status in ('pending', 'processing', 'delivered', 'failed', 'unknown', 'suppressed'));

update public.ph_request_delivery_outbox
set status = 'suppressed',
    sanitized_error_code = 'INITIAL_EVAL_POPULATION_SUMMARY_ONLY',
    updated_at = now()
where event_type = 'eval_assignment_unassigned'
  and status = 'pending'
  and event_key like 'eval-unassigned:%';
