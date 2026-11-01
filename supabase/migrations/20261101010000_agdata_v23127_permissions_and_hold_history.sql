BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';

CREATE OR REPLACE FUNCTION public.set_itemcode_default_owners_v1(p_changes jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles;
  source_revision bigint;
  normalized jsonb;
  request_hash text;
  prior_command private.ph_itemcode_default_owner_commands;
  changed_itemcodes text[] := array[]::text[];
  defaults_result jsonb := '[]'::jsonb;
  assignments_result jsonb;
  changed_rows integer := 0;
  row_to_resolve record;
  response jsonb;
  change_count integer;
begin
  actor := private.current_active_profile();
  if actor.id is null or not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'ITEMCODE_DEFAULT_OWNER_FORBIDDEN';
  end if;
  if not exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active) then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_POLICY_NOT_ACTIVE';
  end if;
  if p_request_id is null or jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 500 then
    raise exception using errcode = '22023', message = 'ITEMCODE_DEFAULT_OWNER_REQUEST_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_changes) e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(e.value) as keys(key) where keys.key not in ('itemcode','assignedto','expectedRevision'))
      or nullif(btrim(e.value->>'itemcode'), '') is null
      or coalesce(e.value->>'expectedRevision', '') !~ '^[0-9]{1,18}$'
      or not (e.value ? 'assignedto')
      or (e.value ? 'assignedto' and jsonb_typeof(e.value->'assignedto') not in ('null','string'))
  ) then
    raise exception using errcode = '22023', message = 'ITEMCODE_DEFAULT_OWNER_CHANGE_INVALID';
  end if;

  with parsed as (
    select upper(btrim(e.value->>'itemcode')) itemcode_normalized,
      nullif(lower(btrim(e.value->>'assignedto')), '') requested_owner,
      (e.value->>'expectedRevision')::bigint expected_revision
    from jsonb_array_elements(p_changes) e(value)
  ), rostered as (
    select p.itemcode_normalized, p.expected_revision, p.requested_owner,
      coalesce(u.username, p.requested_owner) canonical_owner
    from parsed p left join public.ph_eval_assignment_users u
      on lower(btrim(u.username)) = p.requested_owner
  )
  select jsonb_agg(jsonb_build_object('itemcode',r.itemcode_normalized,
    'assignedto',r.canonical_owner,'expectedRevision',r.expected_revision) order by r.itemcode_normalized),
    count(*)::integer
  into normalized, change_count from rostered r;
  if change_count <> jsonb_array_length(p_changes) then
    raise exception using errcode = '22023', message = 'ITEMCODE_DEFAULT_OWNER_CHANGE_INVALID';
  end if;
  if (select count(distinct e.value->>'itemcode') from jsonb_array_elements(normalized) e(value)) <> change_count then
    raise exception using errcode = '22023', message = 'ITEMCODE_DEFAULT_OWNER_DUPLICATE_ITEMCODE';
  end if;

  request_hash := encode(extensions.digest(normalized::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('itemcode-default-owner-command:' || p_request_id::text, 0));
  select * into prior_command from private.ph_itemcode_default_owner_commands c
    where c.request_id = p_request_id for update;
  if found then
    if prior_command.actor_id <> actor.id or prior_command.request_fingerprint <> request_hash then
      raise exception using errcode = '40001', message = 'ITEMCODE_DEFAULT_OWNER_IDEMPOTENCY_CONFLICT';
    end if;
    return prior_command.response;
  end if;
  if exists (
    select 1 from (select distinct e.value->>'assignedto' owner from jsonb_array_elements(normalized) e(value)) owners
    where nullif(owners.owner, '') is not null
      and not private.eval_assignment_profile_active_v1(owners.owner)
  ) then
    raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_IN_EVAL_ROSTER_OR_ACTIVE_PROFILE';
  end if;
  -- A scheduled handover must not silently rewrite a manager's selection in
  -- a BEFORE trigger and return an acknowledgment naming the previous owner.
  if exists (
    select 1 from jsonb_array_elements(normalized) e(value)
    where private.handover_replace_identity_v1(e.value->>'assignedto')
      is distinct from e.value->>'assignedto'
  ) then
    raise exception using errcode = '40001', message = 'ITEMCODE_DEFAULT_OWNER_REPLACED_REFRESH_REQUIRED';
  end if;

  select r.revision into source_revision from public.app_dataset_revisions r
    where r.key = 'ph_master_inventory' and r.state = 'ready' for share;
  if not found then
    raise exception using errcode = '55000', message = 'ITEMCODE_DEFAULT_OWNER_SOURCE_NOT_READY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));

  perform 1 from public.ph_itemcode_default_owners d
    where d.itemcode_normalized in (select e.value->>'itemcode' from jsonb_array_elements(normalized) e(value))
    order by d.itemcode_normalized for update;
  -- The itemcode transaction lock serializes last-write-wins saves, including absent defaults.
  -- A single statement fires dataset/input-generation triggers once for the entire batch.
  -- An unchanged authorized command still records its receipt, but must not fire statement triggers.
  if exists (
    select 1 from jsonb_array_elements(normalized) e(value)
    left join public.ph_itemcode_default_owners d on d.itemcode_normalized=e.value->>'itemcode'
    where d.itemcode_normalized is null or d.assignedto is distinct from nullif(e.value->>'assignedto','') or d.review_required
  ) then
  with requested as materialized (
    select e.value->>'itemcode' itemcode, e.value->>'assignedto' owner
    from jsonb_array_elements(normalized) e(value)
  ), previous as materialized (
    select r.itemcode, r.owner, d.assignedto previous_owner, d.assigned_at,
      coalesce(d.revision, 0) old_revision, d.itemcode_normalized is not null existed,
      coalesce(d.review_required, false) review_required
    from requested r left join public.ph_itemcode_default_owners d on d.itemcode_normalized=r.itemcode
  ), written as (
    insert into public.ph_itemcode_default_owners(itemcode_normalized, assignedto, assigned_at,
      revision, review_required, updated_by, updated_at)
    select p.itemcode, p.owner,
      case when p.owner is null then null
        when p.previous_owner is not distinct from p.owner then p.assigned_at else now() end,
      p.old_revision + case when p.previous_owner is distinct from p.owner or p.review_required then 1 else 0 end,
      false, lower(btrim(actor.username)), now()
    from previous p
    where not p.existed or p.previous_owner is distinct from p.owner or p.review_required
    order by p.itemcode
    on conflict (itemcode_normalized) do update set assignedto=excluded.assignedto,
      assigned_at=excluded.assigned_at, revision=excluded.revision, review_required=false,
      updated_by=excluded.updated_by, updated_at=excluded.updated_at
    returning itemcode_normalized, assignedto, revision
  ), audited as (
    insert into private.ph_itemcode_default_owner_audit(request_id,itemcode_normalized,
      previous_owner,next_owner,old_revision,new_revision,actor_username)
    select p_request_id,w.itemcode_normalized,p.previous_owner,w.assignedto,p.old_revision,w.revision,
      lower(btrim(actor.username)) from written w join previous p on p.itemcode=w.itemcode_normalized
    where p.previous_owner is distinct from w.assignedto or p.review_required
  )
  select coalesce(array_agg(w.itemcode_normalized order by w.itemcode_normalized),array[]::text[])
    into changed_itemcodes from written w;
  end if;

  -- Resolve each changed physical row once, retaining exact identity, row locks and audit.
  for row_to_resolve in select m.unique_id from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = any(changed_itemcodes)
    order by m.unique_id loop
    perform private.resolve_inventory_row_assignment_v1(row_to_resolve.unique_id, source_revision);
    changed_rows := changed_rows + 1;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('itemcode',d.itemcode_normalized,
    'assignedto',d.assignedto,'revision',d.revision) order by d.itemcode_normalized),'[]'::jsonb)
    into defaults_result from public.ph_itemcode_default_owners d
    where d.itemcode_normalized in (select e.value->>'itemcode' from jsonb_array_elements(normalized) e(value));

  select coalesce(jsonb_agg(to_jsonb(a) order by a.itemcode_normalized, a.master_unique_id), '[]'::jsonb)
  into assignments_result
  from public.ph_inventory_row_assignments a
  where a.present_in_drive and a.itemcode_normalized in (
    select e.value->>'itemcode' from jsonb_array_elements(normalized) e(value)
  );
  response := jsonb_build_object('contractVersion', 'inventory-row-assignments-v1',
    'requestId', p_request_id, 'defaults', defaults_result, 'recomputedRows', changed_rows,
    'assignments', assignments_result, 'sourceRevision', source_revision);
  insert into private.ph_itemcode_default_owner_commands(request_id, actor_id, request_fingerprint, response)
    values (p_request_id, actor.id, request_hash, response);
  return response;
