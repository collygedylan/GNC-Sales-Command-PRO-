import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

const source = readFileSync(new URL('../assets/av-derived-rows.js', import.meta.url), 'utf8');
const appSource = readComposedAppSource().replace(/\r\n/g, '\n');

function extractAppFunction(name) {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, name);
  const end = appSource.indexOf('\n        function ', match.index + match[0].length);
  assert.ok(end > match.index, `${name} boundary`);
  return appSource.slice(match.index, end);
}

function installDerivationDependencies(context, currentSeason = 'S1') {
  Object.assign(context, {
    avDerivationMutationEpoch: context.resolvedViewStateEpoch || 0,
    getAvPhotoMode: context.getAvPhotoMode || (() => 'photos'),
    getAvConfiguredCurrentSeasonCode: () => currentSeason,
    getAvConfiguredCurrentSalesYearCode: () => 27,
    getAvNextUpSeasonTarget: () => ({ season: currentSeason === 'F1' ? 'S1' : 'F1' }),
    normalizeNcrSeasonCode: value => String(value || '').toUpperCase(),
    getAvSalesYearNumber: row => row.inWindow === false ? 28 : 27,
    AV_OPEN_ALLOWED_SEASONS: ['F1', 'S1', 'U1', 'U2'],
  });
  vm.runInContext(extractAppFunction('createAvSalesWindowPredicates'), context);
}

function createHarness() {
  const queued = [];
  const context = { window: { setTimeout: callback => { queued.push(callback); return queued.length; }, clearTimeout() {} }, Map, Array, Number, String, Promise };
  vm.runInNewContext(source, context);
  return { api: context.window.AgMetricAvDerivedRows, flushOne: () => queued.shift()?.(), queued };
}

test('filter viewport cleanup does not retrigger its class observer for an already-cleared panel', () => {
  const tokens = new Set(['excel-filter-panel', 'excel-filter-panel--viewport-safe']);
  let mutations = 0;
  const panel = { classList: { contains: token => tokens.has(token), remove: token => { mutations++; tokens.delete(token); } },
    style: { removeProperty() {} } };
  const context = vm.createContext({});
  vm.runInContext(extractAppFunction('clearMobileExcelFilterViewportPanel'), context);
  context.clearMobileExcelFilterViewportPanel(panel);
  context.clearMobileExcelFilterViewportPanel(panel);
  assert.equal(mutations, 1, 'the observer settles after removing the class once');
  const sync = extractAppFunction('syncMobileExcelFilterViewportSafety');
  assert.match(sync, /!document\.body\.classList\.contains\('mobile-excel-filter-panel-open'\)/);
  assert.match(sync, /!panel\.classList\.contains\('excel-filter-panel--viewport-safe'\)/);
});

