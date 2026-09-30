begin;

-- Assignment snapshots must come from the assignment authority, not the denormalized
-- value on inventory.  The metadata below makes that provenance reviewable without
-- changing any of the frozen inventory fields.
alter table public.ph_pikes_order_inventory_rows
  add column if not exists assignment_authority_key text,
  add column if not exists assignment_authority_assigned_at timestamptz,
  add column if not exists assignment_match_method text;

alter table public.ph_pikes_order_inventory_rows
  drop constraint if exists ph_pikes_order_inventory_rows_assignment_match_method_check;
alter table public.ph_pikes_order_inventory_rows
  add constraint ph_pikes_order_inventory_rows_assignment_match_method_check
  check (
    assignment_match_method is null
    or assignment_match_method in ('exact', 'itemcode_unique_assignee', 'unassigned')
  );

create index if not exists idx_ph_warehouse_assigned_active_key
  on public.ph_warehouse_assigned_items (assignment_key, assigned_at)
  where present_in_drive and nullif(btrim(coalesce(assignedto, '')), '') is not null;
create index if not exists idx_ph_warehouse_assigned_active_itemcode
  on public.ph_warehouse_assigned_items (itemcode_normalized, assigned_at, assignment_key)
  where present_in_drive and nullif(btrim(coalesce(assignedto, '')), '') is not null;

create table if not exists public.ph_pikes_order_assignment_repair_audit (
  audit_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ph_pikes_order_batches(batch_id),
  idempotency_key text not null,
  repair_fingerprint text not null,
  eligible_count integer not null check (eligible_count >= 0),
  corrected_count integer not null check (corrected_count >= 0),
  ambiguous_count integer not null check (ambiguous_count >= 0),
  newer_count integer not null check (newer_count >= 0),
  no_match_count integer not null check (no_match_count >= 0),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (batch_id, idempotency_key)
);

alter table public.ph_pikes_order_assignment_repair_audit enable row level security;
revoke all on table public.ph_pikes_order_assignment_repair_audit from public, anon, authenticated;
grant select, insert on table public.ph_pikes_order_assignment_repair_audit to service_role;

-- Reconciliation is incremental: unchanged assignment rows keep their timestamps,
-- removed keys are marked through an anti-join, and overlapping triggers defer.
create or replace function public.reconcile_eval_itemcodes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lock_acquired boolean;
  discovered integer := 0;
  changed integer := 0;
  removed integer := 0;
  alerted integer := 0;
  unassigned_total integer := 0;
