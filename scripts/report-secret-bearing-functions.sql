-- Read-only secret exposure inventory. It returns function identities only and
-- deliberately never prints function source or credential-like values.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and p.prosrc ~* '(onesignal|service[_ -]?role|api[_ -]?key|authorization[^a-z]+basic|authorization[^a-z]+bearer)'
order by function_schema, function_name, identity_arguments;
