import assert from 'node:assert/strict';
import { deferredRead } from '../../src/core/request-snapshot-fixture.mjs';
import { runFunctions } from './golden-test-environment.mjs';

function requestHarness() {
  const navigation = new AbortController();
  const context = {
    productionLiveSyncNavigation:{signal:navigation.signal},
    ACTIVE_REQUEST_TABLE:'active',
    requestsInventory:[{id:'cached'},{id:'history',REQUEST_HISTORY:true}],
    owner:'a',
    window:{},
    getSupabaseReadIdentityScope:()=>context.owner,
    buildActiveRequestLiveRowsQuery:()=>'',
    fetchAllSupabaseRows:async()=>{throw Object.assign(new Error('denied'),{status:403});},
    queueRequestForceRefreshRetry:()=>assert.fail('permission errors do not trigger transient retry'),
  };
  return runFunctions('assets/app-runtime.js',['fetchActiveRequestLiveRows','isOperationalTransientError'],context);
}

export async function requestSnapshotInvariant() {
  const sameOwner = requestHarness();
  assert.deepEqual(Array.from(await sameOwner.fetchActiveRequestLiveRows(), row => row.id), ['cached']);
  for (const outcome of ['success', 'failure']) {
    const context = requestHarness();
    const gate = deferredRead(outcome);
    context.fetchAllSupabaseRows = () => gate.promise;
    const pending = context.fetchActiveRequestLiveRows();
    context.owner = 'b';
    gate.finish();
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
  }
}
