import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { parseExpressionAt } from 'acorn';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
const registry = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');

function functionSource(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `function ${name} exists`);
  const { end } = parseExpressionAt(html, start, { ecmaVersion: 'latest' });
  return html.slice(start, end);
}

function recoveryRuntime() {
  const loading = [], dirty = [], timers = [];
  const context = vm.createContext({
    nativeAuthProfile: { active: true }, VIEW_LOAD_RETRY_MAX_ATTEMPTS: 3,
    viewLoadRetryStates: new Map(), viewLoadRetryTimers: new Map(),
    hasProgressiveViewData: () => false,
    isNativeProfileRetryRequired: () => false,
    isInventorySourceReadinessError: () => false,
    isSupabaseReadTerminalDenial: error => Number(error?.status) === 403,
    showViewLoadingState: (...args) => loading.push(args),
    markViewDirty: view => dirty.push(view),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    isViewVisible: () => true, retryVerifiedViewData: () => {},
  });
  for (const name of ['hasConfirmedCurrentAccountRevocation', 'getViewRetryState', 'scheduleViewLoadRetry', 'showAvReadUnavailableState', 'showViewErrorState']) {
    vm.runInContext(functionSource(name), context);
  }
  return { context, loading, dirty, timers };
}

function forbidden() {
  return Object.assign(new Error('AV_READ_FORBIDDEN'), { status: 403, code: 'AV_READ_FORBIDDEN' });
}

test('cold unconfirmed Drive denial retains loading and schedules one bounded retry', () => {
  const r = recoveryRuntime();
  assert.equal(r.context.showViewErrorState('drive', 'unavailable', true, forbidden()), true);
  assert.deepEqual(r.loading, [['drive', 'Loading inventory…']]);
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].delay, 60000);
  r.context.showViewErrorState('drive', 'unavailable', true, forbidden());
  assert.equal(r.timers.length, 1, 'concurrent failure does not add a timer');
});

test('unconfirmed denial retains an already displayed snapshot without a lockout', () => {
  const r = recoveryRuntime();
  r.context.hasProgressiveViewData = () => true;
  assert.equal(r.context.showViewErrorState('drive', 'unavailable', true, forbidden()), false);
  assert.deepEqual(r.dirty, ['drive']);
  assert.equal(r.loading.length, 0);
  assert.equal(r.timers.length, 0);
});

test('confirmed revocation signals the caller without scheduling or repainting', () => {
  for (const profile of [{ active: false }, { disabled_at: '2026-01-01' }, { must_change_password: true }]) {
    const r = recoveryRuntime();
    r.context.nativeAuthProfile = profile;
    r.context.hasProgressiveViewData = () => true;
    assert.equal(r.context.showViewErrorState('av', 'unavailable', true, forbidden()), true);
    assert.equal(r.loading.length, 0);
    assert.equal(r.dirty.length, 0);
    assert.equal(r.timers.length, 0);
  }
});

test('retry limit stops repeated cold failures', () => {
  const r = recoveryRuntime();
  r.context.viewLoadRetryStates.set('av', { count: 3 });
  assert.equal(r.context.showAvReadUnavailableState(forbidden(), false, 'av'), true);
  assert.equal(r.timers.length, 0);
});

test('Drive retains the settings side adapter in the shared cohort', () => {
  assert.match(registry, /drive:\s*data\(\['master'\],\s*\['settings'\]\)/);
});

test('Drive and AV recovery pass coordinator errors to the view owner', () => {
  assert.match(functionSource('showViewErrorState'), /showAvReadUnavailableState\(error \|\| new Error\(message\), hasProgressiveViewData\(\), viewId\)/);
  const ensure = functionSource('ensureProductionViewDataForRender');
  const read = functionSource('startProductionViewRead');
  assert.match(ensure, /showViewErrorState\(viewId, productionLiveSyncCoordinator\.getStatus\(\)\.message[^;]+, true, productionLiveSyncViewLoad\.error\)/);
  assert.match(read, /showAvReadUnavailableState\(load\.error[^;]+, false, viewId\)/);
  assert.match(read, /productionLiveSyncViewLoad !== load \|\| !isViewVisible\(viewId\) \|\| productionVerifiedViewKey\(\) !== key/);
});
