import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function functionSource(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = html.indexOf('\n        }', start);
  assert.ok(end > start, `Missing end of ${name}`);
  return html.slice(start, end + '\n        }'.length);
}
function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function harness(existingSession = storage()) {
  const calls = { navigations: [], cancellations: [], flushes: 0, cacheClear: [], controllerClear: 0 };
  const context = {
    URL, Date, console, sessionStorage: existingSession,
    localStorage: storage({ 'sb-existing-auth-token': 'keep-session', savedRequestDraft: 'keep-draft' }),
    APP_SHELL_BUILD: 'VTEST.07', APP_SHELL_QUERY_PARAM: 'shellv',
    APP_SHELL_FORCE_REFRESH_STORAGE_KEY: 'force', APP_SHELL_DEFERRED_RELOAD_STORAGE_KEY: 'deferred',
    APP_SHELL_RUNTIME_BOOTED_AT: 0, APP_SHELL_VISIBLE_RELOAD_STARTUP_GRACE_MS: 8000,
    currentUser: 'test-user', loginShellPreparing: false, requestSubmitInFlight: false,
    pendingRequestArchiveFlushInFlight: false, driveEvidenceAbortControllers: new Map(),
    pendingRequestCameraSelection: null, retainedRequestCameraSelections: [], requestCameraPickerOwner: null,
    isLoginSessionOwnershipCurrent: owner => owner === 'current-fixture',
    document: { hidden: false, body: { classList: { contains: () => false } } },
    blocked: false, focused: false, view: 'home', photoDraftPending: false,
    logShellDiagnostics() {}, setStoredTargetShellBuild() {}, getDeferredShellReloadRequest() { return null; },
    syncShellBuildUrl() {}, getShellStaleRecoveryMarker() { return ''; }, setShellStaleRecoveryMarker() {},
    hasPendingProtectedPhotoDrafts() { return context.photoDraftPending; },
    hasActiveTextEntryFocus() { return context.focused; },
    shouldDeferInteractiveBackgroundWork() { return context.blocked; },
    getCurrentVisibleViewId() { return context.view; },
    flushPendingEditsCache(immediate) { assert.equal(immediate, true); calls.flushes += 1; },
    cancelAllDriveEvidenceSaves(reason) { calls.cancellations.push(reason); },
    updateShellServiceWorkerRegistration: async () => null, requestWaitingShellActivation() {},
    clearBootCacheForShellUpdate: async force => calls.cacheClear.push(force),
    clearShellControllerCachesAndRegistrations: async () => { calls.controllerClear += 1; },
    setTimeout: callback => { callback(); return 1; }, clearTimeout() {},
  };
  context.window = { location: { href: 'https://app.test/?shellv=VTEST.06', replace: url => calls.navigations.push(url), reload: () => calls.navigations.push('reload') } };
  vm.createContext(context);
  for (const name of ['rememberDeferredShellReload', 'getRetainedRequestCameraSelections', 'hasPendingRequestCameraPhoto', 'isShellReloadHardBlocked', 'isShellReloadBlocked', 'shouldDeferVisibleShellReload', 'navigateToRecoveredShellBuild', 'applyDeferredShellReloadIfHidden', 'forceShellBuildReload', 'recoverStandaloneShellController']) {
    vm.runInContext(functionSource(name), context);
  }
  return { context, calls, evaluate: code => vm.runInContext(code, context) };
}

test('deferred intent does not consume the actual reload token', async () => {
  const h = harness();
  h.context.focused = true;
  assert.equal(await h.context.forceShellBuildReload('VTEST.07', 'update'), false);
  assert.equal(h.context.sessionStorage.getItem('force'), null);
  assert.equal(h.calls.navigations.length, 0);
  h.context.focused = false;
  assert.equal(await h.context.forceShellBuildReload('VTEST.07', 'typing-idle:deferred'), true);
  assert.equal(h.calls.navigations.length, 1);
  assert.equal(h.context.sessionStorage.getItem('deferred'), null);
});

