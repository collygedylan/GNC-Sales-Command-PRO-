import { expect, test } from '@playwright/test';

test('large Eval Report2 cache rebuild stays off the render path and preserves exact rows', async ({ page, browserName, baseURL }, testInfo) => {
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
    warehouseAssignedItemsInventory = Array.from({ length: 2341 }, (_, i) => ({
      ITEMCODE: 'ITEM-' + String(i).padStart(4, '0'), GENUSNAME: 'Genus ' + i,
      ASSIGNEDTO: ['dylan_collyge', 'megan_kelly'][i % 2]
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
  expect(result.renderPathMs).toBeLessThan(500);
  expect(result).toMatchObject({ initialEmpty: true, loading: true, samePromise: true, editableWhileLoading: false,
    ready: true, rowCount: 9364, exactRowKeys: true, reportParity: true, membershipParity: true, events: [],
    firstLoadFailed: true, firstFailureEvent: true, failedTargetReadCalls: 5, retryTargetReadCalls: 5,
    targetCases: { overrideWinsAndExcludes: true, suggestionBoundaryIsStrict: true,
      noHistoryUsesFallback: true, completeRequestedSummaries: true } });
});
