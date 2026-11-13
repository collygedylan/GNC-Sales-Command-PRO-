import { calculateLiveLocPhotoMatch } from '../src/core/inventory-photo-domain.js';
import { buildDockIssueSourceMatchKey, getDockOrderedQtyRaw, normalizeDockIssueState } from '../src/core/dock-issue-domain.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { getDockOrderBusinessKey, normalizeDockViewDockKey, normalizeDockViewStopKey, isDockSuspendDcRequestMirrorRow, isDockSuspendDcRequestSource, hydrateLiveInventoryCardDisplay, mergeLiveInventoryCardRows, applyDockSuspendQuantityAliases, normalizeSocDockRowAliases } from '../src/core/dock-order-domain.js';

test('classic runtime uses the exact Dock order domain source', () => {
  const moduleSource = readFileSync(new URL('../src/core/dock-order-domain.js', import.meta.url), 'utf8');
  const classic = readFileSync(new URL('../assets/dock-order-domain.js', import.meta.url), 'utf8');
  assert.equal(classic, moduleSource.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''));
  const context = vm.createContext({});
  vm.runInContext(classic, context);
  const row = { dock: 'Dock 036.0', stopnumber: 'Stop 30.0', itemcode: '003085.030.', locationcode: ' C.08.000 ', quantityordered: '1,000' };
  assert.equal(context.getDockOrderBusinessKey(row), getDockOrderBusinessKey(row));
  assert.equal(getDockOrderBusinessKey(row), getDockOrderBusinessKey({ ...row, dock: '36', stopnumber: '30', itemcode: '003085.030', quantityordered: '1000.0' }));
  assert.equal(getDockOrderBusinessKey({ ...row, stopnumber: '' }), '');
  assert.equal(normalizeDockViewDockKey('0'), 'Unassigned');
  assert.equal(normalizeDockViewStopKey('Drop 12.0'), '12');
});

test('Suspend recognition preserves source, mirror, and closed-row rules', () => {
  const source = { suspend: 'SUSPEND', dock: 'Dock 36' };
  assert.equal(isDockSuspendDcRequestSource(source), true);
  assert.equal(isDockSuspendDcRequestMirrorRow(source), true);
  assert.equal(isDockSuspendDcRequestSource({ ...source, status: 'completed' }), false);
  assert.equal(isDockSuspendDcRequestMirrorRow({ request_type: 'suspend_tag' }), true);
  assert.equal(isDockSuspendDcRequestMirrorRow({ source_table: 'ph_soc_master', request_source: 'docks' }), true);
  assert.equal(isDockSuspendDcRequestMirrorRow({ ...source, dock: '' }), false);
  assert.equal(isDockSuspendDcRequestMirrorRow(null), false);
});

test('inventory projection preserves physical identity, scoped evidence and quantity totals', () => {
  const one = { UNIQUE_ID:'one', ITEMCODE:'A', LOCATIONCODE:'L1', LOTCODE:'27.F1', PTRONHAND:'10', PTRAVAILABLE:'3', PTRREVIEWED:'2', SPEC:'original', LOC_MATCH_QTY:'4' };
  const two = { ...one, UNIQUE_ID:'two', LOTCODE:'27.S1', PTRONHAND:'5', PTRAVAILABLE:'7' };
  const note = { MASTER_ID:'one', ITEMCODE:'A', LOCATIONCODE:'L1', LOTCODE:'27.F1', SPEC:'scoped', LOC_MATCH_QTY:'6' };
  const before = structuredClone([one,two,note]);
  const result = hydrateLiveInventoryCardDisplay(one, [one], [one,two], [one,two], {
    canonical:one, notes:[note], normalizeLocation:value=>String(value || '').toUpperCase(), calculateMatch:()=>99
  });
  assert.equal(result.UNIQUE_ID, 'one');
  assert.equal(result.SPEC, 'scoped');
  assert.equal(result.PTRONHAND, 10);
  assert.equal(result.LOC_ON_HAND, 15);
  assert.equal(result.S_LTS, 10);
  assert.equal(result.LOC_MATCH_QTY, 6);
  assert.deepEqual([one,two,note], before);
  const merged = mergeLiveInventoryCardRows([one, {...one, UNIQUE_ID:'duplicate', PHOTO_LINK:'photo'}], value=>value ? [value] : []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].__physicalInventoryRows.length, 2);
  assert.equal(merged[0].PHOTO_LINK, 'photo');
});

