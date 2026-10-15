// @test-group: foundation
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

const source = readFileSync(new URL('../assets/av-derived-rows.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function extractAppFunction(name) {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, name);
  const end = appSource.indexOf('\n        function ', match.index + match[0].length);
  assert.ok(end > match.index, `${name} boundary`);
  return appSource.slice(match.index, end);
}

function createHarness() {
  const queued = [];
  const context = { window: { setTimeout: callback => { queued.push(callback); return queued.length; }, clearTimeout() {} }, Map, Array, Number, String, Promise };
  vm.runInNewContext(source, context);
  return { api: context.window.AgMetricAvDerivedRows, flushOne: () => queued.shift()?.(), queued };
}

test('list search tokenizes its query once while preserving prefix and word-start results', () => {
  let tokenizations = 0;
  const context = { Array, Map, WeakMap, String, searchFilterCache: new WeakMap(), searchFilterCacheEpoch: 1,
    normalizeSearchValue: value => String(value).trim().toLowerCase(),
    tokenizeSearchValue: value => { tokenizations++; return String(value).toLowerCase().split(/\s+/).filter(Boolean); },
    getSearchValuesForProfile: row => row.values,
    normalizedSearchTextHasWordStart: (value, term) => value.split(/\s+/).some(word => word.startsWith(term)),
    beginInternalPerfMeasure: () => 0, recordInternalPerfDuration() {}, incrementInternalPerfCounter() {}, trimInternalCacheMap() {} };
  vm.createContext(context);
  vm.runInContext(['doesSearchProfilePrefixMatch', 'matchesItemSearch', 'filterBySearch'].map(extractAppFunction).join('\n'), context);
  const rows = Array.from({ length: 12000 }, (_, id) => ({ id, values: [id % 2 ? 'red rose' : 'white daisy', `avh.${id}`] }));
  for (const term of ['red', 'rose', 'red rose', 'avh.49', 'absent']) {
    const prefix = rows.filter(row => context.matchesItemSearch(row, term, 'av_open', { prefixOnly: true }));
    const expected = prefix.length ? prefix : rows.filter(row => context.matchesItemSearch(row, term, 'av_open'));
    tokenizations = 0;
    assert.deepEqual(Array.from(context.filterBySearch(rows, term, 'av_open')), expected);
    assert.equal(tokenizations, 1);
  }
});

test('render consumers can defer the first derivation slice and cancel before any row work', async () => {
  const h = createHarness();
  let mapped = 0;
  const options = { key: 'view', scope: 'actor', sourceKey: 'r1', rows: [1, 2], deferFirstSlice: true,
    mapRow: row => { mapped += 1; return row; } };
  const cancelled = h.api.prepare(options);
  assert.equal(mapped, 0);
  h.api.clearScope('actor');
  h.flushOne();
  assert.equal(await cancelled, null);
  assert.equal(mapped, 0);
  const pending = h.api.prepare(options);
  assert.equal(mapped, 0);
  h.flushOne();
  assert.deepEqual(Array.from(await pending), [1, 2]);
  assert.equal(mapped, 2);
});

test('AV first cards use scheduled bounded frames and obsolete renders never replace the visible list', () => {
  const frames = [], generated = [];
  const container = { style: {}, classList: { add() {} }, html: 'previous', insertAdjacentHTML(_where, value) { this.html += value; } };
  const context = { avRenderChunkToken: 0, window: {}, Date, Math, Array, String,
    performance: { now: () => 0 }, beginInternalPerfMeasure: () => 0,
    clearChunkRenderTimersByKey() {}, buildRowsRenderSignature: () => 'changed',
    isAdaptivePerformanceMode: () => false, getAdaptivePerformanceLevel: () => 0,
    isIOSDevice: () => false, isStandaloneApp: () => false,
    CHUNK_RENDER_INTERACTION_HOLD_MAX_MS: 1000, getContainerRenderSignature: () => '',
    getChunkRenderPacing: count => ({ batchTarget: count, timeBudget: 5, frameDelayMs: 0 }),
    generateCard: row => { generated.push(row); return `[${row}]`; },
    setContainerHtml: (target, value) => { target.html = value; },
    appendHtmlFragment: (target, value) => { target.html += value; },
    shouldHoldFollowupChunkFramesForInteraction: () => false,
    isUserInLiveTouchScrollGesture: () => false,
    scheduleChunkRenderTimeout: (_key, callback) => frames.push(callback),
    requestAnimationFrame: callback => frames.push(callback),
    setContainerRenderSignature: (target, value) => { target.signature = value; },
    recordInternalPerfDuration() {} };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('renderAVOpenCardsChunked'), context);
  const rows = Array.from({ length: 50 }, (_, id) => id);
  context.renderAVOpenCardsChunked(container, {}, rows, 'open', 'Rows', 'footer');
  assert.equal(container.html, 'previous');
  assert.equal(generated.length, 0, 'no rich cards are built in the synchronous render');
  context.avRenderChunkToken += 1;
  frames.shift()();
  assert.equal(container.html, 'previous');
  context.renderAVOpenCardsChunked(container, {}, rows, 'open', 'Rows', 'footer');
  frames.shift()();
  assert.equal(generated.length, 4);
  while (frames.length) frames.shift()();
  assert.equal(generated.length, 50);
  assert.equal(container.html, rows.map(id => `[${id}]`).join('') + 'footer');
  assert.equal(container.signature, 'changed:page:50');
});

