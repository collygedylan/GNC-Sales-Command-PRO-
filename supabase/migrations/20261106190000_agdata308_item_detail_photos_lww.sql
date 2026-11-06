BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='20s';
-- v3.0.8: optional evaluation evidence; authorized row commands remain atomic.
ALTER TABLE public.ph_location_sales_notes ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION private.collect_item_detail_photo_links_v308(p_item text,p_location text,p_lot text,p_refs jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH inventory AS (
  SELECT to_jsonb(m) doc, 'inventory' kind FROM public.ph_master_inventory m WHERE upper(btrim(m.itemcode))=upper(btrim(p_item)) AND upper(btrim(m.locationcode))=upper(btrim(p_location))
 ), notes AS (
  SELECT to_jsonb(n) doc, 'notes' kind FROM public.ph_location_sales_notes n WHERE upper(btrim(n.itemcode))=upper(btrim(p_item)) AND upper(btrim(n.locationcode))=upper(btrim(p_location))
 ), candidates AS (SELECT * FROM inventory UNION ALL SELECT * FROM notes), scoped AS (
  SELECT doc FROM candidates c WHERE nullif(btrim(p_lot),'') IS NULL OR upper(btrim(coalesce(doc->>'lotcode','')))=upper(btrim(p_lot))
   OR NOT EXISTS(SELECT 1 FROM candidates x WHERE x.kind=c.kind AND upper(btrim(coalesce(x.doc->>'lotcode','')))=upper(btrim(p_lot)))
 ), refs AS (
  SELECT value doc,n ord FROM jsonb_array_elements(coalesce(p_refs,'[]'::jsonb)) WITH ORDINALITY a(value,n)
  UNION ALL SELECT doc,10000+row_number() OVER(ORDER BY doc->>'unique_id') FROM scoped
 ), fields AS (
  SELECT value,ord,array_position(ARRAY['photo_link','req_photo_link','drive_photo_link','dock_photo_link','photos','request_photos','photo_urls','photo_url'],key) field_ord
  FROM refs CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(doc)='object' THEN doc ELSE jsonb_build_object('photos',doc) END)
  WHERE key IN ('photos','request_photos','photo_urls','photo_url','photo_link','req_photo_link','drive_photo_link','dock_photo_link')
 ), entries AS (
  SELECT entry,ord,field_ord,entry_ord FROM fields CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE jsonb_build_array(value) END) WITH ORDINALITY a(entry,entry_ord)
 ), links AS (
  SELECT btrim(link) link,ord,field_ord,entry_ord,split_ord FROM entries CROSS JOIN LATERAL regexp_split_to_table(CASE WHEN jsonb_typeof(entry)='object' THEN coalesce(entry->>'url',entry->>'src',entry->>'photo_url',entry->>'photo_link','') ELSE coalesce(entry#>>'{}','') END,',') WITH ORDINALITY a(link,split_ord)
 ), unique_links AS (
  SELECT DISTINCT ON(link) link,ord,field_ord,entry_ord,split_ord FROM links WHERE link~'^https?://' ORDER BY link,ord,field_ord,entry_ord,split_ord
 ) SELECT coalesce(string_agg(link,',' ORDER BY ord,field_ord,entry_ord,split_ord),'') FROM unique_links
$fn$;
REVOKE ALL ON FUNCTION private.collect_item_detail_photo_links_v308(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.sync_item_detail_photos_v308(p_master_uid text,p_links text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m public.ph_master_inventory; links text:=coalesce(p_links,''); images jsonb:=coalesce(to_jsonb(string_to_array(nullif(p_links,''),',')),'[]'::jsonb);
BEGIN
 SELECT * INTO m FROM public.ph_master_inventory WHERE unique_id=p_master_uid;
 IF m.unique_id IS NULL THEN RETURN; END IF;
 UPDATE public.ph_master_inventory SET photo_link=links,photo_url=nullif(split_part(links,',',1),''),photos=images
 WHERE unique_id=m.unique_id AND (photo_link,photos) IS DISTINCT FROM (links,images);
 INSERT INTO public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,photos,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,updated_at)
 VALUES(m.unique_id,coalesce(m.source,''),m.itemcode,m.locationcode,coalesce(m.lotcode,''),links,m.photo_name,images,coalesce(nullif(m.spec,''),'N/A'),m.caliper,m.loc_match_pct,m.av_note,m.pick_note,m.sales_note,clock_timestamp())
 ON CONFLICT(unique_id) DO UPDATE SET photo_link=excluded.photo_link,photo_name=excluded.photo_name,photos=excluded.photos,spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_at=excluded.updated_at;
 UPDATE public.ph_requests_pending r SET req_photo_link=links,photo_url=nullif(split_part(links,',',1),''),photos=images
 WHERE r.master_id=m.unique_id AND (r.req_photo_link,r.photos) IS DISTINCT FROM (links,images);
 -- ph_active_suspend is the security-invoker view of these physical SOC tag rows.
 UPDATE public.ph_soc_master s SET dock_photo_link=links,photo_link=links,photo_url=nullif(split_part(links,',',1),''),photos=images
 WHERE upper(btrim(s.itemcode))=upper(btrim(m.itemcode)) AND upper(btrim(s.locationcode))=upper(btrim(m.locationcode))
  AND upper(btrim(coalesce(s.lotcode,'')))=upper(btrim(coalesce(m.lotcode,'')))
  AND suspend_tag_private.eligible(s.suspend,s.suspend_to) AND (s.dock_photo_link,s.photo_link,s.photos) IS DISTINCT FROM (links,links,images);
END $fn$;
REVOKE ALL ON FUNCTION private.sync_item_detail_photos_v308(text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.wait_item_detail_lock_v308(p_key bigint)
RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path='' AS $fn$
BEGIN PERFORM pg_advisory_xact_lock(p_key); RETURN true; END $fn$;
REVOKE ALL ON FUNCTION private.wait_item_detail_lock_v308(bigint) FROM PUBLIC,anon,authenticated;

-- Optional evidence stays optional when denied-tag Mark Done requests another approval.
-- Keep validation of a supplied match value; blank photos, match and AV note are accepted.
CREATE OR REPLACE FUNCTION suspend_tag_private.validate_review(s public.ph_soc_master)
RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE pct numeric;
BEGIN
 IF nullif(btrim(s.match),'') IS NOT NULL THEN
  IF s.match !~ '^\s*[0-9]+(\.[0-9]+)?\s*%?\s*$' THEN RAISE EXCEPTION 'SUSPEND_TAG_MATCH_INVALID' USING ERRCODE='22023'; END IF;
  pct:=replace(s.match,'%','')::numeric;
  IF pct<0 OR pct>100 THEN RAISE EXCEPTION 'SUSPEND_TAG_MATCH_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
END $fn$;

DO $migration$
DECLARE definition text; before_text text; after_text text; name text;
BEGIN
 -- Merge at the locked canonical Request writer, covering Edge and direct PostgREST RPC callers.
 definition:=pg_get_functiondef('public.save_request_work_v1_pre_state_machine_v2359'::regproc);
 before_text:='  expected_version := existing.row_version;';
 after_text:=$src$  expected_version := existing.row_version;
  -- v3.0.8 merge every published/draft photo without making photos mandatory.
  patch:=patch||jsonb_build_object('req_spec',coalesce(nullif(btrim(patch->>'req_spec'),''),nullif(btrim(existing.req_spec),''),'N/A'),
   'req_photo_link',private.collect_item_detail_photo_links_v308(existing.itemcode,existing.locationcode,existing.lotcode,jsonb_build_array(to_jsonb(existing),patch)));
  patch:=patch||jsonb_build_object('drive_photo_link',patch->>'req_photo_link');$src$;
 IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'AGDATA308_REQUEST_MERGE_ANCHOR'; END IF;
 definition:=replace(definition,before_text,after_text);
 definition:=replace(definition,' or expected_version is null','');
 definition:=replace(definition,E'    and r.row_version = expected_version\n','');
 definition:=replace(definition,'message = ''REQUEST_VERSION_CONFLICT''','message = ''REQUEST_NOT_FOUND''');
 definition:=replace(definition,'      req_photo_link = case',E'      photos = coalesce(to_jsonb(string_to_array(nullif(patch->>''req_photo_link'',''''),'','')),''[]''::jsonb),\n      photo_url = nullif(split_part(coalesce(patch->>''req_photo_link'',''''),'','',1),''''),\n      req_photo_link = case');
 before_text:='    where m.unique_id = saved.master_id;';
 IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'AGDATA308_REQUEST_SYNC_ANCHOR'; END IF;
 definition:=replace(definition,before_text,before_text||E'\n    perform private.sync_item_detail_photos_v308(saved.master_id,patch->>''drive_photo_link'');');
 EXECUTE definition;
 definition:=pg_get_functiondef('public.save_request_work_pre_state_machine_v2359'::regproc);
 EXECUTE replace(definition,' or expected_version is null','');

 definition:=pg_get_functiondef('public.save_drive_evidence_v3'::regproc);
 before_text:=substring(definition from '  if current_row[.]date_completed is not null[\s\S]*?DRIVE_ROW_COMPLETED_UNLOCK_REQUIRED'';[\s]*end if;');
 IF before_text IS NULL THEN RAISE EXCEPTION 'AGDATA308_DRIVE_COMPLETION_ANCHOR'; END IF;
 definition:=replace(definition,before_text,'  -- v3.0.8: the authorized editor can complete again with optional evidence.');
 before_text:='  select * into evidence from app_sync_private.inventory_location_evidence_v1 e';
 after_text:=$src$  payload:=payload||jsonb_build_object('spec',coalesce(nullif(btrim(payload->>'spec'),''),nullif(btrim(current_row.spec),''),'N/A'),
    'photo_link',private.collect_item_detail_photo_links_v308(current_row.itemcode,current_row.locationcode,current_row.lotcode,jsonb_build_array(to_jsonb(current_row),payload)));
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e$src$;
 IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'AGDATA308_DRIVE_MERGE_ANCHOR'; END IF;
 definition:=replace(definition,before_text,after_text);
 before_text:='  select * into saved_row from public.ph_master_inventory m';
 IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'AGDATA308_DRIVE_SYNC_ANCHOR'; END IF;
 definition:=replace(definition,before_text,E'  perform private.sync_item_detail_photos_v308(p_master_uid,evidence.photo_link);\n'||before_text);
 -- Wait for the current exact row writer instead of making the user tap again.
 definition:=replace(definition,'pg_try_advisory_xact_lock(', 'private.wait_item_detail_lock_v308(');
 EXECUTE definition;

 FOREACH name IN ARRAY ARRAY['command','group_command'] LOOP
  definition:=pg_get_functiondef(('suspend_tag_private.'||name)::regproc);
  before_text:='if receipt.request<>input then raise exception ''SUSPEND_TAG_TOKEN_CONFLICT'' using errcode=''22023''; end if;';
  IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'AGDATA308_SUSPEND_TOKEN_ANCHOR %',name; END IF;
  after_text:='if receipt.request<>input then return suspend_tag_private.'||name||'(p_actor_id,p_operation,p_payload,md5(p_command_id::text||input::text)::uuid,null); end if;';
  definition:=replace(definition,before_text,after_text);
  definition:=regexp_replace(definition,'if [^;\n]* then raise exception ''SUSPEND_TAG_VERSION_CHANGED'' using errcode=''PT409''; end if;','','g');
  definition:=regexp_replace(definition,'if [^;\n]* then[\s]*raise exception ''SUSPEND_TAG_SOURCE_CHANGED'' using errcode=''PT409''; end if;','','g');
  IF name='command' THEN
   before_text:='      edited:=jsonb_populate_record(s,patch);';
   after_text:=$src$      patch:=patch||jsonb_build_object('dock_spec',coalesce(nullif(btrim(patch->>'dock_spec'),''),nullif(btrim(s.dock_spec),''),'N/A'),
        'dock_photo_link',private.collect_item_detail_photo_links_v308(s.itemcode,s.locationcode,s.lotcode,jsonb_build_array(to_jsonb(s),patch)));
      p_payload:=jsonb_set(p_payload,'{patch}',patch,true);
      edited:=jsonb_populate_record(s,patch);$src$;
   IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'AGDATA308_SUSPEND_MERGE_ANCHOR'; END IF;
   definition:=replace(definition,before_text,after_text);
  END IF;
  EXECUTE definition;
 END LOOP;
END $migration$;
COMMIT;