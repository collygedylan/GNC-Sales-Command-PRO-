CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS suspend_tag_private;
CREATE TABLE storage.objects(bucket_id text,name text,PRIMARY KEY(bucket_id,name));
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),auth.jwt()->>'role') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub')::uuid $$;
CREATE TABLE public.ph_master_inventory(unique_id text PRIMARY KEY,itemcode text,locationcode text,lotcode text,
  photo_link text,photo_name text,photo_date timestamptz,loc_photo_match numeric,photos jsonb);
CREATE TABLE public.ph_location_sales_notes(unique_id text PRIMARY KEY,photos jsonb);
CREATE TABLE public.ph_requests_pending(unique_id text PRIMARY KEY,master_id text,itemcode text,locationcode text,lotcode text,
  request_folder text,owner uuid,req_photo_link text,req_photo_name text);
CREATE TABLE public.ph_requests_completed_history (LIKE public.ph_requests_pending INCLUDING ALL);
ALTER TABLE public.ph_requests_completed_history ADD COLUMN date_completed timestamptz,ADD COLUMN last_event text,
  ADD COLUMN photo_link text,ADD COLUMN photo_name text,ADD COLUMN photo_url text,ADD COLUMN photos jsonb,ADD COLUMN row_version bigint;
CREATE TABLE public.ph_request_delivery_outbox(request_folder text PRIMARY KEY,event_type text,status text,next_attempt_at timestamptz,payload jsonb);
CREATE FUNCTION private.is_service_role_request() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.role()='service_role' $$;
CREATE FUNCTION suspend_tag_private.session_active(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1=$2 $$;
CREATE FUNCTION private.can_work_request_row_v3074(jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1->>'owner'=auth.uid()::text $$;
CREATE FUNCTION private.eval_master_uid_v309(jsonb) RETURNS text LANGUAGE sql STABLE AS $$ SELECT $1->>'master_id' $$;
CREATE FUNCTION private.reconcile_request_folder_completion_v2(folder text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ph_request_delivery_outbox
  SELECT folder,'request_completed','pending',now(),jsonb_build_object('request_ids',jsonb_agg(unique_id),'requests',jsonb_agg(to_jsonb(h)))
    FROM public.ph_requests_completed_history h WHERE request_folder=folder
  ON CONFLICT(request_folder) DO UPDATE SET payload=excluded.payload,next_attempt_at=now();
  RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION private.publish_queue_evaluation_v309(r jsonb,kind text,completed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.ph_master_inventory SET photo_link=r->>'req_photo_link',photo_name=r->>'req_photo_name',
    photo_date=now(),loc_photo_match=1,photos=to_jsonb(string_to_array(r->>'req_photo_link',','))
    WHERE unique_id=r->>'master_id';
  INSERT INTO public.ph_location_sales_notes SELECT unique_id,photos FROM public.ph_master_inventory WHERE unique_id=r->>'master_id'
    ON CONFLICT(unique_id) DO UPDATE SET photos=excluded.photos;
END $$;
CREATE FUNCTION public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM public.ph_requests_pending WHERE unique_id=$4->>'requestId' AND owner=$1 AND master_id=$4->>'masterUid') THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('ok',true,'masterUid',$4->>'masterUid','requestId',$4->>'requestId');
END $$;
CREATE FUNCTION public.request_work_command_v1(p_actor_id uuid,p_session_id uuid,p_operation text,p_request_id text,
  p_expected_version bigint,p_patch jsonb,p_complete boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pending public.ph_requests_pending; history public.ph_requests_completed_history;
begin
  if p_operation='append_photo' then
    SELECT * INTO pending FROM public.ph_requests_pending WHERE unique_id=p_request_id AND owner=p_actor_id;
    IF pending.unique_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ROW_FORBIDDEN' USING ERRCODE='42501'; END IF;
    UPDATE public.ph_requests_pending SET req_photo_link=p_patch->>'req_photo_link',req_photo_name=p_patch->>'req_photo_name'
      WHERE unique_id=p_request_id RETURNING * INTO pending;
    PERFORM private.publish_queue_evaluation_v309(to_jsonb(pending),'request',false);
    RETURN jsonb_build_object('ok',true,'active',true,'lifecycle_state','pending_active','row',to_jsonb(pending),
      'master_row',(SELECT to_jsonb(m) FROM public.ph_master_inventory m WHERE unique_id=pending.master_id));
  END IF;
  DELETE FROM public.ph_requests_pending WHERE unique_id=p_request_id AND owner=p_actor_id RETURNING * INTO pending;
  IF pending.unique_id IS NOT NULL THEN
    INSERT INTO public.ph_requests_completed_history SELECT (jsonb_populate_record(NULL::public.ph_requests_completed_history,
      to_jsonb(pending)||jsonb_build_object('date_completed',now(),'last_event','completed','photos','[]'::jsonb,'row_version',1))).*
      RETURNING * INTO history;
    PERFORM private.reconcile_request_folder_completion_v2(history.request_folder);
  ELSE
    SELECT * INTO history FROM public.ph_requests_completed_history WHERE unique_id=p_request_id AND owner=p_actor_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'active',false,'lifecycle_state','completed_history','row',to_jsonb(history));
END $$;
