import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: drive
import test from 'node:test';

test('inventory projects expose folder and row workflows', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../assets/app-runtime.js', import.meta.url), 'utf8');
  assert.match(html, /id="inventory-open-projects"/);
  assert.match(html, /id="batch-btn-project"/);
  for (const action of ['projects_read','project_save','project_add_rows','project_update_row','project_delete']) assert.match(runtime, new RegExp(action));
});
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const html = readComposedAppSource();
const source = name => html.match(new RegExp('        function ' + name + '\\([^]*?^        }', 'm'))?.[0] || assert.fail(name);

test('AV marks a cold administrator catalog partial and prefers complete master over an old AV slice', () => {
  const master = Array.from({ length: 9600 }, (_, id) => ({ UNIQUE_ID: id }));
  let complete = false;
  const ctx = vm.createContext({ fullInventory: master, avOpenInventory: master.slice(0, 76), activeAVTab: 'open',
    canUseProductionLiveSync: () => true, shouldUseRepAvOpenDataset: () => false,
    getDatasetState: () => ({ rowCompleteness: complete ? 'complete' : 'partial' }),
    isDatasetLoaded: key => key === 'avOpen' || complete,
  });
  vm.runInContext(source('isAvLiveCatalogIncomplete') + source('selectAvSalesInventorySourceRows'), ctx);
  assert.equal(ctx.isAvLiveCatalogIncomplete(), true, 'a 76-row admin preview must never be advertised as complete');
  complete = true;
  ctx.shouldUseRepAvOpenDataset = () => true;
  assert.equal(ctx.selectAvSalesInventorySourceRows().length, 9600, 'the complete master supersedes a previously loaded AV subset');
});

