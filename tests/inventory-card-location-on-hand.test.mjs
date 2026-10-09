import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const source = scripts.find(script => script.includes('function getCardLocationOnHandValue('));
assert.ok(source, 'live inventory-card helper script is present');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const names = new Set([
  'firstNonEmptyValue', 'normalizeCardQuantityValue', 'getCardPtrOnHandValue',
  'parseAppNumber', 'normalizeMasterInventorySourceCode', 'getMasterInventorySourceCode',
  'getMasterInventoryExactKey', 'getInventoryCardItemLocationKey', 'addInventoryCardLocationOnHand',
  'getCardLocationOnHandValue', 'isDatasetLoaded', 'getItemInquiryItemCode',
  'normalizeNcrInheritanceKeyPart', 'rebuildMasterInventoryIndexes', 'applyRowSyncSnapshot',
]);
const declarations = ast.body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
for (const name of names) assert.ok(declarations.some(node => node.id.name === name), `source helper ${name} exists`);
const code = declarations.map(node => source.slice(node.start, node.end)).join('\n');

function setup(rows) {
  const state = { fullLoaded: true, fieldCoverage: 'full', initialLoaded: true };
  const indexInvalidations = { count: 0 };
  const context = vm.createContext({
    Map, Set, Number, String, Array, Object, JSON, Math,
    NON_MASTER_INVENTORY_SOURCE_CODES: new Set(['REQUEST', 'V2_ACTIVE_REQUEST', 'V2_MASTER_INVENTORY', 'V2_SALES_OFFICE']),
    MASTER_EVIDENCE_SYNC_KEYS: ['LAST_UPDATED', 'AV_RULE_LAST_CLEARED_AT'],
    FLYER_FOLDER_ROWS_TABLE: 'ph_flyer_folder_rows',
    fullInventory: rows,
    masterInventoryById: new Map(), masterInventoryByExactKey: new Map(), masterInventoryByItemCode: new Map(),
    masterInventoryByItemLocationOnHand: new Map(),
    nativeAuthSessionActive: false, nativeAuthProfile: null,
    getDatasetState: () => state,
    isMasterInitialLoadPartialForCurrentScope: () => false,
    canUseProductionLiveSync: () => true,
    getProductionLiveSyncContext: () => ({ adapters: [{ id: 'core:master' }] }),
    hasCurrentProductionLiveSyncProof: () => true,
    window: { GncDatabase: { driveEvidenceRevision: () => 0 } },
    findItemByUniqueId: uid => rows.find(row => row.UNIQUE_ID === uid) || null,
    findRequestRowByUniqueId: () => null,
    isRowScopedDesignationSyncKey: () => false,
    normalizeFlyerShadowFields() {},
    normalizeRowPhotoFields() {},
    syncSharedFlyerPhotoFields() {},
    syncRowDataAcrossViews() {},
    invalidateInventoryDomIdLookup: () => { indexInvalidations.count += 1; },
  });
  vm.runInContext(`let masterInventoryByItemLocationOnHand = new Map();\n${code}`, context);
  context.rebuildMasterInventoryIndexes();
  return { context, state, indexInvalidations };
}

const rows = () => [
  { UNIQUE_ID: 'a', ITEMCODE: '001', LOCATIONCODE: ' A.01.001 ', LOTCODE: '27.F1', CONTSIZE: '#3', SOURCE: 'MASTER', PTRONHAND: '1,250' },
  { UNIQUE_ID: 'b', ITEMCODE: '001', LOCATIONCODE: 'a.01.001', LOTCODE: '27.S1', CONTSIZE: '#7', SOURCE: 'MASTER', PTRONHAND: '3,750' },
  { UNIQUE_ID: 'c', ITEMCODE: '1', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', CONTSIZE: '#3', SOURCE: 'MASTER', PTRONHAND: '900' },
  { UNIQUE_ID: 'd', ITEMCODE: '001', LOCATIONCODE: 'B.01.001', LOTCODE: '27.F1', CONTSIZE: '#3', SOURCE: 'MASTER', PTRONHAND: '600' },
];

test('location On Hand sums exact item code and normalized location across lots and sizes', () => {
  const fixture = setup(rows());
  const { context } = fixture;
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '5000');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[1]), '5000');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[2]), '900', 'leading-zero item codes remain distinct');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[3]), '600', 'other locations remain isolated');
});

