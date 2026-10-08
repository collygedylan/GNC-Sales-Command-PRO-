import { expect, test, type Page } from '@playwright/test';

import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
import { poManagementRow } from './fixtures/po-management-canary.mjs';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';
// @test-group: @home-role


type VisitPhase = 'cold' | 'repeat-settled-home' | 'repeat-rapid-home';
type CoordinatorStats = { revisionReads: number; adapterReads: number; discardedLoads: number; commits: number; signals: number; cacheHits: number };
type Visit = {
  phase: VisitPhase; elapsedMs: number | null; error?: string; requestCount: number; transferredBytes: number; cards: number; usable: boolean;
  proofMs: number | null; visibleMs: number | null; usableMs: number | null; currentView: string; verifiedKey: string;
  coordinator: { before: CoordinatorStats; after: CoordinatorStats; delta: CoordinatorStats };
};
type Totals = { requests: number; bytes: number; pending: Promise<void>[] };

function isStrictDatasetRead(body: any, dataset: string) {
  const params = body?.params;
  return body?.action === 'dataset_read' && body.dataset === dataset
    && Object.keys(body).sort().join(',') === 'action,dataset,params'
    && params && typeof params === 'object' && !Array.isArray(params)
    && Number.isInteger(params.limit) && params.limit >= 1 && params.limit <= 500
    && Number.isInteger(params.offset) && params.offset >= 0
    && (!params.projection || ['default', 'signature', 'ids'].includes(params.projection))
    && Array.isArray(params.filters || []) && Array.isArray(params.anyOf || []) && Array.isArray(params.order || [])
    && Object.keys(params).every(key => ['limit', 'offset', 'projection', 'filters', 'anyOf', 'order'].includes(key));
}

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
  }, null, { timeout: 10000 }).catch(async error => {
    const state = await page.evaluate(() => window.eval(`JSON.stringify({
      state: getProductionLiveSyncCoordinator().getStatus().state,
      verified: productionLiveSyncVerifiedView === productionVerifiedViewKey(),
      skeletons: document.querySelectorAll('#drive-content .skeleton').length,
      visibleCards: Array.from(document.querySelectorAll('#drive-content [role="button"]')).filter(node => node.getClientRects().length).length,
      statistics: getProductionLiveSyncCoordinator().getStatistics(),
      drivePreparationDiagnostics: window.__drivePreparationDiagnostics || [],
      drivePreparationInvalidations: window.__drivePreparationInvalidations || []
    })`));
    throw new Error(`${String(error)}\nDrive verification diagnostic: ${state}`);
  });
  const rows = page.locator('#drive-content').getByRole('button', { name: /^Open / });
  await expect(rows.first()).toBeVisible();
  return rows.count();
}

