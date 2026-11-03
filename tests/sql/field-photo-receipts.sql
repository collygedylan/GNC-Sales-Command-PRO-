BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='15s';
-- Exercise the installed migration and discard every fixture and photo write.
-- Use a disposable profile and session. Never complete a Request or invoke a delivery worker.
DO $fixture$
DECLARE actor_id uuid := gen_random_uuid(); session_id uuid := gen_random_uuid();
BEGIN
    PERFORM set_config('test.photo_source',s.unique_id,true) FROM public.ph_soc_master s JOIN public.ph_master_inventory m
        ON (m.itemcode,m.locationcode,m.lotcode)=(s.itemcode,s.locationcode,s.lotcode)
        WHERE s.date_completed IS NULL AND m.date_completed IS NOT NULL
          AND suspend_tag_private.eligible(s.suspend,s.suspend_to)
          AND NOT EXISTS (SELECT 1 FROM suspend_tag_private.workflows w WHERE w.source_uid=s.unique_id AND w.status IN ('approved','awaiting_rep'))
        ORDER BY (s.itemcode='010845.031.1') DESC, s.unique_id LIMIT 1;
    INSERT INTO auth.users(id) VALUES(actor_id);
    INSERT INTO public.profiles(id,username,role) VALUES(actor_id,'photo_test_' || replace(actor_id::text,'-',''),'Manager');
    INSERT INTO auth.sessions(id,user_id) VALUES(session_id,actor_id);
    PERFORM set_config('test.photo_actor',actor_id::text,true);
    PERFORM set_config('test.photo_session',session_id::text,true);
END
$fixture$;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
DO $proof$
DECLARE actor_id uuid := current_setting('test.photo_actor')::uuid; session_id uuid := current_setting('test.photo_session')::uuid;
    source_row public.ph_soc_master; master_row public.ph_master_inventory; request_row public.ph_requests_pending;
    receipt jsonb; saved_version bigint; photo text := 'https://example.invalid/rollback-' || gen_random_uuid() || '.jpg';
BEGIN
    SELECT * INTO STRICT source_row FROM public.ph_soc_master WHERE unique_id=current_setting('test.photo_source');
    SELECT * INTO STRICT master_row FROM public.ph_master_inventory
        WHERE (itemcode,locationcode,lotcode)=(source_row.itemcode,source_row.locationcode,source_row.lotcode) LIMIT 1;
    receipt := public.suspend_tag_command_v1(actor_id,'save',jsonb_build_object('sourceUid',source_row.unique_id,
        'sourceIdentity',jsonb_build_object('masterUid',master_row.unique_id),'expectedLastUpdated',source_row.last_updated,
        'patch',jsonb_build_object('dock_photo_link',photo,'dock_photo_name','rollback.jpg')),gen_random_uuid(),null,session_id);
    IF receipt->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM public.ph_soc_master WHERE unique_id=source_row.unique_id AND photo=ANY(string_to_array(dock_photo_link,',')) AND date_completed IS NULL)
        OR NOT EXISTS(SELECT 1 FROM public.ph_master_inventory WHERE unique_id=master_row.unique_id AND photo=ANY(string_to_array(photo_link,',')) AND date_completed IS NOT DISTINCT FROM master_row.date_completed) THEN
        RAISE EXCEPTION 'Suspend photo failed atomic exact-row proof';
    END IF;
    SELECT r.* INTO STRICT request_row FROM public.ph_requests_pending r JOIN public.ph_master_inventory m ON m.unique_id=r.master_id LIMIT 1;
    FOR i IN 1..2 LOOP
        receipt := public.request_work_command_v1(actor_id,session_id,'append_photo',request_row.unique_id,null,
            jsonb_build_object('req_photo_link',photo,'req_photo_name','rollback.jpg'),false);
        IF i=2 AND saved_version IS DISTINCT FROM (receipt->>'row_version')::bigint THEN RAISE EXCEPTION 'Replay wrote a second revision'; END IF;
        saved_version := (receipt->>'row_version')::bigint;
        IF receipt->>'lifecycle_state' IS DISTINCT FROM 'pending_active' OR receipt->'row'->>'unique_id' IS DISTINCT FROM request_row.unique_id
            OR receipt->'master_row'->>'unique_id' IS DISTINCT FROM request_row.master_id
            OR (SELECT count(*) FROM unnest(string_to_array(receipt->'row'->>'req_photo_link',',')) u WHERE u=photo)<>1
            OR (SELECT count(*) FROM unnest(string_to_array(receipt->'master_row'->>'photo_link',',')) u WHERE u=photo)<>1 THEN
            RAISE EXCEPTION 'Request photo failed exact-row or replay proof';
        END IF;
    END LOOP;
    BEGIN
        PERFORM public.request_work_command_v1(actor_id,gen_random_uuid(),'append_photo',request_row.unique_id,null,
            jsonb_build_object('req_photo_link',photo,'req_photo_name','rollback.jpg'),false);
        RAISE EXCEPTION 'Unverified session accepted';
    EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM <> 'REQUEST_WORK_SESSION_REQUIRED' THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claim.sub',actor_id::text,true);
    BEGIN
        PERFORM public.save_drive_evidence_v3(master_row.unique_id,master_row.itemcode,master_row.locationcode,master_row.lotcode,
            master_row.last_updated::text,'{}',jsonb_build_object('photo_link',photo),false,'location',gen_random_uuid()::text);
        RAISE EXCEPTION 'Direct completed-row edit accepted';
    EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM <> 'DRIVE_ROW_COMPLETED_UNLOCK_REQUIRED' THEN RAISE; END IF;
    END;
    IF has_table_privilege('anon','public.ph_master_inventory','DELETE') OR has_table_privilege('anon','public.ph_requests_pending','UPDATE') THEN
        RAISE EXCEPTION 'Anonymous mutation detected';
    END IF;
END
$proof$;
ROLLBACK;
SELECT 'exact_suspend_and_request_replay_passed' AS rollback_proof;
