BEGIN;
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION test_private.seed_mistake_demo(actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE line public.test_ph_soc_master; child public.test_ph_soc_master; receipt_json jsonb; image_url text:='https://apztnscvagayslumnalr.supabase.co/storage/v1/object/public/farm-operations-staging/demo-fixture/plant-example.webp';
BEGIN
 IF EXISTS(SELECT 1 FROM test_private.bootstrap_receipts WHERE key='workspace-mistake-demo-v1') THEN RETURN;END IF;
 SELECT * INTO line FROM public.test_ph_soc_master WHERE unique_id='TEST-DEMO-SOC-6';IF line.soc_id IS NULL THEN RETURN;END IF;
 IF line.line_status='STAGED_AT_DOCK' AND NOT line.is_pink_tape THEN
  child:=test_private.ops_clone_soc(line,jsonb_build_object('unique_id','TEST-DEMO-SOC-8','soc_id',gen_random_uuid(),'load_id','TEST-DEMO-PARTIAL','tripnumber','TEST-DEMO-PARTIAL','dock','39','dock_num','39','tagcode','4030'));
  UPDATE public.test_ph_dock_drop_status SET dock_bay='39' WHERE load_id=child.load_id;
  receipt_json:=public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','flag_mistake','soc_id',line.soc_id,'type','R-all','quantity',10,'bad_photo',image_url));
  UPDATE test_private.ops_outbox SET status='CANCELLED' WHERE event_key=receipt_json->>'command_id';
 END IF;
 UPDATE public.test_ph_master_inventory SET photo_link=image_url,photo_date=now() WHERE unique_id LIKE 'TEST-DEMO-MASTER-%' AND nullif(photo_link,'') IS NULL;
 INSERT INTO test_private.bootstrap_receipts(key) VALUES('workspace-mistake-demo-v1');
END $$;
REVOKE ALL ON FUNCTION test_private.seed_mistake_demo(uuid) FROM PUBLIC,anon,authenticated;

-- Explicit demonstration rows; an immutable demo_receipt prevents refresh from resetting work.
CREATE OR REPLACE FUNCTION public.test_ops_seed_demos() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE p public.test_profiles; loc text; lot text; n integer; uid text; load text; dock_no text; drop_no integer;
 run text; line public.test_ph_soc_master; drop_id uuid; demo_receipt jsonb;
BEGIN
 p:=test_private.current_profile(); IF p.id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('test:workspace-demo:v1',31));
 IF EXISTS(SELECT 1 FROM test_private.bootstrap_receipts WHERE key='workspace-demo-v1') THEN UPDATE public.test_ph_soc_master SET inventory_master_uid='TEST-DEMO-MASTER-1' WHERE unique_id LIKE 'TEST-DEMO-SOC-%' AND locationcode='F.23.000' AND lotcode='27.F1' AND inventory_master_uid IS NULL;
 PERFORM test_private.seed_mistake_demo(p.id);RETURN jsonb_build_object('ok',true,'seeded',false); END IF;
 IF lower(p.username)<>'dylan_collyge' THEN RAISE EXCEPTION 'TEST_SEED_OWNER_REQUIRED'; END IF;
 INSERT INTO public.test_ph_pullers(puller_id,puller_name,quality_status)
 SELECT lpad(i::text,3,'0'),'Test Puller '||lpad(i::text,3,'0'),(ARRAY['ESP','SP','BLANK'])[1+(i-1)%3] FROM generate_series(1,80)i ON CONFLICT DO NOTHING;
 UPDATE public.test_ph_pullers SET quality_status=(ARRAY['ESP','SP','BLANK'])[1+(puller_id::integer-1)%3]
 WHERE puller_name='Test Puller '||puller_id AND quality_status='BLANK' AND NOT EXISTS(SELECT 1 FROM public.test_ph_order_pulling_teams WHERE active_status AND puller_id IN(driver_puller_id,helper_puller_id));
 INSERT INTO public.test_ph_wingding_units(wingding_id,max_unit_capacity) SELECT i::text,500+floor(random()*201)::integer FROM generate_series(200,240)i ON CONFLICT DO NOTHING;
 UPDATE public.test_ph_wingding_units SET max_unit_capacity=500+floor(random()*201)::integer WHERE max_unit_capacity=600 AND NOT EXISTS(SELECT 1 FROM public.test_ph_order_pulling_teams t WHERE t.wingding_id=test_ph_wingding_units.wingding_id AND active_status);
 FOR n IN 1..11 LOOP
  loc:=(ARRAY['F.23.000','D.20.000','B.15.000','B.32.000','A.2.001','A.10.002','B.1.001','B.2.001','B.3.001','B.4.001','B.5.001'])[n];
  lot:=(ARRAY['27.F1','27.S1','27.F1','27.S1','27.Y','U3','FS','U1','U2','X','F1'])[n];
  INSERT INTO public.test_ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,season,ptronhand,ptravailable,ptrreviewed,warehouseid,source,qualitycode,assignedto,loc_match_qty,spec)
  VALUES('TEST-DEMO-MASTER-'||n,'003085.030.1','Demo · Autumn Fern','3 gal',loc,lot,regexp_replace(lot,'^27\.',''),'1000','1000','100','10','TEST_DEMO','ESP','dylan_collyge','500','Demo 18–24 inch') ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT run_id INTO run FROM public.test_ph_hl_po ORDER BY report_date DESC NULLS LAST,created_at DESC LIMIT 1;
 run:=coalesce(run,'TEST-DEMO-HL');
 FOR n IN 1..2 LOOP
  INSERT INTO public.test_ph_hl_po(unique_id,report_date,source_file_name,run_id,row_index,itemcode,commonname,contsize,locationcode,lotcode,total_quantity_ordered,ptronhand)
  VALUES('TEST-DEMO-HL-'||n,current_date,'Explicit test samples',run,90000+n,CASE WHEN n=1 THEN '003085.030.' ELSE '003085.030.1' END,'Demo · Autumn Fern','3 gal','F.23.000','27.F1',23,1000) ON CONFLICT DO NOTHING;
 END LOOP;
 INSERT INTO public.test_ph_reserves(unique_id,itemcode,commonname,contsize,locationcode,lotcode,quantityordered,quantityshipped,customername)
 VALUES('TEST-DEMO-RESERVE','003085.030.1','Demo · Autumn Fern','3 gal','F.23.000','27.F1','20','0','Demonstration customer') ON CONFLICT DO NOTHING;
 FOR n IN 1..7 LOOP
  load:=(ARRAY['TEST-DEMO-34','TEST-DEMO-34','TEST-DEMO-38','TEST-DEMO-39','TEST-DEMO-52','TEST-DEMO-MISTAKE','TEST-DEMO-COMPLETE'])[n];
  dock_no:=(ARRAY['34','34','38','39','52','38','52'])[n];drop_no:=CASE WHEN n=2 THEN 2 ELSE 1 END;
  INSERT INTO public.test_ph_soc_master(unique_id,soc_id,itemcode,commonname,contsize,locationcode,lotcode,season,load_id,tripnumber,drop_number,stopnumber,dock,dock_num,planstart,ordered_qty,quantityordered,quantityshipped,tagcode,tag_quality,pulled_qty,line_status,warehouseid,customername,consigneename)
  VALUES('TEST-DEMO-SOC-'||n,gen_random_uuid(),'003085.030.1','Demo · Autumn Fern','3 gal','F.23.000','27.F1','F1',load,load,drop_no,drop_no::text,dock_no,dock_no,((current_date-extract(isodow FROM current_date)::integer+1)+(n-1)%5)::text,10,'10','0',CASE WHEN n=3 THEN '4022' ELSE (4022+n)::text END,(ARRAY['ESP','SP','BLANK'])[1+(n-1)%3],CASE WHEN n IN(6,7) THEN 10 ELSE 0 END,CASE WHEN n IN(6,7) THEN 'STAGED_AT_DOCK' ELSE 'PENDING_PULL' END,'10','Demonstration customer','Demonstration destination') ON CONFLICT DO NOTHING;
  UPDATE public.test_ph_dock_drop_status SET dock_bay=dock_no WHERE load_id=load AND drop_number=drop_no;
 END LOOP;
 -- Completed sample uses the same six-stage commands and immutable receipts as the UI.
 SELECT * INTO line FROM public.test_ph_soc_master WHERE unique_id='TEST-DEMO-SOC-7';
 SELECT d.drop_id INTO drop_id FROM public.test_ph_dock_drop_status d WHERE d.load_id=line.load_id AND d.drop_number=line.drop_number;
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','traffic_checkin','load_id',line.load_id,'check_in_status','Trailer','dock','52','driver_name','Demo Driver','seal','DEMO-SEAL'));
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','dock_stage','drop_id',drop_id,'stage','DOCK_STAGING'));
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','dock_stage','drop_id',drop_id,'stage','TAGGING'));
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','tagging_complete','drop_id',drop_id));
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','verify_line','drop_id',drop_id,'soc_id',line.soc_id,'quantity',10));
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','load_drop','drop_id',drop_id));
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','ship_quantity','soc_id',line.soc_id,'quantity',8));
 PERFORM public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','inspector_signoff','drop_id',drop_id,'signature','Demo inspector fixture'));
 demo_receipt:=public.test_ops_command(gen_random_uuid(),jsonb_build_object('action','dispatch','drop_id',drop_id,'driver_signature','Demo driver fixture','seal','DEMO-SEAL'));
 -- Fixture creation must not send mail. Real user actions retain their Dylan-only worker path.
 UPDATE test_private.ops_outbox SET status='CANCELLED' WHERE event_key=demo_receipt->>'command_id';
 INSERT INTO test_private.bootstrap_receipts(key) VALUES('workspace-demo-v1');
 UPDATE public.test_ph_soc_master SET inventory_master_uid='TEST-DEMO-MASTER-1' WHERE unique_id LIKE 'TEST-DEMO-SOC-%' AND locationcode='F.23.000' AND lotcode='27.F1' AND inventory_master_uid IS NULL;
 PERFORM test_private.seed_mistake_demo(p.id);
 RETURN jsonb_build_object('ok',true,'seeded',true,'pullers',80,'units',41,'demo_lines',7);
END $$;
REVOKE ALL ON FUNCTION public.test_ops_seed_demos() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.test_ops_seed_demos() TO authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM test_private.bootstrap_receipts WHERE key='workspace-shared-suspend-v1') THEN
  UPDATE public.test_ph_soc_master SET suspend='SUSPEND',suspend_to='DC' WHERE unique_id LIKE 'TEST-DEMO-SOC-%' AND dock IN('38','39') AND line_status NOT IN('SHIPPED','SUPERSEDED','COMPLETE_TAG');
  INSERT INTO test_private.bootstrap_receipts(key) VALUES('workspace-shared-suspend-v1');
 END IF;
END $$;
COMMIT;
