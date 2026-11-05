BEGIN;
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.test_mail_claim(worker text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE events jsonb:='[]'; e record; token uuid:=gen_random_uuid(); BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 FOR e IN SELECT * FROM test_private.ops_outbox WHERE status IN('PENDING','RETRY','PROCESSING') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 5 LOOP
  UPDATE test_private.ops_outbox SET status='PROCESSING',lease_token=token,lease_until=now()+interval '90 seconds',attempts=attempts+1 WHERE event_id=e.event_id;
  events:=events||jsonb_build_array(jsonb_build_object('source','ops','id',e.event_id,'lease',token,'payload',test_private.trap_email_json(e.payload)));
 END LOOP;
 FOR e IN SELECT * FROM public.test_ph_request_delivery_outbox WHERE test_mail_eligible AND email_delivered_at IS NULL AND status IN('pending','processing','failed') AND next_attempt_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 5 LOOP
  UPDATE public.test_ph_request_delivery_outbox SET status='processing',lease_token=token,lease_owner=worker,lease_expires_at=now()+interval '90 seconds',attempt_count=attempt_count+1,last_attempt_at=now() WHERE event_id=e.event_id;
  events:=events||jsonb_build_array(jsonb_build_object('source','request','id',e.event_id,'lease',token,'payload',test_private.trap_email_json(e.payload)));
 END LOOP;RETURN events;
END $$;
CREATE OR REPLACE FUNCTION public.test_mail_settle(source text,event uuid,lease uuid,outcome text,proof jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE changed integer; BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 IF outcome NOT IN('SENT','RETRY','REVIEW') THEN RAISE EXCEPTION 'INVALID_DELIVERY_OUTCOME';END IF;
 IF outcome='SENT' AND (proof->>'recipient'<>'dylan_collyge@greenleafnursery.com' OR proof->>'eventId'<>event::text OR proof->>'status'<>'SENT') THEN RAISE EXCEPTION 'DELIVERY_RECEIPT_MISMATCH';END IF;
 IF source='ops' THEN UPDATE test_private.ops_outbox SET status=outcome,receipt=proof,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '2 minutes' WHERE event_id=event AND lease_token=lease;
 ELSE UPDATE public.test_ph_request_delivery_outbox SET status=CASE WHEN outcome='SENT' THEN 'delivered' WHEN outcome='REVIEW' THEN 'unknown' ELSE 'pending' END,email_delivered_at=CASE WHEN outcome='SENT' THEN now() ELSE email_delivered_at END,delivered_at=CASE WHEN outcome='SENT' THEN now() ELSE delivered_at END,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=CASE WHEN outcome='REVIEW' THEN 'infinity'::timestamptz ELSE now()+interval '2 minutes' END,channel_results=coalesce(channel_results,'{}')||jsonb_build_object('test_email',proof),sanitized_error_code=CASE WHEN outcome='SENT' THEN NULL ELSE coalesce(proof->>'code','TEST_DELIVERY_RETRY') END WHERE event_id=event AND lease_token=lease AND test_mail_eligible;
 END IF;GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.test_mail_claim(text),public.test_mail_settle(text,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.test_mail_claim(text),public.test_mail_settle(text,uuid,uuid,text,jsonb) TO service_role;
COMMIT;
