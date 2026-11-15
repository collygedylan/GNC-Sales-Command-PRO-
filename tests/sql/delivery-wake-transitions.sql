\set ON_ERROR_STOP on
create schema private;
create role anon;
create role authenticated;
create table public.ph_request_delivery_outbox (
  event_id integer primary key, status text, next_attempt_at timestamptz,
  sanitized_error_code text
);
create table public.wake_receipts(source text);
create function private.wake_request_delivery_worker_now(text) returns bigint
language sql as $$ insert into public.wake_receipts values ($1) returning 1::bigint $$;
create function private.wake_request_delivery_worker_after_insert() returns trigger
language plpgsql as $$begin return null; end$$;
create trigger ph_request_delivery_outbox_wake after insert on public.ph_request_delivery_outbox
for each statement execute function private.wake_request_delivery_worker_after_insert();
\i /migration.sql
create trigger ph_request_delivery_outbox_requeue_wake
after update of status,next_attempt_at on public.ph_request_delivery_outbox
for each row when(new.status='pending' and new.next_attempt_at<=now())
execute function private.wake_request_delivery_worker_after_requeue();
insert into public.ph_request_delivery_outbox values (1,'pending',now(),null);
insert into public.ph_request_delivery_outbox values (1,'pending',now(),null) on conflict do nothing;
insert into public.ph_request_delivery_outbox select 2,'pending',now(),null where false;
update public.ph_request_delivery_outbox set status=status,next_attempt_at=next_attempt_at;
do $$begin
  if (select count(*) from public.wake_receipts)<>1 then raise exception 'NOOP_WAKE_LOOP'; end if;
end$$;
update public.ph_request_delivery_outbox set status='processing';
update public.ph_request_delivery_outbox set status='pending';
insert into public.ph_request_delivery_outbox values (2,'pending',now()+interval '1 hour',null);
update public.ph_request_delivery_outbox set next_attempt_at=now() where event_id=2;
do $$begin
  if (select count(*) from public.wake_receipts)<>3 then raise exception 'REAL_WORK_NOT_WAKEABLE'; end if;
end$$;
update public.ph_request_delivery_outbox set status='suppressed',sanitized_error_code='FOLDER_COMPLETION_STALE' where event_id=1;
update public.ph_request_delivery_outbox set status='pending' where event_id=1;
do $$begin
  if (select count(*) from public.wake_receipts)<>3 then raise exception 'STALE_RECONCILE_LOOP'; end if;
end$$;
update public.ph_request_delivery_outbox set status='suppressed' where event_id=1;
update public.ph_request_delivery_outbox set status='pending',sanitized_error_code=null where event_id=1;
do $$begin
  if (select count(*) from public.wake_receipts)<>4 then raise exception 'MANUAL_RETRY_BLOCKED'; end if;
end$$;
select 'delivery wake transitions PASS' result;
