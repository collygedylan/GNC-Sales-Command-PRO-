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

async function waitForCompletedPendingRender(page: Page) {
  try {
    await page.waitForFunction(() => window.eval(`!!completedPendingRequestRender
      && !productionLiveSyncRenderPending && !productionLiveSyncRendering`), null, {
      polling: 'raf', timeout: 15_000
    });
  } catch (error) {
    const state: unknown = await page.evaluate(() => window.eval(`({
      contract: !!completedPendingRequestRender,
      pending: productionLiveSyncRenderPending, rendering: productionLiveSyncRendering,
      activeChunkCount: activeChunkRenderCount,
      chunkKeys: Object.keys(chunkRenderActivityByKey),
      chunks: Object.entries(chunkRenderActivityByKey).map(([key, value]) => [key, Number(value) || 0]),
      tokenKeys: Object.keys(chunkRenderTokensByKey || {}),
      containerChunk: getContainerChunkRenderKey(document.getElementById('request-content')),
      uiState: getContainerUiState(document.getElementById('request-content')),
      cardCount: document.querySelectorAll('#request-content [data-request-uid]').length,
      contractSignatureMatches: !!completedPendingRequestRender
        && getContainerRenderSignature(document.getElementById('request-content')) === normalizeRenderSignature(completedPendingRequestRender.renderSignature)
    })`));
    throw new Error(`Completed Pending render did not settle: ${JSON.stringify(state)}`, { cause: error });
  }
}

