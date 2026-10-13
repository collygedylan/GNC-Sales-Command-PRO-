begin;

create index if not exists ph_master_inventory_item_location_on_hand_idx
  on public.ph_master_inventory (
    upper(btrim(coalesce(itemcode,''))),
    upper(btrim(coalesce(locationcode,'')))
  );

-- Location On Hand is scoped to the physical item and location pair. This
-- private core is shared by the service-only app boundary and Manager reports.
create or replace function private.inventory_location_item_on_hand_v1(p_pairs jsonb, p_foreman boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare
  pair_count integer;
  result jsonb;
begin
  if jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_array_length(p_pairs) > 500 then
    raise exception using errcode='22023', message='LOC_ON_HAND_PAIRS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_pairs) p(value)
    where jsonb_typeof(value) <> 'object'
      or nullif(btrim(value->>'itemcode'),'') is null
      or nullif(btrim(value->>'locationcode'),'') is null
      or length(value->>'itemcode') > 240 or length(value->>'locationcode') > 160
  ) then raise exception using errcode='22023', message='LOC_ON_HAND_PAIRS_INVALID'; end if;
  select count(*) into pair_count from (
    select distinct upper(btrim(value->>'itemcode')) item_key,
      upper(btrim(value->>'locationcode')) location_key
    from jsonb_array_elements(p_pairs) p(value)
  ) pairs;
  if pair_count > 500 then raise exception using errcode='22023', message='LOC_ON_HAND_PAIRS_INVALID'; end if;

  with pairs as materialized (
    select distinct upper(btrim(value->>'itemcode')) item_key,
      upper(btrim(value->>'locationcode')) location_key
    from jsonb_array_elements(p_pairs) p(value)
  ), totals as (
    select p.item_key,p.location_key,count(m.unique_id) row_count,
      count(m.unique_id) filter(where private.manager_report_safe_numeric_v1(m.ptronhand::text) is null) invalid_count,
      sum(private.manager_report_safe_numeric_v1(m.ptronhand::text)) quantity
    from pairs p left join public.ph_master_inventory m
      on upper(btrim(coalesce(m.itemcode,'')))=p.item_key
      and upper(btrim(coalesce(m.locationcode,'')))=p.location_key
      and (not p_foreman
        or (m.priority is not null and m.priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
    group by p.item_key,p.location_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemcodeKey',item_key,'locationKey',location_key,
    'loc_on_hand',case when row_count=0 or invalid_count>0 then null else quantity end
  ) order by item_key,location_key),'[]'::jsonb) into result from totals;
  return result;
