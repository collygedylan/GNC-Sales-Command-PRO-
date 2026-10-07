begin;
set local lock_timeout = '5s';

create or replace function public.aura_manager_season_settings_v1(
  p_actor_id uuid,
  p_operation text,
  p_expected_revision bigint default null,
  p_season_code text default null,
  p_sales_year integer default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s'
as $$
declare
  actor public.profiles;
  current_value jsonb;
  current_revision bigint;
  next_revision bigint;
  season_code text;
  sales_year integer;
  updated_at timestamptz;
  settings_found boolean := false;
begin
  select * into actor from public.profiles p
  where p.id = p_actor_id and p.disabled_at is null and not p.must_change_password
    and (p.locked_until is null or p.locked_until <= clock_timestamp());
  if actor.id is null or actor.username not in ('dylan_collyge','jd_jones','megan_kelly')
    or not private.app_account_active_at_v1(p_actor_id, actor.username, clock_timestamp()) then
    raise exception using errcode='42501', message='AURA_MANAGER_SETTINGS_FORBIDDEN';
  end if;
  if p_operation is null or p_operation not in ('read','save') then
    raise exception using errcode='22023', message='AURA_MANAGER_SETTINGS_OPERATION_INVALID';
  end if;

  if p_operation = 'save' then
    if p_expected_revision is null or p_expected_revision < 0
      or upper(btrim(coalesce(p_season_code,''))) not in ('S1','F1')
      or p_sales_year is null or p_sales_year not between 1 and 99 then
      raise exception using errcode='22023', message='AURA_MANAGER_SETTINGS_INPUT_INVALID';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('ph_app_settings:current_season_salesyear', 0));
  end if;

  if p_operation='save' then
    select coalesce(s.value, '{}'::jsonb) into current_value
    from public.ph_app_settings s where s.key='current_season_salesyear' for update;
  else
    select coalesce(s.value, '{}'::jsonb) into current_value
    from public.ph_app_settings s where s.key='current_season_salesyear';
  end if;
  settings_found := found;
  if not settings_found and p_operation='read' then
    raise exception using errcode='22023', message='AURA_SEASON_SETTINGS_UNAVAILABLE';
  end if;
  current_value := coalesce(current_value, '{}'::jsonb);
  if nullif(current_value->>'revision','') is not null
    and (coalesce(current_value->>'revision','') !~ '^[0-9]{1,16}$'
      or (current_value->>'revision')::numeric > 9007199254740991) then
    raise exception using errcode='22023', message='AURA_MANAGER_SETTINGS_REVISION_INVALID';
  end if;
  current_revision := coalesce(nullif(current_value->>'revision','')::bigint,0);

  if p_operation = 'save' then
    if current_revision <> p_expected_revision then
      raise exception using errcode='40001', message='AURA_MANAGER_SETTINGS_CONFLICT';
    end if;
    if current_revision >= 9007199254740991 then
      raise exception using errcode='22023', message='AURA_MANAGER_SETTINGS_REVISION_INVALID';
    end if;
    next_revision := current_revision + 1;
    updated_at := clock_timestamp();
    current_value := current_value || jsonb_build_object(
      'seasonCode', upper(btrim(p_season_code)), 'salesYear', p_sales_year,
      'revision', next_revision, 'updatedAt', updated_at, 'updatedBy', actor.username
    );
    insert into public.ph_app_settings(key,value,updated_by,updated_at)
    values ('current_season_salesyear', current_value, actor.username, updated_at)
    on conflict (key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  else
    next_revision := current_revision;
    updated_at := coalesce(private.try_timestamptz(current_value->>'updatedAt'),
      (select s.updated_at from public.ph_app_settings s where s.key='current_season_salesyear'));
  end if;

  season_code := upper(btrim(coalesce(current_value->>'seasonCode','')));
  sales_year := public.aura_query_salesyear_v1(current_value->>'salesYear');
  if season_code is null or season_code not in ('S1','F1') or sales_year is null then
    raise exception using errcode='22023', message='AURA_SEASON_SETTINGS_UNAVAILABLE';
  end if;
  return jsonb_build_object('seasonCode',season_code,'salesYear',sales_year,'revision',next_revision,
    'updatedAt',updated_at,'updatedBy',coalesce(current_value->>'updatedBy',current_value->>'updated_by',''));
end;
$$;
revoke all on function public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer) to service_role;

create or replace function public.aura_resolve_season_v1(p_actor_id uuid, p_reference text default 'current')
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $$
declare
  actor public.profiles;
  settings jsonb;
  season_code text;
  sales_year integer;
  reference text := lower(btrim(coalesce(p_reference,'current')));
  revision bigint;
  next_season text;
  next_year integer;
begin
  select * into actor from public.profiles p where p.id=p_actor_id and p.username='dylan_collyge'
    and p.disabled_at is null and not p.must_change_password and (p.locked_until is null or p.locked_until<=clock_timestamp());
  if actor.id is null or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN';
  end if;
  if reference not in ('current','next') then raise exception using errcode='22023',message='AURA_SEASON_REFERENCE_INVALID'; end if;
  select coalesce(s.value,'{}'::jsonb) into settings from public.ph_app_settings s where s.key='current_season_salesyear';
  settings:=coalesce(settings,'{}'::jsonb);
  season_code:=upper(btrim(coalesce(settings->>'seasonCode','')));
  sales_year:=public.aura_query_salesyear_v1(settings->>'salesYear');
  if season_code is null or season_code not in ('S1','F1') or sales_year is null then raise exception using errcode='22023',message='AURA_SEASON_SETTINGS_UNAVAILABLE'; end if;
  if nullif(settings->>'revision','') is not null
    and (coalesce(settings->>'revision','') !~ '^[0-9]{1,16}$'
      or (settings->>'revision')::numeric > 9007199254740991) then
    raise exception using errcode='22023',message='AURA_MANAGER_SETTINGS_REVISION_INVALID';
  end if;
  revision:=coalesce(nullif(settings->>'revision','')::bigint,0);
  if season_code='F1' then next_season:='S1'; next_year:=sales_year;
  else next_season:='F1'; next_year:=sales_year+1; end if;
  if reference='next' and next_year>99 then raise exception using errcode='22023',message='AURA_NEXT_SEASON_UNAVAILABLE'; end if;
  if reference='next' then season_code:=next_season; sales_year:=next_year; end if;
  return jsonb_build_object('seasonCode',season_code,'salesYear',sales_year,'currentSeason',season_code,
    'currentSalesYear',public.aura_query_salesyear_v1(settings->>'salesYear'),
    'seasonReference',reference,'revision',revision,'updatedAt',settings->>'updatedAt','updatedBy',settings->>'updatedBy');
end;
$$;
revoke all on function public.aura_resolve_season_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.aura_resolve_season_v1(uuid,text) to service_role;

