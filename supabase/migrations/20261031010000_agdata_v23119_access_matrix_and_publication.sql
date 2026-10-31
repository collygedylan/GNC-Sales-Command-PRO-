BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';
CREATE OR REPLACE FUNCTION private.access_username_v23119(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT CASE WHEN normalized='nally_aguilar' THEN 'nelly_aguilar' ELSE normalized END FROM (SELECT trim(both '_' from regexp_replace(lower(btrim(coalesce(value,''))),'[^a-z0-9]+','_','g')) normalized) n $$;
CREATE TABLE IF NOT EXISTS public.user_access (
 profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
 username text PRIMARY KEY, display_name text NOT NULL, role text NOT NULL,
 make_request text NOT NULL DEFAULT 'Y' CHECK (make_request IN ('Y','N')),
 can_make_request text NOT NULL DEFAULT 'Y' CHECK (can_make_request IN ('Y','N')),
 request_all_reps text NOT NULL DEFAULT 'Y' CHECK (request_all_reps IN ('Y','N')),
 edit_any_row text NOT NULL DEFAULT 'N' CHECK (edit_any_row IN ('Y','N')),
 can_edit_all_rows text NOT NULL DEFAULT 'N' CHECK (can_edit_all_rows IN ('Y','N')),
 edit_assigned_rows_only text NOT NULL DEFAULT 'N' CHECK (edit_assigned_rows_only IN ('Y','N')),
 can_edit_assigned_items text NOT NULL DEFAULT 'N' CHECK (can_edit_assigned_items IN ('Y','N')),
 flyer_folder_access text NOT NULL DEFAULT 'N' CHECK (flyer_folder_access IN ('Y','N')),
 can_manage_flyers text NOT NULL DEFAULT 'N' CHECK (can_manage_flyers IN ('Y','N')),
 create_project text NOT NULL DEFAULT 'Y' CHECK (create_project IN ('Y','N')),
 approve_suspend_tags text NOT NULL DEFAULT 'N' CHECK (approve_suspend_tags IN ('Y','N')),
 manage_tables text NOT NULL DEFAULT 'N' CHECK (manage_tables IN ('Y','N')),
 sales_rep_access jsonb NOT NULL DEFAULT '{}', allowed_request_reps jsonb NOT NULL DEFAULT '{}', view_permissions jsonb NOT NULL DEFAULT '{}',
 revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.user_access TO authenticated;
GRANT ALL ON public.user_access TO service_role;
CREATE POLICY user_access_active_read_v23119 ON public.user_access FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.disabled_at IS NULL AND NOT p.must_change_password));
CREATE OR REPLACE FUNCTION private.access_rep_roster_v23119() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(rep,'Y'),'{}') FROM (SELECT DISTINCT private.access_username_v23119(name) rep FROM (
 SELECT btrim(username) name FROM public.profiles WHERE disabled_at IS NULL AND regexp_replace(upper(role),'[^A-Z]','','g') IN ('REP','SALESREP')
 UNION SELECT btrim(salesrepname) FROM public.ph_customer_consignee_sales_reps WHERE nullif(btrim(salesrepname),'') IS NOT NULL) source WHERE nullif(name,'') IS NOT NULL) reps
$$;
CREATE OR REPLACE FUNCTION private.seed_user_access_v23119(p public.profiles) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE name text:=private.access_username_v23119(p.username); role_key text:=regexp_replace(upper(coalesce(p.role,'')),'[^A-Z]','','g'); full_rows text; all_reps text; flyers text; reps jsonb; modules jsonb;
BEGIN
 IF p.disabled_at IS NOT NULL THEN DELETE FROM public.user_access WHERE profile_id=p.id; RETURN; END IF;
 full_rows:=CASE WHEN role_key IN ('ADMIN','ADMINISTRATOR','MANAGER') OR name=ANY(ARRAY['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','morgan_anderson']) THEN 'Y' ELSE 'N' END;
 all_reps:=CASE WHEN role_key IN ('ADMIN','ADMINISTRATOR','MANAGER','CSR','SALESOFFICE','OFFICE','EVAL','EVALUATOR') OR name=ANY(ARRAY['dylan_collyge','nelly_aguilar','morgan_anderson','jd_jones','megan_kelly','melissa_dowty','mitch_kaiser']) THEN 'Y' ELSE 'N' END;
 flyers:=CASE WHEN full_rows='Y' OR role_key IN ('SALES','SALESREP','REP','CSR') OR name='melissa_dowty' THEN 'Y' ELSE 'N' END;
 reps:=CASE WHEN all_reps='Y' THEN private.access_rep_roster_v23119() ELSE jsonb_build_object(name,'Y') END;
 reps:=reps||coalesce((SELECT jsonb_object_agg(private.access_username_v23119(n),'Y') FROM public.user_access_control u CROSS JOIN LATERAL unnest(u.salesrep_match_names) n WHERE u.profile_id=p.id AND nullif(btrim(n),'') IS NOT NULL),'{}');
 modules:=CASE WHEN full_rows='Y' THEN '{"view_drive_mode":"Y","view_av":"Y","view_que_request":"Y","view_que_suspend":"Y","view_docks":"Y","view_hl_order":"Y","view_sales":"Y","view_sales_office":"Y","view_historical_requests":"Y","view_managers":"Y","view_qc":"Y","view_office":"Y","view_inventory":"Y","view_production":"Y","view_bloom":"Y","view_flyers":"Y","view_comm":"Y"}'::jsonb ELSE '{}'::jsonb END;
 INSERT INTO public.user_access(profile_id,username,display_name,role,make_request,can_make_request,request_all_reps,edit_any_row,can_edit_all_rows,edit_assigned_rows_only,can_edit_assigned_items,flyer_folder_access,can_manage_flyers,sales_rep_access,allowed_request_reps,view_permissions,manage_tables)
 VALUES(p.id,name,coalesce(nullif(btrim(p.display_name),''),name),btrim(coalesce(p.role,'')),'Y','Y',all_reps,full_rows,full_rows,CASE WHEN role_key IN ('EVAL','EVALUATOR') THEN 'Y' ELSE 'N' END,CASE WHEN role_key IN ('EVAL','EVALUATOR') THEN 'Y' ELSE 'N' END,flyers,flyers,reps,reps,modules,CASE WHEN private.is_full_app_administrator_v1(name) THEN 'Y' ELSE 'N' END)
 ON CONFLICT(profile_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,role=excluded.role;
END $$;
DO $$ DECLARE p public.profiles; BEGIN FOR p IN SELECT * FROM public.profiles LOOP PERFORM private.seed_user_access_v23119(p); END LOOP; END $$;
CREATE OR REPLACE FUNCTION private.sync_access_matrix_profile_v23119() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM private.seed_user_access_v23119(NEW); RETURN NEW; END $$;
CREATE TRIGGER sync_access_matrix_profile_v23119 AFTER INSERT OR UPDATE OF username,display_name,role,disabled_at ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.sync_access_matrix_profile_v23119();
CREATE OR REPLACE FUNCTION private.sync_access_matrix_aliases_v23119() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.can_make_request IS DISTINCT FROM OLD.can_make_request AND NEW.make_request IS NOT DISTINCT FROM OLD.make_request THEN NEW.make_request:=NEW.can_make_request; ELSE NEW.can_make_request:=NEW.make_request; END IF;
 IF TG_OP='UPDATE' AND NEW.can_edit_all_rows IS DISTINCT FROM OLD.can_edit_all_rows AND NEW.edit_any_row IS NOT DISTINCT FROM OLD.edit_any_row THEN NEW.edit_any_row:=NEW.can_edit_all_rows; ELSE NEW.can_edit_all_rows:=NEW.edit_any_row; END IF;
 IF TG_OP='UPDATE' AND NEW.can_edit_assigned_items IS DISTINCT FROM OLD.can_edit_assigned_items AND NEW.edit_assigned_rows_only IS NOT DISTINCT FROM OLD.edit_assigned_rows_only THEN NEW.edit_assigned_rows_only:=NEW.can_edit_assigned_items; ELSE NEW.can_edit_assigned_items:=NEW.edit_assigned_rows_only; END IF;
 IF TG_OP='UPDATE' AND NEW.can_manage_flyers IS DISTINCT FROM OLD.can_manage_flyers AND NEW.flyer_folder_access IS NOT DISTINCT FROM OLD.flyer_folder_access THEN NEW.flyer_folder_access:=NEW.can_manage_flyers; ELSE NEW.can_manage_flyers:=NEW.flyer_folder_access; END IF;
 IF TG_OP='UPDATE' AND NEW.allowed_request_reps IS DISTINCT FROM OLD.allowed_request_reps AND NEW.sales_rep_access IS NOT DISTINCT FROM OLD.sales_rep_access THEN NEW.sales_rep_access:=NEW.allowed_request_reps; ELSE NEW.allowed_request_reps:=NEW.sales_rep_access; END IF;
 IF jsonb_typeof(NEW.sales_rep_access)<>'object' OR jsonb_typeof(NEW.view_permissions)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each_text(NEW.sales_rep_access||NEW.view_permissions) e WHERE e.value NOT IN ('Y','N')) THEN RAISE EXCEPTION 'USER_ACCESS_MATRIX_INVALID' USING ERRCODE='22023'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER sync_access_matrix_aliases_v23119 BEFORE INSERT OR UPDATE ON public.user_access FOR EACH ROW EXECUTE FUNCTION private.sync_access_matrix_aliases_v23119();
