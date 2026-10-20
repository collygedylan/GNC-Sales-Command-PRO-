import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
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
  assert.match(apply, /scopedReceipt \? scopedReceipt\.deployment\.migrations : releaseDatabaseMigrations/);
});

test('database gate requires source-sealed disposable evidence for scoped releases', () => {
  const workflow = YAML.parse(read('.github/workflows/release-database.yml'));
  assert.ok(workflow.jobs['schema-gate'].needs.includes('scoped-retained-contracts'));
  const check = workflow.jobs['scoped-retained-contracts'].steps.find(step => step.run);
  assert.match(check.run, /verifyScopedRetainedValidation/);
  assert.match(check.run, /disposable !== true/);
  assert.match(check.run, /assertions > 0/);
});
