// @test-group: @release-validation
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assertReleaseAssetReferences } from '../scripts/run-release-smoke.mjs';
import { createPreindexedMasterPageFixture } from './fixtures/preindexed-master-page-fixture.mjs';
import { classifyReleaseSmokeRoute, RELEASE_SMOKE_SUPABASE_ORIGIN } from './helpers/release-smoke-route-policy.mjs';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

test('smoke runs viewport projects concurrently without overlapping cases in one profile', () => {
  const config = fs.readFileSync(new URL('../playwright.release-smoke.config.ts', import.meta.url), 'utf8');
  assert.match(config, /fullyParallel: false/);
  assert.match(config, /workers: 3/);
  assert.match(config, /retries: 0/);
  for (const project of ['desktop-chromium', 'android-chromium', 'iphone-webkit']) {
    assert.ok(config.includes(`name: '${project}'`));
  }
});

test('smoke preflight rejects incomplete support assets before launching browsers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<script src="./assets/runtime.js?v=release"></script><link href="./assets/cards.css">');
    fs.writeFileSync(path.join(root, 'assets/runtime.js'), '');
    assert.throws(() => assertReleaseAssetReferences(root), /RELEASE_SMOKE_ASSET_MISSING:.\/assets\/cards.css/);
    fs.writeFileSync(path.join(root, 'assets/cards.css'), '');
    assert.doesNotThrow(() => assertReleaseAssetReferences(root));
  } finally {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('release-assets-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('preindexed 9,487-row pages match canonical outputs under 5 ms per page', t => {
  const snapshot = JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/suspend-v2314.json.gz', import.meta.url))).toString('utf8'));
  assert.equal(snapshot.masterRows.length, 9487);
  const fixture = createPreindexedMasterPageFixture(snapshot.masterRows);
  assert.equal(fixture.rowCount, 9487);

  for (const projection of ['browse', 'full']) {
    for (let offset = 0; offset < snapshot.masterRows.length; offset += 500) {
      const request = { dataset: 'master', projection, offset, limit: 500 };
      const actual = fixture.readPage(request);
      const expected = inventoryReadFixture.readMasterPage(snapshot.masterRows, request);
      assert.deepEqual(actual, expected, `${projection} page at ${offset} must preserve exact canonical output`);
    }
  }
  for (const boundary of [
    { dataset: 'master', projection: 'browse', offset: 9487, limit: 500 },
    { dataset: 'master', projection: 'full', offset: 9500, limit: 500 },
    { dataset: 'master', projection: 'browse', offset: 9400, limit: 500 },
  ]) assert.deepEqual(fixture.readPage(boundary), inventoryReadFixture.readMasterPage(snapshot.masterRows, boundary));
  assert.throws(() => fixture.readPage({ dataset: 'master', projection: 'full', season: 'F1' }), /unexpected page parameter/);
  assert.throws(() => fixture.readPage({ dataset: 'master', projection: 'browse', offset: -1 }), /invalid page bounds/);
  const lookupId = String(snapshot.masterRows[4750].UNIQUE_ID);
  assert.deepEqual(fixture.readPage({ dataset: 'lookup', projection: 'full', offset: 0, limit: 1, uniqueId: lookupId }),
    inventoryReadFixture.readMasterPage(snapshot.masterRows, { dataset: 'lookup', projection: 'full', offset: 0, limit: 1, uniqueId: lookupId }));

  const requests = Array.from({ length: 19 }, (_, index) => ({ dataset: 'master', projection: 'browse', offset: index * 500, limit: 500 }));
  for (const request of requests) fixture.readPage(request); // warm the page/shape paths
  const elapsed = requests.flatMap(request => Array.from({ length: 20 }, () => {
    const started = performance.now();
    fixture.readPage(request);
    return performance.now() - started;
  }));
  const worst = Math.max(...elapsed);
  t.diagnostic(`PREINDEXED_PAGE_METRIC rows=9487 samples=${elapsed.length} max_ms=${worst.toFixed(3)}`);
  assert.ok(worst < 5, `worst individual page call was ${worst.toFixed(3)} ms`);
});

test('release smoke route allowlist rejects unknown API routes and mutations', () => {
  const site = 'http://127.0.0.1:43124';
  const known = classifyReleaseSmokeRoute({ method: 'POST', url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/functions/v1/app-api`, origin: site });
  assert.equal(known.allowed, true);
  assert.equal(classifyReleaseSmokeRoute({ method: 'GET', url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/rest/v1/ph_department_calendar_events`, origin: site }).allowed, true);
  assert.equal(classifyReleaseSmokeRoute({ method: 'OPTIONS', url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/functions/v1/app-api`, origin: site,
    headers: { 'access-control-request-method': 'POST' } }).allowed, true);
  assert.equal(classifyReleaseSmokeRoute({ method: 'OPTIONS', url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/functions/v1/unknown`, origin: site,
    headers: { 'access-control-request-method': 'POST' } }).allowed, false);
  for (const request of [
    { method: 'POST', url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/functions/v1/unlisted`, origin: site },
    { method: 'PATCH', url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/rest/v1/ph_department_calendar_events`, origin: site },
    { method: 'POST', url: `${site}/unlisted-mutation`, origin: site },
    { method: 'GET', url: `${site}/rest/v1/unlisted`, origin: site },
    { method: 'GET', url: `${site}/functions/v1/unlisted`, origin: site },
    { method: 'GET', url: 'https://unknown.example.test/data.json', origin: site },
  ]) assert.equal(classifyReleaseSmokeRoute(request).allowed, false, `${request.method} ${request.url} must fail closed`);
  assert.equal(classifyReleaseSmokeRoute({ method: 'GET', url: 'https://example.test/photo.jpg', origin: site,
    resourceType: 'image', fixtureImageUrls: new Set(['https://example.test/photo.jpg']) }).allowed, true);
});