CREATE TABLE private.user_access_matrix_commands_v23119(actor_id uuid NOT NULL,command_id uuid NOT NULL,input jsonb NOT NULL,response jsonb NOT NULL,PRIMARY KEY(actor_id,command_id));
REVOKE ALL ON private.user_access_matrix_commands_v23119 FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.save_user_access_matrix_v23119(p_actor_id uuid,p_username text,p_patch jsonb,p_command_id uuid,p_expected_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; target public.user_access; prior private.user_access_matrix_commands_v23119; request jsonb:=jsonb_build_object('username',p_username,'patch',p_patch,'revision',p_expected_revision); result jsonb;
BEGIN
 IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'USER_ACCESS_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO actor FROM public.profiles WHERE id=p_actor_id AND disabled_at IS NULL AND NOT must_change_password;
 IF actor.id IS NULL OR NOT private.is_full_app_administrator_v1(actor.username) THEN RAISE EXCEPTION 'USER_ACCESS_MANAGER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_command_id IS NULL OR p_expected_revision IS NULL OR jsonb_typeof(p_patch)<>'object' OR octet_length(p_patch::text)>65536 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k<>ALL(ARRAY['make_request','can_make_request','request_all_reps','edit_any_row','can_edit_all_rows','edit_assigned_rows_only','can_edit_assigned_items','flyer_folder_access','can_manage_flyers','create_project','approve_suspend_tags','manage_tables','sales_rep_access','allowed_request_reps','view_permissions'])) THEN RAISE EXCEPTION 'USER_ACCESS_MATRIX_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('access-matrix:'||p_actor_id||':'||p_command_id,0));
 SELECT * INTO prior FROM private.user_access_matrix_commands_v23119 WHERE actor_id=p_actor_id AND command_id=p_command_id;
 IF FOUND THEN IF prior.input<>request THEN RAISE EXCEPTION 'USER_ACCESS_COMMAND_CONFLICT' USING ERRCODE='40001'; END IF; RETURN prior.response; END IF;
 SELECT * INTO target FROM public.user_access WHERE username=private.access_username_v23119(p_username) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'USER_ACCESS_TARGET_NOT_FOUND'; END IF;
 IF target.revision<>p_expected_revision THEN RAISE EXCEPTION 'USER_ACCESS_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE public.user_access SET make_request=coalesce(p_patch->>'make_request',make_request),can_make_request=coalesce(p_patch->>'can_make_request',can_make_request),request_all_reps=coalesce(p_patch->>'request_all_reps',request_all_reps),edit_any_row=coalesce(p_patch->>'edit_any_row',edit_any_row),can_edit_all_rows=coalesce(p_patch->>'can_edit_all_rows',can_edit_all_rows),edit_assigned_rows_only=coalesce(p_patch->>'edit_assigned_rows_only',edit_assigned_rows_only),can_edit_assigned_items=coalesce(p_patch->>'can_edit_assigned_items',can_edit_assigned_items),flyer_folder_access=coalesce(p_patch->>'flyer_folder_access',flyer_folder_access),can_manage_flyers=coalesce(p_patch->>'can_manage_flyers',can_manage_flyers),create_project=coalesce(p_patch->>'create_project',create_project),approve_suspend_tags=coalesce(p_patch->>'approve_suspend_tags',approve_suspend_tags),manage_tables=coalesce(p_patch->>'manage_tables',manage_tables),sales_rep_access=coalesce(p_patch->'sales_rep_access',p_patch->'allowed_request_reps',sales_rep_access),allowed_request_reps=coalesce(p_patch->'allowed_request_reps',p_patch->'sales_rep_access',allowed_request_reps),view_permissions=coalesce(p_patch->'view_permissions',view_permissions),revision=revision+1 WHERE username=target.username RETURNING * INTO target;
 result:=jsonb_build_object('ok',true,'matrix',to_jsonb(target));
 INSERT INTO private.user_access_matrix_commands_v23119 VALUES(p_actor_id,p_command_id,request,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_user_access_matrix_v23119(uuid,text,jsonb,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_user_access_matrix_v23119(uuid,text,jsonb,uuid,bigint) TO service_role;
CREATE OR REPLACE FUNCTION private.assert_request_matrix_v23119(requests jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; matrix public.user_access; entry jsonb; rep text; permission text;
BEGIN
 actor:=private.current_profile();
 SELECT * INTO matrix FROM public.user_access WHERE profile_id=actor.id;
 IF matrix.profile_id IS NULL OR matrix.make_request<>'Y' OR matrix.can_make_request<>'Y' THEN RAISE EXCEPTION 'MAKE_REQUEST_DISABLED' USING ERRCODE='42501'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(requests) LOOP
  rep:=private.access_username_v23119(coalesce(nullif(entry->>'request_selected_rep_username',''),nullif(entry->>'request_selected_rep_display',''),entry->>'requested_by'));
  permission:=coalesce(matrix.sales_rep_access->>rep,matrix.allowed_request_reps->>rep,CASE WHEN matrix.request_all_reps='Y' OR rep=matrix.username THEN 'Y' ELSE 'N' END);
  IF permission<>'Y' THEN RAISE EXCEPTION 'REQUEST_SALES_REP_DISABLED' USING ERRCODE='42501'; END IF;
 END LOOP;
END $$;
DO $$ BEGIN
 IF to_regprocedure('public.create_request_batch_pre_matrix_v23119(uuid,jsonb)') IS NULL THEN ALTER FUNCTION public.create_request_batch(uuid,jsonb) RENAME TO create_request_batch_pre_matrix_v23119; END IF;
 IF to_regprocedure('public.create_av_request_batch_pre_matrix_v23119(uuid,jsonb)') IS NULL THEN ALTER FUNCTION public.create_av_request_batch(uuid,jsonb) RENAME TO create_av_request_batch_pre_matrix_v23119; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.create_request_batch(client_batch_id uuid,requests jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM private.assert_request_matrix_v23119(requests); RETURN public.create_request_batch_pre_matrix_v23119(client_batch_id,requests); END $$;
CREATE OR REPLACE FUNCTION public.create_av_request_batch(client_batch_id uuid,requests jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM private.assert_request_matrix_v23119(requests); RETURN public.create_av_request_batch_pre_matrix_v23119(client_batch_id,requests); END $$;
REVOKE ALL ON FUNCTION public.create_request_batch_pre_matrix_v23119(uuid,jsonb),public.create_av_request_batch_pre_matrix_v23119(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_request_batch(uuid,jsonb),public.create_av_request_batch(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_request_batch(uuid,jsonb),public.create_av_request_batch(uuid,jsonb) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION private.require_drive_live_change_profile_v2392(p_master_uid text, p_itemcode text, p_locationcode text, p_lotcode text)
 RETURNS profiles
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles%rowtype;actor_key text;actor_role text;row_value public.ph_master_inventory%rowtype; matrix public.user_access;
begin
  select p.* into actor from public.profiles p where p.id=auth.uid() and p.disabled_at is null
    and not p.must_change_password and (p.locked_until is null or p.locked_until<=statement_timestamp());
  if actor.id is null then raise exception using errcode='42501',message='DRIVE_LIVE_CHANGE_PROFILE_INACTIVE'; end if;
  actor_key:=private.normalize_inventory_live_change_username_v2392(actor.username);
  actor_role:=private.normalized_profile_role(actor.role);
  select * into matrix from public.user_access where profile_id=actor.id;
  if matrix.profile_id is not null then
    if matrix.edit_any_row='Y' then return actor; end if;
    if matrix.flyer_folder_access='Y' and exists(select 1 from public.ph_flyer_folder_rows f where f.master_unique_id=p_master_uid) then return actor; end if;
    if matrix.edit_assigned_rows_only<>'Y' then raise exception 'DRIVE_LIVE_CHANGE_ADMIN_REQUIRED' using errcode='42501'; end if;
  elsif actor_key=any(array['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','morgan_anderson'])
     or actor_role in ('ADMIN','ADMINISTRATOR','MANAGER') then return actor; end if;
  if matrix.profile_id is null and actor_key<>'jorge_colunga' and actor_role not in ('EVAL','EVALUATOR') then
    raise exception using errcode='42501',message='DRIVE_LIVE_CHANGE_ADMIN_REQUIRED';
  end if;
  select m.* into row_value from public.ph_master_inventory m
  where m.unique_id=btrim(coalesce(p_master_uid,''))
    and upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(coalesce(p_itemcode,'')))
    and upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(coalesce(p_locationcode,'')))
    and upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_lotcode,''))) limit 1;
  if row_value.unique_id is null or not private.inventory_row_assigned_to_actor_v2392(
    actor_key,row_value.unique_id,row_value.itemcode) then
    raise exception using errcode='42501',message=case when actor_key='jorge_colunga'
      then 'INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED' else 'INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED' end;
  end if;
  return actor;
end $function$
;

CREATE OR REPLACE FUNCTION suspend_tag_private.publish_inventory_evidence_v23119(p_actor_id uuid,s public.ph_soc_master,p_payload jsonb,p_command_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target record; m public.ph_master_inventory; patch jsonb:=coalesce(p_payload->'patch','{}'); evidence jsonb; result jsonb; rows jsonb:='[]'; seen text[]:='{}'; pct numeric; stock numeric; old_sub text:=current_setting('request.jwt.claim.sub',true); old_claims text:=current_setting('request.jwt.claims',true);
BEGIN
 -- The service wrapper has already verified the native session, physical tag, command and source revision.
 IF p_actor_id IS DISTINCT FROM nullif(current_setting('app.suspend_tag_actor_id',true),'')::uuid THEN RAISE EXCEPTION 'SUSPEND_TAG_SESSION_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 FOR target IN SELECT s.locationcode locationcode,s.lotcode lotcode UNION SELECT r.locationcode,r.lotcode FROM public.ph_soc_master r WHERE s.suspend_candidate_group IS NOT NULL AND r.suspend_candidate_group=s.suspend_candidate_group AND r.suspend_candidate_state='candidate' AND r.source='Suspend Tag AV Option' LOOP
  IF suspend_tag_private.is_false_block_v2378(target.locationcode) THEN CONTINUE; END IF;
  SELECT candidate.* INTO m FROM public.ph_master_inventory candidate
   WHERE regexp_replace(rtrim(upper(candidate.itemcode),'.'),'[.]1$','')=regexp_replace(rtrim(upper(s.itemcode),'.'),'[.]1$','')
    AND upper(btrim(candidate.locationcode))=upper(btrim(target.locationcode))
    AND NOT suspend_tag_private.is_false_block_v2378(candidate.locationcode)
    AND (nullif(p_payload->'sourceIdentity'->>'masterUid','') IS NULL OR target.locationcode IS DISTINCT FROM s.locationcode OR candidate.unique_id=p_payload->'sourceIdentity'->>'masterUid')
   ORDER BY (upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(target.lotcode,'')))) DESC,
    (upper(btrim(candidate.itemcode))=upper(btrim(s.itemcode))) DESC,
    private.reclass_numeric_v1(candidate.ptronhand) DESC NULLS LAST,candidate.unique_id LIMIT 1 FOR UPDATE;
  IF m.unique_id IS NULL OR m.unique_id=ANY(seen) THEN CONTINUE; END IF;
  seen:=array_append(seen,m.unique_id);evidence:='{}';
  IF patch?'dock_spec' THEN evidence:=evidence||jsonb_build_object('spec',s.dock_spec); END IF;
  IF patch?'dock_caliper' THEN evidence:=evidence||jsonb_build_object('caliper',s.dock_caliper); END IF;
  IF patch?'av_note' THEN evidence:=evidence||jsonb_build_object('av_note',s.av_note); END IF;
  IF patch?'dock_note' OR patch?'sales_note' THEN evidence:=evidence||jsonb_build_object('comments',coalesce(patch->>'sales_note',s.dock_note)); END IF;
  IF patch?'pick_note' THEN evidence:=evidence||jsonb_build_object('pick_note',s.pick_note); END IF;
  IF patch?'dock_photo_link' THEN evidence:=evidence||jsonb_build_object('photo_link',coalesce((SELECT string_agg(link,',' ORDER BY first_seen) FROM (SELECT btrim(link) link,min(n) first_seen FROM unnest(string_to_array(concat_ws(',',m.photo_link,s.dock_photo_link),',')) WITH ORDINALITY a(link,n) WHERE btrim(link)<>'' GROUP BY btrim(link)) photos),'')); END IF;
  IF patch?'dock_photo_name' THEN evidence:=evidence||jsonb_build_object('photo_name',concat_ws(',',nullif(m.photo_name,''),nullif(s.dock_photo_name,''))); END IF;
  IF patch?'match' THEN
   pct:=private.reclass_numeric_v1(s.match);stock:=coalesce(nullif(private.reclass_numeric_v1(m.ptronhand),0),nullif(private.reclass_numeric_v1(m.ptravailable),0),0);
   evidence:=evidence||jsonb_build_object('match',s.match,'loc_match_qty',CASE WHEN pct>0 AND stock>0 THEN round(pct*stock/100)::text ELSE s.loc_match_qty END);
  END IF;
  IF evidence='{}' THEN CONTINUE; END IF;
  result:=public.save_drive_evidence_v3(m.unique_id,m.itemcode,m.locationcode,m.lotcode,m.last_updated::text,'{}',evidence,false,'location','suspend-'||p_command_id||'-'||md5(m.unique_id));
  rows:=rows||jsonb_build_array(result->'row');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
 RETURN jsonb_build_object('inventoryRows',rows,'inventoryRow',rows->0);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);RAISE;
