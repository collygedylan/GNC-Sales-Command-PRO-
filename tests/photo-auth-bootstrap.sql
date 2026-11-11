CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA suspend_tag_private;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')
$$;
CREATE TABLE public.profiles (
    "id" uuid,
    "legacy_user_id" integer,
    "username" text,
    "display_name" text,
    "role" text,
    "division" text,
    "language" text,
    "disabled_at" timestamp with time zone,
    "locked_until" timestamp with time zone,
    "must_change_password" boolean,
    "passkey_pilot" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);

CREATE TABLE public.ph_app_users (
    "id" integer,
    "username" text,
    "password" text,
    "role" text,
    "password_hash" text,
    "password_salt" text,
    "password_changed_at" timestamp with time zone,
    "password_expires_at" timestamp with time zone,
    "must_change_password" boolean,
    "failed_login_count" integer,
    "locked_until" timestamp with time zone,
    "disabled_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "division" text,
    "language" text
);

CREATE TABLE public.user_access (
    "profile_id" uuid,
    "username" text,
    "display_name" text,
    "role" text,
    "make_request" text,
    "can_make_request" text,
    "request_all_reps" text,
    "edit_any_row" text,
    "can_edit_all_rows" text,
    "edit_assigned_rows_only" text,
    "can_edit_assigned_items" text,
    "flyer_folder_access" text,
    "can_manage_flyers" text,
    "create_project" text,
    "approve_suspend_tags" text,
    "manage_tables" text,
    "sales_rep_access" jsonb,
    "allowed_request_reps" jsonb,
    "view_permissions" jsonb,
    "revision" bigint,
    "updated_at" timestamp with time zone,
    "view_nursery_command_tables" text,
    "submit_reclass" text,
    "complete_suspend_tag" text,
    "manage_user_access" text,
    "use_weather_hold_risk_tools" text,
    "use_aura_assistant" text,
    "userrole" text,
    "view_all_requests" text,
    "view_all_suspend" text,
    "request_default_scope" text,
    "suspend_default_scope" text
);

CREATE TABLE public.ph_requests_pending (
    "id" bigint,
    "unique_id" text,
    "master_id" text,
    "commonname" text,
    "contsize" text,
    "locationcode" text,
    "lotcode" text,
    "itemcode" text,
    "ptravailable" text,
    "season_supply" text,
    "priority" text,
    "qualitycode" text,
    "field_tag_color" text,
    "plantgroupcode" text,
    "requested_by" text,
    "request_folder" text,
    "req_customer" text,
    "req_qty" text,
    "desired_spec" text,
    "desired_caliper" text,
    "est_ship" text,
    "req_reserve" text,
    "req_photo_link" text,
    "req_photo_name" text,
    "req_archived" boolean,
    "req_status" text,
    "req_rep_action" text,
    "created_at" timestamp with time zone,
    "req_match" numeric,
    "req_spec" text,
    "req_caliper" text,
    "req_pic_note" text,
    "req_sales_note" text,
    "req_comments" text,
    "av_note" text,
    "date_completed" text,
    "completed_by_username" text,
    "completed_by_display" text,
    "completed_by_email" text,
    "req_photo_mode" text,
    "move_batch_id" text,
    "move_approval_stage" text,
    "move_status" text,
    "move_group_key" text,
    "move_from_locationcode" text,
    "move_to_locationcode" text,
    "move_planned_qty" numeric,
    "move_actual_qty" numeric,
    "move_destination_needs_row" boolean,
    "move_dylan_approved_at" timestamp with time zone,
    "move_jd_approved_at" timestamp with time zone,
    "move_completed_at" timestamp with time zone,
    "move_completed_by" text,
    "request_note" text,
    "request_created_by_username" text,
    "request_created_by_display" text,
    "request_created_by_email" text,
    "request_selected_rep_username" text,
    "request_selected_rep_display" text,
    "request_selected_rep_email" text,
    "app_tab_assignment" text,
    "master_app_tab_assignment" text,
    "request_source" text,
    "client_batch_id" uuid,
    "updated_at" timestamp with time zone,
    "row_version" bigint,
    "customeridentityid" text,
    "customername" text,
    "consigneeidentityid" text,
    "consigneename" text,
    "request_selected_salesrep_id" text,
    "dock" text,
    "photos" jsonb,
    "photo_url" text,
    "photo_date" text,
    "spec" text,
    "caliper" text,
    "loc_match_pct" numeric,
    "baseline_on_hand" numeric,
    "initial_photo_match_qty" numeric,
    "loc_photo_match" numeric,
    "pick_note" text,
    "sales_note" text,
    "photo_expires_at" timestamp with time zone,
    "sales_rep" text,
    "customer_name" text,
    "consignee_name" text,
    "customer_consignee_label" text,
    "recipient_emails" jsonb,
    "status" text,
    "request_qty" numeric,
    "effective_qty" numeric,
    "is_default_qty" boolean,
    "unit_list_price" numeric,
    "line_dollar_value" numeric,
    "request_spec" text,
    "request_caliper" text,
    "estimated_ship" text,
    "reserve_flag" text,
    "request_notes" text,
    "on_hand" numeric,
    "review_qty" numeric,
    "available_qty" numeric,
    "open_stock" numeric,
    "loc_on_hand" numeric,
    "pri" text,
    "flag_color" text,
    "ns_grade" text,
    "ld_flag" text,
    "hold_stop_code" text,
    "hold_stop_reason" text,
    "hold_stop_since" text,
    "source_snapshot" jsonb,
    "fulfillment_status" text,
    "fulfilled_qty" numeric,
    "fulfilled_by" text,
    "fulfillment_updated_at" timestamp with time zone,
    "customer" text,
    "consignee" text,
    "qty" numeric,
    "measure_spec" text,
    "comments" text,
    "submitted_by" text
);
CREATE TABLE public.ph_master_inventory(unique_id text PRIMARY KEY,itemcode text,locationcode text,lotcode text,
  eval_user text,default_owner text,effective_worker text,assignedto text);
