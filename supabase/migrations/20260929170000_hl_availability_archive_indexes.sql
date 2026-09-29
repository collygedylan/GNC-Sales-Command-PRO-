-- supabase-migration-disable-ddl-transaction
-- Concurrent indexes must run outside a transaction. Deploy as a standalone
-- migration so normal app queries remain available while the indexes build.

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  ph_master_inventory_hl_availability_lookup_idx
ON public.ph_master_inventory
  (upper(btrim(itemcode)), upper(btrim(contsize)), upper(btrim(lotcode)));

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  ph_drive_around_report_rows_archive_batch_idx
ON public.ph_drive_around_report_rows
  (created_at, unique_id);