begin
  lock_acquired := pg_try_advisory_xact_lock(
    hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0)
  );
  if not lock_acquired then
    return jsonb_build_object(
      'status', 'deferred',
      'errorCode', 'MAINTENANCE_DEFERRED',
      'discovered', 0,
      'changed', 0,
      'removed', 0,
      'alerts_queued', 0
    );
  end if;

  with drive_codes as (
    select
      upper(btrim(itemcode)) as itemcode_normalized,
      lower(regexp_replace(btrim(coalesce(genusname, '')), '[[:space:]]+', ' ', 'g')) as genusname_normalized,
      max(genusname) as genusname,
      max(commonname) as commonname,
      max(contsize) as contsize,
      max(locationcode) as locationcode
    from public.ph_master_inventory
    where nullif(btrim(coalesce(itemcode, '')), '') is not null
    group by
      upper(btrim(itemcode)),
      lower(regexp_replace(btrim(coalesce(genusname, '')), '[[:space:]]+', ' ', 'g'))
  ), written as (
    insert into public.ph_warehouse_assigned_items (
      unique_id, itemcode, itemcode_normalized, genusname, genusname_normalized,
      concat, assignment_key, commonname, contsize, locationcode, source,
      first_seen_at, last_seen_at, present_in_drive, raw_row, updated_at
    )
    select
      'eval-itemcode-genus-' || md5(private.normalize_eval_assignment_key(d.itemcode_normalized, d.genusname)),
      d.itemcode_normalized,
      d.itemcode_normalized,
      d.genusname,
      d.genusname_normalized,
      d.itemcode_normalized || d.genusname,
      private.normalize_eval_assignment_key(d.itemcode_normalized, d.genusname),
      d.commonname,
      d.contsize,
      d.locationcode,
      'supabase_drive_reconcile',
      now(),
      now(),
      true,
      jsonb_build_object('authority', 'supabase', 'scope', 'itemcode_genus'),
      now()
    from drive_codes d
    on conflict (assignment_key) where assignment_key is not null
    do update set
      itemcode = excluded.itemcode,
      itemcode_normalized = excluded.itemcode_normalized,
      genusname = excluded.genusname,
      genusname_normalized = excluded.genusname_normalized,
      concat = excluded.concat,
      commonname = excluded.commonname,
      contsize = excluded.contsize,
      locationcode = excluded.locationcode,
      source = case
        when public.ph_warehouse_assigned_items.source = 'google_sheet_cutover_20260820'
          then public.ph_warehouse_assigned_items.source
        else 'supabase_drive_reconcile'
      end,
      last_seen_at = now(),
      present_in_drive = true,
      updated_at = now()
    where public.ph_warehouse_assigned_items.itemcode is distinct from excluded.itemcode
       or public.ph_warehouse_assigned_items.itemcode_normalized is distinct from excluded.itemcode_normalized
       or public.ph_warehouse_assigned_items.genusname is distinct from excluded.genusname
       or public.ph_warehouse_assigned_items.genusname_normalized is distinct from excluded.genusname_normalized
       or public.ph_warehouse_assigned_items.concat is distinct from excluded.concat
       or public.ph_warehouse_assigned_items.commonname is distinct from excluded.commonname
       or public.ph_warehouse_assigned_items.contsize is distinct from excluded.contsize
       or public.ph_warehouse_assigned_items.locationcode is distinct from excluded.locationcode
       or not public.ph_warehouse_assigned_items.present_in_drive
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted)::integer,
    count(*) filter (where not was_inserted)::integer
  into discovered, changed
  from written;

  with removed_rows as (
    update public.ph_warehouse_assigned_items a
    set present_in_drive = false, updated_at = now()
    where a.present_in_drive
      and a.assignment_key is not null
      and not exists (
        select 1
        from public.ph_master_inventory m
        where private.normalize_eval_assignment_key(m.itemcode, m.genusname) = a.assignment_key
      )
    returning 1
  )
  select count(*)::integer into removed from removed_rows;

  with needs_alert as (
    select id, itemcode_normalized, genusname, assignment_key
    from public.ph_warehouse_assigned_items
    where present_in_drive
      and nullif(btrim(coalesce(assignedto, '')), '') is null
      and unassigned_notified_at is null
    for update
  ), queued as (
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, payload, status
    )
    select
      'eval-unassigned:' || md5(assignment_key),
      'eval_assignment_unassigned',
      jsonb_build_object(
        'itemcode', itemcode_normalized,
        'genusname', genusname,
        'assignment_key', assignment_key,
        'manager_usernames', jsonb_build_array('dylan_collyge', 'megan_kelly')
      ),
      'pending'
    from needs_alert
    on conflict (event_key) do update set
      status = case
        when public.ph_request_delivery_outbox.status = 'delivered' then 'pending'
        else public.ph_request_delivery_outbox.status
      end,
      next_attempt_at = now(),
      delivered_at = null,
      sanitized_error_code = null
    returning event_key
  )
  select count(*)::integer into alerted from queued;

  update public.ph_warehouse_assigned_items
  set unassigned_notified_at = now(), updated_at = now()
  where present_in_drive
    and nullif(btrim(coalesce(assignedto, '')), '') is null
    and unassigned_notified_at is null;

  select count(*)::integer into unassigned_total
  from public.ph_warehouse_assigned_items
  where present_in_drive
    and nullif(btrim(coalesce(assignedto, '')), '') is null;

  return jsonb_build_object(
    'status', 'completed',
    'discovered', discovered,
    'changed', changed,
    'removed', removed,
    'alerts_queued', alerted,
    'unassigned_count', unassigned_total
  );
