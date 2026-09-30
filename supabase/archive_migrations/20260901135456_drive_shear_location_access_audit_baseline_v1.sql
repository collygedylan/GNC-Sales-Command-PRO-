begin;

-- Centralized access remains audit-only. Capture the current effective
-- decisions for the newly cataloged Drive Eval, Shear, and Location Work
-- permissions so every existing profile retains a complete immutable baseline.
-- Runtime authorization continues to be enforced by the dedicated server
-- operations and assignment checks.
insert into private.app_access_legacy_baseline
  (profile_id, permission_key, allowed, access_scope)
select p.id, effective.permission_key, effective.allowed, effective.access_scope
from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(
  p.id,
  private.resolve_app_access_policy_id_v1(true)
) effective
where effective.permission_key in (
  'eval_work.create.drive',
  'shear_location.create',
  'location_work.create',
  'location_work.complete'
)
on conflict (profile_id, permission_key) do nothing;

commit;
