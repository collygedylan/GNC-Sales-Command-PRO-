begin;
set local lock_timeout = '5s';

-- Parse inventory's text-encoded values strictly. Empty or malformed values
-- remain unknown; never reinterpret them as zero.
create or replace function public.aura_inventory_v2_number_v1(p_value text)
returns numeric language sql immutable parallel safe set search_path = pg_catalog
as $$ select case when replace(btrim(coalesce(p_value, '')), ',', '') ~ '^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
  then replace(btrim(p_value), ',', '')::numeric else null::numeric end $$;

create or replace function public.aura_inventory_v2_salesyear_v1(p_value text)
returns integer language sql immutable parallel safe set search_path = pg_catalog
as $$ select case
  when public.aura_inventory_v2_number_v1(p_value) is null
    or public.aura_inventory_v2_number_v1(p_value) <> trunc(public.aura_inventory_v2_number_v1(p_value))
    or public.aura_inventory_v2_number_v1(p_value) < 1
    or public.aura_inventory_v2_number_v1(p_value) > 9999 then null::integer
  when public.aura_inventory_v2_number_v1(p_value) >= 2000 then mod(public.aura_inventory_v2_number_v1(p_value)::integer,100)
  when public.aura_inventory_v2_number_v1(p_value) <= 99 then public.aura_inventory_v2_number_v1(p_value)::integer
  else null::integer end $$;

create or replace function public.aura_inventory_v2_size_v1(p_value text)
returns text language sql immutable parallel safe set search_path = pg_catalog
as $$ select regexp_replace(regexp_replace(lower(regexp_replace(btrim(coalesce(p_value,'')), '^#\s*', '', 'i')), '\s+', ' ', 'g'), '\.$', '') $$;

-- The app-api verifies Dylan's native session before calling this invoker RPC.
-- It derives active season and sales year from the authoritative setting. A
-- fixed supported season may scope count/maximum reads, but caller input never
-- sets the cutoff year. The public-schema function is not executable by PUBLIC,
-- anon, or authenticated.
create or replace function public.aura_inventory_v2_read_v1(
  p_operation text,
  p_itemcode text default null,
  p_contsize text default null,
  p_locationcode text default null,
  p_metric text default 'ptravailable',
  p_open_stock_only boolean default false,
  p_quantity numeric default null,
  p_expected_season text default null,
  p_cursor jsonb default null,
  p_limit integer default 100,
  p_lines jsonb default '[]'::jsonb
) returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_metric text := lower(btrim(coalesce(p_metric, 'ptravailable')));
  v_limit integer := greatest(1, least(500, coalesce(p_limit,100)));
  v_season text;
  v_query_season text;
  v_sales_year integer;
  v_settings jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_valid_rows jsonb := '[]'::jsonb;
  v_total numeric;
  v_complete boolean := true;
  v_more boolean := false;
  v_cursor jsonb;
  v_cursor_item text;
  v_cursor_size text;
  v_cursor_uid text;
  v_cursor_priority numeric;
  v_cursor_priority_null boolean := false;
  v_winner jsonb;
  v_tie_count bigint := 0;
  v_line jsonb;
  v_row public.ph_master_inventory%rowtype;
  v_uid text;
  v_item text;
  v_name text;
  v_size text;
  v_location text;
  v_lot text;
  v_qty numeric;
  v_available numeric;
  v_open numeric;
  v_salesyear integer;
  v_error text;
