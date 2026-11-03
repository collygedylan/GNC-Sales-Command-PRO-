begin;
set local lock_timeout='4s';
set local statement_timeout='15s';
create or replace function private.normalize_itemcode_owner_v1(p_username text) returns text language sql immutable set search_path='' as $$
 select case private.eval_normalize_user_v2(split_part(coalesce(p_username,''),'@',1))
 when 'abigail_vasquez' then 'abigail_vazquez' when 'abigal_vazquez' then 'abigail_vazquez' when 'abigal_vazques' then 'abigail_vazquez' when 'abigail_vazques' then 'abigail_vazquez'
 when 'charlie_robertson' then 'charley_robertson' when 'charey_robertson' then 'charley_robertson'
 when 'kayla_knapp' then 'kayla_knepp' when 'nally_aguilar' then 'nelly_aguilar' when 'nelly_aguliar' then 'nelly_aguilar'
 when 'boby' then 'bobby_adair' when 'bobby' then 'bobby_adair'
 else private.eval_normalize_user_v2(split_part(coalesce(p_username,''),'@',1)) end
$$;
create or replace function private.itemcode_owner_candidate_v1(p_username text) returns boolean language sql stable security definer set search_path='' as $$
 select nullif(private.normalize_itemcode_owner_v1(p_username),'') is null or exists (
 select 1 from (select username from public.ph_app_users union all select username from public.user_access
 union all select coalesce(nullif(btrim(username),''),name) from public.ph_company_directory union all select assignedto from public.ph_itemcode_default_owners
 union all select username from public.ph_eval_assignment_users where active
 union all select assignedto from public.ph_inventory_row_assignments where present_in_drive
 union all select default_assignedto from public.ph_inventory_row_assignments where present_in_drive
 union all select assignedto from public.ph_master_inventory) candidates
 where nullif(private.normalize_itemcode_owner_v1(candidates.username),'') is not null
 and private.normalize_itemcode_owner_v1(candidates.username)=private.normalize_itemcode_owner_v1(p_username))
$$;
revoke all on function private.normalize_itemcode_owner_v1(text),private.itemcode_owner_candidate_v1(text) from public,anon,authenticated;
insert into public.ph_eval_assignment_users(username,display_name,active,source)
select username,replace(username,'_',' '),true,'assigned_items_roster' from unnest(array['chris_fisher','dylan_collyge','zoe_green','megan_kelly','mitch_kaiser','nelly_aguilar','morgan_anderson','jd_jones','abigail_vazquez','bobby_adair','charley_robertson','jorge_colunga','kayla_knepp','josh_cantu','todd_dowty']) username
on conflict(username) do update set active=true where not ph_eval_assignment_users.active;
CREATE OR REPLACE FUNCTION public.set_itemcode_default_owners_v1(p_changes jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  previous_owner_scope text := current_setting('agdata.explicit_itemcode_owner',true);
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
      nullif(private.normalize_itemcode_owner_v1(e.value->>'assignedto'), '') requested_owner,
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
      and not private.itemcode_owner_candidate_v1(owners.owner)
  ) then
    raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_IN_EVAL_ROSTER_OR_ACTIVE_PROFILE';
  end if;
  perform set_config('agdata.explicit_itemcode_owner','on',true);
  -- Authorized explicit owner choices are preserved by the scoped owner triggers.

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
  perform set_config('agdata.explicit_itemcode_owner',coalesce(previous_owner_scope,''),true);
  return response;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_owner_mutation_v23138()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor public.profiles;
BEGIN
 IF current_setting('request.jwt.claim.role',true) = 'service_role' OR coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role'='service_role' THEN RETURN coalesce(NEW,OLD); END IF;
 actor := private.current_active_profile();
 IF actor.id IS NULL OR NOT private.can_manage_eval_assignments() THEN RAISE EXCEPTION 'ITEMCODE_OWNER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF TG_OP <> 'DELETE' AND nullif(NEW.assignedto,'') IS NOT NULL AND NOT private.itemcode_owner_candidate_v1(NEW.assignedto) THEN RAISE EXCEPTION 'ITEMCODE_OWNER_INACTIVE' USING ERRCODE='42501'; END IF;
 RETURN coalesce(NEW,OLD);
