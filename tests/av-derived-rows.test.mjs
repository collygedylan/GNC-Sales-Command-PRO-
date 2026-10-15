// @test-group: foundation
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/av-derived-rows.js', import.meta.url), 'utf8');

function createHarness() {
  const queued = [];
  const context = { window: { setTimeout: callback => { queued.push(callback); return queued.length; }, clearTimeout() {} }, Map, Array, Number, String, Promise };
  vm.runInNewContext(source, context);
  return { api: context.window.AgMetricAvDerivedRows, flushOne: () => queued.shift()?.(), queued };
}

test('AV derived rows publish atomically after bounded slices and reuse exact source revisions', async () => {
  const h = createHarness(), rows = Array.from({ length: 9_539 }, (_, id) => ({ id }));
  const batchSizes = [];
  const pending = h.api.prepare({ key: 'actor:policy:current', sourceKey: 'master:r7', scope: 'actor:policy', rows,
    chunkSize: 128, mapRow: row => row.id % 2 ? row.id : null,
    onSlice: (start, end) => batchSizes.push(end - start) });
  assert.equal(h.api.peek('actor:policy:current', 'actor:policy'), null, 'partial candidates are never visible');
  while (h.queued.length) h.flushOne();
  const result = await pending;
  assert.equal(result.length, 4_769);
  assert.equal(Math.max(...batchSizes), 128);
  assert.equal(h.api.peek('actor:policy:current', 'actor:policy').rows, result);
  let mapped = 0;
  const reused = await h.api.prepare({ key: 'actor:policy:current', sourceKey: 'master:r7', scope: 'actor:policy', rows,
    mapRow: row => { mapped += 1; return row.id; } });
  assert.equal(reused, result);
  assert.equal(mapped, 0);
});

test('AV derivation retains same-scope rows until replacement and rejects stale generation commits', async () => {
  const h = createHarness(), rows = [{ id: 'old' }];
  await h.api.prepare({ key: 'actor:policy:current', sourceKey: 'r1', scope: 'actor:policy', rows, mapRow: row => row.id });
  const replacement = h.api.prepare({ key: 'actor:policy:current', sourceKey: 'r2', scope: 'actor:policy', rows: Array.from({ length: 30 }, (_, id) => ({ id: `new-${id}` })), chunkSize: 16, mapRow: row => row.id });
  assert.deepEqual(Array.from(h.api.peek('actor:policy:current', 'actor:policy').rows), ['old']);
  while (h.queued.length) h.flushOne();
  while (h.queued.length) h.flushOne();
  assert.equal((await replacement).length, 30);

  let current = true;
  const stale = h.api.prepare({ key: 'actor:policy:current', sourceKey: 'r3', scope: 'actor:policy', rows: Array.from({ length: 30 }, (_, id) => ({ id })),
    chunkSize: 16, mapRow: row => row.id, isCurrent: () => current });
  current = false;
  while (h.queued.length) h.flushOne();
  assert.equal(await stale, null);
  assert.deepEqual(Array.from(h.api.peek('actor:policy:current', 'actor:policy').rows), Array.from({ length: 30 }, (_, id) => `new-${id}`));
});

test('AV cache keys isolate accounts and permission revisions and clear scoped jobs safely', async () => {
  const h = createHarness();
  await h.api.prepare({ key: 'actor-a:policy-1:current', sourceKey: 'r1', scope: 'actor-a:policy-1', rows: [{ id: 'private-a' }], mapRow: row => row.id });
  assert.equal(h.api.peek('actor-b:policy-1:current'), null);
  assert.equal(h.api.peek('actor-a:policy-2:current'), null);
  const pending = h.api.prepare({ key: 'actor-a:policy-1:next-up', sourceKey: 'r2', scope: 'actor-a:policy-1', rows: Array.from({ length: 30 }, (_, id) => ({ id })), chunkSize: 16, mapRow: row => row.id });
  h.api.clearScope('actor-a:policy-1');
  while (h.queued.length) h.flushOne();
  assert.equal(await pending, null);
  assert.equal(h.api.peek('actor-a:policy-1:current'), null);
});