test('AV derived rows publish atomically after bounded slices and reuse exact source revisions', async () => {
  const h = createHarness(), rows = Array.from({ length: 9_539 }, (_, id) => ({ id }));
  const batchSizes = [];
  const pending = h.api.prepare({ key: 'actor:policy:current', sourceKey: 'master:r7', scope: 'actor:policy', rows,
    chunkSize: 128, mapRow: row => row.id % 2 ? row.id : null,
    onSlice: (start, end) => batchSizes.push(end - start) });
  assert.equal(h.api.peek('actor:policy:current', 'actor:policy'), null, 'partial candidates are never visible');
  while (h.queued.length) h.flushOne();
  const result = await pending;
  assert.equal(result.length, 4_769);
  assert.equal(Math.max(...batchSizes), 128);
  assert.equal(h.api.peek('actor:policy:current', 'actor:policy').rows, result);
  let mapped = 0;
  const reused = await h.api.prepare({ key: 'actor:policy:current', sourceKey: 'master:r7', scope: 'actor:policy', rows,
    mapRow: row => { mapped += 1; return row.id; } });
  assert.equal(reused, result);
  assert.equal(mapped, 0);
});

test('AV derivation retains same-scope rows until replacement and rejects stale generation commits', async () => {
  const h = createHarness(), rows = [{ id: 'old' }];
  await h.api.prepare({ key: 'actor:policy:current', sourceKey: 'r1', scope: 'actor:policy', rows, mapRow: row => row.id });
  const replacement = h.api.prepare({ key: 'actor:policy:current', sourceKey: 'r2', scope: 'actor:policy', rows: Array.from({ length: 30 }, (_, id) => ({ id: `new-${id}` })), chunkSize: 16, mapRow: row => row.id });
  assert.deepEqual(Array.from(h.api.peek('actor:policy:current', 'actor:policy').rows), ['old']);
  while (h.queued.length) h.flushOne();
  while (h.queued.length) h.flushOne();
  assert.equal((await replacement).length, 30);

  let current = true;
  const stale = h.api.prepare({ key: 'actor:policy:current', sourceKey: 'r3', scope: 'actor:policy', rows: Array.from({ length: 30 }, (_, id) => ({ id })),
    chunkSize: 16, mapRow: row => row.id, isCurrent: () => current });
  current = false;
  while (h.queued.length) h.flushOne();
  assert.equal(await stale, null);
  assert.deepEqual(Array.from(h.api.peek('actor:policy:current', 'actor:policy').rows), Array.from({ length: 30 }, (_, id) => `new-${id}`));
});