END $function$;

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
    if default_row.assignedto is not null and not private.itemcode_owner_candidate_v1(default_row.assignedto) then
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
    if default_row.assignedto is not null and not private.itemcode_owner_candidate_v1(default_row.assignedto) then
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

CREATE OR REPLACE FUNCTION private.handover_normalize_assignment_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  h private.scheduled_account_handover_v1;
  cfg record;
  eligible boolean;
  doc jsonb;
  patch jsonb:='{}'::jsonb;
  col text;
  replacement text;
  prior_assignedto text;
  prior_flyer_assigned text;
begin
  -- Explicit authorized owner commands take precedence over the historical handover.
  if tg_table_schema='public' and tg_table_name in ('ph_itemcode_default_owners','ph_inventory_row_assignments','ph_warehouse_assigned_items')
     and current_setting('agdata.explicit_itemcode_owner',true)='on'
     and (private.current_active_profile()).id is not null and private.can_manage_eval_assignments() then return new; end if;
  if tg_table_schema='public' and tg_table_name in ('ph_master_inventory','ph_drive_around_report_rows')
     and coalesce(auth.role(),'')='service_role'
     and current_setting('agdata.bulk_import.'||tg_table_name,true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  select * into h from private.scheduled_account_handover_v1
    where transition_key='kayla_knepp_to_nelly_aguilar_20261002';
  if h.transition_key is null or now()<h.effective_at then return new; end if;

  if tg_table_name='ph_master_inventory' then
    prior_assignedto:=new.assignedto;
    prior_flyer_assigned:=new.flyer_assigned;
    if new.date_completed is null and new.eval_task_completed_at is null then
      replacement:=private.handover_replace_identity_v1(new.assignedto);
      if replacement is distinct from new.assignedto then
        patch:=patch||jsonb_build_object('assignedto',replacement);
        new.assignedto:=replacement;
      end if;
    end if;
    if new.flyer_completed is null then
      replacement:=private.handover_replace_identity_v1(new.flyer_assigned);
      if replacement is distinct from new.flyer_assigned then
        patch:=patch||jsonb_build_object('flyer_assigned',replacement);
        new.flyer_assigned:=replacement;
      end if;
    end if;
    if patch='{}'::jsonb then return new; end if;
    insert into private.scheduled_account_handover_audit_v1(
      transition_key,event_key,event_type,metadata)
    values(h.transition_key,
      'future:ph_master_inventory:'||coalesce(new.unique_id,'')||':'||
        md5(patch::text||coalesce(prior_assignedto,'')||coalesce(prior_flyer_assigned,'')),
      'assignment_transferred',
      jsonb_build_object('table','ph_master_inventory','id',new.unique_id,
        'source','future_assignment','after',patch))
    on conflict(event_key) do nothing;
    return new;
  end if;

  doc:=to_jsonb(new);
  for cfg in select * from private.handover_assignment_targets_v1() where table_name=tg_table_name loop
    execute format('select %s from jsonb_populate_record(null::public.%I,$1) r',cfg.eligibility,cfg.table_name)
      into eligible using doc;
    if not coalesce(eligible,false) then continue; end if;
    foreach col in array cfg.field_names loop
      replacement:=private.handover_replace_identity_v1(doc->>col);
      if replacement is distinct from doc->>col then patch:=patch||jsonb_build_object(col,replacement); end if;
    end loop;
  end loop;
  if patch='{}'::jsonb then return new; end if;
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'future:'||tg_table_name||':'||coalesce(doc->>'unique_id',doc->>'id',doc->>'itemcode_normalized')||':'||md5(patch::text||coalesce(doc->>'assignedto','')||coalesce(doc->>'flyer_assigned','')),
    'assignment_transferred',jsonb_build_object('table',tg_table_name,'id',coalesce(doc->>'unique_id',doc->>'id',doc->>'itemcode_normalized'),'source','future_assignment','after',patch))
  on conflict(event_key) do nothing;
  new:=jsonb_populate_record(new,patch);
  return new;
end
$function$;
notify pgrst,'reload schema';
commit;
