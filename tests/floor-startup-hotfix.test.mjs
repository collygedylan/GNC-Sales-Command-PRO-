import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
import { liveUpdateFixture } from '../src/ui/live-update-fixture.mjs';
const alpha = readFileSync(new URL('../components/command-center/fieldCommandCenter.jsx', import.meta.url), 'utf8');
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
test('semantic release recovery verifies the target before committing one snapshot reload', async t => {
  const h = liveUpdateFixture(); t.after(h.close);
  h.root.__APP_SHELL_VERSION__ = 'AgData v1.2.2';
  assert.equal(await h.root.recoverShellVersionMismatch('AgData v1.2.2', 'AgData v1.2.4'), true);
  assert.equal(h.navigation.length, 0);
  assert.equal(await h.root.GncLiveAppUpdate.requestApply('recovery'), true);
  assert.equal(h.navigation.length, 1);
  assert.equal(h.checkpoints.length, 1);
});

test('verified shell mismatch retains downloaded assets until the snapshot owner authorizes navigation', async t => {
  const h = liveUpdateFixture(); t.after(h.close);
  const deleted = [];
  h.root.caches = { delete: key => deleted.push(key) };
  h.state.current = false;
  await h.root.recoverShellVersionMismatch('AgData v1.2.4', 'AgData v1.2.4');
  assert.equal(await h.root.GncLiveAppUpdate.requestApply('stale-snapshot'), false);
  assert.equal(h.navigation.length, 0);
  h.state.current = true;
  assert.equal(await h.root.GncLiveAppUpdate.requestApply('fresh-snapshot'), true);
  assert.deepEqual(deleted, []);
  assert.equal(new URL(h.navigation[0]).searchParams.get('view'), 'request');
  assert.equal(await h.root.GncLiveAppUpdate.requestApply('duplicate'), false);
});

test('offline and blocked storage never authorize a snapshot reload', async t => {
  for (const kind of ['offline', 'storage']) {
    const h = liveUpdateFixture(); t.after(h.close);
    if (kind === 'offline') h.root.navigator.onLine = false;
    else Object.defineProperty(h.root, 'sessionStorage', { get() { throw new Error('blocked'); } });
    assert.equal(await h.apply(), false);
    assert.equal(h.navigation.length, 0);
  }
});

test('runtime and pre-runtime shell mismatch paths use the same recovery without deleting field drafts', () => {
  assert.match(section(html, 'async function forceShellBuildReload(', 'async function maybeForceLatestStandaloneShell('), /window\.requestLiveAppUpdate\?\.\(targetBuild/);
  assert.match(section(html, 'function requestWaitingShellActivation(', 'window.requestWaitingShellActivation ='), /window\.requestLiveAppUpdate\?\.\(targetBuild/);
  assert.doesNotMatch(section(html, 'async function recoverStandaloneShellController(', 'async function fetchLatestShellManifestInfo('), /clearBootCacheForShellUpdate\(true\)/);
});

test('iOS shell comparison uses canonical version text rather than CSS-transformed innerText', () => {
  const versionElement = { innerText: 'AGDATA V2.0.0', textContent: 'AgData v1.2.2' };
  const context = vm.createContext({
    APP_SHELL_BUILD: 'AgData v1.2.2', APP_SHELL_VERSION: 'AgData v1.2.2',
    document: { getElementById: id => id === 'header-version' ? versionElement : null },
    window: { __APP_SHELL_VERSION__: 'AgData v1.2.2', __APP_SHELL_BUILD__: 'AgData v1.2.2' },
    getCurrentShellUrlBuild: () => 'AgData v1.2.2', getStoredTargetShellBuild: () => '',
  });
  vm.runInContext(`${section(html, 'function getDisplayedShellBuild()', 'function getIosRuntimeShellMismatchReason()')}\n${section(html, 'function getIosRuntimeShellMismatchReason()', 'function getIosRuntimeRecoveryRecord()')}`, context);
  assert.equal(context.getDisplayedShellBuild(), 'AgData v1.2.2');
  assert.equal(context.getIosRuntimeShellMismatchReason(), '');

  versionElement.textContent = 'AgData v1.9.9';
  assert.equal(context.getIosRuntimeShellMismatchReason(), 'header:AgData v1.9.9', 'genuinely stale canonical display text remains detectable');
  assert.match(section(html, '.nav-version-pill{', '\n'), /text-transform:none/);
});

test('native aliases accept username, display spelling, and full email consistently with the server', () => {
  const context = vm.createContext({ NATIVE_AUTH_ALIAS_DOMAIN: 'greenleafnursery.com' });
  vm.runInContext(section(html, 'function normalizeNativeAuthAlias(', 'let nativeAuthSessionRead'), context);
  for (const username of ['nelly_aguilar', 'Nelly Aguilar', 'nelly-aguilar', ' NELLY_AGUILAR@greenleafnursery.com ']) {
    assert.equal(context.normalizeNativeAuthAlias(username), 'nelly_aguilar@greenleafnursery.com');
  }
  assert.equal(context.normalizeNativeAuthAlias(''), '');
});

test('native network and bridge failures are never retried against a legacy password', async () => {
  const context = vm.createContext({
    window: { withBootDeadline: async work => work }, tryNativeAuthPasswordLogin: async () => { throw Object.assign(new Error('service unavailable'), { status: 503 }); },
    ensureNativeAppSessionBridge: async () => { throw new Error('bridge offline'); },
    postAppFunctionJson: () => assert.fail('unexpected legacy login'),
  });
  vm.runInContext(section(html, 'async function fetchRemoteLoginUser(', 'function getLoginFailureMessage('), context);
  await assert.rejects(context.fetchRemoteLoginUser('nelly_aguilar', 'example'), /service unavailable/);
  context.tryNativeAuthPasswordLogin = async () => ({ user: { username: 'nelly_aguilar' } });
  await assert.rejects(context.fetchRemoteLoginUser('nelly_aguilar', 'example'), /bridge offline/);
});

test('alpha snapshot access-denial classification covers HTTP and Postgres permission failures', async () => {
  const context = vm.createContext({});
  vm.runInContext(`${section(alpha, 'const isAccessDenial =', 'const snapshotCachesByScope')}\nthis.isAccessDenial = isAccessDenial;`, context);
  for (const error of [{ status: 403 }, { code: '42501' }, { status: 401 }]) assert.equal(context.isAccessDenial(error), true);
  assert.equal(context.isAccessDenial({ status: 503 }), false);
  assert.equal(context.isAccessDenial(new Error('network failure')), false);
});
