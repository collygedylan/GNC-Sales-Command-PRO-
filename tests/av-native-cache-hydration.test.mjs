import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readComposedAppSource().replaceAll('\r\n', '\n');
function appFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  const rest = source.slice(start);
  const end = rest.indexOf('\n        }');
  assert.ok(end > 0);
  return rest.slice(0, end + '\n        }'.length);
}
function harness(native = true) {
  const published = [];
  const snapshot = { data: Array.from({ length: 5 }, (_, id) => ({ unique_id: String(id) })) };
  const context = {
    Promise, Array, String, Object, navigator: { onLine: true },
    cacheWarmOwner: '', cacheWarmPromise: null, loginPrefetchPromise: null, loginPrefetchMode: '',
    canUseProductionLiveSync: () => native,
    getSupabaseReadIdentityScope: () => 'brian-owner',
    getCurrentLoginCacheScopeKey: () => 'brian-scope',
    clearLoginCachePrefetch() {},
    loadFromCache: async () => snapshot,
    doesCacheSnapshotMatchCurrentSession: value => !!value,
    normalizeCachedInventorySnapshot: value => value,
    processAndLoadData: value => published.push(value),
    hydrateDatasetLoadState() {}, getCachedDatasetLoadState: () => ({}),
    currentUser: 'brian_hatfield', getPersistentInventoryCacheOwner: () => 'brian-owner',
    getUserScopedDatasetCacheKey: () => 'reserves-cache',
    loadCacheValue: async () => ({ rows: [{ unique_id: 'old-reserve' }], meta: { fullLoaded: true } }),
    getDatasetState: () => ({ initialLoaded: false }), reservesInventory: [],
    firstNonEmptyValue: (...values) => values.find(Boolean), getRoleAccessState: () => ({ isRep: true }),
    shouldTrustCachedFullLoadForDataset: () => true,
  };
  vm.createContext(context);
  vm.runInContext(appFunction('warmCachedInventory') + '\n' + appFunction('warmUserScopedDatasetCaches'), context);
  return { context, published, snapshot };
}

test('native Sales Rep startup leaves inventory and reserve cache publication to the verified coordinator', async () => {
  const { context, published } = harness();
  assert.equal(await context.warmCachedInventory(), false);
  assert.equal(await context.warmUserScopedDatasetCaches(), false);
  assert.equal(published.length, 0);
});

test('a late legacy cache read cannot replace live inventory after native auth becomes ready', async () => {
  const { context, published, snapshot } = harness(false);
  let finish;
  context.loadFromCache = () => new Promise(resolve => { finish = resolve; });
  const pending = context.warmCachedInventory();
  await Promise.resolve();
  context.canUseProductionLiveSync = () => true;
  finish(snapshot);
  assert.equal(await pending, false);
  assert.equal(published.length, 0);
});

test('legacy offline cache restoration is preserved outside native live sync', async () => {
  const { context, published } = harness(false);
  assert.equal(await context.warmCachedInventory(), true);
  assert.equal(published.length, 1);
  assert.equal(published[0].data.length, 5);
});

test('native offline startup retains the existing offline cache fallback', async () => {
  const { context, published } = harness();
  context.navigator.onLine = false;
  assert.equal(await context.warmCachedInventory(), true);
  assert.equal(published.length, 1);
});

test('a formatted first-page preview is incomplete until both full master and reserves commit', () => {
  let complete = false;
  let reserves = false;
  const context = {
    canUseProductionLiveSync: () => true, activeAVTab: 'open', shouldUseRepAvOpenDataset: () => true,
    getDatasetState: () => ({ rowCompleteness: complete ? 'complete' : 'partial' }),
    isDatasetLoaded: key => key === 'master' ? complete : reserves,
  };
  vm.createContext(context);
  vm.runInContext(appFunction('isAvLiveCatalogIncomplete'), context);
  assert.equal(context.isAvLiveCatalogIncomplete(), true);
  complete = true;
  assert.equal(context.isAvLiveCatalogIncomplete(), true);
  reserves = true;
  assert.equal(context.isAvLiveCatalogIncomplete(), false);
  context.activeAVTab = 'reserves';
  complete = false;
  assert.equal(context.isAvLiveCatalogIncomplete(), false);
});