begin
  if v_operation not in ('catalog','count','maximum','lots','validate_draft') then
    raise exception using errcode='22023',message='AURA_V2_OPERATION_INVALID';
  end if;
  if v_metric not in ('ptravailable','ptronhand') then
    raise exception using errcode='22023',message='AURA_V2_METRIC_INVALID';
  end if;
  if p_cursor is not null and jsonb_typeof(p_cursor)<>'object' then
    raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID';
  end if;
  if p_expected_season is not null and upper(btrim(p_expected_season)) not in ('S1','F1','U1','U2','U3','X','Y','Z') then
    raise exception using errcode='22023',message='AURA_V2_SEASON_INVALID';
  end if;
  if v_operation in ('count','lots') and nullif(btrim(coalesce(p_itemcode,'')),'') is null then
    raise exception using errcode='22023',message='AURA_V2_ITEMCODE_REQUIRED';
  end if;
  if length(coalesce(p_itemcode,''))>100 or length(coalesce(p_contsize,''))>48 or length(coalesce(p_locationcode,''))>64 then
    raise exception using errcode='22023',message='AURA_V2_FILTER_INVALID';
  end if;
  if v_operation='lots' and (p_quantity is null or p_quantity<1 or p_quantity>999999 or p_quantity<>trunc(p_quantity)) then
    raise exception using errcode='22023',message='AURA_V2_QUANTITY_INVALID';
  end if;
  if v_operation='validate_draft' and (jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>50) then
    raise exception using errcode='22023',message='AURA_V2_DRAFT_INVALID';
  end if;

  select s.value into v_settings from public.ph_app_settings s where s.key='current_season_salesyear';
  v_season:=upper(btrim(coalesce(v_settings->>'seasonCode',v_settings->>'season_code',v_settings->>'currentSeason',v_settings->>'current_season','')));
  v_sales_year:=public.aura_inventory_v2_salesyear_v1(coalesce(v_settings->>'salesYear',v_settings->>'sales_year',v_settings->>'currentSalesYear',v_settings->>'current_sales_year',v_settings->>'salesyear'));
  if v_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or v_sales_year is null or v_sales_year>99 then
    raise exception using errcode='22023',message='AURA_SETTINGS_UNAVAILABLE';
  end if;
  v_query_season:=coalesce(upper(btrim(p_expected_season)),v_season);
  if v_operation in ('lots','validate_draft') and v_query_season<>v_season then
    return jsonb_build_object('ok',true,'complete',false,'valid',false,'code','AURA_ACTIVE_SEASON_REQUIRED','rows','[]'::jsonb,
      'failures',jsonb_build_array(jsonb_build_object('unique_id',null,'error','active_season_changed')),'season',v_season,'salesYear',v_sales_year);
  end if;

  if v_operation='catalog' then
    if p_cursor is not null then
      if not (p_cursor ? 'itemcode' and p_cursor ? 'contsize') or (p_cursor-'itemcode'-'contsize')<>'{}'::jsonb then
        raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID';
      end if;
      v_cursor_item:=coalesce(p_cursor->>'itemcode','');
      v_cursor_size:=coalesce(p_cursor->>'contsize','');
    end if;
    with grouped as (
      select upper(btrim(m.itemcode)) item_key,
        public.aura_inventory_v2_size_v1(m.contsize) size_key,
        min(btrim(m.itemcode)) itemcode,min(btrim(m.commonname)) commonname,min(btrim(m.contsize)) contsize,
        bool_or(public.aura_inventory_v2_salesyear_v1(m.saleyear) is null) bad_year,
        bool_or(p_open_stock_only and public.aura_inventory_v2_number_v1(m.s_lts) is null) bad_open,
        bool_or(nullif(btrim(coalesce(m.itemcode,'')),'') is null or nullif(btrim(coalesce(m.commonname,'')),'') is null
          or nullif(public.aura_inventory_v2_size_v1(m.contsize),'') is null) bad_identity
      from public.ph_master_inventory m
      where upper(btrim(coalesce(m.season,''))) in ('S1','F1','U1','U2','U3','X','Y','Z')
        and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
        and position('SHFT' in upper(coalesce(m.desigitem,'')))=0
        and (public.aura_inventory_v2_salesyear_v1(m.saleyear)<=v_sales_year or public.aura_inventory_v2_salesyear_v1(m.saleyear) is null)
        and (not p_open_stock_only or public.aura_inventory_v2_number_v1(m.s_lts)>0 or public.aura_inventory_v2_number_v1(m.s_lts) is null)
      group by 1,2
    ), capped as (
      select * from grouped order by item_key,size_key limit 10001
    ), page as (
      select * from capped c where c.itemcode is not null and c.itemcode<>''
        and (p_cursor is null or (c.item_key,c.size_key)>(upper(v_cursor_item),public.aura_inventory_v2_size_v1(v_cursor_size)))
      order by item_key,size_key limit v_limit+1
    ), numbered as (
      select page.*,row_number() over(order by item_key,size_key) ordinal from page
    )
    select
      coalesce((select count(*)>v_limit from numbered),false),
      coalesce((select jsonb_agg(jsonb_build_object('itemcode',itemcode,'commonname',commonname,'contsize',contsize)
        order by item_key,size_key) filter(where ordinal<=v_limit) from numbered),'[]'::jsonb),
      (select jsonb_build_object('itemcode',item_key,'contsize',size_key) from numbered where ordinal=v_limit),
      not exists(select 1 from capped where bad_year or bad_open or bad_identity) and (select count(*)<=10000 from capped)
    into v_more,v_rows,v_cursor,v_complete;
    return jsonb_build_object('ok',true,'rows',v_rows,'complete',v_complete,'nextCursor',case when v_more then v_cursor else null end,
      'hasMore',v_more,'season',v_season,'salesYear',v_sales_year);
  end if;

  if v_operation='maximum' then
    if p_cursor is not null then raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID'; end if;
    with candidates as (
      select upper(btrim(coalesce(m.itemcode,''))) item_key,btrim(coalesce(m.itemcode,'')) itemcode,
        btrim(coalesce(m.commonname,'')) commonname,btrim(coalesce(m.contsize,'')) contsize,
        public.aura_inventory_v2_number_v1(case when v_metric='ptravailable' then m.ptravailable else m.ptronhand end) metric_value,
        public.aura_inventory_v2_number_v1(m.s_lts) open_value,public.aura_inventory_v2_salesyear_v1(m.saleyear) sales_year,
        (nullif(btrim(coalesce(m.itemcode,'')),'') is not null and nullif(btrim(coalesce(m.commonname,'')),'') is not null
          and nullif(public.aura_inventory_v2_size_v1(m.contsize),'') is not null) identity_valid
      from public.ph_master_inventory m where upper(btrim(coalesce(m.season,'')))=v_query_season
        and (nullif(btrim(coalesce(p_locationcode,'')),'') is null or upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(p_locationcode)))
        and (nullif(btrim(coalesce(p_contsize,'')),'') is null or public.aura_inventory_v2_size_v1(m.contsize)=public.aura_inventory_v2_size_v1(p_contsize))
        and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
        and position('SHFT' in upper(coalesce(m.desigitem,'')))=0
    ), scoped as (
      select * from candidates where sales_year<=v_sales_year and (not p_open_stock_only or open_value>0)
    ), grouped as (
      select item_key,public.aura_inventory_v2_size_v1(contsize) size_key,min(itemcode) itemcode,min(commonname) commonname,min(contsize) contsize,sum(metric_value) total
      from scoped group by item_key,public.aura_inventory_v2_size_v1(contsize)
    ), best as (select max(total) total from grouped), winners as (
      select g.* from grouped g cross join best b where g.total=b.total
    )
    select
      (select jsonb_build_object('itemcode',itemcode,'commonname',commonname,'contsize',contsize,'total',total) from winners order by item_key,size_key limit 1),
      (select count(*) from winners),
      not exists(select 1 from candidates where (sales_year is null or sales_year<=v_sales_year)
        and (not p_open_stock_only or open_value is null or open_value>0)
        and (sales_year is null or metric_value is null or not identity_valid or (p_open_stock_only and open_value is null)))
    into v_winner,v_tie_count,v_complete;
    if not v_complete then v_winner:=null;v_tie_count:=0;end if;
    return jsonb_build_object('ok',true,'winner',v_winner,'tieCount',v_tie_count,'complete',v_complete,'season',v_query_season,'activeSeason',v_season,'salesYear',v_sales_year,'metric',v_metric);
  end if;

  if v_operation='validate_draft' then
    if p_cursor is not null then raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID'; end if;
    if v_query_season<>v_season then
      return jsonb_build_object('ok',true,'complete',false,'valid',false,'rows','[]'::jsonb,
        'failures',jsonb_build_array(jsonb_build_object('unique_id',null,'error','active_season_changed')),'season',v_season,'salesYear',v_sales_year);
    end if;
    for v_line in select value from jsonb_array_elements(p_lines) loop
      if jsonb_typeof(v_line)<>'object' then
        v_failures:=v_failures||jsonb_build_array(jsonb_build_object('unique_id',null,'error','invalid_line'));
        continue;
      end if;
      v_uid:=nullif(btrim(coalesce(v_line->>'unique_id','')),'');
      v_item:=btrim(coalesce(v_line->>'itemcode',''));v_name:=btrim(coalesce(v_line->>'commonname',''));
      v_size:=btrim(coalesce(v_line->>'contsize',''));v_location:=btrim(coalesce(v_line->>'locationcode',''));v_lot:=btrim(coalesce(v_line->>'lotcode',''));
      v_qty:=public.aura_inventory_v2_number_v1(v_line->>'quantity');v_error:=null;
      if v_uid is null or v_item='' or v_name='' or v_size='' or v_qty is null or v_qty<=0 or v_qty>999999 or v_qty<>trunc(v_qty) then
        v_error:='invalid_line';
      elsif (select count(*) from jsonb_array_elements(p_lines) x where x->>'unique_id'=v_uid)>1 then v_error:='duplicate_uid';
      elsif (select count(*) from jsonb_array_elements(p_lines) x
        where upper(btrim(x->>'itemcode'))=upper(v_item)
        and public.aura_inventory_v2_size_v1(x->>'contsize')=public.aura_inventory_v2_size_v1(v_size))>1 then v_error:='duplicate_sku';
      else
        select * into v_row from public.ph_master_inventory m where m.unique_id=v_uid;
        if not found then v_error:='row_missing';
        else
          v_salesyear:=public.aura_inventory_v2_salesyear_v1(v_row.saleyear);
          v_available:=public.aura_inventory_v2_number_v1(v_row.ptravailable);v_open:=public.aura_inventory_v2_number_v1(v_row.s_lts);
          if upper(btrim(coalesce(v_row.season,'')))<>v_season or v_salesyear is null or v_salesyear>v_sales_year
            or v_available is null or v_open is null or v_open<=0 or v_qty>v_available
            or lower(btrim(coalesce(v_row.app_tab_assignment,''))) in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
            or position('SHFT' in upper(coalesce(v_row.desigitem,'')))>0
            or upper(btrim(coalesce(v_row.itemcode,'')))<>upper(v_item)
            or lower(btrim(coalesce(v_row.commonname,'')))<>lower(v_name)
            or public.aura_inventory_v2_size_v1(v_row.contsize)<>public.aura_inventory_v2_size_v1(v_size)
            or upper(btrim(coalesce(v_row.locationcode,'')))<>upper(v_location) or upper(btrim(coalesce(v_row.lotcode,'')))<>upper(v_lot) then
            v_error:='row_changed_or_out_of_scope';
          end if;
        end if;
      end if;
      if v_error is not null then
        v_failures:=v_failures||jsonb_build_array(jsonb_build_object('unique_id',v_uid,'error',v_error));
      else
        v_valid_rows:=v_valid_rows||jsonb_build_array(jsonb_build_object('unique_id',v_row.unique_id,'itemcode',v_row.itemcode,
          'commonname',v_row.commonname,'contsize',v_row.contsize,'locationcode',v_row.locationcode,'lotcode',v_row.lotcode,
          'ptravailable',v_row.ptravailable,'ptronhand',v_row.ptronhand,'s_lts',v_row.s_lts,'priority',v_row.priority,
          'season',v_row.season,'saleyear',v_row.saleyear,'quantity',v_qty));
      end if;
    end loop;
    v_complete:=jsonb_array_length(v_failures)=0;
    return jsonb_build_object('ok',true,'complete',v_complete,'valid',v_complete,
      'rows',case when v_complete then v_valid_rows else '[]'::jsonb end,'failures',v_failures,'season',v_season,'salesYear',v_sales_year);
  end if;

  if v_operation='count' then
    if p_cursor is not null and (not (p_cursor ? 'unique_id') or (p_cursor-'unique_id')<>'{}'::jsonb) then
      raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID';
    end if;
    with candidates as (
      select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.ptravailable,m.ptronhand,
        m.s_lts,m.priority,m.season,m.saleyear,public.aura_inventory_v2_salesyear_v1(m.saleyear) sales_year,
        public.aura_inventory_v2_number_v1(case when v_metric='ptravailable' then m.ptravailable else m.ptronhand end) metric_value,
        public.aura_inventory_v2_number_v1(m.s_lts) open_value
      from public.ph_master_inventory m where upper(btrim(coalesce(m.season,'')))=v_query_season
        and upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(p_itemcode))
        and (nullif(btrim(coalesce(p_contsize,'')),'') is null or public.aura_inventory_v2_size_v1(m.contsize)=public.aura_inventory_v2_size_v1(p_contsize))
        and (nullif(btrim(coalesce(p_locationcode,'')),'') is null or upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(p_locationcode)))
        and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
        and position('SHFT' in upper(coalesce(m.desigitem,'')))=0
    ), scoped as (select * from candidates where sales_year<=v_sales_year and (not p_open_stock_only or open_value>0)),
    total_row as (select sum(metric_value) total,not exists(select 1 from scoped where metric_value is null)
      and not exists(select 1 from candidates where (sales_year is null or sales_year<=v_sales_year)
        and (not p_open_stock_only or open_value is null or open_value>0)
        and (sales_year is null or (p_open_stock_only and open_value is null))) complete from scoped),
    page as (select * from scoped where p_cursor is null or unique_id>coalesce(p_cursor->>'unique_id','') order by unique_id limit v_limit+1),
    numbered as (select page.*,row_number() over(order by unique_id) ordinal from page)
    select t.total,t.complete,coalesce((select count(*)>v_limit from numbered),false),
      coalesce((select jsonb_agg(jsonb_build_object('unique_id',unique_id,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
        'locationcode',locationcode,'lotcode',lotcode,'ptravailable',ptravailable,'ptronhand',ptronhand,'s_lts',s_lts,
        'priority',priority,'season',season,'saleyear',saleyear) order by unique_id) filter(where ordinal<=v_limit) from numbered),'[]'::jsonb),
      (select jsonb_build_object('unique_id',unique_id) from numbered where ordinal=v_limit)
    into v_total,v_complete,v_more,v_rows,v_cursor from total_row t;
    return jsonb_build_object('ok',true,'total',case when v_complete then coalesce(v_total,0) else null end,'complete',v_complete,
      'rows',v_rows,'hasMore',v_more,'nextCursor',case when v_more then v_cursor else null end,'season',v_query_season,'activeSeason',v_season,'salesYear',v_sales_year,'metric',v_metric);
  end if;

  if v_operation='lots' then
    if p_cursor is not null and (not (p_cursor ? 'unique_id' and p_cursor ? 'priority') or (p_cursor-'unique_id'-'priority')<>'{}'::jsonb) then
      raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID';
    end if;
    if p_cursor is not null then
      if not (p_cursor ? 'unique_id') then raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID'; end if;
      v_cursor_uid:=coalesce(p_cursor->>'unique_id','');v_cursor_priority_null:=coalesce(p_cursor->'priority','null'::jsonb)='null'::jsonb;
      if not v_cursor_priority_null then
        begin v_cursor_priority:=(p_cursor->>'priority')::numeric;exception when others then raise exception using errcode='22023',message='AURA_V2_CURSOR_INVALID';end;
      end if;
    end if;
    with candidates as (
      select m.unique_id,m.itemcode,m.commonname,m.contsize,m.locationcode,m.lotcode,m.ptravailable,m.ptronhand,
        m.s_lts,m.priority,m.season,m.saleyear,public.aura_inventory_v2_salesyear_v1(m.saleyear) sales_year,
        public.aura_inventory_v2_number_v1(m.ptravailable) available_value,public.aura_inventory_v2_number_v1(m.s_lts) open_value,
        public.aura_inventory_v2_number_v1(m.priority) priority_value
      from public.ph_master_inventory m where upper(btrim(coalesce(m.season,'')))=v_query_season
        and upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(p_itemcode))
        and (nullif(btrim(coalesce(p_contsize,'')),'') is null or public.aura_inventory_v2_size_v1(m.contsize)=public.aura_inventory_v2_size_v1(p_contsize))
        and (nullif(btrim(coalesce(p_locationcode,'')),'') is null or upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(p_locationcode)))
        and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
        and position('SHFT' in upper(coalesce(m.desigitem,'')))=0
    ), scoped as (select * from candidates where sales_year<=v_sales_year and available_value>=p_quantity and (not p_open_stock_only or open_value>0)),
    page as (select * from scoped where p_cursor is null
      or (not v_cursor_priority_null and (priority_value>v_cursor_priority or (priority_value=v_cursor_priority and unique_id>v_cursor_uid) or priority_value is null))
      or (v_cursor_priority_null and priority_value is null and unique_id>v_cursor_uid)
      order by priority_value nulls last,unique_id limit v_limit+1),
    numbered as (select page.*,row_number() over(order by priority_value nulls last,unique_id) ordinal from page)
    select coalesce((select count(*)>v_limit from numbered),false),
      coalesce((select jsonb_agg(jsonb_build_object('unique_id',unique_id,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
        'locationcode',locationcode,'lotcode',lotcode,'ptravailable',ptravailable,'ptronhand',ptronhand,'s_lts',s_lts,
        'priority',priority,'season',season,'saleyear',saleyear)
        order by priority_value nulls last,unique_id) filter(where ordinal<=v_limit) from numbered),'[]'::jsonb),
      (select jsonb_build_object('unique_id',unique_id,'priority',priority_value) from numbered where ordinal=v_limit),
      not exists(select 1 from candidates where (sales_year is null or sales_year<=v_sales_year)
        and (not p_open_stock_only or open_value is null or open_value>0)
        and (sales_year is null or available_value is null or (p_open_stock_only and open_value is null)))
    into v_more,v_rows,v_cursor,v_complete;
    return jsonb_build_object('ok',true,'rows',v_rows,'complete',v_complete,'hasMore',v_more,'nextCursor',case when v_more then v_cursor else null end,
      'season',v_season,'activeSeason',v_season,'salesYear',v_sales_year,'metric','ptravailable','requestedQuantity',p_quantity);
  end if;
  return jsonb_build_object('ok',false,'code','AURA_V2_UNSUPPORTED');
end;
$$;

revoke all on function public.aura_inventory_v2_number_v1(text) from public,anon,authenticated;
revoke all on function public.aura_inventory_v2_salesyear_v1(text) from public,anon,authenticated;
revoke all on function public.aura_inventory_v2_size_v1(text) from public,anon,authenticated;
revoke all on function public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb) from public,anon,authenticated;
grant execute on function public.aura_inventory_v2_number_v1(text) to service_role;
grant execute on function public.aura_inventory_v2_salesyear_v1(text) to service_role;
grant execute on function public.aura_inventory_v2_size_v1(text) to service_role;
grant execute on function public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb) to service_role;

commit;
