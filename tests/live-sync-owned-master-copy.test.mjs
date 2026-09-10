import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sandbox = { module: { exports: {} }, setTimeout, clearTimeout };
vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), sandbox);
const { createCoordinator, copyOwnedSnapshot } = sandbox.module.exports;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  for (let index = 0; index < 300; index++) { if (predicate()) return; await Promise.resolve(); }
  assert.fail('Expected asynchronous boundary was not reached');
}
function graph(label = 'server', count = 700) {
  const data = Array.from({ length: count }, (_, index) => ({ UNIQUE_ID: `synthetic-${index}`,
    ...Object.fromEntries(Array.from({ length: 32 }, (_, field) => [`field${field}`, `${label}-${field}`])) }));
  return { data, _preparedMasterList: { version: 'master-list-v1', rows: data,
    byId: new Map(data.map(row => [row.UNIQUE_ID, row])),
    byExactKey: new Map(data.map(row => [row.UNIQUE_ID, row])),
    byItemCode: new Map(data.map(row => [row.UNIQUE_ID, [row]])) } };
}
function assertGraph(value, count = 700) {
  assert.equal(value.data.length, count);
  assert.equal(value.data, value._preparedMasterList.rows);
  assert.equal(value._preparedMasterList.byId.get('synthetic-0'), value.data[0]);
  assert.equal(value._preparedMasterList.byExactKey.get('synthetic-0'), value.data[0]);
  assert.equal(value._preparedMasterList.byItemCode.get('synthetic-0')[0], value.data[0]);
}
function fixture(overrides = {}) {
  const state = { revision: '1', permission: 'permission-1', readIdentity: 'account/auth-1/permission-1',
    reads: 0, metadataReads: 0, yields: 0, commits: [], saved: [], stages: [], events: [],
    onYield: null, onStage: null, onMetadata: null };
  const master = { id: 'core:master', cacheKey: 'master/list-v1', sourceKeys: ['ph_master_inventory'], snapshotOwnership: 'coordinator',
    stage: async () => {
      state.reads++; state.events.push('stage');
      const value = graph(`${context.scope}/${master.cacheKey}/revision-${state.revision}`);
      state.stages.push(value); if (state.onStage) await state.onStage(); return value;
    } };
  const context = { scope: 'account-a', viewKey: 'drive', visible: true, online: true, adapters: [master], backgroundAdapters: [] };
  let timer = 0;
  const coordinator = createCoordinator({ getContext: () => context, getSnapshotReadIdentity: () => state.readIdentity,
    readRevisions: async keys => {
      state.metadataReads++; state.events.push('metadata');
      const response = { contractVersion: 1, permissionVersion: state.permission,
        sources: keys.map(key => ({ key, revision: state.revision, state: 'ready' })) };
      if (state.onMetadata) await state.onMetadata(state.metadataReads, response); return response;
    },
    yieldToUi: async () => { state.yields++; state.events.push('yield'); if (state.onYield) await state.onYield(); },
    saveOwnedSnapshot: entry => { state.events.push('save'); state.saved.push(entry); },
    commitSnapshots: (items, ctx, meta) => { state.events.push('commit'); state.commits.push({ items, scope: ctx.scope, meta }); },
    setTimeout: () => ++timer, clearTimeout() {}, ...overrides });
  return { state, master, context, coordinator };
}

test('bounded graph copy yields and preserves every row, Map/Set/Date/cycle identity', async () => {
  const source = graph(); const date = new Date('2026-09-10T00:00:00Z');
  source.date = source.sameDate = date; source.set = new Set([source.data[0]]); source.self = source;
  let yields = 0, settled = false;
  const pending = copyOwnedSnapshot(source, { now: () => 0, yieldToUi: async () => { yields++; assert.equal(settled, false); } });
  const copied = await pending; settled = true;
  assert.ok(yields >= 3, 'a large graph cannot be copied in one task even with a frozen clock');
  assertGraph(copied); assert.equal(copied.self, copied); assert.equal(copied.date, copied.sameDate);
  assert.notEqual(copied.date, date); assert.equal(copied.date.getTime(), date.getTime());
  assert.equal([...copied.set][0], copied.data[0]);
  copied.data[0].field0 = 'LOCAL DRAFT'; assert.equal(source.data[0].field0, 'server-0');
});

