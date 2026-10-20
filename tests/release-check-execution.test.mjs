// @test-group: release-tooling
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import yaml from 'js-yaml';
import { parse } from 'acorn';
import { runReleaseUnitChecks } from '../scripts/run-release-unit-checks.mjs';
import { runReleaseReactChecks } from '../scripts/run-release-react-checks.mjs';
import { runDiscoveredNodeTests } from '../scripts/run-discovered-tests.mjs';
import { backendTestMatrices } from '../scripts/ci-backend-matrix.mjs';
import { selectReleaseMigrations, releaseDatabaseMigrations } from '../scripts/apply-item-low-stock-migration.mjs';

function fixture(t, version = '2.3.16') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agdata-check-execution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, body) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  };
  write('package.json', JSON.stringify({ version, scopedValidationReceipt: 'missing-obsolete-receipt.json' }));
  write('tests/one.test.mjs', '');
  write('tests/two.test.mjs', '');
  write('tests/test_contract.py', '');
  return { root, write };
}

test('unit checks execute selected files and propagate failure despite historical version or receipt metadata', t => {
  const { root } = fixture(t);
  let calls = 0;
  const status = runReleaseUnitChecks({ rootDir: root, print() {}, spawn(command, args) {
    calls++;
    assert.equal(command, process.execPath);
    assert.ok(args.includes('tests/one.test.mjs'));
    assert.ok(args.includes('tests/two.test.mjs'));
    return { status: 7 };
  } });
  assert.equal(calls, 1);
  assert.equal(status, 7);
});

test('unit shards are disjoint and spawn errors or signals never count as success', t => {
  const { root } = fixture(t, '2.3.14');
  const selected = [];
  for (const shard of ['1/2', '2/2']) {
    assert.equal(runReleaseUnitChecks({ rootDir: root, argv: [`--shard=${shard}`], print() {}, spawn(_cmd, args) {
      selected.push(args.filter(arg => arg.endsWith('.test.mjs')));
      return { status: null };
    } }), 1);
  }
  assert.deepEqual(selected.flat().sort(), ['tests/one.test.mjs', 'tests/two.test.mjs']);
  assert.throws(() => runReleaseUnitChecks({ rootDir: root, print() {}, spawn: () => ({ error: new Error('spawn failed') }) }), /spawn failed/);
  assert.throws(() => runReleaseUnitChecks({ rootDir: root, argv: ['--shard=3/2'] }), /invalid unit shard/);
});

test('React checks execute the requested cases and propagate actual process status', t => {
  const { root } = fixture(t, '2.3.11');
  let calls = 0;
  assert.equal(runReleaseReactChecks({ rootDir: root, argv: ['tests/changed.test.tsx'], spawn(_cmd, args) {
    calls++;
    assert.deepEqual(args.slice(1), ['run', '--config', 'vite.v2.config.ts', 'tests/changed.test.tsx']);
    return { status: 9 };
  } }), 9);
  assert.equal(calls, 1);
  assert.equal(runReleaseReactChecks({ rootDir: root, spawn: () => ({ status: null }) }), 1);
});

test('discovered Python contracts cannot return retained-receipt success', t => {
  const { root } = fixture(t, '2.3.11');
  let calls = 0;
  assert.equal(runDiscoveredNodeTests({ root, group: 'python', print() {}, spawn(_cmd, args) {
    calls++;
    assert.deepEqual(args, ['tests/test_contract.py']);
    return { status: 3 };
  } }), 3);
  assert.equal(calls, 1);
});

test('backend matrix discovers actual tests independently of historical release metadata', t => {
  const { root, write } = fixture(t, '2.3.13');
  write('supabase/ci/contract_pglite.mjs', '');
  write('supabase/functions/example/index.ts', '');
  write('supabase/functions/example/read_test.ts', '');
  const matrices = backendTestMatrices({ root });
  assert.deepEqual(matrices.pglite, ['supabase/ci/contract_pglite.mjs']);
  assert.deepEqual(matrices.edge.include[0].tests, ['supabase/functions/example/read_test.ts']);
  assert.ok(matrices.edge.include[0].targets.includes('supabase/functions/example/index.ts'));
});

