// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { installPerformanceFixture } from '../scripts/performance-browser-fixture.mjs';

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
  const move = pair.indexOf('renameSync(source, saved)');
  const restore = pair.indexOf('for (const relative of moved)', pair.indexOf('} finally {', pair.indexOf('const baseline = await measure')));
  assert.ok(verify >= 0 && archive > verify && move > archive && restore > move);
  assert.match(pair, /PERFORMANCE_API_PAIR_CLOUD_ONLY/);
  assert.match(pair, /inspectDisposableSupabaseWorkspace/);
  assert.match(pair, /new URL\(values\.API_URL\)/);
  assert.match(pair, /127\.0\.0\.1.*localhost.*\[::1\]/s);
  assert.match(pair, /PERFORMANCE_LOCAL_AUTH_ENV_REQUIRED/);
  assert.match(pair, /removeOwnedTemporaryDirectory\(\)/);
  assert.match(pair, /renameSync\(path\.join\(backup, relative\), target\)/);
  assert.match(pair, /if \(error\.code !== 'ESRCH'\) throw error/);
  assert.match(pair, /try \{ await stopServer\(\); \}\s+finally \{\s+for \(const relative of moved\)/);
});

test('V2 performance fixture blocks non-fixture external requests and uses only a projected synthetic inventory route', async () => {
  const routes = [];
  const page = {
    route: async (pattern, handler) => { routes.push({ pattern, handler }); },
    goto: async path => assert.equal(path, '/v2/#home'),
    locator: () => ({ waitFor: async () => {} })
  };
  await installPerformanceFixture(page, 'http://127.0.0.1:43210', 'v2');
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
