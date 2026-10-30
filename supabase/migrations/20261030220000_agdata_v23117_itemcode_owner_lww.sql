-- v2.3.117: allow serialized authorized owner saves to use the latest revision.
-- The live schema stores canonical itemcode revisions in ph_itemcode_default_owners.
create or replace function public.set_itemcode_default_owners_v1(p_changes jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  source_revision bigint;
  normalized jsonb;
  request_hash text;
  prior_command private.ph_itemcode_default_owner_commands;
  change_row record;
  current_row public.ph_itemcode_default_owners;
  current_found boolean;
  canonical_owner text;
  next_revision bigint;
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
    select 1 from jsonb_array_elements(normalized) e(value)
    where nullif(e.value->>'assignedto', '') is not null
      and not private.eval_assignment_profile_active_v1(e.value->>'assignedto')
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

  for change_row in select e.value from jsonb_array_elements(normalized) e(value)
      order by e.value->>'itemcode' loop
    select * into current_row from public.ph_itemcode_default_owners d
      where d.itemcode_normalized = change_row.value->>'itemcode' for update;
    current_found := found;
    if not current_found then
      current_row.itemcode_normalized := change_row.value->>'itemcode';
      current_row.assignedto := null;
      current_row.revision := 0;
    end if;
    -- Client revisions are advisory; the itemcode transaction lock serializes last-write-wins saves.
    canonical_owner := change_row.value->>'assignedto';
    next_revision := current_row.revision;
    if not current_found and canonical_owner is null then
      insert into public.ph_itemcode_default_owners(itemcode_normalized, assignedto, assigned_at,
        revision, review_required, updated_by, updated_at)
      values (current_row.itemcode_normalized, null, null, 0, false, lower(btrim(actor.username)), now());
      current_found := true;
    end if;
    if current_row.assignedto is distinct from canonical_owner or current_row.review_required then
      next_revision := current_row.revision + 1;
      insert into public.ph_itemcode_default_owners(itemcode_normalized, assignedto, assigned_at, revision, updated_by, updated_at)
      values (current_row.itemcode_normalized, canonical_owner,
        case when canonical_owner is null then null
          when current_row.assignedto is not distinct from canonical_owner then current_row.assigned_at else now() end,
        next_revision, lower(btrim(actor.username)), now())
      on conflict (itemcode_normalized) do update set assignedto = excluded.assignedto,
        assigned_at = excluded.assigned_at, revision = excluded.revision,
        review_required = false, updated_by = excluded.updated_by, updated_at = now();
      insert into private.ph_itemcode_default_owner_audit(request_id, itemcode_normalized, previous_owner,
        next_owner, old_revision, new_revision, actor_username)
      values (p_request_id, current_row.itemcode_normalized, current_row.assignedto, canonical_owner,
        current_row.revision, next_revision, lower(btrim(actor.username)));
      for row_to_resolve in select m.unique_id from public.ph_master_inventory m
        where upper(btrim(coalesce(m.itemcode, ''))) = current_row.itemcode_normalized
        order by m.unique_id loop
        perform private.resolve_inventory_row_assignment_v1(row_to_resolve.unique_id, source_revision);
        changed_rows := changed_rows + 1;
      end loop;
    end if;
    defaults_result := defaults_result || jsonb_build_array(jsonb_build_object(
      'itemcode', current_row.itemcode_normalized, 'assignedto', canonical_owner, 'revision', next_revision));
  end loop;

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
$$;
revoke all on function public.set_itemcode_default_owners_v1(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.set_itemcode_default_owners_v1(jsonb, uuid) to authenticated, service_role;
