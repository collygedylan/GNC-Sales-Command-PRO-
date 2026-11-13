BEGIN;
DO $test$
DECLARE actor uuid:='00000000-0000-0000-0000-000000000001'; other uuid:='00000000-0000-0000-0000-000000000002';
DECLARE payload jsonb:='{"requestId":"r1","masterUid":"m1","itemCode":"ITEM","locationCode":"A","lotCode":"LOT"}';
DECLARE path text:='v2/'||repeat('a',64)||'.jpg'; path2 text:='v2/'||repeat('b',64)||'.jpg';
DECLARE base text:='https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/';
DECLARE result jsonb;
BEGIN
  INSERT INTO public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode) VALUES ('m1','ITEM','A','LOT'),('sibling','ITEM','A','LOT');
  INSERT INTO public.ph_requests_pending(unique_id,master_id,itemcode,locationcode,lotcode,request_folder,owner)
  VALUES ('r1','m1','ITEM','A','LOT','f1',actor);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  result:=public.request_work_command_v1(actor,actor,'save','r1',1,'{"queued_photo_ids":["photo-1","photo-2"]}',true);
  IF result->>'lifecycle_state' IS DISTINCT FROM 'completed_history' OR result->>'photo_intents_registered' IS DISTINCT FROM 'true'
    OR EXISTS(SELECT FROM public.ph_requests_pending WHERE unique_id='r1')
    OR NOT EXISTS(SELECT FROM public.ph_request_delivery_outbox WHERE request_folder='f1' AND next_attempt_at>now())
  THEN RAISE EXCEPTION 'COMPLETION_NOT_IMMEDIATE_OR_DELIVERY_NOT_DEFERRED'; END IF;

  BEGIN
    PERFORM public.authorize_request_photo_intent_v3079(actor,'owner',actor,payload,'uncaptured',path);
    RAISE EXCEPTION 'UNCAPTURED_PHOTO_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.authorize_request_photo_intent_v3079(other,'other',other,payload,'photo-1',path);
    RAISE EXCEPTION 'WRONG_ACTOR_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.authorize_request_photo_intent_v3079(actor,'owner',actor,payload,'photo-1',path);
  PERFORM public.authorize_request_photo_intent_v3079(actor,'owner',actor,payload,'photo-2',path2);
  BEGIN
    PERFORM public.authorize_request_photo_intent_v3079(actor,'owner',actor,payload,'photo-1',path2);
    RAISE EXCEPTION 'WRONG_OBJECT_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,'role','authenticated')::text,true);
  BEGIN
    PERFORM public.append_request_photo_intent_v3079('r1','photo-1',base||path,split_part(path,'/',2));
    RAISE EXCEPTION 'MISSING_STORAGE_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO storage.objects VALUES ('request_photos',path),('request_photos',path2);
  result:=public.append_request_photo_intent_v3079('r1','photo-1',base||path,split_part(path,'/',2));
  IF result->>'queued_photo_id' IS DISTINCT FROM 'photo-1' OR result->>'lifecycle_state' IS DISTINCT FROM 'completed_history'
    OR NOT EXISTS(SELECT FROM public.ph_request_delivery_outbox WHERE request_folder='f1' AND next_attempt_at>now())
  THEN RAISE EXCEPTION 'PARTIAL_PHOTO_NOT_DURABLE'; END IF;
  PERFORM public.append_request_photo_intent_v3079('r1','photo-2',base||path2,split_part(path2,'/',2));
  PERFORM public.append_request_photo_intent_v3079('r1','photo-1',base||path,split_part(path,'/',2));
  IF NOT EXISTS(SELECT FROM public.ph_master_inventory WHERE unique_id='m1' AND photos=jsonb_build_array(base||path,base||path2))
    OR NOT EXISTS(SELECT FROM public.ph_location_sales_notes WHERE unique_id='m1' AND photos=jsonb_build_array(base||path,base||path2))
    OR EXISTS(SELECT FROM public.ph_master_inventory WHERE unique_id='sibling' AND photos IS NOT NULL)
    OR NOT EXISTS(SELECT FROM public.ph_request_delivery_outbox event WHERE request_folder='f1' AND next_attempt_at<=now()
      AND event.payload->'requests'->0->'photos'=jsonb_build_array(base||path,base||path2))
    OR NOT EXISTS(SELECT FROM public.ph_requests_completed_history WHERE unique_id='r1' AND row_version=3
      AND photos=jsonb_build_array(base||path,base||path2))
  THEN RAISE EXCEPTION 'EVIDENCE_ORDER_OR_DELIVERY_REPLAY_FAILED'; END IF;
END $test$;
ROLLBACK;
