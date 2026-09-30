begin;

-- Read only one cursor-sized slice per matching ITEMCODE through the matching
-- (itemcode, report_date, unique_id) index, merge those small slices, and build
-- the response set-wise.  This prevents a 100-row page from fetching and
-- sorting tens of thousands of wide historical rows first.
create or replace function public.get_historical_inventory_rows(
  common_name text,
  container_size text,
  selected_columns text[] default array['report_date','itemcode','commonname','contsize','locationcode','lotcode','ptravailable','holdstopcode','holdstopreason']::text[],
  start_date date default null,
  end_date date default null,
  cursor_report_date date default null,
  cursor_unique_id text default null,
  result_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_name text := lower(btrim(coalesce(common_name, '')));
  safe_size text := upper(btrim(coalesce(container_size, '')));
  safe_limit integer := least(greatest(coalesce(result_limit, 100), 1), 200);
  allowed_columns constant text[] := array[
    'warehousei','plantgroupcode','itemcode','qualitycode','contsize','commonname',
    'lotcode','locationcode','source','desigitem','desigcust','desigloc','priority',
    'ptronhand','ptrreviewed','ptravailable','holdstopcode','holdstopbegindate',
    'holdstopreason','hsreasonbegin','season_supply','season_oh','season_demand',
    's_lts','oversellpercentage','itemspec','locationnote','locationnotedate',
    'suspend','suspendto','specialpuller','pulltagnote1','pulltagnote2','fieldtagcolor',
    'salesnote','inventorynote','locationptn1','locationptn2','prisetby','priupdated',
    'bypassloc','largeptrqty','maxorderquantity','lochold','listprice','ext_ptronhand',
    'varietycode','genusname','botanicalname','reversecommon','sortnamevariety',
    'containersort','saleyear','season','blockalpha','blocknumber','bay',
    'pullerresponsibility','grower','si_lts','a_lts','ai_lts','season_available',
    'holdstopenddate','salesnote_1','fnsalesnote','warehousename','mcstatus','hz',
    'intercopo','insurancegroup','brand','printedcontainercode','salesnotebegindate',
    'equiv_unit','ext_equiv_unit',
    'unique_id','file_id','file_name','report_date','row_number','item_key','genus',
    'salesyear','holdstopbegindate_raw','hold_reason_category','row_hash','created_at',
    'updated_at','source_schema_version'
  ]::text[];
  safe_columns text[];
  result_rows jsonb := '[]'::jsonb;
  next_date date := null;
  next_id text := null;
  has_more boolean := false;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'HISTORICAL_REPORT_FORBIDDEN';
  end if;
  if safe_name = '' or safe_size = '' then
    raise exception using errcode = '22023', message = 'HISTORICAL_REPORT_SELECTION_REQUIRED';
  end if;
  if start_date is not null and end_date is not null and start_date > end_date then
    raise exception using errcode = '22023', message = 'HISTORICAL_REPORT_DATE_RANGE_INVALID';
  end if;

  select coalesce(array_agg(c order by requested_order), array[]::text[])
  into safe_columns
  from (
    select lower(btrim(column_name)) as c, min(ordinality)::integer as requested_order
    from unnest(coalesce(selected_columns, array[]::text[])) with ordinality requested(column_name, ordinality)
    where lower(btrim(column_name)) = any(allowed_columns)
    group by lower(btrim(column_name))
  ) valid_columns;

  if coalesce(array_length(safe_columns, 1), 0) = 0 then
    raise exception using errcode = '22023', message = 'HISTORICAL_REPORT_COLUMNS_REQUIRED';
  end if;
  if exists (
    select 1
    from unnest(coalesce(selected_columns, array[]::text[])) requested_column
    where lower(btrim(requested_column)) <> all(allowed_columns)
  ) then
    raise exception using errcode = '22023', message = 'HISTORICAL_REPORT_COLUMN_INVALID';
  end if;

  with selected_itemcodes as materialized (
    select distinct d.itemcode
    from public.ph_historical_inventory_dimensions d
    where d.commonname_key = safe_name
      and d.contsize_key = safe_size
  ), candidate_rows as materialized (
    select item_page.*
    from selected_itemcodes d
    cross join lateral (
      select h.*
      from public.ph_drive_around_report_rows h
      where h.itemcode = d.itemcode
        and h.report_date is not null
        and lower(btrim(h.commonname)) = safe_name
        and upper(btrim(h.contsize)) = safe_size
        and (start_date is null or h.report_date >= start_date)
        and (end_date is null or h.report_date <= end_date)
        and (
          cursor_report_date is null
          or h.report_date < cursor_report_date
          or (h.report_date = cursor_report_date and h.unique_id < coalesce(cursor_unique_id, ''))
        )
      order by h.report_date desc, h.unique_id desc
      limit safe_limit + 1
    ) item_page
    order by item_page.report_date desc, item_page.unique_id desc
    limit safe_limit + 1
  ), visible_rows as (
    select c.*
    from candidate_rows c
    order by c.report_date desc, c.unique_id desc
    limit safe_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'unique_id', v.unique_id,
          'report_date', v.report_date,
          'commonname', v.commonname,
          'contsize', v.contsize,
          'values', picked.row_values
        ) order by v.report_date desc, v.unique_id desc
      ),
      '[]'::jsonb
    ),
    coalesce((select count(*) > safe_limit from candidate_rows), false),
    (array_agg(v.report_date order by v.report_date asc, v.unique_id asc))[1],
    (array_agg(v.unique_id order by v.report_date asc, v.unique_id asc))[1]
  into result_rows, has_more, next_date, next_id
  from visible_rows v
  cross join lateral (
    select coalesce(
      jsonb_object_agg(column_name, to_jsonb(v) -> column_name),
      '{}'::jsonb
    ) as row_values
    from unnest(safe_columns) column_name
  ) picked;

  return jsonb_build_object(
    'rows', result_rows,
    'selected_columns', to_jsonb(safe_columns),
    'has_more', has_more,
    'next_cursor', case when has_more and next_date is not null then jsonb_build_object(
      'report_date', next_date,
      'unique_id', next_id
    ) else null end
  );
end;
$$;

revoke all on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer)
  from public, anon;
grant execute on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer)
  to authenticated;

comment on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer) is
  'Manager-only keyset-paged history report using bounded per-ItemCode cursor scans.';

notify pgrst, 'reload schema';

commit;
