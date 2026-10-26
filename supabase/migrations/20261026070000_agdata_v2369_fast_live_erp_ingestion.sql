begin;

alter table public.app_dataset_revisions
  add column if not exists source_modified_at timestamptz,
  add column if not exists source_content_hash text;

do $contract$
begin
  if to_regprocedure('private.merge_compact_history_state_v2366()') is null
     or to_regprocedure('private.merge_drive_around_report_state_v2366()') is null
     or not exists(select 1 from pg_indexes where schemaname='public' and tablename='ph_orders_history'
       and replace(indexdef,' ','') like '%(itemcode,row_state_hash)%')
     or not exists(select 1 from pg_indexes where schemaname='public' and tablename='ph_reserves_history'
       and replace(indexdef,' ','') like '%(itemcode,row_state_hash)%') then
    raise exception using errcode='55000',message='FAST_ERP_HISTORY_DEDUP_CONTRACT_MISSING';
  end if;
end
$contract$;

create or replace function private.fast_erp_dataset_key_v2369(p_dataset_key text)
returns text
language sql
immutable
set search_path=''
as $function$
  select case lower(btrim(coalesce(p_dataset_key,'')))
    when 'drive' then 'ph_master_inventory'
    when 'drive_around' then 'ph_master_inventory'
    when 'ph_master_inventory' then 'ph_master_inventory'
    when 'soc' then 'ph_soc_master'
    when 'soc_orders' then 'ph_soc_master'
    when 'ph_soc_master' then 'ph_soc_master'
    when 'reserves' then 'ph_reserves'
    when 'soc_reserves' then 'ph_reserves'
    when 'ph_reserves' then 'ph_reserves'
    when 'cav' then 'ph_cav_import'
    when 'ph_cav_import' then 'ph_cav_import'
    when 'warehouse_assigned' then 'ph_warehouse_assigned_items'
    when 'warehouse_assigned_items' then 'ph_warehouse_assigned_items'
    when 'ph_warehouse_assigned_items' then 'ph_warehouse_assigned_items'
    when 'hl_po' then 'ph_hl_po_parsed'
    when 'ph_hl_po_parsed' then 'ph_hl_po_parsed'
    when 'keyed_transactions' then 'ph_transactions_keyed_rows'
    when 'ph_transactions_keyed_rows' then 'ph_transactions_keyed_rows'
    else null
  end
$function$;

