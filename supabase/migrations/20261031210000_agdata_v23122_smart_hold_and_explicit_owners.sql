BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- Preserve the canonical exact-row resolver, authorization, audit and READY/LKG fences.
CREATE OR REPLACE FUNCTION private.resolve_inventory_row_assignment_v1(p_master_unique_id text, p_source_revision bigint DEFAULT NULL::bigint)
 RETURNS ph_inventory_row_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source_row public.ph_master_inventory;
  prior public.ph_inventory_row_assignments;
  default_row public.ph_itemcode_default_owners;
  legacy_group public.ph_warehouse_assigned_items;
  resolved_owner text;
  unresolved_candidate text;
  resolved_at timestamptz;
  resolved_reason text;
  zone_state text;
  source_rev bigint;
  source_found boolean;
  prior_found boolean;
  legacy_fallback_allowed boolean;
  review_flag boolean := false;
  result_row public.ph_inventory_row_assignments;
begin
  if nullif(btrim(p_master_unique_id), '') is null then
    raise exception using errcode = '22023', message = 'INVENTORY_ROW_ASSIGNMENT_ID_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-row-assignment:' || p_master_unique_id, 0));
  select * into source_row from public.ph_master_inventory m where m.unique_id = p_master_unique_id;
  source_found := found;
  select * into prior from public.ph_inventory_row_assignments a where a.master_unique_id = p_master_unique_id for update;
  prior_found := found;

  if not source_found then
    if prior_found and prior.present_in_drive then
      update public.ph_inventory_row_assignments a
      set present_in_drive = false, assignment_reason = 'source_missing', review_required = true,
          source_revision = coalesce(p_source_revision, a.source_revision), revision = a.revision + 1,
          updated_at = now()
      where a.master_unique_id = p_master_unique_id returning * into result_row;
      insert into private.ph_inventory_row_assignment_audit(
        master_unique_id, event_type, previous_owner, next_owner, reason, source_revision
      ) values (p_master_unique_id, 'source_removed', prior.assignedto, prior.assignedto,
        'source_missing', coalesce(p_source_revision, prior.source_revision));
      return result_row;
    end if;
    return prior;
  end if;

  source_rev := coalesce(p_source_revision,
    (select r.revision from public.app_dataset_revisions r where r.key = 'ph_master_inventory'), 0);
  select * into default_row from public.ph_itemcode_default_owners d
  where d.itemcode_normalized = upper(btrim(coalesce(source_row.itemcode, '')));
  select * into legacy_group from public.ph_warehouse_assigned_items a
  where a.assignment_key = private.normalize_eval_assignment_key(source_row.itemcode, source_row.genusname);
  zone_state := private.eval_location_zone(source_row.locationcode);
  legacy_fallback_allowed := not exists(select 1 from private.ph_inventory_row_assignment_policy_state s
    where s.singleton and s.active);
  if default_row.updated_by is not null or default_row.assignedto is not null then
    -- Explicit itemcode defaults, including explicit Unassigned, precede zone suggestions.
    if default_row.assignedto is not null and not private.eval_assignment_profile_active_v1(default_row.assignedto) then
      resolved_owner := null; resolved_reason := 'default_owner_inactive'; review_flag := true;
    else
      resolved_owner := default_row.assignedto;
      resolved_reason := case when resolved_owner is null then 'unassigned' else 'itemcode_default' end;
      review_flag := coalesce(default_row.review_required, false);
    end if;
  elsif zone_state = 'inside' and upper(btrim(coalesce(source_row.plantgroupcode, ''))) = '135_ROSES' then
    if private.eval_assignment_profile_active_v1('mitch_kaiser') then
      resolved_owner := 'mitch_kaiser';
      resolved_reason := 'zone_mitch_rose';
    else
      resolved_owner := null;
      resolved_reason := 'zone_owner_inactive';
      review_flag := true;
    end if;
  elsif zone_state = 'inside' then
    if private.eval_assignment_profile_active_v1('zoe_green') then
      resolved_owner := 'zoe_green';
      resolved_reason := 'zone_zoe';
    else
      resolved_owner := null;
      resolved_reason := 'zone_owner_inactive';
      review_flag := true;
    end if;
  elsif zone_state = 'outside' then
    if default_row.assignedto is not null and not private.eval_assignment_profile_active_v1(default_row.assignedto) then
      resolved_owner := null;
      resolved_reason := 'default_owner_inactive';
      review_flag := true;
    else
      resolved_owner := default_row.assignedto;
      resolved_reason := case when default_row.review_required then 'default_owner_inactive'
        when resolved_owner is null then 'unassigned' else 'itemcode_default' end;
      review_flag := coalesce(default_row.review_required, false);
    end if;
  else
    unresolved_candidate := case when prior.present_in_drive then prior.assignedto
      when legacy_fallback_allowed and legacy_group.present_in_drive and legacy_group.assignment_key is not null then
        case when legacy_group.zone_override_active then nullif(lower(btrim(legacy_group.zone_override_prior_assignedto)), '')
          else nullif(lower(btrim(legacy_group.assignedto)), '') end
      else null end;
    if unresolved_candidate is not null and not private.eval_assignment_profile_active_v1(unresolved_candidate) then
      resolved_owner := null;
      resolved_reason := 'default_owner_inactive';
    else
      resolved_owner := unresolved_candidate;
      resolved_reason := case when prior.present_in_drive
          or (legacy_fallback_allowed and legacy_group.present_in_drive and legacy_group.assignment_key is not null)
        then 'unresolved_preserved' else 'unresolved_new' end;
    end if;
    review_flag := true;
  end if;
  resolved_at := case
    when resolved_owner is null then null
    when prior.present_in_drive and prior.assignedto is not distinct from resolved_owner then prior.assigned_at
    when legacy_group.present_in_drive and legacy_group.zone_override_active and legacy_group.zone_override_prior_assignedto is not null
      and lower(btrim(legacy_group.zone_override_prior_assignedto)) = lower(btrim(resolved_owner))
      then legacy_group.zone_override_prior_assigned_at
    when legacy_group.present_in_drive and legacy_group.assignedto is not null and lower(btrim(legacy_group.assignedto)) = lower(btrim(resolved_owner))
      then legacy_group.assigned_at
    when default_row.assignedto is not null and lower(btrim(default_row.assignedto)) = lower(btrim(resolved_owner))
      then coalesce(default_row.assigned_at, now())
    else now()
  end;

  insert into public.ph_inventory_row_assignments(
    master_unique_id, unique_id, itemcode, itemcode_normalized, genusname, commonname, contsize,
    locationcode, lotcode, source, warehousei, assignedto, assigned_at, default_assignedto, default_revision,
    zone_override_active, assignment_reason, review_required, policy_revision, source_revision,
    present_in_drive, revision, updated_at
  ) values (
    source_row.unique_id, source_row.unique_id, source_row.itemcode,
    upper(btrim(coalesce(source_row.itemcode, ''))), source_row.genusname, source_row.commonname,
    source_row.contsize, source_row.locationcode, source_row.lotcode, source_row.source,
    source_row.warehousei, resolved_owner,
    resolved_at,
    default_row.assignedto, coalesce(default_row.revision, 0),
    coalesce(zone_state = 'inside' and resolved_reason in ('zone_zoe','zone_mitch_rose','zone_owner_inactive'), false), resolved_reason, review_flag, 1, source_rev, true,
    coalesce(prior.revision, 0) + 1, now()
  ) on conflict (master_unique_id) do update set
    unique_id = excluded.unique_id, itemcode = excluded.itemcode,
    itemcode_normalized = excluded.itemcode_normalized, genusname = excluded.genusname,
    commonname = excluded.commonname, contsize = excluded.contsize, locationcode = excluded.locationcode,
    lotcode = excluded.lotcode, source = excluded.source, warehousei = excluded.warehousei,
    assignedto = excluded.assignedto,
    assigned_at = excluded.assigned_at,
    default_assignedto = excluded.default_assignedto,
    default_revision = excluded.default_revision, zone_override_active = excluded.zone_override_active,
    assignment_reason = excluded.assignment_reason, review_required = excluded.review_required,
    policy_revision = excluded.policy_revision, source_revision = excluded.source_revision,
    present_in_drive = true, revision = public.ph_inventory_row_assignments.revision + 1,
    updated_at = now()
  where (public.ph_inventory_row_assignments.itemcode, public.ph_inventory_row_assignments.itemcode_normalized,
    public.ph_inventory_row_assignments.genusname, public.ph_inventory_row_assignments.commonname,
    public.ph_inventory_row_assignments.contsize, public.ph_inventory_row_assignments.locationcode,
    public.ph_inventory_row_assignments.lotcode, public.ph_inventory_row_assignments.source,
    public.ph_inventory_row_assignments.warehousei, public.ph_inventory_row_assignments.assignedto,
    public.ph_inventory_row_assignments.assigned_at,
    public.ph_inventory_row_assignments.default_assignedto, public.ph_inventory_row_assignments.default_revision,
    public.ph_inventory_row_assignments.zone_override_active, public.ph_inventory_row_assignments.assignment_reason,
    public.ph_inventory_row_assignments.review_required, public.ph_inventory_row_assignments.source_revision,
    public.ph_inventory_row_assignments.present_in_drive)
    is distinct from (excluded.itemcode, excluded.itemcode_normalized, excluded.genusname, excluded.commonname,
    excluded.contsize, excluded.locationcode, excluded.lotcode, excluded.source, excluded.warehousei,
    excluded.assignedto, excluded.assigned_at, excluded.default_assignedto, excluded.default_revision, excluded.zone_override_active,
    excluded.assignment_reason, excluded.review_required, excluded.source_revision, excluded.present_in_drive)
  returning * into result_row;

  if result_row.master_unique_id is not null
     and (prior.master_unique_id is null or prior.assignedto is distinct from result_row.assignedto
       or prior.assignment_reason is distinct from result_row.assignment_reason
       or prior.review_required is distinct from result_row.review_required) then
    insert into private.ph_inventory_row_assignment_audit(
      master_unique_id, event_type, previous_owner, next_owner, reason, source_revision
    ) values (source_row.unique_id, 'resolved', prior.assignedto, result_row.assignedto,
      result_row.assignment_reason, source_rev);
  end if;
  if result_row.master_unique_id is not null then return result_row; end if;
  select * into result_row from public.ph_inventory_row_assignments a
  where a.master_unique_id = p_master_unique_id;
  return result_row;