test('published stock with a blank ERP review field renders numeric zero without inventing unknown stock', () => {
  const first = (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '';
  const ctx = vm.createContext({ firstNonEmptyValue: first,
    parseAppNumber: value => value === '' || value == null ? null : Number(value),
    normalizeCardQuantityValue: value => value === '' ? '0' : String(value),
  });
  vm.runInContext(source('getCardPtrReviewedValue'), ctx);
  for (const qty of [78, 216]) assert.equal(ctx.getCardPtrReviewedValue({ PTRREVIEWED: '', PTRONHAND: qty, PTRAVAILABLE: qty }, { preserveUnknown: true }), '0');
  assert.equal(ctx.getCardPtrReviewedValue({}, { preserveUnknown: true }), null);
});

test('completed AV hydration refreshes search results while preserving the focused search input', () => {
  const input = { id: 'av-search', matches: () => true };
  let rendered = 0;
  const ctx = vm.createContext({ document: { hidden: false, activeElement: input },
    window: { AgMetricLiveSyncRegistry: { views: { av: { kind: 'data' } } } },
    getCurrentVisibleViewId: () => 'av', productionVerifiedViewKey: () => 'av:owner', VIEW_LOAD_UI: {},
    productionLiveSyncRenderGeneration: 0, productionLiveSyncRenderPending: false,
    productionLiveSyncDraftChanged: false, productionLiveSyncActiveRender: null, productionLiveSyncRendering: false,
    latestViewRenderTokensByView: { av: 1 }, canUseProductionLiveSync: () => true,
    hasProductionLiveSyncDraft: () => false, captureProductionRefreshAnchor: () => ({}),
    isProductionRefreshCurrent: () => true, restoreProductionRefreshAnchor() {}, finishProductionRefresh() {},
    markViewDirty() {}, renderViewContent: () => { rendered++; },
    scheduleTypingAwareUiRender: (_key, run) => run(),
  });
  vm.runInContext(source('scheduleProductionLiveSyncRender'), ctx);
  ctx.scheduleProductionLiveSyncRender(true);
  assert.equal(rendered, 1, 'a focused search must not leave a finished catalog stuck at its preview results');
  assert.equal(ctx.document.activeElement, input);
});

test('Drive accepts the first authorized master page while settings and remaining pages are pending', () => {
  const rows = Array.from({ length: 500 }, (_, id) => ({ UNIQUE_ID: `row-${id}` }));
  const calls = [];
  const context = vm.createContext({ productionDisplayMasterReceipt: null, fullInventory: [], avOpenInventory: [], activeAVTab: 'open',
    hasProductionLiveSyncDraft: () => false, confirmedArgosReclassLiveEditRevisions: new Map(),
    getArgosReclassLiveEditIdentityKey: () => 'dylan', getCurrentPreparedMasterRows: () => null,
    processAndLoadData: payload => { calls.push(payload.data.length); },
    productionDisplayGroupKey: () => 'drive', productionDisplaySnapshotTimes: new Map(),
    productionDisplayGroups: new Set(), productionDisplayVerifiedAt: new Map(),
    productionLiveSyncCoordinator: { getStatus: () => ({ state: 'Syncing' }) },
    renderProductionDataFreshness() {}, invalidateResolvedViewStateCaches() {},
    scheduleProductionLiveSyncRender: () => calls.push('render'),
  });
  vm.runInContext(source('previewProductionSnapshots'), context);
  context.previewProductionSnapshots([{ adapter: { id: 'core:master' }, value: { payload: { data: rows }, partial: true } }],
    { view: 'drive', progressive: true, visible: true, partialCohort: true });
  assert.deepEqual(calls, [500, 'render']);
  assert.equal(context.productionDisplayGroups.has('drive'), true);
});

test('Home ready-source summary survives a narrower Drive revision response and clears on account change', () => {
  let owner = 'dylan:login-1';
  const context = vm.createContext({ datasetRevisionConnectionOwner: '', datasetRevisionConnectionStates: [],
    getSupabaseReadIdentityScope: () => owner, updateSyncDiagnostics() {}, hasActiveManualSync: () => true,
    window: { GncUserAccessControl: { getSelfState: () => ({ denied: false }) } } });
  vm.runInContext(source('recordDatasetRevisionConnection') + source('getDatasetRevisionConnectionLabel'), context);
  const record = sources => context.recordDatasetRevisionConnection({ contractVersion: 1, permissionVersion: 'p1', sources }, {},
    { readIdentity: owner, authenticated: true, accessDenied: false });
  const home = Array.from({ length: 11 }, (_, i) => ({ key: `source-${i}`, state: 'ready' }));
  record(home);
  record(home.slice(0, 2));
  assert.equal(context.getDatasetRevisionConnectionLabel(), 'Connected · 11 ready');
  record([{ key: 'source-0', state: 'importing' }]);
  assert.equal(context.getDatasetRevisionConnectionLabel(), 'Connected · 10 ready · 1 updating');
  owner = 'brian:login-2';
  record(home.slice(0, 2));
  assert.equal(context.getDatasetRevisionConnectionLabel(), 'Connected · 2 ready');
});

test('cold Drive and AV retry a transient direct API preview without waiting for coordinator completion', async () => {
  const recoverySource = html.match(/        async function recoverColdInventoryView\([^]*?^        }/m)?.[0];
  assert.ok(recoverySource);
  for (const [view, user] of [['drive', 'dylan_collyge'], ['drive', 'brian_hatfield'], ['av', 'brian_hatfield']]) {
    let requests = 0, previews = 0, continued = 0;
    const load = {};
    const scope = { signal: new AbortController().signal, isCurrent: () => true, dispose() {} };
    const ctx = { authenticated: true, accessDenied: false, visible: true, dataPermissionVersion: 'p1',
      adapters: [{ id: 'core:master' }] };
    const context = vm.createContext({ productionLiveSyncViewLoad: load,
      window: { AgMetricLifecycle: { createScope: () => scope } }, APP_API_FUNCTION_URL: '/app-api',
      getCurrentVisibleViewId: () => view, getSupabaseReadIdentityScope: () => user,
      getProductionLiveSyncContext: () => ctx, hasProgressiveViewData: () => false,
      getProductionCoreLiveProjection: () => view === 'av' ? 'full' : 'browse',
      postAppFunctionJson: async (_url, body) => {
        requests++;
        assert.equal(body.action, 'inventory_read');
        assert.equal(body.params.limit, 200);
        if (requests === 1) throw Object.assign(new Error('Temporary unavailable'), { status: 503 });
        return { ok: true, data: { rows: [{ unique_id: 'authorized' }] } };
      },
      isSupabaseReadRetryable: error => error.status === 503, validateInventoryReadProjection() {},
      prepareProductionMasterSnapshot: async rows => ({ payload: { data: rows }, rowCount: rows.length }),
      previewProductionSnapshots: snapshots => { previews++; assert.equal(snapshots[0].value.rowCompleteness, 'partial'); },
      getProductionLiveSyncCoordinator: () => ({ signal: () => continued++ }),
      showAvReadUnavailableState: error => assert.fail(error.message),
    });
    vm.runInContext(recoverySource, context);
    const started = performance.now();
    await context.recoverColdInventoryView(view, load);
    assert.ok(performance.now() - started < 2500);
    assert.equal(requests, 2);
    assert.equal(previews, 1);
    assert.equal(continued, 1);
    await context.recoverColdInventoryView(view, load);
    assert.equal(requests, 2, 'one bounded recovery per view load');
  }
});

test('Dylan and Brian fetch all 9600 inventory rows and build the complete A-Z Common Name catalog', async () => {
  const fetchSource = html.match(/        async function fetchAllInventoryReadRows\([^]*?^        }/m)?.[0];
  assert.ok(fetchSource);
  const rows = Array.from({ length: 9600 }, (_, i) => ({ unique_id: `id-${i}`, COMMONNAME: `${String.fromCharCode(65 + i % 26)} Plant`, CONTSIZE: '#3' }));
  for (const user of ['dylan_collyge', 'brian_hatfield']) {
    let firstPageRows = 0;
    let catalog = [];
    const context = vm.createContext({ currentUser: user, activeDriveMode: 'ok', DRIVE_MODE_LABELS: { ok: 'Drive Mode' },
      driveViewLevel: 0, selectedDriveName: null, driveDrillGroupStateCache: new Map(),
      shouldLockDriveSearchToTopLevel: () => false, getDrivePlantCommonName: row => row.COMMONNAME,
      getDrivePlantContSize: row => row.CONTSIZE, compareDriveCommonName: (a, b) => a.localeCompare(b),
      renderDriveCommonNameGroupCard() {}, renderDriveDrillEntries: (_container, _crumb, _label, groups) => { catalog = groups; },
      fetchInventoryReadPage: async (_op, _params, limit, offset) => ({ rows: rows.slice(offset, offset + limit),
        total: rows.length, projection: 'browse', fieldCoverage: 'browse', columns: ['unique_id'], hasMore: offset + limit < rows.length }),
      yieldToUiFrame: async () => {}, console,
    });
    vm.runInContext(fetchSource + source('renderDriveCommonNameDrill'), context);
    const started = performance.now();
    const hydrated = await context.fetchAllInventoryReadRows('master_page', { dataset: 'master', projection: 'browse' },
      { limit: 500, pageConcurrency: 2, requireComplete: true, onFirstPage: page => { firstPageRows = page.length; } });
    context.renderDriveCommonNameDrill({}, {}, '', { visibleItems: hydrated, resolvedStateKey: user });
    assert.equal(firstPageRows, 500);
    assert.equal(hydrated.length, 9600);
    assert.equal(hydrated.readMeta.rowCompleteness, 'complete');
    assert.equal(catalog.length, 26);
    assert.equal(catalog[0].name, 'A Plant');
    assert.equal(catalog.at(-1).name, 'Z Plant');
    assert.equal(catalog.reduce((total, group) => total + group.rowCount, 0), 9600);
    assert.ok(performance.now() - started < 2500, 'Node fixture hydration and grouping budget');
  }
});

test('a new inventory read generation detaches an unresponsive cancelled request', async () => {
  const pending = {};
  pending.promise = new Promise(resolve => { pending.resolve = resolve; });
  const context = vm.createContext({ AbortController, productionLiveSyncReadGeneration: 1,
    supabaseReadInFlight: new Map(), supabaseReadLatestByKey: new Map(), supabaseReadTerminalDenials: new Map(),
    getSupabaseReadIdentityScope: () => 'dylan', getSupabaseReadCooldownKey: (owner, key) => JSON.stringify([owner, key]),
    getSupabaseReadTerminalKey: (_owner, key) => key, incrementInternalPerfCounter() {},
    runSupabaseReadTask: task => Promise.resolve().then(task), runSupabaseReadWithBackoff: (_key, task) => task(),
    redactEvalSensitiveData: result => result, staleSupabaseReadScopeError: () => new Error('stale'),
  });
  vm.runInContext(source('runDedupeSupabaseRead'), context);
  const obsolete = context.runDedupeSupabaseRead('inventory_read:master_page', () => pending.promise).catch(() => 'stale');
  await Promise.resolve();
  context.productionLiveSyncReadGeneration = 2;
  let completed = false;
  const fresh = context.runDedupeSupabaseRead('inventory_read:master_page', async () => ['fresh']).then(result => { completed = true; return result; });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const beforeObsoleteSettled = completed;
  pending.resolve(['old']);
  assert.deepEqual(await fresh, ['fresh']);
  assert.equal(await obsolete, 'stale');
  assert.equal(beforeObsoleteSettled, true);
});

test('Brian and admin render a prepared 9600-row Drive snapshot in one pass through the same catalog path', () => {
  const registryContext = vm.createContext({ module: { exports: {} } });
  vm.runInContext(fs.readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8'), registryContext);
  const registry = registryContext.module.exports;
  const rows = Array.from({ length: 9600 }, (_, index) => ({ UNIQUE_ID: `row-${index}` }));
  for (const role of ['admin', 'salesrep', 'sales rep', 'sales_rep']) {
    let passes = 0;
    assert.deepEqual(Array.from(registry.getViewAdapters('drive', { driveAssignmentsRequired: role !== 'admin' })),
      ['core:master', 'side:settings']);
    const context = vm.createContext({ currentRole: role, activeDriveMode: 'ok', activeDriveTab: 'name', driveViewLevel:0, canUseProductionLiveSync:()=>true, getDatasetState:()=>({rowCompleteness:'complete'}),
      DRIVE_MODE_LABELS: { ok: 'Drive Mode' },
      document: { getElementById: () => ({ classList: { remove() {} }, setAttribute() {} }) },
      ensureViewDataForRender: () => false, syncDriveModeTabs() {}, syncDriveTabPills() {},
      renderDriveUniversalSearchResultsOnly: () => false, hideDrivePlantFilters() {},
      buildDriveVisibleItemsState: () => ({ baseSearchFilteredItems: rows }),
      scheduleDriveTopControlsRender() {}, renderDriveQuickRequestBar() {},
      renderDriveCommonNameDrill: (_container, _crumb, _label, state) => {
        passes++; assert.equal(state.baseSearchFilteredItems.length, 9600);
      } });
    vm.runInContext(source('renderDrive'), context);
    context.renderDrive();
    assert.equal(passes, 1, role);
  }
});

test('AV selects the same complete master and reserve projection for every authorized role', () => {
  for (const role of ['admin', 'salesrep', 'sales rep', 'sales_rep']) {
    const context = vm.createContext({ activeAVTab: 'open', pendingMasterFullHydrations: new Set(),
      getSupabaseReadIdentityScope: () => role, shouldUseRepAvOpenDataset: () => role !== 'admin' });
    vm.runInContext(source('getProductionCoreLiveProjection'), context);
    for (const key of ['avOpen', 'master', 'reserves']) {
      assert.equal(context.getProductionCoreLiveProjection(key, 'av'), 'full', `${role}/${key}`);
    }
    assert.equal(context.getProductionCoreLiveProjection('master', 'drive'), 'browse');
  }
});
function fixture(mode) {
  const driveSearchInput = { value: 'Maple', classList: { add() {} }, removeAttribute() {} };
  const context = vm.createContext({ Set, activeDriveMode: mode, activeDriveTab: 'name', driveViewLevel: 3,
    selectedDriveName: 'Maple', selectedDriveSize: '#3', selectedDriveSeason: 'F1', selectedDriveProgram: null,
    selectedDriveBlock: null, selectedDriveLoc: null, selectedDriveCommonNames: new Set(['Maple']),
    driveCommonNameSearchTerm: 'Maple', driveCommonNameFilterOpen: true,
    driveColumnFilters: { COMMONNAME: ['Maple'], LOCATIONCODE: ['A'] },
    getManagerAssignedColumnState: () => ({}), getCurrentVisibleViewId: () => 'drive',
    isDrawerOpen: () => false, getVisibleSecondaryBack: () => null, closeOpenInteractiveSurfaceForBack: () => false,
    window: {}, LocationCode: { back: () => false },
    cancelDriveSearchRenderWork() {}, getNavigationScrollPosition: () => 42, updateGlobalBackButton() {},
    runDirectTrackedNavigation: (_view, _key, apply) => { apply(); return false; },
    document: { getElementById: id => id === 'drive-search' ? driveSearchInput : ({ value: 'Maple', classList: { add() {} }, removeAttribute() {} }) },
    setDriveSearchManualSelectionLock() {}, restoreDriveStateAfterUniversalSearch() {}, syncDriveTabPills() {},
    scheduleDriveSearchRender() {},
  });
  for (const name of ['goBackUniversal', 'backToDriveSeasons', 'backToDriveSizes', 'backToDriveNames', 'resetDriveDrillSelectionState', 'clearDriveSearch', 'getDriveSearchTerm', 'hasActiveDriveSearchTerm']) vm.runInContext(source(name), context);
  return context;
}

function backHarness(view = 'drive') {
  const context = fixture('ok');
  context.document.getElementById('drive-search').value = '';
  const calls = [];
  Object.assign(context, {
    getCurrentVisibleViewId: () => view,
    viewHistoryStack: [],
    shouldResetIosPhoneMainScrollForView: () => false,
    fastBackToView: (target, options) => calls.push({ target, ...options }),
    fastBackHome: () => { calls.push({ target: 'home' }); return false; },
    syncGlobalModalBack: () => calls.push('modal-sync'),
    closeManagerAssignedColumnFilter: () => { calls.push('editor'); return false; },
    setMenuOpenState: () => calls.push('drawer'),
    activeAVTab: 'open', avOpenLevel: 3,
    selectedAvOpenName: 'Maple', selectedAvOpenSize: '#3',
    selectedAvOpenSeason: 'F1', selectedAvOpenLot: '27.F1',
    avResolvedBaseStateKey: 'cached', avResolvedBaseStateCache: { rows: ['cached'] },
    avResLevel: 2, selectedAvResRep: 'REP', selectedAvResDriveUid: 'UID',
    selectedAvResItemCode: 'ITEM', selectedAvResName: 'Maple', selectedAvResSize: '#3',
    clearSelectedAvReserveCustomerCardState: () => calls.push('clear-reserve-customer'),
    clearSelectedAvResRep: () => { context.selectedAvResRep = null; calls.push('clear-rep'); },
    scheduleAVRender: () => calls.push('render-av'),
  });
  vm.runInContext(source('restorePreviousViewFromHistory'), context);
  return { context, calls };
}

test('universal Back closes the modal before editors, drawers, wizards or inventory drill', () => {
  const { context: f, calls } = backHarness();
  f.getManagerAssignedColumnState = () => ({ editor: {} });
  f.isDrawerOpen = () => true;
  f.closeOpenInteractiveSurfaceForBack = () => { calls.push('wizard'); return true; };
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? { click: () => calls.push('modal') } : { click: () => calls.push('delegated') };
  assert.equal(f.goBackUniversal(), false);
  assert.deepEqual(calls, ['modal', 'modal-sync']);
  assert.equal(f.driveViewLevel, 3);
});

test('editor, drawer and wizard Back consume one action before inventory drill or delegation', () => {
  for (const surface of ['editor', 'drawer', 'wizard']) {
    const { context: f, calls } = backHarness();
    f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
    f.getManagerAssignedColumnState = () => ({ editor: surface === 'editor' ? {} : null });
    f.isDrawerOpen = () => surface === 'drawer';
    f.closeOpenInteractiveSurfaceForBack = () => {
      if (surface !== 'wizard') return false;
      calls.push('wizard'); return true;
    };
    assert.equal(f.goBackUniversal(), false);
    assert.deepEqual(calls, [surface]);
    assert.equal(f.driveViewLevel, 3);
  }
});

test('Drive drill takes exactly one step before delegated Back and preserves view history', () => {
  const { context: f, calls } = backHarness();
  f.viewHistoryStack.push({ viewId: 'tasks', scrollTop: 81 });
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
  for (const expectedLevel of [2, 1, 0]) {
    assert.equal(f.goBackUniversal(), false);
    assert.equal(f.driveViewLevel, expectedLevel);
    assert.deepEqual(calls, []);
    assert.equal(f.viewHistoryStack.length, 1);
  }
  f.driveCommonNameSearchTerm = '';
  f.goBackUniversal();
  assert.deepEqual(calls, ['delegated']);
  assert.equal(f.viewHistoryStack.length, 1);
});

test('AV open stock backs one drill level and invalidates its cache before delegation', () => {
  const { context: f, calls } = backHarness('av');
  f.viewHistoryStack.push({ viewId: 'tasks', scrollTop: 81 });
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
  for (const expectedLevel of [2, 1, 0]) {
    f.avResolvedBaseStateKey = 'cached'; f.avResolvedBaseStateCache = { rows: ['cached'] };
    assert.equal(f.goBackUniversal(), false);
    assert.equal(f.avOpenLevel, expectedLevel);
    assert.equal(f.selectedAvOpenSeason, null);
    assert.equal(f.selectedAvOpenLot, null);
    assert.equal(f.selectedAvOpenSize, expectedLevel >= 2 ? '#3' : null);
    assert.equal(f.selectedAvOpenName, expectedLevel >= 1 ? 'Maple' : null);
    assert.equal(f.avResolvedBaseStateKey, '');
    assert.equal(f.avResolvedBaseStateCache, null);
    assert.equal(f.viewHistoryStack.length, 1);
    assert.deepEqual(calls.splice(0), ['render-av']);
  }
  f.goBackUniversal();
  assert.deepEqual(calls, ['delegated']);
});

test('AV reserves preserves its single-step drill and rep selection before root delegation', () => {
  const { context: f, calls } = backHarness('av');
  f.activeAVTab = 'reserves';
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
  f.goBackUniversal();
  assert.equal(f.avResLevel, 1); assert.equal(f.selectedAvResDriveUid, null);
  assert.equal(f.selectedAvResItemCode, 'ITEM'); assert.equal(f.selectedAvResRep, 'REP');
  assert.deepEqual(calls.splice(0), ['clear-reserve-customer', 'render-av']);
  f.goBackUniversal();
  assert.equal(f.avResLevel, 0); assert.equal(f.selectedAvResItemCode, null);
  assert.equal(f.selectedAvResName, null); assert.equal(f.selectedAvResSize, null);
  assert.deepEqual(calls.splice(0), ['clear-reserve-customer', 'render-av']);
  f.goBackUniversal();
  assert.equal(f.selectedAvResRep, null);
  assert.deepEqual(calls.splice(0), ['clear-rep']);
  f.goBackUniversal();
  assert.deepEqual(calls, ['delegated']);
});

test('delegated subqueue Back precedes history, then history precedes Home fallback', () => {
  const { context: f, calls } = backHarness('request');
  f.activeReqTab = 'suspend-tag';
  f.viewHistoryStack.push({ viewId: 'tasks', scrollTop: 81 }, { viewId: 'request', scrollTop: 9 });
  let delegate = true;
  f.getVisibleSecondaryBack = modalOnly => !modalOnly && delegate ? { click: () => calls.push('subqueue') } : null;
  f.goBackUniversal();
  assert.deepEqual(calls.splice(0), ['subqueue']);
  assert.equal(f.viewHistoryStack.length, 2);
  delegate = false;
  f.goBackUniversal();
  assert.deepEqual(calls.splice(0), [{ target: 'tasks', fromHistory: true, targetScrollTop: 81 }]);
  assert.equal(f.viewHistoryStack.length, 0);
  f.goBackUniversal();
  assert.deepEqual(calls, [{ target: 'home' }]);
});

test('non-Home root with no history always has a Home fallback', () => {
  for (const view of ['drive', 'av', 'request', 'historical-requests']) {
    const { context: f, calls } = backHarness(view);
    f.driveViewLevel = 0; f.driveCommonNameSearchTerm = ''; f.selectedDriveName = null;
    f.avOpenLevel = 0; f.activeReqTab = 'suspend-tag';
    assert.equal(f.goBackUniversal(), false);
    assert.deepEqual(calls, [{ target: 'home' }], view);
  }
});

test('bottom-nav Drive keeps global Back visible through drill, modal cleanup and return Home', () => {
  const chromeCssStart = html.indexOf('        #global-header-search-row{');
  const chromeCssEnd = html.indexOf('        .drive-card-filter-grid{', chromeCssStart);
  assert.ok(chromeCssStart >= 0 && chromeCssEnd > chromeCssStart);
  const backCss = html.match(/\.amazon-inline-back\{[^}]+\}/)?.[0];
  assert.ok(backCss);
  const openPopoverCss = html.match(/#global-header-inline-back:popover-open\{[^}]+\}/)?.[0];
  assert.ok(openPopoverCss);
  const footerButton = html.match(/<button\b[^>]*data-footer-view="drive"[^>]*>[^]*?<\/button>/)?.[0];
  const backButton = html.match(/<button\b[^>]*id="global-header-inline-back"[^>]*>[^]*?<\/button>/)?.[0];
  assert.ok(footerButton && backButton);
  // JSDOM's UA stylesheet hides closed popovers, but its selector engine does
  // not observe our showPopover stub. Map only the actual open-popover rule to
  // a fixture state attribute so computed display models that native state.
  const modeledOpenPopoverCss = openPopoverCss.replace(':popover-open', '[data-fixture-popover-open]');
  const dom = new JSDOM(`<!doctype html><style>.hidden{display:none}${html.slice(chromeCssStart, chromeCssEnd)}${backCss}${modeledOpenPopoverCss}</style>
    <body class="current-view-home" data-current-view="home">
      <div id="global-header-search-row" class="hidden" hidden>${backButton}</div>
      <section id="view-home"></section><section id="view-drive" class="hidden"><input id="drive-search"></section>
      <nav id="bottom-nav">${footerButton}</nav>
      <div id="test-modal" class="hidden" role="dialog"><button data-secondary-back>Close</button></div>
    </body>`, { pretendToBeVisual: true });
  try {
    const { window } = dom;
    const { document } = window;
    const f = fixture('ok');
    const noop = () => {};
    Object.assign(f, {
      window, document, getComputedStyle: window.getComputedStyle.bind(window),
      currentPrimaryViewId: 'home', TRACKED_VIEW_IDS: ['drive'], viewHistoryStack: [],
      driveViewLevel: 0, selectedDriveName: null, selectedDriveSize: null, selectedDriveSeason: null,
      driveCommonNameSearchTerm: '', selectedDriveCommonNames: new Set(),
      searchRenderLastTerm: {}, driveQuickFiltersModalOpen: false, inventoryFieldCountingMode: false,
      selectedProductivityUser: '', requestSalesRepsManagerMode: false,
      lastGuardedViewSwitchKey: '', lastGuardedViewSwitchAt: 0, VIEW_SWITCH_DUPLICATE_GUARD_MS: 300,
      cartPanelOpen: false, bloomShareMenuOpen: false, bloomCropUpdateModalOpen: false,
      getPrimaryViewIds: () => ['home', 'drive'], getViewElementById: id => document.getElementById(`view-${id}`),
      isViewVisible: id => !!document.getElementById(`view-${id}`) && !document.getElementById(`view-${id}`).classList.contains('hidden'),
      canAccessView: () => true, canUseProductionLiveSync: () => false,
      shouldShowHomeProductivityBackButton: () => false, shouldResetIosPhoneMainScrollForView: () => false,
      getMainAreaScrollTop: () => 0, prepareManagerAssignedNavigation: (_from, _to, top) => top,
      ensureViewRenderState: () => ({ initialized: true, dirty: false }),
      shouldRunImmediateViewActivation: () => false, isTouchConstrainedDevice: () => false,
      beginInternalPerfMeasure: () => 0, getAdaptivePerfElapsedMs: () => 0,
      syncGlobalHeaderChrome: () => f.updateGlobalBackButton(),
      fastBackToView: id => { f.showOnlyPrimaryView(id); return false; },
      fastBackHome: () => { f.showOnlyPrimaryView('home'); return false; },
      bindFastPressTarget: (element, _kind, name, args) => { element.onclick = () => f[name](...args); },
    });
    for (const name of ['syncHomeDashboardBodyMode', 'syncRequestDetailScrollMode', 'repairAppShellScrollState',
      'cancelManagerSeasonPriorityRead', 'persistAppFilterStateNow', 'closeTaskDropdowns', 'beginDirectNavigationActivity',
      'destroyHistoricalRequestsIsland', 'cancelScheduledViewRenderWork', 'cancelChunkRenderWorkForView',
      'cancelScheduledUiRenderByPrefix', 'ensureNativeBackGuard', 'updateFooterNavState', 'scheduleStickyRailOffsetSync',
      'queueScrollMainAreaToTop', 'schedulePrimaryViewChromeRefresh', 'scheduleWarmViewFollowup',
      'recordGncPerfStat', 'reportPerformanceHealthEvent', 'recordInternalPerfDuration', 'scheduleHomeDashboardFitSettle']) f[name] = noop;
    window.AgMetricLifecycle = { enterView: noop };
    for (const name of ['getCurrentVisibleViewId', 'syncCurrentViewBodyClass', 'showOnlyPrimaryView',
      'getGlobalBackState', 'applyGlobalBackState', 'updateGlobalBackButton', 'getVisibleSecondaryBack',
      'syncGlobalModalBack', 'getDriveSearchTerm', 'hasActiveDriveSearchTerm', 'pruneViewHistoryStack',
      'pushViewHistoryEntry', 'restorePreviousViewFromHistory', 'switchView']) vm.runInContext(source(name), f);
    const footerBinding = html.match(/document\.querySelectorAll\('#bottom-nav \[data-footer-view\]'\)\.forEach\(\(element\) => \{[^]*?\n            \}\);/)?.[0];
    assert.ok(footerBinding, 'actual bottom-nav switchView binding');
    vm.runInContext(footerBinding, f);
    const button = document.getElementById('global-header-inline-back');
    const row = document.getElementById('global-header-search-row');
    const modal = document.getElementById('test-modal');
    let popoverOpen = false;
    const nativeMatches = button.matches.bind(button);
    button.matches = selector => selector === ':popover-open' ? popoverOpen : nativeMatches(selector);
    button.showPopover = () => { popoverOpen = true; button.setAttribute('data-fixture-popover-open', ''); };
    button.hidePopover = () => { popoverOpen = false; button.removeAttribute('data-fixture-popover-open'); };
    button.onclick = () => f.goBackUniversal();
    modal.querySelector('button').onclick = () => modal.classList.add('hidden');
    const assertBackVisible = stage => {
      assert.equal(f.getCurrentVisibleViewId(), 'drive', stage);
      assert.equal(f.currentPrimaryViewId, 'drive', stage);
      assert.equal(document.body.dataset.currentView, 'drive', stage);
      for (const element of [row, button]) {
        assert.notEqual(window.getComputedStyle(element).display, 'none', `${stage}: ${element.id} computed display`);
        assert.equal(element.hidden, false, `${stage}: ${element.id} hidden property`);
        assert.equal(element.classList.contains('hidden'), false, `${stage}: ${element.id} hidden class`);
      }
      assert.equal(button.disabled, false, stage);
      assert.ok(!button.hasAttribute('popover') || button.matches(':popover-open'), `${stage}: no closed popover`);
    };
    // Start with a stale closed promotion, as can remain after modal teardown.
    button.setAttribute('popover', 'manual');
    document.querySelector('#bottom-nav [data-footer-view="drive"]').click();
    assertBackVisible('Drive root');
    assert.equal(button.hasAttribute('popover'), false);
    // Forward transitions are controlled fixture state; Back executes the real drill helpers.
    for (const [level, stage] of [[1, 'Common Name'], [2, 'Container Size'], [3, 'Season']]) {
      f.driveViewLevel = level; f.selectedDriveName = 'ACCOLADE® ELM';
      f.selectedDriveSize = level >= 2 ? '#3' : null;
      f.selectedDriveSeason = level >= 3 ? 'U2' : null;
      f.updateGlobalBackButton();
      assertBackVisible(stage);
    }
    modal.classList.remove('hidden');
    f.syncGlobalModalBack();
    assertBackVisible('modal open');
    assert.equal(button.matches(':popover-open'), true);
    button.click();
    assert.equal(modal.classList.contains('hidden'), true);
    assert.equal(f.driveViewLevel, 3, 'closing the modal must not consume a drill step');
    assertBackVisible('modal closed');
    assert.equal(button.hasAttribute('popover'), false, 'normal Back must leave popover mode');
    assert.equal(button.hasAttribute('data-fixture-popover-open'), false, 'modal display model must not affect normal Back');
    for (const level of [2, 1, 0]) {
      button.click();
      assert.equal(f.driveViewLevel, level);
      assert.equal(f.selectedDriveSeason, null);
      assert.equal(f.selectedDriveSize, level >= 2 ? '#3' : null);
      assert.equal(f.selectedDriveName, level >= 1 ? 'ACCOLADE® ELM' : null);
      assertBackVisible(`Back to level ${level}`);
    }
    button.click();
    assert.equal(f.getCurrentVisibleViewId(), 'home');
    assert.equal(f.currentPrimaryViewId, 'home');
    assert.equal(document.body.dataset.currentView, 'home');
    assert.equal(button.hidden, true);
    assert.equal(row.hidden, true);
  } finally {
    dom.window.close();
  }
});
test('shared inventory navigation backs through Season, Container Size and Common Name in order', () => {
  for (const mode of ['ok']) {
    const f = fixture(mode);
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 2); assert.equal(f.selectedDriveSeason, null); assert.equal(f.selectedDriveSize, '#3');
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 1); assert.equal(f.selectedDriveSize, null); assert.equal(f.selectedDriveName, 'Maple');
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 0); assert.equal(f.selectedDriveName, null);
  }
});
test('clear search exits common-name filters immediately and preserves other column filters', () => {
  for (const mode of ['ok']) {
    const f = fixture(mode); f.activeDriveTab = 'loc'; f.clearDriveSearch();
    assert.equal(f.driveViewLevel, 0); assert.equal(f.activeDriveTab, 'name'); assert.equal(f.selectedDriveName, null);
    assert.equal(f.selectedDriveCommonNames.size, 0); assert.equal(f.driveCommonNameSearchTerm, '');
    assert.equal(f.driveCommonNameFilterOpen, false); assert.equal(f.driveColumnFilters.COMMONNAME, undefined);
    assert.deepEqual(f.driveColumnFilters.LOCATIONCODE, ['A']);
  }
});

