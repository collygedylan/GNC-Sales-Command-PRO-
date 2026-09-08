-- Suspend Tag completion is a narrow native-auth command, not a general SOC
-- write grant. It stamps only date_completed and keeps the source row intact.
create schema if not exists suspend_tag_private;
revoke all on schema suspend_tag_private from public, anon, authenticated;

create table suspend_tag_private.completion_commands (
  actor_id uuid not null,
  request_id uuid not null,
  request_hash text not null,
  source_uid text not null,
  source_last_updated timestamptz,
  completed_at timestamptz not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
create index suspend_tag_completion_source_idx
  on suspend_tag_private.completion_commands(source_uid, created_at desc);
alter table suspend_tag_private.completion_commands enable row level security;
revoke all on suspend_tag_private.completion_commands from public, anon, authenticated;

create function suspend_tag_private.complete(
  p_source_uid text, p_expected_last_updated timestamptz, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_profile public.profiles;
  v_source public.ph_soc_master;
  v_receipt suspend_tag_private.completion_commands;
  v_hash text;
  v_result jsonb;
  v_already_completed boolean;
begin
  -- Recheck current database membership and revocation on EVERY call, including
  -- receipt replay. User-editable metadata and legacy app tokens confer no access.
  if v_actor is null
     or v_claims->>'iss' is distinct from 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1'
     or v_claims->>'role' is distinct from 'authenticated'
     or coalesce((v_claims->>'exp')::numeric, 0) <= extract(epoch from now())
     or not exists (
       select 1 from auth.sessions s where s.id::text = v_claims->>'session_id'
         and s.user_id = v_actor and (s.not_after is null or s.not_after > now())
     ) then
    raise exception using errcode = '42501', message = 'SUSPEND_TAG_SESSION_REQUIRED';
  end if;
  select * into v_profile from public.profiles where id = v_actor for share;
  if v_profile.id is null
     or v_profile.username not in ('dylan_collyge', 'jd_jones', 'megan_kelly')
     or v_profile.username is null or v_profile.disabled_at is not null
     or v_profile.must_change_password is distinct from false
     or (v_profile.locked_until is not null and v_profile.locked_until > now()) then
    raise exception using errcode = '42501', message = 'SUSPEND_TAG_FORBIDDEN';
  end if;
  if p_source_uid is null or btrim(p_source_uid) = '' or length(p_source_uid) > 2000
     or p_request_id is null then
    raise exception using errcode = '22023', message = 'SUSPEND_TAG_REQUEST_INVALID';
  end if;

  -- Serialize same-token retries first, then lock only the exact imported SOC
  -- row. No stock, reservations, request history, or other source row is changed.
  perform pg_advisory_xact_lock(hashtextextended('suspend-tag:' || v_actor::text || ':' || p_request_id::text, 0));
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'sourceUid', p_source_uid, 'expectedLastUpdated', p_expected_last_updated
  )::text, 'UTF8')), 'hex');
  select * into v_receipt from suspend_tag_private.completion_commands
    where actor_id = v_actor and request_id = p_request_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception using errcode = '22023', message = 'SUSPEND_TAG_TOKEN_CONFLICT';
    end if;
    return v_receipt.response;
  end if;

  select * into v_source from public.ph_soc_master where unique_id = p_source_uid for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SUSPEND_TAG_SOURCE_MISSING';
  end if;
  if v_source.last_updated is distinct from p_expected_last_updated then
    raise exception using errcode = '40001', message = 'SUSPEND_TAG_SOURCE_CHANGED';
  end if;
  if upper(btrim(coalesce(v_source.suspend, ''))) <> 'SUSPEND'
     or regexp_replace(lower(coalesce(v_source.suspend_to, '')), '[^a-z0-9]+', '', 'g') <> 'dc' then
    raise exception using errcode = '22023', message = 'SUSPEND_TAG_NOT_ELIGIBLE';
  end if;
  v_already_completed := v_source.date_completed is not null;
  if not v_already_completed then
    update public.ph_soc_master set date_completed = clock_timestamp()
      where unique_id = p_source_uid returning * into v_source;
  end if;
  v_result := jsonb_build_object(
    'ok', true, 'sourceUid', v_source.unique_id,
    'sourceLastUpdated', v_source.last_updated,
    'expectedLastUpdated', p_expected_last_updated,
    'completedAt', v_source.date_completed, 'alreadyCompleted', v_already_completed
  );
  insert into suspend_tag_private.completion_commands(
    actor_id, request_id, request_hash, source_uid, source_last_updated, completed_at, response
  ) values (v_actor, p_request_id, v_hash, v_source.unique_id, v_source.last_updated, v_source.date_completed, v_result);
  return v_result;
end $$;

create function public.complete_suspend_tag_v1(
  p_source_uid text, p_expected_last_updated timestamptz, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select suspend_tag_private.complete(p_source_uid, p_expected_last_updated, p_request_id)
$$;
revoke all on function suspend_tag_private.complete(text,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.complete_suspend_tag_v1(text,timestamptz,uuid) from public, anon, authenticated;
grant usage on schema suspend_tag_private to authenticated;
grant execute on function suspend_tag_private.complete(text,timestamptz,uuid) to authenticated;
grant execute on function public.complete_suspend_tag_v1(text,timestamptz,uuid) to authenticated;
