CREATE UNIQUE INDEX fixture_user_access_username ON public.user_access(username);
CREATE TABLE public.role_access_baselines(role text PRIMARY KEY,matrix_permissions jsonb);
CREATE TABLE public.user_access_control(profile_id uuid,salesrep_match_names text[]);
CREATE TABLE public.ph_customer_consignee_sales_reps(salesrepname text);
CREATE FUNCTION private.canonical_sales_rep_key_v23127(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT private.access_username_v23119($1)';
CREATE FUNCTION private.is_full_app_administrator_v1(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false';
CREATE FUNCTION public.app_account_active_v1(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=$1 AND username=$2 AND disabled_at IS NULL
    AND (locked_until IS NULL OR locked_until<=statement_timestamp()))
$$;
CREATE TABLE public.app_runtime_watchdog_events(id bigint PRIMARY KEY,status text,last_seen_at timestamptz,
  first_seen_at timestamptz,username text,normalized_role text,view_id text,sub_module text,event_type text,
  error_message text,owning_skill text,resolved_in_version text,context_json jsonb);
INSERT INTO public.app_runtime_watchdog_events
SELECT id,CASE WHEN id<=2 THEN 'open' ELSE 'resolved' END,now()-id*interval '1 second',
  now()-id*interval '1 second','fixture','eval','request','photo','NETWORK','bounded','photo',NULL,'{}'
FROM generate_series(1,329) id;
CREATE FUNCTION public.reject_watchdog_fixture_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WATCHDOG_LIST_MUST_NOT_WRITE'; END $$;
CREATE TRIGGER fixture_no_watchdog_write BEFORE UPDATE OR DELETE ON public.app_runtime_watchdog_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_watchdog_fixture_write();
INSERT INTO public.profiles(id,legacy_user_id,username,role,must_change_password) VALUES
 ('00000000-0000-0000-0000-000000000012',12,'megan_kelly','ADMIN',false),
 ('00000000-0000-0000-0000-000000000013',13,'jd_jones','ADMIN',false);
INSERT INTO public.ph_app_users(id,username,role,must_change_password) SELECT legacy_user_id,username,role,false
  FROM public.profiles WHERE legacy_user_id IN (12,13);
INSERT INTO public.user_access(profile_id,username,role,edit_any_row,edit_assigned_rows_only,view_permissions,manage_user_access)
  SELECT id,username,role,'Y','N','{"view_que_request":"Y"}','Y' FROM public.profiles WHERE legacy_user_id IN (12,13);
UPDATE public.user_access SET manage_user_access='Y' WHERE profile_id IN
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004');
