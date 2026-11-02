BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';
-- Roster rows do not create login identities; disabled users retain their state.
ALTER TABLE public.user_access ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE public.user_access ADD COLUMN IF NOT EXISTS userrole text;
CREATE OR REPLACE FUNCTION private.roster_role_v23138(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE private.canonical_user_access_role_v1(value)
 WHEN 'super_admin' THEN 'super-admin' WHEN 'admin' THEN 'ADMIN'
 WHEN 'evaluator' THEN 'EVAL' WHEN 'sales_rep' THEN 'REP' WHEN 'csr' THEN 'CSR'
 WHEN 'counter' THEN 'QC' WHEN 'qc_supervisor' THEN 'QC Supervisor'
 WHEN 'data_entry' THEN 'data entry' WHEN 'supervisor' THEN 'data entry supervisor'
 WHEN 'foreman' THEN 'Foreman' WHEN 'take_backs' THEN 'Take Backs'
 WHEN 'grower' THEN 'Grower' WHEN 'manager' THEN 'Manager' ELSE btrim(value) END
$$;
CREATE OR REPLACE FUNCTION private.normalize_roster_role_v23138() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_TABLE_NAME = 'user_access' THEN
   IF TG_OP = 'UPDATE' AND NEW.userrole IS DISTINCT FROM OLD.userrole AND NEW.role IS NOT DISTINCT FROM OLD.role THEN NEW.role := NEW.userrole; END IF;
   NEW.role := private.roster_role_v23138(NEW.role); NEW.userrole := NEW.role;
 ELSE NEW.role := private.roster_role_v23138(NEW.role);
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION private.sync_roster_role_v23138() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE canonical_name text := private.access_username_v23119(NEW.username);
BEGIN
 IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME = 'ph_app_users' THEN
   INSERT INTO public.user_access(username,profile_id,display_name,role,userrole,make_request,can_make_request,request_all_reps,create_project)
   SELECT canonical_name,p.id,coalesce(nullif(p.display_name,''),NEW.username),NEW.role,NEW.role,'N','N','N','N'
   FROM (SELECT 1) anchor LEFT JOIN public.profiles p ON private.access_username_v23119(p.username)=canonical_name
   ON CONFLICT(username) DO UPDATE SET role=excluded.role,userrole=excluded.role,profile_id=coalesce(excluded.profile_id,public.user_access.profile_id)
   WHERE (public.user_access.role,public.user_access.userrole,public.user_access.profile_id) IS DISTINCT FROM (excluded.role,excluded.role,coalesce(excluded.profile_id,public.user_access.profile_id));
 ELSE
   IF EXISTS(SELECT 1 FROM public.ph_app_users WHERE private.access_username_v23119(username)=canonical_name AND role IS DISTINCT FROM NEW.role) THEN
     UPDATE public.ph_app_users SET role=NEW.role WHERE private.access_username_v23119(username)=canonical_name AND role IS DISTINCT FROM NEW.role;
   END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE private.access_username_v23119(username)=canonical_name AND private.canonical_user_access_role_v1(role) IS DISTINCT FROM private.canonical_user_access_role_v1(NEW.role)) THEN
   UPDATE public.profiles SET role=NEW.role WHERE private.access_username_v23119(username)=canonical_name AND private.canonical_user_access_role_v1(role) IS DISTINCT FROM private.canonical_user_access_role_v1(NEW.role);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS normalize_roster_role_v23138 ON public.ph_app_users;
