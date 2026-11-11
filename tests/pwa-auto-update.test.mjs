import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { liveUpdateFixture } from '../src/ui/live-update-fixture.mjs';

const html = readComposedAppSource();

test('release activation preserves filter state, identity and drafts', async t => {
  const h = liveUpdateFixture(); t.after(h.close);
  for (const store of [h.root.localStorage, h.root.sessionStorage]) {
    store.setItem('gnc_app_filter_state_v1:rep_one', 'saved-filter');
    store.setItem('gnc_user_v3', 'rep_one');
    store.setItem('draft-request', 'unsent');
  }
  assert.equal(h.root.invalidateAppFiltersForVersion('AgData v1.2.4'), true);
  assert.equal(await h.apply(), true);
  for (const store of [h.root.localStorage, h.root.sessionStorage]) {
    assert.equal(store.getItem('gnc_app_filter_state_v1:rep_one'), 'saved-filter');
    assert.equal(store.getItem('gnc_user_v3'), 'rep_one');
    assert.equal(store.getItem('draft-request'), 'unsent');
    assert.equal(store.getItem('gnc_app_filter_version_v1'), 'AgData v1.2.4');
  }
  assert.equal(h.checkpoints.length, 1);
  assert.equal(h.commits[0].snapshotId, 'saved-work');
  assert.equal(new URL(h.navigation[0]).searchParams.get('view'), 'request');
});

test('invalid release markers cannot invalidate or erase saved filters', t => {
  const h = liveUpdateFixture(); t.after(h.close);
  h.root.localStorage.setItem('gnc_app_filter_state_v1:rep_one', 'legacy');
  for (const value of ['not-a-version', 'AgData v02.0.0', 'AgData v2.0', 'AgData v2.0.0.extra']) {
    assert.equal(h.root.invalidateAppFiltersForVersion(value), false);
  }
  assert.equal(h.root.localStorage.getItem('gnc_app_filter_state_v1:rep_one'), 'legacy');
});

test('a verified update commits one checkpoint and navigates only once', async t => {
  const h = liveUpdateFixture(); t.after(h.close);
  assert.equal(await h.apply(), true);
  assert.equal(await h.root.GncLiveAppUpdate.requestApply('duplicate'), false);
  assert.equal(h.navigation.length, 1);
  assert.equal(new URL(h.navigation[0]).searchParams.get('shellv'), 'AgData v1.2.4');
  assert.equal(h.checkpoints.length, 1);
});

test('tapping the pill registers the target URL and reloads after the waiting worker claims control', async t => {
  const messages = [], registrations = [];
  let onMessage, onControllerChange;
  const waiting = { postMessage(message) {
    messages.push(message);
    if (message.type === 'GNC_GET_SHELL_VERSION') {
      onMessage({ source: waiting, data: { type: 'GNC_SHELL_VERSION', build: 'AgData v1.2.4' } });
    }
  } };
  const registration = { waiting };
  const serviceWorker = {
    addEventListener(type, listener) { if (type === 'message') onMessage = listener;
      if (type === 'controllerchange') onControllerChange = listener; },
    async register(url, options) { registrations.push([url, options]); return registration; }
  };
  const h = liveUpdateFixture(serviceWorker); t.after(h.close);
  await h.root.GncLiveAppUpdate.ensureRegistration();
  await h.root.GncLiveAppUpdate.request('1.2.4');
  const pill = h.root.document.getElementById('agdata-live-update-pill');
  const applied = h.tap();
  assert.match(pill.textContent, /^Applying v1\.2\.4/);
  assert.equal(await applied, true);
  assert.deepEqual(registrations.map(([url]) => url), ['./sw.js?v=1.2.3', './sw.js?v=1.2.4']);
  assert.equal(messages.find(message => message.type === 'SKIP_WAITING').snapshotId, 'saved-work');
  assert.equal(h.navigation.length, 0);
  registration.waiting = null;
  serviceWorker.controller = waiting;
  onControllerChange();
  await new Promise(setImmediate);
  assert.equal(new URL(h.navigation[0]).searchParams.get('v'), '1.2.4');
  assert.equal(h.commits.length, 1);
});

test('offline, busy and unverified downloaded shells never commit a reload', async t => {
  for (const kind of ['offline', 'busy', 'wrong-version']) {
    const h = liveUpdateFixture(); t.after(h.close);
    if (kind === 'offline') h.root.navigator.onLine = false;
    if (kind === 'busy') h.state.busy = true;
    if (kind === 'wrong-version') h.state.proof = '1.2.3';
    assert.equal(await h.apply(), false, kind);
    assert.equal(h.navigation.length, 0, kind);
    assert.equal(h.commits.length, 0, kind);
  }
});

test('failed or stale snapshots and rejected commits prevent navigation', async t => {
  for (const flag of ['snapshot', 'current', 'commit']) {
    const h = liveUpdateFixture(); t.after(h.close);
    h.state[flag] = false;
    assert.equal(await h.apply(), false, flag);
    assert.equal(h.navigation.length, 0, flag);
  }
});

test('blocked session storage defers navigation when its reload claim cannot persist', async t => {
  const h = liveUpdateFixture(); t.after(h.close);
  Object.defineProperty(h.root, 'sessionStorage', { get() { throw new Error('storage blocked'); } });
  assert.equal(await h.apply(), false);
  assert.equal(h.navigation.length, 0);
  assert.equal(h.commits.length, 0);
});

test('legacy worker and recovery entrypoints share the checkpoint-gated update owner', async t => {
  const h = liveUpdateFixture(); t.after(h.close);
  assert.equal(h.root.reloadForServiceWorkerUpdate('1.2.4'), false);
  assert.equal(await h.root.recoverShellVersionMismatch('1.2.4', '1.2.4'), true);
  assert.equal(h.navigation.length, 0);
  assert.equal(await h.tap(), true);
  assert.equal(h.navigation.length, 1);
  assert.equal(h.checkpoints.length, 1);
});

test('pagehide filter persistence cannot recreate stale filters during an update reload', () => {
  const start = html.indexOf('function persistAppFilterStateNow()');
  const end = html.indexOf('function schedulePersistAppFilterState(', start);
  const context = vm.createContext({ window: { __gncPwaReloadPending: true } });
  vm.runInContext(html.slice(start, end), context);
  assert.equal(context.persistAppFilterStateNow(), false);
});
