begin;

create table private.ph_inventory_row_assignment_policy_state (
  singleton boolean primary key default true check (singleton),
  active boolean not null default false,
  source_revision bigint,
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into private.ph_inventory_row_assignment_policy_state(singleton,active)
values(true,false) on conflict(singleton) do nothing;
revoke all on private.ph_inventory_row_assignment_policy_state from public, anon, authenticated, service_role;
create or replace function private.inventory_row_assignment_policy_active_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active)
$$;
revoke all on function private.inventory_row_assignment_policy_active_v1() from public, anon, service_role;
grant execute on function private.inventory_row_assignment_policy_active_v1() to authenticated;

create table public.ph_itemcode_default_owners (
  itemcode_normalized text primary key,
  assignedto text,
  assigned_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  review_required boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint ph_itemcode_default_owners_key_check check (itemcode_normalized <> '')
);

alter table public.ph_itemcode_default_owners enable row level security;
create policy ph_itemcode_default_owners_active_read on public.ph_itemcode_default_owners
  for select to authenticated using ((private.current_active_profile()).id is not null
    and private.inventory_row_assignment_policy_active_v1());
revoke all on public.ph_itemcode_default_owners from public, anon, authenticated;
grant select on public.ph_itemcode_default_owners to authenticated;
grant all on public.ph_itemcode_default_owners to service_role;

create table public.ph_inventory_row_assignments (
  master_unique_id text primary key,
  unique_id text not null unique,
  itemcode text,
  itemcode_normalized text,
  genusname text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  source text,
  warehousei text,
  assignedto text,
  assigned_at timestamptz,
  default_assignedto text,
  default_revision bigint not null default 0,
  zone_override_active boolean not null default false,
  assignment_reason text not null,
  review_required boolean not null default false,
  policy_revision bigint not null default 1,
  source_revision bigint not null default 0,
  present_in_drive boolean not null default true,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint ph_inventory_row_assignments_uid_alias check (unique_id = master_unique_id),
  constraint ph_inventory_row_assignments_reason_check check (assignment_reason in (
    'zone_zoe', 'zone_mitch_rose', 'itemcode_default', 'unassigned',
    'unresolved_preserved', 'unresolved_new', 'source_missing',
    'default_owner_inactive', 'zone_owner_inactive'
  )),
  constraint ph_inventory_row_assignments_revision_check check (
    default_revision >= 0 and policy_revision > 0 and source_revision >= 0 and revision > 0
  )
);
create index ph_inventory_row_assignments_owner_idx
  on public.ph_inventory_row_assignments (lower(btrim(assignedto)), master_unique_id)
  where present_in_drive and assignedto is not null;
create index ph_inventory_row_assignments_itemcode_idx
  on public.ph_inventory_row_assignments (itemcode_normalized, master_unique_id)
  where present_in_drive;
alter table public.ph_inventory_row_assignments enable row level security;
create policy ph_inventory_row_assignments_active_read on public.ph_inventory_row_assignments
  for select to authenticated using ((private.current_active_profile()).id is not null
    and private.inventory_row_assignment_policy_active_v1());
revoke all on public.ph_inventory_row_assignments from public, anon, authenticated;
grant select on public.ph_inventory_row_assignments to authenticated;
grant all on public.ph_inventory_row_assignments to service_role;

create table private.ph_inventory_row_assignment_audit (
  id bigint generated always as identity primary key,
  master_unique_id text not null,
  event_type text not null check (event_type in ('resolved', 'source_removed', 'default_changed')),
  previous_owner text,
  next_owner text,
  reason text not null,
  source_revision bigint not null,
  actor_username text,
  created_at timestamptz not null default now()
);
revoke all on private.ph_inventory_row_assignment_audit from public, anon, authenticated, service_role;
grant select on public.ph_inventory_row_assignments to authenticated;

create or replace function private.eval_assignment_profile_active_v1(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ph_eval_assignment_users u
    left join public.profiles p on lower(btrim(p.username)) = lower(btrim(u.username))
    where u.active and lower(btrim(u.username)) = lower(btrim(p_username))
      and (p.id is null or (p.disabled_at is null and (p.locked_until is null or p.locked_until <= now())))
  )
$$;
revoke all on function private.eval_assignment_profile_active_v1(text) from public, anon, authenticated, service_role;

create or replace function private.inventory_effective_owner_v1(master_unique_id text)
returns text
language sql stable security definer set search_path = '' as $$
  select case when private.eval_assignment_profile_active_v1(a.assignedto) then a.assignedto else null end
  from public.ph_inventory_row_assignments a
  where a.master_unique_id = $1 and a.present_in_drive
    and exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active)
$$;
revoke all on function private.inventory_effective_owner_v1(text) from public, anon, authenticated, service_role;

create or replace function private.resolve_inventory_row_assignment_v1(
  p_master_unique_id text,
  p_source_revision bigint default null
) returns public.ph_inventory_row_assignments
language plpgsql security definer set search_path = '' as $$
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
  if zone_state = 'inside' and upper(btrim(coalesce(source_row.plantgroupcode, ''))) = '135_ROSES' then
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
    coalesce(zone_state = 'inside', false), resolved_reason, review_flag, 1, source_rev, true,
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
$$;
revoke all on function private.resolve_inventory_row_assignment_v1(text, bigint) from public, anon, authenticated, service_role;

