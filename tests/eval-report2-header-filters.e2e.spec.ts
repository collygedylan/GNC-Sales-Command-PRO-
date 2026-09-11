// September 9 behavior coverage; see docs/rollback-sep09-validation.md.
import { expect, test } from '@playwright/test';

test('Eval Reports #2 uses real checkbox clicks and preserves whole-ITEMCODE selection in the flat view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=eval2-direct-multiselect', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderManagerEvalReports2Panel === 'function');

  await page.evaluate(() => (window as any).eval(`(() => {
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    currentRole = 'Manager';
    canViewManagerEvalReports2 = () => true;
    isEvalWorkManagerUser = () => true;
    activeHomeTab = 'eval-reports-2';
    processAndLoadData({ data: [
      { UNIQUE_ID: 'eval2-click-a', ITEMCODE: 'CLICK.A', GENUSNAME: 'Rosa', COMMONNAME: 'Alpha Canary', CONTSIZE: '#3', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '', S_LTS: 20, LOCATIONCODE: 'A.01.001', PTRAVAILABLE: 20 },
      { UNIQUE_ID: 'eval2-click-b', ITEMCODE: 'CLICK.B', GENUSNAME: 'Acer', COMMONNAME: 'Beta Canary', CONTSIZE: '#5', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '', S_LTS: 18, LOCATIONCODE: 'B.01.001', PTRAVAILABLE: 18 }
    ], warehouseAssignedItemsData: [
      { UNIQUE_ID: 'eval2-assign-a', ITEMCODE: 'CLICK.A', GENUSNAME: 'Rosa', ASSIGNEDTO: 'dylan_collyge' },
      { UNIQUE_ID: 'eval2-assign-b', ITEMCODE: 'CLICK.B', GENUSNAME: 'Acer', ASSIGNEDTO: 'dylan_collyge' }
    ], _fromCache: true });
    const masterState = getDatasetState('master');
    const assignmentState = getDatasetState('warehouseAssignedItems');
    masterState.initialLoaded = masterState.fullLoaded = true;
    assignmentState.initialLoaded = assignmentState.fullLoaded = true;
    scheduleManagersRender = () => {};
    queueScrollMainAreaToTop = () => {};
    invalidateManagerEvalReport2Cache();
    setManagerEvalReport2Mode('reports');
    setManagerEvalReport2('no-pri');
    setManagerEvalReport2Filter('assignedto', 'dylan_collyge');
    const host = document.createElement('div');
    host.id = 'eval2-multiselect-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;width:390px;overflow:auto;background:#fff;';
    host.innerHTML = renderManagerEvalReports2Panel();
    document.body.appendChild(host);
    const records = host.querySelector('#manager-eval-report-2-records');
    records.innerHTML = getManagerEvalReport2VisibleItemGroups()
      .map((group, index) => renderManagerEvalReport2SelectableCard(group, index)).join('');
  })()`));

  const host = page.locator('#eval2-multiselect-host');
  await expect(host).toContainText('Alpha Canary');
  await expect(host).toContainText('Beta Canary');

  const alphaCheckbox = host.locator('[data-role="manager-eval2-selection-toggle"][data-itemcode="CLICK.A"]');
  await expect(alphaCheckbox).toBeVisible();
  await alphaCheckbox.click();
  await expect(alphaCheckbox).toHaveAttribute('aria-pressed', 'true');
  await expect(host.locator('#manager-eval-report-2-selection-count')).toContainText('1 ITEMCODE');
  await expect(host.locator('#manager-eval-report-2-report-select')).toBeEnabled();
  await expect(host.locator("button[onclick*=\"openManagerEvalUserPicker('eval2')\"]")).toBeEnabled();

  const betaCheckbox = host.locator('[data-role="manager-eval2-selection-toggle"][data-itemcode="CLICK.B"]');
  await betaCheckbox.focus();
  await page.keyboard.press('Space');
  await expect(betaCheckbox).toHaveAttribute('aria-pressed', 'true');
  await expect(host.locator('#manager-eval-report-2-selection-count')).toContainText('2 ITEMCODEs');

  const selectShown = host.locator('#manager-eval-report-2-select-shown');
  await expect(selectShown).toContainText('Deselect Shown');
  await selectShown.click();
  await expect(host.locator('#manager-eval-report-2-selection-count')).toContainText('0 ITEMCODEs');
  await expect(selectShown).toContainText('Select All Shown');
  await selectShown.click();
  await expect(host.locator('#manager-eval-report-2-selection-count')).toContainText('2 ITEMCODEs');

  const state = await page.evaluate(() => (window as any).eval(`(() => ({
    selected: getManagerEvalReport2SelectedItems().map((entry) => entry.itemCode).sort(),
    lockedReport: getManagerEvalReport2SelectedItems()[0]?.reportId || '',
    lockedAssignedTo: getManagerEvalReport2SelectedItems()[0]?.assignedTo || '',
    compactHeader: document.getElementById('eval2-multiselect-host').textContent.includes('Eval Reports #2'),
    hasMore: !!document.querySelector('#eval2-multiselect-host #manager-eval-report-2-more-menu'),
    noLegacySelectMode: !document.getElementById('eval2-multiselect-host').textContent.includes('Select Items'),
    driveControls: !!document.querySelector('#eval2-multiselect-host .manager-eval2-drive-controls'),
    hasFlatColumns: ['Location', 'Lot', 'On Hand', 'Available'].every((label) => document.getElementById('eval2-multiselect-host').textContent.includes(label)),
    driveCards: document.querySelectorAll('#eval2-multiselect-host .manager-eval2-item-card').length,
    noRedundantOpenFooter: !document.getElementById('eval2-multiselect-host').textContent.includes('Open ITEMCODE Details')
  }))()`));
  expect(state).toEqual({
    selected: ['CLICK.A', 'CLICK.B'],
    lockedReport: 'no-pri',
    lockedAssignedTo: 'dylan_collyge',
    compactHeader: true,
    hasMore: true,
    noLegacySelectMode: true,
    driveControls: true,
    hasFlatColumns: true,
    driveCards: 2,
    noRedundantOpenFooter: true,
  });
  const managerShell = await page.evaluate(() => (window as any).eval(`(() => {
    setHomeTab('eval-reports-2');
    syncManagersHeaderChrome();
    return {
      driveShell: document.getElementById('view-managers').classList.contains('manager-eval2-drive-shell'),
      duplicateModuleBannerHidden: document.querySelector('#view-managers .manager-module-freeze').classList.contains('hidden')
    };
  })()`));
  expect(managerShell).toEqual({ driveShell: true, duplicateModuleBannerHidden: true });
  expect(await host.evaluate((element) => element.scrollWidth <= 391)).toBe(true);
});

