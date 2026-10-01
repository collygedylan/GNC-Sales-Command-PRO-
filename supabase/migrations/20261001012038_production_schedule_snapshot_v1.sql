-- Private, versioned snapshots for the 2027 Production Schedule workbook.
-- Browser reads and writes go through the authenticated app-api only.

create table public.production_schedule_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_file_id text not null default '1myBn2DzyhYtTj2MmYatf26jz575TjqxSpxC-kFt1Mhw'
    check (source_file_id = '1myBn2DzyhYtTj2MmYatf26jz575TjqxSpxC-kFt1Mhw'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed', 'superseded')),
  -- The release job may seed the first snapshot through its service-role key.
  -- Browser starts still pass a server-resolved account from the separate trio.
  requested_by text not null check (requested_by in ('dylan_collyge', 'megan_kelly', 'jd_jones', 'github_actions_release')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  source_modified_at timestamptz,
  progress jsonb not null default '{}'::jsonb,
  error_code text
);

create unique index production_schedule_one_active_import_idx
  on public.production_schedule_snapshots ((1))
  where status in ('queued', 'running');
create index production_schedule_recent_runs_idx
  on public.production_schedule_snapshots (created_at desc);

create table public.production_schedule_sheets (
  snapshot_id uuid not null references public.production_schedule_snapshots(id) on delete cascade,
  sheet_index integer not null check (sheet_index between 0 and 6),
  title text not null,
  header_row integer not null check (header_row > 0),
  columns jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array'),
  filter_columns jsonb not null default '[]'::jsonb check (jsonb_typeof(filter_columns) = 'array'),
  row_count integer not null default 0 check (row_count >= 0),
  primary key (snapshot_id, sheet_index),
  unique (snapshot_id, title)
);

create table public.production_schedule_rows (
  snapshot_id uuid not null,
  sheet_index integer not null,
  source_row integer not null check (source_row > 0),
  cells jsonb not null check (jsonb_typeof(cells) = 'object'),
  search_text text not null default '',
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(search_text, ''))) stored,
  primary key (snapshot_id, sheet_index, source_row),
  foreign key (snapshot_id, sheet_index)
    references public.production_schedule_sheets(snapshot_id, sheet_index) on delete cascade
);
create index production_schedule_rows_search_idx
  on public.production_schedule_rows using gin (search_vector);
create index production_schedule_rows_cells_idx
  on public.production_schedule_rows using gin (cells jsonb_path_ops);

create table public.production_schedule_active (
  slot smallint primary key default 1 check (slot = 1),
  snapshot_id uuid not null references public.production_schedule_snapshots(id),
  changed_at timestamptz not null default now()
);

alter table public.production_schedule_snapshots enable row level security;
alter table public.production_schedule_sheets enable row level security;
alter table public.production_schedule_rows enable row level security;
alter table public.production_schedule_active enable row level security;

revoke all on public.production_schedule_snapshots, public.production_schedule_sheets,
  public.production_schedule_rows, public.production_schedule_active from public, anon, authenticated;
grant all on public.production_schedule_snapshots, public.production_schedule_sheets,
  public.production_schedule_rows, public.production_schedule_active to service_role;

