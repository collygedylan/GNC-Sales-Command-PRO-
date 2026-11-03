BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE FUNCTION private.itemcode_owner_candidate_v1(p_username text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select nullif(private.normalize_itemcode_owner_v1(p_username),'') is null or exists (select 1 from public.ph_eval_assignment_users r where r.active and r.username=private.normalize_itemcode_owner_v1(p_username)) or exists (
 select 1 from (select username from public.ph_app_users union all select username from public.user_access
 union all select coalesce(nullif(btrim(username),''),name) from public.ph_company_directory union all select assignedto from public.ph_itemcode_default_owners
 union all select username from public.ph_eval_assignment_users where active
 union all select assignedto from public.ph_inventory_row_assignments where present_in_drive
 union all select default_assignedto from public.ph_inventory_row_assignments where present_in_drive
 union all select assignedto from public.ph_master_inventory) candidates
 where nullif(private.normalize_itemcode_owner_v1(candidates.username),'') is not null
 and private.normalize_itemcode_owner_v1(candidates.username)=private.normalize_itemcode_owner_v1(p_username))
$function$;
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
  fast_ids text[] := array[]::text[];
  source_rev_value bigint;
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

  source_rev_value:=source_revision;
  -- Existing rows with matching source metadata can receive explicit defaults together.
  -- Rows with new or changed master identities still use the canonical full resolver.
  if cardinality(changed_itemcodes)>1 then
    with prior as materialized (
      select a.master_unique_id,a.assignedto prior_owner,a.assignment_reason prior_reason,
        a.review_required prior_review,d.assignedto owner,d.revision default_rev,d.review_required review,
        case when d.assignedto is null then 'unassigned' else 'itemcode_default' end reason,
        case when d.assignedto is null then null
          when a.assignedto is not distinct from d.assignedto then a.assigned_at
          when w.present_in_drive and w.zone_override_active and lower(btrim(w.zone_override_prior_assignedto))=lower(btrim(d.assignedto)) then w.zone_override_prior_assigned_at
          when w.present_in_drive and lower(btrim(w.assignedto))=lower(btrim(d.assignedto)) then w.assigned_at
          else coalesce(d.assigned_at,now()) end assigned_time
      from public.ph_itemcode_default_owners d
      join public.ph_inventory_row_assignments a on a.itemcode_normalized=d.itemcode_normalized and a.present_in_drive
      join public.ph_master_inventory m on m.unique_id=a.master_unique_id
      left join public.ph_warehouse_assigned_items w on w.assignment_key=private.normalize_eval_assignment_key(m.itemcode,m.genusname)
      where d.itemcode_normalized=any(changed_itemcodes) and d.updated_by is not null
        and (a.unique_id,a.itemcode,a.genusname,a.commonname,a.contsize,a.locationcode,a.lotcode,a.source,a.warehousei)
          is not distinct from (m.unique_id,m.itemcode,m.genusname,m.commonname,m.contsize,m.locationcode,m.lotcode,m.source,m.warehousei)
      order by a.master_unique_id for update of a
    ), written as (
      update public.ph_inventory_row_assignments a
      set assignedto=p.owner,assigned_at=p.assigned_time,default_assignedto=p.owner,default_revision=p.default_rev,
          zone_override_active=false,assignment_reason=p.reason,review_required=coalesce(p.review,false),
          policy_revision=1,source_revision=source_rev_value,revision=a.revision+1,updated_at=now()
      from prior p where a.master_unique_id=p.master_unique_id
        and (a.assignedto,a.assigned_at,a.default_assignedto,a.default_revision,a.zone_override_active,
             a.assignment_reason,a.review_required,a.source_revision) is distinct from
            (p.owner,p.assigned_time,p.owner,p.default_rev,false,p.reason,coalesce(p.review,false),source_rev_value)
      returning a.master_unique_id,a.assignedto,a.assignment_reason,a.review_required
    ), audited as (
      insert into private.ph_inventory_row_assignment_audit(master_unique_id,event_type,previous_owner,next_owner,reason,source_revision)
      select w.master_unique_id,'resolved',p.prior_owner,w.assignedto,w.assignment_reason,source_rev_value
      from written w join prior p using(master_unique_id)
      where (p.prior_owner,p.prior_reason,p.prior_review) is distinct from (w.assignedto,w.assignment_reason,w.review_required)
    )
    select coalesce(array_agg(master_unique_id),array[]::text[]) into fast_ids from prior;
    changed_rows:=cardinality(fast_ids);
  end if;

  for row_to_resolve in select m.unique_id from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = any(changed_itemcodes) and not (m.unique_id=any(fast_ids))
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
COMMIT;
