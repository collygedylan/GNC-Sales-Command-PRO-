import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { testScopeForPaths } from '../scripts/ci-test-scope.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const pr = yaml.load(read('.github/workflows/pr-validation.yml'));
const monitor = yaml.load(read('.github/workflows/performance-monitor.yml'));
const pages = yaml.load(read('.github/workflows/pages-static.yml'));
const nightly = yaml.load(read('.github/workflows/nightly-browser-validation.yml'));
const database = yaml.load(read('.github/workflows/release-database.yml'));

test('reusable PR validation defaults to frontend and backend unit coverage only', () => {
  assert.equal(pr.on.workflow_call.inputs['run-frontend-tests'].default, true);
  assert.equal(pr.on.workflow_call.inputs['run-backend-tests'].default, true);
  assert.ok(pr.jobs['pr-gate'].needs.includes('lint'));
  assert.ok(pr.jobs['pr-gate'].needs.includes('unit'));
  assert.ok(pr.jobs['pr-gate'].needs.includes('contracts'));
  assert.equal(pr.jobs.unit.steps.find(step => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0,
    'unit contracts retain access to their immutable historical Git fixtures');
  assert.doesNotMatch(JSON.stringify(pr.jobs.react.steps), /playwright|chromium|lighthouse|performance|artifact/i);
  assert.doesNotMatch(JSON.stringify(pr.jobs.unit.steps), /playwright|chromium|lighthouse|performance|artifact/i);
  for (const input of ['run-schema-tests', 'run-browser-tests', 'run-performance-tests']) {
    assert.equal(pr.jobs['backend-unit'].with[input], false);
  }
});

test('frontend, backend, mixed, and migration changes select the expected PR lanes', () => {
  const expected = [
    { paths: ['v2/src/App.tsx'], frontend: true, backend: false, schema: false, jobs: ['react'] },
    { paths: ['supabase/functions/aura-llm-router/index.ts'], frontend: false, backend: true, schema: true, jobs: ['backend-unit'] },
    { paths: ['v2/src/App.tsx', 'supabase/functions/aura-llm-router/index.ts'], frontend: true, backend: true, schema: true, jobs: ['react', 'backend-unit'] },
    { paths: ['supabase/migrations/example.sql'], frontend: false, backend: true, schema: true, jobs: ['backend-unit'] },
  ];
  for (const selection of expected) {
    assert.deepEqual(testScopeForPaths(selection.paths), { frontend: selection.frontend, backend: selection.backend, schema: selection.schema });
    assert.equal(pr.jobs.react.if.includes('inputs.run-frontend-tests'), true);
    assert.equal(pr.jobs['backend-unit'].if.includes('inputs.run-backend-tests'), true);
    for (const name of ['lint', 'unit', 'contracts']) assert.ok(pr.jobs['pr-gate'].needs.includes(name));
    for (const name of selection.jobs) assert.ok(pr.jobs['pr-gate'].needs.includes(name));
  }
});

test('all selected unit and lint lanes are required and skipped jobs fail closed', () => {
  const gate = pr.jobs['pr-gate'];
  assert.match(gate.if, /always\(\)/);
  assert.match(gate.steps.map(step => step.run || '').join('\n'), /result !== 'success'/);
  for (const name of ['lint', 'unit', 'contracts', 'react', 'backend-unit']) {
    assert.ok(gate.needs.includes(name), `${name} is part of the required PR gate`);
    if (name === 'react' || name === 'backend-unit') assert.match(pr.jobs[name].if, /inputs\./);
  }
  const script = gate.steps.map(step => step.run || '').join('\n').split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, '');
  for (const selection of [
    { frontend: true, backend: false, required: ['lint','unit','contracts','react'], skipped: ['backend-unit'] },
    { frontend: false, backend: true, required: ['lint','unit','contracts','backend-unit'], skipped: ['react'] },
    { frontend: true, backend: true, required: ['lint','unit','contracts','react','backend-unit'], skipped: [] },
    { frontend: false, backend: true, required: ['lint','unit','contracts','backend-unit'], skipped: ['react'] },
  ]) {
    const results = Object.fromEntries(gate.needs.map(name => [name, { result: 'success' }]));
    const env = { PR_JOB_RESULTS: JSON.stringify(results), RUN_FRONTEND_TESTS: String(selection.frontend), RUN_BACKEND_TESTS: String(selection.backend) };
    const execute = () => vm.runInNewContext(script, { process: { env }, console });
    for (const name of selection.skipped) results[name] = { result: 'skipped' };
    env.PR_JOB_RESULTS = JSON.stringify(results);
    assert.doesNotThrow(execute);
    for (const name of selection.required) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        results[name] = { result }; env.PR_JOB_RESULTS = JSON.stringify(results);
        assert.throws(execute, new RegExp(`PR_GATE_FAILED_${name}`));
      }
      results[name] = { result: 'success' };
    }
    for (const name of selection.required) {
      const missing = { ...results }; delete missing[name];
      env.PR_JOB_RESULTS = JSON.stringify(missing);
      assert.throws(execute, new RegExp(`PR_GATE_FAILED_${name}`));
      env.PR_JOB_RESULTS = JSON.stringify(results);
    }
  }
});

test('standard PR and Pages paths cannot opt into browser or performance validation', () => {
  assert.equal(monitor.jobs.validation.uses, './.github/workflows/pr-validation.yml');
  assert.equal(pages.jobs.validation.with['run-nightly-suites'], false);
  assert.equal(nightly.on.schedule[0].cron, '17 9 * * *');
  assert.equal(monitor.jobs.validation.with['run-frontend-tests'], "${{ needs.changes.outputs.frontend == 'true' }}");
});
