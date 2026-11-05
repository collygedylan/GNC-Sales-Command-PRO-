BEGIN;
CREATE TABLE IF NOT EXISTS test_private.mail_worker_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),signing_secret text NOT NULL,last_wake_at timestamptz);
ALTER TABLE test_private.mail_worker_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON test_private.mail_worker_config FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.test_mail_wake() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE config test_private.mail_worker_config; ticket bigint; BEGIN
 IF NOT EXISTS(SELECT 1 FROM test_private.ops_outbox WHERE status IN('PENDING','RETRY','PROCESSING') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now())) AND NOT EXISTS(SELECT 1 FROM public.test_ph_request_delivery_outbox WHERE test_mail_eligible AND status IN('pending','processing','failed') AND email_delivered_at IS NULL AND next_attempt_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<now())) THEN RETURN NULL;END IF;
 SELECT * INTO config FROM test_private.mail_worker_config WHERE singleton FOR UPDATE;
 IF config.signing_secret IS NULL OR config.last_wake_at>clock_timestamp()-interval '1 second' THEN RETURN NULL;END IF;
 SELECT net.http_post(url:='https://apztnscvagayslumnalr.supabase.co/functions/v1/test-email-worker',body:='{"action":"wake"}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-test-mail-key',config.signing_secret),timeout_milliseconds:=30000) INTO ticket;
 UPDATE test_private.mail_worker_config SET last_wake_at=clock_timestamp() WHERE singleton;RETURN ticket;
END $$;
REVOKE ALL ON FUNCTION public.test_mail_wake() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.test_mail_wake() TO service_role,postgres;
CREATE OR REPLACE FUNCTION test_private.wake_request_delivery_worker_now(p_source text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.test_mail_wake() $$;
CREATE OR REPLACE FUNCTION test_private.mail_wake_after_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM public.test_mail_wake();RETURN NEW;END $$;
DROP TRIGGER IF EXISTS test_mail_wake ON test_private.ops_outbox;
CREATE TRIGGER test_mail_wake AFTER INSERT ON test_private.ops_outbox FOR EACH STATEMENT EXECUTE FUNCTION test_private.mail_wake_after_insert();
DROP TRIGGER IF EXISTS test_mail_wake ON public.test_ph_request_delivery_outbox;
CREATE TRIGGER test_mail_wake AFTER INSERT ON public.test_ph_request_delivery_outbox FOR EACH STATEMENT EXECUTE FUNCTION test_private.mail_wake_after_insert();
COMMIT;
