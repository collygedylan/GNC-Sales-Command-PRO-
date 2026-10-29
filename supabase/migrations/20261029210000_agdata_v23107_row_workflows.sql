-- AgData v2.3.107: exact-source edits remain available across import/review churn.
-- No anonymous mutation grants, email sends, bulk inventory triggers or history changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE FUNCTION suspend_tag_private.resolve_edit_source_v23107(p_payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE uid text; candidates text[]; identity jsonb:=p_payload->'sourceIdentity';
BEGIN
 SELECT unique_id INTO uid FROM public.ph_soc_master WHERE unique_id=p_payload->>'sourceUid' AND suspend_tag_private.eligible(suspend,suspend_to);
 IF uid IS NOT NULL THEN RETURN uid; END IF;
 IF jsonb_typeof(identity)<>'object' OR nullif(identity->>'dock','') IS NULL OR nullif(identity->>'stopnumber','') IS NULL OR nullif(identity->>'itemcode','') IS NULL OR nullif(identity->>'consignee','') IS NULL THEN
   RAISE EXCEPTION 'SUSPEND_TAG_SOURCE_MISSING'; END IF;
 SELECT array_agg(r.unique_id) INTO candidates FROM public.ph_soc_master r
 WHERE suspend_tag_private.eligible(r.suspend,r.suspend_to)
 AND upper(btrim(r.dock))=upper(btrim(identity->>'dock'))
 AND upper(btrim(r.stopnumber))=upper(btrim(identity->>'stopnumber'))
 AND regexp_replace(rtrim(upper(r.itemcode),'.'),'[.]1$','')=regexp_replace(rtrim(upper(identity->>'itemcode'),'.'),'[.]1$','')
 AND upper(btrim(identity->>'consignee')) IN (upper(btrim(coalesce(r.consigneeidentityid,''))),upper(btrim(coalesce(r.consigneename,''))))
 AND (nullif(identity->>'transactionnumber','') IS NULL OR upper(btrim(r.transactionnumber))=upper(btrim(identity->>'transactionnumber')))
 AND (nullif(identity->>'tagcode','') IS NULL OR upper(btrim(r.tagcode))=upper(btrim(identity->>'tagcode')));
 IF coalesce(cardinality(candidates),0)=0 THEN RAISE EXCEPTION 'SUSPEND_TAG_SOURCE_MISSING'; END IF;
 IF cardinality(candidates)<>1 THEN RAISE EXCEPTION 'SUSPEND_TAG_SOURCE_AMBIGUOUS'; END IF;
 RETURN candidates[1];
END $body$;
REVOKE ALL ON FUNCTION suspend_tag_private.resolve_edit_source_v23107(jsonb) FROM PUBLIC,anon,authenticated;

DO $patch$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure) INTO definition;
 IF position('resolve_edit_source_v23107' in definition)=0 THEN
 IF position($old$if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then$old$,$new$if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER') then$new$);
 IF position($old$uid:=p_payload->>'sourceUid';$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$uid:=p_payload->>'sourceUid';$old$,$new$uid:=case when p_operation in ('save','complete') then suspend_tag_private.resolve_edit_source_v23107(p_payload) else p_payload->>'sourceUid' end;$new$);
 IF position($old$if not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz then$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$if not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz then$old$,$new$if p_operation not in ('save','complete') and (not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz) then$new$);
 IF position($old$if p_expected_version is not null and w.version<>p_expected_version then$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$if p_expected_version is not null and w.version<>p_expected_version then$old$,$new$if p_operation not in ('save','complete') and p_expected_version is not null and w.version<>p_expected_version then$new$);
 IF position($old$if w.status in ('awaiting_rep','approved') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$if w.status in ('awaiting_rep','approved') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;$old$,$new$if w.status in ('awaiting_rep','approved') then
        update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
        update suspend_tag_private.workflows set status='pending',current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
      end if;$new$);
 IF position($old$edited:=jsonb_populate_record(s,patch);$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$edited:=jsonb_populate_record(s,patch);$old$,$new$-- Preserve concurrent photos while allowing field edits on the latest locked source.
      if patch ? 'dock_photo_link' then
        patch:=jsonb_set(patch,'{dock_photo_link}',to_jsonb(coalesce((select string_agg(distinct btrim(link),',') from unnest(string_to_array(concat_ws(',',nullif(s.dock_photo_link,''),nullif(patch->>'dock_photo_link','')),',')) link where btrim(link)<>''),'')),true);
      end if;
      edited:=jsonb_populate_record(s,patch);$new$);
 IF position($old$and ((s.suspend_candidate_group is null and sibling.suspend_candidate_group is null)
          or (sibling.locationcode=s.locationcode and coalesce(sibling.lotcode,'')=coalesce(s.lotcode,'')))$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$and ((s.suspend_candidate_group is null and sibling.suspend_candidate_group is null)
          or (sibling.locationcode=s.locationcode and coalesce(sibling.lotcode,'')=coalesce(s.lotcode,'')))$old$,$new$and sibling.locationcode=s.locationcode and coalesce(sibling.lotcode,'')=coalesce(s.lotcode,'') and coalesce(sibling.source,'')=coalesce(s.source,'')$new$);
 IF position($old$where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'')$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 command anchor missing'; END IF;
 definition:=replace(definition,$old$where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'')$old$,$new$where m.unique_id=(select candidate.unique_id from public.ph_master_inventory candidate
          where regexp_replace(rtrim(upper(candidate.itemcode),'.'),'[.]1$','')=regexp_replace(rtrim(upper(s.itemcode),'.'),'[.]1$','')
            and candidate.locationcode=s.locationcode and not suspend_tag_private.is_false_block_v2378(candidate.locationcode)
            and (nullif(p_payload->'sourceIdentity'->>'masterUid','') is null or candidate.unique_id=p_payload->'sourceIdentity'->>'masterUid')
            and (upper(coalesce(s.source,'')) not in ('SH','LD') or upper(candidate.source)=upper(s.source))
          order by (coalesce(candidate.lotcode,'')=coalesce(s.lotcode,'')) desc,
            private.reclass_numeric_v1(candidate.ptronhand) desc nulls last,candidate.unique_id limit 1)$new$);
 EXECUTE definition;
 END IF; END $patch$;

