BEGIN;
CREATE OR REPLACE FUNCTION public.test_sync_file_metadata(object_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('id',id,'name',name,'created_at',created_at,'updated_at',updated_at,'metadata',metadata) INTO result FROM storage.objects WHERE id=object_id AND bucket_id='farm-operations-staging' AND name LIKE 'erp-drops/%';RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.test_sync_file_metadata(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.test_sync_file_metadata(uuid) TO service_role;
COMMIT;
