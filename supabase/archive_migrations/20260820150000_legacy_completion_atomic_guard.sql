-- Stale pre-outbox clients can remain open across a PWA deployment. Preserve
-- compatibility for their legacy requests while making completion atomic with
-- History and delivery state. Current RPC-created rows carry client_batch_id
-- and continue through save_request_work.
create or replace function private.capture_legacy_request_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_is_complete boolean;
  old_was_complete boolean := false;
begin
  new_is_complete := lower(coalesce(new.req_status, '')) in ('complete', 'completed')
    or nullif(btrim(coalesce(new.date_completed, '')), '') is not null;
  if not new_is_complete or new.client_batch_id is not null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_was_complete := lower(coalesce(old.req_status, '')) in ('complete', 'completed')
      or nullif(btrim(coalesce(old.date_completed, '')), '') is not null;
  end if;
  if old_was_complete then
    return new;
  end if;

  perform private.upsert_request_history(new.unique_id, 'completed', 'pending', false);
  insert into public.ph_request_delivery_outbox (
    event_key, event_type, request_id, request_folder, payload, status
  ) values (
    'request-completed:' || new.unique_id || ':' || new.row_version::text,
    'request_completed', new.unique_id, new.request_folder,
    jsonb_build_object('request_id', new.unique_id, 'row_version', new.row_version,
                       'legacy_atomic_guard', true),
    'pending'
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists ph_active_request_legacy_completion_insert on public.ph_active_request;
create trigger ph_active_request_legacy_completion_insert
after insert on public.ph_active_request
for each row execute function private.capture_legacy_request_completion();

drop trigger if exists ph_active_request_legacy_completion_update on public.ph_active_request;
create trigger ph_active_request_legacy_completion_update
after update of req_status, date_completed on public.ph_active_request
for each row execute function private.capture_legacy_request_completion();

revoke all on function private.capture_legacy_request_completion() from public, anon, authenticated;

-- Recover any legacy completions committed between the main backfill and this
-- guard. They stay manual-resend only and retain their existing photo objects.
do $$
declare
  missing record;
begin
  for missing in
    select r.unique_id, r.request_folder
    from public.ph_active_request r
    where (
        lower(coalesce(r.req_status, '')) in ('complete', 'completed')
        or nullif(btrim(coalesce(r.date_completed, '')), '') is not null
      )
      and not exists (
        select 1 from public.ph_request_history h where h.unique_id = r.unique_id
      )
  loop
    perform private.upsert_request_history(missing.unique_id, 'recovered', 'unknown', true);
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, request_id, request_folder, payload, status,
      sanitized_error_code
    ) values (
      'request-recovered:' || missing.unique_id,
      'request_completed', missing.unique_id, missing.request_folder,
      jsonb_build_object('request_id', missing.unique_id, 'recovered', true),
      'unknown', 'RECOVERED_WITHOUT_DELIVERY_RECORD'
    ) on conflict (event_key) do nothing;
  end loop;
end
$$;
