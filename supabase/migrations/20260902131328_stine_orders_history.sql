begin;

-- Reuse the immutable manager-order ledger for a second independent source.
-- Drive file identity remains globally idempotent, while display sequencing is
-- isolated per source and America/Chicago processing day.
alter table public.ph_pikes_order_batches
  drop constraint if exists ph_pikes_order_batches_source_key_check;
alter table public.ph_pikes_order_batches
  add constraint ph_pikes_order_batches_source_key_check
  check (source_key in ('pikes', 'stine_lumber'));

comment on table public.ph_pikes_order_batches is
  'Service-owned manager order file ledger for Pikes and Stine Lumber. Every Drive file is an independent frozen historical batch.';
comment on table public.ph_pikes_order_source_rows is
  'Approved Item, Order TOT, and Pick Notes source fields retained for each manager order workbook row.';
comment on table public.ph_pikes_order_inventory_rows is
  'Whitelisted immutable Drive Mode row snapshot matched to one manager order batch.';

create or replace function public.prepare_manager_order_import_v2(
  p_source_key text,
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
  safe_source_key text := lower(btrim(coalesce(p_source_key, '')));
  existing public.ph_pikes_order_batches%rowtype;
  prepared public.ph_pikes_order_batches%rowtype;
begin
  if safe_source_key not in ('pikes', 'stine_lumber') then
    raise exception 'MANAGER_ORDER_SOURCE_INVALID';
  end if;
  if btrim(coalesce(p_drive_file_id, '')) = ''
     or btrim(coalesce(p_file_name, '')) = ''
     or coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$'
     or p_batch_id is null then
    raise exception 'MANAGER_ORDER_IMPORT_INVALID_FILE';
  end if;

  select * into existing
  from public.ph_pikes_order_batches b
  where b.drive_file_id = p_drive_file_id
  for update;

  if found then
    if existing.source_key <> safe_source_key then
      raise exception 'MANAGER_ORDER_FILE_SOURCE_MISMATCH';
    end if;
    if existing.content_sha256 <> p_content_sha256 then
      raise exception 'MANAGER_ORDER_FILE_ID_CHANGED';
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
      'displayName', existing.display_name,
      'sourceKey', existing.source_key
    );
  end if;

  insert into public.ph_pikes_order_batches (
    batch_id, drive_file_id, source_key, file_name, content_sha256, content_bytes
  ) values (
    p_batch_id, btrim(p_drive_file_id), safe_source_key,
    btrim(p_file_name), p_content_sha256, p_content_bytes
  ) returning * into prepared;

  return jsonb_build_object(
    'status', prepared.status,
    'batchId', prepared.batch_id,
    'rowCount', 0,
    'sourceKey', prepared.source_key
  );
end;
$$;

-- The original RPC name is retained for the deployed Apps Script contract, but
-- finalization now derives labeling and daily sequencing from the batch source.
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
  effective_label text;
  effective_name text;
