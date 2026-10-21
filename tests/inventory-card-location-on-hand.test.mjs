import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const html = readComposedAppSource();
const hydrationSource = fs.readFileSync(new URL('../assets/queue-inventory-hydration.js', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const source = scripts.find(script => script.includes('function getCardLocationOnHandValue('));
assert.ok(source, 'live inventory-card helper script is present');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const names = new Set([
  'firstNonEmptyValue', 'normalizeCardQuantityValue', 'getCardPtrOnHandValue',
  'parseAppNumber', 'normalizeMasterInventorySourceCode', 'getMasterInventorySourceCode',
  'getMasterInventoryExactKey', 'getInventoryCardItemLocationKey', 'addInventoryCardLocationOnHand',
  'getCardLocationOnHandValue', 'isDatasetLoaded', 'getItemInquiryItemCode',
  'getCardLocationOnHandServerAggregate', 'clearAcceptedLocOnHandAggregates', 'invalidateLocOnHandAggregateRows', 'acceptCardLocationOnHandSourceReceipt', 'stampCardLocationOnHandReceipt', 'clearCardLocationOnHandReceipt',
  'getQueueCardInventoryAuthorizationContext',
  'normalizeNcrInheritanceKeyPart', 'createMasterInventoryIndexMaps', 'addMasterInventoryRowToIndexes',
  'buildMasterInventoryIndexMaps', 'installMasterInventoryIndexMaps', 'rebuildMasterInventoryIndexes',
  'applyRowSyncSnapshot', 'syncMasterFieldsToRow', 'requestInventoryRead',
]);
const declarations = ast.body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
for (const name of names) assert.ok(declarations.some(node => node.id.name === name), `source helper ${name} exists`);
const code = declarations.map(node => source.slice(node.start, node.end)).join('\n');

function setup(rows) {
  const state = { fullLoaded: true, fieldCoverage: 'full', initialLoaded: true, rowCompleteness: 'complete',
    liveVerifiedScope: '', liveVerifiedPermission: '', liveVerifiedRevision: '' };
  const indexInvalidations = { count: 0 };
  const context = vm.createContext({
    Map, Set, Number, String, Array, Object, JSON, Math,
    NON_MASTER_INVENTORY_SOURCE_CODES: new Set(['REQUEST', 'V2_ACTIVE_REQUEST', 'V2_MASTER_INVENTORY', 'V2_SALES_OFFICE']),
    MASTER_EVIDENCE_SYNC_KEYS: ['LAST_UPDATED', 'AV_RULE_LAST_CLEARED_AT'],
    LOC_ON_HAND_SYNC_KEYS: ['LOC_ON_HAND','LOC_ON_HAND_ITEMCODE','LOC_ON_HAND_LOCATIONCODE','LOC_ON_HAND_REVISION','LOC_ON_HAND_RECEIPT_SCOPE','LOC_ON_HAND_RECEIPT_PERMISSION','LOC_ON_HAND_RECEIPT_REVISION'],
    FLYER_FOLDER_ROWS_TABLE: 'ph_flyer_folder_rows',
    fullInventory: rows,
    requestsInventory: [], managerReportVisibleRows: new Map(), acceptedLocOnHandAggregateRevision: '',
    masterInventoryById: new Map(), masterInventoryByExactKey: new Map(), masterInventoryByItemCode: new Map(),
    masterInventoryByItemLocationOnHand: new Map(),
    nativeAuthSessionActive: false, nativeAuthProfile: null,
    currentUser: '', currentRole: '', currentUserDivision: '',
    getCurrentLoginCacheScopeKey: () => 'login-scope',
    getDatasetState: () => state,
    getSupabaseReadIdentityScope: () => 'actor-a',
    appAccessSnapshotState: { snapshot: { dataPermissionVersion:'permissions-1' } },
    APP_API_FUNCTION_URL:'app-api', SUPABASE_READ_TIMEOUT_MS:1000,
    productionLiveSyncCoordinator: null,
    runDedupeSupabaseRead: async (key, task) => task({ signal:null }),
    postAppFunctionJson: async () => ({ ok:true, data:{} }),
    staleSupabaseReadScopeError: () => new Error('STALE'),
    isMasterInitialLoadPartialForCurrentScope: () => false,
    canUseProductionLiveSync: () => true,
    getProductionLiveSyncContext: () => ({ scope: 'actor-a', dataPermissionVersion: 'permissions-1', adapters: [{ id: 'core:master' }] }),
    hasCurrentProductionLiveSyncProof: () => true,
    window: { GncDatabase: { driveEvidenceRevision: () => 0 } },
    findItemByUniqueId: uid => rows.find(row => row.UNIQUE_ID === uid) || null,
    findRequestRowByUniqueId: () => null,
    isRowScopedDesignationSyncKey: () => false,
    repairDisplayFieldsOnRow() {},
    normalizeFlyerShadowFields() {},
    normalizeRowPhotoFields() {},
    clonePhotoFields() {}, buildSearchIndex() {},
    syncSharedFlyerPhotoFields() {},
    syncRowDataAcrossViews() {},
    invalidateInventoryDomIdLookup: () => { indexInvalidations.count += 1; },
  });
  vm.runInContext(hydrationSource, context);
  vm.runInContext(`let masterInventoryByItemLocationOnHand = new Map(); let acceptedLocOnHandAggregateReceipt = { scope:'', permission:'', revision:'', valid:false };\n${code}`, context);
  context.rebuildMasterInventoryIndexes();
  return { context, state, indexInvalidations };
}

const rows = () => [
  { UNIQUE_ID: 'a', ITEMCODE: '001', LOCATIONCODE: ' A.01.001 ', LOTCODE: '27.F1', CONTSIZE: '#3', SOURCE: 'MASTER', PTRONHAND: '1,250' },
  { UNIQUE_ID: 'b', ITEMCODE: '001', LOCATIONCODE: 'a.01.001', LOTCODE: '27.S1', CONTSIZE: '#7', SOURCE: 'MASTER', PTRONHAND: '3,750' },
  { UNIQUE_ID: 'c', ITEMCODE: '1', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', CONTSIZE: '#3', SOURCE: 'MASTER', PTRONHAND: '900' },
  { UNIQUE_ID: 'd', ITEMCODE: '001', LOCATIONCODE: 'B.01.001', LOTCODE: '27.F1', CONTSIZE: '#3', SOURCE: 'MASTER', PTRONHAND: '600' },
];

test('location On Hand sums only matching item and location across lots and sizes', () => {
  const fixture = setup(rows());
  const { context } = fixture;
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '5,000');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[1]), '5,000');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[2]), '900', 'another item at the same physical location stays isolated');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[3]), '600', 'other locations remain isolated');
});