CREATE TRIGGER normalize_roster_role_v23138 BEFORE INSERT OR UPDATE OF role ON public.ph_app_users FOR EACH ROW EXECUTE FUNCTION private.normalize_roster_role_v23138();
DROP TRIGGER IF EXISTS normalize_roster_role_v23138 ON public.user_access;
CREATE TRIGGER normalize_roster_role_v23138 BEFORE INSERT OR UPDATE OF role,userrole ON public.user_access FOR EACH ROW EXECUTE FUNCTION private.normalize_roster_role_v23138();
DROP TRIGGER IF EXISTS sync_roster_role_v23138 ON public.ph_app_users;
CREATE TRIGGER sync_roster_role_v23138 AFTER INSERT OR UPDATE OF role,username ON public.ph_app_users FOR EACH ROW EXECUTE FUNCTION private.sync_roster_role_v23138();
DROP TRIGGER IF EXISTS sync_roster_role_v23138 ON public.user_access;
CREATE TRIGGER sync_roster_role_v23138 AFTER INSERT OR UPDATE OF role,userrole ON public.user_access FOR EACH ROW EXECUTE FUNCTION private.sync_roster_role_v23138();
-- Keep the canonical profile seeder compatible with a pre-existing roster-only row.
DO $patch$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('private.seed_user_access_v23119(public.profiles)'::regprocedure) INTO definition;
 definition := replace(definition,'DELETE FROM public.user_access WHERE profile_id=p.id; RETURN;','RETURN;');
 definition := replace(definition,'ON CONFLICT(profile_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,role=excluded.role',
 'ON CONFLICT(username) DO UPDATE SET profile_id=excluded.profile_id,display_name=excluded.display_name,role=excluded.role');
 EXECUTE definition;
END $patch$;
UPDATE public.ph_app_users SET role=private.roster_role_v23138(role) WHERE role IS DISTINCT FROM private.roster_role_v23138(role);
INSERT INTO public.user_access(username,profile_id,display_name,role,userrole,make_request,can_make_request,request_all_reps,create_project)
SELECT private.access_username_v23119(u.username),p.id,coalesce(nullif(p.display_name,''),u.username),u.role,u.role,'N','N','N','N'
FROM public.ph_app_users u LEFT JOIN public.profiles p ON private.access_username_v23119(p.username)=private.access_username_v23119(u.username)
ON CONFLICT(username) DO UPDATE SET role=excluded.role,userrole=excluded.role,profile_id=coalesce(excluded.profile_id,public.user_access.profile_id);
-- Public read compatibility is independent of the optional row-assignment join.
ALTER TABLE public.ph_itemcode_default_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ph_itemcode_default_owners_active_read ON public.ph_itemcode_default_owners;
DROP POLICY IF EXISTS ph_itemcode_default_owners_roster_access ON public.ph_itemcode_default_owners;
CREATE POLICY ph_itemcode_default_owners_roster_access ON public.ph_itemcode_default_owners FOR ALL TO anon,authenticated,service_role USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ph_itemcode_default_owners TO anon,authenticated,service_role;
-- The requested grants do not authorize anonymous writes. Every direct mutation
-- repeats the canonical administrator and active-owner checks before any row changes.
CREATE OR REPLACE FUNCTION private.guard_owner_mutation_v23138() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles;
BEGIN
 IF current_setting('request.jwt.claim.role',true) = 'service_role' OR coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role'='service_role' THEN RETURN coalesce(NEW,OLD); END IF;
 actor := private.current_active_profile();
 IF actor.id IS NULL OR NOT private.can_manage_eval_assignments() THEN RAISE EXCEPTION 'ITEMCODE_OWNER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF TG_OP <> 'DELETE' AND nullif(NEW.assignedto,'') IS NOT NULL AND NOT private.eval_assignment_profile_active_v1(NEW.assignedto) THEN RAISE EXCEPTION 'ITEMCODE_OWNER_INACTIVE' USING ERRCODE='42501'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS a_guard_owner_mutation_v23138 ON public.ph_itemcode_default_owners;
CREATE TRIGGER a_guard_owner_mutation_v23138 BEFORE INSERT OR UPDATE OR DELETE ON public.ph_itemcode_default_owners FOR EACH ROW EXECUTE FUNCTION private.guard_owner_mutation_v23138();
GRANT EXECUTE ON FUNCTION public.set_itemcode_default_owners_v1(jsonb,uuid) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_itemcode_default_owners_v1(text[],text,uuid) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.roster_role_v23138(text),private.normalize_roster_role_v23138(),private.sync_roster_role_v23138(),private.guard_owner_mutation_v23138() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
