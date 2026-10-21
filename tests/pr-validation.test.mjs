import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { testScopeForPaths } from '../scripts/ci-test-scope.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const pr = yaml.load(read('.github/workflows/pr-validation.yml'));
const monitor = yaml.load(read('.github/workflows/performance-monitor.yml'));
const nightly = yaml.load(read('.github/workflows/nightly-validation.yml'));

test('daytime PRs run one focused inline and tooling job without historical matrices', () => {
  assert.deepEqual(Object.keys(pr.jobs), ['fast-pr']);
  const job = pr.jobs['fast-pr'];
  assert.equal(job.strategy, undefined);
  assert.equal(job.if, undefined, 'scope flags cannot skip the authorization check');
  assert.equal(job['timeout-minutes'], 3);
  assert.deepEqual(pr.permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' });
  const commands = job.steps.map(step => step.run).filter(Boolean);
  assert.deepEqual(commands, [
    'node scripts/prepare-release-version.mjs --check',
    'npm run check:inline',
    'node scripts/run-tooling-release-checks.mjs',
  ]);
  for (const step of job.steps) {
    assert.equal(step.if, undefined);
    assert.notEqual(step['continue-on-error'], true);
  }
  assert.doesNotMatch(JSON.stringify(job), /run-release-unit-checks|run-release-react-checks|run-discovered-tests|release-database|playwright|docker|prepare-release-site|upload-artifact|secrets/);
  assert.equal(pr.on.workflow_call.outputs, undefined, 'PR checks are not a built publication proof');
});

test('all PR change scopes retain the same required fast job while diagnostics keep their scope classification', () => {
  for (const selection of [
    { paths: ['v2/src/App.tsx'], frontend: true, backend: false, schema: false },
    { paths: ['supabase/functions/aura-llm-router/index.ts'], frontend: false, backend: true, schema: true },
    { paths: ['services/reclassMove.ts'], frontend: true, backend: true, schema: false },
    { paths: ['supabase/migrations/example.sql'], frontend: false, backend: true, schema: true },
  ]) {
    assert.deepEqual(testScopeForPaths(selection.paths), { frontend: selection.frontend, backend: selection.backend, schema: selection.schema });
    assert.deepEqual(Object.keys(pr.jobs), ['fast-pr']);
  }
  assert.equal(monitor.jobs.validation.uses, './.github/workflows/pr-validation.yml');
  assert.equal(monitor.jobs.validation.with['run-frontend-tests'], "${{ needs.changes.outputs.frontend == 'true' }}");
  assert.equal(monitor.jobs.validation.with['run-backend-tests'], "${{ needs.changes.outputs.backend == 'true' }}");
  assert.equal(nightly.on.schedule[0].cron, '30 1,2 * * *');
  const full = Object.values(nightly.jobs).find(job => job.uses === './.github/workflows/release-validation.yml');
  assert.equal(full.with['run-nightly-suites'], true);
});
