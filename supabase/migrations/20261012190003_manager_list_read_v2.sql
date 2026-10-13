begin;

-- These five definitions already exist in the baseline/assignment migrations.
-- IF NOT EXISTS supports installations missing an index without duplicates.
create index if not exists idx_ph_master_inventory_eval_itemcode_lookup
  on public.ph_master_inventory using btree (upper(btrim(coalesce(itemcode,''::text))));
create index if not exists idx_ph_master_inventory_eval_tasks
  on public.ph_master_inventory using btree (assignedto,eval_task_status,eval_task_type);
create index if not exists ph_master_inventory_location_work_match_idx
  on public.ph_master_inventory using btree (lower(btrim(itemcode)),lower(btrim(saleyear)),lower(btrim(locationcode)),unique_id);
create index if not exists ph_inventory_row_assignments_owner_idx
  on public.ph_inventory_row_assignments using btree (lower(btrim(assignedto)),master_unique_id)
  where present_in_drive and assignedto is not null;
create index if not exists ph_inventory_row_assignments_itemcode_idx
  on public.ph_inventory_row_assignments using btree (itemcode_normalized,master_unique_id) where present_in_drive;

-- Companion readers for the app-api report boundary. Neither helper is
-- callable by an app role. The public boundary validates the active actor and
-- source revision before dispatch; actions continue using their original RPCs.
create or replace function private.manager_report_assigned_page_v2(
  p_actor_id uuid, p_filters jsonb, p_operation text,
  p_offset integer, p_limit integer, p_source_revision text
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
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
    raise exception using errcode='40001',message='manager_report_assignment_refresh_required';
  end if;
  if jsonb_typeof(column_filters)<>'object' or exists(
    select 1 from jsonb_each(column_filters) c where jsonb_typeof(c.value)<>'array'
  ) then raise exception using errcode='22023',message='manager_report_column_filters_invalid'; end if;
  with rows as materialized (
    select a.master_unique_id,a.unique_id,a.itemcode,a.itemcode_normalized,a.commonname,
      a.contsize,a.locationcode,a.lotcode,a.source,a.warehousei,a.genusname,
      private.inventory_effective_owner_v1(a.master_unique_id) assignedto,
      a.default_assignedto,a.default_revision,a.zone_override_active,a.assignment_reason,
      a.review_required,a.revision,a.policy_revision,a.source_revision,a.updated_at,
      t.mean_quantity "AVG_ORDER_QTY",coalesce(o.manual_override_qty,t.suggested_qty,s.low_stock_max_slts,150) "LOW_STOCK_TARGET",
      t.suggested_qty "LOW_STOCK_SUGGESTED",t.history_from_date "HISTORY_FROM_DATE",
      t.history_through_date "HISTORY_THROUGH_DATE",t.updated_at "LOW_STOCK_CALCULATED_AT"
    from public.ph_inventory_row_assignments a
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
revoke all on function private.manager_report_assigned_page_v2(uuid,jsonb,text,integer,integer,text) from public,anon,authenticated,service_role;

create or replace function private.manager_report_season_page_v2(
  p_actor_id uuid, p_filters jsonb, p_operation text,
  p_offset integer, p_limit integer, p_source_revision text
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  actor public.profiles := private.manager_season_priority_actor_v1(p_actor_id);
  current_season text := upper(btrim(coalesce(private.season_sales_settings_v1()->>'seasonCode','')));
  current_year integer := private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear');
  assignee text := lower(regexp_replace(btrim(coalesce(p_filters->>'assignedTo','all')),'[^a-z0-9]+','_','g'));
  result jsonb;
begin
  if exists(select 1 from unnest(array['ph_master_inventory','ph_cav_import','ph_inventory_row_assignments']) required(key)
    left join public.app_dataset_revisions r using(key) where r.key is null or r.state<>'ready') then
    raise exception using errcode='40001',message='SEASON_PRIORITY_SOURCE_REFRESH_REQUIRED';
  end if;
  with ranked as materialized (
    select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.blockalpha,
      m.source,m.season,m.saleyear,m.priority,m.ptravailable,m.app_tab_assignment,
      row_number() over(partition by upper(btrim(m.itemcode)) order by
        coalesce(private.season_sales_safe_numeric_v1(m.ptravailable),-1) desc,
        private.season_sales_safe_numeric_v1(m.priority),private.eval_work_natural_sort_key_v1(m.locationcode),m.unique_id) winner_rank
    from public.ph_master_inventory m where lower(btrim(coalesce(m.app_tab_assignment,'')))='season'
      and (coalesce(p_filters->>'itemCode','')='' or upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(p_filters->>'itemCode')))
      and upper(btrim(coalesce(m.season,'')))=current_season
      and private.season_sales_year_v1(m.saleyear)<=current_year
      and btrim(coalesce(m.priority,'')) ~ '^[1-4]$'
      and upper(btrim(coalesce(m.end_cap_folder,''))) in ('','NULL','N/A','-')
      and upper(coalesce(m.holdstopcode,'')) !~ '[HS]'
  ), eligible as materialized (
    select r.*,private.inventory_effective_owner_v1(r.unique_id) assigned_owner from ranked r
    where winner_rank=1 and btrim(priority) ~ '^[2-4]$' and exists(
      select 1 from public.ph_cav_import c where upper(btrim(c.itemcode))=upper(btrim(r.itemcode))
        and upper(btrim(c.season))=current_season
        and upper(btrim(coalesce(to_jsonb(c)->>'holdstopreason',to_jsonb(c)->>'hold_reason',''))) in ('','NULL'))
  ), filtered as materialized (
    select * from eligible e where (assignee in ('','all')
      or (assignee in ('__unassigned__','unassigned') and nullif(btrim(assigned_owner),'') is null)
      or private.eval_normalize_user_v2(assigned_owner)=assignee)
      and (coalesce(p_filters->>'blockalpha','')='' or e.blockalpha=p_filters->>'blockalpha')
      and (coalesce(p_filters->>'locationcode','')='' or e.locationcode=p_filters->>'locationcode')
      and not exists(select 1 from regexp_split_to_table(lower(btrim(coalesce(p_filters->>'search',''))),'[[:space:]]+') token
        where token<>'' and position(token in lower(concat_ws(' ',e.itemcode,e.commonname,e.contsize,e.locationcode,e.lotcode,e.source)))=0)
  ), page as (
    select * from filtered order by upper(coalesce(blockalpha,'')),upper(coalesce(locationcode,'')),upper(coalesce(itemcode,'')),unique_id
      limit least(100,greatest(1,p_limit)) offset greatest(0,p_offset)
  ), groups as (
    select case when p_filters->>'groupBy'='locationcode' then coalesce(nullif(locationcode,''),'(Unassigned)')
      else coalesce(nullif(blockalpha,''),'(Unassigned)') end group_key,
      count(*) row_count,count(distinct locationcode) location_count,count(distinct itemcode) item_count
    from filtered group by 1
  ), group_page as (
    select * from groups order by private.eval_work_natural_sort_key_v1(group_key),group_key
      limit least(25,greatest(1,p_limit)) offset greatest(0,p_offset)
  )
  select jsonb_build_object('rows',case when p_operation='metadata' then '[]'::jsonb
    when p_operation='groups' then coalesce((select jsonb_agg(jsonb_build_object(
      'key',coalesce(p_filters->>'groupBy','blockalpha')||':'||group_key,'value',group_key,'label',group_key,
      'kind',coalesce(p_filters->>'groupBy','blockalpha'),'rowCount',row_count,'locationCount',location_count,'itemCount',item_count)
      order by private.eval_work_natural_sort_key_v1(group_key),group_key) from group_page),'[]'::jsonb)
    else coalesce((
    select jsonb_agg(jsonb_build_object(
      'sourceUid',p.unique_id,'unique_id',p.unique_id,'itemcode',p.itemcode,'commonname',p.commonname,'contsize',p.contsize,
      'locationcode',p.locationcode,'lotcode',p.lotcode,'blockalpha',p.blockalpha,'source',p.source,
      'season',p.season,'salesyear',p.saleyear,'priority',private.season_sales_safe_numeric_v1(p.priority)::integer,'ptravailable',p.ptravailable,
      'currentAssignment',p.app_tab_assignment,'assignedTo',p.assigned_owner,
      'warehouseAssignedTo',case when p.assigned_owner is null then '[]'::jsonb else jsonb_build_array(p.assigned_owner) end,
      'resolvedAssignedTo',case when p.assigned_owner is null then '[]'::jsonb else jsonb_build_array(private.eval_normalize_user_v2(p.assigned_owner)) end,
      'assignmentAuthoritative',true,
      'noteContext',jsonb_build_object('avNote',m.av_note,'salesNote',m.sales_note,'locationNote',m.locationnote,'picNote',m.pic_note),
      'lineageHash',private.manager_season_priority_lineage_v1(to_jsonb(m)),
      'scopeFingerprint',private.manager_season_priority_scope_fingerprint_v1(p.itemcode))
      order by upper(coalesce(p.blockalpha,'')),upper(coalesce(p.locationcode,'')),upper(coalesce(p.itemcode,'')),p.unique_id)
    from page p join public.ph_master_inventory m on m.unique_id=p.unique_id),'[]'::jsonb) end,
    'total',case when p_operation='metadata' then 0 when p_operation='groups' then (select count(*) from groups) else (select count(*) from filtered) end,
    'hasMore',case when p_operation='metadata' then false when p_operation='groups' then (select count(*)>p_offset+least(25,p_limit) from groups)
      else (select count(*)>p_offset+p_limit from filtered) end,'sourceRevision',p_source_revision,
    'metadata',jsonb_build_object('inventoryRevision',(select revision from public.app_dataset_revisions where key='ph_master_inventory'),
      'inventoryState','ready','inventoryRowCount',(select count(*) from eligible),'filteredRowCount',(select count(*) from filtered),
      'assignedToOptions',coalesce((select jsonb_agg(jsonb_build_object('value',value,'label',initcap(replace(value,'_',' ')),'count',n) order by value)
        from(select private.eval_normalize_user_v2(assigned_owner) value,count(*) n from eligible
          where assigned_owner is not null group by private.eval_normalize_user_v2(assigned_owner)) options),'[]'::jsonb),
      'blocks',coalesce((select jsonb_agg(value order by value) from(select distinct blockalpha value from eligible where nullif(blockalpha,'') is not null) b),'[]'::jsonb),
      'locations',coalesce((select jsonb_agg(value order by value) from(select distinct locationcode value from eligible where nullif(locationcode,'') is not null) l),'[]'::jsonb))) into result;
  return result;
end
$function$;
revoke all on function private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text) from public,anon,authenticated,service_role;
commit;
