begin;

set local lock_timeout='5s';
set local statement_timeout='10s';

do $patch_function$
declare
  function_definition text:=pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure);
  old_fragment constant text:=$old$
      from dimensions dimension cross join lateral (
        select distinct on (coalesce(source.row_state_hash,private.drive_around_report_state_hash_v2366(source))) source.*
        from public.ph_drive_around_report_rows source where source.itemcode=dimension.itemcode
        order by coalesce(source.row_state_hash,private.drive_around_report_state_hash_v2366(source)),
          source.report_date desc nulls last,source.unique_id desc limit 5
      ) row
$old$;
  new_fragment constant text:=$new$
      from dimensions dimension cross join lateral (
        -- drive-search-row-alias-v2366
        select distinct on (coalesce(raw_row.row_state_hash,private.drive_around_report_state_hash_v2366(raw_row))) raw_row.*
        from public.ph_drive_around_report_rows raw_row where raw_row.itemcode=dimension.itemcode
        order by coalesce(raw_row.row_state_hash,private.drive_around_report_state_hash_v2366(raw_row)),
          raw_row.report_date desc nulls last,raw_row.unique_id desc limit 5
      ) row
$new$;
begin
  if position('drive-search-row-alias-v2366' in function_definition)>0 then return; end if;
  if position(old_fragment in function_definition)=0 then
    raise exception using errcode='55000',message='DRIVE_ARCHIVE_SEARCH_HASH_SOURCE_MISMATCH';
  end if;
  execute replace(function_definition,old_fragment,new_fragment);
end
$patch_function$;

do $assertions$
declare
  function_definition text:=pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure);
begin
  if position('drive-search-row-alias-v2366' in function_definition)=0
     or position('drive_around_report_state_hash_v2366(raw_row)' in function_definition)=0
     or not has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute')
     or has_function_privilege('anon','public.historical_archive_read_v2(jsonb)','execute') then
    raise exception using errcode='55000',message='DRIVE_ARCHIVE_SEARCH_HASH_FIX_FAILED';
  end if;
end
$assertions$;

commit;
