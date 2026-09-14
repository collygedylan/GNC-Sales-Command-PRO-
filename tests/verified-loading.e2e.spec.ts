import { expect, test, type Page } from '@playwright/test';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';

type VisitPhase = 'cold' | 'repeat-settled-home' | 'repeat-rapid-home';
type CoordinatorStats = { revisionReads: number; adapterReads: number; discardedLoads: number; commits: number; signals: number; cacheHits: number };
type Visit = {
  phase: VisitPhase; elapsedMs: number | null; error?: string; requestCount: number; transferredBytes: number; cards: number; usable: boolean;
  proofMs: number | null; visibleMs: number | null; usableMs: number | null; currentView: string; verifiedKey: string;
  coordinator: { before: CoordinatorStats; after: CoordinatorStats; delta: CoordinatorStats };
};
type Totals = { requests: number; bytes: number; pending: Promise<void>[] };

async function coordinatorEvidence(page: Page) {
  return page.evaluate(() => {
    const coordinator = window.eval('getProductionLiveSyncCoordinator()');
    const stats = coordinator?.getStatistics?.() || {};
    return {
      currentView: window.eval('getCurrentVisibleViewId()'),
      verifiedKey: String(window.eval('productionLiveSyncVerifiedView') || ''),
      stats: {
        revisionReads: Number(stats.revisionReads) || 0, adapterReads: Number(stats.adapterReads) || 0,
        discardedLoads: Number(stats.discardedLoads) || 0, commits: Number(stats.commits) || 0,
        signals: Number(stats.signals) || 0, cacheHits: Number(stats.cacheHits) || 0
      }
    };
  });
}

function subtractStats(after: CoordinatorStats, before: CoordinatorStats): CoordinatorStats {
  return Object.fromEntries(Object.keys(after).map(key => [key, after[key as keyof CoordinatorStats] - before[key as keyof CoordinatorStats]])) as CoordinatorStats;
}

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

async function visitView(page: Page, totals: Totals, phase: VisitPhase, view: 'Drive' | 'Tasks'): Promise<Visit> {
  const baseline = { requests: totals.requests, bytes: totals.bytes };
  const before = await coordinatorEvidence(page);
  const entry = view === 'Drive' ? page.locator('#home-tile-drive') : page.getByRole('navigation').getByRole('button', { name: 'Tasks', exact: true });
  await entry.evaluate(element => {
    element.addEventListener('pointerdown', () => {
      const startedAt = performance.now();
      (window as any).__verifiedNavigationStart = startedAt;
      (window as any).__verifiedNavigationMarks = { startedAt, startedWallAt: Date.now(), visibleAt: null, proofAt: null, usableAt: null };
    }, { once: true, capture: true });
  });
  await entry.click();
  if (view === 'Drive') {
    await page.waitForFunction(() => {
      const content = document.getElementById('drive-content');
      const marks = (window as any).__verifiedNavigationMarks;
      if (content?.getClientRects().length && marks && marks.visibleAt == null) marks.visibleAt = performance.now() - marks.startedAt;
      const verified = window.eval('productionLiveSyncVerifiedView && productionLiveSyncVerifiedView === productionVerifiedViewKey()')
        && window.eval('getProductionLiveSyncCoordinator().getStatus().lastVerifiedAt') >= marks.startedWallAt;
      if (verified && marks && marks.proofAt == null) marks.proofAt = performance.now() - marks.startedAt;
      const usable = !content?.querySelector('.skeleton') && Array.from(content?.querySelectorAll('button,[role="button"]') || []).some(button =>
        (button.getAttribute('aria-label') || button.textContent || '').startsWith('Open ') && button.getClientRects().length);
      if (verified && usable && marks && marks.usableAt == null) marks.usableAt = performance.now() - marks.startedAt;
      return verified && usable;
    }, null, { timeout: 10000 });
  } else {
    await page.waitForFunction(() => {
      const content = document.getElementById('task-content');
      const marks = (window as any).__verifiedNavigationMarks;
      if (content?.getClientRects().length && marks && marks.visibleAt == null) marks.visibleAt = performance.now() - marks.startedAt;
      const verified = window.eval('productionLiveSyncVerifiedView && productionLiveSyncVerifiedView === productionVerifiedViewKey()')
        && window.eval('getProductionLiveSyncCoordinator().getStatus().lastVerifiedAt') >= marks.startedWallAt;
      if (verified && marks && marks.proofAt == null) marks.proofAt = performance.now() - marks.startedAt;
      const usable = !!(content?.getClientRects().length && content.textContent?.trim() && !content.querySelector('.skeleton')
        && !content.querySelector('[onclick*="retryVerifiedViewData"]'));
      if (verified && usable && marks && marks.usableAt == null) marks.usableAt = performance.now() - marks.startedAt;
      return verified && usable;
    }, null, { timeout: 10000 });
  }
  const cards = view === 'Drive'
    ? await page.locator('#drive-content').getByRole('button', { name: /^Open / }).count()
    : await page.locator('#task-content [role=button]').count();
  const usable = cards > 0;
  expect(usable, `${view} benchmark samples must contain actionable rendered results`).toBe(true);
  const marks = await page.evaluate(() => (window as any).__verifiedNavigationMarks || {});
  const elapsedMs = Math.round(marks.usableAt);
  await Promise.all(totals.pending.splice(0));
  const after = await coordinatorEvidence(page);
  expect(after.currentView, 'benchmark proof must belong to the visible requested view').toBe(view.toLowerCase());
  expect(after.verifiedKey, 'benchmark proof must be current rather than retained from another view').toBe(await page.evaluate(() => window.eval('productionVerifiedViewKey()')));
  return { phase, elapsedMs, requestCount: totals.requests - baseline.requests,
    transferredBytes: totals.bytes - baseline.bytes, cards, usable, proofMs: marks.proofAt ?? null,
    visibleMs: marks.visibleAt ?? null, usableMs: marks.usableAt ?? null, currentView: after.currentView, verifiedKey: after.verifiedKey,
    coordinator: { before: before.stats, after: after.stats, delta: subtractStats(after.stats, before.stats) } };
}

