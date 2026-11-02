BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
-- Exact-row blobs are already authorized by store_drive_photo_blob_v1. Index metadata only.
CREATE OR REPLACE FUNCTION private.index_drive_photo_blob_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb;
BEGIN
 SELECT jsonb_build_object('itemcode',m.itemcode,'commonname',m.commonname,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode)
 INTO context FROM public.ph_master_inventory m WHERE m.unique_id=NEW.master_uid;
 context:=coalesce(context,'{}'::jsonb);
 INSERT INTO public.ph_photo_history_assets(source_key,bucket,path,filename,photo_at,itemcode,commonname,contsize,locationcode,lotcode,contexts,search_text,storage_available)
 VALUES('ph_photo_blobs/'||NEW.id,'ph_photo_blobs',NEW.id,regexp_replace(NEW.object_path,'^.*/',''),NEW.created_at,
 coalesce(context->>'itemcode',''),coalesce(context->>'commonname',''),coalesce(context->>'contsize',''),coalesce(context->>'locationcode',''),coalesce(context->>'lotcode',''),jsonb_build_array(context),
 lower(context::text)||' '||regexp_replace(lower(context::text),'[^a-z0-9]','','g'),true)
 ON CONFLICT(source_key) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.index_drive_photo_blob_v1() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS index_drive_photo_blob_v1 ON public.ph_photo_blobs;
CREATE TRIGGER index_drive_photo_blob_v1 AFTER INSERT ON public.ph_photo_blobs FOR EACH ROW EXECUTE FUNCTION private.index_drive_photo_blob_v1();
-- Preserve database originals during the existing bucket/Drive catalog refresh.
DO $repair$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.refresh_photo_history_catalog_v1(boolean)'::regprocedure) INTO definition;
 IF position('a.bucket<>''ph_photo_blobs''' in definition)=0 THEN
  IF position('where a.storage_available and not exists' in definition)=0 THEN RAISE EXCEPTION 'PHOTO_HISTORY_REFRESH_CONTRACT_CHANGED'; END IF;
  definition:=replace(definition,'where a.storage_available and not exists','where a.storage_available and a.bucket<>''ph_photo_blobs'' and not exists');
  EXECUTE definition;
 END IF;
END $repair$;
-- Explicit, bounded metadata maintenance; this does not claim CDN invalidation.
CREATE OR REPLACE FUNCTION public.repair_photo_cache_metadata_batch_v1() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='30s' SET lock_timeout='5s' AS $$
DECLARE changed integer;
BEGIN
 IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'PHOTO_CACHE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 WITH batch AS MATERIALIZED (
  SELECT id FROM storage.objects WHERE bucket_id IN ('location_sales_notes_photos','season_sales_notes_photos')
  AND metadata->>'cacheControl' IS DISTINCT FROM 'public, max-age=31536000, immutable'
  ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED
 )
 UPDATE storage.objects o SET metadata=jsonb_set(coalesce(o.metadata,'{}'::jsonb),'{cacheControl}','"public, max-age=31536000, immutable"'::jsonb)
 FROM batch WHERE o.id=batch.id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.repair_photo_cache_metadata_batch_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_photo_cache_metadata_batch_v1() TO service_role;
COMMIT;
