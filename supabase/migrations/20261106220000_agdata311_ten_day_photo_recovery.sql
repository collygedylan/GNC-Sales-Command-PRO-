BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='45s';
CREATE FUNCTION pg_temp.ag311_lot(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
 SELECT regexp_replace(regexp_replace(upper(btrim(coalesce(value,''))),'[ _-]+','.','g'),'^20([0-9]{2})([.])','\1\2');
$fn$;
CREATE FUNCTION pg_temp.ag311_photos(doc jsonb) RETURNS TABLE(url text,photo_at timestamptz,photo_name text) LANGUAGE sql STABLE AS $fn$
 WITH fields AS (SELECT key,value FROM jsonb_each(CASE WHEN jsonb_typeof(doc)='object' THEN doc ELSE '{}'::jsonb END)
 WHERE key IN ('photos','request_photos','photo_urls','photo_url','photo_link','req_photo_link','drive_photo_link','dock_photo_link','flyer_photo_link','issue_photos')),
 entries AS (SELECT entry FROM fields CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE jsonb_build_array(value) END) a(entry))
 SELECT btrim(link),coalesce(private.try_timestamptz(entry->>'date'),private.try_timestamptz(entry->>'uploaded_at'),private.try_timestamptz(entry->>'created_at')),entry->>'name'
 FROM entries CROSS JOIN LATERAL regexp_split_to_table(CASE WHEN jsonb_typeof(entry)='object' THEN coalesce(entry->>'url',entry->>'src',entry->>'photo_url',entry->>'publicUrl','') ELSE coalesce(entry#>>'{}','') END,E'[,\r\n]+') a(link)
 WHERE btrim(link)~'^https?://';
$fn$;
CREATE TEMP TABLE ag311_sources ON COMMIT DROP AS
WITH docs AS (
 SELECT 'master' src,to_jsonb(m) doc FROM public.ph_master_inventory m WHERE coalesce(m.photo_link,m.photo_url,'')<>'' OR m.photos<>'[]'::jsonb
 UNION ALL SELECT 'notes',to_jsonb(n) FROM public.ph_location_sales_notes n
 UNION ALL SELECT 'pending',to_jsonb(r) FROM public.ph_requests_pending r
 UNION ALL SELECT 'request_history',coalesce(h.snapshot,'{}')||jsonb_strip_nulls(to_jsonb(h)) FROM public.ph_requests_completed_history h
 UNION ALL SELECT 'request_snapshot',coalesce(h.source_snapshot,h.snapshot,'{}')||jsonb_build_object('itemcode',h.itemcode,'locationcode',h.locationcode,'lotcode',h.lotcode,'master_id',coalesce(h.master_id,h.master_unique_id),'completed_at',h.date_completed) FROM public.ph_requests_completed_history h
 UNION ALL SELECT 'suspend',to_jsonb(s) FROM public.ph_active_suspend s
 UNION ALL SELECT 'suspend_history',coalesce(h.snapshot,'{}')||jsonb_build_object('itemcode',h.itemcode,'locationcode',h.locationcode,'lotcode',h.lotcode,'completed_at',h.completed_at,'source_unique_id',h.source_unique_id) FROM public.ph_suspend_history h
 UNION ALL SELECT 'eval_work',coalesce(w.origin_snapshot,'{}')||coalesce(w.submitted_evidence,w.evidence_draft,'{}')||jsonb_build_object('itemcode',w.itemcode,'locationcode',w.origin_locationcode,'lotcode',w.origin_lotcode,'master_id',w.origin_unique_id,'updated_at',w.updated_at,'completed_at',w.submitted_at) FROM public.ph_eval_work w
 UNION ALL SELECT 'eval_origin',coalesce(o.origin_snapshot,'{}')||coalesce(o.submitted_evidence,o.evidence_draft,'{}')||jsonb_build_object('itemcode',o.itemcode,'locationcode',o.locationcode,'lotcode',o.lotcode,'master_id',o.origin_unique_id,'updated_at',o.updated_at) FROM public.ph_eval_work_origin_rows o
 UNION ALL SELECT 'eval_event',coalesce(w.origin_snapshot,'{}')||e.metadata||jsonb_build_object('itemcode',w.itemcode,'locationcode',w.origin_locationcode,'lotcode',w.origin_lotcode,'master_id',w.origin_unique_id,'updated_at',e.created_at) FROM public.ph_eval_work_events e JOIN public.ph_eval_work w ON w.id=e.eval_work_id
 UNION ALL SELECT 'drive_history',coalesce(to_jsonb(h)->'snapshot','{}')||jsonb_strip_nulls(to_jsonb(h)) FROM public.ph_drive_mode_history h WHERE h.updated_at>=current_date-interval '10 days' AND (h.photos<>'[]'::jsonb OR nullif(h.photo_url,'') IS NOT NULL)
 UNION ALL SELECT 'eval_history',coalesce(to_jsonb(h)->'snapshot','{}')||jsonb_strip_nulls(to_jsonb(h)) FROM public.ph_eval_work_history h WHERE h.updated_at>=current_date-interval '10 days' AND (nullif(h.req_photo_link,'') IS NOT NULL OR nullif(h.photo_link,'') IS NOT NULL OR h.photos<>'[]'::jsonb)
 UNION ALL SELECT 'location_move_history',coalesce(to_jsonb(h)->'snapshot','{}')||jsonb_strip_nulls(to_jsonb(h)) FROM public.ph_location_moves_history h WHERE h.updated_at>=current_date-interval '10 days' AND (nullif(h.req_photo_link,'') IS NOT NULL OR nullif(h.photo_link,'') IS NOT NULL OR h.photos<>'[]'::jsonb)
 UNION ALL SELECT 'flyer_history',coalesce(to_jsonb(h)->'snapshot','{}')||jsonb_strip_nulls(to_jsonb(h)) FROM public.ph_flyer_folder_history h WHERE h.updated_at>=current_date-interval '10 days' AND nullif(h.flyer_photo_link,'') IS NOT NULL
 UNION ALL SELECT 'flyer_row',to_jsonb(h) FROM public.ph_flyer_folder_rows h WHERE h.updated_at>=current_date-interval '10 days' AND nullif(h.flyer_photo_link,'') IS NOT NULL
 UNION ALL SELECT 'order_history',coalesce(to_jsonb(h)->'snapshot','{}')||jsonb_strip_nulls(to_jsonb(h)) FROM public.ph_orders_history h WHERE h.updated_at>=current_date-interval '10 days' AND (h.photos<>'[]'::jsonb OR nullif(h.photo_url,'') IS NOT NULL)
 UNION ALL SELECT 'reserve_history',coalesce(to_jsonb(h)->'snapshot','{}')||jsonb_strip_nulls(to_jsonb(h)) FROM public.ph_reserves_history h WHERE h.updated_at>=current_date-interval '10 days' AND (h.photos<>'[]'::jsonb OR nullif(h.photo_url,'') IS NOT NULL)
 UNION ALL SELECT 'sales_office',to_jsonb(h) FROM public.ph_sales_office h WHERE h.updated_at>=current_date-interval '10 days' AND nullif(h.photo_link,'') IS NOT NULL
 UNION ALL SELECT 'photo_history',to_jsonb(h)||jsonb_build_object('photo_date',h.photo_at,'photo_link','https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||h.bucket||'/'||h.path) FROM public.ph_photo_history_assets h WHERE h.storage_available AND h.photo_at>=current_date-interval '10 days'
 UNION ALL SELECT 'ledger',to_jsonb(e)||jsonb_build_object('unique_id',e.source_unique_id,'lotcode',e.source_lotcode,'photo_date',e.evaluated_at) FROM app_sync_private.inventory_location_evidence_v1 e WHERE e.cleared_at IS NULL AND nullif(e.clear_reason,'') IS NULL AND coalesce(e.current_photo_match_qty,1)>0
), normalized AS (
 SELECT src,doc,upper(btrim(coalesce(doc->>'itemcode',doc->>'ITEMCODE',''))) item,
 upper(btrim(coalesce(doc->>'locationcode',doc->>'LOCATIONCODE',''))) loc,
 pg_temp.ag311_lot(coalesce(doc->>'lotcode',doc->>'LOTCODE')) lot,
 coalesce(nullif(doc->>'master_id',''),nullif(doc->>'master_unique_id',''),nullif(doc->>'origin_unique_id',''),nullif(doc->>'source_unique_id',''),doc->>'unique_id') uid,
 coalesce(private.try_timestamptz(doc->>'photo_date'),private.try_timestamptz(doc->>'date_completed'),private.try_timestamptz(doc->>'completed_at'),private.try_timestamptz(doc->>'updated_at'),private.try_timestamptz(doc->>'last_updated')) evidence_at
 FROM docs WHERE jsonb_typeof(doc)='object'
)
SELECT n.*,p.url,coalesce(p.photo_at,s.created_at,n.evidence_at) photo_at,
 coalesce(nullif(p.photo_name,''),regexp_replace(s.name,'^.*/',''),nullif(n.doc->>'photo_name',''),'recovered-photo') photo_name,
 s.name storage_path
FROM normalized n CROSS JOIN LATERAL pg_temp.ag311_photos(n.doc) p
LEFT JOIN storage.objects s ON s.bucket_id=split_part(split_part(p.url,'/storage/v1/object/public/',2),'/',1) AND s.name=substring(split_part(split_part(p.url,'/storage/v1/object/public/',2),'?',1) from position('/' in split_part(p.url,'/storage/v1/object/public/',2))+1)
WHERE n.item<>'' AND n.loc<>'' AND p.url NOT LIKE '%/_thumbs/%'
 AND coalesce(p.photo_at,s.created_at,n.evidence_at)>=current_date-interval '10 days'
 AND coalesce(p.photo_at,s.created_at,n.evidence_at)<=clock_timestamp()
 -- A missing managed storage object cannot be made available by restoring its URL.
 AND (p.url NOT LIKE '%kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/%' OR s.id IS NOT NULL);

-- Recent storage with embedded inventory/request IDs is independently recoverable.
INSERT INTO ag311_sources(src,doc,item,loc,lot,uid,evidence_at,url,photo_at,photo_name,storage_path)
WITH objects AS (
 SELECT s.*,convert_from(decode(split_part(s.name,'/',2),'hex'),'UTF8') decoded_uid
 FROM storage.objects s WHERE s.bucket_id='location_sales_notes_photos' AND s.created_at>=current_date-interval '10 days'
 AND s.name~'^drive-evidence/([0-9a-f]{2})+/' AND s.name NOT LIKE '%/_thumbs/%'
), identities AS (
 SELECT o.*,coalesce(m.unique_id,h.master_id,h.master_unique_id,p.master_id) master_uid
 FROM objects o LEFT JOIN public.ph_master_inventory m ON m.unique_id=o.decoded_uid
 LEFT JOIN LATERAL (SELECT h.master_id,h.master_unique_id FROM public.ph_requests_completed_history h WHERE h.unique_id=o.decoded_uid ORDER BY h.updated_at DESC LIMIT 1) h ON true
 LEFT JOIN public.ph_requests_pending p ON p.unique_id=o.decoded_uid
)
SELECT 'storage_uid',to_jsonb(m),upper(btrim(m.itemcode)),upper(btrim(m.locationcode)),pg_temp.ag311_lot(m.lotcode),m.unique_id,o.created_at,
 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||o.bucket_id||'/'||o.name,o.created_at,regexp_replace(o.name,'^.*/',''),o.name
FROM identities o JOIN public.ph_master_inventory m ON m.unique_id=o.master_uid;

INSERT INTO ag311_sources(src,doc,item,loc,lot,uid,evidence_at,url,photo_at,photo_name,storage_path)
SELECT 'archive',to_jsonb(m),upper(btrim(m.itemcode)),upper(btrim(m.locationcode)),pg_temp.ag311_lot(m.lotcode),m.unique_id,s.created_at,
 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||s.bucket_id||'/'||s.name,s.created_at,regexp_replace(s.name,'^.*/',''),s.name
FROM public.ph_photo_archive_jobs j JOIN storage.objects s ON s.bucket_id=j.source_bucket AND s.name=j.source_path
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(j.master_unique_ids)='array' THEN j.master_unique_ids ELSE '[]' END) ids(uid)
JOIN public.ph_master_inventory m ON m.unique_id=ids.uid
WHERE s.created_at>=current_date-interval '10 days' AND j.deleted_at IS NULL AND j.invalid_reasons::text!~*'deplet|manual|user.delete';

CREATE INDEX ON ag311_sources(item,loc,lot);
CREATE TEMP TABLE ag311_candidates ON COMMIT DROP AS
SELECT m.unique_id,m.itemcode,m.locationcode,m.lotcode,m.ptronhand,m.loc_photo_match existing_qty,e.current_photo_match_qty ledger_qty,
 s.src,s.uid source_uid,s.lot source_lot,s.doc,s.url,s.photo_at,s.photo_name,s.storage_path,
 CASE WHEN s.uid=m.unique_id THEN 0 WHEN s.lot=pg_temp.ag311_lot(m.lotcode) THEN 1 ELSE 2 END source_rank
FROM public.ph_master_inventory m JOIN ag311_sources s ON s.item=upper(btrim(m.itemcode)) AND s.loc=upper(btrim(m.locationcode))
LEFT JOIN app_sync_private.inventory_location_evidence_v1 e ON e.source_unique_id=m.unique_id
WHERE coalesce(private.request_numeric_v2362(m.ptronhand),0)>0
 AND m.loc_photo_match IS DISTINCT FROM 0
 AND private.request_numeric_v2362(s.doc->>'loc_photo_match') IS DISTINCT FROM 0
 AND NOT EXISTS(SELECT 1 FROM app_sync_private.inventory_location_evidence_v1 donor WHERE donor.source_unique_id=s.uid AND (donor.current_photo_match_qty=0 OR donor.cleared_at IS NOT NULL OR nullif(donor.clear_reason,'') IS NOT NULL))
 AND (e.source_unique_id IS NULL OR (e.current_photo_match_qty IS DISTINCT FROM 0 AND e.cleared_at IS NULL AND nullif(e.clear_reason,'') IS NULL))
 -- Exact lot evidence takes precedence. Location fallback is used only when no eligible exact-lot evidence exists.
 AND (s.lot=pg_temp.ag311_lot(m.lotcode) OR NOT EXISTS(SELECT 1 FROM ag311_sources exact WHERE exact.item=s.item AND exact.loc=s.loc AND exact.lot=pg_temp.ag311_lot(m.lotcode)));
CREATE INDEX ON ag311_candidates(unique_id);



CREATE TEMP TABLE ag311_before ON COMMIT DROP AS
SELECT lotcode,count(*) AS valid_photo_rows,sum(jsonb_array_length(photos)) AS total_photos
FROM public.ph_master_inventory WHERE jsonb_typeof(photos)='array' AND jsonb_array_length(photos)>0 AND coalesce(loc_photo_match,0)>0 GROUP BY lotcode;
CREATE FUNCTION pg_temp.ag311_field(docs jsonb,keys text[]) RETURNS text LANGUAGE sql STABLE AS $fn$
 SELECT private.eval_text_v309(d.doc->>k.key) FROM jsonb_array_elements(docs) WITH ORDINALITY d(doc,n)
 CROSS JOIN unnest(keys) WITH ORDINALITY k(key,n)
 WHERE private.eval_text_v309(d.doc->>k.key) IS NOT NULL ORDER BY d.n,k.n LIMIT 1;
$fn$;
CREATE TEMP TABLE ag311_publish ON COMMIT DROP AS
WITH dedup AS (
 SELECT DISTINCT ON(unique_id,url) * FROM ag311_candidates ORDER BY unique_id,url,source_rank,photo_at DESC
)
SELECT unique_id,jsonb_agg(doc ORDER BY source_rank,photo_at DESC) docs,
 string_agg(url,',' ORDER BY photo_at,url) links,max(photo_at) photo_at,
 jsonb_agg(jsonb_build_object('url',url,'date',photo_at,'name',photo_name) ORDER BY photo_at,url) images
FROM dedup GROUP BY unique_id;
CREATE TEMP TABLE ag311_changed(uid text PRIMARY KEY,prior_qty numeric) ON COMMIT DROP;
DO $recover$
DECLARE r record;m public.ph_master_inventory;e app_sync_private.inventory_location_evidence_v1;n public.ph_location_sales_notes;
 links text;images jsonb;stamp timestamptz;pct numeric;qty numeric;oh numeric;available numeric;available_baseline numeric;initial_qty numeric;spec_value text;caliper_value text;av_value text;pick_value text;sales_value text;names text; prior_guard text:=coalesce(current_setting('app.eval_publication_v309',true),'');prior_uid text:=coalesce(current_setting('app.eval_publication_uid_v309',true),'');prior_apply text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
BEGIN
 FOR r IN SELECT * FROM ag311_publish ORDER BY unique_id LOOP
  SELECT * INTO m FROM public.ph_master_inventory WHERE unique_id=r.unique_id FOR UPDATE;
  SELECT * INTO e FROM app_sync_private.inventory_location_evidence_v1 WHERE source_unique_id=r.unique_id;
  SELECT * INTO n FROM public.ph_location_sales_notes WHERE unique_id=r.unique_id FOR UPDATE;
  IF m.unique_id IS NULL OR m.loc_photo_match=0 OR e.current_photo_match_qty=0 OR e.cleared_at IS NOT NULL OR nullif(e.clear_reason,'') IS NOT NULL THEN CONTINUE; END IF;
  oh:=coalesce(private.request_numeric_v2362(m.ptronhand),0);IF oh<=0 THEN CONTINUE; END IF;
  available:=coalesce(private.request_numeric_v2362(m.ptravailable),oh);
  pct:=coalesce(nullif(m.loc_match_pct,0),nullif(private.request_numeric_v2362(m.match),0),nullif(private.request_numeric_v2362(pg_temp.ag311_field(r.docs,ARRAY['loc_match_pct','match_pct','req_match','locMatchPercent','match'])),0),100);
  IF pct<0 OR pct>100 THEN RAISE EXCEPTION 'AGDATA311_INVALID_MATCH_PERCENT'; END IF;
  qty:=coalesce(m.loc_photo_match,e.current_photo_match_qty,round(oh*pct/100));
  IF qty<=0 THEN CONTINUE; END IF;
  -- Preserve recorded depletion and its baseline; filling metadata is not a fresh evaluation.
  available_baseline:=coalesce(e.eval_baseline_available,m.eval_baseline_available,available);
  initial_qty:=coalesce(e.initial_loc_photo_match,m.initial_loc_photo_match,qty);
  links:=private.collect_item_detail_photo_links_v308(NULL,NULL,NULL,jsonb_build_array(to_jsonb(m),to_jsonb(n),jsonb_build_object('photo_link',r.links)));
  SELECT jsonb_agg(coalesce((SELECT p FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.photos)='array' THEN m.photos ELSE '[]' END||r.images) p WHERE coalesce(p->>'url',p->>'src',p->>'photo_url',p#>>'{}')=link AND jsonb_typeof(p)='object' LIMIT 1),jsonb_build_object('url',link,'date',m.photo_date)) ORDER BY ord)
   INTO images FROM unnest(string_to_array(links,',')) WITH ORDINALITY u(link,ord);
  stamp:=greatest(m.photo_date,r.photo_at);
  spec_value:=coalesce(private.eval_text_v309(m.spec),pg_temp.ag311_field(r.docs,ARRAY['req_spec','spec','flyer_spec']),e.spec);
  caliper_value:=coalesce(private.eval_text_v309(m.caliper),pg_temp.ag311_field(r.docs,ARRAY['req_caliper','caliper','flyer_caliper']),e.caliper);
  av_value:=coalesce(private.eval_text_v309(m.av_note),pg_temp.ag311_field(r.docs,ARRAY['av_note','avNote','flyer_av_note']),e.av_note);
  pick_value:=coalesce(private.eval_text_v309(m.pick_note),private.eval_text_v309(m.pic_note),pg_temp.ag311_field(r.docs,ARRAY['req_pic_note','pick_note','pic_note','pickNote']),e.pic_note);
  sales_value:=coalesce(private.eval_text_v309(m.sales_note),pg_temp.ag311_field(r.docs,ARRAY['req_comments','comments','req_sales_note','sales_note']),e.sales_note);
  SELECT string_agg(coalesce(nullif(p->>'name',''),regexp_replace(p->>'url','^.*/',''),'photo'),',' ORDER BY ord) INTO names FROM jsonb_array_elements(images) WITH ORDINALITY a(p,ord);
  PERFORM set_config('app.eval_publication_v309','on',true);PERFORM set_config('app.eval_publication_uid_v309',m.unique_id,true);PERFORM set_config('gnc.inventory_location_evidence_apply','on',true);
  INSERT INTO app_sync_private.inventory_location_evidence_v1 AS prior(itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,source_lotcode,spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,photo_link,photo_name,date_completed,updated_at,updated_by,baseline_on_hand,loc_match_pct,initial_photo_match_qty,current_photo_match_qty,eval_baseline_available,initial_loc_photo_match,evaluated_at,expires_at,cleared_at,clear_reason)
  VALUES(upper(btrim(m.itemcode)),upper(btrim(m.locationcode)),m.itemcode,m.locationcode,m.unique_id,m.lotcode,spec_value,caliper_value,pct::text,qty::text,coalesce(m.initial_ptr,oh::text),av_value,pick_value,sales_value,links,names,m.date_completed,clock_timestamp(),'agdata311_recovery',coalesce(e.baseline_on_hand,m.baseline_on_hand,oh),pct,coalesce(e.initial_photo_match_qty,m.initial_photo_match_qty,initial_qty),qty,available_baseline,initial_qty,stamp,stamp+interval '10 days',NULL,NULL)
  ON CONFLICT(source_unique_id) DO UPDATE SET spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,photo_link=excluded.photo_link,photo_name=excluded.photo_name,loc_match_pct=excluded.loc_match_pct,current_photo_match_qty=excluded.current_photo_match_qty,eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match,initial_photo_match_qty=excluded.initial_photo_match_qty,baseline_on_hand=excluded.baseline_on_hand,evaluated_at=excluded.evaluated_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  UPDATE public.ph_master_inventory SET spec=spec_value,caliper=caliper_value,av_note=av_value,pic_note=pick_value,pick_note=pick_value,sales_note=sales_value,photo_link=links,photo_name=names,photos=images,photo_url=split_part(links,',',1),photo_date=stamp,photo_expires_at=stamp+interval '10 days',match=pct::text,loc_match_pct=pct,loc_photo_match=qty,loc_match_qty=qty::text,eval_baseline_available=available_baseline,initial_loc_photo_match=initial_qty,baseline_on_hand=coalesce(e.baseline_on_hand,m.baseline_on_hand,oh),initial_photo_match_qty=coalesce(e.initial_photo_match_qty,m.initial_photo_match_qty,initial_qty),last_updated=clock_timestamp() WHERE unique_id=m.unique_id;
  INSERT INTO public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,spec,caliper,loc_match_pct,loc_photo_match,av_note,pick_note,sales_note,photo_link,photo_name,photos,photo_url,photo_date,completed_at,eval_baseline_available,initial_loc_photo_match,updated_at)
  VALUES(m.unique_id,coalesce(m.source,''),m.itemcode,m.locationcode,coalesce(m.lotcode,''),spec_value,caliper_value,pct,qty,av_value,pick_value,sales_value,links,names,images,split_part(links,',',1),stamp,m.date_completed,available_baseline,initial_qty,clock_timestamp())
  ON CONFLICT(unique_id) DO UPDATE SET spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,loc_photo_match=excluded.loc_photo_match,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,photo_link=excluded.photo_link,photo_name=excluded.photo_name,photos=excluded.photos,photo_url=excluded.photo_url,photo_date=excluded.photo_date,completed_at=coalesce(ph_location_sales_notes.completed_at,excluded.completed_at),eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match,updated_at=excluded.updated_at;
  INSERT INTO ag311_changed VALUES(m.unique_id,m.loc_photo_match);
 END LOOP;
 PERFORM set_config('app.eval_publication_v309',prior_guard,true);PERFORM set_config('app.eval_publication_uid_v309',prior_uid,true);PERFORM set_config('gnc.inventory_location_evidence_apply',prior_apply,true);
END $recover$;
UPDATE public.app_dataset_revisions SET revision=revision+1,changed_at=clock_timestamp() WHERE key IN ('ph_master_inventory','ph_av_notes');
CREATE TEMP TABLE ag311_after ON COMMIT DROP AS
SELECT lotcode,count(*) AS valid_photo_rows,sum(jsonb_array_length(photos)) AS total_photos FROM public.ph_master_inventory WHERE jsonb_typeof(photos)='array' AND jsonb_array_length(photos)>0 AND coalesce(loc_photo_match,0)>0 GROUP BY lotcode;
DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM ag311_changed c JOIN public.ph_master_inventory m ON m.unique_id=c.uid LEFT JOIN public.ph_location_sales_notes n ON n.unique_id=m.unique_id WHERE m.photo_date IS NULL OR m.loc_photo_match<=0 OR n.unique_id IS NULL OR n.photo_date IS NULL OR EXISTS((SELECT url FROM pg_temp.ag311_photos(to_jsonb(m))) EXCEPT (SELECT url FROM pg_temp.ag311_photos(to_jsonb(n)))) OR EXISTS((SELECT url FROM pg_temp.ag311_photos(to_jsonb(n))) EXCEPT (SELECT url FROM pg_temp.ag311_photos(to_jsonb(m)))) OR n.loc_photo_match IS DISTINCT FROM m.loc_photo_match) THEN RAISE EXCEPTION 'AGDATA311_RECOVERY_PARITY'; END IF;
 IF EXISTS(SELECT 1 FROM ag311_changed c JOIN public.ph_master_inventory m ON m.unique_id=c.uid WHERE c.prior_qty>0 AND m.loc_photo_match IS DISTINCT FROM c.prior_qty) THEN RAISE EXCEPTION 'AGDATA311_DEPLETION_REGRESSION'; END IF;
END $verify$;



COMMIT;
