begin;

set local lock_timeout = '5s';

-- Repair only Nelly's missing audit snapshot. The baseline records are used
-- for access-policy comparison; this migration does not grant permissions.
do $repair_nelly_baseline$
declare
  target_profile_id constant uuid := '961b0a0f-11a6-4db5-b066-582f772ab8e7';
  target_profile public.profiles;
  target_policy_id bigint;
  active_permission_count bigint;
  remaining_missing_count bigint;
begin
  select p.*
    into target_profile
  from public.profiles p
  where p.id = target_profile_id
  for update;

  if not found
     or lower(btrim(target_profile.username)) <> 'nelly_aguilar'
     or private.normalized_profile_role(target_profile.role) <> 'ADMIN'
     or target_profile.disabled_at is not null
     or (target_profile.locked_until is not null and target_profile.locked_until > statement_timestamp())
     or target_profile.must_change_password then
    raise exception using
      errcode = '55000',
      message = 'NELLY_BASELINE_TARGET_IDENTITY_MISMATCH';
  end if;

  if (select count(*) from public.profiles p
      where lower(btrim(p.username)) = 'nelly_aguilar') <> 1 then
    raise exception using
      errcode = '55000',
      message = 'NELLY_BASELINE_TARGET_IDENTITY_MISMATCH';
  end if;

  -- Match the existing native/legacy active-profile identity checks when
  -- this profile is linked to a legacy account.
  if target_profile.legacy_user_id is not null and not exists (
    select 1
    from public.ph_app_users u
    where u.id = target_profile.legacy_user_id
      and lower(btrim(u.username)) = lower(btrim(target_profile.username))
      and u.disabled_at is null
      and (u.locked_until is null or u.locked_until <= statement_timestamp())
      and not u.must_change_password
  ) then
    raise exception using
      errcode = '55000',
      message = 'NELLY_BASELINE_TARGET_IDENTITY_MISMATCH';
  end if;

  target_policy_id := private.resolve_app_access_policy_id_v1(true);
  if target_policy_id is null then
    raise exception using
      errcode = '55000',
      message = 'NELLY_BASELINE_AUDIT_POLICY_MISSING';
  end if;

  select count(*)
    into active_permission_count
  from private.app_access_permissions
  where active;

  if active_permission_count = 0 or (
    select count(*) from private.get_effective_app_permissions_v1(target_profile.id, target_policy_id)
  ) <> active_permission_count then
    raise exception using
      errcode = '55000',
      message = 'NELLY_BASELINE_PERMISSION_CONTRACT_CHANGED';
  end if;

  insert into private.app_access_legacy_baseline
    (profile_id, permission_key, allowed, access_scope)
  select target_profile.id, effective.permission_key, effective.allowed, effective.access_scope
  from private.get_effective_app_permissions_v1(target_profile.id, target_policy_id) effective
  on conflict (profile_id, permission_key) do nothing;

  select count(*)
    into remaining_missing_count
  from private.get_effective_app_permissions_v1(target_profile.id, target_policy_id) effective
  left join private.app_access_legacy_baseline baseline
    on baseline.profile_id = target_profile.id
   and baseline.permission_key = effective.permission_key
  where baseline.permission_key is null;

  if remaining_missing_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'NELLY_BASELINE_REPAIR_INCOMPLETE';
  end if;
end;
$repair_nelly_baseline$;

commit;