create or replace function public.aura_query_seasonal_records_v1(
  p_actor_id uuid, p_capability text, p_filters jsonb default '{}'::jsonb,
  p_cursor jsonb default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '8s'
as $$
declare
  actor public.profiles;
  f jsonb:=coalesce(p_filters,'{}'::jsonb);
  capability text:=lower(btrim(coalesce(p_capability,'')));
  app_module text;
  current_settings jsonb;
  current_season text;
  current_year integer;
  setting_revision bigint;
  query_season text;
  target_year integer;
  reference text:=lower(btrim(coalesce(p_filters->>'seasonReference','current')));
  lim integer:=greatest(1,least(100,coalesce(p_limit,50)));
  page_offset integer:=0;
  product text:=nullif(lower(btrim(coalesce(p_filters->>'productText',''))),'');
  item_code text:=nullif(upper(btrim(coalesce(p_filters->>'itemcode',''))),'');
  location_code text:=nullif(upper(btrim(coalesce(p_filters->>'locationCode',''))),'');
  location_mode text:=lower(coalesce(p_filters->>'locationMode','exact'));
  lot_code text:=nullif(upper(btrim(coalesce(p_filters->>'lotcode',''))),'');
  status_filter text:=nullif(lower(btrim(coalesce(p_filters->>'status',''))),'');
  year_filter integer;
  exact_year boolean:=false;
  rows_json jsonb:='[]'::jsonb;
  total_count bigint:=0;
  unresolved_count bigint:=0;
  has_more boolean:=false;
  next_cursor jsonb:=null;
  actor_key text;
  rep_scoped boolean;
begin
  select * into actor from public.profiles p where p.id=p_actor_id and p.username='dylan_collyge'
    and p.disabled_at is null and not p.must_change_password and (p.locked_until is null or p.locked_until<=clock_timestamp());
  if actor.id is null or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN';
  end if;
  if jsonb_typeof(f)<>'object' or capability not in ('request_queue','active_request','request_history','sales_orders','soc_orders','reserves','av','credits','credit_requests')
    or exists(select 1 from jsonb_object_keys(f) k where k not in ('productText','itemcode','locationCode','locationMode','lotcode','status','season','salesYear','seasonReference')) then
    raise exception using errcode='22023',message='AURA_SEASONAL_FILTER_INVALID';
  end if;
  if location_mode not in ('exact','prefix','contains') then raise exception using errcode='22023',message='AURA_SEASONAL_FILTER_INVALID'; end if;
  if (capability='av' and (location_code is not null or lot_code is not null or status_filter is not null))
    or (capability='reserves' and status_filter is not null) then
    raise exception using errcode='22023',message='AURA_SEASONAL_FILTER_UNSUPPORTED';
  end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or p_cursor-'offset'<>'{}'::jsonb or coalesce(p_cursor->>'offset','') !~ '^[0-9]{1,8}$' then
      raise exception using errcode='22023',message='AURA_SEASONAL_CURSOR_INVALID';
    end if;
    page_offset:=least(1000000,(p_cursor->>'offset')::integer);
  end if;

  app_module:=case capability when 'request_queue' then 'request' when 'active_request' then 'request'
    when 'request_history' then 'request-history' when 'sales_orders' then 'sales-office'
    when 'soc_orders' then 'docks' when 'reserves' then 'reserves' when 'av' then 'av'
    when 'credits' then 'sales-credit' when 'credit_requests' then 'credit-request' end;
  if public.navigation_module_allowed_v1(p_actor_id,app_module) is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN';
  end if;

  select s.value into current_settings from public.ph_app_settings s where s.key='current_season_salesyear';
  current_settings:=coalesce(current_settings,'{}'::jsonb);
  current_season:=upper(current_settings->>'seasonCode');
  current_year:=public.aura_query_salesyear_v1(current_settings->>'salesYear');
  if nullif(current_settings->>'revision','') is not null
    and (coalesce(current_settings->>'revision','') !~ '^[0-9]{1,16}$' or (current_settings->>'revision')::numeric > 9007199254740991) then
    raise exception using errcode='22023',message='AURA_MANAGER_SETTINGS_REVISION_INVALID';
  end if;
  setting_revision:=coalesce(nullif(current_settings->>'revision','')::bigint,0);
  if current_season is null or current_season not in ('S1','F1') or current_year is null then raise exception using errcode='22023',message='AURA_SEASON_SETTINGS_UNAVAILABLE'; end if;
  query_season:=coalesce(upper(nullif(btrim(f->>'season'),'')),case when reference='next' then case when current_season='F1' then 'S1' else 'F1' end else current_season end);
  if reference not in ('current','next') or query_season not in ('S1','F1','U1','U2','U3','X','Y','Z') then raise exception using errcode='22023',message='AURA_SEASON_INVALID'; end if;
  target_year:=current_year;
  if reference='next' then
    target_year:=case when current_season='F1' then current_year else current_year+1 end;
    if target_year>99 then raise exception using errcode='22023',message='AURA_NEXT_SEASON_UNAVAILABLE'; end if;
  end if;
  if f ? 'salesYear' then
    year_filter:=public.aura_query_salesyear_v1(f->>'salesYear');
    if year_filter is null then raise exception using errcode='22023',message='AURA_SEASON_YEAR_INVALID'; end if;
    exact_year:=true;
  end if;
  if exact_year and year_filter>current_year and not (reference='next' and year_filter=target_year) then
    raise exception using errcode='22023',message='AURA_SEASON_YEAR_INVALID';
  end if;
  if capability in ('request_history','soc_orders','reserves','av','credits','credit_requests') and exact_year then
    raise exception using errcode='22023',message='AURA_SEASON_YEAR_UNAVAILABLE';
  end if;
  if not exact_year then year_filter:=target_year; end if;

  actor_key:=lower(btrim(actor.username));
  rep_scoped:=sales_private.is_rep(actor.role) or actor.username in ('ben_brown','chance_alldredge');

  if capability in ('request_queue','active_request') then
    with source as materialized (
      select q.unique_id,q.master_id,q.itemcode,q.commonname,q.contsize,q.locationcode,q.lotcode,q.requested_by,
        q.request_folder,q.req_customer,q.req_qty,q.req_status,q.created_at,q.updated_at,q.date_completed,
        m.season source_season,public.aura_query_salesyear_v1(m.saleyear) source_year,
        jsonb_build_object('unique_id',q.unique_id,'itemcode',q.itemcode,'commonname',q.commonname,'contsize',q.contsize,
          'locationcode',q.locationcode,'lotcode',q.lotcode,'requested_by',q.requested_by,'request_folder',q.request_folder,
          'req_customer',q.req_customer,'req_qty',q.req_qty,'req_status',q.req_status,'created_at',q.created_at,'updated_at',q.updated_at,
          'season',m.season,'salesYear',public.aura_query_salesyear_v1(m.saleyear)) row
      from public.ph_active_request q left join public.ph_master_inventory m on m.unique_id=q.master_id
      where (actor.username not in ('ben_brown','chance_alldredge') or
        lower(regexp_replace(split_part(coalesce(q.request_created_by_username,''),'@',1),'[^a-z0-9]+','','g'))=regexp_replace(actor_key,'[^a-z0-9]+','','g') or
        lower(regexp_replace(split_part(coalesce(q.request_selected_rep_username,''),'@',1),'[^a-z0-9]+','','g'))=regexp_replace(actor_key,'[^a-z0-9]+','','g') or
        lower(regexp_replace(split_part(coalesce(q.requested_by,''),'@',1),'[^a-z0-9]+','','g'))=regexp_replace(actor_key,'[^a-z0-9]+','','g'))
        and (capability<>'request_queue' or nullif(btrim(coalesce(q.date_completed,'')),'') is null
          or exists(select 1 from public.ph_request_delivery_status d where d.request_id=q.unique_id
            and d.event_type='request_completed' and d.delivery_status in ('pending','processing','failed')))
    ), filtered as materialized (
      select s.* from source s where
        (nullif(btrim(s.source_season),'') is null or upper(btrim(s.source_season)) not in ('S1','F1','U1','U2','U3','X','Y','Z')
          or (upper(btrim(s.source_season))=query_season and (s.source_year is null or s.source_year<=year_filter)
            and (not exact_year or s.source_year=year_filter or s.source_year is null)))
        and (item_code is null or upper(coalesce(s.itemcode,''))=item_code)
        and (location_code is null or case when location_mode='prefix' then upper(coalesce(s.locationcode,'')) like location_code||'%' when location_mode='contains' then upper(coalesce(s.locationcode,'')) like '%'||location_code||'%' else upper(coalesce(s.locationcode,''))=location_code end)
        and (lot_code is null or upper(coalesce(s.lotcode,''))=lot_code)
        and (status_filter is null or lower(coalesce(s.req_status,''))=status_filter)
        and (product is null or position(product in lower(concat_ws(' ',s.itemcode,s.commonname,s.request_folder,s.req_customer,s.requested_by)))>0)
    )
    select count(*) filter(where upper(btrim(source_season))=query_season and source_year is not null and source_year<=year_filter and (not exact_year or source_year=year_filter)),
      count(*) filter(where nullif(btrim(source_season),'') is null or upper(btrim(source_season)) not in ('S1','F1','U1','U2','U3','X','Y','Z') or source_year is null),
      coalesce((select jsonb_agg(x.row order by x.updated_at desc,x.unique_id desc) from (select row,updated_at,unique_id from filtered where upper(btrim(source_season))=query_season and source_year is not null and source_year<=year_filter and (not exact_year or source_year=year_filter) order by updated_at desc,unique_id desc offset page_offset limit lim+1) x),'[]'::jsonb)
      into total_count,unresolved_count,rows_json from filtered;
  elsif capability='request_history' then
    with source as materialized (
      select jsonb_build_object('id',h.id,'unique_id',h.unique_id,'itemcode',h.itemcode,'commonname',h.commonname,'contsize',h.contsize,
        'locationcode',h.locationcode,'lotcode',h.lotcode,'requested_by',h.requested_by,'request_folder',h.request_folder,
        'req_qty',h.req_qty,'req_status',h.req_status,'created_at',h.created_at,'date_completed',h.date_completed,
        'season',coalesce(h.season,h.snapshot->>'season')) row,h.assigned_rep_id rep,
        nullif(upper(btrim(coalesce(nullif(h.season,''),h.snapshot->>'season'))),'') source_season,
        coalesce(h.updated_at,h.created_at) sort_at
      from public.ph_request_history h
    ), authorized as materialized (
      select * from source s where (not rep_scoped or s.rep=p_actor_id or sales_private.key(s.row->>'request_created_by_username')=sales_private.key(actor.username))
        and sales_private.can_read_source(p_actor_id,s.rep)
    ), filtered as materialized (
      select * from authorized s where
        (s.source_season is null or s.source_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or s.source_season=query_season)
        and (item_code is null or upper(coalesce(s.row->>'itemcode',''))=item_code)
        and (location_code is null or case when location_mode='prefix' then upper(coalesce(s.row->>'locationcode','')) like location_code||'%' when location_mode='contains' then upper(coalesce(s.row->>'locationcode','')) like '%'||location_code||'%' else upper(coalesce(s.row->>'locationcode',''))=location_code end)
        and (lot_code is null or upper(coalesce(s.row->>'lotcode',''))=lot_code)
        and (status_filter is null or lower(coalesce(s.row->>'req_status',''))=status_filter)
        and (product is null or position(product in lower(concat_ws(' ',s.row->>'itemcode',s.row->>'commonname',s.row->>'request_folder',s.row->>'req_customer',s.row->>'requested_by')))>0)
    )
    select count(*) filter(where source_season=query_season),count(*) filter(where source_season is null or source_season not in ('S1','F1','U1','U2','U3','X','Y','Z')),
      coalesce((select jsonb_agg(x.row order by x.sort_at desc,x.row->>'unique_id' desc) from (select row,sort_at from filtered where source_season is not null and upper(btrim(source_season))=query_season order by sort_at desc,row->>'unique_id' desc offset page_offset limit lim+1) x),'[]'::jsonb)
      into total_count,unresolved_count,rows_json from filtered;
  elsif capability='sales_orders' then
    with source as materialized (
      select s.unique_id,s.itemcode,s.commonname,s.contsize,s.locationcode,s.lotcode,s.order_folder,s.order_number,s.order_customer,s.order_qty,
        s.order_status,s.workflow_status,s.updated_at,s.master_id,s.so_source,
        case when lower(btrim(coalesce(s.so_source,'season'))) not in ('bloom_picker','bloom-picker','move','moves') then st.season_code else mi.season end source_season,
        case when lower(btrim(coalesce(s.so_source,'season'))) not in ('bloom_picker','bloom-picker','move','moves') then st.sales_year else public.aura_query_salesyear_v1(mi.saleyear) end source_year,
        jsonb_build_object('unique_id',s.unique_id,'itemcode',s.itemcode,'commonname',s.commonname,'contsize',s.contsize,'locationcode',s.locationcode,
          'lotcode',s.lotcode,'order_folder',s.order_folder,'order_number',s.order_number,'order_customer',s.order_customer,'order_qty',s.order_qty,
          'order_status',s.order_status,'workflow_status',s.workflow_status,'updated_at',s.updated_at,
          'season',case when lower(btrim(coalesce(s.so_source,'season'))) not in ('bloom_picker','bloom-picker','move','moves') then st.season_code else mi.season end,
          'salesYear',case when lower(btrim(coalesce(s.so_source,'season'))) not in ('bloom_picker','bloom-picker','move','moves') then st.sales_year else public.aura_query_salesyear_v1(mi.saleyear) end) row
      from public.ph_sales_office s left join lateral (
        select state.id,state.season_code,state.sales_year,state.updated_at from public.ph_season_sales_office_state state
        where state.winner_unique_id=coalesce(nullif(s.master_id,''),s.unique_id) and state.status in ('open','done','retired')
          and lower(btrim(coalesce(s.so_source,'season'))) not in ('bloom_picker','bloom-picker','move','moves')
        order by state.updated_at desc,state.id desc limit 1
      ) st on true left join public.ph_master_inventory mi on mi.unique_id=nullif(s.master_id,'')
    ), filtered as materialized (
      select * from source s where (s.source_season is null or upper(btrim(s.source_season)) not in ('S1','F1','U1','U2','U3','X','Y','Z')
          or (upper(btrim(s.source_season))=query_season
          and (s.source_year is null or s.source_year<=year_filter) and (not exact_year or s.source_year=year_filter or s.source_year is null)))
        and (item_code is null or upper(coalesce(s.itemcode,''))=item_code)
        and (location_code is null or case when location_mode='prefix' then upper(coalesce(s.locationcode,'')) like location_code||'%' when location_mode='contains' then upper(coalesce(s.locationcode,'')) like '%'||location_code||'%' else upper(coalesce(s.locationcode,''))=location_code end)
        and (lot_code is null or upper(coalesce(s.lotcode,''))=lot_code)
        and (status_filter is null or lower(coalesce(s.order_status,''))=status_filter or lower(coalesce(s.workflow_status,''))=status_filter)
        and (product is null or position(product in lower(concat_ws(' ',s.itemcode,s.commonname,s.order_folder,s.order_number,s.order_customer)))>0)
    )
    select count(*) filter(where source_season is not null and upper(btrim(source_season))=query_season
        and source_year is not null and source_year<=year_filter and (not exact_year or source_year=year_filter)),
      count(*) filter(where source_season is null or upper(btrim(source_season)) not in ('S1','F1','U1','U2','U3','X','Y','Z')
        or (upper(btrim(source_season))=query_season and source_year is null)),
      coalesce((select jsonb_agg(x.row order by x.updated_at desc,x.unique_id desc) from (select row,updated_at,unique_id from filtered where source_season is not null and upper(btrim(source_season))=query_season
        and source_year is not null and source_year<=year_filter and (not exact_year or source_year=year_filter) order by updated_at desc,unique_id desc offset page_offset limit lim+1) x),'[]'::jsonb)
      into total_count,unresolved_count,rows_json from filtered;
  else
    -- Remaining seasonal readers carry an authoritative season code but no salesyear.
    -- They can be scoped to the configured season code, but a caller must not supply a year.
    if capability in ('soc_orders','reserves','av') then
      if capability='soc_orders' then
        with source as materialized (
          select jsonb_build_object('unique_id',s.unique_id,'itemcode',s.itemcode,'commonname',s.commonname,'contsize',s.contsize,
            'locationcode',s.locationcode,'lotcode',s.lotcode,'season',s.season,'warehouseid',s.warehouseid,'warehousename',s.warehousename,
            'tripnumber',s.tripnumber,'stopnumber',s.stopnumber,'dock_num',s.dock_num,'assignedto',s.assignedto,'salesrepname',s.salesrepname,
            'customername',s.customername,'consigneename',s.consigneename,'quantityordered',s.quantityordered,'quantityshipped',s.quantityshipped,
            'requestdate',s.requestdate,'stagename',s.stagename,'last_updated',s.last_updated) row,
            s.unique_id,s.last_updated sort_at,nullif(upper(btrim(coalesce(s.season,''))),'') source_season from public.ph_soc_master s
        ), filtered as materialized (
          select * from source s where (s.source_season is null or s.source_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or s.source_season=query_season)
            and (item_code is null or upper(coalesce(s.row->>'itemcode',''))=item_code)
            and (location_code is null or case when location_mode='prefix' then upper(coalesce(s.row->>'locationcode','')) like location_code||'%' when location_mode='contains' then upper(coalesce(s.row->>'locationcode','')) like '%'||location_code||'%' else upper(coalesce(s.row->>'locationcode',''))=location_code end)
            and (lot_code is null or upper(coalesce(s.row->>'lotcode',''))=lot_code)
            and (status_filter is null or lower(coalesce(s.row->>'stagename',''))=status_filter)
            and (product is null or position(product in lower(concat_ws(' ',s.row->>'itemcode',s.row->>'commonname',s.row->>'tripnumber',s.row->>'customername')))>0)
        )
        select count(*) filter(where source_season=query_season),count(*) filter(where source_season is null or source_season not in ('S1','F1','U1','U2','U3','X','Y','Z')),
          coalesce((select jsonb_agg(x.row order by x.sort_at desc,x.unique_id desc) from (select row,sort_at,unique_id from filtered where source_season=query_season order by sort_at desc,unique_id desc offset page_offset limit lim+1) x),'[]'::jsonb)
          into total_count,unresolved_count,rows_json from filtered;
      elsif capability='reserves' then
        with source as materialized (
          select jsonb_build_object('unique_id',s.unique_id,'itemcode',s.itemcode,'commonname',s.commonname,'contsize',s.contsize,
            'locationcode',s.locationcode,'lotcode',s.lotcode,'season',s.season,'warehouseid',s.warehouseid,'warehousename',s.warehousename,
            'assignedto',s.assignedto,'assigned_to',s.assigned_to,'customername',s.customername,'consigneename',s.consigneename,
            'salesrepname',s.salesrepname,'quantityordered',s.quantityordered,'quantityshipped',s.quantityshipped,
            'date_completed',s.date_completed,'last_updated',s.last_updated) row,
            s.unique_id,s.last_updated sort_at,nullif(upper(btrim(coalesce(s.season,''))),'') source_season from public.ph_reserves s
          where not rep_scoped or sales_private.can_read_source(p_actor_id,sales_private.assigned_rep(to_jsonb(s)))
        ), filtered as materialized (
          select * from source s where (s.source_season is null or s.source_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or s.source_season=query_season)
            and (item_code is null or upper(coalesce(s.row->>'itemcode',''))=item_code)
            and (location_code is null or case when location_mode='prefix' then upper(coalesce(s.row->>'locationcode','')) like location_code||'%' when location_mode='contains' then upper(coalesce(s.row->>'locationcode','')) like '%'||location_code||'%' else upper(coalesce(s.row->>'locationcode',''))=location_code end)
            and (lot_code is null or upper(coalesce(s.row->>'lotcode',''))=lot_code)
            and (product is null or position(product in lower(concat_ws(' ',s.row->>'itemcode',s.row->>'commonname',s.row->>'customername',s.row->>'consigneename')))>0)
        )
        select count(*) filter(where source_season=query_season),count(*) filter(where source_season is null or source_season not in ('S1','F1','U1','U2','U3','X','Y','Z')),
          coalesce((select jsonb_agg(x.row order by x.sort_at desc,x.unique_id desc) from (select row,sort_at,unique_id from filtered where source_season=query_season order by sort_at desc,unique_id desc offset page_offset limit lim+1) x),'[]'::jsonb)
          into total_count,unresolved_count,rows_json from filtered;
      else
        with source as materialized (
          select jsonb_build_object('unique_id',s.unique_id,'itemcode',s.itemcode,'commonname',s.commonname,'contsize',s.contsize,
            'season',s.season,'ptravailable',s.ptravailable,'available',s.available,'reserved_qty',s.reserved_qty,'order_qty',s.order_qty,
            'hold_reason',s.hold_reason,'holdstopreason',s.holdstopreason,'unit_price',s.unit_price,'last_updated',s.last_updated) row,
            s.unique_id,s.last_updated sort_at,nullif(upper(btrim(coalesce(s.season,''))),'') source_season from public.ph_cav_import s
        ), filtered as materialized (
          select * from source s where (s.source_season is null or s.source_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or s.source_season=query_season)
            and (item_code is null or upper(coalesce(s.row->>'itemcode',''))=item_code)
            and (product is null or position(product in lower(concat_ws(' ',s.row->>'itemcode',s.row->>'commonname',s.row->>'product_description')))>0)
        )
        select count(*) filter(where source_season=query_season),count(*) filter(where source_season is null or source_season not in ('S1','F1','U1','U2','U3','X','Y','Z')),
          coalesce((select jsonb_agg(x.row order by x.sort_at desc,x.unique_id desc) from (select row,sort_at,unique_id from filtered where source_season=query_season order by sort_at desc,unique_id desc offset page_offset limit lim+1) x),'[]'::jsonb)
          into total_count,unresolved_count,rows_json from filtered;
      end if;
    else
      with source as materialized (
        select jsonb_build_object('unique_id',c.unique_id,'request_folder',c.request_folder,'itemcode',c.itemcode,'commonname',c.commonname,
          'contsize',c.contsize,'locationcode',c.locationcode,'lotcode',c.lotcode,'customername',c.customername,'consigneename',c.consigneename,
          'credit_qty',c.credit_qty,'credit_status',c.credit_status,'credit_reason',c.credit_reason,'credit_note',c.credit_note,
          'submitted_by_username',c.submitted_by_username,'submitted_at',c.submitted_at,'reviewed_at',c.reviewed_at,'revision',c.revision,
          'season',coalesce(cs.snapshot->>'season',cs.snapshot->>'seasonCode',cs.snapshot->>'season_code',
            c.snapshot->>'season',c.snapshot->>'seasonCode',c.snapshot->>'season_code')) row,
          c.unique_id,c.submitted_at sort_at,cs.snapshot,
          nullif(upper(btrim(coalesce(cs.snapshot->>'season',cs.snapshot->>'seasonCode',cs.snapshot->>'season_code',
            c.snapshot->>'season',c.snapshot->>'seasonCode',c.snapshot->>'season_code',''))),'') source_season
        from public.ph_sales_credit_requests c left join public.ph_credit_sources cs on cs.id=c.source_id
        where sales_private.can_read_line(p_actor_id,c)
          and (cs.id is null or sales_private.can_read_source(p_actor_id,cs.assigned_rep_id))
      ), filtered as materialized (
        select * from source s where (s.source_season is null or s.source_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or s.source_season=query_season)
          and (item_code is null or upper(coalesce(s.row->>'itemcode',''))=item_code)
          and (location_code is null or case when location_mode='prefix' then upper(coalesce(s.row->>'locationcode','')) like location_code||'%' when location_mode='contains' then upper(coalesce(s.row->>'locationcode','')) like '%'||location_code||'%' else upper(coalesce(s.row->>'locationcode',''))=location_code end)
          and (lot_code is null or upper(coalesce(s.row->>'lotcode',''))=lot_code)
          and (status_filter is null or lower(coalesce(s.row->>'credit_status',''))=status_filter)
          and (product is null or position(product in lower(concat_ws(' ',s.row->>'itemcode',s.row->>'commonname',s.row->>'customername',s.row->>'consigneename')))>0)
      )
      select count(*) filter(where source_season=query_season),count(*) filter(where source_season is null or source_season not in ('S1','F1','U1','U2','U3','X','Y','Z')),
        coalesce((select jsonb_agg(x.row order by x.sort_at desc,x.unique_id desc) from (select row,sort_at,unique_id from filtered where source_season=query_season order by sort_at desc,unique_id desc offset page_offset limit lim+1) x),'[]'::jsonb)
        into total_count,unresolved_count,rows_json from filtered;
    end if;
  end if;

  has_more:=jsonb_array_length(rows_json)>lim;
  if has_more then rows_json:=rows_json- (jsonb_array_length(rows_json)-1); next_cursor:=jsonb_build_object('offset',page_offset+lim);
  end if;
  return jsonb_build_object('ok',true,'complete',unresolved_count=0,'rows',rows_json,'total',case when unresolved_count=0 then total_count else null end,
    'hasMore',has_more,'nextCursor',next_cursor,'season',query_season,'seasonReference',reference,
    'salesYear',case when exact_year or capability in ('request_queue','active_request','sales_orders') then year_filter else null end,
    'managerSalesYear',current_year,'settingRevision',setting_revision,'yearCoverage',case when exact_year then 'exact-year' when capability in ('request_queue','active_request','sales_orders') then 'manager-year-cutoff' else 'season-only' end,
    'unresolvedCount',unresolved_count);
end;
$$;
revoke all on function public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer) to service_role;
comment on function public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer) is
  'Bounded Aura reads over fixed seasonal sources. Enforces Dylan active actor, exact module access, request ownership and sales-credit row/source scopes; unknown season rows are excluded and reported.';