test('AV search clear resets stored item drill and common-name column filters', () => {
  const f = vm.createContext({ avOpenLevel: 3, selectedAvOpenName: 'Maple', selectedAvOpenSize: '#3',
    selectedAvOpenSeason: 'F1', selectedAvOpenLot: '27.F1', avColumnFilters: { COMMONNAME: ['Maple'], CONTSIZE: ['#3'] },
    avResolvedBaseStateKey: 'old', avResolvedBaseStateCache: {},
    document: { getElementById: () => ({ value: 'Maple', classList: { add() {} } }) },
    resetAvSearchDrilldownState: () => { f.avOpenLevel = 0; },
    scheduleTrackedSearchViewRender() {}, isTouchConstrainedDevice: () => false });
  vm.runInContext(source('clearAVSearch'), f); f.clearAVSearch();
  assert.equal(f.avOpenLevel, 0); assert.equal(f.selectedAvOpenName, null); assert.equal(f.selectedAvOpenSeason, null);
  assert.equal(f.avColumnFilters.COMMONNAME, undefined); assert.deepEqual(f.avColumnFilters.CONTSIZE, ['#3']);
  assert.equal(f.avResolvedBaseStateCache, null);
});

test('AV entry from Home clears a stale search before rendering and focus sync keeps the live search node mounted', () => {
  const f = vm.createContext({
    avColumnFilters: { COMMONNAME: ['Red Yucca'], commonname: ['Red Yucca'], CONTSIZE: ['#3'] },
    avResolvedBaseStateKey: 'old', avResolvedBaseStateCache: {},
    selectedAvOpenName: 'Red Yucca', selectedAvOpenSize: '#3', selectedAvOpenSeason: 'F1', selectedAvOpenLot: '27.F1',
    document: { getElementById: id => id === 'av-search' ? input : id === 'av-search-clear' ? clearBtn : null },
    markViewDirty: view => { f.dirtyView = view; },
    resetAvSearchDrilldownState: () => { f.avOpenLevel = 0; }, avOpenLevel: 3
  });
  const input = { value: 'Blue point', isConnected: true };
  const clearBtn = { classList: { add: value => { clearBtn.added = value; } } };
  vm.runInNewContext(source('clearAvSearchForHomeEntry'), f);
  assert.equal(f.clearAvSearchForHomeEntry(), true);
  assert.equal(input.value, '');
  assert.equal(clearBtn.added, 'hidden');
  assert.equal(f.selectedAvOpenName, null);
  assert.equal(f.selectedAvOpenSeason, null);
  assert.equal(f.avColumnFilters.COMMONNAME, undefined);
  assert.deepEqual(f.avColumnFilters.CONTSIZE, ['#3']);
  assert.equal(f.avResolvedBaseStateCache, null);
  assert.equal(f.dirtyView, 'av');

  const chrome = source('syncGlobalHeaderChrome');
  const focusedStart = chrome.indexOf('if (focusedSearchIsAlreadyMounted)');
  const focusedEnd = chrome.indexOf('if (!nextOptions.force && chromeState.signature', focusedStart);
  assert.ok(focusedStart >= 0 && focusedEnd > focusedStart);
  assert.match(chrome.slice(focusedStart, focusedEnd), /syncGlobalHeaderSearchOwnership\(chromeState\.searchContainer\)[\s\S]*?return;/);
  assert.doesNotMatch(chrome.slice(focusedStart, focusedEnd), /appendChild|clearNodeChildren/);
  assert.match(html, /id="av-search"[^>]*autocomplete="off"[^>]*autocorrect="off"[^>]*autocapitalize="none"[^>]*spellcheck="false"/);
  assert.match(source('switchView'), /nextViewId === 'av' && currentViewId === 'home'\) clearAvSearchForHomeEntry\(\)/);
});

