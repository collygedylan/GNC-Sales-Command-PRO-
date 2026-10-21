import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: inventory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const start = html.indexOf('var preparedMasterRows = new WeakMap();');
const end = html.indexOf('function hydrateReserveInventoryRow', start);
assert.ok(start >= 0 && end > start, 'bounded master preparation helper cluster should exist');
const source = html.slice(start, end);
const indexStart = html.indexOf('function createMasterInventoryIndexMaps() {');
const indexEnd = html.indexOf('function rebuildMasterInventoryIndexes() {', indexStart);
assert.ok(indexStart >= 0 && indexEnd > indexStart, 'shared master index helpers should exist');
const indexSource = html.slice(indexStart, indexEnd);

function appFunction(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  const next = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  assert.ok(start >= 0 && next > 0, name);
  return html.slice(start, start + next + 1);
}

test('preparation yield controller honors elapsed-work and row ceilings', async () => {
  let clock = 0;
  let yields = 0;
  let fences = 0;
  const context = vm.createContext({ MASTER_PREPARATION_MAX_ROWS_PER_YIELD: 512,
    MASTER_PREPARATION_TIME_BUDGET_MS: 8,
    performance: { now: () => { clock += 1; return clock; } },
    yieldToUiFrame: async () => { yields += 1; },
  });
  vm.runInContext(appFunction('createMasterPreparationYieldController'), context);
  const yieldIfNeeded = context.createMasterPreparationYieldController(() => { fences += 1; });
  for (let index = 0; index < 25; index++) await yieldIfNeeded();
  assert.equal(yields, 3, 'a slow row loop yields on elapsed work before reaching the row ceiling');
  assert.equal(fences, yields, 'identity, permission, season, and cancellation checks follow each yield');
});

test('bounded season assignment matches synchronous groups including ties, exclusions, and duplicate IDs', async () => {
  let yields = 0;
  let clock = 0;
  const ctx = vm.createContext({ Map, Set, Array, String, Number,
    MASTER_PREPARATION_MAX_ROWS_PER_YIELD: 512, MASTER_PREPARATION_TIME_BUDGET_MS: 8,
    performance: { now: () => { clock += 0.1; return clock; } }, yieldToUiFrame: async () => { yields++; },
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    isWorkflowProtectedAppTabAssignment: value => value === 'protected',
    hasUsableEndCapFolderValue: value => !!value,
    isMasterSeasonWinnerBaseCandidate: row => !!row && row.eligible !== false,
    compareSeasonWinnerCandidates: (a, b) => b.quantity - a.quantity || String(a.UNIQUE_ID).localeCompare(b.UNIQUE_ID),
    applySeasonLocationAssignmentFields: (row, value) => { row.APP_TAB_ASSIGNMENT = value; },
  });
  vm.runInContext(appFunction('createMasterPreparationYieldController') + appFunction('pickSeasonWinnerCandidate') + appFunction('assignSeasonWinnersForItemGroups')
    + appFunction('prepareMasterSeasonAssignments'), ctx);
  const input = Array.from({ length: 200 }, (_, id) => ({ UNIQUE_ID: `uid-${id % 180}`, ITEMCODE: `item-${id % 3}`,
    quantity: id % 4, eligible: id % 5 !== 0, APP_TAB_ASSIGNMENT: id % 9 ? 'location' : 'protected',
    END_CAP_FOLDER: id % 11 ? '' : 'endcap' }));
  input.push(null, { UNIQUE_ID: 'unknown', ITEMCODE: 'UNKNOWN' });
  const synchronous = structuredClone(input), bounded = structuredClone(input);
  ctx.assignSeasonWinnersForItemGroups(synchronous);
  let checks = 0;
  await ctx.prepareMasterSeasonAssignments(bounded, () => { checks++; });
  assert.deepEqual(bounded, synchronous);
  assert.ok(yields > 2);
  assert.equal(checks, yields);
});

