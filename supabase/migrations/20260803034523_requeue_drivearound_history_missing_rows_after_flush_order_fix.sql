-- Requeue DriveAround manifest rows that were marked row_indexed before
-- their row snapshots reached ph_drive_around_report_rows.
update public.ph_drive_around_report_files f
set
  status = 'indexed',
  row_count = 0,
  hold_row_count = 0,
  processed_at = null,
  error_message = 'Requeued: row snapshots missing after row_indexed manifest update.',
  raw = coalesce(f.raw, '{}'::jsonb) || jsonb_build_object(
    'requeued_missing_rows_at',
    now(),
    'requeued_missing_rows_reason',
    'row_indexed_without_ph_drive_around_report_rows_after_flush_order_fix'
  )
where lower(coalesce(f.status, '')) = 'row_indexed'
  and not exists (
    select 1
    from public.ph_drive_around_report_rows r
    where r.file_id = f.file_id
  );
