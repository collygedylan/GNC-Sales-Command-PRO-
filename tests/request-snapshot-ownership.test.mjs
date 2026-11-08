import { requestHarness, deferredRead } from '../src/core/request-snapshot-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

test('request snapshots retain same-account active rows after an unconfirmed read denial', async () => {
  const ctx = requestHarness();
  assert.deepEqual(Array.from(await ctx.fetchActiveRequestLiveRows(), row => row.id), ['cached']);
});

test('request read results and failed fallbacks reject an owner change', async () => {
  for (const outcome of ['success', 'failure']) {
    const ctx = requestHarness();
    const gate = deferredRead(outcome);
    ctx.fetchAllSupabaseRows = () => gate.promise;
    const pending = ctx.fetchActiveRequestLiveRows();
    ctx.owner = 'b';
    gate.finish();
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
  }
});

