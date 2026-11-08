import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

export function registerBackendDeploymentTest(workflowConfig) {
test('daytime backend deployment keeps authorization and SQL before Edge while full validation stays nightly', () => {
  const sync = yaml.load(fs.readFileSync(new URL('../../.github/workflows/apps-script-sync.yml', import.meta.url), 'utf8'));
  const deploy = sync.jobs['deploy-supabase'];
  const required = ['authorize-backend', 'backend-validation', 'pending-order-contract', 'suspend-tag-contract', 'live-dataset-contract'];
  assert.deepEqual([deploy.needs].flat(), required);
  for (const name of required) assert.match(deploy.if, new RegExp(`needs\\.${name}\\.result == 'success'`));
  assert.match(deploy.if, /outputs\.authorized == 'true'/);
  assert.match(deploy.if, /outputs\.backend-changed == 'true'/);
  assert.equal(sync.jobs['backend-validation'].with['run-schema-tests'], true);
  assert.equal(sync.jobs['backend-validation'].with['run-all-schema-tests'], true);
  for (const name of required.slice(2)) assert.ok(sync.jobs[name].uses, name);
  const commands = deploy.steps.map(step => step.run || '').join('\n');
  assert.match(commands, /BACKEND_DISPATCH_STALE_MAIN/);
  assert.ok(commands.indexOf('scripts/apply-item-low-stock-migration.mjs') < commands.indexOf('supabase functions deploy'));
  assert.doesNotMatch(commands, /database-check|run-release-unit-checks|run-release-smoke|playwright|docker build/);
  const nightly = yaml.load(fs.readFileSync(new URL('../../.github/workflows/nightly-validation.yml', import.meta.url), 'utf8'));
  assert.equal(nightly.jobs['backend-diagnostics'].uses, './.github/workflows/release-database.yml');
  for (const flag of ['run-schema-tests', 'run-browser-tests', 'run-performance-tests', 'run-all-schema-tests']) {
    assert.equal(nightly.jobs['backend-diagnostics'].with[flag], true, flag);
  }
  assert.equal(workflowConfig.on.push, undefined, 'full backend diagnostics never independently trigger on a main push');
});

}
