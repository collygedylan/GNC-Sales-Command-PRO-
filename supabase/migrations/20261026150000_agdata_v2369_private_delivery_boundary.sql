begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke all privileges on table public.ph_request_delivery_outbox from public, anon, authenticated;
revoke all privileges on table public.ph_request_delivery_worker_state from public, anon, authenticated;
revoke all privileges on table public.ph_request_email_threads from public, anon, authenticated;
revoke all privileges on table public.ph_requests_completed_history from public, anon, authenticated;
revoke update(delivery_state) on table public.ph_requests_completed_history from public, anon, authenticated;
revoke all privileges on table public.ph_delivery_outbox from public, anon, authenticated;
revoke all privileges on table public.ph_request_delivery_status from public, anon, authenticated;

grant all privileges on table public.ph_request_delivery_outbox to service_role;
grant all privileges on table public.ph_request_delivery_worker_state to service_role;
grant all privileges on table public.ph_request_email_threads to service_role;
grant all privileges on table public.ph_requests_completed_history to service_role;
grant all privileges on table public.ph_delivery_outbox to service_role;
grant all privileges on table public.ph_request_delivery_status to service_role;

alter table public.ph_request_delivery_outbox enable row level security;
alter table public.ph_request_delivery_worker_state enable row level security;
alter table public.ph_request_email_threads enable row level security;
alter table public.ph_requests_completed_history enable row level security;
alter view public.ph_delivery_outbox set (security_invoker=true);
alter view public.ph_request_delivery_status set (security_invoker=true);

do $private_delivery_policies$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'ph_request_delivery_outbox',
        'ph_request_delivery_worker_state',
        'ph_request_email_threads',
        'ph_requests_completed_history'
      ])
      and roles && array['public'::name, 'anon'::name, 'authenticated'::name]
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$private_delivery_policies$;

revoke all privileges on function public.claim_request_delivery_events(integer,text) from public, anon, authenticated;
revoke all privileges on function public.complete_request_delivery_event(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all privileges on function public.fail_request_delivery_event(uuid,uuid,text) from public, anon, authenticated;
revoke all privileges on function public.heartbeat_request_delivery_worker(text,integer,integer,integer,boolean,text) from public, anon, authenticated;
revoke all privileges on function public.record_request_delivery_channel_result(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all privileges on function public.requeue_request_delivery(uuid) from public, anon, authenticated;
revoke all privileges on function public.get_request_delivery_recovery_queue() from public, anon, authenticated;

grant execute on function public.claim_request_delivery_events(integer,text) to service_role;
grant execute on function public.complete_request_delivery_event(uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_request_delivery_event(uuid,uuid,text) to service_role;
grant execute on function public.heartbeat_request_delivery_worker(text,integer,integer,integer,boolean,text) to service_role;
grant execute on function public.record_request_delivery_channel_result(uuid,uuid,jsonb) to service_role;
grant execute on function public.requeue_request_delivery(uuid) to service_role;
grant execute on function public.get_request_delivery_recovery_queue() to service_role;

do $private_delivery_contract$
declare
  relation_name text;
  relation_oid regclass;
  worker_function regprocedure;
begin
  foreach relation_name in array array[
    'ph_request_delivery_outbox',
    'ph_request_delivery_worker_state',
    'ph_request_email_threads',
    'ph_requests_completed_history',
    'ph_delivery_outbox',
    'ph_request_delivery_status'
  ] loop
    relation_oid := to_regclass(format('public.%I', relation_name));
    if relation_oid is null then
      raise exception using errcode='42P01', message='V2369_PRIVATE_DELIVERY_RELATION_MISSING:'||relation_name;
    end if;
    if has_table_privilege('anon', relation_oid, 'select')
       or has_table_privilege('anon', relation_oid, 'insert')
       or has_table_privilege('anon', relation_oid, 'update')
       or has_table_privilege('anon', relation_oid, 'delete')
       or has_any_column_privilege('anon', relation_oid, 'select')
       or has_any_column_privilege('anon', relation_oid, 'insert')
       or has_any_column_privilege('anon', relation_oid, 'update')
       or has_table_privilege('authenticated', relation_oid, 'select')
       or has_table_privilege('authenticated', relation_oid, 'insert')
       or has_table_privilege('authenticated', relation_oid, 'update')
       or has_table_privilege('authenticated', relation_oid, 'delete')
       or has_any_column_privilege('authenticated', relation_oid, 'select')
       or has_any_column_privilege('authenticated', relation_oid, 'insert')
       or has_any_column_privilege('authenticated', relation_oid, 'update') then
      raise exception using errcode='42501', message='V2369_PRIVATE_DELIVERY_ROLE_EXPOSED:'||relation_name;
    end if;
    if not has_table_privilege('service_role', relation_oid, 'select') then
      raise exception using errcode='42501', message='V2369_PRIVATE_DELIVERY_SERVICE_READ_MISSING:'||relation_name;
    end if;
  end loop;

  if exists(
    select 1 from pg_policies
    where schemaname='public'
      and tablename=any(array[
        'ph_request_delivery_outbox',
        'ph_request_delivery_worker_state',
        'ph_request_email_threads',
        'ph_requests_completed_history'
      ])
      and roles && array['public'::name, 'anon'::name, 'authenticated'::name]
  ) then
    raise exception using errcode='42501', message='V2369_PRIVATE_DELIVERY_POLICY_EXPOSED';
  end if;

  foreach worker_function in array array[
    'public.claim_request_delivery_events(integer,text)'::regprocedure,
    'public.complete_request_delivery_event(uuid,uuid,jsonb)'::regprocedure,
    'public.fail_request_delivery_event(uuid,uuid,text)'::regprocedure,
    'public.heartbeat_request_delivery_worker(text,integer,integer,integer,boolean,text)'::regprocedure,
    'public.record_request_delivery_channel_result(uuid,uuid,jsonb)'::regprocedure,
    'public.requeue_request_delivery(uuid)'::regprocedure,
    'public.get_request_delivery_recovery_queue()'::regprocedure
  ] loop
    if has_function_privilege('anon', worker_function, 'execute')
       or has_function_privilege('authenticated', worker_function, 'execute')
       or not has_function_privilege('service_role', worker_function, 'execute') then
      raise exception using errcode='42501', message='V2369_PRIVATE_DELIVERY_FUNCTION_EXPOSED:'||worker_function::text;
    end if;
  end loop;
end
$private_delivery_contract$;

notify pgrst, 'reload schema';
commit;