test('a new AV filter context cancels obsolete same-scope work without publishing it', async () => {
  const h = createHarness();
  const cachedRows = await h.api.prepare({ key: 'actor:policy:current', sourceKey: 'master:r0', scope: 'actor:policy',
    rows: [{ id: 'complete' }], mapRow: row => row.id });
  const obsolete = h.api.prepare({ key: 'actor:policy:current', sourceKey: 'master:r1', scope: 'actor:policy',
    rows: Array.from({ length: 40 }, (_, id) => id), chunkSize: 16, mapRow: row => `old-${row}` });
  const current = h.api.prepare({ key: 'actor:policy:next-up', sourceKey: 'master:r1', scope: 'actor:policy',
    rows: Array.from({ length: 40 }, (_, id) => id), chunkSize: 16, mapRow: row => `next-${row}` });
  assert.equal(await obsolete, null);
  while (h.queued.length) h.flushOne();
  assert.equal((await current).length, 40);
  assert.equal(h.api.peek('actor:policy:current', 'actor:policy').rows, cachedRows, 'obsolete refresh keeps its last completed same-context rows');
  assert.equal(h.api.peek('actor:policy:next-up', 'actor:policy').rows[0], 'next-0');
  assert.deepEqual(Array.from(cachedRows), ['complete']);

  const background = h.api.prepare({ key: 'actor:policy:hot-price', sourceKey: 'master:r1', scope: 'actor:policy',
    rows: Array.from({ length: 40 }, (_, id) => id), chunkSize: 16, mapRow: row => row });
  h.api.cancelOtherJobs('actor:policy', 'actor:policy:next-up');
  assert.equal(await background, null);
  assert.equal(h.api.peek('actor:policy:next-up', 'actor:policy').rows[0], 'next-0');
});

test('AV cache keys isolate accounts and permission revisions and clear scoped jobs safely', async () => {
  const h = createHarness();
  await h.api.prepare({ key: 'actor-a:policy-1:current', sourceKey: 'r1', scope: 'actor-a:policy-1', rows: [{ id: 'private-a' }], mapRow: row => row.id });
  assert.equal(h.api.peek('actor-b:policy-1:current'), null);
  assert.equal(h.api.peek('actor-a:policy-2:current'), null);
  const pending = h.api.prepare({ key: 'actor-a:policy-1:next-up', sourceKey: 'r2', scope: 'actor-a:policy-1', rows: Array.from({ length: 30 }, (_, id) => ({ id })), chunkSize: 16, mapRow: row => row.id });
  h.api.clearScope('actor-a:policy-1');
  while (h.queued.length) h.flushOne();
  assert.equal(await pending, null);
  assert.equal(h.api.peek('actor-a:policy-1:current'), null);
});

test('production AV shell loads its bounded row service before render consumers', () => {
  const serviceIndex = appSource.indexOf('src="./assets/av-derived-rows.js');
  const consumerIndex = appSource.indexOf('id="app-script-source"');
  assert.ok(serviceIndex >= 0, 'AV row preparation service is loaded by the shell');
  assert.ok(consumerIndex > serviceIndex, 'AV row service loads before app render functions execute');
  assert.match(extractAppFunction('renderAV'), /usePreparedSalesRows:\s*activeAVTab\s*===\s*'open'/);
  assert.match(extractAppFunction('buildResolvedAVBaseState'), /getAvSalesRowsForRendering\(activeAvSalesBucket, preparedIdentity\)/);
  assert.match(extractAppFunction('getAvSalesRowsForRendering'), /sourceRows\.slice\(0,\s*AV_DERIVED_PREVIEW_SOURCE_LIMIT\)/);
  assert.match(extractAppFunction('renderAV'), /avState\.isPartial[\s\S]*Preparing AV inventory/);
  assert.match(extractAppFunction('renderAV'), /avState\.isPartial \? 0 : exportCount/);
});

test('production AV derivation identity separates data revisions, buckets, and permission scopes', () => {
  const context = {
    WeakMap, resolvedViewStateEpoch: 4,
    avDerivedRowsArrayIds: new WeakMap(), avDerivedRowsNextArrayId: 0,
    fullInventory: [], avOpenInventory: [], reservesInventory: [], avHotPriceKeysInventory: [],
    currentUser: 'rep-a', currentRole: 'Rep', safeRole: 'Rep',
    selectedAvResRep: '', selectedAvSalesRepName: 'Rep A', selectedAvRepCustomerKey: '',
    normalizeAvSalesBucket: value => String(value),
    shouldUseRepAvOpenDataset: () => true,
    getRepU3VisibilityScopeKey: () => 'division:10',
    getConfiguredCurrentSeasonCode: () => 'S1', getConfiguredCurrentSalesYearCode: () => '26',
    getDatasetLoadSignature: key => `${key}:r1`,
    getSupabaseReadIdentityScope: () => `rep-a:${contextPermissionVersion}`,
  };
  let contextPermissionVersion = 'permission-1';
  vm.createContext(context);
  vm.runInContext(extractAppFunction('getAvDerivedRowsArrayId') + extractAppFunction('getAvSalesDerivationIdentity'), context);

  const original = context.getAvSalesDerivationIdentity('current');
  context.activeAvSalesBucket = 'next-up';
  const otherBucket = context.getAvSalesDerivationIdentity('next-up');
  assert.equal(otherBucket.scope, original.scope);
  assert.notEqual(otherBucket.key, original.key, 'another bucket cannot reuse current-bucket results');
  contextPermissionVersion = 'permission-2';
  const otherPermission = context.getAvSalesDerivationIdentity('current');
  assert.notEqual(otherPermission.scope, original.scope, 'permission changes isolate the cache scope');
  context.resolvedViewStateEpoch += 1;
  const newerData = context.getAvSalesDerivationIdentity('current');
  assert.notEqual(newerData.sourceKey, original.sourceKey, 'a new app data epoch requires re-derivation');
});