begin
  select * into target
  from public.ph_pikes_order_batches b
  where b.drive_file_id = p_drive_file_id
  for update;

  if not found or target.content_sha256 <> p_content_sha256 then
    raise exception 'MANAGER_ORDER_IMPORT_MANIFEST_MISSING';
  end if;
  if target.source_key not in ('pikes', 'stine_lumber') then
    raise exception 'MANAGER_ORDER_SOURCE_INVALID';
  end if;
  if target.status in ('archive_pending', 'processed') then
    return jsonb_build_object(
      'status', target.status,
      'batchId', target.batch_id,
      'rowCount', target.source_row_count,
      'inventoryRowCount', target.inventory_row_count,
      'displayName', target.display_name,
      'sourceKey', target.source_key
    );
  end if;
  if target.status <> 'importing' then raise exception 'MANAGER_ORDER_IMPORT_INVALID_STATE'; end if;
  if p_expected_row_count is null or p_expected_row_count < 1 then raise exception 'MANAGER_ORDER_IMPORT_EMPTY'; end if;

  select count(*)::integer into actual_row_count
  from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id;
  if actual_row_count <> p_expected_row_count then raise exception 'MANAGER_ORDER_IMPORT_ROW_COUNT_MISMATCH'; end if;

  select count(distinct r.itemcode_normalized)::integer into distinct_count
  from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id;

  delete from public.ph_pikes_order_inventory_rows where batch_id = target.batch_id;
  insert into public.ph_pikes_order_inventory_rows (
    batch_id, master_unique_id, itemcode, itemcode_normalized, commonname, contsize,
    locationcode, lotcode, assignedto, assignment_authority_key,
    assignment_authority_assigned_at, assignment_match_method,
    priority, ptronhand, ptrreviewed, ptravailable, s_lts, season, blockalpha,
    blocknumber, fieldtagcolor, desigitem, desigloc, holdstopcode, holdstopreason,
    itemspec, locationnote, locationnotedate, photo_link, photo_name, snapshotted_at
  )
  select distinct on (m.unique_id)
    target.batch_id, m.unique_id, m.itemcode, upper(btrim(m.itemcode)), m.commonname, m.contsize,
    m.locationcode, m.lotcode, nullif(btrim(a.assignedto), ''), a.assignment_key,
    a.assigned_at,
    case when nullif(btrim(a.assignedto), '') is null then 'unassigned' else 'exact' end,
    m.priority, m.ptronhand, m.ptrreviewed, m.ptravailable, m.s_lts, m.season,
    m.blockalpha, m.blocknumber, coalesce(nullif(m.fieldtagcolor, ''), m.field_tag_color),
    m.desigitem, m.desigloc, m.holdstopcode, m.holdstopreason, m.itemspec,
    m.locationnote, m.locationnotedate, m.photo_link, m.photo_name, now()
  from public.ph_master_inventory m
  join (
    select distinct itemcode_normalized
    from public.ph_pikes_order_source_rows
    where batch_id = target.batch_id
  ) requested on requested.itemcode_normalized = upper(btrim(m.itemcode))
  left join public.ph_warehouse_assigned_items a
    on a.assignment_key = private.normalize_eval_assignment_key(m.itemcode, m.genusname)
   and a.present_in_drive
  where m.unique_id is not null and btrim(m.unique_id) <> ''
  order by m.unique_id;

  update public.ph_pikes_order_source_rows r
  set matched = exists (
    select 1 from public.ph_pikes_order_inventory_rows i
    where i.batch_id = r.batch_id and i.itemcode_normalized = r.itemcode_normalized
  )
  where r.batch_id = target.batch_id;

  select count(distinct r.itemcode_normalized)::integer into matched_count
  from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id and r.matched;
  unmatched_count := greatest(0, distinct_count - matched_count);
  select count(*)::integer into snapshot_count
  from public.ph_pikes_order_inventory_rows i where i.batch_id = target.batch_id;

  effective_date := (now() at time zone 'America/Chicago')::date;
  perform pg_advisory_xact_lock(hashtext('manager-orders-' || target.source_key || '-' || effective_date::text));
  select coalesce(max(b.daily_sequence), 0) + 1 into effective_sequence
  from public.ph_pikes_order_batches b
  where b.source_key = target.source_key and b.batch_date = effective_date;
  effective_label := case target.source_key
    when 'stine_lumber' then 'Stine Lumber'
    else 'Pikes'
  end;
  effective_name := effective_label || ' ' || to_char(effective_date, 'MM-DD-YYYY') ||
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
    'displayName', target.display_name,
    'sourceKey', target.source_key
  );
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
  if not private.can_view_manager_orders() then raise exception 'MANAGER_ORDERS_FORBIDDEN'; end if;
  with source_defs(source_key, label, sort_order) as (
    values ('pikes'::text, 'Pikes'::text, 1),
           ('stine_lumber'::text, 'Stine Lumber'::text, 2)
  )
  select jsonb_build_object(
    'sources', coalesce(jsonb_agg(jsonb_build_object(
      'sourceKey', source.source_key,
      'label', source.label,
      'batchCount', (select count(*) from public.ph_pikes_order_batches b
        where b.source_key = source.source_key and b.status in ('archive_pending', 'processed')),
      'failedCount', (select count(*) from public.ph_pikes_order_batches b
        where b.source_key = source.source_key and b.status = 'failed'),
      'latestImportedAt', (select max(b.imported_at) from public.ph_pikes_order_batches b
        where b.source_key = source.source_key and b.status in ('archive_pending', 'processed')),
      'latestDisplayName', (select b.display_name from public.ph_pikes_order_batches b
        where b.source_key = source.source_key and b.status in ('archive_pending', 'processed')
        order by b.imported_at desc nulls last, b.batch_id desc limit 1)
    ) order by source.sort_order), '[]'::jsonb)
  ) into result
  from source_defs source;
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
  safe_source_key text := lower(btrim(coalesce(p_source_key, '')));
  safe_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  source_label text;
  result jsonb;
