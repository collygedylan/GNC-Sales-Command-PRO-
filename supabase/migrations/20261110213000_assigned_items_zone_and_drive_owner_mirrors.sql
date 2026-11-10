begin;
set local lock_timeout='1500ms';
set local statement_timeout='12s';

-- One decision shared by exact-row edits and the set-based DRIVE plan.
-- The itemcode ledger stays independent of the location-specific worker.
create or replace function private.decide_inventory_row_owner_v3047(
  p_zone text,p_plant_group text,p_prior public.ph_inventory_row_assignments,
  p_default public.ph_itemcode_default_owners,p_legacy public.ph_warehouse_assigned_items,
  p_allow_legacy boolean,p_default_allowed boolean default null,p_active text[] default null
)
returns private.inventory_row_owner_decision_v3047 language plpgsql stable set search_path='' as $decide$
declare
  candidate text;
  legacy_present boolean := p_allow_legacy and p_legacy.present_in_drive and p_legacy.assignment_key is not null;
begin
  if p_zone='inside' then
    if private.inventory_assignment_actor_active_v3047('zoe_green',p_active) then
      return ('zoe_green','zone_zoe',false,true)::private.inventory_row_owner_decision_v3047;
    end if;
    return (null,'zone_owner_inactive',true,true)::private.inventory_row_owner_decision_v3047;
  end if;
  if p_default.updated_by is not null or p_default.assignedto is not null then
    if p_default.assignedto is not null and not coalesce(p_default_allowed,
      private.itemcode_owner_candidate_v1(p_default.assignedto)) then
      return (null,'default_owner_inactive',true,false)::private.inventory_row_owner_decision_v3047;
    end if;
    return (p_default.assignedto,case when p_default.assignedto is null then 'unassigned' else 'itemcode_default' end,
      coalesce(p_default.review_required,false),false)::private.inventory_row_owner_decision_v3047;
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

-- The bulk edit shortcut is valid only for rows outside the location rule.
-- Rows inside still use the same exact-row decision as the DRIVE plan.
do $bulk$
declare
  definition text := pg_get_functiondef('public.set_itemcode_default_owners_v1(jsonb,uuid)'::regprocedure);
  anchor constant text := '      where d.itemcode_normalized=any(changed_itemcodes) and d.updated_by is not null';
  guard constant text := '        and private.eval_location_zone(m.locationcode) is distinct from ''inside''';
begin
  if position(guard in definition)>0 then return; end if;
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'ASSIGNED_ITEMS_BULK_OWNER_ANCHOR_MISSING';
  end if;
  execute replace(definition,anchor,anchor||chr(10)||guard);
end
$bulk$;

-- Native RUN SCRIPT already enters this writer through the DRIVE import fence.
-- Mirror only changes, by physical ID, before the existing READY receipt.
do $mirror$
declare
  definition text := pg_get_functiondef('private.apply_drive_row_assignment_plan_v3047(bigint)'::regprocedure);
  declaration constant text := 'declare processed integer;';
  anchor constant text := '  drop table pg_temp.drive_row_assignments_v3047;';
  publication constant text := $projection$  -- v3.0.63 DRIVE owner mirror from the exact assignment plan.
  previous_mirror := current_setting('agdata.owner_master_mirror',true);
  perform set_config('agdata.owner_master_mirror','on',true);
  update public.ph_master_inventory m
    set default_owner=p.default_assignedto,effective_worker=p.assignedto,eval_user=p.assignedto
  from pg_temp.drive_row_assignments_v3047 p
  where m.unique_id=p.master_unique_id
    and (m.default_owner,m.effective_worker,m.eval_user) is distinct from
        (p.default_assignedto,p.assignedto,p.assignedto);
  perform set_config('agdata.owner_master_mirror',coalesce(previous_mirror,''),true);
$projection$;
begin
  if position(publication in definition)>0 then return; end if;
  if cardinality(string_to_array(definition,declaration))<>2 or cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'DRIVE_ASSIGNMENT_MIRROR_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,declaration,declaration||' previous_mirror text;');
  execute replace(definition,anchor,publication||anchor);
end
$mirror$;

commit;
