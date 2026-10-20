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

test('scoped backend publication requires verified receipts and deploys only derived function names', () => {
  const source = read('.github/workflows/apps-script-sync.yml');
  const workflow = YAML.parse(source);
  const job = workflow.jobs['deploy-supabase'];
  assert.match(job.if, /retained-contracts.result == 'success'/);
  const migration = job.steps.find(step => step.run === 'node scripts/apply-item-low-stock-migration.mjs');
  assert.equal(migration.env.SCOPED_RELEASE_DEPLOY, '${{ needs.authorize-backend.outputs.scoped }}');
  assert.equal(migration.if, undefined);
  const functions = job.steps.find(step => step.name === 'Configure Production Schedule dispatch and deploy backend functions');
  assert.match(functions.run, /verifyScopedRetainedValidation\(\)\.deployment\.edgeFunctions/);
  assert.match(functions.run, /supabase functions deploy "\$function_name"/);
  const apply = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(apply, /normalizeScopedMigrationPaths\(scopedReceipt\.deployment\.migrations\)/);
  assert.match(apply, /scopedReceipt\s*\?\s*normalizeScopedMigrationPaths/);
});

test('database gate requires source-sealed disposable evidence for scoped releases', () => {
  const workflow = YAML.parse(read('.github/workflows/release-database.yml'));
  assert.ok(workflow.jobs['schema-gate'].needs.includes('scoped-retained-contracts'));
  const check = workflow.jobs['scoped-retained-contracts'].steps.find(step => step.run);
  assert.match(check.run, /verifyScopedRetainedValidation/);
  assert.match(check.run, /disposable !== true/);
  assert.match(check.run, /assertions > 0/);
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
  assert.match(source, /if \(JSON\.parse\(readFileSync\(path\.join\(repositoryRoot, 'package\.json'\), 'utf8'\)\)\.scopedValidationReceipt\)/);
});

test('scoped Pages release waits for the exact merged backend before publishing', () => {
  const workflow = YAML.parse(read('.github/workflows/pages-static.yml'));
  const deploy = workflow.jobs.deploy;
  const steps = deploy.steps;
  const gate = steps.findIndex(step => step.name === 'Wait for scoped backend migrations and Edge publication');
  const publish = steps.findIndex(step => step.name === 'Deploy verified artifact to Pages');
  assert.ok(gate >= 0 && publish > gate);
  const script = steps[gate].with.script;
  for (const marker of [
    'scopedValidationReceipt', 'deployment?.migrations', 'sourceHashes', 'SCOPED_BACKEND_MIGRATION_RECEIPT_INVALID',
    'SCOPED_BACKEND_MIGRATION_RECEIPT_MISMATCH', 'apps-script-sync.yml',
    'head_sha === context.sha', "event === 'workflow_dispatch'", 'Apply backend migrations and deploy Edge Functions',
    'deployRun.conclusion !== \'success\'', 'appsScriptChangedFunctions', 'apps-script-deploy.yml',
    "event === 'workflow_run'", "job.name === 'deploy-apps-script'",
    "Publish the guarded production Apps Script version", 'SCOPED_APPS_SCRIPT_PUBLICATION_TIMEOUT',
  ]) assert.ok(script.includes(marker), marker);
  assert.match(script, /Date\.now\(\)\s*\+\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(script, /Date\.now\(\)\s*\+\s*15\s*\*\s*60\s*\*\s*1000/);
});