test('location aggregation ignores sales year and preserves zero without an item code', () => {
  const { context } = setup([
    { UNIQUE_ID: 'prior', ITEMCODE: '0001', LOCATIONCODE: 'A.01.001', LOTCODE: '26.F1', PTRONHAND: 10, SOURCE: 'MASTER' },
    { UNIQUE_ID: 'current', ITEMCODE: 'OTHER', LOCATIONCODE: 'a.01.001', LOTCODE: '27.F1', PTRONHAND: 20, SOURCE: 'MASTER' },
    { UNIQUE_ID: 'zero', ITEMCODE: '0001', LOCATIONCODE: 'Z.01.001', LOTCODE: '27.F1', PTRONHAND: 0, SOURCE: 'MASTER' },
  ]);
  assert.equal(context.getCardLocationOnHandValue({ ITEMCODE: '0001', location_code: ' A.01.001 ' }), '10');
  assert.equal(context.getCardLocationOnHandValue({ ITEMCODE:'0001', LOCATIONCODE: 'Z.01.001' }), '0');
  assert.equal(context.getCardLocationOnHandValue({ ITEMCODE: '0001' }), null);
});

test('Suspend and Drive location totals canonicalize dotted item codes and padded location tokens', () => {
  const { context } = setup([
    { UNIQUE_ID:'physical-a', ITEMCODE:'004380.010.1', LOCATIONCODE:'C.09.000', PTRONHAND:90, SOURCE:'MASTER' },
    { UNIQUE_ID:'physical-b', ITEMCODE:'43800101', LOCATIONCODE:' c.9.0 ', PTRONHAND:15, SOURCE:'MASTER' },
    { UNIQUE_ID:'other-location', ITEMCODE:'004380.010.1', LOCATIONCODE:'C.09.001', PTRONHAND:20, SOURCE:'MASTER' }
  ]);
  assert.equal(context.getInventoryCardItemLocationKey(context.fullInventory[0]),
    context.getInventoryCardItemLocationKey(context.fullInventory[1]));
  assert.equal(context.getCardLocationOnHandValue({ ITEMCODE:'43800101', location_code:' c.9.0 ' }), '105');
});

