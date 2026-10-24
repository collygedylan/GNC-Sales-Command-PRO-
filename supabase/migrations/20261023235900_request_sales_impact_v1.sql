begin;

create or replace function private.request_sales_numeric_v1(p_value text)
returns numeric
language sql
immutable
parallel safe
set search_path=''
as $fn$
  select case
    when nullif(btrim(coalesce(p_value,'')),'') is null then null
    when regexp_replace(p_value,'[$,[:space:]]','','g') ~ '^-?[0-9]+([.][0-9]+)?$'
      then regexp_replace(p_value,'[$,[:space:]]','','g')::numeric
    else null
  end
$fn$;

revoke all on function private.request_sales_numeric_v1(text) from public,anon,authenticated;
grant execute on function private.request_sales_numeric_v1(text) to service_role;

create or replace function public.get_request_sales_impact_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $fn$
with outbox_events as materialized (
  select event_id,event_type,request_id,request_folder,payload,created_at
  from public.ph_request_delivery_outbox
  where event_type in (
    'request_created','request_completed','New Plant Request Submitted','Plant Request Completed!'
  )
), outbox_json as (
  select 'ph_request_delivery_outbox'::text source_table,3 source_rank,o.event_id::text source_id,
    entry.value||jsonb_build_object(
      '_outbox_request_id',o.request_id,
      '_outbox_request_folder',o.request_folder,
      '_outbox_event_type',o.event_type,
      '_outbox_created_at',o.created_at
    ) row_data
  from outbox_events o
  cross join lateral jsonb_array_elements(
    (case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'items')='array' then o.payload->'items' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'rows')='array' then o.payload->'rows' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'selected_rows')='array' then o.payload->'selected_rows' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'Selected Request Rows')='array' then o.payload->'Selected Request Rows' else '[]'::jsonb end)
  ) entry(value)
  where jsonb_typeof(entry.value)='object'
), outbox_html_events as (
  select o.*,coalesce(
    nullif(o.payload->>'html',''),nullif(o.payload->>'html_body',''),
    nullif(o.payload->>'body_html',''),nullif(o.payload->>'message_html',''),'') html
  from outbox_events o
), outbox_html_rows as (
  select event.event_id,event.event_type,event.request_id,event.request_folder,event.payload,event.created_at,
    row_match.parts[1] row_html,row_match.row_ordinal
  from outbox_html_events event
  cross join lateral regexp_matches(event.html,'<tr[^>]*>(.*?)</tr>','gis')
    with ordinality as row_match(parts,row_ordinal)
  where event.html<>''
), outbox_html_cells as (
  select row.event_id,row.event_type,row.request_id,row.request_folder,row.payload,row.created_at,row.row_ordinal,
    array_agg(
      btrim(regexp_replace(
        replace(replace(replace(replace(replace(
          regexp_replace(regexp_replace(cell.parts[1],'<br[[:space:]]*/?>',' ','gi'),'<[^>]+>',' ','g'),
          '&nbsp;',' '),'&amp;','&'),'&#39;',chr(39)),'&quot;','"'),'&reg;',chr(174)),
        '[[:space:]]+',' ','g')) order by cell.cell_ordinal
    ) cells
  from outbox_html_rows row
  cross join lateral regexp_matches(row.row_html,'<t[dh][^>]*>(.*?)</t[dh]>','gis')
    with ordinality as cell(parts,cell_ordinal)
  group by row.event_id,row.event_type,row.request_id,row.request_folder,row.payload,row.created_at,row.row_ordinal
), outbox_html as (
  select 'ph_request_delivery_outbox'::text source_table,4 source_rank,cell.event_id::text source_id,
    jsonb_build_object(
      'request_folder',coalesce(nullif(cell.request_folder,''),cell.payload->>'request_folder'),
      'request_id',cell.request_id,
      'itemcode',cell.cells[1],
      'commonname',cell.cells[2],
      'contsize',cell.cells[3],
      'lotcode',cell.cells[4],
      'locationcode',cell.cells[5],
      'req_qty',case when cardinality(cell.cells)>=6 then cell.cells[6] else null end,
      'req_status',case when cell.event_type in ('request_completed','Plant Request Completed!') then 'Completed' else 'Pending' end,
      'created_at',cell.created_at,
      '_outbox_event_type',cell.event_type
    ) row_data
  from outbox_html_cells cell
  where cardinality(cell.cells)>=5
    and nullif(btrim(cell.cells[1]),'') is not null
    and upper(btrim(cell.cells[1])) not in ('ITEMCODE','ITEM CODE')
    and not exists(select 1 from outbox_json json where json.source_id=cell.event_id::text)
), request_sources as materialized (
  select 'ph_request_history'::text source_table,1 source_rank,id::text source_id,to_jsonb(history) row_data
  from public.ph_request_history history
  union all
  select 'ph_active_request'::text,2,id::text,to_jsonb(active)
  from public.ph_active_request active
  union all
  select source_table,source_rank,source_id,row_data from outbox_json
  union all
  select source_table,source_rank,source_id,row_data from outbox_html
), extracted as (
  select source_table,source_rank,source_id,row_data,
    coalesce(
      nullif(btrim(row_data->>'request_folder'),''),nullif(btrim(row_data->>'folder_id'),''),
      nullif(btrim(row_data->>'folder'),''),nullif(btrim(row_data->>'request_key'),''),
      nullif(btrim(row_data->>'_outbox_request_folder'),''),nullif(btrim(row_data->>'client_batch_id'),''),
      nullif(btrim(row_data->>'request_id'),''),nullif(btrim(row_data->>'_outbox_request_id'),''),
      source_table||':'||source_id
    ) request_key,
    coalesce(nullif(btrim(row_data->>'request_folder'),''),nullif(btrim(row_data->>'folder_id'),''),
      nullif(btrim(row_data->>'folder'),''),nullif(btrim(row_data->>'_outbox_request_folder'),''),
      nullif(btrim(row_data->>'request_id'),''),nullif(btrim(row_data->>'_outbox_request_id'),''),source_id) folder_id,
    coalesce(nullif(btrim(row_data->>'itemcode'),''),nullif(btrim(row_data->>'item_code'),'')) itemcode,
    coalesce(nullif(btrim(row_data->>'commonname'),''),nullif(btrim(row_data->>'common_name'),'')) commonname,
    coalesce(nullif(btrim(row_data->>'contsize'),''),nullif(btrim(row_data->>'container_size'),''),
      nullif(btrim(row_data->>'size'),'')) contsize,
    coalesce(nullif(btrim(row_data->>'lotcode'),''),nullif(btrim(row_data->>'lot_code'),'')) lotcode,
    coalesce(nullif(btrim(row_data->>'locationcode'),''),nullif(btrim(row_data->>'location_code'),'')) locationcode,
    coalesce(
      nullif(btrim(row_data->>'request_selected_rep_display'),''),nullif(btrim(row_data->>'request_selected_rep_username'),''),
      nullif(btrim(row_data->>'sales_rep'),''),nullif(btrim(row_data->>'sales_rep_name'),''),
      nullif(btrim(row_data->>'requested_by'),'')
    ) sales_rep,
    coalesce(
      nullif(btrim(row_data->>'customername'),''),nullif(btrim(row_data->>'customer_name'),''),
      nullif(btrim(row_data->>'request_customer'),''),
      nullif(btrim(split_part(coalesce(row_data->>'req_customer',''),'|',1)),'')
    ) customer_name,
    coalesce(
      nullif(btrim(row_data->>'consigneename'),''),nullif(btrim(row_data->>'consignee_name'),''),
      nullif(btrim(case when position('|' in coalesce(row_data->>'req_customer',''))>0
        then split_part(row_data->>'req_customer','|',2) else row_data->>'req_customer' end),'')
    ) consignee_name,
    coalesce(nullif(btrim(row_data->>'created_at'),''),nullif(btrim(row_data->>'requested_at'),''),
      nullif(btrim(row_data->>'request_date'),''),nullif(btrim(row_data->>'date'),''),
      nullif(btrim(row_data->>'_outbox_created_at'),'')) request_date,
    private.request_sales_numeric_v1(coalesce(
      row_data->>'req_qty',row_data->>'qty',row_data->>'quantity',row_data->>'request_qty',
      row_data->>'requested_qty',row_data->>'qty_requested',row_data->>'order_qty'
    )) raw_qty,
    private.request_sales_numeric_v1(coalesce(
      row_data->>'listprice',row_data->>'list_price',row_data->>'unit_list_price',row_data->>'price'
    )) row_list_price,
    lower(btrim(coalesce(row_data->>'req_status',row_data->>'status',''))) ~ '(complete|fulfilled|done|closed|archiv)'
      or lower(btrim(coalesce(row_data->>'req_archived','false')))='true'
      or nullif(btrim(coalesce(row_data->>'date_completed',row_data->>'completed_at','')),'') is not null
      or coalesce(row_data->>'_outbox_event_type','') in ('request_completed','Plant Request Completed!') is_completed
  from request_sources
), normalized as (
  select extracted.*,
    lower(regexp_replace(request_key,'[[:space:]]+',' ','g')) request_key_norm,
    lower(regexp_replace(coalesce(itemcode,''),'[[:space:]]+','','g')) item_key,
    lower(regexp_replace(coalesce(commonname,''),'[[:space:]]+',' ','g')) common_key,
    upper(regexp_replace(coalesce(contsize,''),'[[:space:]]+',' ','g')) size_key,
    lower(regexp_replace(coalesce(locationcode,''),'[[:space:]]+','','g')) location_key,
    lower(regexp_replace(coalesce(lotcode,''),'[[:space:]]+','','g')) lot_key
  from extracted
), keyed as (
  select normalized.*,
    case when item_key<>'' then item_key else 'name:'||common_key||'|size:'||size_key end dedupe_item_key
  from normalized
  where item_key<>'' or common_key<>''
), deduplicated as (
  select request_key_norm,dedupe_item_key,location_key,lot_key,
    (array_agg(folder_id order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(folder_id,'') is not null))[1] folder_id,
    (array_agg(itemcode order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(itemcode,'') is not null))[1] itemcode,
    (array_agg(commonname order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(commonname,'') is not null))[1] commonname,
    (array_agg(contsize order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(contsize,'') is not null))[1] contsize,
    (array_agg(lotcode order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(lotcode,'') is not null))[1] lotcode,
    (array_agg(locationcode order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(locationcode,'') is not null))[1] locationcode,
    coalesce((array_agg(sales_rep order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(sales_rep,'') is not null))[1],'Unassigned') sales_rep,
    coalesce((array_agg(customer_name order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(customer_name,'') is not null))[1],'Unknown Customer') customer_name,
    coalesce((array_agg(consignee_name order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(consignee_name,'') is not null))[1],'N/A') consignee_name,
    min(request_date) filter(where nullif(request_date,'') is not null) request_date,
    (array_agg(raw_qty order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where raw_qty>0))[1] raw_qty,
    (array_agg(row_list_price order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where row_list_price>0))[1] row_list_price,
    bool_or(is_completed) is_completed,
    string_agg(distinct source_table,',' order by source_table) source_tables
  from keyed
  group by request_key_norm,dedupe_item_key,location_key,lot_key
), catalog_source as (
  select 1 source_priority,itemcode,commonname,contsize,listprice price from public.ph_master_inventory
  union all
  select 2,itemcode,commonname,contsize,listprice from public.ph_view_av_hot_price
  union all
  select 3,itemcode,commonname,contsize,coalesce(nullif(unitprice,''),unit_price) from public.ph_cav_import
), catalog_normalized as (
  select source_priority,
    lower(regexp_replace(coalesce(itemcode,''),'[[:space:]]+','','g')) item_key,
    lower(regexp_replace(coalesce(commonname,''),'[[:space:]]+',' ','g')) common_key,
    upper(regexp_replace(coalesce(contsize,''),'[[:space:]]+',' ','g')) size_key,
    private.request_sales_numeric_v1(price) list_price
  from catalog_source
), catalog_by_item as (
  select distinct on(item_key) item_key,list_price
  from catalog_normalized
  where item_key<>'' and list_price>0
  order by item_key,source_priority,list_price desc
), catalog_by_name as (
  select distinct on(common_key,size_key) common_key,size_key,list_price
  from catalog_normalized
  where common_key<>'' and size_key<>'' and list_price>0
  order by common_key,size_key,source_priority,list_price desc
), valued as materialized (
  select d.request_key_norm,d.folder_id,d.itemcode,d.commonname,d.contsize,d.lotcode,d.locationcode,
    d.sales_rep,d.customer_name,d.consignee_name,
    d.customer_name||' / '||d.consignee_name customer_consignee_label,
    d.request_date,case when d.is_completed then 'Completed' else 'Pending' end status,
    d.raw_qty,coalesce(d.raw_qty,25::numeric) effective_qty,d.raw_qty is null is_default_qty,
    round(coalesce(d.row_list_price,item_price.list_price,name_price.list_price,0::numeric),2) list_price,
    round(coalesce(d.raw_qty,25::numeric)*coalesce(d.row_list_price,item_price.list_price,name_price.list_price,0::numeric),2) line_dollar_value,
    d.source_tables
  from deduplicated d
  left join catalog_by_item item_price on item_price.item_key=lower(regexp_replace(coalesce(d.itemcode,''),'[[:space:]]+','','g'))
  left join catalog_by_name name_price
    on name_price.common_key=lower(regexp_replace(coalesce(d.commonname,''),'[[:space:]]+',' ','g'))
   and name_price.size_key=upper(regexp_replace(coalesce(d.contsize,''),'[[:space:]]+',' ','g'))
), summary as (
  select round(coalesce(sum(line_dollar_value),0),2) total_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
    count(distinct request_key_norm) total_requests,count(*) total_line_items,
    coalesce(sum(effective_qty),0) total_units_requested,
    count(*) filter(where not is_default_qty) explicit_qty_line_count,
    count(*) filter(where is_default_qty) default_25_qty_line_count
  from valued
), sales_rep_rollups as (
  select sales_rep,round(sum(line_dollar_value),2) total_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
    count(distinct request_key_norm) request_count,count(*) line_item_count,sum(effective_qty) total_units,
    count(distinct lower(customer_name)||'|'||lower(consignee_name)) customer_count,
    round(sum(line_dollar_value)/greatest(count(distinct request_key_norm),1),2) avg_dollar_per_request
  from valued group by sales_rep
), customer_rollups as (
  select customer_name,consignee_name,customer_consignee_label,sales_rep,
    round(sum(line_dollar_value),2) total_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
    count(distinct request_key_norm) request_count,count(*) line_item_count,sum(effective_qty) total_units,
    jsonb_agg(jsonb_build_object(
      'folder_id',folder_id,'date',request_date,'request_date',request_date,'requested_at',request_date,
      'status',status,'sales_rep',sales_rep,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
      'lotcode',lotcode,'locationcode',locationcode,'raw_qty',raw_qty,'effective_qty',effective_qty,
      'qty_used',effective_qty,'is_default_qty',is_default_qty,'qty_is_default',is_default_qty,
      'list_price',list_price,'unit_list_price',list_price,'line_dollar_value',line_dollar_value,
      'source_tables',source_tables
    ) order by request_date desc nulls last,itemcode,locationcode,lotcode) items
  from valued
  group by customer_name,consignee_name,customer_consignee_label,sales_rep
), source_counts as (
  select source_table,count(*) row_count from request_sources group by source_table
)
select jsonb_build_object(
  'summary',(select jsonb_build_object(
    'total_dollar_value',total_dollar_value,
    'completed_dollar_value',completed_dollar_value,
    'pending_dollar_value',pending_dollar_value,
    'total_requests',total_requests,'total_requests_count',total_requests,
    'total_line_items',total_line_items,'total_line_items_count',total_line_items,
    'total_units_requested',total_units_requested,'total_effective_units',total_units_requested,
    'explicit_qty_line_count',explicit_qty_line_count,'explicit_qty_items_count',explicit_qty_line_count,
    'default_25_qty_line_count',default_25_qty_line_count,'default_25_qty_items_count',default_25_qty_line_count
  ) from summary),
  'by_sales_rep',coalesce((select jsonb_agg(jsonb_build_object(
    'sales_rep',sales_rep,'total_dollar_value',total_dollar_value,
    'completed_dollar_value',completed_dollar_value,'pending_dollar_value',pending_dollar_value,
    'request_count',request_count,'line_item_count',line_item_count,'item_count',line_item_count,
    'total_units',total_units,'customer_count',customer_count,
    'avg_dollar_per_request',avg_dollar_per_request,'avg_request_dollar_value',avg_dollar_per_request
  ) order by total_dollar_value desc,sales_rep) from sales_rep_rollups),'[]'::jsonb),
  'by_customer_consignee',coalesce((select jsonb_agg(jsonb_build_object(
    'customer_name',customer_name,'consignee_name',consignee_name,
    'customer_consignee_label',customer_consignee_label,'sales_rep',sales_rep,'primary_sales_rep',sales_rep,
    'total_dollar_value',total_dollar_value,'completed_dollar_value',completed_dollar_value,
    'pending_dollar_value',pending_dollar_value,'request_count',request_count,
    'line_item_count',line_item_count,'item_count',line_item_count,'total_units',total_units,'items',items
  ) order by total_dollar_value desc,customer_consignee_label,sales_rep) from customer_rollups),'[]'::jsonb),
  'line_items',coalesce((select jsonb_agg(jsonb_build_object(
    'folder_id',folder_id,'request_date',request_date,'status',status,'sales_rep',sales_rep,
    'customer_name',customer_name,'consignee_name',consignee_name,
    'customer_consignee_label',customer_consignee_label,'itemcode',itemcode,'commonname',commonname,
    'contsize',contsize,'lotcode',lotcode,'locationcode',locationcode,'raw_qty',raw_qty,
    'effective_qty',effective_qty,'is_default_qty',is_default_qty,'list_price',list_price,
    'line_dollar_value',line_dollar_value,'source_tables',source_tables
  ) order by request_date desc nulls last,folder_id,itemcode,locationcode,lotcode) from valued),'[]'::jsonb),
  'source_audit',jsonb_build_object(
    'included',coalesce((select jsonb_agg(jsonb_build_object('table',source_table,'rows',row_count) order by source_table) from source_counts),'[]'::jsonb),
    'price_catalogs',jsonb_build_array('ph_master_inventory','ph_view_av_hot_price','ph_cav_import'),
    'unavailable_legacy_tables',jsonb_build_array(
      'ph_archived_requests','ph_historical_requests','ph_sales_requests','ph_request_folders','ph_request_items'
    )
  )
)
$fn$;

comment on function public.get_request_sales_impact_v1() is
  'Service-role-only Request sales impact rollup across active, canonical history, and structured/HTML delivery evidence with folder-item-location-lot deduplication.';

revoke all on function public.get_request_sales_impact_v1() from public,anon,authenticated;
grant execute on function public.get_request_sales_impact_v1() to service_role;

commit;
