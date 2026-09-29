begin;

create schema if not exists private;

-- These columns start inactive. The first successful, fenced master refresh
-- establishes the policy state; applying this migration never reallocates
-- historical owners from a partial or unknown snapshot.
alter table public.ph_warehouse_assigned_items
  add column zone_override_active boolean not null default false,
  add column zone_override_prior_assignedto text,
  add column zone_override_prior_assigned_by text,
  add column zone_override_prior_assigned_at timestamptz,
  add column zone_override_rule_version text,
  add column zone_override_evaluated_revision bigint,
  add column assignment_reason text;

create table private.ph_perennial_assignment_policy_state (
  singleton boolean primary key default true check (singleton),
  activated boolean not null default false,
  activated_at timestamptz,
  activation_import_run_id uuid
);
alter table private.ph_perennial_assignment_policy_state enable row level security;
revoke all on private.ph_perennial_assignment_policy_state from public,anon,authenticated,service_role;
insert into private.ph_perennial_assignment_policy_state(singleton,activated)
values(true,false) on conflict(singleton) do nothing;

create table if not exists private.ph_warehouse_assignment_audit (
  id bigint generated always as identity primary key,
  assignment_key text not null,
  event_type text not null check (event_type in ('manual_assignment','zone_enforced','zone_lock_reasserted','rose_exemption_restore','zone_exit_unassigned')),
  reason text not null,
  rule_version text not null,
  evaluated_inventory_revision bigint,
  actor_username text,
  old_assignedto text,
  new_assignedto text,
  old_zone_override_active boolean not null,
  new_zone_override_active boolean not null,
  import_run_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists ph_warehouse_assignment_audit_key_time_idx
  on private.ph_warehouse_assignment_audit(assignment_key,created_at desc);
alter table private.ph_warehouse_assignment_audit enable row level security;
revoke all on private.ph_warehouse_assignment_audit from public,anon,authenticated,service_role;
grant select,insert on private.ph_warehouse_assignment_audit to postgres;
grant usage,select on sequence private.ph_warehouse_assignment_audit_id_seq to postgres;

create or replace function private.eval_location_zone(p_location text)
returns text
language plpgsql immutable set search_path='' as $$
declare value text := upper(regexp_replace(btrim(coalesce(p_location,'')),'[[:space:]]+','','g'));
  parts text[];
begin
  if value !~ '^[A-Z]\.[0-9]{2}(\.[0-9]{3})?$' then return null; end if;
  parts := string_to_array(value,'.');
  if parts[1]='C' and parts[2] in ('06','07') then return 'inside'; end if;
  if parts[1]='D' and parts[2] between '04' and '09' then return 'inside'; end if;
  if parts[1]='D' and parts[2]='10' and cardinality(parts)<>3 then return null; end if;
  if parts[1]='D' and parts[2]='10' and cardinality(parts)=3
    and parts[3]::integer <= 21 then return 'inside'; end if;
  return 'outside';
end $$;
revoke all on function private.eval_location_zone(text) from public,anon,authenticated;

create or replace function private.audit_eval_assignment_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare action text:=coalesce(nullif(current_setting('app.perennial_assignment_action',true),''),'manual');
  event_name text; actor text;
begin
  if coalesce(new.assignment_key,old.assignment_key) is null then return new; end if;
  if tg_op='UPDATE' and new.assignedto is not distinct from old.assignedto
    and new.assigned_by is not distinct from old.assigned_by
    and new.assigned_at is not distinct from old.assigned_at
    and new.zone_override_active is not distinct from old.zone_override_active then return new; end if;
  if action='zone_reconcile' then return new; end if;
  if action='manual' and tg_op='UPDATE' and old.zone_override_active
    and (new.assignedto is distinct from old.assignedto or new.assigned_by is distinct from old.assigned_by
      or new.assigned_at is distinct from old.assigned_at) then
    raise exception using errcode='55000',message='EVAL_ASSIGNMENT_ZONE_LOCKED';
  end if;
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
end $$;
revoke all on function private.audit_eval_assignment_change() from public,anon,authenticated;
drop trigger if exists ph_warehouse_assignment_audit on public.ph_warehouse_assigned_items;
create trigger ph_warehouse_assignment_audit before insert or update of assignedto,assigned_by,assigned_at,zone_override_active
  on public.ph_warehouse_assigned_items for each row execute function private.audit_eval_assignment_change();

-- One canonical hash is shared by the early app-permissions read and the
-- dataset snapshot so a client can validate cached display before source RPCs.
create or replace function app_sync_private.data_permission_version(p_actor uuid)
returns text language sql stable security definer set search_path='' as $$
  select md5(
    jsonb_build_object('id',profile.id,'username',profile.username,'role',profile.role,'division',profile.division)::text
    || coalesce((select jsonb_agg(to_jsonb(permission)||jsonb_build_object(
        'allowed',case when private.is_kayla_managed_role_v1(profile.role) and override.permission_key is not null
          then override.allowed else permission.allowed end,
        'decision_source',case when private.is_kayla_managed_role_v1(profile.role) and override.permission_key is not null
          then 'limited-user' else permission.decision_source end)
        order by permission.permission_key)::text
      from private.get_effective_app_permissions_v1(p_actor,private.resolve_app_access_policy_id_v1(false)) permission
      left join private.app_limited_live_overrides override
        on override.profile_id=p_actor and override.permission_key=permission.permission_key),'[]')
  ) from public.profiles profile where profile.id=p_actor
$$;
revoke all on function app_sync_private.data_permission_version(uuid) from public,anon,authenticated;

do $$ declare definition text; needle text:='version := md5(actor_scope::text||permissions::text);'; begin
  definition:=pg_get_functiondef('app_sync_private.snapshot(text[])'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'PERMISSION_VERSION_CANONICAL_PATCH_FAILED';
  end if;
  execute replace(definition,needle,'version := app_sync_private.data_permission_version(actor);');
end $$;

create or replace function public.get_my_app_permissions_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile public.profiles; state private.app_access_runtime_state; policy private.app_access_policy_versions;
  permissions jsonb; permission_version text;
begin
  profile:=private.current_active_profile();
  if profile.id is null then raise exception using errcode='42501',message='APP_ACCESS_PROFILE_REQUIRED'; end if;
  select * into state from private.app_access_runtime_state where singleton;
  select * into policy from private.app_access_policy_versions where id=private.resolve_app_access_policy_id_v1(false);
  select coalesce(jsonb_agg(jsonb_build_object('permissionKey',e.permission_key,'kind',e.permission_kind,
    'moduleKey',e.module_key,'label',e.label,'allowed',case when private.is_kayla_managed_role_v1(profile.role)
      and o.permission_key is not null then o.allowed else e.allowed end,
    'scope',e.access_scope,'source',case when private.is_kayla_managed_role_v1(profile.role)
      and o.permission_key is not null then 'limited-user' else e.decision_source end)
    order by e.sort_order,e.permission_key),'[]'::jsonb) into permissions
  from private.get_effective_app_permissions_v1(profile.id,policy.id) e
  left join private.app_limited_live_overrides o on o.profile_id=profile.id and o.permission_key=e.permission_key;
  permission_version:=app_sync_private.data_permission_version(profile.id);
  return jsonb_build_object('contractVersion','app-access-v1','enforcementMode',state.enforcement_mode,
    'policyVersion',policy.version_number,'policyRevision',policy.revision,
    'dataPermissionVersion',permission_version,
    'username',lower(btrim(profile.username)),'role',profile.role,'permissions',permissions);
end $$;

create or replace function public.reconcile_eval_itemcodes(p_import_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lock_acquired boolean; source_state text; run app_sync_private.import_runs;
  inventory_revision bigint; zone_candidates boolean;
  discovered integer:=0; changed integer:=0; removed integer:=0; alerted integer:=0; unassigned_total integer:=0;
  policy_changed integer:=0;
  previous_action text:=current_setting('app.perennial_assignment_action',true);
  previous_run text:=current_setting('app.perennial_import_run_id',true);
begin
  if p_import_run_id is null then
    select state into source_state from public.app_dataset_revisions where key='ph_master_inventory' for share;
    if source_state is distinct from 'ready' then
      return jsonb_build_object('status','deferred','errorCode','MASTER_SNAPSHOT_NOT_READY','discovered',0,'changed',0,'removed',0,'alerts_queued',0);
    end if;
    if not coalesce((select activated from private.ph_perennial_assignment_policy_state where singleton),false) then
      return jsonb_build_object('status','deferred','errorCode','PERENNIAL_POLICY_AWAITING_MASTER_IMPORT','discovered',0,'changed',0,'removed',0,'alerts_queued',0);
    end if;
  else
    select * into run from app_sync_private.import_runs where id=p_import_run_id;
    if run.id is null or run.state<>'active' or run.expires_at<=clock_timestamp()
      or not ('ph_master_inventory'=any(run.source_keys))
      or not ('ph_master_inventory'=any(run.canonical_keys))
      or not exists(select 1 from app_sync_private.import_leases l where l.key='ph_master_inventory' and l.run_id=run.id) then
      raise exception using errcode='55000',message='PERENNIAL_RECONCILE_IMPORT_FENCE_LOST';
    end if;
  end if;
  lock_acquired:=pg_try_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2',0));
  if not lock_acquired then return jsonb_build_object('status','deferred','errorCode','MAINTENANCE_DEFERRED','discovered',0,'changed',0,'removed',0,'alerts_queued',0); end if;
  select revision into inventory_revision from public.app_dataset_revisions where key='ph_master_inventory';
  if p_import_run_id is not null then inventory_revision:=inventory_revision+1; end if;
  select exists(
    select 1 from public.ph_master_inventory mi
    where private.eval_location_zone(mi.locationcode)='inside'
      and nullif(btrim(coalesce(mi.itemcode,'')),'') is not null
      and not exists(select 1 from public.ph_master_inventory rose
        where upper(btrim(rose.itemcode))=upper(btrim(mi.itemcode))
          and lower(regexp_replace(btrim(coalesce(rose.genusname,'')),'[[:space:]]+',' ','g'))=
            lower(regexp_replace(btrim(coalesce(mi.genusname,'')),'[[:space:]]+',' ','g'))
          and upper(btrim(coalesce(rose.plantgroupcode,'')))='135_ROSES')
  ) into zone_candidates;
  if zone_candidates and not exists(select 1 from public.ph_eval_assignment_users where active and lower(btrim(username))='zoe_green') then
    raise exception using errcode='55000',message='PERENNIAL_ZONE_ZOE_INACTIVE';
  end if;
  perform set_config('app.perennial_assignment_action','zone_reconcile',true);
  perform set_config('app.perennial_import_run_id',coalesce(p_import_run_id::text,''),true);

  with normalized_drive as materialized (
    select upper(btrim(itemcode)) itemcode_normalized,
      lower(regexp_replace(btrim(coalesce(genusname,'')),'[[:space:]]+',' ','g')) genusname_normalized,
      genusname,commonname,contsize,locationcode,plantgroupcode
    from public.ph_master_inventory where nullif(btrim(coalesce(itemcode,'')),'') is not null
  ), drive_codes as materialized (
    select itemcode_normalized,genusname_normalized,itemcode_normalized||'|'||genusname_normalized assignment_key,
      max(genusname) genusname,max(commonname) commonname,max(contsize) contsize,max(locationcode) locationcode
    from normalized_drive group by itemcode_normalized,genusname_normalized
  ), changed_codes as materialized (
    select d.* from drive_codes d left join public.ph_warehouse_assigned_items a using(assignment_key)
    where a.assignment_key is null or a.itemcode is distinct from d.itemcode_normalized
      or a.itemcode_normalized is distinct from d.itemcode_normalized or a.genusname is distinct from d.genusname
      or a.genusname_normalized is distinct from d.genusname_normalized
      or a.concat is distinct from (d.itemcode_normalized||d.genusname) or a.commonname is distinct from d.commonname
      or a.contsize is distinct from d.contsize or a.locationcode is distinct from d.locationcode or not a.present_in_drive
  ), written as (
    insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,genusname_normalized,
      concat,assignment_key,commonname,contsize,locationcode,source,first_seen_at,last_seen_at,present_in_drive,raw_row,updated_at)
    select 'eval-itemcode-genus-'||md5(d.assignment_key),d.itemcode_normalized,d.itemcode_normalized,d.genusname,
      d.genusname_normalized,d.itemcode_normalized||d.genusname,d.assignment_key,d.commonname,d.contsize,d.locationcode,
      'supabase_drive_reconcile',now(),now(),true,jsonb_build_object('authority','supabase','scope','itemcode_genus'),now()
    from changed_codes d on conflict(assignment_key) where assignment_key is not null do update set
      itemcode=excluded.itemcode,itemcode_normalized=excluded.itemcode_normalized,genusname=excluded.genusname,
      genusname_normalized=excluded.genusname_normalized,concat=excluded.concat,commonname=excluded.commonname,
      contsize=excluded.contsize,locationcode=excluded.locationcode,
      source=case when public.ph_warehouse_assigned_items.source='google_sheet_cutover_20260820'
        then public.ph_warehouse_assigned_items.source else 'supabase_drive_reconcile' end,
      last_seen_at=now(),present_in_drive=true,updated_at=now() returning (xmax=0) was_inserted
  ), removed_rows as (
    update public.ph_warehouse_assigned_items a set present_in_drive=false,updated_at=now()
    where a.present_in_drive and a.assignment_key is not null
      and not exists(select 1 from drive_codes d where d.assignment_key=a.assignment_key) returning 1
  )
  select (select count(*) filter(where was_inserted)::integer from written),
    (select count(*) filter(where not was_inserted)::integer from written),(select count(*)::integer from removed_rows)
  into discovered,changed,removed;

  -- Group presence must be resolved by a parseable source row. An absent key or
  -- a group with only malformed locations retains its prior assignment state.
  with group_state as materialized (
    select upper(btrim(mi.itemcode))||'|'||lower(regexp_replace(btrim(coalesce(mi.genusname,'')),'[[:space:]]+',' ','g')) assignment_key,
      bool_or(upper(btrim(coalesce(mi.plantgroupcode,'')))='135_ROSES') rose,
      bool_or(private.eval_location_zone(mi.locationcode)='inside') in_zone,
      bool_or(private.eval_location_zone(mi.locationcode) is null) unresolved,
      bool_and(private.eval_location_zone(mi.locationcode)='outside') all_outside
    from public.ph_master_inventory mi where nullif(btrim(coalesce(mi.itemcode,'')),'') is not null
    group by 1
  ), action_rows as materialized (
    select a.id,a.assignment_key,a.assignedto,a.assigned_by,a.assigned_at,a.zone_override_active,
      s.rose,s.in_zone,s.unresolved,s.all_outside,
      case when not s.rose and s.in_zone and not a.zone_override_active then 'enforce'
        when not s.rose and s.in_zone and a.zone_override_active and a.assignedto is distinct from 'zoe_green' then 'reassert'
        when s.rose and a.zone_override_active then 'restore'
        when not s.rose and not s.in_zone and not s.unresolved and s.all_outside and a.zone_override_active then 'exit'
        else null end action
    from public.ph_warehouse_assigned_items a join group_state s using(assignment_key)
    where a.assignment_key is not null and a.present_in_drive
  ), audit_rows as (
    insert into private.ph_warehouse_assignment_audit(assignment_key,event_type,actor_username,old_assignedto,new_assignedto,
      old_zone_override_active,new_zone_override_active,reason,rule_version,evaluated_inventory_revision,import_run_id)
    select action_rows.assignment_key,case action_rows.action when 'enforce' then 'zone_enforced'
      when 'reassert' then 'zone_lock_reasserted' when 'restore' then 'rose_exemption_restore' else 'zone_exit_unassigned' end,
      'system',action_rows.assignedto,
      case action_rows.action when 'enforce' then 'zoe_green' when 'reassert' then 'zoe_green'
        when 'restore' then case when exists(select 1 from public.ph_eval_assignment_users u
          where u.active and lower(btrim(u.username))=lower(btrim(a.zone_override_prior_assignedto)))
          then a.zone_override_prior_assignedto else null end else null end,
      action_rows.zone_override_active,action_rows.action in ('enforce','reassert'),
      case action_rows.action when 'enforce' then 'entered_perennial_zone' when 'reassert' then 'zone_owner_reasserted'
        when 'restore' then case when a.zone_override_prior_assignedto is not null and not exists(
          select 1 from public.ph_eval_assignment_users u where u.active
            and lower(btrim(u.username))=lower(btrim(a.zone_override_prior_assignedto)))
          then 'saved_owner_inactive_reset' else 'rose_exemption_restore' end
        else 'left_perennial_zone' end,
      'perennial-zone-2026-09-v1',inventory_revision,p_import_run_id
    from action_rows join public.ph_warehouse_assigned_items a using(id) where action_rows.action is not null
    returning 1
  )
  update public.ph_warehouse_assigned_items a set
    assignedto=case r.action when 'enforce' then 'zoe_green' when 'reassert' then 'zoe_green'
      when 'restore' then case when exists(select 1 from public.ph_eval_assignment_users u
        where u.active and lower(btrim(u.username))=lower(btrim(a.zone_override_prior_assignedto)))
        then a.zone_override_prior_assignedto else null end else null end,
    assigned_by=case r.action when 'enforce' then 'perennial_zone_policy' when 'reassert' then 'perennial_zone_policy'
      when 'restore' then case when exists(select 1 from public.ph_eval_assignment_users u
        where u.active and lower(btrim(u.username))=lower(btrim(a.zone_override_prior_assignedto)))
        then a.zone_override_prior_assigned_by else null end else null end,
    assigned_at=case r.action when 'enforce' then clock_timestamp() when 'reassert' then clock_timestamp()
      when 'restore' then case when exists(select 1 from public.ph_eval_assignment_users u
        where u.active and lower(btrim(u.username))=lower(btrim(a.zone_override_prior_assignedto)))
        then a.zone_override_prior_assigned_at else null end else null end,
    zone_override_active=(r.action in ('enforce','reassert')),
    zone_override_prior_assignedto=case r.action when 'enforce' then a.assignedto when 'reassert' then a.zone_override_prior_assignedto else null end,
    zone_override_prior_assigned_by=case r.action when 'enforce' then a.assigned_by when 'reassert' then a.zone_override_prior_assigned_by else null end,
    zone_override_prior_assigned_at=case r.action when 'enforce' then a.assigned_at when 'reassert' then a.zone_override_prior_assigned_at else null end,
    zone_override_rule_version=case when r.action in ('enforce','reassert') then 'perennial-zone-2026-09-v1' else null end,
    zone_override_evaluated_revision=case when r.action in ('enforce','reassert') then inventory_revision else null end,
    assignment_reason=case r.action when 'enforce' then 'perennial_zone_area'
      when 'reassert' then 'perennial_zone_owner_reasserted'
      when 'restore' then case when a.zone_override_prior_assignedto is not null and not exists(
        select 1 from public.ph_eval_assignment_users u where u.active
          and lower(btrim(u.username))=lower(btrim(a.zone_override_prior_assignedto)))
        then 'saved_owner_inactive_reset' else 'rose_exemption_restore' end
      else 'left_perennial_zone' end,
    unassigned_notified_at=case when r.action='exit' or (r.action='restore' and not exists(
      select 1 from public.ph_eval_assignment_users u where u.active
        and lower(btrim(u.username))=lower(btrim(a.zone_override_prior_assignedto)))) then null
      when r.action='enforce' then clock_timestamp() else a.unassigned_notified_at end,
    updated_at=clock_timestamp()
    from action_rows r where r.id=a.id and r.action is not null;
  get diagnostics policy_changed=row_count;

  -- Track every successful full evaluation without producing another transition audit.
  update public.ph_warehouse_assigned_items a set
    zone_override_evaluated_revision=inventory_revision,
    zone_override_rule_version='perennial-zone-2026-09-v1',
    updated_at=clock_timestamp()
  where a.present_in_drive and a.zone_override_active and a.assignedto='zoe_green'
    and a.zone_override_evaluated_revision is distinct from inventory_revision
    and exists(select 1 from public.ph_master_inventory mi
      where upper(btrim(mi.itemcode))||'|'||lower(regexp_replace(btrim(coalesce(mi.genusname,'')),'[[:space:]]+',' ','g'))=a.assignment_key
        and private.eval_location_zone(mi.locationcode)='inside')
    and not exists(select 1 from public.ph_master_inventory rose
      where upper(btrim(rose.itemcode))||'|'||lower(regexp_replace(btrim(coalesce(rose.genusname,'')),'[[:space:]]+',' ','g'))=a.assignment_key
        and upper(btrim(coalesce(rose.plantgroupcode,'')))='135_ROSES');
  changed:=changed+policy_changed;

  with needs_alert as (
    select id,itemcode_normalized,genusname,assignment_key from public.ph_warehouse_assigned_items
    where present_in_drive and nullif(btrim(coalesce(assignedto,'')),'') is null and unassigned_notified_at is null for update
  ), queued as (
    insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status)
    select 'eval-unassigned:'||md5(assignment_key),'eval_assignment_unassigned',jsonb_build_object('itemcode',itemcode_normalized,
      'genusname',genusname,'assignment_key',assignment_key,'manager_usernames',jsonb_build_array('dylan_collyge','megan_kelly')),'pending'
    from needs_alert on conflict(event_key) do update set
      status=case when public.ph_request_delivery_outbox.status='delivered' then 'pending' else public.ph_request_delivery_outbox.status end,
      next_attempt_at=now(),delivered_at=null,sanitized_error_code=null returning event_key
  ) select count(*)::integer into alerted from queued;
  update public.ph_warehouse_assigned_items set unassigned_notified_at=now(),updated_at=now()
    where present_in_drive and nullif(btrim(coalesce(assignedto,'')),'') is null and unassigned_notified_at is null;
  select count(*)::integer into unassigned_total from public.ph_warehouse_assigned_items where present_in_drive
    and nullif(btrim(coalesce(assignedto,'')),'') is null;
  if p_import_run_id is not null then
    update private.ph_perennial_assignment_policy_state set activated=true,activated_at=coalesce(activated_at,clock_timestamp()),
      activation_import_run_id=coalesce(activation_import_run_id,p_import_run_id) where singleton;
  end if;
  perform set_config('app.perennial_assignment_action',coalesce(previous_action,''),true);
  perform set_config('app.perennial_import_run_id',coalesce(previous_run,''),true);
  return jsonb_build_object('status','completed','discovered',discovered,'changed',changed,'assignment_changes',policy_changed,'removed',removed,
    'alerts_queued',alerted,'unassigned_count',unassigned_total,'policy_activated',
    coalesce((select activated from private.ph_perennial_assignment_policy_state where singleton),false));
end $$;
revoke all on function public.reconcile_eval_itemcodes(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_eval_itemcodes(uuid) to service_role;
create or replace function public.reconcile_eval_itemcodes() returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.reconcile_eval_itemcodes(null::uuid); end $$;
revoke all on function public.reconcile_eval_itemcodes() from public,anon,authenticated;
grant execute on function public.reconcile_eval_itemcodes() to service_role;

-- Serialize interactive edits in the same order as snapshot publication:
-- master revision lock, reconciliation advisory lock, then the assignment row.
do $$ declare definition text; auth_needle text; key_needle text; begin
  definition:=pg_get_functiondef('public.set_eval_itemcode_assignment(text,text,text)'::regprocedure);
  auth_needle:=E'if not private.can_manage_eval_assignments() then\n    raise exception using errcode = ''42501'', message = ''EVAL_ASSIGNMENT_FORBIDDEN'';\n  end if;';
  key_needle:='normalized_key := private.normalize_eval_assignment_key(normalized_code, resolved_genus);';
  if (length(definition)-length(replace(definition,auth_needle,'')))/length(auth_needle)<>1
    or (length(definition)-length(replace(definition,key_needle,'')))/length(key_needle)<>1 then
    raise exception 'PERENNIAL_ASSIGNMENT_RPC_LOCK_PATCH_FAILED';
  end if;
  definition:=replace(definition,auth_needle,auth_needle||E'\n  perform 1 from public.app_dataset_revisions where key=''ph_master_inventory'' for share;\n  if not found or (select state from public.app_dataset_revisions where key=''ph_master_inventory'') is distinct from ''ready'' then\n    raise exception using errcode=''55000'',message=''EVAL_ASSIGNMENT_SOURCE_NOT_READY'';\n  end if;\n  perform pg_advisory_xact_lock(hashtextextended(''gnc-reconcile-eval-itemcodes-v2'',0));');
  definition:=replace(definition,key_needle,key_needle||E'\n  if exists(select 1 from public.ph_warehouse_assigned_items where assignment_key=normalized_key and zone_override_active) then\n    raise exception using errcode=''55000'',message=''EVAL_ASSIGNMENT_ZONE_LOCKED'';\n  end if;');
  execute definition;
end $$;

-- Preserve the existing delta/lock implementation and add one atomic policy
-- reconciliation before the master source is marked ready.
do $$ declare definition text; needle text:='if p_action=''heartbeat'' then'; declaration text:='declare run app_sync_private.import_runs; target text;';
  return_needle text:='return jsonb_build_object(''ok'',true,''runId'',run.id,''state'',target);'; begin
  definition:=pg_get_functiondef('app_sync_private.advance_import(uuid,text)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'PERENNIAL_IMPORT_FINISH_HOOK_PATCH_FAILED';
  end if;
  if (length(definition)-length(replace(definition,declaration,'')))/length(declaration)<>1
    or (length(definition)-length(replace(definition,return_needle,'')))/length(return_needle)<>1 then
    raise exception 'PERENNIAL_IMPORT_RESULT_PATCH_FAILED';
  end if;
  definition:=replace(definition,declaration,declaration||' assignment_result jsonb;');
  definition:=replace(definition,needle,
    E'if p_action=''finish'' and ''ph_master_inventory''=any(run.source_keys) and ''ph_master_inventory''=any(run.canonical_keys) then\n    assignment_result := public.reconcile_eval_itemcodes(p_run_id);\n    if coalesce(assignment_result->>''status'','''') <> ''completed'' then\n      raise exception using errcode=''55000'',message=''PERENNIAL_ASSIGNMENT_RECONCILE_INCOMPLETE'';\n    end if;\n  end if;\n  '||needle);
  definition:=replace(definition,return_needle,
    'return jsonb_strip_nulls(jsonb_build_object(''ok'',true,''runId'',run.id,''state'',target,''perennialAssignment'',assignment_result));');
  execute definition;
end $$;

notify pgrst,'reload schema';
commit;