test('comma quantities parse, while a blank or invalid member makes the scope Unknown', () => {
  const fixture = setup(rows());
  const { context } = fixture;
  context.fullInventory[0].PTRONHAND = '1,250.5';
  context.fullInventory[1].PTRONHAND = '3,749.5';
  context.rebuildMasterInventoryIndexes();
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '5,000');
  for (const invalid of ['', 'not-a-number']) {
    context.fullInventory[1].PTRONHAND = invalid;
    context.rebuildMasterInventoryIndexes();
    assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), null, `${JSON.stringify(invalid)} keeps the total unknown`);
  }
});

test('location total uses complete browse rows and their own authorized master receipt', () => {
  const fixture = setup(rows());
  const { context, state } = fixture;
  const target = context.fullInventory[0];
  state.rowCompleteness = 'partial';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'an initial-only read is not a full inventory total');
  state.rowCompleteness = 'complete';
  state.fullLoaded = false;
  state.fieldCoverage = 'browse';
  assert.equal(context.getCardLocationOnHandValue(target), '5,000', 'complete browse projection has every quantity needed');
  context.nativeAuthSessionActive = true;
  context.nativeAuthProfile = { id: 'fixture-profile', username: 'rep' };
  context.currentUser = 'rep';
  context.currentRole = 'Sales Rep';
  state.liveVerifiedScope = JSON.stringify(['fixture-profile', 'rep', 'Sales Rep', 'login-scope']);
  state.liveVerifiedPermission = 'permissions-1';
  state.liveVerifiedRevision = '12';
  context.hasCurrentProductionLiveSyncProof = () => false;
  assert.equal(context.getCardLocationOnHandValue(target), '5,000', 'unrelated side adapters do not hide a verified master aggregate');
  state.liveVerifiedScope = 'another-actor';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'another account receipt cannot be reused');
  state.liveVerifiedScope = JSON.stringify(['fixture-profile', 'rep', 'Sales Rep', 'login-scope']);
  state.liveVerifiedPermission = 'old-permissions';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'changed permissions require another master receipt');
  state.liveVerifiedPermission = 'permissions-1';
  state.liveVerifiedRevision = '';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'missing master receipt is insufficient');
  state.liveVerifiedRevision = '12';
  context.canUseProductionLiveSync = () => false;
  assert.equal(context.getCardLocationOnHandValue(target), null, 'unauthorized native context is not trusted');
});

test('D.29.000 totals 1,232 across F1, S1, U2 and Y, independently of selected season', () => {
  const inventory = [['F1', 41], ['S1', 491], ['U2', 210], ['Y', 490]].map(([season, quantity], index) => ({
    UNIQUE_ID: `loc-${index}`, ITEMCODE: '000124', LOCATIONCODE: 'D.29.000', LOTCODE: `27.${season}`,
    SEASON: season, PTRONHAND: quantity, SOURCE: 'MASTER',
  }));
  const { context, state } = setup(inventory.concat(rows()));
  state.fullLoaded = false;
  state.fieldCoverage = 'browse';
  for (const row of inventory) assert.equal(context.getCardLocationOnHandValue(row), '1,232');
  assert.equal(context.getCardLocationOnHandValue({ ITEMCODE: '000124', LOCATIONCODE: 'D.29.000' }), '1,232');
});

test('rebuilding the real master indexes reflects confirmed quantity changes', () => {
  const fixture = setup(rows());
  const { context } = fixture;
  context.fullInventory[1].PTRONHAND = '5,000';
  context.rebuildMasterInventoryIndexes();
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '6,250');
  context.fullInventory[0].PTRONHAND = null;
  context.rebuildMasterInventoryIndexes();
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), null);
});

