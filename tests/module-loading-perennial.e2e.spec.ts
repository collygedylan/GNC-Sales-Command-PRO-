import { expect, test, type Page } from '@playwright/test';

test.setTimeout(90_000);

async function isolatedApp(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?e2e=module-loading-perennial', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).buildManagerEvalReport2IndexAsync === 'function');
  await page.evaluate(() => (window as any).eval(`(() => {
    currentUser = 'dylan_collyge'; currentRole = 'Manager';
    canUseProductionLiveSync = () => false;
    canViewManagerEvalReports2 = () => true;
    canViewAssignedItemsExport = () => true;
    canAccessView = () => true;
    getSupabaseReadIdentityScope = () => 'isolated-performance';
    getCurrentVisibleViewId = () => 'managers';
    getManagerToolTabs = () => [{ id:'eval-reports-2', label:'Eval Reports #2' }, { id:MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW, label:'Assigned Items' }];
    getManagerApprovalTabs = () => [];
    getConfiguredCurrentSeasonCode = () => 'F1';
    getConfiguredCurrentSalesYearCode = () => 27;
    getConfiguredNextSaleSeasonTarget = () => ({ season:'S1', salesYear:27 });
    managerEvalReportSettings = { lowStockMaxSLts:150, holdAgeDays:5, locationNoteAgeDays:10 };
    loadManagerEvalReportSettings = async () => managerEvalReportSettings;
    ensureDatasetLoaded = async () => true;
    ensureViewDataForRender = () => false;
    activeHomeTab = 'eval-reports-2';
    document.getElementById('view-managers').classList.remove('hidden');
    window.__savedScheduleManagersRender = scheduleManagersRender;
    scheduleManagersRender = () => {};
    const original = document.getElementById('managers-content');
    original.removeAttribute('id');
    const host = document.createElement('div');
    host.id = 'managers-content';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--bg-body,#fff);padding:12px';
    document.body.append(host);
  })()`));
}

