begin;

-- Centralized access remains audit-only. Capture the current effective Drive
-- Reclass decision for every existing profile so the new permission has the
-- same immutable baseline coverage as the rest of the access catalog.
insert into private.app_access_legacy_baseline
  (profile_id, permission_key, allowed, access_scope)
select p.id, effective.permission_key, effective.allowed, effective.access_scope
from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(
  p.id,
  private.resolve_app_access_policy_id_v1(true)
) effective
where effective.permission_key = 'drive.reclass.submit'
on conflict (profile_id, permission_key) do nothing;

commit;
