// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('navigation captures outgoing scroll after repair and before layout writes', () => {
  const start = html.indexOf('function switchView(viewId, options = {})');
  const switchSource = html.slice(start, html.indexOf('lastViewSwitchAt = Date.now();', start));
  const capture = switchSource.indexOf('const rememberCurrentView =');
  const teardown = switchSource.indexOf("if (currentViewId === 'managers' && nextViewId !== 'managers') destroyManagerAssignedItemsView();");
  assert.ok(capture > switchSource.indexOf('lastGuardedViewSwitchAt = switchNow;'));
  assert.ok(capture > switchSource.indexOf('repairAppShellScrollState('));
  assert.ok(capture > switchSource.indexOf("clearIosPhoneRequestFlowState('request-switch-start'"));
  assert.ok(capture < teardown && capture < switchSource.indexOf('syncCurrentViewBodyClass(nextViewId)'));
  assert.match(switchSource.slice(teardown), /if \(rememberCurrentView\)\s*\{\s*pushViewHistoryEntry\(currentViewId, historyScroll\)/);
  assert.doesNotMatch(switchSource.slice(teardown), /getMainAreaScrollTop\(\)/);

  const captureSource = switchSource.slice(capture, teardown);
  for (const [currentViewId, nextViewId, fromHistory, activeHomeTab, expected, mainReads, managerReads] of [
    ['drive', 'request', false, '', 123, 1, 0],
    ['managers', 'reports', false, 'assigned-items', 456, 0, 1],
    ['managers', 'reports', false, 'dashboard', 123, 1, 0],
    ['request', 'request', false, '', null, 0, 0],
    ['detail', 'request', false, '', null, 0, 0],
    ['drive', 'request', true, '', null, 0, 0]
  ]) {
    let mainCount = 0, managerCount = 0;
    const context = { currentViewId, nextViewId, fromHistory, activeHomeTab,
      MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW: 'assigned-items',
      getMainAreaScrollTop: () => { mainCount++; return 123; },
      getManagerAssignedColumnState: () => { managerCount++; return { scroll: 456 }; }
    };
    vm.createContext(context);
    assert.equal(vm.runInContext(`${captureSource}\nhistoryScroll`, context), expected);
    assert.equal(mainCount, mainReads);
    assert.equal(managerCount, managerReads);
  }
});

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

function trackedClassList(initial = []) {
  const values = new Set(initial);
  const writes = [];
  return {
    values,
    writes,
    contains: value => values.has(value),
    add(value) { writes.push(['add', value]); values.add(value); },
    remove(value) { writes.push(['remove', value]); values.delete(value); },
    toggle(value, force) {
      writes.push(['toggle', value, force]);
      if (force) values.add(value); else values.delete(value);
      return !!force;
    },
    [Symbol.iterator]: () => values[Symbol.iterator]()
  };
}

function pendingRequestReuseFixture() {
  const rows = [
    { id: 'req-1', UNIQUE_ID: 'req-1', LOCATIONCODE: 'A1', label: 'First' },
    { id: 'req-2', UNIQUE_ID: 'req-2', LOCATIONCODE: 'A2', label: 'Second' }
  ];
  const cardNodes = [{ uid: 'req-1' }, { uid: 'req-2' }];
  const footer = { outerHTML: '<div class="browse-page-footer">Page 1 of 1</div>', textContent: 'Page 1 of 1' };
  const container = {
    dataset: {},
    signature: '',
    classList: { contains: () => false },
    querySelectorAll: selector => selector === '[data-request-uid]' ? cardNodes : [],
    querySelector: selector => selector === '.browse-page-footer' ? footer : null
  };
  const context = {
    key: 'verified-request-context',
    view: 'request',
    visible: true,
    online: true,
    scope: 'profile:test-user',
    dataPermissionVersion: 'permission-1',
    surfaces: ['request:pending'],
    adapters: [{ id: 'core:requests', sourceKeys: ['ph_active_request'] }]
  };
  const ctx = {
    ACTIVE_REQUEST_TABLE: 'ph_active_request',
    activeReqTab: 'pending',
    selectedReqStatus: 'Pending',
    normalizeRequestTabValue: value => String(value || ''),
    currentUser: 'test-user',
    currentRole: 'admin',
    currentUserDivision: '10',
    requestsInventory: rows,
    rows,
    selectedItems: new Set(),
    isMultiSelectMode: false,
    chunkRenderActivityByKey: Object.create(null),
    completedPendingRequestRender: null,
    requestBrowseFooterMarkup: new WeakMap(),
    productionLiveSyncVerifiedView: context.key,
    document: {
      activeElement: { matches: () => false },
      getElementById: id => id === 'request-content' ? container : null
    },
    canUseProductionLiveSync: () => true,
    getProductionLiveSyncContext: () => context,
    productionVerifiedViewKey: () => context.key,
    captureRequestViewState: () => ({ tab: ctx.activeReqTab, status: ctx.selectedReqStatus, page: ctx.pageIndex || 0 }),
    buildSelectionStateKey: values => [...values].sort().join('|'),
    getCurrentVisibleViewId: () => 'request',
    hasProductionLiveSyncDraft: () => false,
    getScopedRequestItems: values => values,
    reconcileRequestDrillState: values => ({ changed: false, items: values }),
    isRequestPendingVisible: () => true,
    isRegularRequestQueueItem: () => true,
    buildRequestChunkRenderKey: (_mode, _crumb, items) => items.map(item => `${item.id}:${item.label}`).join('|'),
    getClientBrowsePage: (_view, key, items) => ({
      key, rows: ctx.visibleRows || items, pageIndex: ctx.pageIndex || 0
    }),
    renderClientBrowsePageFooter: (_view, _key, _total, page) => `<div class="browse-page-footer">Page ${Number(page.pageIndex) + 1} of 1</div>`,
    normalizeRenderSignature: value => value,
    getContainerRenderSignature: element => element.signature,
    getContainerUiState: () => 'content',
    getContainerChunkRenderKey: element => String(element.dataset.activeChunkRenderKey || ''),
    currentContainer: container
  };
  vm.createContext(ctx);
  vm.runInContext([
    'let requestLocationCollator = null;',
    extractFunction(html, 'compareRequestLocationCodes', 'function buildPendingRequestRenderPlan('),
    extractFunction(html, 'buildPendingRequestRenderPlan', 'function getRequestPendingReuseContextSnapshot('),
    extractFunction(html, 'getRequestPendingReuseContextSnapshot', 'function rememberCompletedPendingRequestRender('),
    extractFunction(html, 'rememberCompletedPendingRequestRender', 'function syncRequestRenderChrome()'),
    extractFunction(html, 'canReuseCompletedPendingRequestRender', 'function cancelProductionRefresh(')
  ].join('\n'), ctx);
  const plan = ctx.buildPendingRequestRenderPlan(rows);
  ctx.plan = plan;
  container.signature = plan.renderSignature;
  footer.outerHTML = plan.footerMarkup;
  ctx.requestBrowseFooterMarkup.set(footer, plan.footerMarkup);
  const snapshot = ctx.getRequestPendingReuseContextSnapshot();
  assert.equal(ctx.rememberCompletedPendingRequestRender(container, plan, snapshot), true);
  return { ctx, context, container, rows, plan, cardNodes, footer };
}

