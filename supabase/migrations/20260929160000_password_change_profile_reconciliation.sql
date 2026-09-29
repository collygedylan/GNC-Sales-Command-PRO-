begin;

-- A password reset crosses Supabase Auth and the legacy app-user/profile
-- tables, so the Edge Function cannot update the three records atomically.
-- Keep a durable, password-free intent row to serialize retries and prevent
-- concurrent resets with different passwords from completing out of order.
create table if not exists private.password_change_attempts (
  attempt_id uuid primary key default pg_catalog.gen_random_uuid(),
  legacy_user_id integer not null references public.ph_app_users(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete cascade,
  password_fingerprint text not null
    check (password_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists password_change_one_pending_per_legacy_user
  on private.password_change_attempts(legacy_user_id)
  where status = 'pending';

create index if not exists password_change_completed_retry_lookup
  on private.password_change_attempts(legacy_user_id, password_fingerprint, completed_at desc)
  where status = 'completed';

revoke all on table private.password_change_attempts from public, anon, authenticated, service_role;

create or replace function private.password_change_username_v1(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_value, '')), '@.*$', '')),
    '[^a-z0-9]+', '_', 'g'
  ), '_')
$$;
revoke all on function private.password_change_username_v1(text) from public, anon, authenticated, service_role;