test('inheritance scans skip absent NCR targets and irrelevant moved-season sources', () => {
  const source = { id: 'source', key: 'same', reusable: true, sourceSeason: true, score: 2 };
  const target = { id: 'target', key: 'same', target: true };
  const ctx = vm.createContext({ Map, Set, Array, Date, Number, Math,
    fullInventory: Array.from({ length: 12000 }, (_, id) => ({ id })),
    isNcrCurrentCropInheritanceTarget: row => !!row.target,
    getNcrCurrentCropLocationKey: () => { throw new Error('No target requires source indexing'); },
    isMovedSeasonAvSourceSeason: row => !!row.sourceSeason,
    getMovedSeasonAvInheritanceKey: () => { throw new Error('Non-source seasons require no expensive key lookup'); },
  });
  vm.runInContext(appFunction('hydrateNcrCurrentCropRowsFromSources') + appFunction('hydrateMovedSeasonCurrentRowsFromSources'), ctx);
  assert.equal(ctx.hydrateNcrCurrentCropRowsFromSources(), 0);
  assert.equal(ctx.hydrateMovedSeasonCurrentRowsFromSources(), 0);
  let applied = 0;
  Object.assign(ctx, { fullInventory: [source, target],
    getNcrCurrentCropLocationKey: row => row.key,
    hasNcrReusableCropData: row => !!row.reusable,
    isNcrFutureOrMoveUpSourceForCurrent: row => !!row.sourceSeason,
    scoreNcrCurrentCropSource: row => row.score,
    applyNcrCurrentCropInheritance: (row, selected, options) => {
      assert.equal(row, target); assert.equal(selected, source); assert.equal(options.remote, false); applied++; return true;
    }, queueNcrCurrentCropInheritanceUiRefresh() {} });
  assert.equal(ctx.hydrateNcrCurrentCropRowsFromSources(), 1);
  assert.equal(applied, 1);
  ctx.isNcrCurrentCropInheritanceTarget = () => { throw new Error('An empty prepared candidate set needs no full scan'); };
  ctx.isMovedSeasonAvSourceSeason = () => { throw new Error('An empty prepared candidate set needs no full scan'); };
  assert.equal(ctx.hydrateNcrCurrentCropRowsFromSources({ candidates: [] }), 0);
  assert.equal(ctx.hydrateMovedSeasonCurrentRowsFromSources({ candidates: [] }), 0);
});

test('repeated aggregate receipts reuse validated identity while stale and invalidated revisions remain rejected', () => {
  const accepted = { scope: 'identity-a', permission: 'permission-a', revision: '12', valid: true };
  let invalidations = 0;
  const context = vm.createContext({ acceptedLocOnHandAggregateReceipt: accepted, String, BigInt,
    clearAcceptedLocOnHandAggregates: () => { invalidations++; context.acceptedLocOnHandAggregateReceipt.valid = false; } });
  vm.runInContext(appFunction('acceptCardLocationOnHandSourceReceipt'), context);
  for (let index = 0; index < 12000; index++) {
    assert.equal(context.acceptCardLocationOnHandSourceReceipt('identity-a', 'permission-a', '12'), true);
  }
  assert.equal(context.acceptedLocOnHandAggregateReceipt, accepted, 'batch stamping does not allocate and revalidate the same receipt per row');
  assert.equal(context.acceptCardLocationOnHandSourceReceipt('identity-a', 'permission-a', '11'), false);
  accepted.valid = false;
  assert.equal(context.acceptCardLocationOnHandSourceReceipt('identity-a', 'permission-a', '12'), false);
  assert.equal(context.acceptCardLocationOnHandSourceReceipt('identity-a', 'permission-a', '12', true), true);
  assert.equal(context.acceptCardLocationOnHandSourceReceipt('identity-a', 'permission-b', '12'), true);
  assert.equal(invalidations, 1);
});