test('queued initial AV loads join the foreground full snapshot instead of replacing it with browse', async () => {
  const requested = [];
  const foreground = { id: 'core:master', projection: 'full', cacheKey: 'full-identity' };
  const context = {
    RETIRED_DATASET_KEYS: new Set(), DATASET_DEFINITIONS: { master: {}, avOpen: {}, reserves: {} },
    canUseProductionLiveSync: () => true,
    getProductionLiveSyncContext: () => ({ adapters: [foreground] }),
    createProductionCoreLiveAdapter: (key, projection) => ({ id: `core:${key === 'avOpen' ? 'master' : key}`, projection }),
    getProductionLiveSyncCoordinator: () => ({ ensure: async adapter => { requested.push(adapter); return true; } }),
  };
  vm.createContext(context);
  vm.runInContext(appFunction('ensureDatasetLoaded'), context);
  assert.equal(await context.ensureDatasetLoaded('avOpen', 'initial'), true);
  assert.equal(requested[0].projection, 'full');
  assert.equal(requested[0], foreground);
  assert.equal(await context.ensureDatasetLoaded('reserves', 'full'), true);
  assert.equal(requested[1].projection, 'full');
});

for (const result of [null, [{ unique_id: 'old-source' }]]) {
  test(`AV preparation retries the latest source after clearing its pending marker (${result ? 'stale result' : 'cancelled job'})`, async () => {
    let finish;
    let sourceKey = 'preview';
    let preparations = 0;
    const identity = () => ({ key: 'current', scope: 'brian', sourceKey, signature: `brian:current:${sourceKey}` });
    const context = {
      window: { AgMetricAvDerivedRows: {
        peek: () => ({ sourceKey: 'old', rows: [{ unique_id: 'preview' }] }),
        prepare: () => { preparations += 1; return new Promise(resolve => { finish = resolve; }); },
      } },
      activeAvSalesBucket: 'current', activeAVTab: 'open', avDerivedRowsActiveScope: '',
      avDerivedRowsPendingSignature: '', avResolvedBaseStateKey: 'old', avResolvedBaseStateCache: {},
      AV_DERIVED_ROWS_CHUNK_SIZE: 96, normalizeAvSalesBucket: value => value,
      getAvSalesDerivationIdentity: identity,
      createAvSalesRowsDerivation: () => ({ sourceRows: [], mapRow: row => row, finalize: rows => rows }),
      isViewVisible: () => true, console,
      scheduleAVRender: () => {
        assert.equal(context.avDerivedRowsPendingSignature, '', 'pending marker must clear before reentrant rendering');
        context.getAvSalesRowsForRendering();
      },
    };
    vm.createContext(context);
    vm.runInContext(appFunction('getAvSalesRowsForRendering'), context);
    context.getAvSalesRowsForRendering();
    if (result) sourceKey = 'complete';
    finish(result);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(preparations, 2, 'the current source must receive a new preparation without another user action');
    assert.equal(context.avDerivedRowsPendingSignature, identity().signature);
  });
}

