begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

do $patch$
declare
  definition text:=pg_get_functiondef('private.collect_item_detail_photo_links_v308(text,text,text,jsonb)'::regprocedure);
  old_match text:=$old$upper(btrim(m.itemcode))=upper(btrim(p_item)) AND upper(btrim(m.locationcode))=upper(btrim(p_location))$old$;
  indexed_match text:=$new$p_item IS NOT NULL AND p_location IS NOT NULL
   AND m.itemcode IS NOT NULL AND m.locationcode IS NOT NULL
   AND upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(p_item))
   AND upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(p_location))$new$;
  old_notes text:=$old$FROM public.ph_location_sales_notes n WHERE upper(btrim(n.itemcode))$old$;
  scoped_notes text:=$new$FROM public.ph_location_sales_notes n
   WHERE p_item IS NOT NULL AND p_location IS NOT NULL AND upper(btrim(n.itemcode))$new$;
  old_fields text:=$old$SELECT value,ord,array_position(ARRAY['photo_link','req_photo_link','drive_photo_link','dock_photo_link','photos','request_photos','photo_urls','photo_url'],key) field_ord
  FROM refs CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(doc)='object' THEN doc ELSE jsonb_build_object('photos',doc) END)
  WHERE key IN ('photos','request_photos','photo_urls','photo_url','photo_link','req_photo_link','drive_photo_link','dock_photo_link')$old$;
  photo_fields text:=$new$SELECT f.value,ord,f.field_ord
  FROM refs CROSS JOIN LATERAL (
   SELECT (CASE WHEN jsonb_typeof(doc)='object' THEN doc ELSE jsonb_build_object('photos',doc) END)->keys.key value,
     keys.field_ord
   FROM unnest(ARRAY['photo_link','req_photo_link','drive_photo_link','dock_photo_link','photos','request_photos','photo_urls','photo_url'])
     WITH ORDINALITY keys(key,field_ord)
  ) f WHERE f.value IS NOT NULL$new$;
begin
  if not exists(select 1 from pg_index
    where indexrelid=to_regclass('public.ph_master_inventory_item_location_on_hand_idx')
      and indrelid='public.ph_master_inventory'::regclass and indisvalid and indisready) then
    raise exception 'PHOTO_EVIDENCE_LOOKUP_INDEX_MISSING';
  end if;
  if position(indexed_match in definition)>0 and position(scoped_notes in definition)>0
     and position(photo_fields in definition)>0 then return; end if;
  if cardinality(string_to_array(definition,old_match))<>2
     or cardinality(string_to_array(definition,old_notes))<>2
     or cardinality(string_to_array(definition,old_fields))<>2 then
    raise exception 'PHOTO_EVIDENCE_LOOKUP_PREDICATE_CHANGED';
  end if;
  execute replace(replace(replace(definition,old_match,indexed_match),old_notes,scoped_notes),old_fields,photo_fields);
end
$patch$;

-- A cold bulk import starts with empty relation statistics and inserts
-- thousands of rows in one statement. Keep its cached lookup plan indexed.
alter function private.collect_item_detail_photo_links_v308(text,text,text,jsonb) set enable_seqscan='off';
alter function private.collect_item_detail_photo_links_v308(text,text,text,jsonb) set jit='off';
commit;
