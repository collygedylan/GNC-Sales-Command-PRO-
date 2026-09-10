import { expect, test, type Page } from '@playwright/test';

async function seedHeaderFilterReport(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/?e2e=eval2-header-filters&post_deploy_access_canary=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).buildManagerEvalReport2HeaderFilterPicker === 'function');
  await page.evaluate(() => window.eval(`(() => {
    installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Dylan Collyge', 'ADMIN');
    canViewManagerEvalReports2 = () => true;
    isEvalWorkManagerUser = () => true;
    activeHomeTab = 'eval-reports-2';
    getConfiguredCurrentSeasonCode = () => 'F1';
    getConfiguredCurrentSalesYearCode = () => 27;
    getConfiguredNextSaleSeasonTarget = () => ({ season:'S1', salesYear:27 });
    const common = { SALEYEAR:27, SOURCE:'LD', PTRONHAND:20, PTRAVAILABLE:18, PRIORITY:'1', S_LTS:10 };
    window.headerFilterRows = [
      { ...common, UNIQUE_ID:'hf-a1', ITEMCODE:'HF.A', COMMONNAME:'Mixed Alpha', PLANTGROUPCODE:'330_TREES', GENUSNAME:'Acer', CONTSIZE:'#3', SEASON:'U1', BLOCKALPHA:'A', LOCATIONCODE:'A.01.001', LOTCODE:'27.U1' },
      { ...common, UNIQUE_ID:'hf-a2', ITEMCODE:'HF.A', COMMONNAME:'Mixed Alpha', PLANTGROUPCODE:'210_SHRUBS', GENUSNAME:'Rosa', CONTSIZE:'#5', SEASON:'U2', BLOCKALPHA:'A', LOCATIONCODE:'A.02.001', LOTCODE:'27.U2' },
      { ...common, UNIQUE_ID:'hf-a3', ITEMCODE:'HF.A', COMMONNAME:'Mixed Alpha', PLANTGROUPCODE:'330_TREES', GENUSNAME:'Acer', CONTSIZE:'#3', SEASON:'F1', BLOCKALPHA:'B', LOCATIONCODE:'B.01.003', LOTCODE:'27.F1' },
      { ...common, UNIQUE_ID:'hf-a4', ITEMCODE:'HF.A', COMMONNAME:'Mixed Alpha', PLANTGROUPCODE:'999_OTHER', GENUSNAME:'Acer', CONTSIZE:'#3', SEASON:'F1', BLOCKALPHA:'B', LOCATIONCODE:'B.02.004', LOTCODE:'27.F1' },
      { ...common, UNIQUE_ID:'hf-a5', ITEMCODE:'HF.A', COMMONNAME:'Mixed Alpha', PLANTGROUPCODE:'330_TREES', GENUSNAME:'Acer', CONTSIZE:'#7', SEASON:'U1', BLOCKALPHA:'A', LOCATIONCODE:'A.03.005', LOTCODE:'27.U1' },
      { ...common, UNIQUE_ID:'hf-b1', ITEMCODE:'HF.B', COMMONNAME:'Beta Tree', PLANTGROUPCODE:'330_TREES', GENUSNAME:'Acer', CONTSIZE:'#3', SEASON:'U2', BLOCKALPHA:'B', LOCATIONCODE:'B.01.001', LOTCODE:'27.U2' },
      { ...common, UNIQUE_ID:'hf-c1', ITEMCODE:'HF.C', COMMONNAME:'Gamma Shrub', PLANTGROUPCODE:'210_SHRUBS', GENUSNAME:'Rosa', CONTSIZE:'#5', SEASON:'U1', BLOCKALPHA:'C', LOCATIONCODE:'C.01.001', LOTCODE:'27.U1' },
      { ...common, UNIQUE_ID:'hf-d1', ITEMCODE:'HF.D', COMMONNAME:'Blank Fields', PLANTGROUPCODE:'', GENUSNAME:'', CONTSIZE:'', SEASON:'U1', BLOCKALPHA:'D', LOCATIONCODE:'D.01.001', LOTCODE:'27.U1' },
      { ...common, UNIQUE_ID:'hf-e1', ITEMCODE:'HF.E', COMMONNAME:'Other Assignee', PLANTGROUPCODE:'500_OTHER_USER', GENUSNAME:'Ilex', CONTSIZE:'#15', SEASON:'U1', BLOCKALPHA:'E', LOCATIONCODE:'E.01.001', LOTCODE:'27.U1' },
      { ...common, UNIQUE_ID:'hf-f1', ITEMCODE:'HF.F', COMMONNAME:'Case Fold Tree', PLANTGROUPCODE:' 330_trees ', GENUSNAME:' acer ', CONTSIZE:' #3 ', SEASON:'U1', BLOCKALPHA:'A', LOCATIONCODE:'A.04.001', LOTCODE:'27.U1' },
      { ...common, UNIQUE_ID:'hf-shft', ITEMCODE:'HF.SHFT', COMMONNAME:'Excluded Shift', PLANTGROUPCODE:'SHIFT_ONLY', GENUSNAME:'Miscanthus', CONTSIZE:'#3', SEASON:'U3', DESIGITEM:'SHFT', BLOCKALPHA:'F', LOCATIONCODE:'F.01.001', LOTCODE:'27.U3' }
    ];
    const assignments = new Map();
    window.headerFilterRows.forEach(row => assignments.set(row.ITEMCODE + '|' + row.GENUSNAME.trim().toUpperCase(), {
      UNIQUE_ID:'assign-' + row.UNIQUE_ID, ITEMCODE:row.ITEMCODE, GENUSNAME:row.GENUSNAME,
      ASSIGNEDTO:row.ITEMCODE === 'HF.E' ? 'megan_kelly' : 'dylan_collyge'
    }));
    window.headerFilterAssignments = Array.from(assignments.values());
    processAndLoadData({ data:window.headerFilterRows, warehouseAssignedItemsData:window.headerFilterAssignments, _fromCache:true });
    for (const name of ['master','warehouseAssignedItems']) { getDatasetState(name).initialLoaded = getDatasetState(name).fullLoaded = true; }
    managerEvalReport2AssignedToFilter = 'dylan_collyge';
    managerEvalReport2AssignedToFilters = new Set(['dylan_collyge']);
    managerEvalReport2SeasonFilters = new Set();
    managerEvalReport2HeaderFilters = { plantgroupcode:new Set(), contsize:new Set(), genusname:new Set() };
    managerEvalReport2LocationFilter = 'all';
    managerEvalReport2PriorityFilter = 'all';
    managersSearchTerm = '';
    managerEvalReport2BrowseMode = 'plant';
    resetManagerEvalReport2Drill();
    clearManagerEvalReport2Selection(true);
    invalidateManagerEvalReport2Cache();
    Array.from(document.querySelectorAll('#manager-eval-report-2-browse-region, #manager-eval-report-2-records')).forEach((node, index) => { node.id = 'header-filter-existing-' + index; });
    const host = document.createElement('div');
    host.id = 'eval2-header-filter-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:white;';
    document.body.appendChild(host);
    scheduleManagersRender = () => {
      host.innerHTML = renderManagerEvalReport2ReportsPanel(renderManagerEvalReport2MoreMenu(getManagerEvalReport2Index(), getManagerEvalReport2Meta(), ''));
      renderManagerEvalReport2Records();
    };
    setManagerEvalReport2Reports(['u1','u2','u3']);
    scheduleManagersRender();
    window.headerFilterDataReads = 0;
    ensureDatasetLoaded = () => { window.headerFilterDataReads++; return Promise.resolve(); };
  })()`));
  return page.locator('#eval2-header-filter-host');
}

