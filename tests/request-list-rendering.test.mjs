import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const locationCodeSource = readFileSync(new URL('../assets/location-code.js', import.meta.url), 'utf8');
function source(name) {
  const start = html.search(new RegExp(`        function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const next = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  assert.ok(next > 0, `${name} boundary`);
  return html.slice(start, start + next + 1);
}

function fixture() {
  const signatures = [];
  const pageKeys = [];
  const ctx = vm.createContext({
    signatures, pageKeys, pageIndex: 0,
    isRequestPendingVisible: () => true,
    isRegularRequestQueueItem: () => true,
    naturalCompare: (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' }),
    getItemUniqueId: row => row.UNIQUE_ID,
    buildRequestChunkRenderKey: (mode, crumb, rows) => {
      signatures.push(rows.length);
      return JSON.stringify([mode, crumb, rows.map(row => [row.UNIQUE_ID, row.label])]);
    },
    getClientBrowsePage: (_view, key, rows) => {
      pageKeys.push(key);
      const pageIndex = Math.min(ctx.pageIndex, Math.max(0, Math.ceil(rows.length / 100) - 1));
      return { key, pageIndex, rows: rows.slice(pageIndex * 100, (pageIndex + 1) * 100) };
    },
    renderClientBrowsePageFooter: (_view, _key, total, page) => `${page.pageIndex}:${total}`
  });
  vm.runInContext(locationCodeSource, ctx);
  vm.runInContext(source('compareLocationCodeValues'), ctx);
  for (const name of ['buildRequestBrowseMembershipKey', 'buildRequestPagedRenderPlan']) {
    if (html.includes(`function ${name}(`)) vm.runInContext(source(name), ctx);
  }
  vm.runInContext(source('buildPendingRequestRenderPlan'), ctx);
  return ctx;
}

const rows = (count) => Array.from({ length: count }, (_, i) => ({ UNIQUE_ID: `request-${i}`, LOCATIONCODE: String(i).padStart(5, '0'), label: `Row ${i}` }));

test('Suspend list sorts natural location first, then item, lot, dock and drop', () => {
  const ctx = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    getRequestSuspendTagDockFilterOptionForItem: row => ({ value: row.dock, label: row.dock })
  });
  for (const name of ['compareRequestSuspendTagDockOptions', 'compareLocationCodeValues', 'compareRequestSuspendTagRows', 'sortRequestSuspendTagRows']) {
    vm.runInContext(source(name), ctx);
  }
  const collators = { text: new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare,
    location: new Intl.Collator(undefined, { numeric: true }).compare };
  const data = [
    { id:'drop-10', LOCATIONCODE:'C.09.000', ITEMCODE:'004380.010.1', LOTCODE:'27.F1', dock:'Dock 10', drop:'Drop 10' },
    { id:'location-b', LOCATIONCODE:'B.04.000', ITEMCODE:'009373.031.1', LOTCODE:'27.F1', dock:'Dock 2', drop:'Drop 2' },
    { id:'location-0', LOCATIONCODE:'0.00.111', ITEMCODE:'000001.001.1', LOTCODE:'26.F1', dock:'Dock 10', drop:'Drop 10' },
    { id:'drop-2', LOCATIONCODE:'C.09.000', ITEMCODE:'004380.010.1', LOTCODE:'27.F1', dock:'Dock 2', drop:'Drop 2' },
    { id:'item-secondary', LOCATIONCODE:'C.09.000', ITEMCODE:'005666.021.1', LOTCODE:'27.F1', dock:'Dock 1', drop:'Drop 1' },
    { id:'lot-secondary', LOCATIONCODE:'C.09.000', ITEMCODE:'004380.010.1', LOTCODE:'27.F2', dock:'Dock 1', drop:'Drop 1' }
  ];
  const original = data.slice().sort((a, b) => ctx.compareRequestSuspendTagRows(a, b));
  const optimized = data.slice().sort((a, b) => ctx.compareRequestSuspendTagRows(a, b, collators));
  assert.deepEqual(optimized.map(row => row.id), original.map(row => row.id));
  assert.deepEqual(ctx.sortRequestSuspendTagRows(data, collators).map(row => row.id), optimized.map(row => row.id));
  assert.deepEqual(optimized.map(row => row.id), ['location-0','location-b','drop-2','drop-10','lot-secondary','item-secondary']);
});

test('Pending computes rich card signatures for only its 100-row page at production scale', () => {
  const ctx = fixture();
  const plan = ctx.buildPendingRequestRenderPlan(rows(9539));
  assert.equal(plan.items.length, 9539);
  assert.equal(plan.rows.length, 100);
  assert.deepEqual(ctx.signatures, [100]);
  assert.equal(plan.footerMarkup, '0:9539');
});

test('visible content changes invalidate the render while keeping the current page', () => {
  const ctx = fixture(); ctx.pageIndex = 2;
  const data = rows(350);
  const first = ctx.buildPendingRequestRenderPlan(data);
  data[201].label = 'Updated photo and quantity';
  const second = ctx.buildPendingRequestRenderPlan(data);
  assert.equal(second.pageIndex, 2);
  assert.equal(ctx.pageKeys[0], ctx.pageKeys[1]);
  assert.notEqual(first.renderSignature, second.renderSignature);
  assert.equal(second.rows[1], data[201]);
  data[0].label = 'Off-page update';
  assert.equal(ctx.buildPendingRequestRenderPlan(data).renderSignature, second.renderSignature);
});

test('membership keys track order and filters without delimiter collisions', () => {
  const ctx = fixture();
  const data = rows(2);
  const key = ctx.buildRequestBrowseMembershipKey('pending', data);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('suspend-tag', data), key);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('pending', [...data].reverse()), key);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('pending', [{ UNIQUE_ID: 'a|b' }, { UNIQUE_ID: 'c' }]),
    ctx.buildRequestBrowseMembershipKey('pending', [{ UNIQUE_ID: 'a' }, { UNIQUE_ID: 'b|c' }]));
});

test('Request chrome shares one queue-count snapshot across badge and tabs', () => {
  const calls = [];
  const counts = { pending: 2, 'suspend-tag': 1 };
  const ctx = vm.createContext({
    activeReqTab: 'pending', normalizeRequestTabValue: value => value,
    getRequestTabQueueCounts: () => { calls.push('counts'); return counts; },
    updateFooterRequestBadge: snapshot => calls.push(['badge', snapshot]),
    updateFooterChatBadge: () => calls.push('chat'),
    syncRequestTabButtons: snapshot => calls.push(['tabs', snapshot]),
    syncRequestHeaderSearchChrome: () => calls.push('search'),
  });
  vm.runInContext(source('syncRequestRenderChrome'), ctx);
  ctx.syncRequestRenderChrome();
  assert.deepEqual(calls, ['counts', ['badge', counts], 'chat', ['tabs', counts], 'search']);
});

test('Suspend render chrome reuses the already scoped queue snapshot', () => {
  const calls = [];
  const counts = { pending: 2, 'suspend-tag': 1 };
  const ctx = vm.createContext({
    activeReqTab: 'suspend-tag', normalizeRequestTabValue: value => value,
    getRequestTabQueueCounts: () => { calls.push('unexpected-count-scan'); return {}; },
    updateFooterRequestBadge: snapshot => calls.push(['badge', snapshot]),
    updateFooterChatBadge: () => calls.push('chat'),
    syncRequestTabButtons: snapshot => calls.push(['tabs', snapshot]),
    syncRequestHeaderSearchChrome: () => calls.push('search')
  });
  vm.runInContext(source('syncRequestRenderChrome'), ctx);
  ctx.syncRequestRenderChrome(counts);
  assert.deepEqual(calls, [['badge', counts], 'chat', ['tabs', counts], 'search']);
});

test('Request queue counts skip pending-visibility work for Dock Suspend mirror rows', () => {
  let visibilityChecks = 0;
  const regular = [{ id: 'regular-1' }, { id: 'regular-2' }, { id: 'regular-hidden' }];
  const mirrors = Array.from({ length: 1000 }, (_, index) => ({ id: `dock-mirror-${index}`, mirror: true }));
  const ctx = vm.createContext({
    window: { BunchQueueShell: { counts: () => ({ active: 4, review: 1, canReview: true }) } },
    requestsInventory: [],
    requestArchiveListState: { total: 0 },
    evalWorkRows: [],
    getScopedRequestItems: () => [...regular, ...mirrors],
    isRegularRequestQueueItem: row => !row.mirror,
    isRequestPendingVisible: row => { visibilityChecks += 1; return row.id !== 'regular-hidden'; },
    canCurrentUserViewDockSuspendDcRequests: () => false,
    countPendingSuspendTagQueueItems: () => 0,
    getApprovedMoveRequestRowsForCurrentUser: () => [],
    getLocationMoveRecountRowsForCurrentUser: () => [],
    getVisibleShearMoveTestRequestRecords: () => [],
    console: { warn: (...args) => { throw args[1] || new Error(String(args[0])); } }
  });
  vm.runInContext(source('getRequestTabQueueCounts'), ctx);

  const counts = ctx.getRequestTabQueueCounts();

  assert.equal(counts.pending, 2);
  assert.equal(counts['bunch-notes'], 4);
  assert.equal(counts['bunch-count-review'], 1);
  assert.equal(visibilityChecks, regular.length, 'only regular request rows need visibility/completion checks');
});

test('already scoped non-rep queue rows skip duplicate visibility filtering', () => {
  const scopedRows = [{ UNIQUE_ID: 'suspend-row' }];
  let scopeCalls = 0;
  const ctx = vm.createContext({
    requestsInventory: [], activeReqTab: 'suspend-tag',
    getScopedRequestItems: () => { scopeCalls += 1; throw new Error('duplicate scope pass'); }
  });
  vm.runInContext(source('reconcileRequestDrillState'), ctx);
  const result = ctx.reconcileRequestDrillState(scopedRows, true);
  assert.equal(result.items, scopedRows);
  assert.equal(result.changed, false);
  assert.equal(scopeCalls, 0);
});

test('Suspend filter shell builds filter markup once per render', () => {
  const calls = { render: 0, update: 0 };
  const cardList = {};
  const footerHost = {};
  const resultsShell = { querySelector: selector => selector === '#request-suspend-tag-card-list' ? cardList
    : selector === '#request-suspend-tag-footer' ? footerHost : null };
  const container = {
    mounted: false,
    querySelector(selector) {
      if (!this.mounted) return null;
      return selector === '#request-suspend-tag-filter-shell' ? { querySelector: () => null } : selector === '#request-suspend-tag-results' ? resultsShell : null;
    }
  };
  const ctx = vm.createContext({
    document: { activeElement: { id: '' } },
    canUseRequestSuspendTagAssignedToFilter: () => false,
    setContainerHtml: target => { target.mounted = true; },
    renderRequestSuspendTagFilters: () => { calls.render += 1; return '<filters>'; },
    updateRequestSuspendTagFiltersInPlace: () => { calls.update += 1; },
  });
  vm.runInContext(source('ensureRequestSuspendTagRenderShell'), ctx);
  const crumb = {};
  assert.equal(ctx.ensureRequestSuspendTagRenderShell(container, crumb, 'Suspend Tag', [], [], [], [], []), cardList);
  assert.equal(calls.render, 1);
  assert.equal(calls.update, 0);
  assert.equal(ctx.ensureRequestSuspendTagRenderShell(container, crumb, 'Suspend Tag', [], [], [], [], []), cardList);
  assert.equal(calls.render, 2);
  assert.equal(calls.update, 0);
});

test('decorated Suspend filter rail refreshes in place when its permission shape matches', () => {
  const calls = { render: 0, update: 0 };
  const ids = new Set([
    '#request-suspend-tag-status-filter', '#request-suspend-tag-common-search', '#request-suspend-tag-common-clear',
    '#request-suspend-tag-assigned-filter', '#request-suspend-tag-contsize-filter', '#request-suspend-tag-dock-filter',
    '#request-suspend-tag-filter-count', '#request-suspend-tag-clear-filters'
  ]);
  const rail = {
    classList: { contains: value => value === 'mobile-browse-rail' },
    querySelector: selector => selector === 'details.mobile-browse-filters' ? {} : null
  };
  const filterShell = { querySelector: selector => selector === '.request-view-filters' ? rail : ids.has(selector) ? {} : null };
  const cardList = {};
  const resultsShell = { querySelector: selector => selector === '#request-suspend-tag-card-list' ? cardList : null };
  const container = { querySelector: selector => selector === '#request-suspend-tag-filter-shell' ? filterShell : selector === '#request-suspend-tag-results' ? resultsShell : null };
  const ctx = vm.createContext({
    document: { activeElement: { id: '' } },
    canUseRequestSuspendTagAssignedToFilter: () => true,
    renderRequestSuspendTagFilters: () => { calls.render += 1; return '<filters>'; },
    updateRequestSuspendTagFiltersInPlace: () => { calls.update += 1; }
  });
  vm.runInContext(source('ensureRequestSuspendTagRenderShell'), ctx);

  assert.equal(ctx.ensureRequestSuspendTagRenderShell(container, null, 'Suspend Tag', [], [], [], [], []), cardList);
  assert.deepEqual(calls, { render: 0, update: 1 });
  assert.equal(filterShell.querySelector('.request-view-filters'), rail, 'the existing decorated rail remains mounted');
});

test('active Suspend search keeps the in-place draft path during refresh', () => {
  const calls = { render: 0, update: 0 };
  const resultsShell = { querySelector: selector => selector === '#request-suspend-tag-card-list' ? {} : null };
  const filterShell = { querySelector: () => null };
  const container = { querySelector: selector => selector === '#request-suspend-tag-filter-shell' ? filterShell : selector === '#request-suspend-tag-results' ? resultsShell : null };
  const ctx = vm.createContext({
    document: { activeElement: { id: 'request-suspend-tag-common-search' } },
    canUseRequestSuspendTagAssignedToFilter: () => true,
    renderRequestSuspendTagFilters: () => { calls.render += 1; return '<filters>'; },
    updateRequestSuspendTagFiltersInPlace: () => { calls.update += 1; }
  });
  vm.runInContext(source('ensureRequestSuspendTagRenderShell'), ctx);

  ctx.ensureRequestSuspendTagRenderShell(container, null, 'Suspend Tag', [], [], [], [], []);
  assert.deepEqual(calls, { render: 0, update: 1 });
});

test('decorated Suspend filter rail rebuilds when Assigned To permission changes shape', () => {
  const calls = { render: 0, update: 0 };
  const ids = new Set([
    '#request-suspend-tag-status-filter', '#request-suspend-tag-common-search', '#request-suspend-tag-common-clear',
    '#request-suspend-tag-contsize-filter', '#request-suspend-tag-dock-filter',
    '#request-suspend-tag-filter-count', '#request-suspend-tag-clear-filters'
  ]);
  const rail = {
    classList: { contains: value => value === 'mobile-browse-rail' },
    querySelector: selector => selector === 'details.mobile-browse-filters' ? {} : null
  };
  const filterShell = { querySelector: selector => selector === '.request-view-filters' ? rail : ids.has(selector) ? {} : null };
  const cardList = {};
  const resultsShell = { querySelector: selector => selector === '#request-suspend-tag-card-list' ? cardList : null };
  const container = { querySelector: selector => selector === '#request-suspend-tag-filter-shell' ? filterShell : selector === '#request-suspend-tag-results' ? resultsShell : null };
  const ctx = vm.createContext({
    canUseRequestSuspendTagAssignedToFilter: () => true,
    renderRequestSuspendTagFilters: () => { calls.render += 1; return '<filters>'; },
    updateRequestSuspendTagFiltersInPlace: () => { calls.update += 1; },
    window: { AgMetricStableViewDom: { apply: () => { calls.apply = (calls.apply || 0) + 1; } } },
    document: { activeElement: { id: '' }, createElement: () => ({ content: {}, set innerHTML(_value) {} }) }
  });
  vm.runInContext(source('ensureRequestSuspendTagRenderShell'), ctx);

  assert.equal(ctx.ensureRequestSuspendTagRenderShell(container, null, 'Suspend Tag', [], [], [], [], []), cardList);
  assert.deepEqual(calls, { render: 1, update: 0, apply: 1 });
});

test('Suspend pagination footer is mounted before deferred chunk completion', () => {
  const calls = [];
  let renderOptions;
  const ctx = vm.createContext({
    renderMarkupChunkedByKey: (...args) => { calls.push('render'); renderOptions = args[6]; calls.push(`crumb:${args[4]}`); return true; },
    generateCard: () => '<card>',
    isIOSDevice: () => false,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    getPendingRequestChunkRenderOptions: options => options,
    repairVisibleDockSuspendDcPlanstartCardTones: () => calls.push('tones'),
    decorateRequestRows: () => calls.push('decorate'),
    syncRequestBrowseFooter: (_container, markup) => calls.push(`footer:${markup}`),
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  const plan = { rows: [{ UNIQUE_ID: 'suspend-1' }], renderSignature: 'suspend-signature',
    footerMarkup: '<footer>Rows 1–100 of 1000</footer>', crumbText: 'Suspend Tag' };
  assert.equal(ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag Filter', plan), true);
  assert.deepEqual(calls, ['render', 'crumb:Suspend Tag Filter', `footer:${plan.footerMarkup}`]);
  assert.equal(renderOptions.onCompleteAfterInteractive, true);
  assert.equal(renderOptions.completionDeadlineMs, 100, 'an empty initial list drains its bounded page promptly after first paint');
  assert.equal(renderOptions.completionDeadlineDrainAll, true, 'the bounded initial page cannot wait on one-card-per-frame pacing');
  renderOptions.onComplete();
  assert.deepEqual(calls, ['render', 'crumb:Suspend Tag Filter', `footer:${plan.footerMarkup}`, 'tones', 'decorate', `footer:${plan.footerMarkup}`]);
});

test('initial iPhone Suspend completion skips Pending swipe decoration', () => {
  let renderOptions;
  const calls = [];
  const ctx = vm.createContext({
    renderMarkupChunkedByKey: (...args) => { renderOptions = args[6]; return true; },
    isIOSDevice: () => true,
    generateCard: () => '<card>',
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    getPendingRequestChunkRenderOptions: options => options,
    repairVisibleDockSuspendDcPlanstartCardTones: () => calls.push('tones'),
    decorateRequestRows: () => calls.push('pending-decoration'),
    closeAllRequestSwipes: () => calls.push('close-swipes'),
    releaseRequestSwipeMoveListener: () => calls.push('release-listener'),
    syncRequestBrowseFooter: () => calls.push('footer'),
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagDockFilter: 'all'
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag', {
    rows: [{ UNIQUE_ID: 'suspend-1' }], renderSignature: 'verified-page', footerMarkup: ''
  });
  renderOptions.onComplete();
  assert.deepEqual(calls, ['footer', 'tones', 'close-swipes', 'release-listener', 'footer']);
});

test('retained Suspend cards publish completed stages without touch-idle deferral', () => {
  let renderOptions;
  let renderTarget;
  const calls = [];
  const existingCard = {};
  const container = {
    dataset: {},
    isConnected: true,
    querySelector: selector => selector === '[data-request-uid]' ? existingCard : null
  };
  const ctx = vm.createContext({
    renderMarkupChunkedByKey: (...args) => { renderTarget = args[1]; renderOptions = args[6]; return true; },
    isIOSDevice: () => false,
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: options => options,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
    getContainerRenderSignature: root => root.dataset?.renderSignature || '',
    setContainerRenderSignature: (root, signature) => { root.dataset.renderSignature = signature; },
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    scheduleDeferredCardPhotoHydration: root => calls.push(`hydrate:${root === container}`),
    window: { AgMetricStableViewDom: { apply: () => { calls.push('apply'); } } },
    document: { createElement: () => ({}) }
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);

  ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', {
    rows: [{ UNIQUE_ID: 'source-r1' }], renderSignature: 'revision-2', footerMarkup: ''
  });

  assert.equal(renderOptions._backgroundStage, true);
  assert.equal(renderOptions.onCompleteAfterInteractive, false);
  assert.equal(renderOptions.completionDeadlineMs, 250, 'retained Suspend snapshots need a bounded completion deadline');
  assert.equal(renderOptions.completionDeadlineDrainAll, true, 'retained Suspend stages preserve atomic publication at the bounded deadline');
  renderTarget.dataset = { renderSignature: 'revision-2' };
  renderOptions.onComplete();
  assert.deepEqual(calls, ['apply', 'hydrate:true']);
  assert.equal(container.__suspendPagePublicationReceipt.generation, container.__suspendPageGeneration);
  assert.equal(container.__suspendPagePublicationReceipt.renderSignature, 'revision-2');
  assert.ok(Number.isFinite(container.__suspendPagePublicationReceipt.durationMs));
});

test('Suspend first batch covers its bounded page while shared Pending default stays two rows', () => {
  const initialRows = [];
  const ctx = vm.createContext({
    getQueueCardInventoryState() {},
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    getPendingRequestChunkRenderOptions: options => options,
    renderMarkupChunkedByKey: (_key, _target, _crumb, _rows, _text, _renderRow, options) => {
      initialRows.push(options.initialRows);
      return true;
    },
    syncRequestBrowseFooter() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    document: {}
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  for (const count of [37, 100]) {
    ctx.renderSuspendTagPagedCards({ dataset: {}, querySelector: () => null }, {}, null, null, 'Suspend Tag', {
      rows: rows(count), renderSignature: `suspend-${count}`, footerMarkup: ''
    });
  }
  assert.deepEqual(initialRows, [37, 40]);

  const pendingCtx = vm.createContext({ getRequestChunkRenderOptions: options => options });
  vm.runInContext(source('getPendingRequestChunkRenderOptions'), pendingCtx);
  assert.equal(pendingCtx.getPendingRequestChunkRenderOptions({}).initialRows, 2,
    'the shared Pending first-paint default remains unchanged');
});

test('chunk deadline drains only opted-in bounded Suspend pages despite live-gesture pacing', () => {
  const run = ({ staleAtDeadline = false, drainAll = true } = {}) => {
    const rendered = [];
    const frames = [];
    let deadline;
    let completed = 0;
    const container = { dataset: {}, style: {}, classList: { add() {} } };
    const tokens = { 'request-main': 0 };
    const ctx = vm.createContext({
      chunkRenderTokensByKey: tokens,
      chunkRenderActivityByKey: {},
      productionLiveSyncRendering: false,
      productionLiveSyncActiveRender: null,
      normalizeRenderSignature: value => String(value || ''),
      buildRowsRenderSignature: () => 'render-test',
      CHUNK_RENDER_INTERACTION_HOLD_MAX_MS: 260,
      IOS_CHUNK_SYNC_ROW_LIMIT: 24,
      window: { matchMedia: () => ({ matches: true }) },
      document: { documentElement: { clientHeight: 640 } },
      performance: { now: () => 1 },
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
      scheduleChunkRenderTimeout: (_key, callback, delay) => { if (delay === 250) deadline = callback; return 1; },
      cancelChunkRenderWorkForContainer() {},
      bumpChunkRenderTokenByKey: key => (tokens[key] = (tokens[key] || 0) + 1),
      getContainerChunkRenderKey: target => target.dataset.activeChunkRenderKey || '',
      setContainerChunkRenderState: (target, key, token) => { target.dataset.activeChunkRenderKey = key; target.dataset.activeChunkRenderToken = String(token); },
      clearContainerChunkRenderState: (target, key, token) => {
        if (target.dataset.activeChunkRenderKey === key && target.dataset.activeChunkRenderToken === String(token)) {
          delete target.dataset.activeChunkRenderKey; delete target.dataset.activeChunkRenderToken;
        }
      },
      isChunkRenderCurrentForContainer: (target, key, token) => Number(tokens[key]) === token
        && (!target.dataset.activeChunkRenderToken || Number(target.dataset.activeChunkRenderToken) === token),
      beginInternalPerfMeasure: () => 1, getAdaptivePerfElapsedMs: () => 1,
      isAdaptivePerformanceMode: () => false, getAdaptivePerformanceLevel: () => 0,
      isIOSDevice: () => false, isStandaloneApp: () => false,
      getChunkRenderPacing: count => ({ batchTarget: Math.min(count, Math.max(8, Math.ceil(count / 3))), timeBudget: 2, frameDelayMs: 0 }),
      shouldHoldFollowupChunkFramesForInteraction: () => false,
      isUserInLiveTouchScrollGesture: () => true,
      beginChunkRenderActivity() {}, endChunkRenderActivity() {},
      setContainerHtml() {}, appendHtmlFragment() {}, setContainerUiState() {},
      getContainerRenderSignature: target => target.dataset.renderSignature || '',
      setContainerRenderSignature: (target, signature) => { target.dataset.renderSignature = signature; },
      incrementInternalPerfCounter() {}, recordGncPerfStat() {}, recordInternalPerfDuration() {},
      reportSemanticHealthEvent() {}
    });
    vm.runInContext(source('renderMarkupChunkedByKey'), ctx);
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: index }));
    ctx.renderMarkupChunkedByKey('request-main', container, null, rows, '', row => {
      rendered.push(row.id); return `<row>${row.id}</row>`;
    }, { initialRows: 2, chunkSize: 8, perFrameRows: 8, completionDeadlineMs: 250,
      completionDeadlineDrainAll: drainAll, onComplete: () => { completed += 1; } });
    assert.equal(rendered.length, 2, 'initial rendering stays bounded before the deadline');
    if (staleAtDeadline) tokens['request-main'] += 1;
    assert.equal(typeof deadline, 'function');
    deadline();
    if (!staleAtDeadline && drainAll) {
      assert.equal(rendered.length, 100, 'opted-in deadline must synchronously finish the bounded visible page');
      while (frames.length) frames.shift()();
      assert.equal(completed, 1, 'current complete stage publishes through its completion callback');
    } else if (!staleAtDeadline) {
      assert.ok(rendered.length < 100, 'generic deadlines must preserve interaction-paced batching');
      for (let count = 0; frames.length && count < 200; count += 1) frames.shift()();
      assert.equal(rendered.length, 100, 'generic paced frames continue after their deadline batch');
      assert.equal(completed, 1, 'generic render still completes through its regular token-checked callback');
    } else {
      while (frames.length) frames.shift()();
      assert.equal(rendered.length, 2, 'stale token must block the deadline drain');
      assert.equal(completed, 0, 'stale token must block publication');
    }
  };
  run();
  run({ staleAtDeadline: true });
  run({ drainAll: false });
});

test('a detached Suspend stage cannot publish after its root disconnects', () => {
  let renderOptions;
  let renderTarget;
  let applyCount = 0;
  const container = { dataset: {}, isConnected: true, querySelector: () => ({}) };
  const root = { isConnected: true };
  const ctx = vm.createContext({
    isIOSDevice: () => false,
    renderMarkupChunkedByKey: (...args) => { renderTarget = args[1]; renderOptions = args[6]; return true; },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: value => value,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
    getContainerRenderSignature: target => target.dataset?.renderSignature || '',
    setContainerRenderSignature: (target, signature) => { target.dataset.renderSignature = signature; },
    scheduleDeferredCardPhotoHydration() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    window: { AgMetricStableViewDom: { apply: () => { applyCount += 1; } } }, document: { createElement: () => ({}) }
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  ctx.renderSuspendTagPagedCards(container, {}, root, null, 'Suspend Tag', {
    rows: [{ UNIQUE_ID: 'suspend-1' }], renderSignature: 'auth-r1:source-r1:page-1', footerMarkup: ''
  });

  renderTarget.dataset = { renderSignature: 'auth-r1:source-r1:page-1' };
  root.isConnected = false;
  renderOptions.onComplete();

  assert.equal(applyCount, 0);
  assert.equal(container.dataset.renderSignature || '', '');
  assert.equal(container.__suspendPageStage, null);
});

test('identical in-flight Suspend plans reuse their bounded stage until publication', () => {
  let renderCalls = 0;
  let options;
  let stageTarget;
  const chunkRenderTokensByKey = { 'request-main': 0 };
  const container = {
    dataset: {},
    isConnected: true,
    querySelector: selector => selector === '[data-request-uid]' ? {} : null
  };
  const footerCalls = [];
  const ctx = vm.createContext({
    isIOSDevice: () => false,
    renderMarkupChunkedByKey: (...args) => {
      renderCalls += 1;
      chunkRenderTokensByKey['request-main'] += 1;
      stageTarget = args[1];
      options = args[6];
      return true;
    },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: value => value,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {},
    syncRequestBrowseFooter: (_container, markup) => footerCalls.push(markup),
    getContainerRenderSignature: root => root.dataset.renderSignature || '',
    setContainerRenderSignature: (root, signature) => { root.dataset.renderSignature = signature; },
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    scheduleDeferredCardPhotoHydration() {},
    chunkRenderTokensByKey,
    window: { AgMetricStableViewDom: { apply() {} } }, document: { createElement: () => ({}) }
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);

  const plan = { rows: [{ UNIQUE_ID: 'suspend-1' }], renderSignature: 'auth-r1:source-r1:page-1', footerMarkup: '<footer>1</footer>' };
  assert.equal(ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan), true);
  const stageOptions = options;
  assert.equal(ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan), true);
  assert.equal(renderCalls, 1, 'the same render signature must not cancel and restart its pending detached stage');
  assert.deepEqual(footerCalls, ['<footer>1</footer>', '<footer>1</footer>']);

  stageTarget.dataset = { renderSignature: plan.renderSignature };
  stageOptions.onComplete();
  assert.equal(ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan), true);
  assert.equal(renderCalls, 2, 'once published, the existing renderer signature skip handles an identical redraw');
  assert.equal(stageTarget, container, 'published identical plans must take the connected-container signature skip path');
});

test('request render pre-bump preserves an identical pending Suspend stage only', () => {
  assert.equal(source('renderRequest').includes("if (shouldBumpRequestMainBeforeRender(isSuspendTagRender)) bumpChunkRenderTokenByKey('request-main');"), true,
    'the real request render entrypoint must apply the tab-specific bump guard');
  let renderCalls = 0;
  let stageOptions;
  const tokens = { 'request-main': 0 };
  const container = { dataset: {}, isConnected: true, querySelector: () => ({}) };
  const ctx = vm.createContext({
    isIOSDevice: () => false,
    chunkRenderTokensByKey: tokens,
    renderMarkupChunkedByKey: (...args) => {
      renderCalls += 1;
      tokens['request-main'] += 1;
      stageOptions = args[6];
      return true;
    },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: value => value,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
    getContainerRenderSignature: root => root.dataset.renderSignature || '', setContainerRenderSignature() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    window: { AgMetricStableViewDom: { apply() {} } }, document: { createElement: () => ({}) }
  });
  vm.runInContext(source('shouldBumpRequestMainBeforeRender'), ctx);
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);

  const plan = { rows: [{ UNIQUE_ID: 'suspend-1' }], renderSignature: 'same-auth-source-page', footerMarkup: '' };
  assert.equal(ctx.shouldBumpRequestMainBeforeRender(true), false);
  ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan);
  const pendingOptions = stageOptions;
  if (ctx.shouldBumpRequestMainBeforeRender(true)) tokens['request-main'] += 1;
  ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan);
  assert.equal(renderCalls, 1, 'a same-plan Suspend render must not cancel its pending stage');

  assert.equal(ctx.shouldBumpRequestMainBeforeRender(false), true);
  if (ctx.shouldBumpRequestMainBeforeRender(false)) tokens['request-main'] += 1;
  ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan);
  assert.equal(renderCalls, 2, 'other request views retain the pre-bump cancellation behavior');
  assert.equal(typeof pendingOptions.onComplete, 'function');
});

test('a delayed Pending side-data callback cannot hydrate over Bunch Notes', () => {
  const execute = activeReqTab => {
    const calls = { warm: 0, refresh: 0, catchup: 0, delay: 0 };
    let scheduled;
    const ctx = vm.createContext({
      activeReqTab,
      REQUEST_QUEUE_SIDE_REFRESH_MIN_INTERVAL_MS: 240,
      isTouchConstrainedDevice: () => true,
      isViewVisible: view => view === 'request',
      runAfterShellInteractive: (callback, delay) => { scheduled = callback; calls.delay = delay; },
      window: { BunchQueueShell: { warm: () => { calls.warm += 1; }, isTab: tab => tab === 'bunch-notes' || tab === 'bunch-count-review' } },
      refreshActiveRequestQueueSideData: () => { calls.refresh += 1; return Promise.resolve(); },
      queueRequestVisibleRenderCatchup: () => { calls.catchup += 1; }
    });
    vm.runInContext(source('scheduleRequestRenderSideData'), ctx);
    ctx.scheduleRequestRenderSideData();
    assert.equal(calls.delay, 320, 'touch-device side refresh retains its existing delay');
    scheduled();
    return calls;
  };

  const bunch = execute('bunch-notes');
  assert.deepEqual(bunch, { warm: 1, refresh: 0, catchup: 0, delay: 320 }, 'Bunch may warm its own cache but skips the broad queue refresh and catch-up');
  const pending = execute('pending');
  assert.deepEqual(pending, { warm: 1, refresh: 1, catchup: 1, delay: 320 }, 'ordinary Pending retains its existing side-data refresh behavior');
});

test('an identical Suspend plan restarts when its prior chunk token was cancelled', () => {
  let renderCalls = 0;
  const chunkRenderTokensByKey = { 'request-main': 0 };
  const container = { dataset: {}, isConnected: true, querySelector: () => ({}) };
  const ctx = vm.createContext({
    isIOSDevice: () => false,
    renderMarkupChunkedByKey: () => { renderCalls += 1; chunkRenderTokensByKey['request-main'] += 1; return true; },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: value => value,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
    getContainerRenderSignature: target => target.dataset?.renderSignature || '', setContainerRenderSignature() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    chunkRenderTokensByKey,
    window: { AgMetricStableViewDom: { apply() {} } }, document: { createElement: () => ({}) }
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  const plan = { rows: [{ UNIQUE_ID: 'suspend-1' }], renderSignature: 'same-auth-source-page', footerMarkup: '' };

  ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan);
  chunkRenderTokensByKey['request-main'] += 1;
  ctx.renderSuspendTagPagedCards(container, {}, {}, null, 'Suspend Tag', plan);

  assert.equal(renderCalls, 2, 'a stage whose global chunk token was superseded must not suppress its replacement');
});

test('Suspend schedules hydration for the complete visible page before rendering its first chunk', () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ UNIQUE_ID: `suspend-${index}` }));
  const reads = [];
  const ctx = vm.createContext({
    getQueueCardInventoryState: (row, view) => { reads.push([row.UNIQUE_ID, view]); return { status: 'loading' }; },
    renderMarkupChunkedByKey: (_key, _container, _crumb, visibleRows) => {
      assert.equal(reads.length, 100, 'one batch must already include the whole visible page before chunk callbacks can repaint');
      assert.equal(visibleRows, rows);
      return true;
    },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: options => options,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all'
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  assert.equal(ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag', {
    rows, items: [...rows, { UNIQUE_ID: 'off-page' }], renderSignature: 'page-1', footerMarkup: ''
  }), true);
  assert.deepEqual(reads, rows.map(row => [row.UNIQUE_ID, 'request']), 'off-page rows must not start reads');
});

test('cold Suspend mirror preparation renders a loading state instead of an empty queue', () => {
  let renderOptions;
  const ctx = vm.createContext({
    renderMarkupChunkedByKey: (...args) => { renderOptions = args[6]; return true; },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: options => options,
    isDockSuspendDcRequestMirrorPreparationPending: () => true,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag', { rows: [], renderSignature: 'loading', footerMarkup: '' });
  assert.match(renderOptions.emptyHtml, /Loading Suspend Tag rows/);
});

test('Suspend filtered-empty render signature changes when mirror preparation finishes', () => {
  let pending = true;
  const captured = [];
  const ctx = vm.createContext({
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagStatusFilter: 'active', requestSuspendTagContSizeFilter: 'all', requestSuspendTagDockFilter: 'dock:99',
    queueCardInventoryRenderVersion: 0,
    getDockSuspendDcSourceRows: () => [],
    getDockSuspendDcSourceRowLookupRevision: () => 'empty-source',
    getDockSuspendDcSourceRowLookup: () => new Map(),
    getSuspendTagRequestItems: items => items.slice(),
    getSortedSuspendTagSourceRows: items => items.slice(),
    sortRequestSuspendTagRows: items => items.slice(),
    applyRequestSuspendTagCommonNameSearchFilter: items => items,
    applyRequestSuspendTagAssignedToFilter: items => items,
    applyRequestSuspendTagContSizeFilter: items => items,
    applyRequestSuspendTagDockFilter: () => [],
    normalizeSearchValue: value => value,
    normalizeRequestSuspendTagAssignedToFilterValue: value => value,
    normalizeRequestSuspendTagContSizeFilterValue: value => value,
    buildRequestPagedRenderPlan: () => ({ rows: [], items: [], renderSignature: 'same-empty-rows', footerMarkup: '' }),
    getDockSuspendDcRequestPlanstartInfo: () => ({ value: '', tone: 'unknown', valid: false }),
    isDockSuspendDcRequestMirrorPreparationPending: () => pending,
    renderMarkupChunkedByKey: (...args) => { captured.push(args[6]); return true; },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: options => options,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
  });
  vm.runInContext(source('buildSuspendTagRenderPlan'), ctx);
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);

  const loadingPlan = ctx.buildSuspendTagRenderPlan([{ UNIQUE_ID: 'source-1' }]);
  ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag', loadingPlan);
  pending = false;
  const readyPlan = ctx.buildSuspendTagRenderPlan([{ UNIQUE_ID: 'source-1' }]);
  ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag', readyPlan);

  assert.equal(loadingPlan.rows.length, 0);
  assert.equal(readyPlan.rows.length, 0);
  assert.notEqual(readyPlan.renderSignature, loadingPlan.renderSignature);
  assert.match(captured[0].emptyHtml, /Loading Suspend Tag rows/);
  assert.match(captured[1].emptyHtml, /No suspend tag rows match these filters/);
});

test('Suspend render signature changes when canonical queue hydration completes without source-row changes', () => {
  let sourceRevision = 'source-r1';
  let permissionRevision = 'permission-r1';
  const ctx = vm.createContext({
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    queueCardInventoryRenderVersion: 0,
    getItemUniqueId: item => item.UNIQUE_ID,
    getDockSuspendDcSourceRows: () => [], getDockSuspendDcSourceRowLookupRevision: () => sourceRevision,
    getDockSuspendDcSourceRowLookup: () => new Map(),
    getQueueCardInventoryContext: () => ({ scope: 'scope-1', permission: permissionRevision, revision: '1' }),
    getSuspendTagRequestItems: items => items.slice(), getSortedSuspendTagSourceRows: items => items.slice(),
    applyRequestSuspendTagCommonNameSearchFilter: items => items,
    applyRequestSuspendTagAssignedToFilter: items => items,
    applyRequestSuspendTagContSizeFilter: items => items,
    applyRequestSuspendTagDockFilter: items => items,
    normalizeSearchValue: value => value,
    normalizeRequestSuspendTagAssignedToFilterValue: value => value,
    normalizeRequestSuspendTagContSizeFilterValue: value => value,
    buildRequestPagedRenderPlan: (_mode, _crumb, items) => ({ rows:items, items, renderSignature:'same-source-and-page', footerMarkup:'' }),
    getDockSuspendDcRequestPlanstartInfo: () => ({ value:'', tone:'unknown', valid:false }),
    isDockSuspendDcRequestMirrorPreparationPending: () => false
  });
  vm.runInContext(source('buildSuspendTagRenderPlan'), ctx);
  const unchangedSource = [{ UNIQUE_ID:'suspend-1', DOCK_SUSPEND_DC_REQUEST:true }];
  const loadingPlan = ctx.buildSuspendTagRenderPlan(unchangedSource);
  ctx.queueCardInventoryRenderVersion = 1;
  const hydratedPlan = ctx.buildSuspendTagRenderPlan(unchangedSource);
  assert.notEqual(hydratedPlan.renderSignature, loadingPlan.renderSignature,
    'canonical metric hydration must invalidate the chunk-render skip key even when request rows are unchanged');
  sourceRevision = 'source-r2';
  const changedSourcePlan = ctx.buildSuspendTagRenderPlan(unchangedSource);
  assert.notEqual(changedSourcePlan.renderSignature, hydratedPlan.renderSignature,
    'a changed Suspend source revision must supersede an in-flight stage');
  permissionRevision = 'permission-r2';
  assert.notEqual(ctx.buildSuspendTagRenderPlan(unchangedSource).renderSignature, changedSourcePlan.renderSignature,
    'a changed inventory permission revision must supersede an in-flight stage');
});

test('Request card signatures invalidate when canonical queue hydration completes', () => {
  const ctx = vm.createContext({
    queueCardInventoryRenderVersion: 0, selectedItems: new Set(),
    isHoldReleaseOverrideActiveForItem: () => false,
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    getItemDisplayValue: () => '', getRequestAssignedRep: () => 'Rep',
    getRequestCardSourceLabel: () => 'Request',
    formatLocPhotoMatchQtyValue: () => 'N/A', normalizeCardQuantityValue: value => value,
    getCardLocationOnHandValue: () => null, getRowPhotoLink: () => '', getRowPhotoDateLabel: () => '',
    isRequestComplete: () => false, isRequestDeliverySending: () => false,
    isRequestDeliveryNeedsAttention: () => false, isDockSuspendDcRequestMirrorRow: () => false,
    isSeasonSalesNoteCardItem: () => false, getInventoryCardFieldTagColorDisplayValue: () => '', getCardPtrOnHandValue: () => null,
    getCardPtrReviewedValue: () => null, getCardPtrAvailableValue: () => null,
    getCardOpenStockValue: () => null, getInventoryCardDesigCustValue: () => '',
    getInventoryCardDesigItemValue: () => '', getInventoryCardDesigLocValue: () => ''
  });
  vm.runInContext(source('buildRequestItemRenderSignature'), ctx);
  const row = { UNIQUE_ID: 'request-1', DOM_ID: 'request-dom-1', LOCATIONCODE: 'A1' };
  const loadingSignature = ctx.buildRequestItemRenderSignature(row);
  ctx.queueCardInventoryRenderVersion = 1;
  const hydratedSignature = ctx.buildRequestItemRenderSignature(row);
  assert.notEqual(hydratedSignature, loadingSignature,
    'Request card render skips must not preserve Loading after a canonical hydration update');
});

test('Docks stop-item signatures invalidate when canonical queue hydration completes', () => {
  const ctx = vm.createContext({
    queueCardInventoryRenderVersion: 0,
    buildRowsRenderSignature: (prefix, items) => `${prefix}:${items.map(item => item.UNIQUE_ID).join(',')}`
  });
  vm.runInContext(source('buildDocksStopItemsRenderSignature'), ctx);
  const rows = [{ UNIQUE_ID: 'dock-row-1' }];
  const loadingSignature = ctx.buildDocksStopItemsRenderSignature('Dock 2', 'Stop 3', rows);
  ctx.queueCardInventoryRenderVersion = 1;
  const hydratedSignature = ctx.buildDocksStopItemsRenderSignature('Dock 2', 'Stop 3', rows);
  assert.notEqual(hydratedSignature, loadingSignature,
    'Docks stop cards must repaint canonical metrics after hydration without source-row changes');
});

test('Suspend queue counts scan source status without constructing rich mirror rows', () => {
  let mirrorBuilds = 0;
  const hiddenSources = new Set();
  const ctx = vm.createContext({
    getSuspendTagRequestItems: items => items.filter(row => row.DOCK_SUSPEND_DC_REQUEST && !hiddenSources.has(row.DOCK_SUSPEND_SOURCE_UID)),
    getQueueCompletionState: () => ({ has: key => hiddenSources.has(key.split(':')[1]) }),
    getDockSuspendCompletionRevision: () => 'import-1',
    getQueueCompletionVersion: () => 0,
    getDockSuspendDcRequestSourceUid: row => row.DOCK_SUSPEND_SOURCE_UID || row.UNIQUE_ID,
    isDockSuspendDcRequestSource: row => row.SUSPEND === 'SUSPEND' && row.SUSPENDTO === 'dc',
    getSuspendTagStatus: row => row.status,
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    buildDockSuspendDcRequestMirrorRow: () => { mirrorBuilds += 1; throw new Error('counts must not build cards'); },
  });
  vm.runInContext(source('countPendingSuspendTagQueueItems'), ctx);
  const sourceRows = Array.from({ length: 1000 }, (_, index) => ({
    UNIQUE_ID: `source-${index}`, SUSPEND: 'SUSPEND', SUSPENDTO: 'dc', status: index === 1 ? 'completed' : 'pending'
  }));
  sourceRows[2].status = 'denied';
  const existingMirror = { UNIQUE_ID: 'dock_suspend_dc_source-0', DOCK_SUSPEND_DC_REQUEST: true,
    DOCK_SUSPEND_SOURCE_UID: 'source-0', status: 'pending' };
  const count = ctx.countPendingSuspendTagQueueItems([existingMirror], sourceRows);
  assert.equal(count, 999);
  assert.equal(mirrorBuilds, 0);
  hiddenSources.add('source-0');
  assert.equal(ctx.countPendingSuspendTagQueueItems([existingMirror], sourceRows), 998, 'stale source rows cannot restore an optimistically removed badge count');
});

test('Dock Suspend source lookup is indexed by source snapshot and can be invalidated after row mutation', () => {
  const rows = [{ UNIQUE_ID: 'source-a', status: 'pending' }, { UNIQUE_ID: 'source-b', status: 'pending' }];
  const otherRows = [];
  const ctx = vm.createContext({
    sourceRows: rows, socInventory: otherRows, revision: 'r1', resolvedViewStateEpoch: 4,
    currentUser: 'manager', dockSuspendDcRequestSourceRowLookupCache: { sourceRows: null, revision: '', byId: new Map() },
    requestScopedItemsCacheKey: 'stale', requestScopedItemsCache: ['stale'],
    dockSuspendDcRequestMirrorRowsCacheKey: '', dockSuspendDcRequestMirrorRowsCacheSource: null,
    dockSuspendDcRequestMirrorRowsByIdCache: null, dockSuspendDcRequestMirrorRowsByDomIdCache: null,
    dockSuspendDcRequestMirrorRowsPreparation: null,
    getDockSuspendDcSourceRows: () => ctx.sourceRows,
    getDockSuspendDcRequestSourceUid: item => item?.DOCK_SUSPEND_SOURCE_UID || '',
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    getDatasetLoadSignature: name => `${name}:${ctx.revision}`,
    getSupabaseReadIdentityScope: () => 'manager-scope',
    normalizePushUsername: value => value,
  });
  vm.runInContext(`${source('getDockSuspendDcSourceRowLookupRevision')}\n${source('getDockSuspendDcSourceRowLookup')}\n${source('invalidateDockSuspendDcSourceRowLookup')}\n${source('findDockSuspendDcRequestSourceRow')}`, ctx);
  const firstIndex = ctx.getDockSuspendDcSourceRowLookup();
  assert.equal(firstIndex.get('source-a'), rows[0]);
  assert.equal(ctx.getDockSuspendDcSourceRowLookup(), firstIndex);
  rows[0].status = 'completed';
  ctx.invalidateDockSuspendDcSourceRowLookup(rows);
  assert.equal(ctx.requestScopedItemsCacheKey, '');
  assert.equal(ctx.requestScopedItemsCache, null);
  const refreshedIndex = ctx.getDockSuspendDcSourceRowLookup();
  assert.notEqual(refreshedIndex, firstIndex);
  assert.equal(ctx.findDockSuspendDcRequestSourceRow({ DOCK_SUSPEND_SOURCE_UID: 'source-a' }), rows[0]);
  assert.equal(ctx.findDockSuspendDcRequestSourceRow({ DOCK_SUSPEND_SOURCE_UID: 'missing' }), null);
  ctx.revision = 'r2';
  ctx.sourceRows = [{ UNIQUE_ID: 'source-a', status: 'new snapshot' }];
  assert.equal(ctx.findDockSuspendDcRequestSourceRow({ DOCK_SUSPEND_SOURCE_UID: 'source-a' }).status, 'new snapshot');
});

test('Suspend mirrors prepare in bounded slices, publish atomically, retain same-scope rows, and cancel stale jobs', () => {
  const sourceRows = Array.from({ length: 1000 }, (_, index) => ({ UNIQUE_ID: `source-${index}`, SUSPEND: 'SUSPEND', SUSPENDTO: 'dc' }));
  let builtRows = 0;
  const timers = [];
  const scheduled = [];
  const identity = { scope: 'manager-scope' };
  const setTimer = callback => { const timer = { callback, cleared: false }; timers.push(timer); return timer; };
  const runNextTimer = () => {
    while (timers.length) {
      const timer = timers.shift();
      if (!timer.cleared) { timer.callback(); return true; }
    }
    return false;
  };
  const drainTimers = () => { while (runNextTimer()) { /* Drain queued preparation slices. */ } };
  const ctx = vm.createContext({
    sourceRows, socInventory: [], currentUser: 'manager', activeReqTab: 'suspend-tag', resolvedViewStateEpoch: 5, revision: 'r1',
    dockSuspendDcRequestSourceRowLookupCache: { sourceRows: null, revision: '', byId: new Map() },
    dockSuspendDcRequestMirrorRowsCacheKey: '', dockSuspendDcRequestMirrorRowsCacheSource: null,
    dockSuspendDcRequestMirrorRowsCache: [], dockSuspendDcRequestMirrorRowsByIdCache: null,
    dockSuspendDcRequestMirrorRowsByDomIdCache: null, dockSuspendDcRequestMirrorRowsCacheOwner: '',
    dockSuspendDcRequestMirrorRowsPreparation: null, DOCK_SUSPEND_MIRROR_PREPARATION_CHUNK_SIZE: 64,
    requestScopedItemsCacheKey: 'stale', requestScopedItemsCache: ['stale'],
    canCurrentUserViewDockSuspendDcRequests: () => true,
    getDockSuspendDcSourceRows: () => ctx.sourceRows,
    getDatasetLoadSignature: name => `${name}:${ctx.revision}`,
    getSupabaseReadIdentityScope: () => identity.scope,
    normalizePushUsername: value => value,
    setTimeout: setTimer, clearTimeout: timer => { if (timer) timer.cleared = true; },
    isViewVisible: view => view === 'request',
    scheduleRequestRender: (...args) => scheduled.push(args),
    isDockSuspendDcRequestSource: row => row.SUSPEND === 'SUSPEND' && row.SUSPENDTO === 'dc',
    buildDockSuspendDcRequestMirrorRow: row => { builtRows += 1; return row.SUSPEND === 'SUSPEND' && row.SUSPENDTO === 'dc' ? { UNIQUE_ID: `mirror-${row.UNIQUE_ID}` } : null; },
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
  });
  vm.runInContext(`${source('getDockSuspendDcSourceRowLookupRevision')}\n${source('getDockSuspendDcRequestMirrorRowsOwner')}\n${source('scheduleDockSuspendDcRequestMirrorRowsPreparation')}\n${source('getDockSuspendDcRequestMirrorRows')}`, ctx);
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows().length, 0, 'cold preparation does not expose a partial queue');
  assert.equal(builtRows, 0, 'the first render does no row mapping synchronously');
  runNextTimer();
  assert.equal(builtRows, 64, 'each scheduled slice maps at most 64 rows');
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsCache.length, 0, 'partial slices are never published');
  drainTimers();
  assert.equal(builtRows, 1000);
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows().length, 1000);
  assert.deepEqual(scheduled, [[0, 0, true]]);
  const stableRows = ctx.dockSuspendDcRequestMirrorRowsCache;
  ctx.resolvedViewStateEpoch += 1;
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows().length, 1000);
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsPreparation, null, 'unrelated view cache invalidation must not restart the same source mirror');
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsCache, stableRows);
  assert.equal(builtRows, 1000);

  const previousRows = ctx.dockSuspendDcRequestMirrorRowsCache;
  ctx.revision = 'r2';
  ctx.sourceRows = Array.from({ length: 1000 }, (_, index) => ({ UNIQUE_ID: `replacement-${index}`, SUSPEND: 'SUSPEND', SUSPENDTO: 'dc' }));
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows()[0].UNIQUE_ID, previousRows[0].UNIQUE_ID, 'same-scope refresh keeps the previous complete rows visible');
  runNextTimer();
  assert.equal(builtRows, 1064);
  ctx.revision = 'r3';
  ctx.sourceRows = [{ UNIQUE_ID: 'latest-source', SUSPEND: 'SUSPEND', SUSPENDTO: 'dc' }];
  runNextTimer();
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsCache, previousRows, 'a stale job cannot publish after source replacement');
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows()[0].UNIQUE_ID, previousRows[0].UNIQUE_ID);
  drainTimers();
  assert.equal(Array.from(ctx.getDockSuspendDcRequestMirrorRows(), row => row.UNIQUE_ID).join(','), 'mirror-latest-source');
  assert.equal(ctx.requestScopedItemsCacheKey, '');
  assert.equal(ctx.requestScopedItemsCache, null);
  assert.equal(scheduled.length, 3, 'complete refreshes and stale-job recovery schedule a render');

  identity.scope = 'manager-permission-version-2';
  ctx.dockSuspendDcRequestMirrorRowsByIdCache = new Map([['old-account-row', {}]]);
  ctx.dockSuspendDcRequestMirrorRowsByDomIdCache = new Map([['old-account-dom-row', {}]]);
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows().length, 0, 'a changed auth scope never receives previous-scope rows');
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsByIdCache, null);
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsByDomIdCache, null);
  drainTimers();
  assert.equal(Array.from(ctx.getDockSuspendDcRequestMirrorRows(), row => row.UNIQUE_ID).join(','), 'mirror-latest-source');
  assert.equal(scheduled.length, 4);
});

test('Suspend keeps all filter totals while bounding cards and plan-start signatures to its page', () => {
  const ctx = fixture();
  const planstartReads = [];
  let sortCalls = 0;
  let sourceRevision = 'r1';
  let identityScope = 'manager-a';
  let sourceRowsReads = 0;
  let lookupRevisionReads = 0;
  let lookupReads = 0;
  const sourceLookup = new Map();
  const filterLookups = [];
  Object.assign(ctx, {
    requestSuspendTagSortedSourceRowsCache: { key: '', rows: [] },
    queueCardInventoryRenderVersion: 0,
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagStatusFilter: 'active', requestSuspendTagDockFilter: 'all',
    getSuspendTagRequestItems: (values, status) => values.filter(row => status === 'completed' ? row.status === 'complete' : row.status !== 'complete'),
    isDockSuspendDcRequestMirrorRow: () => true,
    isDockSuspendDcRequestSource: () => true,
    getSupabaseReadIdentityScope: () => identityScope,
    getDatasetLoadSignature: name => `${name}:${sourceRevision}`,
    getDockSuspendDcSourceRows: () => { sourceRowsReads += 1; return []; },
    getDockSuspendDcSourceRowLookup: () => { lookupReads += 1; return sourceLookup; },
    getDockSuspendDcSourceRowLookupRevision: () => { lookupRevisionReads += 1; return `suspend:${sourceRevision}:${identityScope}`; },
    getRequestSuspendTagDockFilterOptionForItem: () => ({ value: 'dock:1', label: 'Dock 1' }),
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    compareRequestSuspendTagRows: (a, b) => a.LOCATIONCODE.localeCompare(b.LOCATIONCODE),
    applyRequestSuspendTagCommonNameSearchFilter: values => values,
    applyRequestSuspendTagAssignedToFilter: (values, lookup) => { filterLookups.push(lookup); return values; },
    applyRequestSuspendTagContSizeFilter: (values, lookup) => { filterLookups.push(lookup); return values; },
    applyRequestSuspendTagDockFilter: (values, lookup) => { filterLookups.push(lookup); return values; },
    normalizeSearchValue: value => value,
    normalizeRequestSuspendTagAssignedToFilterValue: value => value,
    normalizeRequestSuspendTagContSizeFilterValue: value => value,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    getDockSuspendDcRequestPlanstartInfo: row => { planstartReads.push(row.UNIQUE_ID); return { value: row.date || '', tone: 'monday', valid: true }; }
  });
  ctx.sortRequestSuspendTagRows = values => { sortCalls += 1; return values.slice().sort(ctx.compareRequestSuspendTagRows); };
  vm.runInContext(source('getSortedSuspendTagSourceRows'), ctx);
  vm.runInContext(source('buildSuspendTagRenderPlan'), ctx);
  const data = rows(9539);
  data.forEach(row => { row.status = 'pending'; });
  const first = ctx.buildSuspendTagRenderPlan(data);
  assert.equal(first.allItems.length, 9539);
  assert.equal(first.items.length, 9539);
  assert.equal(first.rows.length, 100);
  assert.equal(first.footerMarkup, '0:9539');
  assert.deepEqual(ctx.signatures, [100]);
  assert.equal(planstartReads.length, 100);
  assert.equal(sortCalls, 1);
  assert.equal(sourceRowsReads, 1);
  assert.equal(lookupRevisionReads, 1);
  assert.equal(lookupReads, 1);
  assert.equal(filterLookups.length, 3);
  assert.ok(filterLookups.every(lookup => lookup === sourceLookup), 'all filter passes share the render-scoped source map');
  data[0].status = 'complete';
  assert.equal(ctx.buildSuspendTagRenderPlan(data).allItems.length, 9538, 'status changes are reapplied even when the sort cache is warm');
  assert.equal(sortCalls, 1);
  data[0].date = '2026-10-19';
  assert.notEqual(ctx.buildSuspendTagRenderPlan(data).renderSignature, first.renderSignature);
  assert.equal(sortCalls, 1, 'non-sort card updates do not force another full sort');
  const refreshed = { ...data[0], status: 'pending', COMMONNAME: 'refreshed same-ID source' };
  data[0] = refreshed;
  const refreshedPlan = ctx.buildSuspendTagRenderPlan(data);
  assert.equal(sortCalls, 2, 'same-revision same-ID source content refresh invalidates the ordered rows');
  assert.equal(refreshedPlan.allItems.includes(refreshed), true, 'the refreshed row object reaches the active list');
  const nonSortReplacement = { ...data[2], PHOTO_URL: 'https://example.test/refreshed-photo.jpg' };
  data[2] = nonSortReplacement;
  const nonSortRefreshedPlan = ctx.buildSuspendTagRenderPlan(data);
  assert.equal(sortCalls, 2, 'same-order snapshots with non-sort changes reuse the cached order');
  assert.equal(nonSortRefreshedPlan.allItems.includes(nonSortReplacement), true, 'cached order resolves to fresh same-ID row objects');
  data[1].LOCATIONCODE = 'ZZ.1';
  sourceRevision = 'r2';
  ctx.buildSuspendTagRenderPlan(data);
  assert.equal(sortCalls, 3, 'source revision changes invalidate the ordered rows');
  const replacement = { ...data[1], LOCATIONCODE: 'ZZ.2', date: '2026-10-20' };
  data[1] = replacement;
  sourceRevision = 'r3';
  const revised = ctx.buildSuspendTagRenderPlan(data);
  assert.equal(sortCalls, 4, 'a same-ID replacement snapshot does not reuse prior row objects');
  assert.equal(revised.allItems.at(-1), data[1]);
  assert.equal(revised.allItems.at(-1), replacement);
  identityScope = 'manager-b';
  ctx.buildSuspendTagRenderPlan(data);
  assert.equal(sortCalls, 5, 'identity changes never reuse a previous scope cache');
  ctx.pageIndex = 95;
  assert.equal(ctx.buildSuspendTagRenderPlan(data).rows.length, 39);
});

test('Suspend source stays empty and stable until the active account snapshot is available', () => {
  const empty = Object.freeze([]);
  const ctx = vm.createContext({EMPTY_DOCK_SUSPEND_SOURCE_ROWS: empty, activeReqTab: 'suspend-tag',
    activeDetailSourceView: '', suspendTagInventoryScope: 'old-account', suspendTagInventory: [{ UNIQUE_ID: 'private-old-row' }],
    socInventory: [{ UNIQUE_ID: 'soc-row' }], getCurrentVisibleViewId: () => 'request', getSupabaseReadIdentityScope: () => 'new-account'});
  vm.runInContext(source('getDockSuspendDcSourceRows'), ctx);
  assert.equal(ctx.getDockSuspendDcSourceRows(), empty);
  assert.equal(ctx.getDockSuspendDcSourceRows(), ctx.getDockSuspendDcSourceRows(), 'repeated cold reads cannot restart preparation through a new array identity');
  ctx.suspendTagInventoryScope = 'new-account';
  ctx.suspendTagInventory = [{ UNIQUE_ID: 'new-account-row' }];
  assert.equal(ctx.getDockSuspendDcSourceRows(), ctx.suspendTagInventory);
});
