-- Managers -> Transactions Keyed
--
-- Source workbooks are immutable historical evidence. Apps Script writes with
-- the service role, activates a complete file atomically, and only then moves
-- that Drive file to the processed folder. Browser clients receive aggregate
-- reporting data only; they cannot mutate either import table.

set statement_timeout = '15min';
set lock_timeout = '5s';

create table if not exists public.ph_transactions_keyed_files (
  drive_file_id text primary key,
  file_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_bytes bigint check (content_bytes is null or content_bytes >= 0),
  source_sheet_name text,
  source_header_row integer check (source_header_row is null or source_header_row >= 1),
  row_count integer not null default 0 check (row_count >= 0),
  first_transaction_date date,
  last_transaction_date date,
  status text not null default 'importing' check (
    status in (
      'importing', 'archive_pending', 'processed',
      'duplicate_archive_pending', 'duplicate', 'failed'
    )
  ),
  duplicate_of_drive_file_id text references public.ph_transactions_keyed_files(drive_file_id),
  import_batch_id uuid,
  imported_at timestamptz,
  archived_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (first_transaction_date is null or last_transaction_date is null or first_transaction_date <= last_transaction_date),
  check (duplicate_of_drive_file_id is null or duplicate_of_drive_file_id <> drive_file_id)
);

comment on table public.ph_transactions_keyed_files is
  'Service-owned manifest for keyed-transaction Excel imports and exact-content duplicate auditing.';

create table if not exists public.ph_transactions_keyed_rows (
  drive_file_id text not null references public.ph_transactions_keyed_files(drive_file_id),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_sheet_name text not null,
  source_row_number integer not null check (source_row_number >= 1),
  import_batch_id uuid not null,
  source_row_hash text not null check (source_row_hash ~ '^[0-9a-f]{64}$'),

  transaction_datetime timestamp without time zone,
  invoice_datetime timestamp without time zone,
  commit_datetime timestamp without time zone,
  code_item text,
  description_1_item text,
  code_lot text,
  code_location text,
  source text,
  code_2_detail text,
  desig_item text,
  code_5_detail text,
  desig_cust text,
  code_3_detail text,
  desig_loc text,
  code_4_detail text,
  out_ordered_transaction_location numeric,
  quantity numeric,
  code_1_detail text,
  reference text,
  transaction_status text,
  created_by_detail text,
  transaction_number text,
  date_1_detail timestamp without time zone,
  reference_1_detail text,
  reference_2_detail text,
  program text,
  module text,
  transaction_type text,
  stage text,
  shipping_datetime_om_transaction_header timestamp without time zone,
  ship_to_name_om_transaction_header text,
  fm_pu_stop_number_om_transaction_header text,
  fm_trip_number_om_transaction_header text,
  ordered_quantity numeric,
  shipped_quantity_om_transaction_detail numeric,
  price numeric,
  amount numeric,
  reference_1_lot text,
  reference_2_lot text,
  reference_4_lot text,

  transaction_business_date date generated always as (transaction_datetime::date) stored,
  created_by_key text generated always as (lower(btrim(coalesce(created_by_detail, '')))) stored,
  created_at timestamptz not null default now(),
  primary key (drive_file_id, content_sha256, source_sheet_name, source_row_number)
);

comment on table public.ph_transactions_keyed_rows is
  'Canonical 40-column keyed-transaction workbook rows. Source timestamps retain their workbook wall-clock values.';

create unique index if not exists uq_ph_transactions_keyed_files_canonical_hash
  on public.ph_transactions_keyed_files (content_sha256)
  where duplicate_of_drive_file_id is null and status in ('archive_pending', 'processed');

create index if not exists idx_ph_transactions_keyed_files_status_updated
  on public.ph_transactions_keyed_files (status, updated_at desc);

create index if not exists idx_ph_transactions_keyed_files_duplicate
  on public.ph_transactions_keyed_files (duplicate_of_drive_file_id)
  where duplicate_of_drive_file_id is not null;

create index if not exists idx_ph_transactions_keyed_rows_date_creator
  on public.ph_transactions_keyed_rows (transaction_business_date, created_by_key)
  where transaction_business_date is not null and created_by_key <> '';

