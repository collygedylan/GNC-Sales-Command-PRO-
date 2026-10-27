import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness() {
  const context = { setTimeout, clearTimeout, AbortController, Date, Map, Set };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../assets/queue-inventory-hydration.js', import.meta.url), 'utf8'), context);
  return context.AgMetricQueueInventory;
}
const row = (extra = {}) => ({ unique_id:'master-1',itemcode:'004380.010.1',locationcode:'C.09.000',lotcode:'27.F1',source:'1',ptronhand:89,ptrreviewed:27,ptravailable:62,s_lts:61,...extra });
const identity = { itemCode:'43800101',locationCode:' c.9.0 ',lotCode:'27.F1',source:'1' };

function productionQueueHydrationHarness({ authorized = true, rows = [], complete = true, rpcRows = null } = {}) {
  const html = readComposedAppSource().replace(/\r\n/g, '\n');
  const signal = new AbortController().signal;
  const authorizationScope = JSON.stringify(['actor', 'dylan', 'ADMIN', 'login']);
  const context = {
    setTimeout: () => 1, clearTimeout() {}, Date, Map, Set, AbortController,
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? null,
    getQueueCardInventoryContext: null,
    canUseProductionLiveSync: () => authorized,
    nativeAuthProfile: { id: 'actor' }, currentUser: 'dylan', currentRole: 'ADMIN', getCurrentLoginCacheScopeKey: () => 'login',
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'permission-v3' } },
    getProductionLiveSyncContext: () => ({ scope: authorizationScope, dataPermissionVersion: 'permission-v3' }),
    getSupabaseReadIdentityScope: () => 'authorized-scope',
    productionLiveSyncNavigation: { signal },
    getDatasetState: () => ({ initialLoaded: complete, rowCompleteness: complete ? 'complete' : 'partial',
      liveVerifiedScope: authorizationScope, liveVerifiedPermission: 'permission-v3', liveVerifiedRevision: complete ? '42' : '' }),
    masterInventoryById: new Map(rows.map(value => [value.unique_id, value])),
    masterInventoryLookup: null,
    fullInventory: rows,
    isDockSuspendDcRequestMirrorRow: () => false,
    getSuspendTagInventoryIdentity: item => ({ masterUid: item.MASTER_ID || '', itemCode: item.ITEMCODE || '',
      locationCode: item.LOCATIONCODE || '', lotCode: item.LOTCODE || '', source: item.SOURCE || '' }),
    markViewDirty() {}, isViewVisible: () => false, scheduleRequestRender() {}, scheduleDocksRender() {},
    requestInventoryRead: async (_operation, payload) => ({ rows: rpcRows || payload.queueIdentities.map((_, inputIndex) => ({ inputIndex, matchCount: 0, row: null })), inventoryRevision: '43' }),
    validateInventoryReadProjection() {}, stampCardLocationOnHandReceipt() {},
    window: null
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../assets/queue-inventory-hydration.js', import.meta.url), 'utf8'), context);
  const start = html.indexOf('        let queueCardInventoryHydrator = null;');
  const end = html.indexOf('\n        const suspendTagReclassLoads = new Map();', start);
  assert.ok(start >= 0 && end > start, 'production queue resolver block exists');
  vm.runInContext(html.slice(start, end), context);
  vm.runInContext('flushQueueCardInventoryHydration = () => queueCardInventoryHydrator?.flush()', context);
  return context;
}