test('comma quantities parse, while a blank or invalid member makes the scope Unknown', () => {
  const fixture = setup(rows());
  const { context } = fixture;
  context.fullInventory[0].PTRONHAND = '1,250.5';
  context.fullInventory[1].PTRONHAND = '3,749.5';
  context.rebuildMasterInventoryIndexes();
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '5000');
  for (const invalid of ['', 'not-a-number']) {
    context.fullInventory[1].PTRONHAND = invalid;
    context.rebuildMasterInventoryIndexes();
    assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), null, `${JSON.stringify(invalid)} keeps the total unknown`);
  }
});

test('location total requires complete field coverage and current native master proof', () => {
  const fixture = setup(rows());
  const { context, state } = fixture;
  const target = context.fullInventory[0];
  state.fullLoaded = false;
  assert.equal(context.getCardLocationOnHandValue(target), null, 'an initial-only read is not a full inventory total');
  state.fullLoaded = true;
  state.fieldCoverage = 'browse';
  assert.equal(context.getCardLocationOnHandValue(target), null, 'browse field coverage is not enough');
  state.fieldCoverage = 'full';
  context.nativeAuthSessionActive = true;
  context.nativeAuthProfile = { id: 'fixture-profile' };
  context.getProductionLiveSyncContext = () => ({ adapters: [{ id: 'core:requests' }] });
  assert.equal(context.getCardLocationOnHandValue(target), null, 'proof without core:master is insufficient');
  context.getProductionLiveSyncContext = () => ({ adapters: [{ id: 'core:master' }] });
  context.hasCurrentProductionLiveSyncProof = () => false;
  assert.equal(context.getCardLocationOnHandValue(target), null, 'stale native proof is insufficient');
  context.hasCurrentProductionLiveSyncProof = () => true;
  assert.equal(context.getCardLocationOnHandValue(target), '5000');
  context.canUseProductionLiveSync = () => false;
  assert.equal(context.getCardLocationOnHandValue(target), null, 'unauthorized native context is not trusted');
});

test('rebuilding the real master indexes reflects confirmed quantity changes', () => {
  const fixture = setup(rows());
  const { context } = fixture;
  context.fullInventory[1].PTRONHAND = '5,000';
  context.rebuildMasterInventoryIndexes();
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '6250');
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
  assert.equal(context.getCardLocationOnHandValue(target), '6250');
  assert.equal(indexInvalidations.count, beforeRebuilds + 1, 'quantity changes refresh the aggregate index');

  const afterQuantityRebuilds = indexInvalidations.count;
  assert.equal(context.applyRowSyncSnapshot(snapshot({ LOCATIONCODE: 'B.01.001' })), true);
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[0]), '1250', 'moving the row changes the old location total');
  assert.equal(context.getCardLocationOnHandValue(context.fullInventory[3]), '5600', 'moving the row changes the new location total');
  assert.equal(indexInvalidations.count, afterQuantityRebuilds + 1, 'item/location key changes refresh the aggregate index');

  const afterKeyRebuilds = indexInvalidations.count;
  assert.equal(context.applyRowSyncSnapshot(snapshot({ SAVED_PHOTO_LINK: 'https://example.invalid/photo.webp' })), true);
  assert.equal(context.applyRowSyncSnapshot(snapshot({ PTRONHAND: '5,000' })), true);
  assert.equal(indexInvalidations.count, afterKeyRebuilds, 'metadata-only and unchanged acknowledgments do not rebuild the index');
});
