begin;
set local lock_timeout = '5s';

-- Repair read-time pricing for stale master IDs; historical rows stay untouched.
create or replace function public.historical_requests_read_v1(p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=''
set statement_timeout='10s'
as $function$
declare
  actor public.profiles;
  actor_id uuid:=auth.uid();
  global_scope boolean;
  operation text;
  customer_filter text;
  consignee_filter text;
  page_value integer:=0;
  page_size_value integer:=25;
  row_total bigint:=0;
  request_total bigint:=0;
  unpriced_total bigint:=0;
  value_total numeric:=0;
  rows_value jsonb:='[]'::jsonb;
  revision_value text;
  generated_at timestamptz:=clock_timestamp();
  revision_row record;
  revision_count integer:=0;
begin
  if actor_id is null then raise exception using errcode='42501',message='HISTORICAL_REQUESTS_AUTH_REQUIRED'; end if;
  actor:=sales_private.actor(actor_id);
  if not private.navigation_module_allowed_v1(actor_id,'historical-requests') then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) k
      where k not in ('operation','customerKey','consigneeKey','page','pageSize')) then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
  end if;
  operation:=p_query->>'operation';
  if operation is null or operation not in ('customers','consignees','requests','reps','summary') then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_OPERATION_INVALID';
  end if;
  global_scope:=actor.username='dylan_collyge'
    or upper(btrim(coalesce(actor.role,''))) in ('ADMIN','ADMINISTRATOR');
  if not global_scope and upper(btrim(coalesce(actor.role,''))) not in ('REP','SALESREP') then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_FORBIDDEN';
  end if;
  if operation='reps' and not global_scope then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_REPS_FORBIDDEN';
  end if;
  if p_query ? 'customerKey' then
    if jsonb_typeof(p_query->'customerKey')<>'string' or length(p_query->>'customerKey') not between 1 and 300 then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    customer_filter:=p_query->>'customerKey';
  end if;
  if p_query ? 'consigneeKey' then
    if jsonb_typeof(p_query->'consigneeKey')<>'string' or length(p_query->>'consigneeKey') not between 1 and 300 then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    consignee_filter:=p_query->>'consigneeKey';
  end if;
  if operation in ('consignees','requests') and customer_filter is null then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_CUSTOMER_REQUIRED';
  end if;
  if operation='requests' and consignee_filter is null then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_CONSIGNEE_REQUIRED';
  end if;
  if p_query ? 'page' then
    if jsonb_typeof(p_query->'page')<>'number' or coalesce(p_query->>'page','') !~ '^(0|[1-9][0-9]{0,6})$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    page_value:=(p_query->>'page')::integer;
  end if;
  if p_query ? 'pageSize' then
    if jsonb_typeof(p_query->'pageSize')<>'number' or coalesce(p_query->>'pageSize','') !~ '^[1-9][0-9]{0,2}$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    page_size_value:=(p_query->>'pageSize')::integer;
    if page_size_value not between 1 and 100 then raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
  end if;
  if page_value>100000 then raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;

  -- Lock source revisions in key order. Source triggers acquire the same row
  -- locks, so a response is tied to one coherent active/history/master view.
  for revision_row in
    select r.key,r.revision,r.state from public.app_dataset_revisions r
    where r.key=any(array['ph_active_request','ph_master_inventory','ph_request_history']) order by r.key for share
  loop
    revision_count:=revision_count+1;
    if revision_row.state is distinct from 'ready' then
      raise exception using errcode='55000',message='HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED';
    end if;
  end loop;
  if revision_count<>3 then
    raise exception using errcode='55000',message='HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED';
  end if;
  select string_agg(k||':'||coalesce(r.revision,0)::text,',' order by k) into revision_value
  from unnest(array['ph_active_request','ph_master_inventory','ph_request_history']) k
  left join public.app_dataset_revisions r on r.key=k;

  with source_rows as materialized (
    select h.unique_id,h.assigned_rep_id as owner_id,
      coalesce(nullif(h.customername,''),nullif(h.snapshot->>'customername',''),nullif(h.req_customer,''),nullif(h.request_customer,''),'Unknown customer') as customer_name,
      coalesce(nullif(h.consigneename,''),nullif(h.snapshot->>'consigneename',''),'Unknown consignee') as consignee_name,
      coalesce(nullif(h.customeridentityid,''),nullif(h.snapshot->>'customeridentityid','')) as customer_id,
      coalesce(nullif(h.consigneeidentityid,''),nullif(h.snapshot->>'consigneeidentityid','')) as consignee_id,
      h.itemcode,h.commonname,h.locationcode,h.req_qty,h.req_status,h.created_at,
      coalesce(nullif(h.master_id,''),nullif(h.master_unique_id,'')) as master_uid,
      btrim(coalesce(nullif(h.itemcode,''),h.snapshot->>'itemcode','')) as fallback_itemcode,
      btrim(coalesce(nullif(h.contsize,''),h.snapshot->>'contsize','')) as fallback_size,
      btrim(coalesce(nullif(h.locationcode,''),h.snapshot->>'locationcode','')) as fallback_location,
      btrim(coalesce(nullif(h.lotcode,''),h.snapshot->>'lotcode','')) as fallback_lot
    from public.ph_request_history h
    where global_scope or h.assigned_rep_id=actor_id
    union all
    select a.unique_id,rep.owner_id,
      coalesce(nullif(a.customername,''),nullif(a.req_customer,''),'Unknown customer'),
      coalesce(nullif(a.consigneename,''),'Unknown consignee'),
      nullif(a.customeridentityid,''),nullif(a.consigneeidentityid,''),
      a.itemcode,a.commonname,a.locationcode,a.req_qty,a.req_status,a.created_at,nullif(a.master_id,''),
      btrim(coalesce(a.itemcode,'')),btrim(coalesce(a.contsize,'')),
      btrim(coalesce(a.locationcode,'')),btrim(coalesce(a.lotcode,''))
    from public.ph_active_request a
    cross join lateral (select sales_private.assigned_rep(to_jsonb(a)) as owner_id) rep
    where not exists(select 1 from public.ph_request_history h where h.unique_id=a.unique_id)
      and (global_scope or rep.owner_id=actor_id)
  ), missing_tuples as materialized (
    select distinct fallback_itemcode,fallback_size,fallback_location,fallback_lot
    from source_rows s
    where s.fallback_itemcode<>'' and s.fallback_size<>'' and s.fallback_location<>'' and s.fallback_lot<>''
      and not exists(select 1 from public.ph_master_inventory m where m.unique_id=s.master_uid)
  ), fallback_candidates as materialized (
    select t.*,private.historical_requests_number_v1(m.listprice) as price
    from missing_tuples t
    join public.ph_master_inventory m
      on btrim(coalesce(m.itemcode,''))=t.fallback_itemcode
      and btrim(coalesce(m.contsize,''))=t.fallback_size
      and btrim(coalesce(m.locationcode,''))=t.fallback_location
      and btrim(coalesce(m.lotcode,''))=t.fallback_lot
  ), fallback_prices as materialized (
    -- A tuple contributes one price only if every matching row has that price.
    -- Invalid/missing/negative prices and conflicting candidates stay unresolved.
    select fallback_itemcode,fallback_size,fallback_location,fallback_lot,
      case when count(*)=count(price) and min(price)>=0 and min(price)=max(price)
        then min(price) else null::numeric end as price
    from fallback_candidates group by 1,2,3,4
  ), visible as materialized (
    select s.*,case when m.unique_id is not null then m.listprice else f.price::text end as listprice,
      (m.unique_id is not null or f.price is not null) as current_master_found,
      coalesce(nullif(p.display_name,''),p.username,'Unassigned') as rep_name,
      case when s.customer_id is not null then 'customer:id:'||md5(s.customer_id)
        else 'customer:name:'||md5(coalesce(nullif(sales_private.key(s.customer_name),''),'unknown')) end as customer_key,
      case when s.consignee_id is not null then 'id:'||md5(s.consignee_id)
        else 'name:'||md5(coalesce(nullif(sales_private.key(s.consignee_name),''),'unknown')) end as consignee_part_key,
      private.historical_requests_number_v1(s.req_qty) as parsed_qty,
      case when m.unique_id is not null then private.historical_requests_number_v1(m.listprice) else f.price end as parsed_price,
      case when nullif(btrim(s.req_qty),'') is null or private.historical_requests_number_v1(s.req_qty)=0 then 25::numeric
        else private.historical_requests_number_v1(s.req_qty) end as effective_qty
    from source_rows s
    left join public.ph_master_inventory m on m.unique_id=s.master_uid
    left join fallback_prices f on m.unique_id is null
      and (f.fallback_itemcode,f.fallback_size,f.fallback_location,f.fallback_lot)
        =(s.fallback_itemcode,s.fallback_size,s.fallback_location,s.fallback_lot)
    left join public.profiles p on p.id=s.owner_id
  ), priced as materialized (
    select v.*,
      v.customer_key||'|consignee:'||v.consignee_part_key as full_consignee_key,
      case when nullif(btrim(v.req_qty),'') is not null and v.parsed_qty is null then 'invalid_request_quantity'
        when v.parsed_qty<0 then 'invalid_request_quantity'
        when not v.current_master_found then 'current_master_row_unavailable'
        when v.listprice is null or v.parsed_price is null or v.parsed_price<0 then 'current_list_price_unavailable_or_invalid'
        else null end as unresolved_reason
    from visible v
  ), calculated as materialized (
    select p.*,
      case when p.unresolved_reason is null then p.effective_qty*p.parsed_price else null::numeric end as total_value
    from priced p
  ), filtered as materialized (
    select c.* from calculated c
    where (operation not in ('consignees','requests') or c.customer_key=customer_filter)
      and (operation<>'requests' or c.full_consignee_key=consignee_filter)
  ), summary_data as (
    select count(*)::bigint as requests,coalesce(sum(total_value),0)::numeric as amount,
      count(*) filter(where total_value is null)::bigint as unpriced from calculated
  ), group_data as (
    select case operation when 'customers' then f.customer_key when 'consignees' then f.full_consignee_key
      else 'rep:'||coalesce(f.owner_id::text,'unassigned') end as key,
      case operation when 'customers' then min(f.customer_name) when 'consignees' then min(f.consignee_name)
      else min(f.rep_name) end as label,
      count(*)::bigint as requests,coalesce(sum(f.total_value),0)::numeric as amount,
      count(*) filter(where f.total_value is null)::bigint as unpriced
    from filtered f
    where operation in ('customers','consignees','reps')
    group by case operation when 'customers' then f.customer_key when 'consignees' then f.full_consignee_key
      else 'rep:'||coalesce(f.owner_id::text,'unassigned') end
  ), group_page as (
    select g.key,g.label,g.requests,g.amount,g.unpriced
    from group_data g order by g.amount desc,g.label,g.key
    offset page_value*page_size_value limit page_size_value
  ), request_page as (
    select f.* from filtered f
    where operation='requests'
    order by f.created_at desc nulls last,f.unique_id desc
    offset page_value*page_size_value limit page_size_value
  )
  select (select requests from summary_data),(select amount from summary_data),(select unpriced from summary_data),
    case when operation='summary' then 0
      when operation='requests' then (select count(*) from filtered)
      else (select count(*) from group_data) end,
    case when operation='summary' then '[]'::jsonb
      when operation='requests' then coalesce((select jsonb_agg(jsonb_build_object(
        'id',f.unique_id,'customerName',f.customer_name,'consigneeName',f.consignee_name,
        'salesrepUserId',f.owner_id::text,'salesrepName',f.rep_name,'itemcode',coalesce(f.itemcode,''),
        'commonname',coalesce(f.commonname,''),'location',coalesce(f.locationcode,''),'requestedAt',f.created_at,
        'status',coalesce(f.req_status,'Pending'),
        'requestQty',case when f.parsed_qty<0 then null else f.parsed_qty end,
        'effectiveQty',case when f.unresolved_reason='invalid_request_quantity' then null else f.effective_qty end,
        'listPrice',case when f.parsed_price<0 then null else f.parsed_price end,
        'totalValue',f.total_value,'unresolvedReason',f.unresolved_reason)
        order by f.created_at desc nulls last,f.unique_id desc) from request_page f),'[]'::jsonb)
      else coalesce((select jsonb_agg(jsonb_build_object('key',g.key,'label',g.label,'requestCount',g.requests,
        'totalValue',g.amount,'unpricedCount',g.unpriced) order by g.amount desc,g.label,g.key) from group_page g),'[]'::jsonb)
    end
    into request_total,value_total,unpriced_total,row_total,rows_value;

  return jsonb_build_object('ok',true,'scope',case when global_scope then 'all' else 'own' end,
    'revision',coalesce(revision_value,''),'generatedAt',generated_at,'page',page_value,'pageSize',page_size_value,
    'total',row_total,'rows',rows_value,
    'summary',jsonb_build_object('requestCount',request_total,'totalValue',value_total,'unpricedCount',unpriced_total));
end
$function$;
revoke all on function public.historical_requests_read_v1(jsonb) from public,anon,service_role;
grant execute on function public.historical_requests_read_v1(jsonb) to authenticated;

comment on function public.historical_requests_read_v1(jsonb) is
  'Authenticated historical requests with exact-master precedence and unambiguous current tuple price fallback.';

commit;
