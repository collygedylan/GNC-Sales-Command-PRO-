-- Prevent restored browser caches from repeatedly locking completed request rows.
-- The original transactional implementation remains the only writer. This guard
-- acknowledges immutable completed rows and rejects stale pending versions before
-- the writer takes its row lock.

do $$
begin
  if to_regprocedure('public.save_request_work_v1(text,bigint,jsonb,boolean)') is null then
    alter function public.save_request_work(text, bigint, jsonb, boolean)
      rename to save_request_work_v1;
  end if;
end
$$;

revoke all on function public.save_request_work_v1(text, bigint, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.save_request_work_v1(text, bigint, jsonb, boolean)
  to service_role;

create or replace function public.save_request_work(
  request_id text,
  expected_version bigint,
  patch jsonb,
  complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.ph_active_request%rowtype;
  canonical jsonb;
begin
  if not private.can_save_request_work() then
    raise exception using errcode = '42501', message = 'REQUEST_SAVE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(request_id, '')), '') is null or expected_version is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_AND_VERSION_REQUIRED';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PATCH_INVALID';
  end if;

  select * into existing
  from public.ph_active_request
  where unique_id = request_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;

  -- Completion is immutable. A restored cache may contain an older pending copy
  -- for weeks; acknowledge the canonical completed row so the client can safely
  -- delete that cache entry instead of retrying it forever.
  if lower(coalesce(existing.req_status, '')) in ('complete', 'completed')
     or nullif(btrim(coalesce(existing.date_completed, '')), '') is not null then
    canonical := coalesce(private.canonical_request_json(request_id), to_jsonb(existing));
    return jsonb_build_object(
      'row', canonical,
      'row_version', existing.row_version,
      'delivery_state', 'already_completed',
      'acknowledged', true
    );
  end if;

  -- Reject a stale pending version before the original writer obtains FOR UPDATE.
  -- This preserves optimistic concurrency without creating a tuple-lock convoy.
  if existing.row_version <> expected_version then
    raise exception using
      errcode = '40001',
      message = 'REQUEST_VERSION_CONFLICT',
      detail = jsonb_build_object('current_version', existing.row_version)::text;
  end if;

  return public.save_request_work_v1(request_id, expected_version, patch, complete);
end;
$$;

revoke all on function public.save_request_work(text, bigint, jsonb, boolean)
  from public, anon;
grant execute on function public.save_request_work(text, bigint, jsonb, boolean)
  to authenticated;

comment on function public.save_request_work(text, bigint, jsonb, boolean) is
  'Guards the atomic request writer: completed rows acknowledge stale caches; pending version conflicts fail before row locking.';
