begin;

set local lock_timeout='5s';
set local statement_timeout='30s';

create table if not exists private.inventory_consolidation_cache_v2366 (
  suggestion_key text primary key,
  current_sales_year integer not null,
  itemcode text not null,
  commonname text not null,
  contsize text not null,
  source_locationcode text not null,
  source_lotcodes text not null default '',
  source_sales_year integer not null,
  source_block text not null,
  loc_on_hand numeric not null,
  available numeric not null,
  open_stock numeric not null,
  source_year_on_hand numeric not null,
  sales_year_rule text not null check(sales_year_rule in ('current','older')),
  source_rows jsonb not null check(jsonb_typeof(source_rows)='array'),
  destinations jsonb not null check(jsonb_typeof(destinations)='array'),
  search_text text not null,
  refreshed_at timestamptz not null
);

revoke all on private.inventory_consolidation_cache_v2366 from public,anon,authenticated,service_role;
create index if not exists inventory_consolidation_cache_filters_v2366
  on private.inventory_consolidation_cache_v2366(current_sales_year,sales_year_rule,contsize,source_block);
create index if not exists inventory_consolidation_cache_order_v2366
  on private.inventory_consolidation_cache_v2366(current_sales_year,loc_on_hand,commonname,itemcode,source_locationcode);

