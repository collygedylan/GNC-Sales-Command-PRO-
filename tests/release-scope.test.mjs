import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changedReleasePaths, classifyReleasePaths, isSafePackageMetadataChange, selectReleaseRecoveryBase } from '../scripts/release-scope.mjs';
import { findLastSuccessfulDeploymentBaseline } from '../scripts/release-baseline.mjs';

test('tooling-only changes run the focused Node lane without selecting deploy or app suites', () => {
  const scope = classifyReleasePaths([
    '.github/workflows/pages-static.yml',
    'scripts/release-scope.mjs',
    'tests/release-scope.test.mjs',
  ]);
  assert.equal(scope.toolingOnly, true);
  assert.deepEqual(scope.deploy, { frontend: false, supabase: false, appsScript: false });
  assert.deepEqual(scope.validation, { frontend: false, backend: false, schema: false });
});

test('site source, Supabase, and Apps Script deploy scopes remain independent', () => {
  const scope = classifyReleasePaths([
    'src/app.tsx',
    'supabase/migrations/20261020120000_example.sql',
    'supabase/functions/app-api/index.ts',
    'Code.gs',
  ]);
  assert.equal(scope.toolingOnly, false);
  assert.deepEqual(scope.deploy, { frontend: true, supabase: true, appsScript: true });
  assert.deepEqual(scope.validation, { frontend: false, backend: false, schema: false });
});

test('Back navigation and frontend version markers publish only Pages without historical suites', () => {
  const frontendFiles = [
    'index.html', 'assets/ops-precision-pilot.css', 'assets/ops-precision-pilot.js',
    'manifest.json', 'sw.js', 'v2/src/services/api.ts', 'v2/public/manifest.webmanifest',
    'package.json', 'package-lock.json',
  ];
  // Cover individual runtime/version files as well as the complete frontend patch.
  for (const files of [...frontendFiles.map(file => [file]), [...frontendFiles,
    'scripts/build-live-shell.mjs', 'tests/release-scope.test.mjs',
    '.codex/skills/agdata-app-shell-and-navigation/SKILL.md']]) {
    const scope = classifyReleasePaths(files);
    assert.equal(scope.toolingOnly, false, files.join(', '));
    assert.deepEqual(scope.deploy, { frontend: true, supabase: false, appsScript: false });
    assert.deepEqual(scope.validation, { frontend: false, backend: false, schema: false });
    assert.deepEqual(scope.migrations, []);
    assert.deepEqual(scope.edgeFunctions, []);
  }
  assert.equal(isSafePackageMetadataChange(
    { version: '2.3.17', appsScriptRelease: 'AgData v2.2.1' },
    { version: '2.3.18', appsScriptRelease: 'AgData v2.2.1' },
  ), false, 'a frontend version bump must not be suppressed as tooling metadata');
});

test('full matrices require the explicit Nightly selection for every deployment scope', () => {
  for (const files of [['src/app.tsx'], ['supabase/functions/app-api/index.ts'], ['Code.gs'],
    ['index.html', 'supabase/migrations/new.sql'], ['tests/new.test.mjs']]) {
    assert.deepEqual(classifyReleasePaths(files).validation, { frontend: false, backend: false, schema: false });
  }
  assert.deepEqual(classifyReleasePaths(['index.html', 'supabase/migrations/new.sql'], { fullRegression: true }).validation,
    { frontend: true, backend: true, schema: true });
  assert.equal(classifyReleasePaths(['playwright.release-smoke.config.ts', 'performance/benchmark.mjs']).toolingOnly, true);
});

test('pipeline helpers and generic migration tooling do not cause deployment by path name alone', () => {
  const scope = classifyReleasePaths([
    'scripts/apply-item-low-stock-migration.mjs',
    '.github/workflows/apps-script-sync.yml',
    'tests/database-tooling.test.mjs',
  ]);
  assert.equal(scope.toolingOnly, true);
  assert.deepEqual(scope.deploy, { frontend: false, supabase: false, appsScript: false });
});

test('runtime configuration changes select Pages while Code.gs selects Apps Script only', () => {
  assert.equal(classifyReleasePaths(['manifest.json']).deploy.frontend, true);
  assert.deepEqual(classifyReleasePaths(['Code.gs']).deploy,
    { frontend: false, supabase: false, appsScript: true });
});

