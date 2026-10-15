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