test('home dashboard mode avoids viewport reads away from Home and preserves Home fit scheduling', () => {
  const offHomeClasses = trackedClassList(['hidden']);
  const offHomeBody = { classList: trackedClassList() };
  let widthReads = 0;
  const offHome = {
    document: {
      body: offHomeBody,
      getElementById: id => id === 'view-home' ? { classList: offHomeClasses }
        : id === 'home-rep-dashboard-modules' ? { classList: trackedClassList(['hidden']) }
          : id === 'home-dynamic-content' ? { childElementCount: 0 }
            : { classList: trackedClassList() }
    },
    window: Object.defineProperty({}, 'innerWidth', { get() { widthReads++; throw new Error('off-Home path must not read viewport width'); } }),
    scheduleHomeDashboardFit: () => { throw new Error('off-Home path must not schedule Home fit'); }
  };
  vm.createContext(offHome);
  vm.runInContext(extractFunction(html, 'syncHomeDashboardBodyMode', 'function syncCurrentViewBodyClass('), offHome);
  assert.equal(offHome.syncHomeDashboardBodyMode(), false);
  assert.equal(widthReads, 0);
  assert.deepEqual(offHomeBody.classList.writes, [['toggle', 'home-dashboard-mode', false]]);

  let fitCalls = 0;
  const home = {
    document: {
      body: { classList: trackedClassList() },
      getElementById: id => id === 'view-home' ? { classList: trackedClassList() }
        : id === 'home-rep-dashboard-modules' ? { classList: trackedClassList() }
          : id === 'home-dynamic-content' ? { childElementCount: 0 }
            : { classList: trackedClassList() }
    },
    window: { innerWidth: 1200 },
    scheduleHomeDashboardFit: reason => { assert.equal(reason, 'home-dashboard-mode'); fitCalls++; }
  };
  vm.createContext(home);
  vm.runInContext(extractFunction(html, 'syncHomeDashboardBodyMode', 'function syncCurrentViewBodyClass('), home);
  assert.equal(home.syncHomeDashboardBodyMode(), true);
  assert.equal(home.document.body.classList.values.has('home-dashboard-mode'), true);
  assert.equal(fitCalls, 1);
  assert.equal(home.syncHomeDashboardBodyMode(false), true);
  assert.equal(fitCalls, 1, 'schedule=false keeps the Home layout decision without scheduling another fit');
});

