BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- Public-safe availability projection. The caller must provide 1-500 item
-- codes. The function returns inventory rows only and never exposes order,
-- customer, or destination fields.
CREATE OR REPLACE FUNCTION public.hl_order_inventory_availability(
  p_itemcodes text[]
)
RETURNS TABLE (
  itemcode text,
  contsize text,
  season_lot text,
  computed_balance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_codes text[];
BEGIN
  SELECT coalesce(array_agg(code ORDER BY code), ARRAY[]::text[])
  INTO v_codes
  FROM (
    SELECT DISTINCT upper(btrim(raw_code)) AS code
    FROM unnest(coalesce(p_itemcodes, ARRAY[]::text[])) AS request(raw_code)
    WHERE nullif(btrim(raw_code), '') IS NOT NULL
  ) AS requested;

  IF cardinality(v_codes) = 0 OR cardinality(v_codes) > 500 THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'HL_AVAILABILITY_ITEMCODES_MUST_CONTAIN_1_TO_500_VALUES';
  END IF;

  RETURN QUERY
  WITH inventory_rows AS MATERIALIZED (
    SELECT
      upper(btrim(m.itemcode)) AS itemcode,
      upper(btrim(m.contsize)) AS contsize,
      upper(btrim(m.lotcode)) AS season_lot,
      CASE
        WHEN nullif(btrim(coalesce(m.ptravailable::text, '')), '')
               ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN m.ptravailable::numeric
        ELSE 0::numeric
      END AS available
    FROM public.ph_master_inventory AS m
    WHERE upper(btrim(m.itemcode)) = ANY(v_codes)
      AND upper(btrim(m.lotcode)) IN ('27.F1', '27.S1')
      AND lower(btrim(coalesce(m.app_tab_assignment, '')))
          NOT IN (
            'not_on_inventory_dylan',
            'not_on_inventory_jd',
            'not_on_inventory_denied'
          )
  ),
  inventory AS (
    SELECT itemcode, contsize, season_lot, sum(available) AS available
    FROM inventory_rows
    GROUP BY itemcode, contsize, season_lot
  ),
  active_po AS MATERIALIZED (
    SELECT
      upper(btrim(b.itemcode)) AS itemcode,
      upper(btrim(b.size)) AS contsize,
      upper(btrim(b.lot)) AS season_lot,
      sum(coalesce(b.remaining, 0)) AS allocations
    FROM hl_order_private.po_balances_v2() AS b
    WHERE upper(btrim(b.itemcode)) = ANY(v_codes)
      AND b.lot IN ('27.F1', '27.S1')
      AND b.status = 'ready'
    GROUP BY 1, 2, 3
  )
  SELECT
    i.itemcode,
    i.contsize,
    i.season_lot,
    greatest(0::numeric, coalesce(i.available, 0) - coalesce(p.allocations, 0))
  FROM inventory AS i
  LEFT JOIN active_po AS p
    ON p.itemcode = i.itemcode
   AND p.contsize = i.contsize
   AND p.season_lot = i.season_lot;
END;
$function$;

REVOKE ALL
ON FUNCTION public.hl_order_inventory_availability(text[])
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.hl_order_inventory_availability(text[])
TO anon, authenticated;

COMMENT ON FUNCTION public.hl_order_inventory_availability(text[]) IS
  'Returns computed availability for 1-500 requested item codes; output is limited to itemcode, contsize, inventory season_lot, and computed_balance.';

-- Keep the raw purchase-order source and immutable previews restricted. This
-- migration deliberately adds no direct read or mutation grants on those
-- relations.

-- Durable full-row archive. Keep it private and retain records indefinitely.
CREATE TABLE IF NOT EXISTS public.ph_drive_around_report_rows_archive
  (LIKE public.ph_drive_around_report_rows INCLUDING ALL);

ALTER TABLE public.ph_drive_around_report_rows_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ph_drive_around_report_rows_archive
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ph_drive_around_report_rows_archive TO service_role;

-- The canonical compact relation was renamed to ph_drive_around_report_rows
-- during the 2026-08-16 compaction swap. Keep a separately named compact
-- staging relation as explicit row-level evidence for this retention process.
-- The scheduled routine copies a bounded batch into it, verifies matching
-- unique_ids, archives the rows, then removes them from the live table, all in
-- one transaction. If any statement fails, the batch rolls back as a unit.
CREATE TABLE IF NOT EXISTS public.ph_drive_around_report_rows_compact
  (LIKE public.ph_drive_around_report_rows INCLUDING ALL);

ALTER TABLE public.ph_drive_around_report_rows_compact ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ph_drive_around_report_rows_compact
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ph_drive_around_report_rows_compact TO service_role;

CREATE OR REPLACE FUNCTION private.archive_compacted_drive_around_rows(
  p_batch_size integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 5000), 1), 10000);
  v_archived integer := 0;
