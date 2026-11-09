begin;
set local lock_timeout='4s';
set local statement_timeout='5s';

-- Only the small Drive Mode history projection needs this source-file proof
-- index. The raw workbook archive already has its own (file_id, unique_id).
create index if not exists ph_drive_mode_history_file_proof_v3047
on public.ph_drive_mode_history(source_file_id,source_unique_id)
include(history_key,report_date)
where source_kind='drive_around' and archive_reason='drive_file_snapshot';
commit;
