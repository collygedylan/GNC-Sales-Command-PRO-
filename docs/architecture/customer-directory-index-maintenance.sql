-- Operational maintenance: run statements separately on one persistent connection.
-- Never pass this file to the atomic migration publisher or --single-transaction.
-- Target only kzrnyjsosryejjejliii. The caller verifies the connection identity,
-- unchanged backend PID, no active index build and the session limits below.
-- Measured baseline: active customer/consignee ordered page, 531.024 ms,
-- 14,675 scanned rows, 7,060 matches, 3,192 shared hits, top-N sort.
-- See backend-db-readonly-audit-20261108.txt in the Release Evidence directory.

SET application_name = 'gnc_customer_directory_index';
SET lock_timeout = '500ms';
SET statement_timeout = '30s';
SET max_parallel_maintenance_workers = 0;

SELECT pg_backend_pid() AS backend_pid,
       current_database() AS database_name,
       current_setting('application_name') AS application_name,
       current_setting('lock_timeout') AS lock_timeout,
       current_setting('statement_timeout') AS statement_timeout;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ph_ccsr_active_customer_consignee_names_idx
    ON public.ph_customer_consignee_sales_reps (customername, consigneename)
    WHERE customerstatus = 'A' AND consigneestatus = 'A';

SELECT i.indisvalid, i.indisready, i.indislive,
       pg_get_indexdef(i.indexrelid) AS definition,
       pg_relation_size(i.indexrelid) AS index_bytes
FROM pg_index i
WHERE i.indexrelid =
    'public.ph_ccsr_active_customer_consignee_names_idx'::regclass;

EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT unique_id, customername, consigneename, salesrepname, salesrepid,
       customeridentityid, consigneeid, territorycode, territorydesc,
       customerstatus, consigneestatus
FROM public.ph_customer_consignee_sales_reps
WHERE customerstatus = 'A' AND consigneestatus = 'A'
ORDER BY customername, consigneename
LIMIT 1000;
