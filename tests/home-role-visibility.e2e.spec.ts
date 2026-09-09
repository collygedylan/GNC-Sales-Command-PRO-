import { expect, test, type Page } from '@playwright/test';

const salesViews = ['drive', 'sales', 'av', 'docks', 'request', 'tasks', 'weather-hold', 'communication', 'department-calendar', 'chat', 'sales-office', 'office'];
const adminViews = ['drive', 'docks', 'av', 'communication', 'sales', 'managers', 'building', 'qc', 'office', 'sales-inventory', 'production', 'reports'];
const roleCases = [
  { username: 'tony_bono', role: 'REP', dynamic: true, views: salesViews },
  { username: 'home_rep_whitespace_fixture', role: '\nREP', dynamic: true, views: salesViews },
  { username: 'home_salesrep_fixture', role: 'SALESREP', dynamic: true, views: salesViews },
  { username: 'home_csr_fixture', role: 'CSR', dynamic: true, views: salesViews },
  { username: 'home_sales_fixture', role: 'SALES', dynamic: true, views: salesViews },
  { username: 'home_admin_fixture', role: 'ADMIN', dynamic: false, views: adminViews },
  { username: 'home_manager_fixture', role: 'MANAGER', dynamic: false, views: adminViews },
  { username: 'home_data_entry_fixture', role: 'data entry', dynamic: false, views: adminViews },
  { username: 'home_data_supervisor_fixture', role: 'data entry supervisor', dynamic: false, views: adminViews },
  { username: 'home_qc_fixture', role: 'QC', dynamic: false, views: ['drive', 'docks', 'communication', 'qc', 'production'] },
  { username: 'home_qcsup_fixture', role: 'QC SUPERVISOR', dynamic: false, views: ['drive', 'docks', 'communication', 'qc', 'production'] },
  { username: 'home_foreman_fixture', role: 'FOREMAN', dynamic: false, views: ['drive', 'communication', 'sales-inventory', 'production'] },
  { username: 'home_grower_fixture', role: 'GROWER', dynamic: false, views: ['communication', 'sales-inventory', 'production'] },
  { username: 'home_takeback_fixture', role: 'TAKEBACK', dynamic: false, views: ['sales-inventory', 'production'] },
  { username: 'home_takebacks_fixture', role: 'Take Backs ', dynamic: false, views: ['sales-inventory', 'production'] },
  { username: 'home_eval_fixture', role: 'EVAL', dynamic: false, views: ['drive', 'docks', 'av', 'communication', 'sales-inventory'] },
  { username: 'home_division_fixture', role: 'DIVISION', dynamic: false, views: ['communication'] },
  { username: 'home_marketing_fixture', role: 'SALES MARKETING', dynamic: false, views: ['drive'] },
];
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
      if (!isManualStatusRead && !['/rest/v1/rpc/report_app_health_event', '/rest/v1/rpc/get_app_user_directory'].includes(url.pathname)) {
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

// Keep ordered account transitions while bounding each WebKit test's cumulative work.
// All role, theme, far-tile reachability, and native navigation assertions stay identical.
for (let offset = 0; offset < roleCases.length; offset += 4) {
  const group = roleCases.slice(offset, offset + 4);
  test(`authorized Home tiles are visible and reachable for roles ${offset + 1}-${offset + group.length}`, async ({ page, baseURL, isMobile }) => {
    const app = await harness(page, baseURL!);
    for (const entry of group) {
      await test.step(`${entry.role}: visible modules and native return Home`, async () => {
        await app.seed(entry.username, entry.role);
        await app.assertTiles(entry.views, entry.dynamic);
        if (['tony_bono', 'home_admin_fixture'].includes(entry.username)) {
          for (const theme of ['dark', 'light']) {
            await page.evaluate(({ username, theme }) => {
              localStorage.setItem('gnc_last_theme_v1', theme);
              (window as any).__gncOpsPilot.primeCachedAppearance({ userKey: username, activeView: 'home' });
            }, { username: entry.username, theme });
            await expect(page.locator('body')).toHaveAttribute('data-ops-theme', theme);
            const grid = page.locator(entry.dynamic ? '#home-rep-dashboard-grid' : '#home-dashboard-grid');
            await expect(grid).toBeVisible();
            await expect(grid.locator(':scope > button:visible')).toHaveCount(entry.views.length);
            await page.locator(tileSelector(entry.views.at(-1)!, entry.dynamic)).click({ trial: true });
          }
        }
        const view = ['drive', 'communication', 'production'].find(candidate => entry.views.includes(candidate))!;
        const tile = page.locator(tileSelector(view, entry.dynamic));
        if (isMobile) await tile.tap(); else await tile.click();
        await expect(page.locator(`#view-${view}`)).toBeVisible();
        const homeButton = page.locator('#bottom-nav [data-footer-view="home"]');
        if (isMobile) await homeButton.tap(); else await homeButton.click();
        await expect(page.locator('#view-home')).toBeVisible();
        await expect(page.locator(tileSelector(entry.views[0], entry.dynamic))).toBeVisible();
      });
    }
    app.assertClean();
  });
}

test('REP Home preserves module denials and shows Request loading and retry states', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  const denied = ['drive', 'office', 'chat'];
  await app.seed('tony_bono', 'REP', denied);
  await app.assertTiles(salesViews.filter(view => !denied.includes(view)), true);
  for (const view of denied) {
    await expect(page.locator(tileSelector(view, true))).toHaveCount(0);
    expect(await page.evaluate(value => window.eval(`canAccessView(${JSON.stringify(value)})`), view)).toBe(false);
  }
  for (const status of ['loading', 'error']) {
    await page.evaluate(value => window.eval(`
      requestCapabilityState = { ...requestCapabilityState, status: ${JSON.stringify(value)}, capabilities: null };
      refreshRequestCapabilityUi('home-role-fixture');
    `), status);
    const statusCard = page.locator('#home-request-capability-status');
    await expect(statusCard).toBeVisible();
    await expect(statusCard).toContainText(status === 'loading' ? 'Loading Request access' : 'Request access needs a retry');
    // The role matrix covers native reachability; animated loading states need visibility checks.
    await app.assertTiles(salesViews.filter(view => !denied.includes(view) && view !== 'request'), true, false);
    if (status === 'error') await expect(statusCard.getByRole('button', { name: 'Retry' })).toBeVisible();
  }
  app.assertClean();
});