test('list search tokenizes its query once while preserving prefix and word-start results', () => {
  let tokenizations = 0;
  const context = { Array, Map, WeakMap, String, searchFilterCache: new WeakMap(), searchFilterCacheEpoch: 1,
    normalizeSearchValue: value => String(value).trim().toLowerCase(),
    tokenizeSearchValue: value => { tokenizations++; return String(value).toLowerCase().split(/\s+/).filter(Boolean); },
    getSearchValuesForProfile: row => row.values,
    getSearchWordStartsForProfile: () => null,
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

test('cached AV profile word starts preserve prefix, punctuation, and multi-term search results', () => {
  const context = { Array, Map, WeakMap, String, searchFilterCache: new WeakMap(), searchFilterCacheEpoch: 1,
    normalizeSearchValue: value => String(value).trim().toLowerCase(),
    tokenizeSearchValue: value => String(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    getSearchValuesForProfile: row => row.values,
    getSearchWordStartsForProfile: (row, profile) => row._searchProfileWordStarts?.[profile] || [],
    normalizedSearchTextHasWordStart: (value, term) => String(value).toLowerCase().split(/[^a-z0-9]+/).some(word => word.startsWith(term)),
    beginInternalPerfMeasure: () => 0, recordInternalPerfDuration() {}, incrementInternalPerfCounter() {}, trimInternalCacheMap() {} };
  vm.createContext(context);
  vm.runInContext(['doesSearchProfilePrefixMatch', 'matchesItemSearch', 'filterBySearch'].map(extractAppFunction).join('\n'), context);
  const sourceRows = [
    { values: ['Red Rose', 'AVH.00049'] },
    { values: ['White Daisy', 'AVH.00050'] },
    { values: ['Red-Rose Special', 'Blue/Green'] },
    { values: ['Étoile d\'Or', 'Mixed 27.F1'] },
    { values: ['Rosemary', 'AVH.00049B'] }
  ];
  const legacyRows = sourceRows.map(row => ({ ...row }));
  const cachedRows = sourceRows.map(row => ({ ...row,
    _searchProfileWordStarts: { av_open: [...new Set(row.values.flatMap(context.tokenizeSearchValue))] } }));
  const terms = ['red', 'red rose', 'rose special', 'avh.49', '00049', '27 f1', 'etoile or', 'absent'];
  for (const term of terms) {
    const expected = legacyRows.filter(row => context.matchesItemSearch(row, term, 'av_open'));
    const actual = Array.from(context.filterBySearch(cachedRows, term, 'av_open'));
    assert.deepEqual(actual.map(row => row.values.join('|')), expected.map(row => row.values.join('|')), `search parity for ${term}`);
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
  let continuation;
  const container = { style: {}, classList: { add() {} }, html: 'previous', insertAdjacentHTML(_where, value) { this.html += value; } };
  const context = { avRenderChunkToken: 0, window: {}, Date, Math, Array, String,
    CLIENT_BROWSE_PAGE_SIZE: 100, canUseProductionLiveSync: () => false, shouldUseRepAvOpenDataset: () => false,
    performance: { now: () => 0 }, beginInternalPerfMeasure: () => 0,
    clearChunkRenderTimersByKey() {}, buildRowsRenderSignature: () => 'changed',
    isAdaptivePerformanceMode: () => false, getAdaptivePerformanceLevel: () => 0,
    isIOSDevice: () => false, isStandaloneApp: () => false,
    CHUNK_RENDER_INTERACTION_HOLD_MAX_MS: 1000, getContainerRenderSignature: () => '',
    installAvCardWindowContinuation: (...args) => { continuation = args; },
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
  vm.runInContext(extractAppFunction('getAvCardWindowEnd') + extractAppFunction('renderAVOpenCardsChunked'), context);
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
  assert.deepEqual(generated, rows.slice(0, 20), 'the initial window must generate exactly its first twenty physical rows');
  assert.ok(container.html.startsWith(rows.slice(0, 20).map(id => `[${id}]`).join('')));
  assert.match(container.html, /data-av-load-more/);
  assert.ok(container.html.endsWith('footer'));
  assert.equal(continuation[1], rows, 'continuation retains every source row');
  assert.equal(continuation[3], 20, 'continuation resumes at the first unpainted row');
  assert.equal(container.signature, 'changed:page:50');
});

test('partial native REP AV keeps its first card visible and atomically publishes the prepared window', () => {
  const frames = [], commits = [], generated = [], refreshed = [];
  const container = { style: {}, classList: { add() {} }, html: 'loading' };
  const context = { avRenderChunkToken: 0, window: {}, Date, Math, Array, String,
    CLIENT_BROWSE_PAGE_SIZE: 100, canUseProductionLiveSync: () => true, shouldUseRepAvOpenDataset: () => true,
    performance: { now: () => 0 }, beginInternalPerfMeasure: () => 0,
    clearChunkRenderTimersByKey() {}, buildRowsRenderSignature: () => 'partial',
    isAdaptivePerformanceMode: () => false, getAdaptivePerformanceLevel: () => 0,
    isIOSDevice: () => false, isStandaloneApp: () => false,
    CHUNK_RENDER_INTERACTION_HOLD_MAX_MS: 1000, getContainerRenderSignature: () => '',
    getAvCardWindowEnd: (total, start) => Math.min(total, start + 20),
    getChunkRenderPacing: count => ({ batchTarget: count, timeBudget: 5, frameDelayMs: 0, interactionSlowMode: false }),
    generateCard: row => { generated.push(row); return `[${row.DOM_ID}]`; },
    setContainerHtml: (target, value) => { commits.push(value); target.html = value; },
    appendHtmlFragment: (target, value) => { target.html += value; },
    shouldHoldFollowupChunkFramesForInteraction: () => false,
    isUserInLiveTouchScrollGesture: () => false,
    scheduleChunkRenderTimeout: (_key, callback) => frames.push(callback),
    requestAnimationFrame: callback => frames.push(callback),
    setContainerRenderSignature: (target, value) => { target.signature = value; },
    captureProductionRefreshAnchor: () => null, refreshCartButtons: ids => refreshed.push(ids),
    restoreProductionRefreshAnchor() {}, installAvCardWindowContinuation() {}, recordInternalPerfDuration() {} };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('renderAVOpenCardsChunked'), context);

  const rows = Array.from({ length: 20 }, (_, id) => ({ DOM_ID: `id-${id}` }));
  const render = () => context.renderAVOpenCardsChunked(container, {}, rows, 'av', 'Rows', 'footer', { firstPreviewCardSync: true });

  render();
  assert.equal(container.html, '[id-0]', 'the synchronous preview remains visible while the rest is prepared');
  assert.equal(commits.length, 1, 'only the immediate one-card preview has reached the DOM');
  frames.shift()();
  assert.equal(container.html, '[id-0]', 'prepared chunks stay off-DOM');
  assert.equal(commits.length, 1);
  context.avRenderChunkToken += 1;
  frames.shift()();
  assert.equal(container.html, '[id-0]', 'a superseded render cannot replace the visible preview');

  render();
  assert.equal(container.html, '[id-0]');
  while (frames.length) frames.shift()();
  assert.equal(container.html, `${rows.map(row => `[${row.DOM_ID}]`).join('')}footer`);
  assert.equal(commits.length, 3, 'one preview write, one retry preview write, and one completed-window publication');
  assert.deepEqual(Array.from(refreshed.at(-1)), rows.map(row => row.DOM_ID));
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
    isDatasetLoaded: () => true,
    getProductionLiveSyncContext: () => ({}), getDatasetState: () => ({}),
    avDerivationMutationEpoch: 0,
  };
  let contextPermissionVersion = 'permission-1';
  vm.createContext(context);
  vm.runInContext(extractAppFunction('selectAvSalesInventorySourceRows') + extractAppFunction('getAvDerivationSourceVersion')
    + extractAppFunction('getAvDerivedRowsArrayId') + extractAppFunction('getAvSalesDerivationIdentity'), context);

  const original = context.getAvSalesDerivationIdentity('current');
  context.activeAvSalesBucket = 'next-up';
  const otherBucket = context.getAvSalesDerivationIdentity('next-up');
  assert.equal(otherBucket.scope, original.scope);
  assert.notEqual(otherBucket.key, original.key, 'another bucket cannot reuse current-bucket results');
  contextPermissionVersion = 'permission-2';
  const otherPermission = context.getAvSalesDerivationIdentity('current');
  assert.notEqual(otherPermission.scope, original.scope, 'permission changes isolate the cache scope');
  context.avDerivationMutationEpoch += 1;
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
    normalizeAvSalesBucket: value => String(value), shouldUseRepAvOpenDataset: () => false,
    getAvSalesDerivationIdentity: () => identity,
    AV_DERIVED_ROWS_CHUNK_SIZE: 96,
    AV_DERIVED_PREVIEW_SOURCE_LIMIT: 50,
    createAvSalesRowsDerivation: () => ({
      sourceRows: [{ id: 'preview' }], mapRow: row => row, finalize: rows => rows
    }),
    avDerivedRowsActiveScope: '', avDerivedRowsPendingSignature: '',
    avDerivedPreviewCache: null,
    avResolvedBaseStateKey: 'partial-state', avResolvedBaseStateCache: { isPartial: true },
    activeAVTab: 'open', activeAvSalesBucket: 'current', isViewVisible: () => true, scheduleAVRender() { scheduledRenders += 1; },
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

test('AV retries a cancelled source generation without reviving an old account or bucket', async () => {
  for (const change of ['revision', 'account', 'bucket']) {
    const original = { key: 'current', scope: 'actor-a', sourceKey: 'r1', signature: 'actor-a:current:r1' };
    let identity = original, finish, renders = 0;
    const context = vm.createContext({
      window: { AgMetricAvDerivedRows: { peek: () => null, prepare: () => new Promise(resolve => { finish = resolve; }) } },
      normalizeAvSalesBucket: value => String(value), getAvSalesDerivationIdentity: () => identity,
      AV_DERIVED_ROWS_CHUNK_SIZE: 96, AV_DERIVED_PREVIEW_SOURCE_LIMIT: 50,
      shouldUseRepAvOpenDataset: () => false,
      createAvSalesRowsDerivation: () => ({ sourceRows: [], mapRow: row => row, finalize: rows => rows }),
      avDerivedRowsActiveScope: '', avDerivedRowsPendingSignature: '',
      avDerivedPreviewCache: null,
      avResolvedBaseStateKey: 'preview', avResolvedBaseStateCache: { isPartial: true },
      activeAVTab: 'open', activeAvSalesBucket: 'current', isViewVisible: () => true,
      scheduleAVRender: () => { renders++; }, console: { warn() {} }
    });
    vm.runInContext(extractAppFunction('getAvSalesRowsForRendering'), context);
    context.getAvSalesRowsForRendering('current');
    identity = { ...original, sourceKey: 'r2', signature: 'actor-a:current:r2' };
    if (change === 'account') identity = { ...identity, scope: 'actor-b' };
    if (change === 'bucket') context.activeAvSalesBucket = 'next-up';
    finish(null);
    await nextEventLoopTurn();
    assert.equal(renders, change === 'revision' ? 1 : 0, change);
    assert.equal(context.avDerivedRowsPendingSignature, '');
    if (change === 'revision') assert.equal(context.avResolvedBaseStateCache, null);
  }
});

test('chunked AV derivation preserves bucket filtering, approval, deduplication, and sort parity', async () => {
  const rows = [
    { UNIQUE_ID: 'b', COMMONNAME: 'Plant 10', GENUSNAME: 'Quercus', CONTSIZE: '#2', LOCATIONCODE: 'A.2', SEASON: 'S1', inWindow: true, bucketMatch: true, S_LTS: '4' },
    { UNIQUE_ID: 'a', COMMONNAME: 'Plant 2', GENUSNAME: 'Acer', CONTSIZE: '#1', LOCATIONCODE: 'A.1', SEASON: 'S1', inWindow: true, bucketMatch: true, S_LTS: '2' },
    { UNIQUE_ID: 'duplicate', COMMONNAME: 'Plant 3', GENUSNAME: 'Rosa', CONTSIZE: '#1', LOCATIONCODE: 'A.3', SEASON: 'S1', inWindow: true, bucketMatch: true, locationKey: 'same-location', S_LTS: '1' },
    { UNIQUE_ID: 'duplicate-loser', COMMONNAME: 'Plant 4', GENUSNAME: 'Prunus', CONTSIZE: '#1', LOCATIONCODE: 'A.4', SEASON: 'S1', inWindow: true, bucketMatch: true, locationKey: 'same-location', S_LTS: '1' },
    { UNIQUE_ID: 'outside-window', COMMONNAME: 'Outside', SEASON: 'S1', inWindow: false, bucketMatch: true, S_LTS: '1' },
    { UNIQUE_ID: 'invalid-approval', COMMONNAME: 'Approval', SEASON: 'S1', inWindow: true, bucketMatch: true, approvalHidden: true, S_LTS: '1' },
    { UNIQUE_ID: 'wrong-bucket', COMMONNAME: 'Other', SEASON: 'U1', inWindow: true, bucketMatch: false, S_LTS: '1' },
    { UNIQUE_ID: 'shift', COMMONNAME: 'Shift', SEASON: 'S1', DESIGITEM: 'SHFT', inWindow: true, bucketMatch: true, S_LTS: '1' },
    { UNIQUE_ID: 'wrong-season', COMMONNAME: 'Wrong season', SEASON: 'U3', inWindow: true, bucketMatch: true, S_LTS: '1' },
  ];
  const queued = [];
  const context = {
    window: { setTimeout: callback => { queued.push(callback); return queued.length; }, clearTimeout() {} },
    Map, Array, Number, String, Promise, Intl,
    activeAvSalesBucket: 'current', activeAvOpenTab: 'name', fullInventory: rows,
    AV_FILTER_SEASON_OPTIONS: ['F1', 'S1', 'U1', 'U2'],
    normalizeAvSalesBucket: bucket => String(bucket), shouldUseRepAvOpenDataset: () => false,
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
    getSearchWordStartsForProfile: (row, profile) => {
      row.preparedSearchProfile = profile;
      row._searchProfileWordStarts = { ...(row._searchProfileWordStarts || {}), [profile]: [String(row.COMMONNAME || '').toLowerCase()] };
      return row._searchProfileWordStarts[profile];
    },
    avPreparedRawTabRows: new WeakMap(), resolvedViewStateEpoch: 7,
    getAvFilterGenusFacetValue: row => String(row.GENUSNAME || '(Blank)').trim() || '(Blank)',
    getAvFilterContSizeFacetValue: row => String(row.CONTSIZE || '-').trim() || '-',
    avItemHasPhotos: row => !!row.hasPhoto,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  installDerivationDependencies(context);
  vm.runInContext(extractAppFunction('sortAvOpenItems') + extractAppFunction('createAvSalesRowsDerivation'), context);
  const expected = ['a', 'duplicate', 'b'];
  const syncDerivation = context.createAvSalesRowsDerivation('current');
  const syncRows = syncDerivation.finalize(syncDerivation.sourceRows.map(syncDerivation.mapRow).filter(Boolean));
  assert.deepEqual(Array.from(syncRows, row => row.UNIQUE_ID), expected);
  assert.equal(syncRows.every(row => row.preparedSearchProfile === undefined), true, 'derivation leaves search profiles lazy until a search is entered');
  const prepared = context.avPreparedRawTabRows.get(syncRows);
  assert.ok(prepared, 'the completed derived array carries prepared tab metadata');
  assert.equal(prepared.epoch, context.resolvedViewStateEpoch);
  assert.deepEqual(Array.from(prepared.all.rows, row => row.UNIQUE_ID), expected);
  assert.deepEqual(Array.from(prepared.photos.rows, row => row.UNIQUE_ID), []);
  assert.deepEqual(Array.from(prepared.all.genusOptions).sort(), ['Acer', 'Quercus', 'Rosa']);
  assert.deepEqual(Array.from(prepared.all.sizeOptions).sort(), ['#1', '#2']);
  assert.equal(context.avPreparedRawTabRows.get(prepared.all.rows).epoch, context.resolvedViewStateEpoch);
  assert.deepEqual(Array.from(context.avPreparedRawTabRows.get(prepared.photos.rows).options.genusOptions), prepared.photos.genusOptions);

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
    normalizeAvSalesBucket: value => String(value), getAvSalesReserveDemandRows: () => [], shouldUseRepAvOpenDataset: () => false,
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
    getSearchWordStartsForProfile: row => row._search ? String(row._search).split(/\s+/).filter(Boolean) : [],
    avPreparedRawTabRows: new WeakMap(), resolvedViewStateEpoch: 2,
    getAvFilterGenusFacetValue: row => String(row.GENUSNAME || '(Blank)').trim() || '(Blank)',
    getAvFilterContSizeFacetValue: row => String(row.CONTSIZE || '-').trim() || '-',
    avItemHasPhotos: row => !!row.hasPhoto,
  };
  vm.createContext(context);
  installDerivationDependencies(context);
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

test('prepared AV raw-tab rows preserve photo and shift membership while rejecting stale metadata', () => {
  const rows = [
    { UNIQUE_ID: 'plain', ITEMCODE: 'A', COMMONNAME: 'Oak', CONTSIZE: '#1', GENUSNAME: 'Quercus', SEASON: 'F1', inWindow: true, bucketMatch: true, S_LTS: '4' },
    { UNIQUE_ID: 'photo', ITEMCODE: 'B', COMMONNAME: 'Maple', CONTSIZE: '#2', GENUSNAME: 'Acer', SEASON: 'F1', inWindow: true, bucketMatch: true, hasPhoto: true, S_LTS: '3' },
    { UNIQUE_ID: 'shift', ITEMCODE: 'C', COMMONNAME: 'Shift', CONTSIZE: '#3', GENUSNAME: 'Rosa', SEASON: 'S1', DESIGITEM: 'SHFT', inWindow: true, bucketMatch: true, hasPhoto: true, S_LTS: '2' }
  ];
  const context = {
    Map, Array, Number, String, Object, Set, WeakMap,
    window: {}, activeAvSalesBucket: 'current', activeAVTab: 'open', activeAvOpenTab: 'name', activeAvPhotoMode: 'photos',
    resolvedViewStateEpoch: 11, avPreparedRawTabRows: new WeakMap(),
    fullInventory: rows, avHotPriceKeysInventory: [], AV_FILTER_SEASON_OPTIONS: ['F1', 'S1'],
    normalizeAvSalesBucket: value => String(value), getAvSalesReserveDemandRows: () => [], buildAvReserveSeasonIndex: () => ({}), shouldUseRepAvOpenDataset: () => false,
    isAvCustomerSalesBucket: () => false, getAvSalesInventorySourceRows: () => rows,
    shouldHideU3InventoryRowForRep: () => false, itemMatchesAvOpenSalesWindow: row => row.inWindow !== false,
    getAvSalesSeasonValue: row => String(row.SEASON || ''), isShiftDesigItemRow: row => String(row.DESIGITEM || '').includes('SHFT'),
    shouldHideNotOnInventoryApprovalRowFromInventory: () => false, getAvReserveRowsForSalesItem: () => [],
    shouldIncludeMasterItemInAvOpenStock: row => Number(row.S_LTS) > 0, itemMatchesAvSalesBucket: row => !!row.bucketMatch,
    getAvReserveLocationUniqueKey: row => row.UNIQUE_ID, firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    getAvSalesItemCode: row => String(row.ITEMCODE || ''), decorateAvSalesReserveRow: row => row,
    getSearchWordStartsForProfile: (row, profile) => {
      row._searchProfileWordStarts = { ...(row._searchProfileWordStarts || {}), [profile]: [String(row.COMMONNAME || '').toLowerCase()] };
      return row._searchProfileWordStarts[profile];
    },
    getAvFilterGenusFacetValue: row => String(row.GENUSNAME || '(Blank)').trim() || '(Blank)',
    getAvFilterContSizeFacetValue: row => String(row.CONTSIZE || '-').trim() || '-',
    avItemHasPhotos: row => !!row.hasPhoto,
    getAvSalesRowsForBucket: () => rows,
    getAvPhotoMode: () => context.activeAvPhotoMode
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  installDerivationDependencies(context, 'F1');
  vm.runInContext(extractAppFunction('sortAvOpenItems') + extractAppFunction('createAvSalesRowsDerivation'), context);
  const current = context.createAvSalesRowsDerivation('current');
  const currentRows = current.finalize(current.sourceRows.map(current.mapRow).filter(Boolean));
  const metadata = context.avPreparedRawTabRows.get(currentRows);
  assert.deepEqual(Array.from(metadata.all.rows, row => row.UNIQUE_ID), ['photo', 'plain']);
  assert.deepEqual(Array.from(metadata.photos.rows, row => row.UNIQUE_ID), ['photo']);

  const nextUp = context.createAvSalesRowsDerivation('next-up');
  const nextUpRows = nextUp.finalize(nextUp.sourceRows.map(nextUp.mapRow).filter(Boolean));
  const nextUpMetadata = context.avPreparedRawTabRows.get(nextUpRows);
  assert.ok(nextUpRows.some(row => row.UNIQUE_ID === 'shift'), 'next-up derivation retains its eligible shift row');
  assert.equal(nextUpMetadata.all.rows.some(row => row.UNIQUE_ID === 'shift'), false, 'raw-tab metadata retains the existing non-shift rule');
  assert.equal(nextUpMetadata.photos.rows.some(row => row.UNIQUE_ID === 'shift'), false);

  vm.runInContext(extractAppFunction('getAvRawTabItems'), context);
  context.activeAvPhotoMode = 'all';
  assert.deepEqual(Array.from(context.getAvRawTabItems('open', { salesRows: currentRows }), row => row.UNIQUE_ID), ['photo', 'plain']);
  context.activeAvPhotoMode = 'photos';
  assert.deepEqual(Array.from(context.getAvRawTabItems('open', { salesRows: currentRows }), row => row.UNIQUE_ID), ['photo']);
  context.avPreparedRawTabRows.set(currentRows, { ...metadata, epoch: context.avDerivationMutationEpoch - 1 });
  assert.deepEqual(Array.from(context.getAvRawTabItems('open', { salesRows: currentRows }), row => row.UNIQUE_ID), ['photo'],
    'a stale prepared entry falls back to equivalent ordinary photo filtering');
});

test('AV filter option generation consumes same-epoch prepared facets and scans on stale metadata', () => {
  let genusReads = 0, sizeReads = 0, cachedHits = 0;
  const rows = [{ GENUSNAME: 'Oak', CONTSIZE: '#1' }, { GENUSNAME: 'Maple', CONTSIZE: '#2' }];
  const context = {
    Array, Set, Intl, String, Number,
    resolvedViewStateEpoch: 3, activeAVTab: 'open', activeAvOpenTab: 'name', activeAvHotPriceTab: '',
    avDerivationMutationEpoch: 3,
    activeAvReserveMode: 'cards', activeAvSalesBucket: 'current', activeAvPhotoMode: 'all',
    selectedAvResRep: '', selectedAvSalesRepName: '', selectedAvRepCustomerKey: '',
    avSharedFilterOptionsCacheKey: '', avSharedFilterOptionsCache: null,
    selectedAvSeasons: new Set(['F1']), selectedAvGenusNames: new Set(), selectedAvContSizes: new Set(),
    avGenusSelectionMode: 'all', avContSizeSelectionMode: 'all', AV_FILTER_SEASON_OPTIONS: ['F1', 'S1'],
    avPreparedRawTabRows: new WeakMap(),
    getConfiguredCurrentSeasonCode: () => 'F1', getConfiguredCurrentSalesYearCode: () => '27',
    getDatasetLoadSignature: key => `${key}:r1`, normalizeAvSelectedSeasons() {},
    normalizeAvFacetCompareKey: value => String(value || '').trim().toLowerCase(),
    getAvFilterGenusFacetValue: row => { genusReads += 1; return row.GENUSNAME || ''; },
    getAvFilterContSizeFacetValue: row => { sizeReads += 1; return row.CONTSIZE || ''; },
    syncAvGenusSelectionState: options => ({ options, selected: new Set(), mode: 'all' }),
    syncAvContSizeSelectionState: options => ({ options, selected: new Set(), mode: 'all' }),
    areAllAvSeasonsSelected: () => false, incrementInternalPerfCounter: name => { if (name === 'avFilterOptionsCacheHits') cachedHits += 1; },
    compareDrivePlantContSize: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })
  };
  context.avPreparedRawTabRows.set(rows, { epoch: 3, options: { genusOptions: ['Maple', 'Oak'], sizeOptions: ['#1', '#2'] } });
  vm.createContext(context);
  vm.runInContext(extractAppFunction('buildAvSharedFilterOptionsState'), context);
  const prepared = context.buildAvSharedFilterOptionsState(rows);
  assert.deepEqual(Array.from(prepared.genusOptions), ['Maple', 'Oak']);
  assert.deepEqual(Array.from(prepared.sizeOptions), ['#1', '#2']);
  assert.equal(genusReads + sizeReads, 0, 'same-epoch facet metadata avoids rescanning all rows');
  context.buildAvSharedFilterOptionsState(rows);
  assert.equal(cachedHits, 1, 'the ordinary options state cache remains active');

  context.avDerivationMutationEpoch += 1;
  context.avSharedFilterOptionsCacheKey = '';
  const legacy = context.buildAvSharedFilterOptionsState(rows);
  assert.deepEqual(Array.from(legacy.genusOptions).sort(), ['Maple', 'Oak']);
  assert.deepEqual(Array.from(legacy.sizeOptions).sort(), ['#1', '#2']);
  assert.equal(genusReads + sizeReads, 4, 'stale metadata falls back to recomputing facet values');
});
