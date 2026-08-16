-- Read-only evidence for retiring the high-churn compatibility event table.
select
  pg_size_pretty(pg_relation_size('public.ph_app_live_events')) as heap_size,
  pg_size_pretty(pg_indexes_size('public.ph_app_live_events')) as index_size,
  pg_size_pretty(pg_total_relation_size('public.ph_app_live_events')) as total_size,
  s.n_live_tup as live_rows_estimate,
  s.n_dead_tup as dead_rows_estimate,
  s.seq_scan,
  s.idx_scan,
  s.last_autovacuum
from pg_stat_user_tables s
where s.relid = 'public.ph_app_live_events'::regclass;

select
  n.nspname as table_schema,
  c.relname as table_name,
  t.tgname as trigger_name,
  p.proname as trigger_function,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and p.prokind in ('f', 'p')
  and (
    pg_get_functiondef(p.oid) ilike '%ph_app_live_events%'
    or pg_get_triggerdef(t.oid) ilike '%ph_app_live_events%'
  )
order by table_schema, table_name, trigger_name;

select n.nspname as function_schema, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prokind in ('f', 'p')
  and pg_get_functiondef(p.oid) ilike '%ph_app_live_events%'
order by function_schema, function_name;
