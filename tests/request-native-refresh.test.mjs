// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(source, name, stopAt) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in shell`);
  const end = source.indexOf(stopAt, start);
  assert.ok(end > start, `${name} boundary`);
  return source.slice(start, end);
}

function requestAdapter() {
  return { id: 'core:requests', sourceKeys: ['ph_active_request'], cacheKey: 'request-cache-v1' };
}

function requestContext({ surfaces = ['request:pending'], adapters = [requestAdapter()], ...overrides } = {}) {
  return {
    view: 'request', viewKey: 'request:pending:1', surfaces, adapters, visible: true, online: true,
    scope: 'profile:dylan', dataPermissionVersion: 'permission-v4',
    ...overrides
  };
}

function renderSignatureFixture() {
  const ctx = {
    firstNonEmptyValue(...values) {
      return values.find(value => value != null && String(value).trim() !== '') ?? '';
    },
    selectedItems: new Set(),
    isHoldReleaseOverrideActiveForItem: item => item.holdReleaseOverride === true,
    getItemDisplayValue: (item, key) => key === 'SALES_NOTE' ? item.SALES_NOTE || '' : '',
    getRowPhotoLink: item => item.REQ_PHOTO_LINK || '',
    getRowPhotoDateLabel: (_item, _view, link) => link ? 'Oct 8' : '',
    isRequestComplete: item => item.REQ_STATUS === 'Complete',
    isRequestDeliverySending: item => item.DELIVERY_STATUS === 'pending',
    isRequestDeliveryNeedsAttention: item => item.DELIVERY_STATUS === 'failed',
    getRequestCardSourceLabel: item => item.REQUEST_SOURCE || '',
    isSeasonSalesNoteCardItem: item => item.seasonSalesNote === true,
    isDockSuspendDcRequestMirrorRow: item => item.dockSuspendMirror === true
  };
  const normalizedQuantity = (item, ...keys) => {
    const value = ctx.firstNonEmptyValue(...keys.map(key => item[key]),
      ...keys.map(key => item.SNAPSHOT && item.SNAPSHOT[key]));
    return value === '' ? '0' : String(Number(value));
  };
  ctx.getCardPtrOnHandValue = item => normalizedQuantity(item, 'PTRONHAND', 'ptronhand', 'PTR_ON_HAND', 'ptr_on_hand');
  ctx.getCardPtrReviewedValue = item => normalizedQuantity(item, 'PTRREVIEWED', 'ptrreviewed', 'PTR_REVIEWED', 'ptr_reviewed', 'PTRREVIEW', 'ptrreview', 'REVIEWED', 'reviewed');
  ctx.getCardPtrAvailableValue = item => normalizedQuantity(item, 'PTRAVAILABLE', 'ptravailable', 'PRTAVAILABLE', 'prtavailable', 'LOC_AVAIL', 'loc_avail', 'LOC_AVAILABLE', 'loc_available', 'LOCAVA', 'locava', 'AVAILABLE', 'available');
  ctx.getCardOpenStockValue = item => normalizedQuantity(item, 'S_LTS', 's_lts');
  const displayValue = (item, keys) => String(ctx.firstNonEmptyValue(...keys.map(key => item[key])) || '').trim();
  ctx.getInventoryCardFieldTagColorDisplayValue = item => displayValue(item, ['FIELDTAGCOLOR', 'fieldtagcolor', 'FIELD_TAG_COLOR', 'field_tag_color', 'FieldTagColor']);
  ctx.getInventoryCardDesigCustValue = item => displayValue(item, ['DESIGCUST', 'desigcust', 'DESIG_CUST', 'desig_cust', 'DesigCust', 'DESIGNCUST', 'designcust', 'CUSTOMERDESIG', 'customerdesig']);
  ctx.getInventoryCardDesigItemValue = item => displayValue(item, ['DESIGITEM', 'desigitem', 'DESIG_ITEM', 'desig_item', 'DesigItem', 'DESIGNITEM', 'designitem', 'ITEMDESIG', 'itemdesig']);
  ctx.getInventoryCardDesigLocValue = item => displayValue(item, ['DESIGLOC', 'desigloc', 'DESIG_LOC', 'desig_loc', 'DesigLoc', 'DESIGNLOC', 'designloc', 'DESIG_LOCATION', 'desig_location']);
  vm.createContext(ctx);
  const fn = extractFunction(html, 'buildRequestItemRenderSignature', 'function buildRequestChunkRenderKey(');
  vm.runInContext(fn, ctx);
  return ctx.buildRequestItemRenderSignature;
}

