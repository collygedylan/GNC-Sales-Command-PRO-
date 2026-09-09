import { expect, test, type Page } from '@playwright/test';

async function seedAvBlankFilters(page: Page, username: string, role: string, includeNcrRows = false) {
  // The real task UI runs against synthetic cached inventory. All external
  // HTTP and WebSocket traffic is blocked, including background writes.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=av-blank-filters', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
  await page.evaluate(({ username, role, includeNcrRows }) => {
    const w = window as any;
    if (!w.installMutationBlockedAccessCanaryIdentity(username, 'AV Blanks Filter Fixture', role)) {
      throw new Error('AV blank filter fixture identity unavailable');
    }
    w.ensureDatasetLoaded = async () => true;
    w.ensureViewDataForRender = () => false;
    const season = w.getConfiguredCurrentSeasonCode();
    const year = w.getConfiguredCurrentSalesYearCode();
    const row = {
      SEASON: season, SALESYEAR: year, SALEYEAR: year, LOTCODE: `${year}.${season}`,
      LOCATIONCODE: 'A.01.001', PRIORITY: '1', PTRONHAND: 100, PTRAVAILABLE: 100,
      ASSIGNEDTO: username, APP_TAB_ASSIGNMENT: 'season',
    };
    const rows = [
      { ...row, UNIQUE_ID: 'filter-rosa-1', ITEMCODE: 'FILTER.R1', COMMONNAME: 'Rosa Small', GENUSNAME: 'Rosa', CONTSIZE: '#1' },
      { ...row, UNIQUE_ID: 'filter-rosa-3', ITEMCODE: 'FILTER.R3', COMMONNAME: 'Rosa Large', GENUSNAME: 'Rosa', CONTSIZE: '#3' },
      { ...row, UNIQUE_ID: 'filter-ilex-1', ITEMCODE: 'FILTER.I1', COMMONNAME: 'Ilex Small', GENUSNAME: 'Ilex', CONTSIZE: '#1' },
      { ...row, UNIQUE_ID: 'filter-ilex-3', ITEMCODE: 'FILTER.I3', COMMONNAME: 'Ilex Large', GENUSNAME: 'Ilex', CONTSIZE: '#3' },
      { ...row, UNIQUE_ID: 'filter-filled', ITEMCODE: 'FILTER.FILLED', COMMONNAME: 'Already Entered', GENUSNAME: 'Excluded Genus', CONTSIZE: '#99' },
    ];
    if (includeNcrRows) {
      const next = w.getConfiguredNextSaleSeasonTarget();
      for (const [index, genus, size] of [[1, 'Ilex', '#1'], [2, 'Cercis', '#5'], [3, 'Rosa', '#1']]) {
        rows.push({ ...row, UNIQUE_ID: `filter-ncr-${index}`, ITEMCODE: `FILTER.NCR${index}`,
          COMMONNAME: `Next Crop ${index}`, GENUSNAME: String(genus), CONTSIZE: String(size),
          SEASON: next.season, SALESYEAR: next.salesYear, SALEYEAR: next.salesYear,
          LOTCODE: `${next.salesYear}.${next.season}`, S_LTS: 20 } as any);
      }
    }
    w.processAndLoadData({
      data: rows, warehouseAssignedItemsData: [],
      cavAvBlankKeysData: rows.map(item => ({ ITEMCODE: item.ITEMCODE, SEASON: season,
        HOLDSTOPREASON: item.ITEMCODE === 'FILTER.FILLED' || item.ITEMCODE.startsWith('FILTER.NCR') ? 'READY' : '' })),
      _fromCache: true,
    });
    w.hydrateDatasetLoadState(Object.fromEntries(['master', 'warehouseAssignedItems', 'cavAvBlankKeys']
      .map(key => [key, { initialLoaded: true, fullLoaded: true }])));
    w.applyRolePermissions();
    w.setTaskView('av-blanks');
    w.setTaskFilter('season');
    document.getElementById('view-login')!.style.display = 'none';
    document.getElementById('app-wrapper')!.classList.remove('hidden');
    w.switchView('tasks');
    w.renderTasks();
  }, { username, role, includeNcrRows });
  await expect(page.locator('#task-crumb')).toContainText('AV BLANKS');
}

async function expectAvBlankItems(page: Page, itemCodes: string[]) {
  await expect.poll(() => page.evaluate(() => (window as any).buildResolvedTaskState().tabItems
    .map((item: any) => item.ITEMCODE).sort())).toEqual([...itemCodes].sort());
}

async function changeAvBlankFilter(page: Page, width: number, kind: 'genus' | 'contsize', value: string) {
  await page.locator(`[data-ios-task-filter-trigger="${kind}"]`).click();
  if (width < 768) {
    const sheet = page.locator('#ios-task-filter-sheet');
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-ios-task-filter-options]').getByText(value, { exact: true }).click();
    await sheet.getByRole('button', { name: /^Done/ }).click();
    await expect(sheet).toBeHidden();
  } else {
    const filter = page.locator(`#task-${kind}-filters`);
    await filter.locator(`input[data-${kind}="${value}"]`).click();
    await filter.getByRole('button', { name: 'Done', exact: true }).click();
  }
}

