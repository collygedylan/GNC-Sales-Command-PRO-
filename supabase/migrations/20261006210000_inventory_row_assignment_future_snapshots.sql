begin;

-- New Pikes snapshots capture the exact physical row's owner at the batch's
-- import cutoff. Already finalized batches are returned unchanged above.
create or replace function public.finalize_pikes_order_import(
  p_drive_file_id text,
  p_content_sha256 text,
  p_source_sheet_name text,
  p_source_header_row integer,
  p_expected_row_count integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $function$
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
  select * into target from public.ph_pikes_order_batches b
  where b.drive_file_id = p_drive_file_id for update;
  if not found or target.content_sha256 <> p_content_sha256 then raise exception 'PIKES_IMPORT_MANIFEST_MISSING'; end if;
  if target.status in ('archive_pending', 'processed') then
    return jsonb_build_object('status', target.status, 'batchId', target.batch_id,
      'rowCount', target.source_row_count, 'inventoryRowCount', target.inventory_row_count,
      'displayName', target.display_name);
  end if;
  if target.status <> 'importing' then raise exception 'PIKES_IMPORT_INVALID_STATE'; end if;
  if p_expected_row_count is null or p_expected_row_count < 1 then raise exception 'PIKES_IMPORT_EMPTY'; end if;
  select count(*)::integer into actual_row_count from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id;
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
    m.locationcode, m.lotcode, nullif(btrim(a.assignedto), ''),
    case when a.master_unique_id is null then null else 'inventory-row:' || a.master_unique_id end,
    a.assigned_at,
    case when nullif(btrim(a.assignedto), '') is null then 'unassigned' else 'exact' end,
    m.priority, m.ptronhand, m.ptrreviewed, m.ptravailable, m.s_lts, m.season,
    m.blockalpha, m.blocknumber, coalesce(nullif(m.fieldtagcolor, ''), m.field_tag_color),
    m.desigitem, m.desigloc, m.holdstopcode, m.holdstopreason, m.itemspec,
    m.locationnote, m.locationnotedate, m.photo_link, m.photo_name, now()
  from public.ph_master_inventory m
  join (select distinct itemcode_normalized from public.ph_pikes_order_source_rows where batch_id = target.batch_id) requested
    on requested.itemcode_normalized = upper(btrim(m.itemcode))
  left join public.ph_inventory_row_assignments a
    on a.master_unique_id = m.unique_id and a.present_in_drive
   and a.assigned_at is not null and a.assigned_at <= target.imported_at
  where m.unique_id is not null and btrim(m.unique_id) <> ''
  order by m.unique_id;

  update public.ph_pikes_order_source_rows r set matched = exists (
    select 1 from public.ph_pikes_order_inventory_rows i
    where i.batch_id = r.batch_id and i.itemcode_normalized = r.itemcode_normalized
  ) where r.batch_id = target.batch_id;
  select count(distinct r.itemcode_normalized)::integer into matched_count
  from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id and r.matched;
  unmatched_count := greatest(0, distinct_count - matched_count);
  select count(*)::integer into snapshot_count from public.ph_pikes_order_inventory_rows i where i.batch_id = target.batch_id;

  effective_date := (now() at time zone 'America/Chicago')::date;
  perform pg_advisory_xact_lock(hashtext('pikes-orders-' || effective_date::text));
  select coalesce(max(b.daily_sequence), 0) + 1 into effective_sequence
  from public.ph_pikes_order_batches b where b.source_key = 'pikes' and b.batch_date = effective_date;
  effective_name := 'Pikes ' || to_char(effective_date, 'MM-DD-YYYY') ||
    case when effective_sequence > 1 then ' (' || effective_sequence::text || ')' else '' end;
  update public.ph_pikes_order_batches set
    source_sheet_name = nullif(btrim(coalesce(p_source_sheet_name, '')), ''),
    source_header_row = p_source_header_row, status = 'archive_pending', batch_date = effective_date,
    daily_sequence = effective_sequence, display_name = effective_name, source_row_count = actual_row_count,
    distinct_item_count = distinct_count, matched_item_count = matched_count,
    unmatched_item_count = unmatched_count, inventory_row_count = snapshot_count,
    last_error_code = null, imported_at = now(), updated_at = now()
  where drive_file_id = p_drive_file_id returning * into target;
  return jsonb_build_object('status', target.status, 'batchId', target.batch_id,
    'rowCount', target.source_row_count, 'distinctItemCount', target.distinct_item_count,
    'matchedItemCount', target.matched_item_count, 'unmatchedItemCount', target.unmatched_item_count,
    'inventoryRowCount', target.inventory_row_count, 'displayName', target.display_name);
end
$function$;

-- Include the new default table in the existing bounded handover processor.
create or replace function private.handover_assignment_targets_v1()
returns table(table_name text,key_name text,field_names text[],eligibility text)
language sql immutable set search_path = '' as $function$
  values
  ('ph_eval_assignment_rules','id',array['assignedto'],'r.active is true'),
  ('ph_warehouse_assigned_items','id',array['assignedto'],'r.present_in_drive is true'),
  ('ph_itemcode_default_owners','itemcode_normalized',array['assignedto'],'true'),
  ('ph_inventory_edit_requests','id',array['assignedto'],
    'lower(coalesce(r.status,''pending'')) not in (''complete'',''completed'',''cancelled'',''canceled'',''archived'',''closed'') and (r.inventory_edit_completed_at is null or r.photo_data_completed_at is null)'),
  ('ph_master_inventory','unique_id',array['assignedto'], 'r.date_completed is null and r.eval_task_completed_at is null'),
  ('ph_master_inventory','unique_id',array['flyer_assigned'], 'r.flyer_completed is null'),
  ('ph_reserves','unique_id',array['assignedto','assigned_to'], 'nullif(btrim(r.date_completed),'''') is null'),
  ('ph_reserves','unique_id',array['flyer_assigned'], 'nullif(btrim(r.flyer_completed),'''') is null'),
  ('ph_soc_master','unique_id',array['assignedto'], 'r.date_completed is null'),
  ('ph_soc_master','unique_id',array['flyer_assigned'], 'nullif(btrim(r.flyer_completed),'''') is null')
$function$;

-- Default owners use an Itemcode natural key, while existing work uses IDs.
-- Keep the existing audit format and add only that new identity fallback.
do $migration$
declare definition text;
  needle text := 'coalesce(doc->>''unique_id'',doc->>''id'')';
begin
  definition := pg_get_functiondef('private.handover_normalize_assignment_v1()'::regprocedure);
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 2 then
    raise exception 'INVENTORY_ROW_ASSIGNMENT_HANDOVER_AUDIT_KEY_PATCH_FAILED';
  end if;
  execute replace(definition, needle,
    'coalesce(doc->>''unique_id'',doc->>''id'',doc->>''itemcode_normalized'')');
end
$migration$;

-- Mark the exact scheduled transfer statement. Do not infer a handover from
-- updated_by equality: an ordinary RPC edit by the same manager must remain a
-- normal assignment change.
do $migration$
declare
  definition text;
  loop_needle text := $loop$    for entry in execute format('select r.%I::text row_key,jsonb_build_object(%s) before_values from public.%I r where (%s) and (%s) order by r.%I for update skip locked limit $1',
      cfg.key_name,fields_sql,cfg.table_name,cfg.eligibility,match_sql,cfg.key_name) using greatest(0,cap-changed)$loop$;
  loop_replacement text := $loop$    if cfg.table_name='ph_itemcode_default_owners' then
      perform 1 from public.app_dataset_revisions r where r.key='ph_master_inventory' and r.state='ready' for share;
      if not found or exists(select 1 from app_sync_private.import_leases l where l.key='ph_master_inventory') then
        remaining := true;
        continue;
      end if;
      perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2',0));
    end if;
    for entry in execute format('select r.%I::text row_key,jsonb_build_object(%s) before_values from public.%I r where (%s) and (%s) order by r.%I for update skip locked limit $1',
      cfg.key_name,fields_sql,cfg.table_name,cfg.eligibility,match_sql,cfg.key_name) using greatest(0,cap-changed)$loop$;
  needle text := $needle$      execute format('update public.%I r set %s where r.%I::text=$1 returning jsonb_build_object(%s)',cfg.table_name,set_sql,cfg.key_name,fields_sql)
        into after_values using entry.row_key;$needle$;
  replacement text := $replacement$      if cfg.table_name='ph_itemcode_default_owners' then
        perform set_config('app.scheduled_handover_default_owner','on',true);
      end if;
      execute format('update public.%I r set %s where r.%I::text=$1 returning jsonb_build_object(%s)',cfg.table_name,set_sql,cfg.key_name,fields_sql)
        into after_values using entry.row_key;
      if cfg.table_name='ph_itemcode_default_owners' then
        perform set_config('app.scheduled_handover_default_owner','',true);
      end if;$replacement$;
begin
  definition := pg_get_functiondef('private.transfer_remaining_handover_assignments_v1(text,integer)'::regprocedure);
  if (length(definition) - length(replace(definition, loop_needle, ''))) / length(loop_needle) <> 1 then
    raise exception 'INVENTORY_ROW_ASSIGNMENT_HANDOVER_LOCK_ORDER_PATCH_FAILED';
  end if;
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 'INVENTORY_ROW_ASSIGNMENT_HANDOVER_CONTEXT_PATCH_FAILED';
  end if;
  definition := replace(definition, loop_needle, loop_replacement);
  execute replace(definition, needle, replacement);
end
$migration$;

-- Direct scheduled transfers advance the defaults' optimistic revision. The
-- existing resolver is then used to recompute derived row owners, preserving
-- zone assignments instead of overwriting them manually.
create or replace function private.handover_default_owner_revision_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if current_setting('app.scheduled_handover_default_owner', true) is distinct from 'on'
     or auth.uid() is not null
     or new.assignedto is not distinct from old.assignedto then
    return new;
  end if;
  new.revision := old.revision + 1;
  new.assigned_at := case when new.assignedto is null then null else now() end;
  new.updated_at := now();
  new.updated_by := 'scheduled_handover';
  return new;
end
$function$;
revoke all on function private.handover_default_owner_revision_v1() from public, anon, authenticated;
drop trigger if exists trg_handover_default_owner_revision on public.ph_itemcode_default_owners;
create trigger trg_handover_default_owner_revision before update of assignedto
  on public.ph_itemcode_default_owners for each row execute function private.handover_default_owner_revision_v1();

drop trigger if exists trg_scheduled_handover_default_owner on public.ph_itemcode_default_owners;
create trigger trg_scheduled_handover_default_owner before insert or update of assignedto
  on public.ph_itemcode_default_owners for each row execute function private.handover_normalize_assignment_v1();

create or replace function private.handover_recompute_default_owner_rows_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare row_value record; source_revision bigint;
begin
  if new.assignedto is not distinct from old.assignedto
     or new.updated_by is distinct from 'scheduled_handover' then return new; end if;
  select r.revision into source_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory';
  for row_value in select m.unique_id from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = new.itemcode_normalized order by m.unique_id
  loop
    perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, coalesce(source_revision, 0));
  end loop;
  return new;
end
$function$;
revoke all on function private.handover_recompute_default_owner_rows_v1() from public, anon, authenticated;
drop trigger if exists trg_handover_recompute_default_owner_rows on public.ph_itemcode_default_owners;
create trigger trg_handover_recompute_default_owner_rows after update of assignedto
  on public.ph_itemcode_default_owners for each row execute function private.handover_recompute_default_owner_rows_v1();

notify pgrst, 'reload schema';
commit;