test('all owned UI/disk copies precede the final metadata fence and retain independent ownership', async () => {
  const f = fixture();
  f.state.onYield = async () => { assert.equal(f.state.commits.length, 0); assert.equal(f.state.saved.length, 0); };
  assert.equal(await f.coordinator.check(), true);
  assert.ok(f.state.yields > 0); assert.equal(f.state.metadataReads, 2);
  const lastMetadata = f.state.events.lastIndexOf('metadata');
  assert.ok(f.state.events.lastIndexOf('yield') < lastMetadata);
  assert.deepEqual(f.state.events.slice(lastMetadata), ['metadata', 'save', 'commit']);
  const original = f.state.stages[0], ui = f.state.commits[0].items[0].value, disk = f.state.saved[0].value;
  [original, ui, disk].forEach(value => assertGraph(value));
  assert.notEqual(ui, original); assert.notEqual(disk, original); assert.notEqual(ui, disk);
  ui.data[0].field0 = 'UI DRAFT'; disk.data[1].field0 = 'PERSISTENCE-OWNED';
  assert.match(original.data[0].field0, /revision-1/); assert.match(original.data[1].field0, /revision-1/);
  assert.match(disk.data[0].field0, /revision-1/); assert.match(ui.data[1].field0, /revision-1/);
  const reads = f.state.reads, metadata = f.state.metadataReads, yields = f.state.yields;
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.state.reads, reads); assert.equal(f.state.metadataReads, metadata + 1);
  assert.equal(f.state.yields, yields, 'already-applied unchanged polling does not copy or create a feedback loop');
});

test('changed source during bounded copies discards old prepared data before any persistence/commit', async () => {
  const f = fixture(); let changed = false;
  f.state.onYield = () => { if (!changed) { changed = true; f.state.revision = '2'; } };
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.state.reads, 2); assert.equal(f.state.commits.length, 1); assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.saved[0].sources[0].revision, '2');
  assert.match(f.state.commits[0].items[0].value.data[0].field0, /revision-2/);
});

for (const kind of ['account', 'query', 'auth-epoch']) test(`${kind} change during a copy cancels old work and retries under the current identity`, async () => {
  const f = fixture(); let changed = false;
  f.state.onYield = () => {
    if (changed) return; changed = true;
    if (kind === 'account') f.context.scope = 'account-b';
    else if (kind === 'query') f.master.cacheKey = 'master/list-v2';
    else f.state.readIdentity = 'account/auth-2/permission-1';
  };
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.state.commits.length, 1); assert.equal(f.state.saved.length, 1); assert.equal(f.state.reads, 2);
  assert.equal(f.state.commits[0].scope, f.context.scope);
  assert.equal(f.state.saved[0].cacheKey, f.master.cacheKey);
});

test('same-scope auth change during the final metadata request cannot publish prepared data', async () => {
  const f = fixture();
  f.state.onMetadata = index => { if (index === 2) f.state.readIdentity = 'account/auth-2/permission-1'; };
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.state.reads, 2); assert.equal(f.state.saved.length, 1); assert.equal(f.state.commits.length, 1);
});

test('the phase identity is not silently recaptured between the disk-copy and UI-copy awaits', async () => {
  const f = fixture(); let queued = false;
  f.master.stage = async () => {
    f.state.reads++;
    const value = graph(`auth-stage-${f.state.reads}`, 1);
    if (!queued) {
      const map = value._preparedMasterList.byItemCode, entries = map.entries.bind(map);
      Object.defineProperty(map, 'entries', { value: () => {
        const iterator = entries();
        return { next: () => {
          const next = iterator.next();
          if (next.done && !queued) {
            queued = true;
            // This final Map is visited at the end of the small disk copy.
            // Its data stay immutable, while identity changes before the await
            // continuation starts the separate UI copy.
            queueMicrotask(() => { f.state.readIdentity = 'account/auth-2/permission-1'; });
          }
          return next;
        } };
      } });
    }
    return value;
  };
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.state.reads, 2, 'old-auth retained stage promises must not be reused under the new anchor');
  assert.equal(f.state.saved.length, 1); assert.equal(f.state.commits.length, 1);
  assert.match(f.state.commits[0].items[0].value.data[0].field0, /auth-stage-2/);
});