test('queue inventory canonicalizes ERP item/location without collapsing lots or arbitrary identifiers', () => {
  const q=harness();
  assert.equal(q.normalizeItem('004380.010.1'),q.normalizeItem('43800101'));
  assert.notEqual(q.normalizeItem('001'),q.normalizeItem('1'),'short numeric catalog identifiers keep their leading-zero identity');
  assert.equal(q.normalizeLocation(' c.9.0 '),'C.09.000');
  assert.notEqual(q.normalizeItem('SKU.1'),q.normalizeItem('SKU1'));
  assert.ok(q.matches(row(),identity));
  assert.ok(!q.matches(row({lotcode:'27.F2'}),identity));
  assert.ok(!q.matches(row({source:'2'}),identity));
  assert.ok(!q.matches(row(),{...identity,masterUid:'other'}));
  assert.ok(q.matches(row(),{masterUid:'master-1'}),'a server-linked unique ID can hydrate a request whose lot field is absent');
  assert.ok(!q.matches(row(),{...identity,lotCode:''}),'without a unique ID an absent lot must never broaden the join');
});

test('queue index resolves exact rows, rejects ambiguous identities, and preserves true null and zero', () => {
  const q=harness(), first=row({ptronhand:0,s_lts:null});
  const index=q.createIndex([first,row({unique_id:'master-2',lotcode:'27.F2'})]);
  assert.equal(index.resolve(identity).row,first);
  assert.equal(index.resolve(identity).row.ptronhand,0);
  assert.equal(index.resolve(identity).row.s_lts,null);
  assert.equal(q.createIndex([first,row({unique_id:'master-3'})]).resolve(identity).status,'ambiguous');
  assert.equal(index.resolve({...identity,lotCode:'missing'}).status,'missing',
    'a supplied nonmatching lot never guesses among other physical rows');
});

test('queue display hydration allows same-location fallback only when the lot is absent', () => {
  const q = harness();
  const master = row({ locationcode:' c.9.0 ', lotcode:'27.F1', source:'DRIVE', ptronhand:90,
    ptrreviewed:25, ptravailable:65, s_lts:57, loc_match_qty:42, priority:10, holdstop:'H',
    holdstopreason:'light roots; thin body' });
  const socWithoutLot = { ...identity, lotCode:'', source:'SOC' };
  const resolved = q.createIndex([master]).resolve(socWithoutLot);
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.row, master);
  assert.equal(resolved.row.loc_match_qty, 42);
  assert.equal(resolved.row.priority, 10);
  assert.equal(resolved.row.holdstopreason, 'light roots; thin body');

  const repeatedPhysicalLots = q.createIndex([master, row({ unique_id:'master-2', lotcode:'27.F2', source:'DRIVE' })]);
  assert.equal(repeatedPhysicalLots.resolve(socWithoutLot).status, 'ambiguous',
    'item-location fallback must not discard or select among multiple physical master rows');

  assert.equal(q.createIndex([master, row({ locationcode:'D.01.000', lotcode:'27.F3' })])
    .resolve({ ...identity, lotCode:'27.F3' }).status, 'missing', 'a matching lot at another location cannot be used');
  assert.equal(q.createIndex([master]).resolve({ ...socWithoutLot, masterUid:'missing-master-id' }).status, 'missing',
    'an explicit but stale master identity never falls back to another physical line');
});

test('queue hydration batches card reads, shares duplicates, and reports unresolved states explicitly', async () => {
  const q=harness(), controller=new AbortController(), calls=[];
  const context={scope:'a',permission:'p1',revision:'1',signal:controller.signal};
  const h=q.createHydrator({context:()=>context,load:async ids=>{
    calls.push(ids);return ids.map((_,inputIndex)=>({inputIndex,matchCount:inputIndex===1?0:1,row:inputIndex===1?null:row()}));
  }});
  assert.equal(h.read(identity).status,'loading');
  h.read(identity);h.read({...identity,lotCode:'missing'});
  await h.flush();
  assert.equal(calls.length,1);assert.equal(calls[0].length,2);
  assert.equal(h.read(identity).status,'ready');
  assert.equal(h.read({...identity,lotCode:'missing'}).status,'missing');
  h.dispose();
});

