import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: drive,photos,av-blanks
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { buildSync } from 'esbuild';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
const evalSecurityStart = html.indexOf('        function isEvalSensitiveDataRestricted(');
const evalSecurityEnd = html.indexOf('        function runDedupeSupabaseRead(', evalSecurityStart);
assert.ok(evalSecurityStart >= 0 && evalSecurityEnd > evalSecurityStart, 'Eval security helpers should exist');
const evalSecurityHelpers = html.slice(evalSecurityStart, evalSecurityEnd);
const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('../services/driveEvidence.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const database = module.exports;
function source(name) {
  const start = html.indexOf(`        function ${name}(`);
  const end = html.indexOf('\n        }', start);
  assert.ok(start >= 0 && end > start, name);
  return html.slice(start, end + 10);
}
const stamp = '2026-10-07T18:00:00.123456Z';
const photo = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/capture.webp';
function row(changes = {}) {
  return { ...Object.fromEntries(database.driveEvidenceColumns.map(key => [key, null])),
    unique_id: 'drive-one', itemcode: '00123', locationcode: 'C.06.001', lotcode: '26.F1',
    commonname: 'Synthetic plant', contsize: '#3', season: 'F1', last_updated: stamp,
    photo_link: photo, photo_name: 'capture.webp', spec: '24-30', match: '50', initial_ptr: '20',
    ptravailable: '20', loc_match_qty: '10', av_rule_photo_updated_at: stamp, av_rule_spec_updated_at: stamp,
    av_rule_match_updated_at: stamp, av_rule_bundle_updated_at: stamp, ...changes };
}
const receipt = changes => ({ ok: true, canonicalConfirmed: true, row: row(changes), requestRows: [] });
function runtime() {
  const rendered = [], broadcasts = [], dirty = new Set();
  const c = vm.createContext({ console, URL, Date, Map, Set,
    window: { GncDatabase: database }, scope: 'user-one', confirmedDriveEvidenceRows: new Map(),
    fullInventory: [], avOpenInventory: [], lowStockInventory: [], managerReviewInventory: [], moveUpInventory: [],
    salesOfficeInventory: [], socInventory: [], reservesInventory: [], requestsInventory: [], flyerFolderInventory: [], activeItem: null,
    getSupabaseReadIdentityScope: () => c.scope, getFlyerShadowKeys: () => [],
    getDatasetKeysForTable: () => ['master', 'avOpen'], touchDatasetLoadStateForLocalChange() {},
    rebuildMasterInventoryIndexes() {}, normalizeAppTableName: value => value,
    normalizeNcrInheritanceKeyPart: value => String(value ?? '').trim().toUpperCase(),
    getInventoryCardItemLocationKey: item => {
      const itemCode = String(item?.ITEMCODE ?? item?.itemcode ?? '').trim().toUpperCase();
      const locationCode = String(item?.LOCATIONCODE ?? item?.locationcode ?? item?.location_code ?? '').trim().toUpperCase();
      return itemCode && locationCode ? JSON.stringify([itemCode, locationCode]) : '';
    },
    repairDisplayFieldsOnRow: value => value, buildSearchIndex: value => value,
    isFlyerFolderRow: () => false, findLinkedMasterRow: item => c.fullInventory.find(row => row.UNIQUE_ID === item.UNIQUE_ID),
    shouldIncludeMasterItemInAvSeasonView: item => item.SEASON !== 'X',
    rebuildInventoryByIdMap: items => new Map(items.map(item => [item.UNIQUE_ID, item])),
    syncMasterFieldsToSalesOfficeRow() {}, syncMasterFieldsToRequestRow() {},
    invalidateResolvedViewStateCaches: () => { c.invalidations++; }, invalidations: 0,
    broadcastRowSyncSnapshot: value => broadcasts.push(structuredClone(value)), rememberLocalRealtimeWrite() {},
    getVisibleAffectedViewIds: () => [c.visibleView], visibleView: 'drive',
    getAffectedViewsForDatasets: () => ['drive', 'av'], markViewDirty: id => dirty.add(id),
    shouldDeferInteractiveBackgroundWork: () => false,
    queueInteractiveViewRender: id => rendered.push(id),
  });
  const constants = ['ROW_SCOPED_DESIGNATION_SYNC_KEYS', 'MASTER_EVIDENCE_SYNC_KEYS', 'LINKED_ROW_SYNC_KEYS', 'EVAL_TASK_ROW_SYNC_KEYS', 'LOC_ON_HAND_SYNC_KEYS', 'EXACT_ROW_SYNC_KEYS']
    .map(name => html.match(new RegExp(`        const ${name} = [^\\n]+`))?.[0]).join('\n');
  const names = ['firstNonEmptyValue', 'parseAppNumber', 'parsePhotoCsvValues', 'mergePhotoCsvList', 'getLocPhotoOwnedValue',
    'invalidateLocOnHandAggregateRows', 'clearAcceptedLocOnHandAggregates',
    'normalizeFlyerShadowFields', 'getSharedAppPhotoName', 'normalizeRowPhotoFields', 'clonePhotoFields',
    'sortPhotoCsvPairByCaptureOrder', 'getPhotoCaptureOrderKey', 'getPhotoCaptureOrderParts', 'decodePhotoOrderText',
    'getPhotoAliasFieldsForPrefix', 'setPhotoAliasFieldsForPrefix', 'syncSharedFlyerPhotoFields',
    'syncMasterFieldsToRow', 'syncRowDataAcrossViews', 'propagateCommittedEdit', 'formatFetchedRows',
    'buildConfirmedDriveEvidenceState', 'preserveConfirmedDriveEvidence', 'reconcileConfirmedDriveEvidence'];
  vm.runInContext('let acceptedLocOnHandAggregateReceipt = { scope:"", permission:"", revision:"", valid:false };\n' + evalSecurityHelpers + '\n' + constants + '\n' + names.map(source).join('\n'), c);
  const [master] = c.formatFetchedRows([row({ last_updated: '2026-10-06T18:00:00Z', photo_link: null, photo_name: null, spec: 'old', av_rule_photo_updated_at: '2026-08-01T18:00:00Z' })], 'ph_master_inventory');
  master.DOM_ID = 'fi_0';
  c.fullInventory = [master]; c.avOpenInventory = [{ ...master, DOM_ID: 'avo_drive-one' }];
  c.activeItem = { ...master }; return { c, master, rendered, broadcasts, dirty };
}

test('photo acknowledgement updates cached Drive/AV while retaining an unsaved editor draft', () => {
  const r = runtime(); const { c, master } = r;
  c.activeItem = master; master.SPEC = 'unsaved draft'; master.AV_NOTE = 'private unsaved note';
  const other = { ...master, UNIQUE_ID: 'drive-two', LOCATIONCODE: 'C.07.001' };
  c.fullInventory.push(other); c.avOpenInventory.push({ ...other });
  const otherBefore = JSON.stringify([other, c.avOpenInventory[1]]);
  const result = c.reconcileConfirmedDriveEvidence(receipt(), master, 'ssn-', { photoOnly: true, scope: c.scope });
  assert.equal(result.applied, true);
  assert.equal(master.PHOTO_LINK, photo); assert.equal(master.SPEC, '24-30');
  assert.equal(master.AV_NOTE, null); assert.equal(c.avOpenInventory[0].AV_RULE_PHOTO_UPDATED_AT, stamp);
  assert.equal(c.avOpenInventory[0].LOC_MATCH_QTY, '10'); assert.equal(c.avOpenInventory[0].PHOTO_MATCH_PTR_AVAILABLE_KNOWN, true);
  assert.equal(c.activeItem.SPEC, 'unsaved draft'); assert.equal(c.activeItem.AV_NOTE, 'private unsaved note');
  assert.equal(c.activeItem.PHOTO_LINK, photo); assert.notEqual(c.activeItem, master);
  assert.equal(JSON.stringify([other, c.avOpenInventory[1]]), otherBefore);
  assert.deepEqual([...r.dirty], ['drive', 'av']); assert.deepEqual(r.rendered, ['drive']);
  assert.equal(r.broadcasts[0].SPEC, '24-30'); assert.equal(r.broadcasts[0].AV_NOTE, null);
});

test('completion publishes canonical specs and explicit clears while AV is visible', () => {
  const r = runtime(); r.c.visibleView = 'av';
  r.c.reconcileConfirmedDriveEvidence(receipt({ spec: 'new size', av_rule_last_clear_reason: null }), r.c.activeItem, 'ssn-');
  assert.equal(r.master.SPEC, 'new size'); assert.equal(r.c.activeItem.SPEC, 'new size');
  assert.equal(r.c.avOpenInventory[0].SPEC, 'new size');
  assert.equal(r.c.avOpenInventory[0].AV_RULE_LAST_CLEAR_REASON, null);
  assert.deepEqual(r.rendered, ['av']);
});

test('shared evidence propagation invalidates report pages and preserves an open Suspend editor', () => {
  const r = runtime();
  let reportInvalidations = 0;
  r.c.managerReportPageController = { invalidateInventory() { reportInvalidations += 1; } };
  r.c.visibleView = 'detail';
  r.c.activeItem = { UNIQUE_ID: 'dock_suspend_dc_soc-one', SOURCE_TABLE: 'ph_soc_master', REQ_SPEC: 'draft' };
  r.c.reconcileConfirmedDriveEvidence(receipt({ spec: 'saved size' }), r.master, 'req-', { preserveDetailDraft: true });
  assert.equal(r.master.SPEC, 'saved size');
  assert.equal(r.c.avOpenInventory[0].SPEC, 'saved size');
  assert.equal(r.c.activeItem.REQ_SPEC, 'draft');
  assert.equal(reportInvalidations, 1);
  assert.equal(r.broadcasts.length, 1);
  assert.deepEqual(r.rendered, [], 'background acknowledgement does not remount the editor');
});

test('Suspend Tag source acknowledgement cannot publish incomplete inventory evidence', () => {
  const r = runtime();
  const before = JSON.stringify(r.master);
  r.c.findLinkedMasterRow = () => r.master;
  r.c.propagateCommittedEdit('ph_soc_master', { UNIQUE_ID: 'soc-one', SOURCE_TABLE: 'ph_soc_master', SPEC: 'source-only' }, ['soc'], [], { sourceRowOnly: true });
  assert.equal(JSON.stringify(r.master), before);
  assert.equal(r.broadcasts.length, 0);
  assert.equal(r.c.invalidations, 1);
});

test('canonical exact read populates missing inventory without using an inferred duplicate link', () => {
  const r = runtime();
  const other = r.master;
  const before = JSON.stringify(other);
  const server = row({ unique_id: 'drive-two', spec: 'confirmed second row' });
  const [canonical] = r.c.formatFetchedRows([server], 'ph_master_inventory');
  r.c.findLinkedMasterRow = () => other;
  r.c.reconcileConfirmedDriveEvidence({ ok: true, canonicalConfirmed: true, row: server }, canonical, 'req-', { preserveDetailDraft: true });
  assert.equal(r.c.fullInventory.length, 2);
  assert.equal(r.c.fullInventory[1].UNIQUE_ID, 'drive-two');
  assert.equal(r.c.fullInventory[1].SPEC, 'confirmed second row');
  assert.equal(JSON.stringify(other), before);
});

test('later evidence clears replace lowercase aliases in a previously created AV cache row', () => {
  const { c, master } = runtime();
  c.avOpenInventory = [];
  c.reconcileConfirmedDriveEvidence(receipt({ pic_note: 'saved pick note' }), master, 'ssn-');
  assert.equal(c.avOpenInventory[0].spec, '24-30');
  assert.equal(c.avOpenInventory[0].match, '50');
  c.reconcileConfirmedDriveEvidence(receipt({ last_updated: '2026-10-07T18:00:01Z',
    spec: null, match: null, loc_match_qty: null, pic_note: null }), master, 'ssn-');
  for (const key of ['spec', 'match', 'loc_match_qty', 'pic_note']) {
    assert.equal(c.avOpenInventory[0][key], null, key);
    assert.equal(c.avOpenInventory[0][key.toUpperCase()], null, key.toUpperCase());
  }
  assert.equal(c.avOpenInventory[0].PICK, null);
});

test('older reads and repeated or older acknowledgements cannot replace confirmed evidence', () => {
  const r = runtime(); const { c, master } = r;
  c.reconcileConfirmedDriveEvidence(receipt(), master, 'ssn-');
  const count = r.broadcasts.length;
  assert.equal(c.reconcileConfirmedDriveEvidence(receipt(), master, 'ssn-').applied, false);
  assert.equal(c.reconcileConfirmedDriveEvidence(receipt({ last_updated: '2026-10-07T18:00:00.123455Z', spec: 'stale' }), master, 'ssn-').applied, false);
  const [lateRead] = c.formatFetchedRows([row({ last_updated: '2026-10-06T18:00:00Z', photo_link: null, spec: 'stale' })], 'ph_master_inventory');
  assert.equal(lateRead.PHOTO_LINK, photo); assert.equal(lateRead.SPEC, '24-30');
  const [catalogRead] = c.formatFetchedRows([row({ last_updated: null, commonname: 'Updated catalog name', ptronhand: '99' })], 'ph_master_inventory');
  assert.equal(catalogRead.COMMONNAME, 'Updated catalog name'); assert.equal(catalogRead.PTRONHAND, '99');
  const [movedRead] = c.formatFetchedRows([row({ last_updated: null, locationcode: 'C.08.001', spec: 'moved row' })], 'ph_master_inventory');
  assert.equal(movedRead.SPEC, 'moved row'); assert.equal(movedRead.LOCATIONCODE, 'C.08.001');
  assert.equal(r.broadcasts.length, count);
  const [newRead] = c.formatFetchedRows([row({ last_updated: '2026-10-07T18:00:00.123457Z', spec: 'newer server' })], 'ph_master_inventory');
  assert.equal(newRead.SPEC, 'newer server');
  assert.equal(c.preserveConfirmedDriveEvidence(lateRead).SPEC, 'newer server');
});

test('failed, cross-account and wrong-identity receipts do not change local rows', () => {
  const r = runtime(); const before = JSON.stringify(r.master);
  for (const result of [{ ...receipt(), ok: false }, receipt({ itemcode: 'different' }), receipt({ locationcode: 'C.07.001' })]) {
    assert.throws(() => r.c.reconcileConfirmedDriveEvidence(result, r.master, 'ssn-'));
  }
  assert.throws(() => r.c.reconcileConfirmedDriveEvidence(receipt(), r.master, 'ssn-', { scope: 'old-account' }), { code: 'DRIVE_SAVE_ABORTED' });
  assert.equal(JSON.stringify(r.master), before); assert.equal(r.broadcasts.length, 0);
});

test('same-row metadata never transfers into Request/Flyer rows and AV season eligibility is retained', () => {
  const { c, master } = runtime();
  c.reconcileConfirmedDriveEvidence(receipt(), master, 'ssn-');
  for (const table of ['ph_active_request', 'ph_flyer_folder_rows']) {
    const linked = { UNIQUE_ID: master.UNIQUE_ID, SOURCE_TABLE: table, AV_RULE_PHOTO_UPDATED_AT: 'owned' };
    c.linked = linked;
    vm.runInContext('syncMasterFieldsToRow(fullInventory[0], linked, EXACT_ROW_SYNC_KEYS)', c);
    assert.equal(linked.AV_RULE_PHOTO_UPDATED_AT, 'owned'); assert.equal(linked.LAST_UPDATED, undefined);
  }
  master.SEASON = 'X';
  c.reconcileConfirmedDriveEvidence(receipt({ last_updated: '2026-10-07T18:00:01Z', season: 'X' }), master, 'ssn-');
  assert.equal(c.avOpenInventory.length, 0);
});
