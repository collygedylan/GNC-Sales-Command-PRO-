begin;

-- Preserve the production finalizer's service-only SECURITY DEFINER behavior,
-- source-specific sequence/labels, validation, immutable replay and response.
-- Change only how the row owner is selected and capture one cutoff for both
-- the join and imported_at (which is NULL until this finalizer runs).
do $migration$
declare
  definition text;
  old_declaration text := $old$  effective_name text;$old$;
  new_declaration text := $new$  effective_name text;
  snapshot_cutoff timestamptz;$new$;
  old_cutoff text := $old$  from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id;

  delete from public.ph_pikes_order_inventory_rows where batch_id = target.batch_id;$old$;
  new_cutoff text := $new$  from public.ph_pikes_order_source_rows r where r.batch_id = target.batch_id;

  snapshot_cutoff := coalesce(target.imported_at, clock_timestamp());
  delete from public.ph_pikes_order_inventory_rows where batch_id = target.batch_id;$new$;
  old_join text := $old$    m.locationcode, m.lotcode, nullif(btrim(a.assignedto), ''), a.assignment_key,
    a.assigned_at,
    case when nullif(btrim(a.assignedto), '') is null then 'unassigned' else 'exact' end,$old$;
  new_join text := $new$    m.locationcode, m.lotcode, nullif(btrim(a.assignedto), ''),
    case when a.master_unique_id is null then null else 'inventory-row:' || a.master_unique_id end,
    a.assigned_at,
    case when nullif(btrim(a.assignedto), '') is null then 'unassigned' else 'exact' end,$new$;
  old_from text := $old$  left join public.ph_warehouse_assigned_items a
    on a.assignment_key = private.normalize_eval_assignment_key(m.itemcode, m.genusname)
   and a.present_in_drive
  where m.unique_id is not null and btrim(m.unique_id) <> ''$old$;
  new_from text := $new$  left join public.ph_inventory_row_assignments a
    on a.master_unique_id = m.unique_id
   and a.present_in_drive
   and a.assigned_at is not null
   and a.assigned_at <= snapshot_cutoff
  where m.unique_id is not null and btrim(m.unique_id) <> ''$new$;
  old_persisted_cutoff text := 'imported_at = now(),';
  new_persisted_cutoff text := 'imported_at = snapshot_cutoff,';
  replacement_count integer;
begin
  definition := pg_get_functiondef('public.finalize_pikes_order_import(text,text,text,integer,integer)'::regprocedure);
  if (select prosecdef from pg_proc where oid = 'public.finalize_pikes_order_import(text,text,text,integer,integer)'::regprocedure) is not true then
    raise exception 'PIKES_FINALIZER_SECURITY_DEFINER_REQUIRED';
  end if;
  if position('target.source_key not in (''pikes'', ''stine_lumber'')' in definition) = 0
     or position('''sourceKey'', target.source_key' in definition) = 0
     or position('effective_label := case target.source_key' in definition) = 0
     or position('if target.status in (''archive_pending'', ''processed'') then' in definition) = 0 then
    raise exception 'PIKES_FINALIZER_SOURCE_BEHAVIOR_REQUIRED';
  end if;
  foreach replacement_count in array array[
    (length(definition) - length(replace(definition, old_declaration, ''))) / length(old_declaration),
    (length(definition) - length(replace(definition, old_cutoff, ''))) / length(old_cutoff),
    (length(definition) - length(replace(definition, old_join, ''))) / length(old_join),
    (length(definition) - length(replace(definition, old_from, ''))) / length(old_from),
    (length(definition) - length(replace(definition, old_persisted_cutoff, ''))) / length(old_persisted_cutoff)
  ] loop
    if replacement_count <> 1 then raise exception 'PIKES_EXACT_ROW_PATCH_SOURCE_MISMATCH'; end if;
  end loop;
  definition := replace(definition, old_declaration, new_declaration);
  definition := replace(definition, old_cutoff, new_cutoff);
  definition := replace(definition, old_join, new_join);
  definition := replace(definition, old_from, new_from);
  definition := replace(definition, old_persisted_cutoff, new_persisted_cutoff);
  execute definition;
end
$migration$;

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