for (const width of [390, 1280]) {
  for (const identity of [
    { username: 'dylan_collyge', role: 'ADMIN' },
    { username: 'madison_austin', role: 'sales/marketing' },
    { username: 'josh_vann', role: 'EVAL' },
  ]) {
    test(`AV Blanks GENUSNAME and CONTSIZE combine for ${identity.role} at ${width}px`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 844 });
      await seedAvBlankFilters(page, identity.username, identity.role);
      await expectAvBlankItems(page, ['FILTER.R1', 'FILTER.R3', 'FILTER.I1', 'FILTER.I3']);
      for (const kind of ['genus', 'contsize']) {
        const trigger = page.locator(`[data-ios-task-filter-trigger="${kind}"]`);
        await expect(trigger).toBeVisible();
        // Both filters must be discoverable before a user scrolls the rail.
        await expect(trigger).toBeInViewport({ ratio: 1 });
        const title = trigger.locator('.task-top-control-title');
        await expect(title).toHaveText(kind === 'genus' ? 'Genus Name' : 'Container Size');
        expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth),
          `${kind} label must fit without clipping`).toBe(true);
      }
      const options = await page.evaluate(() => {
        const w = window as any;
        return { genus: w.getIosTaskFilterSheetOptions('genus').options.map((option: any) => option.value),
          contsize: w.getIosTaskFilterSheetOptions('contsize').options.map((option: any) => option.value) };
      });
      expect(options).toEqual({ genus: ['Ilex', 'Rosa'], contsize: ['#1', '#3'] });
      await changeAvBlankFilter(page, width, 'genus', 'Rosa');
      await expectAvBlankItems(page, ['FILTER.R1', 'FILTER.R3']);
      await changeAvBlankFilter(page, width, 'contsize', '#3');
      await expectAvBlankItems(page, ['FILTER.R3']);
      await page.getByRole('button', { name: 'Open block A', exact: true }).click();
      await page.getByRole('button', { name: 'Open location A.01', exact: true }).click();
      await expect(page.locator('#task-content')).toContainText('Rosa Large');
      await expect(page.locator('#task-content')).not.toContainText('Rosa Small');
      await expect(page.locator('#task-content')).not.toContainText('Ilex');
      for (const kind of ['genus', 'contsize']) {
        await expect(page.locator(`[data-ios-task-filter-trigger="${kind}"]`)).toBeInViewport({ ratio: 1 });
      }
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open location A.01', exact: true })).toBeVisible();
      await expectAvBlankItems(page, ['FILTER.R3']);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open block A', exact: true })).toBeVisible();
      await expectAvBlankItems(page, ['FILTER.R3']);
      // Removing only genus retains container size; removing size restores all.
      await changeAvBlankFilter(page, width, 'genus', 'Rosa');
      await expectAvBlankItems(page, ['FILTER.R3', 'FILTER.I3']);
      await changeAvBlankFilter(page, width, 'contsize', '#3');
      await expectAvBlankItems(page, ['FILTER.R1', 'FILTER.R3', 'FILTER.I1', 'FILTER.I3']);
    });
  }

  test(`EVAL AV Blanks facets do not restrict the NCR queue at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 844 });
    await seedAvBlankFilters(page, 'josh_vann', 'EVAL', true);
    await changeAvBlankFilter(page, width, 'genus', 'Rosa');
    await changeAvBlankFilter(page, width, 'contsize', '#3');
    await expectAvBlankItems(page, ['FILTER.R3']);

    await page.evaluate(() => (window as any).setTaskSubview('ncr'));
    await expect(page.locator('#task-crumb')).toContainText('NCR');
    await expect(page.locator('[data-ios-task-filter-trigger="genus"]')).toBeHidden();
    await expect(page.locator('[data-ios-task-filter-trigger="contsize"]')).toBeHidden();
    await expectAvBlankItems(page, ['FILTER.NCR1', 'FILTER.NCR2', 'FILTER.NCR3']);

    await page.evaluate(() => (window as any).setTaskSubview('av-blanks'));
    await expect(page.locator('#task-crumb')).toContainText('AV BLANKS');
    await expect(page.locator('[data-ios-task-filter-trigger="genus"]')).toBeVisible();
    await expect(page.locator('[data-ios-task-filter-trigger="contsize"]')).toBeVisible();
    await expectAvBlankItems(page, ['FILTER.R3']);
  });
}

for (const username of ['madison_austin', 'madelyn_gray']) {
  test(`${username} sees shared AV Blanks but only Season Sales Notes`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // No real accounts, customer data, or production writes are used.
    const fixtureRows = async (table: string) => page.evaluate(table => {
      const fixture = (window as any).__marketingFixture || {};
      return fixture[table === 'ph_master_inventory' ? 'data' : table === 'ph_cav_import' ? 'cavAvBlankKeysData' : 'unused'] || [];
    }, table);
    await page.route('**/functions/v1/**', async route => {
      const body = route.request().postDataJSON() || {};
      if (body.action === 'db' && body.method !== 'GET') return route.abort();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: await fixtureRows(body.table) }) });
    });
    await page.route('**/rest/v1/**', async route => {
      if (route.request().method() !== 'GET') return route.abort();
      const table = new URL(route.request().url()).pathname.split('/').pop()!;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(await fixtureRows(table)) });
    });
    await page.goto('/?post_deploy_access_canary=sales-marketing-tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
    const result = await page.evaluate((username) => {
      const w = window as any;
      w.installMutationBlockedAccessCanaryIdentity(username, username, 'sales/marketing');
      // This is a deterministic cached-data UI test. Do not let login warmup
      // replace its three-row fixture with an unrelated empty API response.
      w.ensureDatasetLoaded = async () => true;
      w.ensureViewDataForRender = () => false;
      const season = w.getConfiguredCurrentSeasonCode();
      const year = w.getConfiguredCurrentSalesYearCode();
      const row = { UNIQUE_ID: 'sm-season-1', ITEMCODE: 'SM.001', COMMONNAME: 'Shared Season Plant', CONTSIZE: '#1',
        SEASON: season, SALESYEAR: year, SALEYEAR: year, LOTCODE: `${year}.${season}`, LOCATIONCODE: 'A.01.001',
        PRIORITY: '1', PTRONHAND: 100, PTRAVAILABLE: 100, ASSIGNEDTO: 'megan_kelly', APP_TAB_ASSIGNMENT: 'season' };
      w.__marketingFixture = { data: [row,
        { ...row, UNIQUE_ID: 'sm-held', ITEMCODE: 'SM.002', COMMONNAME: 'Held Plant', HOLDSTOPCODE: 'H', APP_TAB_ASSIGNMENT: 'location' },
        { ...row, UNIQUE_ID: 'sm-filled', ITEMCODE: 'SM.003', COMMONNAME: 'Already Entered Plant' }
      ], warehouseAssignedItemsData: [], cavAvBlankKeysData: [
        { ITEMCODE: 'SM.001', SEASON: season, HOLDSTOPREASON: '' },
        { ITEMCODE: 'SM.002', SEASON: season, HOLDSTOPREASON: '' },
        { ITEMCODE: 'SM.003', SEASON: season, HOLDSTOPREASON: 'READY' }
      ], _fromCache: true };
      w.processAndLoadData(w.__marketingFixture);
      w.hydrateDatasetLoadState(Object.fromEntries(['master', 'warehouseAssignedItems', 'cavAvBlankKeys'].map(key => [key, { initialLoaded: true, fullLoaded: true }])));
      w.applyRolePermissions();
      w.syncTaskSelectorState();
      const state = w.buildResolvedTaskState();
      document.getElementById('view-login')!.style.display = 'none';
      document.getElementById('app-wrapper')?.classList.remove('hidden');
      w.switchView('tasks');
      w.renderTasks();
      return {
        shared: w.shouldUseSharedTaskQueue('av-blanks'), target: w.getTaskViewTargetUser('av-blanks'),
        rows: state.tabItems.map((r: any) => r.ITEMCODE),
        modes: w.getTaskModeDropdownOptions().map((r: any) => r.value),
        filters: w.getTaskFilterValues('av-blanks'),
        views: [...w.getRoleAccessState().allowedViews],
      };
    }, username);
    expect(result.shared).toBe(true);
    expect(result.target).toBe('');
    expect(result.rows).toEqual(['SM.001']);
    expect(result.modes).toEqual(['av-blanks']);
    expect(result.filters).toEqual(['season']);
    expect(result.views).toEqual(expect.arrayContaining(['drive', 'tasks']));
    expect(result.views).not.toEqual(expect.arrayContaining(['managers']));
    await expect(page.locator('#task-crumb')).toContainText('AV BLANKS');
    await expect(page.locator('#task-crumb')).toContainText('SEASON SALES NOTES');
    await expect(page.getByRole('button', { name: 'Open block A', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open block A', exact: true }).click();
    await page.getByRole('button', { name: 'Open location A.01', exact: true }).click();
    await expect(page.locator('#task-content')).toContainText('Shared Season Plant');
    await expect(page.locator('#task-content')).not.toContainText('Held Plant');
    await expect(page.locator('#task-content')).not.toContainText('Already Entered Plant');
    // Leaving and returning must not reinstate a personal-assignee filter.
    const revisited = await page.evaluate(() => {
      const w = window as any;
      w.switchView('drive'); w.switchView('tasks');
      return w.buildResolvedTaskState().tabItems.map((r: any) => r.ITEMCODE);
    });
    expect(revisited).toEqual(['SM.001']);
  });
}
