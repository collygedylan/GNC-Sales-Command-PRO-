import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRelease } from '../../scripts/deployment-fingerprint-lib.mjs';

export function registerReleaseIdentityTest({ html, manifest, serviceWorker, packageJson, liveShellBuild }) {
test('release identifiers are synchronized', () => {
  const release = normalizeRelease(`V${packageJson.version}`);
  assert.ok(release);
  assert.match(html, new RegExp(release.replaceAll('.', '\\.')));
  assert.equal(manifest.version, release);
  assert.equal(new URL(manifest.start_url, 'https://example.test').searchParams.get('shellv'), release);
  assert.match(serviceWorker, new RegExp(`APP_SHELL_BUILD = '${release.replaceAll('.', '\\.')}'`));
  assert.equal(packageJson.version, release.replace(/^(?:AgData v|V)/, ''));
  assert.ok(liveShellBuild.includes(`const RELEASE = '${release}'`));
});

}
