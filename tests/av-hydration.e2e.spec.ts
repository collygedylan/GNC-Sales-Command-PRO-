import { expect, test, type Page } from '@playwright/test';

import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';

// @test-group: @home-role

const SYNTHETIC_MASTER_ROWS = 9539;
const PREVIEW_PAGE_SIZE = 500;

function syntheticMasterRows() {
  return Array.from({ length: SYNTHETIC_MASTER_ROWS }, (_, index) => hlMaster(`av-hydration-${String(index + 1).padStart(5, '0')}`, {
    itemcode: `AVH.${String(index + 1).padStart(5, '0')}`,
    commonname: `Synthetic AV Plant ${String(index + 1).padStart(5, '0')}`,
    contsize: '#1', locationcode: `A.${String(index + 1).padStart(5, '0')}`,
    lotcode: '27.F1', season: 'F1', saleyear: '27', ptravailable: '90', ptronhand: '90'
  }));
}

async function installAvTimingProbe(page: Page) {
  const installed = await page.evaluate(() => window.eval(`(() => {
    const probe = window.__avHydrationTiming = { startedAt: 0, firstCardAt: 0, renderDurations: [], longTaskDurations: [],
      searchStartedAt: 0, searchResultAt: 0, observer: null, searchObserver: null, longTaskObserver: null };
    probe.longTaskObserver = new PerformanceObserver(entries => {
      if (!probe.startedAt) return;
      for (const entry of entries.getEntries()) probe.longTaskDurations.push(entry.duration);
    });
    probe.longTaskObserver.observe({ type: 'longtask', buffered: false });
    const captureSearchResult = () => {
      if (!probe.searchStartedAt || probe.searchResultAt) return;
      const container = document.getElementById('av-content');
      const crumb = String(document.getElementById('av-crumb')?.textContent || '');
      const input = document.getElementById('av-search');
      const term = String(input?.value || '').trim();
      const match = Array.from(container?.querySelectorAll('[data-dom-id]') || []).find(card => card.textContent?.includes(term));
      const rect = match?.getBoundingClientRect();
      const inViewport = !!rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      if (term && crumb.includes('Search Results (1)') && match && inViewport) {
        probe.searchResultAt = performance.now();
        probe.searchObserver?.disconnect();
      }
    };
    const originalRender = renderAV;
    renderAV = function(...args) {
      const started = performance.now();
      const result = originalRender.apply(this, args);
      const duration = performance.now() - started;
      const hasData = getCurrentVisibleViewId() === 'av'
        && (Number(fullInventory.length) > 0 || Number(avOpenInventory?.length) > 0);
      if (probe.startedAt && hasData) probe.renderDurations.push(duration);
      captureSearchResult();
      return result;
    };
    const arm = () => {
      const tile = document.getElementById('home-tile-av');
      if (!tile) throw new Error('AV tile is unavailable');
      tile.addEventListener('pointerdown', () => {
        probe.startedAt = performance.now();
        probe.firstCardAt = 0;
        probe.renderDurations = [];
        probe.longTaskDurations = [];
        probe.searchStartedAt = 0;
        probe.searchResultAt = 0;
        probe.searchObserver?.disconnect();
        probe.searchObserver = new MutationObserver(captureSearchResult);
        probe.searchObserver.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
        probe.longTaskObserver?.disconnect();
        probe.longTaskObserver = new PerformanceObserver(entries => {
          for (const entry of entries.getEntries()) probe.longTaskDurations.push(entry.duration);
        });
        probe.longTaskObserver.observe({ type: 'longtask', buffered: false });
        const capture = () => {
          if (probe.firstCardAt) return true;
          const container = document.getElementById('av-content');
          const card = container?.querySelector('[data-dom-id]');
          if (!container || !card || card.getClientRects().length === 0) return false;
          const style = getComputedStyle(card);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          probe.firstCardAt = performance.now();
          probe.observer?.disconnect();
          return true;
        };
        probe.observer?.disconnect();
        probe.observer = new MutationObserver(() => { if (!capture()) requestAnimationFrame(capture); });
        probe.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        requestAnimationFrame(capture);
        probe.observer.observe(document.getElementById('av-content') || document.body, { childList: true, subtree: true, characterData: true });
      }, { once: true, capture: true });
    };
    arm();
    window.__armAvHydrationTiming = arm;
    return true;
  })()`));
  expect(installed).toBe(true);
}

