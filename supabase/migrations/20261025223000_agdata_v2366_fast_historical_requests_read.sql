begin;

create index if not exists ph_requests_completed_history_rep_fast_v2366
  on public.ph_requests_completed_history(assigned_rep_id,date_completed desc nulls last,unique_id);
create index if not exists ph_requests_completed_history_customer_fast_v2366
  on public.ph_requests_completed_history(assigned_rep_id,customeridentityid,consigneeidentityid);

create or replace function private.historical_request_customer_key_v2366(p_id text,p_name text)
returns text language sql immutable security invoker as $function$
  select case when nullif(p_id,'') is not null then 'customer:id:'||md5(p_id)
    else 'customer:name:'||md5(coalesce(nullif(sales_private.key(p_name),''),'unknown')) end
$function$;

create or replace function private.historical_request_consignee_key_v2366(p_customer_key text,p_id text,p_name text)
returns text language sql immutable security invoker as $function$
  select p_customer_key||'|consignee:'||case when nullif(p_id,'') is not null then 'id:'||md5(p_id)
    else 'name:'||md5(coalesce(nullif(sales_private.key(p_name),''),'unknown')) end
$function$;

revoke all on function private.historical_request_customer_key_v2366(text,text) from public,anon,authenticated,service_role;
revoke all on function private.historical_request_consignee_key_v2366(text,text,text) from public,anon,authenticated,service_role;