begin
  if not private.can_view_manager_orders() then raise exception 'MANAGER_ORDERS_FORBIDDEN'; end if;
  if safe_source_key not in ('pikes', 'stine_lumber') then raise exception 'MANAGER_ORDERS_SOURCE_INVALID'; end if;
  source_label := case safe_source_key when 'stine_lumber' then 'Stine Lumber' else 'Pikes' end;

  with page as (
    select b.*
    from public.ph_pikes_order_batches b
    where b.source_key = safe_source_key
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
    'sourceKey', safe_source_key,
    'sourceLabel', source_label,
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

-- Keep the existing Pikes-specific hosted health contract scoped to Pikes even
-- when a newer Stine batch is imported into the shared immutable ledger.
create or replace function public.get_pikes_order_assignment_health_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  latest_batch_id uuid;
  inventory_count integer := 0;
  snapshot_unassigned integer := 0;
  false_unassigned integer := 0;
  ambiguous_count integer := 0;
  unresolved_count integer := 0;
begin
  select b.batch_id into latest_batch_id
  from public.ph_pikes_order_batches b
  where b.source_key = 'pikes'
    and b.status in ('archive_pending', 'processed')
  order by b.imported_at desc nulls last, b.batch_id desc
  limit 1;

  if latest_batch_id is null then
    return jsonb_build_object(
      'contractVersion', 1, 'hasBatch', false, 'inventoryRowCount', 0,
      'snapshotUnassignedCount', 0, 'falseUnassignedCount', 0,
      'ambiguousCount', 0, 'unresolvedCount', 0
    );
  end if;

  select
    count(*)::integer,
    count(*) filter (where nullif(btrim(coalesce(i.assignedto, '')), '') is null)::integer
  into inventory_count, snapshot_unassigned
  from public.ph_pikes_order_inventory_rows i
  where i.batch_id = latest_batch_id;

  select
    count(*) filter (where r.resolution = 'eligible')::integer,
    count(*) filter (where r.resolution = 'ambiguous')::integer,
    count(*) filter (where r.resolution in ('newer', 'no_match'))::integer
  into false_unassigned, ambiguous_count, unresolved_count
  from private.resolve_pikes_order_assignment_repair_v1(latest_batch_id) r;

  return jsonb_build_object(
    'contractVersion', 1, 'hasBatch', true,
    'inventoryRowCount', inventory_count,
    'snapshotUnassignedCount', snapshot_unassigned,
    'falseUnassignedCount', false_unassigned,
    'ambiguousCount', ambiguous_count,
    'unresolvedCount', unresolved_count
  );
end;
$$;

revoke all on function public.prepare_manager_order_import_v2(text, text, text, text, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_manager_order_import_v2(text, text, text, text, bigint, uuid)
  to service_role;

revoke all on function public.finalize_pikes_order_import(text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_pikes_order_import(text, text, text, integer, integer)
  to service_role;

revoke all on function public.get_manager_order_sources_v1() from public, anon;
revoke all on function public.get_manager_order_batches_v1(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_manager_order_sources_v1() to authenticated, service_role;
grant execute on function public.get_manager_order_batches_v1(text, timestamptz, uuid, integer) to authenticated, service_role;

revoke all on function public.get_pikes_order_assignment_health_v1() from public, anon, authenticated;
grant execute on function public.get_pikes_order_assignment_health_v1() to service_role;

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('apps_script.stine_lumber_orders', 'manager.orders.view', 'apps_script',
   'Service-owned Stine Lumber file import and archive pipeline.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;

notify pgrst, 'reload schema';

commit;
