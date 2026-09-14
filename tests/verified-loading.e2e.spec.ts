import { expect, test, type Page } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';

type Visit = { phase: 'cold' | 'repeat'; elapsedMs: number; requestCount: number; transferredBytes: number; cards: number; usable: boolean };
type Totals = { requests: number; bytes: number; pending: Promise<void>[] };

async function waitForVerifiedDrive(page: Page) {
  await expect(page.locator('#view-drive')).toBeVisible();
  await page.waitForFunction(() => {
    const content = document.getElementById('drive-content');
    return window.eval('productionLiveSyncVerifiedView && productionLiveSyncVerifiedView === productionVerifiedViewKey()')
      && !content?.querySelector('.skeleton')
      && Array.from(content?.querySelectorAll('button,[role="button"]') || []).some(button =>
        (button.getAttribute('aria-label') || button.textContent || '').startsWith('Open ') && button.getClientRects().length);
  }, null, { timeout: 10000 });
  const rows = page.locator('#drive-content').getByRole('button', { name: /^Open / });
  await expect(rows.first()).toBeVisible();
  return rows.count();
}

async function visitView(page: Page, totals: Totals, phase: Visit['phase'], view: 'Drive' | 'Tasks'): Promise<Visit> {
  const baseline = { requests: totals.requests, bytes: totals.bytes };
  const entry = view === 'Drive' ? page.locator('#home-tile-drive') : page.getByRole('navigation').getByRole('button', { name: 'Tasks', exact: true });
  await entry.evaluate(element => {
    element.addEventListener('pointerdown', () => { (window as any).__verifiedNavigationStart = performance.now(); }, { once: true, capture: true });
  });
  await entry.click();
  let cards = 0, usable = false;
  try {
    if (view === 'Drive') cards = await waitForVerifiedDrive(page);
    else {
      await page.waitForFunction(() => {
        const content = document.getElementById('task-content');
        return window.eval('productionLiveSyncVerifiedView && productionLiveSyncVerifiedView === productionVerifiedViewKey()')
          && content?.getClientRects().length && content.textContent?.trim() && !content.querySelector('.skeleton')
          && !content.querySelector('[onclick*="retryVerifiedViewData"]');
      }, null, { timeout: 10000 });
      cards = await page.locator('#task-content [role=button]').count();
    }
    usable = true;
  }
  catch (error) {
    // The historical baseline has a confirmed repeat-navigation render defect.
    // Record its bounded noncompletion; candidate and normal regressions fail.
    if (process.env.VERIFIED_LOADING_BASELINE !== '1' || phase !== 'repeat') throw error;
  }
  const elapsedMs = await page.evaluate(() => Math.round(performance.now() - (window as any).__verifiedNavigationStart));
  await Promise.all(totals.pending.splice(0));
  return { phase, elapsedMs, requestCount: totals.requests - baseline.requests,
    transferredBytes: totals.bytes - baseline.bytes, cards, usable };
}

async function returnHome(page: Page) {
  await page.locator('#global-header-inline-back').click();
  await expect(page.locator('#view-home')).toBeVisible();
}

async function installColdFixture(page: Page, baseURL: string, options: Record<string, unknown> = {}) {
  return installHlOrderFixture(page, baseURL, {
    startupMode: 'cold', username: 'verified_loading_admin', role: 'ADMIN',
    beforeLogin: async () => { await expect(page.locator('#login-button')).toBeEnabled(); }, ...options
  });
}

