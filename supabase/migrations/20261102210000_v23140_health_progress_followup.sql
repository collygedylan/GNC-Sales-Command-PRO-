BEGIN;
-- Respect exact-row Storage prefixes without weakening delivery health checks.
SET LOCAL lock_timeout = '60s';
SET LOCAL statement_timeout = '180s';
CREATE OR REPLACE FUNCTION public.get_photo_delivery_health_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  released_at timestamptz;
  recent_upload_count bigint := 0;
  recent_oversized_count bigint := 0;
  recent_mime_extension_mismatch_count bigint := 0;
  recent_png_count bigint := 0;
  static_original_count bigint := 0;
  complete_static_thumbnail_set_count bigint := 0;
  active_reference_count bigint := 0;
  active_v2_reference_count bigint := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'PHOTO_DELIVERY_HEALTH_FORBIDDEN';
  end if;

  select b.released_at into released_at
  from private.photo_delivery_health_baseline_v1 b
  where b.baseline_key = 'photo-egress-v1';

  with recent as materialized (
    select
      o.bucket_id,
      o.name,
      lower(coalesce(o.metadata ->> 'mimetype', '')) as mime_type,
      coalesce(nullif(o.metadata ->> 'size', '')::bigint, 0) as byte_count
    from storage.objects o
    where o.bucket_id = any (array[
      'request_photos',
      'flyer_photos',
      'season_sales_notes_photos',
      'location_sales_notes_photos'
    ]::text[])
      and o.created_at >= coalesce(released_at, clock_timestamp())
  )
  select
    count(*),
    count(*) filter (
      where (name ~ '(^|/)v2/[0-9a-f]{64}\.(jpg|webp)$' and byte_count > 1310720)
         or (name ~ '(^|/)_thumbs/v2/[0-9a-f]{64}-w144\.(jpg|webp)$' and byte_count > 81920)
         or (name ~ '(^|/)_thumbs/v2/[0-9a-f]{64}-w320\.(jpg|webp)$' and byte_count > 163840)
    ),
    count(*) filter (
      where (mime_type = 'image/jpeg' and name !~* '\.jpe?g$')
         or (mime_type = 'image/webp' and name !~* '\.webp$')
         or mime_type not in ('image/jpeg', 'image/webp')
    ),
    count(*) filter (where mime_type = 'image/png')
  into recent_upload_count, recent_oversized_count, recent_mime_extension_mismatch_count, recent_png_count
  from recent;

  with originals as materialized (
    select o.bucket_id, o.name,
      regexp_replace(o.name, '^.*v2/([0-9a-f]{64})\.(jpg|webp)$', '\1') as content_hash,
      regexp_replace(o.name, 'v2/[0-9a-f]{64}\.(jpg|webp)$', '') as object_prefix,
      regexp_replace(o.name, '^.*\.', '') as extension
    from storage.objects o
    where o.bucket_id = any (array[
      'request_photos',
      'flyer_photos',
      'season_sales_notes_photos',
      'location_sales_notes_photos'
    ]::text[])
      and o.name ~ '(^|/)v2/[0-9a-f]{64}\.(jpg|webp)$'
  )
  select count(*), count(*) filter (
    where exists (
      select 1 from storage.objects t144
      where t144.bucket_id = originals.bucket_id
        and t144.name = originals.object_prefix || '_thumbs/v2/' || originals.content_hash || '-w144.' || originals.extension
    )
    and exists (
      select 1 from storage.objects t320
      where t320.bucket_id = originals.bucket_id
        and t320.name = originals.object_prefix || '_thumbs/v2/' || originals.content_hash || '-w320.' || originals.extension
    )
  )
  into static_original_count, complete_static_thumbnail_set_count
  from originals;

  with raw_references as materialized (
    select nullif(btrim(m.photo_link), '') as photo_csv
    from public.ph_master_inventory m
    where nullif(btrim(m.photo_link), '') is not null
    union all
    select nullif(btrim(r.req_photo_link), '') as photo_csv
    from public.ph_requests_pending r
    where nullif(btrim(r.req_photo_link), '') is not null
  ), photo_references as materialized (
    select distinct btrim(value) as photo_url
    from raw_references,
      lateral regexp_split_to_table(raw_references.photo_csv, '\s*,\s*') value
    where btrim(value) <> ''
  )
  select count(*), count(*) filter (where photo_url ~ '/v2/[0-9a-f]{64}\.(jpg|webp)(\?|$)')
  into active_reference_count, active_v2_reference_count
  from photo_references;

  return jsonb_build_object(
    'ok', true,
    'healthy', recent_oversized_count = 0
      and recent_mime_extension_mismatch_count = 0
      and recent_png_count = 0
      and static_original_count = complete_static_thumbnail_set_count,
    'shell_version', 'V2026.09.04.04',
    'observed_since', released_at,
    'recent_upload_count', recent_upload_count,
    'recent_oversized_upload_count', recent_oversized_count,
    'recent_mime_extension_mismatch_count', recent_mime_extension_mismatch_count,
    'recent_png_upload_count', recent_png_count,
    'active_reference_count', active_reference_count,
    'active_v2_reference_count', active_v2_reference_count,
    'static_original_count', static_original_count,
    'complete_static_thumbnail_set_count', complete_static_thumbnail_set_count,
    'static_thumbnail_coverage_percent', case
      when static_original_count = 0 then 100
      else round((complete_static_thumbnail_set_count::numeric * 100) / static_original_count, 2)
    end
  );
end
$function$
;
COMMIT;
