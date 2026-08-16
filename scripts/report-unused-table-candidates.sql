-- Read-only evidence report for approval-only unused-table candidates.
-- Review row counts, size, scans, foreign-key dependencies, views, and
-- function references before considering the separate DROP migration.
with candidates(table_name) as (
  values
    ('ph_chat_members'),
    ('ph_chat_threads'),
    ('ph_employee_time_cards'),
    ('ph_security_audit_events'),
    ('ph_walkie_voice_messages'),
    ('ph_outlook_accounts'),
    ('ph_eval_assignment_rules')
), relations as (
  select
    c.table_name,
    cls.oid,
    pg_total_relation_size(cls.oid) as total_bytes
  from candidates c
  left join pg_class cls
    on cls.relname = c.table_name
   and cls.relnamespace = 'public'::regnamespace
   and cls.relkind in ('r', 'p')
)
select
  r.table_name,
  r.oid is not null as exists,
  pg_size_pretty(coalesce(r.total_bytes, 0)) as total_size,
  coalesce(s.n_live_tup, 0) as live_rows_estimate,
  coalesce(s.n_dead_tup, 0) as dead_rows_estimate,
  coalesce(s.seq_scan, 0) as sequential_scans,
  coalesce(s.idx_scan, 0) as index_scans,
  s.last_analyze,
  s.last_autoanalyze
from relations r
left join pg_stat_user_tables s on s.relid = r.oid
order by r.table_name;

with candidates as (
  select to_regclass('public.' || table_name) as relation_oid, table_name
  from (values
    ('ph_chat_members'), ('ph_chat_threads'), ('ph_employee_time_cards'),
    ('ph_security_audit_events'), ('ph_walkie_voice_messages'),
    ('ph_outlook_accounts'), ('ph_eval_assignment_rules')
  ) candidate(table_name)
)
select
  c.table_name,
  pg_describe_object(d.classid, d.objid, d.objsubid) as dependent_object,
  d.deptype
from candidates c
join pg_depend d on d.refobjid = c.relation_oid
where c.relation_oid is not null
  and d.deptype not in ('i', 'a')
order by c.table_name, dependent_object;

with candidates(table_name) as (
  values
    ('ph_chat_members'), ('ph_chat_threads'), ('ph_employee_time_cards'),
    ('ph_security_audit_events'), ('ph_walkie_voice_messages'),
    ('ph_outlook_accounts'), ('ph_eval_assignment_rules')
)
select
  c.table_name,
  n.nspname as function_schema,
  p.proname as function_name
from candidates c
join pg_proc p on p.prosrc ilike '%' || c.table_name || '%'
join pg_namespace n on n.oid = p.pronamespace
order by c.table_name, function_schema, function_name;
