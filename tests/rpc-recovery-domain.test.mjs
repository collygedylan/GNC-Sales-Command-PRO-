import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseBridge } from './helpers/database-bridge.mjs';
import { dispatchRpcWithRecovery } from '../src/services/rpc-recovery-domain.js';

function options(fetcher) {
  const body = { p_idempotency_key: 'fixture-receipt', p_baseline: null, p_complete: null, p_evidence: null,
    p_expected_itemcode: null, p_expected_locationcode: null, p_expected_lotcode: null, p_expected_signature: null,
    p_master_uid: 'fixture-row', p_workflow: 'notes' };
  return { bridge: databaseBridge(fetcher), baseUrl: 'https://fixture.invalid', rpcName: 'save_drive_evidence_v3',
    body, request: { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    requestOptions: {}, timeoutMs: 1000, inScope: () => true, hedgeInScope: () => true };
}

test('retry uses canonical checked RPC bridge with identical authorization and idempotency', async () => {
  const calls = [];
  const opts = options(async (url, init, timeout, label) => {
    calls.push({ url, init, timeout, label });
    return calls.length === 1 ? new Response('unavailable', { status: 503 })
      : Response.json({ ok: true, receipt: 'durable' });
  });
  const response = await dispatchRpcWithRecovery(opts);
  assert.deepEqual(await response.json(), { ok: true, receipt: 'durable' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://fixture.invalid/rest/v1/rpc/save_drive_evidence_v3');
  assert.equal(calls[1].init.body, calls[0].init.body);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer fixture');
  assert.equal(calls[1].timeout, 1000);
  assert.equal(calls[1].init.referrerPolicy, 'no-referrer');
});

test('forbidden or changed-account failures do not replay', async () => {
  for (const state of ['denied', 'changed', 'aborted']) {
    let calls = 0;
    const opts = options(async () => {
      calls++;
      if (state === 'aborted') throw Object.assign(new Error('cancelled'), { code: 'REQUEST_ABORTED' });
      return new Response('', { status: state === 'denied' ? 403 : 503 });
    });
    opts.inScope = () => state !== 'changed';
    if (state === 'denied') assert.equal((await dispatchRpcWithRecovery(opts)).status, 403);
    else await assert.rejects(dispatchRpcWithRecovery(opts));
    assert.equal(calls, state === 'changed' ? 0 : 1, state);
  }
});

test('malformed success on recovery is rejected by the canonical bridge', async () => {
  let calls = 0;
  const opts = options(async () => ++calls === 1 ? new Response('', { status: 503 })
    : new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(dispatchRpcWithRecovery(opts));
  assert.equal(calls, 2);
});

function waitForAbort(signal) {
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
}

test('hedged owner retry resolves once and cancels the losing request', async () => {
  const calls = [];
  const bridge = { fetchRpc: async (_base, _name, init) => {
    calls.push(init);
    if (calls.length === 1) return waitForAbort(init.signal);
    return { ok: true, status: 200 };
  } };
  const opts = { bridge, baseUrl: 'https://fixture.invalid', rpcName: 'set_itemcode_default_owners_v1',
    body: { p_request_id: 'one', p_itemcodes: ['ITEM'] }, request: {}, requestOptions: {}, timeoutMs: 1000,
    inScope: () => true, hedgeInScope: () => true };
  const result = await dispatchRpcWithRecovery(opts);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].ownerReplayRelay, true);
});
