-- Manager Historical Report
--
-- The source table contains millions of immutable Drive Around snapshots.  A
-- compact name/container/item dimension keeps the drill-down fast while the
-- row RPC uses the existing (itemcode, report_date) history index and keyset
-- pagination.  Only Dylan and Megan may use these manager-report interfaces.

set statement_timeout = '15min';
set lock_timeout = '5s';

create table if not exists public.ph_historical_inventory_dimensions (
  commonname_key text not null,
  contsize_key text not null,
  itemcode_key text not null,
  commonname text not null,
  contsize text not null,
  itemcode text not null,
  historical_row_count bigint not null default 0 check (historical_row_count >= 0),
  first_report_date date,
  last_report_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (commonname_key, contsize_key, itemcode_key)
);

comment on table public.ph_historical_inventory_dimensions is
  'Compact drill-down index for Manager Historical Reports; canonical report rows remain in ph_drive_around_report_rows.';

alter table public.ph_historical_inventory_dimensions enable row level security;

revoke all on table public.ph_historical_inventory_dimensions from public, anon;
grant select on table public.ph_historical_inventory_dimensions to authenticated, service_role;
grant insert, update, delete on table public.ph_historical_inventory_dimensions to service_role;

drop policy if exists "Dylan and Megan read historical dimensions" on public.ph_historical_inventory_dimensions;
create policy "Dylan and Megan read historical dimensions"
on public.ph_historical_inventory_dimensions
for select
to authenticated
using ((select private.can_manage_eval_assignments()));

create index if not exists idx_ph_historical_inventory_dimensions_commonname
  on public.ph_historical_inventory_dimensions (commonname_key, contsize_key);

insert into public.ph_historical_inventory_dimensions (
  commonname_key,
  contsize_key,
  itemcode_key,
  commonname,
  contsize,
  itemcode,
  historical_row_count,
  first_report_date,
  last_report_date
)
select
  lower(btrim(commonname)) as commonname_key,
  upper(btrim(contsize)) as contsize_key,
  upper(btrim(itemcode)) as itemcode_key,
  max(btrim(commonname)) as commonname,
  max(btrim(contsize)) as contsize,
  max(btrim(itemcode)) as itemcode,
  count(*)::bigint as historical_row_count,
  min(report_date) as first_report_date,
  max(report_date) as last_report_date
from public.ph_drive_around_report_rows
where nullif(btrim(commonname), '') is not null
  and nullif(btrim(contsize), '') is not null
  and nullif(btrim(itemcode), '') is not null
group by lower(btrim(commonname)), upper(btrim(contsize)), upper(btrim(itemcode))
on conflict (commonname_key, contsize_key, itemcode_key) do update set
  commonname = excluded.commonname,
  contsize = excluded.contsize,
  itemcode = excluded.itemcode,
  historical_row_count = excluded.historical_row_count,
  first_report_date = excluded.first_report_date,
  last_report_date = excluded.last_report_date,
  updated_at = now();

create or replace function private.sync_historical_inventory_dimensions_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ph_historical_inventory_dimensions (
    commonname_key,
    contsize_key,
    itemcode_key,
    commonname,
    contsize,
    itemcode,
    historical_row_count,
    first_report_date,
    last_report_date
  )
  select
    lower(btrim(commonname)),
    upper(btrim(contsize)),
    upper(btrim(itemcode)),
    max(btrim(commonname)),
    max(btrim(contsize)),
    max(btrim(itemcode)),
    count(*)::bigint,
    min(report_date),
    max(report_date)
  from inserted_history_rows
  where nullif(btrim(commonname), '') is not null
    and nullif(btrim(contsize), '') is not null
    and nullif(btrim(itemcode), '') is not null
  group by lower(btrim(commonname)), upper(btrim(contsize)), upper(btrim(itemcode))
  on conflict (commonname_key, contsize_key, itemcode_key) do update set
    commonname = excluded.commonname,
    contsize = excluded.contsize,
    itemcode = excluded.itemcode,
    historical_row_count = public.ph_historical_inventory_dimensions.historical_row_count + excluded.historical_row_count,
    first_report_date = least(public.ph_historical_inventory_dimensions.first_report_date, excluded.first_report_date),
    last_report_date = greatest(public.ph_historical_inventory_dimensions.last_report_date, excluded.last_report_date),
    updated_at = now();
  return null;
end;
$$;

