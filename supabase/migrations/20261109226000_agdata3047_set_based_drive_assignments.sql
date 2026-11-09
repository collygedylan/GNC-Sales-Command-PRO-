begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

create type private.inventory_row_owner_decision_v3047 as (
  assignedto text, assignment_reason text, review_required boolean, zone_override_active boolean
);

create function private.inventory_assignment_actor_active_v3047(p_name text,p_active text[])
returns boolean language sql stable set search_path='' as $active$
  select case when p_active is null then private.eval_assignment_profile_active_v1(p_name)
    else coalesce(lower(btrim(p_name))=any(p_active),false) end
$active$;

-- Keep one precedence owner for interactive and native ERP assignment writes.
create function private.decide_inventory_row_owner_v3047(
  p_zone text,p_plant_group text,p_prior public.ph_inventory_row_assignments,
  p_default public.ph_itemcode_default_owners,p_legacy public.ph_warehouse_assigned_items,
  p_allow_legacy boolean,p_default_allowed boolean default null,p_active text[] default null
)
returns private.inventory_row_owner_decision_v3047 language plpgsql stable set search_path='' as $decide$
declare
  candidate text;
  zone_owner text;
  zone_reason text;
  legacy_present boolean := p_allow_legacy and p_legacy.present_in_drive and p_legacy.assignment_key is not null;
begin
  if p_default.updated_by is not null or p_default.assignedto is not null then
    if p_default.assignedto is not null and not coalesce(p_default_allowed,
      private.itemcode_owner_candidate_v1(p_default.assignedto)) then
      return (null,'default_owner_inactive',true,false)::private.inventory_row_owner_decision_v3047;
    end if;
    return (p_default.assignedto,case when p_default.assignedto is null then 'unassigned' else 'itemcode_default' end,
      coalesce(p_default.review_required,false),false)::private.inventory_row_owner_decision_v3047;
  end if;
  if p_zone='inside' then
    if upper(btrim(coalesce(p_plant_group,'')))='135_ROSES' then
      zone_owner:='mitch_kaiser';
      zone_reason:='zone_mitch_rose';
    else
      zone_owner:='zoe_green';
      zone_reason:='zone_zoe';
    end if;
    if private.inventory_assignment_actor_active_v3047(zone_owner,p_active) then
      return (zone_owner,zone_reason,false,true)::private.inventory_row_owner_decision_v3047;
    end if;
    return (null,'zone_owner_inactive',true,true)::private.inventory_row_owner_decision_v3047;
  end if;
  if p_zone='outside' then
    return (p_default.assignedto,case when p_default.review_required then 'default_owner_inactive'
      when p_default.assignedto is null then 'unassigned' else 'itemcode_default' end,
      coalesce(p_default.review_required,false),false)::private.inventory_row_owner_decision_v3047;
  end if;
  candidate:=case when p_prior.present_in_drive then p_prior.assignedto when legacy_present then
    case when p_legacy.zone_override_active then nullif(lower(btrim(p_legacy.zone_override_prior_assignedto)),'')
      else nullif(lower(btrim(p_legacy.assignedto)),'') end end;
  if candidate is not null and not private.inventory_assignment_actor_active_v3047(candidate,p_active) then
    return (null,'default_owner_inactive',true,false)::private.inventory_row_owner_decision_v3047;
  end if;
  return (candidate,case when p_prior.present_in_drive or legacy_present then 'unresolved_preserved'
    else 'unresolved_new' end,true,false)::private.inventory_row_owner_decision_v3047;
end
$decide$;

create function private.inventory_row_assignment_time_v3047(
  p_owner text,p_prior public.ph_inventory_row_assignments,p_default public.ph_itemcode_default_owners,
  p_legacy public.ph_warehouse_assigned_items
)
returns timestamptz language sql stable set search_path='' as $assigned_at$
  select case
    when p_owner is null then null
    when p_prior.present_in_drive and p_prior.assignedto is not distinct from p_owner then p_prior.assigned_at
    when p_legacy.present_in_drive and p_legacy.zone_override_active
      and lower(btrim(p_legacy.zone_override_prior_assignedto))=lower(btrim(p_owner))
      then p_legacy.zone_override_prior_assigned_at
    when p_legacy.present_in_drive and lower(btrim(p_legacy.assignedto))=lower(btrim(p_owner)) then p_legacy.assigned_at
    when lower(btrim(p_default.assignedto))=lower(btrim(p_owner)) then coalesce(p_default.assigned_at,now())
    else now() end
$assigned_at$;

