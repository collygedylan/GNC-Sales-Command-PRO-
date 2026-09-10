import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['commitRequestBatchWithVerifiedData', 'flushRequestOutbox', 'finalizeRequestAction'];
const declarations = new Map();
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (!match[1].includes('function commitRequestBatchWithVerifiedData(')) continue;
  const source = ts.createSourceFile('request-commit.js', match[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) {
      declarations.set(node.name.text, node.getText(source));
    }
  }
}
for (const name of names) assert.ok(declarations.has(name), `Extract the production ${name} function`);

const batchId = '98000000-0000-4000-8000-000000000099';
const requests = [{ unique_id: 'synthetic-request', master_id: 'synthetic-master', req_qty: '7' }];

function fixture({ native = true, held = false, liveSync = true, failedKey = '',
  rejectedKey = '', finalGuardFails = false, capabilities = { canCreateAv: true, canCreateGeneral: true } } = {}) {
  const calls = { ensure: [], rpc: [], guards: [], coordinator: 0 };
  const pending = new Map();
  const checkStarted = new Map();
  const checkStartSignals = new Map(['master', 'requests'].map(key => [key,
    new Promise(resolve => checkStarted.set(key, resolve)),
  ]));
  const verified = new Set();
  const state = { owner: 1, scope: 'synthetic-read-scope', capabilities };
  const acknowledgement = { client_batch_id: batchId, rows: requests };
  const coordinator = {
    ensure(adapter) {
      calls.ensure.push(adapter.key);
      checkStarted.get(adapter.key)?.();
      if (adapter.key === rejectedKey) return Promise.reject(new Error('Synthetic metadata read failed'));
      const accept = value => { if (value) verified.add(adapter.key); return value; };
      if (!held) return Promise.resolve(accept(adapter.key !== failedKey));
      return new Promise((resolve, reject) => pending.set(adapter.key, {
        resolve: value => resolve(accept(value)), reject,
      }));
    },
  };
  const context = vm.createContext({
    nativeAuthSessionActive: native,
    SUPABASE_WRITE_TIMEOUT_MS: 12000,
    requestCapabilityState: { stale: false },
    captureLoginSessionOwnership: () => ({ generation: state.owner }),
    isLoginSessionOwnershipCurrent: owner => owner.generation === state.owner,
    getSupabaseReadIdentityScope: () => state.scope,
    getRequestCapabilities: () => state.capabilities,
    canUseProductionLiveSync: () => liveSync,
    getProductionLiveSyncCoordinator: () => { calls.coordinator++; return coordinator; },
    createProductionCoreLiveAdapter: key => ({ key }),
    requireVerifiedProductionData(keys) {
      calls.guards.push(Array.from(keys));
      if (finalGuardFails || !liveSync || keys.some(key => !verified.has(key))) {
        throw Object.assign(new Error('Current data has not been verified'), { code: 'DATA_NOT_VERIFIED' });
      }
    },
    supabaseRpc: async (...args) => { calls.rpc.push(args); return acknowledgement; },
  });
  vm.runInContext(declarations.get('commitRequestBatchWithVerifiedData'), context);
  return {
    calls, state, context, acknowledgement,
    submit: (source = 'av') => context.commitRequestBatchWithVerifiedData(source, batchId, requests),
    waitForCheck: key => checkStartSignals.get(key),
    release: (key, value = true) => {
      assert.ok(pending.has(key), `${key} verification is pending`);
      pending.get(key).resolve(value);
    },
  };
}

test('creation waits for both verification checks before the protected RPC', async () => {
  const f = fixture({ held: true });
  const result = f.submit();
  assert.deepEqual(f.calls.ensure, ['master']);
  assert.equal(f.calls.rpc.length, 0);
  f.release('master');
  await f.waitForCheck('requests');
  assert.deepEqual(f.calls.ensure, ['master', 'requests']);
  assert.equal(f.calls.rpc.length, 0, 'Request verification still blocks the write');
  f.release('requests');
  assert.equal(await result, f.acknowledgement);
  assert.equal(f.calls.rpc.length, 1);
  assert.deepEqual(f.calls.guards, [['master', 'requests']], 'the existing final freshness guard remains enforced');
});