async function timingEvidence(page: Page) {
  return page.evaluate(() => window.eval(`(() => {
    const probe = window.__avHydrationTiming;
    return {
      firstCardMs: probe?.firstCardAt && probe?.startedAt ? probe.firstCardAt - probe.startedAt : null,
      dataRenderDurationsMs: Array.isArray(probe?.renderDurations) ? probe.renderDurations.slice() : [],
      longTaskDurationsMs: Array.isArray(probe?.longTaskDurations) ? probe.longTaskDurations.slice() : [],
      maxMainThreadOperationMs: Math.max(0, ...(probe?.renderDurations || []), ...(probe?.longTaskDurations || [])),
      searchResponseMs: probe?.searchResultAt && probe?.searchStartedAt ? probe.searchResultAt - probe.searchStartedAt : null,
      previewRows: Number(fullInventory.length) || 0,
      avRows: Array.isArray(avOpenInventory) ? avOpenInventory.length : 0,
      master: { fullLoaded: getDatasetState('master').fullLoaded === true,
        fieldCoverage: String(getDatasetState('master').fieldCoverage || ''),
        rowCompleteness: String(getDatasetState('master').rowCompleteness || '') },
      verified: productionLiveSyncVerifiedView === productionVerifiedViewKey(),
      coordinatorState: String(getProductionLiveSyncCoordinator().getStatus().state || '')
    };
  })()`));
}