create or replace function public.production_schedule_start_import_v1(p_requested_by text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot public.production_schedule_snapshots%rowtype;
begin
  if p_requested_by not in ('dylan_collyge', 'megan_kelly', 'jd_jones', 'github_actions_release') then
    raise exception using errcode = '42501', message = 'PRODUCTION_SCHEDULE_FORBIDDEN';
  end if;
  select * into v_snapshot from public.production_schedule_snapshots
    where status in ('queued', 'running') order by created_at desc limit 1;
  if found then
    return jsonb_build_object('already_running', true, 'snapshot_id', v_snapshot.id, 'status', v_snapshot.status);
  end if;
  insert into public.production_schedule_snapshots(requested_by)
    values (p_requested_by) returning * into v_snapshot;
  return jsonb_build_object('already_running', false, 'snapshot_id', v_snapshot.id, 'status', v_snapshot.status);
exception when unique_violation then
  select * into v_snapshot from public.production_schedule_snapshots
    where status in ('queued', 'running') order by created_at desc limit 1;
  return jsonb_build_object('already_running', true, 'snapshot_id', v_snapshot.id, 'status', v_snapshot.status);
end;
$$;

create or replace function public.production_schedule_set_sheets_v1(p_snapshot_id uuid, p_sheets jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sheet jsonb;
  v_title text;
  v_columns jsonb;
  v_filters jsonb;
begin
  if p_sheets is null or jsonb_typeof(p_sheets) is distinct from 'array' or jsonb_array_length(p_sheets) <> 7 then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_SHEETS_INVALID';
  end if;
  if not exists (select 1 from public.production_schedule_snapshots where id = p_snapshot_id and status in ('queued', 'running')) then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_RUN_NOT_ACTIVE';
  end if;
  delete from public.production_schedule_sheets where snapshot_id = p_snapshot_id;
  for v_sheet in select value from jsonb_array_elements(p_sheets)
  loop
    v_title := left(btrim(coalesce(v_sheet->>'title', '')), 200);
    v_columns := coalesce(v_sheet->'columns', '[]'::jsonb);
    if v_title = '' or jsonb_typeof(v_columns) <> 'array' then
      raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_SHEET_METADATA_INVALID';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'index', (column_entry->>'index')::integer,
      'header', left(btrim(coalesce(column_entry->>'header', '')), 200)
    ) order by (column_entry->>'index')::integer), '[]'::jsonb)
      into v_columns from jsonb_array_elements(v_columns) column_entry
      where (column_entry->>'index') ~ '^[1-9][0-9]{0,3}$';
    select coalesce(jsonb_agg(jsonb_build_object(
      'index', (column_entry->>'index')::integer,
      'header', left(btrim(coalesce(column_entry->>'header', '')), 200)
    ) order by (column_entry->>'index')::integer), '[]'::jsonb)
      into v_filters from jsonb_array_elements(v_columns) column_entry
      where lower(btrim(coalesce(column_entry->>'header', ''))) in
        ('action', 'nosale', 'no sale', 'stat', 'status', 'prod yr', 'plt grp', 'plant group code',
         'csv subcode', 'target date', 'month code', 'abbreviation', 'source', 'spring/fall',
         'var/type', 'season', 'sun/shd', 'cont sz', 'plt type', 'crop&spaceneeds');
    insert into public.production_schedule_sheets(snapshot_id, sheet_index, title, header_row, columns, filter_columns, row_count)
    values (
      p_snapshot_id,
      (v_sheet->>'sheet_index')::integer,
      v_title,
      greatest(1, (v_sheet->>'header_row')::integer),
      v_columns,
      v_filters,
      0
    );
  end loop;
  update public.production_schedule_snapshots set status = 'running', started_at = coalesce(started_at, now()) where id = p_snapshot_id;
end;
$$;