test('failed AV derivation clears only its current partial view cache so a later render retries', async () => {
  const identity = { key: 'actor:policy:current', scope: 'actor:policy', sourceKey: 'master:r1', signature: 'actor:policy::current::master:r1' };
  let prepareCalls = 0;
  let scheduledRenders = 0;
  const context = {
    window: { AgMetricAvDerivedRows: {
      peek: () => null,
      prepare: () => {
        prepareCalls += 1;
        return prepareCalls === 1 ? Promise.reject(new Error('temporary preparation failure')) : Promise.resolve([{ id: 'complete' }]);
      }
    } },
    normalizeAvSalesBucket: value => String(value),
    getAvSalesDerivationIdentity: () => identity,
    AV_DERIVED_ROWS_CHUNK_SIZE: 96,
    AV_DERIVED_PREVIEW_SOURCE_LIMIT: 50,
    createAvSalesRowsDerivation: () => ({
      sourceRows: [{ id: 'preview' }], mapRow: row => row, finalize: rows => rows
    }),
    avDerivedRowsActiveScope: '', avDerivedRowsPendingSignature: '',
    avResolvedBaseStateKey: 'partial-state', avResolvedBaseStateCache: { isPartial: true },
    activeAVTab: 'open', isViewVisible: () => true, scheduleAVRender() { scheduledRenders += 1; },
    console: { warn() {} },
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('getAvSalesRowsForRendering'), context);

  const first = context.getAvSalesRowsForRendering('current', identity);
  assert.equal(first.partial, true);
  assert.equal(first.rows[0].id, 'preview');
  // A user-triggered render runs in a later task, after then/catch/finally
  // settle. Counting individual microtasks can resume before finally.
  await nextEventLoopTurn();
  assert.equal(context.avResolvedBaseStateKey, '', 'the failed current derivation invalidates the cached partial base state');
  assert.equal(context.avResolvedBaseStateCache, null);
  assert.equal(context.avDerivedRowsPendingSignature, '', 'settlement releases the in-flight retry guard');
  assert.equal(prepareCalls, 1, 'failure does not start an automatic retry loop');
  assert.equal(scheduledRenders, 0, 'the current preview remains displayed until a later render');

  context.getAvSalesRowsForRendering('current', identity);
  assert.equal(prepareCalls, 2, 'a later render retries the same source revision');
  await nextEventLoopTurn();
  assert.equal(scheduledRenders, 1, 'successful preparation schedules the completed rows');
  assert.equal(context.avDerivedRowsPendingSignature, '');
});