create function private.plan_drive_row_assignments_v3047(p_source_revision bigint)
returns void language plpgsql set search_path='' as $plan$
begin
  drop table if exists pg_temp.drive_row_assignments_v3047;
  create temp table drive_row_assignments_v3047 on commit drop as
  with zones as materialized (
    select locationcode,private.eval_location_zone(locationcode) zone
    from (select distinct coalesce(locationcode,'') locationcode from public.ph_master_inventory) locations
  ), default_owners as materialized (
    select assignedto,private.itemcode_owner_candidate_v1(assignedto) allowed
    from (select distinct assignedto from public.ph_itemcode_default_owners where assignedto is not null) users
  ), policy as materialized (
    select not exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active) allow_legacy,
      array(select distinct lower(btrim(u.username)) from public.ph_eval_assignment_users u
        where u.active and private.eval_assignment_profile_active_v1(u.username)) active
  )
  select m.unique_id master_unique_id,m.unique_id,m.itemcode,upper(btrim(coalesce(m.itemcode,''))) itemcode_normalized,
    m.genusname,m.commonname,m.contsize,m.locationcode,m.lotcode,m.source,m.warehousei,
    decision.assignedto,private.inventory_row_assignment_time_v3047(decision.assignedto,a,d,w) assigned_at,
    d.assignedto default_assignedto,coalesce(d.revision,0) default_revision,
    decision.zone_override_active,decision.assignment_reason,decision.review_required,1 policy_revision,
    p_source_revision source_revision,true present_in_drive,coalesce(a.revision,0)+1 revision,now() updated_at,
    a.master_unique_id prior_uid,a.assignedto prior_owner,a.assignment_reason prior_reason,a.review_required prior_review
  from public.ph_master_inventory m
  left join public.ph_inventory_row_assignments a on a.master_unique_id=m.unique_id
  left join public.ph_itemcode_default_owners d on d.itemcode_normalized=upper(btrim(coalesce(m.itemcode,'')))
  left join public.ph_warehouse_assigned_items w on w.assignment_key=private.normalize_eval_assignment_key(m.itemcode,m.genusname)
  left join default_owners o on o.assignedto=d.assignedto
  join zones z on z.locationcode=coalesce(m.locationcode,'')
  cross join policy
  cross join lateral private.decide_inventory_row_owner_v3047(
    z.zone,m.plantgroupcode,a,d,w,policy.allow_legacy,o.allowed,policy.active) decision;
  create unique index on pg_temp.drive_row_assignments_v3047(master_unique_id);
  analyze pg_temp.drive_row_assignments_v3047 (master_unique_id);
end
$plan$;

do $share$
declare
  definition text := pg_get_functiondef('private.resolve_inventory_row_assignment_v1(text,bigint)'::regprocedure);
  policy_at integer := strpos(definition,'  if default_row.updated_by is not null or default_row.assignedto is not null then');
  write_at integer := strpos(definition,'  insert into public.ph_inventory_row_assignments(');
  audit_at integer := strpos(definition,'  if result_row.master_unique_id is not null');
  writer text;
  column_list text;
  values_at integer;
  conflict_at integer;
begin
  if policy_at=0 or write_at<=policy_at or audit_at<=write_at then raise exception 'ERP_ASSIGNMENT_POLICY_ANCHOR_MISSING'; end if;
  writer:=substring(definition from write_at for audit_at-write_at);
  values_at:=strpos(writer,') values (');
  conflict_at:=strpos(writer,') on conflict (master_unique_id) do update set');
  if values_at=0 or conflict_at<=values_at or strpos(writer,'returning * into result_row;')=0 then
    raise exception 'ERP_ASSIGNMENT_WRITER_ANCHOR_MISSING';
  end if;
  column_list:=substring(writer from '\(([^)]*)\)');
  writer:=overlay(writer placing ') select '||column_list||' from pg_temp.drive_row_assignments_v3047 order by master_unique_id'
    from values_at for conflict_at-values_at+1);
  writer:=replace(writer,'returning * into result_row;','returning master_unique_id,assignedto,assignment_reason,review_required');
  execute format($writer$create function private.apply_drive_row_assignment_plan_v3047(p_source_revision bigint)
returns integer language plpgsql set search_path='' as $body$
declare processed integer;
begin
  with written as (
%s
  ), audited as (
    insert into private.ph_inventory_row_assignment_audit(master_unique_id,event_type,previous_owner,next_owner,reason,source_revision)
    select w.master_unique_id,'resolved',p.prior_owner,w.assignedto,w.assignment_reason,p_source_revision
    from written w join pg_temp.drive_row_assignments_v3047 p using(master_unique_id)
    where p.prior_uid is null
      or (p.prior_owner,p.prior_reason,p.prior_review) is distinct from (w.assignedto,w.assignment_reason,w.review_required)
  ) select count(*)::integer into processed from pg_temp.drive_row_assignments_v3047;
  drop table pg_temp.drive_row_assignments_v3047;
  return processed;
end
$body$;$writer$,writer);

  definition:=overlay(definition placing $policy$  decision:=private.decide_inventory_row_owner_v3047(
    zone_state,source_row.plantgroupcode,prior,default_row,legacy_group,legacy_fallback_allowed);
  resolved_owner:=decision.assignedto;
  resolved_reason:=decision.assignment_reason;
  review_flag:=decision.review_required;
  resolved_at:=private.inventory_row_assignment_time_v3047(resolved_owner,prior,default_row,legacy_group);

$policy$ from policy_at for write_at-policy_at);
  definition:=replace(definition,'  unresolved_candidate text;','  decision private.inventory_row_owner_decision_v3047;');
  execute replace(definition,
    'coalesce(zone_state = ''inside'' and resolved_reason in (''zone_zoe'',''zone_mitch_rose'',''zone_owner_inactive''), false)',
    'decision.zone_override_active');
