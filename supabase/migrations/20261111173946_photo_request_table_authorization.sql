BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';

CREATE OR REPLACE FUNCTION private.current_evidence_actor_v3074()
RETURNS public.profiles LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT actor FROM private.current_active_profile() actor
  WHERE actor.id IS NOT NULL AND actor.must_change_password IS FALSE
    AND NOT EXISTS (SELECT 1 FROM public.ph_app_users legacy
      WHERE (legacy.id=actor.legacy_user_id OR lower(btrim(legacy.username))=lower(btrim(actor.username)))
        AND (legacy.disabled_at IS NOT NULL OR legacy.locked_until>statement_timestamp()))
$$;
REVOKE ALL ON FUNCTION private.current_evidence_actor_v3074() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.require_drive_live_change_profile_v2392(
  p_master_uid text,p_itemcode text,p_locationcode text,p_lotcode text)
RETURNS public.profiles LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; matrix public.user_access; target public.ph_master_inventory;
BEGIN
  actor:=private.current_evidence_actor_v3074();
  IF actor.id IS NULL THEN RAISE EXCEPTION 'DRIVE_LIVE_CHANGE_PROFILE_INACTIVE' USING ERRCODE='42501'; END IF;
  SELECT * INTO matrix FROM public.user_access WHERE profile_id=actor.id
    AND lower(btrim(username))=lower(btrim(actor.username));
  IF matrix.profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(matrix.view_permissions) permission
    WHERE permission.key IN ('view_drive_mode','view_av','view_inventory','view_que_request','view_que_suspend','view_flyers')
      AND permission.value='Y') THEN
    RAISE EXCEPTION 'DRIVE_LIVE_CHANGE_PERMISSION_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target FROM public.ph_master_inventory
    WHERE unique_id=btrim(coalesce(p_master_uid,''))
      AND upper(btrim(itemcode))=upper(btrim(coalesce(p_itemcode,'')))
      AND upper(btrim(locationcode))=upper(btrim(coalesce(p_locationcode,'')))
      AND upper(btrim(lotcode))=upper(btrim(coalesce(p_lotcode,'')));
  IF target.unique_id IS NULL THEN RAISE EXCEPTION 'DRIVE_PHYSICAL_ROW_MISMATCH' USING ERRCODE='42501'; END IF;
  IF matrix.edit_any_row='Y' THEN RETURN actor; END IF;
  IF matrix.flyer_folder_access='Y' AND EXISTS (
    SELECT 1 FROM public.ph_flyer_folder_rows WHERE master_unique_id=target.unique_id) THEN RETURN actor; END IF;
  IF matrix.edit_assigned_rows_only='Y' AND private.inventory_row_assigned_to_actor_v2392(
    actor.username,target.unique_id,target.itemcode) THEN RETURN actor; END IF;
  IF EXISTS (SELECT 1 FROM public.ph_requests_pending request
    WHERE request.master_id=target.unique_id AND request.itemcode=target.itemcode
      AND request.locationcode=target.locationcode AND request.lotcode=target.lotcode
      AND coalesce(request.req_archived,false)=false
      AND lower(coalesce(request.req_status,'pending')) NOT IN ('complete','completed','done','archived','cancelled','canceled')
      AND private.can_work_request_identity(request.request_created_by_username,
        request.request_selected_rep_username,request.requested_by)) THEN RETURN actor; END IF;
  RAISE EXCEPTION 'INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED' USING ERRCODE='42501';
END $$;

CREATE OR REPLACE FUNCTION private.can_save_request_work()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM private.current_evidence_actor_v3074() actor
    JOIN public.user_access matrix ON matrix.profile_id=actor.id
      AND lower(btrim(matrix.username))=lower(btrim(actor.username))
    WHERE actor.id IS NOT NULL AND matrix.view_permissions->>'view_que_request'='Y'
      AND (matrix.edit_any_row='Y' OR matrix.edit_assigned_rows_only='Y'
        OR (private.normalized_profile_role(actor.role)<>''
          AND private.normalized_profile_role(actor.role) NOT LIKE 'QC%')))
$$;

