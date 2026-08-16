begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_table('public', 'profiles', 'profiles table exists');
select has_column('public', 'profiles', 'legacy_user_id', 'legacy link is retained');
select has_column('public', 'profiles', 'passkey_pilot', 'passkey pilot is server controlled');
select is((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), true, 'profiles has RLS enabled');
select has_function('private', 'current_profile', array[]::text[], 'current profile helper exists');
select has_function('private', 'has_profile_permission', array['text'], 'permission helper exists');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anonymous role cannot use private schema');

select * from finish();
rollback;
