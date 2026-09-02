-- Production creates this index concurrently before recording the migration;
-- clean databases build the same partial cursor index during migration replay.
create index if not exists idx_ph_drive_history_item_date_uid
  on public.ph_drive_around_report_rows (itemcode, report_date desc, unique_id desc)
  where report_date is not null;