function fixture({ native = true, context = requestContext(), ensureResult = true,
  ensureError = null, onEnsure = null, terminal = false, lastForceAt = 0 } = {}) {
  const calls = { ensure: [], fetch: [], process: [], sideRefresh: [], failures: [], clears: [], dirty: [],
    reconcile: [], badges: 0, persisted: [] };
  const state = {};
  const coordinator = {
    async ensure(...args) {
      calls.ensure.push(args);
      if (onEnsure) onEnsure();
      if (ensureError) throw ensureError;
      return ensureResult;
    }
  };
  const ctx = {
    ACTIVE_REQUEST_TABLE: 'ph_active_request',
    REQUEST_VIEW_FORCE_REFRESH_MIN_INTERVAL_MS: 1000,
    REQUEST_QUEUE_SIDE_REFRESH_MIN_INTERVAL_MS: 2000,
    currentUser: 'dylan',
    currentRole: 'ADMIN',
    activeReqTab: context.surfaces.includes('request:bunch-notes') ? 'bunch-notes' : 'pending',
    navigator: { onLine: true },
    productionLiveSyncCoordinator: native ? coordinator : null,
    canUseProductionLiveSync: () => native,
    getProductionLiveSyncContext: () => ({ ...context }),
    getProductionLiveSyncCoordinator: () => coordinator,
    isRequestViewReadTerminalForCurrentIdentity: () => terminal,
    clearSupabaseReadTerminalDenialsForIdentity() { calls.clears.push('terminal'); },
    requestViewTerminalReadIdentityScope: 'terminal-scope',
    clearRequestViewReadFailure() { calls.clears.push('read-failure'); },
    shouldPauseManualSyncViewRefresh: () => false,
    requestViewForceRefreshInFlight: false,
    requestViewReadCooldownRemaining: () => 0,
    shouldDeferInteractiveBackgroundWork: () => false,
    lastRequestViewForceRefreshAt: lastForceAt,
    requestViewRetryAttempts: 3,
    requestViewForceRefreshRetryTimer: null,
    requestViewInteractiveRefreshTimer: null,
    requestViewLiveSyncSignature: 'old-signature',
    requestsInventory: [],
    fetchActiveRequestLiveRows: async (...args) => { calls.fetch.push(args); return [{ unique_id: 'legacy-row' }]; },
    formatFetchedRows: rows => rows,
    processAndLoadData: payload => calls.process.push(payload),
    refreshActiveRequestQueueSideData: async (...args) => { calls.sideRefresh.push(args); return false; },
    getDatasetState: () => state,
    buildRequestLiveSyncSignature: () => 'new-signature',
    updateFooterRequestBadge: () => { calls.badges++; },
    schedulePendingRequestSourceCompletionReconcile: (...args) => calls.reconcile.push(args),
    markViewDirty: (...args) => calls.dirty.push(args),
    isViewVisible: () => false,
    persistCurrentCache: (...args) => calls.persisted.push(args),
    recordRequestViewReadFailure: error => calls.failures.push(error),
    calls
  };
  vm.createContext(ctx);
  const helper = extractFunction(html, 'getNativeForegroundRequestRefreshAdapter', 'async function forceRefreshRequestsForView(');
  const forceRefresh = extractFunction(html, 'forceRefreshRequestsForView', 'function syncRequestViewLiveSync(');
  vm.runInContext(`${helper}\n${forceRefresh}`, ctx);
  return { ctx, calls, state, adapter: requestAdapter() };
}

