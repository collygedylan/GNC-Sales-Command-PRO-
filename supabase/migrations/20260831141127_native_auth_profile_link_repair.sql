begin;

-- Native Auth users must remain linked to the legacy app-user row while the
-- dual-auth rollout is active. Keep the database half of provisioning in one
-- transaction so an Auth user can never receive a partially linked profile.
create or replace function public.provision_native_auth_app_user(
  p_auth_user_id uuid,
  p_username text,
  p_password text,
  p_display_name text default null,
  p_role text default 'User',
  p_division text default '10',
  p_language text default 'English',
  p_must_change_password boolean default true
)
returns table (legacy_user_id integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_display_name text := btrim(coalesce(nullif(p_display_name, ''), p_username, ''));
  v_role text := btrim(coalesce(nullif(p_role, ''), 'User'));
  v_division text := btrim(coalesce(nullif(p_division, ''), '10'));
  v_language text := btrim(coalesce(nullif(p_language, ''), 'English'));
  v_profile public.profiles%rowtype;
  v_legacy_user_id integer;
  v_normalized_legacy_count integer := 0;
begin
  if p_auth_user_id is null then
    raise exception using errcode = '22023', message = 'auth_user_id_required';
  end if;
  if v_username = '' then
    raise exception using errcode = '22023', message = 'username_required';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception using errcode = '22023', message = 'password_too_short';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = p_auth_user_id
  for update;

  if v_profile.id is not null and lower(btrim(v_profile.username)) <> v_username then
    raise exception using errcode = '23514', message = 'profile_username_mismatch';
  end if;

  select min(u.id), count(*)::integer
  into v_legacy_user_id, v_normalized_legacy_count
  from public.ph_app_users u
  where lower(btrim(u.username)) = v_username;

  if v_normalized_legacy_count > 1 then
    raise exception using errcode = '21000', message = 'duplicate_normalized_legacy_username';
  end if;

  if v_profile.legacy_user_id is not null then
    if v_legacy_user_id is not null and v_legacy_user_id <> v_profile.legacy_user_id then
      raise exception using errcode = '23505', message = 'profile_legacy_link_conflict';
    end if;
    v_legacy_user_id := v_profile.legacy_user_id;
  end if;

  if v_legacy_user_id is not null and exists (
    select 1
    from public.profiles p
    where p.legacy_user_id = v_legacy_user_id
      and p.id <> p_auth_user_id
  ) then
    raise exception using errcode = '23505', message = 'legacy_user_already_linked';
  end if;

  if v_legacy_user_id is null then
    insert into public.ph_app_users (
      username,
      password,
      role,
      password_hash,
      password_salt,
      password_changed_at,
      must_change_password,
      failed_login_count,
      locked_until,
      disabled_at,
      division,
      language
    ) values (
      v_username,
      p_password,
      v_role,
      null,
      null,
      case when p_must_change_password then null else now() end,
      p_must_change_password,
      0,
      null,
      null,
      v_division,
      v_language
    )
    returning id into v_legacy_user_id;
  else
    update public.ph_app_users
    set username = v_username,
        password = p_password,
        role = v_role,
        password_hash = null,
        password_salt = null,
        password_changed_at = case when p_must_change_password then password_changed_at else now() end,
        must_change_password = p_must_change_password,
        failed_login_count = 0,
        locked_until = null,
        disabled_at = null,
        division = v_division,
        language = v_language
    where id = v_legacy_user_id;

    if not found then
      raise exception using errcode = '23503', message = 'linked_legacy_user_missing';
    end if;
  end if;

  insert into public.profiles (
    id,
    legacy_user_id,
    username,
    display_name,
    role,
    division,
    language,
    disabled_at,
    locked_until,
    must_change_password,
    updated_at
  ) values (
    p_auth_user_id,
    v_legacy_user_id,
    v_username,
    coalesce(nullif(v_display_name, ''), v_username),
    v_role,
    v_division,
    v_language,
    null,
    null,
    p_must_change_password,
    now()
  )
  on conflict (id) do update
  set legacy_user_id = excluded.legacy_user_id,
      username = excluded.username,
      display_name = excluded.display_name,
      role = excluded.role,
      division = excluded.division,
      language = excluded.language,
      disabled_at = null,
      locked_until = null,
      must_change_password = excluded.must_change_password,
      updated_at = now();

  return query select v_legacy_user_id;
end
$$;

revoke all on function public.provision_native_auth_app_user(uuid, text, text, text, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.provision_native_auth_app_user(uuid, text, text, text, text, text, text, boolean)
to service_role;

comment on function public.provision_native_auth_app_user(uuid, text, text, text, text, text, text, boolean) is
  'Server-only transactional provisioning and repair for the dual-auth profile/legacy-user link.';

commit;
