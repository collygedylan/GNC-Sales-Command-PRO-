import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
function extract(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} should exist`);
  const next = html.slice(start).search(/\n        (?:async )?function \w+\(/);
  return html.slice(start, next < 0 ? undefined : start + next);
}
function evaluate(ctx, ...names) { vm.createContext(ctx); vm.runInContext(names.map(extract).join('\n'), ctx); return ctx; }

test('Suspend Tag editor retains current permissions without a standalone face button', () => {
  let allowed = true, status = 'pending';
  const item = { UNIQUE_ID: 'dock_suspend_dc_soc-1' }, opened = [];
  const ctx = {
    String, Object, Array, esc: String, escJsAttrValue: String,
    initializeSuspendTagCardActionDelegation() {},
    suspendTagCompletionActions: new Set(), getSupabaseReadIdentityScope: () => 'fixture-owner',
    getSuspendTagStatus: () => status, getDockSuspendDcRequestLinkedMasterRow: () => null,
    findDockSuspendDcRequestSourceRow: () => null, buildArgosInventoryTransactionRailHtml: () => '',
    canCurrentUserViewDockSuspendDcRequests: () => allowed,
    findDockSuspendDcRequestMirrorRowByUniqueId: () => item, isDockSuspendDcRequestMirrorRow: () => true,
    retryPendingSuspendTagInventoryReconciliations() {}, showToast() {},
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    openDetail: (...args) => opened.push(args),
  };
  evaluate(ctx, 'getDockSuspendDcRequestSourceUid', 'buildSuspendTagActions', 'openDockSuspendDcRequestUpdate');
  for (status of ['pending', 'completed', 'awaiting_rep', 'approved', 'denied']) {
    assert.doesNotMatch(ctx.buildSuspendTagActions(item), />Photo \/ Specs</);
  }
  ctx.openDockSuspendDcRequestUpdate(item.UNIQUE_ID);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [[item.UNIQUE_ID, 'request', { preferredTab: 'request' }]]);
  for (status of ['awaiting_rep', 'approved']) assert.doesNotMatch(ctx.buildSuspendTagActions(item), />Photo \/ Specs</);
  status = 'pending'; allowed = false;
  assert.doesNotMatch(ctx.buildSuspendTagActions(item), />Photo \/ Specs</);
  ctx.openDockSuspendDcRequestUpdate(item.UNIQUE_ID);
  assert.equal(opened.length, 1, 'direct activation also checks access');
  assert.match(html, /onchange="handlePhotoUpload\(this, 'req-'\)"/);
  assert.match(html, /id="req-spec"[^>]+onchange="saveData\(false, 'req-', true\)"/);
});

const identity = { itemCode:'PLANT-1', locationCode:'A1', lotCode:'LOT-A', source:'GREENLEAF', masterUid:'' };
function resolverFixture(rows = [], linked = null) {
  const calls = [];
  const ctx = {
    String, Object, Array, Error, Map,
    getDockSuspendDcRequestLinkedMasterRow: () => linked,
    getMasterInventorySourceCode: row => row?.SOURCE || '',
    firstNonEmptyValue: (...values) => values.find(v => v != null && String(v).trim()) ?? '',
    fetchAllInventoryReadRows: async (...args) => { calls.push(args); return rows; },
    validateInventoryReadProjection: () => true,
    loadExactMasterDetailRow: async uid => rows.find(row => row.UNIQUE_ID === uid) || null,
  };
  vm.createContext(ctx); vm.runInContext(extract('matchesSuspendTagInventoryIdentity'), ctx); vm.runInContext(extract('resolveSuspendTagInventoryRow'), ctx);
  return { ctx, calls };
}
const inv = (uid, changes = {}) => ({ UNIQUE_ID:uid, ITEMCODE:'PLANT-1', LOCATIONCODE:'A1', LOTCODE:'LOT-A', SOURCE:'GREENLEAF', ...changes });

test('inventory resolver selects only exact item, location, lot, source and explicit master ID', async () => {
  const good = inv('master-a');
  const f = resolverFixture([good, inv('other-lot', { LOTCODE:'LOT-B' }), inv('other-source', { SOURCE:'OTHER' })]);
  const resolved = await f.ctx.resolveSuspendTagInventoryRow({},{},identity);
  assert.equal(resolved.UNIQUE_ID, 'master-a');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'master_page');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][1])), {
    dataset:'lookup', projection:'full', itemCode:'PLANT-1', locationCode:'A1', lotCode:'LOT-A', source:'GREENLEAF'
  });
  const explicitMismatch = resolverFixture([good]);
  await assert.rejects(explicitMismatch.ctx.resolveSuspendTagInventoryRow({},{},{...identity, masterUid:'master-wrong'}), /identity changed/);
  await assert.rejects(f.ctx.resolveSuspendTagInventoryRow({},{},{...identity, masterUid:'other-lot'}), /identity changed/);
});

test('inventory resolver rejects mismatched linked rows and ambiguous lookup; missing match stays unlinked', async () => {
  const mismatch = resolverFixture([], inv('master-a', { LOTCODE:'LOT-B' }));
  await assert.rejects(mismatch.ctx.resolveSuspendTagInventoryRow({},{},identity), /identity changed/);
  const ambiguous = resolverFixture([inv('master-a'), inv('master-b')]);
  await assert.rejects(ambiguous.ctx.resolveSuspendTagInventoryRow({},{},identity), /More than one/);
  const missing = resolverFixture([]);
  assert.equal(await missing.ctx.resolveSuspendTagInventoryRow({},{},identity), null);
});

test('Suspend Tag master identity ignores Dock labels and uses exact row filters', async () => {
  const source = { unique_id:'soc-10', itemcode:'PLANT-1', locationcode:'A1', lotcode:'LOT-A' };
  const mirror = { ITEMCODE:'PLANT-1', LOCATIONCODE:'A1', LOTCODE:'LOT-A', SOURCE:'Docks', REQUEST_SOURCE:'Docks' };
  const canonical = inv('master-a');
  const calls = [];
  const ctx = {
    String, Object, Array, Error,
    firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim())??'',
    normalizeMasterInventorySourceCode:value=>['DOCK','DOCKS','SOC'].includes(String(value||'').trim().toUpperCase())?'':String(value||'').trim().toUpperCase(),
    getMasterInventorySourceCode:row=>row?.SOURCE||row?.source||'', findDockSuspendDcRequestSourceRow:()=>source,
    getDockSuspendDcRequestLinkedMasterRow:()=>null, fetchAllInventoryReadRows:async(...args)=>{calls.push(args);return [canonical];},
    validateInventoryReadProjection:()=>true, loadExactMasterDetailRow:async uid=>uid==='master-a'?canonical:null,
  };
  vm.createContext(ctx);
  for (const name of ['getSuspendTagInventoryIdentity','matchesSuspendTagInventoryIdentity','resolveSuspendTagInventoryRow']) vm.runInContext(extract(name),ctx);
  const exactIdentity = ctx.getSuspendTagInventoryIdentity(mirror,source);
  assert.equal(exactIdentity.source,'', 'REQUEST_SOURCE= Docks must not be treated as master SOURCE');
  assert.equal((await ctx.resolveSuspendTagInventoryRow(mirror,source,exactIdentity)).UNIQUE_ID,'master-a');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { dataset:'lookup', projection:'full', itemCode:'PLANT-1', locationCode:'A1' });
});

test('Suspend Tag quantity chips use exact hydrated inventory fields independently', () => {
  const mirror = { UNIQUE_ID:'dock_suspend_dc_soc-4', ITEMCODE:'PLANT-1', LOCATIONCODE:'A1', LOTCODE:'LOT-A' };
  const exact = { UNIQUE_ID:'master-a', ITEMCODE:'PLANT-1', LOCATIONCODE:'A1', LOTCODE:'LOT-A', SOURCE:'GREENLEAF',
    PTRONHAND:89, PTRREVIEWED:27, PTRAVAILABLE:62, S_LTS:61, LOC_PHOTO_MATCH:14 };
  const ctx = {
    String, Object, Array, Map,
    activeReqTab: 'suspend-tag',
    escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim()!=='')??'',
    getDatasetState:()=>({rowCompleteness:'partial',initialLoaded:true}), nativeAuthSessionActive:false, nativeAuthProfile:null,
    masterInventoryByItemCode:new Map(), getItemInquiryItemCode:()=> 'PLANT-1',
    getSuspendTagHydratedInventoryRow:()=>exact, findDockSuspendDcRequestSourceRow:()=>({unique_id:'soc-4'}),
    formatLocPhotoMatchQtyValue:row=>row?.LOC_PHOTO_MATCH == null?'Not verified':String(row.LOC_PHOTO_MATCH),
    getCardLocationOnHandValue:()=>null, isDockSuspendDcRequestMirrorRow:row=>row===mirror,
  };
  vm.createContext(ctx);
  for (const name of ['firstNonEmptyValue','normalizeCardQuantityValue','getCardPtrOnHandValue','getCardPtrReviewedValue','getCardPtrAvailableValue','getCardOpenStockValue','getOperationalCardInventoryRow']) {
    vm.runInContext(extract(name),ctx);
  }
  const quantityStart = html.indexOf('        function buildInventoryQuantityChipsHtml(');
  const quantityEnd = html.indexOf('        function isInventoryCardMeaningfulTextValue(',quantityStart);
  vm.runInContext(html.slice(quantityStart,quantityEnd),ctx);
  const hydrated = ctx.getOperationalCardInventoryRow(mirror);
  assert.equal(hydrated,exact);
  const dom = new JSDOM(ctx.buildInventoryQuantityChipsHtml(hydrated,{layout:'row',sourceView:'request',locationMetricItem:hydrated,preserveUnknown:true}));
  const metrics = Object.fromEntries([...dom.window.document.querySelectorAll('[data-inventory-card-metric]')]
    .map(node=>[node.getAttribute('data-inventory-card-metric'),node.querySelector('.app-card-qty-value').textContent]));
  assert.deepEqual(metrics, { 'on-hand':'89', review:'27', available:'62', 'open-stock':'61', 'loc-photo-match':'14', 'loc-on-hand':'--' });
  const cardDataStart = html.indexOf('        function buildDockSuspendDcRequestCardDataHtml(');
  const cardDataEnd = html.indexOf('\n        function ', cardDataStart + 20);
  assert.doesNotMatch(html.slice(cardDataStart, cardDataEnd), /LOC PHOTO MATCH:/,
    'the compact card removes only the duplicate badge; the verified numeric metric above remains');
  dom.window.close();
});

test('confirmed inventory writes invalidate only matching hydrated Suspend Tag card rows', () => {
  const loads = new Map();
  const ctx = { String, Object, Map, suspendTagReclassLoads:loads,
    invalidateDockSuspendDcSourceRowLookup() {},
    getSuspendTagInventoryIdentity:item=>({itemCode:item.ITEMCODE,locationCode:item.LOCATIONCODE,lotCode:item.LOTCODE,source:item.SOURCE}) };
  vm.createContext(ctx); vm.runInContext(extract('invalidateSuspendTagInventoryRows'),ctx);
  const match = { identity:{itemCode:'PLANT-1',locationCode:'A1',lotCode:'LOT-A',source:'GREENLEAF'} };
  const unresolvedSource = { identity:{itemCode:'PLANT-1',locationCode:'A1',lotCode:'LOT-A',source:''} };
  const other = { identity:{itemCode:'PLANT-2',locationCode:'A1',lotCode:'LOT-A',source:'GREENLEAF'} };
  loads.set('match',match); loads.set('unresolved-source',unresolvedSource); loads.set('other',other);
  ctx.invalidateSuspendTagInventoryRows({ITEMCODE:'plant-1',LOCATIONCODE:'a1',LOTCODE:'lot-a',SOURCE:'greenleaf'});
  assert.deepEqual([...loads.keys()],['other']);
});

test('confirmed inventory reconciliation uses exact server fields and retries a failed canonical read', async () => {
  let fail = true, scheduled = 0, reconciled;
  const mirror = { UNIQUE_ID:'dock_suspend_dc_soc-1', DOCK_SUSPEND_SOURCE_UID:'soc-1' };
  const source = { unique_id:'soc-1', itemcode:'PLANT-1', locationcode:'A1', lotcode:'LOT-A', source:'GREENLEAF', dock_spec:'updated' };
  const raw = { unique_id:'master-a', itemcode:'PLANT-1', locationcode:'A1', lotcode:'LOT-A', source:'GREENLEAF', req_spec:'1 gallon', req_photo_link:'photo.jpg', last_updated:'rev-2' };
  const canonical = { UNIQUE_ID:'master-a', ITEMCODE:'PLANT-1', LOCATIONCODE:'A1', LOTCODE:'LOT-A', SOURCE:'GREENLEAF', REQ_SPEC:'1 gallon', REQ_PHOTO_LINK:'photo.jpg', LAST_UPDATED:'rev-2' };
  Object.defineProperty(canonical,'__masterDetailRaw',{value:raw,enumerable:false});
  const map = new Map();
  const ctx = {
    String, Object, Array, Error, Map, Promise, setTimeout:fn => { scheduled++; return 1; },
    getSupabaseReadIdentityScope: ()=>'account-a', getDockSuspendDcRequestSourceUid: row => row.DOCK_SUSPEND_SOURCE_UID,
    getDockSuspendDcRequestLinkedMasterRow:()=>null, getMasterInventorySourceCode: row=>row?.source||row?.SOURCE||'',
    normalizeMasterInventorySourceCode: value => ['DOCK','DOCKS','SOC'].includes(String(value||'').trim().toUpperCase()) ? '' : String(value||'').trim().toUpperCase(),
    firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim())??'',
    fetchAllInventoryReadRows:async()=>[canonical], validateInventoryReadProjection:()=>true,
    loadExactMasterDetailRow:async()=>{ if(fail) throw new Error('canonical read failed'); return canonical; },
    suspendTagInventoryReconciliations:map, window:{GncDatabase:{driveEvidenceColumns:['req_spec','req_photo_link','last_updated']}},
    reconcileConfirmedDriveEvidence:(receipt,row,prefix,options)=>{reconciled={receipt,row,prefix,options};},
    persistCurrentCache(){}, signalProductionLiveSync(){}, showToast(){},
  };
  vm.createContext(ctx); vm.runInContext('let suspendTagInventoryRetryTimer = null;',ctx);
  for (const name of ['getSuspendTagInventoryIdentity','matchesSuspendTagInventoryIdentity','resolveSuspendTagInventoryRow','scheduleSuspendTagInventoryRetry','retryPendingSuspendTagInventoryReconciliations','reconcileSuspendTagInventoryEntry','queueSuspendTagInventoryReconciliation']) vm.runInContext(extract(name),ctx);
  await ctx.queueSuspendTagInventoryReconciliation(mirror,source);
  assert.equal(map.size,1); assert.equal(scheduled,1); assert.equal(reconciled,undefined);
  ctx.clearTimeout = () => {};
  fail=false; ctx.retryPendingSuspendTagInventoryReconciliations();
  await new Promise(setImmediate); await new Promise(setImmediate);
  assert.equal(map.size,0);
  assert.deepEqual(JSON.parse(JSON.stringify(reconciled.receipt.row)), raw);
  assert.equal(reconciled.options.scope,'account-a');
});

test('inventory reconciliation discards a read after account scope changes', async () => {
  let scope='account-a', finish;
  const mirror={UNIQUE_ID:'dock_suspend_dc_soc-2',DOCK_SUSPEND_SOURCE_UID:'soc-2'}, source={unique_id:'soc-2'};
  const raw={unique_id:'master-a',itemcode:'PLANT-1',locationcode:'A1',lotcode:'LOT-A',source:'GREENLEAF',req_spec:'1 gallon'};
  const canonical={UNIQUE_ID:'master-a',ITEMCODE:'PLANT-1',LOCATIONCODE:'A1',LOTCODE:'LOT-A',SOURCE:'GREENLEAF',REQ_SPEC:'1 gallon'};
  Object.defineProperty(canonical,'__masterDetailRaw',{value:raw,enumerable:false});
  const ctx={String,Object,Array,Error,Map,Promise,setTimeout:()=>1,getSupabaseReadIdentityScope:()=>scope,
    getDockSuspendDcRequestSourceUid:row=>row.DOCK_SUSPEND_SOURCE_UID,getDockSuspendDcRequestLinkedMasterRow:()=>null,
    getMasterInventorySourceCode:row=>row?.source||row?.SOURCE||'',
    normalizeMasterInventorySourceCode:value=>['DOCK','DOCKS','SOC'].includes(String(value||'').trim().toUpperCase())?'':String(value||'').trim().toUpperCase(),
    firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim())??'',
    fetchAllInventoryReadRows:async()=>[canonical],validateInventoryReadProjection:()=>true,
    loadExactMasterDetailRow:()=>new Promise(resolve=>{finish=resolve;}),suspendTagInventoryReconciliations:new Map(),
    window:{GncDatabase:{driveEvidenceColumns:['req_spec']}},reconcileConfirmedDriveEvidence(){assert.fail('stale read applied');},
    persistCurrentCache(){},signalProductionLiveSync(){},showToast(){}};
  vm.createContext(ctx); vm.runInContext('let suspendTagInventoryRetryTimer = null;',ctx);
  for(const name of ['getSuspendTagInventoryIdentity','matchesSuspendTagInventoryIdentity','resolveSuspendTagInventoryRow','scheduleSuspendTagInventoryRetry','retryPendingSuspendTagInventoryReconciliations','reconcileSuspendTagInventoryEntry','queueSuspendTagInventoryReconciliation']) vm.runInContext(extract(name),ctx);
  const pending=ctx.queueSuspendTagInventoryReconciliation(mirror,{unique_id:'soc-2',itemcode:'PLANT-1',locationcode:'A1',lotcode:'LOT-A',source:'GREENLEAF'});
  while (!finish) await new Promise(setImmediate);
  scope='account-b'; finish(canonical); await pending;
  assert.equal(ctx.suspendTagInventoryReconciliations.size,1);
});

test('a newer acknowledgement supersedes an earlier late canonical read', async () => {
  const mirror={UNIQUE_ID:'dock_suspend_dc_soc-3',DOCK_SUSPEND_SOURCE_UID:'soc-3'};
  const source={unique_id:'soc-3',itemcode:'PLANT-1',locationcode:'A1',lotcode:'LOT-A',source:'GREENLEAF'};
  const oldRaw={unique_id:'master-a',itemcode:'PLANT-1',locationcode:'A1',lotcode:'LOT-A',source:'GREENLEAF',req_spec:'old',last_updated:'r1'};
  const newRaw={...oldRaw,req_spec:'new',last_updated:'r2'};
  const formatted=raw=>{
    const row={UNIQUE_ID:raw.unique_id,ITEMCODE:raw.itemcode,LOCATIONCODE:raw.locationcode,LOTCODE:raw.lotcode,SOURCE:raw.source,REQ_SPEC:raw.req_spec,LAST_UPDATED:raw.last_updated};
    Object.defineProperty(row,'__masterDetailRaw',{value:raw,enumerable:false}); return row;
  };
  const oldCanonical=formatted(oldRaw), newCanonical=formatted(newRaw);
  const pendingReads=[]; let applied=[];
  const map=new Map(), ctx={String,Object,Array,Error,Map,Promise,setTimeout:()=>1,
    getSupabaseReadIdentityScope:()=>'account-a',getDockSuspendDcRequestSourceUid:row=>row.DOCK_SUSPEND_SOURCE_UID,
    getDockSuspendDcRequestLinkedMasterRow:()=>null,getMasterInventorySourceCode:row=>row?.source||row?.SOURCE||'',
    normalizeMasterInventorySourceCode:value=>['DOCK','DOCKS','SOC'].includes(String(value||'').trim().toUpperCase())?'':String(value||'').trim().toUpperCase(),
    firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim())??'',
    fetchAllInventoryReadRows:async()=>[inv('master-a')],validateInventoryReadProjection:()=>true,
    loadExactMasterDetailRow:()=>new Promise(resolve=>pendingReads.push(resolve)),
    suspendTagInventoryReconciliations:map,window:{GncDatabase:{driveEvidenceColumns:['req_spec','last_updated']}},
    reconcileConfirmedDriveEvidence:receipt=>applied.push(receipt.row.req_spec),persistCurrentCache(){},signalProductionLiveSync(){},showToast(){}};
  vm.createContext(ctx);vm.runInContext('let suspendTagInventoryRetryTimer=null;',ctx);
  for(const name of ['getSuspendTagInventoryIdentity','matchesSuspendTagInventoryIdentity','resolveSuspendTagInventoryRow','scheduleSuspendTagInventoryRetry','retryPendingSuspendTagInventoryReconciliations','reconcileSuspendTagInventoryEntry','queueSuspendTagInventoryReconciliation']) vm.runInContext(extract(name),ctx);

  const oldPending=ctx.queueSuspendTagInventoryReconciliation(mirror,source);
  while(pendingReads.length<1) await new Promise(setImmediate);
  const newPending=ctx.queueSuspendTagInventoryReconciliation(mirror,{...source,dock_spec:'new'});
  while(pendingReads.length<2) await new Promise(setImmediate);
  pendingReads[1](newCanonical); await newPending;
  pendingReads[0](oldCanonical); await oldPending;
  assert.deepEqual(applied,['new'],'the late earlier read must not roll back the newer acknowledgement');
  assert.equal(map.size,0);
});

test('Suspend Tag row writes serialize by account and source and recover after a failed write', async () => {
  const ctx={String,Map,Promise,getSupabaseReadIdentityScope:()=>ctx.scope,getDockSuspendDcRequestSourceUid:row=>row.DOCK_SUSPEND_SOURCE_UID,
    staleSupabaseReadScopeError:()=>new Error('stale account')}; ctx.scope='account-a';
  vm.createContext(ctx); vm.runInContext('const suspendTagRowWrites = new Map();',ctx); vm.runInContext(extract('serializeSuspendTagRowWrite'),ctx);
  const row={DOCK_SUSPEND_SOURCE_UID:'soc-1'}, events=[];
  const first=ctx.serializeSuspendTagRowWrite(row,async()=>{events.push('first-start');await new Promise(resolve=>setTimeout(resolve,10));events.push('first-end');throw Error('write failed');});
  const second=ctx.serializeSuspendTagRowWrite(row,async()=>{events.push('second');return true;});
  await assert.rejects(first,/write failed/); assert.equal(await second,true); assert.deepEqual(events,['first-start','first-end','second']);
  let started=false; const stale=ctx.serializeSuspendTagRowWrite(row,async()=>{started=true;}); ctx.scope='account-b';
  await assert.rejects(stale,/stale account/); assert.equal(started,false);
});
