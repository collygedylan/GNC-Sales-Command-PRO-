begin;

set local lock_timeout = '15s';
set local statement_timeout = '120s';

alter role anon set statement_timeout = '60s';
alter role authenticated set statement_timeout = '60s';
alter role authenticator set statement_timeout = '60s';
alter role service_role set statement_timeout = '120s';

grant select, insert, update, delete on table public.ph_master_inventory to service_role;
grant select, insert, update, delete on table public.ph_cav_import to service_role;
grant select, insert, update, delete on table public.ph_drive_around_report_files to service_role;
grant select, insert, update, delete on table public.ph_drive_around_report_rows to service_role;
grant select, insert, update, delete on table public.ph_soc_master to service_role;
grant select, insert, update, delete on table public.ph_reserves to service_role;
grant select, insert, update, delete on table public.ph_warehouse_assigned_items to service_role;
grant select, insert, update, delete on table public.app_dataset_revisions to service_role;
grant select, insert, update, delete on table public.app_manual_sync_status to service_role;
grant select, insert, update, delete on table public.ph_orders_history to service_role;
grant select, insert, update, delete on table public.ph_reserves_history to service_role;
grant usage, select on all sequences in schema public to service_role;

grant all privileges on table public.ph_request_delivery_outbox to service_role;
grant all privileges on table public.ph_request_delivery_worker_state to service_role;
grant all privileges on table public.ph_request_email_threads to service_role;
grant all privileges on table public.ph_requests_pending to service_role;
grant all privileges on table public.ph_requests_completed_history to service_role;

grant execute on function public.claim_request_delivery_events(integer,text) to service_role;
grant execute on function public.complete_request_delivery_event(uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_request_delivery_event(uuid,uuid,text) to service_role;
grant execute on function public.heartbeat_request_delivery_worker(text,integer,integer,integer,boolean,text) to service_role;
grant execute on function public.record_request_delivery_channel_result(uuid,uuid,jsonb) to service_role;
grant execute on function public.requeue_request_delivery(uuid) to service_role;
grant execute on function public.get_request_delivery_recovery_queue() to service_role;

revoke insert, update, delete, truncate, references, trigger on table public.ph_master_inventory from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.ph_cav_import from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.ph_drive_around_report_files from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.ph_drive_around_report_rows from anon, authenticated;
revoke all privileges on table public.ph_request_delivery_outbox from public, anon, authenticated;
revoke all privileges on table public.ph_request_delivery_worker_state from public, anon, authenticated;
revoke all privileges on table public.ph_request_email_threads from public, anon, authenticated;
revoke all privileges on function public.claim_request_delivery_events(integer,text) from public, anon, authenticated;
revoke all privileges on function public.complete_request_delivery_event(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all privileges on function public.fail_request_delivery_event(uuid,uuid,text) from public, anon, authenticated;
revoke all privileges on function public.heartbeat_request_delivery_worker(text,integer,integer,integer,boolean,text) from public, anon, authenticated;
revoke all privileges on function public.record_request_delivery_channel_result(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all privileges on function public.requeue_request_delivery(uuid) from public, anon, authenticated;
revoke all privileges on function public.get_request_delivery_recovery_queue() from public, anon, authenticated;
revoke all privileges on table public.ph_app_users from public, anon, authenticated;
revoke all privileges on table public.user_access_control from public, anon, authenticated;

do $reclass_stale_quantity_guard$
declare
  definition text;
  repaired text;
begin
  definition := pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure
  );
  repaired := replace(
    definition,
    $mutable_guard$    or s.source_identity->>'ptronhand' is distinct from b.ptronhand::text
    or s.source_identity->>'ptravailable' is distinct from b.ptravailable::text$mutable_guard$,
    ''
  );
  if repaired = definition then
    raise exception 'RECLASS_STALE_QUANTITY_GUARD_NOT_FOUND';
  end if;
  execute repaired;
end
$reclass_stale_quantity_guard$;

do $completed_request_cleanup$
declare
  request_row record;
begin
  for request_row in
    select unique_id
    from public.ph_requests_pending
    where unique_id like 'REQ-%'
      and (
        date_completed is not null
        or lower(btrim(coalesce(req_status, ''))) in ('complete', 'completed')
      )
    for update
  loop
    perform private.persist_completed_request_history_v1(
      request_row.unique_id,
      'completed',
      'pending',
      false
    );
    delete from public.ph_requests_pending
    where unique_id = request_row.unique_id;
  end loop;
end
$completed_request_cleanup$;

create or replace view public.ph_active_request
with (security_invoker = true)
as
select pending.*
from public.ph_requests_pending pending
where pending.unique_id like 'REQ-%'
  and pending.date_completed is null
  and lower(btrim(coalesce(pending.req_status, 'Pending'))) in ('', 'pending', 'open');

create or replace view public.ph_active_request_live_rows
with (security_invoker = true)
as
select active.*
from public.ph_active_request active;

create or replace view public.ph_request_queue_live_rows
with (security_invoker = true)
as
select active.*
from public.ph_active_request active;

update public.ph_master_inventory
set av_note = public.sanitize_av_note_without_spec_caliper(av_note)
where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);

update public.ph_requests_pending
set av_note = public.sanitize_av_note_without_spec_caliper(av_note)
where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);