test('request card signature tracks normalized visible inventory chips and design fields', () => {
  const signature = renderSignatureFixture();
  const row = {
    UNIQUE_ID: 'request-1', DOM_ID: 'dom-1', COMMONNAME: 'Rose', CONTSIZE: '1 gal',
    LOCATIONCODE: 'C.06.001', LOTCODE: 'LOT-1', REQUEST_SOURCE: 'Drive',
    REQUESTED_BY: 'Rep', REQ_CUSTOMER: 'Customer', REQ_QTY: '2', REQ_STATUS: 'Pending',
    REQ_RESERVE: 'NO', PRIORITY: 'High', PTRONHAND: '12.0', PTRREVIEWED: 8,
    PTRAVAILABLE: 4, S_LTS: 2, DESIGCUST: 'Garden', DESIGITEM: 'Rose #1',
    DESIGLOC: 'North', FIELDTAGCOLOR: 'Blue'
  };
  const original = signature(row);
  assert.equal(signature({ ...row }), original, 'an unchanged row copy keeps the same signature');
  assert.equal(signature({
    ...row,
    PTRONHAND: undefined,
    PTRREVIEWED: undefined,
    PTRAVAILABLE: undefined,
    S_LTS: undefined,
    SNAPSHOT: { PTRONHAND: 12, PTRREVIEWED: 8, PTRAVAILABLE: 4, S_LTS: 2 }
  }), original, 'equivalent canonical snapshot aliases normalize to the same rendered chip values');

  const displayedChanges = [
    { PTRONHAND: '13' },
    { PTRREVIEWED: '9' },
    { PTRAVAILABLE: '5' },
    { S_LTS: '3' },
    { DESIGCUST: 'Landscape' },
    { DESIGITEM: 'Rose #2' },
    { DESIGLOC: 'South' },
    { FIELDTAGCOLOR: 'Red' }
  ];
  for (const change of displayedChanges) {
    assert.notEqual(signature({ ...row, ...change }), original,
      `${Object.keys(change)[0]} changes a value rendered on the request card`);
  }
});

test('native request refresh helper accepts only an authorized foreground request-source adapter', () => {
  const valid = fixture();
  assert.deepEqual(valid.ctx.getNativeForegroundRequestRefreshAdapter(), valid.adapter);

  const invalidContexts = [
    requestContext({ surfaces: ['request:bunch-notes'] }),
    requestContext({ adapters: [] }),
    requestContext({ adapters: [{ id: 'core:requests', sourceKeys: ['ph_request_history'] }] }),
    requestContext({ adapters: [{ id: 'side:requests', sourceKeys: ['ph_active_request'] }] }),
    requestContext({ scope: '' }),
    requestContext({ dataPermissionVersion: '' }),
    requestContext({ visible: false }),
    requestContext({ online: false })
  ];
  for (const context of invalidContexts) {
    const f = fixture({ context });
    assert.equal(f.ctx.getNativeForegroundRequestRefreshAdapter(), null);
  }
  assert.equal(fixture({ native: false }).ctx.getNativeForegroundRequestRefreshAdapter(), null);
  assert.equal(fixture({ context: requestContext(), native: true, ensureResult: true }).ctx.getNativeForegroundRequestRefreshAdapter().id, 'core:requests');
});

test('authorized native refresh delegates with the requested force mode and retains queue-side refresh', async () => {
  for (const options of [
    { options: {}, expectedForce: false },
    { options: { force: true }, expectedForce: true },
    { options: { manualRetry: true }, expectedForce: true }
  ]) {
    const f = fixture();
    assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch', options.options), true);
    assert.equal(f.calls.ensure.length, 1);
    assert.equal(f.calls.ensure[0][0].id, 'core:requests');
    assert.equal(f.calls.ensure[0][1], options.expectedForce);
    assert.equal(f.calls.fetch.length, 0, 'native refresh must not issue the legacy fetch');
    assert.equal(f.calls.process.length, 0, 'native snapshot commit owns request state updates');
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.sideRefresh)), [[
      'request-switch', { force: options.options.force === true, allowWhileInteractive: true, minIntervalMs: 2000 }
    ]]);
    assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
  }
});