test('cross-tab master row snapshot rebuilds the location index only when its aggregate key or quantity changes', () => {
  const fixture = setup(rows());
  const { context, indexInvalidations } = fixture;
  const target = context.fullInventory[1];
  const beforeRebuilds = indexInvalidations.count;
  const snapshot = data => ({ uniqueId: target.UNIQUE_ID, masterUniqueId: target.UNIQUE_ID, sourceTable: 'ph_master_inventory', data });

  assert.equal(context.applyRowSyncSnapshot(snapshot({ PTRONHAND: '5,000' })), true);
  assert.equal(context.getCardLocationOnHandValue(target), '6,250');
  assert.equal(indexInvalidations.count, beforeRebuilds + 1, 'quantity changes refresh the aggregate index');

  const afterQuantityRebuilds = indexInvalidations.count;
  assert.equal(context.applyRowSyncSnapshot(snapshot({ LOCATIONCODE: 'B.01.001' })), true);
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '1,250', 'moving the row changes the old item/location total');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[3]), '5,600', 'moving the row changes the new item/location total');
  assert.equal(indexInvalidations.count, afterQuantityRebuilds + 1, 'item/location key changes refresh the aggregate index');

  const afterKeyRebuilds = indexInvalidations.count;
  assert.equal(context.applyRowSyncSnapshot(snapshot({ SAVED_PHOTO_LINK: 'https://example.invalid/photo.webp' })), true);
  assert.equal(context.applyRowSyncSnapshot(snapshot({ PTRONHAND: '5,000' })), true);
  assert.equal(indexInvalidations.count, afterKeyRebuilds, 'metadata-only and unchanged acknowledgments do not rebuild the index');
});

test('trusted row aggregate works before a complete master read and preserves explicit null and zero', () => {
  const { context, state } = setup(rows());
  context.nativeAuthSessionActive = true;
  context.nativeAuthProfile = { id:'fixture-profile' };
  const target = { ITEMCODE:'001973.030.1', LOCATIONCODE:'I.12.000', LOC_ON_HAND:0,
    LOC_ON_HAND_ITEMCODE:'001973.030.1', LOC_ON_HAND_LOCATIONCODE:'I.12.000', LOC_ON_HAND_REVISION:'12',
    LOC_ON_HAND_RECEIPT_SCOPE:'actor-a', LOC_ON_HAND_RECEIPT_PERMISSION:'permissions-1', LOC_ON_HAND_RECEIPT_REVISION:'12' };
  state.rowCompleteness = 'partial';
  assert.equal(context.acceptCardLocationOnHandSourceReceipt('actor-a', 'permissions-1', '12'), true, 'request-only response establishes its own scoped source receipt');
  assert.equal(context.getCardLocationOnHandValue(target), '0');
  target.LOC_ON_HAND = null;
  assert.equal(context.getCardLocationOnHandValue(target), null, 'explicit null is authoritative and does not fall back to partial local rows');
  assert.equal(context.getCardLocationOnHandServerAggregate(target, { preserveUnknown: true }).value, null, 'canonical metrics retain genuine null');
  target.LOC_ON_HAND = 2000;
  target.LOC_ON_HAND_REVISION = '11';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'an older response cannot override the current source revision');
  assert.equal(context.getCardLocationOnHandServerAggregate(target, { preserveUnknown: true }).value, undefined, 'canonical metrics distinguish an invalid receipt from genuine null');
  target.LOC_ON_HAND_REVISION = '12';
  assert.equal(context.getCardLocationOnHandValue(target), '2,000', 'cold request rows use the independently accepted source revision');
  target.LOC_ON_HAND_LOCATIONCODE = 'C.16.000';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'aggregate cannot be retargeted after a row location changes');
  target.LOC_ON_HAND_LOCATIONCODE = 'I.12.000';
  target.LOC_ON_HAND_RECEIPT_SCOPE = 'actor-b';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'aggregate from a different account is rejected');
  target.LOC_ON_HAND_RECEIPT_SCOPE = 'actor-a';
  target.LOC_ON_HAND_RECEIPT_PERMISSION = 'old-permissions';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'aggregate from old permissions is rejected');
});

