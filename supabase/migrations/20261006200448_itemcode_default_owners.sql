begin;

create table private.ph_itemcode_default_owner_commands (
  request_id uuid primary key,
  actor_id uuid not null,
  request_fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create table private.ph_itemcode_default_owner_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  itemcode_normalized text not null,
  previous_owner text,
  next_owner text,
  old_revision bigint not null,
  new_revision bigint not null,
  actor_username text not null,
  created_at timestamptz not null default now()
);
revoke all on private.ph_itemcode_default_owner_commands from public, anon, authenticated, service_role;
revoke all on private.ph_itemcode_default_owner_audit from public, anon, authenticated, service_role;

do $$
declare conflicting text; source_state text;
begin
  select r.state into source_state from public.app_dataset_revisions r where r.key = 'ph_master_inventory' for share;
  if source_state is distinct from 'ready' or exists(
    select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory'
  ) then
    raise exception using errcode = '55000', message = 'ITEMCODE_DEFAULT_OWNER_SEED_SOURCE_NOT_READY';
  end if;
  with current_codes as (
    select distinct upper(btrim(coalesce(m.itemcode, ''))) code
    from public.ph_master_inventory m
    where nullif(btrim(coalesce(m.itemcode, '')), '') is not null
  ), owners as (
    select upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) code,
      case when private.eval_assignment_profile_active_v1(case when a.zone_override_active
          then nullif(lower(btrim(a.zone_override_prior_assignedto)), '') else nullif(lower(btrim(a.assignedto)), '') end)
        then case when a.zone_override_active then nullif(lower(btrim(a.zone_override_prior_assignedto)), '')
          else nullif(lower(btrim(a.assignedto)), '') end else null end owner,
      (case when a.zone_override_active then nullif(lower(btrim(a.zone_override_prior_assignedto)), '')
        else nullif(lower(btrim(a.assignedto)), '') end is not null and not private.eval_assignment_profile_active_v1(
          case when a.zone_override_active then nullif(lower(btrim(a.zone_override_prior_assignedto)), '')
            else nullif(lower(btrim(a.assignedto)), '') end)) inactive_owner,
      case when a.zone_override_active then a.zone_override_prior_assigned_at else a.assigned_at end owner_assigned_at,
      case when a.zone_override_active then a.zone_override_prior_assigned_by else a.assigned_by end owner_assigned_by
    from public.ph_warehouse_assigned_items a
    where a.present_in_drive and a.assignment_key is not null
  ), grouped as (
    select o.code, count(*) filter (where o.owner is null) null_count,
      count(o.owner) owner_count, count(distinct o.owner) distinct_owners
    from owners o join current_codes c using (code)
    group by o.code
  )
  select g.code into conflicting from grouped g
  where g.distinct_owners > 1 or (g.null_count > 0 and g.owner_count > 0)
  order by g.code limit 1;
  if conflicting is not null then
    raise exception using errcode = '55000', message = 'ITEMCODE_DEFAULT_OWNER_SEED_CONFLICT:' || conflicting;
  end if;
end;
$$;

with current_codes as (
  select distinct upper(btrim(coalesce(m.itemcode, ''))) code
  from public.ph_master_inventory m
  where nullif(btrim(coalesce(m.itemcode, '')), '') is not null
), owners as (
  select upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) code,
    case when private.eval_assignment_profile_active_v1(case when a.zone_override_active
        then nullif(lower(btrim(a.zone_override_prior_assignedto)), '') else nullif(lower(btrim(a.assignedto)), '') end)
      then case when a.zone_override_active then nullif(lower(btrim(a.zone_override_prior_assignedto)), '')
        else nullif(lower(btrim(a.assignedto)), '') end else null end owner,
    (case when a.zone_override_active then nullif(lower(btrim(a.zone_override_prior_assignedto)), '')
      else nullif(lower(btrim(a.assignedto)), '') end is not null and not private.eval_assignment_profile_active_v1(
        case when a.zone_override_active then nullif(lower(btrim(a.zone_override_prior_assignedto)), '')
          else nullif(lower(btrim(a.assignedto)), '') end)) inactive_owner,
    case when a.zone_override_active then a.zone_override_prior_assigned_at else a.assigned_at end owner_assigned_at,
    case when a.zone_override_active then a.zone_override_prior_assigned_by else a.assigned_by end owner_assigned_by
  from public.ph_warehouse_assigned_items a
  where a.present_in_drive and a.assignment_key is not null
), grouped as (
  select o.code, min(o.owner) owner, min(o.owner_assigned_at) owner_assigned_at,
    min(o.owner_assigned_by) owner_assigned_by, bool_or(o.inactive_owner) inactive_owner
  from owners o join current_codes c using (code)
  group by o.code
)
insert into public.ph_itemcode_default_owners(itemcode_normalized, assignedto, assigned_at, revision, review_required, updated_by, updated_at)
select c.code,
  case when g.owner is not null and private.eval_assignment_profile_active_v1(g.owner) then g.owner else null end,
  case when g.owner is not null and private.eval_assignment_profile_active_v1(g.owner) then g.owner_assigned_at else null end,
  0,
  coalesce(g.inactive_owner,false),
  case when coalesce(g.inactive_owner,false) then 'inactive_owner_seed' else g.owner_assigned_by end,
  now()
from current_codes c left join grouped g using (code)
on conflict (itemcode_normalized) do nothing;

do $$
declare row_value record; current_revision bigint; source_state text;
begin
  select r.revision, r.state into current_revision, source_state
  from public.app_dataset_revisions r where r.key = 'ph_master_inventory' for share;
  if source_state is distinct from 'ready' or exists(
    select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory'
  ) then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_BACKFILL_SOURCE_NOT_READY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));
  for row_value in select m.unique_id from public.ph_master_inventory m order by m.unique_id loop
    perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, coalesce(current_revision, 0));
  end loop;
  update private.ph_inventory_row_assignment_policy_state
    set source_revision = coalesce(current_revision, 0), updated_at = now()
  where singleton and not active;
end;
$$;

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
    if current_row.revision <> (change_row.value->>'expectedRevision')::bigint then
      raise exception using errcode = '40001', message = 'ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT';
    end if;
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

notify pgrst, 'reload schema';
commit;