test('queue hydration rejects stale account, navigation and revision responses without exposing rows', async () => {
  for (const change of ['scope','permission','revision','navigation']) {
    const q=harness(), controller=new AbortController();
    let context={scope:'a',permission:'p1',revision:'1',signal:controller.signal}, finish;
    const h=q.createHydrator({context:()=>context,load:()=>new Promise(resolve=>{finish=resolve;})});
    h.read(identity);const pending=h.flush();
    if(change==='navigation'){controller.abort();context={...context,signal:new AbortController().signal};}
    else context={...context,[change]:'changed'};
    finish([{inputIndex:0,matchCount:1,row:row()}]);await pending;
    assert.equal(h.read(identity).row,null,change);h.dispose();
  }
});

test('queue hydration retries an in-flight identity after its revision or navigation signal changes', async () => {
  for (const change of ['revision', 'navigation']) {
    const q = harness(), firstController = new AbortController();
    let context = { scope:'a', permission:'p1', revision:'1', signal:firstController.signal };
    const resolvers = [], batches = [];
    const h = q.createHydrator({ context:() => context, load:identities => new Promise(resolve => {
      batches.push(identities);
      resolvers.push(resolve);
    }) });

    assert.equal(h.read(identity).status, 'loading', change);
    const firstFlush = h.flush();
    if (change === 'revision') context = { ...context, revision:'2' };
    else {
      firstController.abort();
      context = { ...context, signal:new AbortController().signal };
    }

    assert.equal(h.read(identity).status, 'loading', `${change}: fresh proof is required`);
    resolvers[0]([{ inputIndex:0, matchCount:1, row:row({ ptronhand:89 }) }]);
    await firstFlush;

    for (let turn = 0; batches.length < 2 && turn < 20; turn++) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(batches.length, 2, `${change}: the new context must dispatch a fresh batch`);
    assert.equal(batches[1].length, 1);
    const secondFlush = h.flush();
    resolvers[1]([{ inputIndex:0, matchCount:1, row:row({ ptronhand:93 }) }]);
    await secondFlush;
    assert.equal(h.read(identity).status, 'ready', change);
    assert.equal(h.read(identity).row.ptronhand, 93, change);
    h.dispose();
  }
});

test('queue hydration rejects contradictory results and retries errors without converting missing stock to zero', async () => {
  const q=harness(), context={scope:'a',permission:'p',revision:'1',signal:new AbortController().signal};
  let bad=true;
  const h=q.createHydrator({context:()=>context,load:async()=>[{inputIndex:0,matchCount:1,row:row({lotcode:bad?'wrong':'27.F1'})}]});
  h.read(identity);await h.flush();assert.equal(h.read(identity).status,'error');
  bad=false;h.invalidate();h.read(identity);await h.flush();assert.equal(h.read(identity).row.ptronhand,89);h.dispose();
});