test('10,000-row reports reuse the index and local filters without low-stock requests', async ({ page, baseURL }, testInfo) => {
  await isolatedApp(page, baseURL!);
  const metrics = await page.evaluate(() => (window as any).eval(`(async () => {
    fullInventory = Array.from({ length:10000 }, (_, i) => ({
      UNIQUE_ID:'perf-' + i, ITEMCODE:String(i % 3200).padStart(6,'0'), GENUSNAME:'Genus ' + (i % 3200),
      COMMONNAME:'Synthetic ' + (i % 3200), CONTSIZE:'#3', LOCATIONCODE:'D.06.' + (i % 40),
      SEASON:['U1','U2','X'][i % 3], SALEYEAR:27, S_LTS:20, PTRONHAND:25, PTRAVAILABLE:20
    }));
    warehouseAssignedItemsInventory = fullInventory.map((row, i) => ({
      master_unique_id:row.UNIQUE_ID, UNIQUE_ID:row.UNIQUE_ID, ITEMCODE:row.ITEMCODE, GENUSNAME:row.GENUSNAME,
      ASSIGNEDTO:i % 2 ? 'zoe_green' : 'megan_kelly'
    }));
    for (const key of ['master','warehouseAssignedItems']) {
      const state = getDatasetState(key); state.fullLoaded = state.initialLoaded = true; state.lastLoadedAt = 'fixture-1';
      if (key === 'master') { state.fieldCoverage = 'full'; state.rowCompleteness = 'complete'; }
    }
    managerEvalReport2SelectedReportIds = ['not-in-f1']; activeManagerEvalReport2 = 'not-in-f1';
    let lowStockReads = 0, fullReads = 0;
    loadManagerItemLowStockTargets = async () => { lowStockReads++; throw new Error('Unrelated low-stock read'); };
    ensureDatasetLoaded = async () => { fullReads++; return true; };
    const start = performance.now();
    await loadManagerEvalReports2(false);
    const coldIndexMs = performance.now() - start;
    const index = getManagerEvalReport2Index();
    if (!index) throw new Error(managerEvalReport2LoadState.error || 'Missing index');
    const readsAtReady = fullReads;
    const samples = [];
    for (let i = 0; i < 10; i++) {
      resolvedViewStateEpoch++;
      const before = performance.now();
      await applyManagerEvalReport2UserFilter(new Set([i % 2 ? 'zoe_green' : 'megan_kelly']));
      const groups = getManagerEvalReport2VisibleItemGroups();
      samples.push(performance.now() - before);
      if (groups.length !== 1600 || getManagerEvalReport2Index() !== index) throw new Error('Index/filter parity');
    }
    // The previous membership lookup scanned every inventory row once per key.
    const codes = Array.from(index.rowsByItemCode.keys());
    const oldStart = performance.now();
    for (const code of codes) fullInventory.filter(row => getManagerEvalReport2ItemCode(row) === code);
    const oldLookupMs = performance.now() - oldStart;
    const newStart = performance.now();
    for (const code of codes) getManagerEvalReport2ItemReportIds(code);
    const newLookupMs = performance.now() - newStart;
    await applyManagerEvalReport2UserFilter(new Set());
    renderManagers();
    renderManagerEvalReport2Records();
    return { coldIndexMs, filterP95Ms:samples.sort((a,b)=>a-b)[9], lowStockReads,
      filterDownloads:fullReads - readsAtReady, rows:index.allRows.length,
      groups:getManagerEvalReport2VisibleItemGroups().length, oldLookupMs, newLookupMs };
  })()`));
  await testInfo.attach('module-loading-timings', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(metrics).toMatchObject({ lowStockReads: 0, filterDownloads: 0, rows: 10000, groups: 3200 });
  expect(metrics.filterP95Ms).toBeLessThan(1000);
  expect(metrics.newLookupMs).toBeLessThan(metrics.oldLookupMs * .5);
  await expect(page.locator('.manager-eval2-item-card').first()).toBeVisible();
  // Apply operates on real controls and the compiled renderer.
  await page.locator('[data-manager-eval2-report-picker] summary').click();
  await page.locator('[data-eval2-report-id][value="not-in-f1"]').uncheck();
  await page.evaluate(() => (window as any).eval(`(() => {
    scheduleManagersRender = window.__savedScheduleManagersRender;
    const original = setManagerEvalReport2Reports;
    const records = document.getElementById('manager-eval-report-2-records');
    const previousCards = new Set(records.querySelectorAll('.manager-eval2-item-card'));
    let startedAt = 0;
    window.__applyStages = {};
    const observer = new MutationObserver(() => {
      if (!startedAt || getManagerEvalReport2SelectedReportIds().join(',') !== 'u1') return;
      const newCard = Array.from(records.querySelectorAll('.manager-eval2-item-card'))
        .find(card => !previousCards.has(card));
      if (newCard && window.__applyReportTiming?.firstRowsMs == null) {
        window.__applyReportTiming.firstRowsMs = performance.now() - startedAt;
        observer.disconnect();
      }
    });
    observer.observe(records, { childList:true, subtree:true });
    for (const name of ['refreshManagerEvalReport2BrowseRegion', 'getManagerEvalReport2VisibleItemGroups', 'syncManagerEvalReport2SelectionUi', 'renderMarkupChunkedByKey', 'setContainerHtml', 'getChunkRenderPacing']) {
      const fn = window[name];
      window[name] = (...args) => {
        const start = performance.now();
        const result = fn(...args);
        if (startedAt) {
          const stage = window.__applyStages[name] ||= { calls:0, durationMs:0, firstStartedMs:start-startedAt };
          stage.calls++; stage.durationMs += performance.now() - start;
        }
        return result;
      };
    }
    setManagerEvalReport2Reports = ids => {
      if (ids.includes('u1') && !startedAt) startedAt = performance.now();
      const value = original(ids);
      if (startedAt && window.__applyReportTiming == null) {
        window.__applyReportTiming = { acknowledgeMs:performance.now() - startedAt };
      }
      return value;
    };
  })()`));
  // The checkbox applies its selection immediately; Apply Reports only closes the picker.
  await page.locator('[data-eval2-report-id][value="u1"]').check();
  await page.getByRole('button', { name: 'Apply Reports', exact: true }).click();
  await page.waitForFunction(() => (window as any).__applyReportTiming?.firstRowsMs != null, undefined, { timeout: 15_000 });
  const apply = await page.evaluate(() => ({...(window as any).__applyReportTiming, stages:(window as any).__applyStages}));
  await testInfo.attach('apply-report-timings', { body:JSON.stringify(apply), contentType:'application/json' });
  expect(apply.acknowledgeMs).toBeLessThan(100);
  expect(apply.firstRowsMs).toBeLessThan(1000);
  expect(await page.evaluate(() => (window as any).eval("getManagerEvalReport2SelectedReportIds().join(',')"))).toBe('u1');
});

test('Eval2 builds and displays a joined saved cohort while revisions are withheld, with edits gated', async ({ page, baseURL }) => {
  await isolatedApp(page, baseURL!);
  const result = await page.evaluate(async () => (window as any).eval(`(async () => {
    const count = 1200;
    fullInventory = Array.from({length:count}, (_,i) => ({
      UNIQUE_ID:'saved-preview-' + i, ITEMCODE:'PREVIEW-' + String(i).padStart(4,'0'), GENUSNAME:'Acer',
      COMMONNAME:'Saved preview ' + i, CONTSIZE:'#3', LOCATIONCODE:'D.06.' + String(i % 40).padStart(3,'0'),
      LOTCODE:'27.F1', SEASON:'F1', SALEYEAR:27, S_LTS:10, PTRAVAILABLE:12
    }));
    warehouseAssignedItemsInventory = Array.from({length:count}, (_,i) => ({
      master_unique_id:'saved-preview-' + i, ITEMCODE:'PREVIEW-' + String(i).padStart(4,'0'), GENUSNAME:'Acer', ASSIGNEDTO:'zoe_green'
    }));
    for (const key of ['master','warehouseAssignedItems']) {
      const state = getDatasetState(key); state.fullLoaded = state.initialLoaded = false;
      state.status = 'cached-preview'; state.lastLoadedAt = 'saved-cohort-fixture';
    }
    currentUser = 'dylan_collyge'; currentRole = 'Manager';
    canUseProductionLiveSync = () => true;
    canViewManagerEvalReports2 = () => true;
    getCurrentVisibleViewId = () => 'managers';
    productionLiveSyncVerifiedView = '';
    productionVerifiedViewKey = () => 'cohort-current-proof';
    hasProgressiveViewData = () => true;
    getSupabaseReadIdentityScope = () => 'saved-cohort-preview';
    getConfiguredCurrentSeasonCode = () => 'F1';
    getConfiguredCurrentSalesYearCode = () => 27;
    getConfiguredNextSaleSeasonTarget = () => ({season:'S1', salesYear:27});
    managerEvalReportSettings = {lowStockMaxSLts:150, holdAgeDays:5, locationNoteAgeDays:10};
    managerEvalReport2SelectedReportIds = ['no-pri']; activeManagerEvalReport2 = 'no-pri';
    managerEvalReport2LoadState = {loading:true, error:'', promise:new Promise(()=>{})};
    managerEvalReport2Cache = null; managerEvalReport2CacheKey = '';
    renderManagers();
    const initial = getManagerEvalReport2Index();
    if (initial !== null) throw new Error('Unverified large preview was synchronously classified');
    const deadline = Date.now() + 15000;
    while (!managerEvalReport2Cache && Date.now() < deadline) await new Promise(resolve=>setTimeout(resolve,10));
    if (!managerEvalReport2Cache) throw new Error('Saved joined cohort index did not complete');
    renderManagers();
    renderManagerEvalReport2Records();
    return {rows:managerEvalReport2Cache.allRows.length, ready:isManagerEvalReport2SnapshotReadyForEdits(), count:managerEvalReport2Cache.counts['no-pri']};
  })()`));
  expect(result.rows).toBe(1200);
  expect(result.count).toBe(1200);
  expect(result.ready).toBe(false);
  await expect(page.locator('.manager-eval2-item-card').first()).toBeVisible();
  await expect(page.locator('#manager-eval-report-2-records')).toContainText('Saved preview');
});

test('cooperative fallback preserves exact report parity and drops obsolete work', async ({ page, baseURL }) => {
  await isolatedApp(page, baseURL!);
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    window.Worker = undefined;
    fullInventory = Array.from({length:10000}, (_,i)=>({ UNIQUE_ID:'fallback-'+i, ITEMCODE:'000'+(i%1000), GENUSNAME:'Acer', SEASON:i%2?'U1':'F1', SALEYEAR:27, S_LTS:10 }));
    warehouseAssignedItemsInventory = [];
    for (const key of ['master','warehouseAssignedItems']) {
      const state = getDatasetState(key); state.fullLoaded = state.initialLoaded = true;
      if (key === 'master') { state.fieldCoverage = 'full'; state.rowCompleteness = 'complete'; }
    }
    let ticks = 0;
    const timer = setInterval(()=>ticks++,1);
    const result = await buildManagerEvalReport2IndexAsync();
    clearInterval(timer);
    const model = GncEvalReports.buildAuthoritativeAssignmentModel(fullInventory, warehouseAssignedItemsInventory);
    const expected = GncEvalReports.classifyScriptCompatibleRows(model.rows, { currentSeason:'F1', currentSalesYear:27, nextSeason:'S1', nextSalesYear:27, settings:managerEvalReportSettings });
    const parity = GncEvalReports.REPORT_IDS.every(id=>JSON.stringify(result.reports[id].map(row=>row.UNIQUE_ID))===JSON.stringify(expected.reports[id].map(row=>row.UNIQUE_ID)));
    invalidateManagerEvalReport2Cache();
    const pending = buildManagerEvalReport2IndexAsync();
    getSupabaseReadIdentityScope = () => 'other-user';
    const obsolete = await pending;
    return { ticks, parity, obsolete:obsolete === null };
  })()`));
  expect(result.parity).toBe(true);
  expect(result.ticks).toBeGreaterThan(10);
  expect(result.obsolete).toBe(true);
});

test('perennial row ownership and itemcode default controls survive mobile themes', async ({ page, baseURL }) => {
  await isolatedApp(page, baseURL!);
  await page.evaluate(() => (window as any).eval(`(() => {
    fullInventory = [];
    warehouseAssignedItemsInventory = [
      { master_unique_id:'inside', itemcode:'0001', genusname:'Acer', assignedto:'zoe_green', default_assignedto:'dylan_collyge', default_revision:1, zone_override_active:true, assignment_reason:'zone_zoe', commonname:'Perennial item', locationcode:'D.10.021' },
      { master_unique_id:'rose', itemcode:'0001', genusname:'Rosa', assignedto:'mitch_kaiser', default_assignedto:'dylan_collyge', default_revision:1, zone_override_active:true, assignment_reason:'zone_mitch_rose', commonname:'Rose exception', locationcode:'D.10.021' },
      { master_unique_id:'none', itemcode:'0002', genusname:'Acer', assignedto:null, zone_override_active:false, assignment_reason:'unassigned', commonname:'Moved outside', locationcode:'E.01.001' }
    ].map(normalizeWarehouseAssignedItemRow);
    getDatasetState('warehouseAssignedItems').fullLoaded = true;
    const masterState = getDatasetState('master'); masterState.fullLoaded = true; masterState.fieldCoverage = 'full'; masterState.rowCompleteness = 'complete';
    canManageEvalItemcodeAssignments = () => true;
    canManageItemLowStockTargets = () => false;
    activeHomeTab = MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW;
    clearWarehouseAssignedItemCaches();
  })()`));
  for (const theme of ['light', 'dark', 'outdoor']) {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => (window as any).eval(`(() => {
        document.documentElement.classList.toggle('dark', ${JSON.stringify(theme)} === 'dark');
        document.documentElement.classList.toggle('outdoor-mode', ${JSON.stringify(theme)} === 'outdoor');
        document.body.dataset.opsTheme = ${JSON.stringify(theme)} === 'dark' ? 'dark' : 'light';
        document.body.dataset.opsThemeMode = document.body.dataset.opsTheme;
        document.body.classList.toggle('dark-mode', ${JSON.stringify(theme)} === 'dark');
        document.body.classList.toggle('outdoor-mode', ${JSON.stringify(theme)} === 'outdoor');
        document.getElementById('managers-content').innerHTML = renderManagerAssignedItemsPreviewTable(warehouseAssignedItemsInventory);
      })()`), theme);
      const defaultOwner = page.locator('#managers-content select[data-itemcode="0001"]');
      await expect(defaultOwner).toHaveCount(1);
      await expect(defaultOwner).toBeEnabled();
      await expect(defaultOwner).toHaveValue('dylan_collyge');
      await expect(page.locator('[data-assignment-reason="zone_zoe"]')).toHaveText('Perennial Area: Zoe');
      await expect(page.locator('[data-assignment-reason="zone_mitch_rose"]')).toHaveText('Perennial roses: Mitch');
    }
  }
  const result = await page.evaluate(() => (window as any).eval(`(() => ({
    exact:getWarehouseAssignedUsersForItem({ UNIQUE_ID:'inside', ITEMCODE:'0001', GENUSNAME:'Acer' }),
    rose:getWarehouseAssignedUsersForItem({ UNIQUE_ID:'rose', ITEMCODE:'0001', GENUSNAME:'Rosa' }),
    unknown:getWarehouseAssignedUsersForItem({ ITEMCODE:'0001' }),
    wrong:getWarehouseAssignedUsersForItem({ ITEMCODE:'0001', GENUSNAME:'Pinus' }),
    explicitNull:getWarehouseAssignedRowsForItem({ UNIQUE_ID:'none', ITEMCODE:'0002', GENUSNAME:'Acer' }).length,
    owner:getEvalTaskAutoAssigneeForItem({ UNIQUE_ID:'none', ITEMCODE:'0002', GENUSNAME:'Acer', ASSIGNEDTO:'old_owner' }),
    exportReason:getManagerAssignedItemsExportColumns().find(column=>column.label==='Assignment Reason').value(warehouseAssignedItemsInventory[0])
  }))()`));
  expect(result).toEqual({ exact:['zoe_green'], rose:['mitch_kaiser'], unknown:[], wrong:[], explicitNull:1, owner:'', exportReason:'Perennial Area: Zoe' });
});