END $$;
REVOKE ALL ON FUNCTION suspend_tag_private.publish_inventory_evidence_v23119(uuid,public.ph_soc_master,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION suspend_tag_private.command(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; inventory_result jsonb:='{}'; was_denied boolean; event_id uuid; approval_id uuid; decision text;
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation='approval' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion')) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','canDecide',(a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) and a.status='pending'
      and exists(select 1 from suspend_tag_private.workflows x join public.ph_soc_master r on r.unique_id=x.source_uid
        where x.current_approval_id=a.id and x.status='awaiting_rep' and r.last_updated is not distinct from a.source_revision and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR','INVENTORY','INVENTORYMANAGER') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
  if p_operation='rows' then
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]') from public.ph_soc_master r
      where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
  input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
  select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
  if found then
    if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
    return receipt.response;
  end if;
  uid:=case when p_operation in ('save','complete') then suspend_tag_private.resolve_edit_source_v23107(p_payload) else p_payload->>'sourceUid' end;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    uid:=a.source_uid;
  end if;
  if p_operation in ('save','complete') then
    perform pg_advisory_xact_lock(hashtextextended('suspend-tag-review-item:'||r.itemcode,0))
      from public.ph_soc_master r where r.unique_id=uid;
  end if;
  select * into s from public.ph_soc_master where unique_id=uid for update;
  if not found or not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
  insert into suspend_tag_private.workflows(source_uid,source_revision) values(uid,s.last_updated) on conflict do nothing;
  select * into w from suspend_tag_private.workflows where source_uid=uid for update;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=a.id for update;
    decision:=p_payload->>'decision';
    if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
    if a.source_revision is distinct from s.last_updated or w.current_approval_id is distinct from a.id then raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='PT409'; end if;
    if a.status<>'pending' then
      if a.status<>(case when decision='approve' then 'approved' else 'denied' end) then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='PT409'; end if;
    else
      update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,decided_at=now(),decided_by=actor.id where id=a.id returning * into a;
      update suspend_tag_private.workflows set status=a.status,version=version+1,updated_at=now() where source_uid=uid;
      if decision='deny' then update public.ph_soc_master set date_completed=null where unique_id=uid; end if;
      insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
        values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),now()) returning public.ph_request_delivery_outbox.event_id into event_id;
      update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
    end if;
    result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
  else
    if p_operation not in ('save','complete') and (not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz) then raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='PT409'; end if;
    if p_operation not in ('save','complete') and p_expected_version is not null and w.version<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='PT409'; end if;
    if w.source_revision is distinct from s.last_updated then
      update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
      update suspend_tag_private.workflows set source_revision=s.last_updated,status='pending',completed_by=null,completed_at=null,current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
    end if;
    if p_operation in ('save','complete') then
      if w.status in ('awaiting_rep','approved') then
        update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
        update suspend_tag_private.workflows set status='pending',current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
      end if;
      was_denied:=w.status='denied'; patch:=coalesce(p_payload->'patch','{}');
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','av_note','match','loc_match_qty','initial_ptr','pick_note','sales_note'])) then raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
      -- Preserve concurrent photos while allowing field edits on the latest locked source.
      if patch ? 'dock_photo_link' then
        patch:=jsonb_set(patch,'{dock_photo_link}',to_jsonb(coalesce((select string_agg(distinct btrim(link),',') from unnest(string_to_array(concat_ws(',',nullif(s.dock_photo_link,''),nullif(patch->>'dock_photo_link','')),',')) link where btrim(link)<>''),'')),true);
      end if;
      edited:=jsonb_populate_record(s,patch);
      if p_operation='complete' then edited:=suspend_tag_private.existing_review(edited); end if;
      if p_operation='complete' then perform suspend_tag_private.validate_review(edited); end if;
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr,pick_note=edited.pick_note,sales_note=edited.sales_note where unique_id=uid returning * into s;
      -- Share evidence only; each physical tag keeps its own completion/approval state.
      update public.ph_soc_master sibling set
        dock_photo_link=coalesce(nullif(s.dock_photo_link,''),sibling.dock_photo_link),
        dock_photo_name=coalesce(nullif(s.dock_photo_name,''),sibling.dock_photo_name),
        dock_spec=coalesce(nullif(s.dock_spec,''),sibling.dock_spec),
        av_note=coalesce(nullif(s.av_note,''),sibling.av_note),
        match=coalesce(nullif(s.match,''),sibling.match)
      where sibling.itemcode=s.itemcode and sibling.unique_id<>uid
        and sibling.locationcode=s.locationcode and coalesce(sibling.lotcode,'')=coalesce(s.lotcode,'') and coalesce(sibling.source,'')=coalesce(s.source,'')
        and suspend_tag_private.eligible(sibling.suspend,sibling.suspend_to)
        and sibling.date_completed is null
        and not exists(select 1 from suspend_tag_private.workflows locked
          where locked.source_uid=sibling.unique_id and locked.status in ('awaiting_rep','approved'));
      inventory_result:=suspend_tag_private.publish_inventory_evidence_v23119(p_actor_id,s,p_payload,p_command_id);
      if p_operation='complete' then
        update public.ph_soc_master set date_completed=clock_timestamp() where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=s.date_completed,version=version+1,updated_at=now() where source_uid=uid;
        if was_denied then approval_id:=suspend_tag_private.request_approval(uid); end if;
      end if;
    elsif p_operation='send' then
      approval_id:=suspend_tag_private.request_approval(uid);
    elsif p_operation='retry' then
      if w.current_approval_id is null then raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023'; end if;
      update public.ph_request_delivery_outbox as outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null
        where outbox.event_id in(select request_event_id from suspend_tag_private.approvals where id=w.current_approval_id) and outbox.status='failed';
    else raise exception 'SUSPEND_TAG_OPERATION_INVALID' using errcode='22023';
    end if;
    result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
  end if;
  result:=result||inventory_result;
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $function$
;
CREATE OR REPLACE FUNCTION suspend_tag_private.group_command(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare actor public.profiles; s public.ph_soc_master; r public.ph_soc_master; m public.ph_master_inventory;
 a suspend_tag_private.approvals; w suspend_tag_private.workflows; receipt suspend_tag_private.commands;
 input jsonb; result jsonb; candidates jsonb; candidate jsonb; group_key text; uid text; candidate_uid text;
 chosen text; decision text; remaining integer; event_id uuid; ids text[]; custom jsonb; custom_location text; custom_lot text; custom_uid text; stamp timestamptz:=clock_timestamp();
begin
 if p_operation not in ('add_candidates','send','approval','decide','inbox','close','dock_review') then
   return suspend_tag_private.command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_version);
 end if;
 actor:=suspend_tag_private.actor(p_actor_id);
 if p_operation='inbox' then
   return jsonb_build_object('approvals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from
     (select a.id,a.status,a.snapshot,a.created_at from suspend_tag_private.approvals a where a.status='pending'
       and (a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) order by a.created_at desc limit 100) x));
 end if;
 if p_operation in ('approval','decide') then
   select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
   if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)
       and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER')
       and not (p_operation='approval' and actor.username='dan_mccuistion')) then
     raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
   end if;
   uid:=a.source_uid;
 else
   if p_operation='dock_review' then
     if not private.is_full_app_administrator_v1(actor.username)
       and regexp_replace(upper(actor.role),'[^A-Z]','','g') not in ('QCSUPERVISOR','QCSUP') then
       raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
   elsif regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in
      ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER','SALESREP')
      and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then
      raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
   uid:=case when p_operation='add_candidates' then suspend_tag_private.resolve_edit_source_v23107(p_payload) else p_payload->>'sourceUid' end;
 end if;
 -- suspend-physical-identity-v2394: resolve stale UIDs before the former early missing-source guard.
 select * into s from public.ph_soc_master where unique_id=uid;
 if s.unique_id is null and p_operation='close' and jsonb_typeof(p_payload->'sourceIdentity')='object' then
   select candidate.* into s from public.ph_soc_master candidate
   where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)
     and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'itemcode','')))
     and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'locationcode','')))
     and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
     and upper(btrim(coalesce(candidate.dock,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'dock','')))
     and upper(btrim(coalesce(candidate.stopnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'stopnumber','')))
     and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'quantityshipped','')),'') is null
       or coalesce(nullif(regexp_replace(candidate.quantityshipped,'[^0-9.-]','','g'),''),'0')::numeric
        =coalesce(nullif(regexp_replace(p_payload->'sourceIdentity'->>'quantityshipped','[^0-9.-]','','g'),''),'0')::numeric)
     and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'tagcode','')),'') is null
       or upper(btrim(coalesce(candidate.tagcode,'')))=upper(btrim(p_payload->'sourceIdentity'->>'tagcode')))
   order by candidate.last_updated desc,candidate.unique_id limit 1;
   if s.unique_id is not null then uid:=s.unique_id; end if;
 end if;
 -- suspend-add-candidates-physical-identity-v2397: exact one-row recovery only.
 if s.unique_id is null and p_operation='add_candidates' and jsonb_typeof(p_payload->'sourceIdentity')='object' then
   select min(candidate.unique_id) into candidate_uid from public.ph_soc_master candidate
   where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)
     and nullif(btrim(p_payload->'sourceIdentity'->>'transactionnumber'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'tagcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'dock'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'stopnumber'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'itemcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'locationcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'lotcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'quantityshipped'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'customer'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'consignee'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'salesrep'),'') is not null
     and upper(btrim(candidate.transactionnumber))=upper(btrim(p_payload->'sourceIdentity'->>'transactionnumber'))
     and upper(btrim(candidate.tagcode))=upper(btrim(p_payload->'sourceIdentity'->>'tagcode'))
     and upper(btrim(candidate.dock))=upper(btrim(p_payload->'sourceIdentity'->>'dock'))
     and upper(btrim(candidate.stopnumber))=upper(btrim(p_payload->'sourceIdentity'->>'stopnumber'))
     and upper(btrim(candidate.itemcode))=upper(btrim(p_payload->'sourceIdentity'->>'itemcode'))
     and upper(btrim(candidate.locationcode))=upper(btrim(p_payload->'sourceIdentity'->>'locationcode'))
     and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
     and coalesce(nullif(regexp_replace(candidate.quantityshipped,'[^0-9.-]','','g'),''),'0')::numeric
       =coalesce(nullif(regexp_replace(p_payload->'sourceIdentity'->>'quantityshipped','[^0-9.-]','','g'),''),'0')::numeric
     and upper(btrim(coalesce(candidate.customeridentityid,candidate.customername,'')))=upper(btrim(p_payload->'sourceIdentity'->>'customer'))
     and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'')))=upper(btrim(p_payload->'sourceIdentity'->>'consignee'))
     and upper(btrim(coalesce(candidate.salesrepid,candidate.salesrepname,'')))=upper(btrim(p_payload->'sourceIdentity'->>'salesrep'))
   having count(*)=1;
   if candidate_uid is not null then
     select * into s from public.ph_soc_master candidate where candidate.unique_id=candidate_uid for update;
     uid:=candidate_uid;
     p_payload:=jsonb_set(p_payload,'{expectedLastUpdated}',to_jsonb(s.last_updated::text),true);
   end if;
 end if;
 if s.unique_id is null then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
 if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g')='SALESREP'
    and (suspend_tag_private.rep_for_row(s)).id is distinct from actor.id then
   raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
 end if;
 group_key:=suspend_tag_private.order_key(s);
 if p_operation='approval' then
   candidates:=coalesce(a.snapshot->'candidates',jsonb_build_array(a.snapshot));
   select coalesce(jsonb_agg(candidate.value||jsonb_build_object('candidate_state',coalesce(r.suspend_candidate_state,'candidate'))),'[]') into candidates
    from jsonb_array_elements(candidates) candidate left join public.ph_soc_master r on r.unique_id=candidate.value->>'unique_id';
   return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','candidates',candidates,
     'canDecide',a.status='pending' and (a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)));
 end if;
 if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
 input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
 select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
 if found then
   if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
   return receipt.response;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('suspend-tag-review-item:'||s.itemcode,0));
 perform pg_advisory_xact_lock(hashtextextended('suspend-order:'||group_key,0));
 -- suspend-close-stable-identity-v2392: close the active physical tag even when an import changes its UID or timestamp.
 select * into s from public.ph_soc_master where unique_id=uid for update;
 if p_operation='close' and (s.unique_id is null or not suspend_tag_private.eligible(s.suspend,s.suspend_to))
    and jsonb_typeof(p_payload->'sourceIdentity')='object' then
   select candidate.* into s from public.ph_soc_master candidate
    where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)
      and upper(btrim(coalesce(candidate.transactionnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'transactionnumber','')))
      and upper(btrim(coalesce(candidate.dock,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'dock','')))
      and upper(btrim(coalesce(candidate.stopnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'stopnumber','')))
      and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'itemcode','')))
      and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'locationcode','')))
      and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
      -- suspend-physical-identity-v2394: shipped quantity/tag disambiguate duplicate physical order lines.
      and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'quantityshipped','')),'') is null
        or coalesce(nullif(regexp_replace(candidate.quantityshipped,'[^0-9.-]','','g'),''),'0')::numeric
          =coalesce(nullif(regexp_replace(p_payload->'sourceIdentity'->>'quantityshipped','[^0-9.-]','','g'),''),'0')::numeric)
      and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'tagcode','')),'') is null
        or upper(btrim(coalesce(candidate.tagcode,'')))=upper(btrim(p_payload->'sourceIdentity'->>'tagcode')))
      and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'consignee','')))
    order by candidate.last_updated desc,candidate.unique_id limit 1 for update;
   if s.unique_id is not null then uid:=s.unique_id; end if;
 end if;
 if p_operation<>'decide' then
   if p_operation<>'dock_review' and not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
   if p_operation not in ('close','add_candidates') and (not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz) then
     raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='PT409'; end if;
   select * into w from suspend_tag_private.workflows where source_uid=uid for update;
   if p_operation<>'add_candidates' and p_expected_version is not null and coalesce(w.version,0)<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='PT409'; end if;
 end if;
 if p_operation='dock_review' then
   if suspend_tag_private.eligible(s.suspend,s.suspend_to) then
     raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023';
   end if;
   if jsonb_typeof(p_payload->'patch')<>'object' or exists(select 1 from jsonb_object_keys(p_payload->'patch') k
      where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','date_completed','av_note','match','loc_match_qty','initial_ptr'])) then
     raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
   r:=jsonb_populate_record(s,p_payload->'patch');
   update public.ph_soc_master set dock_spec=r.dock_spec,dock_caliper=r.dock_caliper,dock_note=r.dock_note,
      dock_photo_link=r.dock_photo_link,dock_photo_name=r.dock_photo_name,date_completed=r.date_completed,
      av_note=r.av_note,match=r.match,loc_match_qty=r.loc_match_qty,initial_ptr=r.initial_ptr where unique_id=uid;
   insert into suspend_tag_private.workflows(source_uid,source_revision,status)
      values(uid,s.last_updated,'pending') on conflict(source_uid) do update set version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='add_candidates' then
   -- suspend-fill-tag-v2390: existing or user-entered real nursery rows share one candidate path.
   if jsonb_typeof(coalesce(p_payload->'inventoryIds','[]'::jsonb))<>'array'
      or jsonb_typeof(coalesce(p_payload->'customRows','[]'::jsonb))<>'array'
      or jsonb_array_length(coalesce(p_payload->'inventoryIds','[]'::jsonb))
        + jsonb_array_length(coalesce(p_payload->'customRows','[]'::jsonb)) not between 1 and 30 then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   select coalesce(array_agg(distinct value),'{}'::text[]) into ids
     from jsonb_array_elements_text(coalesce(p_payload->'inventoryIds','[]'::jsonb));
   for custom in select value from jsonb_array_elements(coalesce(p_payload->'customRows','[]'::jsonb)) loop
     if jsonb_typeof(custom)<>'object' or custom-jsonb_build_object('locationcode',custom->'locationcode','lotcode',custom->'lotcode')<>'{}'::jsonb then
       raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
     custom_location:=upper(btrim(coalesce(custom->>'locationcode','')));
     custom_lot:=upper(btrim(coalesce(custom->>'lotcode','')));
     if custom_location!~'^[A-Z0-9]+([.][A-Z0-9]+){1,2}$' or custom_location~'^0+[.]0+[.]111$'
        or custom_lot!~'^[0-9]{2}[.](F1|S1|U1|U2|U3|X|Y|Z)$' then
       raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
     m:=null;
     select candidate.* into m from public.ph_master_inventory candidate
       where upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(s.itemcode,'')))
         and upper(btrim(coalesce(candidate.locationcode,'')))=custom_location
         and upper(btrim(coalesce(candidate.lotcode,'')))=custom_lot
       order by candidate.unique_id limit 1;
     if m.unique_id is null then
       select candidate.* into m from public.ph_master_inventory candidate
         where upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(s.itemcode,'')))
         order by (upper(btrim(coalesce(candidate.contsize,'')))=upper(btrim(coalesce(s.contsize,'')))) desc,candidate.unique_id limit 1;
       if m.unique_id is null then raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
       custom_uid:='suspend-fill-'||md5(upper(s.itemcode)||':'||custom_location||':'||custom_lot);
       m:=jsonb_populate_record(null::public.ph_master_inventory,to_jsonb(m)||jsonb_build_object(
         'unique_id',custom_uid,'locationcode',custom_location,'lotcode',custom_lot,'season',split_part(custom_lot,'.',2),
         'saleyear',split_part(custom_lot,'.',1),'source','Suspend Fill Tag','last_updated',stamp,
         'ptronhand','0','ptrreviewed','0','ptravailable','0','s_lts','0','season_supply','0','season_oh','0',
         'season_demand','0','season_available','0','loc_match_qty',null,'initial_ptr','0','photos','[]'::jsonb,
         'photo_link',null,'photo_name',null,'photo_url',null,'photo_date',null,'spec',null,'caliper',null,
         'match',null,'loc_match_pct',null,'loc_photo_match',null,'av_note',null,'pick_note',null,'sales_note',null,
         'concat','suspend-fill-tag-v2390:'||custom_uid));
       insert into public.ph_master_inventory select (m).* on conflict(unique_id) do nothing;
     end if;
     ids:=array_append(ids,m.unique_id);
   end loop;
   select array_agg(distinct value order by value) into ids from unnest(ids) value;
   if cardinality(ids) not between 1 and 30 or exists(select 1 from unnest(ids) x left join public.ph_master_inventory m on m.unique_id=x
      where m.unique_id is null or regexp_replace(rtrim(upper(m.itemcode),'.'),'[.]1$','')<>regexp_replace(rtrim(upper(s.itemcode),'.'),'[.]1$','') or nullif(btrim(m.locationcode),'') is null or m.locationcode~'^0+[.]0+[.]111$') then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   -- Authorized additions begin a fresh round; prior frozen approval snapshots remain immutable.
   -- Supersede the prior frozen round before adding a new choice.
   update suspend_tag_private.approvals a set status='superseded' where a.status='pending' and a.id in
     (select w.current_approval_id from suspend_tag_private.workflows w join public.ph_soc_master r on r.unique_id=w.source_uid
       where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key);
   update public.ph_soc_master r set suspend_candidate_group=group_key,suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),
       suspend_origin_uid=coalesce(r.suspend_origin_uid,uid),suspend_candidate_state='candidate'
     where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key and suspend_tag_private.eligible(r.suspend,r.suspend_to);
   for m in select * from public.ph_master_inventory where unique_id=any(ids) order by unique_id loop
     if exists(select 1 from public.ph_soc_master r where r.suspend_candidate_group=group_key
         and r.locationcode=m.locationcode and coalesce(r.lotcode,'')=coalesce(m.lotcode,'') and r.suspend_candidate_state='candidate') then continue; end if;
     candidate_uid:='suspend-option-'||md5(group_key||':'||m.unique_id);
     r:=jsonb_populate_record(null::public.ph_soc_master,to_jsonb(s)||jsonb_build_object(
       'unique_id',candidate_uid,'source','Suspend Tag AV Option','locationcode',m.locationcode,'lotcode',m.lotcode,
       'last_updated',stamp,'date_completed',null,'quantityordered',coalesce(s.suspend_order_quantity,s.quantityordered),
       'quantityshipped','0','suspend','SUSPEND','suspend_to','dc','suspend_candidate_group',group_key,'suspend_candidate_state','candidate',
       'suspend_origin_uid',coalesce(s.suspend_origin_uid,uid),'suspend_order_quantity',coalesce(s.suspend_order_quantity,s.quantityordered),
       'ptronhand',m.ptronhand,'ptravailable',m.ptravailable,'ptrreviewed',m.ptrreviewed,'s_lts',m.s_lts,'priority',m.priority,
       'season',m.season,'dock_spec',m.spec,'dock_caliper',m.caliper,'av_note',m.av_note,'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason,
       'dock_photo_link',m.photo_link,'dock_photo_name',m.photo_name,'photo_link',m.photo_link,'photo_name',m.photo_name,'photo_url',m.photo_url,'photos',m.photos,'pick_note',m.pick_note,'sales_note',m.sales_note,'match',m.match,'loc_match_qty',m.loc_match_qty));
     insert into public.ph_soc_master select (r).* on conflict(unique_id) do nothing;
   end loop;
   update public.ph_soc_master r set suspend_candidate_state='replaced',suspend=null,suspend_to=null,quantityordered='0',date_completed=stamp
     where r.suspend_candidate_group=group_key and suspend_tag_private.is_false_block_v2378(r.locationcode);
   insert into suspend_tag_private.workflows(source_uid,source_revision,status)
     select r.unique_id,r.last_updated,'pending' from public.ph_soc_master r where r.suspend_candidate_group=group_key
     on conflict(source_uid) do update set current_approval_id=null,status='pending',version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   result:=jsonb_build_object('ok',true,
     'added_rows',(select count(*) from public.ph_soc_master c where c.suspend_candidate_group=group_key and c.last_updated=stamp and c.suspend_candidate_state='candidate'),
     'removed_false_block',exists(select 1 from public.ph_soc_master c where c.suspend_candidate_group=group_key and c.locationcode='0.00.111' and c.suspend_candidate_state='replaced'));
 elsif p_operation='send' then
   -- The clicked row retains the existing completion and sender checks.
   result:=suspend_tag_private.command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_version);
   select a2.* into a from suspend_tag_private.approvals a2 join suspend_tag_private.workflows w2 on w2.current_approval_id=a2.id where w2.source_uid=uid;
   if a.snapshot->'candidates' is null then
     select jsonb_agg(to_jsonb(suspend_tag_private.existing_review(r)) order by r.locationcode,r.lotcode,r.unique_id) into candidates
       from public.ph_soc_master r where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key
         and suspend_tag_private.eligible(r.suspend,r.suspend_to) and coalesce(r.suspend_candidate_state,'candidate') not in ('denied','canceled','replaced') and not suspend_tag_private.is_false_block_v2378(r.locationcode) and not suspend_tag_private.is_false_block_v2378(r.locationcode) and not suspend_tag_private.is_false_block_v2378(r.locationcode);
     update suspend_tag_private.approvals set snapshot=snapshot||jsonb_build_object('candidates',candidates,'candidate_group_key',group_key) where id=a.id;
     update public.ph_soc_master r set suspend_candidate_group=group_key,suspend_candidate_state='candidate',
       suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),suspend_origin_uid=coalesce(r.suspend_origin_uid,uid)
       where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates));
     insert into suspend_tag_private.workflows(source_uid,source_revision,status,current_approval_id)
       select r.unique_id,r.last_updated,'awaiting_rep',a.id from public.ph_soc_master r
       where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates))
       on conflict(source_uid) do update set status='awaiting_rep',current_approval_id=a.id,version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   end if;
   result:=result||jsonb_build_object('notification',jsonb_build_object('approvalId',a.id,'repUsername',a.snapshot->>'rep_username',
     'senderDisplay',a.snapshot->>'sent_by_display','customer',coalesce(a.snapshot->>'customername',a.snapshot->>'consigneename'),
     'itemDescription',concat_ws(' ',a.snapshot->>'commonname',a.snapshot->>'contsize')));
 elsif p_operation='close' then
   insert into public.ph_productivity_history(event_key,completed_by_username,completed_by_display,completed_at,
     source_table,source_kind,source_unique_id,source_assignment,itemcode,commonname,contsize,locationcode,lotcode,
     customer_name,request_folder,snapshot)
   values('suspend-tag-complete:'||uid,actor.username,coalesce(nullif(actor.display_name,''),actor.username),stamp,
     'ph_soc_master','Suspend Tag',uid,to_jsonb(s)->>'assignedto',s.itemcode,s.commonname,s.contsize,s.locationcode,s.lotcode,
     coalesce(to_jsonb(s)->>'customername',to_jsonb(s)->>'consigneename'),to_jsonb(s)->>'request_folder',
     to_jsonb(s)||jsonb_build_object('completed_at',stamp,'completed_by_username',actor.username))
   on conflict(event_key) do nothing;
   update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
   update public.ph_soc_master set suspend=null,suspend_to=null,date_completed=stamp where unique_id=uid;
   update suspend_tag_private.workflows set status='completed',current_approval_id=null,version=version+1,updated_at=stamp where source_uid=uid;
   result:=jsonb_build_object('ok',true,'completed',true,'unique_id',uid,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='decide' then
   select * into a from suspend_tag_private.approvals where id=a.id for update;
   if a.status<>'pending' then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='PT409'; end if;
   decision:=p_payload->>'decision'; chosen:=nullif(p_payload->>'candidateUid','');
   if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
   candidates:=coalesce(a.snapshot->'candidates',jsonb_build_array(a.snapshot));
   if decision='approve' and chosen is null then chosen:=a.source_uid; end if;
   if chosen is not null and not exists(select 1 from jsonb_array_elements(candidates) x where x->>'unique_id'=chosen) then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   for candidate in select value from jsonb_array_elements(candidates) order by value->>'unique_id' loop
     select * into r from public.ph_soc_master where unique_id=candidate->>'unique_id' for update;
     if r.unique_id is null or r.last_updated is distinct from (candidate->>'last_updated')::timestamptz
       or not exists(select 1 from suspend_tag_private.workflows w where w.source_uid=r.unique_id and w.current_approval_id=a.id) then
       raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='PT409'; end if;
     if r.unique_id=chosen and r.suspend_candidate_state in ('denied','canceled','replaced') then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='PT409'; end if;
   end loop;
   update public.ph_soc_master r set
     suspend_candidate_group=group_key,suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),
     suspend_candidate_state=case when decision='approve' and r.unique_id=chosen then 'approved' else 'denied' end,
     quantityordered=case when decision='approve' and r.unique_id=chosen then coalesce(r.suspend_order_quantity,r.quantityordered) else '0' end,
     suspend=null,suspend_to=null,date_completed=stamp
     where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)) and (decision='approve' or chosen is null or r.unique_id=chosen);
   update suspend_tag_private.workflows w set status=r.suspend_candidate_state,version=w.version+1,updated_at=stamp
     from public.ph_soc_master r where r.unique_id=w.source_uid and w.current_approval_id=a.id and r.suspend_candidate_state in ('approved','denied');
   select count(*) into remaining from public.ph_soc_master r where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)) and suspend_tag_private.eligible(r.suspend,r.suspend_to);
   if decision='approve' or remaining=0 then
     if decision='deny' then update public.ph_soc_master r set suspend_candidate_state='canceled' where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)); end if;
     update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,
       selected_source_uid=case when decision='approve' then chosen end,decided_at=stamp,decided_by=actor.id where id=a.id returning * into a;
     begin
       insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
         values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),stamp)
         returning public.ph_request_delivery_outbox.event_id into event_id;
       update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
     exception when others then event_id:=null; end;
   end if;
   result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
 end if;
 if p_operation in ('send','close') then result:=result||jsonb_build_object('row',suspend_tag_private.row_json(uid)); end if;
 result:=result||jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]')
    from public.ph_soc_master r where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key));
 insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result)
   on conflict(actor_id,command_id) do update set response=excluded.response;
 return result;