test('Eval Reports #2 verifies a named user against current assignments before showing cards', async ({ page }) => {
  await page.goto('/?e2e=eval2-authoritative-user-filter', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).applyManagerEvalReport2UserFilter === 'function');
  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    const originalEnsureDatasetLoaded = ensureDatasetLoaded;
    let forceSeen = false;
    try {
      currentUser = 'dylan_collyge';
      currentRole = 'Manager';
      canViewManagerEvalReports2 = () => true;
      fullInventory = [
        { UNIQUE_ID:'stale-a', ITEMCODE:'STALE.A', GENUSNAME:'Rosa', COMMONNAME:'Stale Alpha', CONTSIZE:'#3', SEASON:'X', SALEYEAR:27, PRIORITY:'1', LOCATIONCODE:'A.01.001' },
        { UNIQUE_ID:'current-b', ITEMCODE:'CURRENT.B', GENUSNAME:'Acer', COMMONNAME:'Current Beta', CONTSIZE:'#5', SEASON:'X', SALEYEAR:27, PRIORITY:'1', LOCATIONCODE:'B.01.001' }
      ];
      warehouseAssignedItemsInventory = [
        { UNIQUE_ID:'assignment-a', ITEMCODE:'STALE.A', GENUSNAME:'Rosa', ASSIGNEDTO:'dylan_collyge' },
        { UNIQUE_ID:'assignment-b', ITEMCODE:'CURRENT.B', GENUSNAME:'Acer', ASSIGNEDTO:'megan_kelly' }
      ];
      const masterState = getDatasetState('master');
      const assignmentState = getDatasetState('warehouseAssignedItems');
      masterState.initialLoaded = masterState.fullLoaded = true;
      assignmentState.initialLoaded = assignmentState.fullLoaded = true;
      invalidateManagerEvalReport2Cache();
      setManagerEvalReport2Filter('assignedto', 'dylan_collyge');
      const initialAssignmentModel = GncEvalReports.buildAuthoritativeAssignmentModel(fullInventory, warehouseAssignedItemsInventory);
      const before = getManagerEvalReport2RowsBeforeCommonName(initialAssignmentModel.rows).map((row) => getManagerEvalReport2ItemCode(row));
      managerEvalReport2BrowseMode = 'plant';
      resetManagerEvalReport2Drill();
      const beforeCommonNames = getManagerEvalReport2DrillGroups(initialAssignmentModel.rows).map((group) => group.label);
      ensureDatasetLoaded = async (key, mode, options = {}) => {
        forceSeen = key === 'warehouseAssignedItems' && mode === 'full' && options.force === true;
        warehouseAssignedItemsInventory = [
          { UNIQUE_ID:'assignment-a', ITEMCODE:'STALE.A', GENUSNAME:'Rosa', ASSIGNEDTO:'megan_kelly' },
          { UNIQUE_ID:'assignment-b', ITEMCODE:'CURRENT.B', GENUSNAME:'Acer', ASSIGNEDTO:'dylan_collyge' }
        ];
        assignmentState.initialLoaded = assignmentState.fullLoaded = true;
        assignmentState.lastLoadedAt = new Date().toISOString();
        invalidateManagerEvalReport2Cache();
        return true;
      };
      const applyPromise = applyManagerEvalReport2UserFilter(new Set(['dylan_collyge']));
      const refreshingHtml = renderManagerEvalReports2Panel();
      const blockedWhileRefreshing = getManagerEvalReport2RowsBeforeCommonName(initialAssignmentModel.rows).length === 0
        && refreshingHtml.includes('Verifying current AssignedTo ownership before showing results...');
      await applyPromise;
      const currentAssignmentModel = GncEvalReports.buildAuthoritativeAssignmentModel(fullInventory, warehouseAssignedItemsInventory);
      const after = getManagerEvalReport2RowsBeforeCommonName(currentAssignmentModel.rows).map((row) => getManagerEvalReport2ItemCode(row));
      resetManagerEvalReport2Drill();
      const afterCommonNames = getManagerEvalReport2DrillGroups(currentAssignmentModel.rows).map((group) => group.label);
      const settledHtml = renderManagerEvalReports2Panel();
      return { before, after, beforeCommonNames, afterCommonNames, forceSeen, blockedWhileRefreshing, pendingAfter:settledHtml.includes('Verifying current AssignedTo ownership before showing results...') };
    } finally {
      ensureDatasetLoaded = originalEnsureDatasetLoaded;
    }
  })()`));

  expect(result).toEqual({
    before: ['STALE.A'],
    after: ['CURRENT.B'],
    beforeCommonNames: ['Stale Alpha'],
    afterCommonNames: ['Current Beta'],
    forceSeen: true,
    blockedWhileRefreshing: true,
    pendingAfter: false,
  });
});

test('Eval Reports #2 manager search refreshes while the search field remains active', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=eval2-manager-search', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderManagerEvalReports2Panel === 'function');

  const result = await page.evaluate(() => window.eval(`(async () => {
    const originalRender = renderManagers;
    const originalCanView = canViewManagerEvalReports2;
    const originalLoad = loadManagerEvalReports2;
    const originalHomeRender = renderHomeOrManagersNow;
    const originalRegionRefresh = refreshManagerEvalReport2BrowseRegion;
    const input = document.getElementById('managers-search');
    let renderCalls = 0;
    let regionRefreshCalls = 0;
    try {
      canViewManagerEvalReports2 = () => true;
      loadManagerEvalReports2 = () => Promise.resolve();
      renderHomeOrManagersNow = () => false;
      setHomeTab('eval-reports-2');
      renderManagers = () => { renderCalls += 1; };
      refreshManagerEvalReport2BrowseRegion = () => { regionRefreshCalls += 1; return true; };
      input.value = 'Karl';
      input.focus();
      handleManagersSearch();
      await new Promise((resolve) => setTimeout(resolve, 450));
      return { term: input.value, renderCalls, regionRefreshCalls };
    } finally {
      renderManagers = originalRender;
      canViewManagerEvalReports2 = originalCanView;
      loadManagerEvalReports2 = originalLoad;
      renderHomeOrManagersNow = originalHomeRender;
      refreshManagerEvalReport2BrowseRegion = originalRegionRefresh;
      input.value = '';
    }
  })()`));

  expect(result.term).toBe('Karl');
  expect(result.renderCalls).toBe(0);
  expect(result.regionRefreshCalls).toBeGreaterThan(0);
});