create index if not exists idx_ph_transactions_keyed_rows_creator_date
  on public.ph_transactions_keyed_rows (created_by_key, transaction_business_date)
  where created_by_key <> '';

create index if not exists idx_ph_transactions_keyed_rows_file_hash
  on public.ph_transactions_keyed_rows (drive_file_id, content_sha256);

create or replace function private.can_view_transactions_keyed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(coalesce((private.current_active_profile()).username, '')))
    in ('dylan_collyge', 'megan_kelly', 'jd_jones')
$$;

revoke all on function private.can_view_transactions_keyed() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_view_transactions_keyed() to authenticated;

alter table public.ph_transactions_keyed_files enable row level security;
alter table public.ph_transactions_keyed_rows enable row level security;

revoke all on table public.ph_transactions_keyed_files from public, anon, authenticated;
revoke all on table public.ph_transactions_keyed_rows from public, anon, authenticated;
grant select on table public.ph_transactions_keyed_files to authenticated;
grant select on table public.ph_transactions_keyed_rows to authenticated;
grant select, insert, update, delete on table public.ph_transactions_keyed_files to service_role;
grant select, insert, update, delete on table public.ph_transactions_keyed_rows to service_role;

drop policy if exists "Transactions Keyed managers read files" on public.ph_transactions_keyed_files;
create policy "Transactions Keyed managers read files"
on public.ph_transactions_keyed_files
for select
to authenticated
using ((select private.can_view_transactions_keyed()));

drop policy if exists "Transactions Keyed managers read rows" on public.ph_transactions_keyed_rows;
create policy "Transactions Keyed managers read rows"
on public.ph_transactions_keyed_rows
for select
to authenticated
using ((select private.can_view_transactions_keyed()));

create or replace function public.prepare_transactions_keyed_import(
  source_drive_file_id text,
  source_file_name text,
  source_content_sha256 text,
  source_content_bytes bigint default null,
  source_import_batch_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  safe_file_id text := btrim(coalesce(source_drive_file_id, ''));
  safe_file_name text := btrim(coalesce(source_file_name, ''));
  safe_hash text := lower(btrim(coalesce(source_content_sha256, '')));
  safe_batch_id uuid := coalesce(source_import_batch_id, gen_random_uuid());
  existing_file public.ph_transactions_keyed_files%rowtype;
  canonical_file public.ph_transactions_keyed_files%rowtype;
begin
  if safe_file_id = '' or safe_file_name = '' then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_FILE_IDENTITY_REQUIRED';
  end if;
  if safe_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_CONTENT_HASH_INVALID';
  end if;
  if source_content_bytes is not null and source_content_bytes < 0 then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_CONTENT_SIZE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(safe_hash, 0));

  select f.* into existing_file
  from public.ph_transactions_keyed_files f
  where f.drive_file_id = safe_file_id;

  if existing_file.drive_file_id is not null
     and existing_file.content_sha256 = safe_hash
     and existing_file.status in ('archive_pending', 'processed', 'duplicate_archive_pending', 'duplicate') then
    return jsonb_build_object(
      'status', existing_file.status,
      'driveFileId', existing_file.drive_file_id,
      'duplicateOfDriveFileId', existing_file.duplicate_of_drive_file_id,
      'rowCount', existing_file.row_count
    );
  end if;

  select f.* into canonical_file
  from public.ph_transactions_keyed_files f
  where f.content_sha256 = safe_hash
    and f.drive_file_id <> safe_file_id
    and f.duplicate_of_drive_file_id is null
    and f.status in ('archive_pending', 'processed')
  order by f.imported_at nulls last, f.created_at
  limit 1;

  if canonical_file.drive_file_id is not null then
    insert into public.ph_transactions_keyed_files (
      drive_file_id, file_name, content_sha256, content_bytes, row_count,
      status, duplicate_of_drive_file_id, import_batch_id, imported_at,
      archived_at, last_error_code, updated_at
    ) values (
      safe_file_id, safe_file_name, safe_hash, source_content_bytes, 0,
      'duplicate_archive_pending', canonical_file.drive_file_id, safe_batch_id,
      now(), null, null, now()
    )
    on conflict (drive_file_id) do update set
      file_name = excluded.file_name,
      content_sha256 = excluded.content_sha256,
      content_bytes = excluded.content_bytes,
      source_sheet_name = null,
      source_header_row = null,
      row_count = 0,
      first_transaction_date = null,
      last_transaction_date = null,
      status = 'duplicate_archive_pending',
      duplicate_of_drive_file_id = excluded.duplicate_of_drive_file_id,
      import_batch_id = excluded.import_batch_id,
      imported_at = excluded.imported_at,
      archived_at = null,
      last_error_code = null,
      updated_at = now();

    return jsonb_build_object(
      'status', 'duplicate_archive_pending',
      'driveFileId', safe_file_id,
      'duplicateOfDriveFileId', canonical_file.drive_file_id,
      'rowCount', 0
    );
  end if;

  insert into public.ph_transactions_keyed_files (
    drive_file_id, file_name, content_sha256, content_bytes, status,
    duplicate_of_drive_file_id, import_batch_id, imported_at, archived_at,
    last_error_code, updated_at
  ) values (
    safe_file_id, safe_file_name, safe_hash, source_content_bytes, 'importing',
    null, safe_batch_id, null, null, null, now()
  )
  on conflict (drive_file_id) do update set
    file_name = excluded.file_name,
    content_sha256 = excluded.content_sha256,
    content_bytes = excluded.content_bytes,
    source_sheet_name = null,
    source_header_row = null,
    row_count = 0,
    first_transaction_date = null,
    last_transaction_date = null,
    status = 'importing',
    duplicate_of_drive_file_id = null,
    import_batch_id = excluded.import_batch_id,
    imported_at = null,
    archived_at = null,
    last_error_code = null,
    updated_at = now();

  return jsonb_build_object(
    'status', 'importing',
    'driveFileId', safe_file_id,
    'importBatchId', safe_batch_id,
    'rowCount', 0
  );