create or replace function public.production_schedule_append_rows_v1(p_snapshot_id uuid, p_sheet_index integer, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 250 then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_ROW_CHUNK_INVALID';
  end if;
  if not exists (select 1 from public.production_schedule_snapshots where id = p_snapshot_id and status = 'running') then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_RUN_NOT_ACTIVE';
  end if;
  insert into public.production_schedule_rows(snapshot_id, sheet_index, source_row, cells, search_text)
  select p_snapshot_id, p_sheet_index, r.source_row, r.cells,
    coalesce((select string_agg(value, ' ') from jsonb_each_text(r.cells) where btrim(value) <> ''), '')
  from jsonb_to_recordset(p_rows) as r(source_row integer, cells jsonb)
  where r.source_row > 0 and jsonb_typeof(r.cells) = 'object'
  on conflict (snapshot_id, sheet_index, source_row) do update
    set cells = excluded.cells, search_text = excluded.search_text;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.production_schedule_update_progress_v1(
  p_snapshot_id uuid, p_sheet_index integer, p_processed_rows integer, p_total_rows integer
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.production_schedule_snapshots
  set status = 'running', started_at = coalesce(started_at, now()),
      progress = jsonb_build_object(
        'sheetIndex', greatest(0, least(6, p_sheet_index)),
        'processedRows', greatest(0, p_processed_rows),
        'totalRows', greatest(0, p_total_rows),
        'updatedAt', now()
      )
  where id = p_snapshot_id and status in ('queued', 'running');
  if not found then raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_RUN_NOT_ACTIVE'; end if;
end;
$$;

create or replace function public.production_schedule_finish_import_v1(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_min_index integer;
  v_max_index integer;
begin
  select count(*) into v_count from public.production_schedule_sheets where snapshot_id = p_snapshot_id;
  select min(sheet_index), max(sheet_index) into v_min_index, v_max_index from public.production_schedule_sheets where snapshot_id = p_snapshot_id;
  if v_count <> 7 or v_min_index <> 0 or v_max_index <> 6
    or not exists (select 1 from public.production_schedule_snapshots where id = p_snapshot_id and status in ('queued', 'running')) then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_SNAPSHOT_INCOMPLETE';
  end if;
  update public.production_schedule_sheets sh
  set row_count = (select count(*)::integer from public.production_schedule_rows r
    where r.snapshot_id = sh.snapshot_id and r.sheet_index = sh.sheet_index)
  where sh.snapshot_id = p_snapshot_id;
  update public.production_schedule_snapshots set status = 'ready', completed_at = now(), error_code = null where id = p_snapshot_id;
  update public.production_schedule_snapshots set status = 'superseded'
    where id = (select snapshot_id from public.production_schedule_active where slot = 1) and id <> p_snapshot_id;
  insert into public.production_schedule_active(slot, snapshot_id, changed_at)
    values (1, p_snapshot_id, now())
    on conflict (slot) do update set snapshot_id = excluded.snapshot_id, changed_at = excluded.changed_at;
  return jsonb_build_object('snapshot_id', p_snapshot_id, 'status', 'ready');
end;
$$;

create or replace function public.production_schedule_fail_import_v1(p_snapshot_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.production_schedule_snapshots
  set status = 'failed', completed_at = now(), error_code = left(regexp_replace(coalesce(p_error_code, 'IMPORT_FAILED'), '[^A-Z0-9_]', '_', 'g'), 100)
  where id = p_snapshot_id and status in ('queued', 'running');
end;
$$;

create or replace function public.production_schedule_read_metadata_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'snapshot', case when s.id is null then null else jsonb_build_object('id', s.id, 'importedAt', s.completed_at, 'sourceModifiedAt', s.source_modified_at) end,
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sh.sheet_index, 'index', sh.sheet_index, 'title', sh.title,
        'rowCount', sh.row_count, 'headerRow', sh.header_row, 'columns', sh.columns,
        'filterColumns', coalesce((
          select jsonb_agg(jsonb_build_object('index', (fc->>'index')::integer, 'header', fc->>'header', 'options', coalesce(opts.options, '[]'::jsonb)) order by (fc->>'index')::integer)
          from jsonb_array_elements(sh.filter_columns) fc
          left join lateral (
            select jsonb_agg(option_value order by option_value) as options from (
              select distinct r.cells->>(fc->>'index') as option_value
              from public.production_schedule_rows r
              where r.snapshot_id = sh.snapshot_id and r.sheet_index = sh.sheet_index
                and nullif(btrim(r.cells->>(fc->>'index')), '') is not null
              order by option_value limit 100
            ) distinct_options
          ) opts on true
        ), '[]'::jsonb)
      ) order by sh.sheet_index)
      from public.production_schedule_sheets sh where sh.snapshot_id = s.id
    ), '[]'::jsonb)
  )
  from public.production_schedule_active a
  join public.production_schedule_snapshots s on s.id = a.snapshot_id and s.status = 'ready'
  where a.slot = 1
  union all
  select jsonb_build_object('snapshot', null, 'sheets', '[]'::jsonb)
  where not exists (select 1 from public.production_schedule_active);
$$;