test('AV renders a bounded first-page preview before side reads, then verifies and reuses all inventory', { tag: ['@home-role'] }, async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'home-desktop-chromium', 'This is a controlled client-render timing measurement on desktop Chromium.');
  test.setTimeout(120_000);

  let sideGateEnabled = false;
  let releaseSideReads!: () => void;
  let markSideReadStarted!: () => void;
  const sideGate = new Promise<void>(resolve => { releaseSideReads = resolve; });
  const sideReadStarted = new Promise<void>(resolve => { markSideReadStarted = resolve; });
  let sideReadsHeld = 0;
  const masterPageLimits: number[] = [];

  const fixture = await installHlOrderFixture(page, baseURL!, {
    startupMode: 'cold', username: 'av_hydration_fixture', role: 'ADMIN', master: syntheticMasterRows(),
    beforeLogin: async () => {
      await expect(page.locator('#login-button')).toBeEnabled();
      await page.route('**/rest/v1/**', async route => {
        if (!sideGateEnabled) return route.fallback();
        const url = new URL(route.request().url());
        if (/\/rpc\/get_my_dataset_revisions_v1$/.test(url.pathname)) return route.fallback();
        if (!['GET', 'HEAD'].includes(route.request().method())) return route.fallback();
        sideReadsHeld++;
        markSideReadStarted();
        await sideGate;
        return route.fallback();
      });
      await page.route('**/functions/v1/app-api', async route => {
        if (!sideGateEnabled || route.request().method() !== 'POST') return route.fallback();
        const raw: unknown = route.request().postDataJSON();
        const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        if (body.action === 'inventory_read' && body.operation === 'master_page') {
          const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params)
            ? body.params as Record<string, unknown> : {};
          if (Number(params.offset) === 0 && masterPageLimits.length === 0) masterPageLimits.push(Number(params.limit));
          return route.fallback();
        }
        if (body.action === 'inventory_read' && body.operation === 'master_delta') return route.fallback();
        sideReadsHeld++;
        markSideReadStarted();
        await sideGate;
        return route.fallback();
      });
    }
  });

  fixture.holdNextMasterLaterPage();
  await installAvTimingProbe(page);
  sideGateEnabled = true;
  try {
    await page.locator('#home-tile-av').click();
    await Promise.all([fixture.waitForHeldMasterLaterPage(), sideReadStarted]);
    await expect(page.locator('#av-content [data-dom-id]').first()).toBeVisible();
    await expect.poll(async () => (await timingEvidence(page)).firstCardMs).not.toBeNull();

    const preview = await timingEvidence(page);
    expect(masterPageLimits[0], 'the AV preview read must use the bounded 500-row page').toBe(PREVIEW_PAGE_SIZE);
    expect(preview.previewRows).toBeGreaterThan(0);
    expect(preview.previewRows).toBeLessThanOrEqual(PREVIEW_PAGE_SIZE);
    expect(preview.firstCardMs).toBeGreaterThanOrEqual(0);
    expect(preview.firstCardMs).toBeLessThan(1000);
    expect(preview.dataRenderDurationsMs.length).toBeGreaterThan(0);
    expect(preview.maxMainThreadOperationMs).toBeLessThan(100);
    expect(preview.master.fieldCoverage).toBe('browse');
    expect(preview.master.rowCompleteness).not.toBe('complete');
    expect(preview.verified).toBe(false);

    const search = page.locator('#av-search');
    await expect(search).toBeEnabled();
    const searchStartedAt = await page.evaluate(() => {
      const probe = window.eval('window.__avHydrationTiming');
      const input = document.getElementById('av-search') as HTMLInputElement | null;
      if (!input || !probe) throw new Error('AV preview search control is unavailable');
      const startedAt = performance.now();
      probe.searchStartedAt = startedAt;
      probe.searchResultAt = 0;
      input.value = 'AVH.00499';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return startedAt;
    });
    await page.waitForFunction(() => window.eval('window.__avHydrationTiming.searchResultAt > 0'), null, { timeout: 1000 });
    const previewInteraction = await timingEvidence(page);
    expect(previewInteraction.searchResponseMs).toBeGreaterThanOrEqual(0);
    expect(previewInteraction.searchResponseMs).toBeLessThan(1000);
    expect(await search.inputValue()).toBe('AVH.00499');
    await expect(page.locator('#av-content [data-dom-id]').filter({ hasText: 'AVH.00499' }).first()).toBeVisible();
    expect(searchStartedAt).toBeGreaterThan(0);

    await page.waitForTimeout(1100);
    const gated = await timingEvidence(page);
    expect(gated.verified, 'no full-data verification may publish while later master pages and side reads are held').toBe(false);
    expect(gated.master.rowCompleteness).not.toBe('complete');
    expect(sideReadsHeld).toBeGreaterThan(0);
    expect(fixture.blockedMutations, 'preview must remain read-only').toEqual([]);
    expect(fixture.commands, 'no transactional commands may be issued before verification').toEqual([]);

    releaseSideReads();
    fixture.releaseHeldMasterLaterPage();
    await expect(page.locator('#live-data-freshness')).toHaveAttribute('data-state', 'Up to date', { timeout: 30_000 });
    await page.waitForFunction(() => window.eval(`getDatasetState('master').fieldCoverage === 'browse'
      && getDatasetState('master').rowCompleteness === 'complete'
      && fullInventory.length === ${SYNTHETIC_MASTER_ROWS}
      && productionLiveSyncVerifiedView === productionVerifiedViewKey()`), null, { timeout: 30_000 });

    const full = await timingEvidence(page);
    expect(full.master.fieldCoverage).toBe('browse');
    expect(full.master.rowCompleteness).toBe('complete');
    expect(full.previewRows).toBe(SYNTHETIC_MASTER_ROWS);
    expect(full.maxMainThreadOperationMs).toBeLessThan(100);
    expect(await search.inputValue()).toBe('AVH.00499');
    await expect(page.locator('#av-content [data-dom-id]').filter({ hasText: 'AVH.00499' }).first()).toBeVisible();

    const readsBeforeWarmRepeat = fixture.backgroundMasterReads;
    await page.locator('#global-header-inline-back').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await page.evaluate(() => window.eval('__armAvHydrationTiming()'));
    await page.locator('#home-tile-av').click();
    await expect(page.locator('#av-content [data-dom-id]').first()).toBeVisible();
    await expect.poll(async () => (await timingEvidence(page)).firstCardMs).not.toBeNull();
    await page.waitForFunction(() => window.eval(`productionLiveSyncVerifiedView === productionVerifiedViewKey()
      && getProductionLiveSyncCoordinator().getStatus().state === 'Up to date'`), null, { timeout: 10_000 });
    const warm = await timingEvidence(page);
    expect(warm.firstCardMs).toBeLessThan(1000);
    expect(warm.dataRenderDurationsMs.length).toBeGreaterThan(0);
    expect(warm.maxMainThreadOperationMs).toBeLessThan(100);
    expect(fixture.backgroundMasterReads).toBe(readsBeforeWarmRepeat);
    expect(warm.master.rowCompleteness).toBe('complete');
    expect(warm.verified).toBe(true);

    const evidence = {
      kind: 'isolated-client-render-fixture', datasetRows: SYNTHETIC_MASTER_ROWS,
      environment: {
        nodeVersion: process.version,
        browserVersion: await page.context().browser()?.version(),
        viewport: page.viewportSize(),
        coldAssumptions: 'Fresh Playwright test context, cold fixture login, no-cache request headers, and service workers blocked by the home-role config.',
        warmAssumptions: 'Same page context after full browse-cohort verification; repeat reuses the verified in-memory browse dataset.'
      },
      firstPageLimit: masterPageLimits[0], coldPreview: preview, gatedState: gated, fullVerification: full,
      previewInteraction, warmRepeat: warm, heldSideReadCount: sideReadsHeld,
      note: 'Playwright fixture measurements cover UI hydration/rendering; database and live API timings require the separate disposable backend benchmark.'
    };
    await testInfo.attach('av-hydration-client-fixture.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    console.log('AV_HYDRATION_CLIENT_FIXTURE', JSON.stringify(evidence));
  } finally {
    releaseSideReads();
    try { fixture.releaseHeldMasterLaterPage(); } catch { /* no page remained held */ }
  }

  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});
