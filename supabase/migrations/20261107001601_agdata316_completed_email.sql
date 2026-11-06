begin;
CREATE OR REPLACE FUNCTION private.route_legacy_request_completion_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.event_type = 'request_completed'
     and coalesce(new.payload->>'contractVersion', '') not in ('request-folder-completion-v2','request-row-completion-v316') then
    perform private.reconcile_request_folder_completion_v2(new.request_folder);
    new.status := 'suppressed';
    new.sanitized_error_code := 'FOLDER_COMPLETION_V2_SUPERSEDED';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION private.reconcile_request_folder_completion_v2(p_request_folder text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  folder_value text := trim(coalesce(p_request_folder, ''));
  request_ids text[];
  membership_signature_value text;
  state_row private.ph_request_folder_delivery_state;
  all_complete boolean := false;
  dependency_keys text[];
  creation_dependency_coverage boolean := false;
  event_key_value text;
  completion_event public.ph_request_delivery_outbox;
begin
  if folder_value = '' then return jsonb_build_object('queued', false, 'reason', 'folder_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('request-folder-v2:' || folder_value, 0));

  -- Row-completion events own new completions, including partially finished folders.
  -- Keep the existing folder contract for folders that have no row events.
  if exists(select 1 from public.ph_request_delivery_outbox o
    where o.request_folder=folder_value and o.event_type='request_completed'
      and o.payload->>'contractVersion'='request-row-completion-v316') then
    return jsonb_build_object('queued',false,'reason','row_completion_owner');
  end if;

  with folder_membership as (
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
  from folder_membership member;

  membership_signature_value := md5(coalesce(array_to_string(request_ids, E'\n'), 'empty'));
  select * into state_row from private.ph_request_folder_delivery_state
  where request_folder = folder_value for update;

  if state_row.request_folder is null then
    insert into private.ph_request_folder_delivery_state(
      request_folder, membership_version, membership_signature, active_request_ids)
    values (folder_value, 1, membership_signature_value, request_ids)
    returning * into state_row;
  elsif state_row.membership_signature <> membership_signature_value then
    update private.ph_request_folder_delivery_state set
      membership_version = membership_version + 1,
      membership_signature = membership_signature_value,
      active_request_ids = request_ids,
      completion_event_key = null,
      updated_at = now()
    where request_folder = folder_value returning * into state_row;
  else
    update private.ph_request_folder_delivery_state set active_request_ids = request_ids, updated_at = now()
    where request_folder = folder_value returning * into state_row;
  end if;

  update public.ph_request_delivery_outbox o set status = 'suppressed',
    sanitized_error_code = 'FOLDER_MEMBERSHIP_SUPERSEDED', updated_at = now()
  where o.request_folder = folder_value and o.event_type = 'request_completed'
    and o.status in ('pending','failed','unknown')
    and coalesce(o.payload->>'contractVersion', '') = 'request-folder-completion-v2'
    and coalesce((o.payload->>'membershipVersion')::bigint, 0) <> state_row.membership_version;

  if cardinality(request_ids) = 0 or not all_complete then
    return jsonb_build_object('queued', false, 'membershipVersion', state_row.membership_version,
      'activeCount', cardinality(request_ids), 'reason', 'folder_incomplete');
  end if;

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
$function$
;

create or replace function private.enqueue_completed_request_email_v316(p_request_id text,p_deleted_row jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare h public.ph_requests_completed_history%rowtype;
declare p public.ph_requests_pending%rowtype;
declare queued uuid;
declare folder text;
begin
  select * into p from public.ph_requests_pending where unique_id=p_request_id;
  if p.unique_id is not null and (lower(btrim(coalesce(p.req_status,''))) in ('complete','completed','done')
      or nullif(btrim(coalesce(p.date_completed,'')),'') is not null) then
    perform private.upsert_request_history(p.unique_id,'completed','pending',false);
  end if;
  select * into h from public.ph_requests_completed_history where unique_id=p_request_id;
  if h.unique_id is null and p_deleted_row is not null
     and lower(coalesce(p_deleted_row->>'req_status','')) in ('complete','completed','done') then
    -- A completed DELETE may arrive without the canonical command's history upsert.
    -- Freeze only that exact deleted row; cancellation alone is never completion.
    insert into public.ph_requests_completed_history(unique_id,master_id,commonname,contsize,itemcode,locationcode,lotcode,
      request_folder,requested_by,req_customer,req_qty,req_status,date_completed,req_spec,req_caliper,req_match,
      req_pic_note,req_comments,av_note,req_photo_link,req_photo_name,photos,snapshot,last_event,
      completed_by_username,completed_by_display,completed_by_email,request_created_by_username,
      request_created_by_display,request_created_by_email,request_selected_rep_username,request_selected_rep_display,
      request_selected_rep_email,created_at)
    values(p_request_id,p_deleted_row->>'master_id',p_deleted_row->>'commonname',p_deleted_row->>'contsize',
      p_deleted_row->>'itemcode',p_deleted_row->>'locationcode',p_deleted_row->>'lotcode',p_deleted_row->>'request_folder',
      p_deleted_row->>'requested_by',p_deleted_row->>'req_customer',p_deleted_row->>'req_qty','Complete',
      private.request_timestamptz_v2362(p_deleted_row->>'date_completed'),p_deleted_row->>'req_spec',p_deleted_row->>'req_caliper',
      p_deleted_row->>'req_match',p_deleted_row->>'req_pic_note',p_deleted_row->>'req_comments',p_deleted_row->>'av_note',
      p_deleted_row->>'req_photo_link',p_deleted_row->>'req_photo_name',p_deleted_row->'photos',p_deleted_row,'completed',
      p_deleted_row->>'completed_by_username',p_deleted_row->>'completed_by_display',p_deleted_row->>'completed_by_email',
      p_deleted_row->>'request_created_by_username',p_deleted_row->>'request_created_by_display',p_deleted_row->>'request_created_by_email',
      p_deleted_row->>'request_selected_rep_username',p_deleted_row->>'request_selected_rep_display',p_deleted_row->>'request_selected_rep_email',
      private.request_timestamptz_v2362(p_deleted_row->>'created_at')) on conflict(unique_id) do nothing;
    select * into h from public.ph_requests_completed_history where unique_id=p_request_id;
  end if;
  -- History also contains submitted/updated audit snapshots; their compatibility
  -- trigger fills Complete/date_completed. Only the actual completion event proves Done.
  if h.unique_id is null or lower(coalesce(h.last_event,'')) not in ('completed','request_completed') then return null; end if;
  folder:=h.request_folder;
  perform pg_advisory_xact_lock(hashtextextended('request-folder-v2:'||coalesce(folder,''),0));
  select event_id into queued from public.ph_request_delivery_outbox o
  where o.event_type='request_completed' and o.status in ('pending','processing','unknown','delivered')
    and (o.request_id=p_request_id or o.payload->>'request_id'=p_request_id or coalesce(o.payload->'request_ids','[]'::jsonb) ? p_request_id)
  order by (o.email_delivered_at is not null) desc,o.created_at limit 1;
  if queued is not null then return queued; end if;
  insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status,next_attempt_at)
  values('request-row-completed:'||p_request_id,'request_completed',p_request_id,folder,
    jsonb_build_object('contractVersion','request-row-completion-v316','request_id',p_request_id,
      'request_ids',jsonb_build_array(p_request_id),'requests',jsonb_build_array(to_jsonb(h)),
      'completedAt',h.date_completed,'completedBy',h.completed_by_username,'row_version',h.row_version),
    'pending',now()) on conflict(event_key) do nothing returning event_id into queued;
  return queued;
end
$fn$;
revoke all on function private.enqueue_completed_request_email_v316(text,jsonb) from public,anon,authenticated;

create or replace function private.enqueue_completed_request_email_trg()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  -- Prevent nested canonical history upserts from re-entering this wrapper.
  if pg_trigger_depth()>1 then return coalesce(new,old); end if;
  if tg_table_name='ph_requests_completed_history' then
    if lower(coalesce(new.last_event,'')) in ('completed','request_completed') then
      perform private.enqueue_completed_request_email_v316(new.unique_id);
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if lower(coalesce(old.req_status,'')) in ('complete','completed','done')
       or exists(select 1 from public.ph_requests_completed_history h where h.unique_id=old.unique_id
         and lower(coalesce(h.last_event,'')) in ('completed','request_completed')) then
      perform private.enqueue_completed_request_email_v316(old.unique_id,to_jsonb(old));
    end if;
    return old;
  end if;
  if lower(coalesce(new.req_status,'')) in ('complete','completed','done')
     or nullif(btrim(coalesce(new.date_completed,'')),'') is not null then
    perform private.enqueue_completed_request_email_v316(new.unique_id);
  end if;
  return new;
end
$fn$;
revoke all on function private.enqueue_completed_request_email_trg() from public,anon,authenticated;
drop trigger if exists enqueue_completed_request_email_trg on public.ph_requests_pending;
create trigger enqueue_completed_request_email_trg after update or delete on public.ph_requests_pending
for each row execute function private.enqueue_completed_request_email_trg();
drop trigger if exists enqueue_completed_request_email_trg on public.ph_requests_completed_history;
create trigger enqueue_completed_request_email_trg after insert or update of last_event on public.ph_requests_completed_history
for each row execute function private.enqueue_completed_request_email_trg();
-- Existing ph_request_delivery_outbox_wake/requeue triggers call the guarded
-- private.wake_request_delivery_worker_now; no client or new secret-bearing endpoint.

INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261107001601','agdata316_completed_email',ARRAY['Idempotent verified row completion emails']) ON CONFLICT(version) DO NOTHING;
COMMIT;
