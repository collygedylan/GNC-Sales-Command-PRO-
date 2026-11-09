begin;
-- Restore the installed project completion predecessor for the exact 3.0.10 patch.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_INVENTORY_PROJECT_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
CREATE OR REPLACE FUNCTION public.create_inventory_project_v1(p_actor_id uuid, p_project_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor public.profiles; project public.inventory_projects; row_value jsonb; grader text; target_row public.inventory_project_rows; completion jsonb; definition jsonb; custom_value jsonb;
  fingerprint text:=md5(p_payload::text); rep text:=btrim(p_payload->>'salesrep'); customer text:=btrim(p_payload->>'customername'); consignee text:=btrim(p_payload->>'consigneename');
BEGIN
 IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'PROJECT_SERVICE_REQUIRED' USING errcode='42501'; END IF;
 SELECT * INTO actor FROM public.profiles WHERE id=p_actor_id AND disabled_at IS NULL AND (locked_until IS NULL OR locked_until<now());
 IF actor.id IS NULL OR regexp_replace(upper(actor.role),'[^A-Z]','','g')='SALESREP' THEN RAISE EXCEPTION 'PROJECT_FORBIDDEN' USING errcode='42501'; END IF;

 IF p_payload->>'operation'='reassign' THEN
   SELECT * INTO project FROM public.inventory_projects WHERE id=p_project_id FOR UPDATE;
   IF project.id IS NULL THEN RAISE EXCEPTION 'PROJECT_NOT_FOUND'; END IF;
   IF NOT (project.created_by=actor.username OR upper(actor.role) IN ('ADMIN','MANAGER')) OR coalesce((SELECT create_project FROM public.user_access WHERE profile_id=actor.id),'N')<>'Y' THEN RAISE EXCEPTION 'PROJECT_REASSIGN_FORBIDDEN' USING errcode='42501'; END IF;
   grader:=btrim(p_payload->>'assigned_user');
   IF grader IS NULL OR NOT (grader IN ('QC','Eval','Production') OR EXISTS(SELECT 1 FROM public.profiles WHERE username=grader AND disabled_at IS NULL)) THEN RAISE EXCEPTION 'PROJECT_GRADER_INVALID'; END IF;
   UPDATE public.inventory_project_rows SET snapshot_metrics=jsonb_set(coalesce(snapshot_metrics,'{}'),'{grader_username}',to_jsonb(grader)),updated_at=clock_timestamp() WHERE project_id=p_project_id AND status<>'done';
   UPDATE public.inventory_projects SET assigned_users=jsonb_build_array(grader),updated_at=clock_timestamp() WHERE id=p_project_id RETURNING * INTO project;
   RETURN jsonb_build_object('project',to_jsonb(project),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.inventory_project_rows r WHERE project_id=p_project_id));
 END IF;
 IF p_payload->>'operation'='complete_row' THEN
   SELECT * INTO project FROM public.inventory_projects WHERE id=p_project_id FOR UPDATE;
   IF project.id IS NULL THEN RAISE EXCEPTION 'PROJECT_NOT_FOUND'; END IF;
   SELECT * INTO target_row FROM public.inventory_project_rows WHERE id=(p_payload->>'rowId')::uuid AND project_id=p_project_id FOR UPDATE;
   IF target_row.id IS NULL THEN RAISE EXCEPTION 'PROJECT_ROW_NOT_FOUND'; END IF;
   grader:=lower(coalesce(target_row.snapshot_metrics->>'grader_username',''));
   IF NOT (regexp_replace(upper(actor.role),'[^A-Z]','','g') IN ('ADMIN','MANAGER') OR grader=lower(actor.username)
     OR (grader='qc' AND regexp_replace(upper(actor.role),'[^A-Z]','','g') IN ('QC','QUALITYCONTROL'))
     OR (grader='eval' AND regexp_replace(upper(actor.role),'[^A-Z]','','g') IN ('EVAL','EVALUATOR'))
     OR (grader='production' AND regexp_replace(upper(actor.role),'[^A-Z]','','g')='PRODUCTION')
     OR (grader='' AND project.created_by=actor.username)) THEN RAISE EXCEPTION 'PROJECT_ASSIGNEE_REQUIRED' USING errcode='42501'; END IF;
   IF target_row.status<>'done' THEN
     completion:=coalesce(p_payload->'completion','{}'::jsonb);
     IF jsonb_typeof(completion)<>'object' THEN RAISE EXCEPTION 'PROJECT_COMPLETION_INVALID'; END IF;
     FOR row_value IN SELECT value FROM jsonb_array_elements(coalesce(project.project_meta->'tasks','[]'::jsonb)) LOOP
       IF completion->'task_checks'->>(row_value->>'type') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'PROJECT_TASK_CHECK_REQUIRED'; END IF;
       grader:=CASE row_value->>'type' WHEN 'grading' THEN 'qty_graded_out' WHEN 'discard' THEN 'qty_discarded' WHEN 'hauling' THEN 'qty_hauled' ELSE NULL END;
       IF grader IS NOT NULL AND coalesce(completion->>grader,'')!~'^[0-9]{1,9}$' THEN RAISE EXCEPTION 'PROJECT_TASK_COUNT_REQUIRED'; END IF;
     END LOOP;

     IF coalesce((project.project_meta->'parameters'->>'count')::boolean,false) THEN
       IF coalesce(completion->>'qty_graded_out','')!~'^[0-9]{1,9}$' THEN RAISE EXCEPTION 'PROJECT_GRADED_COUNT_REQUIRED'; END IF;
     END IF;
     IF coalesce((project.project_meta->'parameters'->>'marking')::boolean,false) AND nullif(btrim(completion->>'marked_with'),'') IS NULL THEN RAISE EXCEPTION 'PROJECT_MARKING_REQUIRED'; END IF;
     IF coalesce((project.project_meta->'parameters'->>'photo')::boolean,false) AND coalesce(completion->>'photo_url','')!~'^https://' THEN RAISE EXCEPTION 'PROJECT_PHOTO_REQUIRED'; END IF;
     IF jsonb_typeof(coalesce(completion->'custom_variables','{}'))<>'object' THEN RAISE EXCEPTION 'PROJECT_CUSTOM_VALUES_INVALID'; END IF;
     FOR definition IN SELECT value FROM jsonb_array_elements(coalesce(project.project_meta->'custom_variables','[]')) LOOP
       custom_value:=completion->'custom_variables'->(definition->>'id');
       IF custom_value IS NULL OR custom_value='null'::jsonb
         OR (definition->>'type'='number' AND jsonb_typeof(custom_value)<>'number')
         OR (definition->>'type'='boolean' AND jsonb_typeof(custom_value)<>'boolean')
         OR (definition->>'type'='text' AND (jsonb_typeof(custom_value)<>'string' OR nullif(btrim(custom_value#>>'{}'),'') IS NULL)) THEN RAISE EXCEPTION 'PROJECT_CUSTOM_VALUE_REQUIRED'; END IF;
     END LOOP;
     UPDATE public.inventory_project_rows SET status='done',completed_at=clock_timestamp(),completed_by=actor.username,
       qty_graded_out=CASE WHEN project.project_meta->'parameters'->>'count'='true' THEN (completion->>'qty_graded_out')::integer ELSE NULL END,
       completion_meta=completion,updated_at=clock_timestamp() WHERE id=target_row.id;
     UPDATE public.inventory_projects p SET
       status=CASE WHEN NOT EXISTS(SELECT 1 FROM public.inventory_project_rows r WHERE r.project_id=p.id AND r.status<>'done') THEN 'completed' ELSE 'active' END,
       completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM public.inventory_project_rows r WHERE r.project_id=p.id AND r.status<>'done') THEN clock_timestamp() ELSE NULL END,
       completed_by=CASE WHEN NOT EXISTS(SELECT 1 FROM public.inventory_project_rows r WHERE r.project_id=p.id AND r.status<>'done') THEN actor.username ELSE NULL END,
       qty_graded_out=(SELECT sum(r.qty_graded_out) FROM public.inventory_project_rows r WHERE r.project_id=p.id),
       qty_discarded=(SELECT coalesce(sum((r.completion_meta->>'qty_discarded')::integer),0) FROM public.inventory_project_rows r WHERE r.project_id=p.id),
       qty_hauled=(SELECT coalesce(sum((r.completion_meta->>'qty_hauled')::integer),0) FROM public.inventory_project_rows r WHERE r.project_id=p.id),updated_at=clock_timestamp()
       WHERE p.id=p_project_id RETURNING * INTO project;
   END IF;
   RETURN jsonb_build_object('project',to_jsonb(project),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.inventory_project_rows r WHERE project_id=p_project_id));
 END IF;
 IF coalesce((SELECT create_project FROM public.user_access WHERE profile_id=actor.id),'N')<>'Y' THEN RAISE EXCEPTION 'PROJECT_ACCESS_MATRIX_REQUIRED' USING errcode='42501'; END IF; IF p_project_id IS NULL OR jsonb_typeof(p_payload->'rows')<>'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 100
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

 IF p_payload ? 'project_meta' THEN
   IF jsonb_typeof(p_payload->'project_meta')<>'object' OR jsonb_typeof(p_payload->'project_meta'->'parameters') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'project_meta'->'custom_variables') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'PROJECT_META_INVALID'; END IF;
   IF jsonb_array_length(p_payload->'project_meta'->'custom_variables')>32 THEN RAISE EXCEPTION 'PROJECT_CUSTOM_FIELDS_LIMIT'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each(p_payload->'project_meta'->'parameters') WHERE jsonb_typeof(value)<>'boolean') THEN RAISE EXCEPTION 'PROJECT_PARAMETERS_INVALID'; END IF;
   FOR definition IN SELECT value FROM jsonb_array_elements(p_payload->'project_meta'->'custom_variables') LOOP
     IF nullif(btrim(definition->>'id'),'') IS NULL OR nullif(btrim(definition->>'label'),'') IS NULL OR coalesce(definition->>'type','') NOT IN ('number','text','boolean') THEN RAISE EXCEPTION 'PROJECT_CUSTOM_FIELD_INVALID'; END IF;
   END LOOP;
   IF nullif(p_payload->>'finish_by_date','')::date < nullif(p_payload->>'start_date','')::date THEN RAISE EXCEPTION 'PROJECT_DATES_INVALID'; END IF;
 END IF;
 IF p_payload->'project_meta' ? 'tasks' THEN
   IF jsonb_typeof(p_payload->'project_meta'->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'project_meta'->'tasks') NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'PROJECT_TASKS_REQUIRED'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'project_meta'->'tasks') t WHERE t->>'type' NOT IN ('grading','discard','hauling','maintenance') OR t->>'type' IS NULL) THEN RAISE EXCEPTION 'PROJECT_TASK_TYPE_INVALID'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'project_meta'->'tasks') t GROUP BY t->>'type' HAVING count(*)>1) THEN RAISE EXCEPTION 'PROJECT_TASK_DUPLICATE'; END IF;
   IF coalesce(p_payload->'project_meta'->>'priority','Normal') NOT IN ('Normal','High','Critical') THEN RAISE EXCEPTION 'PROJECT_PRIORITY_INVALID'; END IF;
 END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
   grader:=row_value->>'grader_username';
   IF NOT (grader IN ('QC','Eval','Production') OR (grader='' AND p_payload->'project_meta'->'parameters'->>'assignee'='false') OR EXISTS(SELECT 1 FROM public.profiles WHERE username=grader AND disabled_at IS NULL)) THEN RAISE EXCEPTION 'PROJECT_GRADER_INVALID'; END IF;
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
 UPDATE public.inventory_projects SET project_meta=coalesce(p_payload->'project_meta','{}'::jsonb),custom_variables=coalesce(p_payload->'project_meta'->'custom_variables','[]'::jsonb),start_date=nullif(p_payload->>'start_date','')::date,finish_by_date=nullif(p_payload->>'finish_by_date','')::date WHERE id=p_project_id RETURNING * INTO project;
 PERFORM realtime.send(jsonb_build_object('projectId',p_project_id),'inventory_projects','agdata-live-sync',true);
 RETURN jsonb_build_object('project',to_jsonb(project),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.inventory_project_rows r WHERE project_id=p_project_id));
END $function$;
commit;