create or replace function public.production_schedule_read_rows_v1(
  p_sheet_index integer,
  p_snapshot_id uuid default null,
  p_cursor integer default 0,
  p_limit integer default 100,
  p_search text default '',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot uuid;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_search text := left(btrim(coalesce(p_search, '')), 200);
  v_limit integer := greatest(1, least(500, coalesce(p_limit, 100)));
  v_total bigint;
  v_rows jsonb;
  v_last integer;
  v_has_more boolean;
begin
  if jsonb_typeof(v_filters) <> 'object' then raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_FILTERS_INVALID'; end if;
  select coalesce(p_snapshot_id, a.snapshot_id) into v_snapshot from public.production_schedule_active a where a.slot = 1;
  if v_snapshot is null or not exists (select 1 from public.production_schedule_snapshots where id = v_snapshot and status in ('ready','superseded')) then
    return jsonb_build_object('rows', '[]'::jsonb, 'nextCursor', null, 'total', 0, 'snapshotId', null, 'hasMore', false);
  end if;
  if not exists (select 1 from public.production_schedule_sheets where snapshot_id = v_snapshot and sheet_index = p_sheet_index) then
    raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_SHEET_NOT_FOUND';
  end if;
  if exists (
    select 1 from jsonb_each_text(v_filters) f
    where f.key !~ '^[1-9][0-9]{0,3}$'
      or not exists (
        select 1 from public.production_schedule_sheets sh, jsonb_array_elements(sh.filter_columns) fc
        where sh.snapshot_id = v_snapshot and sh.sheet_index = p_sheet_index and fc->>'index' = f.key
      )
  ) then raise exception using errcode = '22023', message = 'PRODUCTION_SCHEDULE_FILTER_INVALID'; end if;

  select count(*) into v_total from public.production_schedule_rows r
  where r.snapshot_id = v_snapshot and r.sheet_index = p_sheet_index
    and (v_search = '' or r.search_vector @@ plainto_tsquery('simple', v_search))
    and not exists (select 1 from jsonb_each_text(v_filters) f where not (r.cells @> jsonb_build_object(f.key, f.value)));
  with page as (
    select r.source_row, r.cells from public.production_schedule_rows r
    where r.snapshot_id = v_snapshot and r.sheet_index = p_sheet_index
      and r.source_row > greatest(0, coalesce(p_cursor, 0))
      and (v_search = '' or r.search_vector @@ plainto_tsquery('simple', v_search))
      and not exists (select 1 from jsonb_each_text(v_filters) f where not (r.cells @> jsonb_build_object(f.key, f.value)))
    order by r.source_row limit v_limit + 1
  )
  select count(*) > v_limit,
    coalesce(jsonb_agg(jsonb_build_object('sourceRow', source_row, 'cells', cells) order by source_row) filter (where ordinal <= v_limit), '[]'::jsonb),
    max(source_row) filter (where ordinal <= v_limit)
  into v_has_more, v_rows, v_last
  from (select page.*, row_number() over (order by source_row) ordinal from page) numbered;
  return jsonb_build_object('rows', v_rows, 'nextCursor', case when v_has_more then v_last::text else null end,
    'total', v_total, 'snapshotId', v_snapshot, 'hasMore', v_has_more);
end;
$$;

create or replace function public.production_schedule_read_status_v1(p_snapshot_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select jsonb_build_object('id', s.id, 'status', s.status, 'startedAt', s.started_at,
      'updatedAt', coalesce((s.progress->>'updatedAt')::timestamptz, s.created_at),
      'progress', s.progress, 'errorCode', s.error_code, 'importedAt', s.completed_at)
    from public.production_schedule_snapshots s
    where s.id = coalesce(p_snapshot_id, (select id from public.production_schedule_snapshots order by created_at desc limit 1))
  ), jsonb_build_object('id', null, 'status', 'empty'));
$$;

revoke all on function public.production_schedule_start_import_v1(text),
  public.production_schedule_set_sheets_v1(uuid, jsonb),
  public.production_schedule_append_rows_v1(uuid, integer, jsonb),
  public.production_schedule_update_progress_v1(uuid, integer, integer, integer),
  public.production_schedule_finish_import_v1(uuid),
  public.production_schedule_fail_import_v1(uuid, text),
  public.production_schedule_read_metadata_v1(),
  public.production_schedule_read_rows_v1(integer, uuid, integer, integer, text, jsonb),
  public.production_schedule_read_status_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.production_schedule_start_import_v1(text),
  public.production_schedule_set_sheets_v1(uuid, jsonb),
  public.production_schedule_append_rows_v1(uuid, integer, jsonb),
  public.production_schedule_update_progress_v1(uuid, integer, integer, integer),
  public.production_schedule_finish_import_v1(uuid),
  public.production_schedule_fail_import_v1(uuid, text),
  public.production_schedule_read_metadata_v1(),
  public.production_schedule_read_rows_v1(integer, uuid, integer, integer, text, jsonb),
  public.production_schedule_read_status_v1(uuid)
  to service_role;
