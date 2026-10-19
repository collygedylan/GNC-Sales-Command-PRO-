import { expect, test, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';

// @test-group: @av-live-hydration
// The ignored snapshot contains sanitized production-shaped rows only. The app
// and its full projection/pagination validator remain the code under test.
type LiveAvSnapshot = {
  generatedAt: string;
  fixtureSource: string;
  identity: { username: 'brian_hatfield'; role: 'REP'; salesRepId?: string };
  master: { rows: Array<Record<string, unknown>>; total: number; projection: string; fieldCoverage: string; columns: string[] };
  reserves: { rows: Array<Record<string, unknown>>; total: number };
  expected: { currentSeason: 'F1'; salesYear: 27; visibleRowCount: 3236; visibleItemcodeCount: 1981 };
};

type PageRead = {
  operation: string;
  dataset: string;
  offset: number;
  limit: number;
  projection: string;
  responseStatus?: number;
  responseRows?: number;
  responseTotal?: number;
  responseProjection?: string;
  responseFieldCoverage?: string;
  error?: string;
};

function makeDeterministicSnapshot(): LiveAvSnapshot {
  const itemcode = (index: number) => `${String(100000 + Math.floor(index / 10)).padStart(6, '0')}.${String(index % 10).padStart(3, '0')}.1`;
  const masterRows: Array<Record<string, unknown>> = [];
  const addRow = (index: number, codeIndex: number, inSeason: boolean, positive: boolean) => {
    const code = itemcode(codeIndex);
    const locationOrdinal = Math.floor(index / 100) % 1000;
    masterRows.push({
      unique_id: `${code.replaceAll('.', '_')}-${inSeason ? '27_F1' : '27_S1'}-L${String(index).padStart(5, '0')}`,
      itemcode: code, commonname: `Fixture Inventory ${codeIndex}`, contsize: '#1',
      locationcode: `E.${String(locationOrdinal % 100).padStart(2, '0')}.${String(index % 1000).padStart(3, '0')}`,
      lotcode: inSeason ? '27.F1' : '27.S1', season: inSeason ? 'F1' : 'S1',
      saleyear: inSeason ? '2026' : '2027', s_lts: positive ? '10' : '0', ptravailable: '0',
      desigitem: null, holdstopcode: null, app_tab_assignment: null, priority: '5',
    });
  };
  for (let index = 0; index < 3_147; index++) addRow(index, index % 1_909, true, true);
  for (let index = 0; index < 303; index++) {
    const codeIndex = index < 17 ? index : index < 89 ? 1_909 + index - 17 : 1_981 + ((index - 89) % 160);
    addRow(3_147 + index, codeIndex, true, false);
  }
  for (let index = 0; index < 6_051; index++) addRow(3_450 + index, 3_000 + index, false, index % 2 === 0);
  const reserveCodes = new Set<number>();
  for (let index = 0; index < 17; index++) reserveCodes.add(index);
  for (let index = 1_909; index < 1_981; index++) reserveCodes.add(index);
  for (let index = 4_000; reserveCodes.size < 613; index++) reserveCodes.add(index);
  const reserveRows: Array<Record<string, unknown>> = [...reserveCodes].map(code => ({ itemcode: itemcode(code), salesrepid: 'S19', salesrepname: 'Hatfield, Brian' }));
  for (let index = 0; reserveRows.length < 702; index++) reserveRows.push({ ...reserveRows[index % 613] });
  return {
    generatedAt: 'deterministic-fixture', fixtureSource: 'generated-sanitized-9501-row-contract',
    identity: { username: 'brian_hatfield', role: 'REP', salesRepId: 'S19' },
    master: { rows: masterRows, total: 9_501, projection: 'sanitized_full_source_fixture', fieldCoverage: 'minimal-safe', columns: Object.keys(masterRows[0]) },
    reserves: { rows: reserveRows, total: 702 },
    expected: { currentSeason: 'F1', salesYear: 27, visibleRowCount: 3_236, visibleItemcodeCount: 1_981 },
  };
}

async function readSnapshot(): Promise<LiveAvSnapshot> {
  const path = resolve(process.env.AV_LIVE_SNAPSHOT || '.gnc-local/v237-live-av-snapshot.json');
  const value = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) as LiveAvSnapshot : makeDeterministicSnapshot();
  if (value.identity?.username !== 'brian_hatfield' || value.identity?.role !== 'REP'
    || !Array.isArray(value.master?.rows) || value.master.rows.length !== 9_501
    || !Array.isArray(value.reserves?.rows) || value.expected?.visibleRowCount !== 3_236
    || value.expected?.visibleItemcodeCount !== 1_981) {
    throw new Error('The sanitized AV live snapshot does not match its versioned fixture contract.');
  }
  if (!value.fixtureSource) value.fixtureSource = 'sanitized-production-snapshot';
  return value;
}