test('current view body sync leaves matching classes and dataset untouched, repairing only stale view classes', () => {
  const classes = trackedClassList(['current-view-request', 'shell-state']);
  let datasetWrites = 0;
  const dataset = { currentView: 'request' };
  Object.defineProperty(dataset, 'currentView', {
    get() { return this.value ?? 'request'; },
    set(value) { datasetWrites++; this.value = value; },
    configurable: true
  });
  let dashboardSyncs = 0;
  const ctx = {
    document: { body: { classList: classes, dataset } },
    getCurrentVisibleViewId: () => 'request',
    syncHomeDashboardBodyMode: () => { dashboardSyncs++; }
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(html, 'syncCurrentViewBodyClass', 'function showOnlyPrimaryView('), ctx);
  ctx.syncCurrentViewBodyClass('request');
  assert.deepEqual(classes.writes, []);
  assert.equal(datasetWrites, 0);
  assert.equal(dashboardSyncs, 1);

  classes.values.add('current-view-drive');
  dataset.value = 'drive';
  datasetWrites = 0;
  classes.writes.length = 0;
  ctx.syncCurrentViewBodyClass('request');
  assert.deepEqual(classes.writes, [['remove', 'current-view-drive']]);
  assert.deepEqual([...classes.values].sort(), ['current-view-request', 'shell-state']);
  assert.equal(datasetWrites, 1);
  assert.equal(dataset.value, 'request');
  assert.equal(dashboardSyncs, 2);

  classes.values.add('current-view-request');
  classes.values.add('shell-state');
  classes.values.delete('current-view-drive');
  classes.writes.length = 0;
  datasetWrites = 0;
  ctx.getCurrentVisibleViewId = () => 'drive';
  ctx.syncCurrentViewBodyClass('drive');
  assert.deepEqual(classes.writes, [['remove', 'current-view-request'], ['add', 'current-view-drive']]);
  assert.deepEqual([...classes.values].sort(), ['current-view-drive', 'shell-state']);
  assert.equal(datasetWrites, 1);
  assert.equal(dataset.value, 'drive');
  assert.equal(dashboardSyncs, 3);
});

function renderSignatureFixture(overrides = {}) {
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
  ctx.getRequestAssignedRep = item => String(item.REQUESTED_BY || item.SALESREPNAME || item.SALESREP || item.SALESREPID || 'Unknown Rep').trim() || 'Unknown Rep';
  ctx.normalizeCardQuantityValue = value => String(value == null ? '' : value).trim() || '0';
  ctx.formatLocPhotoMatchQtyValue = item => item.LOC_MATCH_QTY == null ? 'Not verified' : String(item.LOC_MATCH_QTY);
  ctx.getCardLocationOnHandValue = item => item.LOC_ON_HAND_TOTAL ?? null;
  Object.assign(ctx, overrides);
  vm.createContext(ctx);
  const fn = extractFunction(html, 'buildRequestItemRenderSignature', 'function buildRequestChunkRenderKey(');
  vm.runInContext(fn, ctx);
  return ctx.buildRequestItemRenderSignature;
}

