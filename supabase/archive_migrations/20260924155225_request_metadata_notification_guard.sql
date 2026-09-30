begin;
-- Incremental production correction; no backfill, replay, or sender resumption.
create or replace function private.reconcile_request_folder_from_request_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- request-metadata-notification-guard-v1: compare business semantics only.
  -- Metadata, photos, timestamps and row versions are not completion actions.
  if tg_op = 'UPDATE' then
    if row(
      old.unique_id, btrim(coalesce(old.request_folder,'')),
      not coalesce(old.req_archived,false)
        and lower(btrim(coalesce(old.req_status,'pending'))) not in ('archived','cancelled','canceled'),
      lower(btrim(coalesce(old.req_status,''))) in ('complete','completed','done')
        or nullif(btrim(coalesce(old.date_completed,'')),'') is not null
    ) is not distinct from row(
      new.unique_id, btrim(coalesce(new.request_folder,'')),
      not coalesce(new.req_archived,false)
        and lower(btrim(coalesce(new.req_status,'pending'))) not in ('archived','cancelled','canceled'),
      lower(btrim(coalesce(new.req_status,''))) in ('complete','completed','done')
        or nullif(btrim(coalesce(new.date_completed,'')),'') is not null
    ) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    perform private.reconcile_request_folder_completion_v2(old.request_folder);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.request_folder is distinct from new.request_folder then
    perform private.reconcile_request_folder_completion_v2(old.request_folder);
  end if;
  perform private.reconcile_request_folder_completion_v2(new.request_folder);
  return new;
end
$function$;
revoke all on function private.reconcile_request_folder_from_request_v2() from public, anon, authenticated;

-- Legacy clients must use the same completion semantics as folder delivery.
-- Otherwise a spelling cleanup of an old "done" row can bypass the row guard.
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
  new_is_complete := lower(btrim(coalesce(new.req_status, ''))) in ('complete', 'completed', 'done')
    or nullif(btrim(coalesce(new.date_completed, '')), '') is not null;
  if not new_is_complete or new.client_batch_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    old_was_complete := lower(btrim(coalesce(old.req_status, ''))) in ('complete', 'completed', 'done')
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
revoke all on function private.capture_legacy_request_completion() from public, anon, authenticated;
commit;
