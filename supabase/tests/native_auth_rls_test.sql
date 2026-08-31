begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_table('public', 'profiles', 'profiles table exists');
select has_column('public', 'profiles', 'legacy_user_id', 'legacy link is retained');
select has_column('public', 'profiles', 'passkey_pilot', 'passkey pilot is server controlled');
select is((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), true, 'profiles has RLS enabled');
select has_function('private', 'current_profile', array[]::text[], 'current profile helper exists');
select has_function('private', 'has_profile_permission', array['text'], 'permission helper exists');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anonymous role cannot use private schema');
select has_function(
  'public',
  'provision_native_auth_app_user',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'boolean'],
  'server-only dual-auth provisioning function exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.provision_native_auth_app_user(uuid,text,text,text,text,text,text,boolean)',
    'execute'
  ),
  'service role can provision linked native accounts'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.provision_native_auth_app_user(uuid,text,text,text,text,text,text,boolean)',
    'execute'
  ),
  'authenticated users cannot call the provisioning function'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.provision_native_auth_app_user(uuid,text,text,text,text,text,text,boolean)',
    'execute'
  ),
  'anonymous users cannot call the provisioning function'
);

select * from finish();
rollback;