end;
$$;

create or replace function public.finalize_transactions_keyed_import(
  source_drive_file_id text,
  source_content_sha256 text,
  source_sheet_name text,
  source_header_row integer,
  expected_row_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  safe_file_id text := btrim(coalesce(source_drive_file_id, ''));
  safe_hash text := lower(btrim(coalesce(source_content_sha256, '')));
  safe_sheet_name text := btrim(coalesce(source_sheet_name, ''));
  safe_header_row integer := source_header_row;
  imported_count integer;
  first_date date;
  last_date date;
  canonical_file_id text;
begin
  if safe_file_id = '' or safe_sheet_name = '' or safe_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_FINALIZE_IDENTITY_INVALID';
  end if;
  if coalesce(safe_header_row, 0) < 1 or coalesce(expected_row_count, 0) < 1 then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_FINALIZE_COUNTS_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(safe_hash, 0));

  select count(*)::integer, min(r.transaction_business_date), max(r.transaction_business_date)
  into imported_count, first_date, last_date
  from public.ph_transactions_keyed_rows r
  where r.drive_file_id = safe_file_id
    and r.content_sha256 = safe_hash
    and r.source_sheet_name = safe_sheet_name;

  if imported_count <> expected_row_count then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_ROW_COUNT_MISMATCH';
  end if;

  select f.drive_file_id into canonical_file_id
  from public.ph_transactions_keyed_files f
  where f.content_sha256 = safe_hash
    and f.drive_file_id <> safe_file_id
    and f.duplicate_of_drive_file_id is null
    and f.status in ('archive_pending', 'processed')
  order by f.imported_at nulls last, f.created_at
  limit 1;

  if canonical_file_id is not null then
    delete from public.ph_transactions_keyed_rows
    where drive_file_id = safe_file_id
      and content_sha256 = safe_hash;

    update public.ph_transactions_keyed_files
    set source_sheet_name = safe_sheet_name,
        source_header_row = safe_header_row,
        row_count = 0,
        first_transaction_date = null,
        last_transaction_date = null,
        status = 'duplicate_archive_pending',
        duplicate_of_drive_file_id = canonical_file_id,
        imported_at = now(),
        last_error_code = null,
        updated_at = now()
    where drive_file_id = safe_file_id and content_sha256 = safe_hash;

    return jsonb_build_object(
      'status', 'duplicate_archive_pending',
      'driveFileId', safe_file_id,
      'duplicateOfDriveFileId', canonical_file_id,
      'rowCount', 0
    );
  end if;

  update public.ph_transactions_keyed_files
  set source_sheet_name = safe_sheet_name,
      source_header_row = safe_header_row,
      row_count = imported_count,
      first_transaction_date = first_date,
      last_transaction_date = last_date,
      status = 'archive_pending',
      duplicate_of_drive_file_id = null,
      imported_at = now(),
      last_error_code = null,
      updated_at = now()
  where drive_file_id = safe_file_id and content_sha256 = safe_hash;

  if not found then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_MANIFEST_NOT_PREPARED';
  end if;

  return jsonb_build_object(
    'status', 'archive_pending',
    'driveFileId', safe_file_id,
    'rowCount', imported_count,
    'firstTransactionDate', first_date,
    'lastTransactionDate', last_date
  );