DO $patch$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure) INTO definition;
 IF position('resolve_edit_source_v23107' in definition)=0 THEN
 IF position($old$uid:=p_payload->>'sourceUid';$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 group_command anchor missing'; END IF;
 definition:=replace(definition,$old$uid:=p_payload->>'sourceUid';$old$,$new$uid:=case when p_operation='add_candidates' then suspend_tag_private.resolve_edit_source_v23107(p_payload) else p_payload->>'sourceUid' end;$new$);
 IF position($old$if p_operation<>'close' and (not (p_payload ? 'expectedLastUpdated')$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 group_command anchor missing'; END IF;
 definition:=replace(definition,$old$if p_operation<>'close' and (not (p_payload ? 'expectedLastUpdated')$old$,$new$if p_operation not in ('close','add_candidates') and (not (p_payload ? 'expectedLastUpdated')$new$);
 IF position($old$if p_expected_version is not null and coalesce(w.version,0)<>p_expected_version then$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 group_command anchor missing'; END IF;
 definition:=replace(definition,$old$if p_expected_version is not null and coalesce(w.version,0)<>p_expected_version then$old$,$new$if p_operation<>'add_candidates' and p_expected_version is not null and coalesce(w.version,0)<>p_expected_version then$new$);
 IF position($old$if s.suspend_candidate_state in ('approved','denied','canceled','replaced') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 group_command anchor missing'; END IF;
 definition:=replace(definition,$old$if s.suspend_candidate_state in ('approved','denied','canceled','replaced') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;$old$,$new$-- Authorized additions begin a fresh round; prior frozen approval snapshots remain immutable.$new$);
 IF position($old$m.itemcode<>s.itemcode$old$ in definition)=0 THEN RAISE EXCEPTION 'v23107 group_command anchor missing'; END IF;
 definition:=replace(definition,$old$m.itemcode<>s.itemcode$old$,$new$regexp_replace(rtrim(upper(m.itemcode),'.'),'[.]1$','')<>regexp_replace(rtrim(upper(s.itemcode),'.'),'[.]1$','')$new$);
 EXECUTE definition;
 END IF; END $patch$;


-- Atomic, idempotent Bloom project creation; details use the existing JSON snapshot contract.
CREATE OR REPLACE FUNCTION public.create_inventory_project_v1(p_actor_id uuid,p_project_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE actor public.profiles; project public.inventory_projects; row_value jsonb; grader text;
  fingerprint text:=md5(p_payload::text); rep text:=btrim(p_payload->>'salesrep'); customer text:=btrim(p_payload->>'customername'); consignee text:=btrim(p_payload->>'consigneename');
BEGIN
 IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'PROJECT_SERVICE_REQUIRED' USING errcode='42501'; END IF;
 SELECT * INTO actor FROM public.profiles WHERE id=p_actor_id AND disabled_at IS NULL AND (locked_until IS NULL OR locked_until<now());
 IF actor.id IS NULL OR regexp_replace(upper(actor.role),'[^A-Z]','','g')='SALESREP' THEN RAISE EXCEPTION 'PROJECT_FORBIDDEN' USING errcode='42501'; END IF;
 IF p_project_id IS NULL OR jsonb_typeof(p_payload->'rows')<>'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 100
   OR nullif(btrim(p_payload->>'projectName'),'') IS NULL OR rep IS NULL OR customer IS NULL OR consignee IS NULL THEN RAISE EXCEPTION 'PROJECT_FIELDS_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bloom-project:'||p_project_id,0));
 SELECT * INTO project FROM public.inventory_projects WHERE id=p_project_id;
 IF project.id IS NOT NULL THEN
   IF project.created_by<>actor.username OR EXISTS(SELECT 1 FROM public.inventory_project_rows WHERE project_id=p_project_id AND snapshot_metrics->>'project_command' IS DISTINCT FROM fingerprint) THEN RAISE EXCEPTION 'PROJECT_COMMAND_CONFLICT'; END IF;
   RETURN jsonb_build_object('project',to_jsonb(project),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.inventory_project_rows r WHERE project_id=p_project_id));
 END IF;
 IF NOT (customer='N/A' AND consignee='N/A') AND NOT EXISTS(
   SELECT 1 FROM public.ph_customer_consignee_sales_reps m WHERE m.customername=customer AND m.consigneename=consignee AND m.salesrepid=p_payload->>'salesrepid'
    AND regexp_replace(lower(regexp_replace(m.salesrepname,'^([^,]+),\s*(.+)$','\2 \1')),'[^a-z0-9]','','g')=regexp_replace(lower(rep),'[^a-z0-9]','','g')
    AND lower(coalesce(m.customerstatus,'')) NOT IN ('inactive','disabled','deleted') AND lower(coalesce(m.consigneestatus,'')) NOT IN ('inactive','disabled','deleted')
 ) THEN RAISE EXCEPTION 'PROJECT_CUSTOMER_PAIR_FORBIDDEN' USING errcode='42501'; END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
   grader:=row_value->>'grader_username';
   IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE username=grader AND disabled_at IS NULL) THEN RAISE EXCEPTION 'PROJECT_GRADER_INVALID'; END IF;
   IF coalesce(row_value->>'grade_qty','')!~'^[1-9][0-9]*$' OR length(row_value->>'grade_qty')>9 OR nullif(btrim(row_value->>'marked_with'),'') IS NULL THEN RAISE EXCEPTION 'PROJECT_GRADING_FIELDS_INVALID'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.ph_master_inventory m WHERE m.itemcode=row_value->>'itemcode' AND m.locationcode=row_value->>'locationcode' AND m.lotcode=row_value->>'lotcode') THEN RAISE EXCEPTION 'PROJECT_INVENTORY_ROW_MISSING'; END IF;
 END LOOP;
 INSERT INTO public.inventory_projects(id,project_name,instructions,assigned_users,created_by,created_by_name)
 VALUES(p_project_id,left(p_payload->>'projectName',160),concat('Sales Rep: ',rep,E'\nCustomer: ',customer,E'\nConsignee: ',consignee),
   (SELECT jsonb_agg(DISTINCT value->>'grader_username') FROM jsonb_array_elements(p_payload->'rows')),actor.username,coalesce(actor.display_name,actor.username)) RETURNING * INTO project;
 INSERT INTO public.inventory_project_rows(project_id,itemcode,locationcode,lotcode,commonname,contsize,row_instructions,snapshot_metrics,added_by)
 SELECT p_project_id,value->>'itemcode',value->>'locationcode',value->>'lotcode',coalesce(value->>'commonname',''),coalesce(value->>'contsize',''),
   concat('Grade ',value->>'grade_qty',' · ',value->>'marked_with',' · ',value->>'grader_username'),
   coalesce(value->'snapshotMetrics','{}'::jsonb)||jsonb_build_object('grade_qty',(value->>'grade_qty')::integer,'marked_with',value->>'marked_with','grader_username',value->>'grader_username',
     'salesrep',rep,'customername',customer,'consigneename',consignee,'project_command',fingerprint),actor.username
 FROM jsonb_array_elements(p_payload->'rows') ON CONFLICT(project_id,itemcode,locationcode,lotcode) DO NOTHING;
 PERFORM realtime.send(jsonb_build_object('projectId',p_project_id),'inventory_projects','agdata-live-sync',true);
 RETURN jsonb_build_object('project',to_jsonb(project),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.inventory_project_rows r WHERE project_id=p_project_id));
END $body$;
REVOKE ALL ON FUNCTION public.create_inventory_project_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_project_v1(uuid,uuid,jsonb) TO service_role;
COMMIT;
