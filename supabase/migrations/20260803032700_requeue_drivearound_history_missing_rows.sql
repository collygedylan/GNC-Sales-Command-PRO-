-- Requeue historical DriveAround files whose manifest says row_indexed but whose
-- row snapshots are absent. This is metadata-only; it does not alter live inventory.
update public.ph_drive_around_report_files f
set
  status = 'indexed',
  row_count = 0,
  hold_row_count = 0,
  error_message = 'Row snapshots missing; queued for history backfill.',
  raw = coalesce(f.raw, '{}'::jsonb) || jsonb_build_object(
    'requeued_for_history_backfill_at', now(),
    'requeue_reason', 'manifest_row_indexed_without_ph_drive_around_report_rows'
  )
where f.status = 'row_indexed'
  and not exists (
    select 1
    from public.ph_drive_around_report_rows r
    where r.file_id = f.file_id
  );
