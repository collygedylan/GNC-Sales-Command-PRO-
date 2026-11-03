begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local request.jwt.claim.role = 'service_role';
-- Metadata only. Existing owner, evidence, delivery and RLS contracts are retained.
create temporary table assigned_group_proof on commit drop as
select 'defaults' kind,md5(string_agg((to_jsonb(d)-'plant_group_code')::text,'|' order by itemcode_normalized)) fingerprint from public.ph_itemcode_default_owners d
union all select 'assignments',md5(string_agg((to_jsonb(a)-'plant_group_code')::text,'|' order by master_unique_id)) from public.ph_inventory_row_assignments a
union all select 'requests',md5(string_agg(to_jsonb(r)::text,'|' order by unique_id)) from public.ph_requests_pending r;
alter table public.ph_itemcode_default_owners add column if not exists plant_group_code text;
alter table public.ph_inventory_row_assignments add column if not exists plant_group_code text;
create temporary table assigned_plant_groups on commit drop as
with candidates as (
 select upper(btrim(itemcode)) code,nullif(upper(btrim(plantgroupcode)),'') plant_group_code,0 priority from public.ph_master_inventory
 union all select upper(btrim(itemcode)),nullif(upper(btrim(coalesce(raw_row->>'plantgroupcode',raw_row->>'PLANTGROUPCODE',raw_row->>'plant_group_code'))),''),1 from public.ph_warehouse_assigned_items
 union all select upper(btrim(itemcode)),nullif(upper(btrim(plantgroupcode)),''),3 from public.ph_reserves
 union all select upper(btrim(itemcode)),nullif(upper(btrim(plantgroupcode)),''),4 from public.ph_soc_master
)
select distinct on(code) code,plant_group_code from candidates where code<>'' and plant_group_code is not null order by code,priority,plant_group_code;
create unique index on assigned_plant_groups(code);
-- A base-item fallback is permitted only when all source suffixes agree.
insert into assigned_plant_groups(code,plant_group_code)
select split_part(code,'.',1)||'.'||split_part(code,'.',2),min(plant_group_code) from assigned_plant_groups
where code like '%.%.%' group by 1 having count(distinct plant_group_code)=1 on conflict do nothing;
do $backfill$
begin
 if exists(select 1 from public.ph_master_inventory where nullif(btrim(plantgroupcode),'') is null) then
  update public.ph_master_inventory m set plantgroupcode=g.plant_group_code from assigned_plant_groups g
  where nullif(btrim(m.plantgroupcode),'') is null and g.code=upper(btrim(m.itemcode));
 end if;
end $backfill$;
update public.ph_itemcode_default_owners d set plant_group_code=coalesce(g.plant_group_code,b.plant_group_code)
from public.ph_itemcode_default_owners source
left join assigned_plant_groups g on g.code=source.itemcode_normalized
left join assigned_plant_groups b on b.code=split_part(source.itemcode_normalized,'.',1)||'.'||split_part(source.itemcode_normalized,'.',2)
where d.itemcode_normalized=source.itemcode_normalized and nullif(btrim(d.plant_group_code),'') is null and coalesce(g.plant_group_code,b.plant_group_code) is not null;
update public.ph_inventory_row_assignments a set plant_group_code=m.plantgroupcode from public.ph_master_inventory m
where m.unique_id=a.master_unique_id and a.plant_group_code is distinct from m.plantgroupcode;
-- These triggers live on assignment tables, never on the bulk master import table.
create or replace function private.assigned_item_plant_group_v1() returns trigger
language plpgsql security definer set search_path='' as $group$
begin
 if TG_TABLE_NAME='ph_inventory_row_assignments' then
  select nullif(btrim(m.plantgroupcode),'') into NEW.plant_group_code from public.ph_master_inventory m where m.unique_id=NEW.master_unique_id;
 else
  select nullif(btrim(m.plantgroupcode),'') into NEW.plant_group_code from public.ph_master_inventory m
  where upper(btrim(m.itemcode))=NEW.itemcode_normalized order by m.unique_id limit 1;
 end if;
 if nullif(btrim(NEW.plant_group_code),'') is null and TG_OP='UPDATE' then NEW.plant_group_code:=OLD.plant_group_code; end if;
 return NEW;
