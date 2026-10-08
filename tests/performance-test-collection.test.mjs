// @test-group: foundation
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packageBin, repoRoot, runNode } from '../scripts/tooling-process.mjs';

test('database and timing discovery do not require compiled deferred-view artifacts', t => {
  const emptySite = mkdtempSync(path.join(os.tmpdir(), 'gnc-playwright-collection-'));
  t.after(() => rmdirSync(emptySite));
  const env = {
    CI: 'true',
    GNC_LOCAL_SITE_DIR: emptySite,
    // Collection only: no server, browser, or database connection is started.
    SUPABASE_LOCAL_URL: 'http://127.0.0.1:54321',
    SUPABASE_LOCAL_ANON_KEY: 'collection-only',
    SUPABASE_LOCAL_SERVICE_ROLE_KEY: 'collection-only',
  };
  const list = config => runNode([
    packageBin('@playwright/test', 'playwright'), 'test', '--config', config,
    '--list', '--project=chromium', '--reporter=list',
  ], { env, capture: true });

  const database = list('playwright.database.config.ts');
  assert.match(database, /Total: [1-9]\d* tests? in/);
  assert.doesNotMatch(database, /v2-deferred-views\.e2e\.spec\.ts/);

  const timing = list('playwright.release-timing.config.ts');
  const deferred = timing.split('\n').filter(line => line.includes('v2-deferred-views.e2e.spec.ts:'));
  assert.equal(deferred.length, 4, 'all compiled deferred-view assertions remain assigned to the timing suite');
  assert.match(timing, /compiled Que and Drive chunks load only on route entry/);
  assert.match(timing, /a failed Queue chunk can recover/);
  assert.match(timing, /a failed Que boundary does not poison/);
  assert.match(timing, /Que stays within phone and tablet geometry/);
});

test('executing deferred-view checks still fails when the compiled manifest is absent', t => {
  const emptySite = mkdtempSync(path.join(os.tmpdir(), 'gnc-playwright-missing-artifact-'));
  const config = path.join(emptySite, 'playwright.config.mjs');
  t.after(() => {
    const target = realpathSync(emptySite);
    assert.equal(path.dirname(target), realpathSync(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('gnc-playwright-missing-artifact-'));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(config, `export default ${JSON.stringify({
    testDir: path.join(repoRoot, 'tests'),
    testMatch: '**/v2-deferred-views.e2e.spec.ts',
    outputDir: path.join(emptySite, 'results'),
    workers: 1,
    retries: 0,
    reporter: 'list',
  })};\n`);
  assert.throws(() => runNode([
    packageBin('@playwright/test', 'playwright'), 'test', '--config', config,
    '--grep', 'compiled Que and Drive chunks',
  ], { env: { CI: '', GNC_LOCAL_SITE_DIR: emptySite }, capture: true }), /ENOENT[^\n]*manifest\.json/);
});
