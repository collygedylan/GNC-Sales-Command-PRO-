import { expect, test } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';
const tileSelector = (view: string, dynamic: boolean) => dynamic ? `#home-sales-open-${view}` : `#home-tile-${view}`;

const nativeStartupCases = [
  { username: 'native_start_admin', role: 'ADMIN', startupMode: 'cold', dynamic: false, visible: ['drive', 'managers'] },
  { username: 'native_start_manager', role: 'MANAGER', startupMode: 'restored', dynamic: false, visible: ['drive', 'managers'] },
  { username: 'native_start_rep', role: 'REP', startupMode: 'cold', dynamic: true, visible: ['drive', 'sales'] },
  { username: 'native_start_csr', role: 'CSR', startupMode: 'restored', dynamic: true, visible: ['drive', 'sales'] },
  { username: 'native_start_restricted_rep', role: 'REP', startupMode: 'restored', dynamic: true, visible: ['sales'], denied: ['drive'] },
  { username: 'native_start_qc_restricted', role: 'QC', startupMode: 'cold', dynamic: false, visible: ['qc', 'production'], denied: ['managers'] }
];

for (const entry of nativeStartupCases) {
  test(`native ${entry.startupMode} startup waits for authoritative ${entry.role} access before opening its Home`, async ({ page, baseURL }) => {
    const permissions = (entry.denied || []).map(moduleKey => ({ permissionKey: `module.${moduleKey}.view`, kind: 'module', moduleKey, allowed: false }));
    const fixture = await installHlOrderFixture(page, baseURL!, {
      username: entry.username,
      role: entry.role,
      startupMode: entry.startupMode,
      appPermissions: permissions,
      appAccessDelayMs: 180,
      holdBackgroundMasterMs: 1600
    });
    await expect(page.locator('#view-login')).toBeHidden();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-current-view', 'home');
    await expect.poll(() => page.evaluate(() => window.eval('appAccessSnapshotState.status'))).toBe('ready');
    expect(fixture.appAccessReads).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => window.eval('currentUser'))).toBe(entry.username);
    expect(await page.evaluate(() => window.eval('currentRole'))).toBe(entry.role);
    const grid = page.locator(entry.dynamic ? '#home-rep-dashboard-grid' : '#home-dashboard-grid');
    await expect(grid).toBeVisible();
    for (const view of entry.visible) await expect(page.locator(tileSelector(view, entry.dynamic))).toBeVisible();
    for (const view of entry.denied || []) {
      await expect(page.locator(tileSelector(view, entry.dynamic))).toBeHidden();
      expect(await page.evaluate(value => window.eval(`canAccessView(${JSON.stringify(value)})`), view)).toBe(false);
    }
    // The held master read is unrelated to authorizing Home. The fixture does
    // not synthesize a Home render or mutate the account after startup.
    expect(fixture.errors).toEqual([]);
    expect(fixture.blockedMutations).toEqual([]);
  });
}

test('verified raw cache survives reload and changed revisions reload its dependencies', async ({ page, baseURL }) => {
  const reloadHealthRequests: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/rest/v1/rpc/report_app_health_event')
        && request.postDataJSON()?.event_name === 'fixture_reload') reloadHealthRequests.push(request.url());
  });
  const fixture = await installHlOrderFixture(page, baseURL!);
  expect(await page.evaluate(() => (window as any).reportSemanticHealthEvent('fixture_live_control', 'test'))).toBe(true);
  const reload = async () => {
    // Register after the app's unload guard. Once navigation has started,
    // even a late health event must not create a request from the old document.
    await page.evaluate(() => window.addEventListener('beforeunload', () => {
      void (window as any).reportSemanticHealthEvent('fixture_reload', 'test');
    }, { once: true }));
    await page.reload({ waitUntil: 'load' });
  };
  const openDrive = async () => {
    await page.locator('#view-login').waitFor({ state: 'hidden' });
    await page.locator('#home-tile-drive').click();
    await expect(page.locator('#view-drive')).toBeVisible();
    await page.waitForFunction(() => window.eval('productionLiveSyncVerifiedView && productionLiveSyncVerifiedView === productionVerifiedViewKey()'));
    await expect(page.locator('#drive-content .skeleton')).toHaveCount(0);
  };
  await openDrive();
  expect(fixture.backgroundMasterReads).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => window.eval(`(async () => {
    const context = getProductionLiveSyncContext();
    const adapter = context.adapters.find(entry => entry.id === 'core:master');
    const cached = await loadCacheValue(verifiedSnapshotCacheKey({scope: context.scope, adapterId: adapter.id, cacheKey: adapter.cacheKey}));
    return cached?.format === 'verified-raw-v1' && cached.rawRows.length === cached.rowCount;
  })()`))).toBe(true);
  const beforeReload = fixture.backgroundMasterReads;
  await reload();
  await openDrive();
  expect(fixture.backgroundMasterReads).toBe(beforeReload);
  fixture.datasetRevision++;
  await reload();
  await openDrive();
  expect(fixture.backgroundMasterReads).toBeGreaterThan(beforeReload);
  expect(reloadHealthRequests).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});
