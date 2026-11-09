import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createDatabaseWorkspace } from '../../scripts/database-workspace.mjs';
import { classifyReleasePaths, selectRecoveredReleaseScope } from '../../scripts/release-scope.mjs';
import { historicalSuspendCloseCommand } from './suspend-replay-fixture.mjs';
import { historyDeltaMigrationContract, indexedPhotoEvidenceMigrationName } from './history-delta-migration-registry.mjs';
import { packGeneratedDatabaseTypes, readGeneratedDatabaseTypes, verifyGeneratedDatabaseTypes } from '../../scripts/database-type-parts.mjs';
import { getSupportedFunctions, probeSql } from '../../scripts/sql-lint-temp-context.mjs';

export async function invariant546({ read }) {
  const { geometryLayoutOwners } = await import('../ui/drive-geometry-fixture.mjs');
  assert.deepEqual([...geometryLayoutOwners], ['releaseManagerTablePinnedLayout', 'applyUniversalPinnedResultsLayout']);
  assert.match(read('scripts/drive-mobile-geometry.mjs'), /assets\/manager-table-layout\.js/);
}

export function invariant582() {
  const root = process.cwd();
  const entry = 'v2/src/services/sandbox.database.types.ts';
  const native = readGeneratedDatabaseTypes(root, entry);
  assert.match(native, /Tables: \{[\s\S]*?ph_requests_pending: \{[\s\S]*?Update: \{[\s\S]*?req_qty\?: number \| null/);
  assert.match(native, /Views: \{[\s\S]*?ph_active_request: \{/);
  verifyGeneratedDatabaseTypes(root, native, entry);
  assert.throws(() => verifyGeneratedDatabaseTypes(root,
    native.replace('ph_requests_pending: {', 'ph_requests_incomplete: {'), entry), /DATABASE_TYPES_OUT_OF_DATE/);
}

export function invariant581() {
  const importerBody = `declare v_rows jsonb;
begin
  create temp table ph_master_bulk_stage_v1 as select 1::bigint row_number;
  create temp table ph_master_bulk_map_v1 as select row_number from pg_temp.ph_master_bulk_stage_v1;
end;`;
  const overrideBody = `begin
  create temp table erp_order_delta_v23196 as
    select row_number from pg_temp.ph_master_bulk_stage_v1 join pg_temp.ph_master_bulk_map_v1 using(row_number);
end;`;
  const override = { schema: 'private', name: 'apply_inventory_live_overrides_bulk_v1',
    arguments: 'uuid', argumentNames: ['p_run_id'], body: overrideBody, definition: overrideBody };
  const importer = { schema: 'public', name: 'bulk_import_master_snapshot_v2374_base',
    arguments: 'uuid, uuid, jsonb, text', body: importerBody, definition: importerBody };
  const context = probeSql(getSupportedFunctions([override, importer], { allowMissing: true }));
  assert.match(context, /create temp table ph_master_bulk_map_v1[\s\S]*WITH NO DATA;[\s\S]*create temp table erp_order_delta_v23196/);
  assert.throws(() => getSupportedFunctions([{ ...override, arguments: 'text' }], { allowMissing: true }),
    /SQL_LINT_TEMP_CONTEXT_FUNCTION_SIGNATURE_CHANGED/);
}

export async function invariant573() {
  const { compileBunchQueue } = await import('../../scripts/build-bunch-queue.mjs');
  const { checkHistoricalGeneratedOutput } = await import('../../scripts/engineering-validator.mjs');
  const root = process.cwd();
  const file = 'assets/bunch-queue.js';
  const { outputs } = await compileBunchQueue({ root });
  const source = outputs.get(path.join(root, file)).toString('utf8');
  assert.equal(checkHistoricalGeneratedOutput({ file, source, version: 'worktree' }, outputs, root), '');
  assert.match(checkHistoricalGeneratedOutput({ file, source: source + 'tampered', version: 'worktree' }, outputs, root), /differs/);
}

export function invariant576() {
  const pending = classifyReleasePaths(['Code.gs', 'index.html', 'supabase/migrations/20261109001000_history.sql']);
  const repair = classifyReleasePaths(['supabase/functions/app-api/index.ts']);
  assert.deepEqual(selectRecoveredReleaseScope(repair, pending, pending).deploy,
    { frontend: true, supabase: true, appsScript: true });
  const frontend = classifyReleasePaths(['index.html']);
  assert.deepEqual(selectRecoveredReleaseScope(frontend, pending, pending).deploy, frontend.deploy);
}

export async function invariant574({ read }) {
  const source = await read('supabase/functions/app-api/index.ts');
  const path = source.match(/import \{ createHistoricalSnapshotFetch, fetchHistoricalSnapshot \} from "([^"]+)"/)?.[1];
  assert.equal(path, '../_shared/historical-snapshot-transport.mjs');
  const { historicalSnapshotReadUrl } = await import('../../supabase/functions/_shared/historical-snapshot-transport.mjs');
  const physical = 'https://kzrnyjsosryejjejliii.supabase.co/rest/v1/ph_hold_stop_itemcode_snapshots?limit=1';
  assert.equal(historicalSnapshotReadUrl(physical), physical.replace('?limit=1', '_snapshot_v3039?limit=1'));
  assert.equal(historicalSnapshotReadUrl(physical, 'PATCH'), physical);
}

export async function invariant575() {
  const { build } = await import('esbuild');
  const bundle = await build({ entryPoints: ['supabase/functions/_shared/aura-voice-scope.ts'],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  const { explicitFilters } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
  const proposal = { commonName: 'Maple', season: 'S1', salesYear: 99 };
  assert.deepEqual(explicitFilters('How many Maple?', proposal), { commonName: 'Maple', seasonReference: 'current' });
  assert.deepEqual(explicitFilters('How many Maple in S1 for Sales Year 26?', proposal),
    { commonName: 'Maple', season: 'S1', salesYear: 26 });
}

export function invariant577() {
  const command = historicalSuspendCloseCommand();
  assert.match(command, /SUSPEND_TAG_REVIEW_LOCKED/);
  assert.match(command, /SUSPEND_TAG_INVENTORY_AMBIGUOUS/);
  assert.match(command, /where outbox\.event_id in/i);
  assert.doesNotMatch(command, /resolve_edit_source_v23107|publish_inventory_evidence_v23119/);
}

export function invariant578() {
  const workspace = createDatabaseWorkspace();
  try {
    const migrations = path.join(workspace.root, 'supabase', 'migrations');
    const names = readdirSync(migrations).sort();
    const prerequisite = names.findIndex(name => name.endsWith('_ci_canonical_request_replay_prerequisites.sql'));
    const verification = names.findIndex(name => name.endsWith('_ci_canonical_request_replay_verify.sql'));
    const cleanup = names.findIndex(name => name.endsWith('_ci_canonical_request_replay_cleanup.sql'));
    assert.match(names[prerequisite + 1], /_bounded_request_queue_reconciliation_v2/);
    assert.match(names[verification - 1], /_request_queue_legacy_outbox_reconciliation_v4/);
    assert.ok(prerequisite < verification && verification < cleanup);
    for (const index of [prerequisite, verification, cleanup]) {
      assert.match(readFileSync(path.join(migrations, names[index]), 'utf8'), /private\.ci_schema_workspace_guard/);
      assert.equal(existsSync(path.join('supabase', 'migrations', names[index])), false);
    }
  } finally {
    workspace.dispose();
  }
}

export async function invariant579({ read }) {
  const migration = await read('supabase/migrations/' + indexedPhotoEvidenceMigrationName);
  assert.match(migration, /m\.itemcode IS NOT NULL AND m\.locationcode IS NOT NULL/);
  assert.match(migration, /upper\(btrim\(coalesce\(m\.locationcode,''\)\)\)=upper\(btrim\(p_location\)\)/);
  assert.match(migration, /PHOTO_EVIDENCE_LOOKUP_PREDICATE_CHANGED/);
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER|DROP\s+TRIGGER|GRANT\s/i);
  assert.match(historyDeltaMigrationContract(indexedPhotoEvidenceMigrationName), /indisvalid and indisready/);
}

export function invariant580() {
  const root = process.cwd();
  const native = readGeneratedDatabaseTypes(root);
  const parts = packGeneratedDatabaseTypes(native);
  assert.ok(parts.size > 1);
  assert.ok([...parts.values()].every(source => source.split('\n').length <= 400));
  assert.match(native, /ph_drive_around_report_rows_snapshot_v3039:/);
  assert.match(native, /historical_request_archive_read_v3039:/);
  verifyGeneratedDatabaseTypes(root, native);
}
