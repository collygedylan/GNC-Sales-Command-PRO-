// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(source, name, stopAt) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in shell`);
  const end = source.indexOf(stopAt, start);
  assert.ok(end > start, `${name} boundary`);
  return source.slice(start, end);
}
function fixture({ currentUser = 'dylan', online = true, nativeActive = false, coordinator = false,
  context = {}, initialTimer = null, viewTimer = null, inFlight = false } = {}) {
  const calls = { timers: [], clears: [], syncs: [] };
  const ctx = {
    ACTIVE_REQUEST_TABLE: 'ph_active_request',
    REQUEST_VIEW_SIGNATURE_SYNC_MIN_INTERVAL_MS: 1234,
    currentUser,
    navigator: { onLine: online },
    requestBadgeLiveSyncTimer: initialTimer,
    requestViewLiveSyncTimer: viewTimer,
    requestViewLiveSyncInFlight: inFlight,
    productionLiveSyncCoordinator: coordinator ? {} : null,
    canUseProductionLiveSync: () => nativeActive && !!ctx.currentUser,
    getProductionLiveSyncContext: () => context,
    clearTimeout: id => calls.clears.push(id),
    setTimeout: (callback, delay) => { const id = calls.timers.length + 1; calls.timers.push({ id, callback, delay }); return id; },
    syncAlwaysOnRequestData: (...args) => calls.syncs.push(args),
    calls
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(html, 'queueRequestBadgeLiveSync', 'function updateFooterRequestBadge('), ctx);
  return { ctx, calls };
}

function ownedAdapter() { return { id: 'core:requests', sourceKeys: ['ph_active_request'] }; }
function validContext(where = 'backgroundAdapters') {
  return { visible: true, online: true, scope: 'profile:request', dataPermissionVersion: 'perm-v1',
    adapters: [], backgroundAdapters: [], [where]: [ownedAdapter()] };
}

