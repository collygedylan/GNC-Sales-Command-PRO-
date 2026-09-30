begin;

-- Apply only after V2026.09.04.04 is exact-live. Existing objects remain intact;
-- these limits govern new uploads only.
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/webp']::text[]
where id = any (array[
  'request_photos',
  'flyer_photos',
  'season_sales_notes_photos',
  'location_sales_notes_photos'
]::text[]);

do $block$
declare
  guarded_count integer;
begin
  select count(*) into guarded_count
  from storage.buckets b
  where b.id = any (array[
    'request_photos',
    'flyer_photos',
    'season_sales_notes_photos',
    'location_sales_notes_photos'
  ]::text[])
    and b.file_size_limit = 2097152
    and b.allowed_mime_types @> array['image/jpeg', 'image/webp']::text[]
    and cardinality(b.allowed_mime_types) = 2;

  if guarded_count <> 4 then
    raise exception using errcode = 'P0001', message = 'PHOTO_BUCKET_GUARD_INCOMPLETE';
  end if;
end
$block$;

commit;