create or replace function private.reconcile_inventory_row_assignments_v1(p_import_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run app_sync_private.import_runs; source_state text; row_value record; source_rev bigint;
  processed integer := 0; retired integer := 0;
begin
  if p_import_run_id is null then
    select r.state into source_state from public.app_dataset_revisions r where r.key = 'ph_master_inventory' for share;
    if source_state is distinct from 'ready' or exists(
      select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory'
    ) then
      return jsonb_build_object('status', 'deferred', 'errorCode', 'MASTER_SNAPSHOT_NOT_READY', 'processed', 0);
    end if;
  else
    select * into run from app_sync_private.import_runs r where r.id = p_import_run_id;
    if run.id is null or run.state <> 'active' or run.expires_at <= clock_timestamp()
      or not ('ph_master_inventory' = any(run.source_keys))
      or not ('ph_master_inventory' = any(run.canonical_keys))
      or not exists(select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory' and l.run_id = run.id) then
      raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_IMPORT_FENCE_LOST';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));
  select r.revision + case when p_import_run_id is null then 0 else 1 end into source_rev
  from public.app_dataset_revisions r where r.key = 'ph_master_inventory';
  for row_value in select m.unique_id from public.ph_master_inventory m order by m.unique_id loop
    perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, source_rev);
    processed := processed + 1;
  end loop;
  with retired_rows as (
    update public.ph_inventory_row_assignments a set present_in_drive = false, assignment_reason = 'source_missing',
      review_required = true, source_revision = source_rev, revision = a.revision + 1, updated_at = now()
    where a.present_in_drive and not exists(select 1 from public.ph_master_inventory m where m.unique_id = a.master_unique_id)
    returning a.master_unique_id, a.assignedto
  )
  insert into private.ph_inventory_row_assignment_audit(
    master_unique_id, event_type, previous_owner, next_owner, reason, source_revision
  )
  select r.master_unique_id, 'source_removed', r.assignedto, r.assignedto, 'source_missing', source_rev
  from retired_rows r;
  get diagnostics retired = row_count;
  return jsonb_build_object('status', 'completed', 'processed', processed, 'retired', retired, 'sourceRevision', source_rev);
end;
$$;
revoke all on function private.reconcile_inventory_row_assignments_v1(uuid) from public, anon, authenticated, service_role;

create or replace function private.sync_inventory_row_assignment_statement_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare importing boolean; stale_lease boolean; source_state text; row_value record;
begin
  if not exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active) then
    return null;
  end if;
  select r.state into source_state from public.app_dataset_revisions r where r.key = 'ph_master_inventory';
  select exists(select 1 from app_sync_private.import_leases l
    join app_sync_private.import_runs r on r.id = l.run_id
    where l.key = 'ph_master_inventory' and r.state = 'active' and r.expires_at > clock_timestamp()) into importing;
  select exists(select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory') into stale_lease;
  if importing and source_state is distinct from 'ready' then return null; end if;
  if source_state is distinct from 'ready' then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_NOT_READY';
  end if;
  if stale_lease and not importing then
    raise exception using errcode = '55000', message = 'MASTER_IMPORT_FENCE_EXPIRED';
  end if;
  if importing then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));

  if tg_op = 'INSERT' then
    for row_value in select n.unique_id from new_rows n order by n.unique_id loop
      perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, null);
    end loop;
  elsif tg_op = 'DELETE' then
    for row_value in select o.unique_id from old_rows o order by o.unique_id loop
      perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, null);
    end loop;
  else
    for row_value in
      select changed.unique_id from (
        select o.unique_id from old_rows o
        where not exists(select 1 from new_rows n where n.unique_id = o.unique_id)
          or exists(select 1 from new_rows n where n.unique_id = o.unique_id
            and (o.itemcode, o.genusname, o.plantgroupcode, o.commonname, o.contsize,
              o.locationcode, o.lotcode, o.source, o.warehousei)
              is distinct from (n.itemcode, n.genusname, n.plantgroupcode, n.commonname, n.contsize,
              n.locationcode, n.lotcode, n.source, n.warehousei))
        union
        select n.unique_id from new_rows n
        where not exists(select 1 from old_rows o where o.unique_id = n.unique_id)
          or exists(select 1 from old_rows o where o.unique_id = n.unique_id
            and (o.itemcode, o.genusname, o.plantgroupcode, o.commonname, o.contsize,
              o.locationcode, o.lotcode, o.source, o.warehousei)
              is distinct from (n.itemcode, n.genusname, n.plantgroupcode, n.commonname, n.contsize,
              n.locationcode, n.lotcode, n.source, n.warehousei))
      ) changed order by changed.unique_id
    loop
      perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, null);
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.sync_inventory_row_assignment_statement_v1() from public, anon, authenticated, service_role;
drop trigger if exists trg_ph_master_inventory_row_assignment_insert on public.ph_master_inventory;
drop trigger if exists trg_ph_master_inventory_row_assignment_update on public.ph_master_inventory;
drop trigger if exists trg_ph_master_inventory_row_assignment_delete on public.ph_master_inventory;
create trigger trg_ph_master_inventory_row_assignment_insert after insert on public.ph_master_inventory
  referencing new table as new_rows for each statement execute function private.sync_inventory_row_assignment_statement_v1();
create trigger trg_ph_master_inventory_row_assignment_update after update on public.ph_master_inventory
  referencing old table as old_rows new table as new_rows for each statement execute function private.sync_inventory_row_assignment_statement_v1();
create trigger trg_ph_master_inventory_row_assignment_delete after delete on public.ph_master_inventory
  referencing old table as old_rows for each statement execute function private.sync_inventory_row_assignment_statement_v1();

notify pgrst, 'reload schema';
commit;
