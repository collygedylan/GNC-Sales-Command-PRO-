begin;

set local lock_timeout='5s';
set local statement_timeout='10s';

do $patch_function$
declare
  function_definition text:=pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure);
  old_fragment constant text:=$old$
  base_result:=public.historical_archive_read_v1(p_query);
  if record_kind<>'drive' or operation not in ('archive-records','archive-search') then return base_result; end if;
$old$;
  new_fragment constant text:=$new$
  base_result:=public.historical_archive_read_v1(p_query);
  if record_kind in ('orders','reserves') and operation in ('archive-records','archive-search') then
    with state_rows as (
      select item.record,item.ordinality,
        md5(((item.record-'id')-'occurredAt')::text) state_hash
      from jsonb_array_elements(coalesce(base_result->'rows','[]'::jsonb))
        with ordinality as item(record,ordinality)
    ), deduplicated as (
      select distinct on (state_hash) record,ordinality
      from state_rows order by state_hash,ordinality
    )
    select coalesce(jsonb_agg(record order by ordinality),'[]'::jsonb)
    into rows_value from deduplicated;
    return jsonb_set(base_result,'{rows}',rows_value,true); -- state-dedup-v2366
  end if;
  if record_kind<>'drive' or operation not in ('archive-records','archive-search') then return base_result; end if;
$new$;
begin
  if position('state-dedup-v2366' in function_definition)>0 then return; end if;
  if position(old_fragment in function_definition)=0 then
    raise exception using errcode='55000',message='HISTORICAL_ARCHIVE_PAGE_DEDUP_SOURCE_MISMATCH';
  end if;
  execute replace(function_definition,old_fragment,new_fragment);
end
$patch_function$;

comment on function public.historical_archive_read_v2(jsonb) is
  'Authenticated archive reader with deterministic business-state page deduplication for Orders, Reserves, and Drive Around.';

do $assertions$
begin
  if position('state-dedup-v2366' in pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))=0
     or not has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute')
     or has_function_privilege('anon','public.historical_archive_read_v2(jsonb)','execute') then
    raise exception using errcode='55000',message='HISTORICAL_ARCHIVE_PAGE_DEDUP_FAILED';
  end if;
end
$assertions$;

commit;