test('chunked AV derivation preserves bucket filtering, approval, deduplication, and sort parity', async () => {
  const rows = [
    { UNIQUE_ID: 'b', COMMONNAME: 'Plant 10', CONTSIZE: '#2', LOCATIONCODE: 'A.2', SEASON: 'S1', inWindow: true, bucketMatch: true, S_LTS: '4' },
    { UNIQUE_ID: 'a', COMMONNAME: 'Plant 2', CONTSIZE: '#1', LOCATIONCODE: 'A.1', SEASON: 'S1', inWindow: true, bucketMatch: true, S_LTS: '2' },
    { UNIQUE_ID: 'duplicate', COMMONNAME: 'Plant 3', CONTSIZE: '#1', LOCATIONCODE: 'A.3', SEASON: 'S1', inWindow: true, bucketMatch: true, locationKey: 'same-location', S_LTS: '1' },
    { UNIQUE_ID: 'duplicate-loser', COMMONNAME: 'Plant 4', CONTSIZE: '#1', LOCATIONCODE: 'A.4', SEASON: 'S1', inWindow: true, bucketMatch: true, locationKey: 'same-location', S_LTS: '1' },
    { UNIQUE_ID: 'outside-window', COMMONNAME: 'Outside', SEASON: 'S1', inWindow: false, bucketMatch: true, S_LTS: '1' },
    { UNIQUE_ID: 'invalid-approval', COMMONNAME: 'Approval', SEASON: 'S1', inWindow: true, bucketMatch: true, approvalHidden: true, S_LTS: '1' },
    { UNIQUE_ID: 'wrong-bucket', COMMONNAME: 'Other', SEASON: 'S1', inWindow: true, bucketMatch: false, S_LTS: '1' },
    { UNIQUE_ID: 'shift', COMMONNAME: 'Shift', SEASON: 'S1', DESIGITEM: 'SHFT', inWindow: true, bucketMatch: true, S_LTS: '1' },
    { UNIQUE_ID: 'wrong-season', COMMONNAME: 'Wrong season', SEASON: 'U3', inWindow: true, bucketMatch: true, S_LTS: '1' },
  ];
  const queued = [];
  const context = {
    window: { setTimeout: callback => { queued.push(callback); return queued.length; }, clearTimeout() {} },
    Map, Array, Number, String, Promise, Intl,
    activeAvSalesBucket: 'current', activeAvOpenTab: 'name', fullInventory: rows,
    AV_FILTER_SEASON_OPTIONS: ['F1', 'S1', 'U1', 'U2'],
    normalizeAvSalesBucket: bucket => String(bucket),
    getAvSalesReserveDemandRows: () => [], buildAvReserveSeasonIndex: () => ({}),
    isAvCustomerSalesBucket: () => false,
    getAvSalesInventorySourceRows: () => rows,
    shouldHideU3InventoryRowForRep: () => false,
    itemMatchesAvOpenSalesWindow: row => row.inWindow !== false,
    getAvSalesSeasonValue: row => String(row.SEASON || ''),
    isShiftDesigItemRow: row => String(row.DESIGITEM || '').includes('SHFT'),
    shouldHideNotOnInventoryApprovalRowFromInventory: row => !!row.approvalHidden,
    getAvReserveRowsForSalesItem: () => [], shouldIncludeMasterItemInAvOpenStock: row => Number(row.S_LTS) > 0,
    itemMatchesAvSalesBucket: row => !!row.bucketMatch,
    getAvReserveLocationUniqueKey: row => row.locationKey || '',
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    getAvSalesItemCode: row => String(row.ITEMCODE || ''), decorateAvSalesReserveRow: row => row,
    buildAvHotPriceIndex: () => new Map(),
    getSearchValuesForProfile: (row, profile) => { row.preparedSearchProfile = profile; return []; },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext(extractAppFunction('sortAvOpenItems') + extractAppFunction('createAvSalesRowsDerivation'), context);
  const expected = ['a', 'duplicate', 'b'];
  const syncDerivation = context.createAvSalesRowsDerivation('current');
  const syncRows = syncDerivation.finalize(syncDerivation.sourceRows.map(syncDerivation.mapRow).filter(Boolean));
  assert.deepEqual(Array.from(syncRows, row => row.UNIQUE_ID), expected);
  assert.equal(syncRows.every(row => row.preparedSearchProfile === 'av_open'), true);

  const chunkedDerivation = context.createAvSalesRowsDerivation('current');
  const pending = context.window.AgMetricAvDerivedRows.prepare({
    key: 'actor:policy:current', scope: 'actor:policy', sourceKey: 'master:r1', rows: chunkedDerivation.sourceRows,
    chunkSize: 16, mapRow: chunkedDerivation.mapRow, finalize: chunkedDerivation.finalize,
  });
  while (queued.length) queued.shift()();
  const chunkedRows = await pending;
  assert.deepEqual(Array.from(chunkedRows, row => row.UNIQUE_ID), expected);
});

test('hot-price row batching preserves the matched source fields and season rules', async () => {
  const rows = [
    { UNIQUE_ID: 'hot-a', ITEMCODE: 'ITEM-A', COMMONNAME: 'A', SEASON: 'S1', inWindow: true },
    { UNIQUE_ID: 'hot-u3', ITEMCODE: 'ITEM-U3', COMMONNAME: 'U3', SEASON: 'U3', inWindow: true },
    { UNIQUE_ID: 'hot-outside', ITEMCODE: 'ITEM-OUT', COMMONNAME: 'Outside', SEASON: 'S1', inWindow: false },
  ];
  const context = {
    Map, Array, Number, String, Object,
    activeAvSalesBucket: 'hot-price', fullInventory: rows,
    AV_FILTER_SEASON_OPTIONS: ['F1', 'S1', 'U1', 'U2'],
    normalizeAvSalesBucket: value => String(value), getAvSalesReserveDemandRows: () => [],
    buildAvReserveSeasonIndex: () => ({}), isAvCustomerSalesBucket: () => false,
    avHotPriceKeysInventory: [
      { ITEMCODE: 'ITEM-A', CAV_HOT_PRICE: '12.50', CAV_ITEMCODE: 'PRICE-A', CAV_FILENAME: 'prices.csv', CAV_LAST_UPDATED: '2026-10-15' },
      { ITEMCODE: 'ITEM-U3', CAV_HOT_PRICE: '15.00', CAV_ITEMCODE: 'PRICE-U3' },
    ],
    getAvHotPriceMatchKey: item => String(item && item.ITEMCODE || ''),
    getNormalizedAvHotPrice: value => String(value || '').trim(),
    getNormalizedAvHotPriceSeason: item => String(item && item.SEASON || '').toUpperCase(),
    shouldHideU3InventoryRowForRep: () => false,
    itemMatchesAvOpenSalesWindow: row => row.inWindow !== false,
    getAvSalesSeasonValue: row => String(row.SEASON || ''),
    isShiftDesigItemRow: () => false, shouldHideNotOnInventoryApprovalRowFromInventory: () => false,
    getAvReserveRowsForSalesItem: () => [], shouldIncludeMasterItemInAvOpenStock: () => false,
    itemMatchesAvSalesBucket: () => true, getAvReserveLocationUniqueKey: row => row.UNIQUE_ID,
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    getAvSalesItemCode: row => String(row.ITEMCODE || ''), decorateAvSalesReserveRow: row => row,
    getSearchValuesForProfile: () => [],
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('buildAvHotPriceIndex')
    + extractAppFunction('buildAvHotPriceRow')
    + extractAppFunction('createAvSalesRowsDerivation'), context);
  const derivation = context.createAvSalesRowsDerivation('hot-price');
  const output = derivation.finalize(derivation.sourceRows.map(derivation.mapRow).filter(Boolean));
  assert.equal(output.length, 1);
  assert.equal(output[0].UNIQUE_ID, 'hot-a');
  assert.equal(output[0].HOT_PRICE, '12.50');
  assert.equal(output[0].CAV_ITEMCODE, 'PRICE-A');
  assert.equal(output[0].CAV_FILENAME, 'prices.csv');
  assert.equal(output[0].CAV_LAST_UPDATED, '2026-10-15');
});

test('AV prepares filter selections once and preserves all/custom/empty facet semantics', () => {
  let normalizations = 0;
  const context = { Set, Array, String,
    selectedAvSeasons: new Set(['S1']), selectedAvGenusNames: new Set([' Oak ']), selectedAvContSizes: new Set(['#2']),
    avGenusSelectionMode: 'all', avContSizeSelectionMode: 'all',
    normalizeAvSelectedSeasons: () => { normalizations++; },
    normalizeAvFacetCompareKey: value => String(value || '').trim().toLowerCase(),
    getAvFilterSeasonValue: row => row.season, itemMatchesAvHoldFilter: row => !row.hold,
    getAvFilterGenusFacetValue: row => row.genus, getAvFilterContSizeFacetValue: row => row.size };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('itemMatchesAvFacetSelection') + extractAppFunction('itemMatchesAvTopFilterSelections')
    + extractAppFunction('createAvTopFilterPredicate'), context);
  const rows = Array.from({ length: 1000 }, (_, index) => ({ season: index % 3 ? 'S1' : 'F1', hold: index % 7 === 0,
    genus: index % 2 ? 'oak' : 'Maple', size: index % 5 ? '#2' : '#3' }));
  for (const mode of ['all', 'custom']) {
    context.avGenusSelectionMode = context.avContSizeSelectionMode = mode;
    const expected = rows.filter(context.itemMatchesAvTopFilterSelections);
    normalizations = 0;
    assert.deepEqual(rows.filter(context.createAvTopFilterPredicate()), expected);
    assert.equal(normalizations, 1);
  }
  context.selectedAvGenusNames = new Set();
  assert.equal(rows.filter(context.createAvTopFilterPredicate()).length, 0);
});
