import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

type FixtureRow = Record<string, string | number>;
type SuspendSmokeInfo = TestInfo;
type SuspendSmokeHarness = { readBootstrapDiagnostic: () => Promise<unknown> };

export async function installSuspendProfile(page: Page) {
  if (process.env.V2314_PROFILE !== '1') return;
  await page.addInitScript(`(() => {
    const target = window;
    for (const type of ['requestAnimationFrame', 'setTimeout']) {
      const original = window[type].bind(window);
      const instrument = (callback, ...args) => {
        if (typeof callback !== 'function') return original(callback, ...args);
        return original((...values) => {
          const start = performance.now();
          try { return callback(...values); }
          finally { if (target.__v2314TimingPhase === 'frame') (target.__v2314Scheduled ||= []).push({ type, label: callback.toString().slice(0, 180), ms: performance.now()-start }); }
        }, ...args);
      };
      Object.assign(window, { [type]: instrument });
    }
  })()`);
}

function nextSuspendFrame(page: Page) {
  return page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

export async function settleSuspendSmoke(page: Page, app: SuspendSmokeHarness, info: SuspendSmokeInfo) {
  // Finish the existing initial cohort before sampling settled source parity;
  // a count observed during first hydration can be replaced by its next stage.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.eval(`(async () => {
    let timer;
    try { return await Promise.race([getProductionLiveSyncCoordinator().check('visible-view'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Initial authenticated Suspend cohort did not settle')), 30000); })]); }
    finally { clearTimeout(timer); }
  })()`)).catch(async error => {
    await info.attach('release-smoke-initial-cohort-diagnostic', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify(await app.readBootstrapDiagnostic())) });
    throw error;
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForLoadState('networkidle');
}

export async function assertInitialSuspendParity(page: Page, cards: Locator, expectedSourceIds: string[], app: SuspendSmokeHarness, info: SuspendSmokeInfo) {
  await expect(cards).toHaveCount(37, { timeout: 15000 }).catch(async error => {
    await info.attach('release-smoke-initial-suspend-diagnostic', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify(await app.readBootstrapDiagnostic())) });
    throw error;
  });
  const expectedCardIds = expectedSourceIds.map(id => `dock_suspend_dc_${id}`).sort();
  let priorCardIds: string[] = [];
  let stableCardFrames = 0;
  let actualCardIds: string[] = [];
  for (let attempt = 0; attempt < 40 && stableCardFrames < 2; attempt++) {
    actualCardIds = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-request-uid') || '').sort());
    stableCardFrames = JSON.stringify(actualCardIds) === JSON.stringify(priorCardIds) ? stableCardFrames + 1 : 0;
    priorCardIds = actualCardIds;
    if (stableCardFrames < 2) await nextSuspendFrame(page);
  }
  const uidParity = {
    expectedSourceIds,
    expectedCount: expectedCardIds.length, actualCount: actualCardIds.length,
    actualIds: actualCardIds, missingIds: expectedCardIds.filter(id => !actualCardIds.includes(id)),
    unexpectedIds: actualCardIds.filter(id => !expectedCardIds.includes(id)), stableConsecutiveFrames: stableCardFrames,
  };
  await info.attach('latest-suspend-source-uid-parity', { contentType: 'application/json', body: Buffer.from(JSON.stringify(uidParity)) });
  expect(expectedSourceIds, 'the captured latest SOC file must contain 37 marked physical DC source rows').toHaveLength(37);
  expect(uidParity.stableConsecutiveFrames, 'the complete source UID list must stabilize for two animation frames').toBeGreaterThanOrEqual(2);
  expect(uidParity.actualIds).toEqual(expectedCardIds);
  await expect(cards).toHaveCount(37);
}

const suspendProfileSetup = `(() => {
    window.__v2314Profile = {};
    for (const name of ['renderRequest','getScopedRequestItems','getRequestTabQueueCounts','buildSuspendTagRenderPlan',
      'generateCard','buildDockSuspendDcRequestCardDisplayItem','getQueueCardInventoryState','getMasterInventoryExactKey',
      'getLatestSocSuspendTagSourceRows','getDockSuspendDcRequestMirrorRows','decorateRequestRows','renderMarkupChunkedByKey',
      'getCardLocationOnHandValue','syncMasterFieldsToRequestRow','findMasterInventoryItem','findMasterInventoryExactRow',
      'findDockSuspendDcRequestSourceRow','getProductionLiveSyncContext','getQueueCardInventoryRow',
      'getDockSuspendTagValidDriveOptionRows','getDockSuspendTagDriveOptionRowsCandidateIndex',
      'syncRequestRenderChrome','ensureRequestSuspendTagRenderShell','updateRequestSuspendTagFiltersInPlace',
      'getRowPhotoLink','getRowPhotoDateLabel','getItemDisplayValue','formatLocPhotoMatchQtyValue',
      'findSeasonSalesNoteMasterCandidateForCard','setContainerHtml','setContainerHtmlWithSignature',
      'getQueueCardInventoryAuthorizationContext','getQueueCardInventoryContext','getCardLocationOnHandServerAggregate',
      'normalizeRowPhotoFields','scheduleDeferredCardPhotoHydration','tuneNativeImagePerformance',
      'auditIosPhoneRequestFlow','clearIosPhoneRequestFlowState','repairIosPhoneAndroidFlowGap',
      'syncStickyRailOffset','getCurrentLoginCacheScopeKey','getSupabaseReadIdentityScope',
      'createSuspendTagPageRenderRow']) {
      if (typeof window[name] !== 'function') continue;
      const original = window[name];
      window[name] = function(...args) {
        const start = performance.now();
        try { return original.apply(this,args); }
        finally { const key = name + ':' + (window.__v2314TimingPhase || 'other'); const result = window.__v2314Profile[key] ||= { calls: 0, ms: 0 }; result.calls++; result.ms += performance.now()-start; }
      };
      Object.assign(window[name], original);
      if (name === 'createSuspendTagPageRenderRow') {
        const timed = window[name];
        window[name] = function(...args) {
          const previous = window[name].pages?.get(args[0]);
          const result = timed.apply(this,args);
          const next = window[name].pages?.get(args[0]);
          const oldKey = previous ? JSON.parse(previous.key) : [];
          const newKey = next ? JSON.parse(next.key) : [];
          (window.__v2314CacheEvents ||= []).push({ phase: window.__v2314TimingPhase,
            reused: previous === next, existed: !!previous, stored: !!next,
            changedKeyParts: newKey.flatMap((part,index) => JSON.stringify(part) === JSON.stringify(oldKey[index]) ? [] : [index]),
            changedRowRefs: previous?.sourceRows.filter((row,index) => row !== args[1].rows[index]).length });
          return result;
        };
        Object.assign(window[name], timed);
      }
    }
    for (const [owner, name] of [[Element.prototype, 'getBoundingClientRect'], [window, 'getComputedStyle']]) {
      const original = owner[name];
      owner[name] = function(...args) {
        const start = performance.now();
        try { return original.apply(this,args); }
        finally { const key = name + ':' + (window.__v2314TimingPhase || 'other'); const result = window.__v2314Profile[key] ||= { calls: 0, ms: 0 }; result.calls++; result.ms += performance.now()-start; }
      };
    }
  })()`;

const suspendWarmRender = `(async () => {
      // Wait until the real authenticated snapshot, Suspend source mirrors,
      // and the naturally rendered first page have all settled. A transiently
      // verified but still-preparing mirror is not a warm-page measurement.
      const readinessStart = performance.now();
      let priorReadySignature = '';
      let stableReadyFrames = 0;
      let warmupComplete = false;
      const readiness = window.__releaseSmokeWarmReadiness = { current: null, transitions: [] };
      let priorDiagnostic = '';
      while (stableReadyFrames < 2) {
        const context = getProductionLiveSyncContext();
        const proof = hasCurrentProductionLiveSyncProof(context);
        const container = document.getElementById('request-suspend-tag-card-list');
        const cachedPage = container && createSuspendTagPageRenderRow.pages?.get(container);
        const cardCount = document.querySelectorAll('#request-content article[data-request-uid^="dock_suspend_dc_"]').length;
        const pageReady = !isDockSuspendDcRequestMirrorPreparationPending()
          && cardCount === 37
          && cachedPage?.sourceRows.length === 37
          && cachedPage?.rows.size === 37;
        const preparation = dockSuspendDcRequestMirrorRowsPreparation;
        const diagnostic = {
          elapsedMs: performance.now() - readinessStart, proof, pageReady, cardCount,
          sourceRows: cachedPage?.sourceRows.length ?? null, renderedRows: cachedPage?.rows.size ?? null,
          mirrorsPending: isDockSuspendDcRequestMirrorPreparationPending(),
          mirrorCursor: preparation?.cursor ?? null, mirrorSourceRows: preparation?.sourceRows.length ?? null,
          status: getProductionLiveSyncCoordinator().getStatus(),
          documentHidden: document.hidden, visibilityState: document.visibilityState,
          masterRows: fullInventory.length, currentView: getCurrentVisibleViewId(),
        };
        readiness.current = diagnostic;
        const diagnosticKey = JSON.stringify({ ...diagnostic, elapsedMs: 0 });
        if (diagnosticKey !== priorDiagnostic) {
          readiness.transitions.push(diagnostic);
          if (readiness.transitions.length > 30) readiness.transitions.shift();
          priorDiagnostic = diagnosticKey;
        }
        // An unchanged DOM signature can skip row generation after an auth or
        // dataset cache key changed. Warm the real renderer exactly once and
        // measure that work too; waiting cannot populate its empty row cache.
        if (!warmupComplete && proof && !diagnostic.mirrorsPending
            && cardCount === 37 && cachedPage?.sourceRows.length === 37) {
          const expectedIds = Array.from(document.querySelectorAll('#request-content article[data-request-uid^="dock_suspend_dc_"]'))
            .map(card => card.getAttribute('data-request-uid')).sort();
          const warmupStart = performance.now();
          setContainerHtml(container, '');
          renderRequest();
          while (document.querySelectorAll('#request-content article[data-request-uid^="dock_suspend_dc_"]').length !== 37
              && performance.now() - warmupStart < 5000) {
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const actualIds = Array.from(document.querySelectorAll('#request-content article[data-request-uid^="dock_suspend_dc_"]'))
            .map(card => card.getAttribute('data-request-uid')).sort();
          const warmup = window.__releaseSmokeWarmup = { durationMs: performance.now() - warmupStart, expectedIds, actualIds };
          if (warmup.durationMs > 2000 || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
            throw new Error('Measured authenticated Suspend warmup exceeded 2000 ms or lost source parity: ' + JSON.stringify(warmup));
          }
          warmupComplete = true;
          stableReadyFrames = 0;
          priorReadySignature = '';
          continue;
        }
        if (proof && pageReady) {
          const readySignature = JSON.stringify([
            productionVerifiedViewKey(context),
            ['master', 'avOpen', 'suspendTag', 'soc', 'customerRepMap'].map(getDatasetLoadSignature),
            cachedPage.key, cachedPage.rows.size, cardCount,
          ]);
          stableReadyFrames = readySignature === priorReadySignature ? stableReadyFrames + 1 : 0;
          priorReadySignature = readySignature;
        } else {
          stableReadyFrames = 0;
          priorReadySignature = '';
        }
        if (performance.now() - readinessStart > 15000) {
          throw new Error('Warm authenticated Suspend page or source mirrors did not settle: ' + JSON.stringify(readiness.current));
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const proofBefore = productionVerifiedViewKey(getProductionLiveSyncContext());
      if (window.__v2314Profile) window.__v2314Profile = {};
      // Use the app's clear operation: raw DOM removal leaves stale render
      // signatures/chunk work, and global invalidation is a cold data reset.
      setContainerHtml(document.getElementById('request-suspend-tag-card-list'), '');
      const start = performance.now();
      window.__v2314TimingPhase = 'sync';
      renderRequest();
      const phases = [{ ms: performance.now()-start, cards: document.querySelectorAll('#request-content article[data-request-uid^="dock_suspend_dc_"]').length, phase: 'synchronous' }];
      window.__v2314TimingPhase = 'frame';
      do {
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        const count = document.querySelectorAll('#request-content article[data-request-uid^="dock_suspend_dc_"]').length;
        if (phases.at(-1).cards !== count) phases.push({ ms: performance.now()-start, cards: count, phase: 'frame' });
      } while (document.querySelectorAll('#request-content article[data-request-uid^="dock_suspend_dc_"]').length !== 37 && performance.now()-start < 5000);
      const renderMs = performance.now() - start;
      window.__v2314TimingPhase = 'done';
      window.__v2314Proof = {
        before: proofBefore, after: productionVerifiedViewKey(getProductionLiveSyncContext()),
        verifiedAfter: hasCurrentProductionLiveSyncProof(getProductionLiveSyncContext()),
        phases,
      };
      window.__v2314MeasuredProfile = window.__v2314Profile;
      return renderMs;
    })()`;

export async function measureSuspendWarmRender(page: Page, cards: Locator, info: SuspendSmokeInfo) {
  if (process.env.V2314_PROFILE === '1') await page.evaluate(script => window.eval(script), suspendProfileSetup);
  const profiler = process.env.V2314_PROFILE === '1' && info.project.name === 'desktop-chromium'
    ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
  const renderMs = await page.evaluate(script => window.eval(script), suspendWarmRender).catch(async (error: unknown) => {
    await info.attach('release-smoke-warm-readiness-diagnostic', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify(await page.evaluate(() => (window as unknown as { __releaseSmokeWarmReadiness?: unknown })
        .__releaseSmokeWarmReadiness).catch(() => null))) });
    await info.attach('release-smoke-measured-suspend-warmup', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify(await page.evaluate(() => (window as unknown as { __releaseSmokeWarmup?: unknown })
        .__releaseSmokeWarmup).catch(() => null))) });
    throw error;
  }) as number;
  await info.attach('release-smoke-measured-suspend-warmup', { contentType: 'application/json',
    body: Buffer.from(JSON.stringify(await page.evaluate(() => (window as unknown as { __releaseSmokeWarmup?: unknown }).__releaseSmokeWarmup))) });
  if (profiler) {
    const cpu = await profiler.send('Profiler.stop');
    await info.attach('v2314-cpu-profile', { contentType: 'application/json', body: Buffer.from(JSON.stringify(cpu)) });
    await profiler.detach();
  }
  await expect(cards).toHaveCount(37);
  await info.attach('v2314-proof', { contentType: 'application/json', body: Buffer.from(JSON.stringify(
    await page.evaluate(() => (window as unknown as { __v2314Proof: unknown }).__v2314Proof),
  )) });
  if (process.env.V2314_PROFILE === '1') await info.attach('v2314-render-profile', {contentType:'application/json', body:Buffer.from(JSON.stringify(
    await page.evaluate(() => window.eval('({ profile:window.__v2314Profile, cache:window.__v2314CacheEvents, scheduled:window.__v2314Scheduled })')),
  ))});
  expect.soft(renderMs, 'full 37-card warm render with 9,487 master rows').toBeLessThanOrEqual(2000);
  return renderMs;
}

export async function assertSuspendCardOrder(page: Page, cards: Locator, rows: FixtureRow[], expectedSourceIds: string[], info: SuspendSmokeInfo) {
  let order = (await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-request-uid') || '')));
  let stableOrderFrames = 0;
  let priorOrder = order;
  for (let attempt = 0; attempt < 40 && stableOrderFrames < 2; attempt++) {
    await nextSuspendFrame(page);
    order = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-request-uid') || ''));
    stableOrderFrames = JSON.stringify(order) === JSON.stringify(priorOrder) ? stableOrderFrames + 1 : 0;
    priorOrder = order;
  }
  const measuredUidParity = {
    expectedCount: expectedSourceIds.length, actualCount: order.length,
    actualOrder: order, actualIds: [...order].sort(),
    missingIds: expectedSourceIds.map(id => `dock_suspend_dc_${id}`).filter(id => !order.includes(id)),
    unexpectedIds: order.filter(id => !expectedSourceIds.some(sourceId => id === `dock_suspend_dc_${sourceId}`)),
    stableConsecutiveFrames: stableOrderFrames,
  };
  await info.attach('measured-render-suspend-uid-parity', { contentType: 'application/json', body: Buffer.from(JSON.stringify(measuredUidParity)) });
  expect(measuredUidParity.stableConsecutiveFrames, 'the measured full card order must stabilize across two animation frames').toBeGreaterThanOrEqual(2);
  expect(measuredUidParity.actualIds).toEqual(expectedSourceIds.map(id => `dock_suspend_dc_${id}`).sort());
  const rowById = new Map(rows.map(row => [`dock_suspend_dc_${row.UNIQUE_ID}`, row]));
  const locations = order.map(id => String(rowById.get(id || '')?.LOCATIONCODE || '').trim().toUpperCase());
  expect(locations).toEqual([...locations].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  return rowById.get(order.at(-1) || '');
}