end $function$
;

-- One canonical engine owns all public evidence aliases and the exact note row.
CREATE OR REPLACE FUNCTION public.save_drive_evidence_v3(p_master_uid text, p_expected_itemcode text, p_expected_locationcode text, p_expected_lotcode text, p_expected_signature text, p_baseline jsonb, p_evidence jsonb, p_complete boolean, p_workflow text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles%rowtype;
  current_row public.ph_master_inventory%rowtype;
  saved_row public.ph_master_inventory%rowtype;
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  prior private.drive_evidence_idempotency%rowtype;
  payload jsonb:=coalesce(p_evidence,'{}'::jsonb);
  unexpected text[];
  stable_item text:=upper(btrim(coalesce(p_expected_itemcode,'')));
  stable_location text:=upper(btrim(coalesce(p_expected_locationcode,'')));
  workflow text:=lower(btrim(coalesce(p_workflow,'')));
  saved_at timestamptz:=clock_timestamp();
  request_hash text;
  storage_key text:='location-v3-'||md5(coalesce(p_idempotency_key,''));
  response jsonb;
  request_rows jsonb:='[]'::jsonb;
  location_rows jsonb:='[]'::jsonb;
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
begin
  actor:=private.require_drive_live_change_profile_v2392(p_master_uid,p_expected_itemcode,p_expected_locationcode,p_expected_lotcode);
  if stable_item='' or stable_location='' then raise exception using errcode='22023',message='INVALID_MASTER_IDENTITY'; end if;
  if char_length(btrim(coalesce(p_idempotency_key,''))) not between 12 and 180 then raise exception using errcode='22023',message='INVALID_IDEMPOTENCY_KEY'; end if;
  if workflow not in ('season','location','notes') then raise exception using errcode='22023',message='INVALID_DRIVE_WORKFLOW'; end if;
  if jsonb_typeof(payload)<>'object' or jsonb_typeof(coalesce(p_baseline,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='INVALID_EVIDENCE_PAYLOAD'; end if;
  select array_agg(key order by key) into unexpected from jsonb_object_keys(payload) keys(key)
  where key not in ('spec','caliper','match','loc_match_qty','initial_ptr','av_note','pick_note','comments','photo_link','photo_name');
  if coalesce(cardinality(unexpected),0)>0 then raise exception using errcode='22023',message='UNSUPPORTED_DRIVE_EVIDENCE_FIELD'; end if;
  if octet_length(payload::text)>65536 or octet_length(coalesce(p_baseline,'{}'::jsonb)::text)>65536 then raise exception using errcode='22023',message='DRIVE_EVIDENCE_PAYLOAD_TOO_LARGE'; end if;
  if payload?'match' and nullif(btrim(payload->>'match'),'') is not null
    and payload->>'match' !~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then raise exception using errcode='22023',message='INVALID_LOC_MATCH_PERCENT'; end if;
  if payload?'photo_link' and octet_length(coalesce(payload->>'photo_link',''))>16000 then raise exception using errcode='22023',message='PHOTO_REFERENCE_TOO_LARGE'; end if;
  request_hash:=md5(concat_ws('|',stable_item,stable_location,payload::text,coalesce(p_complete,false)::text,workflow));
  select * into prior from private.drive_evidence_idempotency
  where profile_id=actor.id and idempotency_key=storage_key;
  if found then
    if prior.request_hash<>request_hash then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT','canonicalConfirmed',false,'retryBlocked',true); end if;
    return jsonb_set(prior.response_payload,'{recovered}','true'::jsonb,true);
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('drive-location-idempotency:'||actor.id::text||':'||storage_key,0))
    or not pg_try_advisory_xact_lock(hashtextextended('drive-row:'||p_master_uid,0)) then
    return jsonb_build_object('ok',false,'code','DRIVE_SAVE_BUSY','canonicalConfirmed',false,'retryAfterMs',250,'retryBlocked',false);
  end if;
  select * into current_row from public.ph_master_inventory m
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if not found then return jsonb_build_object('ok',false,'code','DRIVE_ROW_NOT_FOUND','canonicalConfirmed',true,'retryBlocked',false); end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=btrim(p_master_uid);
  if not found then
    evidence.itemcode_key:=stable_item;evidence.locationcode_key:=stable_location;
    evidence.itemcode:=current_row.itemcode;evidence.locationcode:=current_row.locationcode;
    evidence.spec:=current_row.spec;evidence.caliper:=current_row.caliper;evidence.match:=current_row.match;
    evidence.loc_match_qty:=current_row.loc_match_qty;evidence.initial_ptr:=current_row.initial_ptr;
    evidence.av_note:=current_row.av_note;evidence.pic_note:=current_row.pic_note;evidence.sales_note:=current_row.sales_note;
    evidence.photo_link:=current_row.photo_link;evidence.photo_name:=current_row.photo_name;
    evidence.date_completed:=current_row.date_completed;evidence.app_tab_assignment:=current_row.app_tab_assignment;
  end if;
  if payload?'spec' then evidence.spec:=nullif(btrim(payload->>'spec'),''); end if;
  if payload?'caliper' then evidence.caliper:=nullif(btrim(payload->>'caliper'),''); end if;
  if payload?'match' then evidence.match:=nullif(btrim(payload->>'match'),''); end if;
  if payload?'loc_match_qty' then evidence.loc_match_qty:=nullif(btrim(payload->>'loc_match_qty'),''); end if;
  if payload?'initial_ptr' then evidence.initial_ptr:=nullif(btrim(payload->>'initial_ptr'),''); end if;
  if payload?'av_note' then evidence.av_note:=nullif(btrim(payload->>'av_note'),''); end if;
  if payload?'pick_note' then evidence.pic_note:=nullif(btrim(payload->>'pick_note'),''); end if;
  if payload?'comments' then evidence.sales_note:=nullif(payload->>'comments',''); end if;
  if payload?'photo_link' then evidence.photo_link:=nullif(btrim(payload->>'photo_link'),''); end if;
  if payload?'photo_name' then evidence.photo_name:=nullif(btrim(payload->>'photo_name'),''); end if;
  if coalesce(p_complete,false) then evidence.date_completed:=saved_at;evidence.app_tab_assignment:=workflow; end if;
  evidence.source_unique_id:=current_row.unique_id;evidence.updated_at:=saved_at;evidence.updated_by:=lower(btrim(actor.username));
  insert into app_sync_private.inventory_location_evidence_v1 select (evidence).*
  on conflict(source_unique_id) do update set
    itemcode=excluded.itemcode,locationcode=excluded.locationcode,source_unique_id=excluded.source_unique_id,
    spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,
    initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,
    photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,
    app_tab_assignment=excluded.app_tab_assignment,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  perform set_config('gnc.inventory_edit_actor',lower(btrim(actor.username)),true);
  update public.ph_master_inventory m set
    spec=evidence.spec,caliper=evidence.caliper,match=evidence.match,
    loc_match_qty=private.inventory_location_match_qty_v1(m.ptronhand,evidence.match,evidence.loc_match_qty),
    loc_match_pct=private.reclass_numeric_v1(evidence.match),
    loc_photo_match=private.reclass_numeric_v1(private.inventory_location_match_qty_v1(m.ptronhand,evidence.match,evidence.loc_match_qty)),
    pick_note=evidence.pic_note,
    initial_ptr=evidence.initial_ptr,av_note=evidence.av_note,pic_note=evidence.pic_note,sales_note=evidence.sales_note,
    photo_link=evidence.photo_link,photo_name=evidence.photo_name,date_completed=evidence.date_completed,
    photo_url=CASE WHEN payload?'photo_link' THEN nullif(split_part(coalesce(evidence.photo_link,''),',',1),'') ELSE m.photo_url END,
    photos=CASE WHEN payload?'photo_link' THEN coalesce(to_jsonb(string_to_array(nullif(evidence.photo_link,''),',')),'[]'::jsonb) ELSE m.photos END,
    photo_date=CASE WHEN payload?'photo_link' THEN CASE WHEN nullif(evidence.photo_link,'') IS NULL THEN NULL ELSE saved_at END ELSE m.photo_date END,
    app_tab_assignment=evidence.app_tab_assignment,
    av_rule_spec_updated_at=case when payload?'spec' then saved_at else m.av_rule_spec_updated_at end,
    av_rule_caliper_updated_at=case when payload?'caliper' then saved_at else m.av_rule_caliper_updated_at end,
    av_rule_match_updated_at=case when payload?'match' then saved_at else m.av_rule_match_updated_at end,
    av_rule_av_note_updated_at=case when payload?'av_note' then saved_at else m.av_rule_av_note_updated_at end,
    av_rule_photo_updated_at=case when payload?'photo_link' or payload?'photo_name' then saved_at else m.av_rule_photo_updated_at end,
    av_rule_bundle_updated_at=case when payload<>'{}'::jsonb then saved_at else m.av_rule_bundle_updated_at end,
    last_updated=saved_at
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  select * into saved_row from public.ph_master_inventory m
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  select coalesce(jsonb_agg(to_jsonb(m) order by private.eval_work_natural_sort_key_v1(m.locationcode),private.eval_work_natural_sort_key_v1(m.lotcode),m.unique_id),'[]'::jsonb)
    into location_rows from public.ph_master_inventory m
    where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;

  insert into public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,updated_by,updated_at)
  values(saved_row.unique_id,coalesce(saved_row.source,''),saved_row.itemcode,saved_row.locationcode,coalesce(saved_row.lotcode,''),saved_row.photo_link,saved_row.photo_name,saved_row.spec,saved_row.caliper,saved_row.loc_match_pct,saved_row.av_note,saved_row.pick_note,saved_row.sales_note,actor.id,clock_timestamp())
  on conflict(unique_id) do update set source=excluded.source,itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode,photo_link=excluded.photo_link,photo_name=excluded.photo_name,spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  with changed as (
    update public.ph_requests_pending request set
      req_spec=evidence.spec,req_caliper=evidence.caliper,
      req_match=case when evidence.match ~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then evidence.match::numeric else null end,
      req_pic_note=evidence.pic_note,req_sales_note=evidence.sales_note,req_comments=evidence.sales_note,
      av_note=evidence.av_note,req_photo_link=evidence.photo_link,req_photo_name=evidence.photo_name,
      req_status=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then 'Complete' else request.req_status end,
      date_completed=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then saved_at::text else request.date_completed end,
      completed_by_username=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then lower(btrim(actor.username)) else request.completed_by_username end,
      completed_by_display=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then coalesce(nullif(btrim(actor.display_name),''),actor.username) else request.completed_by_display end,
      app_tab_assignment=evidence.app_tab_assignment,master_app_tab_assignment=evidence.app_tab_assignment,
      row_version=coalesce(request.row_version,0)+1,updated_at=saved_at
    where upper(btrim(coalesce(request.itemcode,'')))=stable_item
      and upper(btrim(coalesce(request.locationcode,'')))=stable_location
      and request.master_id=saved_row.unique_id
      and coalesce(request.req_archived,false)=false
      and lower(btrim(coalesce(request.req_status,'pending'))) not in ('complete','completed','done','archived','cancelled','canceled')
    returning request.*
  ) select coalesce(jsonb_agg(to_jsonb(changed) order by changed.unique_id),'[]'::jsonb) into request_rows from changed;
  response:=jsonb_build_object('ok',true,'code','SAVED','contractVersion','save-drive-evidence-v3-row-isolation',
    'row',to_jsonb(saved_row),'locationRows',location_rows,'requestRows',request_rows,'completed',coalesce(p_complete,false),
    'canonicalConfirmed',true,'mergedUnrelatedChanges',true,'retryBlocked',false,'recovered',false);
  insert into private.drive_evidence_idempotency(profile_id,idempotency_key,request_hash,response_payload,outcome_code)
  values(actor.id,storage_key,request_hash,response,'SAVED');
  return response;
end
$function$
;
DO $matrix_project$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.create_inventory_project_v1(uuid,uuid,jsonb)'::regprocedure) INTO definition;
 IF position('PROJECT_ACCESS_MATRIX_REQUIRED' IN definition)=0 THEN
  IF position('IF p_project_id IS NULL' IN definition)=0 THEN RAISE EXCEPTION 'PROJECT_MATRIX_PATCH_ANCHOR_MISSING'; END IF;
  definition:=replace(definition,'IF p_project_id IS NULL','IF coalesce((SELECT create_project FROM public.user_access WHERE profile_id=actor.id),''N'')<>''Y'' THEN RAISE EXCEPTION ''PROJECT_ACCESS_MATRIX_REQUIRED'' USING errcode=''42501''; END IF; IF p_project_id IS NULL');EXECUTE definition;
 END IF;
END $matrix_project$;

NOTIFY pgrst,'reload schema';
COMMIT;
