BEGIN;
SET LOCAL lock_timeout='4s'; SET LOCAL statement_timeout='15s';
-- Canonical login aliases preserve the existing Ben Harveson identity and ownership.
CREATE OR REPLACE FUNCTION private.access_username_v23119(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN normalized='nally_aguilar' THEN 'nelly_aguilar'
 WHEN normalized='ben_harvison' THEN 'ben_harveson'
 WHEN normalized ~ '^(chance_alldredge|alldredge_chance)(_south_tx)?$' THEN 'chance_alldredge' ELSE normalized END
 FROM (SELECT trim(both '_' from regexp_replace(lower(btrim(split_part(coalesce(value,''),'@',1))),'[^a-z0-9]+','_','g')) normalized) n
$fn$;
CREATE TEMP TABLE ag312_users ON COMMIT DROP AS
SELECT DISTINCT u.id,u.username,p.id profile_id FROM public.ph_app_users u
JOIN public.profiles p ON p.legacy_user_id=u.id
JOIN public.user_access a ON a.username=u.username
WHERE u.disabled_at IS NULL AND p.disabled_at IS NULL AND
(EXISTS(SELECT 1 FROM public.ph_company_directory d WHERE d.username=u.username AND d.active)
 OR regexp_replace(upper(a.role),'[^A-Z]','','g') IN ('REP','SALESREP','SALES'));
-- Existing per-user native and legacy credentials already agree. Do not reset passwords.
UPDATE public.ph_app_users u SET failed_login_count=0,locked_until=NULL FROM ag312_users t WHERE u.id=t.id AND (u.failed_login_count<>0 OR u.locked_until IS NOT NULL);
UPDATE public.profiles p SET locked_until=NULL,updated_at=clock_timestamp() FROM ag312_users t WHERE p.id=t.profile_id AND p.locked_until IS NOT NULL;
UPDATE public.user_access a SET make_request='Y',can_make_request='Y',view_all_requests='Y',revision=revision+1 FROM ag312_users t WHERE a.username=t.username AND (a.make_request<>'Y' OR a.can_make_request<>'Y' OR a.view_all_requests<>'Y');
DO $verify$ BEGIN
 IF private.access_username_v23119('Ben Harvison')<>'ben_harveson' OR private.access_username_v23119('ben.harvison')<>'ben_harveson' OR private.access_username_v23119('ben_harvison@greenleafnursery.com')<>'ben_harveson' THEN RAISE EXCEPTION 'AG312_BEN_ALIAS'; END IF;
 IF EXISTS(SELECT 1 FROM ag312_users t JOIN public.ph_app_users u ON u.id=t.id JOIN public.profiles p ON p.id=t.profile_id JOIN public.user_access a ON a.username=t.username WHERE u.disabled_at IS NOT NULL OR u.locked_until IS NOT NULL OR u.failed_login_count<>0 OR p.disabled_at IS NOT NULL OR p.locked_until IS NOT NULL OR a.make_request<>'Y' OR a.view_all_requests<>'Y') THEN RAISE EXCEPTION 'AG312_USER_ACCESS_PARITY'; END IF;
END $verify$;
SELECT jsonb_build_object('eligible_users',(SELECT count(*) FROM ag312_users),'ben_harvison_resolves_to',private.access_username_v23119('ben_harvison'),'ph_app_users',(SELECT jsonb_build_object('username',u.username,'active',u.disabled_at IS NULL,'failed_attempts',u.failed_login_count,'locked_until',u.locked_until) FROM public.ph_app_users u WHERE username='ben_harveson'),'user_access',(SELECT jsonb_build_object('username',a.username,'active',p.disabled_at IS NULL,'make_request',a.make_request,'view_all_requests',a.view_all_requests) FROM public.user_access a JOIN public.profiles p ON p.id=a.profile_id WHERE a.username='ben_harveson'),'passwords_preserved',true) AS accounts312;
COMMIT;