test('Codex, docs, validation Docker files, and approved package metadata stay tooling-only', () => {
  const scope = classifyReleasePaths(['.codex/config.toml', 'docs/upgrade.md', 'Dockerfile.validation', 'Dockerfile.validation.dockerignore',
    'docker-compose.validation.yml', 'package.json', 'package-lock.json'], { packageMetadataOnly: true });
  assert.equal(scope.toolingOnly, true);
  assert.deepEqual(scope.deploy, { frontend: false, supabase: false, appsScript: false });
  assert.equal(isSafePackageMetadataChange({ scopedValidationReceipt: { version: '2.3.13' }, scripts: { test: 'node --test' } },
    { scripts: { test: 'node --test' } }), true);
  assert.equal(isSafePackageMetadataChange({ scripts: { test: 'node --test' } },
    { scripts: { test: 'vite build' } }), false);
  assert.equal(isSafePackageMetadataChange({ dependencies: { x: '1' } },
    { dependencies: { x: '2' } }), false);
});

test('tooling-only scope skips recovery; app scope selects the older successful ancestor', () => {
  const isAncestor = (ancestor, descendant) => ancestor === 'a'.repeat(40) && descendant === 'b'.repeat(40);
  assert.equal(selectReleaseRecoveryBase({ scope: { toolingOnly: true }, manualBase: 'b'.repeat(40),
    lastSuccessfulBase: 'a'.repeat(40), isAncestor }), '');
  assert.equal(selectReleaseRecoveryBase({ scope: { toolingOnly: false }, manualBase: 'b'.repeat(40),
    lastSuccessfulBase: 'a'.repeat(40), isAncestor }), 'a'.repeat(40));
  assert.equal(selectReleaseRecoveryBase({ scope: { toolingOnly: false }, manualBase: 'b'.repeat(40),
    lastSuccessfulBase: 'c'.repeat(40), isAncestor }), 'b'.repeat(40));
  assert.equal(selectReleaseRecoveryBase({ scope: { toolingOnly: false }, manualBase: 'a'.repeat(40),
    lastSuccessfulBase: 'b'.repeat(40), isAncestor }), 'b'.repeat(40), 'already published changes must not replay');
});

test('baseline discovery ignores successful tooling coordinators without a publication job', async () => {
  const runs = [
    { id: 1, run_number: 10, path: '.github/workflows/pages-static.yml', head_branch: 'main', head_sha: 'f'.repeat(40),
      head_repository: { full_name: 'example/app' }, conclusion: 'success' },
    { id: 2, run_number: 9, path: '.github/workflows/pages-static.yml', head_branch: 'main', head_sha: 'e'.repeat(40),
      head_repository: { full_name: 'example/app' }, conclusion: 'success' },
    { id: 3, run_number: 8, path: '.github/workflows/pages-static.yml', head_branch: 'main', head_sha: 'd'.repeat(40),
      head_repository: { full_name: 'example/app' }, conclusion: 'success' },
  ];
  const jobs = new Map([[1, [{ id: 11, name: 'tooling-validation', status: 'completed', conclusion: 'success' }]],
    [2, [{ id: 21, name: 'backend-publication', head_sha: 'e'.repeat(40), status: 'completed', conclusion: 'success' }]],
    [3, [{ id: 31, name: 'deploy', head_sha: 'd'.repeat(40), status: 'completed', conclusion: 'success' }]]]);
  const api = async endpoint => {
    if (endpoint.endsWith('/actions/workflows/pages-static.yml')) return { id: 7,
      path: '.github/workflows/pages-static.yml', state: 'active' };
    if (endpoint.includes('/actions/workflows/7/runs')) return { total_count: runs.length, workflow_runs: runs };
    const id = Number(/\/actions\/runs\/(\d+)\/jobs/.exec(endpoint)?.[1]);
    if (jobs.has(id)) return { total_count: jobs.get(id).length, jobs: jobs.get(id) };
    throw new Error(`Unexpected API path ${endpoint}`);
  };
  assert.equal(await findLastSuccessfulDeploymentBaseline({ repository: 'example/app', currentRunId: 99,
    currentSha: 'a'.repeat(40), api }), 'e'.repeat(40));
  assert.equal(await findLastSuccessfulDeploymentBaseline({ repository: 'example/app', currentRunId: 99,
    currentSha: 'a'.repeat(40), api, publication: 'frontend' }), 'd'.repeat(40));
  assert.equal(await findLastSuccessfulDeploymentBaseline({ repository: 'example/app', currentRunId: 99,
    currentSha: 'a'.repeat(40), api, publication: 'backend' }), 'e'.repeat(40));
});

test('Pages baseline discovery never short-circuits to the supplied parent before consulting publications', () => {
  const source = fs.readFileSync(new URL('../scripts/release-baseline.mjs', import.meta.url), 'utf8');
  assert.match(source, /findLastSuccessfulDeploymentBaseline/);
  assert.doesNotMatch(source, /MANUAL_BASE|manualBase\s*\|\|/);
});