test('AV current-season F1 2027 rows remain searchable by multiword common name', () => {
  const extract = name => {
    const match = html.match(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(match, `expected ${name}`);
    const end = html.indexOf('\n        function ', match.index + match[0].length);
    assert.ok(end > match.index, `${name} boundary`);
    return html.slice(match.index, end);
  };
  const context = vm.createContext({ Array, Math, Number, Object, String,
    PICK_NOTE_CURRENT_SEASON_CODE: 'F1', AV_OPEN_MAX_SALES_YEAR: 27,
    getConfiguredCurrentSeasonCode: () => 'F1', getConfiguredCurrentSalesYearCode: () => 27,
    SEARCH_PROFILES: { av_open: item => [item.COMMONNAME, item.LOCATIONCODE, item.ITEMCODE, item.CONTSIZE, item.LOTCODE] } });
  const functions = [
    'firstNonEmptyValue', 'parseAppNumber', 'normalizeNcrSeasonCode', 'normalizeNcrSalesYearValue', 'parseNcrLotCode',
    'getNcrLotInfo', 'getNcrSalesYear', 'getAvConfiguredCurrentSeasonCode',
    'getAvConfiguredCurrentSalesYearCode', 'getAvComparableSalesYear', 'getAvSalesSeasonValue',
    'getAvSalesYearValue', 'getAvSalesYearNumber', 'itemMatchesAvCurrentSeasonBucket',
    'normalizeSearchValue', 'tokenizeSearchValue', 'isProgressiveSearchWordChar',
    'normalizedSearchTextHasWordStart', 'doesSearchProfilePrefixMatch', 'getSearchValuesForProfile', 'matchesItemSearch'
  ].map(extract).join('\n');
  vm.runInContext(functions, context);
  const rows = [
    { COMMONNAME: 'Red Yucca #7', ITEMCODE: '002900.070.1', LOCATIONCODE: 'G.17.000', LOTCODE: '27.F1', SEASON: 'F1', SALEYEAR: 27 },
    { COMMONNAME: 'Blue Point Juniper - 2 Tier Poodle #5', ITEMCODE: '000152.050.1', LOCATIONCODE: 'G.11.000', LOTCODE: '27.F1', SEASON: 'F1', SALEYEAR: 27 }
  ];
  for (const row of rows) assert.equal(context.itemMatchesAvCurrentSeasonBucket(row), true, row.COMMONNAME);
  assert.equal(context.matchesItemSearch(rows[0], 'Red yucca', 'av_open'), true);
  assert.equal(context.matchesItemSearch(rows[1], 'Blue point', 'av_open'), true);
  assert.equal(context.matchesItemSearch(rows[0], 'Blue point', 'av_open'), false);
});

function loginNavigationHarness() {
  const footer = html.match(/<nav id="bottom-nav"[^>]*>[^]*?<\/nav>/)?.[0];
  const back = html.match(/<button\b[^>]*id="global-header-inline-back"[^>]*>[^]*?<\/button>/)?.[0];
  assert.ok(footer && back);
  const dom = new JSDOM(`<!doctype html><style>.hidden,[hidden]{display:none!important}</style><body class="current-view-home">
    <section id="view-login"></section><div id="login-inputs"></div><div id="loading-spinner"></div>
    <div id="app-wrapper" class="hidden" hidden style="display:none"><main id="main-scroll-area">
    <div id="view-wrapper" class="hidden" hidden style="display:none">
    <section id="view-home" class="hidden" hidden style="display:none"><div id="home-dashboard-sticky"></div>
    <div id="home-dashboard-hero"></div><div id="home-dashboard-content" class="hidden">
    <div id="home-dashboard-modules" class="hidden"><button data-home-module-view="drive">Drive</button></div></div>
    <div id="home-dynamic-content">stale drill</div></section>
    <section id="view-drive" class="hidden"><input id="drive-search"></section>
    <section id="view-managers" class="hidden"></section><section id="view-docks" class="hidden"></section>
    <section id="view-request" class="hidden"></section></div></main>
    <div id="global-header-search-row" class="hidden" hidden>${back}</div>${footer}</div></body>`, { pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  const f = fixture('ok'), noop = () => {}, lifecycle = [], rendered = [];
  const views = ['home', 'drive', 'managers', 'docks', 'request'];
  const allowed = new Set(views.concat('communication'));
  Object.assign(f, {
    window, document, getComputedStyle: window.getComputedStyle.bind(window),
    currentPrimaryViewId: 'home', TRACKED_VIEW_IDS: views.filter(view => view !== 'home'),
    currentUser: 'manager_fixture', currentRole: 'ADMIN', activeHomeTab: 'dashboard',
    selectedProductivityUser: '', CROP_ROLL_HOME_TAB: 'crop-roll',
    driveQuickFiltersModalOpen: false, inventoryFieldCountingMode: false, requestSalesRepsManagerMode: false,
    searchRenderLastTerm: {}, viewHistoryStack: [],
    lastGuardedViewSwitchKey: '', lastGuardedViewSwitchAt: 0, VIEW_SWITCH_DUPLICATE_GUARD_MS: 300,
    cartPanelOpen: false, bloomShareMenuOpen: false, bloomCropUpdateModalOpen: false, selectedItems: new Set(),
    MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW: 'assigned-items', MANAGER_HR_COMMAND_VIEW: 'hr', MANAGER_PRODUCTION_SCHEDULE_VIEW: 'schedule',
    canAccessView: view => allowed.has(view), isFullAppAdministrator: () => false, canUseProductionLiveSync: () => false,
    isViewVisible: view => {
      const element = document.getElementById(`view-${view}`);
      return !!element && !element.hidden && !element.classList.contains('hidden');
    },
    getRoleAccessState: () => ({ isAdmin: true }), isSalesShellAccess: () => false,
    shouldShowHomeProductivityBackButton: () => false, shouldResetIosPhoneMainScrollForView: () => false,
    getMainAreaScrollTop: () => 0, prepareManagerAssignedNavigation: (_from, _to, top) => top,
    ensureViewRenderState: () => ({ initialized: true, dirty: false }),
    shouldRunImmediateViewActivation: () => false, isTouchConstrainedDevice: () => false,
    isIosPhoneRequestFlowView: () => false,
    shouldUseRepSalesHomeHub: () => false,
    beginInternalPerfMeasure: () => 0, getAdaptivePerfElapsedMs: () => 0,
    auditLocalRequestDurability: () => Promise.resolve(), syncAuraWidgetForSession: () => Promise.resolve(),
    runAfterShellInteractive: noop, setTimeout: noop,
    GncMobileWorkspace: { shell: noop },
    syncGlobalHeaderChrome: () => f.updateGlobalBackButton(),
    bindFastPressTarget: (element, _kind, name, args) => { element.onclick = () => f[name](...args); },
  });
  for (const name of ['syncHomeDashboardBodyMode', 'syncRequestDetailScrollMode', 'repairAppShellScrollState',
    'cancelManagerSeasonPriorityRead', 'persistAppFilterStateNow', 'closeTaskDropdowns', 'beginDirectNavigationActivity',
    'destroyHistoricalRequestsIsland', 'destroyManagerAssignedItemsView', 'cancelScheduledViewRenderWork',
    'cancelChunkRenderWorkForView', 'cancelScheduledUiRenderByPrefix', 'ensureNativeBackGuard',
    'scheduleStickyRailOffsetSync', 'queueScrollMainAreaToTop', 'schedulePrimaryViewChromeRefresh',
    'scheduleWarmViewFollowup', 'recordGncPerfStat', 'reportPerformanceHealthEvent', 'recordInternalPerfDuration',
    'incrementInternalPerfCounter',
    'scheduleHomeDashboardFitSettle', 'clearIosPhoneRequestFlowState', 'scheduleRequestNavigationLiveWake',
    'configureNavigationPreferences', 'scheduleIosBottomNavViewportLock', 'clearLoginStartupWatchdog',
    'blurActiveField', 'setLoginProgress', 'finishInitialAppLoad', 'setMenuOpenState', 'syncRoleAccessUi',
    'applyRolePermissions', 'ensureHomeDashboardReadyAfterLogin', 'refreshRealtimeSubscriptionsForCurrentView',
    'syncGoogleScriptButton']) f[name] = noop;
  window.AgMetricLifecycle = { enterView: view => {
    const element = document.getElementById(`view-${view}`);
    lifecycle.push({ view, hidden: element.hidden || element.classList.contains('hidden'),
      wrapperHidden: document.getElementById('view-wrapper').hidden, bodyView: document.body.dataset.currentView });
  } };
  for (const name of ['getPrimaryViewIds', 'getViewElementById', 'getCurrentVisibleViewId', 'syncCurrentViewBodyClass',
    'showOnlyPrimaryView', 'getGlobalBackState', 'applyGlobalBackState', 'updateGlobalBackButton', 'getVisibleSecondaryBack',
    'canShowFooterViewButton', 'updateFooterNavState', 'pruneViewHistoryStack', 'pushViewHistoryEntry',
    'setHomeDashboardModulesReady', 'renderHome', 'openAppShellAfterLogin', 'switchView']) vm.runInContext(source(name), f);
  const renderHome = f.renderHome;
  f.renderHome = () => { rendered.push('home'); return renderHome(); };
  // Existing footer buttons receive their handlers during shell initialization;
  // preferences retain those buttons and only bind newly created shortcuts.
  const footerBinding = html.match(/document\.querySelectorAll\('#bottom-nav \[data-footer-view\]'\)\.forEach\(\(element\) => \{[^]*?\n            \}\);/)?.[0];
  assert.ok(footerBinding, 'actual bottom-nav switchView binding');
  vm.runInContext(footerBinding, f);
  return { dom, window, document, f, allowed, lifecycle, rendered };
}

test('completing login mounts Home synchronously even with a preset or prefixed Home identity', t => {
  for (const preset of ['home', 'view-home']) {
    const h = loginNavigationHarness();
    t.after(() => h.dom.window.close());
    h.f.currentPrimaryViewId = preset;
    h.f.openAppShellAfterLogin(false);
    for (const id of ['app-wrapper', 'view-wrapper', 'view-home', 'home-dashboard-content', 'home-dashboard-modules']) {
      const element = h.document.getElementById(id);
      assert.equal(element.hidden, false, `${preset}: ${id}`);
      assert.equal(element.classList.contains('hidden'), false, `${preset}: ${id}`);
      assert.notEqual(h.window.getComputedStyle(element).display, 'none', `${preset}: ${id}`);
    }
    assert.equal(h.f.currentPrimaryViewId, 'home');
    assert.equal(h.document.body.dataset.currentView, 'home');
    assert.equal(h.document.getElementById('view-login').style.display, 'none');
    assert.deepEqual(h.rendered, ['home'], 'Home renders before any queued warmup/watchdog');
    assert.equal(h.document.getElementById('home-dynamic-content').textContent, '');
    assert.ok(h.document.querySelector('#home-dashboard-modules button'));
    assert.deepEqual(h.lifecycle, [{ view: 'home', hidden: false, wrapperHidden: false, bodyView: 'home' }]);
  }
});

test('same-view warm navigation repairs hidden Home and wrapper without requiring a round trip', t => {
  const h = loginNavigationHarness();
  t.after(() => h.dom.window.close());
  h.f.repairHomeDashboardShell = () => h.f.renderHome();
  h.f.switchView('home');
  for (const id of ['view-wrapper', 'view-home']) {
    const element = h.document.getElementById(id);
    assert.equal(element.hidden, false, id);
    assert.notEqual(h.window.getComputedStyle(element).display, 'none', id);
  }
  assert.equal(h.document.body.dataset.currentView, 'home');
  assert.equal(h.document.querySelector('[data-footer-view="home"]').classList.contains('active'), true);
});

test('actual personalized Manager, Docks and Que footer buttons switch from Home with visible Back and preserve denials', async t => {
  const h = loginNavigationHarness();
  t.after(() => h.dom.window.close());
  vm.runInContext(fs.readFileSync(new URL('../assets/navigation-preferences.js', import.meta.url), 'utf8'), h.f);
  const preferences = h.window.GncNavigationPreferences;
  preferences.configure({ username: () => h.f.currentUser, canAccess: view => h.f.canAccessView(view),
    navigate: view => h.f.switchView(view),
    call: async () => ({ username: h.f.currentUser, shortcuts: ['managers', 'docks', 'request'],
      views: ['home', 'communication', 'managers', 'docks', 'request'].map(view => ({ view, label: view === 'managers' ? 'Manager' : view,
        selectable: true, allowed: true })) }),
  });
  await preferences.refresh();
  h.f.openAppShellAfterLogin(false);
  for (const view of ['managers', 'docks', 'request']) {
    h.f.showOnlyPrimaryView('home');
    const button = h.document.querySelector(`#bottom-nav [data-footer-view="${view}"]`);
    assert.ok(button, `${view}: use the real preferences-created footer button`);
    button.click();
    assert.equal(h.f.getCurrentVisibleViewId(), view);
    assert.equal(h.document.body.dataset.currentView, view);
    assert.equal(h.document.getElementById('view-home').classList.contains('hidden'), true);
    assert.equal(h.document.getElementById(`view-${view}`).hidden, false);
    assert.equal(h.document.getElementById(`view-${view}`).classList.contains('hidden'), false);
    assert.equal(button.classList.contains('active'), true);
    for (const id of ['global-header-search-row', 'global-header-inline-back']) {
      const element = h.document.getElementById(id);
      assert.equal(element.hidden, false, `${view}: ${id}`);
      assert.notEqual(h.window.getComputedStyle(element).display, 'none', `${view}: ${id}`);
    }
    assert.equal(h.document.getElementById('global-header-inline-back').disabled, false);
  }
  h.f.showOnlyPrimaryView('home');
  const manager = h.document.querySelector('#bottom-nav [data-footer-view="managers"]');
  h.allowed.delete('managers');
  manager.click();
  assert.equal(h.f.getCurrentVisibleViewId(), 'home', 'the existing permission gate still rejects a denied shortcut');
  preferences.reset();
});

test('Manager submodules return to Modules immediately; Eval2 ITEMCODES mode returns to the hub, then Home', () => {
  for (const tab of ['customer-rep-map', 'access-control', 'season-settings', 'crop-roll', 'approval', 'season-priority', 'production-schedule', 'eval-reports-2', 'moves', 'productivity']) {
    const { context: f, calls } = backHarness('managers');
    f.activeHomeTab = tab;
    f.MANAGER_EVAL_REPORTS_2_VIEW = 'eval-reports-2';
    f.managerEvalReport2DetailItemKey = ''; f.managerEvalReport2BrowseMode = 'plant';
    f.managerRead = new Promise(() => {});
    f.managerEvalReport2DrillLevel = 3;
    f.openManagersModules = () => { f.activeHomeTab = 'dashboard'; calls.push('modules'); return false; };
    f.getVisibleSecondaryBack = () => ({ click: () => calls.push('old-module-back') });
    // An open modal still consumes its own Back; this scenario has none.
    const secondary = f.getVisibleSecondaryBack;
    f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : secondary();
    assert.equal(f.goBackUniversal(), false, tab);
    assert.equal(f.activeHomeTab, 'dashboard', tab);
    assert.deepEqual(calls.splice(0), ['modules'], tab);
    f.goBackUniversal();
    assert.deepEqual(calls, [{ target: 'home' }], tab);
  }
});

test('Manager Modules cancels stale render work and mounts the hub synchronously even from a separate child view', () => {
  const calls = [];
  let view = 'crop-roll';
  const f = vm.createContext({
    activeHomeTab: 'crop-roll', managersSearchTerm: 'old', selectedProductivityUser: 'person', managerMoveDestinationStage: 'pending',
    MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW: 'assigned-items', MANAGER_BLOCK_CLEARING_VIEW: 'block-clearing',
    managerReportPageController: { suspendMounts: () => calls.push('suspend-pages') },
    cancelManagerModuleReads: () => calls.push('cancel-module-reads'),
    cancelManagerSeasonPriorityRead: () => calls.push('cancel-read'),
    window: { GncProductionSchedule: { unmount: () => calls.push('unmount') } },
    unmountAlphaCommandCenter() {}, cancelScheduledViewRenderWork: () => calls.push('cancel-render'),
    cancelChunkRenderWorkForView: () => calls.push('cancel-chunks'),
    getCurrentVisibleViewId: () => view,
    switchView: target => { view = target; calls.push(target); },
    renderManagers: () => calls.push(`render:${f.activeHomeTab}`),
    updateFooterNavState() {}, updateGlobalBackButton() {}, syncGlobalHeaderChrome() {},
    renderHomeOrManagersNow: () => assert.fail('hub must not wait for a scheduled render'),
  });
  vm.runInContext(source('openManagersModules'), f);
  assert.equal(f.openManagersModules(), false);
  assert.equal(view, 'managers');
  assert.equal(f.activeHomeTab, 'dashboard');
  assert.ok(calls.indexOf('cancel-read') < calls.indexOf('render:dashboard'));
  assert.ok(calls.indexOf('cancel-render') < calls.indexOf('render:dashboard'));
  assert.ok(calls.includes('render:dashboard'));
});

test('Home Sales, Request Queue and Tasks tiles use the shared fast action and honor current access', () => {
  const calls = [], allowed = new Set(['sales', 'request', 'tasks']);
  let view = 'home';
  const f = vm.createContext({
    window: {}, activeReqTab: 'suspend-tag', requestViewLevel: 4, requestSalesRepsManagerMode: true,
    canAccessView: target => allowed.has(target), escapeHtml: value => String(value),
    esc: value => String(value).replace(/'/g, "\\'").replace(/"/g, '&quot;'),
    normalizeRequestTabValue: tab => tab, markViewDirty: target => calls.push(`dirty:${target}`),
    switchView: target => { view = target; calls.push(target); }, getCurrentVisibleViewId: () => view,
    renderSalesHub: () => calls.push('render-sales'),
  });
  for (const name of ['encodeFastPressArgs', 'decodeFastPressArgs', 'buildFastPressAttrs', 'buildFastInvokeAttrs',
    'dispatchFastPressAction', 'renderRepHomeDashboardTileMarkup', 'openHomeModuleView']) vm.runInContext(source(name), f);
  f.window.openHomeModuleView = f.openHomeModuleView;
  for (const target of ['sales', 'request', 'tasks']) {
    const markup = f.renderRepHomeDashboardTileMarkup({ view: target, title: target });
    const [, kind, action, args] = markup.match(/onclick="return handleFastPressClick\(event, '([^']+)', '([^']+)', '([^']+)'\)"/) || [];
    assert.equal(action, 'openHomeModuleView', target);
    assert.equal(f.dispatchFastPressAction(kind, action, args), true);
    assert.equal(view, target);
  }
  assert.ok(calls.includes('render-sales'), 'Sales hub renders in the activation turn');
  assert.equal(f.activeReqTab, 'pending');
  assert.equal(f.requestViewLevel, 0);
  assert.equal(f.requestSalesRepsManagerMode, false);
  allowed.delete('sales');
  f.openHomeModuleView('sales');
  assert.equal(view, 'tasks', 'confirmed denial must not navigate');
});

test('plant search ignores punctuation and accepts joined St John tokens', () => {
  const ctx = vm.createContext({});
  vm.runInContext(['normalizeSearchValue','tokenizeSearchValue','normalizedSearchTextHasWordStart','doesProgressiveSearchTextMatch','doesSearchProfilePrefixMatch'].map(source).join('\n'), ctx);
  for (const plant of ['Blue Velvet™ St. Johnswort','Cobalt-N-Gold™ St. Johnswort','Sunburst St. Johnswort']) {
    for (const query of ['st john','st. john','stjohn']) {
      assert.equal(ctx.doesProgressiveSearchTextMatch(plant, query), true, plant + query);
      assert.equal(ctx.doesSearchProfilePrefixMatch([plant],ctx.tokenizeSearchValue(query)), true, plant + query);
    }
  }
});

test('complete same-account master cannot be replaced by a partial preview', () => {
  const rows = Array.from({length:9600},(_,id)=>({id}));
  let processed = false;
  const ctx = vm.createContext({ fullInventory:rows, productionDisplayMasterReceipt:{rows,readScope:'owner',permission:'p'},
    hasProductionLiveSyncDraft:()=>false, getSupabaseReadIdentityScope:()=> 'owner',
    confirmedArgosReclassLiveEditRevisions:new Map(), getArgosReclassLiveEditIdentityKey:()=> 'owner',
    processAndLoadData:()=>{processed=true;}, invalidateResolvedViewStateCaches:()=>{}, scheduleProductionLiveSyncRender:()=>{} });
  vm.runInContext(source('previewProductionSnapshots'),ctx);
  ctx.previewProductionSnapshots([{adapter:{id:'core:master'},value:{rowCompleteness:'partial',payload:{data:rows.slice(0,200)}}}],
    {progressive:true,visible:true,partialCohort:true,view:'drive',dataPermissionVersion:'p'});
  assert.equal(processed,false); assert.equal(ctx.fullInventory.length,9600);
});

test('complete 9600-row inventory with 1613 names hydrates in bounded parallel pages',async()=>{
 const rows=Array.from({length:9600},(_,i)=>({unique_id:'row-'+i,commonname:i%1613===0?'Monarch™ Purple Holly':'Name '+(i%1613)}));
 let active=0,maxActive=0;
 const ctx=vm.createContext({console,yieldToUiFrame:async()=>{},fetchInventoryReadPage:async(_op,_params,limit,offset)=>{
  active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,2));active--;
  return {rows:rows.slice(offset,offset+limit),total:rows.length,hasMore:offset+limit<rows.length,projection:'browse',fieldCoverage:'browse',columns:['unique_id','commonname']};
 }});
 vm.runInContext(html.match(/        async function fetchAllInventoryReadRows\([^]*?^        }/m)[0],ctx);
 const start=performance.now();
 const full=await ctx.fetchAllInventoryReadRows('browse',{}, {limit:1000,pageConcurrency:4,requireComplete:true});
 assert.equal(full.length,9600);assert.equal(new Set(full.map(row=>row.commonname)).size,1613);
 assert.equal(full.readMeta.rowCompleteness,'complete');assert.equal(maxActive,4);
 assert.ok(full.some(row=>row.commonname.toLowerCase().includes('mon')));
 assert.ok(performance.now()-start<2000);
 console.log('9600-row mocked page hydration: '+(performance.now()-start).toFixed(2)+'ms');
});

test('1000-row master pages preserve the aggregate RPC 500-row safety bound',()=>{
 const api=fs.readFileSync(new URL('../supabase/functions/app-api/index.ts',import.meta.url),'utf8');
 const page=api.slice(api.indexOf('    if (operation === "master_page") {'),api.indexOf('    if (operation === "master_identity_batch")'));
 assert.match(page,/inventoryReadPageBounds\(params, 1000\)/);
 assert.match(page,/projected.slice\(0, 500\)/);assert.match(page,/projected.slice\(500\)/);
 assert.match(page,/enrichInventoryLocationRows\(supabase, String\(actor.id \|\| ""\), batch, inventoryRevision\)/);
});

 test('plant name word starts outrank substrings for st and st jo', () => {
 const ctx=vm.createContext({});
 vm.runInContext(['normalizeSearchValue','tokenizeSearchValue','isProgressiveSearchWordChar','normalizedSearchTextHasWordStart','getPlantSearchRank'].map(source).join('\n'),ctx);
 for(const term of ['st','st jo']) for(const name of ['Blue Velvet™ St. Johnswort','Cobalt-N-Gold™ St. Johnswort','Sunburst St. Johnswort']) {
 assert.ok(ctx.getPlantSearchRank(name,term)<ctx.getPlantSearchRank('Alaska Shasta Daisy',term));
 assert.ok(ctx.getPlantSearchRank(name,term)<ctx.getPlantSearchRank('Queen Josephine Hosta',term)); }
 });

test('AV rendered search ranks St John word starts before Shasta and Hosta even with lower priority', () => {
 const ctx=vm.createContext({activeAVTab:'open',activeAvOpenTab:'cards'});
 vm.runInContext(source('normalizeSearchValue')+source('tokenizeSearchValue')+source('isProgressiveSearchWordChar')+source('normalizedSearchTextHasWordStart')+source('getPlantSearchRank')+source('buildAVExportContext'),ctx);
 const rows=[{COMMONNAME:'Alaska Shasta Daisy',PRIORITY:1},{COMMONNAME:'Queen Josephine Hosta',PRIORITY:1},{COMMONNAME:'Blue Velvet St. Johnswort',PRIORITY:9},{COMMONNAME:'Cobalt-N-Gold St. Johnswort',PRIORITY:9}];
 for(const term of ['st','st jo']) assert.deepEqual(Array.from(ctx.buildAVExportContext(rows,term).rows.slice(0,2),row=>row.COMMONNAME),['Blue Velvet St. Johnswort','Cobalt-N-Gold St. Johnswort']);
});

test('cold Drive withholds a partial 27-name catalog and retains the complete catalog through refresh', () => {
 let complete=false,painted=0; const attrs=new Map();const container={innerHTML:'',classList:{remove(){}},hasAttribute:key=>attrs.has(key),setAttribute:(key,value)=>attrs.set(key,value)};
 const ctx=vm.createContext({activeDriveTab:'name',activeDriveMode:'ok',driveViewLevel:0,DRIVE_MODE_LABELS:{ok:'Drive Mode'},fullInventory:[],productionDisplayMasterReceipt:null,
 ensureViewDataForRender:()=>false,syncDriveModeTabs(){},syncDriveTabPills(){},document:{getElementById:()=>container},renderDriveUniversalSearchResultsOnly:()=>false,hideDrivePlantFilters(){},
 buildDriveVisibleItemsState:()=>({baseSearchFilteredItems:Array.from({length:complete?1613:27})}),scheduleDriveTopControlsRender(){},renderDriveQuickRequestBar(){},
 canUseProductionLiveSync:()=>true,getDatasetState:()=>({rowCompleteness:complete?'complete':'partial'}),syncDriveCrumb(){},
 renderDriveCommonNameDrill:(_c,_b,_l,state)=>{painted++;container.innerHTML=String(state.baseSearchFilteredItems.length)+' names';}});
 vm.runInContext(source('renderDrive'),ctx);
 ctx.renderDrive();assert.equal(painted,0);assert.doesNotMatch(container.innerHTML,/27 names/);
 complete=true;ctx.renderDrive();assert.equal(container.innerHTML,'1613 names');
 complete=false;ctx.renderDrive();assert.equal(container.innerHTML,'1613 names');assert.equal(painted,1);
 const commonName=source('renderDriveCommonNameDrill');assert.ok(!commonName.includes('driveViewLevel > 3) driveViewLevel = 3'));
 const renderContent=html.match(/        function renderViewContent\([^]*?^        }/m)[0];
 assert.ok(renderContent.includes('!selectedDriveName && !selectedDriveLoc && driveViewLevel === 0'));
});

test('phone footer, Bloom clear and dark missing-photo surfaces have high contrast without filename clipping', () => {
 const css=fs.readFileSync(new URL('../assets/app-shell-style-15.css',import.meta.url),'utf8');
 for(const token of ['#062115','#0b3522','#d9fbe8','#15803d','#4ade80','#dc2626','#ffffff','rgba(10,38,25,.85)'])assert.ok(css.includes(token),token);
 assert.ok(css.includes('max-height:none'));assert.ok(css.includes('overflow:visible'));
});


test('9600-row indexes pre-sum locations, preserve lots, and pre-normalize search within 5ms', () => {
  const context = { Map, WeakMap, Set };
  vm.runInNewContext(fs.readFileSync(new URL('../assets/queue-inventory-hydration.js', import.meta.url), 'utf8'), context);
  const rows = Array.from({ length: 9600 }, (_, id) => ({ UNIQUE_ID: String(id), ITEMCODE: 'I' + Math.floor(id / 4),
    LOCATIONCODE: 'A.01.001', LOTCODE: 'L' + id % 2, COMMONNAME: "Dwarf-John's™ Rose®.", PTRONHAND: '12', PTRAVAILABLE: '10' }));
  const index = context.AgMetricQueueInventory.createIndex(rows);
  assert.equal(index.byItemLocLot.size, 4800);
  assert.equal(index.byItemLoc.get(JSON.stringify(['I0','A.01.001'])).locOnHand, 48);
  assert.equal(index.byItem.get('I0').available, 40);
  assert.match(index.normalizedSearchText.get(rows[0]), /dwarf johns rose/);
  // Warm the JIT; measure lookups/filtering only, not snapshot construction.
  const run = () => { let hits = 0; for (const row of rows) {
    if (index.byItem.has(row.ITEMCODE) && index.normalizedSearchText.get(row).includes('johns rose')) hits++;
  } return hits; };
  run(); run(); run();
  const times = [];
  for (let attempt = 0; attempt < 5; attempt++) { const start = performance.now(); assert.equal(run(), 9600); times.push(performance.now() - start); }
  const median = times.sort((a,b) => a-b)[2];
  assert.ok(median < 5, '9600 indexed lookups/search took ' + median.toFixed(2) + 'ms');
  console.log('Inventory indexed lookup/search median: ' + median.toFixed(2) + 'ms (9600 rows, Node)');
});


test('AV options derive On Hand from aliases and available plus review', () => {
 const ctx=vm.createContext({firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!=='' )??'',parseAppNumber:x=>x==null||x===''?null:Number(x),normalizeCardQuantityValue:x=>String(Number(x)||0)});
 vm.runInContext(source('getCardPtrOnHandValue'),ctx);
 for(const n of [62,58,16]) {assert.equal(ctx.getCardPtrOnHandValue({on_hand:0,available:n,review:0}),String(n));assert.equal(ctx.getCardPtrOnHandValue({qty_on_hand:n}),String(n));}
});