test('request badge source remains in the production shell and checks native coordinator ownership', () => {
  assert.match(html, /function queueRequestBadgeLiveSync\(/);
  assert.match(html, /nativeCoordinatorOwnsBadge\(\)/);
  assert.match(html, /adapter\.id === 'core:requests' && adapter\.sourceKeys\.includes\(ACTIVE_REQUEST_TABLE\)/);
});

for (const ownerLocation of ['adapters', 'backgroundAdapters']) {
  test(`native coordinator ownership in ${ownerLocation} suppresses legacy badge request`, () => {
    const f = fixture({ nativeActive: true, coordinator: true, context: validContext(ownerLocation) });
    f.ctx.queueRequestBadgeLiveSync();
    assert.equal(f.calls.timers.length, 0);
    assert.equal(f.calls.syncs.length, 0);
  });
}

test('native-looking context without a coordinator, permission source, identity, scope, permission version, visibility, or online state is not ownership', () => {
  const cases = [
    { nativeActive: true, context: validContext() },
    { nativeActive: true, coordinator: true, context: { ...validContext(), backgroundAdapters: [{ id: 'core:requests', sourceKeys: ['ph_request_history'] }] } },
    { nativeActive: true, coordinator: true, context: { ...validContext(), backgroundAdapters: [{ id: 'side:requests', sourceKeys: ['ph_active_request'] }] } },
    { nativeActive: false, coordinator: true, context: validContext() },
    { nativeActive: true, coordinator: true, currentUser: '', context: validContext() },
    { nativeActive: true, coordinator: true, context: { ...validContext(), scope: '' } },
    { nativeActive: true, coordinator: true, context: { ...validContext(), dataPermissionVersion: '' } },
    { nativeActive: true, coordinator: true, context: { ...validContext(), visible: false } },
    { nativeActive: true, coordinator: true, context: { ...validContext(), online: false } }
  ];
  for (const options of cases) {
    const f = fixture(options);
    f.ctx.queueRequestBadgeLiveSync();
    assert.equal(f.calls.timers.length, options.online === false ? 0 : options.currentUser === '' ? 0 : 1);
    assert.equal(f.calls.syncs.length, 0);
  }
});

test('Bunch Notes-only context without core requests retains the existing legacy timer', () => {
  const f = fixture({ nativeActive: true, coordinator: true, context: {
    visible: true, online: true, scope: 'profile:request', dataPermissionVersion: 'perm-v1',
    adapters: [{ id: 'side:bunchNotes', sourceKeys: ['bunch_note_private.jobs'] }], backgroundAdapters: []
  } });
  f.ctx.queueRequestBadgeLiveSync(450);
  assert.equal(f.calls.timers.length, 1);
  assert.equal(f.calls.timers[0].delay, 450);
});

test('an existing legacy timer is canceled only while the valid native queue adapter owns reads', () => {
  const owned = fixture({ nativeActive: true, coordinator: true, initialTimer: 77, context: validContext() });
  owned.ctx.queueRequestBadgeLiveSync();
  assert.deepEqual(owned.calls.clears, [77]);
  assert.equal(owned.ctx.requestBadgeLiveSyncTimer, null);
  assert.equal(owned.calls.timers.length, 0);

  const unowned = fixture({ nativeActive: true, coordinator: true, initialTimer: 77, context: { ...validContext(), backgroundAdapters: [] } });
  unowned.ctx.queueRequestBadgeLiveSync();
  assert.deepEqual(unowned.calls.clears, []);
  assert.equal(unowned.calls.timers.length, 0, 'existing timer dedupe remains intact');
});

test('a timer scheduled before coordinator ownership is gained exits at callback without a duplicate request-check', () => {
  const f = fixture({ nativeActive: true, coordinator: true, context: { ...validContext(), backgroundAdapters: [] } });
  f.ctx.queueRequestBadgeLiveSync(10);
  assert.equal(f.calls.timers.length, 1);
  f.ctx.getProductionLiveSyncContext = () => validContext();
  f.calls.timers[0].callback();
  assert.equal(f.calls.syncs.length, 0);
  assert.equal(f.ctx.requestBadgeLiveSyncTimer, null);
});

test('callback reevaluates ownership and preserves legacy behavior when ownership is absent or loses visibility', () => {
  for (const lostContext of [
    { ...validContext(), backgroundAdapters: [] },
    { ...validContext(), visible: false },
    { ...validContext(), dataPermissionVersion: '' }
  ]) {
    const unavailable = fixture({ nativeActive: true, coordinator: true, context: { ...validContext(), backgroundAdapters: [] } });
    unavailable.ctx.queueRequestBadgeLiveSync(10);
    unavailable.ctx.getProductionLiveSyncContext = () => lostContext;
    unavailable.calls.timers[0].callback();
    assert.deepEqual(JSON.parse(JSON.stringify(unavailable.calls.syncs)), [[0, { minIntervalMs: 1234, allowWhileInteractive: true }]]);
    assert.equal(unavailable.ctx.requestBadgeLiveSyncTimer, null);
  }
});

test('legacy user/offline/view timers and in-flight gating remain unchanged', () => {
  for (const options of [
    { currentUser: '', nativeActive: false },
    { online: false, nativeActive: false },
    { initialTimer: 77, nativeActive: false },
    { viewTimer: 88, nativeActive: false },
    { inFlight: true, nativeActive: false }
  ]) {
    const f = fixture(options);
    f.ctx.queueRequestBadgeLiveSync(25);
    assert.equal(f.calls.timers.length, 0);
  }
  const legacy = fixture({ nativeActive: false });
  legacy.ctx.queueRequestBadgeLiveSync(25);
  assert.equal(legacy.calls.timers[0].delay, 25);
  legacy.calls.timers[0].callback();
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.calls.syncs)), [[0, { minIntervalMs: 1234, allowWhileInteractive: true }]]);
});

test('legacy callback rechecks logout, offline state and competing request work', () => {
  for (const change of [
    ctx => { ctx.currentUser = null; },
    ctx => { ctx.navigator.onLine = false; },
    ctx => { ctx.requestViewLiveSyncTimer = 88; },
    ctx => { ctx.requestViewLiveSyncInFlight = true; }
  ]) {
    const f = fixture();
    f.ctx.queueRequestBadgeLiveSync();
    change(f.ctx);
    f.calls.timers[0].callback();
    assert.equal(f.calls.syncs.length, 0);
    assert.equal(f.ctx.requestBadgeLiveSyncTimer, null);
  }
});
