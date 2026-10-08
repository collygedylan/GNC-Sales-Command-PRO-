import { expect, test, type Page } from '@playwright/test';
import { installPerformanceFixture, openPerformanceView, waitForPerformanceViewSettlement } from '../scripts/performance-browser-fixture.mjs';
import { installPerformanceRandomFixture, performanceRandomSeed } from '../scripts/performance-random-fixture.mjs';
// @test-group: @home-role

async function settleRequest(page: Page) {
  try { await waitForPerformanceViewSettlement(page, 'live', 'request'); }
  catch (error) {
    const state: unknown = await page.evaluate(() => window.eval(`({
      rendering: productionLiveSyncRendering, pending: productionLiveSyncRenderPending,
      viewLoad: !!productionLiveSyncViewLoad?.pending, chunks: activeChunkRenderCount,
      chunkKeys: Object.keys(chunkRenderActivityByKey), timerKeys: Object.keys(uiRenderTimers),
      frameKeys: Object.keys(uiRenderFrames), tokenKeys: Object.keys(uiRenderTokens),
      coordinator: window.__phase6CoordinatorObserver?.getPendingActivity(),
      shell: window.__phase6ShellObserver?.getPendingActivity(),
      cards: document.querySelectorAll('#request-content [data-request-uid]').length
    })`));
    throw new Error(`Request did not settle: ${JSON.stringify(state)}`, { cause: error });
  }
}

test('native Request navigation and refresh preserve unchanged verified cards', { tag: ['@home-role'] }, async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The Request fixture requires a base URL.');
  await page.addInitScript({ content: `(${installPerformanceRandomFixture.toString()})(${performanceRandomSeed('desktop', 'live', 1)});` });
  await installPerformanceFixture(page, baseURL, 'live');
  await page.evaluate(() => window.eval(`(() => {
    window.__requestLegacyReads = 0;
    const original = fetchActiveRequestLiveRows;
    fetchActiveRequestLiveRows = function(...args) {
      window.__requestLegacyReads++;
      return original.apply(this, args);
    };
  })()`));
  await openPerformanceView(page, 'live', 'request');
  await settleRequest(page);
  await expect(page.locator('#request-content [data-request-uid]')).toHaveCount(100);
  await expect(page.locator('#request-content .browse-page-footer')).toHaveCount(1);
  await page.evaluate(() => window.eval(`(() => {
    window.__requestVerifiedCards = Array.from(document.querySelectorAll('#request-content [data-request-uid]'));
    window.__requestVerifiedFooter = document.querySelector('#request-content .browse-page-footer');
    scheduleRequestNavigationLiveWake('request-repeat-navigation');
  })()`));
  // Exercise the delayed navigation wake, then a real explicit refresh. The
  // fixture answers the normal authenticated reader; no production method is
  // stubbed to claim a successful snapshot.
  await page.waitForTimeout(400);
  const refreshed: unknown = await page.evaluate(() => window.eval(`forceRefreshRequestsForView('manual-regression', {
    force: true, manualRetry: true, allowWhileInteractive: true, minIntervalMs: 0
  })`));
  expect(refreshed).toBe(true);
  await settleRequest(page);
  const state: unknown = await page.evaluate(() => window.eval(`({
    legacyReads: window.__requestLegacyReads,
    sameCards: window.__requestVerifiedCards.every(node => node.isConnected && node.closest('#request-content')),
    sameFooter: window.__requestVerifiedFooter === document.querySelector('#request-content .browse-page-footer'),
    verified: productionLiveSyncVerifiedView === productionVerifiedViewKey(),
    rows: requestsInventory.length
  })`));
  expect(state).toEqual({ legacyReads: 0, sameCards: true, sameFooter: true, verified: true, rows: 200 });
});