end
$share$;

do $reconcile$
declare
  definition text := pg_get_functiondef('private.reconcile_inventory_row_assignments_v1(uuid)'::regprocedure);
  prior_loop text := $loop$  for row_value in select m.unique_id from public.ph_master_inventory m order by m.unique_id loop
    perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, source_rev);
    processed := processed + 1;
  end loop;$loop$;
  header text := 'FUNCTION private.reconcile_inventory_row_assignments_v1(';
  finish_call text := '    return private.reconcile_inventory_row_assignments_v1(p_run_id);';
begin
  if strpos(definition,prior_loop)=0 or strpos(definition,header)=0 then raise exception 'ERP_ASSIGNMENT_LOOP_ANCHOR_MISSING'; end if;
  definition:=replace(definition,header,'FUNCTION private.reconcile_drive_row_assignments_v3047(');
  definition:=replace(definition,' row_value record;','');
  execute replace(definition,prior_loop,$batch$  perform pg_advisory_xact_lock(hashtextextended('inventory-row-assignment:'||m.unique_id,0))
    from public.ph_master_inventory m order by m.unique_id;
  perform private.plan_drive_row_assignments_v3047(source_rev);
  processed:=private.apply_drive_row_assignment_plan_v3047(source_rev);$batch$);
  definition:=pg_get_functiondef('private.inventory_row_assignment_reconcile_finish_v1(uuid)'::regprocedure);
  if strpos(definition,finish_call)=0 then raise exception 'ERP_ASSIGNMENT_FINISH_ANCHOR_MISSING'; end if;
  execute replace(definition,finish_call,$finish$    if current_setting('agdata.erp.drive_assignment_run_v3047',true)=p_run_id::text then
      return private.reconcile_drive_row_assignments_v3047(p_run_id);
    end if;
    return private.reconcile_inventory_row_assignments_v1(p_run_id);$finish$);
end
$reconcile$;

do $wire$
declare
  definition text := pg_get_functiondef('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'::regprocedure);
  begin_at text := '  if coalesce((public.begin_dataset_import_v1(';
  finish_at text := '  finished:=public.finish_dataset_import_with_sources_v1(run_id,';
  close_at text := '  update public.app_dataset_revisions set source_modified_at=';
begin
  if strpos(definition,begin_at)=0 or strpos(definition,finish_at)=0 or strpos(definition,close_at)=0 then
    raise exception 'ERP_ASSIGNMENT_NATIVE_DRIVE_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,begin_at,
    '  perform pg_advisory_xact_lock(hashtextextended(''gnc-reconcile-eval-itemcodes-v2'',0));'||chr(10)||begin_at);
  definition:=replace(definition,finish_at,
    '  perform set_config(''agdata.erp.drive_assignment_run_v3047'',run_id::text,true);'||chr(10)||finish_at);
  execute replace(definition,close_at,
    '  perform set_config(''agdata.erp.drive_assignment_run_v3047'','''',true);'||chr(10)||close_at);
end
$wire$;

revoke all on type private.inventory_row_owner_decision_v3047 from public,anon,authenticated,service_role;
revoke all on function private.inventory_assignment_actor_active_v3047(text,text[]),
  private.decide_inventory_row_owner_v3047(text,text,public.ph_inventory_row_assignments,public.ph_itemcode_default_owners,public.ph_warehouse_assigned_items,boolean,boolean,text[]),
  private.inventory_row_assignment_time_v3047(text,public.ph_inventory_row_assignments,public.ph_itemcode_default_owners,public.ph_warehouse_assigned_items),
  private.plan_drive_row_assignments_v3047(bigint),private.apply_drive_row_assignment_plan_v3047(bigint),
  private.reconcile_drive_row_assignments_v3047(uuid) from public,anon,authenticated,service_role;
commit;
