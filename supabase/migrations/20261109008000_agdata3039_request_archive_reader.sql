begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function private.request_archive_query_v3039(p_query jsonb)
returns jsonb language plpgsql immutable set search_path='' as $function$
declare operation text:=p_query->>'operation'; path_value jsonb:=coalesce(p_query->'path','[]'::jsonb);
begin
  if jsonb_typeof(p_query)<>'object' or p_query->>'recordKind' is distinct from 'requests'
    or exists(select 1 from jsonb_object_keys(p_query) key where key not in
      ('operation','recordKind','path','page','pageSize','query','view'))
    or operation is null or operation not in('archive-folders','archive-records','archive-search') then
    raise exception 'HISTORICAL_ARCHIVE_QUERY_INVALID' using errcode='22023';
  end if;
  if jsonb_typeof(path_value)<>'array' or jsonb_array_length(path_value)>5
    or exists(select 1 from jsonb_array_elements(path_value) part
      where jsonb_typeof(part)<>'string' or length(part#>>'{}') not between 1 and 500)
    or (operation='archive-folders' and jsonb_array_length(path_value)>=5)
    or (operation='archive-records' and jsonb_array_length(path_value)<>5)
    or (p_query ? 'view' and (jsonb_typeof(p_query->'view')<>'string'
      or p_query->>'view' not in('historical-requests','request-history'))) then
    raise exception 'HISTORICAL_ARCHIVE_PATH_INVALID' using errcode='22023';
  end if;
  if (p_query ? 'page' and (jsonb_typeof(p_query->'page')<>'number' or p_query->>'page' !~ '^(0|[1-9][0-9]{0,4})$'))
    or (p_query ? 'pageSize' and (jsonb_typeof(p_query->'pageSize')<>'number' or p_query->>'pageSize' !~ '^([1-9][0-9]?|100)$'))
    or (operation='archive-search' and (jsonb_typeof(p_query->'query') is distinct from 'string'
      or length(btrim(p_query->>'query')) not between 2 and 100))
    or (operation<>'archive-search' and p_query ? 'query') then
    raise exception 'HISTORICAL_ARCHIVE_QUERY_INVALID' using errcode='22023';
  end if;
  return p_query||jsonb_build_object('path',path_value,'page',coalesce((p_query->>'page')::integer,0),
    'pageSize',coalesce((p_query->>'pageSize')::integer,25));
end
$function$;

create or replace function private.request_archive_photos_v3039(p_links jsonb)
returns jsonb language sql stable set search_path='' as $function$
  select jsonb_build_object(
    'photoLinks',coalesce(jsonb_agg(coalesce('https://drive.google.com/file/d/'||receipt.drive_file_id||'/view',
      link.source_url) order by link.ordinality),'[]'::jsonb),
    'photoArchiveReceipts',coalesce(jsonb_agg(jsonb_build_object('sourceUrl',link.source_url,
      'sourceKey',receipt.source_key,'driveFileId',receipt.drive_file_id,'verifiedAt',receipt.verified_at,
      'deletedAt',receipt.deleted_at,'sha256',receipt.sha256) order by link.ordinality)
      filter(where receipt.source_key is not null),'[]'::jsonb))
  from jsonb_array_elements_text(p_links) with ordinality link(source_url,ordinality)
  cross join lateral (select private.request_archive_photo_object_v3039(link.source_url) object_key) source
  left join lateral (
    select job.source_key,job.drive_file_id,job.verified_at,job.deleted_at,
      case when job.sha256 ~ '^[0-9a-fA-F]{64}$' then job.sha256 end sha256
    from public.ph_photo_archive_jobs job
    where ((source.object_key is null and job.source_url=link.source_url)
      or (source.object_key is not null
        and job.source_key=encode(sha256(convert_to(source.object_key,'UTF8')),'hex')
        and job.source_bucket||'/'||job.source_path=source.object_key))
      and job.status='deleted' and job.deleted_at is not null
      and job.verified_at is not null and job.drive_file_id ~ '^[A-Za-z0-9_-]{1,200}$'
    order by job.verified_at,job.source_key limit 1
  ) receipt on true
$function$;

create or replace function private.request_archive_record_v3039(p_row jsonb,p_financials boolean)
returns jsonb language sql stable set search_path='' as $function$
  select jsonb_build_object('kind','record','id',p_row->>'unique_id',
    'archivePath',to_jsonb(public.request_archive_path_v3039(p_row)),
    'title',coalesce(nullif(p_row->>'commonname',''),p_row->>'itemcode'),
    'subtitle',array_to_string(public.request_archive_path_v3039(p_row),' / '),
    'status',coalesce(nullif(p_row->>'status',''),nullif(p_row->>'req_status',''),'Completed'),
    'occurredAt',coalesce(p_row->>'date_completed',p_row->>'requested_at',p_row->>'created_at'),
    'itemcode',coalesce(p_row->>'itemcode',''),'commonname',coalesce(p_row->>'commonname',''),
    'contsize',coalesce(p_row->>'contsize',''),'locationcode',coalesce(p_row->>'locationcode',''),
    'lotcode',coalesce(p_row->>'lotcode',''),'quantity',coalesce((p_row->>'request_qty')::numeric,(p_row->>'effective_qty')::numeric),
    'unitListPrice',case when p_financials then coalesce((p_row->>'unit_list_price')::numeric,(p_row->>'listprice')::numeric) end,
    'lineDollarValue',case when p_financials then p_row->'line_dollar_value' end,
    'photoDate',p_row->>'photo_date',
    'facts',jsonb_build_object('Sales Rep',p_row->>'sales_rep','Customer',p_row->>'customer_name',
      'Consignee',(public.request_archive_path_v3039(p_row))[3],'Folder',p_row->>'request_folder',
      'Spec',coalesce(p_row->>'spec',p_row->>'req_spec',p_row->>'request_spec'),
      'Caliper',coalesce(p_row->>'caliper',p_row->>'req_caliper',p_row->>'request_caliper'),
      'Loc Match %',p_row->'loc_match_pct','Loc Photo Match',p_row->'loc_photo_match',
      'Sent',p_row->>'date_completed','Delivery',coalesce(nullif(p_row->>'delivery_state',''),'unknown'),
      'Photo Notes',p_row->>'req_pic_note'),
    'notes',to_jsonb(array_remove(array[p_row->>'pick_note',p_row->>'av_note',p_row->>'sales_note',p_row->>'comments'],null)))
  ||private.request_archive_photos_v3039(private.archive_photo_array_v2366(p_row->'photos',
      array[p_row->>'photo_url',p_row->>'req_photo_link',p_row->>'photo_link']))
$function$;

create or replace function private.request_archive_rows_v3039(p_actor uuid,p_query jsonb,p_global boolean,p_financials boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare selected_path text[]; depth integer:=jsonb_array_length(p_query->'path'); result jsonb;
begin
  select coalesce(array_agg(value order by ordinality),'{}'::text[]) into selected_path
    from jsonb_array_elements_text(p_query->'path') with ordinality paths(value,ordinality);
  if p_query->>'operation'='archive-folders' then
    with matching as materialized (
      select h.archive_path,h.line_dollar_value from public.ph_request_archive_catalog_v3039 h
      where (p_global or h.assigned_rep_id=p_actor) and (depth=0 or h.archive_path[1:depth]=selected_path)
    ), grouped as (
      select archive_path[depth+1] value,count(*) records,sum(line_dollar_value) amount from matching group by 1
    ), paged as (
      select * from grouped order by lower(value),value offset (p_query->>'page')::integer*(p_query->>'pageSize')::integer
        limit (p_query->>'pageSize')::integer
    ) select jsonb_build_object('total',(select count(*) from grouped),'rows',coalesce(jsonb_agg(
      jsonb_build_object('kind','folder','key',md5(selected_path::text||':'||value),'value',value,'label',value,
        'subtitle',(array['Sales Rep','Customer','Consignee','Request','Item'])[depth+1],
        'recordCount',records,'totalValue',case when p_financials then coalesce(amount,0) end)
      order by lower(value),value),'[]'::jsonb)) into result from paged;
  else
    with matching as materialized (
      select h.* from public.ph_request_archive_catalog_v3039 h where (p_global or h.assigned_rep_id=p_actor)
        and (p_query->>'operation'='archive-search' or h.archive_path=selected_path)
        and (p_query->>'operation'<>'archive-search'
          or lower(concat_ws(' ',h.commonname,h.itemcode,h.locationcode,array_to_string(h.archive_path,' ')))
            like '%'||lower(btrim(p_query->>'query'))||'%'
          or lower(concat_ws(' ',coalesce(h.itemcode,''),coalesce(h.commonname,''),coalesce(h.locationcode,''),
            coalesce(h.customer_name,h.customername,''),coalesce(h.consignee_name,h.consigneename,''),
            coalesce(h.request_folder,''))) like '%'||lower(btrim(p_query->>'query'))||'%')
    ), paged as (
      select * from matching order by coalesce(date_completed,requested_at,created_at) desc nulls last,unique_id
        offset (p_query->>'page')::integer*(p_query->>'pageSize')::integer limit (p_query->>'pageSize')::integer
    ) select jsonb_build_object('total',(select count(*) from matching),'rows',coalesce(jsonb_agg(
      private.request_archive_record_v3039(to_jsonb(paged),p_financials)
      order by coalesce(date_completed,requested_at,created_at) desc nulls last,unique_id),'[]'::jsonb)) into result from paged;
  end if;
  return result;
end
$function$;

create or replace function private.request_archive_scope_v3039(p_actor uuid,p_view text)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare global_scope boolean; revision_value text;
begin
  perform sales_private.actor(p_actor);
  if private.navigation_module_allowed_v1(p_actor,p_view) is not true then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_FORBIDDEN';
  end if;
  global_scope:=private.history_dylan_financial_v1(p_actor);
  select 'history-fast-v2366:'||coalesce(string_agg(source.key||':'||source.revision,',' order by source.key),'ready')
    into revision_value from public.app_dataset_revisions source
    where source.key=any(array['ph_requests_completed_history','ph_requests_pending']);
  return jsonb_build_object('scope',case when global_scope then 'all' else 'own' end,
    'financials',global_scope,'ownRepKey','rep:'||p_actor::text,'revision',revision_value);
end
$function$;

create or replace function public.historical_request_archive_read_v3039(p_actor_id uuid,p_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='2s' as $function$
declare query jsonb; scope jsonb; financials boolean;
begin
  query:=private.request_archive_query_v3039(p_query);
  scope:=private.request_archive_scope_v3039(p_actor_id,coalesce(query->>'view','historical-requests'));
  financials:=scope->>'scope'='all' and (scope->>'financials')::boolean;
  return private.request_archive_rows_v3039(p_actor_id,query,scope->>'scope'='all',financials)
    ||jsonb_build_object('scope',scope->>'scope','financials',financials,'ownRepKey',scope->>'ownRepKey',
      'recordKind','requests','operation',query->>'operation','path',query->'path',
      'depth',jsonb_array_length(query->'path'),'maxDepth',5,'revision',scope->>'revision',
      'generatedAt',clock_timestamp(),'page',(query->>'page')::integer,'pageSize',(query->>'pageSize')::integer);
end
$function$;

-- Preserve the existing Edge RPC and its authorization for the other archives.
create or replace function public.historical_archive_read_v2370(p_actor_id uuid,p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='12s' as $function$
begin
  if p_query->>'recordKind'='requests' then
    return public.historical_request_archive_read_v3039(p_actor_id,p_query);
  end if;
  perform sales_private.actor(p_actor_id);
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
  return public.historical_archive_read_v2368(p_query);
end
$function$;

-- Exact party lookup uses the two lowercase btree indexes. It is separate from
-- the general text search and never runs the contains query for a named party.
create or replace function public.historical_request_party_lookup_v3039(
  p_actor_id uuid,p_customer_name text default null,p_consignee_name text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='2s' as $function$
declare customer text:=nullif(btrim(p_customer_name),''); consignee text:=nullif(btrim(p_consignee_name),'');
  scope jsonb; predicate text; financials boolean; result jsonb;
begin
  if (customer is null and consignee is null) or length(customer)>300 or length(consignee)>300
    or p_limit is null or p_limit not between 1 and 100 then raise exception 'HISTORICAL_REQUEST_PARTY_LOOKUP_INVALID' using errcode='22023'; end if;
  scope:=private.request_archive_scope_v3039(p_actor_id,'historical-requests');
  financials:=scope->>'scope'='all' and (scope->>'financials')::boolean;
  predicate:=case when customer is not null and consignee is not null then 'lower(h.customer_name)=$2 and lower(h.consignee_name)=$3'
    when customer is not null then 'lower(h.customer_name)=$2' else 'lower(h.consignee_name)=$3' end;
  execute format($query$
    with matched as materialized (
      select h.* from public.ph_requests_completed_history h where %s and ($4 or h.assigned_rep_id=$1)
      order by h.requested_at desc nulls last,h.unique_id limit $5+1
    ), bounded as (select * from matched order by requested_at desc nulls last,unique_id limit $5)
    select jsonb_build_object('rows',coalesce(jsonb_agg(private.request_archive_record_v3039(to_jsonb(bounded),$6)
      order by requested_at desc nulls last,unique_id),'[]'::jsonb),'returnedCount',count(*),
      'hasMore',(select count(*) from matched)>$5) from bounded
  $query$,predicate) into result using p_actor_id,lower(customer),lower(consignee),scope->>'scope'='all',p_limit,financials;
  return result||jsonb_build_object('scope',scope->>'scope','financials',financials,'revision',scope->>'revision');
end
$function$;

revoke all on function private.request_archive_query_v3039(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.request_archive_photos_v3039(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.request_archive_record_v3039(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function private.request_archive_rows_v3039(uuid,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function private.request_archive_scope_v3039(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.historical_request_archive_read_v3039(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.historical_request_archive_read_v3039(uuid,jsonb) to service_role;
revoke all on function public.historical_archive_read_v2370(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.historical_archive_read_v2370(uuid,jsonb) to service_role;
revoke all on function public.historical_request_party_lookup_v3039(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.historical_request_party_lookup_v3039(uuid,text,text,integer) to service_role;
commit;
