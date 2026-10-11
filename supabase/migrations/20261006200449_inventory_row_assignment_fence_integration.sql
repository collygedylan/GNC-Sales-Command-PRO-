begin;

insert into app_sync_private.sources(key, modules, client_enabled, dylan_only) values
  ('ph_itemcode_default_owners', '{drive,tasks,managers,request,reports}', true, false),
  ('ph_inventory_row_assignments', '{drive,tasks,managers,request,reports}', true, false)
on conflict (key) do update set modules = excluded.modules, client_enabled = excluded.client_enabled;
insert into public.app_dataset_revisions(key)
values ('ph_itemcode_default_owners'), ('ph_inventory_row_assignments')
on conflict (key) do nothing;

create or replace function private.refresh_inventory_assignment_user_v1(p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uname text := lower(btrim(coalesce(p_username, ''))); codes text[] := '{}'::text[];
  source_revision bigint; row_value record; changed_rows integer := 0; inactive boolean; v_sqlstate text;
begin
  if uname = '' then return jsonb_build_object('status','ignored','rows',0); end if;
  inactive := not private.eval_assignment_profile_active_v1(uname);
  select coalesce(array_agg(distinct d.itemcode_normalized), '{}'::text[]) into codes
  from public.ph_itemcode_default_owners d where lower(btrim(d.assignedto)) = uname;

  -- An inactive account is never allowed to remain a default assignment.
  -- This transition cannot block profile/roster deactivation.
  if inactive then
    perform private.clear_inactive_default_owner_v1(uname);
  end if;

  select r.revision into source_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory';
  if exists(select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory') then
    return jsonb_build_object('status','deferred_to_import_finish','rows',0,'itemcodes',cardinality(codes));
  end if;

  begin
    perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));
    for row_value in
      select m.unique_id from public.ph_master_inventory m
      where upper(btrim(coalesce(m.itemcode,''))) = any(codes)
        or (private.eval_location_zone(m.locationcode) = 'inside'
          and ((uname = 'zoe_green' and upper(btrim(coalesce(m.plantgroupcode,''))) <> '135_ROSES')
            or (uname = 'mitch_kaiser' and upper(btrim(coalesce(m.plantgroupcode,''))) = '135_ROSES')))
      order by m.unique_id
    loop
      perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, coalesce(source_revision,0));
      changed_rows := changed_rows + 1;
    end loop;
  exception when others then
    -- Keep account revocation committed even if operational reconciliation
    -- needs a later full import/reconcile to recover.
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    raise warning 'assignment reconciliation deferred for inactive/status change (SQLSTATE %)', v_sqlstate;
    return jsonb_build_object('status','deferred_reconcile_error','errorCode','ASSIGNMENT_RECONCILE_DEFERRED',
      'rows',0,'itemcodes',cardinality(codes));
  end;
  return jsonb_build_object('status','completed','rows',changed_rows,'itemcodes',cardinality(codes));
end;
$$;
revoke all on function private.refresh_inventory_assignment_user_v1(text) from public, anon, authenticated, service_role;

create or replace function private.clear_inactive_default_owner_v1(p_username text)
returns integer language plpgsql security definer set search_path = '' as $$
declare uname text := lower(btrim(coalesce(p_username, ''))); v_request_id uuid := gen_random_uuid(); changed integer;
begin
  if uname = '' then return 0; end if;
  with changed_rows as (
    update public.ph_itemcode_default_owners d set assignedto = null, assigned_at = null,
      revision = d.revision + 1, review_required = true,
      updated_by = 'inactive_owner_reconcile', updated_at = now()
    where lower(btrim(d.assignedto)) = uname
    returning d.itemcode_normalized, d.revision
  )
  insert into private.ph_itemcode_default_owner_audit(request_id, itemcode_normalized, previous_owner,
    next_owner, old_revision, new_revision, actor_username)
  select v_request_id, c.itemcode_normalized, uname, null, c.revision - 1, c.revision, 'system_inactive_reconcile'
  from changed_rows c;
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function private.clear_inactive_default_owner_v1(text) from public, anon, authenticated, service_role;