end;
$function$;

CREATE OR REPLACE FUNCTION private.audit_eval_assignment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare action text:=coalesce(nullif(current_setting('app.perennial_assignment_action',true),''),'manual');
  event_name text; actor text;
begin
  if coalesce(new.assignment_key,old.assignment_key) is null then return new; end if;
  if tg_op='UPDATE' and new.assignedto is not distinct from old.assignedto
    and new.assigned_by is not distinct from old.assigned_by
    and new.assigned_at is not distinct from old.assigned_at
    and new.zone_override_active is not distinct from old.zone_override_active then return new; end if;
  if action='zone_reconcile' then return new; end if;
  -- Explicit defaults may replace zone suggestions; preserve the authorized write audit below.
  if action='manual' then new.assignment_reason:='manual_assignment'; end if;
  event_name:=case action
    when 'zone_reconcile' then case
      when new.zone_override_active and not coalesce(old.zone_override_active,false) then 'zone_enforced'
      when old.zone_override_active and not new.zone_override_active and new.assignedto is null then 'zone_exit_unassigned'
      else 'rose_exemption_restore' end
    else 'manual_assignment' end;
  select lower(btrim(p.username)) into actor from public.profiles p where p.id=auth.uid();
  insert into private.ph_warehouse_assignment_audit(assignment_key,event_type,actor_username,
    old_assignedto,new_assignedto,old_zone_override_active,new_zone_override_active,reason,rule_version,evaluated_inventory_revision,import_run_id)
  values(new.assignment_key,event_name,actor,
    case when tg_op='INSERT' then null else old.assignedto end,new.assignedto,
    case when tg_op='INSERT' then false else old.zone_override_active end,new.zone_override_active,
    case when action='manual' then 'manual_assignment_change' else action end,
    coalesce(new.zone_override_rule_version,'manual'),
    (select revision from public.app_dataset_revisions where key='ph_master_inventory'),
    nullif(current_setting('app.perennial_import_run_id',true),'')::uuid);
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_itemcode_default_owners_v1(p_itemcodes text[], p_assignedto text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE changes jsonb;
BEGIN
  IF p_itemcodes IS NULL OR cardinality(p_itemcodes) < 1 OR cardinality(p_itemcodes) > 500 THEN
    RAISE EXCEPTION 'ITEMCODE_DEFAULT_OWNER_BATCH_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('itemcode', code, 'assignedto', p_assignedto, 'expectedRevision', 0) ORDER BY code)
    INTO changes FROM (SELECT DISTINCT upper(btrim(value)) code FROM unnest(p_itemcodes) value) codes;
  RETURN public.set_itemcode_default_owners_v1(changes, p_request_id);
END; $$;
REVOKE ALL ON FUNCTION public.set_itemcode_default_owners_v1(text[],text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_itemcode_default_owners_v1(text[],text,uuid) TO authenticated, service_role;
-- Reconcile only existing explicit defaults that contradict the new precedence.
DO $$ DECLARE target record; BEGIN
  FOR target IN SELECT a.master_unique_id FROM public.ph_inventory_row_assignments a
    JOIN public.ph_itemcode_default_owners d USING(itemcode_normalized)
    WHERE a.present_in_drive AND d.updated_by IS NOT NULL
      AND (a.assignedto IS DISTINCT FROM d.assignedto OR a.zone_override_active)
      AND (d.assignedto IS NULL OR private.eval_assignment_profile_active_v1(d.assignedto))
    ORDER BY a.master_unique_id
  LOOP PERFORM private.resolve_inventory_row_assignment_v1(target.master_unique_id, NULL); END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
