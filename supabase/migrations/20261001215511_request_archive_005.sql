begin;

-- Request-row archive is a reversible state transition. The command ledger and
-- functions stay behind app-api; browser clients never receive table write
-- grants for this workflow.
create table if not exists private.ph_request_archive_command_ledger (
  idempotency_key uuid primary key,
  actor_id uuid not null references public.profiles(id),
  request_uid text not null,
  operation text not null check (operation in ('archive', 'restore')),
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table private.ph_request_archive_command_ledger enable row level security;
revoke all on table private.ph_request_archive_command_ledger from public, anon, authenticated;
grant all on table private.ph_request_archive_command_ledger to service_role;

create index if not exists ph_active_request_archived_created_idx
  on public.ph_active_request (created_at desc, unique_id desc)
  where req_archived is true;

create or replace function private.request_archive_actor_allowed_v1(p_actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_actor_id is null then return false; end if;
  -- app-api has already verified the native session and supplies its profile
  -- id. Reuse the same database capability used by the authenticated RLS
  -- policy while keeping the impersonated claim transaction-local.
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  return coalesce(private.can_manage_requests(), false);
end
$function$;
revoke all on function private.request_archive_actor_allowed_v1(uuid) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.request_archive_actor_allowed_v1(uuid) to service_role;

create or replace function public.request_archive_command_v1(
  p_actor_id uuid,
  p_uid text,
  p_operation text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_allowed boolean;
  history_exists boolean;
  operation_name text := lower(btrim(coalesce(p_operation, '')));
  request_uid text := btrim(coalesce(p_uid, ''));
  request_row public.ph_active_request%rowtype;
  prior_command private.ph_request_archive_command_ledger%rowtype;
  history_delivery_state text;
  next_state text;
  response jsonb;
begin
  if p_idempotency_key is null or request_uid = '' or operation_name not in ('archive', 'restore') then
    raise exception using errcode = 'PT400', message = 'REQUEST_ARCHIVE_COMMAND_INVALID';
  end if;

  select private.request_archive_actor_allowed_v1(p_actor_id) into actor_allowed;
  if not coalesce(actor_allowed, false) then
    raise exception using errcode = '42501', message = 'REQUEST_ARCHIVE_FORBIDDEN';
  end if;

  -- Serialize retries using the same command key before checking its ledger.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 805));
  select * into prior_command
  from private.ph_request_archive_command_ledger l
  where l.idempotency_key = p_idempotency_key;
  if found then
    if prior_command.actor_id <> p_actor_id
      or prior_command.request_uid <> request_uid
      or prior_command.operation <> operation_name then
      raise exception using errcode = 'PT409', message = 'REQUEST_ARCHIVE_IDEMPOTENCY_CONFLICT';
    end if;
    return prior_command.result || jsonb_build_object('replayed', true);
  end if;

  select * into request_row
  from public.ph_active_request r
  where r.unique_id = request_uid
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'REQUEST_ARCHIVE_NOT_FOUND';
  end if;

  select coalesce(h.delivery_state, 'pending') into history_delivery_state
  from public.ph_request_history h where h.unique_id = request_uid;
  history_exists := found;
  if not history_exists then history_delivery_state := 'pending'; end if;

  -- The canonical helper creates a history snapshot for legacy rows that do
  -- not have one yet. Never upsert an existing history row during archive or
  -- restore: its triggers refresh the full historical snapshot.
  if not history_exists then
    perform private.upsert_request_history(
      request_uid,
      case when operation_name = 'archive' then 'archived' else 'restored' end,
      history_delivery_state,
      false
    );
  end if;

  if operation_name = 'archive' then
    if coalesce(request_row.req_archived, false) then
      next_state := 'already_archived';
    else
      if lower(btrim(coalesce(request_row.req_status, 'pending'))) in ('complete', 'completed', 'done', 'closed')
        or nullif(btrim(coalesce(request_row.date_completed, '')), '') is not null then
        raise exception using errcode = 'PT409', message = 'REQUEST_ARCHIVE_COMPLETED_FORBIDDEN';
      end if;
      perform set_config('app.request_archive_transition', 'on', true);
      update public.ph_active_request r
      set req_archived = true
      where r.unique_id = request_uid;
      perform set_config('app.request_archive_transition', '', true);
      next_state := 'archived';
    end if;
  else
    if not coalesce(request_row.req_archived, false) then
      next_state := 'already_restored';
    else
      if lower(btrim(coalesce(request_row.req_status, 'pending'))) in ('complete', 'completed', 'done', 'closed')
        or nullif(btrim(coalesce(request_row.date_completed, '')), '') is not null then
        raise exception using errcode = 'PT409', message = 'REQUEST_RESTORE_COMPLETED_FORBIDDEN';
      end if;
      perform set_config('app.request_archive_transition', 'on', true);
      update public.ph_active_request r
      set req_archived = false
      where r.unique_id = request_uid;
      perform set_config('app.request_archive_transition', '', true);
      next_state := 'restored';
    end if;
  end if;

  select * into request_row
  from public.ph_active_request r
  where r.unique_id = request_uid;
  response := jsonb_build_object(
    'uid', request_uid,
    'operation', operation_name,
    'state', next_state,
    'row', to_jsonb(request_row),
    'idempotencyKey', p_idempotency_key,
    'replayed', false
  );
  insert into private.ph_request_archive_command_ledger(idempotency_key, actor_id, request_uid, operation, result)
  values (p_idempotency_key, p_actor_id, request_uid, operation_name, response);
  return response;
end
$function$;

-- Archiving is a reversible queue-visibility operation, not a completion
-- event. Skip folder completion reconciliation for this service RPC only so
-- it cannot enqueue completion notifications as a side effect.
create or replace function private.reconcile_request_folder_from_request_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
    and current_setting('app.request_archive_transition', true) = 'on' then
    return new;
  end if;
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

create or replace function public.request_archive_list_v1(
  p_actor_id uuid,
  p_offset integer default 0,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_allowed boolean;
  safe_offset integer := greatest(0, coalesce(p_offset, 0));
  safe_limit integer := least(500, greatest(1, coalesce(p_limit, 100)));
  total_rows bigint;
  result_rows jsonb;
begin
  select private.request_archive_actor_allowed_v1(p_actor_id) into actor_allowed;
  if not coalesce(actor_allowed, false) then
    raise exception using errcode = '42501', message = 'REQUEST_ARCHIVE_FORBIDDEN';
  end if;

  select count(*) into total_rows
  from public.ph_active_request r
  where coalesce(r.req_archived, false);

  select coalesce(jsonb_agg(page.row_data order by page.created_at desc, page.unique_id desc), '[]'::jsonb)
  into result_rows
  from (
    select r.unique_id, r.created_at,
      jsonb_build_object(
        'id', r.id,
        'unique_id', r.unique_id,
        'master_id', r.master_id,
        'commonname', r.commonname,
        'contsize', r.contsize,
        'locationcode', r.locationcode,
        'lotcode', r.lotcode,
        'itemcode', r.itemcode,
        'ptravailable', r.ptravailable,
        'season_supply', r.season_supply,
        'priority', r.priority,
        'qualitycode', r.qualitycode,
        'field_tag_color', r.field_tag_color,
        'plantgroupcode', r.plantgroupcode,
        'requested_by', r.requested_by,
        'request_folder', r.request_folder,
        'req_customer', r.req_customer,
        'req_qty', r.req_qty,
        'desired_spec', r.desired_spec,
        'desired_caliper', r.desired_caliper,
        'est_ship', r.est_ship,
        'req_reserve', r.req_reserve,
        'req_photo_link', r.req_photo_link,
        'req_photo_name', r.req_photo_name,
        'req_archived', r.req_archived,
        'req_status', r.req_status,
        'req_rep_action', r.req_rep_action,
        'created_at', r.created_at,
        'req_match', r.req_match,
        'req_spec', r.req_spec,
        'req_caliper', r.req_caliper,
        'req_pic_note', r.req_pic_note,
        'req_sales_note', r.req_sales_note,
        'req_comments', r.req_comments,
        'av_note', r.av_note,
        'date_completed', r.date_completed,
        'req_photo_mode', r.req_photo_mode,
        'request_note', r.request_note
      ) || jsonb_build_object(
        'updated_at', r.updated_at,
        'request_created_by_username', r.request_created_by_username,
        'request_created_by_display', r.request_created_by_display,
        'request_created_by_email', r.request_created_by_email,
        'request_selected_rep_username', r.request_selected_rep_username,
        'request_selected_rep_display', r.request_selected_rep_display,
        'request_selected_rep_email', r.request_selected_rep_email,
        'request_source', r.request_source,
        'client_batch_id', r.client_batch_id,
        'row_version', r.row_version,
        'app_tab_assignment', r.app_tab_assignment,
        'master_app_tab_assignment', r.master_app_tab_assignment,
        'customeridentityid', r.customeridentityid,
        'customername', r.customername,
        'consigneeidentityid', r.consigneeidentityid,
        'consigneename', r.consigneename
      ) as row_data
    from public.ph_active_request r
    where coalesce(r.req_archived, false)
    order by r.created_at desc, r.unique_id desc
    limit safe_limit offset safe_offset
  ) page;

  return jsonb_build_object(
    'rows', result_rows,
    'total', total_rows,
    'offset', safe_offset,
    'limit', safe_limit,
    'hasMore', safe_offset + jsonb_array_length(result_rows) < total_rows
  );
end
$function$;

revoke all on function public.request_archive_command_v1(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.request_archive_list_v1(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.request_archive_command_v1(uuid, text, text, uuid) to service_role;
grant execute on function public.request_archive_list_v1(uuid, integer, integer) to service_role;

-- Remove the legacy DELETE escape hatch. New clients archive through the
-- service-authenticated transaction above; old shells fail closed and retain
-- their rows rather than deleting them when their PATCH verification fails.
drop policy if exists ph_active_request_manager_delete on public.ph_active_request;

notify pgrst, 'reload schema';
commit;
