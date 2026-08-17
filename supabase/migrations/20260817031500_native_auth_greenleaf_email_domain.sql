-- Change native Auth sign-in identifiers from the temporary internal domain to
-- the users' company-domain aliases. This preserves Auth UUIDs, passwords,
-- sessions, passkeys, app metadata, and profile links.

do $$
declare
  profile_count integer;
  auth_pair_count integer;
  invalid_username_count integer;
  target_collision_count integer;
begin
  select count(*) into profile_count from public.profiles;

  select count(*) into auth_pair_count
  from public.profiles p
  join auth.users u on u.id = p.id;

  select count(*) into invalid_username_count
  from public.profiles
  where trim(coalesce(username, '')) = ''
     or lower(trim(username)) !~ '^[a-z0-9._-]+$';

  select count(*) into target_collision_count
  from (
    select lower(trim(username)) || '@greenleafnursery.com'
    from public.profiles
    group by 1
    having count(*) > 1
  ) collisions;

  if profile_count = 0 or auth_pair_count <> profile_count then
    raise exception 'native_auth_email_domain_unlinked_profile';
  end if;
  if invalid_username_count <> 0 then
    raise exception 'native_auth_email_domain_invalid_username';
  end if;
  if target_collision_count <> 0 then
    raise exception 'native_auth_email_domain_target_collision';
  end if;
end
$$;

update auth.users u
set email = lower(trim(p.username)) || '@greenleafnursery.com',
    email_change = '',
    email_change_token_new = '',
    email_change_confirm_status = 0,
    updated_at = now()
from public.profiles p
where p.id = u.id
  and lower(coalesce(u.email, '')) <> lower(trim(p.username)) || '@greenleafnursery.com';

update auth.identities i
set email = lower(trim(p.username)) || '@greenleafnursery.com',
    identity_data = jsonb_set(
      coalesce(i.identity_data, '{}'::jsonb),
      '{email}',
      to_jsonb(lower(trim(p.username)) || '@greenleafnursery.com'),
      true
    ),
    updated_at = now()
from public.profiles p
where p.id = i.user_id
  and i.provider = 'email'
  and (
    lower(coalesce(i.email, '')) <> lower(trim(p.username)) || '@greenleafnursery.com'
    or lower(coalesce(i.identity_data ->> 'email', '')) <> lower(trim(p.username)) || '@greenleafnursery.com'
  );

do $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from public.profiles p
  join auth.users u on u.id = p.id
  left join auth.identities i on i.user_id = p.id and i.provider = 'email'
  where lower(coalesce(u.email, '')) <> lower(trim(p.username)) || '@greenleafnursery.com'
     or lower(coalesce(i.email, '')) <> lower(trim(p.username)) || '@greenleafnursery.com'
     or lower(coalesce(i.identity_data ->> 'email', '')) <> lower(trim(p.username)) || '@greenleafnursery.com';

  if remaining <> 0 then
    raise exception 'native_auth_email_domain_reconciliation_failed:%', remaining;
  end if;
end
$$;

-- Approval-only rollback (do not run as part of this migration):
-- update auth.users u
-- set email = lower(trim(p.username)) || '@auth.agmetricapp.invalid', updated_at = now()
-- from public.profiles p where p.id = u.id;
-- update auth.identities i
-- set email = lower(trim(p.username)) || '@auth.agmetricapp.invalid',
--     identity_data = jsonb_set(coalesce(i.identity_data, '{}'::jsonb), '{email}',
--       to_jsonb(lower(trim(p.username)) || '@auth.agmetricapp.invalid'), true),
--     updated_at = now()
-- from public.profiles p where p.id = i.user_id and i.provider = 'email';