create or replace function public.historical_requests_read_v1(p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer
set search_path=''
set statement_timeout='2s'
as $function$
declare
  actor_id uuid:=auth.uid();
  global_scope boolean;
  operation text;
  record_kind text:='all';
  requested_view text:='historical-requests';
  rep_filter text;
  rep_id_filter uuid;
  rep_unassigned boolean:=false;
  customer_filter text;
  consignee_filter text;
  date_from_stamp timestamptz;
  date_to_stamp timestamptz;
  page_value integer:=0;
  page_size_value integer:=25;
  row_total bigint:=0;
  request_total bigint:=0;
  unpriced_total bigint:=0;
  value_total numeric:=0;
  rows_value jsonb:='[]'::jsonb;
  revision_value text;
  generated_at timestamptz:=clock_timestamp();
begin
  if actor_id is null then raise exception using errcode='42501',message='HISTORICAL_REQUESTS_AUTH_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) key
      where key not in ('operation','customerKey','consigneeKey','repKey','recordKind','view','dateFrom','dateTo','page','pageSize')) then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
  end if;
  operation:=p_query->>'operation';
  if operation is null or operation not in ('customers','consignees','requests','reps','folders','months','summary') then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_OPERATION_INVALID';
  end if;
  if p_query ? 'view' then
    if jsonb_typeof(p_query->'view')<>'string' or p_query->>'view' not in ('historical-requests','request-history') then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    requested_view:=p_query->>'view';
  end if;
  if not private.navigation_module_allowed_v1(actor_id,requested_view) then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_FORBIDDEN'; end if;
  global_scope:=private.history_dylan_financial_v1(actor_id);
  if operation='months' and not global_scope then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_FINANCIAL_FORBIDDEN'; end if;
  if p_query ? 'recordKind' then
    if jsonb_typeof(p_query->'recordKind')<>'string' or p_query->>'recordKind' not in ('all','requests','orders') then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    record_kind:=p_query->>'recordKind';
  end if;
  if p_query ? 'repKey' then
    rep_filter:=p_query->>'repKey';
    if jsonb_typeof(p_query->'repKey')<>'string' or (rep_filter !~ '^rep:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and rep_filter<>'rep:unassigned') then raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    rep_unassigned:=rep_filter='rep:unassigned';
    if not rep_unassigned then rep_id_filter:=substring(rep_filter from 5)::uuid; end if;
    if not global_scope and rep_id_filter is distinct from actor_id then
      raise exception using errcode='42501',message='HISTORICAL_REQUESTS_REP_FORBIDDEN'; end if;
  end if;
  if p_query ? 'customerKey' then
    customer_filter:=p_query->>'customerKey';
    if jsonb_typeof(p_query->'customerKey')<>'string' or length(customer_filter) not between 1 and 300 then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
  end if;
  if p_query ? 'consigneeKey' then
    consignee_filter:=p_query->>'consigneeKey';
    if jsonb_typeof(p_query->'consigneeKey')<>'string' or length(consignee_filter) not between 1 and 300 then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
  end if;
  if operation in ('consignees','requests') and customer_filter is null then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_CUSTOMER_REQUIRED'; end if;
  if operation='requests' and consignee_filter is null then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_CONSIGNEE_REQUIRED'; end if;
  if p_query ? 'dateFrom' then
    if jsonb_typeof(p_query->'dateFrom')<>'string' or p_query->>'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    date_from_stamp:=(p_query->>'dateFrom')::date::timestamp at time zone 'America/Chicago';
  end if;
  if p_query ? 'dateTo' then
    if jsonb_typeof(p_query->'dateTo')<>'string' or p_query->>'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    date_to_stamp:=((p_query->>'dateTo')::date+1)::timestamp at time zone 'America/Chicago';
  end if;
  if date_from_stamp is not null and date_to_stamp is not null and date_from_stamp>=date_to_stamp then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
  if p_query ? 'page' then
    if jsonb_typeof(p_query->'page')<>'number' or coalesce(p_query->>'page','') !~ '^(0|[1-9][0-9]{0,6})$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    page_value:=(p_query->>'page')::integer;
  end if;
  if p_query ? 'pageSize' then
    if jsonb_typeof(p_query->'pageSize')<>'number' or coalesce(p_query->>'pageSize','') !~ '^[1-9][0-9]{0,2}$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    page_size_value:=(p_query->>'pageSize')::integer;
  end if;
  if page_value>100000 or page_size_value not between 1 and 100 then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;

  select 'history-fast-v2366:'||coalesce(string_agg(source.key||':'||source.revision,',' order by source.key),'ready')
  into revision_value from public.app_dataset_revisions source
  where source.key=any(array['ph_requests_completed_history','ph_requests_pending']);

  if operation<>'reps' then
    select count(*)::bigint,coalesce(sum(h.line_dollar_value),0),
      count(*) filter(where h.unit_list_price is null or h.line_dollar_value is null)::bigint
    into request_total,value_total,unpriced_total
    from public.ph_requests_completed_history h
    where (global_scope or h.assigned_rep_id=actor_id)
      and (rep_filter is null or (rep_unassigned and h.assigned_rep_id is null) or h.assigned_rep_id=rep_id_filter)
      and (customer_filter is null or private.historical_request_customer_key_v2366(h.customeridentityid,
        coalesce(nullif(h.customer_name,''),nullif(h.customername,''),nullif(h.req_customer,''),nullif(h.request_customer,''),'Unknown customer'))=customer_filter)
      and (consignee_filter is null or private.historical_request_consignee_key_v2366(
        private.historical_request_customer_key_v2366(h.customeridentityid,
          coalesce(nullif(h.customer_name,''),nullif(h.customername,''),nullif(h.req_customer,''),nullif(h.request_customer,''),'Unknown customer')),
        h.consigneeidentityid,coalesce(nullif(h.consignee_name,''),nullif(h.consigneename,''),'Unknown consignee'))=consignee_filter)
      and (date_from_stamp is null or coalesce(h.requested_at,h.created_at,h.date_completed)>=date_from_stamp)
      and (date_to_stamp is null or coalesce(h.requested_at,h.created_at,h.date_completed)<date_to_stamp)
      and (record_kind='all' or (record_kind='orders' and nullif(h.snapshot->>'dock','') is not null)
        or (record_kind='requests' and nullif(h.snapshot->>'dock','') is null));
  end if;

  if operation='requests' then
    row_total:=request_total;
    with source as (
      select h.*,
        coalesce(nullif(h.customer_name,''),nullif(h.customername,''),nullif(h.req_customer,''),nullif(h.request_customer,''),'Unknown customer') normalized_customer,
        coalesce(nullif(h.consignee_name,''),nullif(h.consigneename,''),'Unknown consignee') normalized_consignee,
        coalesce(h.request_qty,private.historical_requests_number_v1(h.req_qty)) normalized_request_qty,
        coalesce(h.requested_at,h.created_at,h.date_completed) normalized_requested_at,
        nullif(h.snapshot->>'dock','') normalized_dock
      from public.ph_requests_completed_history h
      where (global_scope or h.assigned_rep_id=actor_id)
        and (rep_filter is null or (rep_unassigned and h.assigned_rep_id is null) or h.assigned_rep_id=rep_id_filter)
    ), keyed as (
      select source.*,
        private.historical_request_customer_key_v2366(source.customeridentityid,source.normalized_customer) customer_key,
        private.historical_request_consignee_key_v2366(
          private.historical_request_customer_key_v2366(source.customeridentityid,source.normalized_customer),
          source.consigneeidentityid,source.normalized_consignee) full_consignee_key,
        coalesce(source.effective_qty,case when source.normalized_request_qty>0 then source.normalized_request_qty else 25 end) normalized_effective_qty
      from source
    ), paged as (
      select keyed.*,coalesce(nullif(profile.display_name,''),nullif(profile.username,''),nullif(keyed.sales_rep,''),
        nullif(keyed.request_selected_rep_display,''),nullif(keyed.request_selected_rep_username,''),'Unassigned') normalized_rep
      from keyed left join public.profiles profile on profile.id=keyed.assigned_rep_id
      where keyed.customer_key=customer_filter and keyed.full_consignee_key=consignee_filter
        and (date_from_stamp is null or keyed.normalized_requested_at>=date_from_stamp)
        and (date_to_stamp is null or keyed.normalized_requested_at<date_to_stamp)
        and (record_kind='all' or (record_kind='orders' and keyed.normalized_dock is not null)
          or (record_kind='requests' and keyed.normalized_dock is null))
      order by keyed.normalized_requested_at desc nulls last,keyed.unique_id
      offset page_value*page_size_value limit page_size_value
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',unique_id,'customerName',normalized_customer,'consigneeName',normalized_consignee,'salesrepUserId',assigned_rep_id,
      'salesrepName',normalized_rep,'itemcode',coalesce(nullif(btrim(itemcode),''),'Unknown item'),
      'commonname',coalesce(commonname,''),'location',coalesce(locationcode,''),'requestedAt',normalized_requested_at,
      'status',coalesce(nullif(status,''),nullif(req_status,''),nullif(fulfillment_status,''),'Completed'),
      'requestQty',normalized_request_qty,'effectiveQty',normalized_effective_qty,
      'listPrice',case when global_scope then unit_list_price else null end,
      'totalValue',case when global_scope and unit_list_price is not null and unit_list_price>=0
        then round(normalized_effective_qty*unit_list_price,2) else null end,
      'unresolvedReason',case when global_scope and (unit_list_price is null or unit_list_price<0)
        then 'canonical_list_price_unavailable' else null end,'dock',normalized_dock,
      'spec',coalesce(spec,request_spec,req_spec,''),'caliper',coalesce(caliper,request_caliper,req_caliper,''),
      'comments',coalesce(comments,request_notes,req_comments,''),'photoNotes',coalesce(req_pic_note,''),
      'photoLinks',private.archive_photo_array_v2366(photos,array[photo_url,req_photo_link,photo_link]),
      'sentAt',date_completed,'deliveryState',coalesce(nullif(delivery_state,''),'unknown'))
      order by normalized_requested_at desc nulls last,unique_id),'[]'::jsonb) into rows_value from paged;
  elsif operation='reps' then
    with grouped as (
      select h.assigned_rep_id owner_id,
        coalesce(nullif(min(profile.display_name),''),nullif(min(profile.username),''),nullif(min(h.sales_rep),''),'Unassigned') label,
        count(*)::bigint request_count,coalesce(sum(h.line_dollar_value),0) total_value,
        count(*) filter(where h.unit_list_price is null or h.line_dollar_value is null)::bigint unpriced_count
      from public.ph_requests_completed_history h left join public.profiles profile on profile.id=h.assigned_rep_id
      where (global_scope or h.assigned_rep_id=actor_id)
        and (rep_filter is null or (rep_unassigned and h.assigned_rep_id is null) or h.assigned_rep_id=rep_id_filter)
        and (date_from_stamp is null or coalesce(h.requested_at,h.created_at,h.date_completed)>=date_from_stamp)
        and (date_to_stamp is null or coalesce(h.requested_at,h.created_at,h.date_completed)<date_to_stamp)
        and (record_kind='all' or (record_kind='orders' and nullif(h.snapshot->>'dock','') is not null)
          or (record_kind='requests' and nullif(h.snapshot->>'dock','') is null))
      group by h.assigned_rep_id
    ), ranked as (select grouped.*,count(*) over() group_total,sum(request_count) over() summary_request_total,
      sum(total_value) over() summary_value_total,sum(unpriced_count) over() summary_unpriced_total from grouped), paged as (
      select * from ranked order by request_count desc,lower(label) offset page_value*page_size_value limit page_size_value)
    select coalesce(max(group_total),0),coalesce(max(summary_request_total),0),coalesce(max(summary_value_total),0),
      coalesce(max(summary_unpriced_total),0),coalesce(jsonb_agg(jsonb_build_object('key','rep:'||coalesce(owner_id::text,'unassigned'),
      'label',label,'requestCount',request_count,'totalValue',case when global_scope then total_value else null end,
      'unpricedCount',case when global_scope then unpriced_count else null end,'customerKey',null,'consigneeKey',null,
      'consigneeName',null,'customerId',null,'consigneeId',null) order by request_count desc,lower(label)),'[]'::jsonb)
    into row_total,request_total,value_total,unpriced_total,rows_value from paged;
  elsif operation in ('customers','folders','consignees') then
    with source as (
      select h.assigned_rep_id,
        coalesce(nullif(h.customer_name,''),nullif(h.customername,''),nullif(h.req_customer,''),nullif(h.request_customer,''),'Unknown customer') customer_name,
        coalesce(nullif(h.consignee_name,''),nullif(h.consigneename,''),'Unknown consignee') consignee_name,
        nullif(h.customeridentityid,'') customer_id,nullif(h.consigneeidentityid,'') consignee_id,
        coalesce(h.requested_at,h.created_at,h.date_completed) requested_at,h.line_dollar_value,h.unit_list_price,
        nullif(h.snapshot->>'dock','') dock
      from public.ph_requests_completed_history h
      where (global_scope or h.assigned_rep_id=actor_id)
        and (rep_filter is null or (rep_unassigned and h.assigned_rep_id is null) or h.assigned_rep_id=rep_id_filter)
    ), keyed as (
      select source.*,private.historical_request_customer_key_v2366(customer_id,customer_name) customer_key,
        private.historical_request_consignee_key_v2366(
          private.historical_request_customer_key_v2366(customer_id,customer_name),consignee_id,consignee_name) full_consignee_key
      from source
    ), filtered as (
      select * from keyed where (customer_filter is null or customer_key=customer_filter)
        and (consignee_filter is null or full_consignee_key=consignee_filter)
        and (date_from_stamp is null or requested_at>=date_from_stamp) and (date_to_stamp is null or requested_at<date_to_stamp)
        and (record_kind='all' or (record_kind='orders' and dock is not null) or (record_kind='requests' and dock is null))
    ), grouped as (
      select case when operation='customers' then customer_key else full_consignee_key end key,
        case when operation='consignees' then min(consignee_name) else min(customer_name) end label,
        count(*)::bigint request_count,coalesce(sum(line_dollar_value),0) total_value,
        count(*) filter(where unit_list_price is null or line_dollar_value is null)::bigint unpriced_count,
        min(customer_key) customer_key,min(full_consignee_key) consignee_key,min(consignee_name) consignee_name,
        min(customer_id) customer_id,min(consignee_id) consignee_id
      from filtered group by case when operation='customers' then customer_key else full_consignee_key end
    ), ranked as (select grouped.*,count(*) over() group_total from grouped), paged as (
      select * from ranked order by request_count desc,lower(label),key offset page_value*page_size_value limit page_size_value)
    select coalesce(max(group_total),0),coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,
      'requestCount',request_count,'totalValue',case when global_scope then total_value else null end,
      'unpricedCount',case when global_scope then unpriced_count else null end,'customerKey',customer_key,
      'consigneeKey',case when operation in ('folders','consignees') then consignee_key else null end,
      'consigneeName',case when operation in ('folders','consignees') then consignee_name else null end,
      'customerId',customer_id,'consigneeId',consignee_id) order by request_count desc,lower(label),key),'[]'::jsonb)
    into row_total,rows_value from paged;
  elsif operation='months' then
    with grouped as (
      select coalesce(to_char(coalesce(h.requested_at,h.created_at,h.date_completed) at time zone 'America/Chicago','YYYY-MM'),'unknown') month_key,
        count(*)::bigint request_count,coalesce(sum(h.line_dollar_value),0) total_value,
        count(*) filter(where h.unit_list_price is null or h.line_dollar_value is null)::bigint unpriced_count
      from public.ph_requests_completed_history h where (global_scope or h.assigned_rep_id=actor_id)
        and (rep_filter is null or (rep_unassigned and h.assigned_rep_id is null) or h.assigned_rep_id=rep_id_filter)
        and (date_from_stamp is null or coalesce(h.requested_at,h.created_at,h.date_completed)>=date_from_stamp)
        and (date_to_stamp is null or coalesce(h.requested_at,h.created_at,h.date_completed)<date_to_stamp)
        and (record_kind='all' or (record_kind='orders' and nullif(h.snapshot->>'dock','') is not null)
          or (record_kind='requests' and nullif(h.snapshot->>'dock','') is null))
      group by 1
    ), ranked as (select grouped.*,count(*) over() group_total from grouped), paged as (
      select * from ranked order by month_key desc offset page_value*page_size_value limit page_size_value)
    select coalesce(max(group_total),0),coalesce(jsonb_agg(jsonb_build_object('key','month:'||month_key,'label',month_key,
      'requestCount',request_count,'totalValue',total_value,'unpricedCount',unpriced_count,'customerKey',null,
      'consigneeKey',null,'consigneeName',null,'customerId',null,'consigneeId',null) order by month_key desc),'[]'::jsonb)
    into row_total,rows_value from paged;
  end if;

  return jsonb_build_object('scope',case when global_scope then 'all' else 'own' end,'financials',global_scope,
    'recordKind',record_kind,'ownRepKey','rep:'||actor_id::text,'revision',revision_value,'generatedAt',generated_at,
    'page',page_value,'pageSize',page_size_value,'total',row_total,'rows',rows_value,
    'summary',jsonb_build_object('requestCount',request_total,
      'totalValue',case when global_scope then value_total else null end,
      'unpricedCount',case when global_scope then unpriced_total else null end));
end
$function$;

revoke all on function public.historical_requests_read_v1(jsonb) from public,anon,service_role;
grant execute on function public.historical_requests_read_v1(jsonb) to authenticated;
comment on function public.historical_requests_read_v1(jsonb) is
  'history-fast-v2366: canonical completed-request archive reader with indexed role-scoped folders, reports and records.';

commit;
