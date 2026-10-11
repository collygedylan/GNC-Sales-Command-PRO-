import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function sourceExpression() {
  const source = readFileSync(new URL('./verified-loading.e2e.spec.ts', import.meta.url), 'utf8');
  const helperStart = source.indexOf('async function installDrivePreparationDiagnostics(page: Page)');
  assert.notEqual(helperStart, -1, 'the UI diagnostic helper exists');
  const templateStart = source.indexOf('window.eval(`', helperStart);
  assert.notEqual(templateStart, -1, 'the helper evaluates its diagnostic script');
  const expressionStart = templateStart + 'window.eval(`'.length;
  const templateEnd = source.indexOf('`));', expressionStart);
  assert.notEqual(templateEnd, -1, 'the helper diagnostic template is closed');
  return source.slice(expressionStart, templateEnd);
}

function makeContext({ withPending = false } = {}) {
  const calls = { check: [], invalidate: [], render: [], cancel: [], baseContext: 0 };
  const document = { hidden: false, getElementById: () => ({ value: 'query' }) };
  const context = {
    window: {}, document, performance: { now: () => 123 },
    activeDriveTab: 'name', driveCommonNamePreparation: null,
    driveVisibleItemsStateCacheKey: '', driveBaseFilterCacheKey: 'base-filter',
    lastSyncTime: 'sync-stamp', fullInventory: [{ id: 'row' }],
    currentUser: 'fixture-user', currentRole: 'ADMIN', productionLiveSyncReadGeneration: 7,
    checkResult: false,
    getCurrentVisibleViewId: () => 'drive',
    getDriveDrillSelectionStateKey: () => 'selection',
    getDriveBaseFilterContextKey() { calls.baseContext += 1; return 'base-context'; },
    getDatasetState: () => ({ lastLoadedAt: 'master-loaded' }),
    isChunkRenderCurrentForContainer: () => true,
    canUseProductionLiveSync: () => false,
    productionVerifiedViewKey: () => 'verified-key',
    isDriveCommonNamePreparationCurrent(pending) {
      calls.check.push({ receiver: this, pending });
      return context.checkResult;
    },
    invalidateDriveResolvedCardState(...args) {
      calls.invalidate.push({ receiver: this, args });
      return 'invalidate-result';
    },
    renderDriveCompleteCommonNames(...args) {
      calls.render.push({ receiver: this, args });
      if (withPending) context.driveCommonNamePreparation = context.pending;
      return 'render-result';
    },
    cancelDriveCommonNamePreparation(...args) {
      calls.cancel.push({ receiver: this, args });
      context.driveCommonNamePreparation = null;
      return 'cancel-result';
    },
    calls,
  };
  const pending = Object.freeze({
    container: Object.freeze({ dataset: Object.freeze({ driveCommonnameState: 'preparing' }) }),
    token: 4, selection: 'selection', search: 'query', filterKey: '',
    user: 'fixture-user', role: 'ADMIN', native: false, generation: 7,
  });
  context.pending = pending;
  const sandbox = vm.createContext(context);
  return { sandbox, pending, calls };
}

function installDiagnostics(sandbox) {
  const expression = sourceExpression();
  assert.doesNotThrow(() => new vm.Script(expression), 'injected diagnostic script parses as JavaScript');
  return vm.runInContext(expression, sandbox);
}

