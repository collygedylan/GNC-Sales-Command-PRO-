BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='25s';
ALTER TABLE public.ph_location_sales_notes ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.ph_location_sales_notes ADD COLUMN IF NOT EXISTS photo_date timestamptz;
ALTER TABLE public.ph_location_sales_notes ADD COLUMN IF NOT EXISTS loc_photo_match numeric;
CREATE OR REPLACE FUNCTION private.eval_text_v309(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN upper(btrim(coalesce(value,''))) IN ('','-','N/A','NULL') THEN NULL ELSE btrim(value) END
$fn$;
CREATE OR REPLACE FUNCTION private.eval_row_payload_v309(r jsonb,kind text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'spec',coalesce(private.eval_text_v309(r->>CASE WHEN kind='request' THEN 'req_spec' ELSE 'dock_spec' END),private.eval_text_v309(r->>'spec')),
  'caliper',coalesce(private.eval_text_v309(r->>CASE WHEN kind='request' THEN 'req_caliper' ELSE 'dock_caliper' END),private.eval_text_v309(r->>'caliper')),
  'pct',coalesce(private.request_numeric_v2362(r->>CASE WHEN kind='request' THEN 'req_match' ELSE 'match' END),private.request_numeric_v2362(r->>'loc_match_pct')),
  'av_note',private.eval_text_v309(r->>'av_note'),
  'pick_note',coalesce(private.eval_text_v309(r->>'req_pic_note'),private.eval_text_v309(r->>'pick_note'),private.eval_text_v309(r->>'pic_note')),
  'sales_note',coalesce(private.eval_text_v309(r->>'req_comments'),private.eval_text_v309(r->>'req_sales_note'),private.eval_text_v309(r->>'sales_note'),private.eval_text_v309(r->>'comments'),private.eval_text_v309(r->>'dock_note')),
  'photos',r->'photos','photo_url',private.eval_text_v309(r->>'photo_url'),
  'photo_link',coalesce(private.eval_text_v309(r->>CASE WHEN kind='request' THEN 'req_photo_link' ELSE 'dock_photo_link' END),private.eval_text_v309(r->>'photo_link')),
  'photo_name',coalesce(private.eval_text_v309(r->>CASE WHEN kind='request' THEN 'req_photo_name' ELSE 'dock_photo_name' END),private.eval_text_v309(r->>'photo_name')),
  'photo_date',private.eval_text_v309(r->>'photo_date')))
$fn$;
CREATE OR REPLACE FUNCTION private.eval_master_uid_v309(r jsonb) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH candidates AS (
 SELECT m.unique_id,m.last_updated,m.unique_id=nullif(r->>'master_id','') explicit_uid,
 regexp_replace(regexp_replace(upper(coalesce(m.lotcode,'')),'[^A-Z0-9]','','g'),'^20([0-9]{2})','\1')=regexp_replace(regexp_replace(upper(coalesce(r->>'lotcode','')),'[^A-Z0-9]','','g'),'^20([0-9]{2})','\1') exact_lot
 FROM public.ph_master_inventory m WHERE upper(btrim(m.itemcode))=upper(btrim(r->>'itemcode')) AND upper(btrim(m.locationcode))=upper(btrim(r->>'locationcode'))
 ) SELECT c.unique_id FROM candidates c WHERE c.explicit_uid
 OR (c.exact_lot AND (SELECT count(*) FROM candidates x WHERE x.exact_lot)=1)
 OR ((SELECT count(*) FROM candidates)=1 AND NOT EXISTS(SELECT 1 FROM candidates x WHERE x.exact_lot))
 ORDER BY c.explicit_uid DESC NULLS LAST,c.exact_lot DESC,c.unique_id LIMIT 1