for (const { interacting, atomic } of [{ interacting: false, atomic: false }, { interacting: true, atomic: false }, { interacting: false, atomic: true }]) {
test(`AV page rendering keeps bounded progress and preserves interaction pacing (interacting=${interacting}, atomic=${atomic})`, () => {
  const frames = [];
  const delays = [];
  const batches = [];
  const generatedPerFrame = [];
  const continuationGeneratedPerFrame = [];
  const publicationOptions = [];
  const selectionRefreshes = [];
  let generated = 0;
  let now = 1;
  const generatedRows = [];
  const loadMoreButton = {
    disabled: false,
    isConnected: true,
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    insertAdjacentHTML(_position, html) {
      const ids = html.split(',').filter(value => /^row-\d+$/.test(value));
      generatedRows.push(...ids);
    },
    remove() { this.isConnected = false; },
  };
  const container = {
    classList: { add() {} }, style: {}, dataset: {}, _avCardWindow: null,
    querySelector(selector) { return selector === '[data-av-load-more]' && loadMoreButton.isConnected ? loadMoreButton : null; },
    insertAdjacentHTML(_position, html) {
      const ids = html.split(',').filter(value => /^row-\d+$/.test(value));
      generatedRows.push(...ids);
    },
  };
  const context = {
    avRenderChunkToken: 0, CHUNK_RENDER_INTERACTION_HOLD_MAX_MS: 560, IOS_CHUNK_FRAME_BUDGET_MS: 3,
    beginInternalPerfMeasure: () => now, clearChunkRenderTimersByKey() {},
    buildRowsRenderSignature: () => 'full', isAdaptivePerformanceMode: () => false,
    getAdaptivePerformanceLevel: () => 0, isIOSDevice: () => false, isStandaloneApp: () => false,
    canUseProductionLiveSync: () => atomic, shouldUseRepAvOpenDataset: () => atomic, CLIENT_BROWSE_PAGE_SIZE: 100,
    window: { matchMedia: () => ({ matches: false }) }, Date, Math, Array,
    getContainerRenderSignature: () => '', incrementInternalPerfCounter() {},
    recordInternalPerfDuration() {}, setContainerRenderSignature() {},
    getCurrentVisibleViewId: () => 'av', IntersectionObserver: undefined,
    getChunkRenderPacing: target => ({ batchTarget: target, timeBudget: 5.5, frameDelayMs: interacting ? 24 : 0, liveGestureActive: false, interactionSlowMode: interacting }),
    performance: { now: () => now }, generateCard: row => { now += 7; generated += 1; return `${row.DOM_ID},`; },
    setContainerHtml: (_container, html, options) => {
      const ids = html.split(',').filter(value => /^row-\d+$/.test(value));
      batches.push(ids.length);
      generatedRows.push(...ids);
      publicationOptions.push(options);
    },
    captureProductionRefreshAnchor: () => null, restoreProductionRefreshAnchor() {},
    refreshCartButtons: rows => selectionRefreshes.push(rows),
    appendHtmlFragment: (_container, html) => {
      const ids = html.split(',').filter(value => /^row-\d+$/.test(value));
      batches.push(ids.length);
      generatedRows.push(...ids);
    },
    requestAnimationFrame: callback => frames.push(callback),
    shouldHoldFollowupChunkFramesForInteraction: () => false,
    isUserInLiveTouchScrollGesture: () => false,
    scheduleChunkRenderTimeout: (_key, callback, delay) => { delays.push(delay); frames.push(callback); },
    scheduleDeferredCardPhotoHydration() {},
  };
  vm.createContext(context);
  vm.runInContext(appFunction('getAvCardWindowEnd') + '\n' + appFunction('installAvCardWindowContinuation') + '\n' + appFunction('renderAVOpenCardsChunked'), context);
  context.renderAVOpenCardsChunked(container, {}, Array.from({ length: 100 }, (_, index) => ({ DOM_ID: `row-${index}` })), 'av', 'Current Season');
  let turns = 0;
  while (frames.length && turns++ < 250) {
    const before = generated;
    frames.shift()();
    generatedPerFrame.push(generated - before);
  }
  assert.equal(generatedRows.length, 20, 'initial rendering must stop at the first bounded card window');
  assert.equal(container.dataset.avWindowCount, '20');
  assert.ok(loadMoreButton.listeners.click, 'a continuation control must be installed after the first window');
  assert.equal(batches[0], atomic ? 20 : interacting ? 1 : 4, 'the initial window publishes only after bounded preparation');
  if (atomic) assert.equal(batches.length, 1, 'avoid repeated layout of the growing live page');
  if (atomic) {
    assert.ok(generatedPerFrame.some(size => size === 12));
    assert.equal(publicationOptions[0]?.preserveLiveNodes, true);
    assert.equal(selectionRefreshes.length, 1, 'selection is reconciled at publication, not captured at preparation time');
  }
  assert.ok(generatedPerFrame.every(size => size <= 12), 'the renderer must remain bounded');
  if (interacting) assert.ok(delays.length > 0 && delays.every(delay => delay === 24));
  else if (atomic) assert.ok(delays.length > 0 && delays.every(delay => delay === 0), 'detached HTML preparation should yield without waiting for a visual frame');
  else assert.deepEqual(delays, [], 'visible incremental rendering should continue on the next animation frame');

  const loadNextWindow = () => {
    loadMoreButton.listeners.click();
    let continuationTurns = 0;
    while (frames.length && continuationTurns++ < 100) {
      const before = generated;
      frames.shift()();
      continuationGeneratedPerFrame.push(generated - before);
    }
    assert.ok(continuationTurns < 100, 'continuation must finish without an unbounded frame loop');
  };
  while (container._avCardWindow?.index < 100 && turns++ < 500) {
    loadNextWindow();
    assert.equal(Number(container.dataset.avWindowCount) % 20, 0, 'continuation advances by complete bounded windows');
    if (container._avCardWindow?.index < 100) assert.equal(loadMoreButton.isConnected, true);
  }
  assert.equal(container.dataset.avWindowCount, '100');
  assert.equal(loadMoreButton.isConnected, false, 'the continuation control is removed after the final window');
  assert.equal(generatedRows.length, 100);
  assert.equal(new Set(generatedRows).size, 100, 'continuation must neither duplicate nor skip card rows');
  assert.deepEqual(generatedRows, Array.from({ length: 100 }, (_, index) => `row-${index}`));
  assert.ok(continuationGeneratedPerFrame.every(size => size <= 4), 'each Show More frame must prepare at most four rich cards');
  assert.ok(selectionRefreshes.some(rows => rows.length === 100), 'selection state is refreshed as the visible window grows');
});
}

