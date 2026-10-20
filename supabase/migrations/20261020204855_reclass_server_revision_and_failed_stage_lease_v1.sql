begin;

-- Preserve failed-run recovery lineage and resumable stages. A terminal
-- canonical attempt without any publication cannot have changed live rows.
create or replace function private.reclass_failed_unpublished_canonical_run_v1(p_run_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from app_sync_private.import_runs run
    where run.id = p_run_id and run.state = 'failed'
      and 'ph_master_inventory' = any(run.source_keys)
      and 'ph_master_inventory' = any(run.canonical_keys)
      and exists (
        select 1 from app_sync_private.ph_master_snapshot_stage_v1 stage
        where stage.run_id = run.id and stage.status = 'staging'
          and stage.published_response is null and stage.publication_run_id is null
      )
      and not exists (
        select 1 from app_sync_private.ph_master_snapshot_stage_v1 stage
        where stage.run_id = run.id and (stage.status = 'published'
          or stage.published_response is not null or stage.publication_run_id is not null)
      )
  )
$function$;
revoke all on function private.reclass_failed_unpublished_canonical_run_v1(uuid)
  from public, anon, authenticated, service_role;

-- Narrow the surviving-lease fence only for the proven failed atomic stage.
-- Active runs and failed direct-write imports retain their existing fences.
do $migration$
declare
  target regprocedure := 'app_sync_private.published_snapshot_read_proof(text,bigint)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_guard text := $old$where lease.key = 'ph_master_inventory'
      )$old$;
  new_guard text := $new$where lease.key = 'ph_master_inventory'
          and not private.reclass_failed_unpublished_canonical_run_v1(lease.run_id)
      )$new$;
begin
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1 then
    raise exception 'RECLASS_FAILED_STAGE_PROOF_ANCHOR_INVALID';
  end if;
  execute replace(definition,old_guard,new_guard);
end
$migration$;

do $migration$
declare
  target regprocedure := 'private.sync_inventory_row_assignment_statement_v1()'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_guard text := 'if stale_lease and not importing then';
begin
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1 then
    raise exception 'RECLASS_FAILED_STAGE_ASSIGNMENT_ANCHOR_INVALID';
  end if;
  execute replace(definition,old_guard,
    'if stale_lease and not importing and not lkg_reclass_context then');
end
$migration$;

-- V7 establishes the private context before delegating Hold/Stop to V6. Its
-- nested lock must recognize that exact context; standalone V6 stays fenced.
do $migration$
declare
  target regprocedure := 'private.lock_ph_master_inventory_for_live_edit_v6()'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_guard text := $old$where r.key = 'ph_master_inventory' and r.state = 'ready'$old$;
begin
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1 then
    raise exception 'RECLASS_FAILED_STAGE_NESTED_LOCK_ANCHOR_INVALID';
  end if;
  execute replace(definition,old_guard,
    $new$where r.key = 'ph_master_inventory' and (r.state = 'ready'
      or private.reclass_lkg_write_context_proven_v1())$new$);
end
$migration$;

-- Keep the original delivery wrapper, actor/RBAC checks, exact source/quantity
-- CAS, child receipts and transactional email outbox. Only revision selection
-- changes: resolve a new command under the publication lock, or reuse the
-- original request revision for an exact same-command retry.
do $migration$
declare
  target regprocedure := 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_text text;
  new_text text;
begin
  old_text := 'existing_command boolean := false;';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'RECLASS_SERVER_REVISION_DECLARATION_ANCHOR_INVALID';
  end if;
  definition := replace(definition,old_text,old_text||chr(10)||'  resolved_revision bigint;');
  old_text := 'or p_expected_revision is null or p_expected_revision < 1';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'RECLASS_SERVER_REVISION_INPUT_ANCHOR_INVALID';
  end if;
  definition := replace(definition,old_text,'or (p_expected_revision is not null and p_expected_revision < 1)');
  old_text := 'existing_command := found;';
  new_text := $new$existing_command := found;
  if existing_command then
    resolved_revision := (batch_receipt.request->>'expectedRevision')::bigint;
  else
    resolved_revision := private.lock_ph_master_inventory_for_reclass_lkg_v1();
  end if;$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'RECLASS_SERVER_REVISION_RECEIPT_ANCHOR_INVALID';
  end if;
  definition := replace(definition,old_text,new_text);
  old_text := 'p_actor_id, p_command_id, p_expected_revision, p_moves';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 2 then
    raise exception 'RECLASS_SERVER_REVISION_DELEGATION_ANCHOR_INVALID';
  end if;
  definition := replace(definition,old_text,'p_actor_id, p_command_id, resolved_revision, p_moves');
  -- Defaulted trailing args let generated Supabase types represent a missing
  -- client watermark honestly; p_moves is still required by body validation.
  definition := replace(definition,'p_expected_revision bigint,','p_expected_revision bigint DEFAULT NULL::bigint,');
  definition := replace(definition,'p_moves jsonb,','p_moves jsonb DEFAULT NULL::jsonb,');
  execute definition;
end
$migration$;

notify pgrst, 'reload schema';

-- RECLASS_OWN_REVISION_CONTEXT: touch_source runs before the assignment
-- statement trigger. Carry the unexposed context across exactly its own
-- revision bump, preserving backend/transaction/revision identity. The source
-- row is already locked; unrelated writers/imports cannot advance this marker.
do $migration$
declare
  target regprocedure := 'app_sync_private.touch_source()'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_declaration text := 'current_revision public.app_dataset_revisions;';
  old_update text := 'update public.app_dataset_revisions set revision=revision+1,changed_at=clock_timestamp() where key=source_key;';
  new_update text := $new$reclass_context_proven := source_key = 'ph_master_inventory'
    and current_revision.state = 'interrupted'
    and private.reclass_lkg_write_context_proven_v1();
  $new$ || old_update || $new$
  if reclass_context_proven then
    update private.ph_inventory_reclass_lkg_context_v1 context
    set inventory_revision = current_revision.revision + 1
    where context.backend_pid = pg_backend_pid()
      and context.transaction_id = txid_current()
      and context.inventory_revision = current_revision.revision
      and exists (select 1 from public.app_dataset_revisions revision
        where revision.key = source_key and revision.state = 'interrupted'
          and revision.revision = current_revision.revision + 1)
      and coalesce((app_sync_private.published_snapshot_read_proof(
        source_key, current_revision.revision + 1)->>'mutationAllowed')::boolean, false);
  end if;$new$;
begin
  if (length(definition)-length(replace(definition,old_declaration,'')))/length(old_declaration) <> 1 then
    raise exception 'RECLASS_OWN_REVISION_CONTEXT_DECLARATION_ANCHOR_INVALID';
  end if;
  definition := replace(definition,old_declaration,
    old_declaration||chr(10)||'  reclass_context_proven boolean := false;');
  if (length(definition)-length(replace(definition,old_update,'')))/length(old_update) <> 1 then
    raise exception 'RECLASS_OWN_REVISION_CONTEXT_ANCHOR_INVALID';
  end if;
  execute replace(definition,old_update,new_update);
end
$migration$;
commit;
