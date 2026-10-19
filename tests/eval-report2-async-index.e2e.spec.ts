import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
import { expect, test } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';
// @test-group: @local-e2e,@release-timing,eval



test('large Eval Report2 cache rebuild stays off the render path and preserves exact rows', {"tag":["@local-e2e","@release-timing"]}, async ({ page, browserName, baseURL }, testInfo) => {
  const localOrigin = new URL(baseURL!).origin;
  // Every external request, including telemetry and writes, remains intercepted.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    // WebKit routes same-origin blob workers too; their hostname is empty.
    if (url.origin === localOrigin) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  }
  await page.goto('/?e2e=eval2-async-cold', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getManagerEvalReport2Index === 'function');
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    currentUser = 'dylan_collyge'; currentRole = 'Manager';
    canViewManagerEvalReports2 = () => true;
    canUseProductionLiveSync = () => false;
    getSupabaseReadIdentityScope = () => 'isolated-eval-cold';
    scheduleManagersRender = () => {};
    ensureDatasetLoaded = async () => true;
    getConfiguredCurrentSeasonCode = () => 'F1';
    getConfiguredCurrentSalesYearCode = () => 27;
    getConfiguredNextSaleSeasonTarget = () => ({ season: 'S1', salesYear: 27 });
    managerEvalReportSettings = { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 };
    loadManagerEvalReportSettings = async () => managerEvalReportSettings;
    const seasons = ['F1', 'U1', 'U2', 'U3', 'X', 'S1'];
    fullInventory = Array.from({ length: 9364 }, (_, i) => ({
      UNIQUE_ID: 'fixture-' + i, ITEMCODE: 'ITEM-' + String(i % 2341).padStart(4, '0'),
      GENUSNAME: 'Genus ' + (i % 2341), SEASON: seasons[i % 6], SALEYEAR: i % 13 === 0 ? 28 : 27,
      PRIORITY: i % 7 === 0 ? '1' : '', S_LTS: i % 200, ASSIGNEDTO: 'stale',
      LOCATIONCODE: 'A.01.' + i, LOTCODE: '27.F1', SOURCE: 'LD',
      HOLDSTOPCODE: i % 11 === 0 ? 'H' : '', HOLDSTOPBEGINDATE: i % 11 === 0 ? '8/1/2026' : '',
      LOCATIONNOTEDATE: i % 17 === 0 ? '8/1/2026' : ''
    }));
    delete fullInventory[0].UNIQUE_ID;
    fullInventory[9363] = {};
    warehouseAssignedItemsInventory = fullInventory.filter(row => row.UNIQUE_ID && row.ITEMCODE).map(row => ({
      master_unique_id:row.UNIQUE_ID, ITEMCODE:row.ITEMCODE, GENUSNAME:row.GENUSNAME,
      ASSIGNEDTO: ['dylan_collyge', 'megan_kelly'][Number(row.ITEMCODE.slice(5)) % 2]
    }));
    for (const dataset of ['master', 'warehouseAssignedItems']) {
      const state = getDatasetState(dataset); state.initialLoaded = state.fullLoaded = true;
      if (dataset === 'master') { state.fieldCoverage = 'full'; state.rowCompleteness = 'complete'; }
    }
    managerEvalReport2LoadState = { loading: false, error: '', promise: null };
    managerEvalReport2Cache = null;
    managerEvalReport2CacheKey = '';
    managerEvalReport2NeedsReconcile = false;
    activeHomeTab = 'eval-reports-2';
    managerEvalReport2SelectedReportIds = ['low-stock'];
    activeManagerEvalReport2 = 'low-stock';
    const events = [];
    reportSemanticHealthEvent = (...args) => events.push(args[2]);
    const syntheticTargets = new Map();
    for (let i = 0; i < 2341; i += 1) {
      const code = 'ITEM-' + String(i).padStart(4, '0');
      let manualOverride = null, suggestion = null, effective = 150;
      if (i === 5) { manualOverride = 0; suggestion = 100; effective = 0; }
      else if (i === 4) { suggestion = 86; effective = 86; }
      else if (i !== 6 && i % 3 === 0) { manualOverride = 55; suggestion = 70; effective = 55; }
      else if (i !== 6 && i % 3 === 1) { suggestion = 95; effective = 95; }
      syntheticTargets.set(code, {
        itemcode_normalized: code, qualifying_line_count: suggestion == null ? 0 : 8,
        qualifying_day_count: suggestion == null ? 0 : 4, source_file_count: suggestion == null ? 0 : 4,
        mean_quantity: suggestion == null ? null : suggestion / 2, p75_quantity: suggestion == null ? null : suggestion / 2,
        suggested_qty: suggestion, manual_override_qty: manualOverride, effective_qty: effective,
        override_revision: manualOverride == null ? 0 : 2, history_ready: true,
        history_pending_files: 0, history_total_files: 471,
        history_from_date: suggestion == null ? null : '2025-09-01',
        history_through_date: suggestion == null ? null : '2026-09-27',
        calculated_at: suggestion == null ? null : '2026-09-28T12:00:00Z', updated_at: null
      });
    }
    window.__lowStockTargetRpcCalls = [];
    let failFirstTargetRead = true;
    supabaseRpc = async (name, args) => {
      if (name !== 'get_eval_item_low_stock_targets_v1') throw new Error('Unexpected RPC in async-index fixture: ' + name);
      window.__lowStockTargetRpcCalls.push(args.p_itemcodes.slice());
      if (failFirstTargetRead) { failFirstTargetRead = false; return []; }
      return args.p_itemcodes.map(code => syntheticTargets.get(code)).filter(Boolean);
    };
    const started = performance.now();
    const initial = getManagerEvalReport2Index();
    const renderPathMs = performance.now() - started;
    const promise = managerEvalReport2LoadState.promise;
    const loading = managerEvalReport2LoadState.loading;
    const editableWhileLoading = isManagerEvalReport2SnapshotReadyForEdits();
    const duplicate = getManagerEvalReport2Index();
    const samePromise = promise === managerEvalReport2LoadState.promise;
    await promise;
    const firstLoadError = managerEvalReport2LoadState.error;
    const firstTargetError = getManagerItemLowStockTargetsState().error;
    const failedTargetReadCalls = window.__lowStockTargetRpcCalls.length;
    const firstFailureEvent = events.includes('EVAL_REPORT_2_LOAD_FAILED');
    events.length = 0;
    await loadManagerEvalReports2(true);
    const index = getManagerEvalReport2Index();
    if (!index) {
      const reportError = managerEvalReport2LoadState.error || '(none)';
      const targetError = getManagerItemLowStockTargetsState().error || '(none)';
      throw new Error('async report index missing; eval2="' + reportError + '"; item-targets="' + targetError + '"');
    }
    const api = getManagerEvalReports2Api();
    const model = api.buildAuthoritativeAssignmentModel(fullInventory, warehouseAssignedItemsInventory);
    const next = getConfiguredNextSaleSeasonTarget();
    const expected = api.classifyScriptCompatibleRows(model.rows, {
      currentSeason: getConfiguredCurrentSeasonCode(), currentSalesYear: getConfiguredCurrentSalesYearCode(),
      nextSeason: next.season, nextSalesYear: next.salesYear, settings: managerEvalReportSettings,
      itemLowStockTargets: new Map(getManagerItemLowStockTargetsState().rowsByCode), now: new Date()
    });
    model.rows.forEach((row, i) => Object.defineProperty(row, '__evalReport2SourceIndex', { value: i }));
    const rowKeys = model.rows.map((row, i) => getManagerEvalReport2RowKey(row, i));
    const actualKeys = index.allRows.map((row, i) => getManagerEvalReport2RowKey(row, i));
    const membership = new Map();
    const reportParity = api.REPORT_IDS.every(id => {
      expected.reports[id].forEach((row, i) => {
        const key = getManagerEvalReport2RowKey(row, i);
        if (!membership.has(key)) membership.set(key, new Set());
        membership.get(key).add(id);
      });
      return JSON.stringify(index.reports[id].map((row, i) => getManagerEvalReport2RowKey(row, i)))
        === JSON.stringify(expected.reports[id].map((row, i) => getManagerEvalReport2RowKey(row, i)));
    });
    const serialize = map => JSON.stringify(Array.from(map, ([key, value]) => [key, Array.from(value)]));
    const targetIndex = getManagerItemLowStockTargetsState().rowsByCode;
    const lowStockCodes = new Set(index.reports['low-stock'].map(row => String(row.ITEMCODE || row.itemcode || '').toUpperCase()));
    const targetCases = {
      overrideWinsAndExcludes: targetIndex.get('ITEM-0005')?.manual_override_qty === 0 && !lowStockCodes.has('ITEM-0005'),
      suggestionBoundaryIsStrict: targetIndex.get('ITEM-0004')?.suggested_qty === 86 && !lowStockCodes.has('ITEM-0004'),
      noHistoryUsesFallback: targetIndex.get('ITEM-0006')?.suggested_qty == null && targetIndex.get('ITEM-0006')?.effective_qty === 150 && lowStockCodes.has('ITEM-0006'),
      completeRequestedSummaries: targetIndex.size === 2341
    };
    return { renderPathMs, initialEmpty: initial === null && duplicate === null, loading, samePromise,
      editableWhileLoading, ready: !managerEvalReport2LoadState.loading && !managerEvalReport2LoadState.error,
      rowCount: index.rowByKey.size, exactRowKeys: JSON.stringify(rowKeys) === JSON.stringify(actualKeys),
      reportParity, membershipParity: serialize(membership) === serialize(index.reportMembershipByKey), events,
      firstLoadFailed: !!firstLoadError && !!firstTargetError, firstFailureEvent,
      failedTargetReadCalls, retryTargetReadCalls: window.__lowStockTargetRpcCalls.length - failedTargetReadCalls,
      targetCases };
  })()`));
  await testInfo.attach('eval-report2-cold-render-path', { body: JSON.stringify(result), contentType: 'application/json' });
  assertFrontendUiTiming(expect(result.renderPathMs), test.info().project);
  expect(result).toMatchObject({ initialEmpty: true, loading: true, samePromise: true, editableWhileLoading: false,
    ready: true, rowCount: 9364, exactRowKeys: true, reportParity: true, membershipParity: true, events: [],
    firstLoadFailed: true, firstFailureEvent: true, failedTargetReadCalls: 5, retryTargetReadCalls: 5,
    targetCases: { overrideWinsAndExcludes: true, suggestionBoundaryIsStrict: true,
      noHistoryUsesFallback: true, completeRequestedSummaries: true } });
});

test('Eval #2 shared snapshot reopens without loading flash and keeps MORE open through updates', {"tag":["@local-e2e","@release-timing"]}, async ({ page, baseURL }, testInfo) => {
  const fixture = await installHlOrderFixture(page, baseURL!, {
    username: 'dylan_collyge', role: 'ADMIN', startupMode: 'restored',
  });
  await fixture.waitForRevisionIdle();
  await page.waitForFunction(() => typeof (window as any).renderManagerEvalReport2Records === 'function');
  const result = await page.evaluate(async () => (window as any).eval(`(async () => {
    resetProductionLiveSync();
    currentUser = 'dylan_collyge'; currentRole = 'Manager';
    canViewManagerEvalReports2 = () => true;
    canUseProductionLiveSync = () => false;
    useManagerReportPages = () => false;
    getSupabaseReadIdentityScope = () => 'eval2-shared-snapshot';
    scheduleManagersRender = () => {};
    getConfiguredCurrentSeasonCode = () => 'F1';
    getConfiguredCurrentSalesYearCode = () => 27;
    getConfiguredNextSaleSeasonTarget = () => ({ season:'S1', salesYear:27 });
    managerEvalReportSettings = { lowStockMaxSLts:150, holdAgeDays:5, locationNoteAgeDays:10 };
    loadManagerEvalReportSettings = async () => managerEvalReportSettings;
    fullInventory = [];
    warehouseAssignedItemsInventory = [];
    for (let item = 0; item < 1000; item += 1) {
      const itemcode = item === 0 ? 'CACHE-001' : 'SUP-' + String(item).padStart(4, '0');
      for (let physical = 0; physical < 10; physical += 1) {
        const uniqueId = 'eval2-' + item + '-' + physical;
        const active = item === 0 && physical === 0;
        fullInventory.push({ UNIQUE_ID:uniqueId, ITEMCODE:itemcode, COMMONNAME:item === 0 ? 'Cache Test' : 'Suppressed ' + item,
          GENUSNAME:'Genus', SEASON:active ? 'F1' : 'U3', SALEYEAR:27, LOTCODE:active ? '27.F1' : '27.U3',
          CONTSIZE:'#1', LOCATIONCODE:'A.' + String(item % 99).padStart(2, '0') + '.' + String(physical).padStart(3, '0'),
          S_LTS:40, ITEMDESI:'' });
        warehouseAssignedItemsInventory.push({ master_unique_id:uniqueId, ASSIGNEDTO:physical % 2 ? 'Bob' : 'Alice' });
      }
    }
    fullInventory.push({ UNIQUE_ID:'eval2-10000', ITEMCODE:'CACHE-001', COMMONNAME:'Cache Test', GENUSNAME:'Genus',
      SEASON:'U3', SALEYEAR:27, LOTCODE:'27.U3', CONTSIZE:'#1', LOCATIONCODE:'B.01.001', S_LTS:40, ITEMDESI:'' });
    warehouseAssignedItemsInventory.push({ master_unique_id:'eval2-10000', ASSIGNEDTO:'Bob' });
    for (const name of ['master','warehouseAssignedItems']) {
      const state = getDatasetState(name); state.initialLoaded = state.fullLoaded = true;
      state.fieldCoverage = 'full'; state.rowCompleteness = 'complete';
    }
    managerEvalReport2LoadState = { loading:false, error:'', promise:null, lastSourceUpdatedAt:'' };
    managerEvalReport2Cache = null; managerEvalReport2CacheKey = '';
    managerEvalReport2NeedsReconcile = false;
    managerEvalReport2MoreMenuOpen = false;
    managerEvalReport2AssignedToFilter = 'all'; managerEvalReport2AssignedToFilters = new Set();
    managerEvalReport2SeasonFilters = new Set(); managerEvalReport2ContSizeFilter = 'all';
    managerEvalReport2LocationFilter = 'all'; managerEvalReport2PriorityFilter = 'all';
    managerEvalReport2SelectedReportIds = ['u3']; activeManagerEvalReport2 = 'u3';
    managerEvalReport2BrowseMode = 'plant'; managerEvalReport2DrillLevel = 0;
    managerEvalReport2VisibleGroupsCacheKey = ''; managerEvalReport2VisibleGroupsCache = [];
    const beforeBuild = { sourceRows:fullInventory.length, assignmentRows:warehouseAssignedItemsInventory.length,
      selectedReports:getManagerEvalReport2SelectedReportIds(), displaySourcesReady:managerEvalReport2DisplaySourcesReady(),
      cacheKey:getManagerEvalReport2CacheKeyValue(), apiAvailable:!!getManagerEvalReports2Api() };
    const index = getManagerEvalReport2Index(true);
    if (!index) throw new Error('shared cache fixture could not build the Eval2 index');
    const ensureDatasetLoads = ensureDatasetLoaded;
    const loadSettings = loadManagerEvalReportSettings;
    let datasetLoads = 0, settingsLoads = 0;
    const observedDatasetLoads = [];
    ensureDatasetLoaded = async (...args) => {
      observedDatasetLoads.push(String(args[0]));
      // Background lookup prefetch is independent of the warm Eval2 snapshot.
      // Assert zero loads for the two datasets this report actually consumes.
      if (['master', 'warehouseAssignedItems'].includes(String(args[0]))) datasetLoads += 1;
      return ensureDatasetLoads(...args);
    };
    loadManagerEvalReportSettings = async (...args) => { settingsLoads += 1; return loadSettings(...args); };
    const cacheStart = performance.now();
    await loadManagerEvalReports2(false);
    const warmOpenMs = performance.now() - cacheStart;
    const panelHost = document.createElement('div'); panelHost.id = 'eval2-panel-host'; document.body.appendChild(panelHost);
    const domOpenStart = performance.now();
    panelHost.innerHTML = renderManagerEvalReports2Panel();
    renderManagerEvalReport2Records();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const warmOpenDomMs = performance.now() - domOpenStart;
    const recordsHost = panelHost.querySelector('#manager-eval-report-2-records');
    const userFilter = panelHost.querySelector('[data-role="manager-eval2-user-filter"]');
    if (!recordsHost || !(userFilter instanceof HTMLSelectElement)) throw new Error('warm Eval2 panel or direct Users filter did not render');
    const groups = getManagerEvalReport2VisibleItemGroups();
    const cacheCodes = groups.map(group => group.itemCode);
    let details = panelHost.querySelector('details#manager-eval-report-2-more-menu');
    if (!details) throw new Error('Eval2 MORE drawer missing from the shared snapshot');
    details.querySelector('summary').click();
    await new Promise(resolve => setTimeout(resolve, 25));
    details = panelHost.querySelector('details#manager-eval-report-2-more-menu');
    const openedByUser = !!details.open && managerEvalReport2MoreMenuOpen;
    const initialCardCount = recordsHost.querySelectorAll('.manager-eval2-item-card').length;
    const initialRenderedCardCount = initialCardCount;
    const initialCardText = recordsHost.textContent;
    const start = performance.now();
    let loadingFlashSeen = false, drawerClosed = false, cardLost = false;
    while (performance.now() - start < 5000) {
      await loadManagerEvalReports2(false);
      // Match production live-sync updates: repaint report records while the
      // shared controls (including the MORE details node) remain mounted.
      renderManagerEvalReport2Records();
      details = panelHost.querySelector('details#manager-eval-report-2-more-menu');
      loadingFlashSeen ||= /Loading inventory and assignments|Refreshing complete inventory/i.test(panelHost.textContent + recordsHost.textContent);
      drawerClosed ||= !details?.open;
      cardLost ||= recordsHost.querySelectorAll('.manager-eval2-item-card').length !== initialCardCount
        || recordsHost.textContent !== initialCardText;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const expectedForUser = username => index.reports.u3.filter(row =>
      getManagerEvalReportRowAssignedToUsers(row).some(value => String(value).toLocaleLowerCase() === username.toLocaleLowerCase()));
    const filterResults = {};
    for (const username of ['Alice', 'Bob']) {
      const activeUserFilter = panelHost.querySelector('[data-role="manager-eval2-user-filter"]');
      if (!(activeUserFilter instanceof HTMLSelectElement)) throw new Error('direct Users filter disappeared after panel update');
      activeUserFilter.value = username;
      activeUserFilter.dispatchEvent(new Event('change', { bubbles:true }));
      panelHost.innerHTML = renderManagerEvalReports2Panel();
      renderManagerEvalReport2Records();
      const visibleGroups = getManagerEvalReport2VisibleItemGroups();
      const expectedRows = expectedForUser(username);
      const expectedCodes = Array.from(new Set(expectedRows.map(getManagerEvalReport2ItemCode))).sort();
      const visibleCodes = visibleGroups.map(group => group.itemCode).sort();
      const cards = Array.from(panelHost.querySelectorAll('.manager-eval2-item-card'));
      const cardCodes = cards.map(card => card.querySelector('[data-role="manager-eval2-selection-toggle"]')?.getAttribute('data-itemcode') || '')
        .filter(Boolean).sort();

      managerEvalReport2BrowseMode = 'location';
      managerEvalReport2DrillLevel = 0;
      managerEvalReport2SelectedBlockAlpha = '';
      managerEvalReport2SelectedLocationCode = '';
      const blockGroups = getManagerEvalReport2DrillGroups();
      const expectedBlocks = Array.from(new Set(expectedRows.map(getDriveBlockAlphaValue))).sort();
      const actualBlocks = blockGroups.map(group => group.value).sort();
      const locationGroups = [];
      for (const block of blockGroups) {
        managerEvalReport2SelectedBlockAlpha = block.value;
        managerEvalReport2DrillLevel = 1;
        locationGroups.push(...getManagerEvalReport2DrillGroups());
      }
      const expectedLocations = Array.from(new Set(expectedRows.map(row => getManagerEvalReportRowLocation(row)))).sort();
      const actualLocations = locationGroups.map(group => group.value).sort();
      filterResults[username] = {
        expectedCodes, visibleCodes, cardCodes,
        expectedBlocks, actualBlocks, expectedLocations, actualLocations,
        blockRowsMatchUser: blockGroups.every(group => group.rows.every(row =>
          getManagerEvalReportRowAssignedToUsers(row).some(value => String(value).toLocaleLowerCase() === username.toLocaleLowerCase()))),
      };
      managerEvalReport2BrowseMode = 'plant';
      managerEvalReport2DrillLevel = 0;
      managerEvalReport2SelectedBlockAlpha = '';
      managerEvalReport2SelectedLocationCode = '';
    }
    return { warmOpenMs, warmOpenDomMs, initialCardCount:initialRenderedCardCount,
      userFilterRendered:true, filterResults, datasetLoads, observedDatasetLoads, settingsLoads, openedByUser, drawerStayedOpen:!!details?.open,
      loadingFlashSeen, cardLost, cardCount:initialCardCount, cacheCodes,
      visibleUserOptions:getManagerEvalReport2UserFilterOptions(getManagerEvalReport2Rows()).map(option => option.label),
      drawerClosed, diagnostics:{ beforeBuild, sourceRowsNow:fullInventory.length,
        reportRows:index.reports.u3.length, selectedReports:getManagerEvalReport2SelectedReportIds(),
        allRows:index.allRows.length, selectedRows:getManagerEvalReport2Rows().length,
        assignedNames:index.assignedToOptions, datasetState:{ master:getDatasetState('master').fullLoaded,
          assignments:getDatasetState('warehouseAssignedItems').fullLoaded } } };
  })()`));
  console.log(`EVAL2_SHARED_CACHE_RESULT ${JSON.stringify(result)}`);
  await testInfo.attach('eval-report2-shared-cache-open', { body:JSON.stringify(result), contentType:'application/json' });
  expect(result.warmOpenMs).toBeLessThan(300);
  expect(result.warmOpenDomMs).toBeLessThan(300);
  expect(result).toMatchObject({ datasetLoads:0, settingsLoads:0, openedByUser:true, drawerStayedOpen:true,
    loadingFlashSeen:false, cardLost:false, cardCount:1, initialCardCount:1, userFilterRendered:true,
    cacheCodes:['CACHE-001'], drawerClosed:false,
    visibleUserOptions:['All Users (1)','Alice (1)','Bob (1)'] });
  for (const username of ['Alice', 'Bob'] as const) {
    const snapshot = result.filterResults[username];
    expect(snapshot.visibleCodes, `${username} filtered ITEMCODE groups`).toEqual(snapshot.expectedCodes);
    expect(snapshot.cardCodes, `${username} rendered ITEMCODE cards`).toEqual(snapshot.expectedCodes);
    expect(snapshot.actualBlocks, `${username} filtered location blocks`).toEqual(snapshot.expectedBlocks);
    expect(snapshot.actualLocations, `${username} filtered location rows`).toEqual(snapshot.expectedLocations);
    expect(snapshot.blockRowsMatchUser, `${username} block/location rows remain assigned to the selected user`).toBeTruthy();
  }
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});