test('detail camera guard blocks the queue tap even when the target is the file input', () => {
 let blocked=0;
 const ctx=vm.createContext({detailCameraInputBlockUntil:Date.now()+2000,prepareIosCameraPickerOpen(){},Date});
 vm.runInContext(source('handleDetailCameraInputActivation'),ctx);
 assert.equal(ctx.handleDetailCameraInputActivation({target:{matches:()=>true},preventDefault(){blocked++},stopPropagation(){}}),false);
 assert.equal(blocked,1);
});


test('same-account partial row refresh cannot lower known multi-lot location totals', () => {
 let owner='nelly';
 const ctx=vm.createContext({retainedLocationOnHandDisplay:{owner:'',values:new Map()},getSupabaseReadIdentityScope:()=>owner,appAccessSnapshotState:{snapshot:{dataPermissionVersion:'p1'}},getInventoryCardItemLocationKey:r=>r.ITEMCODE+'|'+r.LOCATIONCODE,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),parseAppNumber:x=>x==null||x===''?null:Number(x)});
 vm.runInContext(source('preserveCardLocationOnHand'),ctx);
 for(const [location,total,lot] of [['C.16.000',403,102],['H.06.000',143,81]]){
 const row={ITEMCODE:'004254.030.1',LOCATIONCODE:location,PTRONHAND:lot};
 assert.equal(ctx.preserveCardLocationOnHand(row,total),String(total));
 assert.equal(ctx.preserveCardLocationOnHand(row,lot),String(total));
 }
 owner='other';assert.equal(ctx.preserveCardLocationOnHand({ITEMCODE:'004254.030.1',LOCATIONCODE:'C.16.000',PTRONHAND:102},null),'102');
});

