-- Target only kzrnyjsosryejjejliii. One bounded maintenance transaction.
-- The archive had 406,561 dead tuples against a default vacuum threshold
-- of approximately 544,988; 10% + 1,000 lowers that threshold to 273,469.
-- Retain every archive row. No trigger, policy, RPC or receipt is replaced.
-- This file is an operational runbook, outside the release migration publisher.

BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '500ms';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM private.erp_sync_jobs
        WHERE active OR request_lease_until > now()
    ) THEN
        RAISE EXCEPTION 'MAINTENANCE_DEFERRED_ACTIVE_ERP';
    END IF;
END $$;

ALTER TABLE public.ph_drive_around_report_rows SET (
    autovacuum_vacuum_scale_factor = 0.1,
    autovacuum_vacuum_threshold = 1000
);

SELECT jsonb_build_object(
    'observed_at', now(),
    'prune_receipt', private.prune_supabase_transients_20261107(true, 2000),
    'archive_options', (
        SELECT reloptions FROM pg_class
        WHERE oid = 'public.ph_drive_around_report_rows'::regclass
    )
) AS maintenance_receipt;
COMMIT;