test('AV cards skip generic chip markup discarded by the early AV template return', () => {
  const start = source.indexOf('            const isChecked=selectedItems.has(item.DOM_ID)');
  const end = source.indexOf('            const safeUidJs=', start);
  assert.ok(start > 0 && end > start);
  for (const sourceView of ['av', 'av-photo', 'request']) {
    let quantityCalls = 0;
    let designCalls = 0;
    vm.runInNewContext(source.slice(start, end), {
      item: { DOM_ID: 'row-1' }, sourceView, selectedItems: new Set(),
      activeReqTab: 'pending', isDockSuspendDcRequestMirrorRow: () => false,
      firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
      buildInventoryQuantityChipsHtml: () => { quantityCalls++; return 'quantity'; },
      buildInventoryCardFieldChipsHtml: () => { designCalls++; return 'design'; },
    });
    assert.equal(quantityCalls, sourceView === 'request' ? 3 : 0);
    assert.equal(designCalls, sourceView === 'request' ? 3 : 0);
  }
});

test('full AV preparation yields through cancellable browser tasks without nested timer clamping', async () => {
  const tasks = [];
  let timerCalls = 0;
  class MessageChannel {
    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = { postMessage: data => tasks.push(() => this.port1.onmessage({ data })) };
    }
  }
  const root = { MessageChannel, setTimeout: callback => { timerCalls++; tasks.push(callback); return timerCalls; }, clearTimeout() {} };
  vm.runInNewContext(readFileSync(new URL('../assets/av-derived-rows.js', import.meta.url), 'utf8'), { window: root });
  const service = root.AgMetricAvDerivedRows;
  let mapped = 0;
  const options = { key: 'current', scope: 'brian', sourceKey: 'full', rows: Array.from({ length: 9501 }, (_, i) => i),
    chunkSize: 96, deferFirstSlice: true, mapRow: row => { mapped++; return row; } };
  const pending = service.prepare(options);
  assert.equal(mapped, 0, 'first slice must allow the existing preview to paint');
  tasks.shift()();
  assert.equal(mapped, 96, 'each task must remain bounded');
  while (tasks.length) tasks.shift()();
  assert.equal((await pending).length, 9501);
  assert.equal(timerCalls, 0, 'browser task scheduling must avoid the nested timer clamp');
  const cancelled = service.prepare({ ...options, sourceKey: 'new' });
  service.clearScope('brian');
  while (tasks.length) tasks.shift()();
  assert.equal(await cancelled, null);
  assert.equal(mapped, 9501, 'cancelled work must never map or publish');
});

test('larger AV chunks yield at the time budget without losing or duplicating rows', async () => {
  const tasks = [];
  const slices = [];
  let now = 0;
  const root = { performance: { now: () => now }, setTimeout: callback => { tasks.push(callback); return tasks.length; }, clearTimeout() {} };
  vm.runInNewContext(readFileSync(new URL('../assets/av-derived-rows.js', import.meta.url), 'utf8'), { window: root });
  const rows = Array.from({ length: 100 }, (_, i) => i);
  const pending = root.AgMetricAvDerivedRows.prepare({ key: 'current', scope: 'brian', sourceKey: 'full', rows,
    chunkSize: 384, maxSliceMs: 6, deferFirstSlice: true,
    mapRow: row => { now += 2; return row; }, onSlice: (start, end) => slices.push([start, end]) });
  while (tasks.length) tasks.shift()();
  assert.deepEqual(Array.from(await pending), rows);
  assert.ok(slices.every(([start, end]) => end - start <= 3));
  assert.equal(slices.at(-1)[1], rows.length);
});
