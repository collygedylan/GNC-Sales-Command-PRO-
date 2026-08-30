begin;

-- The V1 Codex server helper is Dylan-only while centralized access remains in
-- audit mode. Mirror that existing behavior in the draft matrix and extend the
-- immutable legacy baseline for the three newly cataloged permissions.
with draft as (
  select v.id
  from private.app_access_policy_versions v
  where v.status = 'draft'
  order by v.version_number desc
  limit 1
), dylan as (
  select p.id
  from public.profiles p
  where lower(btrim(p.username)) = 'dylan_collyge'
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
  limit 1
), permission(permission_key) as (
  values
    ('module.codex_ops.view'::text),
    ('codex_ops.submit'::text),
    ('codex_ops.approve'::text)
)
insert into private.app_access_user_overrides
  (policy_id, profile_id, permission_key, allowed, access_scope)
select draft.id, dylan.id, permission.permission_key, true, null
from draft
cross join dylan
cross join permission
on conflict (policy_id, profile_id, permission_key) do nothing;

insert into private.app_access_legacy_baseline
  (profile_id, permission_key, allowed, access_scope)
select p.id, effective.permission_key, effective.allowed, effective.access_scope
from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(
  p.id,
  private.resolve_app_access_policy_id_v1(true)
) effective
where effective.permission_key in (
  'module.codex_ops.view',
  'codex_ops.submit',
  'codex_ops.approve'
)
on conflict (profile_id, permission_key) do nothing;

commit;