function createHarness({ onYield = () => {}, clockStep = 0 } = {}) {
  let identity = 'identity-a';
  let permission = 'permission-a';
  let season = { seasonCode: 'F1', salesYear: '2027' };
  let clock = 0;
  const context = vm.createContext({
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: permission } },
    getSupabaseReadIdentityScope: () => identity,
    getInventoryCardItemLocationKey: row => {
      const item = String(row?.ITEMCODE || row?.itemcode || row?.ITEM || '').trim().toUpperCase();
      const location = String(row?.LOCATIONCODE || row?.locationcode || row?.LOCATION || '').trim().toUpperCase();
      return item && location ? JSON.stringify([item, location]) : '';
    },
    getCurrentAppSeasonSettings: () => season,
    formatFetchedRows: (rows) => rows.map((row) => ({ ...row, ITEMCODE: row?.ITEMCODE || row?.UNIQUE_ID, SOURCE_TABLE: 'ph_master_inventory', normalized: true })),
    buildSearchIndex: (row) => { row._searchCandidates = [row.UNIQUE_ID]; return row; },
    applyMasterAppTabAssignments: (rows) => rows.forEach((row) => { row.APP_TAB_ASSIGNMENT = 'season'; }),
    hasNcrLocationNote: row => !!row.NCR,
    isMovedSeasonAvSourceSeason: row => !!row.MOVED,
    isWorkflowProtectedAppTabAssignment: value => value === 'protected',
    hasUsableEndCapFolderValue: value => !!value,
    pickSeasonWinnerCandidate: rows => rows[0],
    applySeasonLocationAssignmentFields: (row, assignment) => { row.APP_TAB_ASSIGNMENT = assignment; },
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
    performance: { now: () => { clock += clockStep; return clock; } },
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
  const harness = createHarness({ onYield: () => { yields += 1; }, clockStep: 0.001 });
  const input = Array.from({ length: 130 }, (_, index) => ({ UNIQUE_ID: `uid-${index}`, VALUE: index,
    nested: { source: 'unchanged' }, photo: { link: `photo-${index}` } }));
  const result = await harness.api.prepare(input);

  assert.equal(yields, 0, 'fast bounded preparation does not pay a frame wait for every 64-row chunk');
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

test('master preparation yields at the elapsed-work budget or bounded row ceiling', async () => {
  let yields = 0;
  const harness = createHarness({ onYield: () => { yields += 1; }, clockStep: 0.001 });
  const input = Array.from({ length: 1200 }, (_, index) => ({ UNIQUE_ID: `uid-${index}`, VALUE: index }));
  const result = await harness.api.prepare(input);
  assert.equal(result.rowCount, input.length);
  assert.ok(yields <= 8, `formatting, both assignment passes, and AV projection stay within the 512-row ceiling; observed ${yields}`);
  assert.ok(yields >= 3, 'formatting, assignment, and AV projection each yield at least once for large input');
  assert.equal(result.payload.data[1199].APP_TAB_ASSIGNMENT, 'season');
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

test('preparation collects broad inheritance candidates without changing rows or relaxing commit eligibility', async () => {
  const harness = createHarness();
  const result = await harness.api.prepare([{ UNIQUE_ID: 'ncr', NCR: true }, { UNIQUE_ID: 'moved', MOVED: true }, { UNIQUE_ID: 'normal' }]);
  const prepared = harness.api.current(result.payload.data);
  assert.deepEqual(Array.from(prepared.inheritanceCandidates.ncr), [result.payload.data[0]]);
  assert.deepEqual(Array.from(prepared.inheritanceCandidates.moved), [result.payload.data[1]]);
  assert.match(html, /const inheritanceCandidates = preparedIndexes \? prepared\.inheritanceCandidates : null/,
    'replaced evidence or previously consumed indexes must use a fresh full scan');
  assert.match(appFunction('hydrateNcrCurrentCropRowsFromSources'), /candidates\.filter\(\(target\) => isNcrCurrentCropInheritanceTarget\(target, now\)\)/);
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
  harness = createHarness({ onYield: () => harness.setIdentity('identity-b'), clockStep: 0.1 });
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
    harness = createHarness({ clockStep: 0.1, onYield: () => {
      if (reason === 'abort') controller.abort();
      else if (reason === 'permission') harness.setPermission('permission-b');
      else harness.setSeason({ seasonCode: 'S1', salesYear: '2028' });
    } });
    await assert.rejects(harness.api.prepare(rows, { signal: controller.signal }),
      error => error.code === (reason === 'abort' ? 'REQUEST_ABORTED' : 'DATASET_READ_SCOPE_CHANGED'));
    assert.equal(rows.some(row => Object.hasOwn(row, 'DOM_ID')), false, 'cancelled preparation never mutates source rows');
  }
});

function createCachePersistenceHarness({ rows = 130, yieldToUiFrame = async () => {}, saveToCache = async () => true } = {}) {
  const sourceRows = Array.from({ length: rows }, (_, index) => ({ id: `row-${index}`, privateValue: `secret-${index}` }));
  const state = { epoch: 4, scope: 'identity-a', buildCalls: 0, saveCalls: [] };
  const context = vm.createContext({
    pendingCachePersist: true, lastCachePersistAt: 0, cacheSnapshotPreparationGeneration: 0,
    resolvedViewStateEpoch: state.epoch,
    getSupabaseReadIdentityScope: () => state.scope,
    buildCacheSnapshot: options => {
      assert.equal(options.deferRows, true, 'the full snapshot is gathered without synchronous row cloning');
      state.buildCalls += 1;
      return { status: 'success', data: sourceRows, requestsData: [{ id: 'request-row' }], meta: { generation: state.buildCalls } };
    },
    buildCacheRows: batch => batch.map(({ id }) => ({ id })),
    yieldToUiFrame,
    saveToCache: async snapshot => { state.saveCalls.push(snapshot); return saveToCache(snapshot); },
    Date, Object, Array, Promise, Number, String, Error,
  });
  vm.runInContext(appFunction('prepareCurrentCacheSnapshot') + appFunction('runPersistCurrentCacheNow'), context);
  return { context, state };
}

test('current cache snapshot preparation clones and redacts rows in bounded 64-row batches', async () => {
  const batchSizes = [], options = [];
  const harness = createCachePersistenceHarness({ rows: 130, yieldToUiFrame: async () => {} });
  harness.context.buildCacheRows = batch => {
    batchSizes.push(batch.length);
    return batch.map(({ id }) => ({ id }));
  };
  harness.context.buildCacheSnapshot = received => {
    options.push(received);
    return { status: 'success', data: Array.from({ length: 130 }, (_, id) => ({ id: `data-${id}`, secret: true })),
      requestsData: [{ id: 'request', secret: true }], meta: { generation: 1 } };
  };
  const snapshot = await harness.context.prepareCurrentCacheSnapshot(() => true);

  assert.deepEqual(JSON.parse(JSON.stringify(options)), [{ deferRows: true }]);
  assert.deepEqual(batchSizes, [64, 64, 2, 1]);
  assert.equal(snapshot.data.length, 130);
  assert.equal(snapshot.data.every(row => !Object.hasOwn(row, 'secret')), true, 'row sanitization remains delegated to buildCacheRows');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.requestsData)), [{ id: 'request' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.meta)), { generation: 1 });
});

