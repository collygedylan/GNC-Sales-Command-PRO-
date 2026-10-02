begin;

create or replace function private.request_folder_archive_only_completed_v1(p_request_folder text)
returns boolean
language sql
stable
set search_path = ''
as $function$
with folder_state as (
  select state.request_folder, state.active_request_ids
  from private.ph_request_folder_delivery_state state
  where state.request_folder = trim(coalesce(p_request_folder, ''))
), current_active as (
  select request.unique_id,
         lower(trim(coalesce(request.req_status, ''))) as req_status,
         private.try_timestamptz(request.date_completed) as completed_at
  from public.ph_active_request request
  where trim(coalesce(request.request_folder, '')) = trim(coalesce(p_request_folder, ''))
    and coalesce(request.req_archived, false) = false
    and lower(trim(coalesce(request.req_status, 'pending'))) not in ('archived','cancelled','canceled')
), current_ids as (
  select coalesce(array_agg(current_active.unique_id order by current_active.unique_id), '{}'::text[]) as ids
  from current_active
), removed_ids as (
  select folder_state.request_folder, removed.uid
  from folder_state
  cross join lateral unnest(folder_state.active_request_ids) as removed(uid)
  cross join current_ids
  where not (removed.uid = any(current_ids.ids))
), latest_archive_commands as (
  select removed_ids.uid, latest.operation, latest.result, latest.created_at
  from removed_ids
  left join lateral (
    select ledger.operation, ledger.result, ledger.created_at
    from private.ph_request_archive_command_ledger ledger
    where ledger.request_uid = removed_ids.uid
    order by ledger.created_at desc, ledger.idempotency_key desc
    limit 1
  ) latest on true
), validity as (
  select
    folder_state.request_folder is not null
    and cardinality(folder_state.active_request_ids) > 0
    and array_position(folder_state.active_request_ids, null) is null
    and cardinality(folder_state.active_request_ids) = (
      select count(distinct value)::integer
      from unnest(folder_state.active_request_ids) as ids(value)
    )
    and cardinality(current_ids.ids) > 0
    and cardinality(current_ids.ids) < cardinality(folder_state.active_request_ids)
    and current_ids.ids <@ folder_state.active_request_ids
    and not exists (
      select 1 from current_active
      where current_active.req_status not in ('complete','completed','done')
         or current_active.completed_at is null
    )
    and not exists (
      select 1 from current_active
      where current_active.completed_at > (
        select min(latest_archive_commands.created_at) from latest_archive_commands
      )
    )
    and not exists (
      select 1
      from unnest(folder_state.active_request_ids) as historical(uid)
      left join public.ph_active_request request
        on request.unique_id = historical.uid
       and trim(coalesce(request.request_folder, '')) = folder_state.request_folder
      where request.unique_id is null
    )
    and not exists (
      select 1 from public.ph_active_request request
      where trim(coalesce(request.request_folder, '')) = folder_state.request_folder
        and coalesce(request.req_archived, false) = false
        and lower(trim(coalesce(request.req_status, 'pending'))) not in ('archived','cancelled','canceled')
        and not (request.unique_id = any(folder_state.active_request_ids))
    )
    and not exists (
      select 1
      from latest_archive_commands command
      left join public.ph_active_request archived
        on archived.unique_id = command.uid
       and trim(coalesce(archived.request_folder, '')) = folder_state.request_folder
      where command.operation is distinct from 'archive'
         or command.result->>'state' is distinct from 'archived'
         or command.result->>'uid' is distinct from command.uid
         or command.result #>> '{row,unique_id}' is distinct from command.uid
         or command.result #>> '{row,request_folder}' is distinct from folder_state.request_folder
         or command.result #>> '{row,req_archived}' is distinct from 'true'
         or lower(trim(coalesce(command.result #>> '{row,req_status}', ''))) in ('complete','completed','done','closed')
         or nullif(trim(coalesce(command.result #>> '{row,date_completed}', '')), '') is not null
         or command.created_at is null
         or archived.unique_id is null
         or coalesce(archived.req_archived, false) is not true
    )
    as is_valid
  from folder_state
  cross join current_ids
)
select coalesce((select validity.is_valid from validity), false)
$function$;

revoke all on function private.request_folder_archive_only_completed_v1(text)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_eval_request_delivery_health_snapshot_v2() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  required_manager_emails text[] := private.eval_work_required_manager_emails_v2();
  creation_order_violations bigint := 0;
  membership_mismatches bigint := 0;
  missing_completion_events bigint := 0;
  eval_origin_mismatches bigint := 0;
  eval_recipient_violations bigint := 0;
  archive_only_completed_folders bigint := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'DELIVERY_HEALTH_FORBIDDEN';
  end if;

  select count(*) into creation_order_violations
  from public.ph_request_delivery_outbox completion
  where completion.event_type = 'request_completed'
    and completion.status = 'delivered'
    and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(completion.payload->'dependencyEventKeys', '[]'::jsonb)) dependency(event_key)
      left join public.ph_request_delivery_outbox created on created.event_key = dependency.event_key
      where created.event_id is null or created.status <> 'delivered'
         or created.delivered_at is null or completion.delivered_at is null
         or created.delivered_at > completion.delivered_at
    );

  with active as (
    select trim(r.request_folder) as request_folder,
           bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
             or nullif(trim(coalesce(r.date_completed, '')), '') is not null) as all_complete,
           max(private.try_timestamptz(r.date_completed)) as completed_at
    from public.ph_active_request r
    where trim(coalesce(r.request_folder, '')) <> ''
      and coalesce(r.req_archived, false) = false
      and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled')
    group by trim(r.request_folder)
  ), latest_completion as (
    select distinct on (completion.request_folder)
      completion.request_folder,
      completion.payload
    from public.ph_request_delivery_outbox completion
    where completion.event_type = 'request_completed'
      and completion.status <> 'suppressed'
      and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
    order by completion.request_folder, completion.created_at desc, completion.event_id desc
  )
  select count(*) into membership_mismatches
  from active
  join latest_completion completion on completion.request_folder = active.request_folder
  join private.ph_request_folder_delivery_state state on state.request_folder = active.request_folder
  where active.all_complete
    and not private.request_folder_archive_only_completed_v1(active.request_folder)
    and (coalesce((completion.payload->>'membershipVersion')::bigint, 0) <> state.membership_version
      or coalesce(completion.payload->>'membershipSignature', '') <> state.membership_signature
      or coalesce(jsonb_array_length(completion.payload->'activeRequestIds'), 0) <> cardinality(state.active_request_ids));

  with active as (
    select trim(r.request_folder) as request_folder,
           bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
             or nullif(trim(coalesce(r.date_completed, '')), '') is not null) as all_complete,
           max(private.try_timestamptz(r.date_completed)) as completed_at
    from public.ph_active_request r
    where trim(coalesce(r.request_folder, '')) <> ''
      and coalesce(r.req_archived, false) = false
      and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled')
    group by trim(r.request_folder)
  )
  select count(*) into missing_completion_events
  from active
  left join private.ph_request_folder_delivery_state state on state.request_folder = active.request_folder
  where active.all_complete and active.completed_at >= now() - interval '48 hours'
    and not private.request_folder_archive_only_completed_v1(active.request_folder)
    and not exists (
      select 1 from public.ph_request_delivery_outbox completion
      where completion.request_folder = active.request_folder
        and completion.event_type = 'request_completed'
        and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
        and completion.status <> 'suppressed'
        and (state.request_folder is null
          or coalesce((completion.payload->>'membershipVersion')::bigint, 0) = state.membership_version)
    );

  select count(*) into eval_origin_mismatches
  from public.ph_eval_work work
  where work.contract_version = 'eval-work-v2-multi-origin'
    and (work.origin_count <> (select count(*) from public.ph_eval_work_origin_rows origin where origin.eval_work_id = work.id)
      or exists (select 1 from public.ph_request_delivery_outbox delivery
        where delivery.request_id = work.id::text
          and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
          and delivery.payload->>'contractVersion' = 'eval-work-v2-multi-origin'
          and coalesce(jsonb_array_length(delivery.payload->'origins'), 0) <> work.origin_count));

  select count(*) into eval_recipient_violations
  from public.ph_request_delivery_outbox delivery
  where delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
    and delivery.payload->>'contractVersion' = 'eval-work-v2-multi-origin'
    and not (required_manager_emails <@ coalesce(array(
      select lower(trim(value))
      from jsonb_array_elements_text(case when delivery.event_type = 'eval_work_assignment'
        then coalesce(delivery.payload->'assignmentRecipients', '[]'::jsonb)
        else coalesce(delivery.payload->'completionRecipients', '[]'::jsonb) end) value
    ), '{}'::text[]));

  with active as (
    select trim(r.request_folder) as request_folder,
           bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
             or nullif(trim(coalesce(r.date_completed, '')), '') is not null) as all_complete
    from public.ph_active_request r
    where trim(coalesce(r.request_folder, '')) <> ''
      and coalesce(r.req_archived, false) = false
      and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled')
    group by trim(r.request_folder)
  )
  select count(*) into archive_only_completed_folders
  from active
  where active.all_complete
    and private.request_folder_archive_only_completed_v1(active.request_folder);

  return jsonb_build_object(
    'contract_version', 'eval-request-delivery-health-v2',
    'required_manager_recipient_count', cardinality(required_manager_emails),
    'creation_order_violation_count', creation_order_violations,
    'completion_membership_mismatch_count', membership_mismatches,
    'missing_completion_event_count', missing_completion_events,
    'eval_origin_scope_mismatch_count', eval_origin_mismatches,
    'eval_required_recipient_violation_count', eval_recipient_violations,
    'archive_only_completed_folder_count', archive_only_completed_folders
  );
end
$$;

revoke all on function public.get_eval_request_delivery_health_snapshot_v2()
  from public, anon, authenticated;
grant execute on function public.get_eval_request_delivery_health_snapshot_v2()
  to service_role;

comment on function private.request_folder_archive_only_completed_v1(text) is
  'Read-only narrow classification for complete active Request folders whose prior membership differs only because every removed row has an audited successful archive transition after completion.';

notify pgrst, 'reload schema';

commit;
