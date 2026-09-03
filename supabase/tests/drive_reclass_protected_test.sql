begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select has_function('public', 'enqueue_drive_reclass_inquiry_v1', array['jsonb'], 'protected Drive Reclass enqueue exists');
select has_function('public', 'get_drive_reclass_inquiry_status_v1', array['text', 'text'], 'protected Drive Reclass status exists');
select has_function('public', 'retry_drive_reclass_inquiry_v1', array['text', 'text'], 'protected Drive Reclass retry exists');
select ok(not has_function_privilege('anon', 'public.enqueue_drive_reclass_inquiry_v1(jsonb)', 'execute'), 'anonymous cannot enqueue Drive Reclass');
select ok(not has_function_privilege('authenticated', 'public.enqueue_drive_reclass_inquiry_v1(jsonb)', 'execute'), 'authenticated browser cannot enqueue Drive Reclass directly');
select ok(has_function_privilege('service_role', 'public.enqueue_drive_reclass_inquiry_v1(jsonb)', 'execute'), 'service role may enqueue after app API authorization');
select ok(not has_function_privilege('authenticated', 'public.get_drive_reclass_inquiry_status_v1(text,text)', 'execute'), 'authenticated browser cannot read Drive Reclass status directly');
select ok(not has_function_privilege('authenticated', 'public.retry_drive_reclass_inquiry_v1(text,text)', 'execute'), 'authenticated browser cannot retry Drive Reclass directly');
select is((select count(*)::integer from private.app_access_permissions where permission_key = 'drive.reclass.submit' and active), 1, 'Drive Reclass permission is cataloged');
select is((select count(*)::integer from private.app_access_legacy_checks where permission_key = 'drive.reclass.submit'), 3, 'client, edge, and RPC enforcement surfaces are registered');
select is((select count(*)::integer from private.app_access_role_grants where permission_key = 'drive.reclass.submit' and allowed and role_key in ('ADMIN','ADMINISTRATOR','MANAGER') and access_scope = 'global'), 3 * (select count(*)::integer from private.app_access_policy_versions), 'all manager policy versions receive global scope');
select is((select count(*)::integer from private.app_access_role_grants where permission_key = 'drive.reclass.submit' and allowed and role_key in ('EVAL','EVALUATOR') and access_scope = 'assigned'), 2 * (select count(*)::integer from private.app_access_policy_versions), 'all evaluator policy versions receive assigned scope');
select is((
  select count(*)::integer
  from public.profiles p
  left join private.app_access_legacy_baseline b
    on b.profile_id = p.id
   and b.permission_key = 'drive.reclass.submit'
  where p.disabled_at is null
    and b.permission_key is null
), 0, 'Drive Reclass permission has an immutable baseline for every active profile');

select * from finish();
rollback;