test('inventory display projection derives location totals without collapsing physical master rows', () => {
  const primary = { UNIQUE_ID:'f1', ITEMCODE:'A', LOCATIONCODE:'L1', LOTCODE:'27.F1', PTRONHAND:'90',
    PTRREVIEWED:'25', PTRAVAILABLE:'65', S_LTS:'57', MATCH:'65', LOC_MATCH_QTY:'59', PHOTO_LINK:'photo',
    AV_RULE_PHOTO_UPDATED_AT:'2026-10-20T00:00:00Z' };
  const rows = [primary,
    { ...primary, UNIQUE_ID:'s1', LOTCODE:'27.S1', PTRONHAND:'59', PTRREVIEWED:null, PTRAVAILABLE:'59', PHOTO_LINK:null },
    { ...primary, UNIQUE_ID:'u1', LOTCODE:'27.U1', PTRONHAND:'79', PTRREVIEWED:null, PTRAVAILABLE:'79', PHOTO_LINK:null },
    { ...primary, UNIQUE_ID:'x1', LOTCODE:'27.X', PTRONHAND:'26', PTRREVIEWED:null, PTRAVAILABLE:'26', PHOTO_LINK:null }];
  const before = structuredClone(rows);
  const result = hydrateLiveInventoryCardDisplay(primary, [primary], rows, rows, {
    canonical:{...primary, LOC_PHOTO_MATCH:59}, notes:[], normalizeLocation:value=>String(value || '').toUpperCase(), calculateMatch:()=>34
  });
  assert.deepEqual({ onHand:result.PTRONHAND, review:result.PTRREVIEWED, available:result.PTRAVAILABLE,
    openStock:result.S_LTS, locOnHand:result.LOC_ON_HAND, locPhotoMatch:result.LOC_MATCH_QTY },
  { onHand:90, review:25, available:65, openStock:'57', locOnHand:254, locPhotoMatch:59 });
  assert.deepEqual(rows, before);
  assert.equal(mergeLiveInventoryCardRows(rows).length, 4);
  const unverified = { ...primary, AV_RULE_PHOTO_UPDATED_AT:null };
  assert.equal(hydrateLiveInventoryCardDisplay(unverified, [unverified], [unverified], [unverified], {
    canonical:{...unverified, LOC_PHOTO_MATCH:59}, notes:[], normalizeLocation:value=>String(value || '').toUpperCase(), calculateMatch:()=>34
  }).LOC_MATCH_QTY, null);
});

test('Dock issue domain is the same classic code and preserves identity aliases', () => {
  const moduleSource = readFileSync(new URL('../src/core/dock-issue-domain.js', import.meta.url), 'utf8');
  const classic = readFileSync(new URL('../assets/dock-issue-domain.js', import.meta.url), 'utf8');
  assert.equal(classic, moduleSource.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''));
  const item = { dock:'Dock 38', stopnumber:'3', ITEMCODE:'A.1', LOCATIONCODE:'L1', LOTCODE:'27.F1' };
  assert.equal(buildDockIssueSourceMatchKey(item), buildDockIssueSourceMatchKey({ ...item, dock:'Dock-38' }));
  assert.equal(buildDockIssueSourceMatchKey({}), '');
  assert.equal(getDockOrderedQtyRaw({ order_qty:0, QTY:5 }), 0);
  assert.equal(normalizeDockIssueState('drop off'), 'drop_off');
});

test('SOC normalization and Suspend aliases retain exact source values', () => {
  const row = normalizeSocDockRowAliases({ unique_id:'id', dock:'T123', STOP:'Stop 04.0', itemcode:'A', printedcontainercode:'#3' });
  assert.equal(row.TRIPNUMBER, 'T123');
  assert.equal(row.DOCK_NUM, 'Unassigned');
  assert.equal(row.STOPNUMBER, '04');
  assert.equal(row.CONTSIZE, '#3');
  const mirror = { PTRAVAILABLE:0 };
  const source = { IS_SUSPEND_TAG:true, ON_HAND:4, REVIEW:2, AVAILABLE:3, OPEN_STOCK:9 };
  assert.equal(applyDockSuspendQuantityAliases(mirror, source), mirror);
  assert.equal(mirror.PTRONHAND, 4);
  assert.equal(mirror.PTRREVIEWED, 2);
  assert.equal(mirror.PTRAVAILABLE, 3);
  assert.equal(mirror.S_LTS, 9);
});

test('photo depletion preserves authoritative zero and positive alias fallback', () => {
  const source = readFileSync(new URL('../src/core/inventory-photo-domain.js', import.meta.url), 'utf8');
  const classic = readFileSync(new URL('../assets/inventory-photo-domain.js', import.meta.url), 'utf8');
  assert.equal(classic, source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''));
  assert.equal(calculateLiveLocPhotoMatch({ PTRONHAND:0, on_hand:51, PTRAVAILABLE:347, MATCH:80 }), 0);
  assert.equal(calculateLiveLocPhotoMatch({ on_hand:51, MATCH:80 }), 41);
  assert.equal(calculateLiveLocPhotoMatch({ onhand:1000, available:750, match_pct:50, eval_baseline_available:1000, initial_loc_photo_match:500 }), 250);
});

test('canonical fullInventory rows retain every physical UID', () => {
  const one = { UNIQUE_ID: 'one', ITEMCODE: 'ITEM', LOCATIONCODE: 'A-1', LOTCODE: 'F1', DOM_ID: 'fi_0' };
  const two = { ...one, UNIQUE_ID: 'two', DOM_ID: 'fi_1' };
  assert.equal(mergeLiveInventoryCardRows([one, two]).length, 2);
});