async function pageState(page: Page) {
  return page.evaluate(() => {
    const state = window.eval(`(() => {
    const coordinator = getProductionLiveSyncCoordinator?.();
    const status = coordinator?.getStatus?.() || null;
    const safeState = (key) => {
      const state = getDatasetState(key) || {};
      return { initialLoaded: !!state.initialLoaded, fullLoaded: !!state.fullLoaded,
        rowCompleteness: String(state.rowCompleteness || ''), fieldCoverage: String(state.fieldCoverage || ''),
        liveVerifiedScope: !!state.liveVerifiedScope, liveVerifiedRevision: String(state.liveVerifiedRevision || '') };
    };
    const identity = getAvSalesDerivationIdentity();
    const resolved = avResolvedBaseStateCache || null;
    const resolvedItems = Array.isArray(resolved?.items) ? resolved.items : [];
    const derivedMetric = window.AgMetricAvDerivedRows?.peek?.(identity.key, identity.scope) || null;
    const activeRender = productionLiveSyncActiveRender || null;
    return { masterRows: Array.isArray(fullInventory) ? fullInventory.length : -1,
      reserveRows: Array.isArray(reservesInventory) ? reservesInventory.length : -1,
      master: safeState('master'), reserves: safeState('reserves'),
      avOpen: safeState('avOpen'),
      status: status && { state: status.state, message: status.message, lastVerifiedAt: status.lastVerifiedAt,
        adapters: status.adapters, errors: status.errors },
      freshness: document.getElementById('live-data-freshness')?.getAttribute('data-state') || '',
      freshnessText: document.getElementById('live-data-freshness')?.textContent || '',
      currentBucket: String(activeAvSalesBucket || ''),
      avOpenRows: Array.isArray(avOpenInventory) ? avOpenInventory.length : -1,
      selectedSourceRows: selectAvSalesInventorySourceRows().length,
      sourceRowsWithoutSalesWindow: getAvSalesInventorySourceRows({ skipSalesWindow: true }).length,
      identity: { sourceKey: identity.sourceKey, signature: identity.signature, key: identity.key, scope: identity.scope },
      derivedPendingSignature: avDerivedRowsPendingSignature,
      derivedMetric: derivedMetric && { rowCount: derivedMetric.rows?.length ?? -1, sourceKey: derivedMetric.sourceKey || '' },
      resolvedBase: { itemCount: resolvedItems.length, isPartial: !!resolved?.isPartial, cacheKey: avResolvedBaseStateKey },
      renderPending: !!productionLiveSyncRenderPending,
      activeRender: activeRender && { view: activeRender.view, generation: activeRender.generation, token: activeRender.token, pending: activeRender.pending },
      latestAvRenderToken: Number(latestViewRenderTokensByView.av || 0),
      avRenderChunkToken: Number(avRenderChunkToken || 0),
      activeElementId: String(document.activeElement?.id || ''),
      activeElementTag: String(document.activeElement?.tagName || ''),
      activeElementRects: document.activeElement?.getClientRects?.().length || 0,
      currentRows: resolvedItems.length,
      uniqueCurrentItemcodes: new Set(resolvedItems.map(row => String(row.ITEMCODE || row.itemcode || '').trim().toUpperCase()).filter(Boolean)).size,
      crumb: document.getElementById('av-crumb')?.textContent || '',
      exportLabel: document.getElementById('av-export-btn-label')?.textContent || '',
      exportDisabled: !!document.getElementById('av-export-btn')?.hasAttribute('disabled'),
      exportCount: getAVVisibleExportCount(resolvedItems),
      visibleCardCount: document.querySelectorAll('#av-content .app-smart-card--inventory[data-dom-id]').length,
      browseFooter: document.querySelector('#av-content .browse-page-footer span')?.textContent || '',
      chunkRenderDurations: window.__gncPerfStats?.chunkRenderDurations || null,
      renderCounters: Object.fromEntries(Object.entries(window.__gncPerfStats || {}).filter(([key, value]) => /Chunk|chunk|Render|render/.test(key) && typeof value === 'number')),
      displayGroups: Array.from(productionDisplayGroups || []) };
  })()`);
    return state;
  });
}

