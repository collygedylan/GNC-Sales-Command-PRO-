-- Preserve the complete requested Drive Around worksheet projection in each
-- historical snapshot. Existing normalized columns remain in place for
-- filtering and hold-learning jobs; the source projection is report-only.

set statement_timeout = '15min';
set lock_timeout = '5s';

alter table public.ph_drive_around_report_rows
  add column if not exists warehousei text,
  add column if not exists plantgroupcode text,
  add column if not exists qualitycode text,
  add column if not exists source text,
  add column if not exists desigitem text,
  add column if not exists desigcust text,
  add column if not exists desigloc text,
  add column if not exists priority text,
  add column if not exists ptronhand text,
  add column if not exists ptrreviewed text,
  add column if not exists holdstopbegindate text,
  add column if not exists hsreasonbegin text,
  add column if not exists season_supply text,
  add column if not exists season_oh text,
  add column if not exists season_demand text,
  add column if not exists s_lts text,
  add column if not exists oversellpercentage text,
  add column if not exists itemspec text,
  add column if not exists locationnote text,
  add column if not exists locationnotedate text,
  add column if not exists suspend text,
  add column if not exists suspendto text,
  add column if not exists specialpuller text,
  add column if not exists pulltagnote1 text,
  add column if not exists pulltagnote2 text,
  add column if not exists fieldtagcolor text,
  add column if not exists salesnote text,
  add column if not exists inventorynote text,
  add column if not exists locationptn1 text,
  add column if not exists locationptn2 text,
  add column if not exists prisetby text,
  add column if not exists priupdated text,
  add column if not exists bypassloc text,
  add column if not exists largeptrqty text,
  add column if not exists maxorderquantity text,
  add column if not exists lochold text,
  add column if not exists listprice text,
  add column if not exists ext_ptronhand text,
  add column if not exists varietycode text,
  add column if not exists genusname text,
  add column if not exists botanicalname text,
  add column if not exists reversecommon text,
  add column if not exists sortnamevariety text,
  add column if not exists containersort text,
  add column if not exists saleyear text,
  add column if not exists blocknumber text,
  add column if not exists bay text,
  add column if not exists pullerresponsibility text,
  add column if not exists grower text,
  add column if not exists si_lts text,
  add column if not exists a_lts text,
  add column if not exists ai_lts text,
  add column if not exists season_available text,
  add column if not exists holdstopenddate text,
  add column if not exists salesnote_1 text,
  add column if not exists fnsalesnote text,
  add column if not exists warehousename text,
  add column if not exists mcstatus text,
  add column if not exists hz text,
  add column if not exists intercopo text,
  add column if not exists insurancegroup text,
  add column if not exists brand text,
  add column if not exists printedcontainercode text,
  add column if not exists salesnotebegindate text,
  add column if not exists equiv_unit text,
  add column if not exists ext_equiv_unit text,
  add column if not exists source_schema_version smallint,
  add column if not exists row_hash text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Set defaults separately so PostgreSQL does not materialize a volatile
-- timestamp across every existing historical row. The importer supplies both
-- timestamps explicitly during backfill; these defaults protect future direct
-- inserts without rewriting the multi-million-row relation.
alter table public.ph_drive_around_report_rows
  alter column created_at set default now(),
  alter column updated_at set default now();

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
  history_row public.ph_drive_around_report_rows%rowtype;
  row_values jsonb;
  result_rows jsonb := '[]'::jsonb;
  next_date date := null;
  next_id text := null;
  has_more boolean := false;
  row_number_seen integer := 0;
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

  for history_row in
    select r.*
    from public.ph_drive_around_report_rows r
    where r.report_date is not null
      and r.itemcode in (
        select d.itemcode
        from public.ph_historical_inventory_dimensions d
        where d.commonname_key = safe_name
          and d.contsize_key = safe_size
      )
      and lower(btrim(r.commonname)) = safe_name
      and upper(btrim(r.contsize)) = safe_size
      and (start_date is null or r.report_date >= start_date)
      and (end_date is null or r.report_date <= end_date)
      and (
        cursor_report_date is null
        or r.report_date < cursor_report_date
        or (r.report_date = cursor_report_date and r.unique_id < coalesce(cursor_unique_id, ''))
      )
    order by r.report_date desc, r.unique_id desc
    limit safe_limit + 1
  loop
    row_number_seen := row_number_seen + 1;
    if row_number_seen > safe_limit then
      has_more := true;
      exit;
    end if;

    select coalesce(jsonb_object_agg(column_name, to_jsonb(history_row) -> column_name), '{}'::jsonb)
    into row_values
    from unnest(safe_columns) column_name;

    result_rows := result_rows || jsonb_build_array(jsonb_build_object(
      'unique_id', history_row.unique_id,
      'report_date', history_row.report_date,
      'commonname', history_row.commonname,
      'contsize', history_row.contsize,
      'values', row_values
    ));
    next_date := history_row.report_date;
    next_id := history_row.unique_id;
  end loop;

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

revoke all on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer) from public, anon;
grant execute on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer) to authenticated;

comment on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer) is
  'Manager-only keyset-paged history report with the complete Drive Around source column allowlist.';

-- The importer upserts on the existing row identity, so requeueing is
-- idempotent and retains every existing historical row while filling the new
-- report columns. The relation is absent from the isolated UI migration base.
do $$
begin
  if to_regclass('public.ph_drive_around_report_files') is not null then
    execute $sql$
      update public.ph_drive_around_report_files f
      set
        status = 'indexed',
        row_count = 0,
        hold_row_count = 0,
        error_message = 'Requeued to populate the complete Historical Report column set.',
        raw = coalesce(f.raw, '{}'::jsonb) || jsonb_build_object(
          'requeued_source_schema_version', 1,
          'requeued_source_columns_at', now()
        )
      where lower(coalesce(f.status, '')) = 'row_indexed'
        and exists (
          select 1 from public.ph_drive_around_report_rows r where r.file_id = f.file_id
        )
        and not exists (
          select 1
          from public.ph_drive_around_report_rows r
          where r.file_id = f.file_id
            and r.source_schema_version >= 1
        )
    $sql$;
  end if;
end;
$$;
