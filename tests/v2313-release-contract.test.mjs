import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import yaml from 'js-yaml';
import { isV2313DriveTimingWithinBudget, V2313_FINALIZE_BUDGET_MS } from '../scripts/check-v2313-retained-validation.mjs';
import { patchAppsScriptFunctions } from '../scripts/apps-script-function-patch.mjs';
import { migrationContractQuery, bulkMasterSnapshotMigrationName, bulkContextIndexPlanMigrationName } from '../scripts/apply-item-low-stock-migration.mjs';

test('backend deployment selects exact migrations and Edge Functions without package-version branches', () => {
  const workflow = yaml.safeLoad(fs.readFileSync('.github/workflows/apps-script-sync.yml', 'utf8'));
  const jobs = workflow.jobs;
  assert.ok(jobs['authorize-backend'].outputs.migrations);
  assert.ok(jobs['authorize-backend'].outputs['edge-functions']);
  assert.match(jobs['deploy-supabase'].if, /backend-validation.result == 'success'/);
  const edgeStep = jobs['deploy-supabase'].steps.find(step => step.name === 'Deploy changed Edge Functions');
  assert.equal(edgeStep.if, "needs.authorize-backend.outputs['edge-functions'] != '[]'");
  assert.match(edgeStep.run, /RELEASE_EDGE_FUNCTIONS/);
  const migrationStep = jobs['deploy-supabase'].steps.find(step => step.run === 'node scripts/apply-item-low-stock-migration.mjs');
  assert.equal(migrationStep.if, "needs.authorize-backend.outputs.migrations != '[]'");
  assert.equal(migrationStep.env.RELEASE_MIGRATIONS, '${{ needs.authorize-backend.outputs.migrations }}');
  assert.doesNotMatch(JSON.stringify(workflow.jobs), /v2313|v2311|v238|receipt|retained/i);
});

test('schema gate requires selected database integration checks to pass', () => {
  const workflow = yaml.safeLoad(fs.readFileSync('.github/workflows/release-database.yml', 'utf8'));
  const gate = workflow.jobs['schema-gate'].steps[0];
  assert.match(gate.run, /jobs\[name\]\?\.result !== 'success'/);
  assert.match(gate.run, /All full schema integration checks passed/);
  for (const name of ['integration', 'schema-contracts', 'suspend-tag-approval', 'database-and-functions'])
    assert.match(workflow.jobs[name].if, /needs\.schema-path-scope\.outputs\.changed == 'true'/);
  assert.match(workflow.jobs['edge-functions'].if, /needs\.discover\.outputs\.edge/);
  assert.doesNotMatch(JSON.stringify(workflow.jobs), /v2313|v2311|v238|receipt|retained/i);
  const program = gate.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, '');
  const required = ['schema-path-scope', 'discover', 'integration', 'edge-functions', 'schema-contracts', 'suspend-tag-approval', 'database-and-functions'];
  const results = Object.fromEntries(required.map(name => [name, { result: 'success' }]));
  const run = (scope = 'true', requireScope = 'false', edgeScope = '{"include":[{"name":"edge"}]}') => vm.runInNewContext(program, {
    process: { env: { SCOPE: scope, EDGE_SCOPE: edgeScope, REQUIRE_SCHEMA_SCOPE: requireScope, RESULTS: JSON.stringify(results) }, exit() {} },
    console: { log() {} },
  });
  assert.doesNotThrow(() => run());
  for (const name of required.slice(2)) {
    results[name].result = 'skipped';
    assert.throws(() => run(), new RegExp(`BACKEND_SCHEMA_GATE_FAILED_${name}`));
    results[name].result = 'success';
  }
  results['edge-functions'].result = 'skipped';
  assert.doesNotThrow(() => run('true', 'false', '{"include":[]}'));
  assert.throws(() => run(), /BACKEND_SCHEMA_GATE_FAILED_edge-functions/);
  results['edge-functions'].result = 'success';
  assert.doesNotThrow(() => run('false', 'false'));
  assert.throws(() => run('false', 'true'), /BACKEND_SCHEMA_SCOPE_REQUIRED/);
});

test('Apps Script patching preserves an unapproved scheduling function in a synthetic fixture', () => {
  const remote = 'const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = "fixture";\nfunction handleSignedRequestDeliveryEvent_(){ return "old"; }\nfunction scheduledBackfill(){ return "trusted"; }\n';
  const local = 'const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = "fixture";\nfunction handleSignedRequestDeliveryEvent_(){ return "new"; }\nfunction scheduledBackfill(){ return "changed"; }\n';
  const patch = patchAppsScriptFunctions({ remoteSource: remote, localSource: local, functionNames: ['handleSignedRequestDeliveryEvent_'] });
  assert.match(patch.source, /function handleSignedRequestDeliveryEvent_\(\)\{ return "new"; \}/);
  assert.match(patch.source, /function scheduledBackfill\(\)\{ return "trusted"; \}/);
  assert.doesNotMatch(patch.source, /changed/);
  assert.ok(patch.protectedSourceDigest);
  assert.deepEqual(patch.functions, ['handleSignedRequestDeliveryEvent_']);
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
