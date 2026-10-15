// @test-group: inventory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('var preparedMasterRows = new WeakMap();');
const end = html.indexOf('function hydrateReserveInventoryRow', start);
assert.ok(start >= 0 && end > start, 'bounded master preparation helper cluster should exist');
const source = html.slice(start, end);
const indexStart = html.indexOf('function createMasterInventoryIndexMaps() {');
const indexEnd = html.indexOf('function rebuildMasterInventoryIndexes() {', indexStart);
assert.ok(indexStart >= 0 && indexEnd > indexStart, 'shared master index helpers should exist');
const indexSource = html.slice(indexStart, indexEnd);

function createHarness({ onYield = () => {} } = {}) {
  let identity = 'identity-a';
  let permission = 'permission-a';
  let season = { seasonCode: 'F1', salesYear: '2027' };
  const context = vm.createContext({
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: permission } },
    getSupabaseReadIdentityScope: () => identity,
    getCurrentAppSeasonSettings: () => season,
    formatFetchedRows: (rows) => rows.map((row) => ({ ...row, SOURCE_TABLE: 'ph_master_inventory', normalized: true })),
    buildSearchIndex: (row) => { row._searchCandidates = [row.UNIQUE_ID]; return row; },
    applyMasterAppTabAssignments: (rows) => rows.forEach((row) => { row.APP_TAB_ASSIGNMENT = 'season'; }),
    shouldIncludeMasterItemInAvSeasonView: () => true,
    isEvalScopedDataRowVisibleToCurrentUser: () => true,
    syncMasterFieldsToRow: (master, target, keys) => {
      keys.forEach((key) => { target[key] = master[key]; });
      target.alias = master.VALUE;
      target._searchCandidates = [...master._searchCandidates];
      target.photo = { ...master.photo };
      return target;
    },
    EXACT_ROW_SYNC_KEYS: ['VALUE'],
    getMasterInventoryExactKey: row => {
      const values = [row.ITEMCODE || row.ITEM, row.LOCATIONCODE || row.LOCATION, row.LOTCODE || row.LOT, row.SOURCE || row.source]
        .map(value => String(value || '').trim().toUpperCase());
      return values.every(Boolean) ? values.join('__') : '';
    },
    getItemInquiryItemCode: row => String(row && (row.ITEMCODE || row.itemcode || row.ITEM || row.item) || '').trim().toUpperCase(),
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    addInventoryCardLocationOnHand: (map, row) => {
      const item = String(row && (row.ITEMCODE || row.itemcode || row.ITEM) || '').trim().toUpperCase();
      const location = String(row && (row.LOCATIONCODE || row.locationcode || row.LOCATION) || '').trim().toUpperCase();
      if (!item || !location) return map;
      const key = JSON.stringify([item, location]);
      const entry = map.get(key) || { total: 0, known: true };
      const value = Number(row.PTRAVAILABLE ?? row.ptravailable);
      if (!Number.isFinite(value)) entry.known = false;
      else entry.total += value;
      map.set(key, entry);
      return map;
    },
    yieldToUiFrame: async () => { onYield(); },
    JSON, WeakMap, Map, Array, Object, String, Number, Math, Promise, Error,
  });
  vm.runInContext(`${indexSource}\n${source}\nthis.api = { prepare: prepareProductionMasterSnapshot, current: getCurrentPreparedMasterRows, take: takePreparedMasterIndexMaps, buildIndexes: buildMasterInventoryIndexMaps };`, context);
  return {
    api: context.api,
    setIdentity: value => { identity = value; },
    setPermission: value => { permission = value; context.appAccessSnapshotState.snapshot.dataPermissionVersion = value; },
    setSeason: value => { season = value; },
  };
}

test('prepares master display and AV candidates in bounded batches without sharing source or search state', async () => {
  let yields = 0;
  const harness = createHarness({ onYield: () => { yields += 1; } });
  const input = Array.from({ length: 130 }, (_, index) => ({ UNIQUE_ID: `uid-${index}`, VALUE: index,
    nested: { source: 'unchanged' }, photo: { link: `photo-${index}` } }));
  const result = await harness.api.prepare(input);

  assert.equal(yields, 4, 'display formatting and AV projection yield at the 64-row batch boundaries');
  assert.equal(result.rowCount, 130);
  assert.equal(result.rawRows.length, 130);
  assert.notEqual(result.payload.data, input);
  assert.notEqual(result.payload.data[0], input[0]);
  assert.equal(input[0].nested.source, 'unchanged');
  assert.equal(result.payload.data[0].APP_TAB_ASSIGNMENT, 'season');
  const prepared = harness.api.current(result.payload.data);
  assert.ok(prepared);
  assert.equal(prepared.avOpenRows.length, 130);
  assert.ok(prepared.indexMaps, 'four lookup maps are prepared alongside display rows');
  assert.equal(prepared.indexMaps.byId.get('uid-0'), result.payload.data[0]);
  assert.notEqual(prepared.avOpenRows[0], result.payload.data[0]);
  assert.notEqual(prepared.avOpenRows[0]._searchCandidates, result.payload.data[0]._searchCandidates);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.avOpenRows[0].photo)), { link: 'photo-0' });
});

