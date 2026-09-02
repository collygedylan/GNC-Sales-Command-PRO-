begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select has_function('public', 'create_eval_report2_batch_v1', array['jsonb'], 'stale-safe report batch creation exists');
select has_function('public', 'list_eval_report2_itemcodes_v1', array['jsonb'], 'flat keyset report operation exists');
select has_function('public', 'reconcile_eval_report2_work_v1', array['text','boolean','integer'], 'import reconciliation exists');
select has_function('public', 'get_eval_report2_direct_inquiry_recipients_v1', array['text'], 'direct inquiry recipient resolver exists');

select ok(not has_function_privilege('authenticated', 'public.create_eval_report2_batch_v1(jsonb)', 'execute'), 'authenticated cannot call batch RPC directly');
select ok(not has_function_privilege('authenticated', 'public.list_eval_report2_itemcodes_v1(jsonb)', 'execute'), 'authenticated cannot call report RPC directly');
select ok(not has_function_privilege('authenticated', 'public.reconcile_eval_report2_work_v1(text,boolean,integer)', 'execute'), 'authenticated cannot reconcile work');
select ok(not has_function_privilege('authenticated', 'public.get_eval_report2_direct_inquiry_recipients_v1(text)', 'execute'), 'authenticated cannot resolve direct recipients');

select ok(has_function_privilege('service_role', 'public.create_eval_report2_batch_v1(jsonb)', 'execute'), 'service role can create batches');
select ok(has_function_privilege('service_role', 'public.list_eval_report2_itemcodes_v1(jsonb)', 'execute'), 'service role can read keyset pages');
select ok(has_function_privilege('service_role', 'public.reconcile_eval_report2_work_v1(text,boolean,integer)', 'execute'), 'service role can reconcile work');
select ok(has_function_privilege('service_role', 'public.get_eval_report2_direct_inquiry_recipients_v1(text)', 'execute'), 'service role can resolve recipients');

select ok(
  pg_get_functiondef('private.eval_report2_item_qualifies_v1(text,text,timestamp with time zone)'::regprocedure)
    ~ E'in \\(''Y'', ''U3''\\).*SHFT',
  'shared predicate excludes Y and U3 SHFT rows'
);
select ok(
  pg_get_functiondef('public.reconcile_eval_report2_work_v1(text,boolean,integer)'::regprocedure)
    !~ 'ph_request_delivery_outbox',
  'import resolution never queues delivery'
);
select ok(
  pg_get_functiondef('public.create_eval_work_batch_v2(jsonb)'::regprocedure)
    !~ 'jsonb_array_length\\(context_rows\\) > 100',
  'all current ITEMCODE rows can be snapshotted'
);

select * from finish();
rollback;