-- Load pg_trgm's user-settable GUC before recreating the inventory function.
select extensions.similarity('aura','aura');

create or replace function public.aura_query_inventory_v1(
  p_actor_id uuid,p_operation text,p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,aura_private,extensions set statement_timeout='5s' set pg_trgm.word_similarity_threshold='0.3'
as $$
declare
  op text:=lower(btrim(coalesce(p_operation,''))); f jsonb:=coalesce(p_filters,'{}'::jsonb);
  season_code text; query_season text; sales_year integer; query_sales_year integer; setting_revision bigint;
  manager_settings jsonb; season_reference text:=lower(btrim(coalesce(f->>'seasonReference','current'))); next_season text; next_year integer; metric text; count_mode text; lim integer; open_only boolean;
  needle text; common_name text; ic text; gn text; size_filter text; loc text; zone_filter text; asg text; asg_text text; lot text; selection_filter text;
  assignee_matches integer; person_choices jsonb;
  inventory_ready boolean;
  loc_mode text; row_assignment_active boolean:=false; total_value numeric; row_total bigint; unique_total bigint; physical_total bigint; unresolved_count bigint:=0; page_offset integer:=0; complete_value boolean:=true; identity_complete boolean:=true; scope_complete boolean:=true; rows_value jsonb; choices_value jsonb; more_value boolean; exact_match_value boolean;
begin
  if p_actor_id is null or not exists(select 1 from public.profiles p where p.id=p_actor_id and p.username='dylan_collyge'
    and p.disabled_at is null and p.must_change_password=false and (p.locked_until is null or p.locked_until<=clock_timestamp()))
    or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  if public.navigation_module_allowed_v1(p_actor_id,'drive') is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN'; end if;
  row_assignment_active:=coalesce(private.inventory_row_assignment_policy_active_v1(),false);
  if jsonb_typeof(f)<>'object' or op not in ('match','stock','locations','ownership','unassigned','lot','maximum') then
    raise exception using errcode='22023',message='AURA_FILTER_INVALID'; end if;
  if exists(select 1 from jsonb_object_keys(f) k where k not in ('productText','commonName','itemcode','genus','contSize','locationCode','locationMode','zone','assignee','assigneeText','selectionId','metric','season','seasonReference','salesYear','lotcode','openStockOnly','countMode')) then
    raise exception using errcode='22023',message='AURA_FILTER_KEY_INVALID'; end if;
  metric:=lower(coalesce(f->>'metric','ptravailable')); if metric not in ('ptravailable','ptronhand') then raise exception using errcode='22023',message='AURA_METRIC_INVALID'; end if;
  count_mode:=lower(coalesce(f->>'countMode','quantity')); if count_mode not in ('quantity','physical_rows','unique_items') then raise exception using errcode='22023',message='AURA_COUNT_MODE_INVALID'; end if;
  if f ? 'openStockOnly' and lower(f->>'openStockOnly') not in ('true','false') then raise exception using errcode='22023',message='AURA_OPEN_STOCK_FILTER_INVALID'; end if;
  open_only:=coalesce((f->>'openStockOnly')::boolean,false);
  lim:=greatest(1,least(200,coalesce(p_limit,50)));
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or p_cursor-'offset'<>'{}'::jsonb or coalesce(p_cursor->>'offset','') !~ '^[0-9]{1,9}$' then raise exception using errcode='22023',message='AURA_CURSOR_INVALID'; end if;
    page_offset:=least(1000000,(p_cursor->>'offset')::integer);
  end if;
  needle:=nullif(btrim(f->>'productText'),''); common_name:=nullif(btrim(f->>'commonName'),''); ic:=nullif(upper(btrim(f->>'itemcode')),''); gn:=nullif(lower(btrim(f->>'genus')),'');
  size_filter:=nullif(public.aura_query_size_v1(f->>'contSize'),''); loc:=nullif(upper(btrim(f->>'locationCode')),'');
  zone_filter:=nullif(upper(btrim(f->>'zone')),''); asg:=nullif(lower(btrim(f->>'assignee')),'');
  asg_text:=nullif(lower(btrim(f->>'assigneeText')),''); selection_filter:=nullif(btrim(f->>'selectionId'),''); lot:=nullif(upper(btrim(f->>'lotcode')),'');
  if selection_filter is not null and position('|' in selection_filter)=0 then asg:=lower(selection_filter); selection_filter:=null; end if;
  loc_mode:=lower(coalesce(f->>'locationMode','exact'));
  if loc_mode not in ('exact','prefix','contains') or length(coalesce(needle,''))>160 or length(coalesce(common_name,''))>160 or length(coalesce(ic,''))>100 or length(coalesce(loc,''))>80
      or length(coalesce(asg,''))>120 or length(coalesce(asg_text,''))>120 or length(coalesce(selection_filter,''))>180
      or length(coalesce(lot,''))>100 then raise exception using errcode='22023',message='AURA_FILTER_INVALID'; end if;
  if zone_filter not in ('PERENNIAL','INSIDE','OUTSIDE') and zone_filter is not null then raise exception using errcode='22023',message='AURA_ZONE_INVALID'; end if;
  select s.value into manager_settings from public.ph_app_settings s where s.key='current_season_salesyear';
  manager_settings:=coalesce(manager_settings,'{}'::jsonb);
  season_code:=upper(manager_settings->>'seasonCode');
  sales_year:=public.aura_query_salesyear_v1(manager_settings->>'salesYear');
  if season_code is null or season_code not in ('S1','F1') or sales_year is null then
    return jsonb_build_object('ok',false,'code','AURA_SEASON_SETTINGS_UNAVAILABLE','complete',false,'rows','[]'::jsonb,'total',null,'metric',metric,'season',null,'salesYear',null,'activeSeason',null,'activeSalesYear',null,'settingRevision',null,'hasMore',false,'nextCursor',null); end if;
  if nullif(manager_settings->>'revision','') is not null
    and (coalesce(manager_settings->>'revision','') !~ '^[0-9]{1,16}$' or (manager_settings->>'revision')::numeric > 9007199254740991) then
    raise exception using errcode='22023',message='AURA_MANAGER_SETTINGS_REVISION_INVALID';
  end if;
  setting_revision:=coalesce(nullif(manager_settings->>'revision','')::bigint,0);
  if season_reference not in ('current','next') then raise exception using errcode='22023',message='AURA_SEASON_REFERENCE_INVALID'; end if;
  if season_reference='next' then
    if season_code='F1' then next_season:='S1'; next_year:=sales_year;
    else next_season:='F1'; next_year:=sales_year+1; end if;
    if next_year>99 then raise exception using errcode='22023',message='AURA_NEXT_SEASON_UNAVAILABLE'; end if;
  end if;
  query_season:=case when f ? 'season' then upper(btrim(f->>'season')) when season_reference='next' then next_season else season_code end;
  query_sales_year:=case when f ? 'salesYear' then public.aura_query_salesyear_v1(f->>'salesYear') when season_reference='next' then next_year else sales_year end;
  if query_season not in ('S1','F1','U1','U2','U3','X','Y','Z') or query_sales_year is null
    or (f ? 'salesYear' and query_sales_year>sales_year and not (season_reference='next' and query_sales_year=next_year)) then
    raise exception using errcode='22023',message='AURA_SALESYEAR_OR_SEASON_INVALID';
  end if;
  perform 1 from public.app_dataset_revisions r where r.key='ph_master_inventory' for share;
  inventory_ready:=found and (select r.state from public.app_dataset_revisions r where r.key='ph_master_inventory')='ready'
    and not exists(select 1 from app_sync_private.import_leases l where l.key='ph_master_inventory');
  if not inventory_ready then
    return jsonb_build_object('ok',true,'complete',false,'code','AURA_INVENTORY_IMPORT_INCOMPLETE','rows','[]'::jsonb,'total',null,
      'metric',metric,'season',query_season,'salesYear',query_sales_year,'activeSeason',season_code,'activeSalesYear',sales_year,
      'settingRevision',setting_revision,'seasonReference',season_reference,'unresolvedCount',0,'yearCoverage',case when f ? 'salesYear' then 'sales-year-cutoff' else 'manager-sales-year-cutoff' end,
      'hasMore',false,'nextCursor',null);
  end if;
  if asg_text is not null then
    select count(*) into assignee_matches from public.ph_eval_assignment_users u where u.active is true
      and (lower(regexp_replace(btrim(u.username),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))
        or lower(regexp_replace(btrim(u.display_name),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g')));
    if assignee_matches=1 then
      select u.username into asg from public.ph_eval_assignment_users u where u.active is true
        and (lower(regexp_replace(btrim(u.username),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))
          or lower(regexp_replace(btrim(u.display_name),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))) limit 1;
      asg:=lower(asg); asg_text:=null;
    else
      select coalesce(jsonb_agg(jsonb_build_object('selectionId',username,'username',username,'label',display_name)
        order by score desc,username),'[]'::jsonb) into person_choices from (
          select u.username,u.display_name,greatest(
            extensions.word_similarity(public.aura_inventory_v2_name_v1(asg_text),public.aura_inventory_v2_name_v1(u.username)),
            extensions.word_similarity(public.aura_inventory_v2_name_v1(asg_text),public.aura_inventory_v2_name_v1(u.display_name))) score
          from public.ph_eval_assignment_users u where u.active is true and
            ((assignee_matches>1 and (lower(regexp_replace(btrim(u.username),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))
              or lower(regexp_replace(btrim(u.display_name),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))))
             or (assignee_matches<=1 and (public.aura_inventory_v2_name_v1(u.username) %> public.aura_inventory_v2_name_v1(asg_text)
              or public.aura_inventory_v2_name_v1(u.display_name) %> public.aura_inventory_v2_name_v1(asg_text))))
          order by score desc,u.username limit 5
        ) choices;
      if jsonb_array_length(person_choices)>0 then
        return jsonb_build_object('ok',true,'complete',false,'rows','[]'::jsonb,'total',null,'metric',metric,
          'season',query_season,'salesYear',query_sales_year,'activeSeason',season_code,'activeSalesYear',sales_year,'settingRevision',setting_revision,'seasonReference',season_reference,'exactMatch',false,'choiceKind','assignee','candidateChoices',person_choices,
          'hasMore',false,'nextCursor',null);
      end if;
      return jsonb_build_object('ok',false,'code','AURA_ASSIGNEE_NOT_FOUND','complete',false,'rows','[]'::jsonb,'total',null,
        'metric',metric,'season',query_season,'salesYear',query_sales_year,'activeSeason',season_code,'activeSalesYear',sales_year,'settingRevision',setting_revision,'seasonReference',season_reference,'hasMore',false,'nextCursor',null);
    end if;
  end if;
  if query_season is null then raise exception using errcode='22023',message='AURA_SEASON_INVALID'; end if;
  if op='match' and needle is null and common_name is null and ic is null and gn is null then raise exception using errcode='22023',message='AURA_PRODUCT_REQUIRED'; end if;
  if op='lot' and needle is null and common_name is null and ic is null and gn is null and lot is null then raise exception using errcode='22023',message='AURA_PRODUCT_REQUIRED'; end if;

  -- Result aggregation is bounded only for returned rows; the total is computed
  -- independently. Null or malformed relevant quantities make totals unknown.
  with inv as (
    select m.*, public.aura_query_salesyear_v1(m.saleyear) sy,
      public.aura_query_number_v1(case when metric='ptronhand' then m.ptronhand else m.ptravailable end) qty,
      coalesce(nullif(upper(btrim(m.itemcode)),''),'') ic_norm,
      lower(regexp_replace(btrim(coalesce(m.genusname,'')),'\s+',' ','g')) gn_norm,
      public.aura_query_size_v1(m.contsize) size_norm,
      (case when common_name is not null then public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(common_name)
        when needle is not null then public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.botanicalname)=public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.genusname)=public.aura_inventory_v2_name_v1(needle)
          or upper(coalesce(m.itemcode,''))=upper(needle)
        else false end) product_exact,
      case when common_name is not null then extensions.similarity(public.aura_inventory_v2_name_v1(common_name),public.aura_inventory_v2_name_v1(m.commonname))
        when needle is null then 1::real else greatest(
        case when public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.botanicalname)=public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.genusname)=public.aura_inventory_v2_name_v1(needle)
          or upper(coalesce(m.itemcode,''))=upper(needle) then 1::real else 0::real end,
        extensions.word_similarity(public.aura_inventory_v2_name_v1(needle),public.aura_inventory_v2_name_v1(m.commonname)),
        extensions.word_similarity(lower(needle),lower(coalesce(m.botanicalname,''))),
        extensions.word_similarity(lower(needle),lower(coalesce(m.genusname,'')))) end match_score,
      case when common_name is not null then extensions.similarity(public.aura_inventory_v2_name_v1(common_name),public.aura_inventory_v2_name_v1(m.commonname))
        when needle is null then 1::real else extensions.word_similarity(public.aura_inventory_v2_name_v1(needle),public.aura_inventory_v2_name_v1(m.commonname)) end common_score,
      case when common_name is not null and public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(common_name) then 4
        when common_name is not null then 1 when needle is null then 0
        when public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(needle) then 4
        when public.aura_inventory_v2_name_v1(m.botanicalname)=public.aura_inventory_v2_name_v1(needle) then 3
        when upper(coalesce(m.itemcode,''))=upper(needle) then 3
        when public.aura_inventory_v2_name_v1(m.genusname)=public.aura_inventory_v2_name_v1(needle) then 2 else 1 end product_priority
    from public.ph_master_inventory m
    where (nullif(btrim(coalesce(m.app_tab_assignment,'')),'') is null or lower(m.app_tab_assignment) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied'))
      and upper(coalesce(m.desigitem,'')) not like '%SHFT%'
      and (not open_only or public.aura_query_number_v1(m.s_lts)>0 or public.aura_query_number_v1(m.s_lts) is null)
      and (ic is null or upper(btrim(coalesce(m.itemcode,'')))=ic)
      and (gn is null or lower(regexp_replace(btrim(coalesce(m.genusname,'')),'\s+',' ','g'))=gn)
      and (size_filter is null or public.aura_query_size_v1(m.contsize)=size_filter)
      and (loc is null or case loc_mode when 'prefix' then upper(coalesce(m.locationcode,'')) like loc||'%' when 'contains' then upper(coalesce(m.locationcode,'')) like '%'||loc||'%' else upper(coalesce(m.locationcode,''))=loc end)
      and (lot is null or upper(coalesce(m.lotcode,''))=lot)
      and ((common_name is not null and (public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(common_name)
          or public.aura_inventory_v2_name_v1(m.commonname) %> public.aura_inventory_v2_name_v1(common_name)))
        or (common_name is null and (needle is null or public.aura_inventory_v2_name_v1(m.commonname) %> public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.botanicalname) %> public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.genusname) %> public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.itemcode) %> public.aura_inventory_v2_name_v1(needle))))
  ), unresolved as (
    select count(distinct x.unique_id) n from inv x
    where (nullif(upper(btrim(coalesce(x.season,''))),'') is null
        or upper(btrim(coalesce(x.season,''))) not in ('S1','F1','U1','U2','U3','X','Y','Z')
        or (upper(btrim(coalesce(x.season,'')))=query_season and x.sy is null))
      and (zone_filter is null or (zone_filter in ('INSIDE','PERENNIAL') and private.eval_location_zone(x.locationcode)='inside')
        or (zone_filter='OUTSIDE' and private.eval_location_zone(x.locationcode)='outside'))
      and (selection_filter is null or concat_ws('|',x.ic_norm,x.gn_norm,x.size_norm)=selection_filter or x.ic_norm||'|'||x.gn_norm=selection_filter)
      and (asg is null or (row_assignment_active and exists(select 1 from public.ph_inventory_row_assignments ar
          where ar.master_unique_id=x.unique_id and ar.present_in_drive and lower(private.inventory_effective_owner_v1(ar.master_unique_id))=asg))
        or (not row_assignment_active and exists(select 1 from public.ph_warehouse_assigned_items wa
          where coalesce(wa.assignment_key,upper(btrim(coalesce(wa.itemcode_normalized,wa.itemcode,'')))||'|'||lower(regexp_replace(btrim(coalesce(wa.genusname_normalized,wa.genusname,'')),'\s+',' ','g')))=x.ic_norm||'|'||x.gn_norm
            and wa.present_in_drive and lower(btrim(coalesce(wa.assignedto,'')))=asg)))
      and (op<>'ownership' or (row_assignment_active and exists(select 1 from public.ph_inventory_row_assignments ar where ar.master_unique_id=x.unique_id and ar.present_in_drive))
        or (not row_assignment_active and exists(select 1 from public.ph_warehouse_assigned_items wa
          where coalesce(wa.assignment_key,upper(btrim(coalesce(wa.itemcode_normalized,wa.itemcode,'')))||'|'||lower(regexp_replace(btrim(coalesce(wa.genusname_normalized,wa.genusname,'')),'\s+',' ','g')))=x.ic_norm||'|'||x.gn_norm and wa.present_in_drive)))
      and (op<>'unassigned' or (row_assignment_active and not exists(select 1 from public.ph_inventory_row_assignments ar where ar.master_unique_id=x.unique_id and ar.present_in_drive and nullif(btrim(coalesce(private.inventory_effective_owner_v1(ar.master_unique_id),'')),'') is not null))
        or (not row_assignment_active and not exists(select 1 from public.ph_warehouse_assigned_items wa
          where coalesce(wa.assignment_key,upper(btrim(coalesce(wa.itemcode_normalized,wa.itemcode,'')))||'|'||lower(regexp_replace(btrim(coalesce(wa.genusname_normalized,wa.genusname,'')),'\s+',' ','g')))=x.ic_norm||'|'||x.gn_norm and wa.present_in_drive and nullif(btrim(coalesce(wa.assignedto,'')),'') is not null)))
  ), relevant as (
    select * from inv where upper(coalesce(season,''))=query_season and sy is not null and sy<=query_sales_year
  ), filtered as (
    select r.*,private.eval_location_zone(r.locationcode) zone_calc
    from relevant r
  ), candidates_raw as (
    select x.*,a.assignedto,a.assigned_display_name,a.assignee_values,a.warehousei,a.assignment_reason,a.zone_override_active,a.assignment_ambiguous,a.assignment_present,a.assignment_review_required,
      concat_ws('|',x.ic_norm,x.gn_norm,x.size_norm) selection_id,x.ic_norm||'|'||x.gn_norm owner_key
    from filtered x left join lateral (
      select case when count(distinct coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),''))))=1
          then min(coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),'')))) else null end assignedto,
        min(u.display_name) assigned_display_name,min(a.warehousei) warehousei,min(a.assignment_reason) assignment_reason,
        bool_or(a.zone_override_active) zone_override_active,bool_or(a.review_required) assignment_review_required,
        array_agg(distinct coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),'')))
          order by coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),''))))
          filter(where nullif(btrim(a.assignedto),'') is not null) assignee_values,
        count(distinct coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),''))))>1 assignment_ambiguous,count(*)>0 assignment_present
      from (
        select private.inventory_effective_owner_v1(r.master_unique_id) assignedto,r.warehousei,r.assignment_reason,
          r.zone_override_active,r.review_required
        from public.ph_inventory_row_assignments r
        where row_assignment_active and r.master_unique_id=x.unique_id and r.present_in_drive
        union all
        select legacy.assignedto,legacy.warehousei,legacy.assignment_reason,legacy.zone_override_active,false review_required
        from public.ph_warehouse_assigned_items legacy
        where not row_assignment_active
          and coalesce(legacy.assignment_key,upper(btrim(coalesce(legacy.itemcode_normalized,legacy.itemcode,'')))||'|'||lower(regexp_replace(btrim(coalesce(legacy.genusname_normalized,legacy.genusname,'')),'\s+',' ','g')))
             = x.ic_norm||'|'||x.gn_norm
          and legacy.present_in_drive is true
      ) a left join public.ph_eval_assignment_users u on u.active is true
        and (lower(btrim(a.assignedto))=lower(btrim(u.username)) or lower(btrim(a.assignedto))=lower(btrim(u.display_name)))
    ) a on true
    where (zone_filter is null or (zone_filter in ('INSIDE','PERENNIAL') and x.zone_calc='inside') or (zone_filter='OUTSIDE' and x.zone_calc='outside'))
      and (asg is null or lower(coalesce(a.assignedto,''))=asg or asg=any(coalesce(a.assignee_values,array[]::text[])))
      and (selection_filter is null or concat_ws('|',x.ic_norm,x.gn_norm,x.size_norm)=selection_filter or x.ic_norm||'|'||x.gn_norm=selection_filter)
      and (op<>'unassigned' or case when row_assignment_active then
        (not coalesce(a.assignment_present,false) or coalesce(a.assignment_ambiguous,false) or nullif(btrim(coalesce(a.assignedto,'')),'') is null)
        else coalesce(a.assignment_ambiguous,false) or not coalesce(a.assignment_present,false)
          or nullif(btrim(coalesce(a.assignedto,'')),'') is null or lower(btrim(coalesce(a.assignedto,'')))='unassigned' end)
      and (op<>'ownership' or coalesce(a.assignment_present,false))
  ), candidates as (
    select c.* from candidates_raw c where (needle is null and common_name is null) or c.product_exact
      or not exists(select 1 from candidates_raw e where e.product_exact)
  ), ranked as (
    select c.*,row_number() over(partition by case when op='ownership' and row_assignment_active then unique_id
      when op='ownership' then owner_key else selection_id end
      order by product_priority desc,match_score desc,common_score desc,itemcode,genusname,contsize,locationcode,unique_id) identity_rn from candidates c
  ), numbered as (
    select r.*,row_number() over(order by case when op='maximum' then qty end desc nulls last,product_priority desc,match_score desc,common_score desc,itemcode,genusname,contsize,locationcode,unique_id) rn from ranked r
    where op not in ('ownership','match') or identity_rn=1
  )
  select (select count(*) from candidates),(select count(*) from numbered),
    (select count(distinct owner_key) from candidates),
    case when op='maximum' then (select max(qty) from candidates) else coalesce((select sum(qty) from candidates),0) end,
    coalesce((select bool_and(qty is not null and (not open_only or public.aura_query_number_v1(s_lts) is not null)) from candidates),true),
    coalesce((select bool_and(ic_norm<>'' and gn_norm<>'') from candidates),true),
    coalesce((select bool_and(not open_only or public.aura_query_number_v1(s_lts) is not null) from candidates),true),
    coalesce((select count(distinct selection_id) filter(where product_exact)=1 from candidates),false),
    coalesce(jsonb_agg(jsonb_build_object('selectionId',case when op='ownership' then owner_key else selection_id end,'uniqueId',unique_id,'itemcode',itemcode,'genus',genusname,
      'commonName',commonname,'contSize',contsize,'locationCode',locationcode,'lotCode',lotcode,'ptravailable',public.aura_query_number_v1(ptravailable),
      'ptronhand',public.aura_query_number_v1(ptronhand),'assignedTo',assignedto,'assignedDisplayName',assigned_display_name,'warehousei',warehousei,'assignmentReason',assignment_reason,
      'zoneOverrideActive',coalesce(zone_override_active,false),'assignmentAmbiguous',coalesce(assignment_ambiguous,false),'zone',zone_calc,
      'ownerStatus',case when coalesce(assignment_ambiguous,false) then 'ambiguous'
        when not coalesce(assignment_present,false) then 'missing'
        when nullif(btrim(coalesce(assignedto,'')),'') is null or lower(btrim(coalesce(assignedto,'')))='unassigned' then 'unassigned'
        else 'assigned' end,
      'ownershipSource',case when row_assignment_active then 'inventory_row' else 'eval_group' end,
      'rowOwnerStatus',case when not row_assignment_active then null
        when coalesce(assignment_review_required,false) then 'review'
        when not coalesce(assignment_present,false) then 'missing'
        when nullif(btrim(coalesce(assignedto,'')),'') is null then 'unassigned' else 'assigned' end,
      'matchKind',case when (needle is null and common_name is null) or product_exact then 'exact' else 'fuzzy' end,
      'assigneeChoices',to_jsonb(coalesce(assignee_values,array[]::text[])),
      'currentLocationCount',case when op='ownership' then (select count(distinct z.locationcode) from candidates z where z.owner_key=numbered.owner_key
        and (not row_assignment_active or z.assignedto is not distinct from numbered.assignedto)) else null end,
      'currentLocations',case when op='ownership' then (select coalesce(jsonb_agg(distinct z.locationcode) filter(where z.locationcode is not null),'[]'::jsonb) from candidates z where z.owner_key=numbered.owner_key
        and (not row_assignment_active or z.assignedto is not distinct from numbered.assignedto)) else null end
      ) order by case when op='maximum' then qty end desc nulls last,product_priority desc,match_score desc,common_score desc,itemcode,genusname,contsize,locationcode,unique_id)
      filter(where rn>page_offset and rn<=page_offset+lim),'[]'::jsonb),
    coalesce((select jsonb_agg(choice order by priority desc,score desc,common_score desc,selection_id) from (
      select jsonb_build_object('selectionId',selection_id,
        'itemcode',itemcode,'genus',genusname,'commonName',commonname,'contSize',contsize,'locationCode',locationcode,
        'matchKind',case when product_exact then 'exact' else 'fuzzy' end) choice,product_priority priority,match_score score,common_score,selection_id
      from (select distinct on(selection_id) * from ranked
        order by selection_id,product_priority desc,match_score desc,common_score desc,itemcode,genusname,contsize,locationcode,unique_id) chosen
      order by priority desc,score desc,common_score desc,itemcode,genusname,contsize,locationcode,unique_id limit 5
    ) choice_rows),'[]'::jsonb),(select n from unresolved)
  into physical_total,row_total,unique_total,total_value,complete_value,identity_complete,scope_complete,exact_match_value,rows_value,choices_value,unresolved_count from numbered;
  if count_mode='physical_rows' then total_value:=physical_total; complete_value:=scope_complete;
  elsif count_mode='unique_items' then total_value:=unique_total; complete_value:=identity_complete and scope_complete;
  end if;
  if unresolved_count>0 then complete_value:=false; end if;
  if not coalesce(complete_value,false) then total_value:=null; end if;
  more_value:=row_total>page_offset+lim;
  return jsonb_build_object('ok',true,'complete',coalesce(complete_value,false),'rows',rows_value,'total',total_value,
    'rowCount',row_total,'physicalRowCount',physical_total,'metric',case when count_mode='quantity' then metric else count_mode end,
    'season',query_season,'activeSeason',season_code,'salesYear',query_sales_year,'activeSalesYear',sales_year,'settingRevision',setting_revision,'seasonReference',season_reference,
    'hasMore',more_value,'nextCursor',case when more_value then jsonb_build_object('offset',page_offset+lim) else null end,
    'unresolvedCount',unresolved_count,'yearCoverage',case when f ? 'salesYear' then 'sales-year-cutoff' else 'manager-sales-year-cutoff' end,
    'exactMatch',case when selection_filter is not null and row_total>0 then true
      when needle is null and common_name is null and ic is not null then true
      when needle is null and common_name is null then null else coalesce(exact_match_value,false) end,'candidateChoices',choices_value);
end $$;

revoke all on function public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer) to service_role;

commit;