test('baseline stops at the newest publication without crossing GitHub filtered-run search limits', async () => {
  const calls = [];
  const runs = Array.from({ length: 100 }, (_, index) => ({
    id: 200 - index, run_number: 200 - index, path: '.github/workflows/pages-static.yml',
    head_branch: 'main', head_sha: (index === 1 ? 'b' : 'c').repeat(40),
    head_repository: { full_name: 'example/app' }, conclusion: 'success',
  }));
  const api = async endpoint => {
    calls.push(endpoint);
    if (endpoint.endsWith('/actions/workflows/pages-static.yml')) return {
      id: 7, path: '.github/workflows/pages-static.yml', state: 'active',
    };
    if (endpoint.includes('/actions/workflows/7/runs')) {
      const query = new URLSearchParams(endpoint.split('?')[1]);
      assert.equal(query.get('status'), 'success');
      assert.equal(query.get('page'), null, 'a verified newest publication must not require older pages');
      return { total_count: 1112, workflow_runs: runs };
    }
    if (endpoint.includes('/actions/runs/200/jobs')) return { total_count: 0, jobs: [] };
    assert.match(endpoint, /\/actions\/runs\/199\/jobs/);
    return { total_count: 1, jobs: [{ id: 1, status: 'completed', conclusion: 'success',
      name: 'deploy', head_sha: 'b'.repeat(40) }] };
  };
  assert.equal(await findLastSuccessfulDeploymentBaseline({ repository: 'example/app', currentRunId: 99,
    currentSha: 'a'.repeat(40), api }), 'b'.repeat(40));
  assert.equal(calls.length, 4);
});

test('changed paths use the complete before-to-after commit range', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnc-release-scope-'));
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, stdio: 'ignore' });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release scope fixture');
    git('config', 'user.email', 'release-scope@example.invalid');
    fs.writeFileSync(path.join(rootDir, 'README.md'), 'base\n');
    git('add', '.');
    git('commit', '-m', 'base');
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
    fs.mkdirSync(path.join(rootDir, 'supabase', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'supabase', 'migrations', 'change.sql'), 'select 1;\n');
    fs.writeFileSync(path.join(rootDir, 'src.ts'), 'changed\n');
    git('add', '.');
    git('commit', '-m', 'multiple files');
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
    assert.deepEqual(changedReleasePaths({ rootDir, before, after }), ['src.ts', 'supabase/migrations/change.sql']);
    assert.throws(() => changedReleasePaths({ rootDir, before: '0'.repeat(40), after }),
      /RELEASE_SCOPE_COMPARISON_FAILED/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});


test('type-only schema reconciliation does not redeploy unrelated Edge Functions', () => {
  const scope = classifyReleasePaths(['supabase/functions/_shared/database.types.ts','services/database-contracts.generated.ts','supabase/functions/app-api/index.ts']);
  assert.deepEqual(scope.edgeFunctions,['app-api']);
  assert.equal(scope.deploy.supabase,true);
});

test('exclusive core and secondary ERP sync shared modules deploy only app-api while other shared changes remain global', () => {
  const erp = classifyReleasePaths(['supabase/functions/_shared/erp-sync.mjs', 'supabase/functions/_shared/erp-sync.d.mts',
    'supabase/functions/_shared/erp-secondary-sync.mjs', 'supabase/functions/_shared/erp-secondary-sync.d.mts']);
  assert.deepEqual(erp.edgeFunctions, ['app-api']);
  assert.equal(erp.deploy.supabase, true);
  assert.deepEqual(classifyReleasePaths(['supabase/functions/_shared/erp-secondary-sync.mjs']).edgeFunctions, ['app-api']);
  assert.deepEqual(classifyReleasePaths(['supabase/functions/_shared/erp-secondary-sync.d.mts']).edgeFunctions, ['app-api']);
  assert.deepEqual(classifyReleasePaths(['supabase/functions/_shared/canonical-user-access.ts']).edgeFunctions, ['*']);
  assert.deepEqual(classifyReleasePaths(['supabase/functions/_shared/erp-sync.mjs', 'supabase/config.toml']).edgeFunctions, ['*']);
  assert.deepEqual(classifyReleasePaths(['supabase/functions/_shared/erp-sync.mjs', 'supabase/functions/aura-query/index.ts']).edgeFunctions, ['app-api', 'aura-query']);
  assert.deepEqual(classifyReleasePaths(['supabase/functions/_shared/erp-sync.d.mts', 'supabase/functions/_shared/database.types.ts']).edgeFunctions, ['app-api']);
});