CREATE OR REPLACE FUNCTION private.can_work_request_identity(
  creator_username text,selected_rep_username text,requested_by_value text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.can_save_request_work() AND EXISTS (
    SELECT 1 FROM private.current_evidence_actor_v3074() actor
    JOIN public.user_access matrix ON matrix.profile_id=actor.id
    WHERE matrix.edit_any_row='Y' OR (
      regexp_replace(split_part(lower(actor.username),'@',1),'[^a-z0-9]+','','g')<>''
      AND regexp_replace(split_part(lower(actor.username),'@',1),'[^a-z0-9]+','','g')=ANY(ARRAY[
        regexp_replace(split_part(lower(coalesce(creator_username,'')),'@',1),'[^a-z0-9]+','','g'),
        regexp_replace(split_part(lower(coalesce(selected_rep_username,'')),'@',1),'[^a-z0-9]+','','g'),
        regexp_replace(split_part(lower(coalesce(requested_by_value,'')),'@',1),'[^a-z0-9]+','','g')]))
  )
$$;

CREATE OR REPLACE FUNCTION private.can_work_request_row_v3074(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; matrix public.user_access; matches text[]; master public.ph_master_inventory;
BEGIN
  IF NOT private.can_save_request_work() THEN RETURN false; END IF;
  actor:=private.current_evidence_actor_v3074();
  SELECT * INTO matrix FROM public.user_access WHERE profile_id=actor.id;
  IF matrix.edit_any_row='Y' OR private.can_work_request_identity(p_request->>'request_created_by_username',
    p_request->>'request_selected_rep_username',p_request->>'requested_by') THEN RETURN true; END IF;
  IF matrix.edit_assigned_rows_only<>'Y' THEN RETURN false; END IF;
  SELECT array_agg(unique_id) INTO matches FROM public.ph_master_inventory
    WHERE upper(btrim(itemcode))=upper(btrim(coalesce(p_request->>'itemcode','')))
      AND upper(btrim(locationcode))=upper(btrim(coalesce(p_request->>'locationcode','')))
      AND upper(btrim(lotcode))=upper(btrim(coalesce(p_request->>'lotcode','')))
      AND (nullif(btrim(p_request->>'master_id'),'') IS NULL OR unique_id=p_request->>'master_id');
  IF coalesce(cardinality(matches),0)<>1 THEN RETURN false; END IF;
  SELECT * INTO master FROM public.ph_master_inventory WHERE unique_id=matches[1];
  RETURN private.inventory_row_assigned_to_actor_v2392(actor.username,master.unique_id,master.itemcode);
END $$;
REVOKE ALL ON FUNCTION private.can_work_request_row_v3074(jsonb) FROM PUBLIC,anon,authenticated;

DO $patch$
DECLARE name text; source text; changed text; row_name text; pattern text; expected integer; found integer;
BEGIN
  FOR name,row_name,expected IN VALUES
    ('public.save_request_work_pre_state_machine_v2359(text,bigint,jsonb,boolean)','existing',1),
    ('public.save_request_work(text,bigint,jsonb,boolean)','history_row',1),
    ('public.request_work_command_v1_pre_state_machine_v2359(uuid,uuid,text,text,bigint,jsonb,boolean)','request_row',2),
    ('public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)','history_row',1),
    ('public.request_completion_receipt_v2372(uuid,uuid,text)','history_row',1)
  LOOP
    source:=pg_get_functiondef(to_regprocedure(name));
    IF position('can_work_request_row_v3074' IN source)>0 THEN CONTINUE; END IF;
    changed:=source;
    IF row_name='existing' THEN
      pattern:=$re$(?s)  if lower\(btrim\(coalesce\(profile\.username, ''\)\)\) in \([^\n]+\) then\s+if not private\.can_work_request_identity\(\s+existing\.request_created_by_username,\s+existing\.request_selected_rep_username,\s+existing\.requested_by\s+\) then\s+raise exception using errcode = '42501', message = 'REQUEST_ROW_FORBIDDEN';\s+end if;\s+end if;$re$;
      changed:=regexp_replace(source,pattern,
        E'  if not private.can_work_request_row_v3074(to_jsonb(existing)) then\n    raise exception using errcode=''42501'',message=''REQUEST_ROW_FORBIDDEN'';\n  end if;');
    ELSIF name='public.save_request_work(text,bigint,jsonb,boolean)' THEN
      pattern:=$re$if lower\(btrim\(coalesce\(profile\.username,''\)\)\) in \([^\n]+\)\s+and not private\.can_work_request_identity\(\s+history_row\.request_created_by_username,history_row\.request_selected_rep_username,history_row\.requested_by\s+\)$re$;
      changed:=regexp_replace(source,pattern,'if not private.can_work_request_row_v3074(to_jsonb(history_row))');
    ELSE
      pattern:='private\.can_work_request_identity\(\s*'||row_name||'\.request_created_by_username,\s*'||
        row_name||'\.request_selected_rep_username,\s*'||row_name||'\.requested_by\s*\)';
      SELECT count(*) INTO found FROM regexp_matches(source,pattern,'g');
      IF found<>expected THEN RAISE EXCEPTION 'REQUEST_AUTH_CALLSITE_CHANGED: %',name; END IF;
      changed:=regexp_replace(source,pattern,'private.can_work_request_row_v3074(to_jsonb('||row_name||'))','g');
    END IF;
    IF changed=source OR position('can_work_request_identity' IN changed)>0 THEN
      RAISE EXCEPTION 'REQUEST_AUTH_ANCHOR_CHANGED: %',name;
    END IF;
    EXECUTE changed;
  END LOOP;
END $patch$;

CREATE OR REPLACE FUNCTION public.get_request_capabilities()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; matrix public.user_access; save_access boolean;
BEGIN
  actor:=private.current_evidence_actor_v3074();
  IF actor.id IS NULL THEN RAISE EXCEPTION 'REQUEST_PROFILE_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO matrix FROM public.user_access WHERE profile_id=actor.id;
  save_access:=private.can_save_request_work();
  RETURN jsonb_build_object('contract_version',2,'username',lower(btrim(actor.username)),
    'scope',CASE WHEN matrix.view_all_requests='Y' THEN 'global' ELSE 'assigned' END,
    'can_create_general',private.can_create_general_requests(),'can_create_av',private.can_create_av_requests(),
    'can_view_queue',coalesce(matrix.view_permissions->>'view_que_request'='Y',false),
    'can_take_photo',save_access,'can_edit',save_access,'can_complete',save_access,
    'can_archive',private.can_manage_requests());
END $$;

CREATE OR REPLACE FUNCTION public.can_write_photo_object_v3074(p_bucket text,p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; matrix public.user_access;
BEGIN
  IF p_bucket<>ALL(ARRAY['season_sales_notes_photos','location_sales_notes_photos','flyer_photos','request_photos']) THEN RETURN true; END IF;
  actor:=private.current_evidence_actor_v3074();
  IF actor.id IS NULL THEN RETURN false; END IF;
  IF p_name LIKE 'drive-evidence/%' THEN RETURN public.can_upload_drive_evidence_v23115(p_name); END IF;
  IF p_bucket='request_photos' THEN RETURN private.can_save_request_work(); END IF;
  SELECT * INTO matrix FROM public.user_access WHERE profile_id=actor.id;
  RETURN coalesce(matrix.edit_any_row='Y',false) AND EXISTS (
    SELECT 1 FROM jsonb_each_text(matrix.view_permissions) permission
    WHERE permission.key IN ('view_drive_mode','view_av','view_inventory','view_flyers') AND permission.value='Y');
END $$;
REVOKE ALL ON FUNCTION public.can_write_photo_object_v3074(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_photo_object_v3074(text,text) TO anon,authenticated,service_role;
DROP POLICY IF EXISTS photo_evidence_insert_guard_v3074 ON storage.objects;
CREATE POLICY photo_evidence_insert_guard_v3074 ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated
  WITH CHECK (public.can_write_photo_object_v3074(bucket_id,name));
DROP POLICY IF EXISTS photo_evidence_update_guard_v3074 ON storage.objects;
CREATE POLICY photo_evidence_update_guard_v3074 ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
  USING (public.can_write_photo_object_v3074(bucket_id,name))
  WITH CHECK (public.can_write_photo_object_v3074(bucket_id,name));

DO $version$
DECLARE previous text;
BEGIN
  SELECT value->>'app_version' INTO previous FROM public.ph_app_settings WHERE key='app_version' FOR UPDATE;
  IF previous NOT IN ('3.0.72','3.0.73','3.0.74') OR previous IS NULL THEN
    RAISE EXCEPTION 'PHOTO_AUTH_VERSION_MARKER_CHANGED';
  END IF;
  UPDATE public.ph_app_settings SET value=value||jsonb_build_object('app_version','3.0.74','release','AgData v3.0.74'),
    updated_at=clock_timestamp(),updated_by='release-v3.0.74' WHERE key='app_version' AND previous<>'3.0.74';
END $version$;
COMMIT;
