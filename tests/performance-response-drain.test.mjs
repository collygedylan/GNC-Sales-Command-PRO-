// @test-group: foundation
import assert from 'node:assert/strict';
import test from 'node:test';
import { drainPerformanceResponseBodies } from '../scripts/performance-response-drain.mjs';

test('response body drain clears completed batches and captures responses added while waiting', async () => {
  const totals = { pending: [], errors: [] };
  let release;
  totals.pending.push(new Promise(resolve => { release = resolve; }));
  const drained = drainPerformanceResponseBodies(totals);
  totals.pending.push(Promise.resolve());
  release();
  await drained;
  assert.deepEqual(totals.pending, []);
});

test('response body drain bounds batch growth and hung response bodies', async () => {
  const growing = { pending: [], errors: [] };
  growing.pending.push(Promise.resolve().then(() => growing.pending.push(Promise.resolve())));
  await assert.rejects(drainPerformanceResponseBodies(growing, { maxBatches: 1 }), /PERFORMANCE_RESPONSE_DRAIN_LIMIT/);

  const hung = { pending: [new Promise(() => {})], errors: [] };
  await assert.rejects(drainPerformanceResponseBodies(hung, { timeoutMs: 5 }), /PERFORMANCE_RESPONSE_DRAIN_TIMEOUT/);
});
