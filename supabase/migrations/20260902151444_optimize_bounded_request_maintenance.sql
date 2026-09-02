begin;

-- The prior incremental reconciliation still evaluated a SQL normalization
-- wrapper once for every inventory row during
-- the removal anti-join and twice for every grouped row during the upsert.
-- On production data that anti-join alone consumed roughly the complete
-- PostgREST statement budget.  Materialize the normalized source keys once
-- and compare the plain text keys set-wise instead.
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

  with normalized_drive as materialized (
    select
      upper(btrim(itemcode)) as itemcode_normalized,
      lower(regexp_replace(btrim(coalesce(genusname, '')), '[[:space:]]+', ' ', 'g')) as genusname_normalized,
      genusname,
      commonname,
      contsize,
      locationcode
    from public.ph_master_inventory
    where nullif(btrim(coalesce(itemcode, '')), '') is not null
  ), drive_codes as (
    select
      itemcode_normalized,
      genusname_normalized,
      itemcode_normalized || '|' || genusname_normalized as assignment_key,
      max(genusname) as genusname,
      max(commonname) as commonname,
      max(contsize) as contsize,
      max(locationcode) as locationcode
    from normalized_drive
    group by itemcode_normalized, genusname_normalized
  ), written as (
    insert into public.ph_warehouse_assigned_items (
      unique_id, itemcode, itemcode_normalized, genusname, genusname_normalized,
      concat, assignment_key, commonname, contsize, locationcode, source,
      first_seen_at, last_seen_at, present_in_drive, raw_row, updated_at
    )
    select
      'eval-itemcode-genus-' || md5(d.assignment_key),
      d.itemcode_normalized,
      d.itemcode_normalized,
      d.genusname,
      d.genusname_normalized,
      d.itemcode_normalized || d.genusname,
      d.assignment_key,
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

  with drive_keys as materialized (
    select distinct
      upper(btrim(itemcode)) || '|' ||
      lower(regexp_replace(btrim(coalesce(genusname, '')), '[[:space:]]+', ' ', 'g')) as assignment_key
    from public.ph_master_inventory
    where nullif(btrim(coalesce(itemcode, '')), '') is not null
  ), removed_rows as (
    update public.ph_warehouse_assigned_items a
    set present_in_drive = false, updated_at = now()
    where a.present_in_drive
      and a.assignment_key is not null
      and not exists (
        select 1
        from drive_keys d
        where d.assignment_key = a.assignment_key
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

revoke all on function public.reconcile_eval_itemcodes()
  from public, anon, authenticated;
grant execute on function public.reconcile_eval_itemcodes()
  to service_role;

notify pgrst, 'reload schema';

commit;