test('Manager global Back unwinds Eval2 location levels then hub and Home',()=>{
 let view='managers',hub=0,home=0;
 const ctx=vm.createContext({getVisibleSecondaryBack:()=>null,getManagerAssignedColumnState:()=>({}),getCurrentVisibleViewId:()=>view,isDrawerOpen:()=>false,closeOpenInteractiveSurfaceForBack:()=>false,activeHomeTab:'eval2',MANAGER_EVAL_REPORTS_2_VIEW:'eval2',managerEvalReport2DetailItemKey:'',managerEvalReport2BrowseMode:'location',managerEvalReport2DrillLevel:2,updateGlobalBackButton(){},backManagerEvalReport2Drill(){ctx.managerEvalReport2DrillLevel--;},openManagersModules(){hub++;ctx.activeHomeTab='dashboard';return false;},fastBackHome(){home++;view='home';}});
 vm.runInContext(source('goBackUniversal'),ctx);
 ctx.goBackUniversal();assert.equal(ctx.managerEvalReport2DrillLevel,1);
 ctx.goBackUniversal();assert.equal(ctx.managerEvalReport2DrillLevel,0);
 ctx.goBackUniversal();assert.equal(hub,1);
 ctx.goBackUniversal();assert.equal(home,1);
});


test('Reclass moves propagate Open Stock by season across years before the write resolves', () => {
 const row=(id,loc,lot,oh,av,stock)=>({UNIQUE_ID:id,ITEMCODE:'004502.010.1',LOCATIONCODE:loc,LOTCODE:lot,SEASON:lot.split('.').pop(),PTRONHAND:String(oh),PTRAVAILABLE:String(av),S_LTS:String(stock)});
 const rows=[row('s','C.16.000','27.S1',495,495,785),row('f','F.19.000','27.F1',189,152,377),row('h','H.06.000','27.F1',228,228,377),row('c','C.17.000','26.F1',17,17,377)];
 const ctx=vm.createContext({parseAppNumber:v=>v==null?null:Number(v),buildItemInquiryViewModel:(_item,r)=>({rows:r}),avInventory:[],fullInventory:rows});
 vm.runInContext(source('reclassStockSeason')+source('buildOptimisticInventoryReclassMoveModel'),ctx);
 const start=performance.now();
 const result=ctx.buildOptimisticInventoryReclassMoveModel({item:rows[0],inquiryModel:{rows}},{commandId:'test-stock',moves:[{source:{uniqueId:'s'},lines:[{quantity:200,destinationSeason:'F1'}]}]}).model.rows;
 assert.ok(performance.now()-start<100);
 const s=result.find(r=>r.UNIQUE_ID==='s'); assert.equal(s.PTRONHAND,'295');assert.equal(s.PTRAVAILABLE,'295');assert.equal(s.S_LTS,'585');
 const f=result.filter(r=>r.SEASON==='F1');assert.equal(f.length,4);assert.ok(f.every(r=>r.S_LTS==='577'));
 assert.equal(f.find(r=>r.LOCATIONCODE==='C.16.000').PTRONHAND,'200');
 assert.equal(result.filter(r=>r.LOCATIONCODE==='C.16.000').reduce((sum,r)=>sum+Number(r.PTRONHAND),0),495);
 assert.equal(rows[0].PTRONHAND,'495','preview retains immutable rollback rows');
});


