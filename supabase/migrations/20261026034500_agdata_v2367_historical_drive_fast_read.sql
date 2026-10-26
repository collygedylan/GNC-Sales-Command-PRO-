begin;

set local lock_timeout='5s';
set local statement_timeout='10s';

create or replace function private.historical_drive_file_page_v2367(
  p_file_id text,
  p_page integer,
  p_page_size integer
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  with prepared as materialized (
    select row.unique_id,row.updated_at,row.report_date,
      lower(btrim(coalesce(row.itemcode,''))) item_key_v2367,
      coalesce(row.row_state_hash,md5(concat_ws('|',
        lower(btrim(coalesce(row.itemcode,''))),lower(btrim(coalesce(row.commonname,''))),
        lower(btrim(coalesce(row.contsize,''))),lower(btrim(coalesce(row.locationcode,''))),
        lower(btrim(coalesce(row.lotcode,''))),
        coalesce((case when regexp_replace(coalesce(row.ptronhand::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.ptronhand::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),
        coalesce((case when regexp_replace(coalesce(row.ptrreviewed::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.ptrreviewed::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),
        coalesce(row.ptravailable::text,'0'),
        coalesce((case when regexp_replace(coalesce(row.s_lts::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.s_lts::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),'0',
        lower(btrim(coalesce(row.priority,''))),lower(btrim(coalesce(row.holdstopcode,''))),
        lower(btrim(coalesce(row.holdstopreason,''))),
        coalesce((case when regexp_replace(coalesce(row.listprice::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.listprice::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),
        lower(btrim(coalesce(row.itemspec,''))),'',lower(btrim(coalesce(row.locationnote,''))),'',
        lower(btrim(coalesce(row.salesnote,''))),''))) state_hash_v2367
    from public.ph_drive_around_report_rows row
    where row.file_id=p_file_id
  ), distinct_rows as materialized (
    select distinct on (item_key_v2367,state_hash_v2367) prepared.unique_id,prepared.report_date from prepared
    order by item_key_v2367,state_hash_v2367,updated_at desc,unique_id desc
  ), paged as materialized (
    select distinct_rows.*,count(*) over() full_count from distinct_rows
    order by report_date desc nulls last,unique_id
    offset p_page*p_page_size limit p_page_size
  ), records as (
    select paged.full_count,row.report_date::timestamptz occurred_at,row.unique_id id,
      jsonb_build_object('kind','record','id',row.unique_id,
        'title',coalesce(nullif(row.commonname,''),row.itemcode),'subtitle',row.file_name,
        'status',coalesce(nullif(row.holdstopcode,''),'Archived'),'occurredAt',row.report_date,
        'itemcode',coalesce(row.itemcode,''),'commonname',coalesce(row.commonname,''),
        'contsize',coalesce(row.contsize,''),'locationcode',coalesce(row.locationcode,''),
        'lotcode',coalesce(row.lotcode,''),'quantity',row.ptravailable,
        'unitListPrice',null,'lineDollarValue',null,'photoLinks',coalesce(photo.links,'[]'::jsonb),
        'facts',jsonb_build_object('File',row.file_name,'Report Date',row.report_date,'Season',row.season,
          'Available',row.ptravailable,'On Hand',row.ptronhand,'Review',row.ptrreviewed,'Open Stock',row.s_lts,
          'Hold',row.holdstopcode,'Hold Reason',row.holdstopreason,'Spec',row.itemspec,'Seen',row.seen_count),
        'notes',to_jsonb(array_remove(array[row.locationnote,row.salesnote,row.inventorynote],null))) record
    from paged join public.ph_drive_around_report_rows row on row.unique_id=paged.unique_id
    left join lateral (
      select jsonb_agg('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||asset.bucket||'/'||asset.path order by asset.photo_at desc) links
      from (select photo.* from public.ph_photo_history_assets photo where photo.itemcode=row.itemcode
        and (photo.locationcode is null or photo.locationcode=row.locationcode) order by photo.photo_at desc limit 5) asset
    ) photo on true
  )
  select jsonb_build_object(
    'rows',coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb),
    'total',coalesce(max(full_count),0)
  ) from records
$function$;
revoke all on function private.historical_drive_file_page_v2367(text,integer,integer) from public,anon,authenticated,service_role;

do $patch_drive_archive$
declare
  function_definition text:=pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure);
  old_fragment constant text:=$old$
begin
  base_result:=public.historical_archive_read_v1(p_query);
$old$;
  new_fragment constant text:=$new$
begin
  if record_kind='drive' and operation='archive-records' then
    if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
      or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) key
        where key not in ('operation','recordKind','path','page','pageSize','view'))
      or (p_query ? 'view' and (jsonb_typeof(p_query->'view')<>'string'
        or p_query->>'view' not in ('historical-requests','request-history')))
      or jsonb_typeof(p_query->'path')<>'array' or jsonb_array_length(p_query->'path')<>3
      or exists(select 1 from jsonb_array_elements(p_query->'path') entry
        where jsonb_typeof(entry)<>'string' or length(entry#>>'{}') not between 1 and 500)
      or path_value->>0 !~ '^[0-9]{4}$'
      or path_value->>1 !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or left(path_value->>1,4)<>path_value->>0
      or (p_query ? 'page' and (jsonb_typeof(p_query->'page')<>'number'
        or coalesce(p_query->>'page','') !~ '^(0|[1-9][0-9]{0,4})$'))
      or (p_query ? 'pageSize' and (jsonb_typeof(p_query->'pageSize')<>'number'
        or coalesce(p_query->>'pageSize','') !~ '^[1-9][0-9]?$|^100$')) then
      raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
    end if;
    base_result:=public.historical_archive_read_v1(jsonb_build_object(
      'operation','archive-folders','recordKind','drive','path','[]'::jsonb,'page',0,'pageSize',1)
      || case when p_query ? 'view' then jsonb_build_object('view',p_query->'view') else '{}'::jsonb end);
    with page as materialized (
      select private.historical_drive_file_page_v2367(path_value->>2,page_value,page_size_value) result
    )
    select result->'rows',(result->>'total')::bigint into rows_value,row_total from page;
    return base_result||jsonb_build_object('operation',operation,'recordKind',record_kind,
      'path',path_value,'depth',jsonb_array_length(path_value),'maxDepth',3,
      'page',page_value,'pageSize',page_size_value,'total',row_total,'rows',rows_value);
  end if;
  base_result:=public.historical_archive_read_v1(p_query);
$new$;
begin
  if position('historical_drive_file_page_v2367(path_value->>2' in function_definition)>0 then return; end if;
  if position(old_fragment in function_definition)=0 then
    raise exception using errcode='55000',message='HISTORICAL_DRIVE_FAST_READ_SOURCE_MISMATCH';
  end if;
  execute replace(function_definition,old_fragment,new_fragment);
end
$patch_drive_archive$;

do $archive_assertions$
begin
  if to_regprocedure('private.historical_drive_file_page_v2367(text,integer,integer)') is null
    or position('historical_drive_file_page_v2367(path_value->>2' in
      pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))=0
    or has_function_privilege('authenticated','private.historical_drive_file_page_v2367(text,integer,integer)','execute')
    or not has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute') then
    raise exception using errcode='55000',message='HISTORICAL_DRIVE_FAST_READ_FAILED';
  end if;
end
$archive_assertions$;

commit;