CREATE TABLE public.ph_itemcode_default_owners(itemcode_normalized text,assignedto text);
CREATE TABLE public.ph_flyer_folder_rows(master_unique_id text);
CREATE TABLE public.ph_requests_completed_history (LIKE public.ph_requests_pending);
CREATE TABLE public.ph_request_history (LIKE public.ph_requests_pending);
CREATE TABLE public.ph_request_delivery_outbox(request_id text,event_type text,status text,created_at timestamptz);
CREATE VIEW public.ph_active_request WITH (security_invoker=true) AS SELECT * FROM public.ph_requests_pending WHERE false;
CREATE TABLE public.ph_app_settings(key text PRIMARY KEY,value jsonb,updated_at timestamptz,updated_by text);
INSERT INTO public.ph_app_settings VALUES('app_version','{"app_version":"3.0.72","release":"AgData v3.0.72","retained":"yes"}',now(),'prior');
CREATE FUNCTION private.scheduled_handover_cutoff_reached_v1(text,timestamptz) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
CREATE FUNCTION suspend_tag_private.session_active(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT $2='11111111-1111-1111-1111-111111111111'::uuid
$$;
CREATE FUNCTION private.can_create_general_requests() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION private.can_create_av_requests() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE FUNCTION private.can_manage_requests() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
CREATE FUNCTION private.canonical_request_json(text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(row) FROM public.ph_requests_pending row WHERE row.unique_id=$1
$$;
CREATE FUNCTION private.request_receipt_json_v1(text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(row) FROM public.ph_requests_completed_history row WHERE row.unique_id=$1
$$;
CREATE TABLE storage.objects(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage,public,auth TO anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON storage.objects TO anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE storage.objects_id_seq TO anon,authenticated,service_role;
CREATE POLICY old_open_insert ON storage.objects FOR INSERT TO anon,authenticated WITH CHECK(true);
CREATE POLICY old_open_update ON storage.objects FOR UPDATE TO anon,authenticated USING(true) WITH CHECK(true);
CREATE POLICY old_open_read ON storage.objects FOR SELECT TO anon,authenticated USING(true);
INSERT INTO public.profiles(id,legacy_user_id,username,role,disabled_at,locked_until,must_change_password)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,n,name,role,
  CASE WHEN n=5 THEN now() END,NULL,n=8
FROM (VALUES
 (1,'dylan_collyge','ADMIN'),(2,'fixture_worker','EVAL'),(3,'fixture_rep','REP'),
 (4,'fixture_admin','ADMIN'),(5,'fixture_disabled','ADMIN'),(6,'fixture_legacy_off','EVAL'),
 (7,'fixture_module_off','REP'),(8,'fixture_password','ADMIN'),(9,'fixture_locked','EVAL'),
 (10,'fixture_missing_matrix','ADMIN'),(11,'fixture_qc','QC')
) fixture(n,name,role);
INSERT INTO public.ph_app_users(id,username,role,disabled_at,locked_until,must_change_password)
SELECT legacy_user_id,username,role,CASE WHEN legacy_user_id=6 THEN now() END,
  CASE WHEN legacy_user_id=9 THEN now()+interval '1 hour' END,false FROM public.profiles;
INSERT INTO public.user_access(profile_id,username,role,edit_any_row,can_edit_all_rows,
  edit_assigned_rows_only,can_edit_assigned_items,flyer_folder_access,view_permissions,view_all_requests)
SELECT id,username,role,CASE WHEN legacy_user_id IN (4,5,7,8,11) THEN 'Y' ELSE 'N' END,
  CASE WHEN legacy_user_id IN (4,5,7,8,11) THEN 'Y' ELSE 'N' END,
  CASE WHEN legacy_user_id IN (2,6,9) THEN 'Y' ELSE 'N' END,
  CASE WHEN legacy_user_id IN (2,6,9) THEN 'Y' ELSE 'N' END,'N',
  jsonb_build_object('view_que_request',CASE WHEN legacy_user_id=7 THEN 'N' ELSE 'Y' END,
    'view_drive_mode','Y','view_que_suspend','Y'),'Y'
FROM public.profiles WHERE legacy_user_id<>10;
INSERT INTO public.ph_master_inventory VALUES
 ('master-a','ITEM','A.01','26.F1','fixture_worker',NULL,NULL,NULL),
 ('master-b','ITEM','B.01','26.F1','other_worker',NULL,NULL,NULL),
 ('master-c','ITEM','C.01','26.F1','other_worker',NULL,NULL,NULL);
INSERT INTO public.ph_requests_pending(unique_id,master_id,itemcode,locationcode,lotcode,req_status,req_archived,
  request_created_by_username,request_selected_rep_username,requested_by,row_version,date_completed)
VALUES ('completed-own','master-a','ITEM','A.01','26.F1','completed',false,'fixture_worker','other_rep','other_rep',1,'2026-11-11'),
 ('pending-rep','master-b','ITEM','B.01','26.F1','pending',false,'other_creator','fixture_rep','other_rep',1,NULL),
 ('foreign','master-c','ITEM','C.01','26.F1','pending',false,'other_creator','other_rep','other_rep',1,NULL);
INSERT INTO public.ph_requests_completed_history SELECT * FROM public.ph_requests_pending WHERE unique_id='completed-own';
UPDATE public.ph_requests_completed_history SET unique_id='history-own';
INSERT INTO public.ph_request_history SELECT * FROM public.ph_requests_completed_history;
