begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select has_column('private', 'drive_evidence_idempotency', 'outcome_code', 'save outcomes are classified');
select has_column('private', 'drive_evidence_idempotency', 'expires_at', 'temporary conflict cache entries can expire');
select has_function('public', 'save_drive_evidence_v1', array['text','text','text','text','text','jsonb','boolean','text','text'], 'V1 compatibility RPC remains available');
select has_function('public', 'save_drive_evidence_v2', array['text','text','text','text','text','jsonb','jsonb','boolean','text','text'], 'V2 field-merge RPC is available');
select has_function('public', 'get_drive_evidence_save_health_v2', array[]::text[], 'service health RPC is available');
select ok(has_function_privilege('authenticated', 'public.save_drive_evidence_v1(text,text,text,text,text,jsonb,boolean,text,text)', 'execute'), 'authenticated old shells can use V1');
select ok(has_function_privilege('authenticated', 'public.save_drive_evidence_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text)', 'execute'), 'authenticated new shells can use V2');
select ok(not has_function_privilege('anon', 'public.save_drive_evidence_v1(text,text,text,text,text,jsonb,boolean,text,text)', 'execute'), 'anonymous cannot use V1');
select ok(not has_function_privilege('anon', 'public.save_drive_evidence_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text)', 'execute'), 'anonymous cannot use V2');
select ok(not has_function_privilege('authenticated', 'public.get_drive_evidence_save_health_v2()', 'execute'), 'authenticated clients cannot read save health');
select ok(has_function_privilege('service_role', 'public.get_drive_evidence_save_health_v2()', 'execute'), 'service role can read sanitized save health');
select ok(pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure) like '%pg_try_advisory_xact_lock%', 'save path uses try-locks');
select ok(pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure) not like '%FOR UPDATE%', 'save path never queues on a row lock');
select ok(pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure) like '%last_updated IS NOT DISTINCT FROM v_row.last_updated%', 'save path uses a conditional atomic update');
select is((public.get_drive_evidence_save_health_v2()->>'contractVersion')::text, 'drive-evidence-save-health-v2', 'health contract is versioned');

select * from finish();
rollback;
