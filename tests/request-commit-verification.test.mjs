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

function submittedBatch(source, suffix, overrides = {}) {
  return {
    clientBatchId: `98000000-0000-4000-8000-0000000000${suffix}`,
    username: 'synthetic-current-user',
    status: 'pending',
    requestSource: source,
    requests: [{ unique_id: `synthetic-${suffix}`, master_id: 'synthetic-master', req_qty: '7' }],
    createdAt: '2026-09-10T10:00:00.000Z',
    attempts: 0,
    ...overrides,
  };
}

function flushFixture(records, { rpcError, heldRpc = false, ...verificationOptions } = {}) {
  const f = fixture({ native: false, ...verificationOptions });
  const disk = new Map(structuredClone(records).map(record => [record.clientBatchId, record]));
  const storage = { reads: 0, saved: [], deleted: [], dirty: [] };
  let releaseRpc;
  let signalRpcStarted;
  const rpcStarted = new Promise(resolve => { signalRpcStarted = resolve; });
  const rpcGate = heldRpc ? new Promise(resolve => { releaseRpc = resolve; }) : Promise.resolve();
  Object.assign(f.context, {
    currentUser: 'synthetic-current-user',
    navigator: { onLine: true },
    REQUEST_OUTBOX_STORE: 'request_outbox',
    ACTIVE_REQUEST_TABLE: 'synthetic_request_table',
    requestsInventory: [],
    async getAllIndexedDbRecords(store) {
      assert.equal(store, 'request_outbox');
      storage.reads++;
      return structuredClone([...disk.values()]);
    },
    async deleteIndexedDbRecord(store, id) {
      assert.equal(store, 'request_outbox');
      storage.deleted.push(id);
      disk.delete(id);
    },
    async saveRequestOutboxEntry(entry) {
      storage.saved.push(structuredClone(entry));
      disk.set(entry.clientBatchId, structuredClone(entry));
    },
    async supabaseRpc(...args) {
      f.calls.rpc.push(args);
      signalRpcStarted();
      await rpcGate;
      if (rpcError) throw rpcError;
      return { client_batch_id: args[1].client_batch_id, rows: args[1].requests };
    },
    formatFetchedRows: rows => rows,
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
    findRequestInventoryRowByUniqueId: id => f.context.requestsInventory.find(row => row.unique_id === id),
    rebuildRequestInventoryIndexes() {},
    markDatasetDirty: (...args) => storage.dirty.push(args),
    refreshLocalRequestViewState() {},
    triggerRequestRealtimeUiRefresh() {},
  });
  vm.runInContext(`let requestOutboxFlushPromise = null;\n${declarations.get('flushRequestOutbox')}`, f.context);
  return {
    ...f, disk, storage, rpcStarted,
    releaseRpc: () => releaseRpc(),
    flush: reason => f.context.flushRequestOutbox(reason),
  };
}

test('outbox retry preserves unsent drafts and malformed records without counting or submitting them', async () => {
  const records = [
    { clientBatchId: 'verified-cache-draft', username: 'synthetic-current-user', state: 'draft', note: 'Unsent synthetic draft' },
    submittedBatch('av', '01', { state: 'draft' }),
    submittedBatch('av', '02', { status: undefined }),
    submittedBatch('av', '03', { status: 'sent' }),
    submittedBatch('av', '04', { clientBatchId: '   ' }),
    submittedBatch('unknown', '05'),
    submittedBatch('av', '06', { requests: undefined }),
    submittedBatch('av', '07', { requests: [] }),
    submittedBatch('av', '08', { requests: { unique_id: 'not-an-array' } }),
    submittedBatch(undefined, '09'),
  ];
  const f = flushFixture(records);
  const before = JSON.stringify([...f.disk.values()]);
  assert.deepEqual(structuredClone(await f.flush('online')), { sent: 0, pending: 0 });
  assert.equal(f.calls.rpc.length, 0);
  assert.deepEqual(f.storage.saved, []);
  assert.deepEqual(f.storage.deleted, []);
  assert.deepEqual(f.storage.dirty, []);
  assert.equal(JSON.stringify([...f.disk.values()]), before, 'skipped records remain byte-for-byte unchanged');
});

