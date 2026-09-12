import { expect, test } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';
const tileSelector = (view: string, dynamic: boolean) => dynamic ? `#home-sales-open-${view}` : `#home-tile-${view}`;

test('cold login stays disabled and Enter is safe while the compiled runtime is held', async ({ page, baseURL }) => {
  let releaseRuntime!: () => void;
  const runtimeGate = new Promise<void>(resolve => { releaseRuntime = resolve; });
  const username = 'native_start_admin', accessCode = 'Synthetic-Access-123!';
  const fixture = await installHlOrderFixture(page, baseURL!, {
    username, role: 'ADMIN', startupMode: 'cold',
    runtimeRequest: async (route: any) => { await runtimeGate; await route.continue(); },
    beforeLogin: async (control: any) => {
      try {
        await expect.poll(() => control.runtimeRequests).toBe(1);
        const login = page.locator('#login-button');
        await expect(login).toBeVisible();
        await expect(login).toBeDisabled();
        await expect(page.locator('#login-runtime-status')).toHaveAttribute('role', 'status');
        await expect(page.locator('#login-runtime-status')).toHaveText('Preparing app…');
        await expect(page.locator('#login-runtime-reload')).toBeHidden();
        await page.locator('#username-input').fill(username);
        await page.locator('#pin-code').fill(accessCode);
        // A physical click exercises native disabled-button behavior without
        // waiting for Playwright's enabled check or invoking any app handler.
        const box = await login.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.locator('#pin-code').press('Enter');
        await expect(page.locator('#view-login')).toBeVisible();
        await expect(page.locator('#username-input')).toHaveValue(username);
        await expect(page.locator('#pin-code')).toHaveValue(accessCode);
        expect(await page.evaluate(() => (window as any).__gncAppRuntimeExecuted === true)).toBe(false);
        expect(control.authTokenRequests).toBe(0);
        expect(control.commands).toEqual([]);
        expect(control.errors).toEqual([]);
      } finally {
        releaseRuntime();
      }
      await expect(page.locator('#login-button')).toBeEnabled();
      expect(await page.evaluate(() => (window as any).__gncAppRuntimeExecuted)).toBe(true);
      await expect(page.locator('#username-input')).toHaveValue(username);
      await expect(page.locator('#pin-code')).toHaveValue(accessCode);
      await expect(page.locator('#view-login')).toBeVisible();
      expect(control.authTokenRequests).toBe(0, 'an early interaction must not queue a login');
    }
  });
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/role-access-ready/);
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  expect(fixture.authTokenRequests).toBe(1);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('failed compiled runtime keeps login disabled and Reload app recovers normal login', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, {
    username: 'native_start_admin', role: 'ADMIN', startupMode: 'cold',
    runtimeRequest: async (route: any, control: any) => control.runtimeRequests === 1
      ? route.abort('failed') : route.continue(),
    beforeLogin: async (control: any) => {
      await expect(page.locator('#login-runtime-status')).toHaveText('App could not load');
      await expect(page.locator('#login-button')).toBeDisabled();
      const reload = page.locator('#login-runtime-reload');
      await expect(reload).toBeVisible();
      await expect(reload).toHaveAccessibleName('Reload app');
      expect(control.authTokenRequests).toBe(0);
      expect(control.errors).toEqual([]);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        reload.click()
      ]);
      await expect.poll(() => control.runtimeRequests).toBe(2);
      await expect(page.locator('#login-button')).toBeEnabled();
      await expect(page.locator('#login-runtime-reload')).toBeHidden();
      expect(await page.evaluate(() => (window as any).__gncAppRuntimeExecuted)).toBe(true);
      expect(control.authTokenRequests).toBe(0);
    }
  });
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/role-access-ready/);
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  expect(fixture.authTokenRequests).toBe(1);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

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