async function installDrivePreparationDiagnostics(page: Page) {
  const installed = await page.evaluate(() => window.eval(`(() => {
    const events = window.__drivePreparationDiagnostics = [];
    const invalidations = window.__drivePreparationInvalidations = [];
    const pendingMetadata = new WeakMap();
    const check = pending => {
      const baseline = pendingMetadata.get(pending) || {};
      return pending && ({
      pendingIdentity: driveCommonNamePreparation === pending,
      visible: !document.hidden && getCurrentVisibleViewId() === 'drive',
      nameTab: activeDriveTab === 'name',
      selectionMatches: getDriveDrillSelectionStateKey() === pending.selection,
      searchMatches: String(document.getElementById('drive-search')?.value || '') === pending.search,
      filterMatches: driveVisibleItemsStateCacheKey === pending.filterKey,
      baseFilterMatches: driveBaseFilterCacheKey === baseline.baseFilterKey,
      baseContextMatches: getDriveBaseFilterContextKey() === baseline.baseContextKey,
      syncTimestampMatches: String(lastSyncTime || '') === baseline.lastSyncTime,
      masterLoadTimeMatches: String(getDatasetState('master').lastLoadedAt || '') === baseline.masterLastLoadedAt,
      inventoryLengthMatches: fullInventory.length === baseline.inventoryLength,
      visibleKeyWasEmptyAtStart: baseline.visibleKeyEmptyAtStart,
      userRoleMatches: String(currentUser || '') === pending.user && String(currentRole || '') === pending.role,
      chunkTokenCurrent: isChunkRenderCurrentForContainer(pending.container, 'drive:name:list', pending.token),
      nativeProofCurrent: !pending.native || (canUseProductionLiveSync() && productionVerifiedViewKey() === pending.proof),
      readGenerationCurrent: !pending.native || productionLiveSyncReadGeneration === pending.generation
      });
    };
    const originalCheck = isDriveCommonNamePreparationCurrent;
    const originalInvalidate = invalidateDriveResolvedCardState;
    const originalRenderNames = renderDriveCompleteCommonNames;
    const originalCancel = cancelDriveCommonNamePreparation;
    const wrappedCheck = function(pending) {
      const result = originalCheck.call(this, pending);
      if (pending && !result && events.length < 16) {
        window.__drivePreparationLastInvalidation = {
          kind: 'predicate-false', at: Math.round(performance.now()),
          generation: productionLiveSyncReadGeneration, pendingGeneration: Number(pending?.generation), checks: check(pending)
        };
        events.push(window.__drivePreparationLastInvalidation);
      } else if (result) window.__drivePreparationLastInvalidation = null;
      return result;
    };
    isDriveCommonNamePreparationCurrent = wrappedCheck;
    invalidateDriveResolvedCardState = function(...args) {
      const pending = driveCommonNamePreparation;
      if (pending && invalidations.length < 16) {
        const baseline = pendingMetadata.get(pending) || {};
        const masterState = getDatasetState('master');
        invalidations.push({
          at: Math.round(performance.now()),
          visibleKeyEmptyBefore: !driveVisibleItemsStateCacheKey,
          pendingKeyEmpty: !pending.filterKey,
          visibleKeyMatchesBefore: driveVisibleItemsStateCacheKey === pending.filterKey,
          hasSearch: !!pending.search,
          lastSyncTimeChanged: String(lastSyncTime || '') !== String(baseline.lastSyncTime || ''),
          masterLoadTimeChanged: String(masterState.lastLoadedAt || '') !== String(baseline.masterLastLoadedAt || ''),
          inventoryLengthChanged: fullInventory.length !== baseline.inventoryLength,
          stack: String(new Error().stack || '').split('\\n').slice(1, 7).map(line => line.trim())
        });
      }
      return originalInvalidate.apply(this, args);
    };
    renderDriveCompleteCommonNames = function(...args) {
      const result = originalRenderNames.apply(this, args);
      const pending = driveCommonNamePreparation;
      if (pending && !pendingMetadata.has(pending)) {
        const masterState = getDatasetState('master');
        pendingMetadata.set(pending, {
          baseFilterKey: String(driveBaseFilterCacheKey || ''),
          baseContextKey: String(getDriveBaseFilterContextKey() || ''),
          lastSyncTime: String(lastSyncTime || ''),
          masterLastLoadedAt: String(masterState.lastLoadedAt || ''),
          inventoryLength: fullInventory.length,
          visibleKeyEmptyAtStart: !pending.filterKey
        });
      }
      return result;
    };
    const wrappedCancel = function(...args) {
      const pending = driveCommonNamePreparation;
      if (pending && events.length < 16) {
        events.push({
          kind: 'cancel', at: Math.round(performance.now()),
          generation: productionLiveSyncReadGeneration,
          pendingGeneration: Number(pending?.generation),
          checks: pending ? check(pending) : null,
          invalidations: invalidations.slice(),
          precededByInvalidation: window.__drivePreparationLastInvalidation?.kind === 'predicate-false'
        });
      }
      return originalCancel.apply(this, args);
    };
    cancelDriveCommonNamePreparation = wrappedCancel;
    return isDriveCommonNamePreparationCurrent === wrappedCheck && cancelDriveCommonNamePreparation === wrappedCancel;
  })()`));
  expect(installed, 'Drive preparation diagnostics install before the retry scenario').toBe(true);
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

async function closeMenuAccessibly(page: Page) {
  const closeMenu = page.getByRole('button', { name: 'Close menu', exact: true });
  await expect(closeMenu).toBeVisible();
  await closeMenu.press('Enter');
}

async function retryFreshnessFromMenu(page: Page, beforeRetry: () => void = () => {}) {
  expect(await page.locator('#live-data-warning-dot').evaluate(element => element.parentElement?.id)).toBe('footer-menu-btn');
  await expect(page.locator('#live-data-warning-dot')).toBeVisible();
  await page.locator('#footer-menu-btn').click();
  await expect(page.locator('#side-drawer')).toHaveClass(/open/);
  await expect(page.locator('#live-data-freshness')).toBeVisible();
  await expect(page.locator('#live-data-retry')).toBeVisible();
  beforeRetry();
  await page.locator('#live-data-retry').click();
  await closeMenuAccessibly(page);
  await expect(page.locator('#side-drawer')).not.toHaveClass(/open/);
}

type PendingRequestReadMode = 'rows' | 'failed' | 'empty';

const pendingRequestRow = {
  unique_id: 'verified-loading-pending-request', itemcode: 'REQ.001', commonname: 'Synthetic pending request Hosta',
  contsize: '#1', locationcode: 'C.09.001', lotcode: '27.F1', season: 'F1', saleyear: '27',
  req_status: 'Pending', req_archived: false, req_qty: '5', req_match: '100', request_folder: 'verified-loading-folder',
  req_customer: 'Synthetic Request Customer', salesrepname: 'Fixture Rep', requested_by: 'verified_loading_admin'
};

async function installPendingRequestFixture(page: Page, baseURL: string, initialMode: PendingRequestReadMode) {
  const origin = new URL(baseURL).origin;
  let mode = initialMode;
  let releaseUnrelatedReads!: () => void;
  const unrelatedGate = new Promise<void>(resolve => { releaseUnrelatedReads = resolve; });
  let released = false;
  const reads: string[] = [];
  const fixture = await installColdFixture(page, baseURL, {
    beforeLogin: async () => {
      await page.route('**/functions/v1/app-api', async route => {
        const body = route.request().postDataJSON() || {};
        if (isStrictDatasetRead(body, 'request_queue')) {
          reads.push('dataset_read:request_queue');
          const { limit, offset } = body.params;
          if (mode === 'failed') return route.fulfill({ status: 503, contentType: 'application/json',
            headers: { 'access-control-allow-origin': origin }, body: JSON.stringify({ ok: false, error: 'Synthetic required request read failure' }) });
          const allRows = mode === 'rows' ? [pendingRequestRow] : [];
          const rows = allRows.slice(offset, offset + limit);
          return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin },
            body: JSON.stringify({ ok: true, data: { rows, total: allRows.length, offset, limit, hasMore: offset + rows.length < allRows.length } }) });
        }
        if (body.action !== 'inventory_read' || !['master_page', 'master_delta'].includes(body.operation)) return route.fallback();
        reads.push('ph_master_inventory');
        if (mode === 'failed') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic inventory read failure' }) });
        await unrelatedGate;
        if (body.operation === 'master_page') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true,
            data: inventoryReadFixture.readMasterPage([], body.params || {}) }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {
          rows: [], total: 0, offset: body.params?.offset || 0, limit: body.params?.limit || 500, hasMore: false
        } }) });
      });
      await page.route(/\/rest\/v1\/(?:ph_request_history|ph_sales_credit_requests|ph_inventory_edit_requests|ph_customer_consignee_sales_reps)(?:\?|$)/, async route => {
        const table = new URL(route.request().url()).pathname.split('/').pop() || '';
        reads.push(table);
        const headers = {
          'access-control-allow-origin': origin,
          'access-control-expose-headers': 'content-range',
          'content-range': mode === 'rows' ? '0-0/1' : '*/0'
        };
        const fulfill = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(value) });
        if (['ph_inventory_edit_requests', 'ph_customer_consignee_sales_reps'].includes(table)) {
          await unrelatedGate;
          return fulfill({ message: `Synthetic held ${table} failure` }, 500);
        }
        return fulfill({ message: `Synthetic unrelated ${table} failure` }, 500);
      });
      await expect(page.locator('#login-button')).toBeEnabled();
    }
  });
  return {
    fixture,
    reads,
    setMode(nextMode: PendingRequestReadMode) { mode = nextMode; },
    releaseUnrelatedReads() {
      if (released) return;
      released = true;
      releaseUnrelatedReads();
    }
  };
}

