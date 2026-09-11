import { expect, test, type Page } from '@playwright/test';

// HL is deferred. Exercise its absence in the compiled app using the proven
// mutation-blocked Home identity fixture, with every browser profile retained.
const salesViews = ['drive', 'sales', 'av', 'docks', 'request', 'tasks', 'weather-hold', 'communication', 'department-calendar', 'chat', 'sales-office', 'office'];
const adminViews = ['drive', 'docks', 'av', 'communication', 'sales', 'managers', 'building', 'qc', 'office', 'sales-inventory', 'production', 'reports'];
const salesTileIds: Record<string, string> = {
  'department-calendar': 'calendar', 'sales-office': 'bloom',
};
const tileSelector = (view: string, dynamic: boolean) => dynamic
  ? `#home-sales-open-${salesTileIds[view] || view}` : `#home-tile-${view}`;

async function harness(page: Page, baseURL: string) {
  const appOrigin = new URL(baseURL).origin;
  const unexpectedMutations: string[] = [];
  const pageErrors: string[] = [];
  const runtimeResponses: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) runtimeResponses.push(response.url());
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      const isManualStatusRead = request.method() === 'POST' && url.hostname === 'script.google.com'
        && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) && request.postData() === '{"type":"manual_status"}';
      const isRevisionRead = request.method() === 'POST' && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && url.pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1';
      if (!isManualStatusRead && !isRevisionRead && !['/rest/v1/rpc/report_app_health_event', '/rest/v1/rpc/get_app_user_directory'].includes(url.pathname)) {
        unexpectedMutations.push(`${request.method()}:${url.pathname}`);
      }
      return route.abort('blockedbyclient');
    }
    return url.origin === appOrigin ? route.continue() : route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=1&home_role_canary=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
  expect(runtimeResponses, 'the generated production runtime must execute').toHaveLength(1);

  const seed = async (username: string, role: string, denied: string[] = []) => {
    await page.evaluate(data => {
      (window as any).__homeRoleFixture = data;
      window.eval(`(() => {
        const fixture = window.__homeRoleFixture;
        if (!installMutationBlockedAccessCanaryIdentity(fixture.username, 'Isolated Home Test', fixture.role)) {
          throw new Error('HOME_ROLE_CANARY_IDENTITY_UNAVAILABLE');
        }
        const normalizedRole = fixture.role.trim().toUpperCase();
        const requestScope = ['REP', 'SALESREP', 'CSR', 'SALES'].includes(normalizedRole) ? 'rep'
          : ['ADMIN', 'MANAGER'].includes(normalizedRole) ? 'global' : normalizedRole === 'EVAL' ? 'eval' : 'role';
        requestCapabilityState = {
          status: 'ready', username: fixture.username, stale: false, loadedAt: Date.now(), errorCode: '',
          capabilities: { username: fixture.username, scope: requestScope, canViewQueue: true, canCreateAv: true, canCreateGeneral: false }
        };
        appAccessSnapshotState = {
          status: 'ready', username: fixture.username, stale: false, loadedAt: Date.now(), errorCode: '',
          snapshot: normalizeAppAccessSnapshot({
            contractVersion: APP_ACCESS_CONTRACT_VERSION, enforcementMode: 'enforced',
            username: fixture.username, role: fixture.role,
            permissions: fixture.denied.map(view => ({ permissionKey: 'module.' + view + '.view', kind: 'module', moduleKey: view, allowed: false }))
          }, fixture.username)
        };
        Object.keys(DATASET_DEFINITIONS).forEach(key => {
          const state = getDatasetState(key);
          state.initialLoaded = state.fullLoaded = true;
          state.lastLoadedAt = new Date().toISOString();
        });
        document.getElementById('view-login').style.setProperty('display', 'none', 'important');
        document.getElementById('app-wrapper').classList.remove('hidden');
        hasAppliedInitialHomeView = true;
        showOnlyPrimaryView('home');
        applyRolePermissions();
        renderHome();
        updateFooterNavState();
      })()`);
    }, { username, role, denied });
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-current-view', 'home');
  };

  const assertTiles = async (views: string[], dynamic: boolean, checkReachability = true) => {
    const grid = page.locator(dynamic ? '#home-rep-dashboard-grid' : '#home-dashboard-grid');
    await expect(grid).toBeVisible();
    await expect(grid.locator(':scope > button:visible')).toHaveCount(views.length);
    for (const view of views) {
      const tile = page.locator(tileSelector(view, dynamic));
      await expect(tile, `${view} must be visible through every ancestor`).toBeVisible();
    }
    // Check the far end of the grid is reachable; the test opens an early tile natively.
    if (checkReachability) await page.locator(tileSelector(views.at(-1)!, dynamic)).click({ trial: true });
    await expect(page.locator(dynamic ? '#home-dashboard-content' : '#home-dynamic-content')).toBeHidden();
  };
  const assertClean = () => {
    expect(pageErrors, 'Home and native navigation must not throw browser errors').toEqual([]);
    expect(unexpectedMutations, 'the fixture must never attempt business-data writes').toEqual([]);
  };
  return { seed, assertTiles, assertClean };
}

test('the deferred HL module is absent for Dylan and other accounts while Home remains usable', async ({ page, baseURL }) => {
  const hlRequests: string[] = [];
  page.on('request', request => {
    if (/hl_order|hl_tags/.test(request.url() + (request.postData() || ''))) hlRequests.push(request.method() + ':' + request.url());
  });
  const app = await harness(page, baseURL!);
  for (const entry of [
    { username: 'dylan_collyge', role: 'ADMIN', views: adminViews, dynamic: false },
    { username: 'home_admin_fixture', role: 'ADMIN', views: adminViews, dynamic: false },
    { username: 'tony_bono', role: 'REP', views: salesViews, dynamic: true },
  ]) {
    await app.seed(entry.username, entry.role);
    await page.evaluate(username => {
      (window as any).__deferredHlUsername = username;
      window.eval(`
        nativeAuthSessionActive = true;
        nativeAuthProfile = { id: 'synthetic-deferred-hl', username: window.__deferredHlUsername,
          disabled_at: null, locked_until: null, must_change_password: false };
        applyRolePermissions(); renderHome(); updateGlobalActionBar();
      `);
    }, entry.username);
    await app.assertTiles(entry.views, entry.dynamic, false);
    for (const selector of ['#home-tile-hl-order', '#drawer-hl-order-btn', '#view-hl-order',
      '#batch-btn-hl-tags', '#hl-tags-preview', '#hl-bloom-section']) {
      await expect(page.locator(selector)).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.eval('canAccessView("hl-order")'))).toBe(false);
    expect(await page.evaluate(() => window.eval(`({
      command: typeof hlOrderCommand, submit: typeof submitHlOrderPreview,
      bloom: typeof renderHlBloomSection,
      actions: Object.keys(getBloomPickerActionVisibility([])).filter(key => /hl/i.test(key))
    })`))).toEqual({ command: 'undefined', submit: 'undefined', bloom: 'undefined', actions: [] });
    await page.evaluate(() => window.eval('switchView("hl-order")'));
    await expect(page.locator('body')).toHaveAttribute('data-current-view', 'home');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#footer-cart-btn')).toBeVisible();
  }
  await page.locator('#footer-cart-btn').click();
  await expect(page.locator('#toast-notification')).toContainText('Bloom Picker Empty');
  expect(hlRequests, 'the deferred client must not read or mutate HL records').toEqual([]);
  app.assertClean();
});
