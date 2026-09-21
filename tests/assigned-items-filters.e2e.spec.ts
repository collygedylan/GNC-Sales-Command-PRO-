import { expect, test } from '@playwright/test';

test('Assigned Items header and phone filters share complete rows, export, sorting and safe editing', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
  });
  await page.goto('/?e2e=assigned-items-columns', { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__gncAppRuntimeExecuted === true);
  await page.evaluate(() => window.eval(`(() => {
    resetProductionLiveSync();
    currentUser = 'dylan_collyge'; currentUserDisplay = 'Dylan Collyge'; currentRole = 'Manager';
    activeHomeTab = MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW;
    managersSearchTerm = ''; managerAssignedItemsAssignedToFilter = 'all';
    managerAssignedColumnState = { owner: currentUser, filters: {}, sort: null, editor: null };
    warehouseAssignedItemsInventory = Array.from({ length: 125 }, (_, i) => ({
      UNIQUE_ID: 'assigned-' + i, ITEMCODE: String(i).padStart(6, '0'), COMMONNAME: i === 124 ? 'Zebra Rose' : 'Acer',
      ASSIGNEDTO: i === 124 ? 'dylan_collyge' : '', CONTSIZE: i === 124 ? '#5' : '#3',
      LOCATIONCODE: i === 124 ? 'D.08.002' : 'D.08.001', WAREHOUSEI: '10', SOURCE: 'Import', GENUSNAME: i === 124 ? 'Rosa' : ''
    }));
    const dataset = getDatasetState('warehouseAssignedItems'); dataset.initialLoaded = dataset.fullLoaded = true;
    evalAssignableUsersDirectoryResolved = true;
    managerEvalAssignmentSelection = new Set([buildManagerEvalAssignmentKey('000000', '')]);
    canAccessView = () => true;
    getManagerToolTabs = () => [{ id: MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW, label: 'Assigned Items' }];
    getCurrentVisibleViewId = () => 'managers';
    GncMobileWorkspace.syncHub = () => {};
    syncManagersHeaderChrome = () => {};
    const fixture = document.createElement('div'); fixture.id = 'assigned-filter-fixture';
    fixture.style.cssText = 'position:fixed;inset:8px 8px 80px;overflow:auto;z-index:12000;background:var(--ui-surface,#fff)';
    const wrapper = document.getElementById('view-wrapper');
    Array.from(wrapper.children).forEach(view => { if (view.id.startsWith('view-')) view.classList.add('hidden'); });
    document.getElementById('view-managers').classList.remove('hidden');
    fixture.appendChild(wrapper); document.body.appendChild(fixture);
    document.getElementById('managers-content').classList.remove('hidden');
    scheduleManagersRender = () => setTimeout(renderManagers, 20);
    renderManagers();
    window.__assignedExport = null;
    downloadExcelWorkbook = (columns, rows, title, search, kind, metadata) => { window.__assignedExport = { rows, metadata }; };
  })()`));
  const phone = (page.viewportSize()?.width || 1000) < 768;
  const fixture = page.locator('#assigned-filter-fixture');
  const rows = fixture.locator(phone ? '[data-manager-assigned-item-card]' : '[data-manager-assigned-item-row]');
  await expect(rows).toHaveCount(125);
  const trigger = (field: string) => fixture.locator(`${phone ? '.assigned-phone-filters' : '[data-manager-assigned-desktop-table]'} [data-assigned-filter-trigger="${field}"]`);
  const open = async (field: string) => {
    if (phone && !(await fixture.locator('.assigned-phone-filters').getAttribute('open') !== null)) await fixture.getByText('Filters & Sort', { exact: true }).click();
    await trigger(field).click();
    await expect(page.locator('#manager-assigned-filter-panel')).toBeVisible();
  };
  const panel = page.locator('#manager-assigned-filter-panel');
  for (const theme of ['light', 'dark', 'outdoor']) {
    await page.evaluate(theme => (window as any).__gncOpsPilot.primeCachedAppearance({ userKey: 'dylan_collyge', theme }), theme);
    await page.evaluate(theme => document.body.setAttribute('data-ops-theme', theme), theme);
    await open('COMMONNAME');
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger('COMMONNAME')).toBeFocused();
  }
  await open('COMMONNAME');
  await panel.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await page.locator('#manager-assigned-value-search').fill('Zebra');
  await panel.getByRole('checkbox', { name: 'Zebra Rose (1)' }).check();
  await page.evaluate(() => (window as any).renderManagers());
  await expect(page.locator('#manager-assigned-value-search')).toHaveValue('Zebra');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('000124');
  await expect(fixture).toContainText('1 bulk selection is hidden');
  await fixture.getByRole('button', { name: 'Export Excel' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__assignedExport?.rows?.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__assignedExport.metadata.find((row: string[]) => row[0] === 'Column Filters')[1])).toContain('Common Name: zebra rose');
  await open('CONTSIZE');
  await panel.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(1);
  await open('CONTSIZE');
  await panel.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await open('CONTSIZE');
  await panel.getByRole('button', { name: 'Clear Column Filter', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await fixture.getByRole('button', { name: 'Clear All Filters', exact: true }).click();
  await expect(rows).toHaveCount(125);
  await open('ITEMCODE');
  await panel.getByRole('button', { name: 'Sort Z–A ↓', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rows.first()).toContainText('000124');
  await expect(fixture.locator('[data-manager-assigned-group]')).toHaveCount(0);
  await fixture.getByRole('button', { name: 'Sort: Item Code ↓ ×', exact: true }).click();
  await expect(rows.first()).toContainText('000000');
  await expect(fixture.locator('[data-manager-assigned-group]')).toHaveCount(2);
  for (const field of ['ASSIGNEDTO', 'WAREHOUSEI', 'ITEMCODE', 'CONTSIZE', 'COMMONNAME', 'LOCATIONCODE', 'SOURCE', 'GENUSNAME']) {
    await open(field);
    await expect(panel.getByRole('checkbox').first()).toBeVisible();
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  if (phone) {
    await page.setViewportSize({ width: 320, height: 568 });
    await open('COMMONNAME');
    const narrow = await panel.boundingBox();
    expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(320);
    expect((await panel.getByRole('button', { name: 'Apply', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => (window as any).goBackUniversal());
    await expect(panel).toHaveCount(0);
    await expect(rows).toHaveCount(125);
  }
  const denied = await page.evaluate(() => window.eval(`(() => { currentUser = 'unauthorized_rep'; currentUserDisplay = 'Unauthorized Rep'; currentRole = 'REP'; return renderManagerAssignedItemsExportPanel(); })()`));
  expect(denied).toContain('available to managers only');
});
