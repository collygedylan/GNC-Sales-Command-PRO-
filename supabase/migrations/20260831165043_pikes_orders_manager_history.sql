begin;

-- Immutable Pikes order history sourced from the managed Google Drive drop folder.
-- Source rows and Drive Mode rows are frozen at import time; browser clients are read-only.

create table if not exists public.ph_pikes_order_batches (
  batch_id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  source_key text not null default 'pikes' check (source_key = 'pikes'),
  file_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_bytes bigint check (content_bytes is null or content_bytes >= 0),
  source_sheet_name text,
  source_header_row integer check (source_header_row is null or source_header_row >= 1),
  status text not null default 'importing'
    check (status in ('importing', 'archive_pending', 'processed', 'failed')),
  batch_date date,
  daily_sequence integer check (daily_sequence is null or daily_sequence >= 1),
  display_name text,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  distinct_item_count integer not null default 0 check (distinct_item_count >= 0),
  matched_item_count integer not null default 0 check (matched_item_count >= 0),
  unmatched_item_count integer not null default 0 check (unmatched_item_count >= 0),
  inventory_row_count integer not null default 0 check (inventory_row_count >= 0),
  last_error_code text,
  imported_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, batch_date, daily_sequence)
);

comment on table public.ph_pikes_order_batches is
  'Service-owned Pikes order file ledger. Every Drive file is an independent frozen historical batch.';

create table if not exists public.ph_pikes_order_source_rows (
  batch_id uuid not null references public.ph_pikes_order_batches(batch_id) on delete cascade,
  source_row_number integer not null check (source_row_number >= 1),
  itemcode text not null,
  itemcode_normalized text not null,
  order_tot text,
  pick_notes text,
  matched boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (batch_id, source_row_number),
  check (itemcode_normalized = upper(btrim(itemcode_normalized)) and itemcode_normalized <> '')
);

comment on table public.ph_pikes_order_source_rows is
  'Approved Item, Order TOT, and Pick Notes source fields retained for each Pikes workbook row.';

create table if not exists public.ph_pikes_order_inventory_rows (
  batch_id uuid not null references public.ph_pikes_order_batches(batch_id) on delete cascade,
  master_unique_id text not null,
  itemcode text not null,
  itemcode_normalized text not null,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  assignedto text,
  assignedto_key text generated always as (
    coalesce(nullif(lower(btrim(assignedto)), ''), '__unassigned__')
  ) stored,
  priority text,
  ptronhand text,
  ptrreviewed text,
  ptravailable text,
  s_lts text,
  season text,
  blockalpha text,
  blocknumber text,
  fieldtagcolor text,
  desigitem text,
  desigloc text,
  holdstopcode text,
  holdstopreason text,
  itemspec text,
  locationnote text,
  locationnotedate text,
  photo_link text,
  photo_name text,
  snapshotted_at timestamptz not null default now(),
  primary key (batch_id, master_unique_id),
  check (itemcode_normalized = upper(btrim(itemcode_normalized)) and itemcode_normalized <> '')
);

comment on table public.ph_pikes_order_inventory_rows is
  'Whitelisted immutable Drive Mode row snapshot matched to one Pikes order batch.';

create index if not exists idx_ph_master_inventory_itemcode_normalized
  on public.ph_master_inventory (upper(btrim(itemcode)))
  where itemcode is not null and btrim(itemcode) <> '';
create index if not exists idx_ph_pikes_batches_history
  on public.ph_pikes_order_batches (source_key, imported_at desc, batch_id desc)
  where status in ('archive_pending', 'processed');
create index if not exists idx_ph_pikes_source_item
  on public.ph_pikes_order_source_rows (batch_id, itemcode_normalized, source_row_number);
create index if not exists idx_ph_pikes_inventory_page
  on public.ph_pikes_order_inventory_rows (batch_id, itemcode_normalized, master_unique_id);
create index if not exists idx_ph_pikes_inventory_assignee
  on public.ph_pikes_order_inventory_rows (batch_id, assignedto_key, itemcode_normalized, master_unique_id);

alter table public.ph_pikes_order_batches enable row level security;
alter table public.ph_pikes_order_source_rows enable row level security;
alter table public.ph_pikes_order_inventory_rows enable row level security;

