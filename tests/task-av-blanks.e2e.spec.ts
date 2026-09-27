// September 9 behavior coverage; preserved complete tests/sales-marketing-tasks.e2e.spec.ts fixture.
// See docs/rollback-sep09-validation.md for deliberately removed later contracts.
import { expect, test } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';

test('AV cards show priority across card modes without hiding stock or overflowing', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'av_priority_fixture', role: 'ADMIN' });
  // Exercise the compiled card renderer with cached rows and no live services.
  const cases = [
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: '1' }, expected: '1' },
    { sourceView: 'av-photo', tab: 'open', fields: { PRIORITY: '  ', priority: '12', SOURCE: 'HL' }, expected: '12' },
    { sourceView: 'av', tab: 'reserves', fields: { PRIORITY: 0 }, expected: '0' },
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: null }, expected: '—' },
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: '<b>2</b>' }, expected: '<b>2</b>' },
  ];
  await page.evaluate(() => {
    const root = document.createElement('section');
    root.id = 'av-priority-fixture';
    root.style.cssText = 'position:relative;z-index:99999;background:white;padding:12px;max-width:680px';
    document.body.prepend(root);
  });
  for (const entry of cases) {
    await page.evaluate(({ sourceView, tab, fields }) => {
      window.eval(`activeAVTab = ${JSON.stringify(tab)}`);
      const row = { UNIQUE_ID: 'av-priority-1', DOM_ID: 'av-priority-1', ITEMCODE: 'SYNTH.001',
        COMMONNAME: 'Priority Fixture Plant', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001',
        LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: 120, S_LTS: 80, LISTPRICE: '24.50', ...fields };
      document.getElementById('av-priority-fixture')!.innerHTML = (window as any).generateCard(row, sourceView);
    }, entry);
    const card = page.locator('#av-priority-fixture .app-av-catalog-card');
    const priority = card.locator('.app-av-catalog-stock-stat--priority');
    await expect(priority.locator('.app-av-catalog-stock-label')).toHaveText('Priority');
    await expect(priority.locator('.app-av-catalog-stock-value')).toHaveText(entry.expected);
    await expect(priority.locator('b')).toHaveCount(0);
    for (const label of ['Open Stock', 'Loc On Hand', 'Loc Photo Match']) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
    if (entry.fields.SOURCE === 'HL') await expect(card.getByText('Season OH', { exact: true })).toBeVisible();
    expect(await card.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth + 1 && bounds.right <= innerWidth + 1
        && [...el.querySelectorAll('.app-av-catalog-stock-stat')].every(stat => {
          const rect = stat.getBoundingClientRect();
          return rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right;
        });
    })).toBe(true);
  }
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

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
    await expect(page.locator('#task-content')).not.toContainText('Shared Season Plant');
    await page.getByRole('button', { name: 'Open location A.01.001', exact: true }).click();
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
