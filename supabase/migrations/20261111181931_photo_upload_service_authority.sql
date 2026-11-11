BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';

CREATE OR REPLACE FUNCTION private.can_work_suspend_photo_identity_v3074(p_actor public.profiles,p_master public.ph_master_inventory)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_access matrix
    WHERE matrix.profile_id=p_actor.id AND matrix.view_permissions->>'view_que_suspend'='Y'
      AND (matrix.edit_any_row='Y' OR (matrix.edit_assigned_rows_only='Y'
        AND private.access_username_v23119(p_actor.username)=suspend_tag_private.assigned_owner_v3068(
          p_master.itemcode,p_master.locationcode,p_master.lotcode)))
      AND EXISTS (SELECT 1 FROM public.ph_active_suspend tag
        WHERE tag.itemcode=p_master.itemcode AND tag.locationcode=p_master.locationcode
          AND (nullif(btrim(tag.lotcode),'') IS NULL OR tag.lotcode=p_master.lotcode)))
$$;
REVOKE ALL ON FUNCTION private.can_work_suspend_photo_identity_v3074(public.profiles,public.ph_master_inventory) FROM PUBLIC,anon,authenticated;
DO $guard$
DECLARE source text; changed text;
BEGIN
  source:=pg_get_functiondef('private.require_drive_live_change_profile_v2392(text,text,text,text)'::regprocedure);
  IF position('can_work_suspend_photo_identity_v3074' IN source)>0 THEN RETURN; END IF;
  changed:=replace(source,
    '  RAISE EXCEPTION ''INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED'' USING ERRCODE=''42501'';',
    E'  IF private.can_work_suspend_photo_identity_v3074(actor,target) THEN RETURN actor; END IF;\n  RAISE EXCEPTION ''INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED'' USING ERRCODE=''42501'';');
  IF changed=source THEN RAISE EXCEPTION 'PHOTO_NATIVE_AUTHORITY_ANCHOR_CHANGED'; END IF;
  EXECUTE changed;
END $guard$;

