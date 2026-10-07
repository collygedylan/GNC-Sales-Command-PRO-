import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  inventoryRowAssignmentAuthorityMigrationName,
  itemcodeDefaultOwnersMigrationName,
  inventoryRowAssignmentFenceIntegrationMigrationName,
  inventoryRowAssignmentFutureSnapshotsMigrationName,
  inventoryRowAssignmentLiveConsumersMigrationName,
  auraInternalQueryMigrationName,
  releaseDatabaseMigrations,
  migrationContractQuery
} from '../scripts/apply-item-low-stock-migration.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const authority = read('../supabase/migrations/20261006200446_inventory_row_assignment_authority.sql');
const defaults = read('../supabase/migrations/20261006200448_itemcode_default_owners.sql');
const fence = read('../supabase/migrations/20261006200449_inventory_row_assignment_fence_integration.sql');
const future = read('../supabase/migrations/20261006210000_inventory_row_assignment_future_snapshots.sql');
const consumers = read('../supabase/migrations/20261006210200_inventory_row_assignment_live_consumers.sql');
const engine = read('../assets/eval-reports-engine.js');
const appScript = read('../Code.gs');
const responsiveE2E = read('../tests/responsive-workflows.e2e.spec.ts');

test('handover audits support Itemcode identities and cannot silently rewrite a default acknowledgment', () => {
  assert.match(future, /coalesce\(doc->>''unique_id'',doc->>''id'',doc->>''itemcode_normalized''\)/);
  assert.match(future, /HANDOVER_AUDIT_KEY_PATCH_FAILED/);
  assert.match(defaults, /private\.handover_replace_identity_v1\(e\.value->>'assignedto'\)/);
  assert.match(defaults, /ITEMCODE_DEFAULT_OWNER_REPLACED_REFRESH_REQUIRED/);
});
const defaultOwnerConcurrency = read('../scripts/test-itemcode-default-owner-concurrency.mjs');

test('release migration order applies exact-row authority before every consumer', () => {
  const names = [inventoryRowAssignmentAuthorityMigrationName, itemcodeDefaultOwnersMigrationName,
    inventoryRowAssignmentFenceIntegrationMigrationName, inventoryRowAssignmentFutureSnapshotsMigrationName,
    inventoryRowAssignmentLiveConsumersMigrationName];
  const start = releaseDatabaseMigrations.indexOf(names[0]);
  assert.ok(start >= 0, 'row authority is registered');
  assert.deepEqual(releaseDatabaseMigrations.slice(start, start + names.length), names);
  assert.ok(releaseDatabaseMigrations.indexOf(auraInternalQueryMigrationName) >= start + names.length,
    'Aura reads are installed after row authority and its existing consumers');
  for (const name of names) assert.match(migrationContractQuery(name), / as installed$/);
});