end $group$;
revoke all on function private.assigned_item_plant_group_v1() from public,anon,authenticated,service_role;
drop trigger if exists assigned_item_plant_group on public.ph_inventory_row_assignments;
create trigger assigned_item_plant_group before insert or update of master_unique_id,itemcode on public.ph_inventory_row_assignments
for each row execute function private.assigned_item_plant_group_v1();
drop trigger if exists default_owner_plant_group on public.ph_itemcode_default_owners;
create trigger default_owner_plant_group before insert or update of itemcode_normalized on public.ph_itemcode_default_owners
for each row execute function private.assigned_item_plant_group_v1();
CREATE OR REPLACE FUNCTION private.manager_report_assigned_page_v2(p_actor_id uuid, p_filters jsonb, p_operation text, p_offset integer, p_limit integer, p_source_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles;
  result jsonb;
  column_filters jsonb := coalesce(p_filters->'columnFilters','{}'::jsonb);
  assignee text := lower(btrim(coalesce(p_filters->>'assignedTo','all')));
begin
  select p.* into actor from public.profiles p where p.id=p_actor_id;
  actor := private.eval_work_assert_actor_v1(actor.username);
  if lower(actor.username) not in ('dylan_collyge','megan_kelly','jd_jones') then
    raise exception using errcode='42501',message='manager_report_assigned_forbidden';
  end if;
  if not private.inventory_row_assignment_policy_active_v1() then
    raise exception using errcode='PT409',message='manager_report_assignment_refresh_required';
  end if;
  if jsonb_typeof(column_filters)<>'object' or exists(
    select 1 from jsonb_each(column_filters) c where jsonb_typeof(c.value)<>'array'
  ) then raise exception using errcode='22023',message='manager_report_column_filters_invalid'; end if;
  with rows as materialized (
    select a.master_unique_id,a.unique_id,a.itemcode,a.itemcode_normalized,a.commonname,
      a.contsize,a.locationcode,a.lotcode,a.source,a.warehousei,a.genusname,
      coalesce(nullif(m.plantgroupcode,''),a.plant_group_code,'') plantgroupcode,
      coalesce(nullif(m.plantgroupcode,''),a.plant_group_code,'') plant_group_code,
      private.inventory_effective_owner_v1(a.master_unique_id) assignedto,
      a.default_assignedto,a.default_revision,a.zone_override_active,a.assignment_reason,
      a.review_required,a.revision,a.policy_revision,a.source_revision,a.updated_at,
      t.mean_quantity "AVG_ORDER_QTY",coalesce(o.manual_override_qty,t.suggested_qty,s.low_stock_max_slts,150) "LOW_STOCK_TARGET",
      t.suggested_qty "LOW_STOCK_SUGGESTED",t.history_from_date "HISTORY_FROM_DATE",
      t.history_through_date "HISTORY_THROUGH_DATE",t.updated_at "LOW_STOCK_CALCULATED_AT"
    from public.ph_inventory_row_assignments a
    left join public.ph_master_inventory m on m.unique_id=a.master_unique_id
    left join private.eval_item_low_stock_target_stats_v1 t on t.itemcode_normalized=a.itemcode_normalized
    left join private.ph_eval_item_low_stock_overrides o on o.itemcode_normalized=a.itemcode_normalized
    left join public.ph_eval_report_settings s on s.singleton
    where a.present_in_drive and nullif(btrim(a.itemcode),'') is not null
      and (coalesce(p_filters->>'itemCode','')='' or a.itemcode_normalized=upper(btrim(p_filters->>'itemCode')))
  ), values_by_column as materialized (
    select r.*,jsonb_build_object(
      'ASSIGNEDTO',coalesce(private.eval_normalize_user_v2(r.assignedto),''),
      'DEFAULT_ASSIGNEDTO',lower(btrim(coalesce(r.default_assignedto,''))),
      'WAREHOUSEI',lower(btrim(coalesce(r.warehousei,''))),
      'ITEMCODE',lower(btrim(coalesce(r.itemcode,''))),
      'CONTSIZE',lower(btrim(coalesce(r.contsize,''))),
      'COMMONNAME',lower(btrim(coalesce(r.commonname,''))),
      'PLANTGROUPCODE',lower(btrim(coalesce(r.plantgroupcode,''))),
      'LOCATIONCODE',lower(btrim(coalesce(r.locationcode,''))),
      'LOTCODE',lower(btrim(coalesce(r.lotcode,''))),
      'ASSIGNMENT_REASON',lower(btrim(coalesce(r.assignment_reason,''))),
      'SOURCE',lower(btrim(coalesce(r.source,''))),
      'GENUSNAME',lower(btrim(coalesce(r.genusname,''))),
      'AVG_ORDER_QTY',coalesce(r."AVG_ORDER_QTY"::text,''),
      'LOW_STOCK_TARGET',coalesce(r."LOW_STOCK_TARGET"::text,'')) column_values
    from rows r
  ), searched as materialized (
    select * from values_by_column r
    where (assignee='all' or assignee=coalesce(private.eval_normalize_user_v2(r.assignedto),'')
      or (assignee='assigned' and nullif(btrim(r.assignedto),'') is not null)
      or (assignee='unassigned' and nullif(btrim(r.assignedto),'') is null))
      and not exists(select 1 from regexp_split_to_table(lower(btrim(coalesce(p_filters->>'search',''))),'[[:space:]]+') token
        where token<>'' and position(token in lower(concat_ws(' ',r.assignedto,r.warehousei,r.itemcode,r.contsize,
          r.commonname,r.locationcode,r.lotcode,r.master_unique_id,r.default_assignedto,r.assignment_reason,r.source,r.genusname)))=0)
  ), filtered as materialized (
    select * from searched r where not exists(
      select 1 from jsonb_each(column_filters) c
      where r.column_values ? c.key and not (c.value ? (r.column_values->>c.key)))
  ), page as (
    select * from filtered r order by
      case when coalesce(p_filters#>>'{sort,field}','')<>'' and coalesce(p_filters#>>'{sort,direction}','asc')<>'desc'
        then private.eval_work_natural_sort_key_v1(r.column_values->>(p_filters#>>'{sort,field}')) end asc,
      case when coalesce(p_filters#>>'{sort,field}','')<>'' and p_filters#>>'{sort,direction}'='desc'
        then private.eval_work_natural_sort_key_v1(r.column_values->>(p_filters#>>'{sort,field}')) end desc,
      case when coalesce(p_filters#>>'{sort,field}','')='' then (nullif(r.assignedto,'') is not null)::integer end,
      case when coalesce(p_filters#>>'{sort,field}','')='' then private.eval_work_natural_sort_key_v1(r.commonname) end,
      case when coalesce(p_filters#>>'{sort,field}','')='' then private.eval_work_natural_sort_key_v1(r.contsize) end,
      case when coalesce(p_filters#>>'{sort,field}','')='' then private.eval_work_natural_sort_key_v1(r.itemcode) end,
      case when coalesce(p_filters#>>'{sort,field}','')='' then private.eval_work_natural_sort_key_v1(r.genusname) end,
      case when coalesce(p_filters#>>'{sort,field}','')='' then private.eval_work_natural_sort_key_v1(r.locationcode) end,
      case when coalesce(p_filters#>>'{sort,field}','')='' then private.eval_work_natural_sort_key_v1(r.warehousei) end,
      r.unique_id limit least(100,greatest(1,p_limit)) offset greatest(0,p_offset)
  ), options as (
    select field.key field,field.value value,min(coalesce(to_jsonb(r)->>lower(field.key),to_jsonb(r)->>field.key,'')) label,count(*) n
    from searched r cross join lateral jsonb_each_text(r.column_values) field
    where not exists(select 1 from jsonb_each(column_filters) c where c.key<>field.key
      and r.column_values ? c.key and not(c.value ? (r.column_values->>c.key)))
    group by field.key,field.value
  ), option_groups as (
    select field,jsonb_agg(jsonb_build_object('value',value,'label',case when label='' then
      case when field='ASSIGNEDTO' then 'Unassigned' else '(Blanks)' end else label end,'count',n)
      order by private.eval_work_natural_sort_key_v1(label),value) values from options group by field
  )
  select jsonb_build_object('rows',case when p_operation='metadata' then '[]'::jsonb else
      coalesce((select jsonb_agg(to_jsonb(page)-'column_values') from page),'[]'::jsonb) end,
    'total',case when p_operation='metadata' then 0 else (select count(*) from filtered) end,
    'hasMore',p_operation<>'metadata' and (select count(*)>p_offset+p_limit from filtered),
    'sourceRevision',p_source_revision,
    'metadata',jsonb_build_object('inventoryRowCount',(select count(*) from rows),
      'filteredRowCount',(select count(*) from filtered),
      'columnOptions',coalesce((select jsonb_object_agg(field,values) from option_groups),'{}'::jsonb),
      'assignedToOptions',coalesce((select jsonb_agg(jsonb_build_object('key',username,'label',label,'count',n)
        order by private.eval_work_natural_sort_key_v1(label)) from (
          select private.eval_normalize_user_v2(assignedto) username,min(assignedto) label,count(*) n
          from rows where nullif(btrim(assignedto),'') is not null group by private.eval_normalize_user_v2(assignedto)
        ) users),'[]'::jsonb))) into result;
  return result;
end
$function$;

-- set_itemcode_default_owners_v1 inserts receive metadata through the trigger;
-- ON CONFLICT changes only owner fields, so existing plant_group_code is preserved.
do $proof$
begin
 if exists(select 1 from assigned_group_proof p join (
  select 'defaults' kind,md5(string_agg((to_jsonb(d)-'plant_group_code')::text,'|' order by itemcode_normalized)) fingerprint from public.ph_itemcode_default_owners d
  union all select 'assignments',md5(string_agg((to_jsonb(a)-'plant_group_code')::text,'|' order by master_unique_id)) from public.ph_inventory_row_assignments a
  union all select 'requests',md5(string_agg(to_jsonb(r)::text,'|' order by unique_id)) from public.ph_requests_pending r
 ) current using(kind) where p.fingerprint is distinct from current.fingerprint) then raise exception 'ASSIGNED_ITEMS_PROTECTED_STATE_CHANGED'; end if;
 if exists(select 1 from public.ph_inventory_row_assignments where present_in_drive and nullif(plant_group_code,'') is null) then raise exception 'ASSIGNED_ITEMS_PLANT_GROUP_MISSING'; end if;
end $proof$;
notify pgrst,'reload schema';
commit;
