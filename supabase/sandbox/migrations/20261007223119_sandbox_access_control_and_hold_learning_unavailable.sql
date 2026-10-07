-- Sandbox-only migration: remediation for the verified sandbox schema.
--
-- Purpose: bring the sandbox's stale access-control RPC dependencies back into
-- a defined, restrictive state, and make two legacy hold-learning RPCs fail
-- explicitly because their source feature schema is not installed in sandbox.
--
-- Apply only through a separately reviewed sandbox-only migration after an
-- external runner verifies the exact sandbox project ref and database target.
-- PostgreSQL has no dependable project-ref setting here, so this file does not
-- pretend that current_database() or a custom GUC proves the project identity.
-- Do not run against production. The sandbox runner must externally verify the exact project ref before applying this migration.
--
-- Captured sandbox contract: the four user access-control RPCs are owned by
-- postgres, SECURITY DEFINER, empty search_path, EXECUTE for authenticated and
-- service_role only. The health RPC and both hold-learning RPCs are postgres-
-- owned SECURITY DEFINER functions, service_role-only. CREATE OR REPLACE keeps
-- those OIDs, owners, and ACLs; their existing declarations are restated below.
--
-- The archived current-profile helper contract is from
-- 20260820114722_request_integrity_and_eval_assignments.sql. It resolves only
-- auth.uid() to a non-disabled, non-locked profile. We intentionally do not use
-- the newer scheduled-handover implementation: its ph_app_users and scheduled
-- handover dependencies are absent in this sandbox.
--
-- The hold-learning functions are not called by v2. Their authoritative
-- implementations require absent ph_hold_learning_events, ph_weather_hourly,
-- ph_hold_release_cycles, and derived learning relations. This migration does not
-- create phantom source tables or import production data. A later sandbox
-- feature migration must supply the complete schema and security contract.

BEGIN;

DO $preflight$
DECLARE
  signature text;
  proc_oid oid;
BEGIN
  IF to_regprocedure('private.current_active_profile()') IS NOT NULL
     OR to_regprocedure('private.is_service_role_request()') IS NOT NULL THEN
    RAISE EXCEPTION 'SANDBOX_REMEDIATION_HELPER_ALREADY_EXISTS';
  END IF;

  FOREACH signature IN ARRAY ARRAY[
    'public.get_access_control_health_snapshot_v1()',
    'public.get_my_app_permissions_v1()',
    'public.publish_access_control_policy_v1(integer,text)',
    'public.save_access_control_draft_v1(integer,jsonb,text)',
    'public.save_limited_access_override_v1(integer,jsonb,text)',
    'public.v2_refresh_hold_learning_profiles()',
    'public.v2_refresh_hold_learning_weather_features(integer)'
  ] LOOP
    proc_oid := to_regprocedure(signature);
    IF proc_oid IS NULL THEN
      RAISE EXCEPTION 'SANDBOX_REMEDIATION_TARGET_MISSING: %', signature;
    END IF;
    IF NOT (SELECT p.prosecdef
            FROM pg_proc p
            WHERE p.oid = proc_oid)
       OR (SELECT r.rolname
           FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
           WHERE p.oid = proc_oid) <> 'postgres' THEN
      RAISE EXCEPTION 'SANDBOX_REMEDIATION_TARGET_SECURITY_DRIFT: %', signature;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.get_my_app_permissions_v1()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_my_app_permissions_v1()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.publish_access_control_policy_v1(integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.save_access_control_draft_v1(integer,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.save_limited_access_override_v1(integer,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.publish_access_control_policy_v1(integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.save_access_control_draft_v1(integer,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.save_limited_access_override_v1(integer,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_app_permissions_v1()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.publish_access_control_policy_v1(integer,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_access_control_draft_v1(integer,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_limited_access_override_v1(integer,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_access_control_health_snapshot_v1()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_access_control_health_snapshot_v1()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_access_control_health_snapshot_v1()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v2_refresh_hold_learning_profiles()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.v2_refresh_hold_learning_weather_features(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v2_refresh_hold_learning_profiles()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.v2_refresh_hold_learning_weather_features(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v2_refresh_hold_learning_profiles()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.v2_refresh_hold_learning_weather_features(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SANDBOX_REMEDIATION_ACL_DRIFT';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION private.current_active_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.disabled_at IS NULL
    AND (p.locked_until IS NULL OR p.locked_until <= now())
  LIMIT 1
$function$;
ALTER FUNCTION private.current_active_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.current_active_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.current_active_profile() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_service_role_request()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt()->>'role',
    ''
  ) = 'service_role'
$function$;
ALTER FUNCTION private.is_service_role_request() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_service_role_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_service_role_request() TO service_role;

-- CREATE OR REPLACE preserves the captured owner and ACL. These definitions
-- retain the exact SECURITY DEFINER/search_path settings from the sandbox.
CREATE OR REPLACE FUNCTION public.v2_refresh_hold_learning_profiles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '0A000',
    MESSAGE = 'SANDBOX_HOLD_LEARNING_UNAVAILABLE';
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_refresh_hold_learning_weather_features(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '0A000',
    MESSAGE = 'SANDBOX_HOLD_LEARNING_UNAVAILABLE';
END;
$function$;

-- The sandbox runner verifies the project ref outside SQL before applying.
COMMIT;



