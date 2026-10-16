import { expect, test } from '@playwright/test';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
import { nativeVisibilityBrowser } from './fixtures/native-visibility-browser';
// @test-group: @app-lifecycle

test('native PWA foreground keeps the cached Drive DOM and session through a temporary profile outage', { tag: ['@app-lifecycle'] }, async ({ baseURL }, info) => {
  const native = await nativeVisibilityBrowser({ viewport: info.project.use.viewport || { width: 1280, height: 720 },
    userAgent: info.project.use.userAgent, isMobile: info.project.use.isMobile, deviceScaleFactor: info.project.use.deviceScaleFactor });
  const { page, context } = native;
  try {
  const master = Array.from({ length: 10_000 }, (_, index) => hlMaster(`pwa-${index}`, {
    itemcode: `PWA.${String(index % 20).padStart(3, '0')}`, commonname: `Cached plant ${index % 20}`,
    locationcode: `C.${String(index).padStart(5, '0')}`, ptronhand: '100', ptravailable: '90',
  }));
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'dylan_collyge', role: 'ADMIN', startupMode: 'restored', master });
  await fixture.waitForRevisionIdle();
  await page.evaluate(() => window.eval("switchView('drive')"));
  await expect(page.locator('#view-drive')).toBeVisible();
  await page.waitForFunction(() => {
    const content = document.querySelector('#drive-content');
    return Boolean(content?.textContent?.includes('Cached plant')) && !content?.querySelector('.skeleton');
  });
  await fixture.waitForRevisionIdle();
  const tokenRequests = fixture.authTokenRequests;
  await page.route('**/rest/v1/profiles?*', route => route.abort('failed'));
  const initial = await page.evaluate(() => window.eval(`(() => {
    const content = document.getElementById('drive-content');
    window.__pwaResumeNode = content.firstElementChild;
    window.__pwaResumeSession = localStorage.getItem('gnc_supabase_auth_v1');
    window.__pwaResumeRect = content.firstElementChild.getBoundingClientRect().toJSON();
    window.__pwaResumeFlashes = [];
    const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    window.__pwaResumeObserver = new MutationObserver(() => {
      if (visible(document.getElementById('view-login')) || visible(document.getElementById('loading-spinner')))
        window.__pwaResumeFlashes.push('login-or-spinner');
      if ([...content.querySelectorAll('.skeleton')].some(visible)) window.__pwaResumeFlashes.push('skeleton');
    });
    window.__pwaResumeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    document.addEventListener('visibilitychange', event => {
      if (document.hidden || !event.isTrusted) return;
      const start = performance.now();
      queueMicrotask(() => { window.__pwaResumeResult = {
        elapsedMs: performance.now() - start, trusted: event.isTrusted,
        sameNode: window.__pwaResumeNode === document.getElementById('drive-content').firstElementChild,
        loginVisible: !!document.getElementById('view-login').getClientRects().length
      }; });
    }, { capture: true });
    return { user: currentUser, hasSavedSession: !!window.__pwaResumeSession };
  })()`));
  expect(initial).toMatchObject({ user: 'dylan_collyge', hasSavedSession: true });
  const otherApp = await context.newPage();
  await otherApp.goto('about:blank');
  await otherApp.bringToFront();
  await page.waitForFunction(() => document.hidden);
  const hidden = await page.evaluate(() => window.eval(`({ selfHealStopped: !iosRuntimeSelfHealMonitorTimer,
    reclassPollingStopped: !reclassDeliveryPollTimer, fallbackStopped: !fallbackSyncInterval,
    shellPollingStopped: !window.__swUpdateIntervalId, legacyChannels: realtimeChannels.length,
    user: currentUser, sessionActive: nativeAuthSessionActive })`));
  expect(hidden).toMatchObject({ selfHealStopped: true, reclassPollingStopped: true, fallbackStopped: true,
    shellPollingStopped: true, legacyChannels: 0, user: 'dylan_collyge', sessionActive: true });
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden && Boolean(window.eval('window.__pwaResumeResult')));
  const resumed = await page.evaluate(() => window.eval('window.__pwaResumeResult'));
  expect(resumed.trusted).toBe(true);
  expect(resumed.sameNode).toBe(true);
  expect(resumed.loginVisible).toBe(false);
  expect(resumed.elapsedMs).toBeLessThan(100);
  await fixture.waitForRevisionIdle();
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#loading-spinner')).toBeHidden();
  const settled = await page.evaluate(() => window.eval(`(() => {
    window.__pwaResumeObserver.disconnect();
    const current = document.getElementById('drive-content').firstElementChild;
    const rect = current.getBoundingClientRect();
    const before = window.__pwaResumeRect;
    return { user: currentUser, sessionActive: nativeAuthSessionActive,
      sameSession: localStorage.getItem('gnc_supabase_auth_v1') === window.__pwaResumeSession,
      sameNode: current === window.__pwaResumeNode,
      maxShift: Math.max(...['x','y','width','height'].map(key => Math.abs(rect[key] - before[key]))),
      flashes: window.__pwaResumeFlashes };
  })()`));
  expect(settled).toMatchObject({ user: 'dylan_collyge', sessionActive: true, sameSession: true, sameNode: true, flashes: [] });
  expect(settled.maxShift).toBeLessThan(1);
  expect(fixture.authTokenRequests).toBe(tokenRequests);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
  await otherApp.close();
  console.log(JSON.stringify({ event: 'PWA_FOREGROUND', datasetRows: master.length, ...resumed, ...settled, cache: 'Warm authenticated native session; profile transport unavailable; fresh browser context.' }));
  } catch (error) {
    await page.screenshot({ path: info.outputPath('pwa-foreground-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await native.close();
  }
});