for (const source of ['av', 'general']) {
  test(`${source} creation and retry preserve the idempotency key and request payload`, async () => {
    const f = fixture();
    assert.equal(await f.submit(source), f.acknowledgement);
    assert.equal(await f.submit(source), f.acknowledgement);
    assert.equal(f.calls.rpc.length, 2);
    for (const [rpcName, body, options] of f.calls.rpc) {
      assert.equal(rpcName, source === 'av' ? 'create_av_request_batch' : 'create_request_batch');
      assert.equal(body.client_batch_id, batchId);
      assert.equal(body.requests, requests, 'the saved batch is not rebuilt with different IDs');
      assert.equal(options.timeoutMs, 30000);
    }
  });
}

for (const key of ['master', 'requests']) {
  test(`${key} verification returning false cannot reach the RPC`, async () => {
    const f = fixture({ failedKey: key });
    await assert.rejects(f.submit(), { code: 'DATA_NOT_VERIFIED' });
    assert.equal(f.calls.rpc.length, 0);
  });
  test(`${key} verification failure cannot reach the RPC`, async () => {
    const f = fixture({ rejectedKey: key });
    await assert.rejects(f.submit(), /Synthetic metadata read failed/);
    assert.equal(f.calls.rpc.length, 0);
  });
}

test('a fresh invalidation after awaited checks still fails the final guard', async () => {
  const f = fixture({ finalGuardFails: true });
  await assert.rejects(f.submit(), { code: 'DATA_NOT_VERIFIED' });
  assert.deepEqual(f.calls.ensure, ['master', 'requests']);
  assert.equal(f.calls.rpc.length, 0);
});

for (const dependency of ['master', 'requests']) {
  for (const change of ['owner', 'scope', 'capability', 'stale']) {
    test(`${change} changing during ${dependency} verification prevents creation`, async () => {
      const f = fixture({ held: true });
      const result = f.submit();
      if (dependency === 'requests') {
        f.release('master');
        await f.waitForCheck('requests');
      }
      if (change === 'owner') f.state.owner++;
      if (change === 'scope') f.state.scope = 'different-read-scope';
      if (change === 'capability') f.state.capabilities = { canCreateAv: false, canCreateGeneral: true };
      if (change === 'stale') f.context.requestCapabilityState.stale = true;
      f.release(dependency);
      await assert.rejects(result, { code: ['owner', 'scope'].includes(change) ? 'REQUEST_ABORTED' : 'REQUEST_CREATE_FORBIDDEN' });
      assert.equal(f.calls.rpc.length, 0);
    });
  }
}

test('missing or denied creation capability fails before checking data or writing', async () => {
  for (const capabilities of [null, { canCreateAv: false, canCreateGeneral: true }]) {
    const f = fixture({ capabilities });
    await assert.rejects(f.submit('av'), { code: 'REQUEST_CREATE_FORBIDDEN' });
    assert.deepEqual(f.calls.ensure, []);
    assert.equal(f.calls.rpc.length, 0);
  }
});

test('native mode without usable live sync fails closed before getting a coordinator', async () => {
  const f = fixture({ liveSync: false });
  await assert.rejects(f.submit(), { code: 'DATA_NOT_VERIFIED' });
  assert.equal(f.calls.coordinator, 0);
  assert.equal(f.calls.rpc.length, 0);
});

test('legacy mode reaches the existing RPC without creating a native coordinator', async () => {
  const f = fixture({ native: false, liveSync: false });
  assert.equal(await f.submit(), f.acknowledgement);
  assert.equal(f.calls.coordinator, 0);
  assert.deepEqual(f.calls.guards, []);
  assert.equal(f.calls.rpc[0][0], 'create_av_request_batch');
});

test('initial submission and durable retry use the shared verification boundary', () => {
  const initial = declarations.get('finalizeRequestAction');
  const retry = declarations.get('flushRequestOutbox');
  assert.match(initial, /await commitRequestBatchWithVerifiedData\(requestSource, clientBatchId, insertPayloads\)/);
  assert.match(retry, /await commitRequestBatchWithVerifiedData\(entry\.requestSource, entry\.clientBatchId, entry\.requests \|\| \[\]\)/);
  for (const source of [initial, retry]) {
    assert.doesNotMatch(source, /supabaseRpc\([\s\S]{0,120}['"]create_(?:av_)?request_batch['"]/);
  }
});