function liveRequestSignatureFixture() {
  const firstNonEmptyValue = (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '';
  const ctx = {
    firstNonEmptyValue,
    normalizeRequestStatus: value => String(value || '').trim().toLowerCase(),
    getRequestAssignedRep: item => String(item.REQUESTED_BY || item.SALESREPNAME || item.SALESREP || item.SALESREPID || 'Unknown Rep').trim() || 'Unknown Rep',
    getRequestDesiredSpecValue: () => '',
    getRequestDesiredCaliperValue: () => '',
    getRequestEditableCommentsValue: () => '',
    getRequestRowNoteValue: () => '',
    getMoveRequestRowBatchId: () => '',
    getMoveRequestRowStage: () => '',
    getRequestDeliveryStatus: () => '',
    formatLocPhotoMatchQtyValue: item => item.LOC_MATCH_QTY == null ? 'Not verified' : String(item.LOC_MATCH_QTY),
    normalizeCardQuantityValue: value => String(value == null ? '' : value).trim() || '0',
    getCardLocationOnHandValue: item => item.LOC_ON_HAND_TOTAL ?? null
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(html, 'buildRequestLiveSyncSignature', 'function normalizeRequestIdList('), ctx);
  return ctx.buildRequestLiveSyncSignature;
}

test('request signatures resolve owned photos once and skip dates only for empty links', () => {
  const calls = { photos: 0, dates: 0 };
  const signature = renderSignatureFixture({
    getRowPhotoLink(item, view) {
      assert.equal(view, 'request');
      calls.photos++;
      return item.REQ_PHOTO_LINK || '';
    },
    getRowPhotoDateLabel(item, view, link) {
      assert.equal(view, 'request');
      assert.equal(link, item.REQ_PHOTO_LINK);
      assert.ok(link);
      calls.dates++;
      return item.PHOTO_DATE || '';
    }
  });
  const row = { UNIQUE_ID: 'r-1', REQ_PHOTO_LINK: '' };
  const empty = signature(row);
  assert.deepEqual(calls, { photos: 1, dates: 0 });
  row.REQ_PHOTO_LINK = 'https://example.test/request.jpg';
  row.PHOTO_DATE = 'Oct 8';
  const photographed = signature(row);
  assert.notEqual(photographed, empty);
  assert.deepEqual(calls, { photos: 2, dates: 1 });
  row.PHOTO_DATE = 'Oct 9';
  assert.notEqual(signature(row), photographed, 'fresh date values still invalidate the signature');
  row.REQ_PHOTO_LINK = '';
  assert.equal(signature(row), empty, 'removed or expired photos do not retain a cached date');
  assert.deepEqual(calls, { photos: 4, dates: 2 });
});

test('request and dock photo lookups do not evaluate unused shared inventory photos', () => {
  const calls = { shared: 0, request: 0, dock: 0 };
  const row = { REQ_PHOTO_LINK: 'request-owned', DOCK_PHOTO_LINK: 'dock-owned' };
  const ctx = {
    getSharedAppPhotoLinkCsv(item) { assert.equal(item, row); calls.shared++; return 'retained-shared'; },
    getRequestPhotoLinkCsv(item) { calls.request++; return item.REQ_PHOTO_LINK; },
    getDockOwnedPhotoLinkCsv(item) { calls.dock++; return item.DOCK_PHOTO_LINK; },
    shouldPreferFlyerOwnedFields: () => false
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(html, 'getRowPhotoLink', 'function extractPhotoDateIsoFromText_('), ctx);
  assert.equal(ctx.getRowPhotoLink(row, ' Request '), 'request-owned');
  assert.equal(ctx.getRowPhotoLink(row, 'DOCKS'), 'dock-owned');
  assert.deepEqual(calls, { shared: 0, request: 1, dock: 1 });
  row.REQ_PHOTO_LINK = '';
  assert.equal(ctx.getRowPhotoLink(row, 'request'), '', 'empty owned photos never borrow shared photos');
  assert.equal(ctx.getRowPhotoLink(row, 'av'), 'retained-shared');
  assert.equal(ctx.getRowPhotoLink(row, ''), 'retained-shared');
  assert.deepEqual(calls, { shared: 2, request: 2, dock: 1 });
  assert.equal(ctx.getRowPhotoLink(null, 'request'), '');
});

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
    CUSTOMERNAME: 'Customer Display', CONSIGNEENAME: 'Garden Center', SALESREPNAME: 'Rep Display',
    REQ_CALIPER: '0.75 in', LOC_MATCH_QTY: 6, LOC_ON_HAND_TOTAL: 18,
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
    { FIELDTAGCOLOR: 'Red' },
    { CUSTOMERNAME: 'Another Customer' },
    { CONSIGNEENAME: 'Another Consignee' },
    { REQ_CALIPER: '1.00 in' },
    { LOC_MATCH_QTY: 7 },
    { LOC_ON_HAND_TOTAL: 19 }
  ];
  for (const change of displayedChanges) {
    assert.notEqual(signature({ ...row, ...change }), original,
      `${Object.keys(change)[0]} changes a value rendered on the request card`);
  }
  const repFallbackRow = { ...row, REQUESTED_BY: '' };
  assert.notEqual(signature({ ...repFallbackRow, SALESREPNAME: 'Another Rep' }), signature(repFallbackRow),
    'the canonical assigned-rep fallback changes the rendered card when REQUESTED_BY is absent');
});

