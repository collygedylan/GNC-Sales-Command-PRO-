import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const registry = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `function ${name} exists`);
  const end = html.indexOf('\n        }', start);
  assert.ok(end > start, `function ${name} closes`);
  return html.slice(start, end + 10);
}

function recoveryRuntime() {
  const written = [];
  const dirty = [];
  const notices = [];
  const context = vm.createContext({
    VIEW_LOAD_UI: { drive: { container: 'drive-content' }, av: { container: 'av-content' } },
    viewTerminalReadDenials: new Map(), avReadNoticeTimes: new Map(),
    getSupabaseReadIdentityScope: () => 'identity-a',
    isSupabaseReadTerminalDenial: error => Number(error?.status) === 403 || error?.code === 'AV_READ_FORBIDDEN',
    notifySupabaseReadAccessDenied: (label, error) => notices.push([label, error?.status]),
    showToast: (...args) => notices.push(args),
    markViewDirty: view => dirty.push(view),
    document: { getElementById: id => id === 'drive-content' || id === 'av-content' ? { id } : null },
    setContainerHtml: (container, markup) => written.push([container.id, markup]),
    setContainerUiState: (container, state) => written.push([container.id, state]),
    escapeHtml: value => String(value).replaceAll('<', '&lt;'),
    Date,
  });
  vm.runInContext(functionSource('nativeSessionRecoveryError'), context);
  vm.runInContext(functionSource('showAvReadUnavailableState'), context);
  return { context, written, dirty, notices };
}

test('cold Drive authorization failure gives an actionable access message and manual retry', () => {
  const r = recoveryRuntime();
  const handled = r.context.showAvReadUnavailableState(Object.assign(new Error('AV_READ_FORBIDDEN'), { status: 403, code: 'AV_READ_FORBIDDEN' }), false, 'drive');
  assert.equal(handled, true);
  assert.equal(r.context.viewTerminalReadDenials.get('drive'), 'identity-a');
  assert.equal(r.written[0][0], 'drive-content');
  assert.match(r.written[0][1], /Drive inventory access is unavailable/);
  assert.match(r.written[0][1], /contact an administrator/i);
  assert.match(r.written[0][1], /retryVerifiedViewData\('drive', true, true\)/);
});

test('cached Drive failure preserves same-identity content and marks its view dirty as stale', () => {
  const r = recoveryRuntime();
  r.context.showAvReadUnavailableState(Object.assign(new Error('temporary service error'), { status: 503 }), true, 'drive');
  assert.equal(r.written.length, 0, 'cached content is not replaced by an error panel');
  assert.deepEqual(r.dirty, ['drive']);
  assert.match(String(r.notices[0]?.[1]), /last verified rows are still shown/);
});

test('Drive and AV retain native-session recovery guidance without exposing raw error details', () => {
  for (const view of ['drive', 'av']) {
    const r = recoveryRuntime();
    const error = Object.assign(new Error('Untrusted transport details'), { code: 'NATIVE_SESSION_RECOVERY_REQUIRED' });
    r.context.showAvReadUnavailableState(error, false, view);
    assert.match(r.written[0][1], /Your session could not be restored\. Retry, or sign in again/);
    assert.match(r.written[0][1], new RegExp(`retryVerifiedViewData\\('${view}', true, true\\)`));
    assert.doesNotMatch(r.written[0][1], /Untrusted transport details|Contact an administrator/);
    assert.match(r.notices[0][1], /session could not be restored/);
  }
});

test('cached native-session failure keeps verified rows and supplies sign-in recovery guidance', () => {
  const r = recoveryRuntime();
  r.context.showAvReadUnavailableState(r.context.nativeSessionRecoveryError(), true, 'drive');
  assert.equal(r.written.length, 0);
  assert.deepEqual(r.dirty, ['drive']);
  assert.match(r.notices[0][1], /session could not be restored/);
  assert.match(r.notices[0][1], /last verified rows are still shown/);
});

test('coordinator message-only recovery errors retain the canonical session guidance', () => {
  const r = recoveryRuntime();
  const message = r.context.nativeSessionRecoveryError().message;
  r.context.showAvReadUnavailableState(new Error(message), false, 'drive');
  assert.match(r.written[0][1], /Your session could not be restored\. Retry, or sign in again/);
  assert.equal(r.notices[0][1], message);
});

test('Drive retains the settings side adapter in the shared cohort', () => {
  assert.match(registry, /drive:\s*data\(\['master'\],\s*\['settings'\]\)/);
});

test('Drive and AV recovery pass coordinator errors through the denial classifier', () => {
  assert.match(functionSource('showViewErrorState'), /showAvReadUnavailableState\(error \|\| new Error\(message\), hasProgressiveViewData\(\), viewId\)/);
  const ensure = functionSource('ensureViewDataForRender');
  assert.match(ensure, /showViewErrorState\(viewId, productionLiveSyncCoordinator\.getStatus\(\)\.message[^;]+, true, productionLiveSyncViewLoad\.error\)/);
  assert.match(ensure, /showAvReadUnavailableState\(load\.error[^;]+, false, viewId\)/);
  assert.match(ensure, /productionLiveSyncViewLoad !== load \|\| !isViewVisible\(viewId\) \|\| productionVerifiedViewKey\(\) !== key/);
  assert.match(ensure, /viewTerminalReadDenials\.get\(viewId\) === getSupabaseReadIdentityScope\(\)/);
});