$fn$;
CREATE OR REPLACE FUNCTION private.inherit_request_eval_v309() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m public.ph_master_inventory; n public.ph_location_sales_notes; links text; images jsonb;
BEGIN
 new.req_status:='Pending';new.status:='Pending';new.date_completed:=NULL;
 new.completed_by_username:=NULL;new.completed_by_display:=NULL;new.completed_by_email:=NULL;
 SELECT * INTO m FROM public.ph_master_inventory WHERE unique_id=private.eval_master_uid_v309(to_jsonb(new));
 IF m.unique_id IS NULL THEN RETURN new; END IF;
 SELECT * INTO n FROM public.ph_location_sales_notes WHERE unique_id=m.unique_id;
 new.master_id:=m.unique_id;
 links:=private.collect_item_detail_photo_links_v308(NULL,NULL,NULL,jsonb_build_array(
 CASE WHEN m.photo_date>clock_timestamp()-interval '10 days' AND coalesce(m.loc_photo_match,0)>0 THEN to_jsonb(m) ELSE '{}'::jsonb END,
 CASE WHEN coalesce(n.photo_date,m.photo_date)>clock_timestamp()-interval '10 days' AND coalesce(n.loc_photo_match,m.loc_photo_match,0)>0 THEN to_jsonb(n) ELSE '{}'::jsonb END,CASE WHEN private.try_timestamptz(new.photo_date)>clock_timestamp()-interval '10 days' AND coalesce(new.loc_photo_match,m.loc_photo_match,0)>0 THEN to_jsonb(new) ELSE '{}'::jsonb END));
 images:=coalesce(to_jsonb(string_to_array(nullif(links,''),',')),'[]'::jsonb);
 new.req_photo_link:=nullif(links,'');new.photo_url:=nullif(split_part(links,',',1),'');new.photos:=images;
 new.req_photo_name:=coalesce(nullif(m.photo_name,''),nullif(n.photo_name,''),new.req_photo_name);
 new.photo_date:=coalesce(m.photo_date,n.photo_date)::text;
 new.req_spec:=coalesce(private.eval_text_v309(new.req_spec),private.eval_text_v309(m.spec),private.eval_text_v309(n.spec));new.spec:=new.req_spec;
 new.req_caliper:=coalesce(private.eval_text_v309(new.req_caliper),private.eval_text_v309(m.caliper),private.eval_text_v309(n.caliper));new.caliper:=new.req_caliper;
 new.req_match:=coalesce(new.req_match,m.loc_match_pct,private.request_numeric_v2362(m.match),n.loc_match_pct);new.loc_match_pct:=new.req_match;
 new.loc_photo_match:=coalesce(m.loc_photo_match,n.loc_photo_match,new.loc_photo_match);
 new.initial_photo_match_qty:=coalesce(m.initial_photo_match_qty,new.initial_photo_match_qty);new.baseline_on_hand:=coalesce(m.baseline_on_hand,new.baseline_on_hand);
 new.av_note:=coalesce(private.eval_text_v309(new.av_note),private.eval_text_v309(m.av_note),private.eval_text_v309(n.av_note));
 new.req_pic_note:=coalesce(private.eval_text_v309(new.req_pic_note),private.eval_text_v309(m.pick_note),private.eval_text_v309(m.pic_note),private.eval_text_v309(n.pick_note));new.pick_note:=new.req_pic_note;
 new.req_sales_note:=coalesce(private.eval_text_v309(new.req_sales_note),private.eval_text_v309(m.sales_note),private.eval_text_v309(n.sales_note));new.sales_note:=new.req_sales_note;
 new.req_status:='Pending';new.status:='Pending';new.date_completed:=NULL;
 new.completed_by_username:=NULL;new.completed_by_display:=NULL;new.completed_by_email:=NULL;
 -- Inherited evaluation belongs to inventory; the newly submitted Request stays pending.
 RETURN new;
