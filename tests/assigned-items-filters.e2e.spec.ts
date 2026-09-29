import { expect, test, type Locator } from '@playwright/test';

test('Managers module picker excludes low-stock reads while both consuming tabs retain verified targets', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
  });
  await page.goto('/?e2e=manager-low-stock-surface-contract', { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__gncAppRuntimeExecuted === true);
  const surfaces = await page.evaluate(() => window.eval(`(() => {
    resetProductionLiveSync();
    currentUser = ''; currentRole = 'Manager';
    getCurrentVisibleViewId = () => 'managers';
    canAccessView = () => false;
    const snapshot = tab => {
      activeHomeTab = tab;
      const context = getProductionLiveSyncSideContext();
      return {
        surfaces: context.surfaces,
        adapters: window.AgMetricLiveSyncRegistry.getViewAdapters('managers', { surfaces: context.surfaces })
      };
    };
    return {
      dashboard: snapshot('dashboard'),
      assigned: snapshot(MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW),
      eval2: snapshot(MANAGER_EVAL_REPORTS_2_VIEW),
      classicEval: snapshot(MANAGER_EVAL_REPORTS_VIEW)
    };
  })()`));
  expect(surfaces.dashboard.adapters).not.toContain('side:itemLowStockTargets');
  expect(surfaces.dashboard.surfaces).not.toContain('managers:assigned-items-export');
  expect(surfaces.dashboard.surfaces).not.toContain('managers:eval-reports-2');
  expect(surfaces.classicEval.adapters).not.toContain('side:itemLowStockTargets');
  expect(surfaces.assigned.adapters).toContain('side:itemLowStockTargets');
  expect(surfaces.eval2.adapters).toContain('side:itemLowStockTargets');
});

