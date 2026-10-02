import { expect, test } from '@playwright/test';

for (const width of [320, 390, 460]) {
  test(`Grower inventory and browse filters stay compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?e2e=grower-density-007&post_deploy_access_canary=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as any).renderGrowerInventoryPanel === 'function');
    await page.evaluate(() => window.eval(`(() => {
      document.body.classList.add('ops-precision-pilot');
      processAndLoadData({ data: [
        { UNIQUE_ID:'grower-row-a', ITEMCODE:'GROWER.1', COMMONNAME:'Test Rose', CONTSIZE:'#3', LOCATIONCODE:'A.01', LOTCODE:'27.F1', SEASON:'F1', SALEYEAR:27, PTRAVAILABLE:5, PTRONHAND:8 },
        { UNIQUE_ID:'grower-row-b', ITEMCODE:'GROWER.1', COMMONNAME:'Test Rose', CONTSIZE:'#3', LOCATIONCODE:'A.01', LOTCODE:'27.F2', SEASON:'F1', SALEYEAR:27, PTRAVAILABLE:7, PTRONHAND:9 },
        { UNIQUE_ID:'grower-row-c', ITEMCODE:'GROWER.1', COMMONNAME:'Test Rose', CONTSIZE:'#3', LOCATIONCODE:'B.02', LOTCODE:'27.F1', SEASON:'F1', SALEYEAR:27, PTRAVAILABLE:3, PTRONHAND:4 }
      ], _fromCache: true });
      const masterState = getDatasetState('master');
      masterState.initialLoaded = masterState.fullLoaded = true; masterState.fieldCoverage = 'full'; masterState.rowCompleteness = 'complete';
      canUseGrowerScoutView = () => true;
      const host = document.createElement('div'); host.id='grower-density-host';
      host.style.cssText='position:fixed;inset:0;z-index:2147483647;box-sizing:border-box;padding:8px;overflow:auto;background:#061b13';
      document.body.appendChild(host);
      renderGrowerScout = () => { host.innerHTML = '<div class="grower-workspace">' + renderGrowerScoutTabs() + renderGrowerInventoryPanel() + '</div>'; };
      supabaseFetch = async (table, method, payload) => { window.savedGrowerLog = { table, method, payload }; return [payload]; };
      openProductionWorkflow = (key) => { window.growerCuttingsTarget = key; return false; };
      renderGrowerScout();
      const rail = document.createElement('div'); rail.className='crop-roll-filter-controls'; rail.id='density-test-rail';
      rail.innerHTML='<button type="button">Primary</button><button type="button">Second</button><button type="button">Third</button><button type="button">Fourth</button>';
      const wrapper = document.getElementById('view-wrapper');
      wrapper.style.display = 'block'; wrapper.style.visibility = 'visible';
      wrapper.appendChild(rail);
    })()`));
    const host = page.locator('#grower-density-host');
    await expect(host.locator('.grower-inventory-item')).toHaveCount(1);
    await expect(host.locator('.grower-item-toggle')).toContainText('Avail 15');
    await expect(host.locator('.grower-item-toggle')).toContainText('OH 21');
    await expect(host).not.toContainText('Bloom Picker');
    await expect(host).not.toContainText('Reclass');
    expect(await host.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await host.getByRole('button', { name: 'Cuttings' }).click();
    expect(await page.evaluate(() => (window as any).growerCuttingsTarget)).toBe('propagation');
    await host.locator('.grower-item-toggle').click();
    await expect(host.locator('.grower-location-total')).toHaveCount(2);
    await expect(host.locator('.grower-location-total').first()).toContainText('Avail 12 · OH 17');
    await host.locator('.grower-row-toggle').first().click();
    await host.getByLabel('Pest Code / ID').fill('P-42');
    await host.getByLabel('Sev (0–50)').fill('0');
    await host.getByLabel('Notes').fill('first row only');
    await host.locator('.grower-row-toggle').first().click();
    await host.locator('.grower-row-toggle').first().click();
    await expect(host.getByLabel('Notes')).toHaveValue('first row only');
    await host.getByRole('button', { name: 'Save scouting log' }).click();
    const saved = await page.evaluate(() => (window as any).savedGrowerLog);
    expect(saved.method).toBe('POST');
    expect(saved.payload.source_inventory_uid).toBe('grower-row-a');
    expect(saved.payload.itemcode).toBe('GROWER.1');
    expect(saved.payload.locationcode).toBe('A.01');
    expect(saved.payload.lotcode).toBe('27.F1');
    expect(saved.payload.pest_code).toBe('P-42');
    expect(saved.payload.sev_score).toBe(0);
    expect(saved.payload.status).toBe('dylan_review');
    await expect(page.locator('#density-test-rail > .mobile-browse-filters')).toHaveCount(1);
    await page.evaluate(() => document.getElementById('grower-density-host')!.appendChild(document.getElementById('density-test-rail')!));
    await expect(page.locator('#density-test-rail > .mobile-browse-filters')).toBeVisible();
    await expect(page.locator('#density-test-rail > button')).toHaveCount(1);
    await page.locator('#density-test-rail summary').click();
    await expect(page.locator('#density-test-rail').getByRole('button', { name: 'Fourth' })).toBeVisible();
    expect(await page.locator('#density-test-rail').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  });
}

test('Manager report toggles retain NotInF1 and allow an empty selection', async ({ page }) => {
  await page.goto('/?e2e=manager-report-persistence-007&post_deploy_access_canary=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).setManagerEvalReport2Reports === 'function');
  const states = await page.evaluate(() => window.eval(`(() => {
    canViewManagerEvalReports2 = () => true;
    managerEvalReport2LowStockTargetsReady = () => true;
    scheduleManagersRender = () => {};
    setManagerEvalReport2Reports(['low-stock', 'not-in-f1']);
    const both = getManagerEvalReport2SelectedReportIds();
    setManagerEvalReport2Reports(['not-in-f1']);
    invalidateManagerEvalReport2Cache();
    const remaining = getManagerEvalReport2SelectedReportIds();
    setManagerEvalReport2Reports([]);
    return { both, remaining, empty: getManagerEvalReport2SelectedReportIds(), label: getManagerEvalReport2ReportLabel() };
  })()`));
  expect(states).toEqual({ both: ['low-stock', 'not-in-f1'], remaining: ['not-in-f1'], empty: [], label: 'Choose Reports' });
});
