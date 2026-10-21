import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const lifecycle = readFileSync(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');
const alpha = readFileSync(new URL('../components/command-center/fieldCommandCenter.jsx', import.meta.url), 'utf8');
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
function recoveryHarness({ storageBlocked = false, offline = false, href = 'https://app.test/?view=home', storage = new Map() } = {}) {
  const events = [];
  const root = {
    AbortController, document: { addEventListener() {} }, addEventListener() {},
    navigator: { onLine: !offline, serviceWorker: { getRegistrations: async () => [
      { scope: 'https://app.test/', active: { scriptURL: 'https://app.test/sw.js?v=old' }, unregister: async () => events.push('unregister') },
      { scope: 'https://app.test/other/', active: { scriptURL: 'https://app.test/other/sw.js' }, unregister: async () => assert.fail('unrelated worker removed') },
    ] } },
    caches: { keys: async () => ['ag-data-v4.3-rebuild-old-shell', 'ag-data-v4.3-rebuild-old-assets', 'unrelated-cache'], delete: async key => events.push(`delete:${key}`) },
    sessionStorage: { getItem: key => { if (storageBlocked) throw new Error('blocked'); return storage.get(key); }, setItem: (key, value) => { if (storageBlocked) throw new Error('blocked'); storage.set(key, value); } },
    // Recovery must not remove credentials, saved requests, or unsent photos.
    indexedDB: { deleteDatabase() { assert.fail('draft storage deleted'); } },
    localStorage: { clear() { assert.fail('credentials deleted'); } },
    location: { href, reload: force => events.push(['reload', force]), replace: url => events.push(['replace', url]) },
    history: { state: {}, replaceState: (_state, _title, url) => { root.location.href = url; events.push('url'); } },
  };
  vm.runInNewContext(lifecycle, { window: root, URL, Date, Promise });
  return { root, events, storage };
}

test('semantic release recovery accepts legacy-to-semantic and semantic patch upgrades', async () => {
  for (const from of ['V2026.10.14.003', 'AgData v2.0.0']) {
    const h = recoveryHarness();
    assert.equal(await h.root.recoverShellVersionMismatch(from, 'AgData v2.0.1'), true);
    assert.equal(new URL(h.root.location.href).searchParams.get('shellv'), 'AgData v2.0.1');
    const next = recoveryHarness({ storage: h.storage, href: h.root.location.href });
    assert.equal(await next.root.recoverShellVersionMismatch(from, 'AgData v2.0.1'), false);
  }
});

test('verified shell mismatch unregisters and clears assets before a single cache-busted hard reload', async () => {
  const h = recoveryHarness();
  const first = h.root.recoverShellVersionMismatch('V2026.10.01.002', 'V2026.10.01.003');
  const duplicate = h.root.recoverShellVersionMismatch('V2026.10.01.002', 'V2026.10.01.003');
  assert.equal(await duplicate, false, 'an in-flight recovery suppresses a second reload');
  assert.equal(await first, true);
  assert.deepEqual(h.events, ['unregister', 'delete:ag-data-v4.3-rebuild-old-shell', 'delete:ag-data-v4.3-rebuild-old-assets', 'url', ['reload', true]]);
  const url = new URL(h.root.location.href);
  assert.equal(url.searchParams.get('shellv'), 'V2026.10.01.003');
  assert.equal(url.searchParams.get('view'), 'home');
  assert.ok(url.searchParams.get('shellts'));
  const next = recoveryHarness({ storage: h.storage, href: h.root.location.href });
  assert.equal(await next.root.recoverShellVersionMismatch('V2026.10.01.002', 'V2026.10.01.003'), false);
  assert.deepEqual(next.events, []);
});

test('offline, equal versions, and invalid versions never clear caches; blocked storage cannot create a reload loop', async () => {
  for (const [options, from, to] of [[{ offline: true }, 'V2026.10.01.002', 'V2026.10.01.003'], [{}, 'V2026.10.01.003', 'V2026.10.01.003'], [{}, 'V2026.10.01.002', 'invalid']]) {
    const h = recoveryHarness(options);
    assert.equal(await h.root.recoverShellVersionMismatch(from, to), false);
    assert.deepEqual(h.events, []);
  }
  const h = recoveryHarness({ storageBlocked: true });
  assert.equal(await h.root.recoverShellVersionMismatch('V2026.10.01.002', 'V2026.10.01.003'), true);
  const next = recoveryHarness({ storageBlocked: true, href: h.root.location.href });
  assert.equal(await next.root.recoverShellVersionMismatch('V2026.10.01.002', 'V2026.10.01.003'), false);
});

test('runtime and pre-runtime shell mismatch paths use the same recovery without deleting field drafts', () => {
  assert.match(section(html, 'async function forceShellBuildReload(', 'async function maybeForceLatestStandaloneShell('), /return window\.recoverShellVersionMismatch\(APP_SHELL_BUILD, safeTargetBuild\)/);
  assert.match(section(html, 'const reloadToShellBuild =', 'const requestWaitingShellActivation ='), /window\.recoverShellVersionMismatch\(shellBuild, safeTargetBuild\)/);
  assert.doesNotMatch(section(html, 'async function recoverStandaloneShellController(', 'async function fetchLatestShellManifestInfo('), /clearBootCacheForShellUpdate\(true\)/);
});

test('iOS shell comparison uses canonical version text rather than CSS-transformed innerText', () => {
  const versionElement = { innerText: 'AGDATA V2.0.0', textContent: 'AgData v2.0.0' };
  const context = vm.createContext({
    APP_SHELL_BUILD: 'AgData v2.0.0', APP_SHELL_VERSION: 'AgData v2.0.0',
    document: { getElementById: id => id === 'header-version' ? versionElement : null },
    window: { __APP_SHELL_VERSION__: 'AgData v2.0.0', __APP_SHELL_BUILD__: 'AgData v2.0.0' },
    getCurrentShellUrlBuild: () => 'AgData v2.0.0', getStoredTargetShellBuild: () => '',
  });
  vm.runInContext(`${section(html, 'function getDisplayedShellBuild()', 'function getIosRuntimeShellMismatchReason()')}\n${section(html, 'function getIosRuntimeShellMismatchReason()', 'function getIosRuntimeRecoveryRecord()')}`, context);
  assert.equal(context.getDisplayedShellBuild(), 'AgData v2.0.0');
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
    window: {}, tryNativeAuthPasswordLogin: async () => { throw Object.assign(new Error('service unavailable'), { status: 503 }); },
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