END $fn$;
CREATE OR REPLACE FUNCTION private.protect_eval_data_from_blank_overwrite_v309() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE prior jsonb:=to_jsonb(old); incoming jsonb:=to_jsonb(new); k text; photo_time timestamptz; expiry timestamptz; depleted boolean:=false; allow_photo_clear boolean:=false; links text; images jsonb;
BEGIN
 IF current_setting('app.eval_force_clear_photos',true)='on' THEN RETURN new; END IF;
 IF tg_op='INSERT' THEN prior:='{}'::jsonb; END IF;
 photo_time:=coalesce(private.try_timestamptz(prior->>'photo_date'),private.try_timestamptz(prior->>'date_completed'),private.try_timestamptz(prior->>'completed_at'));
 expiry:=private.try_timestamptz(prior->>'photo_expires_at');
 allow_photo_clear:=(photo_time IS NOT NULL AND photo_time<=clock_timestamp()-interval '10 days') OR (expiry IS NOT NULL AND expiry<=clock_timestamp());
 depleted:=tg_table_name='ph_master_inventory' AND coalesce(private.request_numeric_v2362(incoming->>'ptravailable'),0)<coalesce(private.request_numeric_v2362(prior->>'ptravailable'),0)
  AND coalesce(private.request_numeric_v2362(incoming->>'loc_photo_match'),private.request_numeric_v2362(incoming->>'loc_match_qty'),0)<=0;
 allow_photo_clear:=allow_photo_clear OR depleted;
 FOREACH k IN ARRAY ARRAY['spec','caliper','match','loc_match_qty','av_note','pick_note','pic_note','sales_note','req_spec','req_caliper','req_pic_note','req_sales_note','req_comments','comments','photo_link','req_photo_link','photo_name','req_photo_name','photo_url','photo_date','date_completed','completed_at'] LOOP
  IF allow_photo_clear AND k IN ('photo_link','req_photo_link','photo_name','req_photo_name','photo_url','photo_date','date_completed','completed_at','match','loc_match_qty') THEN CONTINUE; END IF;
  IF prior?k AND private.eval_text_v309(prior->>k) IS NOT NULL AND private.eval_text_v309(incoming->>k) IS NULL THEN incoming:=jsonb_set(incoming,ARRAY[k],prior->k,true); END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['match','loc_match_qty','loc_match_pct','loc_photo_match','req_match','initial_photo_match_qty','initial_loc_photo_match','baseline_on_hand','eval_baseline_available'] LOOP
  IF allow_photo_clear THEN CONTINUE; END IF;
  IF prior?k AND coalesce(private.request_numeric_v2362(prior->>k),0)>0 AND coalesce(private.request_numeric_v2362(incoming->>k),0)<=0 THEN incoming:=jsonb_set(incoming,ARRAY[k],prior->k,true); END IF;
 END LOOP;
 IF NOT allow_photo_clear AND jsonb_typeof(prior->'photos')='array' AND jsonb_array_length(prior->'photos')>0 AND (jsonb_typeof(incoming->'photos') IS DISTINCT FROM 'array' OR incoming->'photos'='[]'::jsonb) THEN incoming:=jsonb_set(incoming,'{photos}',prior->'photos',true); END IF;
 IF NOT allow_photo_clear THEN
  links:=private.collect_item_detail_photo_links_v308(NULL,NULL,NULL,jsonb_build_array(prior,incoming));
  IF links<>'' THEN
   SELECT jsonb_agg(coalesce((SELECT p FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(prior->'photos')='array' THEN prior->'photos' ELSE '[]'::jsonb END ||
      CASE WHEN jsonb_typeof(incoming->'photos')='array' THEN incoming->'photos' ELSE '[]'::jsonb END) p
      WHERE coalesce(p->>'url',p->>'src',p->>'photo_url',p#>>'{}')=link LIMIT 1),to_jsonb(link)) ORDER BY n)
    INTO images FROM unnest(string_to_array(links,',')) WITH ORDINALITY q(link,n);
   incoming:=incoming||jsonb_build_object('photos',images,'photo_url',split_part(links,',',1));
   IF incoming?'photo_link' THEN incoming:=jsonb_set(incoming,'{photo_link}',to_jsonb(links),true); END IF;
   IF incoming?'req_photo_link' THEN incoming:=jsonb_set(incoming,'{req_photo_link}',to_jsonb(links),true); END IF;
  END IF;
 END IF;
 new:=jsonb_populate_record(new,incoming);RETURN new;
END $fn$;
CREATE OR REPLACE FUNCTION private.publish_queue_evaluation_v309(r jsonb,kind text,completed boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m public.ph_master_inventory; e jsonb:=private.eval_row_payload_v309(r,kind); links text; images jsonb; pct numeric; qty numeric; stock numeric; available numeric; photo_time timestamptz; done_at timestamptz; changed boolean; fresh_eval boolean; initial_qty numeric; initial_photo_qty numeric; baseline numeric; available_baseline numeric;
 prior_guard text:=coalesce(current_setting('app.eval_publication_v309',true),''); prior_ledger text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),''); prior_uid text:=coalesce(current_setting('app.eval_publication_uid_v309',true),'');
BEGIN
 IF prior_guard='on' THEN RETURN; END IF;
 SELECT * INTO m FROM public.ph_master_inventory WHERE unique_id=private.eval_master_uid_v309(r) FOR UPDATE;
 IF m.unique_id IS NULL THEN RETURN; END IF;
 IF current_setting('app.eval_force_clear_photos',true)='on' THEN
  links:=coalesce(e->>'photo_link','');
 ELSE links:=private.collect_item_detail_photo_links_v308(NULL,NULL,NULL,jsonb_build_array(
  CASE WHEN greatest(private.try_timestamptz(e->>'photo_date'),m.photo_date)>clock_timestamp()-interval '10 days' OR private.try_timestamptz(e->>'photo_date') IS NULL AND m.photo_date IS NULL THEN e ELSE e-'photos'-'photo_url'-'photo_link'-'photo_name' END,
  CASE WHEN m.photo_date>clock_timestamp()-interval '10 days' AND coalesce(m.loc_photo_match,0)>0 THEN to_jsonb(m) ELSE '{}'::jsonb END)); END IF;
 images:=coalesce(to_jsonb(string_to_array(nullif(links,''),',')),'[]'::jsonb);
 pct:=coalesce(private.request_numeric_v2362(e->>'pct'),m.loc_match_pct,private.request_numeric_v2362(m.match));
 stock:=greatest(0,coalesce(private.request_numeric_v2362(m.ptronhand),0));available:=greatest(0,coalesce(private.request_numeric_v2362(m.ptravailable),stock));
 fresh_eval:=completed OR pct IS DISTINCT FROM coalesce(m.loc_match_pct,private.request_numeric_v2362(m.match)) OR (current_setting('app.eval_force_clear_photos',true) IS DISTINCT FROM 'on' AND nullif(links,'') IS DISTINCT FROM nullif(m.photo_link,''));
 qty:=CASE WHEN fresh_eval AND pct BETWEEN 0 AND 100 THEN round(stock*pct/100) ELSE coalesce(m.loc_photo_match,private.request_numeric_v2362(m.loc_match_qty),CASE WHEN pct BETWEEN 0 AND 100 THEN round(stock*pct/100) END) END;
 initial_qty:=CASE WHEN fresh_eval THEN qty ELSE coalesce(m.initial_loc_photo_match,m.initial_photo_match_qty,qty) END;
 initial_photo_qty:=CASE WHEN fresh_eval THEN qty ELSE coalesce(m.initial_photo_match_qty,initial_qty) END;
 baseline:=CASE WHEN fresh_eval THEN available ELSE coalesce(m.baseline_on_hand,available) END;
 available_baseline:=CASE WHEN fresh_eval THEN available ELSE coalesce(m.eval_baseline_available,available) END;
 photo_time:=CASE WHEN links<>'' THEN greatest(private.try_timestamptz(e->>'photo_date'),m.photo_date) END;
 done_at:=coalesce(m.date_completed,CASE WHEN completed THEN coalesce(private.try_timestamptz(r->>'date_completed'),clock_timestamp()) END);
 IF links='' AND e-'photos'-'photo_url'-'photo_link'-'photo_name'-'photo_date'='{}'::jsonb AND NOT completed AND current_setting('app.eval_force_clear_photos',true) IS DISTINCT FROM 'on' THEN RETURN; END IF;
 changed:=(m.spec,m.caliper,m.av_note,m.pick_note,m.sales_note,m.photo_link,m.loc_match_pct,m.loc_photo_match,m.date_completed) IS DISTINCT FROM
  (coalesce(e->>'spec',m.spec),coalesce(e->>'caliper',m.caliper),coalesce(e->>'av_note',m.av_note),coalesce(e->>'pick_note',m.pick_note),coalesce(e->>'sales_note',m.sales_note),nullif(links,''),pct,qty,done_at);
 IF NOT changed THEN RETURN; END IF;
 PERFORM set_config('app.eval_publication_v309','on',true);PERFORM set_config('app.eval_publication_uid_v309',m.unique_id,true);
 INSERT INTO app_sync_private.inventory_location_evidence_v1 AS stored(itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,source_lotcode,spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,photo_link,photo_name,date_completed,updated_at,updated_by,baseline_on_hand,loc_match_pct,initial_photo_match_qty,current_photo_match_qty,eval_baseline_available,initial_loc_photo_match,evaluated_at,expires_at,cleared_at,clear_reason)
 VALUES(upper(btrim(m.itemcode)),upper(btrim(m.locationcode)),m.itemcode,m.locationcode,m.unique_id,m.lotcode,coalesce(e->>'spec',m.spec),coalesce(e->>'caliper',m.caliper),pct::text,qty::text,stock::text,coalesce(e->>'av_note',m.av_note),coalesce(e->>'pick_note',m.pick_note,m.pic_note),coalesce(e->>'sales_note',m.sales_note),nullif(links,''),coalesce(e->>'photo_name',m.photo_name),done_at,clock_timestamp(),coalesce(auth.uid()::text,'queue-publisher-v309'),baseline,pct,initial_photo_qty,qty,available_baseline,initial_qty,photo_time,photo_time+interval '10 days',NULL,NULL)
 ON CONFLICT(source_unique_id) DO UPDATE SET source_lotcode=excluded.source_lotcode,spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,updated_at=excluded.updated_at,updated_by=excluded.updated_by,baseline_on_hand=excluded.baseline_on_hand,loc_match_pct=excluded.loc_match_pct,initial_photo_match_qty=excluded.initial_photo_match_qty,current_photo_match_qty=excluded.current_photo_match_qty,eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match,evaluated_at=excluded.evaluated_at,expires_at=excluded.expires_at,cleared_at=CASE WHEN fresh_eval THEN NULL ELSE stored.cleared_at END,clear_reason=CASE WHEN fresh_eval THEN NULL ELSE stored.clear_reason END;
 PERFORM set_config('gnc.inventory_location_evidence_apply','on',true);
 UPDATE public.ph_master_inventory SET spec=coalesce(e->>'spec',m.spec),caliper=coalesce(e->>'caliper',m.caliper),match=pct::text,loc_match_pct=pct,loc_match_qty=qty::text,loc_photo_match=qty,initial_ptr=stock::text,baseline_on_hand=baseline,initial_photo_match_qty=initial_photo_qty,eval_baseline_available=available_baseline,initial_loc_photo_match=initial_qty,av_note=coalesce(e->>'av_note',m.av_note),pic_note=coalesce(e->>'pick_note',m.pic_note),pick_note=coalesce(e->>'pick_note',m.pick_note),sales_note=coalesce(e->>'sales_note',m.sales_note),photo_link=nullif(links,''),photo_name=coalesce(e->>'photo_name',m.photo_name),photos=images,photo_url=nullif(split_part(links,',',1),''),photo_date=photo_time,photo_expires_at=photo_time+interval '10 days',date_completed=done_at,last_updated=clock_timestamp() WHERE unique_id=m.unique_id RETURNING * INTO m;
 INSERT INTO public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,spec,caliper,loc_match_pct,loc_photo_match,av_note,pick_note,sales_note,photo_link,photo_name,photos,photo_url,photo_date,completed_at,eval_baseline_available,initial_loc_photo_match,updated_at)
 VALUES(m.unique_id,coalesce(m.source,''),m.itemcode,m.locationcode,coalesce(m.lotcode,''),m.spec,m.caliper,m.loc_match_pct,m.loc_photo_match,m.av_note,m.pick_note,m.sales_note,m.photo_link,m.photo_name,m.photos,m.photo_url,m.photo_date,m.date_completed,m.eval_baseline_available,m.initial_loc_photo_match,clock_timestamp())
 ON CONFLICT(unique_id) DO UPDATE SET spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,loc_photo_match=excluded.loc_photo_match,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,photo_link=excluded.photo_link,photo_name=excluded.photo_name,photos=excluded.photos,photo_url=excluded.photo_url,photo_date=excluded.photo_date,completed_at=excluded.completed_at,eval_baseline_available=excluded.eval_baseline_available,initial_loc_photo_match=excluded.initial_loc_photo_match,updated_at=excluded.updated_at;
 UPDATE public.ph_requests_pending p SET req_spec=m.spec,spec=m.spec,req_caliper=m.caliper,caliper=m.caliper,req_match=m.loc_match_pct,loc_match_pct=m.loc_match_pct,loc_photo_match=m.loc_photo_match,av_note=m.av_note,req_pic_note=m.pick_note,pick_note=m.pick_note,req_sales_note=m.sales_note,sales_note=m.sales_note,req_photo_link=m.photo_link,req_photo_name=m.photo_name,photos=m.photos,photo_url=m.photo_url,photo_date=m.photo_date::text
 WHERE p.master_id=m.unique_id AND (kind<>'request' OR p.unique_id IS DISTINCT FROM r->>'unique_id')
 AND (p.req_spec,p.req_caliper,p.req_match,p.loc_photo_match,p.av_note,p.req_pic_note,p.req_sales_note,p.req_photo_link,p.photos) IS DISTINCT FROM (m.spec,m.caliper,m.loc_match_pct,m.loc_photo_match,m.av_note,m.pick_note,m.sales_note,m.photo_link,m.photos);
 UPDATE public.app_dataset_revisions SET revision=revision+1,changed_at=clock_timestamp() WHERE key IN ('ph_av_notes','ph_requests_pending');
 PERFORM set_config('gnc.inventory_location_evidence_apply',prior_ledger,true);PERFORM set_config('app.eval_publication_v309',prior_guard,true);PERFORM set_config('app.eval_publication_uid_v309',prior_uid,true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('gnc.inventory_location_evidence_apply',prior_ledger,true);PERFORM set_config('app.eval_publication_v309',prior_guard,true);PERFORM set_config('app.eval_publication_uid_v309',prior_uid,true);RAISE;
END $fn$;
CREATE OR REPLACE FUNCTION private.sync_completed_request_to_master_v309() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r jsonb:=to_jsonb(new); kind text:=CASE WHEN tg_table_name='ph_requests_pending' THEN 'request' ELSE 'suspend' END; completed boolean;
BEGIN
 IF current_setting('app.eval_publication_v309',true)='on' OR pg_trigger_depth()>1 THEN RETURN new; END IF;
 completed:=lower(coalesce(r->>'req_status',r->>'status','')) IN ('complete','completed','done') OR nullif(r->>'date_completed','') IS NOT NULL;
 IF tg_table_name='ph_requests_pending' AND tg_op='INSERT' AND NOT completed THEN RETURN new; END IF;
 IF tg_table_name='ph_soc_master' AND NOT suspend_tag_private.eligible(r->>'suspend',r->>'suspend_to') THEN RETURN new; END IF;
 IF tg_op='UPDATE' AND private.eval_row_payload_v309(r,kind)=private.eval_row_payload_v309(to_jsonb(old),kind)
  AND (r->>'req_status',r->>'status',r->>'date_completed') IS NOT DISTINCT FROM (to_jsonb(old)->>'req_status',to_jsonb(old)->>'status',to_jsonb(old)->>'date_completed') THEN RETURN new; END IF;
 IF tg_op='UPDATE' THEN
  completed:=completed AND (lower(coalesce(to_jsonb(old)->>'req_status',to_jsonb(old)->>'status','')) NOT IN ('complete','completed','done') AND nullif(to_jsonb(old)->>'date_completed','') IS NULL
   OR nullif(r->>'date_completed','') IS DISTINCT FROM nullif(to_jsonb(old)->>'date_completed',''));
 END IF;
 PERFORM private.publish_queue_evaluation_v309(r,kind,completed);RETURN new;
END $fn$;
-- Trigger names place inheritance before legacy aliases and shielding after all formatters.
DROP TRIGGER IF EXISTS a00000_inherit_request_eval_v309 ON public.ph_requests_pending;
CREATE TRIGGER a00000_inherit_request_eval_v309 BEFORE INSERT ON public.ph_requests_pending FOR EACH ROW EXECUTE FUNCTION private.inherit_request_eval_v309();
DROP TRIGGER IF EXISTS zzzzzzzz_protect_eval_data_from_blank_overwrite_trg ON public.ph_master_inventory;
CREATE TRIGGER zzzzzzzz_protect_eval_data_from_blank_overwrite_trg BEFORE INSERT OR UPDATE ON public.ph_master_inventory FOR EACH ROW EXECUTE FUNCTION private.protect_eval_data_from_blank_overwrite_v309();
DROP TRIGGER IF EXISTS zzzzzzzz_protect_eval_data_from_blank_overwrite_trg ON public.ph_location_sales_notes;
CREATE TRIGGER zzzzzzzz_protect_eval_data_from_blank_overwrite_trg BEFORE INSERT OR UPDATE ON public.ph_location_sales_notes FOR EACH ROW EXECUTE FUNCTION private.protect_eval_data_from_blank_overwrite_v309();
DROP TRIGGER IF EXISTS zzzzzzzz_protect_eval_data_from_blank_overwrite_trg ON public.ph_requests_pending;
CREATE TRIGGER zzzzzzzz_protect_eval_data_from_blank_overwrite_trg BEFORE INSERT OR UPDATE ON public.ph_requests_pending FOR EACH ROW EXECUTE FUNCTION private.protect_eval_data_from_blank_overwrite_v309();
DROP TRIGGER IF EXISTS sync_completed_request_to_master_trg ON public.ph_requests_pending;
CREATE TRIGGER sync_completed_request_to_master_trg AFTER INSERT OR UPDATE OF req_spec,req_caliper,req_match,req_pic_note,req_sales_note,req_comments,av_note,req_photo_link,req_photo_name,photos,photo_url,photo_date,spec,caliper,loc_match_pct,loc_photo_match,pick_note,sales_note,req_status,date_completed ON public.ph_requests_pending FOR EACH ROW EXECUTE FUNCTION private.sync_completed_request_to_master_v309();
-- ph_active_suspend is a view; its physical source owns the trigger.
DROP TRIGGER IF EXISTS sync_completed_request_to_master_trg ON public.ph_soc_master;
CREATE TRIGGER sync_completed_request_to_master_trg AFTER INSERT OR UPDATE OF dock_spec,dock_caliper,dock_note,dock_photo_link,dock_photo_name,spec,caliper,match,loc_match_qty,av_note,pick_note,sales_note,photos,photo_url,date_completed ON public.ph_soc_master FOR EACH ROW EXECUTE FUNCTION private.sync_completed_request_to_master_v309();
DO $patch$
DECLARE s text; name text;
BEGIN
 -- The publisher supplies verified quantities, baselines and original dates for this exact UID.
 -- Avoid the legacy INSERT/UPDATE normalizers reinterpreting a note-only upsert as a new evaluation.
 FOREACH name IN ARRAY ARRAY['private.normalize_inventory_location_evidence_v2','private.apply_inventory_location_evidence_v1','private.sync_master_inventory_canonical_v2362'] LOOP
  s:=pg_get_functiondef(name::regproc);
  IF strpos(s,'app.eval_publication_uid_v309')=0 THEN
   s:=regexp_replace(s,'\m[Bb][Ee][Gg][Ii][Nn]\M',E'BEGIN\n  IF current_setting(''app.eval_publication_v309'',true)=''on'' AND current_setting(''app.eval_publication_uid_v309'',true)=coalesce(to_jsonb(new)->>''source_unique_id'',to_jsonb(new)->>''unique_id'') THEN RETURN new; END IF;');
   EXECUTE s;
  END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['private.propagate_drive_av_to_pending_requests','private.publish_drive_evidence_to_soc_v23142'] LOOP
  s:=pg_get_functiondef(name::regproc);
  IF strpos(s,'app.eval_publication_v309')=0 THEN
   s:=regexp_replace(s,'\m[Bb][Ee][Gg][Ii][Nn]\M',E'BEGIN\n  IF current_setting(''app.eval_publication_v309'',true)=''on'' THEN RETURN NULL; END IF;');
   EXECUTE s;
  END IF;
 END LOOP;
 s:=pg_get_functiondef('public.save_drive_evidence_v3'::regproc);
 IF strpos(s,'app.eval_force_clear_photos')=0 THEN
  s:=replace(s,'  if stable_item=',$src$  IF payload->'force_clear_photos'='true'::jsonb OR (payload?'match' AND private.request_numeric_v2362(payload->>'match')=0) THEN PERFORM set_config('app.eval_force_clear_photos','on',true); END IF;
  payload:=payload-'force_clear_photos';
  if stable_item=$src$);
  s:=replace(s,'private.collect_item_detail_photo_links_v308(current_row.itemcode,current_row.locationcode,current_row.lotcode,jsonb_build_array(to_jsonb(current_row),payload))',
   $src$CASE WHEN p_evidence->'force_clear_photos'='true'::jsonb THEN coalesce(payload->>'photo_link','') ELSE private.collect_item_detail_photo_links_v308(current_row.itemcode,current_row.locationcode,current_row.lotcode,jsonb_build_array(to_jsonb(current_row),payload)) END$src$);
  EXECUTE s;
 END IF;
 s:=pg_get_functiondef('public.save_request_work_v1_pre_state_machine_v2359'::regproc);
 IF strpos(s,'app.eval_force_clear_photos')=0 THEN
  s:=replace(s,'  expected_version := existing.row_version;',$src$  IF patch->'force_clear_photos'='true'::jsonb OR (patch?'req_match' AND private.request_numeric_v2362(patch->>'req_match')=0) THEN PERFORM set_config('app.eval_force_clear_photos','on',true); END IF;
  patch:=patch-'force_clear_photos';
  expected_version := existing.row_version;$src$);
  s:=replace(s,'private.collect_item_detail_photo_links_v308(existing.itemcode,existing.locationcode,existing.lotcode,jsonb_build_array(to_jsonb(existing),patch))',
   $src$CASE WHEN current_setting('app.eval_force_clear_photos',true)='on' THEN coalesce(patch->>'req_photo_link','') ELSE private.collect_item_detail_photo_links_v308(existing.itemcode,existing.locationcode,existing.lotcode,jsonb_build_array(to_jsonb(existing),patch)) END$src$);
  EXECUTE s;
 END IF;
 s:=pg_get_functiondef('public.request_work_command_v1_pre_state_machine_v2359'::regproc);
 s:=replace(s,'k not in (''req_match''','k not in (''force_clear_photos'',''req_match''');
 EXECUTE s;
 s:=pg_get_functiondef('suspend_tag_private.command'::regproc);
 s:=replace(s,'array[''dock_spec''','array[''force_clear_photos'',''dock_spec''');
 s:=replace(s,'      -- Preserve concurrent photos while allowing field edits on the latest locked source.',
 $src$      IF patch->'force_clear_photos'='true'::jsonb OR (patch?'match' AND private.request_numeric_v2362(patch->>'match')=0) THEN PERFORM set_config('app.eval_force_clear_photos','on',true); END IF;
      patch:=patch-'force_clear_photos';
      -- Preserve concurrent photos while allowing field edits on the latest locked source.$src$);
 s:=replace(s,'if patch ? ''dock_photo_link'' then','if patch ? ''dock_photo_link'' and current_setting(''app.eval_force_clear_photos'',true) IS DISTINCT FROM ''on'' then');
 s:=replace(s,'private.collect_item_detail_photo_links_v308(s.itemcode,s.locationcode,s.lotcode,jsonb_build_array(to_jsonb(s),patch))',
 $src$CASE WHEN current_setting('app.eval_force_clear_photos',true)='on' THEN coalesce(patch->>'dock_photo_link','') ELSE private.collect_item_detail_photo_links_v308(s.itemcode,s.locationcode,s.lotcode,jsonb_build_array(to_jsonb(s),patch)) END$src$);
 EXECUTE s;
 s:=pg_get_functiondef('suspend_tag_private.publish_inventory_evidence_v23119'::regproc);
 s:=replace(s,'evidence:=''{}'';',$src$evidence:='{}';
  IF current_setting('app.eval_force_clear_photos',true)='on' THEN evidence:=jsonb_build_object('force_clear_photos',true); END IF;$src$);
 s:=replace(s,'IF patch?''dock_photo_link'' THEN evidence:=evidence||jsonb_build_object(''photo_link'',coalesce(',
 'IF patch?''dock_photo_link'' THEN evidence:=evidence||jsonb_build_object(''photo_link'',CASE WHEN current_setting(''app.eval_force_clear_photos'',true)=''on'' THEN coalesce(s.dock_photo_link,'''') ELSE coalesce(');
 s:=replace(s,'photos),'''')); END IF;','photos),'''') END); END IF;');
 EXECUTE s;
 s:=pg_get_functiondef('public.reconcile_inventory_location_evidence_v1'::regproc);
 IF strpos(s,'app.eval_force_clear_photos')=0 THEN
  s:=replace(s,'  previous_guard text:=',$src$  v309_force_before text:=coalesce(current_setting('app.eval_force_clear_photos',true),'');
  previous_guard text:=$src$);
  s:=replace(s,'  perform set_config(''gnc.inventory_location_evidence_apply'',''on'',true);',$src$  perform set_config('app.eval_force_clear_photos','on',true);
  perform set_config('gnc.inventory_location_evidence_apply','on',true);$src$);
  s:=replace(s,'  perform set_config(''gnc.inventory_location_evidence_apply'',previous_guard,true);',$src$  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  perform set_config('app.eval_force_clear_photos',v309_force_before,true);$src$);
  EXECUTE s;
 END IF;
END $patch$;
REVOKE ALL ON FUNCTION private.eval_text_v309(text),private.eval_row_payload_v309(jsonb,text),private.eval_master_uid_v309(jsonb),private.inherit_request_eval_v309(),private.protect_eval_data_from_blank_overwrite_v309(),private.publish_queue_evaluation_v309(jsonb,text,boolean),private.sync_completed_request_to_master_v309() FROM PUBLIC,anon,authenticated;
-- Complete metadata for the already-restored, exact-UID evaluations from today's completed Requests.
UPDATE public.ph_location_sales_notes n SET photo_url=coalesce(nullif(n.photo_url,''),m.photo_url,nullif(split_part(m.photo_link,',',1),'')),
 photo_date=coalesce(n.photo_date,m.photo_date),loc_photo_match=coalesce(n.loc_photo_match,m.loc_photo_match)
FROM public.ph_master_inventory m
WHERE n.unique_id=m.unique_id AND (n.photo_url IS NULL OR n.photo_date IS NULL OR n.loc_photo_match IS NULL)
 AND jsonb_typeof(n.photos)='array' AND jsonb_array_length(n.photos)>0
 AND EXISTS(SELECT 1 FROM public.ph_requests_completed_history h WHERE h.master_id=m.unique_id
  AND (private.try_timestamptz(to_jsonb(h)->>'date_completed') AT TIME ZONE 'America/Chicago')::date=DATE '2026-11-06');
COMMIT;