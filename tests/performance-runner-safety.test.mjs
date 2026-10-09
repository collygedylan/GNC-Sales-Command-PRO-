// @test-group: foundation
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installPerformanceFixture } from '../scripts/performance-browser-fixture.mjs';
import {
  PERFORMANCE_API_SOURCE_DIRECTORIES,
  restorePerformanceApiSources,
  stagePerformanceApiSources,
  validatePerformanceApiRoots,
} from '../scripts/performance-api-source-snapshots.mjs';

const source = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('historical browser build uses an immutable pinned archive in its own verified output directory', () => {
  const build = source('../scripts/build-performance-baseline.mjs');
  assert.match(build, /PERFORMANCE_BASELINE_BUILD_CLOUD_ONLY/);
  assert.match(build, /const directory = path\.join\(repoRoot, '\.gnc-local', `performance-baseline-/);
  assert.match(build, /manifest\.baselineCommit/);
  assert.match(build, /git', \['archive', '--format=tar', manifest\.baselineCommit\]/);
  assert.match(build, /run\('npm', \['run', command\], \{ root: directory, env \}\)/);
  assert.match(build, /verifyReleaseArtifact\(site/);
  assert.doesNotMatch(build, /git', \['checkout'|reset --hard/);
});

test('API pair requires a verified disposable workspace and restores moved candidate sources in finally', () => {
  const pair = source('../scripts/run-performance-api.mjs');
  const verify = pair.indexOf('inspectDisposableSupabaseWorkspace({ workspaceRoot: process.argv[2], cli })');
  const archive = pair.indexOf("run('git', ['archive', '--format=tar'");
  const stage = pair.indexOf('stagePerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repoRoot, candidateRoot: backup })');
  const restore = pair.indexOf('restorePerformanceApiSources(candidateSnapshot)');
  assert.ok(verify >= 0 && archive > verify && stage > archive && restore > stage);
  assert.match(pair, /PERFORMANCE_API_PAIR_CLOUD_ONLY/);
  assert.match(pair, /inspectDisposableSupabaseWorkspace/);
  assert.match(pair, /'functions', 'serve'/);
  assert.match(pair, /const logPath = path\.join\(temp, `function-server-pass-\$\{passIndex\}\.log`\)/);
  assert.match(pair, /stdio: \['ignore', logFd, logFd\]/);
  assert.match(pair, /env: \{ \.\.\.process\.env, SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr\.io' \}/,
    'functions serve uses the pinned CLI-supported registry override only in its child environment');
  assert.doesNotMatch(pair, /process\.env\.SUPABASE_INTERNAL_IMAGE_REGISTRY\s*=/,
    'the parent environment (and the already-running stack) is unchanged');
  assert.match(pair, /finally \{ closeFunctionServerLog\(logFd\); \}/);
  assert.match(pair, /getFunctionServerFailureDiagnostics\(\{/);
  assert.match(pair, /server\.signalCode !== null/);
  assert.match(pair, /new URL\(values\.API_URL\)/);
  assert.match(pair, /127\.0\.0\.1.*localhost.*\[::1\]/s);
  assert.match(pair, /PERFORMANCE_LOCAL_AUTH_ENV_REQUIRED/);
  assert.match(pair, /removeOwnedTemporaryDirectory\(\)/);
  assert.match(pair, /if \(error\.code !== 'ESRCH'\) throw error/);
  assert.match(pair, /if \(candidateSnapshot\) restorePerformanceApiSources\(candidateSnapshot\);\s+removeOwnedTemporaryDirectory\(\);/);
  assert.doesNotMatch(pair, /rmSync\(temp, \{ recursive: true, force: true \}\)/);
});

test('API source roots reject overlap before any source tree is copied or removed', t => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-performance-api-root-guard-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const workspace = path.join(fixtureRoot, 'workspace');
  const repository = path.join(fixtureRoot, 'repository');
  const candidate = path.join(fixtureRoot, 'candidate');
  mkdirSync(workspace);
  mkdirSync(repository);
  writeFileSync(path.join(repository, 'must-survive.txt'), 'repository');

  assert.throws(
    () => validatePerformanceApiRoots({ workspaceRoot: workspace, repositoryRoot: repository, candidateRoot: path.join(repository, 'candidate') }),
    { message: 'PERFORMANCE_SOURCE_ROOT_INVALID' },
  );
  assert.throws(
    () => validatePerformanceApiRoots({ workspaceRoot: workspace, repositoryRoot: repository, candidateRoot: fixtureRoot }),
    { message: 'PERFORMANCE_SOURCE_ROOT_INVALID' },
  );
  assert.throws(
    () => stagePerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repository, candidateRoot: path.join(workspace, 'candidate') }),
    { message: 'PERFORMANCE_SOURCE_ROOT_INVALID' },
  );
  assert.equal(readFileSync(path.join(repository, 'must-survive.txt'), 'utf8'), 'repository');
  assert.deepEqual(readdirSync(repository), ['must-survive.txt']);
});

test('API source roots reject a workspace reached through a directory junction', t => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-performance-api-junction-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const realWorkspace = path.join(fixtureRoot, 'real-workspace');
  const workspaceJunction = path.join(fixtureRoot, 'workspace-link');
  const repository = path.join(fixtureRoot, 'repository');
  const candidate = path.join(fixtureRoot, 'candidate');
  mkdirSync(realWorkspace);
  mkdirSync(repository);
  symlinkSync(realWorkspace, workspaceJunction, 'junction');

  assert.throws(
    () => validatePerformanceApiRoots({ workspaceRoot: workspaceJunction, repositoryRoot: repository, candidateRoot: candidate }),
    { message: 'PERFORMANCE_SOURCE_PATH_UNSAFE' },
  );
});

test('API source staging rejects a junction in a source target ancestor', t => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-performance-api-child-junction-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const workspace = path.join(fixtureRoot, 'workspace');
  const repository = path.join(fixtureRoot, 'repository');
  const candidate = path.join(fixtureRoot, 'candidate');
  const externalTarget = path.join(fixtureRoot, 'external-supabase');
  mkdirSync(path.join(workspace, 'supabase'), { recursive: true });
  mkdirSync(repository);
  mkdirSync(externalTarget);
  writeFileSync(path.join(externalTarget, 'preserve.txt'), 'outside workspace');
  rmSync(path.join(workspace, 'supabase'), { recursive: true });
  symlinkSync(externalTarget, path.join(workspace, 'supabase'), 'junction');

  assert.throws(
    () => stagePerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repository, candidateRoot: candidate }),
    { message: 'PERFORMANCE_SOURCE_PATH_UNSAFE' },
  );
  assert.equal(readFileSync(path.join(externalTarget, 'preserve.txt'), 'utf8'), 'outside workspace');
  assert.equal(existsSync(candidate), false);
});

test('API source staging supports an empty canonical workspace and restores historical source directories', t => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-performance-api-snapshot-test-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const workspace = path.join(fixtureRoot, 'gnc-db-workspace-test');
  const repository = path.join(fixtureRoot, 'repo');
  const candidateRoot = path.join(fixtureRoot, 'candidate');
  mkdirSync(path.join(workspace, 'supabase'), { recursive: true });
  mkdirSync(repository, { recursive: true });
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
    const repoDirectory = path.join(repository, relative);
    mkdirSync(repoDirectory, { recursive: true });
    writeFileSync(path.join(repoDirectory, 'candidate-marker.txt'), relative);
  }

  const canonicalSnapshot = stagePerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repository, candidateRoot });
  assert.deepEqual(canonicalSnapshot.originallyPresent, []);
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
    assert.equal(readFileSync(path.join(candidateRoot, relative, 'candidate-marker.txt'), 'utf8'), relative);
    assert.equal(existsSync(path.join(workspace, relative)), false);
    cpSync(path.join(candidateRoot, relative), path.join(workspace, relative), { recursive: true, errorOnExist: true, force: false });
  }
  restorePerformanceApiSources(canonicalSnapshot);
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) assert.equal(existsSync(path.join(workspace, relative)), false);
  assert.equal(existsSync(candidateRoot), false);

  const historicalCandidateRoot = path.join(fixtureRoot, 'historical-candidate');
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
    const historicalDirectory = path.join(workspace, relative);
    mkdirSync(historicalDirectory, { recursive: true });
    writeFileSync(path.join(historicalDirectory, 'historical-marker.txt'), relative);
  }
  const historicalSnapshot = stagePerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repository, candidateRoot: historicalCandidateRoot });
  assert.deepEqual(historicalSnapshot.originallyPresent, PERFORMANCE_API_SOURCE_DIRECTORIES);
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
    assert.equal(readFileSync(path.join(historicalCandidateRoot, relative, 'historical-marker.txt'), 'utf8'), relative);
    assert.equal(existsSync(path.join(workspace, relative)), false);
    cpSync(path.join(historicalCandidateRoot, relative), path.join(workspace, relative), { recursive: true, errorOnExist: true, force: false });
  }
  restorePerformanceApiSources(historicalSnapshot);
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
    assert.equal(readFileSync(path.join(workspace, relative, 'historical-marker.txt'), 'utf8'), relative);
  }
  assert.equal(existsSync(historicalCandidateRoot), false);
});

test('API restoration preserves parked sources when its root validation fails', t => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-performance-api-restore-guard-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const workspace = path.join(fixtureRoot, 'workspace');
  const repository = path.join(fixtureRoot, 'repository');
  const candidateRoot = path.join(fixtureRoot, 'candidate');
  mkdirSync(path.join(workspace, 'supabase'), { recursive: true });
  mkdirSync(path.join(workspace, 'services'), { recursive: true });
  mkdirSync(repository);
  writeFileSync(path.join(workspace, 'services', 'original.txt'), 'preserve');
  for (const relative of ['supabase/functions', 'utils']) mkdirSync(path.join(repository, relative), { recursive: true });

  const snapshot = stagePerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repository, candidateRoot });
  assert.throws(
    () => restorePerformanceApiSources({ ...snapshot, repository: candidateRoot }),
    { message: 'PERFORMANCE_SOURCE_ROOT_INVALID' },
  );
  assert.equal(readFileSync(path.join(candidateRoot, 'services', 'original.txt'), 'utf8'), 'preserve');
  restorePerformanceApiSources(snapshot);
  assert.equal(readFileSync(path.join(workspace, 'services', 'original.txt'), 'utf8'), 'preserve');
});

test('V2 performance fixture blocks non-fixture external requests and uses only a projected synthetic inventory route', async () => {
  const routes = [];
  const page = Object.assign(new EventEmitter(), {
    route: async (pattern, handler) => { routes.push({ pattern, handler }); },
    goto: async path => assert.equal(path, '/v2/#home'),
    locator: () => ({ waitFor: async () => {} })
  });
  const control = await installPerformanceFixture(page, 'http://127.0.0.1:43210', 'v2');
  assert.equal(typeof control.waitForApiIdle, 'function');
  assert.deepEqual(page.eventNames().sort(), ['request', 'requestfailed', 'requestfinished']);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].pattern, '**/*');
  const route = url => ({
    request: () => ({ url: () => url }),
    abort: async reason => ({ action: 'abort', reason }),
    continue: async () => ({ action: 'continue' }),
    fulfill: async options => ({ action: 'fulfill', options })
  });
  assert.deepEqual(await routes[0].handler(route('https://external.example.invalid/track')), { action: 'abort', reason: 'blockedbyclient' });
  assert.deepEqual(await routes[0].handler(route('http://127.0.0.1:43210/v2/assets/app.js')), { action: 'continue' });

  const response = await routes[0].handler(route('https://performance.supabase.co/rest/v1/ph_master_inventory?select=unique_id&offset=0&limit=1'));
  assert.equal(response.action, 'fulfill');
  assert.deepEqual(response.options.json, [{ unique_id: 'perf-00000' }]);
  assert.match(response.options.headers['content-range'], /^0-0\/1000$/);
});
