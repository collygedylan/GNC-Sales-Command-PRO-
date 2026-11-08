import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  ensureCompleteMasterInventorySnapshot,
  fetchInventoryPreviewWithRetry,
  isCompleteMasterInventorySnapshot,
  isRecoverableSnapshotError,
  selectAvailableInventoryPreviewAdapterIds,
  shouldRetainCompleteInventorySnapshot
} from '../src/core/inventory-hydration-recovery.js';

const completeState = (overrides = {}) => ({
  initialLoaded: true,
  fullLoaded: true,
  rowCompleteness: 'complete',
  expectedRowCount: 9480,
  ...overrides
});

test('a partial preview cannot replace an already complete master snapshot', () => {
  const currentRows = Array.from({ length: 9480 }, (_, index) => ({ unique_id: `row-${index}` }));
  const incomingRows = currentRows.slice(0, 200);
  assert.equal(shouldRetainCompleteInventorySnapshot({
    currentRows,
    currentState: completeState(),
    incomingRows,
    incomingCompleteness: 'partial'
  }), true);
});

test('complete master proof requires the expected physical row count', () => {
  const rows = Array.from({ length: 9480 });
  assert.equal(isCompleteMasterInventorySnapshot({ rows, state: completeState() }), true);
  assert.equal(isCompleteMasterInventorySnapshot({
    rows: rows.slice(0, 200),
    state: completeState()
  }), false);
});

test('partial cold recovery invokes the canonical loader and verifies its result', async () => {
  let rows = Array.from({ length: 200 });
  let state = completeState({ fullLoaded: false, rowCompleteness: 'partial' });
  let loads = 0;
  assert.equal(await ensureCompleteMasterInventorySnapshot({
    getRows: () => rows,
    getState: () => state,
    isCurrent: () => true,
    load: async () => {
      loads++;
      rows = Array.from({ length: 9480 });
      state = completeState();
      return true;
    }
  }), true);
  assert.equal(loads, 1);
});

test('bounded preview retry is lifecycle-fenced and attempts one retry only', async () => {
  let attempts = 0;
  const result = await fetchInventoryPreviewWithRetry({
    fetchPage: async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('temporary'), { status: 503 });
      return { rows: [1] };
    },
    isCurrent: () => true,
    isRetryable: error => error.status === 503
  });
  assert.deepEqual(result, { rows: [1] });
  assert.equal(attempts, 2);
});

test('the preview guard permits cold hydration and verified complete replacements', () => {
  const partial = Array.from({ length: 200 }, (_, index) => ({ unique_id: `row-${index}` }));
  const complete = Array.from({ length: 9480 }, (_, index) => ({ unique_id: `row-${index}` }));
  assert.equal(shouldRetainCompleteInventorySnapshot({
    currentRows: partial,
    currentState: completeState({ fullLoaded: false, rowCompleteness: 'partial' }),
    incomingRows: complete,
    incomingCompleteness: 'complete'
  }), false);
  assert.equal(shouldRetainCompleteInventorySnapshot({
    currentRows: complete,
    currentState: completeState(),
    incomingRows: complete.map(row => ({ ...row })),
    incomingCompleteness: 'complete'
  }), false);
});

test('progressive preview IDs are always a subset of the active adapters', () => {
  const master = { id: 'core:master' }, metadata = { id: 'side:homeSyncMetadata' };
  assert.deepEqual(selectAvailableInventoryPreviewAdapterIds({ progressive: true, view: 'home', adapters: [master, metadata] }), ['core:master']);
  assert.equal(selectAvailableInventoryPreviewAdapterIds({ progressive: true, view: 'home', adapters: [metadata] }), undefined);
  assert.deepEqual(selectAvailableInventoryPreviewAdapterIds({ progressive: true, view: 'docks', adapters: [{ id: 'core:soc' }] }), ['core:soc']);
  assert.equal(selectAvailableInventoryPreviewAdapterIds({ progressive: false, view: 'drive', adapters: [master] }), undefined);
});

test('a stale complete flag cannot retain a row-count mismatch', () => {
  assert.equal(shouldRetainCompleteInventorySnapshot({
    currentRows: Array.from({ length: 1000 }),
    currentState: completeState(),
    incomingRows: Array.from({ length: 200 }),
    incomingCompleteness: 'partial'
  }), false);
});

test('pagination field-coverage drift retries but invalid projection remains terminal', () => {
  assert.equal(isRecoverableSnapshotError(
    new Error('Inventory field coverage changed between pages; the partial snapshot was discarded.')
  ), true);
  assert.equal(isRecoverableSnapshotError(
    new Error('Full inventory field coverage was missing or invalid; the partial snapshot was discarded.')
  ), false);
  assert.equal(isRecoverableSnapshotError(
    new Error('Direct inventory projection is unavailable.')
  ), false);
});

test('classic recovery asset publishes the same preview guard', () => {
  const source = readFileSync(new URL('../assets/inventory-hydration-recovery.js', import.meta.url), 'utf8');
  const sandbox = { module: { exports: {} }, globalThis: null, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'assets/inventory-hydration-recovery.js' });
  assert.equal(typeof sandbox.GncInventoryHydrationRecovery.shouldRetainCompleteInventorySnapshot, 'function');
  assert.equal(typeof sandbox.GncInventoryHydrationRecovery.fetchInventoryPreviewWithRetry, 'function');
  assert.equal(sandbox.GncInventoryHydrationRecovery.shouldRetainCompleteInventorySnapshot({
    currentRows: Array.from({ length: 9480 }),
    currentState: completeState(),
    incomingRows: Array.from({ length: 200 }),
    incomingCompleteness: 'partial'
  }), true);
});