create or replace function private.refresh_inventory_consolidation_cache_v2366()
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='5s'
as $function$
declare
  active_sales_year integer;
  refreshed_at_value timestamptz:=clock_timestamp();
  refreshed_rows integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('inventory-consolidation-cache-v2366',0)) then
    return jsonb_build_object('status','refresh_in_progress');
  end if;
  active_sales_year:=private.inventory_consolidation_sales_year_v2366(
    private.season_sales_settings_v1()->>'salesYear',null);
  if active_sales_year is null then
    select max(private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode))
    into active_sales_year from public.ph_master_inventory row;
  end if;

  create temporary table inventory_consolidation_refresh_v2366 on commit drop as
  with inventory as materialized (
    select row.unique_id,upper(btrim(row.itemcode)) itemcode,
      coalesce(nullif(btrim(row.commonname),''),btrim(row.itemcode)) commonname,
      upper(btrim(row.contsize)) contsize,upper(btrim(row.locationcode)) locationcode,
      btrim(coalesce(row.lotcode,'')) lotcode,
      private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode) sales_year,
      private.inventory_consolidation_block_v2366(row.blockalpha,row.locationcode) block,
      greatest(coalesce(private.location_work_numeric_v1(row.ptronhand),0),0) on_hand,
      greatest(coalesce(private.location_work_numeric_v1(row.ptravailable),0),0) available,
      greatest(coalesce(private.location_work_numeric_v1(row.s_lts),0),0) open_stock
    from public.ph_master_inventory row
    where nullif(btrim(row.itemcode),'') is not null and nullif(btrim(row.locationcode),'') is not null
      and upper(btrim(row.contsize))=any(array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8" P','3GP','1DP'])
  ), location_totals as materialized (
    select itemcode,locationcode,sum(on_hand) loc_on_hand,sum(available) available,sum(open_stock) open_stock
    from inventory group by itemcode,locationcode
  ), source_groups as materialized (
    select inventory.itemcode,inventory.locationcode,inventory.sales_year,max(inventory.block) block,
      max(inventory.commonname) commonname,max(inventory.contsize) contsize,
      totals.loc_on_hand,totals.available,totals.open_stock,sum(inventory.on_hand) source_year_on_hand,
      string_agg(distinct nullif(inventory.lotcode,''),', ' order by nullif(inventory.lotcode,'')) lotcodes,
      jsonb_agg(jsonb_build_object('uniqueId',inventory.unique_id,'itemcode',inventory.itemcode,
        'commonname',inventory.commonname,'contsize',inventory.contsize,'locationcode',inventory.locationcode,
        'lotcode',inventory.lotcode,'salesYear',inventory.sales_year,'onHand',inventory.on_hand,
        'available',inventory.available,'openStock',inventory.open_stock)
        order by inventory.lotcode,inventory.unique_id) source_rows
    from inventory join location_totals totals using(itemcode,locationcode)
    where inventory.on_hand>0 and inventory.sales_year is not null and inventory.sales_year<=active_sales_year
    group by inventory.itemcode,inventory.locationcode,inventory.sales_year,
      totals.loc_on_hand,totals.available,totals.open_stock
  ), destination_groups as materialized (
    select inventory.itemcode,inventory.locationcode,inventory.sales_year,max(inventory.block) block,
      sum(inventory.on_hand) loc_on_hand,
      string_agg(distinct nullif(inventory.lotcode,''),', ' order by nullif(inventory.lotcode,'')) lotcodes
    from inventory where inventory.on_hand>0 and inventory.sales_year is not null
    group by inventory.itemcode,inventory.locationcode,inventory.sales_year
  ), destination_options as materialized (
    select source.itemcode,source.locationcode source_locationcode,source.sales_year source_sales_year,
      jsonb_agg(jsonb_build_object('locationcode',candidate.locationcode,'lotcode',candidate.lotcodes,
        'salesYear',candidate.sales_year,'locOnHand',candidate.loc_on_hand,
        'combinedLocOnHand',source.loc_on_hand+candidate.loc_on_hand,'sameSalesYear',candidate.sales_year=source.sales_year,
        'sameBlock',candidate.block=source.block,
        'distance',private.inventory_consolidation_distance_v2366(source.locationcode,candidate.locationcode))
        order by (candidate.sales_year=source.sales_year) desc,(candidate.block=source.block) desc,
          private.inventory_consolidation_distance_v2366(source.locationcode,candidate.locationcode),
          candidate.loc_on_hand desc,candidate.locationcode,candidate.sales_year) options
    from source_groups source join destination_groups candidate
      on candidate.itemcode=source.itemcode and candidate.locationcode<>source.locationcode
      and (source.sales_year<active_sales_year or candidate.sales_year=source.sales_year)
    where source.loc_on_hand>0 and source.loc_on_hand<100
    group by source.itemcode,source.locationcode,source.sales_year
  )
  select source.itemcode||'|'||source.locationcode||'|'||source.sales_year::text suggestion_key,
    active_sales_year current_sales_year,source.itemcode,source.commonname,source.contsize,
    source.locationcode source_locationcode,coalesce(source.lotcodes,'') source_lotcodes,
    source.sales_year source_sales_year,source.block source_block,source.loc_on_hand,source.available,
    source.open_stock,source.source_year_on_hand,
    case when source.sales_year=active_sales_year then 'current' else 'older' end sales_year_rule,
    source.source_rows,options.options destinations,
    lower(source.commonname||' '||source.itemcode||' '||source.locationcode) search_text,
    refreshed_at_value refreshed_at
  from source_groups source join destination_options options
    on options.itemcode=source.itemcode and options.source_locationcode=source.locationcode
    and options.source_sales_year=source.sales_year;

  insert into private.inventory_consolidation_cache_v2366 as target(
    suggestion_key,current_sales_year,itemcode,commonname,contsize,source_locationcode,source_lotcodes,
    source_sales_year,source_block,loc_on_hand,available,open_stock,source_year_on_hand,sales_year_rule,
    source_rows,destinations,search_text,refreshed_at)
  select suggestion_key,current_sales_year,itemcode,commonname,contsize,source_locationcode,source_lotcodes,
    source_sales_year,source_block,loc_on_hand,available,open_stock,source_year_on_hand,sales_year_rule,
    source_rows,destinations,search_text,refreshed_at
  from pg_temp.inventory_consolidation_refresh_v2366
  on conflict(suggestion_key) do update set
    current_sales_year=excluded.current_sales_year,itemcode=excluded.itemcode,commonname=excluded.commonname,
    contsize=excluded.contsize,source_locationcode=excluded.source_locationcode,
    source_lotcodes=excluded.source_lotcodes,source_sales_year=excluded.source_sales_year,
    source_block=excluded.source_block,loc_on_hand=excluded.loc_on_hand,available=excluded.available,
    open_stock=excluded.open_stock,source_year_on_hand=excluded.source_year_on_hand,
    sales_year_rule=excluded.sales_year_rule,source_rows=excluded.source_rows,
    destinations=excluded.destinations,search_text=excluded.search_text,refreshed_at=excluded.refreshed_at;
  delete from private.inventory_consolidation_cache_v2366 cache
  where not exists(select 1 from pg_temp.inventory_consolidation_refresh_v2366 fresh
    where fresh.suggestion_key=cache.suggestion_key);
  select count(*) into refreshed_rows from pg_temp.inventory_consolidation_refresh_v2366;
  return jsonb_build_object('status','complete','currentSalesYear',active_sales_year,
    'rows',refreshed_rows,'refreshedAt',refreshed_at_value);