test('accepted aggregate receipt freezes its original item/location pair and current identity', () => {
  const { context } = setup(rows());
  const row = { itemcode:'001973.030.1', locationcode:'I.12.000', loc_on_hand:2000, loc_on_hand_revision:'12' };
  context.acceptCardLocationOnHandSourceReceipt('actor-a', 'permissions-1', '12');
  context.stampCardLocationOnHandReceipt(row, 'actor-a', 'permissions-1', '12');
  row.ITEMCODE = 'OTHER';
  assert.equal(context.getCardLocationOnHandValue(row), null, 'mutating source identity cannot retarget the aggregate');
  row.ITEMCODE = '001973.030.1';
  assert.equal(context.getCardLocationOnHandValue(row), '2,000');
  context.clearAcceptedLocOnHandAggregates();
  assert.equal(context.getCardLocationOnHandValue(row), null, 'a newer master receipt invalidates prior row totals');
});

test('authenticated bounded read boundaries capture permission and stamp only accepted response rows', () => {
  const inventoryRead = source.match(/async function requestInventoryRead\([\s\S]*?(?=\n\s*async function fetchInventoryReadPage)/)?.[0] || '';
  assert.match(inventoryRead, /const permissionVersion = String\(appAccessSnapshotState\.snapshot\?\.dataPermissionVersion/);
  assert.match(inventoryRead, /identityScope !== getSupabaseReadIdentityScope\(\) \|\| permissionVersion !== String\(appAccessSnapshotState\.snapshot\?\.dataPermissionVersion/);
  assert.match(inventoryRead, /stampCardLocationOnHandReceipt\(row, identityScope, permissionVersion, inventoryRevision\)/);
  const managerTransport = source.match(/transport: async \(query, signal\) => \{[\s\S]*?(?=\n\s*onReady:)/)?.[0] || '';
  assert.match(managerTransport, /const receiptScope = getSupabaseReadIdentityScope\(\)/);
  assert.match(managerTransport, /receiptScope !== getSupabaseReadIdentityScope\(\) \|\| receiptPermission !== String\(appAccessSnapshotState\.snapshot\?\.dataPermissionVersion/);
  assert.match(managerTransport, /stampCardLocationOnHandReceipt\(value, receiptScope, receiptPermission, inventoryRevision\)/);
  const managerRenderState = source.match(/onState:result => \{[\s\S]*?managerReportVisibleRows\.set\(host,[\s\S]*?extra\.onState\?\.\(result\);/)?.[0] || '';
  assert.doesNotMatch(managerRenderState, /stampCardLocationOnHandReceipt/, 'cached render notifications cannot reauthorize rows');
});

test('requestInventoryRead executes its permission fence and stamps only the captured authorized response', async () => {
  const { context } = setup(rows());
  const serverRow = { itemcode:'001973.030.1', locationcode:'I.12.000', loc_on_hand:2000, loc_on_hand_revision:'12' };
  context.postAppFunctionJson = async () => ({ ok:true, data:{ inventoryRevision:'12', rows:[serverRow] } });
  const accepted = await context.requestInventoryRead('master_page');
  assert.equal(accepted.rows[0].LOC_ON_HAND_RECEIPT_REVISION, '12');
  assert.equal(context.getCardLocationOnHandValue(accepted.rows[0]), '2,000');

  let release;
  context.postAppFunctionJson = () => new Promise(resolve => { release = resolve; });
  const pending = context.requestInventoryRead('master_page');
  await Promise.resolve(); await Promise.resolve();
  context.appAccessSnapshotState.snapshot.dataPermissionVersion = 'permissions-2';
  release({ ok:true, data:{ inventoryRevision:'13', rows:[{ ...serverRow, loc_on_hand:3000, loc_on_hand_revision:'13' }] } });
  await assert.rejects(pending, /STALE/);
});

test('requestInventoryRead sends no page request while the source gate is suspended', async () => {
  const { context } = setup(rows());
  let pageReads = 0;
  context.postAppFunctionJson = async () => { pageReads += 1; return { ok:true, data:{} }; };
  context.productionLiveSyncCoordinator = { isSourceReadSuspended: () => true };
  await assert.rejects(context.requestInventoryRead('master_page'), error =>
    error.code === 'LOC_SOURCE_READ_SUSPENDED' && error.status === 423);
  assert.equal(pageReads, 0);
  context.productionLiveSyncCoordinator = { isSourceReadSuspended: () => false };
  await context.requestInventoryRead('master_page');
  assert.equal(pageReads, 1, 'a permitted recovery read reaches the normal boundary');
});

test('linked inventory rows preserve zero and null aggregates and copy receipts only for the exact pair', () => {
  const { context } = setup(rows());
  const inventoryKeys = ['ITEMCODE','LOCATIONCODE'];
  const receipt = { ITEMCODE:'001973.030.1', LOCATIONCODE:'I.12.000', LOC_ON_HAND:0,
    LOC_ON_HAND_ITEMCODE:'001973.030.1', LOC_ON_HAND_LOCATIONCODE:'I.12.000', LOC_ON_HAND_REVISION:'12',
    LOC_ON_HAND_RECEIPT_SCOPE:'actor-a', LOC_ON_HAND_RECEIPT_PERMISSION:'permissions-1', LOC_ON_HAND_RECEIPT_REVISION:'12' };
  const target = { ITEMCODE:'001973.030.1', LOCATIONCODE:'I.12.000', LOC_ON_HAND:99 };
  context.syncMasterFieldsToRow(receipt, target, inventoryKeys);
  assert.equal(target.LOC_ON_HAND, 0, 'zero is copied without truthiness fallback');
  assert.equal(target.LOC_ON_HAND_RECEIPT_REVISION, '12');
  receipt.LOC_ON_HAND = null;
  context.syncMasterFieldsToRow(receipt, target, inventoryKeys);
  assert.equal(target.LOC_ON_HAND, null, 'explicit null is copied as authoritative');
  const mismatched = { ITEMCODE:'001973.030.1', LOCATIONCODE:'C.16.000', LOC_ON_HAND:450,
    LOC_ON_HAND_RECEIPT_SCOPE:'actor-a', LOC_ON_HAND_RECEIPT_PERMISSION:'permissions-1', LOC_ON_HAND_RECEIPT_REVISION:'12' };
  context.syncMasterFieldsToRow(receipt, mismatched, []);
  assert.equal(Object.hasOwn(mismatched, 'LOC_ON_HAND'), false, 'pair mismatch drops the old server aggregate');
  assert.equal(Object.hasOwn(mismatched, 'LOC_ON_HAND_RECEIPT_SCOPE'), false, 'pair mismatch drops the receipt instead of reauthorizing it');
});

test('aggregate invalidation preserves aliased values but makes them Unknown until a newer receipt is accepted', () => {
  const { context } = setup(rows());
  const row = { ITEMCODE:'001973.030.1', LOCATIONCODE:'I.12.000', LOC_ON_HAND:2000, LOC_ON_HAND_REVISION:'12' };
  context.fullInventory.push(row);
  context.acceptCardLocationOnHandSourceReceipt('actor-a', 'permissions-1', '12');
  context.stampCardLocationOnHandReceipt(row, 'actor-a', 'permissions-1', '12');
  context.clearAcceptedLocOnHandAggregates();
  assert.equal(row.LOC_ON_HAND, 2000, 'invalidation does not erase values from aliased accepted snapshots');
  assert.equal(context.getCardLocationOnHandValue(row), null, 'invalid receipt prevents reuse and partial fallback');
  row.LOC_ON_HAND = 3000; row.LOC_ON_HAND_REVISION = '13';
  assert.equal(context.acceptCardLocationOnHandSourceReceipt('actor-a', 'permissions-1', '13'), true);
  context.stampCardLocationOnHandReceipt(row, 'actor-a', 'permissions-1', '13');
  assert.equal(context.getCardLocationOnHandValue(row), '3,000', 'a newer accepted aliased row remains usable');
  const cached = { loc_on_hand:2, loc_on_hand_receipt_scope:'actor-a', loc_on_hand_revision:'13' };
  context.clearCardLocationOnHandReceipt(cached);
  assert.deepEqual(Object.keys(cached), [], 'cache cleanup strips lowercase derived fields too');
});

// v2.3.11: cached row decoration must not veto a complete authorized location index.
test('Blue Point location totals survive absent row receipts and unrelated adapters', () => {
  const fixture = setup([
    { UNIQUE_ID:'blue-g', ITEMCODE:'000152.050.1', LOCATIONCODE:'G.11.000', LOTCODE:'27.F1', PTRONHAND:88, LOC_ON_HAND:88, SOURCE:'MASTER' },
    { UNIQUE_ID:'blue-l', ITEMCODE:'000152.050.1', LOCATIONCODE:'L.05.000', LOTCODE:'25.F1', PTRONHAND:1, LOC_ON_HAND:1, SOURCE:'MASTER' },
  ]);
  const { context, state } = fixture;
  context.nativeAuthSessionActive = true; context.nativeAuthProfile = {id:'fixture-profile', username:'rep'};
  context.currentUser = 'rep'; context.currentRole = 'Sales Rep';
  Object.assign(state, {
    liveVerifiedScope:JSON.stringify(['fixture-profile', 'rep', 'Sales Rep', 'login-scope']),
    liveVerifiedPermission:'permissions-1', liveVerifiedRevision:'12'
  });
  context.hasCurrentProductionLiveSyncProof = () => false;
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '88');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[1]), '1');
  state.rowCompleteness = 'partial';
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), null);
  state.rowCompleteness = 'complete'; state.liveVerifiedPermission = 'stale';
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), null);
});