create or replace function private.fast_erp_timestamptz_v2369(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path=''
as $function$
begin
  if nullif(btrim(coalesce(p_value,'')),'') is null then return null; end if;
  return p_value::timestamptz;
exception when others then
  raise exception using errcode='22023',message='FAST_ERP_FILE_MODIFIED_AT_INVALID';
end
$function$;

create or replace function private.fast_erp_clean_row_v2369(p_row jsonb)
returns jsonb
language sql
immutable
set search_path=''
as $function$
  select coalesce(jsonb_object_agg(entry.key,
    case when jsonb_typeof(entry.value)='string'
      then to_jsonb(replace(entry.value#>>'{}',E'\\''',''''))
      else entry.value end), '{}'::jsonb)
  from jsonb_each(p_row) entry
$function$;

create or replace function private.fast_erp_file_meta_v2369(p_file_meta jsonb)
returns jsonb
language plpgsql
immutable
set search_path=''
as $function$
declare
  file_id text:=btrim(coalesce(p_file_meta->>'file_id',p_file_meta->>'fileId',''));
  file_name text:=btrim(coalesce(p_file_meta->>'file_name',p_file_meta->>'fileName',''));
  modified_text text:=coalesce(p_file_meta->>'modified_at',p_file_meta->>'modifiedAt');
  content_hash text:=lower(nullif(btrim(coalesce(p_file_meta->>'content_hash',p_file_meta->>'contentHash','')),''));
  report_date date;
begin
  if jsonb_typeof(p_file_meta) is distinct from 'object' or file_id='' or file_name=''
     or length(file_id)>512 or length(file_name)>1024
     or (content_hash is not null and content_hash !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='FAST_ERP_FILE_META_INVALID';
  end if;
  begin
    report_date:=coalesce(nullif(p_file_meta->>'report_date','')::date,
      nullif(p_file_meta->>'reportDate','')::date,
      private.fast_erp_timestamptz_v2369(modified_text)::date);
  exception when others then
    raise exception using errcode='22023',message='FAST_ERP_FILE_META_INVALID';
  end;
  return jsonb_build_object(
    'file_id',file_id,'file_name',file_name,
    'modified_at',private.fast_erp_timestamptz_v2369(modified_text),
    'content_hash',content_hash,'report_date',report_date,
    'web_view_link',nullif(btrim(coalesce(p_file_meta->>'web_view_link',p_file_meta->>'webViewLink','')),'')
  );
end
$function$;

create or replace function public.check_erp_file_sync_needed_v1(
  p_dataset_key text,
  p_file_id text,
  p_file_name text,
  p_modified_at text,
  p_content_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='200ms'
set lock_timeout='50ms'
as $function$
declare
  started_at timestamptz:=clock_timestamp();
  revision_key text:=private.fast_erp_dataset_key_v2369(p_dataset_key);
  modified_at timestamptz;
  content_hash text:=lower(nullif(btrim(coalesce(p_content_hash,'')),''));
  current_revision public.app_dataset_revisions%rowtype;
  up_to_date boolean:=false;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='FAST_ERP_SYNC_CHECK_FORBIDDEN';
  end if;
  if revision_key is null or nullif(btrim(coalesce(p_file_id,'')),'') is null
     or nullif(btrim(coalesce(p_file_name,'')),'') is null
     or (content_hash is not null and content_hash !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='FAST_ERP_SYNC_CHECK_INVALID';
  end if;
  if btrim(p_file_name) like '~$%' or upper(btrim(p_file_name)) like 'TEMP\_%' escape '\' then
    return jsonb_build_object('up_to_date',true,'skip',true,'ignored',true,
      'file_name',btrim(p_file_name),'dataset_key',revision_key,
      'target_ms',50,
      'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
  end if;
  modified_at:=private.fast_erp_timestamptz_v2369(p_modified_at);
  select * into current_revision from public.app_dataset_revisions
  where key=revision_key and state='ready';
  if found and current_revision.source_file_id=btrim(p_file_id) then
    up_to_date:=case
      when content_hash is not null and current_revision.source_content_hash is not null
        then current_revision.source_content_hash=content_hash
      when modified_at is not null and current_revision.source_modified_at is not null
        then current_revision.source_modified_at=modified_at
      when modified_at is not null then coalesce(current_revision.source_imported_at,current_revision.changed_at)>=modified_at
      else current_revision.source_file_name=btrim(p_file_name)
    end;
    if up_to_date and (current_revision.source_modified_at is null or
        (content_hash is not null and current_revision.source_content_hash is null)) then
      update public.app_dataset_revisions set
        source_modified_at=coalesce(source_modified_at,modified_at),
        source_content_hash=coalesce(source_content_hash,content_hash)
      where key=revision_key and state='ready' and source_file_id=btrim(p_file_id);
    end if;
  end if;
  return jsonb_build_object('up_to_date',up_to_date,'skip',up_to_date,'ignored',false,
    'file_name',btrim(p_file_name),'dataset_key',revision_key,
    'target_ms',50,
    'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
end
$function$;

create or replace function private.fast_ingest_snapshot_v2369(
  p_table regclass,
  p_rows jsonb,
  p_preserve_columns text[] default '{}'::text[],
  p_delete_missing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='55s'
set lock_timeout='5s'
as $function$
declare
  table_name text:=p_table::text;
  stage_name text:=format('fast_erp_stage_%s_%s',pg_backend_pid(),txid_current());
  cleaned_rows jsonb;
  columns text[];
  update_columns text[];
  quoted_columns text;
  update_values text;
  changed_predicate text;
  sql_text text;
  inserted_rows integer:=0;
  updated_rows integer:=0;
  deleted_rows integer:=0;
begin
  if table_name not in ('ph_soc_master','ph_reserves','ph_cav_import','ph_warehouse_assigned_items')
     and table_name not in ('public.ph_soc_master','public.ph_reserves','public.ph_cav_import','public.ph_warehouse_assigned_items') then
    raise exception using errcode='22023',message='FAST_ERP_TABLE_INVALID';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<1
     or jsonb_array_length(p_rows)>50000 or octet_length(p_rows::text)>67108864
     or exists(select 1 from jsonb_array_elements(p_rows) as source_row(row_value)
       where jsonb_typeof(row_value) is distinct from 'object') then
    raise exception using errcode='22023',message='FAST_ERP_ROWS_INVALID';
  end if;
  select jsonb_agg(private.fast_erp_clean_row_v2369(row_value)) into cleaned_rows
  from jsonb_array_elements(p_rows) as source_row(row_value);
  if exists(select 1 from jsonb_array_elements(cleaned_rows) as source_row(row_value)
      where nullif(btrim(row_value->>'unique_id'),'') is null)
     or exists(select 1 from jsonb_array_elements(cleaned_rows) as source_row(row_value)
      group by row_value->>'unique_id' having count(*)>1) then
    raise exception using errcode='22023',message='FAST_ERP_ROW_IDENTITY_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(cleaned_rows) as source_row(row_value),
      lateral jsonb_object_keys(row_value) as source_keys(source_key)
      where not exists(select 1 from pg_attribute column_row where column_row.attrelid=p_table
        and column_row.attnum>0 and not column_row.attisdropped and column_row.attname=source_key)) then
    raise exception using errcode='22023',message='FAST_ERP_COLUMN_INVALID';
  end if;
  select array_agg(column_row.attname order by column_row.attnum) into columns
  from pg_attribute column_row
  where column_row.attrelid=p_table and column_row.attnum>0 and not column_row.attisdropped
    and column_row.attgenerated='' and column_row.attidentity=''
    and exists(select 1 from jsonb_array_elements(cleaned_rows) as source_row(row_value)
      where row_value ? column_row.attname);
  if not ('unique_id'=any(columns)) then
    raise exception using errcode='22023',message='FAST_ERP_ROW_IDENTITY_INVALID';
  end if;
  execute format('create temp table %I on commit drop as select source_row.ordinality::bigint fast_row_number,typed.*
    from jsonb_array_elements($1) with ordinality source_row(value,ordinality)
    cross join lateral jsonb_populate_record(null::%s,source_row.value) typed',stage_name,p_table)
    using cleaned_rows;
  execute format('create unique index on %I(unique_id)',stage_name);
  update_columns:=array(select column_name from unnest(columns) column_name
    where column_name<>'unique_id' and not (column_name=any(coalesce(p_preserve_columns,'{}'::text[]))));
  quoted_columns:=array_to_string(array(select format('%I',column_name) from unnest(columns) column_name),',');
  update_values:=array_to_string(array(select format('%1$I=excluded.%1$I',column_name)
    from unnest(update_columns) column_name),',');
  changed_predicate:=array_to_string(array(select format('target.%1$I is distinct from excluded.%1$I',column_name)
    from unnest(update_columns) column_name),' or ');
  sql_text:=format('with changed as (
      insert into %s as target(%s) select %s from %I
      on conflict(unique_id) do update set %s where %s
      returning xmax=0 inserted)
    select count(*) filter(where inserted)::integer,count(*) filter(where not inserted)::integer from changed',
    p_table,quoted_columns,quoted_columns,stage_name,update_values,changed_predicate);
  execute sql_text into inserted_rows,updated_rows;
  if p_delete_missing then
    execute format('delete from %s target where not exists(select 1 from %I source where source.unique_id=target.unique_id)',
      p_table,stage_name);
    get diagnostics deleted_rows=row_count;
  end if;
  return jsonb_build_object('source_rows',jsonb_array_length(cleaned_rows),'inserted_rows',inserted_rows,
    'updated_rows',updated_rows,'unchanged_rows',jsonb_array_length(cleaned_rows)-inserted_rows-updated_rows,
    'deleted_rows',deleted_rows);
end
$function$;

create or replace function private.archive_soc_order_trigger_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if current_setting('agdata.fast_erp_defer_history',true)='on' then return new; end if;
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
  if current_setting('agdata.fast_erp_defer_history',true)='on' then return new; end if;
  perform private.refresh_reserve_history_v2366(new.unique_id);
  return new;
end
$function$;

create or replace function private.fast_finish_live_ingest_v2369(
  p_dataset_key text,
  p_file_meta jsonb,
  p_rows jsonb,
  p_preserve_columns text[],
  p_delete_missing boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='55s'
set lock_timeout='5s'
as $function$
declare
  started_at timestamptz:=clock_timestamp();
  revision_key text:=private.fast_erp_dataset_key_v2369(p_dataset_key);
  meta jsonb:=private.fast_erp_file_meta_v2369(p_file_meta);
  run_id uuid:=gen_random_uuid();
  begun jsonb;
  result jsonb;
  finished jsonb;
  rows_with_meta jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='FAST_ERP_INGEST_FORBIDDEN';
  end if;
  result:=public.check_erp_file_sync_needed_v1(p_dataset_key,meta->>'file_id',meta->>'file_name',
    meta->>'modified_at',meta->>'content_hash');
  if coalesce((result->>'skip')::boolean,false) then
    return result||jsonb_build_object('ok',true,'dataset_key',revision_key,'source_rows',0);
  end if;
  if revision_key not in ('ph_soc_master','ph_reserves','ph_cav_import','ph_warehouse_assigned_items') then
    raise exception using errcode='22023',message='FAST_ERP_DATASET_INVALID';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<1
     or jsonb_array_length(p_rows)>50000 or octet_length(p_rows::text)>67108864 then
    raise exception using errcode='22023',message='FAST_ERP_ROWS_INVALID';
  end if;
  select jsonb_agg(private.fast_erp_clean_row_v2369(row_value)
      ||jsonb_build_object('filename',meta->>'file_name','last_updated',clock_timestamp()) order by ordinality)
  into rows_with_meta
  from jsonb_array_elements(p_rows) with ordinality source_row(row_value,ordinality);
  begun:=public.begin_dataset_import_v1(array[revision_key],run_id,array[revision_key]);
  if coalesce((begun->>'ok')::boolean,false) is distinct from true or begun->>'state'<>'active' then
    raise exception using errcode='55000',message='FAST_ERP_IMPORT_FENCE_FAILED';
  end if;
  perform set_config('agdata.fast_erp_defer_history','on',true);
  result:=private.fast_ingest_snapshot_v2369(to_regclass('public.'||revision_key),rows_with_meta,
    p_preserve_columns,p_delete_missing);
  perform set_config('agdata.fast_erp_defer_history','off',true);
  if revision_key='ph_soc_master' then perform private.refresh_soc_order_history_v2366(null); end if;
  if revision_key='ph_reserves' then perform private.refresh_reserve_history_v2366(null); end if;
  finished:=public.finish_dataset_import_with_sources_v1(run_id,jsonb_build_array(jsonb_build_object(
    'key',revision_key,'fileName',meta->>'file_name','fileId',meta->>'file_id')));
  if coalesce((finished->>'ok')::boolean,false) is distinct from true
     or coalesce((finished->>'sourceMetadataStamped')::boolean,false) is distinct from true then
    raise exception using errcode='55000',message='FAST_ERP_IMPORT_FINISH_FAILED';
  end if;
  update public.app_dataset_revisions set source_modified_at=(meta->>'modified_at')::timestamptz,
    source_content_hash=nullif(meta->>'content_hash','') where key=revision_key and state='ready';
  return result||jsonb_build_object('ok',true,'skip',false,'up_to_date',false,'dataset_key',revision_key,
    'file_name',meta->>'file_name','target_ms',2000,
    'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
end
$function$;

create or replace function private.fast_archive_drive_v2369(p_file_meta jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  meta jsonb:=private.fast_erp_file_meta_v2369(p_file_meta);
  common_columns text;
  insert_columns text;
  select_columns text;
  row_count integer;
  history_count integer;
  sql_text text;
begin
  select string_agg(format('%I',master_column.attname),',' order by master_column.attnum)
  into common_columns
  from pg_attribute master_column
  join pg_attribute report_column on report_column.attrelid='public.ph_drive_around_report_rows'::regclass
    and report_column.attname=master_column.attname and report_column.attnum>0 and not report_column.attisdropped
    and report_column.attgenerated=''
  where master_column.attrelid='public.ph_master_inventory'::regclass and master_column.attnum>0
    and not master_column.attisdropped and master_column.attgenerated=''
    and master_column.attname not in ('unique_id','created_at','updated_at','row_hash','row_state_hash');
  insert_columns:=case when common_columns is null then '' else ','||common_columns end;
  select_columns:=case when common_columns is null then '' else ','||common_columns end;
  sql_text:=format('insert into public.ph_drive_around_report_rows(
      unique_id,file_id,file_name,report_date,row_number,item_key,row_hash,source_schema_version%s)
    select md5($1||''|''||master.unique_id),$1,$2,$3,row_number() over(order by master.unique_id)::integer,
      lower(btrim(coalesce(master.itemcode,''))),encode(extensions.digest(convert_to(to_jsonb(master)::text,''UTF8''),''sha256''),''hex''),1%s
    from public.ph_master_inventory master on conflict(unique_id) do update set updated_at=clock_timestamp()',
    insert_columns,select_columns);
  execute sql_text using meta->>'file_id',meta->>'file_name',(meta->>'report_date')::date;
  get diagnostics row_count=row_count;
  insert into public.ph_drive_around_report_files(file_id,file_name,mime_type,report_date,drive_modified_time,web_view_link,
    processed_at,row_count,hold_row_count,status,raw,updated_at)
  select meta->>'file_id',meta->>'file_name','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    (meta->>'report_date')::date,(meta->>'modified_at')::timestamptz,meta->>'web_view_link',clock_timestamp(),
    count(*)::integer,count(*) filter(where nullif(btrim(coalesce(holdstopcode,'')),'') is not null)::integer,
    'processed',jsonb_build_object('pipeline','fast-live-erp-v2369'),clock_timestamp()
  from public.ph_master_inventory
  on conflict(file_id) do update set file_name=excluded.file_name,report_date=excluded.report_date,
    drive_modified_time=excluded.drive_modified_time,web_view_link=excluded.web_view_link,processed_at=excluded.processed_at,
    row_count=excluded.row_count,hold_row_count=excluded.hold_row_count,status='processed',error_message=null,
    raw=excluded.raw,updated_at=clock_timestamp();
  insert into public.ph_drive_mode_history(history_key,source_kind,source_unique_id,source_file_id,source_file_name,
    report_date,itemcode,commonname,contsize,locationcode,lotcode,season,ptravailable,on_hand,review,available,
    open_stock,pri,unit_list_price,photos,photo_url,photo_date,spec,caliper,loc_match_pct,loc_photo_match,
    pick_note,av_note,sales_note,hold_stop_code,hold_stop_reason,archive_reason,archived_at,updated_at)
  select md5((meta->>'file_id')||'|'||master.unique_id),'drive_around',master.unique_id,meta->>'file_id',meta->>'file_name',
    (meta->>'report_date')::date,master.itemcode,master.commonname,master.contsize,master.locationcode,master.lotcode,
    master.season,master.available,master.on_hand,master.review,master.available,master.open_stock,master.pri,
    master.unit_list_price,coalesce(master.photos,'[]'::jsonb),master.photo_url,master.photo_date::text,master.spec,
    master.caliper,master.loc_match_pct,master.loc_photo_match,master.pick_note,master.av_note,master.sales_note,
    master.hold_stop_code,master.hold_stop_reason,'drive_file_snapshot',clock_timestamp(),clock_timestamp()
  from public.ph_master_inventory master
  on conflict(history_key) do update set updated_at=clock_timestamp();
  get diagnostics history_count=row_count;
  return jsonb_build_object('report_rows',row_count,'history_rows',history_count);
end
$function$;

create or replace function public.fast_ingest_drive_around_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='55s'
set lock_timeout='5s'
as $function$
declare
  started_at timestamptz:=clock_timestamp();
  meta jsonb:=private.fast_erp_file_meta_v2369(p_file_meta);
  preflight jsonb;
  run_id uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid();
  bulk_rows jsonb;
  bulk_result jsonb;
  archive_result jsonb;
  finished jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='FAST_ERP_INGEST_FORBIDDEN';
  end if;
  preflight:=public.check_erp_file_sync_needed_v1('drive_around',meta->>'file_id',meta->>'file_name',
    meta->>'modified_at',meta->>'content_hash');
  if coalesce((preflight->>'skip')::boolean,false) then
    return preflight||jsonb_build_object('ok',true,'source_rows',0);
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<1
     or jsonb_array_length(p_rows)>50000 or octet_length(p_rows::text)>67108864 then
    raise exception using errcode='22023',message='FAST_ERP_ROWS_INVALID';
  end if;
  select jsonb_agg(case when row_value ? 'values' then
      jsonb_build_object('values',private.fast_erp_clean_row_v2369(row_value->'values')
        ||jsonb_build_object('filename',meta->>'file_name','last_updated',clock_timestamp()),
        'rawFields',coalesce(row_value->'rawFields','[]'::jsonb))
    else jsonb_build_object('values',private.fast_erp_clean_row_v2369(row_value)
        ||jsonb_build_object('filename',meta->>'file_name','last_updated',clock_timestamp()),
      'rawFields',(select coalesce(jsonb_agg(field_name order by field_name),'[]'::jsonb)
        from unnest(array['locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility',
          'oversellpercentage','salesnote','suspend']) field_name where row_value ? field_name)) end order by ordinality)
  into bulk_rows from jsonb_array_elements(p_rows) with ordinality source_row(row_value,ordinality);
  if exists(select 1 from jsonb_array_elements(bulk_rows) as source_row(row_value)
      where nullif(btrim(row_value->'values'->>'unique_id'),'') is null)
     or exists(select 1 from jsonb_array_elements(bulk_rows) as source_row(row_value)
      group by row_value->'values'->>'unique_id' having count(*)>1) then
    raise exception using errcode='22023',message='FAST_ERP_ROW_IDENTITY_INVALID';
  end if;
  if coalesce((public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory'])->>'ok')::boolean,false)
     is distinct from true then
    raise exception using errcode='55000',message='FAST_ERP_IMPORT_FENCE_FAILED';
  end if;
  bulk_result:=public.bulk_import_master_snapshot_v1(run_id,request_id,bulk_rows,
    encode(extensions.digest(convert_to(bulk_rows::text,'UTF8'),'sha256'),'hex'));
  perform public.reconcile_inventory_location_evidence_v1();
  archive_result:=private.fast_archive_drive_v2369(meta);
  finished:=public.finish_dataset_import_with_sources_v1(run_id,jsonb_build_array(jsonb_build_object(
    'key','ph_master_inventory','fileName',meta->>'file_name','fileId',meta->>'file_id')));
  if coalesce((finished->>'ok')::boolean,false) is distinct from true
     or coalesce((finished->>'sourceMetadataStamped')::boolean,false) is distinct from true then
    raise exception using errcode='55000',message='FAST_ERP_IMPORT_FINISH_FAILED';
  end if;
  update public.app_dataset_revisions set source_modified_at=(meta->>'modified_at')::timestamptz,
    source_content_hash=nullif(meta->>'content_hash','') where key='ph_master_inventory' and state='ready';
  return bulk_result||archive_result||jsonb_build_object('ok',true,'skip',false,'up_to_date',false,
    'dataset_key','ph_master_inventory','file_name',meta->>'file_name','source_rows',jsonb_array_length(p_rows),
    'target_ms',2000,
    'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
end
$function$;

create or replace function public.fast_ingest_soc_orders_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb language sql security definer set search_path='' as $function$
  select private.fast_finish_live_ingest_v2369('soc',p_file_meta,p_rows,array[
    'assignedto','date_completed','dock_photo_link','dock_photo_name','dock_spec','dock_caliper','dock_note',
    'spec','caliper','pic_note','av_note','photo_link','photo_name','initial_ptr','loc_match_qty','app_tab_assignment',
    'match','sales_note','suspend_candidate_group','state','order_quantity','origin_uid'],true)
$function$;

create or replace function public.fast_ingest_soc_reserves_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb language sql security definer set search_path='' as $function$
  select private.fast_finish_live_ingest_v2369('reserves',p_file_meta,p_rows,array[
    'assigned_to','assignedto','date_completed','dock_photo_link','dock_photo_name','dock_spec','dock_caliper','dock_note',
    'spec','caliper','pic_note','av_note','photo_link','photo_name','initial_ptr','loc_match_qty','app_tab_assignment',
    'match','sales_note'],true)
$function$;

create or replace function public.fast_ingest_cav_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb language sql security definer set search_path='' as $function$
  select private.fast_finish_live_ingest_v2369('cav',p_file_meta,p_rows,'{}'::text[],true)
$function$;

create or replace function public.fast_ingest_warehouse_assigned_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb language sql security definer set search_path='' as $function$
  select private.fast_finish_live_ingest_v2369('warehouse_assigned',p_file_meta,p_rows,array[
    'id','assignedto','assigned_by','assigned_at','first_seen_at','last_seen_at','present_in_drive',
    'unassigned_notified_at','zone_override_active','zone_override_prior_assignedto','zone_override_prior_assigned_by',
    'zone_override_prior_assigned_at','zone_override_rule_version','zone_override_evaluated_revision','assignment_reason'],false)
$function$;

revoke all on function private.fast_erp_dataset_key_v2369(text) from public,anon,authenticated,service_role;
revoke all on function private.fast_erp_timestamptz_v2369(text) from public,anon,authenticated,service_role;
revoke all on function private.fast_erp_clean_row_v2369(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.fast_erp_file_meta_v2369(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.fast_ingest_snapshot_v2369(regclass,jsonb,text[],boolean) from public,anon,authenticated,service_role;
revoke all on function private.fast_finish_live_ingest_v2369(text,jsonb,jsonb,text[],boolean) from public,anon,authenticated,service_role;
revoke all on function private.fast_archive_drive_v2369(jsonb) from public,anon,authenticated,service_role;

revoke all on function public.check_erp_file_sync_needed_v1(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.fast_ingest_drive_around_v1(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.fast_ingest_soc_orders_v1(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.fast_ingest_soc_reserves_v1(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.fast_ingest_cav_v1(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.fast_ingest_warehouse_assigned_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.check_erp_file_sync_needed_v1(text,text,text,text,text) to service_role;
grant execute on function public.fast_ingest_drive_around_v1(jsonb,jsonb) to service_role;
grant execute on function public.fast_ingest_soc_orders_v1(jsonb,jsonb) to service_role;
grant execute on function public.fast_ingest_soc_reserves_v1(jsonb,jsonb) to service_role;
grant execute on function public.fast_ingest_cav_v1(jsonb,jsonb) to service_role;
grant execute on function public.fast_ingest_warehouse_assigned_v1(jsonb,jsonb) to service_role;

comment on function public.check_erp_file_sync_needed_v1(text,text,text,text,text)
  is 'AgData v2.3.69 constant-time READY revision fast-skip for live ERP files.';
comment on function public.fast_ingest_drive_around_v1(jsonb,jsonb)
  is 'AgData v2.3.69 atomic set-based DriveAround snapshot ingestion with protected evaluation state and compact history.';
comment on function public.fast_ingest_soc_orders_v1(jsonb,jsonb)
  is 'AgData v2.3.69 atomic set-based SOC Open Orders ingestion with app-owned workflow preservation.';
comment on function public.fast_ingest_soc_reserves_v1(jsonb,jsonb)
  is 'AgData v2.3.69 atomic set-based SOC Reserves ingestion and compact state history.';
comment on function public.fast_ingest_cav_v1(jsonb,jsonb)
  is 'AgData v2.3.69 atomic set-based CAV ingestion.';
comment on function public.fast_ingest_warehouse_assigned_v1(jsonb,jsonb)
  is 'AgData v2.3.69 guarded Warehouse Assigned snapshot ingestion; assignment authority remains in Supabase.';

commit;