end
$function$;

revoke all on function private.refresh_inventory_consolidation_cache_v2366() from public,anon,authenticated,service_role;

select private.refresh_inventory_consolidation_cache_v2366();

create or replace function public.inventory_consolidation_suggestions_v1(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
set statement_timeout='500ms'
as $function$
declare
  actor_id uuid:=auth.uid();
  configured_sales_year integer;
  active_sales_year integer;
  block_filter text:=upper(btrim(coalesce(p_query->>'block','')));
  size_filter text:=upper(btrim(coalesce(p_query->>'containerSize','')));
  rule_filter text:=lower(btrim(coalesce(p_query->>'salesYearRule','')));
  search_filter text:=lower(btrim(coalesce(p_query->>'query','')));
  eligible_sizes constant text[]:=array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8" P','3GP','1DP'];
  rows_value jsonb:='[]'::jsonb;
  total_value bigint:=0;
  generated_at_value timestamptz;
begin
  if actor_id is null then raise exception using errcode='42501',message='INVENTORY_CONSOLIDATION_AUTH_REQUIRED'; end if;
  perform sales_private.actor(actor_id);
  if not private.navigation_module_allowed_v1(actor_id,'sales-inventory') then
    raise exception using errcode='42501',message='INVENTORY_CONSOLIDATION_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
     or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) key
       where key not in ('block','containerSize','salesYearRule','query'))
     or length(block_filter)>20 or length(size_filter)>20 or length(search_filter)>100
     or rule_filter not in ('','current','older')
     or (size_filter<>'' and not size_filter=any(eligible_sizes)) then
    raise exception using errcode='22023',message='INVENTORY_CONSOLIDATION_QUERY_INVALID';
  end if;
  configured_sales_year:=private.inventory_consolidation_sales_year_v2366(
    private.season_sales_settings_v1()->>'salesYear',null);
  select coalesce(max(cache.current_sales_year),configured_sales_year),max(cache.refreshed_at)
  into active_sales_year,generated_at_value from private.inventory_consolidation_cache_v2366 cache;

  with filtered as materialized (
    select cache.* from private.inventory_consolidation_cache_v2366 cache
    where cache.current_sales_year=active_sales_year
      and (block_filter='' or cache.source_block=block_filter)
      and (size_filter='' or cache.contsize=size_filter)
      and (rule_filter='' or cache.sales_year_rule=rule_filter)
      and (search_filter='' or cache.search_text like '%'||search_filter||'%')
  )
  select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object(
      'suggestionKey',suggestion_key,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
      'fromLocationcode',source_locationcode,'fromLotcode',source_lotcodes,'salesYear',source_sales_year,
      'block',source_block,'locOnHand',loc_on_hand,'available',available,'openStock',open_stock,
      'sourceYearOnHand',source_year_on_hand,'salesYearRule',sales_year_rule,'sourceRows',source_rows,
      'destinations',destinations) order by loc_on_hand,lower(commonname),itemcode,source_locationcode,source_sales_year)
    from (select * from filtered order by loc_on_hand,lower(commonname),itemcode,source_locationcode,source_sales_year limit 1000) page),'[]'::jsonb)
  into total_value,rows_value;
  return jsonb_build_object('currentSalesYear',active_sales_year,'eligibleContainerSizes',to_jsonb(eligible_sizes),
    'total',total_value,'truncated',total_value>1000,'rows',rows_value,'generatedAt',generated_at_value);
end
$function$;

comment on function public.inventory_consolidation_suggestions_v1(jsonb) is
  'Authenticated, cached, read-only Inventory Consolidation suggestions; background refresh never creates Queue work.';
revoke all on function public.inventory_consolidation_suggestions_v1(jsonb) from public,anon,service_role;
grant execute on function public.inventory_consolidation_suggestions_v1(jsonb) to authenticated;

do $schedule$
declare existing_job bigint;
begin
  if to_regclass('cron.job') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null then
    select jobid into existing_job from cron.job where jobname='agdata_inventory_consolidation_cache_v2366' limit 1;
    if existing_job is not null then perform cron.unschedule(existing_job); end if;
    perform cron.schedule('agdata_inventory_consolidation_cache_v2366','7,22,37,52 * * * *',
      'select private.refresh_inventory_consolidation_cache_v2366();');
  end if;
end
$schedule$;

commit;