test('Reclass card preview publishes before network completion and rolls back only its own rows', () => {
 const original={UNIQUE_ID:'s',ITEMCODE:'i',LOTCODE:'27.S1',PTRONHAND:'495',S_LTS:'785'};
 const cav={UNIQUE_ID:'cav',ITEMCODE:'i',SEASON:'S1',PTRAVAILABLE:'785'};
 const ctx=vm.createContext({fullInventory:[{...original}],avOpenInventory:[{...original}],cavInventory:[cav],getCurrentVisibleViewId:()=> 'drive',queueInteractiveViewRender(){},publishArgosInventoryTransactionReturnedRows(){},removeRealtimeRow:(rows,uid)=>{const i=rows.findIndex(r=>r.UNIQUE_ID===uid);if(i>=0)rows.splice(i,1);}});
 ctx.applyArgosInventoryTransactionReturnedRow=(row)=>{const value={...row};for(const rows of [ctx.fullInventory,ctx.avOpenInventory]){const i=rows.findIndex(r=>r.UNIQUE_ID===row.UNIQUE_ID);if(i>=0)rows[i]={...value};else rows.push({...value});}return ctx.fullInventory.find(r=>r.UNIQUE_ID===row.UNIQUE_ID);};
 vm.runInContext(source('reclassStockSeason')+source('applyReclassSeasonStocks')+source('publishOptimisticReclassRows'),ctx);
 const pending={command:{commandId:'preview'}};const start=performance.now();ctx.publishOptimisticReclassRows(pending,[{...original,PTRONHAND:'295',S_LTS:'585',SEASON_OH:'295'}]);
 assert.equal(ctx.fullInventory[0].PTRONHAND,'295');assert.equal(cav.PTRAVAILABLE,'585');assert.ok(performance.now()-start<100);
 ctx.publishOptimisticReclassRows(pending);assert.equal(ctx.fullInventory[0].PTRONHAND,'495');assert.equal(cav.PTRAVAILABLE,'785');
});
