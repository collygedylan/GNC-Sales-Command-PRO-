import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { verifyV2313AppsScriptProtection, isV2313DriveTimingWithinBudget, V2313_FINALIZE_BUDGET_MS } from '../scripts/check-v2313-retained-validation.mjs';
import { patchAppsScriptFunctions } from '../scripts/apps-script-function-patch.mjs';
import { execFileSync } from 'node:child_process';
import { migrationContractQuery, bulkMasterSnapshotMigrationName, bulkContextIndexPlanMigrationName } from '../scripts/apply-item-low-stock-migration.mjs';

test('v2313 deployment selects ingestion evidence and skips unchanged Edge deployment', () => {
  const workflow = yaml.safeLoad(fs.readFileSync('.github/workflows/apps-script-sync.yml', 'utf8'));
  const jobs = workflow.jobs;
  assert.ok(jobs['authorize-backend'].outputs.v2313);
  for (const name of ['pending-order-contract', 'suspend-tag-contract', 'live-dataset-contract']) {
    assert.match(jobs[name].if, /v2313 != 'true'/);
  }
  assert.match(jobs['v238-retained-contracts'].if, /v2313 == 'true'/);
  const edgeStep = jobs['deploy-supabase'].steps.find(step => step.name === 'Configure Production Schedule dispatch and deploy backend functions');
  assert.equal(edgeStep.if, "needs.authorize-backend.outputs.v2313 != 'true'");
  const migrationStep = jobs['deploy-supabase'].steps.find(step => step.run === 'node scripts/apply-item-low-stock-migration.mjs');
  assert.equal(migrationStep.env.V2313_SCOPED_DEPLOY, '${{ needs.authorize-backend.outputs.v2313 }}');
  assert.equal(jobs['deploy-supabase'].steps.find(step => step.name === 'Verify deployed Aura authorization').if,
    "needs.authorize-backend.outputs.v2313 != 'true'");
});

test('v2313 schema gate requires sealed native PostgreSQL evidence without UI or unrelated SQL reruns', () => {
  const workflow = yaml.safeLoad(fs.readFileSync('.github/workflows/release-database.yml', 'utf8'));
  assert.ok(workflow.jobs['schema-path-scope'].outputs.v2313);
  const gate = workflow.jobs['schema-gate'].steps[0];
  assert.ok(gate.env.V2313);
  assert.match(gate.run, /V2313_INGESTION_EVIDENCE_REQUIRED/);
  const program = gate.run.replace(/^node[^\n]*\n/, '').replace(/\nNODE\s*$/, '');
  const results = Object.fromEntries(['schema-path-scope', 'discover', 'integration'].map(name => [name, { result: 'success' }]));
  for (const name of ['edge-functions', 'schema-contracts', 'suspend-tag-approval', 'database-and-functions']) results[name] = { result: 'skipped' };
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--input-type=module', '-e', program], {
    env: { ...process.env, SCOPE: 'true', V2313: 'true', RESULTS: JSON.stringify(results) }, encoding: 'utf8',
  }));
  for (const name of ['schema-contracts', 'suspend-tag-approval', 'database-and-functions']) {
    assert.match(workflow.jobs[name].if, /v2313 != 'true'/);
  }
});

test('v2313 Apps Script patch preserves every unapproved function and historical scheduling', () => {
  const protection = verifyV2313AppsScriptProtection();
  assert.ok(protection.protectedFunctions > 100);
  assert.ok(protection.patchNames.includes('processSnapshotBatchFolderLocked_'));
  const base = execFileSync('git', ['show', '1fa247e779838d20ec5090f5d95559a0bf0be864:Code.gs'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const local = fs.readFileSync('Code.gs', 'utf8');
  const patch = patchAppsScriptFunctions({ remoteSource: base, localSource: local, functionNames: protection.patchNames });
  assert.ok(patch.protectedSourceDigest);
  assert.equal(patch.functions.length, protection.patchNames.length);
});

test('v2313 approved finalization budget retains strict boundaries and staging gates', () => {
  assert.equal(V2313_FINALIZE_BUDGET_MS, 10_000);
  assert.equal(isV2313DriveTimingWithinBudget({ operation: 'finalize', ms: 5733.899 }), true);
  assert.equal(isV2313DriveTimingWithinBudget({ operation: 'finalize', ms: 9999.999 }), true);
  assert.equal(isV2313DriveTimingWithinBudget({ operation: 'finalize', ms: 10000 }), false);
  assert.equal(isV2313DriveTimingWithinBudget({ operation: 'append', ms: 2000 }), false);
  assert.equal(isV2313DriveTimingWithinBudget({ operation: 'append', ms: 321.575 }), true);
  assert.equal(isV2313DriveTimingWithinBudget({ operation: 'finalize', ms: NaN }), false);
  assert.equal(isV2313DriveTimingWithinBudget({ operation: 'finalize', ms: -1 }), false);
});


test('v2313 legacy migration contracts accept only fenced typed crop deployment and indexed context lookups', () => {
  const bulk = migrationContractQuery(bulkMasterSnapshotMigrationName);
  const typedStart = bulk.indexOf("position('private.ph_master_crop_roll_from_master_v1(master)' in p.prosrc)>0");
  assert.ok(typedStart > 0);
  assert.match(bulk.slice(0, typedStart), /position\('v2_crop_roll_drive_row_from_json' in p\.prosrc\)>0\s+or \(\s+--/);
  const typed = bulk.slice(typedStart, bulk.indexOf("and position('public.ph_crop_roll_drive_rows'", typedStart));
  for (const required of [
    "mapper.proowner=p.proowner", "mapper.provolatile='s'", "mapper.prorettype=to_regtype('public.ph_crop_roll_drive_rows')",
    "mapper.proconfig @> array['search_path=\"\"']", "not has_function_privilege('service_role',mapper.oid,'execute')",
    'count(*)=3', 'stage.prosecdef and stage.proowner=p.proowner', "'statement_timeout=120s','lock_timeout=15s'",
    'public.begin_master_snapshot_stage_v1(uuid,uuid,jsonb,text,integer,integer)',
    'public.append_master_snapshot_stage_chunk_v1(uuid,uuid,integer,jsonb)',
    'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)',
    'assert_master_snapshot_stage_fence_v1', 'MASTER_SNAPSHOT_STAGE_INCOMPLETE',
    'source_manifest_digest', 'published_response', 'private.sync_ph_master_bulk_crop_roll_v1',
    'stage_table.relrowsecurity', "not has_table_privilege('service_role',stage_table.oid",
    'ph_master_snapshot_stage_v1', 'ph_master_snapshot_stage_chunks_v1', 'ph_master_snapshot_stage_rows_v1',
  ]) assert.ok(typed.includes(required), `typed contract requires ${required}`);
  const context = migrationContractQuery(bulkContextIndexPlanMigrationName);
  for (const field of ['source_unique_id', 'canonical_unique_id']) {
    assert.ok(context.includes(`p.prosrc ~ 'c[.]${field}[[:space:]]*=[[:space:]]*p_unique_id'`));
  }
  assert.match(context, /p\.prosecdef and p\.provolatile='v'/);
  assert.ok(context.includes('ph_master_inventory_import_lineage_seen'));
  assert.ok(context.includes('ph_master_inventory_item6_alias_seen_v7'));
});
