begin;
set local lock_timeout = '5s';

-- Covers the assigned_rep_id foreign key. The existing history read path
-- already has its updated_at DESC index.
create index if not exists idx_ph_request_history_assigned_rep_id
  on public.ph_request_history (assigned_rep_id);

-- Compact, bounded cards for the schedule list. Keep the original full-row
-- endpoint available for existing callers and detail views.
create or replace function public.production_schedule_read_cards_v1(
  p_sheet_index integer,
  p_snapshot_id uuid default null,
  p_cursor integer default 0,
  p_limit integer default 100,
  p_search text default '',
  p_filters jsonb default '{}'::jsonb,
  p_column_indexes integer[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot uuid;
  v_columns jsonb;
  v_filter_columns jsonb;
  v_column_indexes integer[] := coalesce(p_column_indexes, '{}'::integer[]);
  v_requested_keys text[];
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_search text := left(btrim(coalesce(p_search, '')), 200);
  v_limit integer := greatest(1, least(500, coalesce(p_limit, 100)));
  v_total bigint;
  v_rows jsonb;
  v_last integer;
  v_has_more boolean;
begin
  if jsonb_typeof(v_filters) <> 'object' then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_FILTERS_INVALID';
  end if;
  if cardinality(v_column_indexes) > 32
    or array_position(v_column_indexes, null) is not null
    or cardinality(v_column_indexes) <> (
      select count(distinct requested_index) from unnest(v_column_indexes) requested(requested_index)
    )
  then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_COLUMNS_INVALID';
  end if;

  select coalesce(p_snapshot_id, a.snapshot_id) into v_snapshot
  from public.production_schedule_active a where a.slot = 1;
  if v_snapshot is null or not exists (
    select 1 from public.production_schedule_snapshots
    where id = v_snapshot and status in ('ready', 'superseded')
  ) then
    return jsonb_build_object('rows', '[]'::jsonb, 'nextCursor', null, 'total', 0,
      'snapshotId', null, 'hasMore', false);
  end if;

  select sh.columns, sh.filter_columns into v_columns, v_filter_columns
  from public.production_schedule_sheets sh
  where sh.snapshot_id = v_snapshot and sh.sheet_index = p_sheet_index;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_SHEET_NOT_FOUND';
  end if;
  if exists (
    select 1 from unnest(v_column_indexes) requested(requested_index)
    where requested.requested_index < 1
      or not exists (
        select 1 from jsonb_array_elements(v_columns) column_meta
        where column_meta->>'index' = requested.requested_index::text
      )
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_COLUMNS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_each_text(v_filters) f
    where f.key !~ '^[1-9][0-9]{0,3}$'
      or not exists (
        select 1 from jsonb_array_elements(v_filter_columns) fc
        where fc->>'index' = f.key
      )
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_FILTER_INVALID';
  end if;

  select array_agg(requested_index::text order by ordinal)
  into v_requested_keys
  from unnest(v_column_indexes) with ordinality requested(requested_index, ordinal);

  select count(*) into v_total
  from public.production_schedule_rows r
  where r.snapshot_id = v_snapshot and r.sheet_index = p_sheet_index
    and (v_search = '' or r.search_vector @@ plainto_tsquery('simple', v_search))
    and not exists (
      select 1 from jsonb_each_text(v_filters) f
      where not (r.cells @> jsonb_build_object(f.key, f.value))
    );

  with page as (
    select r.source_row, r.cells,
      (select count(*)::integer
       from jsonb_each_text(r.cells) source_field
       where btrim(coalesce(source_field.value, '')) <> '') as field_count,
      (select coalesce(jsonb_object_agg(source_field.key, source_field.value), '{}'::jsonb)
       from jsonb_each(r.cells) source_field
       where source_field.key = any (v_requested_keys)) as card_cells
    from public.production_schedule_rows r
    where r.snapshot_id = v_snapshot and r.sheet_index = p_sheet_index
      and r.source_row > greatest(0, coalesce(p_cursor, 0))
      and (v_search = '' or r.search_vector @@ plainto_tsquery('simple', v_search))
      and not exists (
        select 1 from jsonb_each_text(v_filters) f
        where not (r.cells @> jsonb_build_object(f.key, f.value))
      )
    order by r.source_row
    limit v_limit + 1
  )
  select count(*) > v_limit,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'sourceRow', source_row,
        'cells', card_cells,
        'fieldCount', field_count
      ) order by source_row) filter (where ordinal <= v_limit),
      '[]'::jsonb
    ),
    max(source_row) filter (where ordinal <= v_limit)
  into v_has_more, v_rows, v_last
  from (
    select page.*, row_number() over (order by source_row) ordinal
    from page
  ) numbered;

  return jsonb_build_object(
    'rows', v_rows,
    'nextCursor', case when v_has_more then v_last::text else null end,
    'total', v_total,
    'snapshotId', v_snapshot,
    'hasMore', v_has_more
  );
end;
$$;

revoke all on function public.production_schedule_read_cards_v1(integer, uuid, integer, integer, text, jsonb, integer[])
  from public, anon, authenticated;
grant execute on function public.production_schedule_read_cards_v1(integer, uuid, integer, integer, text, jsonb, integer[])
  to service_role;

commit;