create or replace function private.sync_historical_inventory_dimensions_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ph_historical_inventory_dimensions (
    commonname_key,
    contsize_key,
    itemcode_key,
    commonname,
    contsize,
    itemcode,
    historical_row_count,
    first_report_date,
    last_report_date
  )
  select
    lower(btrim(commonname)),
    upper(btrim(contsize)),
    upper(btrim(itemcode)),
    max(btrim(commonname)),
    max(btrim(contsize)),
    max(btrim(itemcode)),
    count(*)::bigint,
    min(report_date),
    max(report_date)
  from updated_history_rows
  where nullif(btrim(commonname), '') is not null
    and nullif(btrim(contsize), '') is not null
    and nullif(btrim(itemcode), '') is not null
  group by lower(btrim(commonname)), upper(btrim(contsize)), upper(btrim(itemcode))
  on conflict (commonname_key, contsize_key, itemcode_key) do update set
    commonname = excluded.commonname,
    contsize = excluded.contsize,
    itemcode = excluded.itemcode,
    first_report_date = least(public.ph_historical_inventory_dimensions.first_report_date, excluded.first_report_date),
    last_report_date = greatest(public.ph_historical_inventory_dimensions.last_report_date, excluded.last_report_date),
    updated_at = now();
  return null;
end;
$$;

revoke all on function private.sync_historical_inventory_dimensions_insert() from public, anon, authenticated;
revoke all on function private.sync_historical_inventory_dimensions_update() from public, anon, authenticated;

drop trigger if exists trg_ph_history_dimensions_insert on public.ph_drive_around_report_rows;
create trigger trg_ph_history_dimensions_insert
after insert on public.ph_drive_around_report_rows
referencing new table as inserted_history_rows
for each statement
execute function private.sync_historical_inventory_dimensions_insert();

drop trigger if exists trg_ph_history_dimensions_update on public.ph_drive_around_report_rows;
create trigger trg_ph_history_dimensions_update
after update on public.ph_drive_around_report_rows
referencing new table as updated_history_rows
for each statement
execute function private.sync_historical_inventory_dimensions_update();

create or replace function public.search_historical_inventory_common_names(
  search_text text,
  result_limit integer default 75
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_search text := lower(btrim(coalesce(search_text, '')));
  safe_limit integer := least(greatest(coalesce(result_limit, 75), 1), 100);
  result_rows jsonb;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'HISTORICAL_REPORT_FORBIDDEN';
  end if;
  if length(safe_search) < 2 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(to_jsonb(matches) order by matches.match_rank, matches.commonname), '[]'::jsonb)
  into result_rows
  from (
    select
      max(d.commonname) as commonname,
      count(distinct d.contsize_key)::integer as contsize_count,
      sum(d.historical_row_count)::bigint as historical_row_count,
      min(d.first_report_date) as first_report_date,
      max(d.last_report_date) as last_report_date,
      case when d.commonname_key like safe_search || '%' then 0 else 1 end as match_rank
    from public.ph_historical_inventory_dimensions d
    where strpos(d.commonname_key, safe_search) > 0
    group by d.commonname_key
    order by match_rank, max(d.commonname)
    limit safe_limit
  ) matches;

  return result_rows;
end;
$$;

create or replace function public.get_historical_inventory_container_sizes(
  common_name text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_name text := lower(btrim(coalesce(common_name, '')));
  result_rows jsonb;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'HISTORICAL_REPORT_FORBIDDEN';
  end if;
  if safe_name = '' then
    raise exception using errcode = '22023', message = 'HISTORICAL_REPORT_COMMONNAME_REQUIRED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(sizes) order by sizes.contsize), '[]'::jsonb)
  into result_rows
  from (
    select
      max(d.contsize) as contsize,
      count(distinct d.itemcode_key)::integer as itemcode_count,
      sum(d.historical_row_count)::bigint as historical_row_count,
      min(d.first_report_date) as first_report_date,
      max(d.last_report_date) as last_report_date
    from public.ph_historical_inventory_dimensions d
    where d.commonname_key = safe_name
    group by d.contsize_key
  ) sizes;

  return result_rows;
end;
$$;

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
    'report_date','file_name','row_number','itemcode','commonname','genus','contsize',
    'locationcode','lotcode','season','blockalpha','salesyear','ptravailable',
    'holdstopcode','holdstopreason','holdstopbegindate_raw','hold_reason_category'
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
      -- ItemCodes are canonical formatted identifiers.  Keep this predicate on
      -- the raw column so PostgreSQL can use the existing
      -- (itemcode, report_date desc) history index instead of scanning all
      -- historical rows through a function-wrapped expression.
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
        or (
          r.report_date = cursor_report_date
          and r.unique_id < coalesce(cursor_unique_id, '')
        )
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

revoke all on function public.search_historical_inventory_common_names(text, integer) from public, anon;
revoke all on function public.get_historical_inventory_container_sizes(text) from public, anon;
revoke all on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer) from public, anon;
grant execute on function public.search_historical_inventory_common_names(text, integer) to authenticated;
grant execute on function public.get_historical_inventory_container_sizes(text) to authenticated;
grant execute on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer) to authenticated;

comment on function public.search_historical_inventory_common_names(text, integer) is
  'Dylan/Megan-only Common Name search for the Manager Historical Report.';
comment on function public.get_historical_inventory_container_sizes(text) is
  'Dylan/Megan-only container-size drill-down for the Manager Historical Report.';
comment on function public.get_historical_inventory_rows(text, text, text[], date, date, date, text, integer) is
  'Dylan/Megan-only keyset-paged historical rows with a strict selectable-column allowlist.';