async function openPendingRequests(page: Page) {
  await page.locator('#footer-request-btn').click();
  await expect(page.locator('#view-request')).toBeVisible();
}

async function expectPendingRequestScope(page: Page) {
  await page.waitForFunction(() => window.eval(`getCurrentVisibleViewId() === 'request'
    && productionLiveSyncVerifiedView === productionVerifiedViewKey()`));
  const context = await page.evaluate(() => window.eval(`(() => {
    const current = getProductionLiveSyncContext();
    return { view: current.viewKey, surfaces: current.surfaces, adapters: current.adapters.map((adapter) => adapter.id) };
  })()`));
  expect(context.view).toContain('request');
  expect(context.surfaces).toContain('request:pending');
  expect(context.adapters).toEqual(['side:settings', 'core:requests']);
}

const COMMON_NAME_TOTAL = 1581;
const commonNameAt = (index: number) => `Common Name ${String(index).padStart(4, '0')}`;
function commonNameMasterRows() {
  return Array.from({ length: 9366 }, (_, index) => {
    const number = index % COMMON_NAME_TOTAL + 1;
    return Object.freeze(hlMaster(`common-row-${String(index + 1).padStart(5, '0')}`, {
      itemcode: `CN.${String(number).padStart(4, '0')}`,
      commonname: commonNameAt(number), locationcode: `A.${String(index + 1).padStart(5, '0')}`
    }));
  });
}

const commonNameState = (page: Page) => page.locator('#drive-content');
const commonNameButtons = (page: Page) => page.locator('#drive-content').getByRole('button', { name: /^Open Common Name / });

