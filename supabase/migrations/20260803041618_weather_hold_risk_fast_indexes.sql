create index if not exists idx_ph_drive_around_report_rows_file_item
  on public.ph_drive_around_report_rows (file_id, itemcode, row_number);

create index if not exists idx_ph_drive_around_report_rows_item_file
  on public.ph_drive_around_report_rows (itemcode, file_id);

create index if not exists idx_ph_drive_around_report_files_status_report_date
  on public.ph_drive_around_report_files (
    status,
    coalesce(canonical_report_date, report_date),
    coalesce(canonical_sequence, 0),
    file_name
  );
