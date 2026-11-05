BEGIN;
CREATE OR REPLACE FUNCTION public.test_storage_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT (test_private.current_profile()).id IS NOT NULL $$;
CREATE OR REPLACE FUNCTION public.test_storage_write_ok(object_name text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE original text; BEGIN
 IF NOT public.test_storage_active() THEN RETURN false;END IF;
 IF object_name ~ '^erp-drops/(drive|cav|reserves|soc|hl-po)/[^/]+\.(xlsx|xls|csv|pdf)$' THEN RETURN lower((test_private.current_profile()).role) IN('admin','administrator','super-admin','super_admin','manager');END IF;
 IF split_part(object_name,'/',1)=auth.uid()::text THEN RETURN true;END IF;
 original:=substring(object_name from '^[^/]+/(.*)$');
 IF original LIKE 'drive-evidence/%' THEN RETURN public.test_can_upload_drive_evidence_v23115(original);END IF;
 RETURN split_part(object_name,'/',1) IN('chat_voice_notes','credit_photos','diagnostic_lab_reports','disease_training_assets','season_sales_notes_photos','location_sales_notes_photos','flyer_photos','qc_photos','eval_photos');
END $$;
REVOKE ALL ON FUNCTION public.test_storage_active(),public.test_storage_write_ok(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.test_storage_active(),public.test_storage_write_ok(text) TO authenticated;
CREATE POLICY agdata_test_bucket_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='farm-operations-staging' AND public.test_storage_active());
CREATE POLICY agdata_test_bucket_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='farm-operations-staging' AND public.test_storage_write_ok(name));
CREATE POLICY agdata_test_bucket_update ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='farm-operations-staging' AND public.test_storage_write_ok(name)) WITH CHECK(bucket_id='farm-operations-staging' AND public.test_storage_write_ok(name));
CREATE POLICY agdata_test_bucket_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='farm-operations-staging' AND public.test_storage_write_ok(name));
CREATE POLICY agdata_test_bucket_restrict ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>'farm-operations-staging' OR (auth.uid() IS NOT NULL AND public.test_storage_active())) WITH CHECK(bucket_id<>'farm-operations-staging' OR (auth.uid() IS NOT NULL AND public.test_storage_write_ok(name)));
COMMIT;