revoke all on table public.ph_pikes_order_batches from public, anon, authenticated;
revoke all on table public.ph_pikes_order_source_rows from public, anon, authenticated;
revoke all on table public.ph_pikes_order_inventory_rows from public, anon, authenticated;
grant select on table public.ph_pikes_order_batches to authenticated;
grant select on table public.ph_pikes_order_source_rows to authenticated;
grant select on table public.ph_pikes_order_inventory_rows to authenticated;
grant select, insert, update, delete on table public.ph_pikes_order_batches to service_role;
grant select, insert, update, delete on table public.ph_pikes_order_source_rows to service_role;
grant select, insert, update, delete on table public.ph_pikes_order_inventory_rows to service_role;

create or replace function private.can_view_manager_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and regexp_replace(upper(btrim(coalesce(p.role, ''))), '[^A-Z0-9]+', '', 'g')
        in ('ADMIN', 'ADMINISTRATOR', 'MANAGER')
  )
$$;

revoke all on function private.can_view_manager_orders() from public, anon, authenticated;
grant execute on function private.can_view_manager_orders() to authenticated;

drop policy if exists "Pikes order managers read batches" on public.ph_pikes_order_batches;
create policy "Pikes order managers read batches"
on public.ph_pikes_order_batches for select to authenticated
using ((select private.can_view_manager_orders()));

drop policy if exists "Pikes order managers read source rows" on public.ph_pikes_order_source_rows;
create policy "Pikes order managers read source rows"
on public.ph_pikes_order_source_rows for select to authenticated
using ((select private.can_view_manager_orders()));

drop policy if exists "Pikes order managers read inventory rows" on public.ph_pikes_order_inventory_rows;
create policy "Pikes order managers read inventory rows"
on public.ph_pikes_order_inventory_rows for select to authenticated
using ((select private.can_view_manager_orders()));

