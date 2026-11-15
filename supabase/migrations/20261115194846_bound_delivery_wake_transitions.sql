begin;
set local statement_timeout = '15s';
set local lock_timeout = '1500ms';

-- Statement triggers also run after an INSERT that inserted zero rows.
-- Only genuinely inserted, due work warrants an immediate worker invocation.
create or replace function private.wake_request_delivery_worker_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $wake$
begin
  if exists(select 1 from inserted_delivery_events
    where status='pending' and next_attempt_at<=now()) then
    perform private.wake_request_delivery_worker_now('outbox_insert');
  end if;
  return null;
end;
$wake$;

drop trigger ph_request_delivery_outbox_wake on public.ph_request_delivery_outbox;
create trigger ph_request_delivery_outbox_wake
after insert on public.ph_request_delivery_outbox
referencing new table as inserted_delivery_events
for each statement execute function private.wake_request_delivery_worker_after_insert();

-- A status read/reconciliation may write the same due pending values again.
-- Keep real retries immediately wakeable without feeding that no-op back.
create or replace function private.wake_request_delivery_worker_after_requeue()
returns trigger language plpgsql security definer set search_path = '' as $wake$
begin
  if new.status='pending' and new.next_attempt_at<=now()
    and (old.status is distinct from new.status
      or old.next_attempt_at is distinct from new.next_attempt_at)
    and not (old.status='suppressed'
      and old.sanitized_error_code is not distinct from 'FOLDER_COMPLETION_STALE'
      and new.sanitized_error_code is not distinct from 'FOLDER_COMPLETION_STALE') then
    perform private.wake_request_delivery_worker_now('manual_requeue');
  end if;
  return null;
end;
$wake$;
revoke all on function private.wake_request_delivery_worker_after_insert() from public,anon,authenticated;
revoke all on function private.wake_request_delivery_worker_after_requeue() from public,anon,authenticated;
commit;
