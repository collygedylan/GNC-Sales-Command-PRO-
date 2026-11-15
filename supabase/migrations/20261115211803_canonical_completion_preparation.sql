begin;
set local statement_timeout='15s';
set local lock_timeout='1500ms';
CREATE OR REPLACE FUNCTION public.prepare_request_folder_completion_v2(p_event_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  event_row public.ph_request_delivery_outbox;
  state_row private.ph_request_folder_delivery_state;
  current_ids text[];
  current_signature text;
  all_complete boolean;
  dependencies_ready boolean;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_WORKER_FORBIDDEN';
  end if;
  select * into event_row from public.ph_request_delivery_outbox
  where event_id = p_event_id and lease_token = p_lease_token and status = 'processing' for update;
  if event_row.event_id is null or event_row.payload->>'contractVersion' <> 'request-folder-completion-v2' then
    raise exception using errcode = 'P0002', message = 'FOLDER_COMPLETION_EVENT_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('request-folder-v2:' || event_row.request_folder, 0));
  select coalesce(array_agg(m.unique_id order by m.unique_id), '{}'::text[]),
         coalesce(bool_and(m.completed), false)
    into current_ids, all_complete
  from private.request_folder_members_v3065(event_row.request_folder) m;
  current_signature := md5(coalesce(array_to_string(current_ids, chr(10)), 'empty'));
  select * into state_row from private.ph_request_folder_delivery_state
  where request_folder = event_row.request_folder;
  if state_row.request_folder is null or current_signature <> event_row.payload->>'membershipSignature'
     or current_ids <> array(select jsonb_array_elements_text(event_row.payload->'activeRequestIds'))
     or not all_complete then
    update public.ph_request_delivery_outbox set status = 'suppressed',
      sanitized_error_code = 'FOLDER_COMPLETION_STALE', lease_token = null,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where event_id = event_row.event_id;
    perform private.reconcile_request_folder_completion_v2(event_row.request_folder);
    return jsonb_build_object('ready', false, 'terminal', true, 'code', 'FOLDER_COMPLETION_STALE');
  end if;
  select not exists (
    select 1 from jsonb_array_elements_text(coalesce(event_row.payload->'dependencyEventKeys', '[]'::jsonb)) dep(event_key)
    left join public.ph_request_delivery_outbox created on created.event_key = dep.event_key
    where created.event_key is null or created.status <> 'delivered'
  ) into dependencies_ready;
  if not dependencies_ready then
    update public.ph_request_delivery_outbox set status = 'pending', next_attempt_at = now() + interval '10 seconds',
      sanitized_error_code = 'WAITING_FOR_REQUEST_CREATED', lease_token = null,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where event_id = event_row.event_id;
    return jsonb_build_object('ready', false, 'terminal', false, 'code', 'WAITING_FOR_REQUEST_CREATED');
  end if;
  return jsonb_build_object('ready', true, 'requestIds', to_jsonb(current_ids),
    'membershipVersion', state_row.membership_version,
    'updatedCompletion', coalesce((event_row.payload->>'updatedCompletion')::boolean, false));
end
$function$;
revoke all on function public.prepare_request_folder_completion_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_request_folder_completion_v2(uuid,uuid) to service_role;
commit;