test('outbox retries submitted AV and General batches with their saved IDs and payloads', async () => {
  const draft = { clientBatchId: 'unsent-draft', state: 'draft', note: 'Keep this local' };
  const av = submittedBatch('av', '11', { createdAt: '2026-09-10T10:01:00.000Z' });
  const general = submittedBatch('general', '12');
  const f = flushFixture([draft, av, general]);
  assert.deepEqual(structuredClone(await f.flush('online')), { sent: 2, pending: 0 });
  assert.deepEqual(f.calls.rpc.map(([name]) => name), ['create_request_batch', 'create_av_request_batch']);
  for (const [index, entry] of [general, av].entries()) {
    const [, body, options] = f.calls.rpc[index];
    assert.equal(body.client_batch_id, entry.clientBatchId);
    assert.deepEqual(structuredClone(body.requests), entry.requests);
    assert.equal(options.timeoutMs, 30000);
  }
  assert.deepEqual(f.storage.deleted, [general.clientBatchId, av.clientBatchId]);
  assert.deepEqual(f.storage.saved, []);
  assert.deepEqual([...f.disk.values()], [draft]);
  assert.deepEqual(f.storage.dirty, [['requests', 'request-outbox:online']]);
});

test('failed submitted batches remain pending with their original payload while drafts stay untouched', async () => {
  const draft = { clientBatchId: 'unsent-draft', state: 'draft', note: 'Keep this local' };
  const entry = submittedBatch('av', '21', { attempts: 2, customField: 'preserve-me' });
  const f = flushFixture([draft, entry], { rpcError: Object.assign(new Error('Synthetic unavailable response'), { status: 503 }) });
  assert.deepEqual(structuredClone(await f.flush()), { sent: 0, pending: 1 });
  assert.equal(f.calls.rpc.length, 1);
  assert.deepEqual(f.storage.deleted, []);
  assert.equal(f.storage.saved.length, 1);
  const saved = f.disk.get(entry.clientBatchId);
  const { attempts, lastErrorCode, lastAttemptAt, ...retained } = saved;
  const { attempts: originalAttempts, ...original } = entry;
  assert.deepEqual(retained, original);
  assert.equal(attempts, originalAttempts + 1);
  assert.equal(lastErrorCode, 'HTTP_503');
  assert.ok(Number.isFinite(Date.parse(lastAttemptAt)));
  assert.deepEqual(f.disk.get(draft.clientBatchId), draft);
  assert.deepEqual(f.storage.dirty, []);
});

test('outbox verification failures retain submitted batches without reaching the write RPC', async () => {
  const entry = submittedBatch('av', '31');
  const f = flushFixture([entry], { native: true, failedKey: 'master' });
  assert.deepEqual(structuredClone(await f.flush()), { sent: 0, pending: 1 });
  assert.deepEqual(f.calls.ensure, ['master', 'requests']);
  assert.equal(f.calls.rpc.length, 0);
  assert.deepEqual(f.storage.deleted, []);
  const saved = f.disk.get(entry.clientBatchId);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.clientBatchId, entry.clientBatchId);
  assert.deepEqual(saved.requests, entry.requests);
  assert.equal(saved.attempts, 1);
  assert.equal(saved.lastErrorCode, 'REQUEST_COMMIT_FAILED');
});

test('concurrent outbox flushes share one retry and can run again after completion', async () => {
  const entry = submittedBatch('general', '41');
  const f = flushFixture([entry], { heldRpc: true });
  const first = f.flush('online');
  await f.rpcStarted;
  const second = f.flush('resume');
  assert.equal(f.storage.reads, 1);
  assert.equal(f.calls.rpc.length, 1);
  assert.deepEqual(f.storage.deleted, []);
  f.releaseRpc();
  const results = await Promise.all([first, second]);
  for (const result of results) assert.deepEqual(structuredClone(result), { sent: 1, pending: 0 });
  assert.deepEqual(f.storage.deleted, [entry.clientBatchId]);
  assert.deepEqual(structuredClone(await f.flush('manual')), { sent: 0, pending: 0 });
  assert.equal(f.storage.reads, 2, 'a completed flush releases its concurrency guard');
  assert.equal(f.calls.rpc.length, 1, 'an acknowledged batch is not submitted twice');
});