test('injected diagnostics safely preserve original wrappers when no preparation is pending', () => {
  const { sandbox, calls } = makeContext();
  assert.equal(installDiagnostics(sandbox), true);
  const receiver = { receiver: 'sentinel' };
  const render = vm.runInContext('renderDriveCompleteCommonNames.call(testReceiver, "row", 2)', Object.assign(sandbox, { testReceiver: receiver }));
  const check = vm.runInContext('isDriveCommonNamePreparationCurrent.call(testReceiver, null)', sandbox);
  const invalidate = vm.runInContext('invalidateDriveResolvedCardState.call(testReceiver, "filter", 1)', sandbox);
  const cancel = vm.runInContext('cancelDriveCommonNamePreparation.call(testReceiver, "reason")', sandbox);
  assert.equal(render, 'render-result');
  assert.equal(check, false);
  assert.equal(invalidate, 'invalidate-result');
  assert.equal(cancel, 'cancel-result');
  assert.equal(calls.render[0].receiver, receiver);
  assert.deepEqual(calls.render[0].args, ['row', 2]);
  assert.equal(calls.check[0].receiver, receiver);
  assert.equal(calls.invalidate[0].receiver, receiver);
  assert.deepEqual(calls.invalidate[0].args, ['filter', 1]);
  assert.equal(calls.cancel[0].receiver, receiver);
  assert.deepEqual(calls.cancel[0].args, ['reason']);
  assert.deepEqual(Array.from(sandbox.window.__drivePreparationDiagnostics), []);
  assert.deepEqual(Array.from(sandbox.window.__drivePreparationInvalidations), []);
});

test('pending metadata is recorded once without mutating it; diagnostic wrappers preserve results and bound logs', () => {
  const { sandbox, pending, calls } = makeContext({ withPending: true });
  const before = JSON.stringify(pending);
  assert.equal(installDiagnostics(sandbox), true);
  const receiver = { receiver: 'sentinel' };
  for (let index = 0; index < 2; index += 1) {
    assert.equal(vm.runInContext('renderDriveCompleteCommonNames.call(testReceiver, "row", 2)', Object.assign(sandbox, { testReceiver: receiver })), 'render-result');
  }
  assert.equal(calls.render.length, 2);
  assert.equal(calls.render.every(call => call.receiver === receiver && call.args[0] === 'row' && call.args[1] === 2), true);
  assert.equal(calls.baseContext, 1, 'WeakMap metadata is captured only on the first encounter with this pending object');

  for (let index = 0; index < 24; index += 1) {
    assert.equal(vm.runInContext('isDriveCommonNamePreparationCurrent.call(testReceiver, pending)', Object.assign(sandbox, { testReceiver: receiver })), false);
  }
  const events = sandbox.window.__drivePreparationDiagnostics;
  assert.equal(events.length, 16);
  assert.equal(events.every(event => event.kind === 'predicate-false' && event.checks.filterMatches), true);
  assert.equal(calls.check.length, 24);
  assert.equal(calls.check.every(call => call.receiver === receiver && call.pending === pending), true);

  for (let index = 0; index < 20; index += 1) {
    assert.equal(vm.runInContext('invalidateDriveResolvedCardState.call(testReceiver, "filter", 1)', Object.assign(sandbox, { testReceiver: receiver })), 'invalidate-result');
  }
  const invalidations = sandbox.window.__drivePreparationInvalidations;
  assert.equal(invalidations.length, 16);
  assert.equal(invalidations.every(entry => entry.visibleKeyEmptyBefore && entry.pendingKeyEmpty && entry.visibleKeyMatchesBefore), true);
  assert.equal(calls.invalidate.length, 20);
  assert.equal(calls.invalidate.every(call => call.receiver === receiver && call.args[0] === 'filter'), true);

  events.length = 0;
  sandbox.checkResult = true;
  assert.equal(vm.runInContext('isDriveCommonNamePreparationCurrent.call(testReceiver, pending)', Object.assign(sandbox, { testReceiver: receiver })), true);
  assert.equal(sandbox.window.__drivePreparationLastInvalidation, null);
  const cancelled = vm.runInContext('cancelDriveCommonNamePreparation.call(testReceiver, "retry")', Object.assign(sandbox, { testReceiver: receiver }));
  assert.equal(cancelled, 'cancel-result');
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.cancel[0].receiver, receiver);
  assert.deepEqual(calls.cancel[0].args, ['retry']);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'cancel');
  assert.equal(events[0].checks.filterMatches, true);
  assert.equal(JSON.stringify(pending), before, 'diagnostics keep metadata outside the original pending object');
});
