begin;

-- The two accounts were created in Auth and the legacy directory, but their
-- public profile transaction did not finish. Link the existing identities;
-- do not create credentials or change either source account.
do $repair$
begin
  if to_regclass('public.ph_app_users') is null then
    return;
  end if;

  execute $sql$
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
)
select
  a.id,
  u.id,
  lower(btrim(u.username)),
  coalesce(
    nullif(btrim(a.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(a.raw_user_meta_data->>'username'), ''),
    lower(btrim(u.username))
  ),
  u.role,
  u.division,
  u.language,
  u.disabled_at,
  u.locked_until,
  u.must_change_password,
  now()
from auth.users a
join public.ph_app_users u
  on lower(split_part(coalesce(a.email, ''), '@', 1)) = lower(btrim(u.username))
where lower(btrim(u.username)) in ('madison_austin', 'madelyn_gray')
  and private.normalized_profile_role(u.role) = 'SALESMARKETING'
  and not exists (
    select 1 from public.profiles p
    where p.id = a.id
       or lower(btrim(p.username)) = lower(btrim(u.username))
       or p.legacy_user_id = u.id
  )
on conflict do nothing
  $sql$;
end
$repair$;

-- Capture a baseline for the repaired identities so the broad audit matrix
-- remains internally complete while their narrow live access is enforced.
insert into private.app_access_legacy_baseline
  (profile_id, permission_key, allowed, access_scope)
select p.id, e.permission_key, e.allowed, e.access_scope
from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(
  p.id,
  private.resolve_app_access_policy_id_v1(false)
) e
where lower(btrim(p.username)) in ('madison_austin', 'madelyn_gray')
on conflict (profile_id, permission_key) do nothing;

commit;