test('native ensure false or failure never falls back to a legacy request read', async () => {
  const declined = fixture({ ensureResult: false });
  assert.equal(await declined.ctx.forceRefreshRequestsForView('request-switch', { force: true }), false);
  assert.equal(declined.calls.ensure.length, 1);
  assert.equal(declined.calls.fetch.length, 0);
  assert.equal(declined.calls.process.length, 0);
  assert.equal(declined.ctx.requestViewForceRefreshInFlight, false);

  const failure = new Error('verified native snapshot unavailable');
  const rejected = fixture({ ensureError: failure });
  assert.equal(await rejected.ctx.forceRefreshRequestsForView('request-switch'), false);
  assert.equal(rejected.calls.fetch.length, 0);
  assert.equal(rejected.calls.process.length, 0);
  assert.equal(rejected.calls.failures[0], failure);
  assert.equal(rejected.ctx.requestViewForceRefreshInFlight, false);
});

test('a lost native owner after ensure returns false without a legacy fetch', async () => {
  const context = requestContext();
  const f = fixture({ context, onEnsure: () => { context.visible = false; } });
  assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch'), false);
  assert.equal(f.calls.ensure.length, 1);
  assert.equal(f.calls.fetch.length, 0);
  assert.equal(f.calls.process.length, 0);
  assert.equal(f.calls.sideRefresh.length, 0);
  assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
});

test('a changed Request surface after ensure does not refresh the new tab side data', async () => {
  const context = requestContext();
  const f = fixture({ context, onEnsure: () => { context.viewKey = 'request:reps:2'; } });
  assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch'), false);
  assert.equal(f.calls.fetch.length, 0);
  assert.equal(f.calls.process.length, 0);
  assert.equal(f.calls.sideRefresh.length, 0);
  assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
});

test('terminal, offline, cooldown, in-flight, and interval guards run before native ensure', async () => {
  const cases = [
    { terminal: true, options: {} },
    { offline: true, options: {} },
    { cooldown: true, options: {} },
    { inFlight: true, options: {} },
    { lastForceAt: Date.now(), options: { force: false } }
  ];
  for (const item of cases) {
    const f = fixture({ terminal: item.terminal || false, lastForceAt: item.lastForceAt || 0 });
    if (item.offline) f.ctx.navigator.onLine = false;
    if (item.cooldown) f.ctx.requestViewReadCooldownRemaining = () => 500;
    if (item.inFlight) f.ctx.requestViewForceRefreshInFlight = true;
    assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch', item.options), false);
    assert.equal(f.calls.ensure.length, 0);
    assert.equal(f.calls.fetch.length, 0);
  }

  const manual = fixture({ terminal: true });
  assert.equal(await manual.ctx.forceRefreshRequestsForView('manual-retry', { manualRetry: true }), true);
  assert.equal(manual.calls.ensure[0][1], true);
  assert.deepEqual(manual.calls.clears, ['terminal', 'read-failure']);
});

test('Bunch Notes and non-native contexts retain legacy request refresh behavior', async () => {
  for (const f of [
    fixture({ context: requestContext({ surfaces: ['request:bunch-notes'] }) }),
    fixture({ native: false })
  ]) {
    assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch', { force: true }), true);
    assert.equal(f.calls.ensure.length, 0);
    assert.equal(f.calls.fetch.length, 1);
    assert.equal(f.calls.process.length, 1);
    assert.equal(f.calls.process[0].requestsData[0].unique_id, 'legacy-row');
    assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
  }
});

