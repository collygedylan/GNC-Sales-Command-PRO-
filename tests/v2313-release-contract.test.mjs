import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { verifyV2313AppsScriptProtection } from '../scripts/check-v2313-retained-validation.mjs';
import { patchAppsScriptFunctions } from '../scripts/apps-script-function-patch.mjs';
import { execFileSync } from 'node:child_process';

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
