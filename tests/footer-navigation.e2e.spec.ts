import { expect, test } from '@playwright/test';

test('deployed shell footer opens cold and warm views and returns from Menu with native input', async ({ page, baseURL, isMobile }) => {
  const appOrigin = new URL(baseURL!).origin;
  const attemptedMutations: string[] = [];
  const runtimeResponses: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) {
      runtimeResponses.push(response.url());
    }
  });
  // Only this shell's static GETs reach the network. The same test is safe against
  // production: external services and every mutation are blocked before navigation.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      let body: any = null;
      try { body = request.postDataJSON(); } catch { /* Non-JSON writes stay blocked. */ }
      const preferenceRead = request.method() === 'POST' && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && url.pathname === '/functions/v1/app-api' && body?.action === 'navigation_preferences'
        && body.operation === 'get' && !body.commandId && !body.command_id
        && Object.keys(body.payload || {}).length === 0;
      if (preferenceRead) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ ok: true, data: { username: 'dylan_collyge', views: [], shortcuts: null, footerRevision: 0, accessRevision: 0 } }) });
      attemptedMutations.push(`${request.method()}:${url.pathname}`);
      await route.abort('blockedbyclient');
    } else if (new URL(request.url()).origin !== appOrigin) {
      await route.abort('blockedbyclient');
    } else {
      await route.continue();
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());

  await page.goto('/?post_deploy_access_canary=1&footer_navigation_canary=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
  expect(runtimeResponses, 'must exercise the generated, deferred deployment runtime').toHaveLength(1);
  // Before authentication the reusable Drive button may be parked outside the
  // footer; selecting account shortcuts must retain its original native binding.
  await expect(page.locator('#footer-drive-btn')).toHaveAttribute('data-fast-press-bound', '1');
  await expect(page.locator('#footer-menu-btn')).toHaveAttribute('data-fast-press-bound', '1');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gnc_app_shell_build_v1')))
    .toBe(await page.evaluate(() => (window as any).__APP_SHELL_VERSION__));

  // Supply a local, mutation-blocked identity and empty data only. In particular,
  // do not initialize the chrome, rebind controls, or replace the navigation/renderers.
  await page.evaluate(() => window.eval(`(() => {
    if (!installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Hosted Footer Canary', 'ADMIN')) {
      throw new Error('FOOTER_CANARY_IDENTITY_UNAVAILABLE');
    }
    requestCapabilityState = {
      status: 'ready', username: 'dylan_collyge', stale: false, loadedAt: Date.now(), errorCode: '',
      capabilities: { username: 'dylan_collyge', scope: 'global', canViewQueue: true, canCreateAv: true, canCreateGeneral: true }
    };
    Object.keys(DATASET_DEFINITIONS).forEach((key) => {
      const state = getDatasetState(key);
      state.initialLoaded = state.fullLoaded = true;
      state.lastLoadedAt = new Date().toISOString();
    });
    document.getElementById('view-login').style.setProperty('display', 'none', 'important');
    document.getElementById('app-wrapper').classList.remove('hidden');
    showOnlyPrimaryView('home');
    updateFooterNavState();
  })()`));
  await expect(page.locator('#bottom-nav .footer-nav-btn')).toHaveCount(8);
  expect(await page.locator('#bottom-nav .footer-nav-btn').evaluateAll(buttons => buttons.every(button => button.getAttribute('type') === 'button'))).toBe(true);
  expect(await page.locator('#bottom-nav .footer-nav-btn').evaluateAll(buttons => buttons.map(button => button.id))).toEqual([
    'footer-menu-btn', 'footer-home-btn', 'footer-drive-btn', 'footer-tasks-btn', 'footer-docks-btn', 'footer-request-btn', 'footer-cart-btn', 'footer-communication-btn',
  ]);

  const activate = async (selector: string) => {
    const button = page.locator(selector);
    await expect(button).toBeVisible();
    if (isMobile) await button.tap();
    else await button.click();
  };
  const expectView = async (viewId: string) => {
    await expect(page.locator(`#view-${viewId}`)).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-current-view', viewId);
    await expect(page.locator(`#bottom-nav [data-footer-view="${viewId}"]`)).toHaveClass(/active/);
    if (viewId !== 'home') await expect(page.locator('#view-home')).toBeHidden();
  };

  // First visits must build each real destination; revisits exercise warm reuse.
  for (const viewId of ['drive', 'tasks', 'docks', 'communication', 'home', 'drive', 'tasks', 'docks', 'communication', 'home']) {
    await activate(`#bottom-nav [data-footer-view="${viewId}"]`);
    await expectView(viewId);
  }
  await activate('#footer-menu-btn');
  await expect(page.locator('#side-drawer')).toHaveClass(/open/);
  await activate('#drawer-home-btn');
  await expect(page.locator('#side-drawer')).not.toHaveClass(/open/);
  await expectView('home');
  await activate('#bottom-nav [data-footer-view="drive"]');
  await expectView('drive');
  expect(pageErrors, 'startup and native navigation must not throw browser errors').toEqual([]);
  // The app may POST telemetry and its read-only user-directory RPC on entry.
  // They were blocked above, along with all other non-GET traffic.
  const expectedBlockedBackgroundRequests = new Set([
    'POST:/rest/v1/rpc/report_app_health_event',
    'POST:/rest/v1/rpc/get_app_user_directory',
  ]);
  expect(attemptedMutations.filter((request) => !expectedBlockedBackgroundRequests.has(request)),
    'navigation must not attempt a business-data mutation').toEqual([]);
});