BEGIN
  WITH source_batch AS MATERIALIZED (
    SELECT live.*
    FROM public.ph_drive_around_report_rows AS live
    WHERE live.created_at < now() - interval '12 months'
    ORDER BY live.created_at, live.unique_id
    LIMIT v_batch_size
    FOR UPDATE OF live SKIP LOCKED
  ), compacted AS (
    INSERT INTO public.ph_drive_around_report_rows_compact
    SELECT source_batch.* FROM source_batch
    ON CONFLICT (unique_id) DO UPDATE SET
      file_id = excluded.file_id,
      file_name = excluded.file_name,
      report_date = excluded.report_date,
      row_number = excluded.row_number,
      item_key = excluded.item_key,
      itemcode = excluded.itemcode,
      commonname = excluded.commonname,
      genus = excluded.genus,
      contsize = excluded.contsize,
      locationcode = excluded.locationcode,
      lotcode = excluded.lotcode,
      season = excluded.season,
      blockalpha = excluded.blockalpha,
      salesyear = excluded.salesyear,
      ptravailable = excluded.ptravailable,
      holdstopcode = excluded.holdstopcode,
      holdstopreason = excluded.holdstopreason,
      holdstopbegindate_raw = excluded.holdstopbegindate_raw,
      hold_reason_category = excluded.hold_reason_category,
      row_hash = excluded.row_hash,
      updated_at = excluded.updated_at
    RETURNING unique_id
  ), verified AS MATERIALIZED (
    SELECT live.unique_id
    FROM public.ph_drive_around_report_rows AS live
    JOIN compacted USING (unique_id)
    WHERE live.created_at < now() - interval '12 months'
      AND EXISTS (
        SELECT 1
        FROM public.ph_drive_around_report_rows_compact AS compact
        WHERE compact.unique_id = live.unique_id
      )
  ), moved AS (
    DELETE FROM public.ph_drive_around_report_rows AS live
    USING verified
    WHERE live.unique_id = verified.unique_id
      AND live.created_at < now() - interval '12 months'
      AND EXISTS (
        SELECT 1
        FROM public.ph_drive_around_report_rows_compact AS compact
        WHERE compact.unique_id = live.unique_id
      )
    RETURNING live.*
  ), archived AS (
    INSERT INTO public.ph_drive_around_report_rows_archive
    SELECT moved.* FROM moved
    ON CONFLICT (unique_id) DO UPDATE SET
      file_id = excluded.file_id,
      file_name = excluded.file_name,
      report_date = excluded.report_date,
      row_number = excluded.row_number,
      item_key = excluded.item_key,
      itemcode = excluded.itemcode,
      commonname = excluded.commonname,
      genus = excluded.genus,
      contsize = excluded.contsize,
      locationcode = excluded.locationcode,
      lotcode = excluded.lotcode,
      season = excluded.season,
      blockalpha = excluded.blockalpha,
      salesyear = excluded.salesyear,
      ptravailable = excluded.ptravailable,
      holdstopcode = excluded.holdstopcode,
      holdstopreason = excluded.holdstopreason,
      holdstopbegindate_raw = excluded.holdstopbegindate_raw,
      hold_reason_category = excluded.hold_reason_category,
      row_hash = excluded.row_hash,
      updated_at = excluded.updated_at
    RETURNING unique_id
  )
  SELECT count(*)::integer INTO v_archived FROM archived;

  RETURN v_archived;
END;
$function$;

REVOKE ALL
ON FUNCTION private.archive_compacted_drive_around_rows(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION private.archive_compacted_drive_around_rows(integer)
TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive_compacted_drive_around_rows') THEN
    PERFORM cron.unschedule('archive_compacted_drive_around_rows');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum_analyze_drive_around_rows') THEN
    PERFORM cron.unschedule('vacuum_analyze_drive_around_rows');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum_analyze_drive_around_archive') THEN
    PERFORM cron.unschedule('vacuum_analyze_drive_around_archive');
  END IF;

  PERFORM cron.schedule(
    'archive_compacted_drive_around_rows',
    '0 4 * * *',
    'SELECT private.archive_compacted_drive_around_rows(5000);'
  );
  -- VACUUM must execute as standalone statements, so schedule one job per table.
  PERFORM cron.schedule(
    'vacuum_analyze_drive_around_rows',
    '0 2 * * 0',
    'VACUUM (ANALYZE) public.ph_drive_around_report_rows;'
  );
  PERFORM cron.schedule(
    'vacuum_analyze_drive_around_archive',
    '5 2 * * 0',
    'VACUUM (ANALYZE) public.ph_drive_around_report_rows_archive;'
  );
END;
$schedule$;

CREATE SCHEMA IF NOT EXISTS maintenance;
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW maintenance.hl_database_health AS
SELECT
  c.oid::regclass::text AS relation_name,
  pg_relation_size(c.oid) AS heap_bytes,
  pg_indexes_size(c.oid) AS index_bytes,
  pg_total_relation_size(c.oid) AS total_bytes,
  coalesce(s.n_live_tup, 0) AS estimated_live_rows,
  coalesce(s.n_dead_tup, 0) AS estimated_dead_rows,
  coalesce(s.seq_scan, 0) AS sequential_scans,
  coalesce(s.idx_scan, 0) AS index_scans,
  s.last_autovacuum,
  s.last_autoanalyze
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables AS s ON s.relid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'm')
  AND c.relname IN (
    'ph_27f1_hl_po',
    'ph_hold_stop_itemcode_snapshots',
    'ph_drive_around_report_rows',
    'ph_drive_around_report_rows_compact',
    'ph_drive_around_report_rows_archive',
    'ph_hl_po',
    'ph_hl_order_previews'
  );

GRANT SELECT ON maintenance.hl_database_health TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
