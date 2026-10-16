import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareReleaseVersion } from '../scripts/prepare-release-version.mjs';
import { normalizeRelease, buildDeploymentFingerprint, verifyDeploymentFingerprint } from '../scripts/deployment-fingerprint-lib.mjs';
import { releaseMarkerOnly } from '../scripts/select-focused-tests.mjs';

test('AgData semantic release identifiers are canonical and retain historical fingerprint compatibility', () => {
  for (const value of ['AgData v2.0.0', 'agdata V2.0.0', 'V2.0.0']) assert.equal(normalizeRelease(value), 'AgData v2.0.0');
  for (const value of ['AgData v02.0.0', 'AgData v2.00.0', 'AgData v2.0', 'AgData v2.0.0.extra', '2.0.0']) assert.equal(normalizeRelease(value), '');
  assert.equal(normalizeRelease('v2026.10.14.003'), 'V2026.10.14.003');
  const commit = 'a'.repeat(40);
  const payload = buildDeploymentFingerprint({ release: 'AgData v2.1.3', commit });
  assert.equal(verifyDeploymentFingerprint(payload, { release: 'AgData v2.1.3', commit }).ok, true);
  assert.equal(verifyDeploymentFingerprint(payload, { release: 'AgData v2.1.4', commit }).ok, false);
});

test('release preparation synchronizes semantic app, importer and manifest markers without changing historical protocols', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnc-semver-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof contents === 'string' ? contents : JSON.stringify(contents));
  };
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const prior = 'V2026.10.14.003';
  write('package.json', { version: '2.0.0' });
  write('package-lock.json', { version: '2026.10.14.003', packages: { '': { version: '2026.10.14.003' } } });
  write('index.html', `window.__APP_RELEASE_VERSION__ = 'GNC.001'; window.__APP_SHELL_VERSION__ = '${prior}'; const protocol = 'gnc-v1'; <script src="./assets/app.js?v=${prior}"></script>`);
  write('sw.js', `const APP_SHELL_BUILD = '${prior}'; const legacy = 'V2026.09.01.01';`);
  write('manifest.json', { version: prior, start_url: `./index.html?shellv=${prior}&app=ag-data-solutions` });
  write('scripts/build-live-shell.mjs', `const RELEASE = '${prior}';`);
  write('v2/src/services/api.ts', `export const APP_VERSION = '${prior}';`);
  write('v2/public/manifest.webmanifest', { version: prior, start_url: `./?shellv=${prior}` });
  write('Code.gs', `const APP_RELEASE_VERSION_ = '${prior}'; const POLICY = 'reclass-v7';`);
  write('assets/ops-precision-pilot.js', `const RELEASE = '${prior}';`);
  assert.throws(() => prepareReleaseVersion(root, true), /MISMATCH/);
  assert.equal(prepareReleaseVersion(root), 'AgData v2.0.0');
  assert.equal(prepareReleaseVersion(root, true), 'AgData v2.0.0');
  for (const file of ['index.html', 'Code.gs', 'sw.js', 'v2/src/services/api.ts', 'assets/ops-precision-pilot.js']) assert.ok(read(file).includes('AgData v2.0.0'));
  for (const file of ['manifest.json', 'v2/public/manifest.webmanifest']) {
    const manifest = JSON.parse(read(file));
    assert.equal(manifest.version, 'AgData v2.0.0');
    assert.equal(new URL(manifest.start_url, 'https://example.test/').searchParams.get('shellv'), 'AgData v2.0.0');
    assert.ok(!manifest.start_url.includes(' '), 'manifest URL uses encoded whitespace');
  }
  assert.match(read('sw.js'), /V2026\.09\.01\.01/);
  assert.match(read('Code.gs'), /reclass-v7/);
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].version, '2.0.0');
  assert.ok(read('index.html').includes('?v=AgData%20v2.0.0'));
  assert.ok(read('index.html').includes("window.__APP_RELEASE_VERSION__ = 'AgData v2.0.0'"));
  write('package.json', { version: '2.0.1' });
  assert.equal(prepareReleaseVersion(root), 'AgData v2.0.1');
  assert.equal(prepareReleaseVersion(root, true), 'AgData v2.0.1');
  assert.ok(read('index.html').includes('?v=AgData%20v2.0.1'));
  assert.ok(!read('index.html').includes('v2.0.0'));
});

test('focused selection recognizes semantic marker changes but retains substantive changes', () => {
  assert.equal(releaseMarkerOnly('package.json', '{"version":"2.0.0"}', '{"version":"2.0.1"}'), true);
  assert.equal(releaseMarkerOnly('package.json', '{"version":"2.0.0"}', '{"version":"2.0.1","private":true}'), false);
  assert.equal(releaseMarkerOnly('index.html', "window.__APP_SHELL_VERSION__ = 'AgData v2.0.0';", "window.__APP_SHELL_VERSION__ = 'AgData v2.0.1';"), true);
});
