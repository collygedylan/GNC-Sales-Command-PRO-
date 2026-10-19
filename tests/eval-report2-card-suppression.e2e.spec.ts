import { expect, test } from '@playwright/test';
// @test-group: @local-e2e,@release-functional,eval

test('Eval Reports #2 hides only fully suppressed ITEMCODE cards across report, search, flat, and drill modes', { tag: ['@local-e2e', '@release-functional'] }, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?e2e=eval2-card-suppression', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderManagerEvalReports2Panel === 'function'
    && typeof (window as any).GncEvalReports?.isSuppressedEvalReportCardRows === 'function');

  const sourceRows = [
    { UNIQUE_ID: 'jim-y-1', ITEMCODE: '000201.030.1', COMMONNAME: 'Jim Dandy Winterberry', CONTSIZE: '#3', SEASON: 'Y', SALEYEAR: 27, LOTCODE: '27.Y', LOCATIONCODE: 'K.01.000', PRIORITY: '', S_LTS: 82, PTRONHAND: 82, PTRAVAILABLE: 82, ITEMDESI: '' },
    { UNIQUE_ID: 'lot-u3', ITEMCODE: 'LOT.ONLY', COMMONNAME: 'Lot Suffix Fixture', CONTSIZE: '#1', SEASON: 'F1', SALEYEAR: 27, LOTCODE: '27.U3', LOCATIONCODE: 'L.01.001', PRIORITY: '', S_LTS: 24, ITEMDESI: '' },
    { UNIQUE_ID: 'desi-shft', ITEMCODE: 'SHFT.ONLY', COMMONNAME: 'Shift Fixture', CONTSIZE: '#1', SEASON: 'S1', SALEYEAR: 27, LOTCODE: '27.S1', LOCATIONCODE: 'H.01.001', PRIORITY: '', S_LTS: 22, ITEMDESI: 'season shFt label' },
    { UNIQUE_ID: 'salsa-s1', ITEMCODE: '000193.031.1', COMMONNAME: 'Salsa Dancer™ Hibiscus', CONTSIZE: '#3', SEASON: 'S1', SALEYEAR: 27, LOTCODE: '27.S1', LOCATIONCODE: 'C.06.005', PRIORITY: '', S_LTS: 35, ITEMDESI: '' },
    { UNIQUE_ID: 'salsa-s1-2', ITEMCODE: '000193.031.1', COMMONNAME: 'Salsa Dancer™ Hibiscus', CONTSIZE: '#3', SEASON: 'S1', SALEYEAR: 27, LOTCODE: '27.S1', LOCATIONCODE: 'C.06.006', PRIORITY: '', S_LTS: 35, ITEMDESI: '' },
    { UNIQUE_ID: 'salsa-z', ITEMCODE: '000193.031.1', COMMONNAME: 'Salsa Dancer', CONTSIZE: '#3', SEASON: 'Z', SALEYEAR: 27, LOTCODE: '26.Z', LOCATIONCODE: 'C.06.029', PRIORITY: '', S_LTS: 18, ITEMDESI: '' },
    { UNIQUE_ID: 'mixed-u3', ITEMCODE: 'MIXED.ACTIVE', COMMONNAME: 'Mixed Season Fixture', CONTSIZE: '#1', SEASON: 'U3', SALEYEAR: 27, LOTCODE: '27.U3', LOCATIONCODE: 'M.01.001', PRIORITY: '', S_LTS: 16, ITEMDESI: '' },
    { UNIQUE_ID: 'mixed-s1', ITEMCODE: 'MIXED.ACTIVE', COMMONNAME: 'Mixed Season Fixture', CONTSIZE: '#1', SEASON: 'S1', SALEYEAR: 27, LOTCODE: '27.S1', LOCATIONCODE: 'M.01.002', PRIORITY: '', S_LTS: 12, ITEMDESI: '' }
  ];

  const result = await page.evaluate((rows) => {
    (window as any).__eval2SuppressionFixture = rows;
    return (window as any).eval(`(() => {
      const rows = window.__eval2SuppressionFixture;
      currentUser = 'dylan_collyge';
      currentUserDisplay = 'Dylan Collyge';
      currentRole = 'Manager';
      canViewManagerEvalReports2 = () => true;
      isEvalWorkManagerUser = () => true;
      activeHomeTab = MANAGER_EVAL_REPORTS_2_VIEW;
      processAndLoadData({
        data: rows,
        warehouseAssignedItemsData: rows.map(row => ({
          master_unique_id: row.UNIQUE_ID, UNIQUE_ID: row.UNIQUE_ID, ITEMCODE: row.ITEMCODE,
          GENUSNAME: row.GENUSNAME || 'Rosa', ASSIGNEDTO: 'dylan_collyge'
        })),
        _fromCache: true
      });
      const masterState = getDatasetState('master');
      const assignedState = getDatasetState('warehouseAssignedItems');
      masterState.initialLoaded = masterState.fullLoaded = true;
      masterState.fieldCoverage = 'full'; masterState.rowCompleteness = 'complete';
      assignedState.initialLoaded = assignedState.fullLoaded = true;
      assignedState.fieldCoverage = 'full'; assignedState.rowCompleteness = 'complete';
      scheduleManagersRender = () => {};
      queueScrollMainAreaToTop = () => {};
      managersSearchTerm = '';
      managerEvalReport2BrowseMode = 'plant';
      managerEvalReport2DrillLevel = 0;
      managerEvalReport2SelectedReportIds = ['no-pri'];
      activeManagerEvalReport2 = 'no-pri';
      managerEvalReport2AssignedToFilters = new Set();
      managerEvalReport2SeasonFilters = new Set();
      managerEvalReport2ContSizeFilter = 'all';
      managerEvalReport2LocationFilter = 'all';
      managerEvalReport2PriorityFilter = 'all';
      managerEvalReport2AssignmentFilterRefreshing = false;
      invalidateManagerEvalReport2Cache();
      const index = getManagerEvalReport2Index(true);
      const rawCount = index.allRows.length;
      const rawIndexRowsBefore = index.allRows.slice();
      const masterBefore = JSON.stringify(fullInventory);
      const initialRows = getManagerEvalReport2Rows('no-pri');
      const initialGroups = getManagerEvalReport2VisibleItemGroups();
      const initialCardHtml = initialGroups.map(renderManagerEvalReport2SelectableCard).join('');
      const u3Codes = getManagerEvalReport2Rows('u3').map(getManagerEvalReport2ItemCode).sort();
      const rawPreserved = fullInventory.length === rows.length && index.allRows.length === rows.length
        && index.rowsByItemCode.get('000201.030.1').length === 1;
      managersSearchTerm = 'Jim Dandy';
      const hiddenSearchCount = getManagerEvalReport2VisibleItemGroups().length;
      managersSearchTerm = 'Salsa Dancer';
      const visibleSearchCodes = getManagerEvalReport2VisibleItemGroups().map(group => group.itemCode);
      managersSearchTerm = '';
      managerEvalReport2BrowseMode = 'location';
      managerEvalReport2DrillLevel = 0;
      const blockGroups = getManagerEvalReport2DrillGroups();
      return {
        rawCount, reportCodes: initialRows.map(getManagerEvalReport2ItemCode).sort(),
        visibleCodes: initialGroups.map(group => group.itemCode).sort(),
        hiddenNamesAbsent: !initialCardHtml.includes('Jim Dandy') && !initialCardHtml.includes('Lot Suffix Fixture') && !initialCardHtml.includes('Shift Fixture'),
        salsaCardPresent: initialCardHtml.includes('Salsa Dancer'),
        u3Codes, hiddenSearchCount, visibleSearchCodes,
        blockGroupsContainHiddenFixture: blockGroups.some(group => group.rows.some(row => row.ITEMCODE === '000201.030.1')),
        rawPreserved, dataIdentityPreserved: index.allRows.every((row, i) => row === rawIndexRowsBefore[i])
          && JSON.stringify(fullInventory) === masterBefore
      };
    })()`);
  }, sourceRows);

  expect(result).toEqual({
    rawCount: 8,
    reportCodes: ['000193.031.1', '000193.031.1', '000193.031.1', 'MIXED.ACTIVE', 'MIXED.ACTIVE'],
    visibleCodes: ['000193.031.1', 'MIXED.ACTIVE'],
    hiddenNamesAbsent: true,
    salsaCardPresent: true,
    u3Codes: ['MIXED.ACTIVE'],
    hiddenSearchCount: 0,
    visibleSearchCodes: ['000193.031.1'],
    blockGroupsContainHiddenFixture: false,
    rawPreserved: true,
    dataIdentityPreserved: true,
  });
});
