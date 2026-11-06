BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='25s';
-- Import-only inheritance; ordinary edits retain exact-UID authorization and receipts.
CREATE OR REPLACE FUNCTION private.normalized_evidence_lot_v311(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT regexp_replace(regexp_replace(upper(coalesce(value,'')),'[^A-Z0-9]','','g'),'^20([0-9]{2})','\1')
$fn$;
CREATE OR REPLACE FUNCTION private.inherit_erp_location_evidence_v311(m public.ph_master_inventory)
RETURNS public.ph_master_inventory LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d jsonb; links text; stamp timestamptz; qty numeric; stock numeric; available numeric; pct numeric; same_lot boolean;
 prior_guard text:=coalesce(current_setting('app.eval_publication_v309',true),'');
 prior_uid text:=coalesce(current_setting('app.eval_publication_uid_v309',true),'');
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR current_setting('agdata.bulk_import.ph_master_inventory',true) IS DISTINCT FROM 'on'
  OR current_setting('app.eval_force_clear_photos',true)='on' THEN RETURN m; END IF;
 -- Existing rows use the UPDATE shield and the canonical order-delta reconciliation.
 IF EXISTS(SELECT 1 FROM public.ph_master_inventory x WHERE x.unique_id=m.unique_id) THEN RETURN m; END IF;
 stock:=coalesce(private.request_numeric_v2362(m.ptronhand),0);
 available:=coalesce(private.request_numeric_v2362(m.ptravailable),stock);
 IF stock<=0 OR m.loc_photo_match=0 THEN RETURN m; END IF;
 -- An explicit target tombstone always wins over location fallback.
 IF EXISTS(SELECT 1 FROM app_sync_private.inventory_location_evidence_v1 e WHERE e.source_unique_id=m.unique_id
   AND (e.cleared_at IS NOT NULL OR e.current_photo_match_qty=0 OR e.expires_at<=clock_timestamp())) THEN RETURN m; END IF;
 -- A new UID for the same depleted/cleared lot must not borrow a positive sibling.
 SELECT to_jsonb(e) INTO d FROM app_sync_private.inventory_location_evidence_v1 e
 WHERE e.itemcode_key=upper(btrim(m.itemcode)) AND e.locationcode_key=upper(btrim(m.locationcode))
  AND private.normalized_evidence_lot_v311(e.source_lotcode)=private.normalized_evidence_lot_v311(m.lotcode)
 ORDER BY greatest(e.evaluated_at,e.updated_at) DESC LIMIT 1;
 IF d IS NOT NULL AND (nullif(d->>'cleared_at','') IS NOT NULL OR private.request_numeric_v2362(d->>'current_photo_match_qty')=0
  OR private.try_timestamptz(d->>'expires_at')<=clock_timestamp()) THEN RETURN m; END IF;
 IF EXISTS(SELECT 1 FROM public.ph_location_sales_notes n WHERE n.unique_id=m.unique_id AND n.loc_photo_match=0) THEN RETURN m; END IF;
 WITH candidates AS (
  SELECT to_jsonb(e)||jsonb_build_object('unique_id',e.source_unique_id,'lotcode',e.source_lotcode,
    'photo_date',e.evaluated_at,'loc_photo_match',e.current_photo_match_qty,'pick_note',e.pic_note) doc,
    e.source_unique_id=m.unique_id own_uid,private.normalized_evidence_lot_v311(e.source_lotcode)=private.normalized_evidence_lot_v311(m.lotcode) exact_lot,
    e.evaluated_at at_time,0 kind
  FROM app_sync_private.inventory_location_evidence_v1 e
  WHERE e.itemcode_key=upper(btrim(m.itemcode)) AND e.locationcode_key=upper(btrim(m.locationcode))
    AND e.cleared_at IS NULL AND e.current_photo_match_qty>0 AND nullif(btrim(e.photo_link),'') IS NOT NULL
    AND e.evaluated_at>clock_timestamp()-interval '10 days' AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
  UNION ALL
  SELECT to_jsonb(n)||jsonb_build_object('photo_date',coalesce(n.photo_date,n.completed_at,n.updated_at),'date_completed',n.completed_at) doc,
    n.unique_id=m.unique_id,private.normalized_evidence_lot_v311(n.lotcode)=private.normalized_evidence_lot_v311(m.lotcode),
    coalesce(n.photo_date,n.completed_at,n.updated_at),1
  FROM public.ph_location_sales_notes n
  WHERE upper(btrim(n.itemcode))=upper(btrim(m.itemcode)) AND upper(btrim(n.locationcode))=upper(btrim(m.locationcode))
    AND coalesce(n.photo_date,n.completed_at,n.updated_at)>clock_timestamp()-interval '10 days'
    AND (n.loc_photo_match IS NULL OR n.loc_photo_match>0)
    AND private.collect_item_detail_photo_links_v308(NULL,NULL,NULL,jsonb_build_array(to_jsonb(n)))<>''
    AND NOT EXISTS(SELECT 1 FROM app_sync_private.inventory_location_evidence_v1 e WHERE e.source_unique_id=n.unique_id)
 ) SELECT doc INTO d FROM candidates ORDER BY own_uid DESC,exact_lot DESC,kind,at_time DESC LIMIT 1;
 IF d IS NULL THEN RETURN m; END IF;
 stamp:=private.try_timestamptz(d->>'photo_date');
 links:=private.collect_item_detail_photo_links_v308(NULL,NULL,NULL,jsonb_build_array(d));
 pct:=coalesce(private.request_numeric_v2362(d->>'loc_match_pct'),private.request_numeric_v2362(d->>'match'),100);
 qty:=coalesce(private.request_numeric_v2362(d->>'loc_photo_match'),round(stock*pct/100));
 same_lot:=private.normalized_evidence_lot_v311(d->>'lotcode')=private.normalized_evidence_lot_v311(m.lotcode);
 IF same_lot AND private.request_numeric_v2362(d->>'eval_baseline_available') IS NOT NULL
  AND private.request_numeric_v2362(d->>'initial_loc_photo_match') IS NOT NULL THEN
  qty:=least(qty,private.live_loc_photo_match_v23142(available,private.request_numeric_v2362(d->>'eval_baseline_available'),private.request_numeric_v2362(d->>'initial_loc_photo_match')));
 END IF;
 qty:=greatest(0,least(stock,qty));
 IF qty<=0 OR links='' OR stamp IS NULL THEN RETURN m; END IF;
 m.spec:=coalesce(private.eval_text_v309(m.spec),private.eval_text_v309(d->>'spec'),'N/A');
 m.caliper:=coalesce(private.eval_text_v309(m.caliper),private.eval_text_v309(d->>'caliper'));
 m.av_note:=coalesce(private.eval_text_v309(m.av_note),private.eval_text_v309(d->>'av_note'));
 m.pick_note:=coalesce(private.eval_text_v309(m.pick_note),private.eval_text_v309(d->>'pick_note'),private.eval_text_v309(d->>'pic_note'));m.pic_note:=m.pick_note;
 m.sales_note:=coalesce(private.eval_text_v309(m.sales_note),private.eval_text_v309(d->>'sales_note'));
 m.photo_link:=links;m.photo_url:=split_part(links,',',1);m.photos:=to_jsonb(string_to_array(links,','));m.photo_name:=d->>'photo_name';
 m.photo_date:=stamp;m.photo_expires_at:=stamp+interval '10 days';m.date_completed:=private.try_timestamptz(d->>'date_completed');
 m.loc_match_pct:=pct;m.match:=pct::text;m.loc_photo_match:=qty;m.loc_match_qty:=qty::text;
 m.baseline_on_hand:=coalesce(private.request_numeric_v2362(d->>'baseline_on_hand'),stock);
 m.initial_photo_match_qty:=coalesce(private.request_numeric_v2362(d->>'initial_photo_match_qty'),qty);
 m.eval_baseline_available:=available;m.initial_loc_photo_match:=qty;
 PERFORM set_config('app.eval_publication_v309','on',true);PERFORM set_config('app.eval_publication_uid_v309',m.unique_id,true);
 INSERT INTO app_sync_private.inventory_location_evidence_v1(itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,source_lotcode,spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,photo_link,photo_name,date_completed,updated_at,updated_by,baseline_on_hand,loc_match_pct,initial_photo_match_qty,current_photo_match_qty,eval_baseline_available,initial_loc_photo_match,evaluated_at,expires_at)
 VALUES(upper(btrim(m.itemcode)),upper(btrim(m.locationcode)),m.itemcode,m.locationcode,m.unique_id,m.lotcode,m.spec,m.caliper,m.match,qty::text,stock::text,m.av_note,m.pick_note,m.sales_note,links,m.photo_name,m.date_completed,clock_timestamp(),'erp-inherit-v311',m.baseline_on_hand,pct,m.initial_photo_match_qty,qty,available,qty,stamp,m.photo_expires_at)
 ON CONFLICT(source_unique_id) DO NOTHING;
 INSERT INTO public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,spec,caliper,loc_match_pct,loc_photo_match,av_note,pick_note,sales_note,photo_link,photo_name,photos,photo_url,photo_date,completed_at,eval_baseline_available,initial_loc_photo_match,updated_at)
 VALUES(m.unique_id,coalesce(m.source,''),m.itemcode,m.locationcode,coalesce(m.lotcode,''),m.spec,m.caliper,pct,qty,m.av_note,m.pick_note,m.sales_note,links,m.photo_name,m.photos,m.photo_url,stamp,m.date_completed,available,qty,clock_timestamp())
 ON CONFLICT(unique_id) DO NOTHING;
 PERFORM set_config('app.eval_publication_v309',prior_guard,true);PERFORM set_config('app.eval_publication_uid_v309',prior_uid,true);
 RETURN m;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.eval_publication_v309',prior_guard,true);PERFORM set_config('app.eval_publication_uid_v309',prior_uid,true);RAISE;
END $fn$;
REVOKE ALL ON FUNCTION private.normalized_evidence_lot_v311(text),private.inherit_erp_location_evidence_v311(public.ph_master_inventory) FROM PUBLIC,anon,authenticated;
DO $migration$
DECLARE d text:=pg_get_functiondef('private.protect_eval_data_from_blank_overwrite_v309'::regproc); anchor text:=$a$ IF tg_op='INSERT' THEN prior:='{}'::jsonb; END IF;$a$;
BEGIN
 IF strpos(d,'inherit_erp_location_evidence_v311')>0 THEN RETURN; END IF;
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'AGDATA311_IMPORT_SHIELD_ANCHOR'; END IF;
 d:=replace(d,anchor,$a$ IF tg_op='INSERT' THEN
  prior:='{}'::jsonb;
  IF tg_table_name='ph_master_inventory' THEN
   new:=private.inherit_erp_location_evidence_v311(new);incoming:=to_jsonb(new);
  END IF;
 END IF;$a$);
 EXECUTE d;
END $migration$;
COMMIT;