test('location metrics use the exact queue authorization scope without rebuilding live adapter context', () => {
  const fixture = setup(rows());
  const { context, state } = fixture;
  context.nativeAuthSessionActive = true;
  context.nativeAuthProfile = { id: 'profile-a', username: 'rep' };
  context.currentUser = 'rep';
  context.currentRole = 'Sales Rep';
  const liveScope = JSON.stringify(['profile-a', 'rep', 'Sales Rep', 'login-scope']);
  Object.assign(state, {
    liveVerifiedScope: liveScope,
    liveVerifiedPermission: 'permissions-1',
    liveVerifiedRevision: '12',
  });
  context.getProductionLiveSyncContext = () => {
    throw new Error('card metrics must not rebuild the full production adapter graph');
  };

  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '5,000',
    'the existing scope, permission, and revision proof still authorizes the complete master index');

  const accepted = context.acceptCardLocationOnHandSourceReceipt('actor-a', 'permissions-1', '12');
  assert.equal(accepted, true);
  const aggregateRow = {
    ...context.fullInventory[0],
    LOC_ON_HAND: 7000,
    LOC_ON_HAND_ITEMCODE: '001',
    LOC_ON_HAND_LOCATIONCODE: 'A.01.001',
    LOC_ON_HAND_REVISION: '12',
    LOC_ON_HAND_RECEIPT_SCOPE: 'actor-a',
    LOC_ON_HAND_RECEIPT_PERMISSION: 'permissions-1',
    LOC_ON_HAND_RECEIPT_REVISION: '12',
  };
  assert.equal(context.getCardLocationOnHandValue(aggregateRow), '7,000',
    'accepted server aggregates remain available without an adapter graph rebuild');

  context.appAccessSnapshotState.snapshot.dataPermissionVersion = 'permissions-2';
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), null,
    'a permission change invalidates the previous master proof');
});