end;
$$;

create or replace function public.run_request_integrity_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_result jsonb;
  audit_result jsonb;
  expired_count integer;
  maintenance_status text;
begin
  assignment_result := public.reconcile_eval_itemcodes();
  expired_count := private.expire_shared_av_results();
  audit_result := private.record_request_health_audit();
  maintenance_status := coalesce(assignment_result->>'status', 'completed');
  return jsonb_strip_nulls(jsonb_build_object(
    'status', maintenance_status,
    'errorCode', case when maintenance_status = 'deferred' then 'MAINTENANCE_DEFERRED' end,
    'assignments', assignment_result,
    'expired_av_rows', expired_count,
    'health', audit_result
  ));
end;
$$;

create or replace function private.resolve_pikes_order_assignment_repair_v1(p_batch_id uuid)
returns table (
  master_unique_id text,
  assignedto text,
  assignment_authority_key text,
  assignment_authority_assigned_at timestamptz,
  assignment_match_method text,
  resolution text
)
language sql
stable
security definer
set search_path = ''
as $$
  with targets as (
    select
      i.master_unique_id,
      i.itemcode_normalized,
      b.imported_at,
      m.unique_id as live_master_id,
      private.normalize_eval_assignment_key(m.itemcode, m.genusname) as live_assignment_key
    from public.ph_pikes_order_inventory_rows i
    join public.ph_pikes_order_batches b on b.batch_id = i.batch_id
    left join public.ph_master_inventory m on m.unique_id = i.master_unique_id
    where i.batch_id = p_batch_id
      and nullif(btrim(coalesce(i.assignedto, '')), '') is null
  ), exact_candidates as (
    select
      t.master_unique_id,
      a.assignedto,
      a.assignment_key,
      a.assigned_at
    from targets t
    join public.ph_warehouse_assigned_items a
      on a.assignment_key = t.live_assignment_key
     and a.present_in_drive
     and nullif(btrim(coalesce(a.assignedto, '')), '') is not null
     and a.assigned_at is not null
     and a.assigned_at <= t.imported_at
  ), fallback_candidates as (
    select
      t.master_unique_id,
      min(a.assignedto) as assignedto,
      min(a.assignment_key) as assignment_key,
      max(a.assigned_at) as assigned_at,
      count(distinct lower(btrim(a.assignedto))) as assignee_count
    from targets t
    join public.ph_warehouse_assigned_items a
      on a.itemcode_normalized = t.itemcode_normalized
     and a.present_in_drive
     and nullif(btrim(coalesce(a.assignedto, '')), '') is not null
     and a.assigned_at is not null
     and a.assigned_at <= t.imported_at
    where t.live_master_id is null
    group by t.master_unique_id
  ), any_candidates as (
    select
      t.master_unique_id,
      count(*) filter (
        where a.assigned_at is not null and a.assigned_at > t.imported_at
      ) as newer_count,
      count(distinct lower(btrim(a.assignedto))) filter (
        where a.assigned_at is not null and a.assigned_at <= t.imported_at
      ) as historic_assignee_count
    from targets t
    left join public.ph_warehouse_assigned_items a
      on a.itemcode_normalized = t.itemcode_normalized
     and a.present_in_drive
     and nullif(btrim(coalesce(a.assignedto, '')), '') is not null
    group by t.master_unique_id
  )
  select
    t.master_unique_id,
    coalesce(e.assignedto, case when f.assignee_count = 1 then f.assignedto end),
    coalesce(e.assignment_key, case when f.assignee_count = 1 then f.assignment_key end),
    coalesce(e.assigned_at, case when f.assignee_count = 1 then f.assigned_at end),
    case
      when e.master_unique_id is not null then 'exact'
      when f.assignee_count = 1 then 'itemcode_unique_assignee'
      else null
    end,
    case
      when e.master_unique_id is not null then 'eligible'
      when f.assignee_count = 1 then 'eligible'
      when coalesce(f.assignee_count, a.historic_assignee_count, 0) > 1 then 'ambiguous'
      when a.newer_count > 0 then 'newer'
      else 'no_match'
    end
  from targets t
  left join exact_candidates e on e.master_unique_id = t.master_unique_id
  left join fallback_candidates f on f.master_unique_id = t.master_unique_id
  left join any_candidates a on a.master_unique_id = t.master_unique_id