test('production Que resolver returns only authorized exact, unique inventory rows', async () => {
  const linkedRequest = { MASTER_ID: 'master-1', ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000', LOTCODE: '27.F1', SOURCE: '1' };
  const exact = row({ PHOTO_LINK: 'https://storage.example.test/master.webp' });

  const denied = productionQueueHydrationHarness({ authorized: false, rows: [exact] });
  assert.equal(denied.getQueueCardInventoryRow(linkedRequest, 'request'), null,
    'without the live-sync permission/context the resolver cannot expose a cached row');

  const ambiguous = productionQueueHydrationHarness({ rows: [exact, row({ unique_id: 'master-2' })] });
  const ambiguousIdentity = { ...linkedRequest, MASTER_ID: '' };
  assert.equal(ambiguous.getQueueCardInventoryRow(ambiguousIdentity, 'request'), null,
    'an ambiguous full-cache identity never selects the first candidate');

  const missing = productionQueueHydrationHarness({ complete: false, rpcRows: [{ inputIndex: 0, matchCount: 0, row: null }] });
  assert.equal(missing.getQueueCardInventoryRow(linkedRequest, 'request'), null,
    'an unresolved identity remains null while batched hydration is pending');
  await missing.flushQueueCardInventoryHydration();
  assert.equal(missing.getQueueCardInventoryRow(linkedRequest, 'request'), null,
    'a server-confirmed missing match remains null');

  const verified = productionQueueHydrationHarness({ rows: [exact] });
  assert.equal(verified.getQueueCardInventoryRow(linkedRequest, 'request'), exact,
    'a unique exact match with a complete verified cache is returned');
});


test('production resolver discards a complete older master snapshot after a live inventory revision', async () => {
  const item = { MASTER_ID:'master-1',ITEMCODE:'004380.010.1',LOCATIONCODE:'C.09.000',LOTCODE:'27.F1',SOURCE:'1' };
  const old = row({ptronhand:89}), fresh = row({ptronhand:93});
  const c = productionQueueHydrationHarness({rows:[old],rpcRows:[{inputIndex:0,matchCount:1,row:fresh}]});
  assert.equal(c.getQueueCardInventoryRow(item),old);
  c.acceptQueueInventorySourceRevision({state:'ready',revision:'43'},'permission-v3');
  assert.equal(c.getQueueCardInventoryRow(item),null);
  await c.flushQueueCardInventoryHydration();
  assert.equal(c.getQueueCardInventoryRow(item).PTRONHAND,93);
});


test('Suspend write verification resolves normalized identity before reading an exact full master row', async () => {
  const html=readComposedAppSource();
  const start=html.indexOf('        async function resolveSuspendTagInventoryRow(');
  const next=/\r?\n        (?:async )?function /.exec(html.slice(start+1));
  const calls=[], c={window:{AgMetricQueueInventory:harness()}, productionLiveSyncNavigation:{signal:new AbortController().signal},
    getDockSuspendDcRequestLinkedMasterRow:()=>null,
    requestInventoryRead:async(op,payload)=>{calls.push({op,payload});return {rows:[{inputIndex:0,matchCount:1,row:row()}]};},
    validateInventoryReadProjection:()=>true,
    matchesSuspendTagInventoryIdentity:(actual,wanted)=>harness().matches(actual,wanted),
    loadExactMasterDetailRow:async uid=>{assert.equal(uid,'master-1');return row();}
  };
  vm.createContext(c);vm.runInContext(html.slice(start,start+1+next.index),c);
  const actual=await c.resolveSuspendTagInventoryRow({},null,identity);
  assert.equal(actual.unique_id,'master-1');assert.equal(calls[0].op,'master_identity_batch');
  assert.equal(calls[0].payload.queueIdentities[0].itemCode,'0043800101');
  assert.equal(calls[0].payload.queueIdentities[0].locationCode,'C.09.000');
});

test('exact Queue master metrics beat stale aliases and preserve genuine zero On Hand', () => {
  const html = readComposedAppSource();
  const start = html.indexOf('        function normalizeRequestCardMetrics(');
  const next = /\r?\n        (?:async )?function /.exec(html.slice(start + 1));
  assert.ok(start >= 0 && next, 'canonical request metric normalizer exists');
  const context = { firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? null };
  vm.createContext(context);
  vm.runInContext(html.slice(start, start + 1 + next.index), context);
  const normalized = context.normalizeRequestCardMetrics({
    PTRONHAND: 0, PTRREVIEWED: 30, PTRAVAILABLE: 5, S_LTS: -2, LOC_ON_HAND: 2046,
    ON_HAND: 125, REVIEW: 120, AVAILABLE: 0
  });
  assert.equal(normalized.PTRONHAND, 0, 'exact zero On Hand is not inferred from unrelated aliases');
  assert.equal(normalized.PTRREVIEWED, 30);
  assert.equal(normalized.PTRAVAILABLE, 5, 'exact physical-row Available wins over stale zero alias');
  assert.equal(normalized.S_LTS, -2, 'exact physical-row seasonal stock remains authoritative');
  assert.equal(normalized.LOC_ON_HAND, 2046);
});
