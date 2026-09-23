begin;
set local lock_timeout = '3s';
set local statement_timeout = '8s';

-- Evaluate the complete eligible-item fingerprints once. Without this fence,
-- a nested-loop plan can rescan the grouped helper for every selected row.
-- The protected list body and permissions are otherwise unchanged.

create or replace function public.manager_season_priority_list_v1(
  p_actor_id uuid,
  p_assigned_to text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.manager_season_priority_actor_v1(p_actor_id);
  filter_value text := case
    when lower(btrim(coalesce(p_assigned_to, 'all'))) in ('__unassigned__', 'unassigned') then '__unassigned__'
    else lower(regexp_replace(btrim(coalesce(p_assigned_to, 'all')), '[^a-z0-9]+', '_', 'g'))
  end;
  inventory_revision bigint;
  current_season text := upper(btrim(coalesce(private.season_sales_settings_v1()->>'seasonCode', '')));
  current_sales_year integer := private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear');
  roster_available boolean := (select exists(select 1 from public.ph_warehouse_assigned_items));
  result jsonb;
begin
  perform 1
  from public.app_dataset_revisions r
  where r.key in ('ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items')
  order by r.key
  for share;
  if exists (
    select 1
    from unnest(array['ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items']) required(key)
    left join public.app_dataset_revisions r on r.key = required.key
    where r.key is null or r.state <> 'ready'
  ) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_REFRESH_REQUIRED';
  end if;
  select r.revision into inventory_revision
  from public.app_dataset_revisions r where r.key = 'ph_master_inventory';
  if inventory_revision is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_SOURCE_REVISION_MISSING';
  end if;

  with ranked as materialized (
    select m.*, to_jsonb(m) row_json,
      row_number() over (
        partition by upper(btrim(m.itemcode))
        order by coalesce(private.season_sales_safe_numeric_v1(m.ptravailable), -1) desc,
                 btrim(m.priority)::integer asc,
                 private.eval_work_natural_sort_key_v1(m.locationcode),
                 m.unique_id
      ) winner_rank
    from public.ph_master_inventory m
    where lower(btrim(coalesce(m.app_tab_assignment, ''))) = 'season'
      and upper(btrim(coalesce(m.season, ''))) = current_season
      and private.season_sales_year_v1(to_jsonb(m)->>'saleyear') <= current_sales_year
      and btrim(coalesce(m.priority, '')) ~ '^[1-4]$'
      and upper(btrim(coalesce(to_jsonb(m)->>'end_cap_folder', ''))) in ('', 'NULL', 'N/A', '-')
      and upper(coalesce(m.holdstopcode, '')) !~ '[HS]'
  ), eligible as materialized (
    select ranked.*
    from ranked
    where winner_rank = 1
      and btrim(priority) ~ '^[2-4]$'
      and exists (
        select 1 from public.ph_cav_import c
        where upper(btrim(c.itemcode)) = upper(btrim(ranked.itemcode))
          and upper(btrim(c.season)) = current_season
          and upper(btrim(coalesce(to_jsonb(c)->>'holdstopreason', to_jsonb(c)->>'hold_reason', ''))) in ('', 'NULL')
      )
  ), scope_hashes as materialized (
    select upper(btrim(itemcode)) itemcode_normalized,
           private.manager_season_priority_scope_fingerprint_v1(min(itemcode)) scope_fingerprint
    from eligible
    group by upper(btrim(itemcode))
  ), enriched as (
    select e.*,
      coalesce(assignments.values, '{}'::text[]) warehouse_assigned_to,
      coalesce(resolved.values, '{}'::text[]) resolved_assigned_to,
      private.manager_season_priority_lineage_v1(e.row_json) lineage_hash,
      scope_hashes.scope_fingerprint
    from eligible e
    join scope_hashes on scope_hashes.itemcode_normalized = upper(btrim(e.itemcode))
    left join lateral (
      select array_agg(distinct btrim(a.assignedto) order by btrim(a.assignedto))
        filter (where nullif(btrim(coalesce(a.assignedto, '')), '') is not null) values
      from public.ph_warehouse_assigned_items a
      where upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(btrim(e.itemcode))
    ) assignments on true
    left join lateral (
      select array_agg(distinct normalized.value order by normalized.value) values
      from (
        select lower(regexp_replace(btrim(raw.value), '[^a-z0-9]+', '_', 'g')) value
        from unnest(case when roster_available
          then coalesce(assignments.values, '{}'::text[])
          else regexp_split_to_array(coalesce(e.assignedto, ''), '[,&/|]+|[[:space:]]+[Aa][Nn][Dd][[:space:]]+')
        end) raw(value)
      ) normalized
      where normalized.value not in ('', 'all', 'unassigned', 'none', 'null', 'na', 'n_a')
    ) resolved on true
  ), filtered as (
    select * from enriched e
    where filter_value in ('', 'all')
       or (filter_value = '__unassigned__' and cardinality(e.resolved_assigned_to) = 0)
       or exists (
         select 1 from unnest(e.resolved_assigned_to) assigned(value)
         where value = filter_value
       )
  ), options as (
    select assigned.value, min(initcap(replace(assigned.value, '_', ' '))) label, count(*)::integer count
    from enriched e cross join lateral unnest(e.resolved_assigned_to) assigned(value)
    group by assigned.value
  )
  select jsonb_build_object(
    'ok', true,
    'contractVersion', 'manager-season-priority-v1',
    'inventoryRevision', inventory_revision,
    'inventoryState', 'ready',
    'assignedToOptions', coalesce((select jsonb_agg(jsonb_build_object(
      'value', value, 'label', label, 'count', count
    ) order by label) from options), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'sourceUid', f.unique_id,
      'itemcode', coalesce(f.itemcode, ''),
      'commonname', coalesce(f.commonname, ''),
      'contsize', coalesce(f.contsize, ''),
      'locationcode', coalesce(f.locationcode, ''),
      'lotcode', coalesce(f.lotcode, ''),
      'blockalpha', coalesce(f.blockalpha, ''),
      'source', coalesce(f.source, ''),
      'season', coalesce(f.season, ''),
      'salesyear', coalesce(f.row_json->>'saleyear', ''),
      'priority', (btrim(f.priority))::integer,
      'ptravailable', coalesce(f.ptravailable, ''),
      'currentAssignment', coalesce(f.app_tab_assignment, ''),
      'assignedTo', coalesce(f.assignedto, ''),
      'warehouseAssignedTo', to_jsonb(f.warehouse_assigned_to),
      'resolvedAssignedTo', to_jsonb(f.resolved_assigned_to),
      'assignmentAuthoritative', roster_available,
      'noteContext', jsonb_build_object(
        'avNote', coalesce(f.av_note, ''),
        'salesNote', coalesce(f.sales_note, ''),
        'locationNote', coalesce(f.locationnote, ''),
        'picNote', coalesce(f.pic_note, '')
      ),
      'lineageHash', f.lineage_hash,
      'scopeFingerprint', f.scope_fingerprint
    ) order by upper(coalesce(f.blockalpha, '')), upper(coalesce(f.locationcode, '')),
               upper(coalesce(f.itemcode, '')), f.unique_id) from filtered f), '[]'::jsonb)
  ) into result;
  return result;
end
$function$;

notify pgrst, 'reload schema';
commit;
