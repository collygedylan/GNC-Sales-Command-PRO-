import { runWarmOwnerBenchmark, isWarmOwnerBenchmarkValid } from '../src/core/warm-owner-benchmark.mjs';
import { fixture, engines } from '../src/core/canonical-row-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';

test('10,000 warm exact/family owner lookups finish within 15 milliseconds', t => {
    const {ctx,state}=fixture(engines);
    for(let i=0;i<3352;i++)state.itemcodeDefaultOwners.set(String(100000+i)+'.010.1','worker');
    const index=ctx.getCardEvalOwnerIndex(state,true);
    assert.equal(index.exact,state.ownerByExactItemcodeMap); assert.equal(index.family,state.ownerByPrefix6Map);
    assert.equal(state.usersWithAssignedItemsSet.has('chris_fisher'),true);
    const result = runWarmOwnerBenchmark(ctx, index, performance);
    assert.equal(ctx.getAssignedQueueOwner({itemcode:'999999.999.9'}, index), '');
    assert.equal(ctx.getAssignedQueueOwner({itemcode:'001973.030.1'}, index), 'other_eval');
    assert.equal(result.warmHits, 10000);
    assert.equal(result.hits, 10000);
    assert.ok(isWarmOwnerBenchmarkValid(result), String(result.elapsed));
    t.diagnostic(result.elapsed.toFixed(3) + ' ms');
});
