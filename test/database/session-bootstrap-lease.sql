BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE test_private.session_bootstrap_lease(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), owner_token uuid NOT NULL, expires_at timestamptz NOT NULL);
ALTER TABLE test_private.session_bootstrap_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON test_private.session_bootstrap_lease FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.test_session_bootstrap_claim(p_owner uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,test_private AS $$
DECLARE acquired boolean;
BEGIN
 IF p_owner IS NULL THEN RETURN false; END IF;
 INSERT INTO test_private.session_bootstrap_lease(singleton,owner_token,expires_at) VALUES(true,p_owner,clock_timestamp()+interval '20 seconds')
 ON CONFLICT(singleton) DO UPDATE SET owner_token=EXCLUDED.owner_token,expires_at=EXCLUDED.expires_at WHERE session_bootstrap_lease.expires_at<clock_timestamp() OR session_bootstrap_lease.owner_token=p_owner RETURNING true INTO acquired;
 RETURN coalesce(acquired,false);
END $$;
CREATE FUNCTION public.test_session_bootstrap_release(p_owner uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,test_private AS $$
DECLARE released boolean;
BEGIN
 DELETE FROM test_private.session_bootstrap_lease WHERE singleton AND owner_token=p_owner RETURNING true INTO released;
 RETURN coalesce(released,false);
END $$;
REVOKE ALL ON FUNCTION public.test_session_bootstrap_claim(uuid),public.test_session_bootstrap_release(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.test_session_bootstrap_claim(uuid),public.test_session_bootstrap_release(uuid) TO service_role;
DO $$ BEGIN
 IF has_function_privilege('anon','public.test_session_bootstrap_claim(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.test_session_bootstrap_claim(uuid)','EXECUTE') THEN RAISE EXCEPTION 'BOOTSTRAP_LEASE_EXPOSED'; END IF;
 IF NOT has_function_privilege('service_role','public.test_session_bootstrap_claim(uuid)','EXECUTE') THEN RAISE EXCEPTION 'BOOTSTRAP_SERVICE_DENIED'; END IF;
END $$;
DO $$ DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); BEGIN
 IF NOT public.test_session_bootstrap_claim(a) OR public.test_session_bootstrap_claim(b) OR public.test_session_bootstrap_release(b) THEN RAISE EXCEPTION 'BOOTSTRAP_LEASE_NOT_EXCLUSIVE'; END IF;
 IF NOT public.test_session_bootstrap_release(a) OR NOT public.test_session_bootstrap_claim(b) OR NOT public.test_session_bootstrap_release(b) THEN RAISE EXCEPTION 'BOOTSTRAP_LEASE_NOT_RELEASED'; END IF;
END $$;
COMMIT;
