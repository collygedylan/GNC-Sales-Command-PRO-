import assert from 'node:assert/strict';
import { requestHarness, deferredRead } from './request-snapshot-fixture.mjs';

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
