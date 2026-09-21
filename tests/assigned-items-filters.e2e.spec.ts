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
  await panel.getByRole('button', { name: 'Select All', exact: true }).click();
  await page.evaluate(() => (window as any).renderManagers());
  await expect(page.locator('#manager-assigned-value-search')).toHaveValue('Zebra');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('000124');
  await expect(fixture).toContainText('1 bulk selection is hidden');
  await fixture.getByRole('button', { name: 'Export Excel' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__assignedExport?.rows?.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__assignedExport.metadata.find((row: string[]) => row[0] === 'Column Filters')[1])).toContain('Common Name: Zebra Rose');
  await open('CONTSIZE');
  await panel.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  // Touch browsers may blur the search after a button click; Escape still cancels.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
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


test('Assigned Items preserves the real navigation state and a focused editor during refreshed data', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue()
    : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=1&home_role_canary=1', { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__gncAppRuntimeExecuted === true);
  await page.evaluate(() => window.eval(`(() => {
    installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Dylan Collyge', 'Manager');
    resetProductionLiveSync();
    activeHomeTab = MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW;
    managerAssignedColumnState = { owner: currentUser, filters: {}, sort: null, editor: null };
    managersSearchTerm = ''; managerAssignedItemsAssignedToFilter = 'all';
    warehouseAssignedItemsInventory = Array.from({ length: 240 }, (_, i) => ({
      UNIQUE_ID: 'nav-' + i, ITEMCODE: String(i).padStart(6, '0'), COMMONNAME: 'Rose ' + i,
      ASSIGNEDTO: '', CONTSIZE: '#3', LOCATIONCODE: 'D.08.002', WAREHOUSEI: 0, SOURCE: 'Import', GENUSNAME: 'Rosa'
    }));
    managerEvalAssignmentSelection = new Set([buildManagerEvalAssignmentKey('000239', 'Rosa')]);
    Object.keys(DATASET_DEFINITIONS).forEach(key => {
      const state = getDatasetState(key); state.initialLoaded = state.fullLoaded = true; state.lastLoadedAt = new Date().toISOString();
    });
    evalAssignableUsersDirectoryResolved = true;
    canAccessView = () => true;
    getManagerToolTabs = () => [{ id: MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW, label: 'Assigned Items' }];
    ensureViewDataForRender = () => false;
    document.getElementById('view-login').style.setProperty('display', 'none', 'important');
    document.getElementById('app-wrapper').classList.remove('hidden');
    hasAppliedInitialHomeView = true;
    showOnlyPrimaryView('managers');
    syncCurrentViewBodyClass('managers');
    renderManagers();
    ensureNativeBackGuard();
    window.__assignedExport = null;
    downloadExcelWorkbook = (columns, rows, title, search, kind, metadata) => {
      window.__assignedExport = { ids: rows.map(row => row.UNIQUE_ID), values: rows.map(row => columns.map(col => col.value(row))), metadata };
    };
  })()`));
  const phone = (page.viewportSize()?.width || 1000) < 768;
  const panel = page.locator('#manager-assigned-filter-panel');
  const rows = page.locator(phone ? '[data-manager-assigned-item-card]' : '[data-manager-assigned-item-row]');
  const open = async (field: string) => {
    const details = page.locator('.assigned-phone-filters');
    if (phone && await details.getAttribute('open') === null) await details.locator('summary').click();
    await page.locator(`${phone ? '.assigned-phone-filters' : '[data-manager-assigned-desktop-table]'} [data-assigned-filter-trigger="${field}"]`).click();
    await expect(panel).toBeVisible();
  };
  await expect(rows).toHaveCount(240);
  await open('COMMONNAME');
  await panel.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  const search = page.locator('#manager-assigned-value-search');
  await search.fill('Rose 23');
  await panel.getByRole('button', { name: 'Select All', exact: true }).click();
  const checkbox = panel.getByRole('checkbox', { name: 'Rose 239 (1)', exact: true });
  await checkbox.focus();
  await page.evaluate(() => {
    (window as any).__assignedFocusedInput = document.activeElement;
    window.eval(`warehouseAssignedItemsInventory = warehouseAssignedItemsInventory.filter(row => row.UNIQUE_ID !== 'nav-239'); renderManagers();`);
  });
  await expect(panel.getByRole('checkbox', { name: 'Rose 239 (0)', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.activeElement === (window as any).__assignedFocusedInput)).toBe(true);
  await search.focus();
  await page.evaluate(() => {
    (window as any).__assignedSearchInput = document.activeElement;
    window.eval(`warehouseAssignedItemsInventory.push({ UNIQUE_ID:'new', ITEMCODE:'000999', COMMONNAME:'Rose 239 New', GENUSNAME:'Rosa', LOCATIONCODE:'D.08.002', WAREHOUSEI:0 }); renderManagers();`);
  });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Rose 23');
  expect(await page.evaluate(() => document.activeElement === (window as any).__assignedSearchInput)).toBe(true);
  await expect(panel.getByRole('checkbox', { name: 'Rose 239 New (1)' })).not.toBeChecked();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rows).toHaveCount(10);
  await page.getByRole('button', { name: /Export Excel/ }).click();
  const exported = await page.evaluate(() => (window as any).__assignedExport);
  expect(exported.ids).toEqual(['nav-23', ...Array.from({ length: 9 }, (_, i) => 'nav-' + (230 + i))]);
  expect(exported.values.every((row: string[]) => row[1] === '0' && row[5] === 'D.08.002')).toBe(true);
  expect(exported.values[0][2]).toBe('000023');
  const countCard = page.getByText('Visible Rows', { exact: true }).locator('..');
  await expect(countCard).toContainText('10');
  await expect(page.getByText('Total Rows', { exact: true }).locator('..')).toContainText('240');
  await open('ITEMCODE');
  await panel.getByRole('button', { name: 'Sort Z–A ↓', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Clear All Filters', exact: true }).click();
  await expect(rows).toHaveCount(240);
  await expect(page.getByRole('button', { name: 'Sort: Item Code ↓ ×', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Export Excel/ }).click();
  expect(await page.evaluate(() => (window as any).__assignedExport.ids[0])).toBe('new');
  await page.evaluate(() => window.eval(`managersSearchTerm = 'Rose'; managerAssignedItemsAssignedToFilter = 'unassigned'; renderManagers(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { setMainAreaScrollTop(500); resolve(true); })));`));
  if (await page.evaluate(() => CSS.supports('overflow-anchor', 'none'))) {
    await expect(page.locator('#main-scroll-area')).toHaveCSS('overflow-anchor', 'none');
  }
  const savedScroll = await page.evaluate(() => (window as any).getMainAreaScrollTop());
  expect(savedScroll).toBeGreaterThan(100);
  await page.evaluate(() => (window as any).goBackUniversal());
  expect(await page.evaluate(() => window.eval('activeHomeTab'))).toBe('dashboard');
  await page.evaluate(() => window.eval(`setHomeTab(MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW)`));
  await expect.poll(() => page.evaluate(() => (window as any).getMainAreaScrollTop())).toBe(savedScroll);
  await page.evaluate(() => (window as any).switchView('reports', { force: true }));
  await expect(page.locator('body')).toHaveAttribute('data-current-view', 'reports');
  expect(await page.evaluate(() => window.eval('viewHistoryStack.at(-1).scrollTop'))).toBe(savedScroll);
  await page.evaluate(() => (window as any).goBackUniversal());
  await expect(page.locator('body')).toHaveAttribute('data-current-view', 'managers');
  await expect.poll(() => page.evaluate(() => (window as any).getMainAreaScrollTop())).toBe(savedScroll);
  expect(await page.evaluate(() => window.eval(`({ search: managersSearchTerm, assignee: managerAssignedItemsAssignedToFilter, sort: getManagerAssignedColumnState().sort, selected: [...managerEvalAssignmentSelection] })`)))
    .toEqual({ search: 'Rose', assignee: 'unassigned', sort: { field: 'ITEMCODE', direction: 'desc' }, selected: ['000239|rosa'] });
  await open('SOURCE');
  await panel.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-current-view', 'managers');
  await expect(rows).toHaveCount(240);
  await open('SOURCE');
  await panel.getByRole('button', { name: 'Apply', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Sort A–Z ↑', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  if (phone) {
    await page.setViewportSize({ width: 320, height: 568 });
    await open('COMMONNAME');
    await page.locator('#manager-assigned-value-search').focus();
    // The keyboard reduces available height after a user opens the editor.
    await page.setViewportSize({ width: 320, height: 300 });
    await expect.poll(async () => (await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThanOrEqual(300);
    const bounds = await panel.boundingBox();
    for (const name of ['Apply', 'Cancel']) {
      const button = await panel.getByRole('button', { name, exact: true }).boundingBox();
      expect(button!.y).toBeGreaterThanOrEqual(bounds!.y);
      expect(button!.y + button!.height).toBeLessThanOrEqual(Math.min(300, bounds!.y + bounds!.height));
      expect(button!.height).toBeGreaterThanOrEqual(44);
    }
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 568 });
  }
  // An authorized manager may browse/export without the named assignment capability.
  await page.evaluate(() => window.eval(`currentUser = 'jd_jones'; currentUserDisplay = 'JD Jones'; currentRole = 'Manager'; renderManagers();`));
  expect(await page.evaluate(() => window.eval('managerEvalAssignmentSelection.size'))).toBe(0);
  await expect(page.getByRole('button', { name: 'Assign Selected', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Export Excel/ })).toBeVisible();
  await open('COMMONNAME');
  await page.evaluate(() => window.eval(`currentUser = 'unauthorized_rep'; currentUserDisplay = 'Unauthorized Rep'; currentRole = 'REP'; renderManagers();`));
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Export Excel/ })).toHaveCount(0);
});