async function hydrationReadiness(page: Page) {
  return page.evaluate(() => window.eval(`(() => {
    const status = getProductionLiveSyncCoordinator?.().getStatus?.() || null;
    return { masterRows: Array.isArray(fullInventory) ? fullInventory.length : -1,
      masterFull: !!getDatasetState('master')?.fullLoaded,
      reservesFull: !!getDatasetState('reserves')?.fullLoaded,
      state: String(status?.state || '') };
  })()`));
}

async function preparedCurrentRows(page: Page) {
  return page.evaluate(() => window.eval(`(() => {
    const resolved = getCurrentAVBaseItems({ usePreparedSalesRows: true });
    const safeRows = Array.isArray(resolved?.items) ? resolved.items : [];
    return { rowCount: safeRows.length,
      uniqueItemcodes: new Set(safeRows.map(row => String(row.ITEMCODE || row.itemcode || '').trim().toUpperCase()).filter(Boolean)).size,
      exportCount: getAVVisibleExportCount(safeRows) };
  })()`));
}

test('Brian REP cold AV hydration publishes the complete F1 through sales year 27 cohort', { tag: ['@av-live-hydration', '@local-e2e'] }, async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await readSnapshot();
  const pageErrors: string[] = [];
  const failedRequests: Array<{ url: string; error: string }> = [];
  const inventoryPages: PageRead[] = [];
  const lifecycle: Array<{ event: string; atMs: number; url?: string }> = [];
  const documentNavigations: Array<{ event: string; atMs: number; path: string; hash: string;
    shellVersion: string; shellRecovery: string; status?: number }> = [];
  const fixtureApiTraffic: Array<{ path: string; method: string; action?: string; operation?: string; dataset?: string;
    authorizationPresent: boolean; status?: number }> = [];
  let fullRenderFirstCardMs: number | null = null;
  let fullPageDomReadyMs: number | null = null;
  const pageByRequest = new Map<Request, PageRead>();
  const responseTasks: Promise<void>[] = [];
  const hydrationStarted = Date.now();
  const recordLifecycle = (event: string, url?: string) => lifecycle.push({ event, atMs: Date.now() - hydrationStarted, url });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const url = new URL(frame.url());
    recordLifecycle('main-frame-navigation', `${url.pathname}${url.hash}`);
  });
  page.on('request', request => {
    if (!request.isNavigationRequest() || request.resourceType() !== 'document') return;
    const url = new URL(request.url());
    documentNavigations.push({ event: 'request', atMs: Date.now() - hydrationStarted,
      path: url.pathname, hash: url.hash,
      shellVersion: url.searchParams.get('shellv') || '', shellRecovery: url.searchParams.get('shellrecover') || '' });
  });
  page.on('response', response => {
    const request = response.request();
    if (!request.isNavigationRequest() || request.resourceType() !== 'document') return;
    const url = new URL(response.url());
    const entry = documentNavigations.findLast(item => item.path === url.pathname && item.hash === url.hash && item.status === undefined);
    if (entry) { entry.status = response.status(); entry.event = 'response'; }
  });
  page.on('domcontentloaded', () => recordLifecycle('domcontentloaded'));
  page.on('load', () => recordLifecycle('load'));
  page.on('close', () => recordLifecycle('close'));
  page.on('crash', () => recordLifecycle('crash'));
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));
  page.on('request', request => {
    if (request.url().includes('/functions/v1/')) {
      const url = new URL(request.url());
      const entry: (typeof fixtureApiTraffic)[number] = {
        path: url.pathname, method: request.method(), authorizationPresent: Boolean(request.headers()['authorization']),
      };
      try {
        const body = request.postDataJSON() as { action?: string; operation?: string; dataset?: string; params?: Record<string, unknown> };
        entry.action = String(body.action || '');
        entry.operation = String(body.operation || '');
        entry.dataset = String(body.dataset || body.params?.dataset || '');
      } catch { /* Some preflight or non-JSON requests have no request body. */ }
      fixtureApiTraffic.push(entry);
    }
    if (!request.url().includes('/functions/v1/app-api') || request.method() !== 'POST') return;
    try {
      const body = request.postDataJSON() as { action?: string; operation?: string; params?: Record<string, unknown> };
      if (body.action !== 'inventory_read' || body.operation !== 'master_page') return;
      const params = body.params || {};
      const entry = { operation: String(body.operation), dataset: String(params.dataset || ''),
        offset: Number(params.offset || 0), limit: Number(params.limit || 0), projection: String(params.projection || '') };
      inventoryPages.push(entry);
      pageByRequest.set(request, entry);
    } catch { /* Non-JSON POST bodies are not inventory pages. */ }
  });
  page.on('response', response => {
    const traffic = fixtureApiTraffic.findLast(entry => entry.path === new URL(response.url()).pathname
      && entry.method === response.request().method() && entry.status === undefined);
    if (traffic) traffic.status = response.status();
    if (!response.url().includes('/functions/v1/app-api')) return;
    const entry = pageByRequest.get(response.request());
    if (!entry) return;
    entry.responseStatus = response.status();
    responseTasks.push((async () => {
      try {
        const body = await response.json() as { data?: { total?: number; rows?: unknown[]; projection?: string; fieldCoverage?: string }; error?: string };
        const data = body.data;
        entry.responseRows = Array.isArray(data?.rows) ? data.rows.length : 0;
        entry.responseTotal = Number(data?.total ?? -1);
        entry.responseProjection = String(data?.projection || '');
        entry.responseFieldCoverage = String(data?.fieldCoverage || '');
        entry.error = String(body.error || '');
      } catch (error) { entry.error = String(error); }
    })());
  });

  let fixtureControl: Awaited<ReturnType<typeof installHlOrderFixture>> | null = null;
  let continuationHeld = false;
  try {
    fixtureControl = await installHlOrderFixture(page, baseURL!, {
      username: fixture.identity.username,
      role: fixture.identity.role,
      startupMode: 'cold',
      master: fixture.master.rows,
      reserveRows: fixture.reserves.rows.map(row => ({ salesrepname: 'Brian Hatfield', ...row })),
    });
    fixtureControl.holdNextMasterLaterPage();
    await page.evaluate(() => (window as any).switchView('av'));
    await expect(page.locator('#view-av')).toBeVisible();
    await fixtureControl.waitForHeldMasterLaterPage();
    continuationHeld = true;
    const orderedRows = fixture.master.rows.slice().sort((left, right) => String(left.unique_id || '').localeCompare(String(right.unique_id || '')));
    const expectedPreviewRows = orderedRows.slice(0, 16).filter(row => String(row.season || '').toUpperCase() === 'F1'
      && Number(String(row.saleyear || '').slice(-2)) <= 27 && Number(row.s_lts || 0) > 0).length;
    let readyPartialPreview: Awaited<ReturnType<typeof pageState>> | null = null;
    await expect.poll(async () => {
      const preview = await pageState(page);
      const ready = preview.currentRows === expectedPreviewRows && preview.exportDisabled && /Loading full inventory/i.test(preview.crumb);
      if (ready) readyPartialPreview = preview;
      return ready;
    }, { timeout: 15_000, intervals: [50, 100, 200] }).toBe(true);
    const partial = readyPartialPreview;
    if (!partial) throw new Error('AV partial preview did not reach its verified state.');
    expect(partial.master.fullLoaded).toBe(false);
    expect(partial.currentRows).toBe(expectedPreviewRows);
    expect(partial.exportDisabled).toBe(true);
    expect(partial.crumb).toMatch(/Loading full inventory/i);
    fixtureControl.releaseHeldMasterLaterPage();
    continuationHeld = false;

    await expect.poll(async () => {
      const state = await hydrationReadiness(page);
      return state.masterRows === fixture.master.total && state.masterFull
        && state.reservesFull && state.state === 'Up to date';
    }, { timeout: 90_000, intervals: [200, 500, 1_000] }).toBe(true);

    const uiConvergenceStarted = Date.now();
    await expect(page.locator('#av-crumb')).toContainText(`Current Season (${fixture.expected.visibleRowCount} items)`, { timeout: 60_000 });
    await expect(page.locator('#av-export-btn')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#av-export-btn-label')).toContainText(`(${fixture.expected.visibleRowCount})`, { timeout: 60_000 });

    await expect.poll(async () => {
      const renderedPage = await page.locator('#av-content').evaluate(container => ({
        cardCount: container.querySelectorAll('.app-smart-card--inventory[data-dom-id]').length,
        footer: container.querySelector('.browse-page-footer span')?.textContent || '',
      }));
      const fullPageReady = renderedPage.footer.replaceAll(',', '').includes(`of ${fixture.expected.visibleRowCount}`)
        && renderedPage.cardCount === 100;
      if (fullRenderFirstCardMs === null && renderedPage.cardCount > expectedPreviewRows) {
        fullRenderFirstCardMs = Date.now() - uiConvergenceStarted;
      }
      if (fullPageReady && fullPageDomReadyMs === null) fullPageDomReadyMs = Date.now() - uiConvergenceStarted;
      return fullPageReady;
    }, { timeout: 45_000, intervals: [100, 250, 500] }).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const fullCohortUiReadyMs = Date.now() - uiConvergenceStarted;

    await Promise.all(responseTasks);
    const state = await pageState(page);
    const preparedRows = await preparedCurrentRows(page);
    expect(state.masterRows).toBe(fixture.master.total);
    expect(state.reserveRows).toBe(fixture.reserves.rows.length);
    expect(state.master).toMatchObject({ fullLoaded: true, rowCompleteness: 'complete', fieldCoverage: 'full' });
    expect(state.reserves.fullLoaded).toBe(true);
    expect(state.status?.state).toBe('Up to date');
    expect(state.freshness).toBe('Up to date');
    expect(state.freshnessText).not.toMatch(/awaiting first sync/i);
    expect(preparedRows.rowCount).toBe(fixture.expected.visibleRowCount);
    expect(preparedRows.uniqueItemcodes).toBe(fixture.expected.visibleItemcodeCount);
    expect(state.visibleCardCount).toBeGreaterThan(0);
    expect(state.visibleCardCount).toBeLessThanOrEqual(100);
    expect(state.browseFooter.replaceAll(',', '')).toContain(`Rows 1–100 of ${fixture.expected.visibleRowCount}`);
    expect(preparedRows.exportCount).toBe(fixture.expected.visibleRowCount);
    await expect(page.locator('#av-crumb')).toContainText(`Current Season (${fixture.expected.visibleRowCount} items)`);
    await expect(page.locator('#av-export-btn-label')).toContainText(`(${fixture.expected.visibleRowCount})`);
    expect(fullCohortUiReadyMs).toBeLessThanOrEqual(1_500);

    const pageOffsets = inventoryPages.filter(pageRead => pageRead.dataset === 'master')
      .map(pageRead => pageRead.offset);
    expect(pageOffsets.length).toBeGreaterThan(1);
    expect(pageOffsets[0]).toBe(0);
    expect(pageOffsets).toContain(16);
    expect(Math.max(...pageOffsets)).toBeGreaterThan(8_000);
    const masterPageRequests = inventoryPages.filter(pageRead => pageRead.dataset === 'master');
    expect(masterPageRequests.filter(pageRead => pageRead.projection === 'browse')).toEqual([]);
    expect(new Set(pageOffsets).size).toBe(pageOffsets.length);
    expect(inventoryPages.filter(pageRead => pageRead.dataset === 'master' && pageRead.projection === 'full')
      .every(pageRead => pageRead.responseStatus === 200 && pageRead.responseProjection === 'full'
        && pageRead.responseFieldCoverage === 'full')).toBe(true);
    expect(fixtureControl?.blockedMutations).toEqual([]);
    expect(pageErrors).toEqual([]);
    console.log('AV_LIVE_HYDRATION_METRICS', JSON.stringify({ fixtureGeneratedAt: fixture.generatedAt,
      masterRows: state.masterRows, reserveRows: state.reserveRows, currentRows: preparedRows.rowCount,
      uniqueItemcodes: preparedRows.uniqueItemcodes, renderedFirstPageCards: state.visibleCardCount,
      pageOffsets, fullHydrationElapsedMs: Date.now() - hydrationStarted,
      fullCohortUiReadyMs,
      fullRenderFirstCardMs, fullPageDomReadyMs,
      browser: testInfo.project.name, fixtureSource: fixture.fixtureSource,
      masterPageProjections: masterPageRequests.map(pageRead => ({ offset: pageRead.offset, projection: pageRead.projection })) }));
  } catch (error) {
    if (continuationHeld) fixtureControl?.releaseHeldMasterLaterPage();
    const diagnostic = {
      failure: String(error), pageErrors, failedRequests, inventoryPages,
      lifecycle, documentNavigations, fixtureApiTraffic,
      fullRenderFirstCardMs, fullPageDomReadyMs,
      pageState: await pageState(page).catch(stateError => ({ error: String(stateError) })),
      safeAuthState: await page.evaluate(() => {
        const safeParse = (key: string): Record<string, unknown> | null => {
          try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value && typeof value === 'object' ? value : null; }
          catch { return null; }
        };
        const session = safeParse('gnc_supabase_auth_v1');
        const nativeProfile = safeParse('gnc_native_auth_profile_v1');
        const authToken = typeof session?.access_token === 'string' ? session.access_token : '';
        const nativeState = (window as unknown as { nativeAuthProfile?: { username?: string; role?: string } }).nativeAuthProfile;
        return {
          urlPath: location.pathname,
          localStorageKeys: Object.keys(localStorage).filter(key => key.startsWith('gnc_')).sort(),
          username: localStorage.getItem('gnc_user_v3') || '',
          role: localStorage.getItem('gnc_role_v3') || '',
          sessionPresent: !!session,
          accessTokenPresent: !!authToken,
          accessTokenLength: authToken.length,
          sessionExpiresAt: Number(session?.expires_at || 0),
          sessionUserPresent: !!session?.user,
          nativeProfilePresent: !!nativeProfile,
          nativeProfileUsername: String(nativeProfile?.username || ''),
          nativeProfileRole: String(nativeProfile?.role || ''),
          runtimeNativeProfileUsername: String(nativeState?.username || ''),
          runtimeNativeProfileRole: String(nativeState?.role || ''),
          loginVisible: !!document.querySelector('#view-login')?.getClientRects().length,
          homeVisible: !!document.querySelector('#view-home')?.getClientRects().length,
          avVisible: !!document.querySelector('#view-av')?.getClientRects().length,
        };
      }).catch(authError => ({ error: String(authError) })),
      fixtureState: fixtureControl && {
        authTokenRequests: fixtureControl.authTokenRequests,
        appAccessReads: fixtureControl.appAccessReads,
        runtimeRequests: fixtureControl.runtimeRequests,
        runtimeResponses: fixtureControl.runtime,
        backgroundMasterReads: fixtureControl.backgroundMasterReads,
        masterLaterPageReads: fixtureControl.masterLaterPageReads,
        shellDiagnostics: fixtureControl.shellDiagnostics,
        errors: fixtureControl.errors,
        blockedMutations: fixtureControl.blockedMutations,
      },
      capturedAt: new Date().toISOString(), fixtureGeneratedAt: fixture.generatedAt,
    };
    const path = testInfo.outputPath('av-live-hydration-failure.json');
    await writeFile(path, JSON.stringify(diagnostic, null, 2));
    await testInfo.attach('av-live-hydration-failure.json', { path, contentType: 'application/json' });
    console.log('AV_LIVE_HYDRATION_FAILURE', JSON.stringify(diagnostic));
    throw error;
  }
});