end
$function$;
revoke all on function private.inventory_location_item_on_hand_v1(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.inventory_location_item_on_hand_v1(jsonb,boolean) to postgres;

create or replace function public.inventory_location_on_hand_read_v1(
  p_actor_id uuid, p_pairs jsonb, p_expected_revision text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare
  actor public.profiles;
  revision_text text;
  revision_state text;
  totals jsonb;
begin
  select p.* into actor from public.profiles p
  where p.id=p_actor_id and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now());
  if not found or actor.must_change_password then
    raise exception using errcode='42501',message='LOC_ON_HAND_ACTOR_FORBIDDEN';
  end if;
  -- The app-api service boundary applies the canonical hasTableReadAccess
  -- decision before calling this service-only RPC. Keep this SQL guard focused
  -- on active identity; duplicating the evolving role matrix here would deny
  -- valid roles accepted by the existing reader.
  select revision::text,state into revision_text,revision_state
    from public.app_dataset_revisions where key='ph_master_inventory';
  if revision_state is distinct from 'ready' or revision_text is null then
    raise exception using errcode='40001',message='LOC_ON_HAND_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null and p_expected_revision<>revision_text then
    raise exception using errcode='40001',message='LOC_ON_HAND_REVISION_CHANGED';
  end if;
  totals:=private.inventory_location_item_on_hand_v1(p_pairs,
    regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') like '%FOREMAN%');
  return jsonb_build_object('inventoryRevision',revision_text,
    'rows',(select coalesce(jsonb_agg(jsonb_build_object(
      'itemcode',p.value->>'itemcode','locationcode',p.value->>'locationcode',
      'loc_on_hand',t.value->'loc_on_hand','loc_on_hand_revision',revision_text
    ) order by ordinal),'[]'::jsonb)
      from jsonb_array_elements(p_pairs) with ordinality p(value,ordinal)
      left join lateral (select value from jsonb_array_elements(totals) x(value)
        where x.value->>'itemcodeKey'=upper(btrim(p.value->>'itemcode'))
          and x.value->>'locationKey'=upper(btrim(p.value->>'locationcode'))) t on true));
end
$function$;
revoke all on function public.inventory_location_on_hand_read_v1(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.inventory_location_on_hand_read_v1(uuid,jsonb,text) to service_role;

-- Walk every nested projection so Manager NCR's rows array and grouped
-- representativeRow receive the same metric as ordinary inventory rows.
create or replace function private.manager_report_enrich_location_on_hand_json_v1(
  p_value jsonb,p_totals jsonb,p_revision text
) returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  result jsonb;
  entry record;
  amount jsonb;
  item_key text;
  location_key text;
begin
  if jsonb_typeof(p_value)='array' then
    result:='[]'::jsonb;
    for entry in select value from jsonb_array_elements(p_value) loop
      result:=result||jsonb_build_array(private.manager_report_enrich_location_on_hand_json_v1(entry.value,p_totals,p_revision));
    end loop;
    return result;
  elsif jsonb_typeof(p_value)='object' then
    result:='{}'::jsonb;
    for entry in select key,value from jsonb_each(p_value) loop
      result:=result||jsonb_build_object(entry.key,
        private.manager_report_enrich_location_on_hand_json_v1(entry.value,p_totals,p_revision));
    end loop;
    item_key:=upper(btrim(coalesce(p_value->>'itemcode','')));
    location_key:=upper(btrim(coalesce(p_value->>'locationcode','')));
    if item_key<>'' and location_key<>'' and not (p_value ? 'representativeRow') then
      select value->'loc_on_hand' into amount from jsonb_array_elements(coalesce(p_totals,'[]'::jsonb)) x(value)
        where value->>'itemcodeKey'=item_key and value->>'locationKey'=location_key limit 1;
      result:=result||jsonb_build_object('loc_on_hand',amount,'loc_on_hand_revision',p_revision);
    end if;
    return result;
  end if;
  return p_value;
end
$function$;
revoke all on function private.manager_report_enrich_location_on_hand_json_v1(jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.manager_report_enrich_location_on_hand_json_v1(jsonb,jsonb,text) to postgres;

create or replace function private.manager_report_enrich_location_on_hand_v1(p_result jsonb,p_foreman boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  source_revision text;
  source_state text;
  pairs jsonb;
  totals jsonb;
  rows_value jsonb;
begin
  select revision::text,state into source_revision,source_state
    from public.app_dataset_revisions where key='ph_master_inventory';
  if source_revision is null or source_state is distinct from 'ready' then
    raise exception using errcode='40001',message='LOC_ON_HAND_SOURCE_NOT_READY';
  end if;
  with recursive nodes(value) as (
    select coalesce(p_result->'rows','[]'::jsonb)
    union all
    select child.value from nodes n cross join lateral (
      select a.value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end) a(value)
      union all
      select o.value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end) o(key,value)
    ) child
  )
  select coalesce(jsonb_agg(jsonb_build_object('itemcode',item_key,'locationcode',location_key)
      order by item_key,location_key),'[]'::jsonb)
    into pairs from (
      select distinct upper(btrim(value->>'itemcode')) item_key,
        upper(btrim(value->>'locationcode')) location_key
      from nodes where jsonb_typeof(value)='object'
        and nullif(btrim(value->>'itemcode'),'') is not null
        and nullif(btrim(value->>'locationcode'),'') is not null
    ) normalized_pairs;
  if jsonb_array_length(pairs)>500 then raise exception using errcode='22023',message='LOC_ON_HAND_PAIRS_INVALID'; end if;
  totals:=private.inventory_location_item_on_hand_v1(pairs,p_foreman);
  rows_value:=private.manager_report_enrich_location_on_hand_json_v1(coalesce(p_result->'rows','[]'::jsonb),totals,source_revision);
  return jsonb_set(jsonb_set(p_result,'{rows}',rows_value,true),'{inventoryRevision}',to_jsonb(source_revision),true);
end
$function$;
revoke all on function private.manager_report_enrich_location_on_hand_v1(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.manager_report_enrich_location_on_hand_v1(jsonb,boolean) to postgres;

do $migration$
declare definition text; replacement text;
begin
  definition:=pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure);
  if position('private.manager_report_enrich_location_on_hand_v1(response' in definition)>0 then return; end if;
  if position('  return response;' in definition)=0
    or position('return private.manager_report_assigned_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision);' in definition)=0
    or position('return private.manager_report_season_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision);' in definition)=0 then
    raise exception 'MANAGER_REPORT_LOCATION_ON_HAND_PATCH_POINT_MISSING';
  end if;
  replacement:=$replace$return private.manager_report_enrich_location_on_hand_v1(response,
    regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') like '%FOREMAN%');$replace$;
  definition:=replace(definition,'  return response;',replacement);
  definition:=replace(definition,
    'return private.manager_report_assigned_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision);',
    $replace$return private.manager_report_enrich_location_on_hand_v1(private.manager_report_assigned_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision),
      regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') like '%FOREMAN%');$replace$);
  definition:=replace(definition,
    'return private.manager_report_season_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision);',
    $replace$return private.manager_report_enrich_location_on_hand_v1(private.manager_report_season_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision),
      regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') like '%FOREMAN%');$replace$);
  if position('private.manager_report_enrich_location_on_hand_v1(response' in definition)=0
    or position('private.manager_report_enrich_location_on_hand_v1(private.manager_report_assigned_page_v2' in definition)=0
    or position('private.manager_report_enrich_location_on_hand_v1(private.manager_report_season_page_v2' in definition)=0 then
    raise exception 'MANAGER_REPORT_LOCATION_ON_HAND_REPLACEMENT_FAILED';
  end if;
  execute definition;
end
$migration$;

notify pgrst,'reload schema';
commit;