test('Rosy Muhly location total remains 195 from a same-account complete display cache during refresh', () => {
  const rows = [
    { UNIQUE_ID: 'rosy-f1', ITEMCODE: '010539.030.1', LOCATIONCODE: 'F.16.000', LOTCODE: '27.F1', PTRONHAND: 195 },
    { UNIQUE_ID: 'other-location', ITEMCODE: '010539.030.1', LOCATIONCODE: 'F.17.000', LOTCODE: '27.F1', PTRONHAND: 99 },
  ];
  const { context, state } = setup(rows);
  context.nativeAuthSessionActive = true;
  context.nativeAuthProfile = { id: 'fixture-profile', username: 'rep' };
  context.currentUser = 'rep'; context.currentRole = 'Sales Rep';
  state.rowCompleteness = 'unknown'; state.initialLoaded = false;
  context.productionDisplayMasterReceipt = { rows: context.fullInventory, readScope: 'actor-a', permission: 'permissions-1' };
  assert.equal(context.getCardLocationOnHandValue(rows[0]), '195');
  context.productionDisplayMasterReceipt.permission = 'other-permissions';
  assert.equal(context.getCardLocationOnHandValue(rows[0]), null);
  context.productionDisplayMasterReceipt.permission = 'permissions-1';
  context.productionDisplayMasterReceipt.rows = rows.slice(0, 1);
  assert.equal(context.getCardLocationOnHandValue(rows[0]), null, 'partial replacement cannot borrow complete display proof');
});