test('prepared master indexes preserve full-rebuild duplicate and missing-key semantics', async () => {
  const harness = createHarness();
  const rows = [
    { UNIQUE_ID: 'duplicate-id', ITEMCODE: 'item-a', LOCATIONCODE: 'loc-a', LOTCODE: 'lot-a', SOURCE: 'grower', PTRAVAILABLE: 2 },
    { UNIQUE_ID: 'duplicate-id', ITEMCODE: 'item-a', LOCATIONCODE: 'loc-a', LOTCODE: 'lot-a', SOURCE: 'grower', PTRAVAILABLE: 3 },
    { UNIQUE_ID: 'id-c', ITEMCODE: 'item-a', LOCATIONCODE: 'loc-b', LOTCODE: 'lot-b', SOURCE: 'grower', PTRAVAILABLE: 4 },
    { UNIQUE_ID: '', ITEMCODE: 'item-no-source', LOCATIONCODE: 'loc-c', LOTCODE: 'lot-c', PTRAVAILABLE: 5 },
    null,
  ];
  const result = await harness.api.prepare(rows);
  const prepared = harness.api.current(result.payload.data);
  const rebuilt = harness.api.buildIndexes(result.payload.data);
  const preparedIndexes = prepared.indexMaps;

  assert.equal(preparedIndexes.byId.get('duplicate-id'), result.payload.data[1], 'ID duplicates retain last-row-wins');
  assert.equal(preparedIndexes.byExactKey.get('ITEM-A__LOC-A__LOT-A__GROWER'), result.payload.data[0], 'exact-key duplicates retain first-row-wins');
  assert.deepEqual(Array.from(preparedIndexes.byItemCode.get('ITEM-A')), [result.payload.data[0], result.payload.data[1], result.payload.data[2]]);
  assert.equal(preparedIndexes.byId.has(''), false);
  assert.equal(preparedIndexes.byExactKey.has(''), false);
  assert.deepEqual(JSON.parse(JSON.stringify(preparedIndexes.byItemLocationOnHand.get('["ITEM-A","LOC-A"]'))), { total: 5, known: true });
  for (const key of ['byId', 'byExactKey', 'byItemCode', 'byItemLocationOnHand']) {
    assert.deepEqual(JSON.parse(JSON.stringify(Array.from(preparedIndexes[key]))), JSON.parse(JSON.stringify(Array.from(rebuilt[key]))), `${key} matches ordinary full rebuild`);
  }
});

test('prepared indexes are consumed once and replaced-row publications fall back to rebuild', async () => {
  const harness = createHarness();
  const result = await harness.api.prepare([{ UNIQUE_ID: 'uid-1', ITEMCODE: 'item-a' }]);
  const prepared = harness.api.current(result.payload.data);
  const first = harness.api.take(prepared, true);
  assert.ok(first);
  assert.equal(harness.api.take(prepared, true), null, 'a later commit cannot reuse stale prepared maps');

  const secondResult = await harness.api.prepare([{ UNIQUE_ID: 'uid-2', ITEMCODE: 'item-b' }]);
  const secondPrepared = harness.api.current(secondResult.payload.data);
  assert.equal(harness.api.take(secondPrepared, false), null, 'evidence replacement forces the regular rebuild path');
  assert.ok(secondPrepared.indexMaps, 'fallback leaves private maps available only to the current prepared publication');

  const commitStart = html.indexOf('function processAndLoadData(res) {');
  const commitEnd = html.indexOf('if (hasCropRollDrive) {', commitStart);
  const commit = html.slice(commitStart, commitEnd);
  assert.match(commit, /preparedRowsUnchanged = false/);
  assert.match(commit, /takePreparedMasterIndexMaps\(prepared, preparedRowsUnchanged\)/);
  assert.match(commit, /if \(preparedIndexes\) installMasterInventoryIndexMaps\(preparedIndexes\);\s*else rebuildMasterInventoryIndexes\(\);/);
});

