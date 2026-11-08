import assert from 'node:assert/strict';
import vm from 'node:vm';
import { isWarmOwnerBenchmarkValid, runWarmOwnerBenchmark } from './warm-owner-benchmark.mjs';

function runFixture({ elapsed = 14, wrongAt = Infinity } = {}) {
  const ctx = vm.createContext({ wrongAt });
  vm.runInContext(`
    let calls = 0;
    const realm = globalThis;
    function getAssignedQueueOwner() {
      calls++;
      if (globalThis !== realm || calls > wrongAt) return 'wrong-owner';
      return 'chris_fisher';
    }
  `, ctx);
  const samples = [];
  const clock = { now() { samples.push(vm.runInContext('calls', ctx)); return samples.length === 1 ? 0 : elapsed; } };
  return { result: runWarmOwnerBenchmark(ctx, {}, clock), samples };
}

export function assertWarmOwnerBenchmarkContract() {
  const safe = runFixture();
  assert.deepEqual(safe.samples, [10000, 20000]);
  assert.equal(isWarmOwnerBenchmarkValid(safe.result), true);
  assert.equal(isWarmOwnerBenchmarkValid(runFixture({ wrongAt: 10000 }).result), false);
  assert.equal(isWarmOwnerBenchmarkValid(runFixture({ wrongAt: 0 }).result), false);
  assert.equal(isWarmOwnerBenchmarkValid(runFixture({ elapsed: 15 }).result), false);
  assert.equal(isWarmOwnerBenchmarkValid({ warmHits:10000, hits:10000, elapsed:NaN }), false);
}
