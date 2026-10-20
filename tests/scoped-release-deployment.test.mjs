import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import { scopedEdgeMatrix } from '../scripts/ci-backend-matrix.mjs';
import {
  migrationContractQuery, reclassEmailReportPolicyMigrationName, releaseDatabaseMigrations,
} from '../scripts/apply-item-low-stock-migration.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Reclass report migration is registered with recipient and immutable report contracts', () => {
  assert.ok(releaseDatabaseMigrations.includes(reclassEmailReportPolicyMigrationName));
  const sql = migrationContractQuery(reclassEmailReportPolicyMigrationName);
  for (const marker of ['reclass_delivery_recipients_v1', 'appliedRows', 'enqueue_drive_reclass_inquiry_v7',
    'apply_inventory_reclass_moves_with_delivery_v1', 'has_function_privilege']) assert.ok(sql.includes(marker));
});

test('scoped backend publication requires actual checks and deploys selected functions after SQL', () => {
  const source = read('.github/workflows/apps-script-sync.yml');
  const workflow = YAML.parse(source);
  const job = workflow.jobs['deploy-supabase'];
  for (const name of ['backend-validation', 'pending-order-contract', 'suspend-tag-contract', 'live-dataset-contract']) {
    assert.ok(job.if.includes(`needs.${name}.result == 'success'`));
  }
  const migration = job.steps.find(step => step.run === 'node scripts/apply-item-low-stock-migration.mjs');
  assert.equal(migration.env.RELEASE_MIGRATIONS, '${{ needs.authorize-backend.outputs.migrations }}');
  assert.equal(migration.if, "needs.authorize-backend.outputs.migrations != '[]'");
  const functions = job.steps.find(step => step.name === 'Deploy changed Edge Functions');
  assert.equal(functions.env.RELEASE_EDGE_FUNCTIONS, '${{ needs.authorize-backend.outputs[\'edge-functions\'] }}');
  assert.match(functions.run, /supabase functions deploy "\$function_name"/);
  const apply = read('scripts/apply-item-low-stock-migration.mjs');
  assert.ok(job.steps.indexOf(migration) < job.steps.indexOf(functions));
  assert.match(apply, /selectReleaseMigrations/);
  assert.doesNotMatch(apply, /scopedReceipt|verifyScopedRetainedValidation/);
});

test('scoped backend classifier validates selected migration and Edge Function inputs', () => {
  const workflow = YAML.parse(read('.github/workflows/apps-script-sync.yml'));
  const scope = workflow.jobs['authorize-backend'].steps.find(step => step.name === 'Require changed Supabase or database paths');
  assert.ok(scope);
  for (const marker of ['changedReleasePaths', 'classifyReleasePaths', 'Array.isArray',
    'RELEASE_MIGRATION_INPUT_INVALID', 'EDGE_FUNCTION_SELECTION_INVALID', 'available.has(name)']) {
    assert.ok(scope.run.includes(marker));
  }
  assert.doesNotMatch(scope.run, /scopedValidationReceipt|retained/);
});

test('database gate requires actual selected disposable checks without receipt substitution', () => {
  const workflow = YAML.parse(read('.github/workflows/release-database.yml'));
  assert.equal(workflow.jobs['scoped-retained-contracts'], undefined);
  const gate = workflow.jobs['schema-gate'];
  for (const name of ['integration', 'schema-contracts', 'database-and-functions']) assert.ok(gate.needs.includes(name));
  assert.match(gate.steps[0].run, /jobs\[name\]\?\.result !== 'success'/);
  assert.match(gate.steps[0].run, /BACKEND_SCHEMA_SCOPE_REQUIRED/);
});

test('source-sealed scoped backend matrix checks only derived affected Edge Functions and touched tests', () => {
  const matrix = scopedEdgeMatrix({
    edgeFunctions: ['request-delivery-worker', 'app-api', 'app-api'],
    changedPaths: [
      'supabase/functions/_shared/production-workflow.ts',
      'supabase/functions/app-api/index.ts',
      'supabase/functions/app-api/suspend-tag-read_test.ts',
      'supabase/functions/request-delivery-worker/index.ts',
      'supabase/tests/v2315_reclass_email_runtime_test.sql',
    ],
  });
  assert.deepEqual(matrix.include, [
    { suite: 'app-api', targets: ['supabase/functions/app-api/index.ts'],
      tests: ['supabase/functions/app-api/suspend-tag-read_test.ts'] },
    { suite: 'request-delivery-worker', targets: ['supabase/functions/request-delivery-worker/index.ts'], tests: [] },
  ]);
  const source = read('scripts/ci-backend-matrix.mjs');
  assert.doesNotMatch(source, /scopedValidationReceipt|verifyScopedRetainedValidation/);
});

test('mixed Pages release waits for exact backend and Apps Script publication', () => {
  const workflow = YAML.parse(read('.github/workflows/pages-static.yml'));
  const deploy = workflow.jobs.deploy;
  assert.ok(deploy.needs.includes('backend-publication'));
  assert.match(deploy.if, /needs.backend-publication.result == 'success'/);
  const script = workflow.jobs['backend-publication'].steps[0].with.script;
  for (const marker of [
    'apps-script-sync.yml', 'BACKEND_MAIN_SUPERSEDED', 'BACKEND_RUN_IDENTITY_MISMATCH',
    "event === 'workflow_dispatch'", 'Apply backend migrations and deploy Edge Functions',
    'apps-script-deploy.yml', "job.name === 'deploy-apps-script'",
    'Publish the guarded production Apps Script version', 'APPS_SCRIPT_PUBLICATION_NOT_SUCCESSFUL',
  ]) assert.ok(script.includes(marker), marker);
  assert.doesNotMatch(script, /scopedValidationReceipt/);
  assert.match(script, /Date\.now\(\)\s*\+\s*15\s*\*\s*60\s*\*\s*1000/);
});

test('validated PR publication dispatches the same coordinator as direct pushes and manual releases', () => {
  const source = read('.github/workflows/publish-candidate.yml');
  assert.match(source, /await dispatchPagesOnce/);
  assert.doesNotMatch(source, /apps-script-sync.yml|apps-script-deploy.yml|scopedValidationReceipt/);
  const pages = YAML.parse(read('.github/workflows/pages-static.yml'));
  assert.deepEqual(pages.on.push.branches, ['main']);
  assert.ok(pages.on.workflow_dispatch);
});