test('request live-sync signature tracks the customer and location details displayed on cards', () => {
  const signature = liveRequestSignatureFixture();
  const row = {
    UNIQUE_ID: 'request-live-1', REQ_STATUS: 'Pending', REQ_CUSTOMER: 'Customer',
    CUSTOMERNAME: 'Customer Display', CONSIGNEENAME: 'Garden Center', SALESREPNAME: 'Rep Display',
    REQ_CALIPER: '0.75 in', LOC_MATCH_QTY: 6, LOC_ON_HAND_TOTAL: 18
  };
  const original = signature([row]);
  assert.equal(signature([{ ...row }]), original, 'an unchanged row copy retains its signature');

  for (const change of [
    { CUSTOMERNAME: 'Another Customer' },
    { CONSIGNEENAME: 'Another Consignee' },
    { REQ_CALIPER: '1.00 in' },
    { LOC_MATCH_QTY: 7 },
    { LOC_ON_HAND_TOTAL: 19 }
  ]) {
    assert.notEqual(signature([{ ...row, ...change }]), original,
      `${Object.keys(change)[0]} changes a value displayed on the Request card`);
  }
  const repFallbackRow = { ...row, REQUESTED_BY: '' };
  assert.notEqual(signature([{ ...repFallbackRow, SALESREPNAME: 'Another Rep' }]), signature([repFallbackRow]),
    'the canonical assigned-rep fallback invalidates the live signature when REQUESTED_BY is absent');
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

test('Pending Request bounds its first paint while preserving iOS pacing and completion contracts', () => {
  let ios = false;
  let level = 0;
  const ctx = {
    isIosPhoneRequestFlowView: view => { assert.equal(view, 'request'); return ios; },
    getAdaptivePerformanceLevel: () => level,
    IOS_CHUNK_SYNC_ROW_LIMIT: 24,
    renderRequestQueueFallbackCard: () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(html, 'getRequestChunkRenderOptions', 'function getApprovedMoveRequestRowsForCurrentUser('), ctx);
  const onComplete = () => {};
  const input = { renderSignature: 'all-rows-signature:page:0', onComplete };
  const desktop = ctx.getPendingRequestChunkRenderOptions(input);
  assert.equal(desktop.initialRows, 8);
  assert.equal(desktop.renderSignature, input.renderSignature);
  assert.equal(desktop.onComplete, onComplete);
  assert.equal(desktop.onCompleteAfterInteractive, true);
  assert.equal(desktop.onCompleteDelayMs, 140);
  assert.equal(ctx.getRequestChunkRenderOptions(input).initialRows, undefined, 'other Request subviews keep their existing first batch');
  assert.equal(ctx.getPendingRequestChunkRenderOptions({ initialRows: 3 }).initialRows, 3, 'explicit pacing remains authoritative');
  ios = true;
  const phone = ctx.getPendingRequestChunkRenderOptions(input);
  assert.equal(phone.initialRows, 6);
  assert.equal(phone.iosSyncRowLimit, 80);
  assert.equal(phone.verifyRowSelector, '[data-request-uid]');
  assert.equal(phone.completionDeadlineMs, 1200);
  level = 2;
  assert.equal(ctx.getPendingRequestChunkRenderOptions(input).initialRows, 4);
  assert.equal(input.initialRows, undefined, 'caller options are not mutated');
});

function productionListFixture({ key = 'request-main', tab = 'pending', signature = 'same', rowCount = 2 } = {}) {
  const calls = { crumb: [], complete: 0, staged: [], created: 0, classes: [], capture: 0, restore: 0, replaced: 0 };
  const container = {
    dataset: {},
    querySelectorAll: selector => ({ length: selector === '[data-request-uid]' ? rowCount : 0 }),
    classList: { add: value => calls.classes.push(value) },
    replaceChildren: () => { calls.replaced++; },
    isConnected: true
  };
  const refresh = { pending: 0, containers: new Set() };
  const ctx = {
    productionLiveSyncActiveRender: refresh,
    activeReqTab: tab,
    document: { createElement: () => { calls.created++; return { childNodes: [], querySelectorAll: () => ({ length: 0 }) }; } },
    chunkRenderTokensByKey: Object.create(null),
    getContainerChunkRenderKey: element => String(element?.dataset?.activeChunkRenderKey || ''),
    clearContainerChunkRenderState(element, key, token) {
      if (element.dataset.activeChunkRenderKey !== key
        || Number(element.dataset.activeChunkRenderToken) !== Number(token)) return;
      delete element.dataset.activeChunkRenderKey;
      delete element.dataset.activeChunkRenderToken;
    },
    normalizeRenderSignature: value => String(value).trim(),
    getContainerRenderSignature: () => signature,
    setContainerRenderSignature: () => {},
    syncRequestCrumb: (...args) => calls.crumb.push(args),
    renderMarkupChunkedByKey: (...args) => {
      calls.staged.push(args);
      const key = String(args[0] || '');
      ctx.chunkRenderTokensByKey[key] = Number(ctx.chunkRenderTokensByKey[key] || 0) + 1;
      return 'staged';
    },
    scheduleTypingAwareUiRender: (_key, callback) => callback(),
    isProductionRefreshCurrent: () => true,
    captureProductionRefreshAnchor: () => { calls.capture++; return { view: 'request' }; },
    restoreProductionRefreshAnchor: () => { calls.restore++; },
    finishProductionRefresh: () => {},
    calls
  };
  vm.createContext(ctx);
  const helper = extractFunction(html, 'clearSupersededContainerChunkState', 'function stageProductionRefreshList(');
  const source = extractFunction(html, 'stageProductionRefreshList', 'function cancelProductionRefresh(');
  vm.runInContext(`${helper}\n${source}`, ctx);
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

test('staged commit retires only the superseded original-container chunk marker', () => {
  const helper = extractFunction(html, 'clearSupersededContainerChunkState', 'function stageProductionRefreshList(');
  const ctx = {
    chunkRenderTokensByKey: { 'request-main': 8 },
    getContainerChunkRenderKey: container => String(container.dataset.activeChunkRenderKey || ''),
    clearContainerChunkRenderState(container, key, token) {
      if (container.dataset.activeChunkRenderKey !== key
        || Number(container.dataset.activeChunkRenderToken) !== Number(token)) return;
      delete container.dataset.activeChunkRenderKey;
      delete container.dataset.activeChunkRenderToken;
    }
  };
  vm.createContext(ctx);
  vm.runInContext(helper, ctx);

  const superseded = { dataset: { activeChunkRenderKey: 'request-main', activeChunkRenderToken: '7' } };
  assert.equal(ctx.clearSupersededContainerChunkState(superseded, 'request-main', {
    key: 'request-main', token: 7
  }, 8), true, 'a canceled old callback may leave its dataset marker after the staged token supersedes it');
  assert.equal(superseded.dataset.activeChunkRenderKey, undefined);
  assert.equal(superseded.dataset.activeChunkRenderToken, undefined);

  const newerGlobalToken = { dataset: { activeChunkRenderKey: 'request-main', activeChunkRenderToken: '7' } };
  ctx.chunkRenderTokensByKey['request-main'] = 9;
  assert.equal(ctx.clearSupersededContainerChunkState(newerGlobalToken, 'request-main', {
    key: 'request-main', token: 7
  }, 8), false, 'a later chunk generation is never retired by this staged commit');
  assert.equal(newerGlobalToken.dataset.activeChunkRenderToken, '7');

  const replacedContainerState = { dataset: { activeChunkRenderKey: 'request-main', activeChunkRenderToken: '8' } };
  ctx.chunkRenderTokensByKey['request-main'] = 8;
  assert.equal(ctx.clearSupersededContainerChunkState(replacedContainerState, 'request-main', {
    key: 'request-main', token: 7
  }, 8), false, 'a different container token is preserved');
  assert.equal(replacedContainerState.dataset.activeChunkRenderToken, '8');

  const stage = extractFunction(html, 'stageProductionRefreshList', 'function cancelProductionRefresh(');
  const currentGuard = stage.indexOf('if (!isProductionRefreshCurrent(refresh) || !container.isConnected) return;');
  const retireMarker = stage.indexOf('clearSupersededContainerChunkState(container, key, supersededChunkState, stagedChunkToken)');
  const commitRows = stage.indexOf('container.replaceChildren(...staged.childNodes)');
  assert.ok(currentGuard >= 0 && retireMarker > currentGuard && commitRows > retireMarker,
    'only the current staged commit retires its captured prior marker before replacing the original list');
});

test('request crumb compares textContent and writes innerText only when content changes', () => {
  const sync = extractFunction(html, 'syncRequestCrumb', 'function applyRequestRenderMarkup(');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(sync, ctx);

  let writes = 0;
  const unchanged = {
    textContent: 'Pending requests',
    get innerText() { throw new Error('innerText read forces layout'); },
    set innerText(_value) { writes++; }
  };
  ctx.syncRequestCrumb(unchanged, 'Pending requests');
  assert.equal(writes, 0);

  const changed = {
    textContent: 'Old label',
    get innerText() { throw new Error('innerText read forces layout'); },
    set innerText(value) { writes++; this.written = value; }
  };
  ctx.syncRequestCrumb(changed, 'Updated label');
  assert.equal(writes, 1);
  assert.equal(changed.written, 'Updated label');
  ctx.syncRequestCrumb(null, 'Ignored');
  assert.equal(writes, 1);
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
    if (key === 'request-main' && item.tab !== 'completed') {
      f.calls.staged[0][6].onComplete();
      assert.equal(f.calls.capture, 1, 'changed Pending Request rows capture at commit time');
      assert.equal(f.calls.restore, 1, 'changed Pending Request rows restore at commit time');
      assert.equal(f.calls.replaced, 1);
    }
    assert.equal(f.refresh.pending, key === 'request-main' && item.tab !== 'completed' ? 0 : 1);
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

function productionRefreshSchedulerFixture({ view = 'request', viewState = 'loading', tab = 'pending', verified = true } = {}) {
  const scheduled = [];
  const calls = { capture: 0, restore: 0, render: 0, finish: 0 };
  const ctx = {
    window: { AgMetricLiveSyncRegistry: { views: { [view]: { kind: 'module' } } } },
    VIEW_LOAD_UI: { request: { container: 'request-content' }, drive: { container: 'drive-content' } },
    document: { hidden: false, activeElement: null, getElementById: () => ({}) },
    productionLiveSyncRenderGeneration: 0,
    productionLiveSyncRenderPending: false,
    productionLiveSyncRendering: false,
    productionLiveSyncActiveRender: null,
    productionLiveSyncDraftChanged: false,
    productionLiveSyncVerifiedView: verified ? 'verified-context' : 'different-context',
    productionLiveSyncCoordinator: { getStatus: () => ({}) },
    activeReqTab: tab,
    latestViewRenderTokensByView: { [view]: 1 },
    getCurrentVisibleViewId: () => view,
    productionVerifiedViewKey: () => 'verified-context',
    getContainerUiState: () => viewState,
    canUseProductionLiveSync: () => true,
    hasProductionLiveSyncDraft: () => false,
    scheduleTypingAwareUiRender: (key, callback, ...args) => scheduled.push([key, callback, ...args]),
    captureProductionRefreshAnchor: () => { calls.capture++; return { view }; },
    restoreProductionRefreshAnchor: () => { calls.restore++; },
    isProductionRefreshCurrent: () => true,
    canReuseCompletedPendingRequestRender: () => false,
    bumpLatestViewRenderToken: () => 1,
    markViewDirty: () => {},
    renderViewContent: () => { calls.render++; },
    finishProductionRefresh: () => { calls.finish++; },
    cancelProductionRefresh: () => {},
    calls,
    scheduled
  };
  // A distinct verified key simulates a Request route without current proof.
  if (!verified) ctx.productionVerifiedViewKey = () => 'unverified-context';
  vm.createContext(ctx);
  const fn = extractFunction(html, 'scheduleProductionLiveSyncRender', 'function retainAppliedProductionDisplay(');
  vm.runInContext(fn, ctx);
  return { ctx, scheduled, calls };
}

test('verified Request first display may bypass navigation grace without weakening interaction protections', () => {
  const firstRequest = productionRefreshSchedulerFixture({ view: 'request', viewState: 'loading', verified: true });
  firstRequest.ctx.scheduleProductionLiveSyncRender(false);
  const firstOptions = firstRequest.scheduled[0][4];
  assert.equal(firstOptions.allowDuringRecentInteraction, true);
  assert.equal(firstOptions.allowDuringRecentViewSwitch, true);
  assert.equal(firstOptions.deferUntilIdle, true);
  assert.equal(firstOptions.ignoreChunkDuringInteraction, true);
  firstRequest.scheduled[0][1]();
  assert.equal(firstRequest.calls.capture, 0, 'Pending Request defers anchor work to the row commit');
  assert.equal(firstRequest.calls.restore, 0);
  for (const key of ['allowWhileTyping', 'allowDuringTouch', 'allowWhileScrolling']) {
    assert.equal(Object.hasOwn(firstOptions, key), false);
  }

  const casesThatRemainDeferred = [
    { view: 'request', viewState: 'loading', verified: false, options: {} },
    { view: 'drive', viewState: 'loading', verified: true, options: {} },
    { view: 'request', viewState: 'ready', tab: 'completed', verified: true, options: {} }
  ];
  for (const item of casesThatRemainDeferred) {
    const f = productionRefreshSchedulerFixture(item);
    f.ctx.scheduleProductionLiveSyncRender(false, item.options);
    assert.equal(f.scheduled[0][4].allowDuringRecentInteraction, false);
    assert.equal(f.scheduled[0][4].allowDuringRecentViewSwitch, false);
    if (item.view === 'request' && item.viewState === 'ready') {
      f.scheduled[0][1]();
      assert.equal(f.calls.capture, 1, 'other Request tabs retain the outer anchor');
      assert.equal(f.calls.restore, 1);
    }
  }

  const cachedPreview = productionRefreshSchedulerFixture({ view: 'drive', viewState: 'loading', verified: false });
  cachedPreview.ctx.scheduleProductionLiveSyncRender(false, { cachedPreview: true });
  assert.equal(cachedPreview.scheduled[0][4].allowDuringRecentInteraction, true);
  assert.equal(cachedPreview.scheduled[0][4].allowDuringRecentViewSwitch, true);
  assert.equal(cachedPreview.scheduled[0][4].deferUntilIdle, true);
  assert.equal(cachedPreview.scheduled[0][4].ignoreChunkDuringInteraction, true);
});

test('Pending Request refresh keeps commit anchoring and skips outer anchoring for empty or cancelled renders', () => {
  const source = extractFunction(html, 'scheduleProductionLiveSyncRender', 'function retainAppliedProductionDisplay(');
  assert.match(source, /view === 'request' && activeReqTab === 'pending'\s*\? null : captureProductionRefreshAnchor\(view\)/,
    'only Pending Request defers anchor capture; the staged commit still captures its own anchor');
  const stage = extractFunction(html, 'stageProductionRefreshList', 'function cancelProductionRefresh(');
  assert.match(stage, /const anchor = captureProductionRefreshAnchor\(refresh\.view\)/);
  assert.match(stage, /restoreProductionRefreshAnchor\(anchor\)/);
  const renderRequest = extractFunction(html, 'renderRequest', 'function createRequestSwipeState(');
  assert.match(renderRequest, /if\s*\(plan\.empty\)/);
  assert.match(renderRequest, /applyRequestRenderMarkup\(container, crumb, crumbText, `<div[^`]*No pending requests\./,
    'empty Pending Request results use the synchronous markup fallback, which relies on native scroll clamping');

  const cancelled = productionRefreshSchedulerFixture();
  cancelled.ctx.scheduleProductionLiveSyncRender(false);
  cancelled.ctx.getCurrentVisibleViewId = () => 'home';
  cancelled.scheduled[0][1]();
  assert.equal(cancelled.calls.capture, 0, 'a navigation-cancelled refresh performs no anchor scan');
  assert.equal(cancelled.calls.render, 0);
});

test('native verified Pending refresh reuses only the exact completed body contract', () => {
  const fixture = pendingRequestReuseFixture();
  const { ctx, context, rows, container, cardNodes, footer } = fixture;
  assert.equal(ctx.canReuseCompletedPendingRequestRender(context.key), true);

  const rejects = mutation => {
    const next = pendingRequestReuseFixture();
    mutation(next);
    assert.equal(next.ctx.canReuseCompletedPendingRequestRender(next.context.key), false);
  };
  rejects(({ rows: changed }) => { changed[0].label = 'A changed visible field'; });
  rejects(({ context: changed }) => { changed.scope = 'profile:other-user'; });
  rejects(({ context: changed }) => { changed.dataPermissionVersion = 'permission-2'; });
  rejects(({ context: changed }) => { changed.visible = false; });
  rejects(({ context: changed }) => { changed.online = false; });
  rejects(({ context: changed }) => { changed.surfaces = ['request:bunch-notes']; });
  rejects(({ context: changed }) => { changed.adapters = []; });
  rejects(({ context: changed }) => { changed.adapters = [{ id: 'core:requests', sourceKeys: ['ph_other_table'] }]; });
  rejects(({ context: changed }) => { changed.key = 'a different adapter/view key'; });
  rejects(({ ctx: changed }) => { changed.activeReqTab = 'completed'; });
  rejects(({ ctx: changed }) => { changed.selectedReqStatus = 'Complete'; });
  rejects(({ ctx: changed }) => { changed.currentUser = 'other-user'; });
  rejects(({ ctx: changed }) => { changed.pageIndex = 1; });
  rejects(({ ctx: changed }) => { changed.selectedItems.add('req-1'); });
  rejects(({ ctx: changed }) => { changed.isMultiSelectMode = true; });
  rejects(({ ctx: changed }) => { changed.document.activeElement.matches = () => true; });
  rejects(({ container: changed }) => { changed.dataset.activeChunkRenderKey = 'request-main'; });
  rejects(({ container: changed }) => { changed.signature = 'stale-container-signature'; });
  rejects(({ cardNodes: changed }) => { changed[0] = { uid: 'replacement-node' }; });
  const decorated = pendingRequestReuseFixture();
  decorated.footer.outerHTML = `${decorated.footer.outerHTML.replace('class="browse-page-footer"', 'class="browse-page-footer ui-action"')}`;
  assert.equal(decorated.ctx.canReuseCompletedPendingRequestRender(decorated.context.key), true,
    'class-only framework decoration does not invalidate an authored footer');
  rejects(({ footer: changed }) => { changed.textContent = 'Different visible footer text'; });
  rejects(({ container: changed, footer: original, ctx: changedCtx, plan }) => {
    const replacement = { outerHTML: original.outerHTML, textContent: original.textContent };
    changedCtx.requestBrowseFooterMarkup.set(replacement, plan.footerMarkup);
    changed.querySelector = selector => selector === '.browse-page-footer' ? replacement : null;
  });
  rejects(({ footer: changed, ctx: changedCtx, plan }) => {
    changedCtx.requestBrowseFooterMarkup.set(changed, `${plan.footerMarkup} `);
  });
  fixture.rows[0].label = 'still matching';
  assert.equal(ctx.canReuseCompletedPendingRequestRender(context.key), false,
    'once the source rows change, the completed plan can no longer authorize DOM reuse');
  assert.ok(rows.length && container && cardNodes.length && footer);
});

test('Pending reuse is completed-render-only, keeps native scope out of shared legacy planning, and preserves chrome', () => {
  const plan = extractFunction(html, 'buildPendingRequestRenderPlan', 'function getRequestPendingReuseContextSnapshot(');
  assert.doesNotMatch(plan, /getProductionLiveSyncContext|canUseProductionLiveSync/,
    'the shared Pending plan remains usable by legacy rendering without requiring native sync');
  const remember = extractFunction(html, 'rememberCompletedPendingRequestRender', 'function syncRequestRenderChrome()');
  assert.match(remember, /options|contextSnapshot/);
  assert.match(remember, /cardNodes/);
  assert.match(remember, /getContainerRenderSignature/);

  const scheduler = extractFunction(html, 'scheduleProductionLiveSyncRender', 'function retainAppliedProductionDisplay(');
  const reuseAt = scheduler.indexOf('canReuseCompletedPendingRequestRender(contextKey)');
  const rendererAt = scheduler.indexOf('renderViewContent(view, false, true)');
  assert.ok(reuseAt >= 0 && rendererAt > reuseAt, 'the strict reuse gate runs before the full view renderer');
  assert.match(scheduler, /syncRequestRenderChrome\(\)/);
  assert.match(scheduler, /scheduleRequestRenderSideData\(\)/);
  assert.match(scheduler, /state\.dirty = false/);
  assert.match(scheduler, /finishProductionRefresh\(refresh\)/,
    'the verified refresh still completes and updates its freshness status');

  const labels = extractFunction(html, 'updateRequestTabButtonLabels', 'function getAuthorizedRequestCategories(');
  assert.match(labels, /syncRequestChromeMarkup\(element, nextHtml, requestTabLabelMarkupByNode\)/);
  const toolbar = extractFunction(html, 'renderRequestCategoryToolbar', 'let requestArchiveListState');
  assert.match(toolbar, /syncRequestChromeMarkup\(toolbar, nextHtml, requestCategoryToolbarMarkupByNode\)/);
});

test('Request chrome markup cache preserves decorated child nodes until authored markup changes', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFunction(html, 'syncRequestChromeMarkup', 'const requestTabLabelMarkupByNode'), ctx);
  const markupByNode = new WeakMap();
  const originalMarkup = '<span><span>Request</span><span class="ui-pill">4</span></span>';
  const root = { decorated: true };
  let innerHTML = originalMarkup;
  let writes = 0;
  const element = {
    get firstElementChild() { return root; },
    get innerHTML() { return innerHTML; },
    set innerHTML(value) { writes++; innerHTML = value; }
  };
  markupByNode.set(element, { markup: '<span><span>Request</span><span>4</span></span>', root });
  assert.equal(ctx.syncRequestChromeMarkup(element, '<span><span>Request</span><span>4</span></span>', markupByNode), false);
  assert.equal(writes, 0, 'decorated inner markup does not force a parent replacement');
  assert.equal(element.firstElementChild, root);

  assert.equal(ctx.syncRequestChromeMarkup(element, '<span><span>Request</span><span>5</span></span>', markupByNode), true);
  assert.equal(writes, 1, 'a changed count still refreshes the tab label');
  assert.equal(innerHTML, '<span><span>Request</span><span>5</span></span>');
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
