BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS private.request_photo_intents_v3079 (
  request_id text NOT NULL,
  photo_id text NOT NULL CHECK (photo_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  actor_id uuid NOT NULL,
  master_uid text NOT NULL,
  object_path text,
  published_url text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  PRIMARY KEY (request_id, photo_id)
);
ALTER TABLE private.request_photo_intents_v3079 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.request_photo_intents_v3079 FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.lock_request_photo_work_v3079(p_actor uuid,p_session uuid,p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
  IF NOT coalesce(suspend_tag_private.session_active(p_actor,p_session),false)
    OR nullif(btrim(p_request),'') IS NULL OR length(p_request)>200 THEN
    RAISE EXCEPTION 'REQUEST_WORK_SESSION_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('request-photo-v3079:'||p_request,0));
END $fn$;

CREATE OR REPLACE FUNCTION private.request_photo_actor_v3079(p_actor uuid,p_session uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated','session_id',p_session)::text,true);
END
$fn$;

CREATE OR REPLACE FUNCTION public.complete_request_with_photo_intents_v3079(p_actor_id uuid,p_session_id uuid,p_request_id text,
  p_expected_version bigint,p_patch jsonb,p_photo_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='8s' SET statement_timeout='30s' AS $fn$
DECLARE pending public.ph_requests_pending; selected_master_uid text; result jsonb;
BEGIN
  IF private.is_service_role_request() IS DISTINCT FROM true THEN RAISE EXCEPTION 'REQUEST_PHOTO_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM private.lock_request_photo_work_v3079(p_actor_id,p_session_id,p_request_id);
  IF cardinality(p_photo_ids)>500 OR EXISTS(SELECT FROM unnest(p_photo_ids) i WHERE i IS NULL OR i !~ '^[A-Za-z0-9_-]{1,64}$') THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_IDS_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO pending FROM public.ph_requests_pending WHERE unique_id=p_request_id FOR UPDATE;
  IF pending.unique_id IS NOT NULL THEN
    PERFORM private.request_photo_actor_v3079(p_actor_id,p_session_id);
    IF private.can_work_request_row_v3074(to_jsonb(pending)) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'REQUEST_ROW_FORBIDDEN' USING ERRCODE='42501';
    END IF;
    SELECT m.unique_id INTO selected_master_uid FROM public.ph_master_inventory m
    WHERE m.unique_id=private.eval_master_uid_v309(to_jsonb(pending))
      AND (m.itemcode,m.locationcode,m.lotcode)=(pending.itemcode,pending.locationcode,pending.lotcode);
    IF selected_master_uid IS NOT NULL THEN
      INSERT INTO private.request_photo_intents_v3079(request_id,photo_id,actor_id,master_uid)
      SELECT p_request_id,id,p_actor_id,selected_master_uid FROM unnest(p_photo_ids) id
      ON CONFLICT DO NOTHING;
      UPDATE private.request_photo_intents_v3079 i SET expires_at=greatest(i.expires_at,now()+interval '30 minutes')
      WHERE i.request_id=p_request_id AND i.photo_id=ANY(p_photo_ids) AND i.actor_id=p_actor_id
        AND i.master_uid=selected_master_uid AND i.published_url IS NULL;
    END IF;
  END IF;
  result:=public.request_work_command_v1(p_actor_id,p_session_id,'save',p_request_id,p_expected_version,p_patch,true);
  IF result->>'lifecycle_state' IS DISTINCT FROM 'completed_history' OR result->'row'->>'unique_id' IS DISTINCT FROM p_request_id THEN
    RAISE EXCEPTION 'REQUEST_COMPLETION_RECEIPT_UNCONFIRMED';
  END IF;
  RETURN result||jsonb_build_object('photo_intents_registered',
    coalesce(cardinality(p_photo_ids),0)=0 OR NOT EXISTS (
      SELECT FROM unnest(p_photo_ids) id WHERE NOT EXISTS (
        SELECT FROM private.request_photo_intents_v3079 i WHERE i.request_id=p_request_id AND i.photo_id=id
          AND i.actor_id=p_actor_id AND i.master_uid=result->'row'->>'master_id'
      )
    ));
END $fn$;

CREATE OR REPLACE FUNCTION private.completed_request_photo_row_v3079(p_request text,p_master text)
RETURNS public.ph_requests_completed_history LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE history public.ph_requests_completed_history;
BEGIN
  SELECT * INTO history FROM public.ph_requests_completed_history WHERE unique_id=p_request AND master_id=p_master
    AND date_completed IS NOT NULL AND lower(coalesce(last_event,'')) IN ('completed','request_completed') FOR UPDATE;
  IF history.unique_id IS NULL OR private.can_work_request_row_v3074(to_jsonb(history)) IS DISTINCT FROM true
    OR NOT EXISTS(SELECT FROM public.ph_master_inventory m WHERE m.unique_id=p_master
      AND (m.itemcode,m.locationcode,m.lotcode)=(history.itemcode,history.locationcode,history.lotcode)) THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN history;
END $fn$;

CREATE OR REPLACE FUNCTION public.authorize_request_photo_intent_v3079(p_actor_id uuid,p_actor_username text,p_session_id uuid,
  p_identity jsonb,p_photo_id text,p_object_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='8s' SET statement_timeout='15s' AS $fn$
DECLARE req text:=p_identity->>'requestId'; master text:=p_identity->>'masterUid'; intent private.request_photo_intents_v3079;
BEGIN
  IF private.is_service_role_request() IS DISTINCT FROM true THEN RAISE EXCEPTION 'REQUEST_PHOTO_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM private.lock_request_photo_work_v3079(p_actor_id,p_session_id,req);
  IF p_photo_id IS NULL OR p_photo_id !~ '^[A-Za-z0-9_-]{1,64}$' OR p_object_path IS NULL
    OR p_object_path !~ '^v2/[a-f0-9]{64}\.(jpg|webp)$' OR p_identity ? 'suspendTagId' AND nullif(p_identity->>'suspendTagId','') IS NOT NULL THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_INTENT_INVALID' USING ERRCODE='22023';
  END IF;
  DELETE FROM private.request_photo_intents_v3079 WHERE request_id=req AND expires_at<now()-interval '1 day';
  IF EXISTS(SELECT FROM public.ph_requests_pending WHERE unique_id=req FOR UPDATE) THEN
    PERFORM public.authorize_photo_upload_v3074(p_actor_id,p_actor_username,'req-',p_identity,p_session_id,NULL);
    INSERT INTO private.request_photo_intents_v3079(request_id,photo_id,actor_id,master_uid)
    VALUES(req,p_photo_id,p_actor_id,master) ON CONFLICT DO NOTHING;
  ELSE
    PERFORM private.request_photo_actor_v3079(p_actor_id,p_session_id);
    PERFORM private.completed_request_photo_row_v3079(req,master);
    IF NOT EXISTS(SELECT FROM public.ph_master_inventory WHERE unique_id=master
      AND (upper(btrim(itemcode)),upper(btrim(locationcode)),upper(btrim(lotcode)))=
        (upper(btrim(p_identity->>'itemCode')),upper(btrim(p_identity->>'locationCode')),upper(btrim(p_identity->>'lotCode')))) THEN
      RAISE EXCEPTION 'REQUEST_PHOTO_FORBIDDEN' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT * INTO intent FROM private.request_photo_intents_v3079 WHERE request_id=req AND photo_id=p_photo_id FOR UPDATE;
  IF intent.actor_id IS DISTINCT FROM p_actor_id OR intent.master_uid IS DISTINCT FROM master
    OR (intent.published_url IS NULL AND intent.expires_at<=now() AND NOT EXISTS(
      SELECT FROM public.ph_requests_pending WHERE unique_id=req))
    OR (intent.object_path IS NOT NULL AND intent.object_path<>p_object_path) THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_INTENT_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  UPDATE private.request_photo_intents_v3079 SET object_path=p_object_path,
    expires_at=CASE WHEN intent.expires_at<=now() AND intent.published_url IS NULL THEN now()+interval '30 minutes' ELSE expires_at END
    WHERE request_id=req AND photo_id=p_photo_id;
  RETURN jsonb_build_object('ok',true,'masterUid',master,'requestId',req);
END $fn$;

CREATE OR REPLACE FUNCTION private.append_completed_request_photo_v3079(p_request text,p_master text,p_url text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE history public.ph_requests_completed_history; master public.ph_master_inventory; links text; names text; images jsonb;
BEGIN
  history:=private.completed_request_photo_row_v3079(p_request,p_master);
  SELECT * INTO STRICT master FROM public.ph_master_inventory WHERE unique_id=p_master
    AND (itemcode,locationcode,lotcode)=(history.itemcode,history.locationcode,history.lotcode) FOR UPDATE;
  IF NOT (p_url=ANY(string_to_array(coalesce(history.req_photo_link,''),','))) THEN
    links:=concat_ws(',',nullif(history.req_photo_link,''),p_url);
    names:=concat_ws(',',nullif(history.req_photo_name,''),p_name);
    images:=CASE WHEN jsonb_typeof(history.photos)='array' AND jsonb_array_length(history.photos)>0 THEN history.photos
      ELSE coalesce(to_jsonb(string_to_array(nullif(history.req_photo_link,''),',')),'[]'::jsonb) END;
    IF NOT (images @> jsonb_build_array(p_url) OR images @> jsonb_build_array(jsonb_build_object('url',p_url))) THEN
      images:=images||jsonb_build_array(p_url);
    END IF;
    UPDATE public.ph_requests_completed_history SET req_photo_link=links,photo_link=links,req_photo_name=names,photo_name=names,
      photos=images,photo_url=split_part(links,',',1),row_version=coalesce(row_version,0)+1
    WHERE unique_id=p_request RETURNING * INTO history;
  END IF;
  IF NOT (p_url=ANY(string_to_array(coalesce(master.photo_link,''),','))) THEN
    master:=private.publish_completed_request_photo_v3079(master,p_request,p_url,p_name);
  END IF;
  IF NOT coalesce(p_url=ANY(string_to_array(history.req_photo_link,',')),false) OR
    NOT coalesce(p_url=ANY(string_to_array(master.photo_link,',')),false) THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_RECEIPT_UNCONFIRMED';
  END IF;
  RETURN jsonb_build_object('ok',true,'active',false,'lifecycle_state','completed_history','row',to_jsonb(history),
    'row_version',history.row_version,'master_row',to_jsonb(master));
END $fn$;

CREATE OR REPLACE FUNCTION private.publish_completed_request_photo_v3079(p_master public.ph_master_inventory,p_request text,p_url text,p_name text)
RETURNS public.ph_master_inventory LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE master public.ph_master_inventory; links text; names text;
BEGIN
  IF p_master.photo_date>clock_timestamp()-interval '10 days' AND coalesce(p_master.loc_photo_match,0)>0 THEN
    links:=nullif(p_master.photo_link,'');
    names:=nullif(p_master.photo_name,'');
  END IF;
  PERFORM private.publish_queue_evaluation_v309(jsonb_build_object('master_id',p_master.unique_id,'unique_id',p_request,
    'itemcode',p_master.itemcode,'locationcode',p_master.locationcode,'lotcode',p_master.lotcode,
    'req_photo_link',concat_ws(',',links,p_url),'req_photo_name',concat_ws(',',names,p_name),'photo_date',clock_timestamp()),'request',false);
  SELECT * INTO STRICT master FROM public.ph_master_inventory WHERE unique_id=p_master.unique_id;
  RETURN master;
END $fn$;

CREATE OR REPLACE FUNCTION private.apply_request_photo_intent_v3079(p_actor_id uuid,p_session_id uuid,p_request_id text,
  p_photo_id text,p_url text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='8s' SET statement_timeout='30s' AS $fn$
DECLARE intent private.request_photo_intents_v3079; result jsonb; bucket constant text:='request_photos';
BEGIN
  PERFORM private.lock_request_photo_work_v3079(p_actor_id,p_session_id,p_request_id);
  SELECT * INTO intent FROM private.request_photo_intents_v3079 WHERE request_id=p_request_id AND photo_id=p_photo_id FOR UPDATE;
  IF intent.actor_id IS DISTINCT FROM p_actor_id OR intent.object_path IS NULL OR
    (intent.published_url IS NULL AND intent.expires_at<=now()) OR p_name IS NULL OR p_name<>split_part(intent.object_path,'/',2)
    OR p_url IS DISTINCT FROM 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||bucket||'/'||intent.object_path
    OR NOT EXISTS(SELECT FROM storage.objects WHERE bucket_id=bucket AND name=intent.object_path) THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_INTENT_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF intent.published_url IS NOT NULL AND NOT EXISTS(SELECT FROM public.ph_requests_pending WHERE unique_id=p_request_id) THEN
    PERFORM private.request_photo_actor_v3079(p_actor_id,p_session_id);
    RETURN private.completed_request_photo_receipt_v3079(p_request_id,intent.master_uid,p_url,p_photo_id);
  END IF;
  IF EXISTS(SELECT FROM public.ph_requests_pending WHERE unique_id=p_request_id FOR UPDATE) THEN
    result:=private.append_pending_request_photo_v3079(p_actor_id,p_session_id,p_request_id,p_url,p_name);
  ELSE
    PERFORM private.request_photo_actor_v3079(p_actor_id,p_session_id);
    result:=private.append_completed_request_photo_v3079(p_request_id,intent.master_uid,p_url,p_name);
  END IF;
  IF result->'master_row'->>'unique_id' IS DISTINCT FROM intent.master_uid OR
    NOT coalesce(p_url=ANY(string_to_array(result->'row'->>'req_photo_link',',')),false) THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_RECEIPT_UNCONFIRMED';
  END IF;
  IF intent.published_url IS NULL THEN
    UPDATE private.request_photo_intents_v3079 SET published_url=p_url WHERE request_id=p_request_id AND photo_id=p_photo_id;
    IF result->>'lifecycle_state'='completed_history' THEN
      PERFORM private.reconcile_request_folder_completion_v2(result->'row'->>'request_folder');
    END IF;
  END IF;
  RETURN result||jsonb_build_object('queued_photo_id',p_photo_id);
END $fn$;

CREATE OR REPLACE FUNCTION private.completed_request_photo_receipt_v3079(p_request text,p_master text,p_url text,p_photo_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE history public.ph_requests_completed_history; master public.ph_master_inventory;
BEGIN
  history:=private.completed_request_photo_row_v3079(p_request,p_master);
  SELECT * INTO STRICT master FROM public.ph_master_inventory WHERE unique_id=p_master;
  IF NOT coalesce(p_url=ANY(string_to_array(history.req_photo_link,',')),false)
    OR NOT coalesce(p_url=ANY(string_to_array(master.photo_link,',')),false) THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_RECEIPT_UNCONFIRMED';
  END IF;
  RETURN jsonb_build_object('ok',true,'active',false,'lifecycle_state','completed_history','row',to_jsonb(history),
    'row_version',history.row_version,'master_row',to_jsonb(master),'queued_photo_id',p_photo_id);
END $fn$;

CREATE OR REPLACE FUNCTION private.append_pending_request_photo_v3079(p_actor uuid,p_session uuid,p_request text,p_url text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE prior_role text:=current_setting('request.jwt.claim.role',true);
DECLARE prior_claims text:=current_setting('request.jwt.claims',true);
DECLARE prior_sub text:=current_setting('request.jwt.claim.sub',true);
DECLARE result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','service_role','session_id',p_session)::text,true);
  result:=public.request_work_command_v1(p_actor,p_session,'append_photo',p_request,NULL,
    jsonb_build_object('req_photo_link',p_url,'req_photo_name',p_name),false);
  PERFORM set_config('request.jwt.claim.role',coalesce(prior_role,''),true);
  PERFORM set_config('request.jwt.claims',coalesce(prior_claims,''),true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
  RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION public.append_request_photo_intent_v3079(p_request_id text,p_photo_id text,p_url text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='8s' SET statement_timeout='30s' AS $fn$
DECLARE actor uuid:=auth.uid(); session_id uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR session_id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_WORK_SESSION_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN private.apply_request_photo_intent_v3079(actor,session_id,p_request_id,p_photo_id,p_url,p_name);
END $fn$;

CREATE OR REPLACE FUNCTION private.defer_request_photo_delivery_v3079()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE until_at timestamptz;
BEGIN
  IF jsonb_typeof(NEW.payload->'request_ids') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  SELECT max(i.expires_at) INTO until_at
  FROM jsonb_array_elements_text(coalesce(NEW.payload->'request_ids','[]'::jsonb)) id
  JOIN private.request_photo_intents_v3079 i ON i.request_id=id
  WHERE i.published_url IS NULL AND i.expires_at>now();
  IF until_at IS NOT NULL THEN NEW.next_attempt_at:=greatest(NEW.next_attempt_at,until_at); END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS defer_request_photo_delivery_v3079 ON public.ph_request_delivery_outbox;
CREATE TRIGGER defer_request_photo_delivery_v3079
BEFORE INSERT OR UPDATE OF payload,next_attempt_at ON public.ph_request_delivery_outbox
FOR EACH ROW WHEN (NEW.event_type='request_completed' AND NEW.status='pending')
EXECUTE FUNCTION private.defer_request_photo_delivery_v3079();

-- Keep the existing Edge and PostgREST request-work routes. The reserved
-- transport field is stripped before the normal evaluation patch is applied.
DO $patch$
DECLARE definition text; anchor constant text:=E'begin\n  if p_operation';
DECLARE guarded text:=E'begin\n  if p_patch ? ''queued_photo_ids'' and p_operation=''save'' and p_complete then\n'
  ||E'    return public.complete_request_with_photo_intents_v3079(p_actor_id,p_session_id,p_request_id,p_expected_version,\n'
  ||E'      p_patch-''queued_photo_ids'',ARRAY(SELECT jsonb_array_elements_text(p_patch->''queued_photo_ids'')));\n'
  ||E'  end if;\n  if p_operation';
BEGIN
  definition:=pg_get_functiondef('public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)'::regprocedure);
  IF strpos(definition,guarded)>0 THEN RETURN; END IF;
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'REQUEST_PHOTO_COMMAND_ANCHOR_CHANGED'; END IF;
  EXECUTE replace(definition,anchor,guarded);
END $patch$;

REVOKE ALL ON FUNCTION private.lock_request_photo_work_v3079(uuid,uuid,text),
  private.request_photo_actor_v3079(uuid,uuid),private.completed_request_photo_row_v3079(text,text),
  private.append_completed_request_photo_v3079(text,text,text,text),private.defer_request_photo_delivery_v3079(),
  private.publish_completed_request_photo_v3079(public.ph_master_inventory,text,text,text),
  private.completed_request_photo_receipt_v3079(text,text,text,text),
  private.apply_request_photo_intent_v3079(uuid,uuid,text,text,text,text),private.append_pending_request_photo_v3079(uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_request_with_photo_intents_v3079(uuid,uuid,text,bigint,jsonb,text[]),
  public.authorize_request_photo_intent_v3079(uuid,text,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_request_with_photo_intents_v3079(uuid,uuid,text,bigint,jsonb,text[]),
  public.authorize_request_photo_intent_v3079(uuid,text,uuid,jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.append_request_photo_intent_v3079(text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.append_request_photo_intent_v3079(text,text,text,text) TO authenticated;
COMMIT;