async function measureVisit(page: Page, totals: Totals, phase: VisitPhase, view: 'Drive' | 'Tasks'): Promise<Visit> {
  try { return await visitView(page, totals, phase, view); }
  catch (error) {
    if (process.env.VERIFIED_LOADING_BASELINE !== '1') throw error;
    // A historical noncompletion is recorded, never converted into a timing
    // sample or accepted as candidate behavior.
    const after = await coordinatorEvidence(page);
    return { phase, elapsedMs: null, error: String(error).split('\n')[0], requestCount: 0, transferredBytes: 0,
      cards: 0, usable: false, proofMs: null, visibleMs: null, usableMs: null,
      currentView: after.currentView, verifiedKey: after.verifiedKey,
      coordinator: { before: after.stats, after: after.stats, delta: subtractStats(after.stats, after.stats) } };
  }
}

async function returnHome(page: Page, settle = false) {
  await page.locator('#global-header-inline-back').click();
  await expect(page.locator('#view-home')).toBeVisible();
  if (settle) {
    await page.waitForFunction(() => window.eval(`getCurrentVisibleViewId() === 'home'
      && productionLiveSyncVerifiedView && productionLiveSyncVerifiedView === productionVerifiedViewKey()
      && getProductionLiveSyncCoordinator().getStatus().state === 'Up to date'`), null, { timeout: 10000 });
  }
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
      const fixture = await installColdFixture(page, baseURL!, view === 'Tasks' ? {
        master: [
          { ...hlMaster('benchmark-task-av', {
            commonname: 'Benchmark Current AV Blank', locationcode: 'A.01.001', lotcode: '27.F1',
            app_tab_assignment: 'season', priority: '1', ptravailable: '10'
          }) }
        ],
        beforeLogin: async () => {
          await page.route(/\/rest\/v1\/ph_cav_import(?:\?|$)/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
            { itemcode: 'SYNTH.003', season: 'F1', holdstopreason: '' }
          ]) }));
          await expect(page.locator('#login-button')).toBeEnabled();
        }
      } : {});
      await Promise.all(totals.pending.splice(0));
      const cold = await measureVisit(page, totals, 'cold', view);
      await returnHome(page, true);
      await Promise.all(totals.pending.splice(0));
      const settledRepeat = await measureVisit(page, totals, 'repeat-settled-home', view);
      await returnHome(page, false);
      const rapidRepeat = await measureVisit(page, totals, 'repeat-rapid-home', view);
      trials.push([cold, settledRepeat, rapidRepeat]);
      expect(fixture.errors).toEqual([]);
      expect(fixture.blockedMutations).toEqual([]);
    } finally {
      await context.close();
    }
  }
  await info.attach('verified-loading-benchmark.json', { body: JSON.stringify({ view, trials }, null, 2), contentType: 'application/json' });
  expect(trials).toHaveLength(3);
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


test('returning to Drive masks cached rows until this visit verifies current revisions', async ({ page, baseURL }) => {
  const fixture = await installColdFixture(page, baseURL!);
  await page.locator('#home-tile-drive').click(); await waitForVerifiedDrive(page);
  const reads = fixture.backgroundMasterReads;
  await returnHome(page, true);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/rest/v1/rpc/get_my_dataset_revisions_v1', async route => {
    const keys = route.request().postDataJSON()?.p_dataset_keys || [];
    if (keys.length === 2 && keys.includes('ph_master_inventory')) { started(); await gate; }
    await route.fallback();
  });
  try {
    await page.locator('#home-tile-drive').click(); await seen;
    await expect(page.locator('#drive-content .skeleton').first()).toBeVisible();
    await expect(page.locator('#drive-content').getByRole('button', { name: /^Open / })).toHaveCount(0);
    expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView === productionVerifiedViewKey()'))).toBe(false);
    release(); await waitForVerifiedDrive(page);
    expect(fixture.backgroundMasterReads).toBe(reads);
  } finally { release(); }
  expect(fixture.errors).toEqual([]); expect(fixture.blockedMutations).toEqual([]);
});