create or replace function private.sync_inventory_assignment_roster_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sqlstate text;
begin
  if tg_op = 'INSERT' then
    begin
      perform private.refresh_inventory_assignment_user_v1(new.username);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise warning 'assignment refresh deferred for roster insert (SQLSTATE %)', v_sqlstate;
    end;
    return new;
  elsif tg_op = 'UPDATE' and lower(btrim(old.username)) is distinct from lower(btrim(new.username)) then
    begin
      perform private.refresh_inventory_assignment_user_v1(old.username);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if not private.eval_assignment_profile_active_v1(old.username) then
        perform private.clear_inactive_default_owner_v1(old.username);
      end if;
      raise warning 'assignment refresh deferred for roster rename (SQLSTATE %)', v_sqlstate;
    end;
  end if;
  if tg_op = 'DELETE' then
    begin
      perform private.refresh_inventory_assignment_user_v1(old.username);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      perform private.clear_inactive_default_owner_v1(old.username);
      raise warning 'assignment refresh deferred for roster removal (SQLSTATE %)', v_sqlstate;
    end;
    return old;
  end if;
  if old.active is distinct from new.active or lower(btrim(old.username)) is distinct from lower(btrim(new.username)) then
    begin
      perform private.refresh_inventory_assignment_user_v1(new.username);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if not private.eval_assignment_profile_active_v1(new.username) then
        perform private.clear_inactive_default_owner_v1(new.username);
      end if;
      raise warning 'assignment refresh deferred for roster status change (SQLSTATE %)', v_sqlstate;
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_inventory_assignment_roster_v1() from public, anon, authenticated, service_role;
drop trigger if exists trg_inventory_assignment_roster_status on public.ph_eval_assignment_users;
create trigger trg_inventory_assignment_roster_status after insert or update of active, username or delete
  on public.ph_eval_assignment_users for each row execute function private.sync_inventory_assignment_roster_v1();

create or replace function private.sync_inventory_assignment_profile_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_active boolean; new_active boolean; v_sqlstate text;
begin
  old_active := old.disabled_at is null and (old.locked_until is null or old.locked_until <= now());
  new_active := new.disabled_at is null and (new.locked_until is null or new.locked_until <= now());
  if old_active is distinct from new_active then
    begin
      perform private.refresh_inventory_assignment_user_v1(new.username);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      -- Do not let assignment repair availability block emergency account
      -- revocation. Exact owner resolution is fail-closed in the read helper.
      if not new_active then
        perform private.clear_inactive_default_owner_v1(new.username);
      end if;
      raise warning 'assignment refresh deferred for profile status change (SQLSTATE %)', v_sqlstate;
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_inventory_assignment_profile_v1() from public, anon, authenticated, service_role;
drop trigger if exists trg_inventory_assignment_profile_status on public.profiles;
create trigger trg_inventory_assignment_profile_status after update of disabled_at, locked_until
  on public.profiles for each row execute function private.sync_inventory_assignment_profile_v1();

do $$
declare v_source_revision bigint; v_seed_source_revision bigint; result jsonb; missing_rows bigint;
begin
  select r.revision into v_source_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory' and r.state = 'ready' for share;
  if not found or exists(select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory') then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_ACTIVATION_SOURCE_NOT_READY';
  end if;
  select s.source_revision into v_seed_source_revision
  from private.ph_inventory_row_assignment_policy_state s where s.singleton and not s.active;
  if v_seed_source_revision is null or v_seed_source_revision is distinct from v_source_revision then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_SEED_REVISION_CHANGED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));

  insert into public.ph_itemcode_default_owners(itemcode_normalized, assignedto, assigned_at,
    revision, review_required, updated_by, updated_at)
  select distinct upper(btrim(m.itemcode)), null::text, null::timestamptz, 0, false, 'source_seed', now()
  from public.ph_master_inventory m
  where nullif(btrim(coalesce(m.itemcode,'')), '') is not null
  on conflict (itemcode_normalized) do nothing;

  update public.ph_itemcode_default_owners d set assignedto = null, assigned_at = null,
    revision = d.revision + 1, review_required = true,
    updated_by = 'inactive_owner_activation_reconcile', updated_at = now()
  where d.assignedto is not null and not private.eval_assignment_profile_active_v1(d.assignedto);

  result := private.reconcile_inventory_row_assignments_v1(null::uuid);
  if result->>'status' is distinct from 'completed' then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_ACTIVATION_RECONCILE_FAILED';
  end if;
  select count(*) into missing_rows from public.ph_master_inventory m
  left join public.ph_inventory_row_assignments a on a.master_unique_id = m.unique_id and a.present_in_drive
  where a.master_unique_id is null;
  if missing_rows <> 0 or (result->>'processed')::bigint <> (select count(*) from public.ph_master_inventory) then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_ACTIVATION_COVERAGE_FAILED';
  end if;
  update private.ph_inventory_row_assignment_policy_state
    set active = true, source_revision = v_source_revision, activated_at = now(), updated_at = now()
  where singleton;
