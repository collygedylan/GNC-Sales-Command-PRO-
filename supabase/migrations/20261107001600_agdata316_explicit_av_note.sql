BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='45s';
-- Acquire the existing revision owner before the physical row; avoid the inverse live-sync lock order.
SELECT key FROM public.app_dataset_revisions WHERE key='ph_master_inventory' FOR UPDATE;

CREATE OR REPLACE FUNCTION private.set_explicit_av_note_v316(payload jsonb, row_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE master_uid text:=coalesce(nullif(row_data->>'master_id',''),nullif(row_data->>'master_unique_id',''),nullif(row_data->>'master_uid',''),CASE WHEN row_data?'ptronhand' THEN row_data->>'unique_id' END);
BEGIN
 IF payload->'explicit_av_note'='true'::jsonb AND payload?'av_note' THEN
  IF jsonb_typeof(payload->'av_note') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'EXPLICIT_AV_NOTE_MUST_BE_TEXT' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(row_data->>'itemcode'),'') IS NULL OR nullif(btrim(row_data->>'locationcode'),'') IS NULL THEN RAISE EXCEPTION 'EXPLICIT_AV_NOTE_IDENTITY_REQUIRED' USING ERRCODE='22023'; END IF;
  PERFORM set_config('app.explicit_av_note_v316',jsonb_build_object('row_uid',row_data->>'unique_id','master_uid',master_uid,'itemcode',upper(btrim(row_data->>'itemcode')),'locationcode',upper(btrim(row_data->>'locationcode')),'lotcode',upper(btrim(coalesce(row_data->>'lotcode',''))),'av_note',payload->'av_note')::text,true);
 END IF;
