import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: requests
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const context = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../assets/queue-completion-state.js', import.meta.url), 'utf8'), context);
  return { storage, create: scope => context.window.AgMetricQueueCompletion.create({ scope, storage }) };
}

test('Done removes immediately, deduplicates clicks, and survives stale fetches after acknowledgment', () => {
  const f = fixture(); const cache = f.create('user-a');
  assert.equal(cache.begin('request:a'), true);
  assert.equal(cache.begin('request:a'), false);
  assert.equal(cache.has('request:a'), true);
  cache.confirm('request:a');
  assert.equal(cache.has('request:a'), true);
  assert.equal(f.create('user-a').has('request:a'), true);
  assert.equal(f.create('user-b').has('request:a'), false);
});

test('rejected saves restore visibility; pending work is never persisted as success', () => {
  const f = fixture(); const cache = f.create('user-a');
  cache.begin('request:a');
  assert.equal(f.create('user-a').has('request:a'), false);
  cache.rollback('request:a');
  assert.equal(cache.has('request:a'), false);
  cache.begin('request:a'); cache.confirm('request:a'); cache.rollback('request:a');
  assert.equal(cache.has('request:a'), true);
});

test('a new source revision has independent visibility and storage failure preserves session state', () => {
  const f = fixture(); const cache = f.create('user-a');
  cache.begin('suspend:a:import-1'); cache.confirm('suspend:a:import-1');
  assert.equal(cache.has('suspend:a:import-2'), false);
  f.storage.setItem = () => { throw new Error('Storage unavailable'); };
  cache.begin('request:b'); assert.doesNotThrow(() => cache.confirm('request:b'));
  assert.equal(cache.has('request:b'), true);
});

test('only a later acknowledged server version can reopen a completed row', () => {
  const cache = fixture().create('user-a');
  cache.begin('suspend:a:import-1'); cache.confirm('suspend:a:import-1', 5);
  assert.equal(cache.has('suspend:a:import-1', 4), true);
  assert.equal(cache.has('suspend:a:import-1', 5), true);
  assert.equal(cache.has('suspend:a:import-1', 6), false);
});

function appFixture() {
  const html = readComposedAppSource();
  const values = new Map();
  const context = vm.createContext({
    window: { localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } },
    scope: 'operator-a', optimisticCompletedRowIds: new Set(),
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== '') || '',
    normalizeRequestStatus: value => value,
    invalidateResolvedViewStateCaches() {},
    isDockSuspendDcRequestMirrorRow: item => !!item?.DOCK_SUSPEND_SOURCE_UID,
    getDockSuspendDcRequestSourceUid: item => item.DOCK_SUSPEND_SOURCE_UID,
    getDockSuspendCompletionRevision: item => item.LAST_UPDATED,
    isDockSuspendDcRequestSource: item => item.SUSPEND === 'SUSPEND',
    getSuspendTagStatus: item => item.suspend_tag_status,
  });
  context.getSupabaseReadIdentityScope = () => context.scope;
  vm.runInContext(readFileSync(new URL('../assets/queue-completion-state.js', import.meta.url), 'utf8'), context);
  vm.runInContext(html.slice(html.indexOf('        function getItemUniqueId('), html.indexOf('        function getRequestDeliveryStatus(')), context);
  const start = html.indexOf('        function getSuspendTagRequestItems(');
  vm.runInContext(html.slice(start, html.indexOf('        function countPendingSuspendTagQueueItems(', start)), context);
  return context;
}

test('active Request visibility remains complete after stale cache replacement and resets for another user', () => {
  const app = appFixture(); const stale = { UNIQUE_ID: 'request-1', REQ_STATUS: 'Pending', row_version: 4 };
  app.trackOptimisticCompletedRows([stale]); assert.equal(app.isRequestComplete(stale), true);
  app.confirmQueueCompletion({ ...stale, REQ_STATUS: 'Complete', row_version: 5 });
  app.clearOptimisticCompletedRows([stale]); assert.equal(app.isRequestComplete({ ...stale }), true);
  app.scope = 'operator-b'; assert.equal(app.isRequestComplete(stale), false);
  app.scope = 'operator-a'; assert.equal(app.isRequestComplete(stale), true);
});

test('Suspend active lists exclude pending Done immediately, keep failures retryable, and respect later denial', () => {
  const app = appFixture();
  const row = { UNIQUE_ID: 'mirror-1', DOCK_SUSPEND_SOURCE_UID: 'soc-1', LAST_UPDATED: 'import-1', SUSPEND: 'SUSPEND', suspend_tag_status: 'pending', suspend_tag_version: 1 };
  const cache = app.getQueueCompletionState(); const key = app.getQueueCompletionKey(row);
  cache.begin(key); assert.equal(app.getSuspendTagRequestItems([row]).length, 0);
  cache.rollback(key); assert.equal(app.getSuspendTagRequestItems([row]).length, 1);
  cache.begin(key); cache.confirm(key, 2); assert.equal(app.getSuspendTagRequestItems([{ ...row }]).length, 0);
  assert.equal(app.getSuspendTagRequestItems([{ ...row, suspend_tag_status: 'denied', suspend_tag_version: 3 }]).length, 1);
  for (const status of ['completed', 'awaiting_rep', 'approved']) {
    const completed = { ...row, suspend_tag_status: status, suspend_tag_version: 2 };
    assert.equal(app.getSuspendTagRequestItems([completed]).length, 0);
    assert.equal(app.getSuspendTagRequestItems([completed], 'completed').length, 1, 'completed approval work remains reachable outside the active queue');
  }
  assert.equal(app.getSuspendTagRequestItems([row], 'completed').length, 0, 'pending optimistic work cannot claim server completion');
});