function wakeFixture({ native = true } = {}) {
  const calls = { signal: [], subscriptions: [], force: [], liveSync: [], alwaysOn: [], renders: [] };
  const ctx = {
    REQUEST_VIEW_VISIBLE_FORCE_REFRESH_MIN_INTERVAL_MS: 1000,
    REQUEST_VIEW_ACTIVE_SIGNATURE_SYNC_MS: 3000,
    REQUEST_VIEW_SIGNATURE_SYNC_MIN_INTERVAL_MS: 4000,
    REQUEST_REALTIME_UI_DELAY_MS: 25,
    lastRequestLiveWakeAt: 0,
    canWakeRequestQueueLiveData: () => true,
    getNativeForegroundRequestRefreshAdapter: () => native ? requestAdapter() : null,
    signalProductionLiveSync: (...args) => calls.signal.push(args),
    isPrimaryRequestLiveSyncContextVisible: () => true,
    setRealtimeSubscriptionsForView: (...args) => calls.subscriptions.push(args),
    forceRefreshRequestsForView: (...args) => { calls.force.push(args); return Promise.resolve(true); },
    runRequestViewLiveSync: (...args) => { calls.liveSync.push(args); return Promise.resolve(true); },
    syncAlwaysOnRequestData: (...args) => calls.alwaysOn.push(args),
    isViewVisible: () => true,
    scheduleRequestRender: (...args) => calls.renders.push(args),
    calls
  };
  vm.createContext(ctx);
  const wake = extractFunction(html, 'wakeRequestQueueLiveData', 'function scheduleRequestNavigationLiveWake(');
  vm.runInContext(wake, ctx);
  return { ctx, calls };
}

test('native request wake signals the coordinator without legacy fetch, timer, subscription, or render work', () => {
  const f = wakeFixture();
  assert.equal(f.ctx.wakeRequestQueueLiveData('request-navigation', {
    force: true, subscribeVisible: true, renderDelayMs: 50
  }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.signal)), [['view-entry', 0]]);
  assert.equal(f.calls.subscriptions.length, 0);
  assert.equal(f.calls.force.length, 0);
  assert.equal(f.calls.liveSync.length, 0);
  assert.equal(f.calls.alwaysOn.length, 0);
  assert.equal(f.calls.renders.length, 0);
});

test('legacy request wake retains its subscription, refresh, periodic sync, and render sequence', async () => {
  const f = wakeFixture({ native: false });
  assert.equal(f.ctx.wakeRequestQueueLiveData('request-navigation', {
    subscribeVisible: true, renderDelayMs: 50
  }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.subscriptions)), [['request', true]]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.force)), [[
    'request-navigation', { force: true, allowWhileInteractive: true, minIntervalMs: 0 }
  ]]);
  assert.equal(f.calls.alwaysOn.length, 1);
  assert.equal(f.calls.renders.length, 1);
  assert.equal(f.calls.liveSync.length, 0);
  await Promise.resolve();
});

function productionListFixture({ key = 'request-main', tab = 'pending', signature = 'same', rowCount = 2 } = {}) {
  const calls = { crumb: [], complete: 0, staged: [], created: 0, classes: [] };
  const container = {
    querySelectorAll: selector => ({ length: selector === '[data-request-uid]' ? rowCount : 0 }),
    classList: { add: value => calls.classes.push(value) },
    isConnected: true
  };
  const refresh = { pending: 0, containers: new Set() };
  const ctx = {
    productionLiveSyncActiveRender: refresh,
    activeReqTab: tab,
    document: { createElement: () => { calls.created++; return { childNodes: [] }; } },
    normalizeRenderSignature: value => String(value).trim(),
    getContainerRenderSignature: () => signature,
    syncRequestCrumb: (...args) => calls.crumb.push(args),
    renderMarkupChunkedByKey: (...args) => { calls.staged.push(args); return 'staged'; },
    calls
  };
  vm.createContext(ctx);
  const source = extractFunction(html, 'stageProductionRefreshList', 'function cancelProductionRefresh(');
  vm.runInContext(source, ctx);
  return { ctx, calls, container, refresh, key };
}

