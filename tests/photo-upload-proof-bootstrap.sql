CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
INSERT INTO auth.sessions VALUES
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000002',NULL),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000003',NULL);
CREATE TABLE public.ph_soc_master(unique_id text PRIMARY KEY,itemcode text,locationcode text,lotcode text,active boolean);
CREATE VIEW public.ph_active_suspend WITH (security_invoker=true) AS SELECT * FROM public.ph_soc_master WHERE active;
CREATE TABLE public.ph_inventory_row_assignments(present_in_drive boolean,itemcode_normalized text,locationcode text,lotcode text,assignedto text);
CREATE FUNCTION private.eval_location_zone(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN $1 LIKE 'Z.%' THEN 'inside' ELSE 'outside' END
$$;
CREATE FUNCTION private.inventory_assignment_actor_active_v3047(text,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE username=$1 AND disabled_at IS NULL)
$$;
INSERT INTO public.ph_inventory_row_assignments VALUES(true,'ITEM','A.01','26.F1','fixture_worker');
INSERT INTO public.ph_soc_master VALUES('tag-a','ITEM','A.01','26.F1',true),('tag-z','ITEM','Z.01','26.F1',true);
INSERT INTO public.ph_master_inventory VALUES('master-z','ITEM','Z.01','26.F1','other_worker',NULL,NULL,NULL);
INSERT INTO public.profiles(id,legacy_user_id,username,role,must_change_password)
 VALUES('00000000-0000-0000-0000-000000000012',12,'zoe_green','EVAL',false);
INSERT INTO public.ph_app_users(id,username,role,must_change_password) VALUES(12,'zoe_green','EVAL',false);
INSERT INTO public.user_access(profile_id,username,role,edit_any_row,edit_assigned_rows_only,view_permissions)
 VALUES('00000000-0000-0000-0000-000000000012','zoe_green','EVAL','N','Y','{"view_que_suspend":"Y"}');