test('native Request navigation and refresh preserve unchanged verified cards', { tag: ['@home-role'] }, async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The Request fixture requires a base URL.');
  await page.addInitScript({ content: `(${installPerformanceRandomFixture.toString()})(${performanceRandomSeed('desktop', 'live', 1)});` });
  await installPerformanceFixture(page, baseURL, 'live');
  await page.evaluate(() => window.eval(`(() => {
    window.__requestLegacyReads = 0;
    window.__requestRenderCalls = 0;
    window.__requestFirstBatchCounts = [];
    const originalSetContainerHtml = setContainerHtml;
    setContainerHtml = function(container, ...args) {
      const result = originalSetContainerHtml.call(this, container, ...args);
      if (container?.id === 'request-content') {
        const count = container.querySelectorAll('[data-request-uid]').length;
        if (count) window.__requestFirstBatchCounts.push(count);
      }
      return result;
    };
    const originalRenderRequest = renderRequest;
    renderRequest = function(...args) {
      window.__requestRenderCalls++;
      return originalRenderRequest.apply(this, args);
    };
    const original = fetchActiveRequestLiveRows;
    fetchActiveRequestLiveRows = function(...args) {
      window.__requestLegacyReads++;
      return original.apply(this, args);
    };
  })()`));
  await openPerformanceView(page, 'live', 'request');
  await settleRequest(page);
  await expect(page.locator('#request-content [data-request-uid]')).toHaveCount(100);
  const firstBatch: unknown = await page.evaluate(() => window.eval('window.__requestFirstBatchCounts[0]'));
  expect(typeof firstBatch).toBe('number');
  expect(Number(firstBatch)).toBeGreaterThan(0);
  expect(Number(firstBatch)).toBeLessThanOrEqual(8);
  await expect(page.locator('#request-content .browse-page-footer')).toHaveCount(1);
  await waitForCompletedPendingRender(page);
  const initialRenderCallsResult: unknown = await page.evaluate(() => window.eval('window.__requestRenderCalls'));
  expect(typeof initialRenderCallsResult).toBe('number');
  const initialRenderCalls = Number(initialRenderCallsResult);
  await page.evaluate(() => window.eval(`(() => {
    window.__requestInitialRenderCalls = window.__requestRenderCalls;
    window.__requestVerifiedCards = Array.from(document.querySelectorAll('#request-content [data-request-uid]'));
    window.__requestVerifiedFooter = document.querySelector('#request-content .browse-page-footer');
    window.__requestCategoryButtons = ['pending','suspend-tag','moves','recount','eval-work','shear-list']
      .map(name => document.getElementById('tab-req-' + name));
    window.__requestCategoryButtonChildren = window.__requestCategoryButtons.map(node => Array.from(node?.childNodes || []));
    window.__requestCategoryChips = Array.from(document.querySelectorAll('#request-filter-toolbar [data-request-category]'));
    window.__requestCategoryChipChildren = window.__requestCategoryChips.map(node => Array.from(node.childNodes));
  })()`));
  // Exercise the ordinary verified scheduler path first; the fixture's
  // authenticated live reader and render pipeline remain active.
  await page.evaluate(() => window.eval(`scheduleProductionLiveSyncRender(true, { reason: 'request-unchanged-scheduler-regression' })`));
  await settleRequest(page);
  const unchangedScheduler = await page.evaluate(() => window.eval(`({
    legacyReads: window.__requestLegacyReads,
    renderCalls: window.__requestRenderCalls,
    initialRenderCalls: window.__requestInitialRenderCalls,
    sameCards: window.__requestVerifiedCards.every(node => node.isConnected && node.closest('#request-content')),
    sameFooter: window.__requestVerifiedFooter === document.querySelector('#request-content .browse-page-footer'),
    sameCategoryButtons: window.__requestCategoryButtons.every((node, index) =>
      node && node === document.getElementById('tab-req-' + ['pending','suspend-tag','moves','recount','eval-work','shear-list'][index])),
    sameCategoryChildren: window.__requestCategoryButtons.every((node, index) =>
      node && window.__requestCategoryButtonChildren[index].length === node.childNodes.length
        && window.__requestCategoryButtonChildren[index].every((child, childIndex) => child === node.childNodes[childIndex])),
    sameCategoryChips: window.__requestCategoryChips.every((node, index) =>
      node.isConnected && node === document.querySelectorAll('#request-filter-toolbar [data-request-category]')[index]
        && window.__requestCategoryChipChildren[index].length === node.childNodes.length
        && window.__requestCategoryChipChildren[index].every((child, childIndex) => child === node.childNodes[childIndex])),
    verified: productionLiveSyncVerifiedView === productionVerifiedViewKey(),
    rows: requestsInventory.length
  })`));
  expect(unchangedScheduler.renderCalls).toBe(initialRenderCalls);
  expect(unchangedScheduler).toMatchObject({
    legacyReads: 0, renderCalls: initialRenderCalls, initialRenderCalls,
    sameCards: true, sameFooter: true, sameCategoryButtons: true,
    sameCategoryChildren: true, sameCategoryChips: true, verified: true, rows: 200
  });

  await page.evaluate(() => window.eval(`scheduleRequestNavigationLiveWake('request-repeat-navigation')`));
  await page.waitForTimeout(400);
  await settleRequest(page);

  // Also retain coverage for an explicit user refresh. It may refresh chrome,
  // but must preserve the already displayed rows and footer when unchanged.
  const refreshed: unknown = await page.evaluate(() => window.eval(`forceRefreshRequestsForView('manual-regression', {
    force: true, manualRetry: true, allowWhileInteractive: true, minIntervalMs: 0
  })`));
  expect(refreshed).toBe(true);
  await settleRequest(page);
  const state = await page.evaluate(() => window.eval(`({
    legacyReads: window.__requestLegacyReads,
    sameCards: window.__requestVerifiedCards.every(node => node.isConnected && node.closest('#request-content')),
    sameFooter: window.__requestVerifiedFooter === document.querySelector('#request-content .browse-page-footer'),
    sameCategoryButtons: window.__requestCategoryButtons.every((node, index) =>
      node && node === document.getElementById('tab-req-' + ['pending','suspend-tag','moves','recount','eval-work','shear-list'][index])),
    sameCategoryChildren: window.__requestCategoryButtons.every((node, index) =>
      node && window.__requestCategoryButtonChildren[index].length === node.childNodes.length
        && window.__requestCategoryButtonChildren[index].every((child, childIndex) => child === node.childNodes[childIndex])),
    sameCategoryChips: window.__requestCategoryChips.every((node, index) =>
      node.isConnected && node === document.querySelectorAll('#request-filter-toolbar [data-request-category]')[index]
        && window.__requestCategoryChipChildren[index].length === node.childNodes.length
        && window.__requestCategoryChipChildren[index].every((child, childIndex) => child === node.childNodes[childIndex])),
    verified: productionLiveSyncVerifiedView === productionVerifiedViewKey(),
    rows: requestsInventory.length
  })`));
  expect(state).toMatchObject({
    legacyReads: 0,
    sameCards: true,
    sameFooter: true,
    sameCategoryButtons: true,
    sameCategoryChildren: true,
    sameCategoryChips: true,
    verified: true,
    rows: 200
  });
  const postRefreshRenderCalls: unknown = await page.evaluate(() => window.eval('window.__requestRenderCalls'));
  expect(typeof postRefreshRenderCalls).toBe('number');

  await page.evaluate(() => window.eval(`(() => {
    const card = document.querySelector('#request-content [data-request-uid]');
    const uid = card?.getAttribute('data-request-uid');
    const row = requestsInventory.find(item => String(item.UNIQUE_ID || '') === String(uid || ''));
    if (!card || !row) throw new Error('Could not find the first rendered Request row in the fixture.');
    window.__requestChangedCard = card;
    window.__requestChangedRowUid = uid;
    window.__requestChangedOldQty = String(row.REQ_QTY || row.req_qty || '');
    row.REQ_QTY = String(Number(window.__requestChangedOldQty) + 1);
  })()`));
  const changedRowUid: unknown = await page.evaluate(() => window.eval('window.__requestChangedRowUid'));
  const changedRowOldQty: unknown = await page.evaluate(() => window.eval('window.__requestChangedOldQty'));
  const changedRowNewQty: unknown = await page.evaluate(() => window.eval('requestsInventory.find(item => String(item.UNIQUE_ID || "") === String(window.__requestChangedRowUid || ""))?.REQ_QTY'));
  expect(typeof changedRowUid).toBe('string');
  expect(typeof changedRowOldQty).toBe('string');
  expect(typeof changedRowNewQty).toBe('string');
  expect(changedRowNewQty).not.toBe(changedRowOldQty);
  await page.evaluate(() => window.eval(`scheduleProductionLiveSyncRender(true, { reason: 'request-row-change-regression' })`));
  await settleRequest(page);
  const changedUid = String(changedRowUid);
  const expectedQty = String(changedRowNewQty);
  const changedState = await page.evaluate(({ uid, expectedQty }) => window.eval(`({
      renderCalls: window.__requestRenderCalls,
      changedCardReplaced: !window.__requestChangedCard.isConnected,
      quantityVisible: !!document.querySelector('#request-content [data-request-uid="${CSS.escape(uid)}"]')
        && document.querySelector('#request-content [data-request-uid="${CSS.escape(uid)}"]')?.textContent.includes('QTY: ${expectedQty}'),
      verified: productionLiveSyncVerifiedView === productionVerifiedViewKey(),
      uid: ${JSON.stringify(uid)}
    })`), { uid: changedUid, expectedQty });
  expect(changedState).toMatchObject({ changedCardReplaced: true, quantityVisible: true, verified: true });
  const changedRenderCalls: unknown = await page.evaluate(() => window.eval('window.__requestRenderCalls'));
  expect(typeof changedRenderCalls).toBe('number');
  expect(Number(changedRenderCalls)).toBeGreaterThan(Number(postRefreshRenderCalls));
});
