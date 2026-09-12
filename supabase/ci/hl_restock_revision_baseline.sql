-- PGlite-only missing account-policy plumbing. Native CI loads the real
-- centralized access policies and dataset revision migrations instead.
alter table public.profiles add column if not exists division text default '10';
create function private.resolve_app_access_policy_id_v1(boolean) returns bigint language sql stable as $$ select 1::bigint $$;
create function private.get_effective_app_permissions_v1(uuid,bigint)
returns table(permission_key text,permission_kind text,module_key text,allowed boolean)
language sql stable as $$ select 'module.'||m||'.view','module',m,exists(select 1 from public.profiles where id=$1 and disabled_at is null)
from unnest(array['drive','po-management']) m $$;
create function private.can_view_access_control_v2() returns boolean language sql stable as $$
select exists(select 1 from public.profiles where id=auth.uid() and role in ('ADMIN','MANAGER') and disabled_at is null) $$;