test('stable warm cache previews while changed row reads are held, after fresh authorization and without sharing drafts', async () => {
  const diskValue = graph('saved'), gate = deferred(), previewReady = deferred();
  const f = fixture({ loadStableSnapshot: async (adapter, ctx) => ({ contractVersion: 1, id: adapter.id,
    cacheKey: adapter.cacheKey, scope: ctx.scope, permissionVersion: 'permission-1',
    sources: [{ key: 'ph_master_inventory', revision: '1', state: 'ready' }], verifiedAt: 1, value: diskValue }),
    previewSnapshots: items => { previewReady.resolve(items); } });
  f.state.revision = '2'; f.state.onStage = () => gate.promise;
  const checking = f.coordinator.check(), previews = await previewReady.promise;
  assert.ok(f.state.metadataReads >= 2, 'yielding the preview must be followed by an authorization fence');
  assert.equal(f.state.commits.length, 0); assert.equal(f.coordinator.isVerified(f.master), false);
  assertGraph(previews[0].value); previews[0].value.data[0].field0 = 'READ-ONLY PREVIEW MUTATION';
  assert.equal(diskValue.data[0].field0, 'saved-0');
  await until(() => f.state.reads === 1); gate.resolve(); assert.equal(await checking, true);
  assert.match(f.state.commits[0].items[0].value.data[0].field0, /revision-2/);
});

test('generic mutable adapter results still capture immediately before another master copy yields', async () => {
  const shared = [{ id: 'generic', nested: { value: 'server' } }];
  const f = fixture();
  f.context.adapters.push({ id: 'side:generic', cacheKey: 'generic/all', sourceKeys: ['generic'], stage: async () => shared });
  f.state.onYield = () => { shared[0].nested.value = 'LATE PRODUCER MUTATION'; };
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.state.commits[0].items.find(item => item.adapter.id === 'side:generic').value[0].nested.value, 'server');
});

test('a newer denied-source observation prevents an older in-flight preview authorization from painting', async () => {
  const gate = deferred(); let previews = 0;
  const f = fixture({ loadStableSnapshot: async (adapter, ctx) => ({ contractVersion: 1, id: adapter.id,
    cacheKey: adapter.cacheKey, scope: ctx.scope, permissionVersion: 'permission-1',
    sources: [{ key: 'ph_master_inventory', revision: '1', state: 'ready' }], verifiedAt: 1, value: graph('saved') }),
    previewSnapshots: () => { previews++; } });
  f.state.revision = '2';
  f.state.onMetadata = async (index, response) => {
    if (index === 2) await gate.promise;
    if (index >= 3) response.sources.forEach(source => { source.state = 'unavailable'; source.revision = null; });
  };
  const checking = f.coordinator.check(); await until(() => f.state.metadataReads === 2);
  const observer = { id: 'badge:access-observer', cacheKey: 'access/all', sourceKeys: ['ph_master_inventory'], stage: async () => [] };
  assert.equal(await f.coordinator.ensure(observer), false);
  gate.resolve(); assert.equal(await checking, false);
  assert.equal(previews, 0); assert.equal(f.state.reads, 0); assert.equal(f.state.commits.length, 0);
});

test('A to B to A navigation during final metadata retries if a newly required master commit was not prepared', async () => {
  const f = fixture(); assert.equal(await f.coordinator.check(), true);
  const gate = deferred(), originalKey = f.master.cacheKey;
  const joined = { id: 'side:joined', cacheKey: 'joined/all', sourceKeys: ['joined'], stage: async () => [] };
  f.context.adapters = [f.master, joined];
  f.state.onMetadata = async index => { if (index === 4) await gate.promise; };
  const checkingA = f.coordinator.check(); await until(() => f.state.metadataReads === 4);
  f.master.cacheKey = 'master/list-B'; f.context.viewKey = 'view-B'; f.context.adapters = [f.master];
  assert.equal(await f.coordinator.check(), true);
  f.master.cacheKey = originalKey; f.context.viewKey = 'drive'; f.context.adapters = [f.master, joined];
  gate.resolve(); assert.equal(await checkingA, true);
  assert.equal(f.state.reads, 2, 'the retry reuses A canonical values instead of re-downloading them');
  assert.equal(f.state.commits.length, 3);
  const finalMaster = f.state.commits.at(-1).items.find(item => item.adapter.id === 'core:master');
  assertGraph(finalMaster.value);
  assert.match(finalMaster.value.data[0].field0, /master\/list-v1/);
  assert.equal(f.coordinator.isVerified(f.master), true);
});

test('owned storage errors remain optional and cannot prevent a verified UI commit', async () => {
  const f = fixture({ saveOwnedSnapshot: () => { throw new Error('Synthetic disk full'); } });
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.state.commits.length, 1); assert.equal(f.coordinator.isVerified(f.master), true);
});