end;
$function$
;
ALTER TABLE public.role_access_baselines ADD COLUMN IF NOT EXISTS matrix_permissions jsonb NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.save_access_permission_v23127(p_actor_id uuid,p_mode text,p_target text,p_permission text,p_value text,p_command_id uuid,p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; target public.user_access; baseline public.role_access_baselines; prior private.user_access_matrix_commands_v23119; input jsonb:=jsonb_build_object('mode',p_mode,'target',p_target,'permission',p_permission,'value',p_value,'revision',p_expected_revision); result jsonb; patch jsonb; legacy_key text; legacy_patch jsonb; role_key text; rev bigint; saved jsonb; matrices jsonb:='[]'; next_matrix jsonb; child_id uuid;
BEGIN
 IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'USER_ACCESS_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO actor FROM public.profiles WHERE id=p_actor_id AND disabled_at IS NULL AND NOT must_change_password AND (locked_until IS NULL OR locked_until<=now());
 IF actor.id IS NULL OR NOT private.is_full_app_administrator_v1(actor.username) THEN RAISE EXCEPTION 'USER_ACCESS_MANAGER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_mode IS NULL OR p_target IS NULL OR btrim(p_target)='' OR p_permission IS NULL OR p_value IS NULL OR p_mode NOT IN ('role','user') OR p_value NOT IN ('Y','N') OR p_command_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR NOT (p_permission=ANY(ARRAY['make_request','request_all_reps','edit_any_row','edit_assigned_rows_only','flyer_folder_access','create_project','approve_suspend_tags','manage_tables','legacy:can_submit_reclass','legacy:can_complete_suspend_tag','legacy:can_access_eval_reports_2','view_drive_mode','view_av','view_que_request','view_que_suspend','view_docks','view_hl_order','view_sales','view_sales_office','view_historical_requests','view_managers','view_qc','view_office','view_inventory','view_production','view_bloom','view_flyers','view_comm']) OR p_permission ~ '^rep:[a-z0-9_]{1,80}$') THEN RAISE EXCEPTION 'USER_ACCESS_PERMISSION_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('permission:'||p_actor_id||':'||p_command_id,0));
 SELECT * INTO prior FROM private.user_access_matrix_commands_v23119 WHERE actor_id=p_actor_id AND command_id=p_command_id;
 IF FOUND THEN IF prior.input<>input THEN RAISE EXCEPTION 'USER_ACCESS_COMMAND_CONFLICT' USING ERRCODE='40001'; END IF; RETURN prior.response; END IF;
 SELECT revision INTO rev FROM public.user_access_control_state WHERE singleton FOR UPDATE;
 legacy_key:=CASE p_permission WHEN 'view_drive_mode' THEN 'can_access_drive_mode' WHEN 'view_av' THEN 'can_access_av' WHEN 'view_managers' THEN 'can_access_manager_tab' WHEN 'approve_suspend_tags' THEN 'can_approve_deny_suspend' ELSE CASE WHEN p_permission LIKE 'legacy:%' THEN substring(p_permission from 8) END END;
 IF p_mode='role' THEN
  role_key:=private.canonical_user_access_role_v1(p_target);
  SELECT * INTO baseline FROM public.role_access_baselines WHERE role=role_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_ACCESS_ROLE_INVALID'; END IF;
  IF baseline.revision<>p_expected_revision THEN RAISE EXCEPTION 'USER_ACCESS_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  next_matrix:=baseline.matrix_permissions;
  IF p_permission LIKE 'view_%' THEN next_matrix:=next_matrix||jsonb_build_object('view_permissions',coalesce(next_matrix->'view_permissions','{}')||jsonb_build_object(p_permission,p_value));
  ELSIF p_permission LIKE 'rep:%' THEN next_matrix:=next_matrix||jsonb_build_object('request_all_reps','N','sales_rep_access',coalesce(next_matrix->'sales_rep_access','{}')||jsonb_build_object(substring(p_permission from 5),p_value));
  ELSE next_matrix:=next_matrix||jsonb_build_object(p_permission,p_value); END IF;
  IF legacy_key IS NOT NULL THEN
   saved:=public.user_access_command_v1(p_actor_id,'save_role_baseline',jsonb_build_object('role',role_key,'permissions',baseline.permissions||jsonb_build_object(legacy_key,p_value='Y')),rev,md5(p_command_id::text||':baseline')::uuid);
  ELSE UPDATE public.role_access_baselines SET revision=revision+1,updated_by_profile_id=p_actor_id,updated_at=clock_timestamp() WHERE role=role_key; END IF;
  UPDATE public.role_access_baselines SET matrix_permissions=next_matrix WHERE role=role_key;
 END IF;
 FOR target IN SELECT * FROM public.user_access u WHERE CASE WHEN p_mode='role' THEN private.canonical_user_access_role_v1(u.role)=role_key ELSE u.username=private.access_username_v23119(p_target) END ORDER BY u.username FOR UPDATE LOOP
  IF p_mode='user' AND target.revision<>p_expected_revision THEN RAISE EXCEPTION 'USER_ACCESS_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  patch:='{}';
  IF p_permission LIKE 'view_%' THEN patch:=jsonb_build_object('view_permissions',target.view_permissions||jsonb_build_object(p_permission,p_value));
  ELSIF p_permission LIKE 'rep:%' THEN patch:=jsonb_build_object('request_all_reps','N','sales_rep_access',target.sales_rep_access||jsonb_build_object(substring(p_permission from 5),p_value));
  ELSIF p_permission NOT LIKE 'legacy:%' THEN patch:=jsonb_build_object(p_permission,p_value); END IF;
  IF p_permission='request_all_reps' THEN patch:=patch||jsonb_build_object('sales_rep_access',(SELECT coalesce(jsonb_object_agg(k,p_value),'{}') FROM jsonb_object_keys(private.access_rep_roster_v23119()) k)); END IF;
  saved:=public.save_user_access_matrix_v23119(p_actor_id,target.username,patch,md5(p_command_id::text||':matrix:'||target.username)::uuid,target.revision);
  matrices:=matrices||jsonb_build_array(saved->'matrix');
  IF legacy_key IS NOT NULL THEN
   SELECT permission_overrides||jsonb_build_object(legacy_key,p_value='Y') INTO legacy_patch FROM public.user_access_control WHERE profile_id=target.profile_id AND active;
   IF FOUND THEN
    SELECT revision INTO rev FROM public.user_access_control_state WHERE singleton;
    saved:=public.user_access_command_v1(p_actor_id,'save_user_overrides',jsonb_build_object('username',target.username,'permission_overrides',legacy_patch),rev,md5(p_command_id::text||':legacy:'||target.username)::uuid);
   END IF;
  END IF;
 END LOOP;
 IF p_mode='user' AND jsonb_array_length(matrices)=0 THEN RAISE EXCEPTION 'USER_ACCESS_TARGET_NOT_FOUND'; END IF;
 result:=jsonb_build_object('ok',true,'matrixRows',matrices,'roleMatrices',(SELECT jsonb_agg(jsonb_build_object('role',role,'revision',revision,'matrix',matrix_permissions)) FROM public.role_access_baselines),'directory',public.user_access_command_v1(p_actor_id,'directory','{}',NULL,NULL));
 INSERT INTO private.user_access_matrix_commands_v23119 VALUES(p_actor_id,p_command_id,input,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_access_permission_v23127(uuid,text,text,text,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_access_permission_v23127(uuid,text,text,text,text,uuid,bigint) TO service_role;

-- Every historical file-date observation contributes; blank reasons mark releases.
CREATE OR REPLACE FUNCTION public.smart_hold_context_v23127(p_itemcodes text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'HOLD_HISTORY_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_itemcodes IS NULL OR cardinality(p_itemcodes) NOT BETWEEN 1 AND 30 OR EXISTS(SELECT 1 FROM unnest(p_itemcodes) c WHERE c IS NULL OR c !~ '^[A-Za-z0-9._-]{1,80}$') THEN RAISE EXCEPTION 'HOLD_HISTORY_SCOPE_INVALID'; END IF;
 WITH observations AS MATERIALIZED (
  SELECT itemcode,report_date observation_date,array_agg(DISTINCT nullif(btrim(holdstopreason),'')) FILTER(WHERE nullif(btrim(holdstopreason),'') IS NOT NULL) reasons
  FROM public.ph_drive_around_report_rows WHERE itemcode=ANY(p_itemcodes) AND report_date IS NOT NULL GROUP BY itemcode,report_date
 ), reasons AS (SELECT DISTINCT itemcode,unnest(reasons) reason FROM observations),
 states AS (SELECT d.itemcode,r.reason,d.observation_date,coalesce(r.reason=ANY(d.reasons),false) held FROM observations d JOIN reasons r USING(itemcode)),
 changes AS (SELECT *,held IS DISTINCT FROM lag(held) OVER(PARTITION BY itemcode,reason ORDER BY observation_date) changed FROM states),
 runs AS (SELECT *,sum(changed::int) OVER(PARTITION BY itemcode,reason ORDER BY observation_date) run FROM changes),
 periods AS (SELECT itemcode,reason,run,bool_or(held) held,min(observation_date) start_date,max(observation_date) last_date FROM runs GROUP BY itemcode,reason,run),
 edges AS (SELECT *,lead(start_date) OVER(PARTITION BY itemcode,reason ORDER BY run) end_date,lag(start_date) OVER(PARTITION BY itemcode,reason ORDER BY run) previous_clear FROM periods),
 measured AS (SELECT e.*,off_w.gdd recovery_gdd,on_w.gdd onset_gdd FROM edges e
  LEFT JOIN LATERAL (SELECT CASE WHEN count(DISTINCT w.date)=e.end_date-e.start_date THEN sum(greatest(0,(w.temperature_high_f+w.temperature_low_f-50)/2)) END gdd FROM public.ph_weather_daily w WHERE w.station_key='park_hill_ok' AND w.date>=e.start_date AND w.date<e.end_date AND w.temperature_high_f IS NOT NULL AND w.temperature_low_f IS NOT NULL) off_w ON e.held
  LEFT JOIN LATERAL (SELECT CASE WHEN count(DISTINCT w.date)=e.start_date-e.previous_clear THEN sum(greatest(0,(w.temperature_high_f+w.temperature_low_f-50)/2)) END gdd FROM public.ph_weather_daily w WHERE w.station_key='park_hill_ok' AND w.date>=e.previous_clear AND w.date<e.start_date AND w.temperature_high_f IS NOT NULL AND w.temperature_low_f IS NOT NULL) on_w ON e.held
 ), models AS (SELECT itemcode,reason AS holdreason,
  percentile_cont(0.5) WITHIN GROUP(ORDER BY recovery_gdd) FILTER(WHERE held AND end_date IS NOT NULL) recovery,
  percentile_cont(0.5) WITHIN GROUP(ORDER BY onset_gdd) FILTER(WHERE held) onset,
  count(*) FILTER(WHERE held AND recovery_gdd IS NOT NULL AND end_date IS NOT NULL)::int sample_count,
  count(*) FILTER(WHERE held AND end_date IS NOT NULL)::int completed_cycles,
  max(start_date) FILTER(WHERE held AND end_date IS NULL) on_date,
  max(start_date) FILTER(WHERE held) last_on_date,
  max(start_date) FILTER(WHERE NOT held) off_date,
  min(start_date) first_file_date,max(last_date) last_file_date,
  (SELECT count(*)::int FROM observations o WHERE o.itemcode=measured.itemcode) observations
  FROM measured GROUP BY itemcode,reason)
 SELECT jsonb_build_object('models',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('as_of',(now() at time zone 'America/Chicago')::date,'elapsed_gdd',ew.gdd,'clear_gdd',cw.gdd) ORDER BY itemcode,holdreason) FROM models m
   LEFT JOIN LATERAL (SELECT CASE WHEN count(DISTINCT date)=(now() at time zone 'America/Chicago')::date-m.on_date THEN coalesce(sum(greatest(0,(temperature_high_f+temperature_low_f-50)/2)),0) END gdd FROM public.ph_weather_daily WHERE station_key='park_hill_ok' AND date>=m.on_date AND date<(now() at time zone 'America/Chicago')::date AND temperature_high_f IS NOT NULL AND temperature_low_f IS NOT NULL) ew ON true
   LEFT JOIN LATERAL (SELECT CASE WHEN count(DISTINCT date)=(now() at time zone 'America/Chicago')::date-m.off_date THEN coalesce(sum(greatest(0,(temperature_high_f+temperature_low_f-50)/2)),0) END gdd FROM public.ph_weather_daily WHERE station_key='park_hill_ok' AND date>=m.off_date AND date<(now() at time zone 'America/Chicago')::date AND temperature_high_f IS NOT NULL AND temperature_low_f IS NOT NULL) cw ON true),'[]'),
  'weather',coalesce((SELECT jsonb_agg(jsonb_build_object('date',date,'high',temperature_high_f,'low',temperature_low_f,'source','Park Hill daily weather') ORDER BY date) FROM public.ph_weather_daily WHERE station_key='park_hill_ok' AND date>=current_date-60 AND date<=current_date+14 AND temperature_high_f IS NOT NULL AND temperature_low_f IS NOT NULL),'[]'),
  'reasons',coalesce((SELECT jsonb_agg(DISTINCT reason ORDER BY reason) FROM reasons),'[]')) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.smart_hold_context_v23127(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.smart_hold_context_v23127(text[]) TO service_role;

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
        -- Completing a review never closes the physical Suspend Tag. Only group_command close does.
        update public.ph_soc_master set date_completed=null where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=clock_timestamp(),version=version+1,updated_at=now() where source_uid=uid;
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

-- Fill only the 129 missing Park Hill daily observations verified against Open-Meteo Archive.
WITH recovered(date,high,low) AS (VALUES
('2026-02-14'::date,60,51.4),
('2026-02-15'::date,64.5,46.2),
('2026-02-16'::date,67.3,43.5),
('2026-02-17'::date,66.1,51.9),
('2026-02-18'::date,74.3,53.3),
('2026-02-19'::date,71.9,38.8),
('2026-02-20'::date,53.7,26.9),
('2026-02-21'::date,50.2,37.1),
('2026-02-22'::date,43.9,27.4),
('2026-02-23'::date,45.7,22.4),
('2026-02-24'::date,65.8,35.7),
('2026-02-25'::date,70.6,48.8),
('2026-02-26'::date,72.4,47.6),
('2026-02-27'::date,75.4,40.2),
('2026-02-28'::date,78.3,53.5),
('2026-03-01'::date,75.5,51.1),
('2026-03-02'::date,61.6,48.7),
('2026-03-03'::date,77.9,55.2),
('2026-03-04'::date,67.6,54.6),
('2026-03-05'::date,74.3,55),
('2026-03-06'::date,76.9,62.5),
('2026-03-07'::date,66.9,43.2),
('2026-03-08'::date,68.5,34.7),
('2026-03-09'::date,76.3,56.8),
('2026-03-10'::date,78.2,64.8),
('2026-03-11'::date,68.1,43.6),
('2026-03-12'::date,59.1,32.5),
('2026-03-13'::date,72.4,45),
('2026-03-14'::date,74.8,52.5),
('2026-03-15'::date,65.4,33.4),
('2026-03-16'::date,34.7,20.8),
('2026-03-17'::date,56.1,24.8),
('2026-03-18'::date,67.4,46),
('2026-03-19'::date,79.6,50.8),
('2026-03-20'::date,87.1,55.1),
('2026-03-21'::date,88.9,59.5),
('2026-03-22'::date,89.4,58.6),
('2026-03-23'::date,69.7,46.7),
('2026-03-24'::date,68.1,51.3),
('2026-03-25'::date,83.8,54),
('2026-03-26'::date,85.2,64),
('2026-03-27'::date,70.3,50.5),
('2026-03-28'::date,60.8,41.3),
('2026-03-29'::date,76.8,48),
('2026-03-30'::date,79.3,62.1),
('2026-04-29'::date,66.1,50.9),
('2026-04-30'::date,65.7,49.2),
('2026-05-01'::date,65.6,49.2),
('2026-05-02'::date,66.7,45),
('2026-05-03'::date,77.6,46.9),
('2026-05-04'::date,76.5,60.5),
('2026-05-05'::date,74.7,50.2),
('2026-05-06'::date,61.1,48.4),
('2026-05-07'::date,67.1,44),
('2026-05-08'::date,76.2,52),
('2026-05-09'::date,80,54.4),
('2026-05-10'::date,71.8,58.4),
('2026-05-11'::date,75.2,51.2),
('2026-05-12'::date,76.9,55.2),
('2026-05-13'::date,80.7,60.4),
('2026-05-14'::date,81.1,57.7),
('2026-05-15'::date,81.7,67.4),
('2026-05-16'::date,83.4,64.1),
('2026-05-17'::date,86.8,68.6),
('2026-05-18'::date,85.3,66.7),
('2026-05-19'::date,75.3,62.3),
('2026-05-20'::date,70.7,59.6),
('2026-05-21'::date,74.9,63.2),
('2026-05-22'::date,75.8,63.2),
('2026-05-23'::date,69.3,62.6),
('2026-05-24'::date,79.7,59.2),
('2026-05-25'::date,83,64.5),
('2026-05-26'::date,79.8,64.5),
('2026-05-27'::date,83.1,66.9),
('2026-05-28'::date,78.3,68.7),
('2026-05-29'::date,84.2,64.7),
('2026-05-30'::date,90.6,70.5),
('2026-05-31'::date,89.4,66.7),
('2026-06-01'::date,91.2,71.6),
('2026-06-02'::date,90,68.2),
('2026-06-03'::date,84.8,67),
('2026-06-04'::date,83.8,69.5),
('2026-06-05'::date,83.5,71.5),
('2026-06-06'::date,78.9,69.4),
('2026-06-07'::date,78.3,70.2),
('2026-06-08'::date,87.5,69.1),
('2026-06-09'::date,88.3,74.8),
('2026-06-10'::date,89.2,75.7),
('2026-06-11'::date,88.2,71.1),
('2026-06-12'::date,82.9,69.2),
('2026-06-13'::date,89.9,71.1),
('2026-06-14'::date,80.5,67.4),
('2026-06-15'::date,80.5,63.4),
('2026-06-16'::date,84.5,65.8),
('2026-06-17'::date,89,72.2),
('2026-06-18'::date,83.5,68.7),
('2026-06-19'::date,80.1,65.3),
('2026-06-20'::date,86.3,67.9),
('2026-06-21'::date,87.3,69.8),
('2026-06-22'::date,81.9,68.4),
('2026-06-23'::date,75.6,67.3),
('2026-06-24'::date,78.6,69.5),
('2026-06-25'::date,85.1,68),
('2026-06-26'::date,83.2,73.3),
('2026-06-27'::date,88,72.6),
('2026-06-28'::date,89.9,76.4),
('2026-06-29'::date,90.7,77.8),
('2026-06-30'::date,91.2,77.3),
('2026-07-01'::date,90.2,75.6),
('2026-07-04'::date,92.3,73.3),
('2026-07-05'::date,86.6,67.9),
('2026-07-06'::date,87.9,71.7),
('2026-07-07'::date,89.1,69),
('2026-07-08'::date,92.1,71.5),
('2026-07-09'::date,92.9,75.7),
('2026-07-10'::date,94.2,78.4),
('2026-07-11'::date,90.7,75.7),
('2026-07-12'::date,84.4,71),
('2026-07-13'::date,90.3,71.3),
('2026-07-14'::date,91.8,72.9),
('2026-07-15'::date,85,71.8),
('2026-07-16'::date,87.9,70.7),
('2026-07-17'::date,87.7,73.2),
('2026-07-18'::date,90.1,76.1),
('2026-07-19'::date,92.6,75.9),
('2026-07-20'::date,95.7,76.9),
('2026-07-21'::date,100.6,79.1),
('2026-07-22'::date,91.6,75.2),
('2026-07-23'::date,91.9,71.5)
)
INSERT INTO public.ph_weather_daily(unique_id,station_key,latitude,longitude,timezone,date,temperature_high_f,temperature_low_f,daily_gdd_base_50,source)
SELECT 'park_hill_ok:'||date::text,'park_hill_ok',35.8334,-94.9080,'America/Chicago',date,high,low,greatest(0,(high+low-50)/2),'open_meteo_archive' FROM recovered r
WHERE NOT EXISTS(SELECT 1 FROM public.ph_weather_daily w WHERE w.station_key='park_hill_ok' AND w.date=r.date AND w.temperature_high_f IS NOT NULL AND w.temperature_low_f IS NOT NULL)
ON CONFLICT(station_key,date) DO UPDATE SET temperature_high_f=excluded.temperature_high_f,temperature_low_f=excluded.temperature_low_f,daily_gdd_base_50=excluded.daily_gdd_base_50,source=excluded.source WHERE ph_weather_daily.temperature_high_f IS NULL OR ph_weather_daily.temperature_low_f IS NULL;


-- Explicitly requested recovery of Dylan's accidental Item Detail completion.
DO $$
DECLARE target public.ph_soc_master; uid constant text:='Dock_30-10-0045192-0001-60-007541_031_1-C_15_000-27_F1-10-Breshear_s_Nursery-Breshear_s_Nursery-3DP---';
BEGIN
 SELECT * INTO target FROM public.ph_soc_master WHERE unique_id=uid FOR UPDATE;
 IF target.unique_id IS NULL THEN RAISE EXCEPTION 'BLUE_BAYOU_RESTORE_SOURCE_MISSING'; END IF;
 IF target.itemcode<>'007541.031.1' OR target.locationcode<>'C.15.000' OR target.lotcode<>'27.F1' THEN RAISE EXCEPTION 'BLUE_BAYOU_RESTORE_IDENTITY_CHANGED'; END IF;
 IF target.date_completed IS NOT NULL THEN
  IF target.date_completed<>'2026-11-01T00:13:50.696427Z'::timestamptz THEN RAISE EXCEPTION 'BLUE_BAYOU_RESTORE_NEWER_COMPLETION'; END IF;
  UPDATE public.ph_soc_master SET date_completed=NULL WHERE unique_id=uid RETURNING * INTO target;
  UPDATE suspend_tag_private.workflows SET status='pending',completed_by=NULL,completed_at=NULL,source_revision=target.last_updated,version=version+1,updated_at=clock_timestamp() WHERE source_uid=uid AND status='completed';
 END IF;
END $$;

COMMIT;
