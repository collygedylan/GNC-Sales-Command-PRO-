begin;

-- Eval2 reports use the shared setting. Assigned Items history and manual
-- overrides remain available through their existing APIs and screens.
CREATE OR REPLACE FUNCTION private.eval_report2_item_qualifies_v1(p_report_id text, p_itemcode text, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  report_id text := lower(btrim(coalesce(p_report_id, '')));
  item_key text := upper(btrim(coalesce(p_itemcode, '')));
  app_settings jsonb := private.eval_work_settings_v1();
  current_season text := upper(btrim(coalesce(app_settings->>'seasonCode', 'F1')));
  current_sales_year integer := private.eval_work_normalized_sales_year_v1(app_settings->>'salesYear');
  next_season text;
  next_sales_year integer;
  low_stock_limit numeric := 150;
  hold_age_limit integer := 5;
  location_note_age_limit integer := 10;
  central_today date := (p_now at time zone 'America/Chicago')::date;
  result_value boolean := false;
begin
  if report_id not in (
    's1-with-pri', 'u1', 'u2', 'u3', 'od-loc-note-date', 'hs-plus-5-days',
    'get-off-hold', 'low-stock', 'no-pri', 'culls', 'not-in-f1'
  ) then
    raise exception using errcode = '22023', message = 'eval_report2_report_invalid';
  end if;
  if item_key = '' then return false; end if;
  current_sales_year := coalesce(current_sales_year, 27);
  next_season := case when current_season = 'F1' then 'S1' else 'F1' end;
  next_sales_year := case when current_season = 'F1' then current_sales_year else current_sales_year + 1 end;

  select
    coalesce((select s.low_stock_max_slts from public.ph_eval_report_settings s where s.singleton limit 1), 150),
    coalesce((select s.hold_age_days from public.ph_eval_report_settings s where s.singleton limit 1), 5),
    coalesce((select s.location_note_age_days from public.ph_eval_report_settings s where s.singleton limit 1), 10)
  into low_stock_limit, hold_age_limit, location_note_age_limit;

  with item_rows as materialized (
    select
      m.*,
      upper(regexp_replace(btrim(coalesce(m.season, '')), '[[:space:]]+', '', 'g')) as season_key,
      private.eval_work_normalized_sales_year_v1(m.saleyear) as sales_year_key,
      private.eval_report2_inventory_date_v1(m.holdstopbegindate) as hold_start_date,
      private.eval_report2_inventory_date_v1(m.locationnotedate) as location_note_date,
      coalesce(private.eval_work_safe_numeric_v1(m.s_lts), 0) as slts_value
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = item_key
      and not private.eval_report2_is_excluded_row_v1(m.season, m.desigitem)
  ), aggregate_flags as (
    select
      count(*) > 0 as has_rows,
      bool_or(nullif(btrim(coalesce(priority, '')), '') is not null) as has_priority,
      bool_or(season_key = 'F1' and sales_year_key between 1 and current_sales_year) as has_valid_f1,
      bool_or(
        upper(btrim(coalesce(holdstopcode, ''))) in ('H', 'S')
        and hold_start_date is not null
        and central_today - hold_start_date > hold_age_limit
      ) as has_old_hold,
      bool_or(
        season_key = current_season
        and sales_year_key between 1 and current_sales_year
        and slts_value < low_stock_limit
      ) as qualifies_low_stock
    from item_rows
  )
  select case report_id
    when 's1-with-pri' then exists (
      select 1 from item_rows where nullif(btrim(coalesce(priority, '')), '') is not null and season_key <> 'F1'
    )
    when 'u1' then exists (select 1 from item_rows where season_key = 'U1')
    when 'u2' then exists (select 1 from item_rows where season_key = 'U2')
    when 'u3' then exists (select 1 from item_rows where season_key = 'U3')
    when 'od-loc-note-date' then exists (
      select 1 from item_rows
      where location_note_date is not null and central_today - location_note_date > location_note_age_limit
    )
    when 'hs-plus-5-days' then exists (
      select 1 from item_rows
      where upper(btrim(coalesce(holdstopcode, ''))) in ('H', 'S')
        and hold_start_date is not null and central_today - hold_start_date > hold_age_limit
    )
    when 'get-off-hold' then (select has_old_hold from aggregate_flags)
      and exists (select 1 from item_rows where nullif(btrim(coalesce(holdstopcode, '')), '') is null)
    when 'low-stock' then (select qualifies_low_stock from aggregate_flags)
      and exists (
        select 1 from item_rows
        where (
          season_key in ('U1', 'U2', 'U3', 'X')
          and sales_year_key between 1 and current_sales_year
        ) or (season_key = next_season and sales_year_key = next_sales_year)
      )
    when 'no-pri' then (select has_rows from aggregate_flags) and not (select has_priority from aggregate_flags)
    when 'culls' then exists (select 1 from item_rows where season_key = 'X')
    when 'not-in-f1' then (select has_rows from aggregate_flags) and not (select has_valid_f1 from aggregate_flags)
    else false
  end into result_value;

  return coalesce(result_value, false);
end
$function$;
revoke all on function private.eval_report2_item_qualifies_v1(text,text,timestamptz) from public,anon,authenticated;
grant execute on function private.eval_report2_item_qualifies_v1(text,text,timestamptz) to service_role;

create or replace function public.manager_report_read_v2(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  surface text := lower(btrim(coalesce(p_payload->>'surface','')));
  operation text := lower(btrim(coalesce(p_payload->>'operation','')));
  filters jsonb := coalesce(p_payload->'filters','{}'::jsonb);
  requested_reports text[];
  page_limit integer := case when lower(coalesce(p_payload->>'operation',''))='groups'
    then least(25,greatest(1,coalesce((p_payload->>'limit')::integer,25)))
    else least(100,greatest(1,coalesce((p_payload->>'limit')::integer,25))) end;
  page_offset integer := greatest(0,coalesce((p_payload->>'offset')::integer,0));
  source_revision text;
  source_state text;
  response jsonb;
begin
  if coalesce(p_payload->>'actorUsername','') = '' then
    raise exception using errcode='42501',message='manager_report_actor_required';
  end if;
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  select md5(concat_ws('|',
      (select string_agg(key||':'||revision::text||':'||state,',' order by key)
        from public.app_dataset_revisions where key in ('ph_master_inventory','ph_eval_report_settings','ph_app_users','profiles','ph_cav_import','ph_inventory_row_assignments','private.ph_eval_item_low_stock_import_state','private.ph_eval_item_low_stock_overrides')),
      (select count(*)::text||':'||coalesce(max(revision),0)::text||':'||coalesce(max(updated_at)::text,'') from public.ph_inventory_row_assignments),
      (select count(*)::text||':'||coalesce(max(updated_at)::text,'') from public.ph_itemcode_default_owners),
      (select coalesce(max(updated_at)::text,'') from public.ph_eval_assignment_users),
      (select coalesce(policy.active::text,'false')||':'||coalesce(policy.source_revision::text,'')||':'||coalesce(policy.updated_at::text,'')
        from private.ph_inventory_row_assignment_policy_state policy where policy.singleton),
      private.eval_work_settings_v1()::text,
      (select to_jsonb(s)::text from public.ph_eval_report_settings s where s.singleton limit 1),
      (select coalesce(active_run_id::text,'')||':'||coalesce(pending_run_id::text,'')||':'||updated_at::text
        from private.ph_eval_item_low_stock_import_state where singleton),
      (select count(*)::text||':'||coalesce(max(t.calculated_at)::text,'')
        from private.ph_eval_item_low_stock_target_stats t
        join private.ph_eval_item_low_stock_import_state s on s.singleton and t.run_id=s.active_run_id),
      (select count(*)::text||':'||coalesce(max(revision),0)::text||':'||coalesce(max(updated_at)::text,'')
        from private.ph_eval_item_low_stock_overrides),
      (now() at time zone 'America/Chicago')::date::text)),
    (coalesce((select bool_and(state='ready') from public.app_dataset_revisions
      where key in ('ph_master_inventory','ph_eval_report_settings','ph_cav_import','ph_inventory_row_assignments')),false)
      and private.inventory_row_assignment_policy_active_v1())::text
    into source_revision,source_state;
  if source_revision is null or source_state <> 'true' then
    raise exception using errcode='40001',message='manager_report_source_not_ready';
  end if;
  if nullif(p_payload->>'sourceRevision','') is not null
     and p_payload->>'sourceRevision' <> source_revision then
    raise exception using errcode='40001',message='manager_report_source_revision_changed';
  end if;
  if operation = 'capabilities' then
    return jsonb_build_object('ok',true,'version','manager-report-read-v2',
      'surfaces',jsonb_build_array('eval1','eval2','ncr') ||
        case when actor.username in ('dylan_collyge','megan_kelly','jd_jones')
          and to_regprocedure('private.manager_report_assigned_page_v2(uuid,jsonb,text,integer,integer,text)') is not null
          then jsonb_build_array('assigned-items') else '[]'::jsonb end ||
        case when private.normalized_profile_role(actor.role) in ('ADMIN','ADMINISTRATOR','MANAGER')
          and exists(select 1 from private.get_effective_app_permissions_v1(
            actor.id,private.resolve_app_access_policy_id_v1(false)) e
            where e.permission_key='module.managers.view' and e.allowed)
          and exists(select 1 from private.get_effective_app_permissions_v1(
            actor.id,private.resolve_app_access_policy_id_v1(false)) e
            where e.permission_key='managers.season_priority.submit' and e.allowed)
          and to_regprocedure('private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)') is not null
          then jsonb_build_array('season-priority') else '[]'::jsonb end ||
        case when actor.username in ('dylan_collyge','megan_kelly','jd_jones')
          and to_regprocedure('public.manager_ncr_outbox_metadata_v1(text,text)') is not null
          then jsonb_build_array('approval') else '[]'::jsonb end,
      'operations',jsonb_build_array('groups','rows','metadata','detail'));
  end if;
  if surface not in ('eval1','eval2','ncr','assigned-items','season-priority','approval')
     or operation not in ('groups','rows','metadata','detail') then
    raise exception using errcode='22023',message='manager_report_query_invalid';
  end if;
  if surface='eval1' and actor.username not in ('dylan_collyge','megan_kelly') then
    raise exception using errcode='42501',message='manager_report_eval1_forbidden';
  end if;
  if surface='eval2' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones') then
    raise exception using errcode='42501',message='manager_report_eval2_forbidden';
  end if;
  if surface='assigned-items' then
    return private.manager_report_assigned_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision);
  elsif surface='season-priority' then
    return private.manager_report_season_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision);
  elsif surface='approval' then
    raise exception using errcode='22023',message='manager_report_surface_uses_protected_adapter';
  end if;
  if jsonb_typeof(filters) <> 'object' then
    raise exception using errcode='22023',message='manager_report_filters_invalid';
  end if;
  if jsonb_typeof(coalesce(filters->'gridColumns','{}'::jsonb))<>'object'
    or jsonb_typeof(coalesce(filters->'selectedIds','[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(filters->'selectedItemCodes','[]'::jsonb))<>'array' then
    raise exception using errcode='22023',message='manager_report_grid_filters_invalid';
  end if;
  if surface='ncr' then
    with settings as materialized (
      select upper(btrim(coalesce(private.eval_work_settings_v1()->>'seasonCode','F1'))) current_season,
        mod(coalesce(private.manager_report_sales_year_v1(private.eval_work_settings_v1()->>'salesYear'),2027),100) current_year,
        (now() at time zone 'America/Chicago')::date today,
        case when upper(btrim(coalesce(private.eval_work_settings_v1()->>'seasonCode','F1')))='S1' then 'F1' else 'S1' end release_season,
        mod(coalesce(private.manager_report_sales_year_v1(private.eval_work_settings_v1()->>'salesYear'),2027)
          + case when upper(btrim(coalesce(private.eval_work_settings_v1()->>'seasonCode','F1')))='S1'
            and extract(month from (now() at time zone 'America/Chicago'))=12 then 2 else 1 end,100) release_year
    ), source_rows as materialized (
      select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.s_lts,m.season,
        case when upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g')) in ('S','S1') then 'S1'
          when upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g')) in ('F','F1') then 'F1'
          when upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g'))='U' then 'U1'
          when upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g')) in ('U1','U2','U3') then upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g'))
          else coalesce(upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g')),'') end explicit_season,
        case when upper(btrim(coalesce(m.lotcode,''))) ~ '^([0-9]{2})[[:space:]]*\.[[:space:]]*[A-Z0-9]+$'
          then substring(upper(btrim(m.lotcode)) from '^([0-9]{2})')::integer end lot_year,
        case when upper(btrim(coalesce(m.lotcode,''))) ~ '^[0-9]{2}[[:space:]]*\.[[:space:]]*[A-Z0-9]+$'
          then regexp_replace(upper(btrim(m.lotcode)),'^[0-9]{2}[[:space:]]*\.[[:space:]]*','','') end lot_suffix,
        private.manager_report_sales_year_v1(m.saleyear::text) sales_year_value
      from public.ph_master_inventory m
      where nullif(btrim(coalesce(m.itemcode,'')),'') is not null
        and (coalesce(filters->>'itemCode','')='' or upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(filters->>'itemCode')))
    ), interpreted as materialized (
      select r.*,case when r.explicit_season in ('S1','F1','U1','U2','U3') then r.explicit_season
        when r.lot_suffix in ('S','S1') then 'S1' when r.lot_suffix in ('F','F1') then 'F1'
        when r.lot_suffix in ('U','U1') then 'U1' when r.lot_suffix in ('U2','U3') then r.lot_suffix
        else coalesce(nullif(r.explicit_season,''),r.lot_suffix,'') end season_code,
        case when r.sales_year_value is not null and r.lot_year is not null then greatest(mod(r.sales_year_value,100),r.lot_year)
          when r.sales_year_value is not null then mod(r.sales_year_value,100) else r.lot_year end ncr_sales_year,
        coalesce(private.manager_report_safe_numeric_v1(r.s_lts::text),0) slts_value
      from source_rows r
    ), ncr_rows as materialized (
      select i.*,upper(btrim(coalesce(i.itemcode,'')))||'|'||upper(btrim(coalesce(i.contsize,'')))||'|'||upper(btrim(coalesce(i.commonname,''))) ncr_key
      from interpreted i cross join settings st
      where i.season_code=st.current_season and i.ncr_sales_year=st.current_year
        and private.manager_report_safe_numeric_v1(i.s_lts::text) is not null
        and private.manager_report_safe_numeric_v1(i.s_lts::text)<150
    ), ncr_groups as (
      select r.ncr_key,max(r.itemcode) itemcode,max(r.contsize) contsize,max(r.commonname) commonname,
        array_agg(distinct nullif(btrim(r.locationcode),'') order by nullif(btrim(r.locationcode),'')) filter(where nullif(btrim(r.locationcode),'') is not null) current_locations,
        count(*) row_count,min(r.slts_value) min_slts,
        jsonb_build_array(jsonb_build_object('unique_id',min(r.unique_id),'itemcode',max(r.itemcode),
          'commonname',max(r.commonname),'contsize',max(r.contsize),'locationcode',min(r.locationcode),
          'lotcode',min(r.lotcode),'season',min(r.season),'s_lts',min(r.s_lts))) representative
      from ncr_rows r group by r.ncr_key
    ), enriched as (
      select g.*,coalesce((select jsonb_agg(jsonb_build_object('season',f.season_code,'locations',f.locations)
        order by case f.season_code when st.release_season then 0 when 'U1' then 1 when 'U2' then 2 else 3 end)
        from (
          select c.season_code,array_agg(distinct nullif(btrim(c.locationcode),'')) filter(where nullif(btrim(c.locationcode),'') is not null) locations
          from interpreted c cross join settings cs
          where upper(btrim(coalesce(c.itemcode,'')))=upper(btrim(g.itemcode))
            and upper(btrim(coalesce(c.contsize,'')))=upper(btrim(g.contsize))
            and upper(btrim(coalesce(c.commonname,'')))=upper(btrim(g.commonname))
            and (c.season_code=cs.release_season and c.ncr_sales_year=cs.release_year
              or c.season_code in ('U1','U2','U3') and c.ncr_sales_year between least(cs.current_year,cs.release_year) and greatest(cs.current_year,cs.release_year))
          group by c.season_code
        ) f),'[]'::jsonb) future_locations
      from ncr_groups g cross join settings st
    ), page as (
      select * from enriched order by lower(commonname),private.eval_work_natural_sort_key_v1(contsize),
        private.eval_work_natural_sort_key_v1(itemcode),ncr_key limit page_limit offset page_offset
    )
    select jsonb_build_object('ok',true,'surface','ncr','operation',operation,
      'rows',case when operation='metadata' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
        'key','ncr:'||p.ncr_key,'itemcode',p.itemcode,'contsize',p.contsize,'commonname',p.commonname,
        'currentSeason',(select current_season from settings),
        'currentLocations',coalesce((select jsonb_agg(x order by private.eval_work_natural_sort_key_v1(x)) from unnest(p.current_locations) x),'[]'::jsonb),
        'sltsValues',jsonb_build_array(p.min_slts),'rowCount',p.row_count,'minSlts',p.min_slts,
        'futureSeasonLocations',coalesce((select jsonb_agg(jsonb_build_object('season',x.value->>'season','locations',
          coalesce((select jsonb_agg(loc.value order by private.eval_work_natural_sort_key_v1(loc.value))
            from jsonb_array_elements_text(coalesce(x.value->'locations','[]'::jsonb)) loc(value)),'[]'::jsonb)) order by x.ordinality)
          from jsonb_array_elements(coalesce(p.future_locations,'[]'::jsonb)) with ordinality x(value,ordinality)),'[]'::jsonb),'rows',p.representative)
        order by lower(p.commonname),private.eval_work_natural_sort_key_v1(p.contsize),
          private.eval_work_natural_sort_key_v1(p.itemcode),p.ncr_key) from page p),'[]'::jsonb) end,
      'total',case when operation='metadata' then 0 else (select count(*) from enriched) end,'offset',page_offset,'limit',page_limit,
      'hasMore',operation<>'metadata' and (select count(*)>page_offset+page_limit from enriched),'sourceRevision',source_revision,
      'sourceFreshness',source_state,'metadata',jsonb_build_object('currentSeason',(select current_season from settings),
        'currentSalesYear',(select current_year from settings),'releaseSeason',(select release_season from settings),
        'releaseSalesYear',(select release_year from settings))) into response;
    return response;
  end if;
  select coalesce(array_agg(value),array[]::text[])
    into requested_reports
  from jsonb_array_elements_text(coalesce(filters->'reportIds','[]'::jsonb)) e(value)
  where value in ('s1-with-pri','u1','u2','u3','od-loc-note-date','hs-plus-5-days',
      'get-off-hold','low-stock','no-pri','culls','not-in-f1');
  if surface='eval1' then requested_reports := array[coalesce(requested_reports[1],'s1-with-pri')]; end if;

  with settings as materialized (
    select upper(btrim(coalesce(private.eval_work_settings_v1()->>'seasonCode','F1'))) current_season,
      coalesce(private.manager_report_sales_year_v1(private.eval_work_settings_v1()->>'salesYear'),2027) current_year,
      coalesce((select low_stock_max_slts from public.ph_eval_report_settings where singleton limit 1),150) low_limit,
      coalesce((select hold_age_days from public.ph_eval_report_settings where singleton limit 1),5) hold_days,
      coalesce((select location_note_age_days from public.ph_eval_report_settings where singleton limit 1),10) note_days,
      (now() at time zone 'America/Chicago')::date today
  ), source_rows as materialized (
    select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.ptronhand,
      m.ptravailable,m.season,m.saleyear,m.priority,m.genusname,m.blockalpha,m.source,m.s_lts,
      m.holdstopcode,m.holdstopbegindate,m.locationnotedate,m.desigitem,m.plantgroupcode,
      m.ptrreviewed,m.desigloc,m.photo_link,m.photo_name,m.holdstopreason,m.locationnote,m.salesnote,m.itemspec,
      m.sales_note,m.av_note,m.fieldtagcolor,m.listprice,m.season_supply,m.season_oh,m.season_demand,m.season_available,m.qualitycode,m.warehousei,
      upper(btrim(coalesce(m.itemcode,''))) item_key,
      upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g')) season_key,
      coalesce(private.manager_report_sales_year_v1(m.saleyear::text),0) sales_year,
      private.manager_report_date_v1(m.holdstopbegindate::text) hold_day,
      private.manager_report_date_v1(m.locationnotedate::text) note_day,
      coalesce(private.manager_report_safe_numeric_v1(m.s_lts::text),0) slts,
      coalesce(nullif(private.eval_normalize_user_v2(private.inventory_effective_owner_v1(m.unique_id)),''),'') assignedto,
      m.last_updated,
      (upper(regexp_replace(btrim(coalesce(m.season,'')),'[[:space:]]+','','g')) in ('Y','U3')
        and upper(coalesce(m.desigitem,'')) like '%SHFT%') is_excluded
    from public.ph_master_inventory m
    where nullif(btrim(coalesce(m.itemcode,'')),'') is not null
      and (coalesce(filters->>'itemCode','')='' or upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(filters->>'itemCode'))
        or (coalesce(filters->>'uniqueId','')<>'' and upper(btrim(coalesce(m.itemcode,'')))=(
          select upper(btrim(coalesce(sibling.itemcode,''))) from public.ph_master_inventory sibling
          where sibling.unique_id=filters->>'uniqueId' limit 1)))
  ), target_rows as materialized (
    select s.*,case when surface='eval2' then st.low_limit else coalesce(o.manual_override_qty,t.suggested_qty,st.low_limit) end low_item_limit,
      st.current_season current_season,st.current_year current_year,
      st.today,st.hold_days,st.note_days
    from source_rows s cross join settings st
    left join private.eval_item_low_stock_target_stats_v1 t on surface<>'eval2' and t.itemcode_normalized=s.item_key
    left join private.ph_eval_item_low_stock_overrides o on surface<>'eval2' and o.itemcode_normalized=s.item_key
  ), item_flags as materialized (
    select item_key,
      bool_or(nullif(btrim(coalesce(priority,'')),'') is not null) has_priority,
      bool_or(season_key='F1' and sales_year between 1 and current_year) has_f1,
      bool_or(upper(btrim(coalesce(holdstopcode,''))) in ('H','S') and hold_day is not null
        and today-hold_day>hold_days) has_old_hold,
      bool_or(season_key=current_season and sales_year between 1 and current_year
        and slts<low_item_limit) has_low_stock
    from target_rows where not is_excluded group by item_key
  ), classified as materialized (
    select r.*,
      case when r.is_excluded then array[]::text[] else
      array_remove(array[
        case when (surface='eval1' and nullif(btrim(coalesce(r.priority,'')),'') is not null and r.season_key=r.current_season)
                   or (surface='eval2' and nullif(btrim(coalesce(r.priority,'')),'') is not null and r.season_key<>'F1') then 's1-with-pri' end,
        case when r.season_key='U1' then 'u1' end,
        case when r.season_key='U2' then 'u2' end,
        case when r.season_key='U3' then 'u3' end,
        case when r.note_day is not null and r.today-r.note_day>r.note_days then 'od-loc-note-date' end,
        case when upper(btrim(coalesce(r.holdstopcode,''))) in ('H','S') and r.hold_day is not null and r.today-r.hold_day>r.hold_days then 'hs-plus-5-days' end,
        case when f.has_old_hold and nullif(btrim(coalesce(r.holdstopcode,'')),'') is null then 'get-off-hold' end,
        case when f.has_low_stock and ((r.season_key in ('U1','U2','U3','X') and r.sales_year between 1 and r.current_year)
          or (r.season_key=case when r.current_season='F1' then 'S1' else 'F1' end
            and r.sales_year=case when r.current_season='F1' then r.current_year else r.current_year+1 end)) then 'low-stock' end,
        case when not f.has_priority then 'no-pri' end,
        case when r.season_key='X' then 'culls' end,
        case when not f.has_f1 then 'not-in-f1' end
      ],null) end report_ids
    from target_rows r join item_flags f using(item_key)
  ), qualified as materialized (
    select c.* from classified c
    where c.report_ids && requested_reports
      and (coalesce(filters->>'contsize','all')='all' or lower(btrim(coalesce(c.contsize,'')))=lower(btrim(filters->>'contsize')))
      and (coalesce(filters->>'locationcode','all')='all' or lower(btrim(coalesce(c.locationcode,'')))=lower(btrim(filters->>'locationcode')))
      and (coalesce(filters->>'drillLocation','')='' or lower(btrim(coalesce(c.locationcode,'')))=lower(btrim(filters->>'drillLocation')))
      and (coalesce(filters->>'locationBase','')='' or coalesce(nullif(private.manager_report_location_base_v1(c.locationcode),''),'UNASSIGNED')=upper(btrim(filters->>'locationBase')))
      and (coalesce(filters->>'drillContsize','')='' or lower(btrim(coalesce(c.contsize,'')))=lower(btrim(filters->>'drillContsize')))
      and (coalesce(filters->>'blockalpha','')='' or lower(private.manager_report_block_key_v1(surface,c.blockalpha,c.locationcode))=lower(btrim(filters->>'blockalpha')))
      and (coalesce(filters->>'commonname','')='' or lower(coalesce(nullif(btrim(c.commonname),''),nullif(btrim(c.itemcode),''),'Unknown'))=lower(btrim(filters->>'commonname')))
      and (coalesce(filters->>'priority','all')='all' or (filters->>'priority'='with' and nullif(btrim(coalesce(c.priority,'')),'') is not null) or (filters->>'priority'='without' and nullif(btrim(coalesce(c.priority,'')),'') is null))
      and private.manager_report_progressive_search_v1(array[
        c.itemcode,coalesce(nullif(c.commonname,''),c.itemcode),coalesce(nullif(c.contsize,''),'-'),
        coalesce(nullif(upper(btrim(c.locationcode)),''),'UNASSIGNED'),c.lotcode,c.season_key,c.priority,
        coalesce(nullif(c.assignedto,''),'(Unassigned)'),c.genusname,c.holdstopcode,c.locationnotedate
      ],filters->>'search')
      and not exists(select 1 from jsonb_each(coalesce(filters->'gridColumns','{}'::jsonb)) gc where
        case gc.key
          when 'common' then not private.manager_report_grid_filter_v1(c.commonname,gc.value)
          when 'container' then not private.manager_report_grid_filter_v1(c.contsize,gc.value)
          when 'item-code' then not private.manager_report_grid_filter_v1(c.itemcode,gc.value)
          when 'location' then not private.manager_report_grid_filter_v1(c.locationcode,gc.value)
          when 'lot' then not private.manager_report_grid_filter_v1(c.lotcode,gc.value)
          when 'priority' then not private.manager_report_grid_filter_v1(c.priority,gc.value)
          when 'on-hand' then not private.manager_report_grid_filter_v1(c.ptronhand,gc.value)
          when 'review' then not private.manager_report_grid_filter_v1(c.ptrreviewed,gc.value)
          when 'available' then not private.manager_report_grid_filter_v1(c.ptravailable,gc.value)
          when 'open-stock' then not private.manager_report_grid_filter_v1(c.s_lts,gc.value)
          when 'desigloc' then not private.manager_report_grid_filter_v1(c.desigloc,gc.value)
          when 'photo' then case lower(btrim(coalesce(gc.value->>'value',''))) when '' then false when 'yes' then nullif(btrim(coalesce(c.photo_link,'')),'') is null when 'no' then nullif(btrim(coalesce(c.photo_link,'')),'') is not null else false end
          when 'selected' then case lower(btrim(coalesce(gc.value->>'value',''))) when '' then false when 'selected' then not (coalesce(filters->'selectedIds','[]'::jsonb) ? c.unique_id) when 'unselected' then coalesce(filters->'selectedIds','[]'::jsonb) ? c.unique_id else false end
          when 'action' then case lower(btrim(coalesce(gc.value->>'value',''))) when 'yes' then surface<>'eval1' when 'no' then surface='eval1' else false end
          else false end)
      and (jsonb_array_length(coalesce(filters->'seasons','[]'::jsonb))=0 or c.season_key=any(array(select upper(value) from jsonb_array_elements_text(filters->'seasons') s(value))))
      and (jsonb_array_length(coalesce(filters->'assignedUsers','[]'::jsonb))=0 or c.assignedto=any(array(select case when lower(value)='(unassigned)' then '' else lower(regexp_replace(btrim(value),'[^a-z0-9]+','_','g')) end from jsonb_array_elements_text(filters->'assignedUsers') u(value))))
      and (coalesce(filters->>'itemCode','')='' or c.item_key=upper(btrim(filters->>'itemCode')))
      and (coalesce(filters->>'uniqueId','')='' or c.unique_id=filters->>'uniqueId'
        or operation='detail' or coalesce(filters->>'cardRows','false')='true')
  ), qualifying_itemcodes as materialized (
    select distinct item_key from qualified
  ), filtered as materialized (
    select c.*,(q.unique_id is not null) is_qualified,
      coalesce(q.report_ids,array[]::text[]) qualified_report_ids
    from classified c
    join qualifying_itemcodes qi using(item_key)
    left join qualified q on q.unique_id=c.unique_id
    where q.unique_id is not null
      or (surface='eval2' and jsonb_array_length(coalesce(filters->'seasons','[]'::jsonb))=0
        and (coalesce(filters->>'cardRows','false')='true'
          or (operation='groups' and coalesce(filters->>'groupBy','itemcode')='itemcode')))
  ), ordered_page as (
    select * from filtered
    order by private.eval_work_natural_sort_key_v1(assignedto),
      private.eval_work_natural_sort_key_v1(item_key),
      case season_key when 'F1' then 1 when 'S1' then 2 when 'U1' then 3
        when 'U2' then 4 when 'U3' then 5 when 'X' then 6 when 'Y' then 7 when 'Z' then 8 else 9 end,
      (sales_year=0),sales_year,private.eval_work_natural_sort_key_v1(locationcode),unique_id
    limit page_limit offset page_offset
  ), grouped as (
    select case coalesce(filters->>'groupBy','itemcode')
        when 'blockalpha' then private.manager_report_block_key_v1(surface,blockalpha,locationcode)
        when 'locationcode' then coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED')
        when 'locationbase' then coalesce(nullif(private.manager_report_location_base_v1(locationcode),''),'UNASSIGNED')
        when 'commonname' then coalesce(nullif(btrim(commonname),''),nullif(btrim(itemcode),''),'Unknown')
        when 'contsize' then coalesce(nullif(btrim(contsize),''),'-')
        when 'row' then unique_id else item_key end group_key,
      min(item_key) item_key,min(itemcode) itemcode,max(commonname) commonname,
      private.manager_report_block_key_v1(surface,min(blockalpha),min(locationcode)) blockalpha_value,
      coalesce(nullif(upper(btrim(min(locationcode))),''),'UNASSIGNED') location_value,
      coalesce(nullif(btrim(min(contsize)),''),'-') contsize_value,
      array_agg(distinct contsize order by contsize) container_sizes,
      array_agg(distinct coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED') order by coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED')) full_locations,
      array_agg(distinct coalesce(nullif(assignedto,''),'(Unassigned)') order by coalesce(nullif(assignedto,''),'(Unassigned)')) assigned_users,
      count(distinct item_key) item_count,count(distinct unique_id) row_count,
      count(distinct coalesce(nullif(btrim(commonname),''),'(Unknown)')) common_name_count,
      count(distinct unique_id) filter(where is_qualified) report_row_count,
      count(distinct case when surface='eval1' then private.manager_report_location_base_v1(locationcode)
        else coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED') end) location_count,
      count(distinct coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED')) full_location_count,
      array_remove(array_agg(distinct rid order by rid),'') report_ids
    from filtered cross join lateral unnest(case when cardinality(report_ids)=0 then array['']::text[] else report_ids end) ids(rid)
    where rid=any(requested_reports) or coalesce(filters->>'cardRows','false')='true' or operation='groups'
    group by case coalesce(filters->>'groupBy','itemcode')
        when 'blockalpha' then private.manager_report_block_key_v1(surface,blockalpha,locationcode)
        when 'locationcode' then coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED')
        when 'locationbase' then coalesce(nullif(private.manager_report_location_base_v1(locationcode),''),'UNASSIGNED')
        when 'commonname' then coalesce(nullif(btrim(commonname),''),nullif(btrim(itemcode),''),'Unknown')
        when 'contsize' then coalesce(nullif(btrim(contsize),''),'-')
        when 'row' then unique_id else item_key end
  ), group_page as (
    select * from grouped order by private.eval_work_natural_sort_key_v1(group_key),group_key limit page_limit offset page_offset
  ), metadata as (
    select jsonb_build_object(
      'counts',(select coalesce(jsonb_object_agg(report_id,n), '{}'::jsonb) from (
        select rid report_id,count(*) n from classified cross join lateral unnest(report_ids) ids(rid) where rid<>'' group by rid
      ) counts),
      'filteredRowCount',(select count(*) from qualified),
      'groupCount',(select count(*) from grouped),
      'selectedRowCount',(select count(*) from source_rows where item_key=any(array(
        select upper(btrim(code.value)) from jsonb_array_elements_text(coalesce(filters->'selectedItemCodes','[]'::jsonb)) code(value)))),
      'selectedLocationCount',(select count(distinct coalesce(nullif(upper(btrim(locationcode)),''),'UNASSIGNED'))
        from source_rows where item_key=any(array(
          select upper(btrim(code.value)) from jsonb_array_elements_text(coalesce(filters->'selectedItemCodes','[]'::jsonb)) code(value)))),
      'matchingSelectedItemCount',case when coalesce(filters->>'groupBy','itemcode')='itemcode' then
        (select count(distinct g.item_key) from grouped g
          where g.item_key=any(array(select upper(btrim(code.value))
            from jsonb_array_elements_text(coalesce(filters->'selectedItemCodes','[]'::jsonb)) code(value))))
        else 0 end,
      'assignedToOptions',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct coalesce(nullif(assignedto,''),'(Unassigned)') value from target_rows) x),
      'filterOptions',jsonb_build_object(
        'seasons',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from(select distinct season_key value from target_rows where season_key<>'')x),
        'contSizes',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from(select distinct contsize value from target_rows where coalesce(contsize,'')<>'')x),
        'assignedTo',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from(select distinct coalesce(nullif(assignedto,''),'(Unassigned)') value from target_rows)x),
        'locations',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from(select distinct locationcode value from target_rows where coalesce(locationcode,'')<>'')x)),
      'currentSeason',(select current_season from settings),'currentSalesYear',(select current_year from settings),
      'nextSeason',case when (select current_season from settings)='F1' then 'S1' else 'F1' end,
      'nextSalesYear',(select current_year+case when current_season='F1' then 0 else 1 end from settings),
      'settings',jsonb_build_object('lowStockMaxSLts',(select low_limit from settings),'holdAgeDays',(select hold_days from settings),'locationNoteAgeDays',(select note_days from settings)),
      'inventoryRowCount',(select count(*) from source_rows),
      'assignmentStats',jsonb_build_object('assignmentCount',(select count(*) from target_rows where assignedto<>''),
        'matchedCount',(select count(*) from target_rows where assignedto<>''),
        'unassignedCount',(select count(*) from target_rows where assignedto='')),
      'diagnostics',jsonb_build_object(
        'invalidHoldStartDateCount',(select count(*) from target_rows where nullif(btrim(coalesce(holdstopbegindate,'')),'') is not null and hold_day is null),
        'invalidLocationNoteDateCount',(select count(*) from target_rows where nullif(btrim(coalesce(locationnotedate,'')),'') is not null and note_day is null)),
      'latestSourceUpdatedAt',(select max(last_updated) from source_rows)) value
  )
  select jsonb_build_object('ok',true,'surface',surface,'operation',operation,
    'rows',case when operation='metadata' then '[]'::jsonb when operation='groups' then coalesce((select jsonb_agg(jsonb_build_object(
      'key',case coalesce(filters->>'groupBy','itemcode') when 'itemcode' then 'item:'||item_key else coalesce(filters->>'groupBy','itemcode')||':'||group_key end,
      'groupBy',coalesce(filters->>'groupBy','itemcode'),'value',group_key,
      'label',case when surface='eval2' and coalesce(filters->>'groupBy','itemcode')='blockalpha' and group_key='__NO_BLOCK_ALPHA__' then 'No Block Alpha' else group_key end,
      'itemCount',item_count,'itemCode',itemcode,'commonName',commonname,
      'blockalpha',blockalpha_value,'locationcode',location_value,'contsize',contsize_value,
      'containerSizes',container_sizes,'assignedToUsers',assigned_users,'rowCount',row_count,
      'reportRowCount',report_row_count,'locationCount',location_count,'fullLocationCount',full_location_count,'fullLocations',full_locations,
      'contSizeCount',cardinality(container_sizes),'reportIds',report_ids,
      'commonNameCount',common_name_count,
      'representativeRow',(select jsonb_build_object('unique_id',p.unique_id,'itemcode',p.itemcode,
        'commonname',p.commonname,'contsize',p.contsize,'locationcode',p.locationcode,
        'lotcode',p.lotcode,'season',p.season,'priority',p.priority,'assignedto',p.assignedto)
        from filtered p where p.item_key=g.item_key
        order by private.eval_work_natural_sort_key_v1(p.assignedto),private.eval_work_natural_sort_key_v1(p.item_key),
          case p.season_key when 'F1' then 1 when 'S1' then 2 when 'U1' then 3 when 'U2' then 4
            when 'U3' then 5 when 'X' then 6 when 'Y' then 7 when 'Z' then 8 else 9 end,
          (p.sales_year=0),p.sales_year,private.eval_work_natural_sort_key_v1(p.locationcode),p.unique_id limit 1)
    ) order by private.eval_work_natural_sort_key_v1(group_key),group_key) from group_page g),'[]'::jsonb)
    else coalesce((select jsonb_agg((case when coalesce(filters->>'projection','list')='full' or operation='detail'
      then to_jsonb(m) when coalesce(filters->>'projection','list')='card' then jsonb_build_object(
        'unique_id',p.unique_id,'itemcode',p.itemcode,'commonname',p.commonname,'contsize',p.contsize,
        'locationcode',p.locationcode,'lotcode',p.lotcode,'ptronhand',p.ptronhand,'ptrreviewed',p.ptrreviewed,
        'ptravailable',p.ptravailable,'season',p.season,'saleyear',p.saleyear,'priority',p.priority,
        'genusname',p.genusname,'blockalpha',p.blockalpha,'source',p.source,'s_lts',p.s_lts,
        'holdstopcode',p.holdstopcode,'holdstopbegindate',p.holdstopbegindate,'holdstopreason',p.holdstopreason,
        'locationnotedate',p.locationnotedate,'locationnote',p.locationnote,'salesnote',p.salesnote,
        'sales_note',p.sales_note,'av_note',p.av_note,'itemspec',p.itemspec,'desigitem',p.desigitem,
        'desigloc',p.desigloc,'plantgroupcode',p.plantgroupcode,'fieldtagcolor',p.fieldtagcolor,
        'listprice',p.listprice,'season_supply',p.season_supply,'season_oh',p.season_oh,
        'season_demand',p.season_demand,'season_available',p.season_available,'qualitycode',p.qualitycode,
        'warehousei',p.warehousei,'photo_link',p.photo_link,'photo_name',p.photo_name,'last_updated',p.last_updated)
      else jsonb_build_object(
        'unique_id',p.unique_id,'itemcode',p.itemcode,'commonname',p.commonname,
        'contsize',p.contsize,'locationcode',p.locationcode,'lotcode',p.lotcode,
        'ptronhand',p.ptronhand,'ptravailable',p.ptravailable,'season',p.season,
        'saleyear',p.saleyear,'priority',p.priority,'genusname',p.genusname,
        'blockalpha',p.blockalpha,'source',p.source,'s_lts',p.s_lts,
        'holdstopcode',p.holdstopcode,'holdstopbegindate',p.holdstopbegindate,
        'locationnotedate',p.locationnotedate,'desigitem',p.desigitem,
        'plantgroupcode',p.plantgroupcode,'last_updated',p.last_updated) end)||jsonb_build_object('assignedto',p.assignedto,
      'assignedToUsers',jsonb_build_array(coalesce(nullif(p.assignedto,''),'(Unassigned)')),
      'reportIds',p.report_ids) order by private.eval_work_natural_sort_key_v1(p.assignedto),
        private.eval_work_natural_sort_key_v1(p.item_key),p.item_key,
        case p.season_key when 'F1' then 1 when 'S1' then 2 when 'U1' then 3 when 'U2' then 4
          when 'U3' then 5 when 'X' then 6 when 'Y' then 7 when 'Z' then 8 else 9 end,
        (p.sales_year=0),p.sales_year,private.eval_work_natural_sort_key_v1(p.locationcode),p.unique_id) from ordered_page p
      join public.ph_master_inventory m on m.unique_id=p.unique_id),'[]'::jsonb) end,
    'total',case when operation='metadata' then 0 when operation='groups' then (select count(*) from grouped) else (select count(*) from filtered) end,
    'offset',page_offset,'limit',page_limit,
    'hasMore',case when operation='metadata' then false when operation='groups' then (select count(*)>page_offset+page_limit from grouped)
      else (select count(*)>page_offset+page_limit from filtered) end,
    'sourceRevision',source_revision,'sourceFreshness',source_state,
    'metadata',(select value from metadata)) into response;
  return response;
end
$function$;
revoke all on function public.manager_report_read_v2(jsonb) from public,anon,authenticated;
grant execute on function public.manager_report_read_v2(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