end;
$$;

create or replace function public.mark_transactions_keyed_file_archived(
  source_drive_file_id text,
  source_content_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  safe_file_id text := btrim(coalesce(source_drive_file_id, ''));
  safe_hash text := lower(btrim(coalesce(source_content_sha256, '')));
  final_status text;
begin
  update public.ph_transactions_keyed_files
  set status = case
        when status = 'duplicate_archive_pending' then 'duplicate'
        when status = 'archive_pending' then 'processed'
        else status
      end,
      archived_at = coalesce(archived_at, now()),
      last_error_code = null,
      updated_at = now()
  where drive_file_id = safe_file_id
    and content_sha256 = safe_hash
    and status in ('archive_pending', 'duplicate_archive_pending', 'processed', 'duplicate')
  returning status into final_status;

  if final_status is null then
    raise exception using errcode = '22023', message = 'TRANSACTIONS_KEYED_ARCHIVE_STATE_INVALID';
  end if;

  return jsonb_build_object('status', final_status, 'driveFileId', safe_file_id);
end;
$$;

create or replace function public.record_transactions_keyed_import_failure(
  source_drive_file_id text,
  source_content_sha256 text,
  sanitized_error_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  safe_file_id text := btrim(coalesce(source_drive_file_id, ''));
  safe_hash text := lower(btrim(coalesce(source_content_sha256, '')));
  safe_error_code text := left(upper(regexp_replace(coalesce(sanitized_error_code, 'IMPORT_FAILED'), '[^A-Za-z0-9_]+', '_', 'g')), 80);
  current_status text;
begin
  update public.ph_transactions_keyed_files
  set status = case when status in ('archive_pending', 'duplicate_archive_pending') then status else 'failed' end,
      last_error_code = coalesce(nullif(safe_error_code, ''), 'IMPORT_FAILED'),
      updated_at = now()
  where drive_file_id = safe_file_id and content_sha256 = safe_hash
  returning status into current_status;

  return jsonb_build_object(
    'status', coalesce(current_status, 'missing'),
    'driveFileId', safe_file_id,
    'errorCode', coalesce(nullif(safe_error_code, ''), 'IMPORT_FAILED')
  );
end;
$$;

create or replace function public.get_transactions_keyed_dashboard(
  selected_date date default null,
  creator_search text default '',
  all_dates_offset integer default 0,
  all_dates_limit integer default 250,
  files_offset integer default 0,
  files_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_search text := lower(btrim(coalesce(creator_search, '')));
  safe_all_dates_offset integer := greatest(coalesce(all_dates_offset, 0), 0);
  safe_all_dates_limit integer := least(greatest(coalesce(all_dates_limit, 250), 1), 500);
  safe_files_offset integer := greatest(coalesce(files_offset, 0), 0);
  safe_files_limit integer := least(greatest(coalesce(files_limit, 50), 1), 100);
  effective_date date;
  summary_json jsonb;
  available_dates_json jsonb;
  date_metrics_json jsonb;
  all_dates_json jsonb;
  files_json jsonb;
  all_dates_total bigint;
  files_total bigint;
begin
  if not private.can_view_transactions_keyed() then
    raise exception using errcode = '42501', message = 'TRANSACTIONS_KEYED_FORBIDDEN';
  end if;

  select max(r.transaction_business_date)
  into effective_date
  from public.ph_transactions_keyed_rows r
  join public.ph_transactions_keyed_files f
    on f.drive_file_id = r.drive_file_id
   and f.content_sha256 = r.content_sha256
  where f.status = 'processed'
    and f.duplicate_of_drive_file_id is null;

  effective_date := coalesce(selected_date, effective_date);

  select jsonb_build_object(
    'canonicalFiles', count(distinct f.drive_file_id) filter (where f.status = 'processed' and f.duplicate_of_drive_file_id is null),
    'duplicateFiles', (select count(*) from public.ph_transactions_keyed_files df where df.status = 'duplicate'),
    'totalRows', count(r.drive_file_id),
    'firstTransactionDate', min(r.transaction_business_date),
    'lastTransactionDate', max(r.transaction_business_date),
    'distinctCreators', count(distinct nullif(r.created_by_key, '')),
    'excludedRows', count(*) filter (where r.transaction_business_date is null or r.created_by_key = ''),
    'selectedDate', effective_date
  )
  into summary_json
  from public.ph_transactions_keyed_files f
  left join public.ph_transactions_keyed_rows r
    on r.drive_file_id = f.drive_file_id
   and r.content_sha256 = f.content_sha256
  where f.status = 'processed'
    and f.duplicate_of_drive_file_id is null;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.transaction_date desc), '[]'::jsonb)
  into available_dates_json
  from (
    select r.transaction_business_date as transaction_date, count(*)::bigint as row_count
    from public.ph_transactions_keyed_rows r
    join public.ph_transactions_keyed_files f
      on f.drive_file_id = r.drive_file_id and f.content_sha256 = r.content_sha256
    where f.status = 'processed'
      and f.duplicate_of_drive_file_id is null
      and r.transaction_business_date is not null
    group by r.transaction_business_date
  ) d;

  with canonical_rows as materialized (
    select r.*
    from public.ph_transactions_keyed_rows r
    join public.ph_transactions_keyed_files f
      on f.drive_file_id = r.drive_file_id and f.content_sha256 = r.content_sha256
    where f.status = 'processed' and f.duplicate_of_drive_file_id is null
      and r.created_by_key <> ''
  ), historical as (
    select created_by_key, max(btrim(created_by_detail)) as display_name, count(*)::bigint as historical_count
    from canonical_rows
    group by created_by_key
  ), historical_total as (
    select count(*)::numeric as total_count from canonical_rows
  ), daily as (
    select created_by_key, max(btrim(created_by_detail)) as display_name, count(*)::bigint as day_count
    from canonical_rows
    where transaction_business_date = effective_date
    group by created_by_key
  ), daily_total as (
    select coalesce(sum(day_count), 0)::numeric as total_count from daily
  )
  select coalesce(jsonb_agg(to_jsonb(metric) order by metric.day_count desc, metric.display_name), '[]'::jsonb)
  into date_metrics_json
  from (
    select
      d.created_by_key,
      d.display_name,
      d.day_count,
      case when dt.total_count > 0 then round((d.day_count::numeric / dt.total_count) * 100, 2) else 0 end as day_percentage,
      h.historical_count,
      case when ht.total_count > 0 then round((h.historical_count::numeric / ht.total_count) * 100, 2) else 0 end as historical_percentage
    from daily d
    join historical h using (created_by_key)
    cross join daily_total dt
    cross join historical_total ht
    where safe_search = '' or strpos(d.created_by_key, safe_search) > 0
  ) metric;

  with canonical_rows as materialized (
    select r.*
    from public.ph_transactions_keyed_rows r
    join public.ph_transactions_keyed_files f
      on f.drive_file_id = r.drive_file_id and f.content_sha256 = r.content_sha256
    where f.status = 'processed' and f.duplicate_of_drive_file_id is null
      and r.transaction_business_date is not null and r.created_by_key <> ''
  ), daily as (
    select
      transaction_business_date as transaction_date,
      created_by_key,
      max(btrim(created_by_detail)) as display_name,
      count(*)::bigint as day_count
    from canonical_rows
    group by transaction_business_date, created_by_key
  ), daily_with_total as (
    select d.*, sum(d.day_count) over (partition by d.transaction_date)::numeric as day_total
    from daily d
  ), historical as (
    select created_by_key, count(*)::bigint as historical_count
    from canonical_rows
    group by created_by_key
  ), historical_total as (
    select count(*)::numeric as total_count from canonical_rows
  ), filtered as (
    select
      d.transaction_date,
      d.created_by_key,
      d.display_name,
      d.day_count,
      round((d.day_count::numeric / nullif(d.day_total, 0)) * 100, 2) as day_percentage,
      h.historical_count,
      round((h.historical_count::numeric / nullif(ht.total_count, 0)) * 100, 2) as historical_percentage
    from daily_with_total d
    join historical h using (created_by_key)
    cross join historical_total ht
    where safe_search = '' or strpos(d.created_by_key, safe_search) > 0
  ), paged as (
    select * from filtered
    order by transaction_date desc, day_count desc, display_name
    offset safe_all_dates_offset limit safe_all_dates_limit
  )
  select
    (select count(*) from filtered),
    coalesce((select jsonb_agg(to_jsonb(p) order by p.transaction_date desc, p.day_count desc, p.display_name) from paged p), '[]'::jsonb)
  into all_dates_total, all_dates_json;

  with file_rows as (
    select
      f.drive_file_id,
      f.file_name,
      f.row_count,
      f.first_transaction_date,
      f.last_transaction_date,
      f.status,
      f.duplicate_of_drive_file_id,
      canonical.file_name as duplicate_of_file_name,
      f.imported_at,
      f.archived_at
    from public.ph_transactions_keyed_files f
    left join public.ph_transactions_keyed_files canonical
      on canonical.drive_file_id = f.duplicate_of_drive_file_id
    where f.status in ('processed', 'duplicate')
  ), paged as (
    select * from file_rows
    order by coalesce(archived_at, imported_at) desc, file_name
    offset safe_files_offset limit safe_files_limit
  )
  select
    (select count(*) from file_rows),
    coalesce((select jsonb_agg(to_jsonb(p) order by coalesce(p.archived_at, p.imported_at) desc, p.file_name) from paged p), '[]'::jsonb)
  into files_total, files_json;

  return jsonb_build_object(
    'summary', coalesce(summary_json, '{}'::jsonb),
    'availableDates', coalesce(available_dates_json, '[]'::jsonb),
    'dateMetrics', coalesce(date_metrics_json, '[]'::jsonb),
    'allDates', coalesce(all_dates_json, '[]'::jsonb),
    'allDatesTotal', coalesce(all_dates_total, 0),
    'allDatesHasMore', coalesce(all_dates_total, 0) > safe_all_dates_offset + safe_all_dates_limit,
    'files', coalesce(files_json, '[]'::jsonb),
    'filesTotal', coalesce(files_total, 0),
    'filesHasMore', coalesce(files_total, 0) > safe_files_offset + safe_files_limit
  );
end;
$$;

revoke all on function public.prepare_transactions_keyed_import(text, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.finalize_transactions_keyed_import(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_transactions_keyed_file_archived(text, text) from public, anon, authenticated;
revoke all on function public.record_transactions_keyed_import_failure(text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_transactions_keyed_import(text, text, text, bigint, uuid) to service_role;
grant execute on function public.finalize_transactions_keyed_import(text, text, text, integer, integer) to service_role;
grant execute on function public.mark_transactions_keyed_file_archived(text, text) to service_role;
grant execute on function public.record_transactions_keyed_import_failure(text, text, text) to service_role;

revoke all on function public.get_transactions_keyed_dashboard(date, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.get_transactions_keyed_dashboard(date, text, integer, integer, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
