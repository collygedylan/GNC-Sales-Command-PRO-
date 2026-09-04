begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_function('public', 'get_photo_delivery_health_v1', array[]::text[], 'photo delivery health RPC exists');
select ok(not has_function_privilege('anon', 'public.get_photo_delivery_health_v1()', 'execute'), 'anonymous cannot inspect photo health');
select ok(not has_function_privilege('authenticated', 'public.get_photo_delivery_health_v1()', 'execute'), 'authenticated clients cannot inspect photo health');
select ok(has_function_privilege('service_role', 'public.get_photo_delivery_health_v1()', 'execute'), 'service role can inspect sanitized photo health');
select has_table('private', 'photo_delivery_health_baseline_v1', 'photo health release baseline is durable');
select ok(not has_table_privilege('authenticated', 'private.photo_delivery_health_baseline_v1', 'select'), 'clients cannot read the private health baseline');
select is((select shell_version from private.photo_delivery_health_baseline_v1 where baseline_key = 'photo-egress-v1'), 'V2026.09.04.04', 'photo health baseline identifies the release');

select * from finish();
rollback;
