begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
create or replace function private.queue_request_folder_v3065(folder_value text,request_ids text[],state_row private.ph_request_folder_delivery_state)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare dependency_keys text[];
declare creation_dependency_coverage boolean;
declare event_key_value text;
declare completion_event public.ph_request_delivery_outbox;
begin
  select coalesce(array_agg(o.event_key order by o.created_at, o.event_key), '{}'::text[])
    into dependency_keys
  from public.ph_request_delivery_outbox o
  where o.request_folder = folder_value
    and o.event_type in ('request_created', 'request_options_appended')
    and coalesce(o.payload->'request_ids', '[]'::jsonb) ?| request_ids;

  select coalesce(bool_and(exists (
    select 1 from public.ph_request_delivery_outbox membership
    where membership.request_folder = folder_value
      and membership.event_type in ('request_created', 'request_options_appended')
      and coalesce(membership.payload->'request_ids', '[]'::jsonb) ? active_request.request_id
  )), false) into creation_dependency_coverage
  from unnest(request_ids) as active_request(request_id);

  if not creation_dependency_coverage then
    return jsonb_build_object('queued', false, 'membershipVersion', state_row.membership_version,
      'activeCount', cardinality(request_ids), 'reason', 'waiting_for_request_membership_event');
  end if;

  event_key_value := 'request-folder-completed:' || md5(folder_value) || ':v' || state_row.membership_version::text;
  insert into public.ph_request_delivery_outbox(
    event_key, event_type, request_folder, payload, status, next_attempt_at)
  values (
    event_key_value, 'request_completed', folder_value,
    jsonb_build_object(
      'contractVersion', 'request-folder-completion-v2',
      'activeRequestIds', to_jsonb(request_ids), 'request_ids', to_jsonb(request_ids),
      'requests', (select coalesce(jsonb_agg(to_jsonb(h) order by h.unique_id),'[]'::jsonb)
        from public.ph_requests_completed_history h where h.unique_id=any(request_ids)),
      'itemsCount', cardinality(request_ids),
      'membershipVersion', state_row.membership_version,
      'membershipSignature', state_row.membership_signature,
      'dependencyEventKeys', to_jsonb(dependency_keys),
      'updatedCompletion', state_row.last_delivered_version > 0
    ), 'pending', now()
  ) on conflict (event_key) do update set
      payload = excluded.payload,
      status = case when public.ph_request_delivery_outbox.status = 'suppressed' then 'pending' else public.ph_request_delivery_outbox.status end,
      next_attempt_at = least(public.ph_request_delivery_outbox.next_attempt_at, now()),
      updated_at = now()
  returning * into completion_event;

  update private.ph_request_folder_delivery_state set completion_event_key = event_key_value, updated_at = now()
  where request_folder = folder_value;

  return jsonb_build_object('queued', true, 'eventId', completion_event.event_id,
    'membershipVersion', state_row.membership_version, 'activeCount', cardinality(request_ids));
end
$fn$;
commit;
