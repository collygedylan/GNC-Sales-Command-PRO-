-- Restore Drive Around snapshot coverage after the 2026-08-16 compaction and
-- expose every canonical history-table column in the manager report RPC.
--
-- The importer is idempotent on (file_id, row_number). Requeueing manifests
-- that no longer have row payloads therefore restores missing snapshots
-- without deleting or overwriting existing historical rows.

set statement_timeout = '15min';
set lock_timeout = '5s';

update public.ph_drive_around_report_files f
set
  status = 'indexed',
  row_count = 0,
  hold_row_count = 0,
  error_message = 'Requeued after verified history compaction removed this file payload.',
  raw = coalesce(f.raw, '{}'::jsonb) || jsonb_build_object(
    'requeued_missing_rows_at', now(),
    'requeued_missing_rows_reason', 'restore_registered_file_after_20260816_compaction'
  )
where lower(coalesce(f.status, '')) = 'row_indexed'
  and not exists (
    select 1
    from public.ph_drive_around_report_rows r
    where r.file_id = f.file_id
  );

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
    'unique_id','file_id','file_name','report_date','row_number','item_key',
    'itemcode','commonname','genus','contsize','locationcode','lotcode','season',
    'blockalpha','salesyear','ptravailable','holdstopcode','holdstopreason',
    'holdstopbegindate_raw','hold_reason_category','row_hash','created_at','updated_at'
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
  'Dylan/Megan-only keyset-paged historical rows with every canonical history-table column available through a strict allowlist.';
