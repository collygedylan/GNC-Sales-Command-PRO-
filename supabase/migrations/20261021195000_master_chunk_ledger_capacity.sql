begin;
set local lock_timeout = '1s';
set local statement_timeout = '10s';
-- Match append_master_snapshot_stage_chunk_v1's bounded 2,000-row payload.
-- Retain existing 500-row receipts, digests, keys, cursors and publication state.
alter table app_sync_private.ph_master_snapshot_stage_chunks_v1
  drop constraint if exists ph_master_snapshot_stage_chunks_v1_row_count_check;
alter table app_sync_private.ph_master_snapshot_stage_chunks_v1
  add constraint ph_master_snapshot_stage_chunks_v1_row_count_check
  check (row_count >= 1 and row_count <= 2000);
commit;