update public.ph_requests_completed_history
set av_note = public.sanitize_av_note_without_spec_caliper(av_note)
where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);

update public.ph_av_notes
set salesnote = public.sanitize_av_note_without_spec_caliper(salesnote)
where salesnote is distinct from public.sanitize_av_note_without_spec_caliper(salesnote);

update public.ph_request_delivery_outbox
set status = 'pending',
    attempt_count = 0,
    next_attempt_at = now(),
    last_attempt_at = null,
    sanitized_error_code = null,
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    updated_at = now()
where delivered_at is null
  and event_type <> 'delivery_canary'
  and created_at >= now() - interval '48 hours';

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values (
  'app_version',
  jsonb_build_object('app_version','2.3.71','release','AgData v2.3.71'),
  'release-v2.3.71',
  now()
)
on conflict(key) do update set
  value = excluded.value,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

do $v2371_contract$
declare
  definition text;
begin
  definition := pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure
  );
  if definition like '%source_identity->>''ptronhand'' is distinct from%'
     or definition like '%source_identity->>''ptravailable'' is distinct from%' then
    raise exception 'RECLASS_MUTABLE_QUANTITY_GUARD_REMAINS';
  end if;
  if not has_table_privilege('service_role','public.ph_master_inventory','INSERT,UPDATE,DELETE')
     or not has_table_privilege('service_role','public.ph_request_delivery_outbox','INSERT,UPDATE,DELETE')
     or not has_function_privilege('service_role','public.claim_request_delivery_events(integer,text)','EXECUTE') then
    raise exception 'SERVICE_ROLE_IMPORT_OR_DELIVERY_CONTRACT_MISSING';
  end if;
  if has_table_privilege('anon','public.ph_master_inventory','INSERT,UPDATE,DELETE')
     or has_table_privilege('anon','public.ph_request_delivery_outbox','INSERT,UPDATE,DELETE')
     or has_function_privilege('anon','public.claim_request_delivery_events(integer,text)','EXECUTE') then
    raise exception 'ANON_OPERATIONAL_WRITE_EXPOSED';
  end if;
  if has_table_privilege('anon','public.ph_app_users','SELECT')
     or has_table_privilege('authenticated','public.user_access_control','SELECT') then
    raise exception 'IDENTITY_TABLE_EXPOSED';
  end if;
  if exists (
    select 1 from public.ph_active_request
    where date_completed is not null
       or lower(btrim(coalesce(req_status,''))) not in ('','pending','open')
  ) then
    raise exception 'ACTIVE_REQUEST_VIEW_INCLUDES_COMPLETED_ROWS';
  end if;
end
$v2371_contract$;

commit;
