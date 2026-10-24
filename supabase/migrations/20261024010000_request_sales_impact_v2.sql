begin;

create or replace function public.get_request_sales_impact_v2()
returns jsonb
language sql
stable
security definer
set search_path=''
set statement_timeout='60s'
as $fn$
with outbox_events as materialized (
  select event_id,event_type,request_id,request_folder,payload,created_at,gmail_thread_id
  from public.ph_request_delivery_outbox
  where event_type in (
    'request_created','request_completed','New Plant Request Submitted','Plant Request Completed!'
  )
), outbox_json as (
  select 'ph_request_delivery_outbox'::text source_table,3 source_rank,o.event_id::text source_id,
    entry.row_ordinal::bigint source_row_index,
    entry.value||jsonb_build_object(
      '_outbox_request_id',o.request_id,
      '_outbox_request_folder',o.request_folder,
      '_outbox_event_type',o.event_type,
      '_outbox_created_at',o.created_at,
      '_outbox_gmail_thread_id',o.gmail_thread_id,
      '_outbox_row_index',entry.row_ordinal
    ) row_data
  from outbox_events o
  cross join lateral jsonb_array_elements(
    (case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'items')='array' then o.payload->'items' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'rows')='array' then o.payload->'rows' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'selected_rows')='array' then o.payload->'selected_rows' else '[]'::jsonb end)
    ||(case when jsonb_typeof(o.payload->'Selected Request Rows')='array' then o.payload->'Selected Request Rows' else '[]'::jsonb end)
  ) with ordinality as entry(value,row_ordinal)
  where jsonb_typeof(entry.value)='object'
), outbox_html_events as (
  select o.*,coalesce(
    nullif(o.payload->>'html',''),nullif(o.payload->>'html_body',''),
    nullif(o.payload->>'body_html',''),nullif(o.payload->>'message_html',''),'') html
  from outbox_events o
), outbox_html_rows as (
  select event.event_id,event.event_type,event.request_id,event.request_folder,event.payload,event.created_at,
    event.gmail_thread_id,row_match.parts[1] row_html,row_match.row_ordinal
  from outbox_html_events event
  cross join lateral regexp_matches(event.html,'<tr[^>]*>(.*?)</tr>','gis')
    with ordinality as row_match(parts,row_ordinal)
  where event.html<>''
), outbox_html_cells as (
  select row.event_id,row.event_type,row.request_id,row.request_folder,row.payload,row.created_at,row.gmail_thread_id,
    row.row_ordinal,
    array_agg(
      btrim(regexp_replace(
        replace(replace(replace(replace(replace(
          regexp_replace(regexp_replace(cell.parts[1],'<br[[:space:]]*/?>',' ','gi'),'<[^>]+>',' ','g'),
          '&nbsp;',' '),'&amp;','&'),'&#39;',chr(39)),'&quot;',chr(34)),'&reg;',chr(174)),
        '[[:space:]]+',' ','g')) order by cell.cell_ordinal
    ) cells
  from outbox_html_rows row
  cross join lateral regexp_matches(row.row_html,'<t[dh][^>]*>(.*?)</t[dh]>','gis')
    with ordinality as cell(parts,cell_ordinal)
  group by row.event_id,row.event_type,row.request_id,row.request_folder,row.payload,row.created_at,
    row.gmail_thread_id,row.row_ordinal
), outbox_html as (
  select 'ph_request_delivery_outbox'::text source_table,4 source_rank,cell.event_id::text source_id,
    cell.row_ordinal::bigint source_row_index,
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
      '_outbox_event_type',cell.event_type,
      '_outbox_gmail_thread_id',cell.gmail_thread_id,
      '_outbox_row_index',cell.row_ordinal
    ) row_data
  from outbox_html_cells cell
  where cardinality(cell.cells)>=5
    and nullif(btrim(cell.cells[1]),'') is not null
    and upper(btrim(cell.cells[1])) not in ('ITEMCODE','ITEM CODE')
    and not exists(select 1 from outbox_json json where json.source_id=cell.event_id::text)
), request_sources as materialized (
  select 'ph_request_history'::text source_table,1 source_rank,id::text source_id,1::bigint source_row_index,
    coalesce(snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(history)) row_data
  from public.ph_request_history history
  union all
  select 'ph_active_request'::text,2,id::text,1::bigint,to_jsonb(active)
  from public.ph_active_request active
  union all
  select source_table,source_rank,source_id,source_row_index,row_data from outbox_json
  union all
  select source_table,source_rank,source_id,source_row_index,row_data from outbox_html
), extracted as (
  select source_table,source_rank,source_id,source_row_index,row_data,
    source_table||':'||source_id source_row_id,
    coalesce(nullif(btrim(row_data->>'unique_id'),''),nullif(btrim(row_data->>'request_unique_id'),''),
      nullif(btrim(row_data->>'master_unique_id'),'')) stable_line_id,
    coalesce(nullif(btrim(row_data->>'request_folder'),''),nullif(btrim(row_data->>'folder_id'),''),
      nullif(btrim(row_data->>'folder'),''),nullif(btrim(row_data->>'_outbox_request_folder'),'')) request_folder,
    coalesce(nullif(btrim(row_data->>'request_id'),''),nullif(btrim(row_data->>'_outbox_request_id'),''),
      nullif(btrim(row_data->>'client_batch_id'),'')) request_reference,
    coalesce(nullif(btrim(row_data->>'email_thread_id'),''),nullif(btrim(row_data->>'gmail_thread_id'),''),
      nullif(btrim(row_data->>'thread_id'),''),nullif(btrim(row_data->>'_outbox_gmail_thread_id'),'')) email_thread_id,
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
    coalesce(row_data->>'_outbox_event_type',row_data->>'last_event','') event_kind,
    lower(btrim(coalesce(row_data->>'req_status',row_data->>'status',''))) ~ '(complete|fulfilled|done|closed|archiv)'
      or lower(btrim(coalesce(row_data->>'req_archived','false')))='true'
      or nullif(btrim(coalesce(row_data->>'date_completed',row_data->>'completed_at','')),'') is not null
      or coalesce(row_data->>'_outbox_event_type','') in ('request_completed','Plant Request Completed!') is_completed
  from request_sources
), normalized as (
  select extracted.*,
    lower(regexp_replace(coalesce(stable_line_id,''),'[[:space:]]+','','g')) stable_line_id_norm,
    lower(regexp_replace(coalesce(request_folder,''),'[[:space:]]+',' ','g')) request_folder_norm,
    lower(regexp_replace(coalesce(request_reference,''),'[[:space:]]+',' ','g')) request_reference_norm,
    lower(regexp_replace(coalesce(email_thread_id,''),'[[:space:]]+','','g')) email_thread_id_norm,
    lower(regexp_replace(coalesce(itemcode,''),'[[:space:]]+','','g')) item_key,
    lower(regexp_replace(coalesce(commonname,''),'[[:space:]]+',' ','g')) common_key,
    upper(regexp_replace(coalesce(contsize,''),'[[:space:]]+',' ','g')) size_key,
    lower(regexp_replace(coalesce(locationcode,''),'[[:space:]]+','','g')) location_key,
    lower(regexp_replace(coalesce(lotcode,''),'[[:space:]]+','','g')) lot_key
  from extracted
), keyed_base as (
  select normalized.*,
    case when item_key<>'' then item_key else 'name:'||common_key||'|size:'||size_key end dedupe_item_key
  from normalized
  where item_key<>'' or common_key<>''
), keyed as materialized (
  select keyed_base.*,
    case
      when stable_line_id_norm<>'' then 'uid:'||stable_line_id_norm
      when source_table='ph_request_delivery_outbox' and request_folder_norm<>'' then
        'folder:'||request_folder_norm||'|item:'||dedupe_item_key||'|location:'||location_key||'|lot:'||lot_key||'|row:'||source_row_index::text
      when source_table='ph_request_delivery_outbox' and email_thread_id_norm<>'' then
        'thread:'||email_thread_id_norm||'|item:'||dedupe_item_key||'|location:'||location_key||'|lot:'||lot_key||'|row:'||source_row_index::text
      when source_table='ph_request_delivery_outbox' and request_reference_norm<>'' then
        'request:'||request_reference_norm||'|item:'||dedupe_item_key||'|location:'||location_key||'|lot:'||lot_key||'|row:'||source_row_index::text
      else 'source:'||source_table||':'||source_id||'|date:'||coalesce(request_date,'')||'|thread:'||email_thread_id_norm||'|row:'||source_row_index::text
    end line_identity_key,
    case
      when request_folder_norm<>'' then 'folder:'||request_folder_norm
      when request_reference_norm<>'' then 'request:'||request_reference_norm
      when email_thread_id_norm<>'' then 'thread:'||email_thread_id_norm
      else 'source:'||source_table||':'||source_id||'|date:'||coalesce(request_date,'')
    end request_identity,
    event_kind in ('request_created','New Plant Request Submitted') is_submitted_event,
    event_kind in ('request_completed','Plant Request Completed!') is_completed_event
  from keyed_base
), deduplicated as (
  select line_identity_key,
    (array_agg(request_identity order by source_rank,is_completed desc,request_date desc nulls last))[1] request_identity,
    (array_agg(stable_line_id order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(stable_line_id,'') is not null))[1] unique_id,
    (array_agg(coalesce(request_folder,request_reference,source_row_id) order by source_rank,is_completed desc,request_date desc nulls last))[1] folder_id,
    (array_agg(source_row_id order by source_rank,is_completed desc,request_date desc nulls last))[1] source_row_id,
    (array_agg(source_row_index order by source_rank,is_completed desc,request_date desc nulls last))[1] row_index,
    (array_agg(email_thread_id order by source_rank,is_completed desc,request_date desc nulls last)
      filter(where nullif(email_thread_id,'') is not null))[1] email_thread_id,
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
    string_agg(distinct source_table,',' order by source_table) source_tables,
    string_agg(distinct source_row_id,',' order by source_row_id) source_row_ids
  from keyed
  group by line_identity_key
), catalog_source as (
  select 1 source_priority,itemcode,commonname,contsize,listprice price from public.ph_master_inventory
  union all
  select 2,itemcode,commonname,contsize,listprice from public.ph_view_av_hot_price
  union all
  select 3,itemcode,commonname,contsize,coalesce(nullif(unitprice,''),unit_price) from public.ph_cav_import
), catalog_normalized as materialized (
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
), catalog_by_size as (
  select size_key,round(avg(list_price),2) list_price
  from catalog_normalized
  where size_key<>'' and list_price>0
  group by size_key
), valued as materialized (
  select d.line_identity_key,d.request_identity,d.unique_id,d.folder_id,d.source_row_id,d.source_row_ids,d.row_index,
    d.email_thread_id,d.itemcode,d.commonname,d.contsize,d.lotcode,d.locationcode,
    d.sales_rep,d.customer_name,d.consignee_name,
    d.customer_name||' / '||d.consignee_name customer_consignee_label,
    d.request_date,case when d.is_completed then 'Completed' else 'Pending' end status,
    d.raw_qty,case when d.raw_qty>0 then d.raw_qty else 25::numeric end effective_qty,
    not coalesce(d.raw_qty>0,false) is_default_qty,
    round(coalesce(d.row_list_price,item_price.list_price,name_price.list_price,size_price.list_price,0::numeric),2) list_price,
    case when d.row_list_price>0 then 'request_row' when item_price.list_price>0 then 'itemcode'
      when name_price.list_price>0 then 'commonname_contsize' when size_price.list_price>0 then 'contsize_average'
      else 'unpriced' end price_source,
    round((case when d.raw_qty>0 then d.raw_qty else 25::numeric end)
      *coalesce(d.row_list_price,item_price.list_price,name_price.list_price,size_price.list_price,0::numeric),2) line_dollar_value,
    d.source_tables
  from deduplicated d
  left join catalog_by_item item_price on item_price.item_key=lower(regexp_replace(coalesce(d.itemcode,''),'[[:space:]]+','','g'))
  left join catalog_by_name name_price
    on name_price.common_key=lower(regexp_replace(coalesce(d.commonname,''),'[[:space:]]+',' ','g'))
   and name_price.size_key=upper(regexp_replace(coalesce(d.contsize,''),'[[:space:]]+',' ','g'))
  left join catalog_by_size size_price
    on size_price.size_key=upper(regexp_replace(coalesce(d.contsize,''),'[[:space:]]+',' ','g'))
), summary as (
  select round(coalesce(sum(line_dollar_value),0),2) total_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
    count(distinct request_identity) total_requests,count(*) total_line_items,
    coalesce(sum(effective_qty),0) total_units_requested,
    count(*) filter(where not is_default_qty) explicit_qty_line_count,
    count(*) filter(where is_default_qty) default_25_qty_line_count
  from valued
), sales_rep_rollups as (
  select sales_rep,round(sum(line_dollar_value),2) total_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
    count(distinct request_identity) request_count,count(*) line_item_count,sum(effective_qty) total_units,
    count(distinct lower(customer_name)||'|'||lower(consignee_name)) customer_count,
    round(sum(line_dollar_value)/greatest(count(distinct request_identity),1),2) avg_dollar_per_request
  from valued group by sales_rep
), customer_rollups as (
  select customer_name,consignee_name,customer_consignee_label,sales_rep,
    round(sum(line_dollar_value),2) total_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
    round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
    count(distinct request_identity) request_count,count(*) line_item_count,sum(effective_qty) total_units,
    jsonb_agg(jsonb_build_object(
      'line_identity_key',line_identity_key,'request_identity',request_identity,'unique_id',unique_id,
      'folder_id',folder_id,'source_row_id',source_row_id,'source_row_ids',source_row_ids,'row_index',row_index,
      'email_thread_id',email_thread_id,'date',request_date,'request_date',request_date,'requested_at',request_date,
      'status',status,'sales_rep',sales_rep,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
      'lotcode',lotcode,'locationcode',locationcode,'raw_qty',raw_qty,'effective_qty',effective_qty,
      'qty_used',effective_qty,'is_default_qty',is_default_qty,'qty_is_default',is_default_qty,
      'list_price',list_price,'unit_list_price',list_price,'price_source',price_source,
      'line_dollar_value',line_dollar_value,'source_tables',source_tables
    ) order by request_date desc nulls last,itemcode,locationcode,lotcode,row_index) items
  from valued
  group by customer_name,consignee_name,customer_consignee_label,sales_rep
), source_extract_counts as (
  select source_table,count(*) extracted_line_items,
    count(*)-count(distinct line_identity_key) duplicate_rows_within_table
  from keyed
  group by source_table
), dedupe_group_audit as (
  select line_identity_key,count(*) source_rows,bool_or(is_submitted_event) has_submitted,bool_or(is_completed_event) has_completed
  from keyed
  group by line_identity_key
), dedupe_stats as (
  select coalesce(sum(source_rows),0) total_extracted_line_items,count(*) final_deduplicated_line_items,
    coalesce(sum(source_rows-1),0) duplicate_source_rows_merged,
    count(*) filter(where source_rows>1) duplicate_line_groups,
    count(*) filter(where has_submitted and has_completed) duplicate_submitted_completed_pairs_merged
  from dedupe_group_audit
), raw_table_audit as materialized (
  select 'public'::text schema_name,'ph_active_request'::text table_name,'table'::text relation_type,
    count(*)::bigint total_raw_rows,count(*)::bigint request_related_rows,true included_in_rollup,
    'Canonical active request rows; cross-source copies merge by unique_id.'::text note from public.ph_active_request
  union all select 'public','ph_av_option_eval_requests','table',count(*),count(*),false,
    'Evaluation option requests are audited but are not plant sales request lines.' from public.ph_av_option_eval_requests
  union all select 'public','ph_inventory_edit_request_events','table',count(*),count(*),false,
    'Inventory edit workflow events are audited but excluded from sales impact.' from public.ph_inventory_edit_request_events
  union all select 'public','ph_inventory_edit_requests','table',count(*),count(*),false,
    'Inventory edit workflow requests are audited but excluded from sales impact.' from public.ph_inventory_edit_requests
  union all select 'public','ph_request_delivery_outbox','table',count(*),(select count(*) from outbox_events),true,
    'Only request-created and request-completed events are extracted; every JSON array element and HTML table row is scanned.' from public.ph_request_delivery_outbox
  union all select 'public','ph_request_delivery_worker_state','table',count(*),0,false,
    'Delivery worker state contains no request line items.' from public.ph_request_delivery_worker_state
  union all select 'public','ph_request_email_threads','table',count(*),count(*),false,
    'Thread metadata contains no item arrays; delivery outbox payloads are the line source.' from public.ph_request_email_threads
  union all select 'public','ph_request_history','table',count(*),count(*),true,
    'Canonical completed and historical request rows; every physical unique_id remains distinct.' from public.ph_request_history
  union all select 'public','ph_sales_credit_requests','table',count(*),count(*),false,
    'Sales credit workflow requests are audited but excluded from plant request impact.' from public.ph_sales_credit_requests
  union all select 'private','ph_request_archive_command_ledger','table',count(*),count(*),false,
    'Archive command ledger is supporting workflow evidence, not request line data.' from private.ph_request_archive_command_ledger
  union all select 'private','ph_request_folder_delivery_state','table',count(*),count(*),false,
    'Folder delivery state is supporting metadata; its lines already exist in canonical sources.' from private.ph_request_folder_delivery_state
  union all select 'private','ph_request_queue_removal_commands','table',count(*),count(*),false,
    'Queue removal commands are audited but excluded from sales impact.' from private.ph_request_queue_removal_commands
  union all select 'private','request_financial_admins_v1','table',count(*),0,false,
    'Financial administrator configuration contains no request rows.' from private.request_financial_admins_v1
  union all select 'private','request_financial_values_v1','table',count(*),count(*),false,
    'Derived financial trigger ledger is audited but excluded to prevent duplicate valuation.' from private.request_financial_values_v1
), unavailable_table_audit as (
  select 'public'::text schema_name,missing.table_name,'table'::text relation_type,null::bigint total_raw_rows,
    0::bigint request_related_rows,false included_in_rollup,
    'Relation is not present in the live schema; canonical history is ph_request_history.'::text note
  from (values ('ph_archived_requests'::text),('ph_historical_requests'),('ph_sales_requests'),
    ('ph_request_items'),('ph_request_folders')) missing(table_name)
), source_table_audit_rows as (
  select raw.schema_name,raw.table_name,raw.relation_type,raw.total_raw_rows,raw.request_related_rows,
    coalesce(extracted.extracted_line_items,0)::bigint extracted_line_items,
    coalesce(extracted.duplicate_rows_within_table,0)::bigint duplicate_rows_merged,
    true available,raw.included_in_rollup,raw.note
  from raw_table_audit raw
  left join source_extract_counts extracted on extracted.source_table=raw.table_name
  union all
  select missing.schema_name,missing.table_name,missing.relation_type,missing.total_raw_rows,missing.request_related_rows,
    0::bigint,0::bigint,false,missing.included_in_rollup,missing.note
  from unavailable_table_audit missing
), revision_audit as (
  select count(*) matching_current_rows,coalesce(max(revision) filter(where revision=46957),0) matched_revision,
    (select max(revision) from public.app_dataset_revisions) current_max_revision
  from public.app_dataset_revisions
  where revision=46957
), audit_payload as (
  select jsonb_build_object(
    'tables',coalesce((select jsonb_agg(jsonb_build_object(
      'schema_name',schema_name,'table_name',table_name,'relation_type',relation_type,
      'total_raw_rows',total_raw_rows,'request_related_rows',request_related_rows,
      'extracted_line_items',extracted_line_items,'duplicate_rows_merged',duplicate_rows_merged,
      'available',available,'included_in_rollup',included_in_rollup,'note',note
    ) order by schema_name,table_name) from source_table_audit_rows),'[]'::jsonb),
    'derived_views',jsonb_build_array(
      jsonb_build_object('view_name','public.ph_active_request_live_rows','source','public.ph_active_request'),
      jsonb_build_object('view_name','public.ph_historical_orders','source','public.ph_request_history + public.ph_active_request','note','Role-filtered projection; excluded to prevent double counting.'),
      jsonb_build_object('view_name','public.ph_request_delivery_status','source','public.ph_request_delivery_outbox'),
      jsonb_build_object('view_name','public.ph_request_queue_live_rows','source','public.ph_active_request')
    ),
    'price_catalogs',jsonb_build_array('ph_master_inventory','ph_view_av_hot_price','ph_cav_import'),
    'total_extracted_line_items',(select total_extracted_line_items from dedupe_stats),
    'duplicate_source_rows_merged',(select duplicate_source_rows_merged from dedupe_stats),
    'duplicate_line_groups',(select duplicate_line_groups from dedupe_stats),
    'duplicate_submitted_completed_pairs_merged',(select duplicate_submitted_completed_pairs_merged from dedupe_stats),
    'final_deduplicated_line_items',(select final_deduplicated_line_items from dedupe_stats),
    'grand_total_dollar_impact',(select total_dollar_value from summary),
    'revision_46957',(select jsonb_build_object(
      'matching_current_rows',matching_current_rows,'matched_revision',matched_revision,
      'current_max_revision',current_max_revision,
      'relationship','46957 is a global monotonic dataset revision marker, not a request-row count. No current row retains it after later dataset revisions supersede that marker.'
    ) from revision_audit)
  ) value
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
    'line_identity_key',line_identity_key,'request_identity',request_identity,'unique_id',unique_id,
    'folder_id',folder_id,'source_row_id',source_row_id,'source_row_ids',source_row_ids,'row_index',row_index,
    'email_thread_id',email_thread_id,'request_date',request_date,'status',status,'sales_rep',sales_rep,
    'customer_name',customer_name,'consignee_name',consignee_name,
    'customer_consignee_label',customer_consignee_label,'itemcode',itemcode,'commonname',commonname,
    'contsize',contsize,'lotcode',lotcode,'locationcode',locationcode,'raw_qty',raw_qty,
    'effective_qty',effective_qty,'is_default_qty',is_default_qty,'list_price',list_price,
    'price_source',price_source,'line_dollar_value',line_dollar_value,'source_tables',source_tables
  ) order by request_date desc nulls last,folder_id,itemcode,locationcode,lotcode,row_index) from valued),'[]'::jsonb),
  'source_table_audit',(select value from audit_payload),
  'source_audit',(select value from audit_payload)
)
$fn$;

comment on function public.get_request_sales_impact_v2() is
  'Service-role-only full-table Request sales impact rollup with complete JSON/HTML extraction, stable physical-row identity, size-average pricing fallback, and source-table audit.';

revoke all on function public.get_request_sales_impact_v2() from public,anon,authenticated;
grant execute on function public.get_request_sales_impact_v2() to service_role;

commit;
