begin;

set local statement_timeout='120s';
set local lock_timeout='5s';

create or replace function private.archive_numeric_v2366(p_value text)
returns numeric
language plpgsql
immutable
set search_path=''
as $function$
declare
  cleaned text:=regexp_replace(coalesce(p_value,''),'[^0-9.+-]','','g');
begin
  if cleaned !~ '^[+-]?[0-9]+([.][0-9]+)?$' then return null; end if;
  return cleaned::numeric;
exception when numeric_value_out_of_range then
  return null;
end
$function$;

create or replace function private.archive_timestamptz_v2366(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path=''
as $function$
declare
  normalized text:=btrim(coalesce(p_value,''));
begin
  if normalized='' then return null; end if;
  normalized:=regexp_replace(normalized,'\s+GMT([+-][0-9]{4})(\s+\([^)]*\))?\s*$',' \1','i');
  return normalized::timestamptz;
exception when others then
  return null;
end
$function$;

create or replace function private.archive_photo_array_v2366(p_photos jsonb,p_links text[] default '{}'::text[])
returns jsonb
language sql
immutable
set search_path=''
as $function$
  with candidates as (
    select case jsonb_typeof(item)
      when 'string' then item#>>'{}'
      when 'object' then coalesce(item->>'url',item->>'photo_url',item->>'photoUrl',item->>'href',item->>'link')
      else null end value
    from jsonb_array_elements(case when jsonb_typeof(p_photos)='array' then p_photos else '[]'::jsonb end) item
    union all
    select link from unnest(coalesce(p_links,'{}'::text[])) link
  ), normalized as (
    select btrim(link) link
    from candidates cross join lateral regexp_split_to_table(coalesce(value,''),'\s*[,|;\n]\s*') link
    where btrim(link) ~* '^(https?://|/[^/])'
  )
  select coalesce(jsonb_agg(link order by link),'[]'::jsonb)
  from (select distinct link from normalized order by link limit 20) unique_links
$function$;

create or replace function private.archive_rep_profile_id_v2366(p_rep text)
returns uuid
language sql
stable
security definer
set search_path=''
as $function$
  select profile.id
  from public.profiles profile
  where profile.disabled_at is null
    and not coalesce(profile.must_change_password,true)
    and (profile.locked_until is null or profile.locked_until<=statement_timestamp())
    and sales_private.rep_name_key(p_rep) in
      (sales_private.rep_name_key(profile.username),sales_private.rep_name_key(profile.display_name))
  order by (sales_private.rep_name_key(p_rep)=sales_private.rep_name_key(profile.username)) desc,profile.id
  limit 1
$function$;

revoke all on function private.archive_numeric_v2366(text) from public,anon,authenticated,service_role;
revoke all on function private.archive_timestamptz_v2366(text) from public,anon,authenticated,service_role;
revoke all on function private.archive_photo_array_v2366(jsonb,text[]) from public,anon,authenticated,service_role;
revoke all on function private.archive_rep_profile_id_v2366(text) from public,anon,authenticated,service_role;

create index if not exists ph_customer_consignee_archive_identity_v2366
  on public.ph_customer_consignee_sales_reps(customeridentityid,consigneeid);
create index if not exists ph_photo_history_archive_identity_v2366
  on public.ph_photo_history_assets(itemcode,locationcode,lotcode,photo_at desc);
create index if not exists ph_photo_history_storage_object_v2366
  on public.ph_photo_history_assets(bucket,path);

do $replace_views$
declare
  relation_name text;
  relation_kind "char";
begin
  foreach relation_name in array array['ph_orders_history','ph_reserves_history','ph_drive_mode_history'] loop
    select relation.relkind into relation_kind
    from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='public' and relation.relname=relation_name;
    if relation_kind='v' then
      execute format('drop view public.%I',relation_name);
    elsif relation_kind is not null and relation_kind not in ('r','p') then
      raise exception 'HISTORICAL_ARCHIVE_RELATION_CONFLICT: %',relation_name;
    end if;
  end loop;
end
$replace_views$;

create table if not exists public.ph_orders_history (
  order_line_key text primary key,
  source_unique_id text,
  source_kind text not null default 'soc',
  source_file_id text,
  source_file_name text,
  report_date text,
  sales_rep_profile_id uuid,
  sales_rep text,
  customer_name text not null,
  consignee_name text,
  customer_consignee_label text not null,
  order_folder_key text not null,
  order_number text,
  tripnumber text,
  dock_num text,
  drop_num text,
  planstart text,
  order_date timestamptz,
  checker text,
  inspector text,
  mistake text,
  dock_status text,
  item_check_status text,
  issue_status text,
  issue_note text,
  issue_photos jsonb not null default '[]'::jsonb,
  itemcode text not null,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  qty_ordered numeric,
  unit_list_price numeric not null default 0,
  line_dollar_value numeric not null default 0,
  photos jsonb not null default '[]'::jsonb,
  photo_url text,
  photo_date text,
  spec text,
  caliper text,
  loc_match_pct numeric,
  loc_photo_match numeric,
  pick_note text,
  av_note text,
  sales_note text,
  archived_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (lower(
    coalesce(source_file_name,'')||' '||coalesce(sales_rep,'')||' '||coalesce(customer_name,'')||' '||
    coalesce(consignee_name,'')||' '||coalesce(order_folder_key,'')||' '||coalesce(order_number,'')||' '||
    coalesce(tripnumber,'')||' '||coalesce(dock_num,'')||' '||coalesce(itemcode,'')||' '||
    coalesce(commonname,'')||' '||coalesce(locationcode,'')||' '||coalesce(lotcode,''))) stored
);

create table if not exists public.ph_reserves_history (
  reserve_history_key text primary key,
  source_unique_id text,
  source_file_id text,
  source_file_name text,
  report_date text,
  sales_rep_profile_id uuid,
  sales_rep text,
  customer_name text not null,
  consignee_name text,
  customer_consignee_label text not null,
  reserve_folder_key text not null,
  order_number text,
  itemcode text not null,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  qty_reserved numeric,
  on_hand numeric,
  available_qty numeric,
  open_stock numeric,
  unit_list_price numeric not null default 0,
  line_dollar_value numeric not null default 0,
  hold_stop_code text,
  hold_stop_reason text,
  photos jsonb not null default '[]'::jsonb,
  photo_url text,
  photo_date text,
  spec text,
  caliper text,
  av_note text,
  pick_note text,
  sales_note text,
  archived_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (lower(
    coalesce(source_file_name,'')||' '||coalesce(sales_rep,'')||' '||coalesce(customer_name,'')||' '||
    coalesce(consignee_name,'')||' '||coalesce(reserve_folder_key,'')||' '||coalesce(order_number,'')||' '||
    coalesce(itemcode,'')||' '||coalesce(commonname,'')||' '||coalesce(locationcode,'')||' '||coalesce(lotcode,''))) stored
);

create table if not exists public.ph_drive_mode_history_files (
  file_id text primary key,
  file_name text not null,
  report_date date,
  row_count integer not null default 0,
  hold_row_count integer not null default 0,
  status text,
  web_view_link text,
  drive_modified_time timestamptz,
  processed_at timestamptz,
  archived_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ph_drive_mode_history (
  history_key text primary key,
  source_kind text not null,
  source_unique_id text,
  source_file_id text,
  source_file_name text,
  report_date date,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  ptravailable numeric,
  on_hand numeric,
  photos jsonb not null default '[]'::jsonb,
  photo_url text,
  photo_date text,
  spec text,
  caliper text,
  loc_match_pct numeric,
  loc_photo_match numeric,
  pick_note text,
  av_note text,
  sales_note text,
  hold_stop_code text,
  hold_stop_reason text,
  archive_reason text not null,
  archived_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (lower(
    coalesce(source_file_name,'')||' '||coalesce(itemcode,'')||' '||coalesce(commonname,'')||' '||
    coalesce(contsize,'')||' '||coalesce(locationcode,'')||' '||coalesce(lotcode,'')||' '||coalesce(season,''))) stored
);

create or replace function private.refresh_soc_order_history_v2366(p_unique_id text default null)
returns integer
language plpgsql
security definer
set search_path=''
as $function$
declare
  affected integer;
begin
  insert into public.ph_orders_history(
    order_line_key,source_unique_id,source_kind,source_file_id,source_file_name,report_date,
    sales_rep_profile_id,sales_rep,customer_name,consignee_name,customer_consignee_label,order_folder_key,
    order_number,tripnumber,dock_num,drop_num,planstart,order_date,checker,inspector,mistake,dock_status,
    item_check_status,issue_status,issue_note,issue_photos,itemcode,commonname,contsize,locationcode,lotcode,
    qty_ordered,unit_list_price,line_dollar_value,photos,photo_url,photo_date,spec,caliper,loc_match_pct,
    loc_photo_match,pick_note,av_note,sales_note,archived_at,updated_at)
  select
    md5(concat_ws('|','soc',coalesce(nullif(btrim(source.filename),''),source.last_updated::text,'current'),source.unique_id)),
    source.unique_id,'soc',nullif(btrim(source.filename),''),nullif(btrim(source.filename),''),source.last_updated::date::text,
    private.archive_rep_profile_id_v2366(coalesce(nullif(btrim(source.salesrepname),''),mapping.salesrepname)),
    coalesce(nullif(btrim(source.salesrepname),''),nullif(btrim(mapping.salesrepname),''),'Unassigned'),
    coalesce(nullif(btrim(source.customername),''),nullif(btrim(mapping.customername),''),'Unassigned'),
    coalesce(nullif(btrim(source.consigneename),''),nullif(btrim(mapping.consigneename),''),'Unassigned'),
    concat_ws(' | ',coalesce(nullif(btrim(source.customername),''),nullif(btrim(mapping.customername),''),'Unassigned'),
      coalesce(nullif(btrim(source.consigneename),''),nullif(btrim(mapping.consigneename),''),'Unassigned')),
    concat_ws(' • ','Trip '||coalesce(nullif(btrim(source.tripnumber),''),'—'),
      'Dock '||coalesce(nullif(btrim(coalesce(source.dock_num,source.dock)),''),'—'),
      'Drop '||coalesce(nullif(btrim(source.stopnumber),''),'—'),
      'PlanStart '||coalesce(nullif(btrim(source.planstart),''),'—')),
    coalesce(nullif(btrim(source.transactionnumber),''),nullif(btrim(source.purchaseordernumber),'')),
    nullif(btrim(source.tripnumber),''),nullif(btrim(coalesce(source.dock_num,source.dock)),''),
    nullif(btrim(source.stopnumber),''),nullif(btrim(source.planstart),''),
    coalesce(private.archive_timestamptz_v2366(source.requestdate),private.archive_timestamptz_v2366(source.invoicedate),source.last_updated),
    coalesce(nullif(btrim(trip.checker),''),nullif(btrim(team.checker),'')),
    coalesce(nullif(btrim(trip.inspector),''),nullif(btrim(team.inspector),'')),
    coalesce(nullif(btrim(trip.mistake),''),nullif(btrim(team.mistake),'')),
    coalesce(nullif(btrim(trip.status),''),nullif(btrim(team.status),'')),
    case when item.checker_done and item.inspector_done then 'Checked + Inspected'
      when item.checker_done then 'Checked' when item.inspector_done then 'Inspected' else null end,
    issue.issue_state,issue.issue_note,
    private.archive_photo_array_v2366(null,array[issue.issue_photo_link,issue.source_photo_link]),
    coalesce(nullif(btrim(source.itemcode),''),'__SOC_ROW__'),nullif(btrim(source.commonname),''),nullif(btrim(source.contsize),''),
    nullif(btrim(source.locationcode),''),nullif(btrim(source.lotcode),''),
    coalesce(private.archive_numeric_v2366(source.quantityordered),private.archive_numeric_v2366(source.quantityshipped)),
    coalesce(private.archive_numeric_v2366(source.listprice),private.archive_numeric_v2366(source.unitprice),0),
    round(coalesce(private.archive_numeric_v2366(source.quantityordered),private.archive_numeric_v2366(source.quantityshipped),0)
      *coalesce(private.archive_numeric_v2366(source.listprice),private.archive_numeric_v2366(source.unitprice),0),2),
    private.archive_photo_array_v2366(coalesce(master.photos,request.photos,asset.photos),
      array[source.photo_link,source.dock_photo_link,master.photo_url,master.photo_link,request.photo_url,request.req_photo_link]),
    coalesce(nullif(btrim(source.photo_link),''),nullif(btrim(source.dock_photo_link),''),master.photo_url,master.photo_link,request.photo_url,request.req_photo_link),
    coalesce(master.photo_date::text,request.photo_date,source.last_updated::text),
    coalesce(nullif(btrim(source.spec),''),nullif(btrim(source.dock_spec),''),nullif(btrim(master.spec),''),nullif(btrim(request.spec),''),nullif(btrim(request.req_spec),'')),
    coalesce(nullif(btrim(source.caliper),''),nullif(btrim(source.dock_caliper),''),nullif(btrim(master.caliper),''),nullif(btrim(request.caliper),''),nullif(btrim(request.req_caliper),'')),
    coalesce(master.loc_match_pct,request.loc_match_pct),coalesce(master.loc_photo_match,request.loc_photo_match),
    coalesce(nullif(btrim(source.picknote),''),nullif(btrim(master.pick_note),''),nullif(btrim(master.picknote),''),nullif(btrim(request.pick_note),'')),
    coalesce(nullif(btrim(source.av_note),''),nullif(btrim(master.av_note),''),nullif(btrim(request.av_note),'')),
    coalesce(nullif(btrim(source.sales_note),''),nullif(btrim(source.salesnote),''),nullif(btrim(master.sales_note),''),nullif(btrim(master.salesnote),''),nullif(btrim(request.sales_note),'')),
    coalesce(source.last_updated,clock_timestamp()),clock_timestamp()
  from public.ph_soc_master source
  left join public.ph_dock_trip_status trip on lower(btrim(trip.tripnumber))=lower(btrim(source.tripnumber))
    and (nullif(btrim(trip.dock_num),'') is null or lower(btrim(trip.dock_num))=lower(btrim(coalesce(source.dock_num,source.dock))))
  left join public.ph_dock_team_status team on lower(btrim(team.dock_num))=lower(btrim(coalesce(source.dock_num,source.dock)))
  left join public.ph_dock_item_status item on item.unique_id=source.unique_id
  left join lateral (select issue_row.* from public.ph_dock_issue_status issue_row
    where issue_row.source_master_unique_id=source.unique_id or issue_row.issue_source_unique_id=source.unique_id
      or issue_row.source_match_key=source.unique_id order by issue_row.updated_at desc nulls last limit 1) issue on true
  left join lateral (select mapping_row.* from public.ph_customer_consignee_sales_reps mapping_row
    where mapping_row.customeridentityid=source.customeridentityid
      and mapping_row.consigneeid=source.consigneeidentityid order by mapping_row.updated_at desc nulls last limit 1) mapping on true
  left join lateral (select master_row.* from public.ph_master_inventory master_row
    where master_row.itemcode=source.itemcode and master_row.locationcode=source.locationcode
      and coalesce(master_row.lotcode,'')=coalesce(source.lotcode,'') order by master_row.last_updated desc nulls last limit 1) master on true
  left join lateral (select request_row.* from public.ph_requests_completed_history request_row
    where request_row.itemcode=source.itemcode and request_row.locationcode=source.locationcode
      and coalesce(request_row.lotcode,'')=coalesce(source.lotcode,'') order by request_row.updated_at desc nulls last limit 1) request on true
  left join lateral (select jsonb_agg('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||photo.bucket||'/'||photo.path order by photo.photo_at desc) photos
    from (select photo_row.* from public.ph_photo_history_assets photo_row where photo_row.itemcode=source.itemcode
      and (nullif(source.locationcode,'') is null or photo_row.locationcode=source.locationcode)
      order by photo_row.photo_at desc limit 5) photo) asset on true
  where p_unique_id is null or source.unique_id=p_unique_id
  on conflict(order_line_key) do update set
    sales_rep_profile_id=excluded.sales_rep_profile_id,sales_rep=excluded.sales_rep,customer_name=excluded.customer_name,
    consignee_name=excluded.consignee_name,customer_consignee_label=excluded.customer_consignee_label,
    order_folder_key=excluded.order_folder_key,order_number=excluded.order_number,tripnumber=excluded.tripnumber,
    dock_num=excluded.dock_num,drop_num=excluded.drop_num,planstart=excluded.planstart,order_date=excluded.order_date,
    checker=excluded.checker,inspector=excluded.inspector,mistake=excluded.mistake,dock_status=excluded.dock_status,
    item_check_status=excluded.item_check_status,issue_status=excluded.issue_status,issue_note=excluded.issue_note,
    issue_photos=excluded.issue_photos,itemcode=excluded.itemcode,commonname=excluded.commonname,contsize=excluded.contsize,
    locationcode=excluded.locationcode,lotcode=excluded.lotcode,qty_ordered=excluded.qty_ordered,
    unit_list_price=excluded.unit_list_price,line_dollar_value=excluded.line_dollar_value,photos=excluded.photos,
    photo_url=excluded.photo_url,photo_date=excluded.photo_date,spec=excluded.spec,caliper=excluded.caliper,
    loc_match_pct=excluded.loc_match_pct,loc_photo_match=excluded.loc_photo_match,pick_note=excluded.pick_note,
    av_note=excluded.av_note,sales_note=excluded.sales_note,updated_at=clock_timestamp();
  get diagnostics affected=row_count;
  return affected;
end
$function$;

revoke all on function private.refresh_soc_order_history_v2366(text) from public,anon,authenticated,service_role;

select private.refresh_soc_order_history_v2366(null);

insert into public.ph_orders_history(
  order_line_key,source_unique_id,source_kind,source_file_id,source_file_name,report_date,sales_rep_profile_id,sales_rep,
  customer_name,consignee_name,customer_consignee_label,order_folder_key,order_number,tripnumber,dock_num,drop_num,
  planstart,order_date,itemcode,commonname,locationcode,lotcode,qty_ordered,unit_list_price,line_dollar_value,archived_at,updated_at)
select md5(concat_ws('|','transaction',row.drive_file_id,row.content_sha256,row.source_sheet_name,row.source_row_number::text)),
  concat_ws(':',row.drive_file_id,row.source_sheet_name,row.source_row_number::text),'transaction',row.drive_file_id,
  coalesce(file.file_name,row.drive_file_id),coalesce(row.transaction_business_date,file.last_transaction_date)::text,
  null::uuid,coalesce(nullif(btrim(row.created_by_detail),''),nullif(btrim(row.created_by_key),'')),
  coalesce(nullif(btrim(row.ship_to_name_om_transaction_header),''),'Historical SOC Transaction'),
  coalesce(nullif(btrim(row.ship_to_name_om_transaction_header),''),'Unassigned'),
  coalesce(nullif(btrim(row.ship_to_name_om_transaction_header),''),'Historical SOC Transaction'),
  concat_ws(' • ','Trip '||coalesce(nullif(btrim(row.fm_trip_number_om_transaction_header),''),'—'),
    'Drop '||coalesce(nullif(btrim(row.fm_pu_stop_number_om_transaction_header),''),'—'),
    'File '||coalesce(file.file_name,row.drive_file_id)),
  coalesce(nullif(btrim(row.reference),''),nullif(btrim(row.transaction_number),'')),
  nullif(btrim(row.fm_trip_number_om_transaction_header),''),null,nullif(btrim(row.fm_pu_stop_number_om_transaction_header),''),null,
  coalesce(row.transaction_datetime::timestamptz,row.shipping_datetime_om_transaction_header::timestamptz,row.transaction_business_date::timestamptz),
  coalesce(nullif(btrim(row.code_item),''),'__TRANSACTION__'),nullif(btrim(row.description_1_item),''),
  nullif(btrim(row.code_location),''),nullif(btrim(row.code_lot),''),
  coalesce(row.ordered_quantity,row.out_ordered_transaction_location,row.quantity),coalesce(row.price,0),
  coalesce(row.amount,round(coalesce(row.ordered_quantity,row.out_ordered_transaction_location,row.quantity,0)*coalesce(row.price,0),2)),
  coalesce(row.created_at,clock_timestamp()),clock_timestamp()
from public.ph_transactions_keyed_rows row
left join public.ph_transactions_keyed_files file on file.drive_file_id=row.drive_file_id
on conflict(order_line_key) do update set updated_at=clock_timestamp(),line_dollar_value=excluded.line_dollar_value,
  qty_ordered=excluded.qty_ordered,unit_list_price=excluded.unit_list_price;

insert into public.ph_orders_history(
  order_line_key,source_unique_id,source_kind,source_file_id,source_file_name,report_date,sales_rep,customer_name,
  consignee_name,customer_consignee_label,order_folder_key,itemcode,commonname,qty_ordered,archived_at,updated_at)
select 'order-file:'||version.file_version_id::text,version.file_version_id::text,'file',version.drive_file_id,version.file_name,
  version.source_report_date::text,null,'Imported SOC File','Unassigned','Imported SOC File | Unassigned',
  concat_ws(' • ',coalesce(version.file_name,'SOC Open Orders'),coalesce(version.source_report_date::text,'Date unavailable')),
  '__FILE__','Imported SOC Open Orders File',coalesce(version.source_row_count,version.expected_row_count,0),
  coalesce(version.finalized_at,version.created_at,clock_timestamp()),clock_timestamp()
from private.ph_eval_item_low_stock_file_versions version
on conflict(order_line_key) do update set source_file_name=excluded.source_file_name,report_date=excluded.report_date,
  qty_ordered=excluded.qty_ordered,updated_at=clock_timestamp();

insert into public.ph_orders_history(
  order_line_key,source_unique_id,source_kind,customer_name,consignee_name,customer_consignee_label,order_folder_key,
  tripnumber,dock_num,checker,inspector,mistake,dock_status,itemcode,commonname,archived_at,updated_at)
select md5(concat_ws('|','trip',trip.tripnumber,trip.dock_num)),concat_ws(':',trip.tripnumber,trip.dock_num),'trip',
  'Dock Trips','Unassigned','Dock Trips | Unassigned',concat_ws(' • ','Trip '||trip.tripnumber,'Dock '||coalesce(trip.dock_num,'—')),
  trip.tripnumber,trip.dock_num,trip.checker,trip.inspector,trip.mistake,trip.status,'__TRIP__','Dock Trip Accountability',
  coalesce(trip.created_at,trip.updated_at,clock_timestamp()),clock_timestamp()
from public.ph_dock_trip_status trip
on conflict(order_line_key) do update set checker=excluded.checker,inspector=excluded.inspector,mistake=excluded.mistake,
  dock_status=excluded.dock_status,updated_at=clock_timestamp();

insert into public.ph_orders_history(
  order_line_key,source_unique_id,source_kind,customer_name,consignee_name,customer_consignee_label,order_folder_key,
  tripnumber,dock_num,checker,inspector,mistake,dock_status,itemcode,commonname,archived_at,updated_at)
select 'trip-audit:'||audit.id::text,audit.id::text,'trip_audit','Dock Trips','Unassigned','Dock Trips | Unassigned',
  concat_ws(' • ','Trip '||coalesce(audit.next_value->>'tripnumber',audit.tripnumber,'—'),
    'Dock '||coalesce(audit.next_value->>'dock_num','—'),'Audit '||audit.id::text),
  coalesce(audit.next_value->>'tripnumber',audit.tripnumber),audit.next_value->>'dock_num',audit.next_value->>'checker',
  audit.next_value->>'inspector',audit.next_value->>'mistake',audit.next_value->>'status','__TRIP_AUDIT__','Dock Trip Accountability Audit',
  audit.created_at,clock_timestamp()
from public.ph_dock_trip_status_audit audit
on conflict(order_line_key) do nothing;

create or replace function private.refresh_reserve_history_v2366(p_unique_id text default null)
returns integer
language plpgsql
security definer
set search_path=''
as $function$
declare
  affected integer;
begin
  insert into public.ph_reserves_history(
    reserve_history_key,source_unique_id,source_file_id,source_file_name,report_date,sales_rep_profile_id,sales_rep,
    customer_name,consignee_name,customer_consignee_label,reserve_folder_key,order_number,itemcode,commonname,contsize,
    locationcode,lotcode,qty_reserved,on_hand,available_qty,open_stock,unit_list_price,line_dollar_value,
    hold_stop_code,hold_stop_reason,photos,photo_url,photo_date,spec,caliper,av_note,pick_note,sales_note,archived_at,updated_at)
  select md5(concat_ws('|','reserve',source.unique_id,coalesce(nullif(btrim(source.filename),''),source.last_updated::text,'current'))),
    source.unique_id,nullif(btrim(source.filename),''),nullif(btrim(source.filename),''),
    coalesce(source.last_updated::date::text,nullif(btrim(source.requestdate),'')),
    rep_profile.id,
    coalesce(nullif(btrim(source.salesrepname),''),nullif(btrim(mapping.salesrepname),''),'Unassigned'),
    coalesce(nullif(btrim(source.customername),''),nullif(btrim(mapping.customername),''),'Unassigned'),
    coalesce(nullif(btrim(source.consigneename),''),nullif(btrim(mapping.consigneename),''),'Unassigned'),
    concat_ws(' | ',coalesce(nullif(btrim(source.customername),''),nullif(btrim(mapping.customername),''),'Unassigned'),
      coalesce(nullif(btrim(source.consigneename),''),nullif(btrim(mapping.consigneename),''),'Unassigned')),
    concat_ws(' • ',coalesce(nullif(btrim(source.transactionnumber),''),nullif(btrim(source.purchaseordernumber),''),'Reserve'),
      coalesce(nullif(btrim(source.filename),''),source.last_updated::date::text,'Current File')),
    coalesce(nullif(btrim(source.transactionnumber),''),nullif(btrim(source.purchaseordernumber),'')),
    coalesce(nullif(btrim(source.itemcode),''),'__RESERVE_ROW__'),nullif(btrim(source.commonname),''),
    coalesce(nullif(btrim(source.contsize),''),nullif(btrim(source.container),''),nullif(btrim(source.size),'')),
    coalesce(nullif(btrim(source.locationcode),''),nullif(btrim(source.location),'')),
    coalesce(nullif(btrim(source.lotcode),''),nullif(btrim(source.lot),'')),
    coalesce(private.archive_numeric_v2366(source.quantityordered),private.archive_numeric_v2366(source.ptravailable)),
    private.archive_numeric_v2366(source.ptronhand),private.archive_numeric_v2366(source.ptravailable),
    private.archive_numeric_v2366(source.s_lts),coalesce(private.archive_numeric_v2366(source.listprice),private.archive_numeric_v2366(source.unitprice),0),
    round(coalesce(private.archive_numeric_v2366(source.quantityordered),private.archive_numeric_v2366(source.ptravailable),0)
      *coalesce(private.archive_numeric_v2366(source.listprice),private.archive_numeric_v2366(source.unitprice),0),2),
    nullif(btrim(source.holdstopcode),''),nullif(btrim(source.holdstopreason),''),
    private.archive_photo_array_v2366(coalesce(master.photos,asset.photos),
      array[source.photo_link,source.dock_photo_link,master.photo_url,master.photo_link]),
    coalesce(nullif(btrim(source.photo_link),''),nullif(btrim(source.dock_photo_link),''),master.photo_url,master.photo_link),
    coalesce(master.photo_date::text,source.last_updated::text),
    coalesce(nullif(btrim(source.spec),''),nullif(btrim(source.dock_spec),''),nullif(btrim(master.spec),'')),
    coalesce(nullif(btrim(source.caliper),''),nullif(btrim(source.dock_caliper),''),nullif(btrim(master.caliper),'')),
    coalesce(nullif(btrim(source.av_note),''),nullif(btrim(master.av_note),'')),
    coalesce(nullif(btrim(source.picknote),''),nullif(btrim(master.pick_note),''),nullif(btrim(master.picknote),'')),
    coalesce(nullif(btrim(source.sales_note),''),nullif(btrim(source.salesnote),''),nullif(btrim(master.sales_note),''),nullif(btrim(master.salesnote),'')),
    coalesce(source.last_updated,clock_timestamp()),clock_timestamp()
  from public.ph_reserves source
  left join lateral (select mapping_row.* from public.ph_customer_consignee_sales_reps mapping_row
    where mapping_row.customeridentityid=source.customeridentityid and mapping_row.consigneeid=source.consigneeidentityid
    order by mapping_row.updated_at desc nulls last limit 1) mapping on true
  left join lateral (select profile.id from public.profiles profile
    where profile.disabled_at is null and not coalesce(profile.must_change_password,true)
      and (profile.locked_until is null or profile.locked_until<=statement_timestamp())
      and sales_private.rep_name_key(coalesce(nullif(btrim(source.salesrepname),''),mapping.salesrepname)) in
        (sales_private.rep_name_key(profile.username),sales_private.rep_name_key(profile.display_name))
    order by (sales_private.rep_name_key(coalesce(nullif(btrim(source.salesrepname),''),mapping.salesrepname))=
      sales_private.rep_name_key(profile.username)) desc,profile.id limit 1) rep_profile on true
  left join lateral (select master_row.* from public.ph_master_inventory master_row
    where master_row.itemcode=source.itemcode and master_row.locationcode=source.locationcode
      and coalesce(master_row.lotcode,'')=coalesce(source.lotcode,'') order by master_row.last_updated desc nulls last limit 1) master on true
  left join lateral (select jsonb_agg('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||photo.bucket||'/'||photo.path order by photo.photo_at desc) photos
    from (select photo_row.* from public.ph_photo_history_assets photo_row where photo_row.itemcode=source.itemcode
      and (nullif(source.locationcode,'') is null or photo_row.locationcode=source.locationcode)
      order by photo_row.photo_at desc limit 5) photo) asset on true
  where p_unique_id is null or source.unique_id=p_unique_id
  on conflict(reserve_history_key) do update set
    sales_rep_profile_id=excluded.sales_rep_profile_id,sales_rep=excluded.sales_rep,customer_name=excluded.customer_name,
    consignee_name=excluded.consignee_name,customer_consignee_label=excluded.customer_consignee_label,
    reserve_folder_key=excluded.reserve_folder_key,order_number=excluded.order_number,itemcode=excluded.itemcode,
    commonname=excluded.commonname,contsize=excluded.contsize,locationcode=excluded.locationcode,lotcode=excluded.lotcode,
    qty_reserved=excluded.qty_reserved,on_hand=excluded.on_hand,available_qty=excluded.available_qty,
    open_stock=excluded.open_stock,unit_list_price=excluded.unit_list_price,line_dollar_value=excluded.line_dollar_value,
    hold_stop_code=excluded.hold_stop_code,hold_stop_reason=excluded.hold_stop_reason,photos=excluded.photos,
    photo_url=excluded.photo_url,photo_date=excluded.photo_date,spec=excluded.spec,caliper=excluded.caliper,
    av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_at=clock_timestamp();
  get diagnostics affected=row_count;
  return affected;
end
$function$;

revoke all on function private.refresh_reserve_history_v2366(text) from public,anon,authenticated,service_role;

select private.refresh_reserve_history_v2366(null);

insert into public.ph_drive_mode_history_files(
  file_id,file_name,report_date,row_count,hold_row_count,status,web_view_link,drive_modified_time,processed_at,archived_at,updated_at)
select file.file_id,coalesce(nullif(btrim(file.canonical_file_name),''),nullif(btrim(file.file_name),''),file.file_id),
  coalesce(file.canonical_report_date,file.report_date),coalesce(file.row_count,0),coalesce(file.hold_row_count,0),
  file.status,file.web_view_link,file.drive_modified_time,file.processed_at,coalesce(file.first_seen_at,file.created_at,clock_timestamp()),clock_timestamp()
from public.ph_drive_around_report_files file
on conflict(file_id) do update set file_name=excluded.file_name,report_date=excluded.report_date,row_count=excluded.row_count,
  hold_row_count=excluded.hold_row_count,status=excluded.status,web_view_link=excluded.web_view_link,
  drive_modified_time=excluded.drive_modified_time,processed_at=excluded.processed_at,updated_at=clock_timestamp();

insert into public.ph_drive_mode_history(
  history_key,source_kind,source_unique_id,source_file_id,report_date,itemcode,commonname,contsize,locationcode,lotcode,
  photos,photo_url,photo_date,archive_reason,archived_at,updated_at)
select 'photo:'||asset.id::text,'photo_asset',asset.source_key,asset.drive_file_id,asset.photo_at::date,asset.itemcode,asset.commonname,
  asset.contsize,asset.locationcode,asset.lotcode,
  jsonb_build_array('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||asset.bucket||'/'||asset.path),
  'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||asset.bucket||'/'||asset.path,
  asset.photo_at::text,'historical_photo_asset',coalesce(asset.photo_at,asset.indexed_at,clock_timestamp()),clock_timestamp()
from public.ph_photo_history_assets asset
on conflict(history_key) do update set photo_url=excluded.photo_url,photos=excluded.photos,updated_at=clock_timestamp();

create index if not exists ph_orders_history_customer_consignee_v2366 on public.ph_orders_history(customer_name,consignee_name);
create index if not exists ph_orders_history_rep_v2366 on public.ph_orders_history(sales_rep_profile_id,archived_at desc);
create index if not exists ph_orders_history_trip_v2366 on public.ph_orders_history(tripnumber);
create index if not exists ph_orders_history_dock_v2366 on public.ph_orders_history(dock_num);
create index if not exists ph_orders_history_planstart_v2366 on public.ph_orders_history(planstart);
create index if not exists ph_orders_history_source_file_v2366 on public.ph_orders_history(source_file_name);
create index if not exists ph_orders_history_item_v2366 on public.ph_orders_history(itemcode);
create index if not exists ph_orders_history_source_unique_v2366 on public.ph_orders_history(source_unique_id);
create index if not exists ph_orders_history_updated_v2366 on public.ph_orders_history(updated_at desc);
create index if not exists ph_orders_history_search_v2366 on public.ph_orders_history using gin(search_text gin_trgm_ops);

create index if not exists ph_reserves_history_rep_customer_v2366 on public.ph_reserves_history(sales_rep_profile_id,customer_name,consignee_name);
create index if not exists ph_reserves_history_source_file_v2366 on public.ph_reserves_history(source_file_name);
create index if not exists ph_reserves_history_report_date_v2366 on public.ph_reserves_history(report_date);
create index if not exists ph_reserves_history_item_v2366 on public.ph_reserves_history(itemcode);
create index if not exists ph_reserves_history_source_unique_v2366 on public.ph_reserves_history(source_unique_id);
create index if not exists ph_reserves_history_updated_v2366 on public.ph_reserves_history(updated_at desc);
create index if not exists ph_reserves_history_search_v2366 on public.ph_reserves_history using gin(search_text gin_trgm_ops);

create index if not exists ph_drive_mode_history_files_date_v2366 on public.ph_drive_mode_history_files(report_date desc,file_id);
create index if not exists ph_drive_mode_history_files_name_v2366 on public.ph_drive_mode_history_files(file_name);
create index if not exists ph_drive_mode_history_item_v2366 on public.ph_drive_mode_history(itemcode,archived_at desc);
create index if not exists ph_drive_mode_history_location_v2366 on public.ph_drive_mode_history(locationcode,archived_at desc);
create index if not exists ph_drive_mode_history_source_v2366 on public.ph_drive_mode_history(source_unique_id);
create index if not exists ph_drive_mode_history_updated_v2366 on public.ph_drive_mode_history(updated_at desc);
create index if not exists ph_drive_mode_history_search_v2366 on public.ph_drive_mode_history using gin(search_text gin_trgm_ops);

create or replace function private.archive_soc_order_trigger_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  perform private.refresh_soc_order_history_v2366(new.unique_id);
  return new;
end
$function$;

create or replace function private.archive_reserve_trigger_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  perform private.refresh_reserve_history_v2366(new.unique_id);
  return new;
end
$function$;

create or replace function private.archive_drive_file_trigger_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  insert into public.ph_drive_mode_history_files(
    file_id,file_name,report_date,row_count,hold_row_count,status,web_view_link,drive_modified_time,processed_at,archived_at,updated_at)
  values(new.file_id,coalesce(nullif(btrim(new.canonical_file_name),''),nullif(btrim(new.file_name),''),new.file_id),
    coalesce(new.canonical_report_date,new.report_date),coalesce(new.row_count,0),coalesce(new.hold_row_count,0),new.status,
    new.web_view_link,new.drive_modified_time,new.processed_at,coalesce(new.first_seen_at,new.created_at,clock_timestamp()),clock_timestamp())
  on conflict(file_id) do update set file_name=excluded.file_name,report_date=excluded.report_date,row_count=excluded.row_count,
    hold_row_count=excluded.hold_row_count,status=excluded.status,web_view_link=excluded.web_view_link,
    drive_modified_time=excluded.drive_modified_time,processed_at=excluded.processed_at,updated_at=clock_timestamp();
  return new;
end
$function$;

create or replace function private.archive_dock_accountability_trigger_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  payload jsonb:=to_jsonb(new);
  trip_value text:=nullif(btrim(payload->>'tripnumber'),'');
  dock_value text:=nullif(btrim(payload->>'dock_num'),'');
  source_value text:=coalesce(nullif(btrim(payload->>'unique_id'),''),nullif(btrim(payload->>'source_master_unique_id'),''),nullif(btrim(payload->>'issue_source_unique_id'),''));
begin
  if tg_table_name='ph_dock_trip_status' then
    update public.ph_orders_history set checker=nullif(btrim(payload->>'checker'),''),inspector=nullif(btrim(payload->>'inspector'),''),
      mistake=nullif(btrim(payload->>'mistake'),''),dock_status=nullif(btrim(payload->>'status'),''),updated_at=clock_timestamp()
    where (trip_value is not null and tripnumber=trip_value) or (trip_value is null and dock_value is not null and dock_num=dock_value);
    insert into public.ph_orders_history(order_line_key,source_unique_id,source_kind,customer_name,consignee_name,
      customer_consignee_label,order_folder_key,tripnumber,dock_num,checker,inspector,mistake,dock_status,itemcode,commonname,archived_at,updated_at)
    values(md5(concat_ws('|','trip',trip_value,dock_value)),concat_ws(':',trip_value,dock_value),'trip','Dock Trips','Unassigned',
      'Dock Trips | Unassigned',concat_ws(' • ','Trip '||coalesce(trip_value,'—'),'Dock '||coalesce(dock_value,'—')),
      trip_value,dock_value,payload->>'checker',payload->>'inspector',payload->>'mistake',payload->>'status',
      '__TRIP__','Dock Trip Accountability',coalesce((payload->>'created_at')::timestamptz,clock_timestamp()),clock_timestamp())
    on conflict(order_line_key) do update set checker=excluded.checker,inspector=excluded.inspector,mistake=excluded.mistake,
      dock_status=excluded.dock_status,updated_at=clock_timestamp();
  elsif tg_table_name='ph_dock_team_status' then
    update public.ph_orders_history set checker=nullif(btrim(payload->>'checker'),''),inspector=nullif(btrim(payload->>'inspector'),''),
      mistake=nullif(btrim(payload->>'mistake'),''),dock_status=nullif(btrim(payload->>'status'),''),updated_at=clock_timestamp()
    where dock_num=dock_value;
  elsif tg_table_name='ph_dock_item_status' then
    update public.ph_orders_history set item_check_status=case
      when coalesce((payload->>'checker_done')::boolean,false) and coalesce((payload->>'inspector_done')::boolean,false) then 'Checked + Inspected'
      when coalesce((payload->>'checker_done')::boolean,false) then 'Checked'
      when coalesce((payload->>'inspector_done')::boolean,false) then 'Inspected' else null end,updated_at=clock_timestamp()
    where source_unique_id=source_value;
  elsif tg_table_name='ph_dock_issue_status' then
    update public.ph_orders_history set issue_status=payload->>'issue_state',issue_note=payload->>'issue_note',
      issue_photos=private.archive_photo_array_v2366(null,array[payload->>'issue_photo_link',payload->>'source_photo_link']),
      updated_at=clock_timestamp()
    where source_unique_id=source_value;
  end if;
  return new;
end
$function$;

create or replace function private.archive_drive_evidence_trigger_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  has_old_evidence boolean;
  evidence_changed boolean;
  reason text;
begin
  has_old_evidence:=jsonb_array_length(case when jsonb_typeof(old.photos)='array' then old.photos else '[]'::jsonb end)>0
    or nullif(btrim(coalesce(old.photo_url,old.photo_link,'')),'') is not null
    or nullif(btrim(coalesce(old.spec,old.caliper,old.av_note,old.pick_note,old.sales_note,'')),'') is not null;
  evidence_changed:=old.photos is distinct from new.photos or old.photo_url is distinct from new.photo_url
    or old.photo_link is distinct from new.photo_link or old.photo_date is distinct from new.photo_date
    or old.spec is distinct from new.spec or old.caliper is distinct from new.caliper
    or old.loc_match_pct is distinct from new.loc_match_pct or old.loc_photo_match is distinct from new.loc_photo_match
    or old.pick_note is distinct from new.pick_note or old.av_note is distinct from new.av_note or old.sales_note is distinct from new.sales_note;
  if not has_old_evidence or not evidence_changed then return new; end if;
  reason:=case when coalesce(new.loc_photo_match,1)=0 then 'zero_photo_match'
    when old.photo_expires_at is not null and old.photo_expires_at<=clock_timestamp() then 'ten_day_expiration'
    when nullif(btrim(coalesce(new.photo_url,new.photo_link,'')),'') is null then 'evidence_cleared'
    else 'evidence_replaced' end;
  insert into public.ph_drive_mode_history(
    history_key,source_kind,source_unique_id,itemcode,commonname,contsize,locationcode,lotcode,season,ptravailable,on_hand,
    photos,photo_url,photo_date,spec,caliper,loc_match_pct,loc_photo_match,pick_note,av_note,sales_note,
    hold_stop_code,hold_stop_reason,archive_reason,archived_at,updated_at)
  values(md5(concat_ws('|','master',old.unique_id,coalesce(old.photo_date::text,''),coalesce(old.photo_url,old.photo_link,''),
      coalesce(old.spec,''),coalesce(old.caliper,''),coalesce(old.loc_photo_match::text,''))),
    'master_evaluation',old.unique_id,old.itemcode,old.commonname,old.contsize,old.locationcode,old.lotcode,old.season,
    private.archive_numeric_v2366(old.ptravailable),private.archive_numeric_v2366(old.ptronhand),
    private.archive_photo_array_v2366(old.photos,array[old.photo_url,old.photo_link]),coalesce(old.photo_url,old.photo_link),
    old.photo_date::text,old.spec,old.caliper,old.loc_match_pct,old.loc_photo_match,coalesce(old.pick_note,old.picknote),
    old.av_note,coalesce(old.sales_note,old.salesnote),old.holdstopcode,old.holdstopreason,reason,clock_timestamp(),clock_timestamp())
  on conflict(history_key) do update set archive_reason=excluded.archive_reason,updated_at=clock_timestamp();
  return new;
end
$function$;

revoke all on function private.archive_soc_order_trigger_v2366() from public,anon,authenticated,service_role;
revoke all on function private.archive_reserve_trigger_v2366() from public,anon,authenticated,service_role;
revoke all on function private.archive_drive_file_trigger_v2366() from public,anon,authenticated,service_role;
revoke all on function private.archive_dock_accountability_trigger_v2366() from public,anon,authenticated,service_role;
revoke all on function private.archive_drive_evidence_trigger_v2366() from public,anon,authenticated,service_role;

drop trigger if exists ph_soc_master_archive_v2366 on public.ph_soc_master;
create trigger ph_soc_master_archive_v2366 after insert or update on public.ph_soc_master
for each row execute function private.archive_soc_order_trigger_v2366();
drop trigger if exists ph_reserves_archive_v2366 on public.ph_reserves;
create trigger ph_reserves_archive_v2366 after insert or update on public.ph_reserves
for each row execute function private.archive_reserve_trigger_v2366();
drop trigger if exists ph_drive_files_archive_v2366 on public.ph_drive_around_report_files;
create trigger ph_drive_files_archive_v2366 after insert or update on public.ph_drive_around_report_files
for each row execute function private.archive_drive_file_trigger_v2366();
drop trigger if exists ph_drive_evidence_archive_v2366 on public.ph_master_inventory;
create trigger ph_drive_evidence_archive_v2366 before update of photos,photo_url,photo_link,photo_date,spec,caliper,
  loc_match_pct,loc_photo_match,pick_note,av_note,sales_note on public.ph_master_inventory
for each row execute function private.archive_drive_evidence_trigger_v2366();

do $dock_triggers$
declare table_name text;
begin
  foreach table_name in array array['ph_dock_trip_status','ph_dock_team_status','ph_dock_item_status','ph_dock_issue_status'] loop
    execute format('drop trigger if exists %I on public.%I','archive_'||table_name||'_v2366',table_name);
    execute format('create trigger %I after insert or update on public.%I for each row execute function private.archive_dock_accountability_trigger_v2366()',
      'archive_'||table_name||'_v2366',table_name);
  end loop;
end
$dock_triggers$;

create or replace function private.reject_historical_archive_delete_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  raise exception using errcode='42501',message='HISTORICAL_ARCHIVE_RETENTION_PROTECTED';
end
$function$;
revoke all on function private.reject_historical_archive_delete_v2366() from public,anon,authenticated,service_role;

do $retention_triggers$
declare table_name text;
begin
  foreach table_name in array array['ph_requests_completed_history','ph_orders_history','ph_reserves_history','ph_drive_mode_history','ph_drive_mode_history_files'] loop
    execute format('drop trigger if exists %I on public.%I',table_name||'_block_delete_v2366',table_name);
    execute format('create trigger %I before delete on public.%I for each row execute function private.reject_historical_archive_delete_v2366()',
      table_name||'_block_delete_v2366',table_name);
    execute format('drop trigger if exists %I on public.%I',table_name||'_block_truncate_v2366',table_name);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.reject_historical_archive_delete_v2366()',
      table_name||'_block_truncate_v2366',table_name);
  end loop;
end
$retention_triggers$;

create or replace function private.protect_historical_photo_object_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if exists(select 1 from public.ph_photo_history_assets asset where asset.bucket=old.bucket_id and asset.path=old.name) then
    raise exception using errcode='42501',message='HISTORICAL_PHOTO_RETENTION_PROTECTED';
  end if;
  return old;
end
$function$;
revoke all on function private.protect_historical_photo_object_v2366() from public,anon,authenticated,service_role;

do $storage_guard$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop trigger if exists historical_photo_retention_v2366 on storage.objects';
    execute 'create trigger historical_photo_retention_v2366 before delete on storage.objects for each row execute function private.protect_historical_photo_object_v2366()';
  end if;
end
$storage_guard$;

create or replace function public.historical_archive_read_v1(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
set statement_timeout='2s'
as $function$
declare
  actor public.profiles;
  actor_id uuid:=auth.uid();
  global_scope boolean;
  operation text;
  record_kind text;
  search_value text;
  path_value jsonb:='[]'::jsonb;
  path_length integer:=0;
  path_0 text;
  path_1 text;
  path_2 text;
  path_3 text;
  page_value integer:=0;
  page_size_value integer:=25;
  row_total bigint:=0;
  rows_value jsonb:='[]'::jsonb;
  revision_value text;
  max_depth integer;
begin
  if actor_id is null then raise exception using errcode='42501',message='HISTORICAL_ARCHIVE_AUTH_REQUIRED'; end if;
  actor:=sales_private.actor(actor_id);
  if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) key
      where key not in ('operation','recordKind','path','query','page','pageSize','view')) then
    raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
  end if;
  if p_query ? 'view' and (jsonb_typeof(p_query->'view')<>'string'
    or p_query->>'view' not in ('historical-requests','request-history')) then
    raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
  end if;
  if not private.navigation_module_allowed_v1(actor_id,coalesce(p_query->>'view','historical-requests')) then
    raise exception using errcode='42501',message='HISTORICAL_ARCHIVE_FORBIDDEN';
  end if;
  operation:=p_query->>'operation';
  record_kind:=p_query->>'recordKind';
  if operation is null or operation not in ('archive-folders','archive-records','archive-search')
    or record_kind is null or record_kind not in ('requests','orders','reserves','drive') then
    raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
  end if;
  if operation<>'archive-search' and record_kind='requests' then
    raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
  end if;
  if p_query ? 'path' then
    if jsonb_typeof(p_query->'path')<>'array' or jsonb_array_length(p_query->'path')>5
      or exists(select 1 from jsonb_array_elements(p_query->'path') entry
        where jsonb_typeof(entry)<>'string' or length(entry#>>'{}') not between 1 and 500) then
      raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
    end if;
    path_value:=p_query->'path';
  end if;
  path_length:=jsonb_array_length(path_value);
  path_0:=path_value->>0; path_1:=path_value->>1; path_2:=path_value->>2; path_3:=path_value->>3;
  if record_kind='drive' and ((path_length>0 and path_0 !~ '^[0-9]{4}$')
    or (path_length>1 and (path_1 !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(path_1,4)<>path_0))) then
    raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_PATH_INVALID';
  end if;
  if operation='archive-search' then
    if jsonb_typeof(p_query->'query')<>'string' or length(btrim(p_query->>'query')) not between 2 and 100 then
      raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
    end if;
    search_value:=lower(btrim(p_query->>'query'));
  elsif p_query ? 'query' then
    raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
  end if;
  if p_query ? 'page' then
    if jsonb_typeof(p_query->'page')<>'number' or coalesce(p_query->>'page','') !~ '^(0|[1-9][0-9]{0,4})$' then
      raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
    end if;
    page_value:=(p_query->>'page')::integer;
  end if;
  if p_query ? 'pageSize' then
    if jsonb_typeof(p_query->'pageSize')<>'number' or coalesce(p_query->>'pageSize','') !~ '^[1-9][0-9]?$|^100$' then
      raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
    end if;
    page_size_value:=(p_query->>'pageSize')::integer;
  end if;
  global_scope:=private.history_dylan_financial_v1(actor_id);
  max_depth:=case record_kind when 'orders' then 3 when 'reserves' then 4 when 'drive' then 3 else 0 end;

  if operation='archive-folders' then
    if path_length>=max_depth then raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_PATH_INVALID'; end if;
    if record_kind='orders' and path_length=0 then
      with grouped as (select coalesce(nullif(customer_name,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_orders_history
        where global_scope or sales_rep_profile_id=actor_id group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select coalesce(nullif(customer_name,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_orders_history
        where global_scope or sales_rep_profile_id=actor_id group by 1),paged as
        (select * from grouped order by lower(value) offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key',md5('orders:0:'||value),'value',value,
        'label',value,'subtitle','Customer','recordCount',records,'totalValue',case when global_scope then amount else null end)
        order by lower(value)),'[]'::jsonb) into rows_value from paged;
    elsif record_kind='orders' and path_length=1 then
      with grouped as (select coalesce(nullif(consignee_name,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_orders_history where customer_name=path_0
        and (global_scope or sales_rep_profile_id=actor_id) group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select coalesce(nullif(consignee_name,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_orders_history where customer_name=path_0
        and (global_scope or sales_rep_profile_id=actor_id) group by 1),paged as
        (select * from grouped order by lower(value) offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key',md5('orders:1:'||path_0||':'||value),'value',value,
        'label',value,'subtitle',path_0,'recordCount',records,'totalValue',case when global_scope then amount else null end)
        order by lower(value)),'[]'::jsonb) into rows_value from paged;
    elsif record_kind='orders' then
      with grouped as (select order_folder_key value,count(*)::bigint records,coalesce(sum(line_dollar_value),0) amount,
        max(report_date) report_date from public.ph_orders_history where customer_name=path_0
        and coalesce(nullif(consignee_name,''),'Unassigned')=path_1 and (global_scope or sales_rep_profile_id=actor_id) group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select order_folder_key value,count(*)::bigint records,coalesce(sum(line_dollar_value),0) amount,
        max(report_date) report_date from public.ph_orders_history where customer_name=path_0
        and coalesce(nullif(consignee_name,''),'Unassigned')=path_1 and (global_scope or sales_rep_profile_id=actor_id) group by 1),paged as
        (select * from grouped order by report_date desc nulls last,lower(value) offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key',md5('orders:2:'||path_0||':'||path_1||':'||value),
        'value',value,'label',value,'subtitle',coalesce(report_date,'Date unavailable'),'recordCount',records,
        'totalValue',case when global_scope then amount else null end) order by report_date desc nulls last,lower(value)),'[]'::jsonb)
      into rows_value from paged;
    elsif record_kind='reserves' and path_length=0 then
      with grouped as (select coalesce(nullif(sales_rep,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_reserves_history
        where global_scope or sales_rep_profile_id=actor_id group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select coalesce(nullif(sales_rep,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_reserves_history
        where global_scope or sales_rep_profile_id=actor_id group by 1),paged as
        (select * from grouped order by lower(value) offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key',md5('reserves:0:'||value),'value',value,
        'label',value,'subtitle','Sales Rep','recordCount',records,'totalValue',case when global_scope then amount else null end)
        order by lower(value)),'[]'::jsonb) into rows_value from paged;
    elsif record_kind='reserves' and path_length=1 then
      with grouped as (select customer_name value,count(*)::bigint records,coalesce(sum(line_dollar_value),0) amount
        from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0
        and (global_scope or sales_rep_profile_id=actor_id) group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select customer_name value,count(*)::bigint records,coalesce(sum(line_dollar_value),0) amount
        from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0
        and (global_scope or sales_rep_profile_id=actor_id) group by 1),paged as
        (select * from grouped order by lower(value) offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key',md5('reserves:1:'||path_0||':'||value),'value',value,
        'label',value,'subtitle',path_0,'recordCount',records,'totalValue',case when global_scope then amount else null end)
        order by lower(value)),'[]'::jsonb) into rows_value from paged;
    elsif record_kind='reserves' and path_length=2 then
      with grouped as (select coalesce(nullif(consignee_name,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0
        and customer_name=path_1 and (global_scope or sales_rep_profile_id=actor_id) group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select coalesce(nullif(consignee_name,''),'Unassigned') value,count(*)::bigint records,
        coalesce(sum(line_dollar_value),0) amount from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0
        and customer_name=path_1 and (global_scope or sales_rep_profile_id=actor_id) group by 1),paged as
        (select * from grouped order by lower(value) offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key',md5('reserves:2:'||path_0||':'||path_1||':'||value),
        'value',value,'label',value,'subtitle',path_1,'recordCount',records,'totalValue',case when global_scope then amount else null end)
        order by lower(value)),'[]'::jsonb) into rows_value from paged;
    elsif record_kind='reserves' then
      with grouped as (select reserve_folder_key value,count(*)::bigint records,coalesce(sum(line_dollar_value),0) amount,
        max(report_date) report_date from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0
        and customer_name=path_1 and coalesce(nullif(consignee_name,''),'Unassigned')=path_2
        and (global_scope or sales_rep_profile_id=actor_id) group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select reserve_folder_key value,count(*)::bigint records,coalesce(sum(line_dollar_value),0) amount,
        max(report_date) report_date from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0
        and customer_name=path_1 and coalesce(nullif(consignee_name,''),'Unassigned')=path_2
        and (global_scope or sales_rep_profile_id=actor_id) group by 1),paged as
        (select * from grouped order by report_date desc nulls last,lower(value) offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key',md5('reserves:3:'||path_0||':'||path_1||':'||path_2||':'||value),
        'value',value,'label',value,'subtitle',coalesce(report_date,'Date unavailable'),'recordCount',records,
        'totalValue',case when global_scope then amount else null end) order by report_date desc nulls last,lower(value)),'[]'::jsonb)
      into rows_value from paged;
    elsif record_kind='drive' and path_length=0 then
      with grouped as (select extract(year from report_date)::integer value,count(*)::bigint records,sum(row_count)::bigint row_count
        from public.ph_drive_mode_history_files where report_date is not null group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select extract(year from report_date)::integer value,count(*)::bigint records,sum(row_count)::bigint row_count
        from public.ph_drive_mode_history_files where report_date is not null group by 1),paged as
        (select * from grouped order by value desc offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key','drive-year:'||value,'value',value::text,
        'label',value::text,'subtitle',row_count||' indexed rows','recordCount',records,'totalValue',null) order by value desc),'[]'::jsonb)
      into rows_value from paged;
    elsif record_kind='drive' and path_length=1 then
      with grouped as (select to_char(report_date,'YYYY-MM') value,count(*)::bigint records,sum(row_count)::bigint row_count
        from public.ph_drive_mode_history_files where extract(year from report_date)::integer=path_0::integer group by 1)
      select count(*) into row_total from grouped;
      with grouped as (select to_char(report_date,'YYYY-MM') value,count(*)::bigint records,sum(row_count)::bigint row_count
        from public.ph_drive_mode_history_files where extract(year from report_date)::integer=path_0::integer group by 1),paged as
        (select * from grouped order by value desc offset page_value*page_size_value limit page_size_value)
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key','drive-month:'||value,'value',value,
        'label',to_char((value||'-01')::date,'FMMonth YYYY'),'subtitle',row_count||' indexed rows','recordCount',records,'totalValue',null)
        order by value desc),'[]'::jsonb) into rows_value from paged;
    elsif record_kind='drive' then
      select count(*) into row_total from public.ph_drive_mode_history_files where to_char(report_date,'YYYY-MM')=path_1;
      select coalesce(jsonb_agg(jsonb_build_object('kind','folder','key','drive-file:'||file_id,'value',file_id,
        'label',file_name,'subtitle',coalesce(report_date::text,'Date unavailable')||' • '||row_count||' rows • '||hold_row_count||' holds',
        'recordCount',row_count,'totalValue',null) order by report_date desc,file_name),'[]'::jsonb) into rows_value
      from (select * from public.ph_drive_mode_history_files where to_char(report_date,'YYYY-MM')=path_1
        order by report_date desc,file_name offset page_value*page_size_value limit page_size_value) files;
    end if;
  elsif operation='archive-records' then
    if path_length<>max_depth then raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_PATH_INVALID'; end if;
    if record_kind='orders' then
      select count(*) into row_total from public.ph_orders_history where customer_name=path_0
        and coalesce(nullif(consignee_name,''),'Unassigned')=path_1 and order_folder_key=path_2
        and (global_scope or sales_rep_profile_id=actor_id);
      select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value from (
        select archived_at occurred_at,order_line_key id,jsonb_build_object('kind','record','id',order_line_key,
          'title',coalesce(nullif(commonname,''),itemcode),'subtitle',order_folder_key,'status',coalesce(issue_status,dock_status,'Archived'),
          'occurredAt',coalesce(order_date,archived_at),'itemcode',itemcode,'commonname',coalesce(commonname,''),'contsize',coalesce(contsize,''),
          'locationcode',coalesce(locationcode,''),'lotcode',coalesce(lotcode,''),'quantity',qty_ordered,
          'unitListPrice',case when global_scope then unit_list_price else null end,
          'lineDollarValue',case when global_scope then line_dollar_value else null end,'photoLinks',private.archive_photo_array_v2366(photos,array[photo_url]),
          'facts',jsonb_build_object('Order',order_number,'Trip #',tripnumber,'Dock',dock_num,'Drop',drop_num,'PlanStart',planstart,
            'Checker',checker,'Inspector',inspector,'Mistake',mistake,'Item Check',item_check_status,'Issue',issue_status,
            'Spec',spec,'Caliper',caliper),'notes',to_jsonb(array_remove(array[issue_note,pick_note,av_note,sales_note],null))) record
        from public.ph_orders_history where customer_name=path_0 and coalesce(nullif(consignee_name,''),'Unassigned')=path_1
          and order_folder_key=path_2 and (global_scope or sales_rep_profile_id=actor_id)
        order by archived_at desc,order_line_key offset page_value*page_size_value limit page_size_value) records;
    elsif record_kind='reserves' then
      select count(*) into row_total from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0
        and customer_name=path_1 and coalesce(nullif(consignee_name,''),'Unassigned')=path_2 and reserve_folder_key=path_3
        and (global_scope or sales_rep_profile_id=actor_id);
      select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value from (
        select archived_at occurred_at,reserve_history_key id,jsonb_build_object('kind','record','id',reserve_history_key,
          'title',coalesce(nullif(commonname,''),itemcode),'subtitle',reserve_folder_key,
          'status',case when nullif(hold_stop_code,'') is null then 'Reserved' else 'Hold '||hold_stop_code end,
          'occurredAt',archived_at,'itemcode',itemcode,'commonname',coalesce(commonname,''),'contsize',coalesce(contsize,''),
          'locationcode',coalesce(locationcode,''),'lotcode',coalesce(lotcode,''),'quantity',qty_reserved,
          'unitListPrice',case when global_scope then unit_list_price else null end,
          'lineDollarValue',case when global_scope then line_dollar_value else null end,'photoLinks',private.archive_photo_array_v2366(photos,array[photo_url]),
          'facts',jsonb_build_object('Sales Rep',sales_rep,'Customer',customer_name,'Consignee',consignee_name,'Order',order_number,
            'On Hand',on_hand,'Available',available_qty,'Open Stock',open_stock,'Hold',hold_stop_code,'Hold Reason',hold_stop_reason,
            'Spec',spec,'Caliper',caliper),'notes',to_jsonb(array_remove(array[pick_note,av_note,sales_note],null))) record
        from public.ph_reserves_history where coalesce(nullif(sales_rep,''),'Unassigned')=path_0 and customer_name=path_1
          and coalesce(nullif(consignee_name,''),'Unassigned')=path_2 and reserve_folder_key=path_3
          and (global_scope or sales_rep_profile_id=actor_id)
        order by archived_at desc,reserve_history_key offset page_value*page_size_value limit page_size_value) records;
    elsif record_kind='drive' then
      select coalesce(file.row_count,0) into row_total from public.ph_drive_mode_history_files file where file.file_id=path_2;
      select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value from (
        select row.report_date::timestamptz occurred_at,row.unique_id id,jsonb_build_object('kind','record','id',row.unique_id,
          'title',coalesce(nullif(row.commonname,''),row.itemcode),'subtitle',row.file_name,'status',coalesce(nullif(row.holdstopcode,''),'Archived'),
          'occurredAt',row.report_date,'itemcode',coalesce(row.itemcode,''),'commonname',coalesce(row.commonname,''),
          'contsize',coalesce(row.contsize,''),'locationcode',coalesce(row.locationcode,''),'lotcode',coalesce(row.lotcode,''),
          'quantity',row.ptravailable,'unitListPrice',null,'lineDollarValue',null,
          'photoLinks',coalesce(photo.links,'[]'::jsonb),'facts',jsonb_build_object('File',row.file_name,'Report Date',row.report_date,
            'Season',row.season,'Available',row.ptravailable,'On Hand',row.ptronhand,'Hold',row.holdstopcode,'Hold Reason',row.holdstopreason,
            'Spec',row.itemspec),'notes',to_jsonb(array_remove(array[row.locationnote,row.salesnote,row.inventorynote],null))) record
        from public.ph_drive_around_report_rows row
        left join lateral (select jsonb_agg('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||asset.bucket||'/'||asset.path order by asset.photo_at desc) links
          from (select photo.* from public.ph_photo_history_assets photo where photo.itemcode=row.itemcode
            and (photo.locationcode is null or photo.locationcode=row.locationcode) order by photo.photo_at desc limit 5) asset) photo on true
        where row.file_id=path_2 order by row.report_date desc nulls last,row.unique_id
        offset page_value*page_size_value limit page_size_value) records;
    end if;
  elsif operation='archive-search' then
    if record_kind='requests' then
      select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value from (
        select coalesce(history.date_completed,history.requested_at,history.created_at) occurred_at,history.unique_id id,
          jsonb_build_object('kind','record','id',history.unique_id,'title',coalesce(nullif(history.commonname,''),history.itemcode),
            'subtitle',concat_ws(' • ',coalesce(nullif(history.customer_name,''),nullif(history.customername,''),'Unassigned'),
              coalesce(nullif(history.consignee_name,''),nullif(history.consigneename,''),'Unassigned'),history.request_folder),
            'status',coalesce(nullif(history.status,''),nullif(history.req_status,''),'Completed'),
            'occurredAt',coalesce(history.date_completed,history.requested_at,history.created_at),'itemcode',coalesce(history.itemcode,''),
            'commonname',coalesce(history.commonname,''),'contsize',coalesce(history.contsize,''),'locationcode',coalesce(history.locationcode,''),
            'lotcode',coalesce(history.lotcode,''),'quantity',coalesce(history.request_qty,history.effective_qty),
            'unitListPrice',case when global_scope then coalesce(history.unit_list_price,history.listprice) else null end,
            'lineDollarValue',case when global_scope then history.line_dollar_value else null end,
            'photoLinks',private.archive_photo_array_v2366(history.photos,array[history.photo_url,history.req_photo_link,history.photo_link]),
            'facts',jsonb_build_object('Sales Rep',coalesce(history.sales_rep,history.requested_by),'Customer',coalesce(history.customer_name,history.customername),
              'Consignee',coalesce(history.consignee_name,history.consigneename),'Folder',history.request_folder,'Spec',coalesce(history.spec,history.req_spec,history.request_spec),
              'Caliper',coalesce(history.caliper,history.req_caliper,history.request_caliper),'Loc Match %',history.loc_match_pct,
              'Loc Photo Match',history.loc_photo_match),'notes',to_jsonb(array_remove(array[history.pick_note,history.av_note,history.sales_note,history.comments],null))) record
        from public.ph_requests_completed_history history
        where (global_scope or history.assigned_rep_id=actor_id)
          and lower(coalesce(history.itemcode,'')||' '||coalesce(history.commonname,'')||' '||coalesce(history.locationcode,'')||' '||
            coalesce(history.customer_name,history.customername,'')||' '||coalesce(history.consignee_name,history.consigneename,'')||' '||
            coalesce(history.request_folder,'')) like '%'||search_value||'%'
        order by coalesce(history.date_completed,history.requested_at,history.created_at) desc nulls last,history.unique_id
        limit page_size_value) records;
    elsif record_kind='orders' then
      select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value from (
        select history.archived_at occurred_at,history.order_line_key id,jsonb_build_object('kind','record','id',history.order_line_key,
          'title',coalesce(nullif(history.commonname,''),history.itemcode),'subtitle',history.order_folder_key,
          'status',coalesce(history.issue_status,history.dock_status,'Archived'),'occurredAt',coalesce(history.order_date,history.archived_at),
          'itemcode',history.itemcode,'commonname',coalesce(history.commonname,''),'contsize',coalesce(history.contsize,''),
          'locationcode',coalesce(history.locationcode,''),'lotcode',coalesce(history.lotcode,''),'quantity',history.qty_ordered,
          'unitListPrice',case when global_scope then history.unit_list_price else null end,
          'lineDollarValue',case when global_scope then history.line_dollar_value else null end,
          'photoLinks',private.archive_photo_array_v2366(history.photos,array[history.photo_url]),
          'facts',jsonb_build_object('Customer',history.customer_name,'Consignee',history.consignee_name,'Trip #',history.tripnumber,
            'Dock',history.dock_num,'Drop',history.drop_num,'PlanStart',history.planstart,'Checker',history.checker,
            'Inspector',history.inspector,'Mistake',history.mistake),'notes',to_jsonb(array_remove(array[history.issue_note,history.pick_note,history.av_note,history.sales_note],null))) record
        from public.ph_orders_history history where history.search_text like '%'||search_value||'%'
          and (global_scope or history.sales_rep_profile_id=actor_id)
        order by history.archived_at desc,history.order_line_key limit page_size_value) records;
    elsif record_kind='reserves' then
      select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value from (
        select history.archived_at occurred_at,history.reserve_history_key id,jsonb_build_object('kind','record','id',history.reserve_history_key,
          'title',coalesce(nullif(history.commonname,''),history.itemcode),'subtitle',history.reserve_folder_key,'status','Reserved',
          'occurredAt',history.archived_at,'itemcode',history.itemcode,'commonname',coalesce(history.commonname,''),
          'contsize',coalesce(history.contsize,''),'locationcode',coalesce(history.locationcode,''),'lotcode',coalesce(history.lotcode,''),
          'quantity',history.qty_reserved,'unitListPrice',case when global_scope then history.unit_list_price else null end,
          'lineDollarValue',case when global_scope then history.line_dollar_value else null end,
          'photoLinks',private.archive_photo_array_v2366(history.photos,array[history.photo_url]),
          'facts',jsonb_build_object('Sales Rep',history.sales_rep,'Customer',history.customer_name,'Consignee',history.consignee_name,
            'Order',history.order_number,'On Hand',history.on_hand,'Available',history.available_qty,'Open Stock',history.open_stock,
            'Hold',history.hold_stop_code),'notes',to_jsonb(array_remove(array[history.hold_stop_reason,history.pick_note,history.av_note,history.sales_note],null))) record
        from public.ph_reserves_history history where history.search_text like '%'||search_value||'%'
          and (global_scope or history.sales_rep_profile_id=actor_id)
        order by history.archived_at desc,history.reserve_history_key limit page_size_value) records;
    elsif record_kind='drive' then
      with dimensions as materialized (
        select distinct dimension.itemcode from public.ph_historical_inventory_dimensions dimension
        where dimension.commonname_key like '%'||search_value||'%' or lower(dimension.itemcode) like search_value||'%'
        order by dimension.itemcode limit 20),report_matches as (
        select row.report_date::timestamptz occurred_at,row.unique_id id,jsonb_build_object('kind','record','id',row.unique_id,
          'title',coalesce(nullif(row.commonname,''),row.itemcode),'subtitle',row.file_name,'status',coalesce(nullif(row.holdstopcode,''),'Archived'),
          'occurredAt',row.report_date,'itemcode',coalesce(row.itemcode,''),'commonname',coalesce(row.commonname,''),
          'contsize',coalesce(row.contsize,''),'locationcode',coalesce(row.locationcode,''),'lotcode',coalesce(row.lotcode,''),
          'quantity',row.ptravailable,'unitListPrice',null,'lineDollarValue',null,'photoLinks','[]'::jsonb,
          'facts',jsonb_build_object('File',row.file_name,'Report Date',row.report_date,'Season',row.season,'Available',row.ptravailable,
            'On Hand',row.ptronhand,'Hold',row.holdstopcode,'Hold Reason',row.holdstopreason),'notes',to_jsonb(array_remove(array[row.locationnote,row.salesnote],null))) record
        from dimensions dimension cross join lateral (select source.* from public.ph_drive_around_report_rows source
          where source.itemcode=dimension.itemcode order by source.report_date desc nulls last,source.unique_id desc limit 5) row),
      evidence_matches as (
        select history.archived_at occurred_at,history.history_key id,jsonb_build_object('kind','record','id',history.history_key,
          'title',coalesce(nullif(history.commonname,''),history.itemcode,'Historical Evidence'),'subtitle',coalesce(history.source_file_name,history.archive_reason),
          'status',history.archive_reason,'occurredAt',history.archived_at,'itemcode',coalesce(history.itemcode,''),
          'commonname',coalesce(history.commonname,''),'contsize',coalesce(history.contsize,''),'locationcode',coalesce(history.locationcode,''),
          'lotcode',coalesce(history.lotcode,''),'quantity',coalesce(history.ptravailable,history.on_hand),'unitListPrice',null,'lineDollarValue',null,
          'photoLinks',private.archive_photo_array_v2366(history.photos,array[history.photo_url]),
          'facts',jsonb_build_object('Report Date',history.report_date,'Season',history.season,'Spec',history.spec,'Caliper',history.caliper,
            'Loc Match %',history.loc_match_pct,'Loc Photo Match',history.loc_photo_match,'Hold',history.hold_stop_code),
          'notes',to_jsonb(array_remove(array[history.pick_note,history.av_note,history.sales_note,history.hold_stop_reason],null))) record
        from public.ph_drive_mode_history history where history.search_text like '%'||search_value||'%'
        order by history.archived_at desc limit page_size_value)
      select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value
      from (select * from report_matches union all select * from evidence_matches order by occurred_at desc nulls last limit page_size_value) matches;
    end if;
    row_total:=jsonb_array_length(rows_value);
  end if;

  revision_value:=case record_kind
    when 'requests' then 'requests:'||coalesce((select extract(epoch from max(updated_at))::bigint::text from public.ph_requests_completed_history),'0')
    when 'orders' then 'orders:'||coalesce((select extract(epoch from max(updated_at))::bigint::text from public.ph_orders_history),'0')
    when 'reserves' then 'reserves:'||coalesce((select extract(epoch from max(updated_at))::bigint::text from public.ph_reserves_history),'0')
    else 'drive:'||coalesce((select extract(epoch from max(updated_at))::bigint::text from public.ph_drive_mode_history_files),'0')||':'||
      coalesce((select extract(epoch from max(updated_at))::bigint::text from public.ph_drive_mode_history),'0') end;
  return jsonb_build_object('scope',case when global_scope then 'all' else 'own' end,'financials',global_scope,
    'recordKind',record_kind,'operation',operation,'path',path_value,'depth',path_length,'maxDepth',max_depth,
    'revision',revision_value,'generatedAt',clock_timestamp(),'page',page_value,'pageSize',page_size_value,
    'total',row_total,'rows',rows_value);
end
$function$;

comment on function public.historical_archive_read_v1(jsonb) is
  'Authenticated four-domain archive reader. DriveAround rows are accessed only by indexed file_id or itemcode lookups; folder counts use compact metadata tables.';
revoke all on function public.historical_archive_read_v1(jsonb) from public,anon,service_role;
grant execute on function public.historical_archive_read_v1(jsonb) to authenticated;

alter table public.ph_orders_history enable row level security;
alter table public.ph_reserves_history enable row level security;
alter table public.ph_drive_mode_history enable row level security;
alter table public.ph_drive_mode_history_files enable row level security;
revoke all on public.ph_orders_history,public.ph_reserves_history,public.ph_drive_mode_history,public.ph_drive_mode_history_files
  from public,anon,authenticated;
grant select on public.ph_orders_history,public.ph_reserves_history,public.ph_drive_mode_history,public.ph_drive_mode_history_files
  to service_role;

update public.ph_00_table_directory set
  history_table=case module_or_view when 'Drive Mode and AV' then 'public.ph_drive_mode_history'
    when 'Orders' then 'public.ph_orders_history' when 'Reserves' then 'public.ph_reserves_history' else history_table end,
  what_it_does_and_lifecycle_rules=case module_or_view when 'Drive Mode and AV' then 'Drive files use compact history metadata; 8.78M report rows stay in their indexed source and are read only by file_id or itemcode.'
    when 'Orders' then 'Permanent SOC order, imported-file and Dock accountability archive with live snapshot triggers.'
    when 'Reserves' then 'Permanent SOC reserve archive with per-file identity and live snapshot trigger.' else what_it_does_and_lifecycle_rules end,
  updated_at=clock_timestamp()
where module_or_view in ('Drive Mode and AV','Orders','Reserves');

commit;
