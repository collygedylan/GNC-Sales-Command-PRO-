-- V2026.08.16.10 backend cleanup: final approval-gated relation removal.
-- RESTRICT is intentional: any unexpected dependency aborts the migration.

do $guard$
begin
  if to_regclass('public.ph_drive_around_report_rows_precleanup_20260816') is null then
    raise exception 'The pre-cleanup rollback relation is not present.';
  end if;
  if not exists (
    select 1
    from public.ph_drive_around_compaction_runs
    where phase = 'swapped_pending_drop'
      and cutoff_date = date '2025-08-16'
      and source_rows = shadow_rows
      and source_hash = shadow_hash
  ) then
    raise exception 'The verified table swap has not completed.';
  end if;
end;
$guard$;

with file_manifest as (
  select
    coalesce(sum(row_count), 0)::bigint as source_rows_total,
    coalesce(sum(row_count) filter (
      where coalesce(canonical_report_date, report_date) >= date '2025-08-16'
    ), 0)::bigint as retained_rows
  from public.ph_drive_around_report_files
  where status = 'row_indexed'
), relation_size as (
  select
    pg_relation_size('public.ph_drive_around_report_rows_precleanup_20260816')::bigint as table_bytes,
    pg_indexes_size('public.ph_drive_around_report_rows_precleanup_20260816')::bigint as index_bytes,
    pg_total_relation_size('public.ph_drive_around_report_rows_precleanup_20260816')::bigint as total_bytes
)
update public.ph_drive_around_compaction_runs r
set manifest = coalesce(r.manifest, '{}'::jsonb) || jsonb_build_object(
      'source_rows_total', f.source_rows_total,
      'retained_rows', f.retained_rows,
      'net_rows_removed', f.source_rows_total - f.retained_rows,
      'dropped_table_bytes', s.table_bytes,
      'dropped_index_bytes', s.index_bytes,
      'dropped_total_bytes', s.total_bytes,
      'drop_started_at', now()
    )
from file_manifest f cross join relation_size s
where r.id = (
  select id
  from public.ph_drive_around_compaction_runs
  where phase = 'swapped_pending_drop'
  order by verified_at desc
  limit 1
);

drop table public.ph_drive_around_report_rows_precleanup_20260816 restrict;

alter table public.ph_drive_around_report_rows
  rename constraint ph_drive_around_report_rows_compact_pkey
  to ph_drive_around_report_rows_pkey;
alter table public.ph_drive_around_report_rows
  rename constraint ph_drive_around_report_rows_compact_file_id_row_number_key
  to ph_drive_around_report_rows_file_row_unique;

alter index public.ph_drive_around_compact_item_date_idx
  rename to idx_ph_drive_around_report_rows_item_date;
alter index public.ph_drive_around_compact_item_key_date_idx
  rename to idx_ph_drive_around_report_rows_item_key_date;
alter index public.ph_drive_around_compact_hold_idx
  rename to idx_ph_drive_around_report_rows_hold_date_item_partial;

analyze public.ph_drive_around_report_rows;

update public.ph_drive_around_compaction_runs
set phase = 'cleanup_complete',
    manifest = coalesce(manifest, '{}'::jsonb) || jsonb_build_object(
      'drop_completed_at', now(),
      'release', 'V2026.08.16.10-backend-cleanup'
    ),
    approved_at = coalesce(approved_at, now())
where id = (
  select id
  from public.ph_drive_around_compaction_runs
  where phase = 'swapped_pending_drop'
  order by verified_at desc
  limit 1
);