$$;

create or replace function public.repair_pikes_order_batch_assignments_v1(
  p_batch_id uuid,
  p_dry_run boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.ph_pikes_order_batches%rowtype;
  prior jsonb;
  eligible_count integer := 0;
  corrected_count integer := 0;
  ambiguous_count integer := 0;
  newer_count integer := 0;
  no_match_count integer := 0;
  repair_fingerprint text;
  response jsonb;
begin
  if p_batch_id is null
     or coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    raise exception 'PIKES_ASSIGNMENT_REPAIR_INVALID_REQUEST';
  end if;

  select * into target
  from public.ph_pikes_order_batches b
  where b.batch_id = p_batch_id
  for update;
  if not found or target.status not in ('archive_pending', 'processed') then
    raise exception 'PIKES_ASSIGNMENT_REPAIR_BATCH_NOT_READY';
  end if;

  select a.result into prior
  from public.ph_pikes_order_assignment_repair_audit a
  where a.batch_id = p_batch_id and a.idempotency_key = p_idempotency_key;
  if found then
    return prior || jsonb_build_object('replayed', true);
  end if;

  with resolved as (
    select * from private.resolve_pikes_order_assignment_repair_v1(p_batch_id)
  )
  select
    count(*) filter (where resolution = 'eligible')::integer,
    count(*) filter (where resolution = 'ambiguous')::integer,
    count(*) filter (where resolution = 'newer')::integer,
    count(*) filter (where resolution = 'no_match')::integer,
    md5(coalesce(string_agg(
      master_unique_id || ':' || coalesce(assignedto, '') || ':' || resolution,
      '|' order by master_unique_id
    ), ''))
  into eligible_count, ambiguous_count, newer_count, no_match_count, repair_fingerprint
  from resolved;

  if coalesce(p_dry_run, false) then
    return jsonb_build_object(
      'status', 'dry_run',
      'eligibleCount', eligible_count,
      'correctedCount', 0,
      'ambiguousCount', ambiguous_count,
      'newerCount', newer_count,
      'noMatchCount', no_match_count,
      'fingerprint', repair_fingerprint,
      'replayed', false
    );
  end if;

  with eligible as (
    select *
    from private.resolve_pikes_order_assignment_repair_v1(p_batch_id)
    where resolution = 'eligible'
  ), corrected as (
    update public.ph_pikes_order_inventory_rows i
    set assignedto = e.assignedto,
        assignment_authority_key = e.assignment_authority_key,
        assignment_authority_assigned_at = e.assignment_authority_assigned_at,
        assignment_match_method = e.assignment_match_method
    from eligible e
    where i.batch_id = p_batch_id
      and i.master_unique_id = e.master_unique_id
      and nullif(btrim(coalesce(i.assignedto, '')), '') is null
    returning 1
  )
  select count(*)::integer into corrected_count from corrected;

  response := jsonb_build_object(
    'status', 'completed',
    'eligibleCount', eligible_count,
    'correctedCount', corrected_count,
    'ambiguousCount', ambiguous_count,
    'newerCount', newer_count,
    'noMatchCount', no_match_count,
    'fingerprint', repair_fingerprint,
    'replayed', false
  );

  insert into public.ph_pikes_order_assignment_repair_audit (
    batch_id, idempotency_key, repair_fingerprint, eligible_count,
    corrected_count, ambiguous_count, newer_count, no_match_count, result
  ) values (
    p_batch_id, p_idempotency_key, repair_fingerprint, eligible_count,
    corrected_count, ambiguous_count, newer_count, no_match_count, response
  );

  return response;
end;
$$;

-- Future imports snapshot the live, active assignment authority and its provenance.
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

  if not found or target.content_sha256 <> p_content_sha256 then raise exception 'PIKES_IMPORT_MANIFEST_MISSING'; end if;
  if target.status in ('archive_pending', 'processed') then
    return jsonb_build_object(
      'status', target.status, 'batchId', target.batch_id,
      'rowCount', target.source_row_count,
      'inventoryRowCount', target.inventory_row_count,
      'displayName', target.display_name
    );
  end if;
  if target.status <> 'importing' then raise exception 'PIKES_IMPORT_INVALID_STATE'; end if;
  if p_expected_row_count is null or p_expected_row_count < 1 then raise exception 'PIKES_IMPORT_EMPTY'; end if;

  select count(*)::integer into actual_row_count
  from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id;
  if actual_row_count <> p_expected_row_count then raise exception 'PIKES_IMPORT_ROW_COUNT_MISMATCH'; end if;

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
  perform pg_advisory_xact_lock(hashtext('pikes-orders-' || effective_date::text));
  select coalesce(max(b.daily_sequence), 0) + 1 into effective_sequence
  from public.ph_pikes_order_batches b
  where b.source_key = 'pikes' and b.batch_date = effective_date;
  effective_name := 'Pikes ' || to_char(effective_date, 'MM-DD-YYYY') ||
    case when effective_sequence > 1 then ' (' || effective_sequence::text || ')' else '' end;

  update public.ph_pikes_order_batches
  set source_sheet_name = nullif(btrim(coalesce(p_source_sheet_name, '')), ''),
      source_header_row = p_source_header_row, status = 'archive_pending',
      batch_date = effective_date, daily_sequence = effective_sequence,
      display_name = effective_name, source_row_count = actual_row_count,
      distinct_item_count = distinct_count, matched_item_count = matched_count,
      unmatched_item_count = unmatched_count, inventory_row_count = snapshot_count,
      last_error_code = null, imported_at = now(), updated_at = now()
  where drive_file_id = p_drive_file_id
  returning * into target;

  return jsonb_build_object(
    'status', target.status, 'batchId', target.batch_id,
    'rowCount', target.source_row_count, 'distinctItemCount', target.distinct_item_count,
    'matchedItemCount', target.matched_item_count,
    'unmatchedItemCount', target.unmatched_item_count,
    'inventoryRowCount', target.inventory_row_count, 'displayName', target.display_name
  );
end;
$$;

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
  where b.status in ('archive_pending', 'processed')
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

revoke all on function public.reconcile_eval_itemcodes() from public, anon, authenticated;
revoke all on function public.run_request_integrity_maintenance() from public, anon, authenticated;
revoke all on function private.resolve_pikes_order_assignment_repair_v1(uuid) from public, anon, authenticated;
revoke all on function public.repair_pikes_order_batch_assignments_v1(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.get_pikes_order_assignment_health_v1() from public, anon, authenticated;
revoke all on function public.finalize_pikes_order_import(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reconcile_eval_itemcodes() to service_role;
grant execute on function public.run_request_integrity_maintenance() to service_role;
grant execute on function private.resolve_pikes_order_assignment_repair_v1(uuid) to service_role;
grant execute on function public.repair_pikes_order_batch_assignments_v1(uuid, boolean, text) to service_role;
grant execute on function public.get_pikes_order_assignment_health_v1() to service_role;
grant execute on function public.finalize_pikes_order_import(text, text, text, integer, integer) to service_role;

commit;
