begin;

-- Removal is deliberately separate from the reversible archive command. Keep
-- immutable history and a private retry receipt; remove only the active row.
create table private.ph_request_queue_removal_commands (
  idempotency_key uuid primary key,
  actor_id uuid not null references public.profiles(id),
  request_uid text not null,
  expected_row_version bigint not null,
  expected_updated_at timestamptz not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.ph_request_queue_removal_commands enable row level security;
revoke all on private.ph_request_queue_removal_commands from public, anon, authenticated, service_role;

create function public.request_queue_remove_v1(
  p_actor_id uuid, p_uid text, p_expected_row_version bigint,
  p_expected_updated_at timestamptz, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = ''
set statement_timeout = '15s'
as $function$
declare
  request_row public.ph_active_request%rowtype;
  prior_command private.ph_request_queue_removal_commands%rowtype;
  request_uid text := btrim(coalesce(p_uid, ''));
  response jsonb;
begin
  if request_uid = '' or length(request_uid) > 240 or p_idempotency_key is null
    or p_expected_row_version is null or p_expected_row_version < 1
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then
    raise exception using errcode = 'PT400', message = 'REQUEST_REMOVE_COMMAND_INVALID';
  end if;
  if not coalesce(private.request_archive_actor_allowed_v1(p_actor_id), false) then
    raise exception using errcode = '42501', message = 'REQUEST_REMOVE_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 906));
  select c.* into prior_command from private.ph_request_queue_removal_commands c
    where c.idempotency_key = p_idempotency_key;
  if found then
    if prior_command.actor_id <> p_actor_id or prior_command.request_uid <> request_uid
      or prior_command.expected_row_version <> p_expected_row_version
      or prior_command.expected_updated_at <> p_expected_updated_at then
      raise exception using errcode = 'PT409', message = 'REQUEST_REMOVE_IDEMPOTENCY_CONFLICT';
    end if;
    return prior_command.result || jsonb_build_object('replayed', true);
  end if;
  select r.* into request_row from public.ph_active_request r
    where r.unique_id = request_uid for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'REQUEST_REMOVE_NOT_FOUND';
  end if;
  if request_row.row_version is distinct from p_expected_row_version
    or request_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'PT409', message = 'REQUEST_REMOVE_STALE_REVISION';
  end if;
  if coalesce(request_row.req_archived, false)
    or lower(btrim(coalesce(request_row.req_status, 'pending'))) in ('complete','completed','done','closed','cancelled','canceled','removed')
    or nullif(btrim(coalesce(request_row.date_completed, '')), '') is not null then
    raise exception using errcode = 'PT409', message = 'REQUEST_REMOVE_PENDING_REQUIRED';
  end if;

  -- Never refresh a frozen historical snapshot just to remove its queue row.
  if not exists (select 1 from public.ph_request_history h where h.unique_id = request_uid) then
    perform private.upsert_request_history(request_uid, 'removed_from_queue', 'pending', false);
  end if;
  delete from public.ph_active_request r where r.unique_id = request_uid;
  -- Existing DELETE triggers advance dataset revisions, publish invalidation,
  -- and reconcile the remaining folder membership. Removed IDs are never
  -- marked completed or inserted into a completion payload.
  response := jsonb_build_object('uid', request_uid, 'state', 'removed',
    'idempotencyKey', p_idempotency_key, 'replayed', false);
  insert into private.ph_request_queue_removal_commands
    (idempotency_key, actor_id, request_uid, expected_row_version, expected_updated_at, result)
    values (p_idempotency_key, p_actor_id, request_uid, p_expected_row_version, p_expected_updated_at, response);
  return response;
end
$function$;
revoke all on function public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid) to service_role;
comment on function public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid) is
  'Authorized, revision-checked permanent removal from Que, retaining request history and retry receipts.';

commit;
