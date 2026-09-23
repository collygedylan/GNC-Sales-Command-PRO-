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
    loadManagerEvalReportSettings = async () => {};
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
    }
    managerEvalReport2LoadState = { loading: false, error: '', promise: null };
    managerEvalReport2Cache = null;
    managerEvalReport2CacheKey = '';
    managerEvalReport2NeedsReconcile = false;
    activeHomeTab = 'eval-reports-2';
    const events = [];
    reportSemanticHealthEvent = (...args) => events.push(args[2]);
    const started = performance.now();
    const initial = getManagerEvalReport2Index();
    const renderPathMs = performance.now() - started;
    const promise = managerEvalReport2LoadState.promise;
    const loading = managerEvalReport2LoadState.loading;
    const editableWhileLoading = isManagerEvalReport2SnapshotReadyForEdits();
    const duplicate = getManagerEvalReport2Index();
    const samePromise = promise === managerEvalReport2LoadState.promise;
    await promise;
    const index = getManagerEvalReport2Index();
    if (!index) throw new Error('async report index missing');
    const api = getManagerEvalReports2Api();
    const model = api.buildAuthoritativeAssignmentModel(fullInventory, warehouseAssignedItemsInventory);
    const next = getConfiguredNextSaleSeasonTarget();
    const expected = api.classifyScriptCompatibleRows(model.rows, {
      currentSeason: getConfiguredCurrentSeasonCode(), currentSalesYear: getConfiguredCurrentSalesYearCode(),
      nextSeason: next.season, nextSalesYear: next.salesYear, settings: managerEvalReportSettings, now: new Date()
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
    return { renderPathMs, initialEmpty: initial === null && duplicate === null, loading, samePromise,
      editableWhileLoading, ready: !managerEvalReport2LoadState.loading && !managerEvalReport2LoadState.error,
      rowCount: index.rowByKey.size, exactRowKeys: JSON.stringify(rowKeys) === JSON.stringify(actualKeys),
      reportParity, membershipParity: serialize(membership) === serialize(index.reportMembershipByKey), events };
  })()`));
  await testInfo.attach('eval-report2-cold-render-path', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.renderPathMs).toBeLessThan(500);
  expect(result).toMatchObject({ initialEmpty: true, loading: true, samePromise: true, editableWhileLoading: false,
    ready: true, rowCount: 9364, exactRowKeys: true, reportParity: true, membershipParity: true, events: [] });
});