CREATE OR REPLACE FUNCTION private.require_photo_request_source_v3074(p_actor public.profiles,p_master public.ph_master_inventory,p_identity jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE request_uid text:=nullif(btrim(p_identity->>'requestId'),'');
  tag_uid text:=nullif(btrim(p_identity->>'suspendTagId'),''); request public.ph_requests_pending;
  tag public.ph_soc_master; candidates jsonb; matrix public.user_access;
BEGIN
  IF request_uid IS NOT NULL AND tag_uid IS NOT NULL THEN RAISE EXCEPTION 'PHOTO_SOURCE_AMBIGUOUS' USING ERRCODE='22023'; END IF;
  IF request_uid IS NULL AND tag_uid IS NULL THEN
    SELECT jsonb_agg(source) INTO candidates FROM (
      SELECT jsonb_build_object('requestId',row.unique_id) source FROM public.ph_requests_pending row
      WHERE row.master_id=p_master.unique_id AND coalesce(row.req_archived,false)=false
        AND lower(coalesce(row.req_status,'pending')) NOT IN ('completed','complete','done','archived','cancelled','canceled')
      UNION ALL SELECT jsonb_build_object('suspendTagId',row.unique_id) FROM public.ph_active_suspend row
      WHERE row.itemcode=p_master.itemcode AND row.locationcode=p_master.locationcode
        AND (nullif(btrim(row.lotcode),'') IS NULL OR row.lotcode=p_master.lotcode)
    ) source;
    IF coalesce(jsonb_array_length(candidates),0)<>1 THEN RAISE EXCEPTION 'PHOTO_EXACT_SOURCE_REQUIRED' USING ERRCODE='22023'; END IF;
    request_uid:=candidates->0->>'requestId';tag_uid:=candidates->0->>'suspendTagId';
  END IF;
  IF request_uid IS NOT NULL THEN
    SELECT * INTO request FROM public.ph_requests_pending WHERE unique_id=request_uid AND coalesce(req_archived,false)=false
      AND lower(coalesce(req_status,'pending')) NOT IN ('completed','complete','done','archived','cancelled','canceled');
    IF request.unique_id IS NULL OR NOT private.can_work_request_row_v3074(to_jsonb(request))
      OR request.itemcode IS DISTINCT FROM p_master.itemcode OR request.locationcode IS DISTINCT FROM p_master.locationcode
      OR (nullif(btrim(request.lotcode),'') IS NOT NULL AND request.lotcode IS DISTINCT FROM p_master.lotcode)
      OR (nullif(btrim(request.master_id),'') IS NOT NULL AND request.master_id IS DISTINCT FROM p_master.unique_id)
      OR (nullif(btrim(request.master_id),'') IS NULL AND (SELECT count(*) FROM public.ph_master_inventory master
        WHERE master.itemcode=request.itemcode AND master.locationcode=request.locationcode AND master.lotcode=request.lotcode)<>1)
    THEN RAISE EXCEPTION 'REQUEST_PHOTO_FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSE
    SELECT source.* INTO tag FROM public.ph_soc_master source WHERE source.unique_id=tag_uid
      AND EXISTS(SELECT 1 FROM public.ph_active_suspend active WHERE active.unique_id=source.unique_id);
    SELECT * INTO matrix FROM public.user_access WHERE profile_id=p_actor.id;
    IF tag.unique_id IS NULL OR tag.itemcode IS DISTINCT FROM p_master.itemcode OR tag.locationcode IS DISTINCT FROM p_master.locationcode
      OR (nullif(btrim(tag.lotcode),'') IS NOT NULL AND tag.lotcode IS DISTINCT FROM p_master.lotcode)
      OR matrix.view_permissions->>'view_que_suspend' IS DISTINCT FROM 'Y'
      OR NOT private.can_work_suspend_photo_identity_v3074(p_actor,p_master)
    THEN RAISE EXCEPTION 'SUSPEND_PHOTO_FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('requestId',request_uid,'suspendTagId',tag_uid));
END $$;
REVOKE ALL ON FUNCTION private.require_photo_request_source_v3074(public.profiles,public.ph_master_inventory,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.authorize_photo_upload_v3074(p_actor_id uuid,p_actor_username text,p_prefix text,p_identity jsonb,
  p_session_id uuid DEFAULT NULL,p_app_issued_at bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; master public.ph_master_inventory; source jsonb:='{}';
  old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'PHOTO_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_session_id IS NOT NULL THEN
    IF NOT suspend_tag_private.session_active(p_actor_id,p_session_id) THEN RAISE EXCEPTION 'PHOTO_SESSION_REQUIRED' USING ERRCODE='42501'; END IF;
  ELSIF p_app_issued_at IS NULL OR p_app_issued_at<extract(epoch FROM statement_timestamp())-14*86400
    OR p_app_issued_at>extract(epoch FROM statement_timestamp())+30 THEN
    RAISE EXCEPTION 'PHOTO_APP_SESSION_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_prefix<>ALL(ARRAY['ssn-','lsn-','na-','flyer-','req-']) THEN RAISE EXCEPTION 'PHOTO_PREFIX_INVALID' USING ERRCODE='22023'; END IF;
  PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
  actor:=private.current_evidence_actor_v3074();
  IF actor.id IS NULL OR private.access_username_v23119(actor.username) IS DISTINCT FROM private.access_username_v23119(p_actor_username)
    THEN RAISE EXCEPTION 'PHOTO_ACTOR_MISMATCH' USING ERRCODE='42501'; END IF;
  actor:=private.require_drive_live_change_profile_v2392(p_identity->>'masterUid',p_identity->>'itemCode',
    p_identity->>'locationCode',p_identity->>'lotCode');
  SELECT * INTO master FROM public.ph_master_inventory WHERE unique_id=p_identity->>'masterUid';
  IF p_prefix='req-' THEN source:=private.require_photo_request_source_v3074(actor,master,p_identity); END IF;
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
  RETURN jsonb_build_object('ok',true,'masterUid',master.unique_id)||source;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);RAISE;
END $$;
REVOKE ALL ON FUNCTION public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint) TO service_role;
COMMIT;