test('all navigation paths get at most one navigation per build, including a new runtime', async () => {
  const h = harness();
  await Promise.all([
    h.context.forceShellBuildReload('VTEST.07', 'manifest'),
    h.context.forceShellBuildReload('VTEST.07', 'controllerchange'),
    h.context.recoverStandaloneShellController('VTEST.07', 'stale-controller'),
  ]);
  assert.equal(h.calls.navigations.length, 1);
  const restored = harness(h.context.sessionStorage);
  assert.equal(restored.context.navigateToRecoveredShellBuild('VTEST.07', 'runtime-recovery'), false);
  assert.equal(restored.context.navigateToRecoveredShellBuild('VTEST.08', 'new-release'), true);
});

test('in-memory guard still prevents repeated navigation if session storage is unavailable', () => {
  const h = harness({ getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }, removeItem() {} });
  assert.equal(h.context.navigateToRecoveredShellBuild('VTEST.07', 'first'), true);
  assert.equal(h.context.navigateToRecoveredShellBuild('VTEST.07', 'repeat'), false);
  assert.equal(h.calls.navigations.length, 1);
});

for (const [name, configure] of [
  ['profile startup', c => { c.loginShellPreparing = true; }],
  ['photo upload', c => { c.window.pendingPhotoUploads = new Set(['upload']); }],
  ['unsaved uploaded photo', c => { c.photoDraftPending = true; }],
  ['retained Request camera File', c => { c.pendingRequestCameraSelection = { files: ['synthetic-local-file'], owner: 'current-fixture' }; }],
  ['open Request native camera', c => { c.requestCameraPickerOwner = { reviewed: true, owner: 'current-fixture' }; }],
  ['protected evidence save', c => { c.driveEvidenceAbortControllers.set('row', {}); }],
  ['open detail draft after blur', c => { c.view = 'detail'; }],
  ['Request submission', c => { c.requestSubmitInFlight = true; }],
]) {
  test(`hidden shell does not replace ${name}`, () => {
    const h = harness();
    h.context.document.hidden = true;
    configure(h.context);
    h.context.rememberDeferredShellReload('VTEST.07', 'update');
    assert.equal(h.context.applyDeferredShellReloadIfHidden(), false);
    assert.equal(h.context.navigateToRecoveredShellBuild('VTEST.07', 'forced-hidden'), false);
    assert.equal(h.calls.cancellations.length, 0);
    assert.equal(h.calls.navigations.length, 0);
  });
}

test('new typing during the async service worker check is rechecked before navigation', async () => {
  const h = harness();
  h.context.updateShellServiceWorkerRegistration = async () => { h.context.focused = true; return null; };
  assert.equal(await h.context.forceShellBuildReload('VTEST.07', 'manifest'), false);
  assert.equal(h.calls.navigations.length, 0);
  assert.equal(h.calls.cancellations.length, 0);
  assert.equal(h.context.window.__gncDeferredShellReload.build, 'VTEST.07');
});

test('standalone stale-controller repair preserves credentials and the shared Request outbox database', async () => {
  const h = harness();
  assert.equal(await h.context.recoverStandaloneShellController('VTEST.07', 'stale'), true);
  assert.deepEqual(h.calls.cacheClear, [undefined]);
  assert.equal(h.context.localStorage.getItem('sb-existing-auth-token'), 'keep-session');
  assert.equal(h.context.localStorage.getItem('savedRequestDraft'), 'keep-draft');
  assert.equal(h.calls.flushes, 1);
  assert.equal(h.calls.controllerClear, 1);
});

test('same-build service worker activation never forces a second app restart', () => {
  const source = html.slice(html.indexOf('const reloadToShellBuild ='), html.indexOf('const requestWaitingShellActivation =', html.indexOf('const reloadToShellBuild =')));
  assert.match(source, /if \(safeTargetBuild === shellBuild\) return false/);
  assert.match(source, /window\.navigateToRecoveredShellBuild\(safeTargetBuild, reason\)/);
  assert.doesNotMatch(source, /location\.(?:replace|reload)\(/);
  const apply = html.slice(html.indexOf('const tryApplyShellUpdateSilently ='), html.indexOf('const checkLatestShellAndReload ='));
  assert.doesNotMatch(apply, /location\.(?:replace|reload)\(/);
  assert.doesNotMatch(functionSource('recoverStandaloneShellController'), /clearBootCacheForShellUpdate\(true\)/);
});
