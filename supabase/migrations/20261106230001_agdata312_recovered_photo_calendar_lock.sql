BEGIN;
SET LOCAL lock_timeout='4s'; SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE ag312_cohort(uid text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO ag312_cohort VALUES ('000310_070_1-_7-J_03_000-27_S1-SH-_---'),
('000749_031_1-3DP-F_17_000-27_U2-SH---SOUTH-'),
('000310_070_1-_7-J_03_000-27_F1-SH----1'),
('003202_100_1-_10-F_20_000-27_S1-SH----'),
('003202_071_1-7DP-F_20_000-27_F1-SH----'),
('003202_100_1-_10-F_20_000-27_F1-SH----1'),
('000310_050_1-_5-K_03_000-27_F1-SH----1'),
('008880_250_1-_25-B_06_000-27_F1-SH----1'),
('008880_250_1-_25-B_06_000-27_S1-SH----'),
('008880_250_1-_25-B_06_000-27_U1-SH----'),
('010585_031_1-3DP-D_21_000-27_S1-LD----'),
('drive-6947bb92d1316d11a24665b1edd196e9'),
('drive-aa1f2f9c302c4acb9882339c44d9201f'),
('drive-d913e2a41093a5d03175f2af099c02c8'),
('drive-7ccbe9fd018d0a4c5a481e7745036cf2'),
('drive-d7148af075cfd3ef739335dce3a98c0b');
CREATE TEMP TABLE ag312_restore ON COMMIT DROP AS
SELECT m.unique_id,n.photos,coalesce(nullif(n.photo_link,''),(SELECT string_agg(coalesce(p->>'url',p->>'src',p->>'photo_url'),',' ORDER BY ord) FROM jsonb_array_elements(n.photos) WITH ORDINALITY a(p,ord))) photo_link,n.photo_name,n.photo_url,e.evaluated_at,
 private.inventory_location_evidence_expiry_v2(e.evaluated_at) expires_at,
 coalesce(private.request_numeric_v2362(m.ptronhand),0) on_hand,
 coalesce(private.request_numeric_v2362(m.ptravailable),0) available,
 coalesce(nullif(e.loc_match_pct,0),nullif(n.loc_match_pct,0),100) pct,
 greatest(1,round(coalesce(nullif(e.loc_match_pct,0),nullif(n.loc_match_pct,0),100)/100.0*greatest(coalesce(private.request_numeric_v2362(m.ptronhand),0),1))) qty
FROM ag312_cohort c JOIN public.ph_master_inventory m ON m.unique_id=c.uid
JOIN app_sync_private.inventory_location_evidence_v1 e ON e.source_unique_id=c.uid
JOIN public.ph_location_sales_notes n ON n.unique_id=c.uid
WHERE e.updated_by='agdata311_recovery' AND e.clear_reason='expired'
 AND coalesce(m.loc_photo_match,1)>0
 AND (e.evaluated_at AT TIME ZONE 'America/Chicago')::date >= (clock_timestamp() AT TIME ZONE 'America/Chicago')::date-10
 AND private.inventory_location_evidence_expiry_v2(e.evaluated_at)>clock_timestamp()
 AND n.photos<>'[]'::jsonb AND private.request_numeric_v2362(m.ptronhand)>0
 AND private.request_numeric_v2362(m.ptravailable)>0;
DO $verify$ BEGIN IF (SELECT count(*) FROM ag312_restore)<>16 THEN RAISE EXCEPTION 'AG312_RECOVERY_COHORT_CHANGED'; END IF; END $verify$;
DO $repair$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM ag312_restore LOOP
  PERFORM set_config('app.eval_publication_v309','on',true);
  PERFORM set_config('app.eval_publication_uid_v309',r.unique_id,true);
  PERFORM set_config('gnc.inventory_location_evidence_apply','on',true);
  UPDATE app_sync_private.inventory_location_evidence_v1 SET photo_link=r.photo_link,photo_name=r.photo_name,
    baseline_on_hand=r.on_hand,eval_baseline_available=r.available,loc_match_pct=r.pct,match=r.pct::text,
    initial_photo_match_qty=r.qty,initial_loc_photo_match=r.qty,current_photo_match_qty=r.qty,loc_match_qty=r.qty::text,
    expires_at=r.expires_at,cleared_at=NULL,clear_reason=NULL,updated_at=clock_timestamp(),updated_by='agdata312_calendar_recovery'
    WHERE source_unique_id=r.unique_id;
  UPDATE public.ph_master_inventory SET photos=r.photos,photo_link=r.photo_link,photo_name=r.photo_name,
    photo_url=coalesce(nullif(r.photo_url,''),split_part(r.photo_link,',',1)),photo_date=r.evaluated_at,photo_expires_at=r.expires_at,
    baseline_on_hand=r.on_hand,eval_baseline_available=r.available,loc_match_pct=r.pct,match=r.pct::text,
    initial_photo_match_qty=r.qty,initial_loc_photo_match=r.qty,loc_photo_match=r.qty,loc_match_qty=r.qty::text,
    last_updated=clock_timestamp() WHERE unique_id=r.unique_id;
  UPDATE public.ph_location_sales_notes SET photos=r.photos,photo_link=r.photo_link,photo_name=r.photo_name,
    photo_url=coalesce(nullif(r.photo_url,''),split_part(r.photo_link,',',1)),photo_date=r.evaluated_at,
    eval_baseline_available=r.available,initial_loc_photo_match=r.qty,loc_match_pct=r.pct,loc_photo_match=r.qty,
    updated_at=clock_timestamp() WHERE unique_id=r.unique_id;
 END LOOP;
 PERFORM set_config('app.eval_publication_v309','',true);PERFORM set_config('app.eval_publication_uid_v309','',true);
 PERFORM set_config('gnc.inventory_location_evidence_apply','',true);
END $repair$;
DO $verify$ BEGIN
 IF EXISTS(SELECT 1 FROM ag312_restore r JOIN public.ph_master_inventory m ON m.unique_id=r.unique_id JOIN public.ph_location_sales_notes n ON n.unique_id=r.unique_id JOIN app_sync_private.inventory_location_evidence_v1 e ON e.source_unique_id=r.unique_id WHERE m.photos<>r.photos OR n.photos<>r.photos OR m.loc_photo_match<>r.qty OR n.loc_photo_match<>r.qty OR e.current_photo_match_qty<>r.qty OR m.photo_date<>r.evaluated_at OR e.evaluated_at<>r.evaluated_at OR e.cleared_at IS NOT NULL OR e.expires_at<>r.expires_at) THEN RAISE EXCEPTION 'AG312_RECOVERY_PARITY'; END IF;
 IF (SELECT count(*) FROM public.ph_master_inventory WHERE photos<>'[]'::jsonb AND coalesce(loc_photo_match,0)>0)<>228 THEN RAISE EXCEPTION 'AG312_VALID_COUNT_NOT_228'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_sync_private.inventory_location_evidence_v1 WHERE source_unique_id='008095_250_1-_25-A_07_010-27_F1-SH----1' AND clear_reason='depleted' AND current_photo_match_qty=0) THEN RAISE EXCEPTION 'AG312_DEPLETION_CHANGED'; END IF;
END $verify$;
UPDATE public.app_dataset_revisions SET revision=revision+1,changed_at=clock_timestamp() WHERE key IN ('ph_master_inventory','ph_av_notes');
SELECT jsonb_build_object('restored',16,'valid_photo_rows',(SELECT count(*) FROM public.ph_master_inventory WHERE photos<>'[]'::jsonb AND coalesce(loc_photo_match,0)>0),'original_dates_retained',true,'expiry', (SELECT min(expires_at) FROM ag312_restore),'depleted_excluded',true,'watchdog',(SELECT count(*) FROM public.app_runtime_watchdog_events WHERE status='open')) AS recovery312;
COMMIT;