test('completed pending request list reuses matching rendered rows and completes the refresh', () => {
  const f = productionListFixture();
  const completed = () => { f.calls.complete++; };
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.equal(f.ctx.stageProductionRefreshList('request-main', f.container, {}, rows, 'Pending', () => '', {
    renderSignature: 'same', onComplete: completed
  }), true);
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.staged.length, 0);
  assert.equal(f.calls.complete, 1);
  assert.equal(f.calls.crumb.length, 1);
  assert.equal(f.refresh.pending, 0);
  assert.equal(f.refresh.retainedRequestList, true);
});

test('changed, incomplete, non-pending, and Drive lists still use the staging renderer', () => {
  const cases = [
    { signature: 'changed' },
    { rowCount: 1 },
    { tab: 'completed' },
    { key: 'drive:name:list' }
  ];
  for (const item of cases) {
    const f = productionListFixture(item);
    const key = item.key || 'request-main';
    const rows = [{ id: 'a' }, { id: 'b' }];
    assert.equal(f.ctx.stageProductionRefreshList(key, f.container, null, rows, 'Rows', () => '', {
      renderSignature: 'same'
    }), 'staged');
    assert.equal(f.calls.created, 1);
    assert.equal(f.calls.staged.length, 1);
    assert.equal(f.refresh.pending, 1);
    assert.equal(f.container.classList ? f.calls.classes.length : 0, 1);
  }
});

function footerContainer() {
  const calls = { inserted: [], removed: 0 };
  let footer = null;
  const container = {
    querySelector: selector => selector === '.browse-page-footer' ? footer : null,
    insertAdjacentHTML(_position, markup) {
      calls.inserted.push(markup);
      footer = { outerHTML: markup, remove() { calls.removed++; footer = null; } };
    },
    get footer() { return footer; },
    calls
  };
  return container;
}

function footerFixture() {
  const ctx = { WeakMap };
  vm.createContext(ctx);
  const fn = extractFunction(html, 'syncRequestBrowseFooter', 'function renderRequest(');
  vm.runInContext(`const requestBrowseFooterMarkup = new WeakMap();\n${fn}`, ctx);
  return ctx.syncRequestBrowseFooter;
}

test('request browse footer reuses identical HTML despite DOM decoration, replaces changed HTML once, and removes empty HTML', () => {
  const syncFooter = footerFixture();
  const first = footerContainer();
  syncFooter(first, '<footer class="browse-page-footer">Page 1</footer>');
  const originalFooter = first.footer;
  originalFooter.outerHTML = '<footer class="browse-page-footer ops-record-node">Page 1</footer>';
  syncFooter(first, '<footer class="browse-page-footer">Page 1</footer>');
  assert.equal(first.footer, originalFooter, 'unchanged markup keeps the decorated footer node');
  assert.deepEqual(first.calls.inserted, ['<footer class="browse-page-footer">Page 1</footer>']);
  assert.equal(first.calls.removed, 0);

  const changedMarkup = '<footer class="browse-page-footer">Page 2</footer>';
  syncFooter(first, changedMarkup);
  assert.deepEqual(first.calls.inserted, [
    '<footer class="browse-page-footer">Page 1</footer>', changedMarkup
  ]);
  assert.equal(first.calls.removed, 1);
  syncFooter(first, '');
  assert.equal(first.footer, null);
  assert.equal(first.calls.removed, 2);
  assert.equal(first.calls.inserted.length, 2, 'empty markup removes without inserting');

  const second = footerContainer();
  syncFooter(second, changedMarkup);
  assert.equal(second.calls.inserted.length, 1, 'the WeakMap cache is independent per footer node');
  assert.equal(second.calls.removed, 0);
});

