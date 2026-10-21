// @test-group: @release-validation
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertReleaseAssetReferences, prepareReleaseSmokeSite } from '../scripts/run-release-smoke.mjs';
import { buildDeploymentFingerprint } from '../scripts/deployment-fingerprint-lib.mjs';
import { classifyReleaseSmokeRoute, isProvenReleaseSmokeReadCancellation, RELEASE_SMOKE_SUPABASE_ORIGIN } from './helpers/release-smoke-route-policy.mjs';

test('smoke runs viewport projects concurrently without overlapping cases in one profile', () => {
  const config = fs.readFileSync(new URL('../playwright.release-smoke.config.ts', import.meta.url), 'utf8');
  assert.match(config, /fullyParallel: false/);
  assert.match(config, /workers: 3/);
  assert.match(config, /retries: 0/);
  for (const project of ['desktop-chromium', 'android-chromium', 'iphone-webkit']) {
    assert.ok(config.includes(`name: '${project}'`));
  }
});

test('warm synthetic access snapshots bind the current auth epoch without bypassing the forced permission refresh case', () => {
  const spec = fs.readFileSync(new URL('./suspend-tag-completion.e2e.spec.ts', import.meta.url), 'utf8');
  const readyStates = [...spec.matchAll(/appAccessSnapshotState = \{\s*status: 'ready',[\s\S]*?snapshot: normalizeAppAccessSnapshot\(/g)];
  assert.equal(readyStates.length, 2);
  for (const [state] of readyStates) assert.match(state, /authEpoch: productionLiveSyncReadAuthEpoch/);
  assert.match(spec, /appAccessSnapshotState = \{ status: 'idle', snapshot: null,[\s\S]*?refreshNativeRoleAndCapabilities\('live-permissions'\)/);
  assert.match(spec, /expect\(accessRefresh\.legacyCacheAdopted\)\.toBe\(true\)/);
});

test('published Drive fixture bootstraps Home without opening an unrelated privileged Request tab', () => {
  const spec = fs.readFileSync(new URL('./suspend-tag-completion.e2e.spec.ts', import.meta.url), 'utf8');
  assert.match(spec, /const initialView = options\.published \? 'home' : 'request'/);
  assert.match(spec, /if \(seedView === 'request'\) \{[\s\S]*invalidateResolvedViewStateCaches\(\);[\s\S]*renderRequest\(\)/);
  assert.match(spec, /await expect\(page\.locator\('#view-' \+ initialView\)\)\.toBeVisible\(\)/);
  assert.match(spec, /fullInventory = \[\]; rebuildMasterInventoryIndexes\(\);[\s\S]*showOnlyPrimaryView\('drive'\)/,
    'the measured cold Drive case still clears master inventory before its real transition');
});

test('initial Suspend identity parity is sampled after the existing authenticated cohort settles', () => {
  const spec = fs.readFileSync(new URL('./suspend-tag-completion.e2e.spec.ts', import.meta.url), 'utf8');
  const cohort = spec.indexOf('Initial authenticated Suspend cohort did not settle');
  const count = spec.indexOf('await expect(cards).toHaveCount(37, { timeout: 15000 })');
  const parity = spec.indexOf("await info.attach('latest-suspend-source-uid-parity'");
  assert.ok(cohort > 0 && cohort < count && count < parity);
  assert.match(spec, /expect\(uidParity\.actualIds\)\.toEqual\(expectedCardIds\)/);
  assert.match(spec, /expect\.soft\(renderMs,[^\n]+\.toBeLessThanOrEqual\(2000\)/);
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

function workingTreeSite(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-working-tree-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(directory), /^smoke-working-tree-/);
    fs.rmSync(directory, { recursive: true });
  });
  const siteDir = path.join(directory, '_site');
  const commit = 'a'.repeat(40);
  const fingerprint = JSON.stringify(buildDeploymentFingerprint({ release: 'AgData v2.3.17', commit }));
  fs.mkdirSync(path.join(siteDir, 'deployments'), { recursive: true });
  fs.mkdirSync(path.join(siteDir, 'assets'));
  fs.writeFileSync(path.join(siteDir, 'deployment.json'), fingerprint);
  fs.writeFileSync(path.join(siteDir, 'deployments', `${commit}.json`), fingerprint);
  fs.writeFileSync(path.join(siteDir, 'manifest.json'), JSON.stringify({ version: 'AgData v2.3.17' }));
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<script src="assets/test.js"></script>');
  fs.writeFileSync(path.join(siteDir, 'assets/test.js'), '// current uncommitted build');
  const options = { rootDir: directory, siteDir, env: {}, getSourceDigest: () => 'b'.repeat(64),
    runGit: args => ({ status: 0, stdout: args[0] === 'rev-parse' ? 'c'.repeat(40) : ' M tests/current-work.mjs' }) };
  return { siteDir, options, commit };
}

test('working-tree smoke preflight needs no candidate commit or pre-sealed manifest', async t => {
  const { siteDir, options, commit } = workingTreeSite(t);
  const result = await prepareReleaseSmokeSite(options);
  assert.equal(result.artifact.commit, commit, 'artifact commit is build metadata, not a claim that current source is committed');
  assert.deepEqual(result.sourceIdentity, { kind: 'working-tree', digest: 'b'.repeat(64), head: 'c'.repeat(40), dirty: true });
  assert.ok(fs.existsSync(path.join(siteDir, 'release-manifest.json')));
  assert.match(result.artifact.digest, /^[a-f0-9]{64}$/);
  assert.match(result.currentSiteDigest, /^[a-f0-9]{64}$/);
});

test('working-tree smoke still rejects tampered artifact bytes and explicit expectation mismatches', async t => {
  const { siteDir, options } = workingTreeSite(t);
  await prepareReleaseSmokeSite(options);
  for (const env of [
    { EXPECTED_RELEASE_COMMIT: 'd'.repeat(40) },
    { EXPECTED_RELEASE_DIGEST: 'd'.repeat(64) },
    { RELEASE_SMOKE_SOURCE_DIGEST: 'd'.repeat(64) },
    { EXPECTED_RELEASE_COMMIT: 'invalid' },
  ]) await assert.rejects(prepareReleaseSmokeSite({ ...options, env }), /MISMATCH|MANIFEST_INVALID|EXPECTATION_INVALID/);
  fs.writeFileSync(path.join(siteDir, 'assets/test.js'), '// changed after manifest creation');
  await assert.rejects(prepareReleaseSmokeSite(options), /RELEASE_ARTIFACT_CONTENT_MISMATCH/);
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


test('aborted fixture reads and telemetry do not require exact payload or lifecycle contracts', () => {
  for (const body of [
    { action: 'inventory_read', operation: 'master_page', params: { futureReadFilter: true } },
    { action: 'dataset_read', dataset: 'future_dataset', params: { offset: 7500 } },
    { action: 'eval_work', operation: 'list', payload: { cursor: 'next-page' } },
    { action: 'health-telemetry', payload: { duration: 45 } },
  ]) assert.equal(isProvenReleaseSmokeReadCancellation({ method: 'POST',
    url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/functions/v1/app-api`, body: JSON.stringify(body), failure: 'net::ERR_ABORTED' }), true);
  assert.equal(isProvenReleaseSmokeReadCancellation({ method: 'POST',
    url: `${RELEASE_SMOKE_SUPABASE_ORIGIN}/rest/v1/rpc/report_app_health_event`, body: '{}', failure: 'AbortError' }), true);
});
