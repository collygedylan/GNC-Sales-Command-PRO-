begin;
set local lock_timeout='1500ms';
set local statement_timeout='120s';
ALTER TABLE public.ph_prod_schedule_active ADD COLUMN IF NOT EXISTS location_shield jsonb NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS target_allocations jsonb NOT NULL DEFAULT '[]';
CREATE OR REPLACE FUNCTION private.nursery_block_v23127(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT upper(m[1])||'.'||lpad((m[2]::integer)::text,2,'0')||'.000' FROM regexp_matches(coalesce(value,''),'\m([A-L])\.?0*([0-9]{1,2})\y','i') m WHERE m[2]::integer BETWEEN 1 AND 26 LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.nursery_block_v23127(text) FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS ph_nursery_water_genus_v23127 ON public.ph_nursery_water_rating(upper(genus));
CREATE OR REPLACE FUNCTION private.resolve_nursery_schedule_locations_v23127() RETURNS integer
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE scheduled record; candidate record; cell jsonb; chosen_location text; candidates jsonb; allocations jsonb; tier integer; selected_tier integer; label text; zone text; crop_genus text; shade_required boolean; cpb_value numeric; total_beds numeric; total_weight numeric; allocated_qty numeric; allocated_beds numeric; part_qty numeric; part_beds numeric; count_parts integer; part_index integer; resolved integer:=0;
BEGIN
 CREATE TEMP TABLE nursery_rotation_v23127 ON COMMIT DROP AS
 SELECT i.itemcode,private.nursery_block_v23127(i.locationcode) location_code,
 upper(coalesce(nullif(to_jsonb(i)->>'genusname',''),nullif(to_jsonb(i)->>'genus',''),split_part(coalesce(i.botanicalname,''),' ',1))) genus,
 coalesce(i.season,'')||' '||coalesce(i.lotcode,'') ~* 'Y' is_y,
 greatest(0,coalesce(nullif(regexp_replace(i.ptronhand::text,'[^0-9.-]','','g'),''),'0')::numeric) quantity,w.hydro_zone
 FROM public.ph_master_inventory i LEFT JOIN LATERAL (SELECT water.hydro_zone FROM public.ph_nursery_water_rating water WHERE private.nursery_name_key_v23127(water.common_name)=private.nursery_name_key_v23127(i.commonname) OR upper(water.genus)=upper(coalesce(nullif(to_jsonb(i)->>'genusname',''),nullif(to_jsonb(i)->>'genus',''),split_part(coalesce(i.botanicalname,''),' ',1))) ORDER BY (private.nursery_name_key_v23127(water.common_name)=private.nursery_name_key_v23127(i.commonname)) DESC,water.id LIMIT 1) w ON true
 WHERE position('10' IN coalesce(nullif(i.warehousei::text,''),i.warehouseid::text,''))>0;
 CREATE INDEX ON nursery_rotation_v23127(itemcode,location_code);CREATE INDEX ON nursery_rotation_v23127(genus,hydro_zone,location_code);
 FOR scheduled IN SELECT * FROM public.ph_prod_schedule_active ORDER BY plant_date,line_id,id LOOP
  IF coalesce(scheduled.planned_qty,0)<=0 OR btrim(coalesce(scheduled.source,''))='>' THEN CONTINUE;END IF;
  SELECT coalesce(nullif(scheduled.cpb,0),(SELECT c.cpb FROM public.ph_nursery_items_cpb c WHERE c.itemcode=scheduled.itemcode AND c.cpb>0),('{"100":72,"111":944,"150":50,"250":32,"450":16,"920":516,"000":320,"007":3360,"008":728,"010":944,"011":944,"013":976,"0150":50,"016":540,"019":180,"020":516,"021":516,"022":248,"027":320,"028":540,"030":320,"031":320,"033":141,"050":176,"051":220,"055":120,"060":248,"061":100,"070":120,"071":120,"077":1544,"079":1544,"081":728,"083":333}'::jsonb->>split_part(scheduled.itemcode,'.',2))::numeric) INTO cpb_value;
  total_beds:=CASE WHEN cpb_value>0 THEN round(scheduled.planned_qty/cpb_value,2) ELSE NULL END;candidates:='[]';selected_tier:=0;
  FOR tier IN 1..3 LOOP
   FOR cell IN SELECT value FROM jsonb_array_elements(coalesce(scheduled.location_shield->'tier_cells'->(tier-1),jsonb_build_array(coalesce(scheduled.location_shield->'tiers'->(tier-1),'[]')))) LOOP
   SELECT coalesce(jsonb_agg(jsonb_build_object('location',l.location_code,'weight',greatest(0.000001,coalesce((entry->>'weight')::numeric,1))) ORDER BY ordinal),'[]') INTO candidates FROM jsonb_array_elements(cell) WITH ORDINALITY e(entry,ordinal) JOIN public.ph_nursery_locations l ON l.location_code=private.nursery_block_v23127(entry->>'location');
   IF jsonb_array_length(candidates)>0 THEN selected_tier:=tier;EXIT;END IF;
   END LOOP;
   IF selected_tier>0 THEN EXIT;END IF;
  END LOOP;
  IF selected_tier=0 THEN
   selected_tier:=4;chosen_location:=NULL;
   IF EXISTS(SELECT 1 FROM pg_temp.nursery_rotation_v23127 r WHERE r.itemcode=scheduled.itemcode) THEN
    SELECT r.location_code INTO chosen_location FROM pg_temp.nursery_rotation_v23127 r JOIN public.ph_nursery_locations l USING(location_code) WHERE r.itemcode=scheduled.itemcode AND NOT r.is_y GROUP BY r.location_code ORDER BY sum(r.quantity) DESC,r.location_code LIMIT 1;
   ELSE
    SELECT water.hydro_zone,upper(coalesce(nullif(scheduled.location_shield->>'genus',''),water.genus)) INTO zone,crop_genus FROM public.ph_nursery_water_rating water WHERE private.nursery_name_key_v23127(water.common_name)=private.nursery_name_key_v23127(scheduled.commonname) OR upper(water.genus)=upper(scheduled.location_shield->>'genus') ORDER BY (private.nursery_name_key_v23127(water.common_name)=private.nursery_name_key_v23127(scheduled.commonname)) DESC,water.id LIMIT 1;
    shade_required:=coalesce(crop_genus,'')||' '||coalesce(scheduled.commonname,'') ~* 'CAMELLIA|AUCUBA|RHODODENDRON|AZALEA|HOSTA|FERN|ATHYRIUM|DRYOPTERIS|LEUCOTHOE';
    SELECT r.location_code INTO chosen_location FROM pg_temp.nursery_rotation_v23127 r JOIN public.ph_nursery_locations l USING(location_code) WHERE NOT r.is_y AND r.genus=crop_genus AND r.hydro_zone=zone AND (NOT shade_required OR l.permanent_shade='Y') GROUP BY r.location_code ORDER BY sum(r.quantity) DESC,r.location_code LIMIT 1;
   END IF;
   IF chosen_location IS NOT NULL THEN candidates:=jsonb_build_array(jsonb_build_object('location',chosen_location,'weight',1));END IF;
  END IF;
  label:=CASE selected_tier WHEN 1 THEN 'Tier 1 (Confirmed 2027 Sch — WH 10)' WHEN 2 THEN 'Tier 2 (2026 Historical Block — WH 10)' WHEN 3 THEN 'Tier 3 (2025 Historical Block — WH 10)' ELSE 'Tier 4 (27.F1/SY27 Block Rotation — WH 10)' END;
  allocations:='[]';allocated_qty:=0;allocated_beds:=0;part_index:=0;count_parts:=jsonb_array_length(candidates);SELECT sum((entry->>'weight')::numeric) INTO total_weight FROM jsonb_array_elements(candidates) e(entry);
  FOR candidate IN SELECT entry FROM jsonb_array_elements(candidates) e(entry) LOOP
   part_index:=part_index+1;part_qty:=CASE WHEN part_index=count_parts THEN round(scheduled.planned_qty-allocated_qty,2) ELSE round(scheduled.planned_qty*(candidate.entry->>'weight')::numeric/total_weight,2) END;
   part_beds:=CASE WHEN total_beds IS NULL THEN NULL WHEN part_index=count_parts THEN round(total_beds-allocated_beds,2) ELSE round(total_beds*(candidate.entry->>'weight')::numeric/total_weight,2) END;
   allocated_qty:=allocated_qty+part_qty;allocated_beds:=allocated_beds+coalesce(part_beds,0);allocations:=allocations||jsonb_build_array(jsonb_build_object('location',candidate.entry->>'location','qty',part_qty,'beds',part_beds,'tier',label));
  END LOOP;
  UPDATE public.ph_prod_schedule_active SET cpb=cpb_value,beds_needed=total_beds,target_loc=coalesce(allocations->0->>'location',''),tier_label=label||CASE WHEN count_parts=0 THEN ' — HOLD: no matching block' ELSE '' END,target_allocations=allocations WHERE id=scheduled.id;
  IF count_parts>0 THEN resolved:=resolved+1;END IF;
 END LOOP;RETURN resolved;
END $$;
REVOKE ALL ON FUNCTION private.resolve_nursery_schedule_locations_v23127() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.nursery_schedule_import_v23127(p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
<<nursery_import>>
DECLARE file_key text:=p_payload->>'fileKey'; receipt private.nursery_schedule_imports_v23127; row_count integer; slice_offset integer; next_offset integer;
BEGIN
 IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'NURSERY_IMPORT_SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 IF file_key IS NULL OR length(file_key)>300 OR octet_length(p_payload::text)>67108864 THEN RAISE EXCEPTION 'NURSERY_IMPORT_INVALID' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('nursery-import:'||file_key,0));
 SELECT * INTO receipt FROM private.nursery_schedule_imports_v23127 i WHERE i.file_key=nursery_import.file_key FOR UPDATE;
 IF p_operation='status' THEN RETURN jsonb_build_object('published',coalesce(receipt.published,false),'rows',coalesce(receipt.rows_published,0));END IF;
 IF receipt.published THEN RETURN jsonb_build_object('published',true,'rows',receipt.rows_published);END IF;
 IF p_operation='append' THEN
  slice_offset:=(p_payload->>'offset')::integer;next_offset:=(p_payload->>'nextOffset')::integer;
  IF slice_offset<0 OR next_offset<slice_offset OR next_offset-slice_offset>1500 OR jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows')>1500 THEN RAISE EXCEPTION 'NURSERY_SLICE_INVALID' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'rows') r WHERE position('10' IN coalesce(r->>'_warehouse',''))=0 OR coalesce(r->>'itemcode','')!~'^[0-9]{4,}\.[0-9A-Za-z]+\.[0-9A-Za-z]+$' OR coalesce((r->>'planned_qty')::numeric,0)<=0 OR btrim(coalesce(r->>'source',''))='>') THEN RAISE EXCEPTION 'NURSERY_WAREHOUSE_INVALID' USING ERRCODE='22023';END IF;
  IF receipt.file_key IS NULL THEN
   IF slice_offset<>0 THEN RAISE EXCEPTION 'NURSERY_SLICE_GAP' USING ERRCODE='40001';END IF;
   INSERT INTO private.nursery_schedule_imports_v23127(file_key,file_name,headers) VALUES(file_key,coalesce(p_payload->>'fileName',''),coalesce(p_payload->'headers','[]')) RETURNING * INTO receipt;
  END IF;
  IF receipt.next_offset>slice_offset THEN RETURN jsonb_build_object('nextOffset',receipt.next_offset);END IF;
  IF receipt.next_offset<>slice_offset THEN RAISE EXCEPTION 'NURSERY_SLICE_GAP' USING ERRCODE='40001';END IF;
  INSERT INTO private.nursery_schedule_stage_v23127(file_key,slice_offset,row_number,payload) SELECT file_key,slice_offset,ordinality::integer,value-'_warehouse' FROM jsonb_array_elements(p_payload->'rows') WITH ORDINALITY;
  UPDATE private.nursery_schedule_imports_v23127 i SET next_offset=nursery_import.next_offset,complete=coalesce((p_payload->>'done')::boolean,false),updated_at=clock_timestamp() WHERE i.file_key=nursery_import.file_key;
  RETURN jsonb_build_object('nextOffset',next_offset);
 END IF;
 IF p_operation IS DISTINCT FROM 'publish' OR NOT coalesce(receipt.complete,false) THEN RAISE EXCEPTION 'NURSERY_IMPORT_NOT_COMPLETE' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO row_count FROM private.nursery_schedule_stage_v23127 s WHERE s.file_key=nursery_import.file_key;
 IF row_count=0 THEN RAISE EXCEPTION 'NURSERY_IMPORT_NO_PARK_HILL_ROWS' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('nursery-active-publication',0));
 DELETE FROM public.ph_prod_schedule_active;
 INSERT INTO public.ph_prod_schedule_active(source_tab_name,line_id,itemcode,commonname,contsize,source,planned_qty,req_qty,cutoff_qty,cpb,beds_needed,target_loc,tier_label,plant_date,can_fill_date,staged_from,location_shield)
 SELECT r.source_tab_name,r.line_id,r.itemcode,r.commonname,r.contsize,r.source,r.planned_qty,r.req_qty,r.cutoff_qty,coalesce(nullif(r.cpb,0),c.cpb),CASE WHEN coalesce(nullif(r.cpb,0),c.cpb)>0 THEN round(r.planned_qty/coalesce(nullif(r.cpb,0),c.cpb),2) ELSE r.beds_needed END,r.target_loc,r.tier_label,r.plant_date,r.can_fill_date,r.staged_from,coalesce(r.location_shield,'{}')
 FROM private.nursery_schedule_stage_v23127 s CROSS JOIN LATERAL jsonb_populate_record(NULL::public.ph_prod_schedule_active,s.payload) r LEFT JOIN public.ph_nursery_items_cpb c ON c.itemcode=r.itemcode WHERE s.file_key=nursery_import.file_key ORDER BY s.slice_offset,s.row_number;
 PERFORM private.resolve_nursery_schedule_locations_v23127();
 DELETE FROM public.ph_header_control WHERE source_tab='PROD SCHEDULE 102726 (2026-10-29_1232)';
 INSERT INTO public.ph_header_control(source_tab,col_letter,col_index,raw_header_text,live_sample_values,assigned_category_dropdown,standardized_field_name,managing_gem)
 SELECT source_tab,col_letter,col_index,raw_header_text,live_sample_values,assigned_category_dropdown,standardized_field_name,managing_gem FROM jsonb_populate_recordset(NULL::public.ph_header_control,receipt.headers);
 UPDATE private.nursery_schedule_imports_v23127 i SET published=true,rows_published=row_count,updated_at=clock_timestamp() WHERE i.file_key=nursery_import.file_key;
 DELETE FROM private.nursery_schedule_stage_v23127 s WHERE s.file_key=nursery_import.file_key;
 RETURN jsonb_build_object('published',true,'rows',row_count);
END $$;
REVOKE ALL ON FUNCTION public.nursery_schedule_import_v23127(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nursery_schedule_import_v23127(text,jsonb) TO service_role;

commit;