create or replace function private.password_change_auth_identity_v1(p_auth_user_id uuid)
returns table (username text, trusted_metadata boolean, email_confirmed_at timestamptz, banned_until timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_metadata jsonb;
  v_email_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_metadata_username text;
  v_legacy_id_text text;
  v_legacy_username text;
  v_alias_username text;
begin
  select lower(coalesce(u.email, '')), coalesce(u.raw_app_meta_data, '{}'::jsonb),
      u.email_confirmed_at, u.banned_until
    into v_email, v_metadata, v_email_confirmed_at, v_banned_until
  from auth.users u where u.id = p_auth_user_id;
  if not found then
    raise exception using errcode = '23503', message = 'password_change_auth_user_missing';
  end if;

  v_metadata_username := private.password_change_username_v1(v_metadata->>'username');
  v_legacy_id_text := coalesce(v_metadata->>'legacy_user_id', '');
  if coalesce(v_metadata->>'username', '') <> '' and v_metadata_username = '' then
    raise exception using errcode = '23514', message = 'password_change_auth_identity_conflict';
  end if;
  if v_legacy_id_text <> '' and v_legacy_id_text !~ '^[0-9]+$' then
    raise exception using errcode = '23514', message = 'password_change_auth_identity_conflict';
  end if;
  if v_legacy_id_text ~ '^[0-9]+$' then
    select private.password_change_username_v1(u.username) into v_legacy_username
    from public.ph_app_users u where u.id::text = v_legacy_id_text;
    if not found then
      raise exception using errcode = '23514', message = 'password_change_auth_identity_conflict';
    end if;
  end if;
  if lower(split_part(v_email, '@', 2)) = 'greenleafnursery.com' then
    v_alias_username := private.password_change_username_v1(split_part(v_email, '@', 1));
  end if;

  return query
    select candidate.username, candidate.trusted_metadata, v_email_confirmed_at, v_banned_until
    from (
      select v_metadata_username as username, true as trusted_metadata
      where coalesce(v_metadata_username, '') <> ''
      union
      select v_legacy_username as username, true as trusted_metadata
      where coalesce(v_legacy_username, '') <> ''
      union
      -- A verified Auth UUID already linked to a service-managed profile is
      -- authoritative even when older accounts use a noncanonical email and
      -- have no app_metadata identity claims.
      select private.password_change_username_v1(p.username) as username, true as trusted_metadata
      from public.profiles p
      where p.id = p_auth_user_id
        and private.password_change_username_v1(p.username) <> ''
      union
      select v_alias_username as username, false as trusted_metadata
      where coalesce(v_alias_username, '') <> ''
    ) candidate;
end
$$;
revoke all on function private.password_change_auth_identity_v1(uuid) from public, anon, authenticated, service_role;

create or replace function public.prepare_password_change_profile(
  p_username text,
  p_auth_user_id uuid default null,
  p_password_fingerprint text default null
)
returns table (
  status text,
  attempt_id uuid,
  profile_id uuid,
  legacy_user_id integer,
  username text,
  display_name text,
  role text,
  division text,
  language text,
  must_change_password boolean,
  locked_until timestamptz,
  disabled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := '';
  v_input_username text := '';
  v_auth_user_id uuid := p_auth_user_id;
  v_auth_count integer := 0;
  v_auth_candidate_id uuid;
  v_profile_candidate_id uuid;
  v_auth_identity_count integer := 0;
  v_auth_identity_username text;
  v_has_trusted_metadata boolean := false;
  v_email_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_legacy_id integer;
  v_legacy public.ph_app_users%rowtype;
  v_profile public.profiles%rowtype;
  v_has_profile boolean := false;
  v_forced boolean := false;
  v_attempt private.password_change_attempts%rowtype;
  v_existing_pending boolean := false;
  v_existing_completed boolean := false;
  v_fingerprint text := lower(coalesce(p_password_fingerprint, ''));
begin
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'password_change_fingerprint_required';
  end if;

  v_input_username := private.password_change_username_v1(p_username);

  -- A legacy-only signed session provides its already verified username. A
  -- native session may omit it when the profile is missing; derive identity
  -- only from Auth email/app_metadata, never raw_user_meta_data.
  if v_auth_user_id is null then
    v_username := v_input_username;
    if v_username = '' then
      raise exception using errcode = '22023', message = 'password_change_username_required';
    end if;
  else
    select count(distinct i.username), min(i.username), bool_or(i.trusted_metadata),
        max(i.email_confirmed_at), max(i.banned_until)
      into v_auth_identity_count, v_username, v_has_trusted_metadata,
        v_email_confirmed_at, v_banned_until
    from private.password_change_auth_identity_v1(v_auth_user_id) i;
    if v_auth_identity_count <> 1
       or (v_input_username <> '' and v_input_username <> v_username) then
      raise exception using errcode = '23514', message = 'password_change_auth_identity_conflict';
    end if;
    if not v_has_trusted_metadata and v_email_confirmed_at is null then
      raise exception using errcode = '23514', message = 'password_change_unconfirmed_auth_alias';
    end if;
    if v_banned_until is not null and v_banned_until > now() then
      raise exception using errcode = '42501', message = 'password_change_inactive_account';
    end if;
  end if;

  if v_username = '' then
    raise exception using errcode = '22023', message = 'password_change_username_required';
  end if;

  -- Serialize account resolution, profile repair, and pending-intent changes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('password-change-profile:' || v_username, 0)
  );

  select count(*)::integer, min(u.id)
    into v_auth_count, v_legacy_id
  from public.ph_app_users u
  where private.password_change_username_v1(u.username) = v_username;
  if v_auth_count = 0 then
    raise exception using errcode = 'P0002', message = 'password_change_legacy_user_missing';
  elsif v_auth_count <> 1 then
    raise exception using errcode = '21000', message = 'password_change_duplicate_legacy_username';
  end if;

  select u.* into v_legacy
  from public.ph_app_users u
  where u.id = v_legacy_id
  for update;
  if v_legacy.disabled_at is not null
     or (v_legacy.locked_until is not null and v_legacy.locked_until > now()) then
    raise exception using errcode = '42501', message = 'password_change_inactive_account';
  end if;
  v_forced := coalesce(v_legacy.must_change_password, false)
    or upper(regexp_replace(coalesce(v_legacy.password, ''), '\s+', '', 'g'))
      in ('GREENLEAF25', '1234', '12345', 'WELCOME', 'PASSWORD');

  if v_auth_user_id is null then
    -- Existing profile links and canonical/trusted Auth metadata are separate
    -- identity sources. If both exist they must identify the same UUID.
    select count(*)::integer into v_auth_count
    from public.profiles p
    where private.password_change_username_v1(p.username) = v_username
       or p.legacy_user_id = v_legacy.id;
    if v_auth_count > 1 then
      raise exception using errcode = '23505', message = 'password_change_profile_link_conflict';
    elsif v_auth_count = 1 then
      select p.id into v_profile_candidate_id
      from public.profiles p
      where private.password_change_username_v1(p.username) = v_username
         or p.legacy_user_id = v_legacy.id;
    end if;

    select count(distinct u.id)::integer,
        (array_agg(distinct u.id order by u.id))[1]
      into v_auth_count, v_auth_candidate_id
    from auth.users u
    where (lower(split_part(coalesce(u.email, ''), '@', 2)) = 'greenleafnursery.com'
       and private.password_change_username_v1(split_part(coalesce(u.email, ''), '@', 1)) = v_username)
       or private.password_change_username_v1(u.raw_app_meta_data->>'username') = v_username
       or u.raw_app_meta_data->>'legacy_user_id' = v_legacy_id::text;
    if v_auth_count > 1 then
      raise exception using errcode = '21000', message = 'password_change_auth_identity_conflict';
    end if;
    if v_profile_candidate_id is not null and v_auth_candidate_id is not null
       and v_profile_candidate_id <> v_auth_candidate_id then
      raise exception using errcode = '23514', message = 'password_change_auth_identity_conflict';
    end if;
    v_auth_user_id := coalesce(v_profile_candidate_id, v_auth_candidate_id);
    if v_auth_user_id is not null then
      select count(distinct i.username), min(i.username), bool_or(i.trusted_metadata),
          max(i.email_confirmed_at), max(i.banned_until)
        into v_auth_identity_count, v_auth_identity_username, v_has_trusted_metadata,
          v_email_confirmed_at, v_banned_until
      from private.password_change_auth_identity_v1(v_auth_user_id) i;
      if coalesce(v_auth_identity_count, 0) <> 1 or v_auth_identity_username <> v_username then
        raise exception using errcode = '23514', message = 'password_change_auth_identity_conflict';
      end if;
      if not v_has_trusted_metadata and v_email_confirmed_at is null then
        raise exception using errcode = '23514', message = 'password_change_unconfirmed_auth_alias';
      end if;
      if v_banned_until is not null and v_banned_until > now() then
        raise exception using errcode = '42501', message = 'password_change_inactive_account';
      end if;
    end if;
  end if;

  -- A legacy account without a native identity gets a durable reservation.
  -- The caller creates Auth from these trusted legacy attributes, then calls
  -- prepare again with that new UUID to bind the profile safely.
  if v_auth_user_id is null then
    select a.* into v_attempt
    from private.password_change_attempts a
    where a.legacy_user_id = v_legacy.id and a.status = 'pending'
    for update;
    if found then
      if v_attempt.password_fingerprint <> v_fingerprint then
        raise exception using errcode = '40001', message = 'password_change_attempt_conflict';
      end if;
      if not v_forced then
        raise exception using errcode = '23514', message = 'password_change_gate_missing';
      end if;
      update public.ph_app_users set must_change_password = true where id = v_legacy.id;
      return query select 'needs_native_identity', v_attempt.attempt_id, null::uuid,
        v_legacy.id, v_username, v_username, v_legacy.role, v_legacy.division,
        v_legacy.language, true, v_legacy.locked_until, v_legacy.disabled_at;
      return;
    end if;
    if not v_forced then
      return query select 'password_change_not_required', null::uuid, null::uuid,
        v_legacy.id, v_username, v_username, v_legacy.role, v_legacy.division,
        v_legacy.language, false, v_legacy.locked_until, v_legacy.disabled_at;
      return;
    end if;
    update public.ph_app_users set must_change_password = true where id = v_legacy.id;
    insert into private.password_change_attempts (
      legacy_user_id, profile_id, auth_user_id, password_fingerprint, status
    ) values (v_legacy.id, null, null, v_fingerprint, 'pending')
    returning * into v_attempt;
    return query select 'needs_native_identity', v_attempt.attempt_id, null::uuid,
      v_legacy.id, v_username, v_username, v_legacy.role, v_legacy.division,
      v_legacy.language, true, v_legacy.locked_until, v_legacy.disabled_at;
    return;
  end if;

  -- Lock an in-flight attempt before the profile row. The completion RPC uses
  -- the same advisory -> legacy -> attempt -> profile order to avoid deadlocks.
  select a.* into v_attempt
  from private.password_change_attempts a
  where a.legacy_user_id = v_legacy.id and a.status = 'pending'
  for update;
  v_existing_pending := found;
  if v_existing_pending and (
    v_attempt.password_fingerprint <> v_fingerprint
    or (v_attempt.auth_user_id is not null and v_attempt.auth_user_id <> v_auth_user_id)
    or (v_attempt.profile_id is not null and v_attempt.profile_id <> v_auth_user_id)
  ) then
    raise exception using errcode = '40001', message = 'password_change_attempt_conflict';
  end if;

  -- Recheck profile constraints by UUID, username, and legacy link. Never
  -- adopt another Auth account's profile or overwrite role/access state.
  select count(*)::integer into v_auth_count
  from public.profiles p
  where p.id = v_auth_user_id
     or private.password_change_username_v1(p.username) = v_username
     or p.legacy_user_id = v_legacy.id;
  if v_auth_count > 1 then
    raise exception using errcode = '23505', message = 'password_change_profile_link_conflict';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = v_auth_user_id
     or private.password_change_username_v1(p.username) = v_username
     or p.legacy_user_id = v_legacy.id
  for update;
  v_has_profile := found;
  if v_has_profile then
    if v_profile.id <> v_auth_user_id
       or v_profile.username <> v_username
       or (v_profile.legacy_user_id is not null and v_profile.legacy_user_id <> v_legacy.id) then
      raise exception using errcode = '23505', message = 'password_change_profile_link_conflict';
    end if;
    if v_profile.disabled_at is not null
       or (v_profile.locked_until is not null and v_profile.locked_until > now()) then
      raise exception using errcode = '42501', message = 'password_change_inactive_account';
    end if;
  else
    insert into public.profiles (
      id, legacy_user_id, username, display_name, role, division, language,
      disabled_at, locked_until, must_change_password, updated_at
    ) values (
      v_auth_user_id, v_legacy.id, v_username, v_username,
      coalesce(nullif(btrim(v_legacy.role), ''), 'User'),
      coalesce(nullif(btrim(v_legacy.division), ''), '10'),
      coalesce(nullif(btrim(v_legacy.language), ''), 'English'),
      v_legacy.disabled_at, v_legacy.locked_until, true, now()
    ) returning * into v_profile;
    v_has_profile := true;
  end if;

  if v_existing_pending then
    if v_attempt.profile_id is not null and v_attempt.profile_id <> v_profile.id then
      raise exception using errcode = '40001', message = 'password_change_attempt_conflict';
    end if;
    update private.password_change_attempts a
    set auth_user_id = v_auth_user_id, profile_id = v_profile.id
    where a.attempt_id = v_attempt.attempt_id
    returning * into v_attempt;
  else
    v_forced := v_forced or coalesce(v_profile.must_change_password, false);

    if not v_forced then
      select a.* into v_attempt
      from private.password_change_attempts a
      where a.legacy_user_id = v_legacy.id
        and a.status = 'completed'
        and a.password_fingerprint = v_fingerprint
        and a.auth_user_id = v_auth_user_id
        and a.profile_id = v_profile.id
        and a.completed_at = v_legacy.password_changed_at
        and exists (
          select 1 from auth.users au
          where au.id = v_auth_user_id
            and au.encrypted_password is not null
            and extensions.crypt(v_legacy.password, au.encrypted_password) = au.encrypted_password
        )
      order by a.completed_at desc
      limit 1;
      v_existing_completed := found;
      if v_existing_completed then
        return query select 'completed', v_attempt.attempt_id, v_profile.id,
          v_legacy.id, v_username, v_profile.display_name, v_profile.role,
          v_profile.division, v_profile.language, false,
          v_profile.locked_until, v_profile.disabled_at;
      else
        return query select 'password_change_not_required', null::uuid, v_profile.id,
          v_legacy.id, v_username, v_profile.display_name, v_profile.role,
          v_profile.division, v_profile.language, false,
          v_profile.locked_until, v_profile.disabled_at;
      end if;
      return;
    end if;

    insert into private.password_change_attempts (
      legacy_user_id, profile_id, auth_user_id, password_fingerprint, status
    ) values (v_legacy.id, v_profile.id, v_auth_user_id, v_fingerprint, 'pending')
    returning * into v_attempt;
  end if;

  -- Set the normal forced-reset gate for any pending password operation.
  -- This also protects optional paths if they are ever enabled in the future.
  update public.ph_app_users
  set must_change_password = true
  where id = v_legacy.id;
  update public.profiles
  set legacy_user_id = v_legacy.id,
      must_change_password = true,
      updated_at = now()
  where id = v_profile.id;

  return query select 'ready', v_attempt.attempt_id, v_profile.id,
    v_legacy.id, v_username, v_profile.display_name, v_profile.role,
    v_profile.division, v_profile.language, true,
    v_profile.locked_until, v_profile.disabled_at;
end
$$;

create or replace function public.complete_password_change_profile(
  p_attempt_id uuid,
  p_auth_user_id uuid,
  p_password text,
  p_password_fingerprint text
)
returns table (
  status text,
  profile_id uuid,
  legacy_user_id integer,
  username text,
  display_name text,
  role text,
  division text,
  language text,
  must_change_password boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.password_change_attempts%rowtype;
  v_legacy public.ph_app_users%rowtype;
  v_profile public.profiles%rowtype;
  v_fingerprint text := lower(coalesce(p_password_fingerprint, ''));
  v_username text;
  v_auth_password_hash text;
  v_auth_identity_count integer;
  v_auth_identity_username text;
  v_has_trusted_metadata boolean;
  v_email_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_legacy_id integer;
begin
  if p_attempt_id is null or p_auth_user_id is null then
    raise exception using errcode = '22023', message = 'password_change_attempt_required';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception using errcode = '22023', message = 'password_too_short';
  end if;
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'password_change_fingerprint_required';
  end if;

  select a.legacy_user_id into v_legacy_id
  from private.password_change_attempts a
  where a.attempt_id = p_attempt_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'password_change_attempt_missing';
  end if;
  select private.password_change_username_v1(u.username) into v_username
  from public.ph_app_users u where u.id = v_legacy_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'password_change_legacy_user_missing';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('password-change-profile:' || v_username, 0)
  );

  -- Keep the same lock order as prepare: advisory, legacy, attempt, profile.
  select u.* into v_legacy
  from public.ph_app_users u where u.id = v_legacy_id for update;
  select a.* into v_attempt
  from private.password_change_attempts a
  where a.attempt_id = p_attempt_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'password_change_attempt_missing';
  end if;
  if v_attempt.password_fingerprint <> v_fingerprint
     or v_attempt.auth_user_id is distinct from p_auth_user_id
     or v_attempt.legacy_user_id <> v_legacy.id then
    raise exception using errcode = '23514', message = 'password_change_attempt_conflict';
  end if;
  select p.* into v_profile
  from public.profiles p
  where p.id = p_auth_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'password_change_profile_missing';
  end if;

  v_username := private.password_change_username_v1(v_legacy.username);
  if private.password_change_username_v1(v_profile.username) <> v_username
     or v_profile.legacy_user_id is distinct from v_legacy.id then
    raise exception using errcode = '23505', message = 'password_change_profile_link_conflict';
  end if;
  if v_legacy.disabled_at is not null
     or v_profile.disabled_at is not null
     or (v_legacy.locked_until is not null and v_legacy.locked_until > now())
     or (v_profile.locked_until is not null and v_profile.locked_until > now()) then
    raise exception using errcode = '42501', message = 'password_change_inactive_account';
  end if;

  select u.encrypted_password, u.banned_until
    into v_auth_password_hash, v_banned_until
  from auth.users u where u.id = p_auth_user_id for share;
  if not found then
    raise exception using errcode = '23503', message = 'password_change_auth_user_missing';
  end if;
  if v_banned_until is not null and v_banned_until > now() then
    raise exception using errcode = '42501', message = 'password_change_inactive_account';
  end if;

  select count(distinct i.username), min(i.username), bool_or(i.trusted_metadata),
      max(i.email_confirmed_at), max(i.banned_until)
    into v_auth_identity_count, v_auth_identity_username, v_has_trusted_metadata,
      v_email_confirmed_at, v_banned_until
  from private.password_change_auth_identity_v1(p_auth_user_id) i;
  if coalesce(v_auth_identity_count, 0) <> 1 or v_auth_identity_username <> v_username then
    raise exception using errcode = '23514', message = 'password_change_auth_identity_conflict';
  end if;
  if not v_has_trusted_metadata and v_email_confirmed_at is null then
    raise exception using errcode = '23514', message = 'password_change_unconfirmed_auth_alias';
  end if;
  if v_banned_until is not null and v_banned_until > now() then
    raise exception using errcode = '42501', message = 'password_change_inactive_account';
  end if;
  if v_auth_password_hash is null
     or extensions.crypt(p_password, v_auth_password_hash) is distinct from v_auth_password_hash then
    raise exception using errcode = '23514', message = 'password_change_auth_password_mismatch';
  end if;

  if v_attempt.status = 'completed' then
    if v_legacy.must_change_password is distinct from false
       or v_profile.must_change_password is distinct from false
       or v_legacy.password is distinct from p_password then
      raise exception using errcode = '40001', message = 'password_change_attempt_stale';
    end if;
    return query select 'completed', v_profile.id, v_legacy.id, v_username,
      v_profile.display_name, v_profile.role, v_profile.division, v_profile.language, false;
    return;
  end if;

  if v_legacy.must_change_password is distinct from true
     or v_profile.must_change_password is distinct from true then
    raise exception using errcode = '40001', message = 'password_change_attempt_stale';
  end if;

  update public.ph_app_users
  set password = p_password,
      password_hash = null,
      password_salt = null,
      password_changed_at = now(),
      must_change_password = false
  where id = v_legacy.id;

  update public.profiles
  set must_change_password = false,
      updated_at = now()
  where id = v_profile.id;

  update private.password_change_attempts
  set status = 'completed', completed_at = now()
  where attempt_id = v_attempt.attempt_id;

  return query select 'completed', v_profile.id, v_legacy.id, v_username,
    v_profile.display_name, v_profile.role, v_profile.division, v_profile.language, false;
end
$$;

revoke all on function public.prepare_password_change_profile(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_password_change_profile(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_password_change_profile(text, uuid, text)
  to service_role;
grant execute on function public.complete_password_change_profile(uuid, uuid, text, text)
  to service_role;

comment on function public.prepare_password_change_profile(text, uuid, text) is
  'Service-only, idempotent profile/link reconciliation and durable password-change preparation. Stores only the server HMAC fingerprint, never a password.';
comment on function public.complete_password_change_profile(uuid, uuid, text, text) is
  'Service-only atomic legacy/profile password completion for a prepared Auth update; preserves roles and account restrictions.';

commit;