test('Reclass ownership guard checks source and every edited row by exact UID', () => {
  assert.match(consumers, /private\.inventory_effective_owner_v1\(source_uid\)/);
  assert.match(consumers, /jsonb_array_elements\(coalesce\(p_payload->'rowOverlays'/);
  assert.match(consumers, /inventory_effective_owner_v1\(overlay->>'unique_id'\)/);
  assert.match(consumers, /old_query text := \$old\$[\s\S]*?from public\.ph_warehouse_assigned_items a/);
  assert.match(consumers, /new_query text := \$new\$[\s\S]*?inventory_effective_owner_v1/);
});

test('season-priority assignee options come from exact row assignments only', () => {
  assert.match(consumers, /old_lookup text := \$old\$[\s\S]*?from public\.ph_warehouse_assigned_items a/);
  assert.match(consumers, /new_lookup text := \$new\$[\s\S]*?from public\.ph_inventory_row_assignments a[\s\S]*?a\.master_unique_id = e\.unique_id/);
});

test('Eval Reports #2 projects each lot from its exact source UID', () => {
  assert.match(consumers, /old_projection text := \$old\$[\s\S]*?from public\.ph_warehouse_assigned_items a/);
  assert.match(consumers, /new_projection text := \$new\$[\s\S]*?inventory_effective_owner_v1\(m\.unique_id\)/);
  assert.match(consumers, /ROW_ASSIGNMENT_EVAL_REPORT_PROJECTION_SOURCE_MISMATCH/);
});

test('Eval Reports migration matches one exact LF or CRLF fragment without normalizing the stored function', () => {
  const projection = consumers.slice(consumers.indexOf('-- Eval Reports #2'), consumers.indexOf('-- Review setup'));
  assert.match(projection, /old_projection := replace\(old_projection, chr\(13\) \|\| chr\(10\), chr\(10\)\)/);
  assert.match(projection, /crlf_projection := replace\(old_projection, chr\(10\), chr\(13\) \|\| chr\(10\)\)/);
  assert.match(projection, /if lf_matches \+ crlf_matches <> 1 then/);
  assert.match(projection, /if crlf_matches = 1 then[\s\S]*old_projection := crlf_projection/);
  assert.match(projection, /execute replace\(definition, old_projection, new_projection\)/);
  assert.doesNotMatch(projection, /definition := (?:replace|regexp_replace)/);
  const workflow = read('../.github/workflows/release-database.yml');
  assert.match(workflow, /node supabase\/ci\/inventory_row_assignment_line_endings_pglite\.mjs --pglite-root "\$pglite_root"/);
});

test('new Eval Work uses exact recipients and issued work preserves its saved authorization', () => {
  assert.match(consumers, /create or replace function private\.eval_work_assignment_users_v1\(p_itemcode text\)[\s\S]*?a\.master_unique_id = m\.unique_id/);
  assert.match(consumers, /old_owner_gate text := \$old\$[\s\S]*?eval_work_match_assignment_users_v1\(work\.itemcode, selected_filters\)/);
  assert.match(consumers, /ROW_ASSIGNMENT_EVAL_WORK_MEMBERSHIP_SOURCE_MISMATCH/);
  assert.match(consumers, /eval_work_assert_itemcode_membership_v1\(uuid\)'::regprocedure/);
  assert.doesNotMatch(consumers.slice(consumers.indexOf('create or replace function private.eval_work_assignment_users_v1'), consumers.indexOf('-- Eval Work creation uses')), /ph_warehouse_assigned_items/);
});

test('future Pikes snapshots use exact row authority and leave finalized snapshots frozen', () => {
  const patch = future.slice(future.indexOf('-- Preserve the production finalizer'), future.indexOf('-- Include the new default table'));
  assert.match(patch, /pg_get_functiondef\('public\.finalize_pikes_order_import\(text,text,text,integer,integer\)'::regprocedure\)/);
  assert.match(patch, /PIKES_FINALIZER_SECURITY_DEFINER_REQUIRED/);
  assert.match(patch, /target\.source_key not in \(''pikes'', ''stine_lumber''\)/);
  assert.match(patch, /effective_label := case target\.source_key/);
  assert.match(patch, /position\('if target\.status in \(''archive_pending'', ''processed''\) then' in definition\)/);
  assert.match(patch, /snapshot_cutoff := coalesce\(target\.imported_at, clock_timestamp\(\)\)/);
  assert.match(patch, /a\.assigned_at <= snapshot_cutoff/);
  assert.match(patch, /imported_at = snapshot_cutoff/);
  assert.match(patch, /'inventory-row:' \|\| a\.master_unique_id/);
  assert.match(patch, /sourceKey/);
  assert.match(patch, /PIKES_EXACT_ROW_PATCH_SOURCE_MISMATCH/);
  assert.doesNotMatch(patch, /language plpgsql security invoker/);
});

test('scheduled handover transfers defaults, advances revisions, then recomputes derived rows', () => {
  assert.match(future, /\('ph_itemcode_default_owners','itemcode_normalized',array\['assignedto'\]/);
  assert.match(future, /new\.revision := old\.revision \+ 1/);
  assert.match(future, /auth\.uid\(\) is not null/);
  assert.match(future, /new\.assigned_at := case when new\.assignedto is null then null else now\(\) end/);
  assert.match(future, /app_dataset_revisions r where r\.key='ph_master_inventory' and r\.state='ready' for share/);
  assert.match(future, /pg_advisory_xact_lock\(hashtextextended\('gnc-reconcile-eval-itemcodes-v2',0\)\)/);
  assert.match(future, /private\.resolve_inventory_row_assignment_v1\(row_value\.unique_id/);
  assert.doesNotMatch(future, /update public\.ph_inventory_row_assignments a set\s+assignedto/);
});

test('default-owner concurrency fixture uses native sessions and checks revision and idempotency races', () => {
  assert.match(defaultOwnerConcurrency, /auth\.sessions\(id,user_id,not_after\)/);
  assert.match(defaultOwnerConcurrency, /Promise\.allSettled\(/);
  assert.match(defaultOwnerConcurrency, /ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT/);
  assert.match(defaultOwnerConcurrency, /Concurrent exact retries return the same saved acknowledgment/);
  assert.match(defaultOwnerConcurrency, /ph_itemcode_default_owner_audit where request_id=\$1/);
});

test('report overlay supports exact authoritative NULL and retains legacy snapshots', () => {
  assert.match(engine, /options\.assignmentContract === 'inventory-row-assignments-v1'/);
  assert.match(engine, /assignmentBySourceId\.has\(sourceId\)/);
  assert.match(engine, /assignmentBySourceId\.get\(sourceId\)/);
  assert.match(engine, /buildAuthoritativeAssignmentKey\(row\)/);
});

test('Assigned Items export reads row ID, location, lot, effective and default ownership', () => {
  assert.match(appScript, /WAREHOUSE_EFFECTIVE_ASSIGNMENTS_TABLE = 'ph_inventory_row_assignments'/);
  assert.match(appScript, /master_unique_id,unique_id,itemcode,itemcode_normalized,genusname,commonname,contsize,locationcode,lotcode/);
  assert.match(appScript, /default_assignedto,default_revision,assignment_reason,review_required/);
  assert.match(appScript, /'MASTER_UNIQUE_ID', 'ITEMCODE', 'GENUSNAME', 'ASSIGNEDTO', 'DEFAULT_ASSIGNEDTO'/);
});

test('responsive Eval Reports fixtures use exact row identities and acknowledged RPC responses', () => {
  assert.match(responsiveE2E, /master_unique_id: 'eval2-a-f1'/);
  assert.match(responsiveE2E, /contractVersion: 'inventory-row-assignments-v1'/);
  assert.match(responsiveE2E, /master_unique_id: 'eval-test-1'/);
  assert.doesNotMatch(responsiveE2E, /applyAcknowledgedEvalAssignmentResults\(\s*\[\{ itemcode:/);
});

test('new downstream migrations stay within repository file-size guardrail', () => {
  for (const source of [future, consumers]) assert.ok(source.split(/\r?\n/).length < 500);
});