test('migration selection accepts only allowlisted paths and rejects malformed or duplicate inputs', () => {
  const migration = releaseDatabaseMigrations.at(-1);
  assert.deepEqual(selectReleaseMigrations(JSON.stringify([`supabase/migrations/${migration}`])), [migration]);
  assert.deepEqual(selectReleaseMigrations('[]'), []);
  for (const value of ['{}', 'null', 'bad json', '["../unsafe.sql"]', JSON.stringify([migration, migration])]) {
    assert.throws(() => selectReleaseMigrations(value), /LOW_STOCK_SCOPED/);
  }
});

test('immutable release gate requires actual selected successes without retained evidence', () => {
  const workflow = yaml.safeLoad(fs.readFileSync(new URL('../.github/workflows/release-validation.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.on.workflow_call.inputs['reuse-v230-passing-suites'], undefined);
  assert.equal(workflow.jobs['retained-v230-evidence'], undefined);
  assert.equal(workflow.jobs.unit.if, undefined);
  const step = workflow.jobs['release-gate'].steps.find(step => step.name === 'Require every safety lane for this commit');
  const source = /<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/.exec(step.run)[1];
  const jobs = Object.fromEntries(['release-mode', 'lint', 'unit', 'react', 'contracts', 'database', 'build'].map(name => [name, { result: 'success' }]));
  jobs.build.outputs = { digest: 'a'.repeat(64) };
  const execute = (overrides = {}, env = {}) => vm.runInNewContext(source, { console: { log() {} }, process: { env: {
    HOTFIX: 'false', RUN_FRONTEND_TESTS: 'true', RUN_BACKEND_TESTS: 'true', RUN_NIGHTLY_SUITES: 'false',
    RELEASE_JOB_RESULTS: JSON.stringify({ ...jobs, ...overrides }), ...env,
  } } });
  assert.doesNotThrow(() => execute());
  for (const status of ['skipped', 'cancelled', 'failure']) {
    assert.throws(() => execute({ unit: { result: status } }), /RELEASE_GATE_FAILED_unit/);
  }
  assert.throws(() => execute({ database: { result: 'skipped' } }), /RELEASE_GATE_FAILED_database/);
  assert.doesNotThrow(() => execute({ database: { result: 'skipped' } }, { RUN_BACKEND_TESTS: 'false' }));
  assert.throws(() => execute({ build: { result: 'success', outputs: { digest: 'invalid' } } }), /RELEASE_DIGEST_MISSING/);
});

test('paid cloud builds require explicit CI opt-in and a configured builder', () => {
  const workflow = yaml.safeLoad(fs.readFileSync(new URL('../.github/workflows/release-validation.yml', import.meta.url), 'utf8'));
  const gate = workflow.jobs.build.steps.find(step => step.id === 'docker-cloud');
  assert.ok(gate.if.includes("vars.DOCKER_BUILD_CLOUD_ENABLED == 'true'"));
  assert.ok(gate.if.includes("github.ref == 'refs/heads/main'"));
  assert.ok(gate.if.includes("github.event_name == 'push'"));
  assert.ok(gate.run.includes('DOCKER_CLOUD_BUILDER'));
  const cloud = workflow.jobs.build.steps.find(step => step.name === 'Set up Docker Build Cloud');
  assert.equal(cloud.with.endpoint, '${{ vars.DOCKER_CLOUD_BUILDER }}');
});

test('modified release workflow JavaScript parses without executing deployments', () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const name of ['pages-static', 'publish-candidate', 'apps-script-sync', 'apps-script-deploy',
    'release-validation', 'release-database']) {
    const workflow = yaml.safeLoad(fs.readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
    for (const job of Object.values(workflow.jobs)) for (const step of job.steps || []) {
      if (step.uses?.startsWith('actions/github-script@')) {
        assert.doesNotThrow(() => new AsyncFunction(step.with.script), `${name}: ${step.name}`);
      }
      for (const [, source] of (step.run || '').matchAll(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/g)) {
        assert.doesNotThrow(() => parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), `${name}: ${step.name}`);
      }
    }
  }
});
