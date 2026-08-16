-- Read-only database bloat and usage report. Safe to run in production.
with relations as (
  select
    c.oid,
    n.nspname as schema_name,
    c.relname as relation_name,
    c.relkind,
    pg_relation_size(c.oid) as heap_bytes,
    pg_indexes_size(c.oid) as index_bytes,
    pg_total_relation_size(c.oid) as total_bytes
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'm')
)
select
  r.schema_name,
  r.relation_name,
  pg_size_pretty(r.heap_bytes) as heap_size,
  pg_size_pretty(r.index_bytes) as index_size,
  pg_size_pretty(r.total_bytes) as total_size,
  coalesce(s.n_live_tup, 0) as live_rows_estimate,
  coalesce(s.n_dead_tup, 0) as dead_rows_estimate,
  coalesce(s.seq_scan, 0) as sequential_scans,
  coalesce(s.idx_scan, 0) as index_scans,
  s.last_autovacuum,
  s.last_autoanalyze
from relations r
left join pg_stat_user_tables s on s.relid = r.oid
order by r.total_bytes desc;

select
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
from pg_stat_user_indexes
order by pg_relation_size(indexrelid) desc;

select
  queryid,
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  shared_blks_read,
  shared_blks_hit,
  left(regexp_replace(query, '\s+', ' ', 'g'), 300) as normalized_query
from pg_stat_statements
order by total_exec_time desc
limit 100;
