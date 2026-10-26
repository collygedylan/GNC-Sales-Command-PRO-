begin;

set local lock_timeout = '15s';
set local statement_timeout = '120s';

do $repair_folder_completion_reconcile$
declare
  definition text;
  repaired text;
begin
  definition:=pg_get_functiondef('private.reconcile_request_folder_completion_v2(text)'::regprocedure);
  repaired:=replace(definition,
$old$  select coalesce(array_agg(r.unique_id order by r.unique_id), '{}'::text[]),
         coalesce(bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
           or nullif(trim(coalesce(r.date_completed, '')), '') is not null), false)
    into request_ids, all_complete
  from public.ph_requests_pending r
  where trim(coalesce(r.request_folder, '')) = folder_value
    and coalesce(r.req_archived, false) = false
    and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled');$old$,
$new$  with folder_membership as (
    select pending.unique_id,
      lower(trim(coalesce(pending.req_status, ''))) in ('complete','completed','done')
        or nullif(trim(coalesce(pending.date_completed, '')), '') is not null as completed
    from public.ph_requests_pending pending
    where trim(coalesce(pending.request_folder, '')) = folder_value
      and coalesce(pending.req_archived, false) = false
      and lower(trim(coalesce(pending.req_status, 'pending'))) not in ('archived','cancelled','canceled')
    union all
    select history.unique_id,true
    from public.ph_requests_completed_history history
    where trim(coalesce(history.request_folder, '')) = folder_value
      and history.date_completed is not null
      and lower(trim(coalesce(history.req_status, 'complete'))) in ('complete','completed','done')
      and not exists(select 1 from public.ph_requests_pending pending where pending.unique_id=history.unique_id)
  )
  select coalesce(array_agg(member.unique_id order by member.unique_id), '{}'::text[]),
         coalesce(bool_and(member.completed), false)
    into request_ids, all_complete
  from folder_membership member;$new$);
  if repaired=definition or position('from public.ph_requests_completed_history history' in repaired)=0 then
    raise exception 'FOLDER_COMPLETION_RECONCILE_REPAIR_FAILED';
  end if;
  execute repaired;
end
$repair_folder_completion_reconcile$;

do $repair_folder_completion_prepare$
declare
  definition text;
  repaired text;
begin
  definition:=pg_get_functiondef('public.prepare_request_folder_completion_v2(uuid,uuid)'::regprocedure);
  repaired:=replace(definition,
$old$  select coalesce(array_agg(r.unique_id order by r.unique_id), '{}'::text[]),
         coalesce(bool_and(lower(trim(coalesce(r.req_status, ''))) in ('complete','completed','done')
           or nullif(trim(coalesce(r.date_completed, '')), '') is not null), false)
    into current_ids, all_complete
  from public.ph_requests_pending r
  where trim(coalesce(r.request_folder, '')) = trim(event_row.request_folder)
    and coalesce(r.req_archived, false) = false
    and lower(trim(coalesce(r.req_status, 'pending'))) not in ('archived','cancelled','canceled');$old$,
$new$  with folder_membership as (
    select pending.unique_id,
      lower(trim(coalesce(pending.req_status, ''))) in ('complete','completed','done')
        or nullif(trim(coalesce(pending.date_completed, '')), '') is not null as completed
    from public.ph_requests_pending pending
    where trim(coalesce(pending.request_folder, '')) = trim(event_row.request_folder)
      and coalesce(pending.req_archived, false) = false
      and lower(trim(coalesce(pending.req_status, 'pending'))) not in ('archived','cancelled','canceled')
    union all
    select history.unique_id,true
    from public.ph_requests_completed_history history
    where trim(coalesce(history.request_folder, '')) = trim(event_row.request_folder)
      and history.date_completed is not null
      and lower(trim(coalesce(history.req_status, 'complete'))) in ('complete','completed','done')
      and not exists(select 1 from public.ph_requests_pending pending where pending.unique_id=history.unique_id)
  )
  select coalesce(array_agg(member.unique_id order by member.unique_id), '{}'::text[]),
         coalesce(bool_and(member.completed), false)
    into current_ids, all_complete
  from folder_membership member;$new$);
  if repaired=definition or position('from public.ph_requests_completed_history history' in repaired)=0 then
    raise exception 'FOLDER_COMPLETION_PREPARE_REPAIR_FAILED';
  end if;
  execute repaired;
end
$repair_folder_completion_prepare$;

do $queue_blue_shadow_folder_completion$
declare
  result jsonb;
begin
  result:=private.reconcile_request_folder_completion_v2(
    'Digger Odell Nursery - Digger Odell Nursery - 10/26/26'
  );
  if coalesce((result->>'queued')::boolean,false) is not true then
    raise exception 'BLUE_SHADOW_FOLDER_COMPLETION_NOT_QUEUED: %',result;
  end if;
end
$queue_blue_shadow_folder_completion$;

do $v2372_delivery_contract$
begin
  if position('from public.ph_requests_completed_history history' in pg_get_functiondef(
      'private.reconcile_request_folder_completion_v2(text)'::regprocedure))=0
     or position('from public.ph_requests_completed_history history' in pg_get_functiondef(
      'public.prepare_request_folder_completion_v2(uuid,uuid)'::regprocedure))=0 then
    raise exception 'FOLDER_COMPLETION_HISTORY_MEMBERSHIP_CONTRACT_MISSING';
  end if;
  if not exists(select 1 from public.ph_request_delivery_outbox outbox
    where outbox.request_folder='Digger Odell Nursery - Digger Odell Nursery - 10/26/26'
      and outbox.event_type='request_completed'
      and outbox.payload->>'contractVersion'='request-folder-completion-v2'
      and outbox.status='pending') then
    raise exception 'BLUE_SHADOW_FOLDER_COMPLETION_EVENT_MISSING';
  end if;
end
$v2372_delivery_contract$;

commit;
