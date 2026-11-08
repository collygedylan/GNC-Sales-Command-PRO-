import vm from 'node:vm';

export function runWarmOwnerBenchmark(ctx, index, clock) {
  Object.assign(ctx, { benchmarkIndex: index, benchmarkClock: clock });
  vm.runInContext(`
    isDockSuspendDcRequestMirrorRow = () => false;
    isDockSuspendDcRequestSource = () => false;
    buildManagerEvalAssignmentKey = code => String(code || '').trim().toUpperCase();
    const exact = { itemcode: '004380.010.1' }, family = { itemcode: '004380.999.1' };
    function benchmarkOwnerLookups() {
      let hits = 0;
      for (let i = 0; i < 5000; i++) {
        if (getAssignedQueueOwner(exact, benchmarkIndex) === 'chris_fisher') hits++;
        if (getAssignedQueueOwner(family, benchmarkIndex) === 'chris_fisher') hits++;
      }
      return hits;
    }
  `, ctx);
  const warmHits = vm.runInContext('benchmarkOwnerLookups()', ctx);
  return vm.runInContext(`(() => {
    const start = benchmarkClock.now();
    const hits = benchmarkOwnerLookups();
    return { warmHits: ${warmHits}, hits, elapsed: benchmarkClock.now() - start };
  })()`, ctx);
}

export function isWarmOwnerBenchmarkValid(result) {
  return result.warmHits === 10000 && result.hits === 10000
    && Number.isFinite(result.elapsed) && result.elapsed >= 0 && result.elapsed < 15;
}