test('Assigned Items header and phone filters share complete rows, export, sorting and safe editing', async ({ page, baseURL }, testInfo) => {
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
    await trigger(field).click();
    await expect(page.locator('#manager-assigned-filter-panel')).toBeVisible();
  };
  const panel = page.locator('#manager-assigned-filter-panel');
  await expect(fixture.locator('.assigned-filter-chip')).toHaveCount(0);
  await expect(fixture.locator('.assigned-filter-clear')).toHaveCount(0);
  await expect(trigger('COMMONNAME').locator('.assigned-filter-value')).toHaveText('All');
  if (phone) {
    const phoneFilters = fixture.locator('.assigned-phone-filters');
    await expect(phoneFilters).toBeVisible();
    await expect(phoneFilters.locator('summary')).toHaveCount(0);
    expect(await phoneFilters.evaluate(element => element.tagName)).toBe('DIV');
  }
  for (const theme of ['light', 'dark', 'outdoor']) {
    await page.evaluate(theme => (window as any).__gncOpsPilot.primeCachedAppearance({ userKey: 'dylan_collyge', theme }), theme);
    await page.evaluate(theme => document.body.setAttribute('data-ops-theme', theme), theme);
    await open('COMMONNAME');
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
    const layout = await fixture.evaluate(element => {
      const scope = element.querySelector(window.innerWidth < 768 ? '.assigned-phone-filters' : '[data-manager-assigned-desktop-table]');
      const targets = Array.from(scope?.querySelectorAll<HTMLElement>('[data-assigned-filter-trigger]') || [])
        .filter(node => node.getClientRects().length).map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
      const search = document.getElementById('manager-assigned-value-search');
      return { targets, pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        searchFont: search ? parseFloat(getComputedStyle(search).fontSize) : 0 };
    });
    expect(layout.targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(layout)).toBe(true);
    expect(layout.pageOverflow, JSON.stringify(layout)).toBeLessThanOrEqual(1);
    if (phone) expect(layout.searchFont).toBeGreaterThanOrEqual(16);
    if (theme === 'light' || theme === 'dark') await page.screenshot({ path: testInfo.outputPath(`assigned-items-compact-${theme}.png`) });
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
  await expect(trigger('COMMONNAME').locator('.assigned-filter-value')).toHaveText('Zebra Rose');
  await expect(fixture.locator('.assigned-filter-clear')).toBeVisible();
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
  await expect(trigger('CONTSIZE').locator('.assigned-filter-value')).toHaveText('0 selected');
  await open('CONTSIZE');
  await panel.getByRole('button', { name: 'Clear Column Filter', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await fixture.getByRole('button', { name: 'Clear All Filters', exact: true }).click();
  await expect(rows).toHaveCount(125);
  await expect(fixture.locator('.assigned-filter-clear')).toHaveCount(0);
  await open('ITEMCODE');
  await panel.getByRole('button', { name: 'Sort Z–A ↓', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rows.first()).toContainText('000124');
  await expect(fixture.locator('[data-manager-assigned-group]')).toHaveCount(0);
  await expect(trigger('ITEMCODE').locator('.assigned-filter-value')).toHaveText('All');
  await expect(trigger('ITEMCODE')).toContainText('↓');
  await expect(fixture.locator('.assigned-filter-chip')).toHaveCount(0);
  await open('ITEMCODE');
  await panel.getByRole('button', { name: 'Clear Sort', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
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
    fullInventory = []; rebuildMasterInventoryIndexes();
    warehouseAssignedItemsInventory = Array.from({ length: 240 }, (_, i) => ({
      UNIQUE_ID: 'nav-' + i, ITEMCODE: String(i).padStart(6, '0'), COMMONNAME: 'Rose ' + i,
      ASSIGNEDTO: '', CONTSIZE: '#3', LOCATIONCODE: 'D.08.002', WAREHOUSEI: 0, SOURCE: 'Import', GENUSNAME: 'Rosa'
    }));
    window.__targetReadReleased = false;
    window.__heldTargetReadResolvers = [];
    window.__releaseTargetReads = () => {
      window.__targetReadReleased = true;
      const pending = window.__heldTargetReadResolvers.splice(0);
      pending.forEach(release => release());
    };
    const originalTargetRpc = supabaseRpc;
    supabaseRpc = async (name, args, options) => {
      if (name !== 'get_eval_item_low_stock_targets_v1' || !Array.isArray(args?.p_itemcodes)) return originalTargetRpc(name, args, options);
      const rows = args.p_itemcodes.map(itemcode => ({ itemcode_normalized: itemcode, history_ready: true, history_pending_files: 0, history_total_files: 4, qualifying_line_count: 12, qualifying_day_count: 4, source_file_count: 4, mean_quantity: 8, p75_quantity: 12, suggested_qty: 12, manual_override_qty: null, effective_qty: 12, override_revision: 0, history_from_date: '2026-09-01', history_through_date: '2026-09-26', calculated_at: '2026-09-27T12:00:00Z' }));
      if (window.__targetReadReleased) return rows;
      return new Promise(resolve => window.__heldTargetReadResolvers.push(() => resolve(rows)));
    };
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
  await page.waitForFunction(() => (window as any).eval('managerItemLowStockTargetsState.loading') && (window as any).__heldTargetReadResolvers.length > 0);
  const phone = (page.viewportSize()?.width || 1000) < 768;
  const panel = page.locator('#manager-assigned-filter-panel');
  const rows = page.locator(phone ? '[data-manager-assigned-item-card]' : '[data-manager-assigned-item-row]');
  const open = async (field: string) => {
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
  await expect(rows).toHaveCount(10);
  const assignedTo = page.getByRole('combobox', { name: 'AssignedTo', exact: true });
  await expect(assignedTo).toHaveValue('all');
  await expect(assignedTo).toContainText('All AssignedTo (240)');
  await expect(page.getByText('Visible Rows', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Total Rows', { exact: true })).toHaveCount(0);
  await open('ITEMCODE');
  await panel.getByRole('button', { name: 'Sort Z–A ↓', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Clear All Filters', exact: true }).click();
  await expect(rows).toHaveCount(240);
  await expect(page.locator(`${phone ? '.assigned-phone-filters' : '[data-manager-assigned-desktop-table]'} [data-assigned-filter-trigger="ITEMCODE"]`)).toContainText('↓');
  await expect(page.locator('.assigned-filter-chip')).toHaveCount(0);
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
  // Resolve a genuinely delayed history read in the same turn as the return
  // navigation. Its completion render must not stomp the navigation scroll restore.
  await page.evaluate(() => {
    (window as any).goBackUniversal();
    (window as any).__releaseTargetReads?.();
  });
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

test('Assigned Items low-stock targets preserve focused drafts, enforce editor identities and export report-matched averages', async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
  });
  await page.goto('/?e2e=assigned-item-low-stock', { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__gncAppRuntimeExecuted === true);
  await page.evaluate(() => window.eval(`(() => {
    resetProductionLiveSync();
    currentUser = 'jd_jones'; currentUserDisplay = 'JD Jones'; currentRole = 'Manager';
    activeHomeTab = MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW; managersSearchTerm = ''; managerAssignedItemsAssignedToFilter = 'all';
    warehouseAssignedItemsInventory = [
      { UNIQUE_ID: 'target-a', ITEMCODE: 'ab-100', COMMONNAME: 'Alpha', ASSIGNEDTO: 'jd_jones', CONTSIZE: '#3', LOCATIONCODE: 'D.01.001', WAREHOUSEI: '10', SOURCE: 'Import', GENUSNAME: 'Rosa' },
      { UNIQUE_ID: 'target-b', ITEMCODE: 'cd-200', COMMONNAME: 'Beta', ASSIGNEDTO: '', CONTSIZE: '#5', LOCATIONCODE: 'D.01.002', WAREHOUSEI: '10', SOURCE: 'Import', GENUSNAME: 'Acer' }
    ];
    const ds = getDatasetState('warehouseAssignedItems'); ds.initialLoaded = ds.fullLoaded = true;
    evalAssignableUsersDirectoryResolved = true; canAccessView = () => true;
    getManagerToolTabs = () => [{ id: MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW, label: 'Assigned Items' }];
    getCurrentVisibleViewId = () => 'managers'; GncMobileWorkspace.syncHub = () => {}; syncManagersHeaderChrome = () => {};
    const targetA = { itemcode_normalized: 'AB-100', history_ready: true, history_pending_files: 0, history_total_files: 4, history_from_date: '2026-09-10', history_through_date: '2026-09-26', calculated_at: '2026-09-27T12:00:00Z', qualifying_line_count: 8, qualifying_day_count: 4, source_file_count: 4, mean_quantity: 11.75, p75_quantity: 18, suggested_qty: 20, manual_override_qty: null, effective_qty: 20, override_revision: 3, updated_at: '2026-09-27T12:00:00Z' };
    const targetB = { itemcode_normalized: 'CD-200', history_ready: true, history_pending_files: 0, history_total_files: 2, history_from_date: '2026-09-10', history_through_date: '2026-09-26', calculated_at: '2026-09-27T12:00:00Z', qualifying_line_count: 2, qualifying_day_count: 2, source_file_count: 2, mean_quantity: 3, p75_quantity: 5, suggested_qty: 6, manual_override_qty: 4, effective_qty: 4, override_revision: 7, updated_at: '2026-09-27T12:00:00Z' };
    managerItemLowStockTargetsState = { owner: currentUser, key: '', loadingKey: '', errorKey: '', rowsByCode: new Map([['AB-100', targetA], ['CD-200', targetB]]), loading: false, error: '', promise: null, requestId: 0, revision: 1, drafts: new Map(), saving: new Set() };
    managerItemLowStockTargetsState.key = getManagerAssignedItemTargetKey();
    window.__lowStockRpcCalls = [];
    window.__simulateLowStockConflict = false;
    supabaseRpc = async (name, args) => {
      window.__lowStockRpcCalls.push({ name, args });
      if (name === 'get_eval_item_low_stock_targets_v1') return args.p_itemcodes == null
        ? Array.from(managerItemLowStockTargetsState.rowsByCode.values())
        : args.p_itemcodes.map(code => managerItemLowStockTargetsState.rowsByCode.get(code)).filter(Boolean);
      const prior = managerItemLowStockTargetsState.rowsByCode.get(args.p_itemcode);
      if (window.__simulateLowStockConflict) {
        window.__simulateLowStockConflict = false;
        managerItemLowStockTargetsState.rowsByCode.set(args.p_itemcode, { ...prior, manual_override_qty: 9, effective_qty: 9, override_revision: Number(prior.override_revision) + 1 });
        throw Object.assign(new Error('LOW_STOCK_OVERRIDE_CONFLICT'), { status: 40001 });
      }
      const target = { ...prior, manual_override_qty: args.p_override_qty, effective_qty: args.p_override_qty == null ? prior.suggested_qty : args.p_override_qty, override_revision: Number(prior.override_revision) + 1 };
      managerItemLowStockTargetsState.rowsByCode.set(args.p_itemcode, target);
      return [target];
    };
    window.__assignedExports = [];
    downloadExcelWorkbook = (columns, rows, title, search, kind, metadata) => window.__assignedExports.push({ columns: columns.map(column => column.label), rows, kind, metadata });
    scheduleManagersRender = () => setTimeout(renderManagers, 10);
    const fixture = document.createElement('div'); fixture.id = 'low-stock-assigned-fixture';
    fixture.style.cssText = 'position:fixed;inset:8px 8px 80px;overflow:auto;z-index:12000;background:var(--ui-surface,#fff)';
    const wrapper = document.getElementById('view-wrapper');
    Array.from(wrapper.children).forEach(view => { if (view.id.startsWith('view-')) view.classList.add('hidden'); });
    document.getElementById('view-managers').classList.remove('hidden'); fixture.appendChild(wrapper); document.body.appendChild(fixture);
    document.getElementById('managers-content').classList.remove('hidden'); renderManagers();
  })()`));

  const fixture = page.locator('#low-stock-assigned-fixture');
  const row = fixture.locator('[data-manager-assigned-item-card], [data-manager-assigned-item-row]').filter({ has: page.locator('[data-low-stock-override="AB-100"]') });
  const targetInput = fixture.locator('[data-low-stock-override="AB-100"]');
  await expect(targetInput).toHaveValue('20');
  await expect(targetInput).toHaveAttribute('inputmode', 'numeric');
  await expect(fixture.locator('[data-manager-item-average="AB-100"]').first()).toHaveText('11.8');
  await expect(row.getByText('8 lines · 4 days · 4 files · Limited history')).toBeVisible();
  await row.getByText('8 lines · 4 days · 4 files · Limited history').click();
  await expect(row.getByText('History 2026-09-10 to 2026-09-26')).toBeVisible();
  const activateTargetControl = async (locator: Locator) => {
    if (testInfo.project.use.isMobile) await locator.tap();
    else await locator.click();
  };

  const rights = await page.evaluate(() => window.eval(`(() => {
    const originalUser = currentUser, originalDisplay = currentUserDisplay;
    const results = {};
    for (const [user, display] of [['dylan_collyge',''],['megan_kelly',''],['jd_jones',''],['other_user','Other User']]) {
      currentUser = user; currentUserDisplay = display; results[user] = canManageItemLowStockTargets();
    }
    currentUser = originalUser; currentUserDisplay = originalDisplay; return results;
  })()`));
  expect(rights).toEqual({ dylan_collyge: true, megan_kelly: true, jd_jones: true, other_user: false });

  await page.evaluate(() => window.eval(`managerItemLowStockTargetsState.rowsByCode.get('CD-200').history_ready = false; renderManagers()`));
  await expect(fixture.getByRole('button', { name: /History Processing/ })).toBeDisabled();
  await expect(fixture.getByText(/Refreshing history; active targets remain in effect/).first()).toBeVisible();
  await page.evaluate(() => window.eval(`managerItemLowStockTargetsState.rowsByCode.get('CD-200').history_ready = true; renderManagers()`));

  await targetInput.fill('27');
  await page.evaluate(() => window.eval('renderManagers()'));
  await expect(targetInput).toHaveValue('27');
  await expect(targetInput).toBeFocused();
  await targetInput.fill('25');
  await activateTargetControl(row.getByRole('button', { name: 'Save', exact: true }));
  await expect(targetInput).toHaveValue('25');
  await expect.poll(() => page.evaluate(() => (window as any).__lowStockRpcCalls.filter((call: any) => call.name === 'set_eval_item_low_stock_override_v1').length)).toBe(1);
  let calls = await page.evaluate(() => (window as any).__lowStockRpcCalls);
  expect(calls[0]).toEqual({ name: 'set_eval_item_low_stock_override_v1', args: { p_itemcode: 'AB-100', p_override_qty: 25, p_expected_revision: 3 } });
  await activateTargetControl(row.getByRole('button', { name: 'Use suggestion', exact: true }));
  await expect(targetInput).toHaveValue('20');
  await expect.poll(() => page.evaluate(() => (window as any).__lowStockRpcCalls.filter((call: any) => call.name === 'set_eval_item_low_stock_override_v1').length)).toBe(2);
  calls = await page.evaluate(() => (window as any).__lowStockRpcCalls);
  expect(calls[1]).toEqual({ name: 'set_eval_item_low_stock_override_v1', args: { p_itemcode: 'AB-100', p_override_qty: null, p_expected_revision: 4 } });

  await page.evaluate(() => window.eval('window.__simulateLowStockConflict = true'));
  await targetInput.fill('31');
  await activateTargetControl(row.getByRole('button', { name: 'Save', exact: true }));
  await expect(targetInput).toHaveValue('9');
  await expect.poll(() => page.evaluate(() => (window as any).__lowStockRpcCalls.filter((call: any) => call.name === 'set_eval_item_low_stock_override_v1').length)).toBe(3);
  calls = await page.evaluate(() => (window as any).__lowStockRpcCalls);
  expect(calls[2]).toEqual({ name: 'set_eval_item_low_stock_override_v1', args: { p_itemcode: 'AB-100', p_override_qty: 31, p_expected_revision: 5 } });
  expect(calls[3]).toEqual({ name: 'get_eval_item_low_stock_targets_v1', args: { p_itemcodes: ['AB-100'] } });
  await targetInput.fill('9.5');
  await activateTargetControl(row.getByRole('button', { name: 'Save', exact: true }));
  await expect.poll(() => page.evaluate(() => (window as any).__lowStockRpcCalls.filter((call: any) => call.name === 'set_eval_item_low_stock_override_v1').length)).toBe(3);
  await targetInput.fill('');
  await activateTargetControl(row.getByRole('button', { name: 'Save', exact: true }));
  await expect.poll(() => page.evaluate(() => (window as any).__lowStockRpcCalls.filter((call: any) => call.name === 'set_eval_item_low_stock_override_v1').length)).toBe(3);
  await page.evaluate(() => window.eval(`managerItemLowStockTargetsState.drafts.delete('AB-100'); renderManagers()`));
  await expect(targetInput).toHaveValue('9');
  await activateTargetControl(row.getByRole('button', { name: 'Save', exact: true }));
  await expect.poll(() => page.evaluate(() => (window as any).__lowStockRpcCalls.filter((call: any) => call.name === 'set_eval_item_low_stock_override_v1').length)).toBe(4);
  calls = await page.evaluate(() => (window as any).__lowStockRpcCalls);
  expect(calls[4]).toEqual({ name: 'set_eval_item_low_stock_override_v1', args: { p_itemcode: 'AB-100', p_override_qty: 9, p_expected_revision: 6 } });

  for (const theme of ['light', 'dark', 'outdoor']) {
    await page.evaluate(theme => {
      (window as any).__gncOpsPilot.primeCachedAppearance({ userKey: 'jd_jones', theme });
      document.body.setAttribute('data-ops-theme', theme);
    }, theme);
    await expect(targetInput).toBeVisible();
    expect(await targetInput.evaluate(input => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(14);
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.eval('renderManagers()'));
      await expect(targetInput).toBeVisible();
      const bounds = await row.evaluate(card => {
        const cardRect = card.getBoundingClientRect();
        const controls = Array.from(card.querySelectorAll('.manager-item-low-stock-editor input, .manager-item-low-stock-editor button'))
          .filter((control: any) => control.getBoundingClientRect().width > 0)
          .map((control: any) => {
            const rect = control.getBoundingClientRect();
            return { left: rect.left, right: rect.right, height: rect.height, clientWidth: control.clientWidth, scrollWidth: control.scrollWidth };
          });
        return {
          card: { left: cardRect.left, right: cardRect.right, clientWidth: card.clientWidth, scrollWidth: card.scrollWidth },
          controls
        };
      });
      expect(bounds.controls.length).toBeGreaterThanOrEqual(3);
      expect(bounds.card.scrollWidth).toBeLessThanOrEqual(bounds.card.clientWidth + 1);
      for (const control of bounds.controls) {
        expect(control.left).toBeGreaterThanOrEqual(bounds.card.left - 1);
        expect(control.right).toBeLessThanOrEqual(bounds.card.right + 1);
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
      }
      if (width === 320) {
        await row.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`low-stock-${theme}-${width}.png`) });
      }
    }
  }
  await fixture.getByRole('button', { name: /Export Excel/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__assignedExports.length)).toBe(1);
  let exported = await page.evaluate(() => (window as any).__assignedExports[0]);
  expect(exported.columns).toContain('Average Order Qty');
  expect(exported.columns).toContain('Low Stock Qty');
  await fixture.getByRole('button', { name: /Average Summary/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__assignedExports.length)).toBe(2);
  exported = await page.evaluate(() => (window as any).__assignedExports[1]);
  expect(exported.kind).toBe('assigned-items-average-summary');
  expect(exported.rows).toHaveLength(2);
  expect(exported.columns).toContain('P75 Order Qty');
  expect(exported.columns).toContain('History From');
  expect(exported.columns).toContain('Calculated At');
  expect(exported.metadata).toContainEqual(['Summary', 'All archived history; for each warehouse/order/consignee/ItemCode group, use its latest qualifying daily snapshot and weight individual order lines equally.']);
  calls = await page.evaluate(() => (window as any).__lowStockRpcCalls);
  expect(calls[5]).toEqual({ name: 'get_eval_item_low_stock_targets_v1', args: { p_itemcodes: null, p_after_itemcode: null, p_limit: 500 } });
  expect(exported.rows.find((summary: any) => summary.ITEMCODE === 'AB-100').AVG_ORDER_QTY).toBe(11.75);

  await page.evaluate(() => window.eval(`(() => {
    const target = managerItemLowStockTargetsState.rowsByCode.get('CD-200');
    Object.assign(target, { qualifying_line_count: 0, qualifying_day_count: 0, source_file_count: 0, mean_quantity: null, suggested_qty: null, effective_qty: 150 });
    renderManagers();
  })()`));
  await expect(fixture.locator('[data-manager-item-average="CD-200"]')).toHaveText('—');
  await expect(fixture.getByText('No qualifying history · using target 150')).toBeVisible();

  const emptyHistoryExported = await page.evaluate(() => window.eval(`(async () => {
    const originalRpc = supabaseRpc;
    supabaseRpc = async (name, args) => name === 'get_eval_item_low_stock_targets_v1' && args.p_itemcodes == null ? [] : originalRpc(name, args);
    try { return await exportManagerAssignedAverageSummaryToExcel(); }
    finally { supabaseRpc = originalRpc; }
  })()`));
  expect(emptyHistoryExported).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as any).__assignedExports.length)).toBe(2);
});