test('iOS layout cleanup preserves active request chunks while render replacement and navigation still cancel them', () => {
  const clearedClasses = [];
  const windowedList = {
    classList: { remove: value => clearedClasses.push(value) },
    style: { minHeight: '100px' }
  };
  const requestView = {
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === '.performance-windowed-list' ? [windowedList] : [];
    }
  };
  const calls = { cancel: [], sticky: [] };
  const ctx = {
    document: {
      activeElement: null,
      getElementById(id) {
        if (id === 'view-request') return requestView;
        if (id === 'main-scroll-area') return { style: {}, scrollTop: 0 };
        return null;
      }
    },
    isIosPhoneRequestFlowEnabled: () => true,
    getCurrentVisibleViewId: () => 'request',
    cancelChunkRenderWorkForView: view => calls.cancel.push(view),
    releaseFixedFilterRail() {},
    scheduleStickyRailOffsetSync: (...args) => calls.sticky.push(args)
  };
  vm.createContext(ctx);
  const clear = extractFunction(html, 'clearIosPhoneRequestFlowState', 'function auditIosPhoneRequestFlow(');
  vm.runInContext(clear, ctx);
  assert.equal(ctx.clearIosPhoneRequestFlowState('layout-audit', { resetScroll: false }), true);
  assert.deepEqual(calls.cancel, [], 'style cleanup must not cancel a chunk render still filling the visible list');
  assert.deepEqual(clearedClasses, ['performance-windowed-list']);
  assert.equal(windowedList.style.minHeight, '');
  assert.equal(calls.sticky.length, 1);

  const fastBack = extractFunction(html, 'fastBackToView', 'function fastBackHome(');
  const switchView = extractFunction(html, 'switchView', 'function getVisibleSecondaryBack(');
  const renderMarkup = extractFunction(html, 'applyRequestRenderMarkup', 'function renderRequestQueueFallbackCard(');
  assert.match(fastBack, /cancelChunkRenderWorkForView\(currentViewId\)/);
  assert.match(fastBack, /cancelChunkRenderWorkForView\(nextViewId\)/);
  assert.match(switchView, /cancelChunkRenderWorkForView\(currentViewId\)/);
  assert.match(switchView, /cancelChunkRenderWorkForView\(nextViewId\)/);
  assert.match(renderMarkup, /cancelChunkRenderWorkForView\('request'\)/,
    'replacing Request markup must still cancel the prior chunk job');
});

function productionRefreshSchedulerFixture({ view = 'request', viewState = 'loading', verified = true } = {}) {
  const scheduled = [];
  const ctx = {
    window: { AgMetricLiveSyncRegistry: { views: { [view]: { kind: 'module' } } } },
    VIEW_LOAD_UI: { request: { container: 'request-content' }, drive: { container: 'drive-content' } },
    document: { getElementById: () => ({}) },
    productionLiveSyncRenderGeneration: 0,
    productionLiveSyncRenderPending: false,
    productionLiveSyncVerifiedView: verified ? 'verified-context' : 'different-context',
    getCurrentVisibleViewId: () => view,
    productionVerifiedViewKey: () => 'verified-context',
    getContainerUiState: () => viewState,
    canUseProductionLiveSync: () => true,
    scheduleTypingAwareUiRender: (...args) => scheduled.push(args),
    scheduled
  };
  // A distinct verified key simulates a Request route without current proof.
  if (!verified) ctx.productionVerifiedViewKey = () => 'unverified-context';
  vm.createContext(ctx);
  const fn = extractFunction(html, 'scheduleProductionLiveSyncRender', 'function retainAppliedProductionDisplay(');
  vm.runInContext(fn, ctx);
  return { ctx, scheduled };
}