async function selectValues(page: Page, kind: string, values: string[]) {
  const menu = page.locator(`#eval2-header-filter-host #manager-eval2-header-filter-${kind}`);
  await menu.locator('summary').click();
  await menu.locator('input[data-eval2-header-all]').check();
  for (const value of values) await menu.locator(`input[data-eval2-header-value][value=${JSON.stringify(value)}]`).check();
  await menu.getByRole('button', { name: /^Apply/ }).click();
}

async function displayedRows(page: Page) {
  return page.evaluate(() => window.eval(`getManagerEvalReport2VisibleItemGroups().map(group => ({ itemCode:group.itemCode, rows:group.rows.map(row => row.UNIQUE_ID).sort(), rowCount:group.rowCount, locationCount:group.locationCount }))`));
}

for (const width of [390, 1280]) {
  test(`Eval Reports #2 header menus filter physical rows and preserve full Queue scope at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const host = await seedHeaderFilterReport(page, width);
    for (const kind of ['plantgroupcode','contsize','genusname']) {
      await expect(host.locator(`#manager-eval2-header-filter-${kind}`)).toBeVisible();
      expect(await host.locator(`#manager-eval2-header-filter-${kind}`).evaluate(node => !node.closest('#manager-eval-report-2-more-menu'))).toBe(true);
    }
    await expect(host.locator('select[onchange*="contsize"]')).toHaveCount(0);
    const choices = await page.evaluate(() => window.eval(`getManagerEvalReport2HeaderFilterOptions('plantgroupcode').map(option => option.value)`));
    expect(choices).toEqual(['', '210_SHRUBS', '330_TREES']);

    await selectValues(page, 'plantgroupcode', ['210_SHRUBS','330_TREES']);
    await selectValues(page, 'contsize', ['#3']);
    await selectValues(page, 'genusname', ['ACER']);
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(3);
    expect(await displayedRows(page)).toEqual([
      { itemCode:'HF.A', rows:['hf-a1','hf-a3'], rowCount:2, locationCount:2 },
      { itemCode:'HF.B', rows:['hf-b1'], rowCount:1, locationCount:1 },
      { itemCode:'HF.F', rows:['hf-f1'], rowCount:1, locationCount:1 }
    ]);
    const records = host.locator('#manager-eval-report-2-records');
    await expect(records).not.toContainText('B.02.004');
    await expect(records).not.toContainText('A.02.001');
    await expect(records).not.toContainText('A.03.005');
    await page.screenshot({ path:testInfo.outputPath(`header-filters-${width}.png`) });
    await host.locator('[data-role="manager-eval2-selection-toggle"][data-itemcode="HF.A"]').click();
    expect(await page.evaluate(() => window.eval(`getManagerEvalReport2SelectedRows().map(row => row.UNIQUE_ID).sort()`))).toEqual(['hf-a1','hf-a2','hf-a3','hf-a4','hf-a5']);

    const savedKey = await page.evaluate(() => window.eval('getManagerEvalReport2HeaderFilterKey()'));
    const genus = host.locator('#manager-eval2-header-filter-genusname');
    await genus.locator('summary').click();
    await genus.locator('input[data-eval2-header-search]').fill('ro');
    await expect(genus.locator('input[data-eval2-header-value][value="ROSA"]')).toBeVisible();
    await expect(genus.locator('input[data-eval2-header-value][value="ACER"]')).not.toBeVisible();
    await genus.locator('input[data-eval2-header-value][value="ROSA"]').check();
    await page.evaluate(() => window.eval('scheduleManagersRender()'));
    await expect(genus.locator('input[data-eval2-header-search]')).toHaveValue('ro');
    await expect(genus.locator('input[data-eval2-header-value][value="ROSA"]')).toBeChecked();
    expect(await page.evaluate(() => window.eval('getManagerEvalReport2HeaderFilterKey()'))).toBe(savedKey);
    await genus.getByRole('button', { name: /^Cancel/ }).click();
    expect(await page.evaluate(() => window.eval('getManagerEvalReport2HeaderFilterKey()'))).toBe(savedKey);
    await genus.locator('summary').click();
    await expect(genus.locator('input[data-eval2-header-value][value="ROSA"]')).not.toBeChecked();
    await genus.getByRole('button', { name: /^Cancel/ }).click();

    await host.locator('#manager-eval-report-2-view-location').click();
    await expect(host.locator('[data-manager-eval2-drill-kind="blockalpha"]')).toHaveCount(2);
    expect(await page.evaluate(() => window.eval(`getManagerEvalReport2DrillGroups().map(group => ({value:group.value, rowCount:group.rowCount})).sort((a,b)=>a.value.localeCompare(b.value))`))).toEqual([{ value:'A', rowCount:2 }, { value:'B', rowCount:1 }]);
    await host.locator('[data-manager-eval2-drill-kind="blockalpha"][data-manager-eval2-drill-value="A"]').click();
    await expect(host.locator('[data-manager-eval2-drill-kind="locationcode"]')).toHaveCount(2);
    await host.locator('[data-manager-eval2-drill-kind="locationcode"][data-manager-eval2-drill-value="A.01.001"]').click();
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(1);
    await host.getByRole('button', { name:/Back/ }).click();
    await expect(host.locator('[data-manager-eval2-drill-kind="locationcode"]')).toHaveCount(2);
    expect(await page.evaluate(() => window.eval('getManagerEvalReport2HeaderFilterKey()'))).toBe(savedKey);
    expect(await page.evaluate(() => window.eval(`getManagerEvalReport2SelectedItems().map(entry => entry.itemCode)`))).toEqual(['HF.A']);
    expect(await page.evaluate(() => (window as any).headerFilterDataReads)).toBe(0);
    expect(await host.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const inquiry = await page.evaluate(() => window.eval(`(() => {
      const before = getManagerEvalReport2HeaderFilterKey();
      openManagerEvalReport2DirectInquiry(encodeURIComponent(getManagerEvalReport2ItemKey('HF.A')));
      const opened = !!argosInventoryTransactionState && !document.getElementById('argos-inventory-transaction-modal').classList.contains('hidden');
      const uid = argosInventoryTransactionState && argosInventoryTransactionState.uid;
      closeArgosInventoryTransactionModal();
      return { opened, uid, filtersRetained:before === getManagerEvalReport2HeaderFilterKey(), level:managerEvalReport2DrillLevel, block:managerEvalReport2SelectedBlockAlpha, selected:getManagerEvalReport2SelectedItems().map(entry=>entry.itemCode) };
    })()`));
    expect(inquiry).toEqual({opened:true,uid:'hf-a1',filtersRetained:true,level:1,block:'A',selected:['HF.A']});
  });

  test(`Eval Reports #2 header filters keep no-match drill state, blank values, and unavailable selections at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    const host = await seedHeaderFilterReport(page, width);
    await selectValues(page, 'genusname', ['']);
    expect((await displayedRows(page)).map((group: any) => group.itemCode)).toEqual(['HF.D']);
    await page.evaluate(() => window.eval("managersSearchTerm = 'Mixed Alpha'; scheduleManagersRender()"));
    await selectValues(page, 'genusname', ['ACER']);
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(1);
    expect((await displayedRows(page))[0].rows).toEqual(['hf-a1','hf-a3','hf-a4','hf-a5']);
    await selectValues(page, 'genusname', ['ROSA']);
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(1);
    expect((await displayedRows(page))[0].rows).toEqual(['hf-a2']);
    await expect(host.locator('#manager-eval-report-2-records')).not.toContainText('B.02.004');
    await page.evaluate(() => window.eval("managersSearchTerm = ''; scheduleManagersRender()"));
    await selectValues(page, 'genusname', []);
    await selectValues(page, 'plantgroupcode', ['210_SHRUBS']);
    await selectValues(page, 'contsize', ['#5']);
    await selectValues(page, 'genusname', ['ROSA']);
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(2);

    await host.locator('#manager-eval-report-2-view-location').click();
    await host.locator('[data-manager-eval2-drill-kind="blockalpha"][data-manager-eval2-drill-value="A"]').click();
    await host.locator('[data-manager-eval2-drill-kind="locationcode"][data-manager-eval2-drill-value="A.02.001"]').click();
    await selectValues(page, 'genusname', ['ACER']);
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(0);
    await expect(host).toContainText(/No .*match/i);
    expect(await page.evaluate(() => window.eval(`({level:managerEvalReport2DrillLevel, block:managerEvalReport2SelectedBlockAlpha, location:managerEvalReport2SelectedLocationCode})`))).toEqual({ level:2, block:'A', location:'A.02.001' });
    await selectValues(page, 'genusname', ['ROSA']);
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(1);

    await page.evaluate(() => window.eval(`(() => {
      processAndLoadData({ data:window.headerFilterRows.filter(row => row.GENUSNAME.trim().toUpperCase() !== 'ROSA'), warehouseAssignedItemsData:window.headerFilterAssignments, _fromCache:true });
      invalidateManagerEvalReport2Cache();
      scheduleManagersRender();
    })()`));
    await expect(host.locator('.manager-eval2-item-card')).toHaveCount(0);
    expect(await page.evaluate(() => window.eval(`Array.from(managerEvalReport2HeaderFilters.genusname)`))).toEqual(['ROSA']);
    const menu = host.locator('#manager-eval2-header-filter-genusname');
    await menu.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(menu.locator('input[data-eval2-header-value][value="ROSA"]')).toBeChecked();
    await menu.getByRole('button', { name: /^Cancel/ }).click();
    await page.evaluate(() => window.eval('clearManagerEvalReport2Filters()'));
    expect(await page.evaluate(() => window.eval(`Object.values(managerEvalReport2HeaderFilters).map(values => values.size)`))).toEqual([0,0,0]);
    expect(await host.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}