test('current cache persistence cancels after a yield when identity or data epoch changes', async () => {
  for (const changed of ['identity', 'epoch']) {
    let signalYield;
    let releaseYield;
    const yieldStarted = new Promise(resolve => { signalYield = resolve; });
    const yieldGate = new Promise(resolve => { releaseYield = resolve; });
    let firstYield = true;
    const harness = createCachePersistenceHarness({ yieldToUiFrame: () => {
      if (!firstYield) return Promise.resolve();
      firstYield = false;
      signalYield();
      return yieldGate;
    } });
    const persistence = harness.context.runPersistCurrentCacheNow();
    await yieldStarted;
    if (changed === 'identity') harness.state.scope = 'identity-b';
    else harness.context.resolvedViewStateEpoch += 1;
    releaseYield();

    assert.equal(await persistence, false, `snapshot work stops after ${changed} changes`);
    assert.equal(harness.state.saveCalls.length, 0, 'a stale snapshot is never written');
  }
});

test('overlapping cache snapshot preparation writes only the newest generation', async () => {
  let signalFirstYield;
  let releaseFirstYield;
  const firstYieldStarted = new Promise(resolve => { signalFirstYield = resolve; });
  const firstYieldGate = new Promise(resolve => { releaseFirstYield = resolve; });
  let firstYield = true;
  const harness = createCachePersistenceHarness({ yieldToUiFrame: () => {
    if (!firstYield) return Promise.resolve();
    firstYield = false;
    signalFirstYield();
    return firstYieldGate;
  } });

  const older = harness.context.runPersistCurrentCacheNow();
  await firstYieldStarted;
  const newer = harness.context.runPersistCurrentCacheNow();
  assert.equal(await newer, true);
  releaseFirstYield();
  assert.equal(await older, false);
  assert.equal(harness.state.saveCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.state.saveCalls[0].meta)), { generation: 2 });
});

test('cache persistence reports a failed cache write as false', async () => {
  const harness = createCachePersistenceHarness({ rows: 1, saveToCache: async () => false });
  assert.equal(await harness.context.runPersistCurrentCacheNow(), false);
  assert.equal(harness.state.saveCalls.length, 1);
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
