BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $quota$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND regexp_replace(tablename,'^test_','') = ANY(ARRAY['ph_master_inventory','ph_reserves','ph_customer_reserves','ph_27f1_hl_po','ph_27s1_hl_po','ph_hl_po','ph_soc_master','ph_drive_around_report_rows','ph_hold_stop_itemcode_summaries','ph_hold_stop_itemcode_cycles','ph_hold_learning_profiles','ph_weather_daily','ph_erp_sync_runs'])
  LOOP EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I',r.schemaname,r.tablename); END LOOP;
END $quota$;
ALTER ROLE anon SET log_statement='none';
ALTER ROLE authenticated SET log_statement='none';
ALTER ROLE service_role SET log_statement='none';
ALTER ROLE postgres SET log_statement='none';
COMMIT;
SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND (tablename LIKE '%dataset_revisions' OR tablename IN ('ph_reserves','ph_soc_master','test_ph_reserves','test_ph_soc_master'));
