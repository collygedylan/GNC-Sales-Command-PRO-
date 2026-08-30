begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('private', 'codex_ops_tasks', 'private task projection exists');
select has_table('private', 'codex_ops_messages', 'private messages exist');
select has_table('private', 'codex_ops_events', 'private events exist');
select has_table('private', 'codex_ops_attachments', 'private attachments exist');
select has_table('private', 'codex_ops_approvals', 'private approvals exist');
select has_table('private', 'codex_ops_dispatches', 'private dispatches exist');
select has_table('private', 'codex_ops_audit_events', 'private audit exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname like 'codex_ops_%' and c.relkind = 'r'), 'all Codex tables have RLS');
select ok(not has_table_privilege('anon', 'private.codex_ops_tasks', 'select'), 'anonymous callers cannot select private tasks');
select ok(not has_table_privilege('authenticated', 'private.codex_ops_tasks', 'select'), 'authenticated cannot select private tasks');
select ok(not has_table_privilege('authenticated', 'private.codex_ops_attachments', 'insert'), 'authenticated cannot write private attachments');
select has_function('public', 'get_codex_ops_capabilities_v1', array[]::text[], 'capabilities RPC exists');
select has_function('public', 'create_codex_ops_task_v1', array['text', 'uuid'], 'task RPC exists');
select has_function('public', 'approve_codex_ops_deployment_v1', array['uuid', 'integer', 'text', 'uuid'], 'exact SHA approval RPC exists');
select has_function('public', 'apply_codex_ops_service_event_v1', array['uuid', 'integer', 'text', 'jsonb'], 'service event RPC exists');
select has_function('public', 'apply_codex_ops_repair_result_service_v2', array['uuid', 'integer', 'jsonb'], 'bounded Terra result RPC exists');
select ok(has_function_privilege('authenticated', 'public.get_codex_ops_capabilities_v1()', 'execute'), 'authenticated may call guarded capability RPC');
select ok(not has_function_privilege('authenticated', 'public.apply_codex_ops_service_event_v1(uuid,integer,text,jsonb)', 'execute'), 'authenticated cannot call runner mutation RPC');
select is((select public from storage.buckets where id = 'codex-ops-evidence-v1'), false, 'evidence bucket is private');

select * from finish();
rollback;
