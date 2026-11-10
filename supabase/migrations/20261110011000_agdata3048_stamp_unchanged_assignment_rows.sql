begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Existing default owners require no speculative insert or per-row defaults.
-- The original warehouse projection, audit, and summary still own new rows.
do $seed$
declare
  definition text := pg_get_functiondef('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)'::regprocedure);
  anchor text := $old$    select c.code,null,0,false,'system',clock_timestamp() from codes c
    on conflict(itemcode_normalized) do nothing$old$;
begin
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'ERP_ASSIGNMENT_DEFAULT_SEED_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,$seed_only$    select c.code,null,0,false,'system',clock_timestamp() from codes c
    where not exists(select 1 from public.ph_itemcode_default_owners existing where existing.itemcode_normalized=c.code)
    on conflict(itemcode_normalized) do nothing$seed_only$);
end
$seed$;

-- Maintain the READY revision on all rows. Only changes to assignment inputs
-- or the projected plant group need the full UPSERT and column trigger.
do $plan$
declare
  definition text := pg_get_functiondef('private.plan_drive_row_assignments_v3047(bigint)'::regprocedure);
  anchor text := '    a.master_unique_id prior_uid,a.assignedto prior_owner,a.assignment_reason prior_reason,a.review_required prior_review';
begin
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'ERP_ASSIGNMENT_GROUP_PLAN_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||E',\n    coalesce(nullif(btrim(m.plantgroupcode),''''),a.plant_group_code) expected_plant_group_code');
end
$plan$;

do $writer$
declare
  definition text := pg_get_functiondef('private.apply_drive_row_assignment_plan_v3047(bigint)'::regprocedure);
  with_at text := '  with written as (';
  source_at text := '   from pg_temp.drive_row_assignments_v3047 order by master_unique_id on conflict';
  comparison_at integer := strpos(definition,'  where (public.ph_inventory_row_assignments.itemcode,');
  end_at integer := strpos(definition,'  returning master_unique_id,assignedto,assignment_reason,review_required');
  same_values text;
begin
  if comparison_at=0 or end_at<=comparison_at or cardinality(string_to_array(definition,with_at))<>2
    or cardinality(string_to_array(definition,source_at))<>2 then
    raise exception 'ERP_ASSIGNMENT_REVISION_STAMP_ANCHOR_MISSING';
  end if;
  same_values:=substring(definition from comparison_at+8 for end_at-comparison_at-8);
  same_values:=replace(replace(same_values,'public.ph_inventory_row_assignments.','a.'),'excluded.','p.');
  if strpos(same_values,', a.source_revision,')=0 or strpos(same_values,', p.source_revision,')=0 then
    raise exception 'ERP_ASSIGNMENT_REVISION_COMPARISON_SHAPE_CHANGED';
  end if;
  same_values:=replace(replace(replace(same_values,', a.source_revision,',','),', p.source_revision,',','),
    'is distinct from','is not distinct from');
  definition:=replace(definition,with_at,format($stamp$  with row_decisions as materialized (
    select p.*, (a.master_unique_id is not null and %s
      and a.plant_group_code is not distinct from p.expected_plant_group_code) stamp_only
    from pg_temp.drive_row_assignments_v3047 p left join public.ph_inventory_row_assignments a using(master_unique_id)
  ), stamped as (
    update public.ph_inventory_row_assignments a set unique_id=p.unique_id,policy_revision=p.policy_revision,
      source_revision=p.source_revision,revision=a.revision+1,updated_at=now()
    from row_decisions p where p.stamp_only and a.master_unique_id=p.master_unique_id
      and a.source_revision is distinct from p.source_revision
  ), written as ($stamp$,rtrim(same_values)));
  execute replace(definition,source_at,'   from row_decisions where not stamp_only order by master_unique_id on conflict');
end
$writer$;

commit;
