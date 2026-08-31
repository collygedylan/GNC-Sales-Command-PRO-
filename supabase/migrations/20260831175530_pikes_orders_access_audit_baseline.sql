begin;

-- Centralized access is still in audit mode. Capture the effective legacy
-- decision for the newly cataloged Orders permission so the audit matrix and
-- production health contract remain complete for every existing profile.
-- This baseline is observational only; private.can_view_manager_orders()
-- remains the authoritative runtime authorization helper.
insert into private.app_access_legacy_baseline
  (profile_id, permission_key, allowed, access_scope)
select p.id, effective.permission_key, effective.allowed, effective.access_scope
from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(
  p.id,
  private.resolve_app_access_policy_id_v1(true)
) effective
where effective.permission_key = 'manager.orders.view'
on conflict (profile_id, permission_key) do nothing;

commit;