test('Drive verifies cards before unopened reserves and AV-note sources are requested', async ({ page, baseURL }) => {
  let releaseOptional!: () => void;
  const optionalGate = new Promise<void>(resolve => { releaseOptional = resolve; });
  let optionalReadCount = 0;
  const fixture = await installColdFixture(page, baseURL!, {
    beforeLogin: async () => {
      await page.route(/\/rest\/v1\/(ph_reserves|ph_av_notes)(?:\?|$)/, async route => {
        optionalReadCount++;
        await optionalGate;
        await route.fallback();
      });
      await expect(page.locator('#login-button')).toBeEnabled();
    }
  });
  try {
    await page.locator('#home-tile-drive').click();
    expect(await waitForVerifiedDrive(page)).toBeGreaterThan(0);
    expect(optionalReadCount, 'initial Drive may not request unopened Reserves or AV-note sources').toBe(0);
    const masterReads = fixture.backgroundMasterReads;
    await returnHome(page);
    await page.locator('#home-tile-drive').click();
    expect(await waitForVerifiedDrive(page)).toBeGreaterThan(0);
    expect(fixture.backgroundMasterReads, 'unchanged repeat visits reuse the verified inventory snapshot').toBe(masterReads);
  } finally {
    releaseOptional();
  }
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

for (const view of ['Drive', 'Tasks'] as const) test(`benchmark records three independent cold and repeat ${view} visits`, async ({ browser, baseURL }, info) => {
  test.skip(process.env.VERIFIED_LOADING_BENCHMARK !== '1', 'benchmark enabled only when explicitly requested');
  const trials: Visit[][] = [];
  for (let trial = 0; trial < 3; trial++) {
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
    const page = await context.newPage();
    const totals: Totals = { requests: 0, bytes: 0, pending: [] };
    page.on('response', response => {
      if (!new URL(response.url()).pathname.includes('/rest/v1/')) return;
      totals.requests++;
      totals.pending.push(response.body().then(body => { totals.bytes += body.length; }).catch(() => {}));
    });
    try {
      const fixture = await installColdFixture(page, baseURL!);
      await Promise.all(totals.pending.splice(0));
      const cold = await visitView(page, totals, 'cold', view);
      await returnHome(page);
      await Promise.all(totals.pending.splice(0));
      const repeat = await visitView(page, totals, 'repeat', view);
      trials.push([cold, repeat]);
      expect(fixture.errors).toEqual([]);
      expect(fixture.blockedMutations).toEqual([]);
    } finally {
      await context.close();
    }
  }
  await info.attach('verified-loading-benchmark.json', { body: JSON.stringify({ view, trials }, null, 2), contentType: 'application/json' });
  expect(trials).toHaveLength(3);
  expect(trials.every(pair => pair[0].usable)).toBe(true);
  if (process.env.VERIFIED_LOADING_BASELINE !== '1') expect(trials.flat().every(visit => visit.usable)).toBe(true);
});


test('Tasks verifies both AV Blank inputs without waiting for unopened task categories', async ({ page, baseURL }) => {
  let releaseCav!: () => void, releaseOptional!: () => void;
  const cavGate = new Promise<void>(resolve => { releaseCav = resolve; });
  const optionalGate = new Promise<void>(resolve => { releaseOptional = resolve; });
  let cavReads = 0, optionalReads = 0;
  const fixture = await installColdFixture(page, baseURL!, {
    beforeLogin: async () => {
      await page.route(/\/rest\/v1\/ph_cav_import(?:\?|$)/, async route => {
        cavReads++; await cavGate; await route.fallback();
      });
      await page.route(/\/rest\/v1\/(ph_av_notes|ph_view_av_hot_price_keys|ph_flyer_folder_rows|ph_flyer_folder_history)(?:\?|$)/, async route => {
        optionalReads++; await optionalGate; await route.fallback();
      });
      await expect(page.locator('#login-button')).toBeEnabled();
    }
  });
  try {
    await page.getByRole('navigation').getByRole('button', { name: 'Tasks', exact: true }).click();
    await expect.poll(() => cavReads).toBeGreaterThan(0);
    await expect(page.locator('#task-content .skeleton').first()).toBeVisible();
    releaseCav();
    await page.waitForFunction(() => window.eval('productionLiveSyncVerifiedView && productionLiveSyncVerifiedView === productionVerifiedViewKey()'));
    await expect(page.locator('#task-content .skeleton')).toHaveCount(0);
    expect(cavReads, 'explicit AV Blank keys and fallback rows must both be complete').toBeGreaterThanOrEqual(2);
    expect(optionalReads).toBe(0);
  } finally { releaseCav(); releaseOptional(); }
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});
