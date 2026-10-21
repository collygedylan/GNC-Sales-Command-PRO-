import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const lifecycle = readFileSync(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');
const html = readComposedAppSource();
const oldBuild = 'V2026.10.12.001';
const newBuild = 'V2026.10.12.002';

test('semantic release activation preserves session and drafts while invalidating obsolete filters', () => {
  const h = harness();
  h.root.localStorage.setItem('gnc_app_filter_state_v1:rep_one', 'old');
  h.root.localStorage.setItem('gnc_supabase_auth_v1', 'session');
  h.root.localStorage.setItem('draft-request', 'unsent');
  assert.equal(h.root.invalidateAppFiltersForVersion('AgData v2.0.0'), true);
  assert.equal(h.root.localStorage.getItem('gnc_app_filter_state_v1:rep_one'), null);
  assert.equal(h.root.localStorage.getItem('gnc_supabase_auth_v1'), 'session');
  assert.equal(h.root.localStorage.getItem('draft-request'), 'unsent');
  for (const value of ['AgData v02.0.0', 'AgData v2.0', 'AgData v2.0.0.extra']) {
    assert.equal(h.root.invalidateAppFiltersForVersion(value), false);
  }
  h.root.reloadForServiceWorkerUpdate('AgData v2.0.1');
  h.timers.shift()();
  assert.equal(new URL(h.reloads[0]).searchParams.get('shellv'), 'AgData v2.0.1');
});

function storage(entries = []) {
  const values = new Map(entries);
  return {
    values,
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function harness() {
  const timers = [], toasts = [], reloads = [];
  const root = {
    AbortController, document: { addEventListener() {} }, addEventListener() {},
    localStorage: storage(), sessionStorage: storage(),
    __APP_SHELL_VERSION__: oldBuild,
    setTimeout: callback => { timers.push(callback); return timers.length; },
    showToast: (...args) => toasts.push(args),
    indexedDB: { deleteDatabase() { assert.fail('offline data must survive an update'); } },
    location: { href: 'https://app.test/?view=request', reload: () => reloads.push(root.location.href) },
    history: { state: {}, replaceState: (_state, _title, url) => { root.location.href = url; } },
  };
  const context = vm.createContext({ window: root, AbortController, URL, Date, Promise });
  vm.runInContext(lifecycle, context);
  return { root, context, timers, toasts, reloads };
}

test('version bumps purge only filter snapshots in both local and session storage', () => {
  const h = harness();
  for (const store of [h.root.localStorage, h.root.sessionStorage]) {
    store.setItem('gnc_app_filter_version_v1', oldBuild);
    store.setItem('gnc_app_filter_state_v1:rep_one', '{"ghost":true}');
    store.setItem('gnc_app_filter_state_v1:admin', '{"ghost":true}');
    store.setItem('gnc_user_v3', 'rep_one');
    store.setItem('gnc_last_theme_v1', 'dark');
    store.setItem('draft-request', 'unsent');
  }
  assert.equal(h.root.invalidateAppFiltersForVersion(newBuild), true);
  for (const store of [h.root.localStorage, h.root.sessionStorage]) {
    assert.equal(store.getItem('gnc_app_filter_state_v1:rep_one'), null);
    assert.equal(store.getItem('gnc_app_filter_state_v1:admin'), null);
    assert.equal(store.getItem('gnc_app_filter_version_v1'), newBuild);
    assert.equal(store.getItem('gnc_user_v3'), 'rep_one');
    assert.equal(store.getItem('gnc_last_theme_v1'), 'dark');
    assert.equal(store.getItem('draft-request'), 'unsent');
    store.setItem('gnc_app_filter_state_v1:rep_one', '{"current":true}');
  }
  h.root.invalidateAppFiltersForVersion(newBuild);
  assert.equal(h.root.localStorage.getItem('gnc_app_filter_state_v1:rep_one'), '{"current":true}');
  assert.equal(h.root.sessionStorage.getItem('gnc_app_filter_state_v1:rep_one'), '{"current":true}');
});

test('legacy unversioned filters reset once and invalid versions do not clear storage', () => {
  const h = harness();
  h.root.localStorage.setItem('gnc_app_filter_state_v1:rep_one', 'legacy');
  assert.equal(h.root.invalidateAppFiltersForVersion('not-a-version'), false);
  assert.equal(h.root.localStorage.getItem('gnc_app_filter_state_v1:rep_one'), 'legacy');
  h.root.invalidateAppFiltersForVersion(newBuild);
  assert.equal(h.root.localStorage.getItem('gnc_app_filter_state_v1:rep_one'), null);
});

test('one short toast precedes one reload using the active worker version reply', () => {
  const h = harness();
  h.root.localStorage.setItem('gnc_app_filter_version_v1', oldBuild);
  h.root.localStorage.setItem('gnc_app_filter_state_v1:rep_one', 'old');
  assert.equal(h.root.reloadForServiceWorkerUpdate(), true);
  assert.equal(h.root.reloadForServiceWorkerUpdate(newBuild), false);
  assert.equal(h.timers.length, 1);
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0][1], /New version detected\. Updating/);
  assert.equal(h.reloads.length, 0);
  h.timers.shift()();
  assert.equal(h.reloads.length, 1);
  const next = new URL(h.reloads[0]);
  assert.equal(next.searchParams.get('shellv'), newBuild);
  assert.equal(next.searchParams.get('view'), 'request');
  assert.equal(h.root.localStorage.getItem('gnc_app_filter_state_v1:rep_one'), null);
});

test('blocked filter storage still permits a single automatic reload', () => {
  const h = harness();
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(h.root, name, { get() { throw new Error('storage blocked'); } });
  }
  h.root.reloadForServiceWorkerUpdate(newBuild);
  assert.doesNotThrow(() => h.timers.shift()());
  assert.equal(h.reloads.length, 1);
});

test('waiting-state toast and standalone recovery cannot duplicate an automatic update', async () => {
  const h = harness();
  h.root.__gncShellUpdateToastShown = true;
  h.root.reloadForServiceWorkerUpdate(newBuild);
  assert.equal(h.toasts.length, 0);
  assert.equal(await h.root.recoverShellVersionMismatch(oldBuild, newBuild), false);
  assert.equal(h.timers.length, 1);
});

test('the live controller listener ignores first claim, then requests the active worker version and reloads', () => {
  const h = harness();
  let listener;
  const messages = [];
  h.context.navigator = { serviceWorker: {
    controller: { postMessage: data => messages.push(data) },
    addEventListener: (_name, callback) => { listener = callback; },
  } };
  const start = html.indexOf("navigator.serviceWorker.addEventListener('controllerchange',");
  const end = html.indexOf("document.addEventListener('visibilitychange',", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(`let shellControllerObserved = false; ${html.slice(start, end)}`, h.context);
  listener();
  assert.equal(h.timers.length, 0);
  listener();
  listener();
  assert.equal(h.timers.length, 1);
  assert.equal(messages[0].type, 'GNC_GET_SHELL_VERSION');
});

test('pagehide filter persistence cannot recreate stale filters during an update reload', () => {
  const start = html.indexOf('function persistAppFilterStateNow()');
  const end = html.indexOf('function schedulePersistAppFilterState(', start);
  const context = vm.createContext({ window: { __gncPwaReloadPending: true } });
  vm.runInContext(html.slice(start, end), context);
  assert.equal(context.persistAppFilterStateNow(), false);
});