test('Common Name displays early rows, finishes all 9366 rows, and survives identical refreshes', {"tag":["@home-role"]}, async ({ page, baseURL }, info) => {
  const fixture = await installColdFixture(page, baseURL!, { master: commonNameMasterRows() });
  fixture.holdNextMasterLaterPage();
  const coldStartedAt = Date.now();
  try {
    await page.locator('#home-tile-drive').click();
    await fixture.waitForHeldMasterLaterPage();
    try { await expect.poll(() => commonNameButtons(page).count()).toBeGreaterThan(0); }
    catch (error) {
      const detail = await page.evaluate(() => window.eval(`JSON.stringify({ context: getProductionLiveSyncContext().adapters.map(a=>a.id), surfaces:getProductionLiveSyncContext().surfaces, progressive:getProductionLiveSyncContext().progressive, canDisplay:hasProgressiveViewData(), groups:[...productionDisplayGroups], draft:hasProductionLiveSyncDraft(), active:document.activeElement?.id, rows:fullInventory.length, status:productionLiveSyncCoordinator.getStatus(), pending:!!driveCommonNamePreparation })`));
      throw new Error(`${String(error)}\nPreview diagnostic: ${detail}`, { cause: error });
    }
    const firstMs = Date.now() - coldStartedAt;
    expect(await commonNameButtons(page).count()).toBeLessThan(COMMON_NAME_TOTAL);
    await expect(page.locator('#live-data-freshness')).not.toContainText('Up to date');
    await page.evaluate(() => { window.eval('renderDrive(); renderDrive();'); });
    await expect.poll(() => commonNameButtons(page).count()).toBeGreaterThan(0);
    fixture.releaseHeldMasterLaterPage();
    await waitForVerifiedDrive(page);
    await expect(commonNameButtons(page)).toHaveCount(COMMON_NAME_TOTAL, { timeout: 20000 });
    const completeMs = Date.now() - coldStartedAt;
    await returnHome(page, true);
    const before = fixture.backgroundMasterReads, repeatStart = Date.now();
    await page.locator('#home-tile-drive').click();
    await expect(commonNameButtons(page)).toHaveCount(COMMON_NAME_TOTAL, { timeout: 20000 });
    await waitForVerifiedDrive(page);
    expect(fixture.backgroundMasterReads).toBe(before);
    await info.attach('progressive-loading.json', { body: JSON.stringify({ firstMs, completeMs, repeatMs: Date.now() - repeatStart,
      rows: 9366, names: COMMON_NAME_TOTAL, masterReads: before }), contentType: 'application/json' });
    for (const index of [1, 781, COMMON_NAME_TOTAL]) {
      await page.locator('#drive-content').getByRole('button', { name: `Open ${commonNameAt(index)}`, exact: true }).click();
      await expect(page.locator('#drive-crumb')).toContainText(commonNameAt(index));
      await page.locator('#global-header-inline-back').click();
      await expect(commonNameButtons(page)).toHaveCount(COMMON_NAME_TOTAL, { timeout: 20000 });
    }
    await expect(page.locator('#drive-content').getByRole('button', { name: `Open ${commonNameAt(781)}`, exact: true })).toContainText('6 Rows');
  } finally { try { fixture.releaseHeldMasterLaterPage(); } catch (_) {} }
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('Common Name replaces obsolete search and navigation work and resumes after visibility changes', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  const fixture = await installColdFixture(page, baseURL!, { master: commonNameMasterRows() });
  await page.locator('#home-tile-drive').click();
  await waitForVerifiedDrive(page);
  await expect(commonNameButtons(page)).toHaveCount(COMMON_NAME_TOTAL, { timeout: 20000 });
  await page.locator('#drive-search').fill(commonNameAt(781));
  await expect(commonNameButtons(page)).toHaveCount(1);
  await page.locator('#drive-search').fill('');
  await page.locator('#global-header-inline-back').click();
  await page.locator('#home-tile-drive').click();
  await page.evaluate(() => {
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    delete (document as unknown as Record<string, unknown>).hidden;
  });
  // Exercise the passive chat refresh that used to force a foreground read and
  // repeatedly invalidate this unchanged inventory list while it was preparing.
  await page.evaluate(async () => {
    await window.eval('runChatBackgroundPoll()');
    window.eval('ensureChatBackgroundSync("test-resume", 0)');
  });
  await expect(commonNameButtons(page)).toHaveCount(COMMON_NAME_TOTAL, { timeout: 20000 });
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

for (const failure of ['failed', 'empty'] as const) test(`Common Name retains early rows with Retry when a later page is ${failure}`, {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  const fixture = await installColdFixture(page, baseURL!, { master: commonNameMasterRows() });
  if (failure === 'failed') fixture.failNextMasterLaterPage(); else fixture.emptyMasterLaterPage();
  await page.locator('#home-tile-drive').click();
  await expect(page.locator('#live-data-freshness')).toContainText('Needs attention', { timeout: 20000 });
  await expect.poll(() => commonNameButtons(page).count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView'))).toBe('');
  if (failure === 'failed') {
    fixture.clearMasterPageFaults();
    await retryFreshnessFromMenu(page);
    await waitForVerifiedDrive(page);
    await expect(commonNameButtons(page)).toHaveCount(COMMON_NAME_TOTAL, { timeout: 20000 });
  }
  expect(fixture.blockedMutations).toEqual([]);
});

test('mobile Pending Requests renders its required rows while unrelated reads are held or failing', {"tag":["@home-role"]}, async ({ page, baseURL }, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, 'Focused native-auth phone and tablet regression');
  const control = await installPendingRequestFixture(page, baseURL!, 'rows');
  try {
    await openPendingRequests(page);
    await expect(page.locator('#request-content')).toContainText('Synthetic pending request Hosta');
    await expect(page.locator('#request-content')).not.toContainText('Load Failed');
    await expectPendingRequestScope(page);
    expect(control.reads.includes('dataset_read:request_queue'),
      'Pending Requests must fetch its own required queue rows').toBe(true);
  } finally {
    control.releaseUnrelatedReads();
  }
  expect(control.fixture.errors).toEqual([]);
  expect(control.fixture.blockedMutations).toEqual([]);
});

test('native mobile search viewport changes settle without browser resize errors', {"tag":["@home-role"]}, async ({ page, baseURL }, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, 'Native mobile viewport regression');
  await page.addInitScript(() => {
    (window as any).__nativeResizeErrors = 0;
    window.addEventListener('error', event => {
      if (/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)\.?$/i.test(event.message || '')) {
        (window as any).__nativeResizeErrors++;
      }
    });
  });
  const fixture = await installColdFixture(page, baseURL!);
  const original = page.viewportSize()!;
  await page.locator('#home-tile-drive').click();
  await waitForVerifiedDrive(page);
  const search = page.locator('#drive-search');
  await search.fill('Rose');
  for (const height of [Math.round(original.height * 0.6), original.height]) {
    await page.setViewportSize({ width: original.width, height });
    await search.focus();
    for (const id of ['global-header-inline-back', 'drive-search-clear']) {
      await expect.poll(() => page.evaluate(value => {
        const button = document.getElementById(value)!;
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return rect.width > 0 && rect.height > 0 && !!hit && (hit === button || button.contains(hit));
      }, id), `${id} must remain unobstructed`).toBe(true);
    }
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  await search.blur();
  await expect(page.locator('#footer-menu-btn')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__nativeResizeErrors)).toBe(0);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('navigation clears a stale draft warning without discarding the retained input value', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  const fixture = await installColdFixture(page, baseURL!);
  await page.locator('#bottom-nav [data-footer-view="docks"]').click();
  await expect(page.locator('#view-docks')).toBeVisible();
  await page.waitForFunction(() => window.eval(`productionLiveSyncVerifiedView
    && productionLiveSyncVerifiedView === productionVerifiedViewKey()
    && getProductionLiveSyncCoordinator().getStatus().state === 'Up to date'
    && !productionLiveSyncRenderPending && !productionLiveSyncActiveRender`), null, { timeout: 10000 });
  await page.evaluate(() => window.eval(`openDockInfoModal('28', '37231')`));
  await expect(page.locator('#dock-info-modal')).toBeVisible();
  await page.evaluate(() => window.eval(`ensureDockTeamStatusLoaded()`));
  await page.locator('#dock-status').selectOption('Palletize');
  fixture.datasetRevision += 1;
  await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().check('draft-warning-navigation')`));
  await expect(page.locator('#live-data-freshness')).toContainText('Edit needs review');
  await expect(page.locator('#live-data-warning-dot')).toBeVisible();
  // The editor overlay intentionally blocks pointer hit-testing. Activate the
  // real footer control's click handler to exercise navigation lifecycle only.
  await page.locator('#bottom-nav [data-footer-view="home"]').evaluate(element => (element as HTMLElement).click());
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#live-data-freshness')).not.toContainText('Edit needs review');
  await expect(page.locator('#live-data-warning-dot')).toBeHidden();
  await expect(page.locator('#dock-status')).toHaveValue('Palletize');
  expect(await page.evaluate(() => window.eval('productionLiveSyncDraftChanged'))).toBe(false);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('mobile Pending Requests exposes required-read failure and recovers through Retry', {"tag":["@home-role"]}, async ({ page, baseURL }, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, 'Focused native-auth phone and tablet regression');
  const control = await installPendingRequestFixture(page, baseURL!, 'failed');
  try {
    await openPendingRequests(page);
    await expect(page.locator('#request-content')).toContainText('Load Failed');
    await retryFreshnessFromMenu(page, () => control.setMode('rows'));
    await expect(page.locator('#request-content')).toContainText('Synthetic pending request Hosta');
    await expectPendingRequestScope(page);
  } finally {
    control.releaseUnrelatedReads();
  }
  expect(control.fixture.errors).toEqual([]);
  expect(control.fixture.blockedMutations).toEqual([]);
});

test('mobile Pending Requests verifies an empty required list without waiting on other datasets', {"tag":["@home-role"]}, async ({ page, baseURL }, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, 'Focused native-auth phone and tablet regression');
  const control = await installPendingRequestFixture(page, baseURL!, 'empty');
  try {
    await openPendingRequests(page);
    await expect(page.locator('#request-content')).toContainText('No pending requests.');
    await expect(page.locator('#request-content')).not.toContainText('Load Failed');
    await expectPendingRequestScope(page);
  } finally {
    control.releaseUnrelatedReads();
  }
  expect(control.fixture.errors).toEqual([]);
  expect(control.fixture.blockedMutations).toEqual([]);
});

test('QC Supervisor Drive cold start verifies inventory and season before searchable cards', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  const reads: string[] = [];
  const fixture = await installColdFixture(page, baseURL!, {
    username: 'dan_mccuistion', role: 'QC Supervisor',
    beforeLogin: async () => {
      await page.route('**/functions/v1/app-api', async route => {
        const body = route.request().postDataJSON() || {};
        if (body.action === 'av_read') reads.push(body.dataset);
        return route.fallback();
      });
      await expect(page.locator('#login-button')).toBeEnabled();
    },
  });
  await page.locator('#home-tile-drive').click();
  expect(await waitForVerifiedDrive(page)).toBeGreaterThan(0);
  expect(reads).toContain('settings');
  expect(reads).not.toContain('reserves');
  await page.locator('#drive-search').fill('Synthetic HL Holly');
  await expect(page.locator('#drive-content').getByRole('button', { name: /^Open / }).first()).toBeVisible();
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('Drive season denial stays recoverable and makes no automatic retry before explicit Retry', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  let denied = true;
  let settingReads = 0;
  const fixture = await installColdFixture(page, baseURL!, {
    username: 'dan_mccuistion', role: 'QC Supervisor',
    beforeLogin: async () => {
      await page.route('**/functions/v1/app-api', async route => {
        const body = route.request().postDataJSON() || {};
        if (body.action !== 'av_read' || body.dataset !== 'settings') return route.fallback();
        settingReads++;
        if (!denied) return route.fallback();
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({
          ok: false, error: 'AV_READ_FORBIDDEN', code: 'AV_READ_FORBIDDEN',
        }) });
      });
      await expect(page.locator('#login-button')).toBeEnabled();
    },
  });
  await installDrivePreparationDiagnostics(page);
  await page.locator('#home-tile-drive').click();
  await expect(page.locator('#drive-content')).toContainText('Drive inventory unavailable');
  const attempts = settingReads;
  expect(attempts).toBeGreaterThan(0);
  await page.evaluate(() => window.eval("signalProductionLiveSync('background-regression-check', 0)"));
  await expect(page.locator('#drive-content').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(settingReads).toBe(attempts);
  expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView === productionVerifiedViewKey()'))).toBe(false);
  denied = false;
  await page.locator('#drive-content').getByRole('button', { name: 'Retry', exact: true }).click();
  expect(await waitForVerifiedDrive(page)).toBeGreaterThan(0);
  expect(settingReads).toBe(attempts + 1);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('Drive verifies cards before unopened reserves and AV-note sources are requested', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
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

for (const view of ['Drive', 'Tasks'] as const) test(`benchmark records three independent cold and repeat ${view} visits`, {"tag":["@home-role"]}, async ({ browser, baseURL }, info) => {
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
          await page.route('**/functions/v1/app-api', async route => {
            const body = route.request().postDataJSON() || {};
            if (!isStrictDatasetRead(body, 'cav')) return route.fallback();
            const { limit, offset } = body.params;
            const allRows = [{ itemcode: 'SYNTH.003', season: 'F1', holdstopreason: '' }];
            const rows = allRows.slice(offset, offset + limit);
            return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': new URL(baseURL!).origin },
              body: JSON.stringify({ ok: true, data: { rows, total: allRows.length, offset, limit, hasMore: offset + rows.length < allRows.length } }) });
          });
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


test('Tasks verifies both AV Blank inputs without waiting for unopened task categories', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  let releaseCav!: () => void, releaseOptional!: () => void;
  const cavGate = new Promise<void>(resolve => { releaseCav = resolve; });
  const optionalGate = new Promise<void>(resolve => { releaseOptional = resolve; });
  let cavReads = 0, optionalReads = 0;
  const fixture = await installColdFixture(page, baseURL!, {
    beforeLogin: async () => {
      const origin = new URL(baseURL!).origin;
      await page.route('**/functions/v1/app-api', async route => {
        const body = route.request().postDataJSON() || {};
        if (!isStrictDatasetRead(body, 'cav')) return route.fallback();
        cavReads++;
        await cavGate;
        const { limit, offset } = body.params;
        const allRows = [{ itemcode: 'SYNTH.003', season: 'F1', holdstopreason: '' }];
        const rows = allRows.slice(offset, offset + limit);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin },
          body: JSON.stringify({ ok: true, data: { rows, total: allRows.length, offset, limit, hasMore: offset + rows.length < allRows.length } }) });
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


test('Drive previews same-permission cache before revisions and keeps it display-only through import and failure', {"tag":["@home-role"]}, async ({ page, baseURL }, testInfo) => {
  const forbiddenMasterReads: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/rest/v1/ph_master_inventory') forbiddenMasterReads.push(request.url());
  });
  const fixture = await installColdFixture(page, baseURL!);
  await page.locator('#home-tile-drive').click(); await waitForVerifiedDrive(page);
  fixture.master[0].last_updated = '2026-09-01T12:00:00.000Z';
  const deltaIds = await page.evaluate(async () => {
    const rows = await window.eval(`fetchAllInventoryReadRows('master_delta', { since: '2026-01-01T00:00:00.000Z' }, { limit: 500 })`);
    return rows.map((row: any) => String(row.unique_id || ''));
  });
  expect(deltaIds).toContain(String(fixture.master[0].unique_id));
  expect(fixture.inventoryReadOperations).toContain('master_delta');
  expect(await page.evaluate(() => window.eval('getProductionLiveSyncContext().dataPermissionVersion'))).toBe('hl-policy-1');
  const reads = fixture.backgroundMasterReads;
  fixture.setDatasetSourceState('ph_master_inventory', 'importing');
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
    await page.evaluate(() => {
      const tile = document.querySelector('#home-tile-drive');
      if (!tile) throw new Error('Drive tile is unavailable');
      (window as any).__cachedDriveFirstCardTiming = { startedAt: 0, firstVisibleAt: 0, observer: null };
      tile.addEventListener('click', () => {
        const timing = (window as any).__cachedDriveFirstCardTiming;
        timing.startedAt = performance.now();
        const capture = () => {
          if (timing.firstVisibleAt) return true;
          const container = document.querySelector('#drive-content');
          const card = container?.querySelector('[role="button"][aria-label^="Open "]');
          if (!container || !card || card.getClientRects().length === 0) return false;
          const style = getComputedStyle(card);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = card.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return false;
          timing.firstVisibleAt = performance.now();
          timing.observer?.disconnect();
          return true;
        };
        const poll = () => { if (!capture()) requestAnimationFrame(poll); };
        timing.observer = new MutationObserver(capture);
        timing.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        requestAnimationFrame(poll);
      }, { once: true, capture: true });
    });
    await page.locator('#home-tile-drive').click(); await seen;
    await expect(page.locator('#drive-content .skeleton')).toHaveCount(0);
    await expect.poll(() => page.locator('#drive-content').getByRole('button', { name: /^Open / }).count()).toBeGreaterThan(0);
    const cachedTiming = await page.evaluate(() => ({
      elapsedMs: Number((window as any).__cachedDriveFirstCardTiming.firstVisibleAt) - Number((window as any).__cachedDriveFirstCardTiming.startedAt)
    }));
    await testInfo.attach('cached-drive-first-card-timing.json', { body: JSON.stringify(cachedTiming, null, 2), contentType: 'application/json' });
    console.log('CACHED_DRIVE_FIRST_CARD_TIMING', JSON.stringify(cachedTiming));
    expect(cachedTiming.elapsedMs, JSON.stringify(cachedTiming)).toBeGreaterThanOrEqual(0);
    expect(cachedTiming.elapsedMs, JSON.stringify(cachedTiming)).toBeLessThanOrEqual(1000);
    await expect(page.locator('#live-data-status-label')).toHaveText('Showing saved data · Checking for updates');
    expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView === productionVerifiedViewKey()'))).toBe(false);
    const blockedExports = await page.evaluate(() => window.eval(`(() => {
      let downloads = 0;
      const previousDownload = downloadExcelWorkbook;
      downloadExcelWorkbook = () => { downloads++; };
      try {
        return {
          results: [exportCurrentDriveModeToExcel(), exportCurrentDriveReportToExcel(), exportCurrentAVToExcel(), exportSalesOfficeOrderFolder('saved-folder')],
          downloads
        };
      } finally { downloadExcelWorkbook = previousDownload; }
    })()`));
    expect(blockedExports.results).toEqual([false, false, false, false]);
    expect(blockedExports.downloads).toBe(0);
    release();
    await expect(page.locator('#live-data-freshness')).toHaveAttribute('data-state', 'Importing');
    expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView === productionVerifiedViewKey()'))).toBe(false);
    expect(fixture.backgroundMasterReads).toBe(reads);
    fixture.setDatasetSourceState('ph_master_inventory', 'ready');
    await page.route('**/functions/v1/app-api', async route => {
      const body = route.request().postDataJSON() || {};
      if (body.action === 'inventory_read' && ['master_page', 'master_delta'].includes(body.operation)) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic refresh failure' }) });
      }
      return route.fallback();
    });
    await page.evaluate(() => window.eval("signalProductionLiveSync('retry-after-import', 0)"));
    await expect(page.locator('#live-data-freshness')).toHaveAttribute('data-state', 'Needs attention');
    await expect(page.locator('#live-data-status-label')).toHaveText('Showing saved data · Needs attention · Retry');
    await expect(page.locator('#drive-content').getByRole('button', { name: /^Open / }).first()).toBeVisible();
    expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView === productionVerifiedViewKey()'))).toBe(false);
    await page.locator('#footer-menu-btn').click();
    await page.locator('#drawer-logout-btn').click();
    await expect(page.locator('#view-login')).toBeVisible();
  } finally { release(); }
  expect(forbiddenMasterReads).toEqual([]);
  expect(fixture.inventoryReadOperations).toContain('master_page');
  expect(fixture.errors).toEqual([]); expect(fixture.blockedMutations).toEqual([]);
});

test('Managers module picker opens without waiting for unrelated live datasets', {"tag":["@home-role"]}, async ({ page, baseURL }, testInfo) => {
  const fixture = await installColdFixture(page, baseURL!);
  await page.evaluate(() => {
    const tile = document.querySelector('#home-tile-managers');
    if (!tile) throw new Error('Managers tile is unavailable');
    (window as any).__managerPickerTiming = { startedAt: 0, firstVisibleAt: 0, observer: null };
    tile.addEventListener('click', () => {
      const timing = (window as any).__managerPickerTiming;
      timing.startedAt = performance.now();
      const capture = () => {
        if (timing.firstVisibleAt) return true;
        const manager = document.querySelector('#view-managers');
        const item = manager?.querySelector('button[aria-label*="Crop Roll:"]');
        if (!manager || !item || manager.classList.contains('hidden')) return false;
        const style = getComputedStyle(item);
        if (style.display === 'none' || style.visibility === 'hidden' || item.getClientRects().length === 0) return false;
        timing.firstVisibleAt = performance.now();
        timing.observer?.disconnect();
        return true;
      };
      const poll = () => { if (!capture()) requestAnimationFrame(poll); };
      timing.observer = new MutationObserver(() => { if (!capture()) requestAnimationFrame(capture); });
      timing.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      requestAnimationFrame(poll);
    }, { once: true, capture: true });
  });
  await page.locator('#home-tile-managers').click();
  await expect(page.locator('#view-managers')).toBeVisible();
  await expect(page.locator('#view-managers').getByRole('button', { name: /Crop Roll:/ }).first()).toBeVisible();
  const evidence = await page.evaluate(() => ({
    elapsedMs: Number((window as any).__managerPickerTiming.firstVisibleAt) - Number((window as any).__managerPickerTiming.startedAt),
    timing: (window as any).__managerPickerTiming,
    adapters: window.eval('getProductionLiveSyncContext().adapters.map(adapter => adapter.id)'),
    revisionReads: Number(window.eval('getProductionLiveSyncCoordinator().getStatistics().revisionReads')) || 0
  }));
  await testInfo.attach('manager-picker-timing.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  console.log('MANAGER_PICKER_TIMING', JSON.stringify(evidence.timing));
  expect(evidence.elapsedMs, JSON.stringify(evidence.timing)).toBeGreaterThanOrEqual(0);
  expect(evidence.elapsedMs).toBeLessThanOrEqual(250);
  expect(evidence.adapters).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});


test('native session recovery is shared by module reads and never calls the legacy database proxy', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  const fixture = await installColdFixture(page, baseURL!);
  let release!: () => void, refreshes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/auth/v1/token?grant_type=refresh_token', async route => {
    refreshes++; await gate; await route.fallback();
  });
  await page.evaluate(() => {
    const client = window.eval('getSupabaseBrowserClient()');
    (window as any).__originalGetSession = client.auth.getSession.bind(client.auth);
    client.auth.getSession = async () => ({ data: { session: null }, error: null });
  });
  try {
    await page.locator('#home-tile-drive').click();
    await expect.poll(() => refreshes).toBe(1);
    expect(fixture.blockedMutations).toEqual([]);
    await expect(page.locator('#drive-content')).not.toContainText('Native Auth sessions must use PostgREST');
    await page.evaluate(() => { window.eval('getSupabaseBrowserClient()').auth.getSession = (window as any).__originalGetSession; });
    release(); await waitForVerifiedDrive(page);
    expect(refreshes).toBe(1);
    expect(fixture.blockedMutations).toEqual([]);
  } finally { release(); }
  expect(fixture.errors).toEqual([]);
});

test('failed native session recovery shows recovery guidance without a legacy database request', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  const fixture = await installColdFixture(page, baseURL!);
  await page.evaluate(() => {
    const client = window.eval('getSupabaseBrowserClient()');
    client.auth.getSession = async () => ({ data: { session: null }, error: null });
    client.auth.refreshSession = async () => ({ data: { session: null }, error: new Error('Expired synthetic session') });
  });
  await page.locator('#home-tile-drive').click();
  await expect(page.locator('#drive-content')).toContainText(/session.*(restored|required)/i);
  expect(fixture.blockedMutations).toEqual([]);
});

test('HL and PO show permission-matched saved listings before refresh, with current actions gated', {"tag":["@home-role"]}, async ({ page, baseURL }) => {
  const fixture = await installColdFixture(page, baseURL!, {
    username: 'dylan_collyge',
    poRows: [poManagementRow({ row_index: 1, itemcode: 'CACHE.PO', commonname: 'Saved PO listing', contsize: '#3', locationcode: 'C.12.001', lotcode: '27.F1' })]
  });
  await page.locator('#home-tile-hl-order').click();
  await expect(page.locator('[data-hl-group]')).toBeVisible();
  await page.waitForFunction(() => window.eval('productionLiveSyncVerifiedView === productionVerifiedViewKey()'));
  await page.locator('#global-header-inline-back').click();
  await page.getByRole('button', { name: 'Open Inventory', exact: true }).click();
  await page.locator('#inventory-open-po-management').click();
  await page.locator('#po-management-hub-grid').getByRole('button', { name: /HL PO/ }).click();
  await page.locator('#po-management-season-grid').getByRole('button', { name: /27F1/ }).click();
  await expect(page.locator('#po-management-content tbody')).toContainText('Saved PO listing');
  await page.waitForFunction(() => window.eval('productionLiveSyncVerifiedView === productionVerifiedViewKey()'));
  await page.locator('#bottom-nav [data-footer-view="home"]').evaluate(element => (element as HTMLElement).click());
  await expect(page.locator('#view-home')).toBeVisible();

  let releaseMetadata!: () => void;
  const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; });
  await page.route(/\/rest\/v1\/rpc\/get_my_dataset_revisions_v1(?:\?|$)/, async route => {
    await metadataGate;
    try { await route.fallback(); } catch { /* Navigation may cancel the held request. */ }
  });
  try {
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('#view-home')).toBeVisible();
    await page.locator('#home-tile-hl-order').click();
    await expect(page.locator('[data-hl-group]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-hl-group] button').first()).toBeDisabled();
    await expect(page.locator('#live-data-status-label')).toHaveText('Showing saved data · Checking for updates');
    await expect(page.locator('#live-data-status-time')).toContainText('Saved verification:');
    expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView'))).toBe('');

    await page.locator('#global-header-inline-back').click();
    await page.getByRole('button', { name: 'Open Inventory', exact: true }).click();
    await page.locator('#inventory-open-po-management').click();
    await page.locator('#po-management-hub-grid').getByRole('button', { name: /HL PO/ }).click();
    await page.locator('#po-management-season-grid').getByRole('button', { name: /27F1/ }).click();
    await expect(page.locator('#po-management-content tbody')).toContainText('Saved PO listing', { timeout: 10000 });
    await expect(page.locator('#po-management-content')).not.toContainText('View inventory');
    await expect(page.locator('#live-data-status-label')).toHaveText('Showing saved data · Checking for updates');
    expect(await page.evaluate(() => window.eval('productionLiveSyncVerifiedView'))).toBe('');
  } finally {
    releaseMetadata();
  }
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});


test('progressive loader reference timing uses three cold sessions and repeat visits', {"tag":["@home-role"]}, async ({ browser, baseURL }, info) => {
  test.skip(process.env.PROGRESSIVE_LOADING_BENCHMARK !== '1', 'Timing runs are isolated from functional browser work');
  test.setTimeout(240000);
  const samples: any[] = [];
  for (let trial = 0; trial < 3; trial++) {
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
    const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, serviceWorkers: 'block' });
    const page = await context.newPage();
    let requests = 0, bytes = 0;
    const responses: Promise<void>[] = [];
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/rest/v1/')) {
        requests++;
        responses.push(response.body().then(body => { bytes += body.length; }).catch(() => {}));
      }
    });
    const started = Date.now(), sample: any = { trial };
    try {
      const fixture = await installColdFixture(page, baseURL!, { master: commonNameMasterRows(),
        historicalReferenceVersion: process.env.PROGRESSIVE_LOADING_HISTORICAL === '1' ? 'V2026.08.24.01' : null });
      sample.loginMs = Date.now() - started;
      sample.release = await page.evaluate(() => window.eval('APP_SHELL_VERSION'));
      sample.paintTimings = await page.evaluate(() => Object.fromEntries(
        performance.getEntriesByType('paint').map(entry => [entry.name, Math.round(entry.startTime * 10) / 10])
      ));
      sample.firstPaintMs = sample.paintTimings['first-paint'] ?? null;
      sample.firstContentfulPaintMs = sample.paintTimings['first-contentful-paint'] ?? null;
      const navigate = async () => {
        const begin = Date.now(), reads = fixture.backgroundMasterReads, requestsBefore = requests, bytesBefore = bytes;
        await page.locator('#home-tile-drive').click();
        await expect.poll(() => commonNameButtons(page).count(), { timeout: 20000 }).toBeGreaterThan(0);
        const firstMs = Date.now() - begin;
        await expect(commonNameButtons(page)).toHaveCount(COMMON_NAME_TOTAL, { timeout: 20000 });
        await page.waitForFunction(() => window.eval('typeof productionLiveSyncVerifiedView === "undefined" ? getDatasetState("master").fullLoaded : productionLiveSyncVerifiedView === productionVerifiedViewKey()'), null, { timeout: 20000 });
        await Promise.all(responses.splice(0));
        return { firstMs, completeMs: Date.now() - begin, inventoryReads: fixture.backgroundMasterReads - reads,
          requests: requests - requestsBefore, bytes: bytes - bytesBefore };
      };
      sample.cold = await navigate();
      sample.sessionCompleteMs = Date.now() - started;
      await page.locator('#global-header-inline-back').click();
      await expect(page.locator('#view-home')).toBeVisible();
      sample.repeat = await navigate();
      if (process.env.PROGRESSIVE_LOADING_BASELINE !== '1') expect(sample.repeat.inventoryReads).toBe(0);
      sample.prohibitedReads = fixture.blockedMutations.filter(value => value.startsWith('PROHIBITED_NATIVE_DB'));
      sample.totalRequests = requests; sample.totalBytes = bytes;
    } catch (error) {
      sample.failure = String(error).split('\n')[0];
      if (process.env.PROGRESSIVE_LOADING_BASELINE !== '1') throw error;
    } finally { samples.push(sample); await context.close(); }
  }
  await info.attach('progressive-reference-timing.json', { body: JSON.stringify({ profile: info.project.name, samples }, null, 2), contentType: 'application/json' });
  console.log('PROGRESSIVE_REFERENCE_TIMING', JSON.stringify({ profile: info.project.name, samples }));
});