test('verified Request first display may bypass navigation grace without weakening interaction protections', () => {
  const firstRequest = productionRefreshSchedulerFixture({ view: 'request', viewState: 'loading', verified: true });
  firstRequest.ctx.scheduleProductionLiveSyncRender(false);
  const firstOptions = firstRequest.scheduled[0][4];
  assert.equal(firstOptions.allowDuringRecentInteraction, true);
  assert.equal(firstOptions.allowDuringRecentViewSwitch, true);
  assert.equal(firstOptions.deferUntilIdle, true);
  assert.equal(firstOptions.ignoreChunkDuringInteraction, true);
  for (const key of ['allowWhileTyping', 'allowDuringTouch', 'allowWhileScrolling']) {
    assert.equal(Object.hasOwn(firstOptions, key), false);
  }

  const casesThatRemainDeferred = [
    { view: 'request', viewState: 'loading', verified: false, options: {} },
    { view: 'drive', viewState: 'loading', verified: true, options: {} },
    { view: 'request', viewState: 'ready', verified: true, options: {} }
  ];
  for (const item of casesThatRemainDeferred) {
    const f = productionRefreshSchedulerFixture(item);
    f.ctx.scheduleProductionLiveSyncRender(false, item.options);
    assert.equal(f.scheduled[0][4].allowDuringRecentInteraction, false);
    assert.equal(f.scheduled[0][4].allowDuringRecentViewSwitch, false);
  }

  const cachedPreview = productionRefreshSchedulerFixture({ view: 'drive', viewState: 'loading', verified: false });
  cachedPreview.ctx.scheduleProductionLiveSyncRender(false, { cachedPreview: true });
  assert.equal(cachedPreview.scheduled[0][4].allowDuringRecentInteraction, true);
  assert.equal(cachedPreview.scheduled[0][4].allowDuringRecentViewSwitch, true);
  assert.equal(cachedPreview.scheduled[0][4].deferUntilIdle, true);
  assert.equal(cachedPreview.scheduled[0][4].ignoreChunkDuringInteraction, true);
});

test('anchor restoration avoids forced layout on the fallback and preserves offsets when a row remains', () => {
  const ctx = { getCurrentVisibleViewId: () => 'request', CSS: { escape: value => value } };
  vm.createContext(ctx);
  const restore = extractFunction(html, 'restoreProductionRefreshAnchor', 'function isProductionRefreshCurrent(');
  vm.runInContext(restore, ctx);

  const assignments = [];
  const fallbackScroller = {
    get scrollHeight() { throw new Error('fallback must not read scrollHeight'); },
    get clientHeight() { throw new Error('fallback must not read clientHeight'); },
    get scrollTop() { return 17; },
    set scrollTop(value) { assignments.push(value); }
  };
  ctx.restoreProductionRefreshAnchor({
    root: { isConnected: true }, scroller: fallbackScroller, view: 'request', top: 240, anchors: []
  });
  assert.deepEqual(assignments, [240], 'browser scrollTop assignment uses its native clamping behavior');

  const remainingAssignments = [];
  const card = { getBoundingClientRect: () => ({ top: 132 }) };
  const anchorRoot = { isConnected: true, querySelector: selector => selector === '[id="row-1"]' ? card : null };
  const anchoredScroller = {
    getBoundingClientRect: () => ({ top: 100 }),
    get scrollTop() { return 42; },
    set scrollTop(value) { remainingAssignments.push(value); }
  };
  ctx.restoreProductionRefreshAnchor({
    root: anchorRoot,
    scroller: anchoredScroller,
    view: 'request',
    top: 42,
    anchors: [{ attribute: 'id', value: 'row-1', offset: 12 }]
  });
  assert.deepEqual(remainingAssignments, [62], 'a surviving row restores its prior viewport offset');

  const scheduler = extractFunction(html, 'scheduleProductionLiveSyncRender', 'function retainAppliedProductionDisplay(');
  assert.match(scheduler, /!refresh\.retainedRequestList\) restoreProductionRefreshAnchor\(anchor\)/,
    'the exact unchanged Request list retained in the staging helper skips redundant anchor measurement');
});
