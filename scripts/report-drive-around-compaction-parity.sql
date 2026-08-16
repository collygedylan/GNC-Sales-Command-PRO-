-- Read-only parity report for the .08 compact shadow. Run after every batch
-- and before any mirror, rename, or cleanup approval.
\set cutoff_date '2025-08-16'

with source as (
  select
    count(*)::bigint as row_count,
    count(distinct file_id)::bigint as file_count,
    md5(sum(hashtextextended(coalesce(row_hash, unique_id), 0)::numeric)::text) as rows_hash
  from public.ph_drive_around_report_rows
  where report_date >= :'cutoff_date'::date
), shadow as (
  select
    count(*)::bigint as row_count,
    count(distinct file_id)::bigint as file_count,
    md5(sum(hashtextextended(coalesce(row_hash, unique_id), 0)::numeric)::text) as rows_hash
  from public.ph_drive_around_report_rows_compact
  where report_date >= :'cutoff_date'::date
)
select
  source.row_count as source_rows,
  shadow.row_count as shadow_rows,
  source.file_count as source_files,
  shadow.file_count as shadow_files,
  source.rows_hash as source_hash,
  shadow.rows_hash as shadow_hash,
  source.row_count = shadow.row_count
    and source.file_count = shadow.file_count
    and source.rows_hash = shadow.rows_hash as parity_ok
from source cross join shadow;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('ph_drive_around_report_rows', 'ph_drive_around_report_rows_compact')
order by tablename, indexname;