end;
$$;

drop trigger if exists app_dataset_revision_inserted on public.ph_itemcode_default_owners;
drop trigger if exists app_dataset_revision_updated on public.ph_itemcode_default_owners;
drop trigger if exists app_dataset_revision_deleted on public.ph_itemcode_default_owners;
drop trigger if exists app_dataset_revision_truncated on public.ph_itemcode_default_owners;
create trigger app_dataset_revision_inserted after insert on public.ph_itemcode_default_owners
  referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_itemcode_default_owners
  referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_itemcode_default_owners
  referencing old table as app_dataset_old_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_itemcode_default_owners
  for each statement execute function app_sync_private.touch_source();
drop trigger if exists app_dataset_revision_inserted on public.ph_inventory_row_assignments;
drop trigger if exists app_dataset_revision_updated on public.ph_inventory_row_assignments;
drop trigger if exists app_dataset_revision_deleted on public.ph_inventory_row_assignments;
drop trigger if exists app_dataset_revision_truncated on public.ph_inventory_row_assignments;
create trigger app_dataset_revision_inserted after insert on public.ph_inventory_row_assignments
  referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_inventory_row_assignments
  referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_inventory_row_assignments
  referencing old table as app_dataset_old_rows for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_inventory_row_assignments
  for each statement execute function app_sync_private.touch_source();

do $$
declare definition text;
  needle text := 'from unnest(coalesce(p_canonical_keys,keys)) requested(source_key);';
  patch text := needle || E'\n  if ''ph_master_inventory'' = any(keys) then\n    select array_agg(distinct requested.source_key order by requested.source_key) into keys\n    from unnest(keys || array[''ph_itemcode_default_owners'',''ph_inventory_row_assignments'']) requested(source_key);\n  end if;';
begin
  definition := pg_get_functiondef('app_sync_private.begin_import(text[],uuid,text[])'::regprocedure);
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 'INVENTORY_ROW_ASSIGNMENT_IMPORT_FENCE_PATCH_FAILED';
  end if;
  execute replace(definition, needle, patch);
end;
$$;

create or replace function public.reconcile_eval_itemcodes(p_import_run_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.reconcile_inventory_row_assignments_v1(p_import_run_id)
$$;
create or replace function public.reconcile_eval_itemcodes()
returns jsonb language sql security definer set search_path = '' as $$
  select private.reconcile_inventory_row_assignments_v1(null::uuid)
$$;
revoke all on function public.reconcile_eval_itemcodes(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_eval_itemcodes() from public, anon, authenticated;
grant execute on function public.reconcile_eval_itemcodes(uuid) to service_role;
grant execute on function public.reconcile_eval_itemcodes() to service_role;

create or replace function public.set_eval_itemcode_assignment(itemcode text, assignedto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'EVAL_ITEMCODE_GROUP_ASSIGNMENT_RETIRED';
end;
$$;
create or replace function public.set_eval_itemcode_assignment(itemcode text, genusname text, assignedto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'EVAL_ITEMCODE_GROUP_ASSIGNMENT_RETIRED';
end;
$$;
revoke all on function public.set_eval_itemcode_assignment(text,text) from public, anon, authenticated;
revoke all on function public.set_eval_itemcode_assignment(text,text,text) from public, anon, authenticated;
grant execute on function public.set_eval_itemcode_assignment(text,text) to service_role;
grant execute on function public.set_eval_itemcode_assignment(text,text,text) to service_role;

do $$
declare definition text; needle text := 'assignment_result := public.reconcile_eval_itemcodes(p_run_id);';
begin
  definition := pg_get_functiondef('app_sync_private.advance_import(uuid,text)'::regprocedure);
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 'INVENTORY_ROW_ASSIGNMENT_FINISH_HOOK_PATCH_FAILED';
  end if;
  execute replace(definition, needle,
    'assignment_result := private.reconcile_inventory_row_assignments_v1(p_run_id);');
end;
$$;

notify pgrst, 'reload schema';
commit;