create or replace function public.prepare_pikes_order_import(
  p_drive_file_id text,
  p_file_name text,
  p_content_sha256 text,
  p_content_bytes bigint,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.ph_pikes_order_batches%rowtype;
  prepared public.ph_pikes_order_batches%rowtype;
begin
  if btrim(coalesce(p_drive_file_id, '')) = ''
     or btrim(coalesce(p_file_name, '')) = ''
     or coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$'
     or p_batch_id is null then
    raise exception 'PIKES_IMPORT_INVALID_FILE';
  end if;

  select * into existing
  from public.ph_pikes_order_batches b
  where b.drive_file_id = p_drive_file_id
  for update;

  if found then
    if existing.content_sha256 <> p_content_sha256 then
      raise exception 'PIKES_IMPORT_FILE_ID_CHANGED';
    end if;
    if existing.status = 'failed' then
      delete from public.ph_pikes_order_inventory_rows where batch_id = existing.batch_id;
      delete from public.ph_pikes_order_source_rows where batch_id = existing.batch_id;
      update public.ph_pikes_order_batches
      set status = 'importing',
          file_name = btrim(p_file_name),
          content_bytes = p_content_bytes,
          source_sheet_name = null,
          source_header_row = null,
          source_row_count = 0,
          distinct_item_count = 0,
          matched_item_count = 0,
          unmatched_item_count = 0,
          inventory_row_count = 0,
          last_error_code = null,
          updated_at = now()
      where drive_file_id = p_drive_file_id
      returning * into existing;
    end if;
    return jsonb_build_object(
      'status', existing.status,
      'batchId', existing.batch_id,
      'rowCount', existing.source_row_count,
      'displayName', existing.display_name
    );
  end if;

  insert into public.ph_pikes_order_batches (
    batch_id, drive_file_id, file_name, content_sha256, content_bytes
  ) values (
    p_batch_id, btrim(p_drive_file_id), btrim(p_file_name), p_content_sha256, p_content_bytes
  ) returning * into prepared;

  return jsonb_build_object('status', prepared.status, 'batchId', prepared.batch_id, 'rowCount', 0);
end;
$$;

create or replace function public.finalize_pikes_order_import(
  p_drive_file_id text,
  p_content_sha256 text,
  p_source_sheet_name text,
  p_source_header_row integer,
  p_expected_row_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.ph_pikes_order_batches%rowtype;
  actual_row_count integer;
  distinct_count integer;
  matched_count integer;
  unmatched_count integer;
  snapshot_count integer;
  effective_date date;
  effective_sequence integer;
  effective_name text;
begin
  select * into target
  from public.ph_pikes_order_batches b
  where b.drive_file_id = p_drive_file_id
  for update;

  if not found or target.content_sha256 <> p_content_sha256 then
    raise exception 'PIKES_IMPORT_MANIFEST_MISSING';
  end if;
  if target.status in ('archive_pending', 'processed') then
    return jsonb_build_object(
      'status', target.status,
      'batchId', target.batch_id,
      'rowCount', target.source_row_count,
      'inventoryRowCount', target.inventory_row_count,
      'displayName', target.display_name
    );
  end if;
  if target.status <> 'importing' then
    raise exception 'PIKES_IMPORT_INVALID_STATE';
  end if;
  if p_expected_row_count is null or p_expected_row_count < 1 then
    raise exception 'PIKES_IMPORT_EMPTY';
  end if;

  select count(*)::integer into actual_row_count
  from public.ph_pikes_order_source_rows r
  where r.batch_id = target.batch_id;
  if actual_row_count <> p_expected_row_count then
    raise exception 'PIKES_IMPORT_ROW_COUNT_MISMATCH';
  end if;

  select count(distinct r.itemcode_normalized)::integer into distinct_count
  from public.ph_pikes_order_source_rows r
  where r.batch_id = target.batch_id;

  delete from public.ph_pikes_order_inventory_rows where batch_id = target.batch_id;
  insert into public.ph_pikes_order_inventory_rows (
    batch_id, master_unique_id, itemcode, itemcode_normalized, commonname, contsize,
    locationcode, lotcode, assignedto, priority, ptronhand, ptrreviewed, ptravailable,
    s_lts, season, blockalpha, blocknumber, fieldtagcolor, desigitem, desigloc,
    holdstopcode, holdstopreason, itemspec, locationnote, locationnotedate,
    photo_link, photo_name, snapshotted_at
  )
  select distinct on (m.unique_id)
    target.batch_id, m.unique_id, m.itemcode, upper(btrim(m.itemcode)), m.commonname, m.contsize,
    m.locationcode, m.lotcode, m.assignedto, m.priority, m.ptronhand, m.ptrreviewed,
    m.ptravailable, m.s_lts, m.season, m.blockalpha, m.blocknumber,
    coalesce(nullif(m.fieldtagcolor, ''), m.field_tag_color), m.desigitem, m.desigloc,
    m.holdstopcode, m.holdstopreason, m.itemspec, m.locationnote, m.locationnotedate,
    m.photo_link, m.photo_name, now()
  from public.ph_master_inventory m
  join (
    select distinct itemcode_normalized
    from public.ph_pikes_order_source_rows
    where batch_id = target.batch_id
  ) requested on requested.itemcode_normalized = upper(btrim(m.itemcode))
  where m.unique_id is not null and btrim(m.unique_id) <> ''
  order by m.unique_id;

  update public.ph_pikes_order_source_rows r
  set matched = exists (
    select 1
    from public.ph_pikes_order_inventory_rows i
    where i.batch_id = r.batch_id
      and i.itemcode_normalized = r.itemcode_normalized
  )
  where r.batch_id = target.batch_id;

  select count(distinct r.itemcode_normalized)::integer into matched_count
  from public.ph_pikes_order_source_rows r
  where r.batch_id = target.batch_id and r.matched;
  unmatched_count := greatest(0, distinct_count - matched_count);
  select count(*)::integer into snapshot_count
  from public.ph_pikes_order_inventory_rows i
  where i.batch_id = target.batch_id;

  effective_date := (now() at time zone 'America/Chicago')::date;
  perform pg_advisory_xact_lock(hashtext('pikes-orders-' || effective_date::text));
  select coalesce(max(b.daily_sequence), 0) + 1 into effective_sequence
  from public.ph_pikes_order_batches b
  where b.source_key = 'pikes' and b.batch_date = effective_date;
  effective_name := 'Pikes ' || to_char(effective_date, 'MM-DD-YYYY') ||
    case when effective_sequence > 1 then ' (' || effective_sequence::text || ')' else '' end;

  update public.ph_pikes_order_batches
  set source_sheet_name = nullif(btrim(coalesce(p_source_sheet_name, '')), ''),
      source_header_row = p_source_header_row,
      status = 'archive_pending',
      batch_date = effective_date,
      daily_sequence = effective_sequence,
      display_name = effective_name,
      source_row_count = actual_row_count,
      distinct_item_count = distinct_count,
      matched_item_count = matched_count,
      unmatched_item_count = unmatched_count,
      inventory_row_count = snapshot_count,
      last_error_code = null,
      imported_at = now(),
      updated_at = now()
  where drive_file_id = p_drive_file_id
  returning * into target;

  return jsonb_build_object(
    'status', target.status,
    'batchId', target.batch_id,
    'rowCount', target.source_row_count,
    'distinctItemCount', target.distinct_item_count,
    'matchedItemCount', target.matched_item_count,
    'unmatchedItemCount', target.unmatched_item_count,
    'inventoryRowCount', target.inventory_row_count,
    'displayName', target.display_name
  );
end;
$$;

create or replace function public.mark_pikes_order_file_archived(
  p_drive_file_id text,
  p_content_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.ph_pikes_order_batches%rowtype;
begin
  update public.ph_pikes_order_batches
  set status = 'processed', archived_at = coalesce(archived_at, now()), updated_at = now()
  where drive_file_id = p_drive_file_id
    and content_sha256 = p_content_sha256
    and status in ('archive_pending', 'processed')
  returning * into target;
  if not found then raise exception 'PIKES_IMPORT_ARCHIVE_STATE_INVALID'; end if;
  return jsonb_build_object('status', target.status, 'batchId', target.batch_id, 'displayName', target.display_name);
end;
$$;

create or replace function public.record_pikes_order_import_failure(
  p_drive_file_id text,
  p_content_sha256 text,
  p_sanitized_error_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.ph_pikes_order_batches%rowtype;
begin
  if coalesce(p_sanitized_error_code, '') !~ '^PIKES_[A-Z0-9_]{3,100}$' then
    raise exception 'PIKES_IMPORT_ERROR_CODE_INVALID';
  end if;
  update public.ph_pikes_order_batches
  set status = 'failed', last_error_code = p_sanitized_error_code, updated_at = now()
  where drive_file_id = p_drive_file_id
    and content_sha256 = p_content_sha256
    and status = 'importing'
  returning * into target;
  return jsonb_build_object('recorded', found, 'batchId', target.batch_id, 'status', target.status);
end;
$$;

create or replace function public.get_manager_order_sources_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  if not private.can_view_manager_orders() then raise exception 'PIKES_ORDERS_FORBIDDEN'; end if;
  select jsonb_build_object(
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceKey', 'pikes',
      'label', 'Pikes',
      'batchCount', count(*) filter (where status in ('archive_pending', 'processed')),
      'failedCount', count(*) filter (where status = 'failed'),
      'latestImportedAt', max(imported_at) filter (where status in ('archive_pending', 'processed')),
      'latestDisplayName', (array_agg(display_name order by imported_at desc nulls last, batch_id desc)
        filter (where status in ('archive_pending', 'processed')))[1]
    ))
  ) into result
  from public.ph_pikes_order_batches;
  return coalesce(result, '{"sources":[]}'::jsonb);
end;
$$;

create or replace function public.get_manager_order_batches_v1(
  p_source_key text default 'pikes',
  p_before_imported_at timestamptz default null,
  p_before_batch_id uuid default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  result jsonb;
begin
  if not private.can_view_manager_orders() then raise exception 'PIKES_ORDERS_FORBIDDEN'; end if;
  if lower(btrim(coalesce(p_source_key, ''))) <> 'pikes' then raise exception 'PIKES_ORDERS_SOURCE_INVALID'; end if;
  with page as (
    select b.*
    from public.ph_pikes_order_batches b
    where b.source_key = 'pikes'
      and b.status in ('archive_pending', 'processed')
      and (
        p_before_imported_at is null
        or (b.imported_at, b.batch_id) < (p_before_imported_at, p_before_batch_id)
      )
    order by b.imported_at desc, b.batch_id desc
    limit safe_limit + 1
  ), shown as (
    select * from page order by imported_at desc, batch_id desc limit safe_limit
  )
  select jsonb_build_object(
    'sourceKey', 'pikes',
    'batches', coalesce((select jsonb_agg(jsonb_build_object(
      'batchId', s.batch_id,
      'displayName', s.display_name,
      'fileName', s.file_name,
      'status', s.status,
      'sourceRowCount', s.source_row_count,
      'distinctItemCount', s.distinct_item_count,
      'matchedItemCount', s.matched_item_count,
      'unmatchedItemCount', s.unmatched_item_count,
      'inventoryRowCount', s.inventory_row_count,
      'importedAt', s.imported_at,
      'archivedAt', s.archived_at
    ) order by s.imported_at desc, s.batch_id desc) from shown s), '[]'::jsonb),
    'hasMore', (select count(*) > safe_limit from page),
    'nextCursor', (select jsonb_build_object('importedAt', s.imported_at, 'batchId', s.batch_id)
      from shown s order by s.imported_at asc, s.batch_id asc limit 1)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_manager_order_batch_v1(
  p_batch_id uuid,
  p_assignedto_keys text[] default null,
  p_after_itemcode text default null,
  p_after_unique_id text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  result jsonb;
begin
  if not private.can_view_manager_orders() then raise exception 'PIKES_ORDERS_FORBIDDEN'; end if;
  if not exists (
    select 1 from public.ph_pikes_order_batches b
    where b.batch_id = p_batch_id and b.status in ('archive_pending', 'processed')
  ) then raise exception 'PIKES_ORDERS_BATCH_NOT_FOUND'; end if;

  with normalized_filter as (
    select distinct case
      when lower(btrim(value)) in ('', 'unassigned', '__unassigned__') then '__unassigned__'
      else lower(btrim(value)) end as key
    from unnest(coalesce(p_assignedto_keys, '{}'::text[])) value
  ), filtered as (
    select i.*
    from public.ph_pikes_order_inventory_rows i
    where i.batch_id = p_batch_id
      and (
        not exists (select 1 from normalized_filter)
        or i.assignedto_key in (select key from normalized_filter)
      )
      and (
        p_after_itemcode is null
        or (i.itemcode_normalized, i.master_unique_id) > (p_after_itemcode, coalesce(p_after_unique_id, ''))
      )
    order by i.itemcode_normalized, i.master_unique_id
    limit safe_limit + 1
  ), shown as (
    select * from filtered order by itemcode_normalized, master_unique_id limit safe_limit
  ), source_context as (
    select r.itemcode_normalized,
      jsonb_agg(jsonb_build_object(
        'sourceRowNumber', r.source_row_number,
        'orderTot', r.order_tot,
        'pickNotes', r.pick_notes
      ) order by r.source_row_number) as entries
    from public.ph_pikes_order_source_rows r
    where r.batch_id = p_batch_id
    group by r.itemcode_normalized
  )
  select jsonb_build_object(
    'batch', (select jsonb_build_object(
      'batchId', b.batch_id, 'displayName', b.display_name, 'fileName', b.file_name,
      'status', b.status, 'sourceRowCount', b.source_row_count,
      'distinctItemCount', b.distinct_item_count, 'matchedItemCount', b.matched_item_count,
      'unmatchedItemCount', b.unmatched_item_count, 'inventoryRowCount', b.inventory_row_count,
      'importedAt', b.imported_at, 'archivedAt', b.archived_at
    ) from public.ph_pikes_order_batches b where b.batch_id = p_batch_id),
    'assignees', coalesce((select jsonb_agg(jsonb_build_object(
      'key', a.assignedto_key,
      'label', case when a.assignedto_key = '__unassigned__' then 'Unassigned' else a.assignedto end,
      'rowCount', a.row_count
    ) order by case when a.assignedto_key = '__unassigned__' then 1 else 0 end, lower(a.assignedto))
    from (
      select i.assignedto_key, max(nullif(btrim(i.assignedto), '')) as assignedto, count(*)::integer as row_count
      from public.ph_pikes_order_inventory_rows i where i.batch_id = p_batch_id
      group by i.assignedto_key
    ) a), '[]'::jsonb),
    'unmatchedItems', coalesce((select jsonb_agg(jsonb_build_object(
      'itemcode', u.itemcode,
      'itemcodeNormalized', u.itemcode_normalized,
      'sourceEntries', u.entries
    ) order by u.itemcode_normalized)
    from (
      select min(r.itemcode) as itemcode, r.itemcode_normalized,
        jsonb_agg(jsonb_build_object('sourceRowNumber', r.source_row_number, 'orderTot', r.order_tot, 'pickNotes', r.pick_notes)
          order by r.source_row_number) as entries
      from public.ph_pikes_order_source_rows r
      where r.batch_id = p_batch_id and not r.matched
      group by r.itemcode_normalized
      order by r.itemcode_normalized
      limit 200
    ) u), '[]'::jsonb),
    'unmatchedItemsTruncated', (select b.unmatched_item_count > 200
      from public.ph_pikes_order_batches b where b.batch_id = p_batch_id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'masterUniqueId', s.master_unique_id, 'itemcode', s.itemcode,
      'itemcodeNormalized', s.itemcode_normalized, 'commonname', s.commonname,
      'contsize', s.contsize, 'locationcode', s.locationcode, 'lotcode', s.lotcode,
      'assignedto', s.assignedto, 'assignedtoKey', s.assignedto_key,
      'priority', s.priority, 'ptronhand', s.ptronhand, 'ptrreviewed', s.ptrreviewed,
      'ptravailable', s.ptravailable, 'sLts', s.s_lts, 'season', s.season,
      'blockalpha', s.blockalpha, 'blocknumber', s.blocknumber,
      'fieldtagcolor', s.fieldtagcolor, 'desigitem', s.desigitem, 'desigloc', s.desigloc,
      'holdstopcode', s.holdstopcode, 'holdstopreason', s.holdstopreason,
      'itemspec', s.itemspec, 'locationnote', s.locationnote,
      'locationnotedate', s.locationnotedate, 'photoLink', s.photo_link,
      'photoName', s.photo_name, 'snapshottedAt', s.snapshotted_at,
      'sourceEntries', coalesce(sc.entries, '[]'::jsonb)
    ) order by s.itemcode_normalized, s.master_unique_id)
    from shown s left join source_context sc on sc.itemcode_normalized = s.itemcode_normalized), '[]'::jsonb),
    'filteredRowCount', (select count(*) from public.ph_pikes_order_inventory_rows i
      where i.batch_id = p_batch_id and (
        not exists (select 1 from normalized_filter)
        or i.assignedto_key in (select key from normalized_filter)
      )),
    'hasMore', (select count(*) > safe_limit from filtered),
    'nextCursor', (select jsonb_build_object('itemcode', s.itemcode_normalized, 'uniqueId', s.master_unique_id)
      from shown s order by s.itemcode_normalized desc, s.master_unique_id desc limit 1)
  ) into result;
  return result;
end;
$$;

revoke all on function public.prepare_pikes_order_import(text, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.finalize_pikes_order_import(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_pikes_order_file_archived(text, text) from public, anon, authenticated;
revoke all on function public.record_pikes_order_import_failure(text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_pikes_order_import(text, text, text, bigint, uuid) to service_role;
grant execute on function public.finalize_pikes_order_import(text, text, text, integer, integer) to service_role;
grant execute on function public.mark_pikes_order_file_archived(text, text) to service_role;
grant execute on function public.record_pikes_order_import_failure(text, text, text) to service_role;

revoke all on function public.get_manager_order_sources_v1() from public, anon;
revoke all on function public.get_manager_order_batches_v1(text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_manager_order_batch_v1(uuid, text[], text, text, integer) from public, anon;
grant execute on function public.get_manager_order_sources_v1() to authenticated, service_role;
grant execute on function public.get_manager_order_batches_v1(text, timestamptz, uuid, integer) to authenticated, service_role;
grant execute on function public.get_manager_order_batch_v1(uuid, text[], text, text, integer) to authenticated, service_role;

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values
  ('manager.orders.view', 'action', 'managers', 'Orders', 'View immutable imported order batches.', '{}', 1475, true)
on conflict (permission_key) do update set
  permission_kind = excluded.permission_kind,
  module_key = excluded.module_key,
  label = excluded.label,
  description = excluded.description,
  scope_options = excluded.scope_options,
  sort_order = excluded.sort_order,
  active = true;

insert into private.app_access_role_grants
  (policy_id, role_key, permission_key, allowed, access_scope)
select p.id, r.role_key, 'manager.orders.view', true, null
from private.app_access_policy_versions p
cross join (values ('ADMIN'), ('ADMINISTRATOR'), ('MANAGER')) r(role_key)
on conflict (policy_id, role_key, permission_key) do update set
  allowed = true, access_scope = null, updated_at = now();

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('client.manager.orders', 'manager.orders.view', 'client', 'Managers Orders module visibility.'),
  ('rpc.manager.orders', 'manager.orders.view', 'rpc', 'Authenticated paginated Pikes order history RPCs.'),
  ('rls.manager.orders', 'manager.orders.view', 'rls', 'Active Admin or Manager profile remains authoritative.'),
  ('apps_script.pikes_orders', 'manager.orders.view', 'apps_script', 'Service-owned Pikes file import and archive pipeline.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;

commit;