END $fn$;
CREATE OR REPLACE FUNCTION private.explicit_av_note_for_row_v316(row_data jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE context jsonb:=coalesce(nullif(current_setting('app.explicit_av_note_v316',true),''),'{}')::jsonb;
BEGIN
 IF context?'av_note' AND upper(btrim(coalesce(row_data->>'itemcode','')))=context->>'itemcode' AND upper(btrim(coalesce(row_data->>'locationcode','')))=context->>'locationcode' AND upper(btrim(coalesce(row_data->>'lotcode','')))=context->>'lotcode'
 AND (row_data->>'unique_id'=context->>'row_uid' OR row_data->>'unique_id'=context->>'master_uid' OR nullif(row_data->>'master_id','')=context->>'master_uid') THEN RETURN jsonb_build_object('av_note',context->'av_note'); END IF;
 RETURN '{}'::jsonb;
END $fn$;
REVOKE ALL ON FUNCTION private.set_explicit_av_note_v316(jsonb,jsonb),private.explicit_av_note_for_row_v316(jsonb) FROM PUBLIC,anon,authenticated;

DO $patch$ DECLARE definition text:=pg_get_functiondef('private.protect_eval_data_from_blank_overwrite_v309'::regproc); BEGIN
 IF md5(definition)='323db37db00a5166a8a3c2258a88afea' THEN RETURN; END IF;
 IF md5(definition)<>'d0df7facab1828b6b5622fec6ed41b07' THEN RAISE EXCEPTION 'v316 installed definition changed: private.protect_eval_data_from_blank_overwrite_v309'; END IF;
 definition:=replace(definition,$before$BEGIN
$before$,$after$BEGIN
 incoming:=incoming||private.explicit_av_note_for_row_v316(incoming);
 new:=jsonb_populate_record(new,incoming);
$after$);
 definition:=replace(definition,$before$  IF allow_photo_clear AND k IN ($before$,$after$  IF k='av_note' AND private.explicit_av_note_for_row_v316(incoming)?'av_note' THEN CONTINUE; END IF;
  IF allow_photo_clear AND k IN ($after$);
 IF md5(definition)<>'323db37db00a5166a8a3c2258a88afea' THEN RAISE EXCEPTION 'v316 replacement mismatch: private.protect_eval_data_from_blank_overwrite_v309'; END IF;
 EXECUTE definition;
END $patch$;

DO $patch$ DECLARE definition text:=pg_get_functiondef('public.save_drive_evidence_v3'::regproc); BEGIN
 IF md5(definition)='08e011d625daec7f2a05229eb55e8185' THEN RETURN; END IF;
 IF md5(definition)<>'a9cb6b2cae9128bb86f8bc3316300480' THEN RAISE EXCEPTION 'v316 installed definition changed: public.save_drive_evidence_v3'; END IF;
 definition:=replace(definition,$before$payload:=payload-'force_clear_photos';$before$,$after$payload:=payload-'force_clear_photos'-'explicit_av_note';$after$);
 definition:=replace(definition,$before$  -- v3.0.8: the authorized editor can complete again with optional evidence.$before$,$after$  PERFORM private.set_explicit_av_note_v316(p_evidence,to_jsonb(current_row));
  -- v3.0.8: the authorized editor can complete again with optional evidence.$after$);
 definition:=replace(definition,$before$payload::text,coalesce(p_complete,false)::text$before$,$after$payload::text,coalesce(p_evidence->>'explicit_av_note','false'),coalesce(p_complete,false)::text$after$);
 IF md5(definition)<>'08e011d625daec7f2a05229eb55e8185' THEN RAISE EXCEPTION 'v316 replacement mismatch: public.save_drive_evidence_v3'; END IF;
 EXECUTE definition;
END $patch$;

DO $patch$ DECLARE definition text:=pg_get_functiondef('public.save_request_work_v1_pre_state_machine_v2359'::regproc); BEGIN
 IF md5(definition)='ec9605f833291abac6cf20ab40c82142' THEN RETURN; END IF;
 IF md5(definition)<>'4612fb49076d0b7257a27c4573310d04' THEN RAISE EXCEPTION 'v316 installed definition changed: public.save_request_work_v1_pre_state_machine_v2359'; END IF;
 definition:=replace(definition,$before$  patch:=patch-'force_clear_photos';$before$,$after$  PERFORM private.set_explicit_av_note_v316(patch,to_jsonb(existing)||jsonb_build_object('master_uid',private.eval_master_uid_v309(to_jsonb(existing))));
  patch:=patch-'force_clear_photos'-'explicit_av_note';$after$);
 IF md5(definition)<>'ec9605f833291abac6cf20ab40c82142' THEN RAISE EXCEPTION 'v316 replacement mismatch: public.save_request_work_v1_pre_state_machine_v2359'; END IF;
 EXECUTE definition;
END $patch$;

DO $patch$ DECLARE definition text:=pg_get_functiondef('public.request_work_command_v1_pre_state_machine_v2359'::regproc); BEGIN
 IF md5(definition)='55eacc48a0991334fbba10d0974eb061' THEN RETURN; END IF;
 IF md5(definition)<>'9f39f15ad2a3aed659be17d5c8213a62' THEN RAISE EXCEPTION 'v316 installed definition changed: public.request_work_command_v1_pre_state_machine_v2359'; END IF;
 definition:=replace(definition,$before$k not in ('force_clear_photos'$before$,$after$k not in ('explicit_av_note','force_clear_photos'$after$);
 IF md5(definition)<>'55eacc48a0991334fbba10d0974eb061' THEN RAISE EXCEPTION 'v316 replacement mismatch: public.request_work_command_v1_pre_state_machine_v2359'; END IF;
 EXECUTE definition;
END $patch$;

DO $patch$ DECLARE definition text:=pg_get_functiondef('suspend_tag_private.command'::regproc); BEGIN
 IF md5(definition)='b009f320f98a9334492fa98606c18042' THEN RETURN; END IF;
 IF md5(definition)<>'ae786dc9c2da29972d5ef95c84f8af2b' THEN RAISE EXCEPTION 'v316 installed definition changed: suspend_tag_private.command'; END IF;
 definition:=replace(definition,$before$array['force_clear_photos'$before$,$after$array['explicit_av_note','force_clear_photos'$after$);
 definition:=replace(definition,$before$      patch:=patch-'force_clear_photos';$before$,$after$      PERFORM private.set_explicit_av_note_v316(patch,to_jsonb(s));
      patch:=patch-'force_clear_photos'-'explicit_av_note';$after$);
 IF md5(definition)<>'b009f320f98a9334492fa98606c18042' THEN RAISE EXCEPTION 'v316 replacement mismatch: suspend_tag_private.command'; END IF;
 EXECUTE definition;
END $patch$;

DO $patch$ DECLARE definition text:=pg_get_functiondef('private.publish_queue_evaluation_v309'::regproc); BEGIN
 IF md5(definition)='a44df710dbf392a2611af0ea5df24693' THEN RETURN; END IF;
 IF md5(definition)<>'512cf05b73da3849f7238ebc2f972380' THEN RAISE EXCEPTION 'v316 installed definition changed: private.publish_queue_evaluation_v309'; END IF;
 definition:=replace(definition,$before$ IF m.unique_id IS NULL THEN RETURN; END IF;$before$,$after$ IF m.unique_id IS NULL THEN RETURN; END IF;
 e:=e||private.explicit_av_note_for_row_v316(to_jsonb(m));$after$);
 IF md5(definition)<>'a44df710dbf392a2611af0ea5df24693' THEN RAISE EXCEPTION 'v316 replacement mismatch: private.publish_queue_evaluation_v309'; END IF;
 EXECUTE definition;
END $patch$;

DO $patch$ DECLARE definition text:=pg_get_functiondef('suspend_tag_private.publish_inventory_evidence_v23119'::regproc); BEGIN
 IF md5(definition)='0d5caf3c2ee9f4e331c8ff6407b7dc8f' THEN RETURN; END IF;
 IF md5(definition)<>'7870ee99eaea67665f4527633a3ea96b' THEN RAISE EXCEPTION 'v316 installed definition changed: suspend_tag_private.publish_inventory_evidence_v23119'; END IF;
 definition:=replace(definition,$before$  IF m.unique_id IS NOT NULL AND evidence<>'{}' THEN$before$,$after$  IF private.explicit_av_note_for_row_v316(to_jsonb(s))?'av_note' THEN evidence:=evidence||private.explicit_av_note_for_row_v316(to_jsonb(s))||jsonb_build_object('explicit_av_note',true); END IF;
  IF m.unique_id IS NOT NULL AND evidence<>'{}' THEN$after$);
 IF md5(definition)<>'0d5caf3c2ee9f4e331c8ff6407b7dc8f' THEN RAISE EXCEPTION 'v316 replacement mismatch: suspend_tag_private.publish_inventory_evidence_v23119'; END IF;
 EXECUTE definition;
END $patch$;

-- Repair the explicitly named physical LD row; the distinct SH stock row stays separate.
DO $repair$ DECLARE r public.ph_master_inventory; previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),''); BEGIN
 SELECT * INTO STRICT r FROM public.ph_master_inventory WHERE unique_id='drive-03695daa254c39fd89a7a4d1a940e3e9' AND itemcode='008737.031.1' AND locationcode='D.17.000' AND lotcode='27.S1' AND source='LD' FOR UPDATE;
 PERFORM private.set_explicit_av_note_v316(jsonb_build_object('explicit_av_note',true,'av_note','SPEC - 12-14" H'),to_jsonb(r));
 PERFORM set_config('gnc.inventory_location_evidence_apply','on',true);
 UPDATE public.ph_master_inventory SET spec='12-14" H',av_note='SPEC - 12-14" H' WHERE unique_id=r.unique_id;
 UPDATE public.ph_location_sales_notes SET spec='12-14" H',av_note='SPEC - 12-14" H' WHERE unique_id=r.unique_id AND itemcode=r.itemcode AND locationcode=r.locationcode AND lotcode=r.lotcode;
 IF NOT FOUND THEN RAISE EXCEPTION 'v316 exact location note missing'; END IF;
 UPDATE app_sync_private.inventory_location_evidence_v1 SET spec='12-14" H',av_note='SPEC - 12-14" H' WHERE source_unique_id=r.unique_id;
 PERFORM set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
 PERFORM set_config('app.explicit_av_note_v316','',true);
END $repair$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261107001600','agdata316_explicit_av_note',ARRAY['Scoped explicit AV Note protocol and exact LD note repair']) ON CONFLICT(version) DO NOTHING;
COMMIT;
