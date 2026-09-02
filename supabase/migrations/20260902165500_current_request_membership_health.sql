begin;

-- A delivered completion is immutable historical evidence. If options were added
-- by the retired client after that delivery, compare only the latest completion
-- for a folder that is currently fully complete. An incomplete reopened folder
-- is not a present-tense completion-integrity failure; its next atomic completion
-- will create a new event for the current membership version.
create or replace function public.get_eval_request_delivery_health_snapshot_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_manager_emails text[] := private.eval_work_required_manager_emails_v2();
  creation_order_violations bigint := 0;
  membership_mismatches bigint := 0;
  missing_completion_events bigint := 0;
  eval_origin_mismatches bigint := 0;
  eval_recipient_violations bigint := 0;
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

  return jsonb_build_object(
    'contract_version', 'eval-request-delivery-health-v2',
    'required_manager_recipient_count', cardinality(required_manager_emails),
    'creation_order_violation_count', creation_order_violations,
    'completion_membership_mismatch_count', membership_mismatches,
    'missing_completion_event_count', missing_completion_events,
    'eval_origin_scope_mismatch_count', eval_origin_mismatches,
    'eval_required_recipient_violation_count', eval_recipient_violations
  );
end
$function$;

revoke all on function public.get_eval_request_delivery_health_snapshot_v2()
  from public, anon, authenticated;
grant execute on function public.get_eval_request_delivery_health_snapshot_v2()
  to service_role;

comment on function public.get_eval_request_delivery_health_snapshot_v2() is
  'Service-only delivery health for current Request membership; immutable historical completion events remain preserved.';

notify pgrst, 'reload schema';

commit;