test('discards a preparation when identity, permissions, or season changes across a yield', async () => {
  let harness;
  harness = createHarness({ onYield: () => harness.setIdentity('identity-b') });
  const rows = Array.from({ length: 130 }, (_, index) => ({ UNIQUE_ID: `uid-${index}`, VALUE: index }));
  await assert.rejects(harness.api.prepare(rows), error => error.code === 'DATASET_READ_SCOPE_CHANGED');

  const second = createHarness();
  const prepared = await second.api.prepare([{ UNIQUE_ID: 'uid-1', VALUE: 1 }]);
  assert.ok(second.api.current(prepared.payload.data));
  second.setPermission('permission-b');
  assert.equal(second.api.current(prepared.payload.data), null);
  second.setPermission('permission-a');
  second.setSeason({ seasonCode: 'S1', salesYear: '2028' });
  assert.equal(second.api.current(prepared.payload.data), null);
});

test('cancels private preparation on abort, permission changes, and season changes during a yield', async () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({ UNIQUE_ID: `uid-${index}`, VALUE: index }));
  for (const reason of ['abort', 'permission', 'season']) {
    const controller = new AbortController();
    let harness;
    harness = createHarness({ onYield: () => {
      if (reason === 'abort') controller.abort();
      else if (reason === 'permission') harness.setPermission('permission-b');
      else harness.setSeason({ seasonCode: 'S1', salesYear: '2028' });
    } });
    await assert.rejects(harness.api.prepare(rows, { signal: controller.signal }),
      error => error.code === (reason === 'abort' ? 'REQUEST_ABORTED' : 'DATASET_READ_SCOPE_CHANGED'));
    assert.equal(rows.some(row => Object.hasOwn(row, 'DOM_ID')), false, 'cancelled preparation never mutates source rows');
  }
});

test('preview preparation honors its row limit and keeps cache, display, and source ownership separate', async () => {
  const harness = createHarness();
  const rows = Array.from({ length: 130 }, (_, index) => ({ UNIQUE_ID: `uid-${index}`, VALUE: index, nested: { value: index } }));
  const preview = await harness.api.prepare(rows, { limit: 50 });
  assert.equal(preview.rowCount, 50);
  assert.equal(preview.payload.data.length, 50);
  assert.equal(preview.rawRows.length, 50);
  preview.payload.data[0].nested.value = 900;
  assert.equal(preview.rawRows[0].nested.value, 0);
  assert.equal(rows[0].nested.value, 0);
  const cache = await harness.api.prepare(rows, { limit: 50, includeRawRows: false });
  assert.equal(cache.rawRows.length, 0, 'cache reads may reuse their existing immutable raw snapshot');
  assert.equal(cache.rowCount, 50);
});

test('verified master publication stamps each candidate once after invalidating prior aggregate receipts', () => {
  const commitStart = html.indexOf('function processAndLoadData(res) {');
  const commitEnd = html.indexOf('const prepared = getCurrentPreparedMasterRows(res.data);', commitStart);
  assert.ok(commitStart >= 0 && commitEnd > commitStart);
  const prefix = html.slice(commitStart, commitEnd) + '} }';
  for (const withMaster of [true, false]) {
    const master = { id: 'master' }, av = { id: 'av' }, request = { id: 'request' };
    const events = [];
    const context = vm.createContext({
      getCurrentPreparedMasterRows: () => ({ avOpenRows: [av] }),
      redactEvalSensitiveData: value => value,
      acceptCardLocationOnHandSourceReceipt: () => { events.push('accept'); return true; },
      clearAcceptedLocOnHandAggregates: () => events.push('clear'),
      stampCardLocationOnHandReceipt: row => events.push(row.id),
      Object, Array, String,
    });
    vm.runInContext(prefix + '; this.commit = processAndLoadData;', context);
    context.commit({ ...(withMaster ? { data: [master] } : {}), requestsData: [request], _verifiedLiveSync: true,
      _locOnHandReceiptScope: 'identity-a', _locOnHandReceiptPermission: 'permission-a', _locOnHandReceiptRevision: '1' });
    assert.deepEqual(events, withMaster ? ['clear', 'accept', 'master', 'request', 'av'] : ['accept', 'request']);
  }
});
