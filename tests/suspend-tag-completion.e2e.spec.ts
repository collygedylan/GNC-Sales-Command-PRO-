import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
// @test-group: @suspend-tag,suspend,@v2312-ui,@v2314-parity,@release-smoke

import { confirmedDriveEvidence, driveEvidenceColumns } from '../services/driveEvidence.ts';
import { inventoryReadFixture, inventoryIdentityBatchFixture } from './fixtures/inventory-list-read-fixture.mjs';


type FixtureRow = Record<string, string | number>;
async function activateSurface(page: Page, locator: Locator) {
  if ((page.viewportSize()?.width || 0) <= 767) await locator.tap();
  else await locator.click();
}

type Reply = {
  operation?: string;
  status?: number;
  body?: Record<string, unknown>;
  abort?: boolean;
  commitBeforeAbort?: boolean;
  wait?: Promise<void>;
};
type CompletionRequest = { body: Record<string, any> };
const sourceRevision = '2026-09-08T14:00:00.000Z';
const completionTime = '2026-09-08T15:00:00.000Z';
const safeDatasetReads = new Set(['request_queue', 'active_request', 'soc', 'suspend_tag', 'cav', 'reserves', 'sales_office', 'dock_team', 'dock_item', 'dock_issue', 'dock_allocations', 'productivity_history', 'inventory_edits', 'shear']);
const fixtures: FixtureRow[] = [1, 2].map((index) => ({
  UNIQUE_ID: `browser-suspend-${index}`,
  ITEMCODE: `BROWSER-ONLY-SUSPEND-${index}`,
  COMMONNAME: `Suspend browser fixture ${index}`,
  CONTSIZE: '#3',
  LOCATIONCODE: `B.0${index}.000`,
  LOTCODE: '27.F1',
  SEASON: 'F1',
  SALESYEAR: '27',
  SUSPEND: 'SUSPEND',
  SUSPENDTO: 'DC',
  LAST_UPDATED: sourceRevision,
  DATE_COMPLETED: '', SUSPEND_TAG_VERSION: 0, SUSPEND_TAG_STATUS: 'pending', DOCK_PHOTO_LINK: 'https://example.test/photo.jpg', DOCK_PHOTO_NAME: 'photo.jpg', MATCH: '100', AV_NOTE: 'Verified stock',
  QUANTITYORDERED: '10',
  PTRONHAND: '40',
  PTRAVAILABLE: '30',
  S_LTS: '100',
  DOCK_NUM: '1',
  CUSTOMERNAME: 'Synthetic browser customer',
  CONSIGNEENAME: 'Synthetic browser consignee',
  SALESREPNAME: 'Dylan Collyge',
  ASSIGNEDTO: 'dylan_collyge',
}));

function buildConfirmedInventoryRow(source: FixtureRow, patch: Record<string, unknown>) {
  const asText = (value: unknown) => value == null ? null : String(value);
  const row = Object.assign(Object.fromEntries(driveEvidenceColumns.map(column => [column, null])), {
    unique_id: `master-${String(source.UNIQUE_ID)}`,
    itemcode: String(source.ITEMCODE),
    locationcode: String(source.LOCATIONCODE),
    lotcode: String(source.LOTCODE),
    last_updated: new Date(Date.parse(completionTime) + Math.max(0, Number(source.SUSPEND_TAG_VERSION) - 1) * 1000).toISOString(),
    photo_link: asText(patch.dock_photo_link ?? source.DOCK_PHOTO_LINK),
    photo_name: asText(patch.dock_photo_name ?? source.DOCK_PHOTO_NAME),
    match: asText(patch.match ?? source.MATCH),
    spec: asText(patch.dock_spec ?? source.DOCK_SPEC),
    caliper: asText(patch.dock_caliper ?? source.DOCK_CALIPER),
    initial_ptr: asText(patch.initial_ptr ?? source.INITIAL_PTR),
    loc_match_qty: asText(patch.loc_match_qty ?? source.LOC_MATCH_QTY),
    ptravailable: asText(source.PTRAVAILABLE),
    av_note: asText(patch.av_note ?? source.AV_NOTE),
  });
  return confirmedDriveEvidence({ ok: true, canonicalConfirmed: true, row });
}

test('Latest file’s 37 marked physical DC tags hydrate current master metrics and sort by nursery location @v2314-parity @release-smoke',
  { tag: ['@suspend-tag', '@v2314-parity', '@release-smoke'] }, async ({ page, baseURL }, info) => {
  // Bootstrap, dictionary hydration and readiness are outside the measured
  // warm-render operation; its strict 2,000 ms assertion remains below.
  test.setTimeout(120_000);
  const snapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/suspend-v2314.json.gz', import.meta.url))).toString('utf8')) as {
    capturedAt: string; masterRows: FixtureRow[]; suspendRows: FixtureRow[];
    source: { filename: string; sha256: string };
  };
  const expectedSourceIds = snapshot.suspendRows
    .filter(row => String(row.SUSPEND || '').trim().toUpperCase() === 'SUSPEND'
      && String(row.SUSPENDTO || row.SUSPEND_TO || '').trim().toUpperCase() === 'DC'
      && !String(row.DATE_COMPLETED || '').trim())
    .map(row => String(row.UNIQUE_ID || '').trim()).sort();
  expect(snapshot.suspendRows).toHaveLength(67);
  expect(new Set(snapshot.suspendRows.map(row => row.UNIQUE_ID)).size).toBe(67);
  expect(snapshot.masterRows).toHaveLength(9487);
  const olderControlRows = snapshot.suspendRows.filter(row => row.SUSPEND === 'SUSPEND').slice(0,3).map((row, index) => ({ ...row,
    UNIQUE_ID: 'isolated-older-source-' + index, FILENAME: 'SOC-10 Open Orders-12250920261019122509.xlsx', LAST_UPDATED: '2026-10-19T22:00:00.000Z' }));
  if (process.env.V2314_PROFILE === '1') await page.addInitScript(() => {
    const target = window as unknown as { __v2314TimingPhase?: string; __v2314Scheduled?: Array<{ type: string; label: string; ms: number }> };
    for (const type of ['requestAnimationFrame', 'setTimeout'] as const) {
      const original = window[type].bind(window);
      const instrument = (callback: FrameRequestCallback | TimerHandler, ...args: number[]) => {
        if (typeof callback !== 'function') return original(callback as never, ...args);
        return original(((...values: number[]) => {
          const start = performance.now();
          try { return callback(...values); }
          finally { if (target.__v2314TimingPhase === 'frame') (target.__v2314Scheduled ||= []).push({ type, label: callback.toString().slice(0, 180), ms: performance.now()-start }); }
        }) as never, ...args);
      };
      Object.assign(window, { [type]: instrument });
    }
  });
  const app = await harness(page, baseURL!, [...snapshot.suspendRows, ...olderControlRows], { masterRows: snapshot.masterRows });
  const cards = page.locator('#request-content article[data-request-uid^="dock_suspend_dc_"]');
  await expect(cards).toHaveCount(37, { timeout: 15000 });
  const expectedCardIds = expectedSourceIds.map(id => `dock_suspend_dc_${id}`).sort();
  let priorCardIds: string[] = [];
  let stableCardFrames = 0;
  let actualCardIds: string[] = [];
  for (let attempt = 0; attempt < 40 && stableCardFrames < 2; attempt++) {
    actualCardIds = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-request-uid') || '').sort());
    stableCardFrames = JSON.stringify(actualCardIds) === JSON.stringify(priorCardIds) ? stableCardFrames + 1 : 0;
    priorCardIds = actualCardIds;
    if (stableCardFrames < 2) await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
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
  // Complete the initial snapshot's bounded identity lookups before measuring
  // a warm reopen; do not race the seed publication and its follow-up reads.
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => { await document.fonts.ready; });
  if (process.env.V2314_PROFILE === '1') await page.evaluate(() => window.eval(`(() => {
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
  })()`));
  const profiler = process.env.V2314_PROFILE === '1' && info.project.name === 'desktop-chromium'
    ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
  const renderMs = await page.evaluate(async () => {
    return window.eval(`(async () => {
      // Wait until the real authenticated snapshot, Suspend source mirrors,
      // and the naturally rendered first page have all settled. A transiently
      // verified but still-preparing mirror is not a warm-page measurement.
      const readinessStart = performance.now();
      let priorReadySignature = '';
      let stableReadyFrames = 0;
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
          throw new Error('Warm authenticated Suspend page or source mirrors did not settle');
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
    })()`);
  }) as number;
  if (profiler) {
    const cpu = await profiler.send('Profiler.stop');
    await info.attach('v2314-cpu-profile', { contentType: 'application/json', body: Buffer.from(JSON.stringify(cpu)) });
    await profiler.detach();
  }
  await expect(cards).toHaveCount(37);
  await info.attach('v2314-proof', { contentType: 'application/json', body: Buffer.from(JSON.stringify(
    await page.evaluate(() => (window as unknown as { __v2314Proof: unknown }).__v2314Proof),
  )) });
  if (process.env.V2314_PROFILE === '1') console.log('V2314_PROFILE', await page.evaluate(() => (window as unknown as {__v2314Profile: unknown}).__v2314Profile));
  if (process.env.V2314_PROFILE === '1') console.log('V2314_CACHE', await page.evaluate(() => (window as unknown as {__v2314CacheEvents: unknown}).__v2314CacheEvents));
  if (process.env.V2314_PROFILE === '1') console.log('V2314_SCHEDULED', await page.evaluate(() => (window as unknown as {__v2314Scheduled: unknown}).__v2314Scheduled));
  expect.soft(renderMs, 'full 37-card warm render with 9,487 master rows').toBeLessThanOrEqual(2000);
  let order = (await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-request-uid') || '')));
  let stableOrderFrames = 0;
  let priorOrder = order;
  for (let attempt = 0; attempt < 40 && stableOrderFrames < 2; attempt++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
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
  const rowById = new Map(snapshot.suspendRows.map(row => [`dock_suspend_dc_${row.UNIQUE_ID}`, row]));
  const locations = order.map(id => String(rowById.get(id || '')?.LOCATIONCODE || '').trim().toUpperCase());
  expect(locations).toEqual([...locations].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  const littleLime = snapshot.suspendRows.filter(row => row.SUSPEND === 'SUSPEND' && row.ITEMCODE === '009373.031.1' && row.LOCATIONCODE === 'F.14.000' && row.LOTCODE === '27.F1');
  expect(littleLime.length).toBeGreaterThan(0);
  for (const row of littleLime) {
    const card = app.card(row);
    await expect(card.locator('[data-inventory-card-metric="on-hand"]')).toContainText('90');
    await expect(card.locator('[data-inventory-card-metric="review"]')).toContainText('25');
    await expect(card.locator('[data-inventory-card-metric="available"]')).toContainText('65');
    await expect(card.locator('[data-inventory-card-metric="open-stock"]')).toContainText('57');
    // These are the captured Oct 20 master quantities, newer than the video:
    // location total = 90 F1 + 59 S1 + 79 U1 + 26 X; verified photo quantity = round(65 available × 65% match) = 42.
    await expect(card.locator('[data-inventory-card-metric="loc-photo-match"]')).toContainText('42');
    await expect(card.locator('[data-inventory-card-metric="loc-on-hand"]')).toContainText('254');
    await expect(card).toContainText('PRI 10');
    await expect(card).toContainText('light roots; thin body');
  }
  const liriope = snapshot.suspendRows.filter(row => row.SUSPEND === 'SUSPEND' && row.ITEMCODE === '004380.010.1' && row.LOCATIONCODE === 'C.09.000' && row.LOTCODE === '27.F1');
  expect(liriope.length).toBeGreaterThan(1);
  for (const row of liriope) {
    const card = app.card(row);
    await expect(card.locator('[data-inventory-card-metric="on-hand"]')).toContainText('1542');
    await expect(card.locator('[data-inventory-card-metric="review"]')).toContainText('675');
    await expect(card.locator('[data-inventory-card-metric="available"]')).toContainText('867');
    await expect(card.locator('[data-inventory-card-metric="open-stock"]')).toContainText('1090');
    // The live master has no photo-rule timestamp for this row. Preserve
    // Drive's unverified result; an inventory update is not photo evidence.
    await expect(card.locator('[data-inventory-card-metric="loc-photo-match"]')).toContainText('N/A');
    await expect(card.locator('[data-inventory-card-metric="loc-on-hand"]')).toContainText(/23,?655/);
  }
  const lastVisibleRow = rowById.get(order.at(-1) || '');
  expect(lastVisibleRow, 'the ordered last card must map to a captured source row').toBeDefined();
  if (lastVisibleRow) {
    const lastCard = app.card(lastVisibleRow);
    await lastCard.scrollIntoViewIfNeeded();
    await expect(lastCard).toBeVisible();
    await expect(lastCard.getByRole('button', { name: 'Complete Tag', exact: true })).toBeVisible();
    const finalCardLayout = {
      ...await lastCard.evaluate(card => {
      const metrics = [...card.querySelectorAll<HTMLElement>('[data-inventory-card-metric]')];
      const rect = card.getBoundingClientRect();
      return {
        cardOverflow: card.scrollWidth > card.clientWidth + 1,
        inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
        metrics: metrics.map(metric => {
          const label = metric.querySelector<HTMLElement>('.app-card-qty-label');
          const value = metric.querySelector<HTMLElement>('.app-card-qty-value');
          return {
            id: metric.dataset.inventoryCardMetric,
            label: label?.textContent?.trim() || '',
            value: value?.textContent?.trim() || '',
            labelSingleLine: !!label && getComputedStyle(label).whiteSpace === 'nowrap'
              && label.scrollHeight <= label.clientHeight + 1,
            valueSingleLine: !!value && getComputedStyle(value).whiteSpace === 'nowrap'
              && value.scrollHeight <= value.clientHeight + 1,
          };
        }),
      };
      }),
      completeTagVisible: await lastCard.getByRole('button', { name: 'Complete Tag', exact: true }).isVisible(),
    };
    await info.attach('release-smoke-last-card-layout', {
      body: Buffer.from(JSON.stringify(finalCardLayout)), contentType: 'application/json',
    });
    expect(finalCardLayout.inViewport).toBe(true);
    expect(finalCardLayout.cardOverflow).toBe(false);
    expect(finalCardLayout.completeTagVisible).toBe(true);
    expect(finalCardLayout.metrics.map(metric => metric.id)).toEqual(expect.arrayContaining([
      'on-hand', 'review', 'available', 'open-stock', 'loc-photo-match', 'loc-on-hand',
    ]));
    expect(finalCardLayout.metrics.every(metric => metric.label && metric.value && metric.labelSingleLine && metric.valueSingleLine)).toBe(true);
  }
  const sharedTotals = await page.evaluate(() => window.eval(`({
    littleLime: getCardLocationOnHandValue(fullInventory.find(row => row.ITEMCODE === '009373.031.1' && row.LOCATIONCODE === 'F.14.000' && row.LOTCODE === '27.F1')),
    liriope: getCardLocationOnHandValue(fullInventory.find(row => row.ITEMCODE === '004380.010.1' && row.LOCATIONCODE === 'C.09.000' && row.LOTCODE === '27.F1'))
  })`));
  expect(String(sharedTotals.littleLime).replaceAll(',', '')).toBe('254');
  expect(String(sharedTotals.liriope).replaceAll(',', '')).toBe('23655');
  const driveSummary = await page.evaluate(() => window.eval(`collectDashboardSyncSource([
    {LAST_UPDATED:'2026-10-20T02:24:45.602Z',FILENAME:'DriveAroundMC-10-10320620261019103206.xlsx'},
    {LAST_UPDATED:'2026-10-20T02:24:45.602Z',FILENAME:'DriveAroundMC-10-16251320260916042513.xlsx'}
  ],'Drive')`));
  expect(driveSummary.files).toEqual(['DriveAroundMC-10-10320620261019103206.xlsx']);
  await info.attach('release-smoke-render-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    environment: info.project.name, masterRows: snapshot.masterRows.length, cards: 37, expectedCards: 37,
    renderMs, sorted: true, metricsVerified: true, cache: 'warm complete master snapshot; new card DOM; service worker blocked; fonts ready; trace off',
    capturedAt: snapshot.capturedAt, source: snapshot.source, liveAuthentication: false, productionWrites: false,
  })) });
  expect(app.requests).toEqual([]);
  await info.attach('release-smoke-console-resource-diagnostics', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ consoleErrors: app.consoleErrorDetails, failedResources: app.failedResources,
      chatParticipantReads: app.chatParticipantReads, customerConsigneeReads: app.customerConsigneeReads,
      syntheticHealthTelemetry: app.healthTelemetryReceipts,
      healthTelemetryRequests: app.healthTelemetryRequests, fetchAbortEvidence: await app.readFetchAbortEvidence() })),
  });
  await app.assertClean();
});

test('release smoke uses an isolated synthetic session and does not authorize production writes @release-smoke',
  { tag: ['@suspend-tag', '@release-smoke'] }, async ({ page, baseURL }) => {
    const app = await harness(page, baseURL!, [fixtures[0]], { masterRows: [{ ...fixtures[0], UNIQUE_ID: 'synthetic-auth-master-row' }] });
    const auth = await page.evaluate(() => window.eval(`(async () => ({
      headers: await getNativeAuthRequestHeaders(),
      fixtureReady: window.__suspendTestAuthReady === true,
      tokenLooksSynthetic: String(nativeAuthAccessToken || '').includes('synthetic-not-a-real-token')
    }))()`));
    expect(auth.fixtureReady).toBe(true);
    expect(auth.headers).toEqual({ Authorization: 'Bearer browser-only-no-real-session', apikey: 'browser-only' });
    expect(auth.tokenLooksSynthetic).toBe(true);
    expect(app.requests).toEqual([]);
    await app.assertClean();
  });

/** Runs the built app's real renderer, confirmation, transport and cache logic.
 * Only identity/data-loading boundaries are supplied. Backend state lives in
 * this test process across refresh/reload; no customer record is ever changed.
 */
async function harness(page: Page, baseURL: string, rows = fixtures, options: { search?: string; expired?: boolean; inventoryUnavailable?: boolean; native?: boolean; published?: boolean; masterRows?: FixtureRow[] } = {}) {
  const origin = new URL(baseURL).origin;
  const backendRows = structuredClone(rows);
  const receipts = new Map<string, Record<string, unknown>>();
  const requests: CompletionRequest[] = [];
  const unexpectedMutations: string[] = [];
  const blockedReadOnlyAppApiCalls: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleErrorDetails: Array<{ text: string; location: { url: string; lineNumber: number; columnNumber: number } }> = [];
  const failedResources: Array<{ url: string; method: string; resourceType: string; failure: string }> = [];
  const chatParticipantReads: Array<{ url: string; authorization: string; status: number }> = [];
  const customerConsigneeReads: Array<{ url: string; authorizationAllowed: boolean; status: number }> = [];
  const healthTelemetryReceipts: Array<{ payload: Record<string, unknown>; apiKeyPresent: boolean; syntheticIdentity: boolean; authorizationMatchesPublicKey: boolean; status: number }> = [];
  const healthTelemetryRequests: Array<{ url: string; method: string; authorizationAllowed: boolean; apiKeyPresent: boolean; payload: unknown }> = [];
  const settingsReads: Array<{ url: string; status: number | null; authorization: string }> = [];
  const fixtureImage404s = new Set<string>();
  const http404Resources: Array<{ url: string; resourceType: string }> = [];
  const knownFixtureImageUrl = 'https://example.test/photo.jpg';
  const fixtureImageUrls = new Set<string>([knownFixtureImageUrl]);
  for (const row of [...rows, ...(options.masterRows || [])]) {
    const candidate = String(row.DOCK_PHOTO_LINK || row.dock_photo_link || row.PHOTO_LINK || row.photo_link || row.ROW_PHOTO_LINK || row.row_photo_link || '').trim();
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') fixtureImageUrls.add(parsed.href);
    } catch (_) {}
  }
  // Validate the captured source once; page reads then validate/project only
  // their bounded slice instead of serializing 9,487 rows for every page.
  const masterReadRows = options.published ? (options.masterRows || []).map(row => inventoryReadFixture.fromFixtureShape(row))
    .sort((a, b) => String(a.unique_id).localeCompare(String(b.unique_id))) : [];
  const masterReadById = new Map(masterReadRows.map(row => [String(row.unique_id), row]));
  const publishedReadPages: Array<{ dataset: string; offset: number; rows: number; total: number }> = [];
  const readPublishedMasterPage = (params: Record<string, unknown>) => {
    const offset = Number(params.offset), limit = Number(params.limit);
    const rows = params.dataset === 'lookup'
      ? [masterReadById.get(String(params.uniqueId))].filter(Boolean)
      : masterReadRows.slice(offset, offset + limit);
    const page = inventoryReadFixture.readMasterPage(rows, { ...params, offset: 0 });
    const total = params.dataset === 'lookup' ? page.total : masterReadRows.length;
    const result = { ...page, offset, total, hasMore: offset + page.rows.length < total };
    publishedReadPages.push({ dataset: String(params.dataset), offset, rows: result.rows.length, total });
    return result;
  };
  const runtimeResponses: string[] = [];
  const inventoryLookupCalls: Array<{ params: Record<string, unknown>; status: number }> = [];
  const replies: Reply[] = [];
  let nativeRevision = 1;
  await page.addInitScript(expired => { (window as any).__suspendTestAuthReady = !expired; }, !!options.expired);
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json',
  };
  await page.addInitScript(() => {
    type AbortEntry = { url: string; method: string; context: string; reasonName: string; reasonCode: string; reasonMessage: string; abortStack: string; requestStack: string };
    type FixtureWindow = Window & { __suspendFixtureFetchAbortContext?: string; __suspendFixtureFetchAborts?: AbortEntry[] };
    const fixtureWindow = window as FixtureWindow;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = request?.url || String(input);
      const method = String(init?.method || request?.method || 'GET').toUpperCase();
      const signal = init?.signal || request?.signal || null;
      const parsedUrl = (() => { try { return new URL(url, window.location.href); } catch (_) { return null; } })();
      const watched = parsedUrl?.origin === 'https://kzrnyjsosryejjejliii.supabase.co'
        && parsedUrl.pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1' && method === 'POST';
      if (watched && signal) {
        const requestStack = new Error('fixture fetch start').stack || '';
        const recordAbort = () => {
          const rawReason: unknown = signal.reason;
          const reason = rawReason && typeof rawReason === 'object' ? rawReason as Record<string, unknown> : {};
          const entry: AbortEntry = {
            url, method, context: fixtureWindow.__suspendFixtureFetchAbortContext || '',
            reasonName: String(reason.name || ''), reasonCode: String(reason.code || ''),
            reasonMessage: String(reason.message || (typeof rawReason === 'string' ? rawReason : '')),
            abortStack: String(reason.stack || new Error('fixture fetch signal aborted').stack || ''), requestStack,
          };
          (fixtureWindow.__suspendFixtureFetchAborts ||= []).push(entry);
        };
        if (signal.aborted) recordAbort();
        else signal.addEventListener('abort', recordAbort, { once: true });
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  });
  const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleErrors.push(message.text());
    consoleErrorDetails.push({ text: message.text(), location: message.location() });
  });
  page.on('requestfailed', request => failedResources.push({
    url: request.url(), method: request.method(), resourceType: request.resourceType(), failure: request.failure()?.errorText || 'unknown',
  }));
  page.on('request', request => {
    if (request.url().includes('/rest/v1/rpc/report_app_health_event')) {
      let payload: unknown = null;
      try { payload = request.postDataJSON(); } catch (_) {}
      const authorization = request.headers()['authorization'] || '';
      const apiKey = request.headers()['apikey'] || '';
      healthTelemetryRequests.push({ url: request.url(), method: request.method(),
        authorizationAllowed: authorization === 'Bearer browser-only-no-real-session' || (apiKey.length > 0 && authorization === `Bearer ${apiKey}`),
        apiKeyPresent: Boolean(apiKey), payload });
    }
  });
  page.on('response', response => {
    const request = response.request();
    if (response.status() === 404) http404Resources.push({ url: response.url(), resourceType: request.resourceType() });
    if (response.url() === knownFixtureImageUrl && request.resourceType() === 'image' && response.status() === 404) {
      fixtureImage404s.add(response.url());
    }
  });
  page.on('response', (response) => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) runtimeResponses.push(response.url());
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    // A real HTTP image failure dispatches the browser's error event consistently;
    // an intercepted cancellation can leave WebKit's deferred image unsettled.
    if (request.method() === 'GET' && url.href === knownFixtureImageUrl && request.resourceType() === 'image') {
      return route.fulfill({ status: 404, contentType: 'image/jpeg', body: '' });
    }
    if (request.method() === 'GET' && request.resourceType() === 'image' && fixtureImageUrls.has(url.href)) {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    }
    // Keep browser health telemetry synthetic: validate and record the exact
    // sanitized RPC envelope locally, then acknowledge it without contacting
    // Supabase or emitting real telemetry.
    if (request.method() === 'POST' && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
      && url.pathname === '/rest/v1/rpc/report_app_health_event') {
      const authorization = request.headers()['authorization'] || '';
      const apiKey = request.headers()['apikey'] || '';
      let payload: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = request.postDataJSON();
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      } catch (_) {}
      const expectedKeys = 'app_build,area,duration_ms,event_name,metadata,sample_rate,sanitized_code,severity';
      const metadata = payload?.metadata;
      const localSyntheticAuth = authorization === 'Bearer browser-only-no-real-session'
        || (apiKey.length > 0 && authorization === `Bearer ${apiKey}`);
      const validTelemetry = localSyntheticAuth && apiKey.length > 0
        && !!payload && Object.keys(payload).sort().join(',') === expectedKeys
        && typeof payload.event_name === 'string' && payload.event_name.length > 0 && payload.event_name.length <= 120
        && typeof payload.area === 'string' && payload.area.length > 0 && payload.area.length <= 80
        && ['info', 'warning', 'error', 'critical'].includes(String(payload.severity))
        && typeof payload.sanitized_code === 'string' && /^[A-Z0-9_-]{1,160}$/i.test(payload.sanitized_code)
        && (payload.duration_ms === null || typeof payload.duration_ms === 'number' && Number.isFinite(payload.duration_ms) && payload.duration_ms >= 0)
        && typeof payload.sample_rate === 'number' && Number.isFinite(payload.sample_rate) && payload.sample_rate >= 0 && payload.sample_rate <= 1
        && typeof payload.app_build === 'string'
        && !!metadata && typeof metadata === 'object' && !Array.isArray(metadata);
      if (!validTelemetry || !payload) {
        unexpectedMutations.push(`POST:${url.pathname}:invalid-synthetic-telemetry-envelope`);
        return route.abort('blockedbyclient');
      }
      healthTelemetryReceipts.push({ payload, apiKeyPresent: true,
        syntheticIdentity: authorization === 'Bearer browser-only-no-real-session',
        authorizationMatchesPublicKey: authorization === `Bearer ${apiKey}` });
      return route.fulfill({ status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' }, body: 'null' });
    }
    if (request.method() === 'GET' && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
      && url.pathname === '/rest/v1/ph_department_calendar_events'
      && url.search === '?select=*&order=start_at.asc&limit=1000&offset=0'
      && Boolean(request.headers()['apikey'])
      && (request.headers()['authorization'] === 'Bearer browser-only-no-real-session'
        || request.headers()['authorization'] === `Bearer ${request.headers()['apikey']}`)) {
      return fulfill(route, []);
    }
    if (request.method() === 'GET' && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
      && url.pathname === '/rest/v1/ph_customer_consignee_sales_reps'
      && url.search === '?select=unique_id%2Ccustomername%2Cconsigneename%2Csalesrepname%2Csalesrepid%2Ccustomeridentityid%2Cconsigneeid%2Cterritorycode%2Cterritorydesc%2Ccustomerstatus%2Cconsigneestatus&order=customername.asc&limit=1000&offset=0') {
      const authorization = request.headers()['authorization'] || '';
      const apiKey = request.headers()['apikey'] || '';
      const authorizationAllowed = authorization === 'Bearer browser-only-no-real-session'
        || (apiKey.length > 0 && authorization === `Bearer ${apiKey}`);
      customerConsigneeReads.push({ url: request.url(), authorizationAllowed, status: authorizationAllowed && apiKey ? 200 : 0 });
      if (authorizationAllowed && apiKey) return fulfill(route, []);
      return route.abort('blockedbyclient');
    }
    if (request.method() === 'GET' && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
      && url.pathname === '/rest/v1/ph_chat_participants'
      && url.searchParams.get('select') === '*' && url.searchParams.get('username') === 'eq.dylan_collyge'
      && url.searchParams.get('is_archived') === 'eq.false' && url.searchParams.get('order') === 'joined_at.desc'
      && [...url.searchParams.keys()].sort().join(',') === 'is_archived,order,select,username') {
      const authorization = request.headers()['authorization'] || '';
      if (authorization !== 'Bearer browser-only-no-real-session') return route.abort('blockedbyclient');
      chatParticipantReads.push({ url: request.url(), authorization, status: 200 });
      return fulfill(route, []);
    }
    if (options.published && request.method() === 'GET' && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
      && url.pathname === '/rest/v1/ph_app_settings') {
      const authorization = request.headers()['authorization'] || '';
      const validFixtureRead = url.searchParams.get('key') === 'eq.current_season_salesyear'
        && url.searchParams.get('select') === 'key,value,updated_by,updated_at'
        && authorization === 'Bearer browser-only-no-real-session';
      settingsReads.push({ url: request.url(), status: validFixtureRead ? 200 : null, authorization });
      if (validFixtureRead) return fulfill(route, [{ key: 'current_season_salesyear', value: { seasonCode: 'F1', salesYear: 27, revision: 1 },
        updated_by: 'release-smoke-fixture', updated_at: '2026-10-20T02:26:00.000Z' }]);
      return route.abort('blockedbyclient');
    }
    if ((options.native || options.masterRows?.length) && url.pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1' && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (!Array.isArray(body.p_dataset_keys) || Object.keys(body).some(key => key !== 'p_dataset_keys')) throw new Error('Unexpected revision read');
      return fulfill(route, { contractVersion: 1, permissionVersion: 'suspend-fixture-access-1', serverTime: new Date().toISOString(),
        sources: body.p_dataset_keys.map((key: string) => ({ key, revision: options.masterRows?.length ? '8277' : String(nativeRevision), state: options.published && key === 'ph_master_inventory' ? 'interrupted' : 'ready',
          ...(options.published && key === 'ph_master_inventory' ? { publishedReadable: true, publishedRevision: '8277:published-receipt', publishedAt: '2026-10-20T02:26:00Z' } : {}) })) });
    }
    if (url.pathname === '/functions/v1/app-api' && request.method() === 'POST' && request.postDataJSON()?.action === 'suspend_tag') {
      const body=request.postDataJSON();
      const input=body.payload || {};
      requests.push({body});
      if(body.operation==='rows') {
        const ids=Array.isArray(input.ids)?input.ids.map((id:unknown)=>String(id)):[];
        const rows=backendRows.filter(row=>ids.includes(String(row.UNIQUE_ID))).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toLowerCase(),value])));
        return fulfill(route,{ok:true,data:{rows}});
      }
      const source=backendRows.find(row=>row.UNIQUE_ID===input.sourceUid || row.SUSPEND_TAG_APPROVAL_ID===input.approvalId);
      if(!source) return fulfill(route,{message:'Suspend Tag source row was not found.'},404);
      const canonical=()=>Object.fromEntries(Object.entries(source).map(([key,value])=>[key.toLowerCase(),value]));
      if(body.operation==='approval') return fulfill(route,{ok:true,data:{approval:{id:input.approvalId,status:source.SUSPEND_TAG_STATUS==='awaiting_rep'?'pending':source.SUSPEND_TAG_STATUS,snapshot:canonical()},canDecide:source.SUSPEND_TAG_STATUS==='awaiting_rep'}});
      if(body.operation==='decide') {
        source.SUSPEND_TAG_STATUS=input.decision==='approve'?'approved':'denied'; source.SUSPEND_TAG_VERSION=Number(source.SUSPEND_TAG_VERSION)+1;
        if(input.decision==='deny') source.DATE_COMPLETED='';
        return fulfill(route,{ok:true,data:{ok:true,decision:source.SUSPEND_TAG_STATUS,approvalId:input.approvalId}});
      }
      const reply=(!replies[0]?.operation || replies[0].operation===body.operation ? replies.shift() : null) || {};
      if(reply.wait) await reply.wait;
      if(reply.body) return fulfill(route,reply.body,reply.status || 200);
      if(reply.abort && !reply.commitBeforeAbort) return route.abort('connectionfailed');
      const existing=receipts.get(body.commandId);
      if(existing) return fulfill(route,{ok:true,data:existing});
      const wasDenied=source.SUSPEND_TAG_STATUS==='denied';
      Object.entries(input.patch || {}).forEach(([key,value])=>{source[key.toUpperCase()]=value as string;});
      if(body.operation==='complete') { source.DATE_COMPLETED=completionTime; source.SUSPEND_TAG_STATUS='completed'; }
      if(body.operation==='close') {
        source.DATE_COMPLETED=completionTime;
        for (const key of ['SUSPEND','suspend','Suspend']) source[key]=null;
        for (const key of ['SUSPENDTO','suspendto','SUSPEND_TO','suspend_to','SUSPEND-TO','suspend-to','SUSPEND TO','suspend to','SuspendTo','Suspend-To','Suspend To']) source[key]=null;
        source.SUSPEND_TAG_STATUS='completed';
      }
      if(body.operation==='send' || (body.operation==='complete' && wasDenied)) {
        source.SUSPEND_TAG_STATUS='awaiting_rep'; source.SUSPEND_TAG_APPROVAL_ID='a0000000-0000-4000-8000-'+String(receipts.size+1).padStart(12,'0');
      }
      source.SUSPEND_TAG_VERSION=Number(source.SUSPEND_TAG_VERSION)+1;
      const acknowledgment: Record<string, unknown> = {ok:true,row:canonical()};
      if (['save', 'complete', 'close'].includes(String(body.operation))) {
        acknowledgment.inventoryRow = options.inventoryUnavailable && body.operation === 'complete'
          ? null
          : buildConfirmedInventoryRow(source,input.patch || {});
      }
      receipts.set(body.commandId,acknowledgment);
      if(reply.abort) return route.abort('connectionfailed');
      return fulfill(route,{ok:true,data:acknowledgment});
    }
    if (url.pathname === '/functions/v1/app-api' && request.method() === 'POST') {
      const body = request.postDataJSON() || {};
      if ((options.native || options.masterRows?.length) && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && body.action === 'eval_work' && body.operation === 'list'
        && Object.keys(body).sort().join(',') === 'action,operation'
        && !request.headers()['idempotency-key']) {
        return fulfill(route, { ok: true, data: [], manager: true });
      }
      if ((options.native || options.masterRows?.length) && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && body.action === 'shear_location_work' && body.operation === 'list' && body.status === 'active'
        && Object.keys(body).sort().join(',') === 'action,operation,status'
        && !request.headers()['idempotency-key']) {
        return fulfill(route, { ok: true, data: [] });
      }
      if (options.inventoryUnavailable && body.action === 'inventory_read' && body.operation === 'master_identity_batch') {
        inventoryLookupCalls.push({params:body.params,status:503});
        return fulfill(route,{ok:false,status:503,error:'Synthetic full inventory lookup unavailable'},503);
      }
      if ((options.native || options.masterRows?.length) && !options.inventoryUnavailable && body.action === 'inventory_read' && body.operation === 'master_identity_batch') {
        const rows=options.masterRows?.length ? options.masterRows
          : backendRows.map(row=>inventoryReadFixture.fromFixtureShape({ ...row, ...buildConfirmedInventoryRow(row,{}),loc_match_qty:'0' }));
        inventoryLookupCalls.push({params:body.params,status:200});
        return fulfill(route,{ok:true,data:inventoryIdentityBatchFixture(rows,body.params.queueIdentities,options.masterRows?.length ? '8277' : String(nativeRevision))});
      }
      if (options.published && options.masterRows?.length && body.action === 'inventory_read' && body.operation === 'master_page'
        && body.params?.dataset === 'master' && ['browse', 'full'].includes(body.params?.projection)
        && Number.isInteger(body.params.offset) && body.params.offset >= 0 && body.params.limit <= 500
        && Object.keys(body.params).every(key => ['dataset', 'projection', 'limit', 'offset'].includes(key))) {
        return fulfill(route, { ok: true, data: readPublishedMasterPage(body.params) });
      }
      if (options.published && options.masterRows?.length && body.action === 'inventory_read' && body.operation === 'master_page'
        && body.params?.dataset === 'lookup' && body.params?.projection === 'full'
        && typeof body.params.uniqueId === 'string' && body.params.limit === 1 && body.params.offset === 0
        && Object.keys(body.params).every(key => ['dataset', 'projection', 'limit', 'offset', 'uniqueId'].includes(key))) {
        return fulfill(route, { ok: true, data: readPublishedMasterPage(body.params) });
      }
      if (options.native && !options.inventoryUnavailable && body.action === 'inventory_read' && body.operation === 'master_page'
        && body.params?.dataset === 'lookup' && body.params?.projection === 'full'
        && typeof body.params?.uniqueId === 'string' && body.params.limit === 1 && body.params.offset === 0
        && Object.keys(body).sort().join(',') === 'action,operation,params'
        && Object.keys(body.params).sort().join(',') === 'dataset,limit,offset,projection,uniqueId') {
        const matching = backendRows.filter(row => `master-${row.UNIQUE_ID}` === body.params.uniqueId);
        const rows = matching.map(row => inventoryReadFixture.fromFixtureShape({
          ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])),
          ...buildConfirmedInventoryRow(row, {}), loc_match_qty: '0' }));
        return fulfill(route, { ok: true, data: inventoryReadFixture.readMasterPage(rows, body.params) });
      }
      if ((options.native || options.masterRows?.length) && ['sales_credit', 'request_history'].includes(body.action) && body.operation === 'compatibility'
        && Object.keys(body).sort().join(',') === 'action,operation,payload'
        && !request.headers()['idempotency-key'] && body.payload?.status === 'all'
        && body.payload?.cursor === null && body.payload?.limit === 100
        && Object.keys(body.payload).sort().join(',') === 'cursor,limit,status') {
        return fulfill(route, { ok: true, data: { rows: [], nextCursor: null } });
      }
      if (options.native && !options.inventoryUnavailable && body.action === 'inventory_read' && body.operation === 'master_page'
        && body.params?.dataset === 'lookup' && body.params?.projection === 'full'
        && typeof body.params?.itemCode === 'string' && typeof body.params?.locationCode === 'string'
        && body.params.limit === 500 && body.params.offset === 0
        && Object.keys(body).sort().join(',') === 'action,operation,params'
        && Object.keys(body.params).sort().join(',') === 'dataset,itemCode,limit,locationCode,offset,projection') {
        const matching = backendRows.filter(row => row.ITEMCODE === body.params.itemCode && row.LOCATIONCODE === body.params.locationCode);
        const rows = matching.map(row => inventoryReadFixture.fromFixtureShape({
          ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])),
          ...buildConfirmedInventoryRow(row, {}), loc_match_qty: '0' }));
        inventoryLookupCalls.push({ params: body.params, status: 200 });
        return fulfill(route, { ok: true, data: inventoryReadFixture.readMasterPage(rows, body.params) });
      }
      if (options.inventoryUnavailable && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && body.action === 'inventory_read' && body.operation === 'master_page'
        && body.params?.dataset === 'lookup' && body.params?.projection === 'full'
        && typeof body.params?.itemCode === 'string' && typeof body.params?.locationCode === 'string'
        && Object.keys(body).sort().join(',') === 'action,operation,params'
        && Object.keys(body.params).sort().join(',') === 'dataset,itemCode,limit,locationCode,offset,projection'
        && body.params?.limit === 500 && body.params?.offset === 0) {
        inventoryLookupCalls.push({ params: body.params, status: 503 });
        return fulfill(route, { ok: false, status: 503, error: 'Synthetic full inventory lookup unavailable' }, 503);
      }
      // The detail form looks up inventory for its AV choices. Keep this read
      // synthetic and bounded, while all inventory mutations remain blocked.
      if (url.hostname === 'kzrnyjsosryejjejliii.supabase.co' && body.action === 'inventory_read' && body.operation === 'master_page'
        && Object.keys(body).sort().join(',') === 'action,operation,params'
        && body.params?.dataset === 'lookup' && body.params.projection === 'initial'
        && typeof body.params.itemCode === 'string' && body.params.limit === 100 && body.params.offset === 0
        && Object.keys(body.params).sort().join(',') === 'dataset,itemCode,limit,offset,projection') {
        return fulfill(route,{ok:true,data:{rows:[],total:0,offset:0,limit:100,hasMore:false}});
      }
      if (url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && body.action === 'navigation_preferences' && body.operation === 'get'
        && Object.keys(body).every(key => ['action', 'operation', 'payload'].includes(key))
        && body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        && Object.keys(body.payload).length === 0) {
        return fulfill(route, { ok: true, data: { username: 'dylan_collyge', views: [], shortcuts: null, footerRevision: 0, accessRevision: 0 } });
      }
      const avRead = url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && body.action === 'av_read'
        && ['reserves', 'notes', 'hot_prices', 'settings'].includes(body.dataset)
        && !request.headers()['idempotency-key']
        && Object.keys(body).every(key => ['action', 'dataset', 'query'].includes(key))
        && (body.query === undefined || typeof body.query === 'string');
      if (avRead) {
        const params = new URLSearchParams(body.query || '');
        if (options.published && body.dataset === 'settings') {
          const authorization = request.headers()['authorization'] || '';
          const validFixtureRead = params.get('key') === 'eq.current_season_salesyear'
            && params.get('select') === 'key,value,updated_by,updated_at'
            && authorization === 'Bearer browser-only-no-real-session';
          settingsReads.push({ url: request.url(), status: validFixtureRead ? 200 : null, authorization });
          if (!validFixtureRead) throw new Error('Unexpected authenticated season-settings fixture request');
          return fulfill(route, { ok: true, data: { rows: [{ key: 'current_season_salesyear',
            value: { seasonCode: 'F1', salesYear: 27, revision: 1 }, updated_by: 'release-smoke-fixture',
            updated_at: '2026-10-20T02:26:00.000Z' }], total: 1, offset: 0, limit: 1, hasMore: false } });
        }
        const offset = Math.max(0, Number(params.get('offset')) || 0);
        const limit = Math.min(500, Math.max(1, Number(params.get('limit')) || 500));
        return fulfill(route, { ok: true, data: { rows: [], total: 0, offset, limit, hasMore: false } });
      }
      const readOnlyAppApi = url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && url.pathname === '/functions/v1/app-api'
        && !request.headers()['idempotency-key']
        && ((body.action === 'inventory_read' && body.operation === 'source_freshness'
          && Object.keys(body).sort().join(',') === 'action,operation,params'
          && body.params && typeof body.params === 'object' && !Array.isArray(body.params)
          && Object.keys(body.params).length === 0)
          || (body.action === 'dataset_read' && safeDatasetReads.has(body.dataset)
            && Object.keys(body).sort().join(',') === 'action,dataset,params'
            && body.params && typeof body.params === 'object' && !Array.isArray(body.params)
            && Number.isInteger(body.params.limit) && body.params.limit >= 1 && body.params.limit <= 500
            && Number.isInteger(body.params.offset) && body.params.offset >= 0
            && (!body.params.projection || ['default', 'signature', 'ids'].includes(body.params.projection))
            && Array.isArray(body.params.filters || []) && Array.isArray(body.params.anyOf || []) && Array.isArray(body.params.order || [])
            && Object.keys(body.params).every((key) => ['limit', 'offset', 'projection', 'filters', 'anyOf', 'order'].includes(key))));
      if (readOnlyAppApi) {
        blockedReadOnlyAppApiCalls.push(`${body.action}:${body.operation || body.dataset}`);
        if (body.action === 'dataset_read') {
          const params = body.params as Record<string, any>;
          if ((options.native || options.masterRows?.length) && body.dataset === 'suspend_tag') {
            const source = backendRows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])));
            const rows = source.slice(params.offset, params.offset + params.limit);
            const newest = options.masterRows?.length
              ? [...source].sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || '')))[0] : null;
            return fulfill(route, { ok: true, data: { rows, total: source.length, offset: params.offset, limit: params.limit,
              hasMore: params.offset + rows.length < source.length,
              ...(newest && params.offset === 0 ? { sourceFreshness: { filename: newest.filename, last_updated: newest.last_updated } } : {}) } });
          }
          return fulfill(route, { ok: true, data: { rows: [], total: 0, offset: params.offset, limit: params.limit, hasMore: false } });
        }
        return fulfill(route, { ok: true, data: { filename: null, last_updated: null } });
      }
      // Opening Queue > Location Moves performs this authenticated read. Keep
      // every Location Work mutation blocked while allowing the navigation.
      if (body.action === 'location_work' && body.operation === 'list' && body.status === 'all') {
        return fulfill(route, { ok: true, data: [] });
      }
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      const safeReadOrTelemetry = ['/rest/v1/rpc/get_app_user_directory'];
      if (!safeReadOrTelemetry.includes(url.pathname)) {
        const body = request.postData() || '';
        unexpectedMutations.push(`${request.method()}:${url.pathname}:${body.slice(0, 200)}`);
      }
      return route.abort('blockedbyclient');
    }
    if (url.origin !== origin) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());

  const seed = async (nextRows: FixtureRow[] = backendRows) => {
    await page.waitForFunction(() => (window as any).__gncAppRuntimeExecuted !== false && typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
    await page.evaluate((data) => {
      (window as any).__suspendCompletionFixtureRows = data.rows;
      (window as any).__suspendCompletionMasterRows = data.masterRows;
      window.eval(`(() => {
        if (!installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Isolated Suspend Done Test', 'ADMIN')) {
          throw new Error('SUSPEND_DONE_CANARY_IDENTITY_UNAVAILABLE');
        }
        // Synthetic identity only: real fetchWithTimeout/supabaseRpc still run.
        getNativeAuthRequestHeaders = async () => window.__suspendTestAuthReady ? ({ Authorization: 'Bearer browser-only-no-real-session', apikey: 'browser-only' }) : null;
        requestCapabilityState = {
          status: 'ready', stale: false, errorCode: '', loadedAt: Date.now(), username: 'dylan_collyge',
          capabilities: { username: 'dylan_collyge', scope: 'global', canViewQueue: true, canTakePhoto: true, canEdit: true, canComplete: true, canArchive: true }
        };
        if (window.__suspendCompletionMasterRows.length) {
          nativeAuthSessionActive = true;
          nativeAuthProfile = { id: 'synthetic-suspend-master-snapshot', username: 'dylan_collyge', role: 'ADMIN', active: true };
          nativeAuthAccessToken = 'synthetic-not-a-real-token';
          appAccessSnapshotState = {
            status: 'ready', stale: false, errorCode: '', loadedAt: Date.now(), username: currentUser,
            snapshot: normalizeAppAccessSnapshot({
              contractVersion: APP_ACCESS_CONTRACT_VERSION, enforcementMode: 'enforced',
              username: currentUser, role: currentRole, dataPermissionVersion: 'suspend-fixture-access-1',
              permissions: [{ permissionKey: 'module.request.view', kind: 'module', moduleKey: 'request', allowed: true },
                { permissionKey: 'module.drive.view', kind: 'module', moduleKey: 'drive', allowed: true }]
            }, currentUser)
          };
          // A warm authenticated snapshot includes the permission version
          // learned with its revision metadata, before its scoped receipts.
          productionLiveSyncReadPermissionVersion = appAccessSnapshotState.snapshot.dataPermissionVersion;
          setRoleAccessReadyState(true);
        }
        // Queue is opened after login's initial Home transition. Preference
        // refresh must recheck access without replaying that startup transition.
        hasAppliedInitialHomeView = true;
        appSeasonSettingsCache = { seasonCode: 'F1', salesYear: 27 };
        Object.keys(DATASET_DEFINITIONS).forEach((key) => {
          const state = getDatasetState(key);
          state.initialLoaded = state.fullLoaded = true;
          if (key === 'master') { state.fieldCoverage = 'full'; state.rowCompleteness = 'complete'; }
          state.lastLoadedAt = new Date().toISOString();
        });
        loadDatasetTargetsWithLimit = async (targets = []) => {
          // The production loader publishes only the requested datasets.
          // Unrelated background targets must not replay the Suspend snapshot.
          if (window.__suspendCompletionMasterRows.length && !targets.some(target => target.key === 'suspendTag')) return true;
          const snapshot = structuredClone(window.__suspendCompletionFixtureRows);
          if (window.__suspendCompletionDatasetGate) await window.__suspendCompletionDatasetGate;
          processAndLoadData({ suspendTagData: snapshot, _fromCache: true });
          return true;
        };
        const snapshotContext = getProductionLiveSyncContext();
        processAndLoadData({ suspendTagData: structuredClone(window.__suspendCompletionFixtureRows), requestsData: [],
          data: structuredClone(window.__suspendCompletionMasterRows), socData: structuredClone(window.__suspendCompletionFixtureRows),
          _fromCache: true, _verifiedLiveSync: !!window.__suspendCompletionMasterRows.length,
          _locOnHandReceiptScope: getSupabaseReadIdentityScope(), _locOnHandReceiptPermission: snapshotContext.dataPermissionVersion,
          _locOnHandReceiptRevision: '8277' });
        if (window.__suspendCompletionMasterRows.length) Object.assign(getDatasetState('master'), {
          initialLoaded: true, fullLoaded: true, fieldCoverage: 'full', rowCompleteness: 'complete',
          liveVerifiedScope: snapshotContext.scope, liveVerifiedPermission: snapshotContext.dataPermissionVersion,
          liveVerifiedRevision: '8277'
        });
        document.getElementById('view-login').style.setProperty('display', 'none', 'important');
        document.getElementById('app-wrapper').classList.remove('hidden');
        activeReqTab = 'suspend-tag';
        requestSuspendTagCommonNameSearchTerm = '';
        requestSuspendTagAssignedToFilter = 'all';
        requestSuspendTagContSizeFilter = 'all';
        requestSuspendTagDockFilter = 'all';
        requestSuspendTagStatusFilter = 'active';
        window.__suspendFixtureFetchAbortContext = 'suspend-fixture-request-view-transition';
        showOnlyPrimaryView('request');
        window.__suspendFixtureFetchAbortContext = '';
        if (window.__suspendCompletionMasterRows.length) {
          productionLiveSyncVerifiedView = productionVerifiedViewKey(getProductionLiveSyncContext());
        }
        invalidateResolvedViewStateCaches();
        renderRequest();
      })()`);
    }, { rows: nextRows, masterRows: options.masterRows || [] });
    await expect(page.locator('#view-request')).toBeVisible();
  };
  await page.goto('/?post_deploy_access_canary=1&suspend_tag_canary=1' + (options.search || ''), { waitUntil: 'load' });
  if (options.masterRows?.length) await page.waitForLoadState('networkidle');
  await seed();
  if (options.native) {
    await page.evaluate(() => window.eval(`(() => {
      nativeAuthSessionActive = true;
      nativeAuthProfile = { id: 'synthetic-suspend-live-sync', username: 'dylan_collyge', role: 'ADMIN', active: true };
      nativeAuthAccessToken = 'synthetic-not-a-real-token';
      appAccessSnapshotState = {
        status: 'ready', stale: false, errorCode: '', loadedAt: Date.now(), username: currentUser,
        snapshot: normalizeAppAccessSnapshot({
          contractVersion: APP_ACCESS_CONTRACT_VERSION, enforcementMode: 'enforced',
          username: currentUser, role: currentRole, dataPermissionVersion: 'suspend-fixture-access-1',
          permissions: [{ permissionKey: 'module.request.view', kind: 'module', moduleKey: 'request', allowed: true },
                { permissionKey: 'module.drive.view', kind: 'module', moduleKey: 'drive', allowed: true }]
        }, currentUser)
      };
      setRoleAccessReadyState(true);
      resetProductionLiveSync();
      getProductionLiveSyncCoordinator().check('suspend-fixture-entry');
    })()`));
    await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
  }
  expect(runtimeResponses, 'must exercise the deferred production-built runtime').toHaveLength(1);
  const card = (row: FixtureRow = rows[0]) => page.locator(`#request-content [data-request-uid="dock_suspend_dc_${row.UNIQUE_ID}"]`);
  const done = (row: FixtureRow = rows[0]) => card(row).getByRole('button', { name: 'Complete Tag', exact: true });
  // Legacy Mark Done remains covered separately from the current card's
  // Complete Tag close action. This helper deliberately invokes the retained
  // legacy handler; it does not claim the removed card button still exists.
  const beginLegacyCompletion = async (row: FixtureRow = rows[0]) => {
    await page.evaluate(uid => window.eval(`void completeDockSuspendDcRequestFromCard(${JSON.stringify('dock_suspend_dc_' + uid)}, null)`), row.UNIQUE_ID);
    await expect(page.locator('#app-prompt-dialog')).toContainText('Complete Suspend Tag');
  };
  const activate = (locator: ReturnType<typeof page.locator>) => activateSurface(page, locator);
  const legacyComplete = async (row: FixtureRow = rows[0]) => {
    await beginLegacyCompletion(row);
    await activate(page.locator('#app-prompt-dialog').getByRole('button', { name: 'Mark Done', exact: true }));
  };
  const refresh = async (nextRows: FixtureRow[] = backendRows) => {
    await page.evaluate((data) => {
      (window as any).__suspendCompletionFixtureRows = data;
      window.eval('processAndLoadData({suspendTagData:structuredClone(window.__suspendCompletionFixtureRows),_fromCache:true}); renderRequest();');
    }, nextRows);
  };
  const showStatus = async (status: 'active' | 'completed') => {
    const filters = page.locator('#request-suspend-tag-filter-shell .mobile-browse-filters');
    // The mobile disclosure is decorated on the next animation frame after
    // seeding or reloading. Wait for it before deciding whether to open it.
    if ((page.viewportSize()?.width || 0) <= 767) {
      await expect(filters).toBeVisible();
      if (await filters.getAttribute('open') === null) await filters.locator('summary').click();
    }
    await expect(page.locator('#request-suspend-tag-status-filter')).toBeVisible();
    await page.locator('#request-suspend-tag-status-filter').selectOption(status);
  };
  const nativeRefresh = async (nextRows: FixtureRow[]) => {
    backendRows.splice(0, backendRows.length, ...structuredClone(nextRows));
    nativeRevision++;
    await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().check('suspend-fixture-revision')`));
  };
  const readFetchAbortEvidence = async () => page.evaluate(() => {
    const fixtureWindow = window as Window & { __suspendFixtureFetchAborts?: Array<{ url: string; method: string; context: string; reasonName: string; reasonCode: string; reasonMessage: string; abortStack: string; requestStack: string }> };
    return fixtureWindow.__suspendFixtureFetchAborts || [];
  });
  const assertClean = async () => {
    expect(unexpectedMutations, 'Suspend Tag actions must not bypass the scoped idempotent API with generic writes').toEqual([]);
    expect(blockedReadOnlyAppApiCalls.filter((call) => call !== 'inventory_read:source_freshness' && ![...safeDatasetReads].some((dataset) => call === `dataset_read:${dataset}`))).toEqual([]);
    expect(pageErrors, 'completion must not throw unhandled browser errors').toEqual([]);
    const expectedPhoto404Count = fixtureImage404s.has(knownFixtureImageUrl) ? 1 : 0;
    const onlyKnownFixtureReturned404 = http404Resources.every(resource => resource.url === knownFixtureImageUrl && resource.resourceType === 'image');
    const knownPhoto404Errors = onlyKnownFixtureReturned404
      ? consoleErrors.filter(error => /failed to load resource:.*\b404\b/i.test(error)) : [];
    const unexpectedConsoleErrors = consoleErrors.filter(error => !(/failed to load resource:.*\b404\b/i.test(error) && onlyKnownFixtureReturned404));
    expect(knownPhoto404Errors.length, 'only the routed fixture image may fail with a 404').toBeLessThanOrEqual(expectedPhoto404Count);
    expect(http404Resources.filter(resource => resource.url !== knownFixtureImageUrl || resource.resourceType !== 'image'), 'unexpected 404s retain resource URL and type').toEqual([]);
    expect(unexpectedConsoleErrors, 'release smoke must not emit unexpected browser console errors').toEqual([]);
    expect(healthTelemetryReceipts.every(receipt => receipt.apiKeyPresent
      && (receipt.syntheticIdentity || receipt.authorizationMatchesPublicKey)),
      'health telemetry must be acknowledged only by the local synthetic fixture and never reach Supabase').toBe(true);
    expect(healthTelemetryRequests.every(request => request.method === 'POST' && request.authorizationAllowed && request.apiKeyPresent),
      'health telemetry requests must carry a synthetic session or matching public anon key').toBe(true);
    expect(customerConsigneeReads.every(read => read.status === 200 && read.authorizationAllowed),
      'customer directory fixture reads must be authenticated and fulfilled locally').toBe(true);
    expect(healthTelemetryReceipts.length, 'every captured health event must receive a validated local acknowledgment')
      .toBe(healthTelemetryRequests.length);
    // The local shell logo is requested during initial document paint and can
    // be cancelled when the app replaces its startup surface. Classify only
    // that exact image cancellation; all other aborted reads remain failures.
    const fetchAbortEvidence = await readFetchAbortEvidence();
    const unexpectedFailedResources = failedResources.filter(resource => {
      const failedUrl = new URL(resource.url);
      const intentionalShellLogoCancel = failedUrl.origin === origin
        && failedUrl.pathname === '/assets/branding/ag-data-solutions-logo-v2026080925.png'
        && resource.resourceType === 'image' && resource.failure === 'net::ERR_ABORTED';
      const intentionalRevisionReadSupersededByFixtureTransition = resource.method === 'POST'
        && failedUrl.origin === 'https://kzrnyjsosryejjejliii.supabase.co'
        && failedUrl.pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1'
        && ['Load request cancelled', 'net::ERR_ABORTED'].includes(resource.failure)
        && fetchAbortEvidence.some(evidence => evidence.url === resource.url && evidence.method === 'POST'
          && evidence.reasonName === 'AbortError'
          && (['suspend-fixture-request-view-transition', 'published-lkg-drive-transition'].includes(evidence.context)
            || (evidence.abortStack.includes('invalidateBackground') && evidence.abortStack.includes('live-sync-coordinator.js'))));
      return !intentionalShellLogoCancel && !intentionalRevisionReadSupersededByFixtureTransition;
    });
    expect(unexpectedFailedResources, 'unexpected aborted reads/assets retain URL and resource type evidence').toEqual([]);
  };
  return { requests, replies, receipts, backendRows, inventoryLookupCalls, settingsReads, publishedReadPages, failedResources, consoleErrorDetails, chatParticipantReads, customerConsigneeReads, healthTelemetryRequests, healthTelemetryReceipts, card, done, activate, legacyComplete, beginLegacyCompletion, seed, refresh, nativeRefresh, showStatus, readFetchAbortEvidence, assertClean };
}

async function setDetailMeasurement(page: Page, id: 'req-spec' | 'req-match', value: string) {
  const customKeyboard = await page.evaluate((inputId) =>
    (window as any).shouldPreferDetailMeasurementKeyboard()
      && (window as any).isDetailMeasurementKeyboardInput(document.getElementById(inputId)), id);
  if (!customKeyboard) {
    await page.locator(`#${id}`).fill(value);
    return;
  }
  await activateSurface(page, page.locator(`#${id}`));
  await activateSurface(page, page.locator('#detail-measurement-keyboard').getByRole('button', { name: 'Clear', exact: true }).first());
  for (const digit of value) await activateSurface(page, page.locator(`#detail-measurement-keyboard [data-key-token="${digit}"]`));
  await activateSurface(page, page.locator('#detail-measurement-keyboard [data-key-token="__done"]'));
}

test('legacy Mark Done immediately leaves the active queue, survives stale refresh and reload, and preserves completed approval work', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.legacyComplete();
  await expect.poll(() => app.requests.length).toBe(1);
  await expect(app.card()).toHaveCount(0);
  await app.refresh(fixtures);
  await expect(app.card()).toHaveCount(0);
  await expect(page.locator('#request-content')).not.toContainText('Keep my value');
  await expect(page.locator('#toast-notification')).not.toContainText('Suspend Tag row completed.');
  expect(app.backendRows[0].DATE_COMPLETED).toBe('');
  expect(app.requests[0].body.payload.sourceUid).toBe(fixtures[0].UNIQUE_ID);
  expect(new Date(app.requests[0].body.payload.expectedLastUpdated).toISOString()).toBe(sourceRevision);
  expect(app.requests[0].body.commandId).toMatch(/^[0-9a-f-]{36}$/i);
  release();
  await expect.poll(() => app.receipts.size).toBe(1);
  await expect(app.card()).toHaveCount(0);
  await expect(app.card(fixtures[1])).toHaveCount(1);
  await app.refresh();
  await expect(app.card()).toHaveCount(0);
  await page.reload({ waitUntil: 'load' });
  await app.seed();
  await expect(app.card()).toHaveCount(0);
  await expect(app.done(fixtures[1])).toBeVisible();
  await app.showStatus('completed');
  await expect(app.card()).toContainText('Completed — Ready to Email');
  await expect(app.card().getByRole('button', { name: 'Email', exact: true })).toBeVisible();
  expect(app.backendRows[0].PTRONHAND).toBe('40');
  expect(app.backendRows[0].PTRAVAILABLE).toBe('30');
  expect(app.backendRows[1].DATE_COMPLETED).toBe('');
  expect(app.requests).toHaveLength(1);
  await app.assertClean();
});

test('pastel Suspend cards keep readable text in both themes without removing weekday color', {"tag":["@suspend-tag"]}, async ({ page, baseURL }, info) => {
  const rows = fixtures.map((row, index) => ({ ...row, PLANSTART: index ? '2026-10-13' : '2026-10-12' }));
  const app = await harness(page, baseURL!, rows);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(mode => {
      document.body.classList.toggle('dark-mode', mode === 'dark');
      document.body.dataset.opsTheme = mode;
    }, theme);
    await page.mouse.move(0, 0);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    const evidence = await page.locator('#request-content .app-suspend-tag-compact-card').evaluateAll(cards => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const rgba = (value: string) => {
        // Computed Tailwind colors can be oklch()/color(srgb), not rgb bytes.
        // Let the browser resolve the CSS color before calculating WCAG luminance.
        context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
        const values = context.getImageData(0, 0, 1, 1).data;
        return [values[0], values[1], values[2], values[3] / 255];
      };
      const composite = (paint: number[], base: number[]) => paint.slice(0, 3).map((value, i) => value * paint[3] + base[i] * (1 - paint[3]));
      const luminance = (value: number[]) => value.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const surfaces = (element: Element) => {
        const ancestors: Element[] = [];
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor);
        let colors = [[255, 255, 255]];
        for (const ancestor of ancestors) {
          const style = getComputedStyle(ancestor);
          colors = colors.map(color => composite(rgba(style.backgroundColor), color));
          // A transparent backgroundColor does not describe a painted gradient.
          // Check every endpoint and composite translucent child fills against it.
          const stops = style.backgroundImage.match(/(?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]+\)/g);
          if (stops?.length) colors = colors.flatMap(color => stops.map(stop => composite(rgba(stop), color)));
        }
        return colors;
      };
      return cards.map(card => {
        const samples: Array<{ text: string; color: string; background: number[]; ratio: number }> = [];
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          const element = text.parentElement;
          if (!text.textContent?.trim() || !element || element.closest('button,.app-suspend-tag-actions,.app-drive-card-reclass') || !element.getClientRects().length) continue;
          for (const surface of surfaces(element)) {
            const foreground = luminance(composite(rgba(getComputedStyle(element).color), surface));
            const background = luminance(surface);
            samples.push({ text: text.textContent.trim().slice(0, 60), color: getComputedStyle(element).color,
              background: surface, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) });
          }
        }
        return { tone: card.getAttribute('data-planstart-tone'), background: getComputedStyle(card).backgroundImage,
          textCount: samples.length, minimumContrast: Math.min(...samples.map(sample => sample.ratio)),
          weakest: samples.sort((a, b) => a.ratio - b.ratio).filter(sample => sample.ratio < 4.5) };
      });
    });
    expect(evidence).toHaveLength(2);
    expect(evidence[0].background).not.toBe(evidence[1].background);
    await info.attach(`suspend-${theme}-contrast`, { body: JSON.stringify(evidence), contentType: 'application/json' });
    for (const card of evidence) { expect(card.textCount).toBeGreaterThan(5); expect(card.minimumContrast, JSON.stringify(card.weakest)).toBeGreaterThanOrEqual(4.5); }
  }
  await app.assertClean();
});

test('background Suspend revision preserves card identity and layout while updating its content', {"tag":["@suspend-tag"]}, async ({ page, baseURL }, info) => {
  const app = await harness(page, baseURL!, fixtures, { native: true });
  const card = app.card();
  await expect(card).toBeVisible();
  // Wait for the real hydration read before isolating the subsequent revision.
  // Otherwise the baseline itself changes from unknown to verified inventory.
  await expect.poll(() => app.inventoryLookupCalls.filter(call => call.status === 200).length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.eval(`
    Array.from(suspendTagReclassLoads.values()).filter(entry => entry.row && !entry.promise && !entry.error).length
  `))).toBe(2);
  await expect(card.locator('[data-suspend-tag-reclass-uid]')).toHaveCount(0);
  // The synthetic photo intentionally fails. Settle its display-only fallback
  // before measuring a separate revision of the already hydrated card.
  await expect.poll(() => card.locator('img').evaluateAll(images => images.map(image => ({
    source: image.getAttribute('data-src'), src: image.getAttribute('src'),
    hydrated: image.getAttribute('data-photo-hydrated'), failed: image.getAttribute('data-photo-load-failed'),
    observed: image.getAttribute('data-photo-observed'), complete: image.complete,
    errorHandler: typeof image.onerror
  }))), { message: 'The visible synthetic photo must settle its fallback before the revision baseline' })
    .toEqual([expect.objectContaining({ hydrated: '1', failed: '1' })]);
  await expect(card.locator('[data-loc-photo-match-value]')).toHaveText(['N/A', 'N/A']);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const beforeNode = await card.elementHandle();
  const before = await card.boundingBox();
  const beforeContent = await card.innerText();
  const beforeScroll = await page.locator('#main-scroll-area').evaluate(element => element.scrollTop);
  type LayoutRect = { x: number; y: number; width: number; height: number } | null;
  type LayoutSample = {
    phase: string; at: number; filterShellId: number | null; railId: number | null; detailsId: number | null;
    detailsOpen: boolean | null; shell: LayoutRect; rail: LayoutRect; details: LayoutRect; panel: LayoutRect;
    panelDisplay: string | null; panelPosition: string | null; card: LayoutRect;
  };
  type LayoutDiagnostics = {
    samples: LayoutSample[];
    mutations: Array<{ at: number; records: Array<{ type: string; targetId: number | null; attribute: string | null; added: string[]; removed: string[] }> }>;
    overflow: boolean;
    final: { shell: LayoutRect; rail: LayoutRect; detailsOpen: boolean | null; details: LayoutRect; panel: LayoutRect; card: LayoutRect; panelDisplay: string | null; panelPosition: string | null; rootScrollTop: number | null };
  };
  await page.evaluate(() => window.eval(`(() => {
    const root = document.getElementById('request-content');
    const maxEvents = 1000;
    const ids = new WeakMap(); let nextId = 1; let stopped = false;
    let rafId = 0;
    const id = node => { if (!node) return null; if (!ids.has(node)) ids.set(node, nextId++); return ids.get(node); };
    const rect = node => { if (!node) return null; const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    const stop = () => { stopped = true; observer.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
    const sample = phase => {
      if (window.__suspendLayoutDiagnostic.samples.length >= maxEvents) { window.__suspendLayoutDiagnostic.overflow = true; stop(); return; }
      const filterShell = document.getElementById('request-suspend-tag-filter-shell');
      const rail = filterShell && filterShell.querySelector('.request-view-filters');
      const details = rail && rail.querySelector('details.mobile-browse-filters');
      const panel = details && details.querySelector('.mobile-browse-filter-panel');
      const card = document.querySelector('#request-content [data-request-uid="dock_suspend_dc_browser-suspend-1"]');
      const style = panel ? getComputedStyle(panel) : null;
      window.__suspendLayoutDiagnostic.samples.push({
        phase, at: performance.now(), filterShellId:id(filterShell), railId:id(rail), detailsId:id(details),
        detailsOpen: details ? details.open : null, shell:rect(filterShell), rail:rect(rail), details:rect(details),
        panel:rect(panel), panelDisplay:style && style.display, panelPosition:style && style.position, card:rect(card)
      });
    };
    const observer = new MutationObserver(records => {
      const remaining = maxEvents - window.__suspendLayoutDiagnostic.mutationRecordCount;
      if (remaining <= 0) { window.__suspendLayoutDiagnostic.overflow = true; stop(); return; }
      const retainedRecords = records.slice(0, remaining);
      if (retainedRecords.length < records.length) window.__suspendLayoutDiagnostic.overflow = true;
      window.__suspendLayoutDiagnostic.mutations.push({
        at: performance.now(), records: retainedRecords.map(record => ({type:record.type,targetId:id(record.target),attribute:record.attributeName,
          added:Array.from(record.addedNodes || []).map(node => node.nodeName + (node.id ? '#' + node.id : '')),
          removed:Array.from(record.removedNodes || []).map(node => node.nodeName + (node.id ? '#' + node.id : ''))}))
      });
      window.__suspendLayoutDiagnostic.mutationRecordCount += retainedRecords.length;
      sample('mutation');
    });
    window.__suspendLayoutDiagnostic = {samples:[],mutations:[],mutationRecordCount:0,overflow:false,stop};
    sample('before-refresh');
    if (root) observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class']});
    const frame = () => { sample('raf'); if (!stopped) rafId = requestAnimationFrame(frame); };
    rafId = requestAnimationFrame(frame);
  })()`));
  let layoutDiagnostics: LayoutDiagnostics | null;
  try {
    await app.nativeRefresh(fixtures.map(row => ({ ...row, COMMONNAME: String(row.COMMONNAME).replace('fixture', 'updated') })));
    await expect(card).toContainText('Suspend browser updated 1');
  } finally {
    layoutDiagnostics = await page.evaluate(() => window.eval(`(() => {
      const diagnostic = window.__suspendLayoutDiagnostic;
      if (!diagnostic) return null;
      const root = document.getElementById('request-content');
      const filterShell = document.getElementById('request-suspend-tag-filter-shell');
      const rail = filterShell && filterShell.querySelector('.request-view-filters');
      const details = rail && rail.querySelector('details.mobile-browse-filters');
      const panel = details && details.querySelector('.mobile-browse-filter-panel');
      const card = document.querySelector('#request-content [data-request-uid="dock_suspend_dc_browser-suspend-1"]');
      const r = node => { if (!node) return null; const b=node.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; };
      diagnostic.stop();
      return {samples:diagnostic.samples,mutations:diagnostic.mutations,overflow:diagnostic.overflow,final:{
        shell:r(filterShell),rail:r(rail),detailsOpen:details ? details.open : null,details:r(details),panel:r(panel),card:r(card),
        panelDisplay:panel && getComputedStyle(panel).display,panelPosition:panel && getComputedStyle(panel).position,
        rootScrollTop:root && root.scrollTop
      }};
    })()`) as unknown as LayoutDiagnostics | null);
    if (layoutDiagnostics) await info.attach('suspend-layout-timeline', { body: JSON.stringify(layoutDiagnostics), contentType: 'application/json' });
  }
  expect(await beforeNode?.evaluate(node => node.isConnected)).toBe(true);
  const after = await card.boundingBox();
  const afterContent = await card.innerText();
  const afterScroll = await page.locator('#main-scroll-area').evaluate(element => element.scrollTop);
  expect(before).not.toBeNull(); expect(after).not.toBeNull();
  await info.attach('suspend-background-dom-stability', { body: JSON.stringify({ before, after, beforeContent, afterContent, beforeScroll, afterScroll, retainedNode: true, layoutDiagnostics }), contentType: 'application/json' });
  for (const field of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after![field] - before![field])).toBeLessThanOrEqual(1);
  expect(layoutDiagnostics, 'must capture the filter/card timeline across refresh').not.toBeNull();
  if (!layoutDiagnostics) throw new Error('Missing Suspend layout diagnostic timeline');
  const baselineSample = layoutDiagnostics.samples.find(sample => sample.phase === 'before-refresh');
  expect(baselineSample, 'must capture the rendered filter/card baseline before the revision').toBeDefined();
  if (!baselineSample?.card || !baselineSample.rail) throw new Error('Missing baseline card or filter rail geometry');
  expect(layoutDiagnostics?.overflow, 'layout diagnostics must remain complete').toBe(false);
  for (const sample of layoutDiagnostics.samples) {
    if (sample.at < baselineSample.at) continue;
    expect(sample.card, `card must remain measurable during ${sample.phase} at ${sample.at}ms`).not.toBeNull();
    if (!sample.card || !sample.rail) throw new Error(`Missing card or filter rail geometry during ${sample.phase} at ${sample.at}ms`);
    expect(Math.abs(sample.card.y - baselineSample.card.y), `card y must remain stable during ${sample.phase} at ${sample.at}ms`).toBeLessThanOrEqual(1);
    expect(Math.abs(sample.rail.height - baselineSample.rail.height), `filter rail height must remain stable during ${sample.phase} at ${sample.at}ms`).toBeLessThanOrEqual(1);
  }
  await app.assertClean();
});

test('canceling confirmation retains the row and makes no completion request', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await app.beginLegacyCompletion();
  await app.activate(page.locator('#app-prompt-dialog').getByRole('button', { name: 'Keep Pending', exact: true }));
  await expect(app.done()).toBeEnabled();
  expect(app.requests).toHaveLength(0);
  await app.assertClean();
});

test('Complete Tag saves and removes the row from the active Suspend view', {"tag":["@suspend-tag","@v2311-workflow"]}, async ({ page, baseURL }, info) => {
  const representativeRows=Array.from({length:1000},(_,index)=>({...fixtures[index%2],UNIQUE_ID:'browser-suspend-'+(index+1)}));
  const app = await harness(page, baseURL!, representativeRows);
  const row = app.backendRows[0];
  const uniqueId = row.UNIQUE_ID;
  let release!: () => void;
  app.replies.push({ operation:'close', wait:new Promise<void>(resolve => { release=resolve; }) });
  // Establish the active list through the same filter path used by the UI.
  await app.showStatus('active');
  await expect(app.card(row)).toBeVisible();
  // Start the warm action with its control on screen, after initial rendering.
  await app.done(row).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.eval(`(() => {
    const names=['syncIosFixedTopChromeMetrics','syncIosBottomNavViewportLock','auditIosFixedShellGap','syncViewportHeight','renderRequest'];
    const diagnostic={phase:'settling',visibility:document.visibilityState,hasFocus:document.hasFocus(),functions:Object.create(null)};
    window.__v2311ShellDiagnostic=diagnostic;
    for(const name of names){
      const original=window[name];
      if(typeof original!=='function')continue;
      diagnostic.functions[name]={settling:{count:0,totalMs:0,maxMs:0},action:{count:0,totalMs:0,maxMs:0}};
      window[name]=function(...args){
        const started=performance.now();
        try{return original.apply(this,args)}
        finally{const elapsed=performance.now()-started;const bucket=diagnostic.functions[name][diagnostic.phase==='action'?'action':'settling'];bucket.count++;bucket.totalMs+=elapsed;bucket.maxMs=Math.max(bucket.maxMs,elapsed)}
      };
    }
  })()`));
  await page.evaluate(async () => {
    await document.fonts.ready;
    const gaps:number[]=[];
    let previous=performance.now();
    for(let frame=0;frame<4;frame++)await new Promise<void>(resolve=>requestAnimationFrame(()=>{
      const now=performance.now();gaps.push(now-previous);previous=now;resolve();
    }));
    const diagnostic=(window as Window & {__v2311ShellDiagnostic?:{phase:string;settledFrameGaps?:number[]}}).__v2311ShellDiagnostic;
    if(diagnostic){diagnostic.settledFrameGaps=gaps;diagnostic.phase='idle'}
  });
  await page.evaluate(uid => {
    const selector='#request-content [data-request-uid="dock_suspend_dc_'+uid+'"]';
    const probe={started:0,domMs:-1,paintMs:-1, mountedRows:document.querySelectorAll('#request-content [data-request-uid]').length,
      settledFrameGaps:(window as Window & {__v2311ShellDiagnostic?:{settledFrameGaps?:number[]}}).__v2311ShellDiagnostic?.settledFrameGaps,
      shellFunctions:(window as Window & {__v2311ShellDiagnostic?:{functions?:Record<string,unknown>}}).__v2311ShellDiagnostic?.functions,
      visibility:document.visibilityState,hasFocus:document.hasFocus(),
      chromeBackdropFilters:Array.from(document.querySelectorAll('#app-top-chrome,#bottom-nav,.fixed-filter-rail')).map(element=>({id:element.id,filter:getComputedStyle(element).backdropFilter}))};
    Object.assign(window,{__v2311CompleteTagProbe:probe});
    window.addEventListener('click', event => {
      if (!(event.target instanceof Element) || !event.target.closest(selector+' [data-action="complete-tag"]')) return;
      const diagnostic=(window as Window & {__v2311ShellDiagnostic?:{phase:string}}).__v2311ShellDiagnostic;
      if(diagnostic)diagnostic.phase='action';
      probe.started=performance.now();
      const observer=new MutationObserver(() => {
        if(document.querySelector(selector))return;
        probe.domMs=performance.now()-probe.started;observer.disconnect();
        probe.paintRafRequestedAt=performance.now();
        requestAnimationFrame(timestamp=>{probe.paintRafTimestamp=timestamp;probe.paintCallbackAt=performance.now();probe.paintMs=probe.paintCallbackAt-probe.started;});
      });
      observer.observe(document.getElementById('request-content')!,{childList:true,subtree:true});
    },{capture:true,once:true});
  }, uniqueId);
  try {
    await app.activate(app.done(row));
    // Keep the paint probe passive: queue-count scans and locator assertions
    // below must not compete with the first frame being measured.
    await page.waitForFunction(()=>Number((window as Window & {__v2311CompleteTagProbe?:{paintMs:number}}).__v2311CompleteTagProbe?.paintMs)>=0);
    const metric=await page.evaluate(()=>(window as Window & {__v2311CompleteTagProbe?:{domMs:number;paintMs:number}}).__v2311CompleteTagProbe!);
    await info.attach('v2311-optimistic-completion.json',{body:JSON.stringify({...metric,rows:1000,environment:info.project.name,cache:'warm',backendAcknowledgmentHeld:true}),contentType:'application/json'});
    expect(metric.domMs).toBeLessThan(50);
    // Explicit user allowance for Windows emulated iPhone frame scheduling.
    const paintBudgetMs = info.project.name === 'v2311-iphone-webkit' ? 350 : 50;
    expect(metric.paintMs).toBeLessThan(paintBudgetMs);
    await expect(app.card(row)).toHaveCount(0);
    await expect(page.locator('#request-open-info-modal')).toBeHidden();
    await expect(page.locator('#view-detail')).toBeHidden();
    await expect(page.locator('#app-prompt-dialog')).toBeHidden();
    expect(app.backendRows.find(candidate=>candidate.UNIQUE_ID===uniqueId)?.SUSPEND_TAG_STATUS).toBe('pending');
    const suspendCategory = page.locator('[data-request-category="suspend-tag"]');
    const suspendBackingCount = await page.evaluate(() => window.eval("getRequestTabQueueCounts()['suspend-tag']"));
    expect(suspendBackingCount).toBe(999);
    await expect(suspendCategory.locator('.request-category-chip__count')).toHaveText('99+');
  } finally { release(); }
  await expect.poll(() => app.requests.map(request => request.body.operation)).toEqual(['close']);
  await expect.poll(()=>app.backendRows.find(candidate=>candidate.UNIQUE_ID===uniqueId)?.SUSPEND_TAG_STATUS).toBe('completed');
  await app.assertClean();
});

test('v2312 Suspend metric rerender keeps a warm 100-card window painted within 1200 ms @v2312-ui', { tag: ['@v2312-ui'] }, async ({ page, baseURL }, info) => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    ...fixtures[index % fixtures.length],
    UNIQUE_ID: `browser-suspend-${index + 1}`,
    MASTER_UNIQUE_ID: `master-browser-suspend-${index + 1}`,
    ITEMCODE: `BROWSER-ONLY-SUSPEND-${index + 1}`,
    LOCATIONCODE: `B.${String(index + 1).padStart(2, '0')}.000`,
    S_LTS: String(100 + index),
    PTRAVAILABLE: String(30 + index),
    PTRONHAND: String(40 + index),
  }));
  const app = await harness(page, baseURL!, rows, { native: true, search: '&shellv=AgData%20v2.3.12' });
  await app.showStatus('active');
  await expect(app.card(rows[0])).toBeVisible();
  const cards = page.locator('#request-content [data-request-uid]');
  await expect.poll(() => cards.count(), { timeout: 30000 }).toBe(100);
  const firstOpenStock = page.locator('#request-content [data-request-uid="dock_suspend_dc_browser-suspend-1"] [data-inventory-card-metric="open-stock"] .app-card-qty-value');
  await expect(firstOpenStock).toHaveText('100');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

  await page.evaluate(() => {
    const win = window as Window & { __suspendMetricPerfResult?: Record<string, unknown> };
    const container = document.getElementById('request-content');
    const target = container?.querySelector<HTMLElement>('[data-request-uid="dock_suspend_dc_browser-suspend-1"] [data-inventory-card-metric="open-stock"] .app-card-qty-value');
    if (!container || !target) throw new Error('SUSPEND_METRIC_TARGET_NOT_MOUNTED');
    const work = window.eval(`(() => {
      const samples = {};
      for (const name of ['generateCard', 'renderRequest', 'buildSuspendTagRenderPlan', 'getScopedRequestItems', 'repairVisibleDockSuspendDcPlanstartCardTones', 'decorateRequestRows']) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        samples[name] = { calls: 0, ms: 0 };
        window[name] = function (...args) {
          const started = performance.now();
          try { return original.apply(this, args); }
          finally { samples[name].calls += 1; samples[name].ms += performance.now() - started; }
        };
      }
      return samples;
    })()`);
    const probe: Record<string, unknown> = { startedAt: performance.now(), domMs: null, paintMs: null, before: target.textContent?.trim() || '', work };
    win.__suspendMetricPerfResult = probe;
    const observer = new MutationObserver(() => {
      const current = container.querySelector<HTMLElement>('[data-request-uid="dock_suspend_dc_browser-suspend-1"] [data-inventory-card-metric="open-stock"] .app-card-qty-value');
      if (!current || current.textContent?.trim() !== '101') return;
      observer.disconnect();
      probe.domMs = performance.now() - Number(probe.startedAt);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const rect = current.getBoundingClientRect();
        probe.paintMs = performance.now() - Number(probe.startedAt);
        probe.value = current.textContent?.trim() || '';
        probe.visible = rect.width > 0 && rect.height > 0;
        probe.whiteSpace = getComputedStyle(current).whiteSpace;
        probe.scrollWidth = current.scrollWidth;
        probe.clientWidth = current.clientWidth;
        probe.mounted = container.querySelectorAll('[data-request-uid]').length;
        probe.sourceRows = (window as Window & { __suspendCompletionFixtureRows?: unknown[] }).__suspendCompletionFixtureRows?.length || 0;
        const numericMetrics = Array.from(container.querySelectorAll<HTMLElement>('[data-inventory-card-metric] .app-card-qty-value'))
          .filter(value => /^-?\d[\d,]*(?:\.\d+)?%?$/.test(value.textContent?.trim() || ''));
        probe.numericMetricCells = numericMetrics.length;
        probe.numericValuesNowrap = numericMetrics.every(value => getComputedStyle(value).whiteSpace === 'nowrap');
        probe.numericValuesFit = numericMetrics.every(value => value.scrollWidth <= value.clientWidth + 1);
      }));
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    window.eval(`(() => {
      const queueRow = window.__suspendCompletionFixtureRows?.[0];
      const state = queueRow ? getQueueCardInventoryState(queueRow, 'request') : null;
      if (!state || state.status !== 'ready' || !state.row) {
        throw new Error('SUSPEND_METRIC_VERIFIED_QUEUE_ROW_NOT_READY:' + String(state?.status || 'missing'));
      }
      // Mutate the revision- and identity-verified master row cached by the
      // real master_identity_batch hydrator, then exercise the real renderer.
      state.row.S_LTS = '101'; state.row.s_lts = '101';
      // Match the native hydrator onChange invalidation before rendering.
      queueCardInventoryRenderVersion += 1;
      markViewDirty('request');
      renderRequest();
    })()`);
  });
  await page.waitForFunction(() => {
    const paintMs = (window as Window & { __suspendMetricPerfResult?: { paintMs?: number } }).__suspendMetricPerfResult?.paintMs;
    return typeof paintMs === 'number' && Number.isFinite(paintMs);
  }, null, { timeout: 15000 });
  const result = await page.evaluate(() => (window as Window & { __suspendMetricPerfResult?: Record<string, unknown> }).__suspendMetricPerfResult);
  await info.attach('v2312-suspend-metric-render.json', { body: JSON.stringify({ ...result, project: info.project.name, cache: 'warm after initial 100-card page', fixtureAuth: true, realAuth: false, fixture: 'synthetic authenticated read-only harness' }), contentType: 'application/json' });
  expect(result?.sourceRows).toBe(1000);
  expect(result?.mounted).toBe(100);
  expect(result?.value).toBe('101');
  expect(result?.visible).toBe(true);
  expect(result?.whiteSpace).toBe('nowrap');
  expect(Number(result?.numericMetricCells)).toBeGreaterThan(0);
  expect(result?.numericValuesNowrap).toBe(true);
  expect(result?.numericValuesFit).toBe(true);
  // Explicit user waiver: only this synthetic local rendering check is below 1,200 ms.
  expect(result?.paintMs).toBeLessThan(1200);
  await expect(cards).toHaveCount(100);
  await app.assertClean();
});

test('Suspend filters stay in the view, preserve a restored choice across Queue tabs, and Clear Filters restores rows on phone', {"tag":["@suspend-tag"]}, async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await harness(page, baseURL!);
  const shell = page.locator('#request-suspend-tag-filter-shell');
  const category = (name: string) => page.locator(`#request-filter-toolbar [data-request-category="${name}"]`);
  const controls = [
    shell.locator('#request-suspend-tag-common-search'),
    shell.locator('#request-suspend-tag-assigned-filter'),
    shell.locator('#request-suspend-tag-contsize-filter'),
    shell.locator('#request-suspend-tag-dock-filter'),
  ];

  await expect(shell).toBeVisible();
  await expect(page.locator('#request-search-container')).toBeHidden();
  await expect(page.locator('#request-filter-toolbar .workflow-control')).toHaveCount(0);
  await expect(category('suspend-tag')).toContainText('2');
  const compactFilters = shell.locator('.mobile-browse-filters');
  await expect(compactFilters.locator('summary')).toHaveText('Filters');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await compactFilters.locator('summary').click();
  await expect(compactFilters).toHaveAttribute('open', '');
  await expect(compactFilters.locator('.mobile-browse-filter-panel')).toBeVisible();
  for (const control of controls) await expect(control).toBeVisible();

  // Dylan's old shared Queue filter is deliberately nonmatching. It remains
  // available to Request/reps, but cannot narrow Suspend rows or its badge.
  await page.evaluate(() => window.eval(`(() => {
    requestDylanFilterMode = 'salesrep';
    requestDylanFilterValue = '["not-a-suspend-fixture"]';
    requestDylanLocationValue = '["NO.SUCH.LOCATION"]';
    renderRequest();
  })()`));
  await expect(app.card()).toHaveCount(1);
  await expect(app.card(fixtures[1])).toHaveCount(1);
  await expect(category('suspend-tag')).toContainText('2');

  // Simulate restoring a valid saved Suspend-only choice whose source rows no
  // longer exist.  The actual capture/restore path must retain that selection.
  await page.evaluate(() => window.eval(`(() => {
    requestSuspendTagDockFilter = 'dock:99';
    const saved = captureRequestViewState();
    requestSuspendTagDockFilter = 'all';
    restoreRequestViewState(saved);
    renderRequest();
  })()`));
  await expect(shell.locator('#request-suspend-tag-dock-filter')).toHaveValue('dock:99');
  await expect(page.locator('#request-suspend-tag-results')).toContainText('No suspend tag rows match these filters.');
  await expect(category('suspend-tag')).toContainText('2');
  await page.screenshot({ path: info.outputPath('suspend-empty-filter-phone.png'), fullPage: true });
  const clear = shell.locator('#request-suspend-tag-clear-filters');
  await expect(clear).toBeInViewport();

  // Category navigation remains in the global header.  Suspend-only state
  // neither changes Request/Moves nor disappears when returning to Suspend.
  await category('pending').click();
  await expect(category('pending')).toHaveAttribute('aria-pressed', 'true');
  await expect(shell).toHaveCount(0);
  await expect(page.locator('#request-content')).not.toContainText('No suspend tag rows match these filters.');
  await category('moves').click();
  await expect(category('moves')).toHaveAttribute('aria-pressed', 'true');
  await expect(shell).toHaveCount(0);
  await category('suspend-tag').click();
  await expect(shell.locator('#request-suspend-tag-dock-filter')).toHaveValue('dock:99');
  await expect(page.locator('#request-suspend-tag-results')).toContainText('No suspend tag rows match these filters.');

  await clear.click();
  await expect(shell.locator('#request-suspend-tag-dock-filter')).toHaveValue('all');
  await expect(app.card()).toHaveCount(1);
  await expect(app.card(fixtures[1])).toHaveCount(1);
  await expect(page.locator('#request-suspend-tag-results')).not.toContainText('No suspend tag rows match these filters.');
  await app.assertClean();
});

test('bounded Suspend Tag cards and filters remain reachable at 320, 390 and 430 pixels', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.eval('renderRequest();'));
    const filters = page.locator('#request-suspend-tag-filter-shell .mobile-browse-filters');
    await expect(app.card()).toBeVisible();
    await filters.locator('summary').click();
    await expect(filters.locator('.mobile-browse-filter-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await filters.locator('summary').click();
  }
  await app.assertClean();
});

test('legacy Mark Done double activation sends one completion even through a stale rerendered button', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.legacyComplete();
  await expect.poll(() => app.requests.length).toBe(1);
  await page.evaluate((uid) => window.eval(`void completeDockSuspendDcRequestFromCard(${JSON.stringify('dock_suspend_dc_' + uid)}, null)`), fixtures[0].UNIQUE_ID);
  await expect(page.locator('#app-prompt-dialog')).toBeHidden();
  await expect(app.card()).toHaveCount(0);
  expect(app.requests).toHaveLength(1);
  release();
  await expect.poll(() => app.receipts.size).toBe(1);
  await expect(app.card()).toHaveCount(0);
  expect(app.receipts.size).toBe(1);
  await app.assertClean();
});

test('lost response leaves row actionable and retry after reload reuses the persisted request token', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  app.replies.push({ abort: true, commitBeforeAbort: true });
  await app.legacyComplete();
  await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind', 'error');
  await expect(app.done()).toBeEnabled();
  expect(app.requests).toHaveLength(1);
  const token = app.requests[0].body.commandId;
  // Simulate cached data after a lost response, while the backend retains Done.
  await page.reload({ waitUntil: 'load' });
  await app.seed(fixtures);
  await app.legacyComplete();
  await expect.poll(() => app.requests.length).toBe(2);
  await expect(app.card()).toHaveCount(0);
  expect(app.requests).toHaveLength(2);
  expect(app.requests[1].body.commandId).toBe(token);
  expect(app.receipts.size).toBe(1);
  await app.assertClean();
});

for (const failure of [
  { status: 401, message: 'Session expired. Sign in again to complete Suspend Tag.' },
  { status: 403, message: 'You do not have permission to complete Suspend Tag.' },
  { status: 400, message: 'Suspend Tag source revision is required.' },
  { status: 409, message: 'Suspend Tag row changed. Refresh and review before completing.' },
]) {
  test(`HTTP ${failure.status} preserves actionable row and shows the actual error`, {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
    const app = await harness(page, baseURL!);
    app.replies.push({ status: failure.status, body: { code: String(failure.status), message: failure.message } });
    await app.legacyComplete();
    await expect(page.locator('#toast-notification')).toContainText(failure.message);
    await expect(app.done()).toBeEnabled();
    await app.refresh();
    await expect(app.done()).toBeEnabled();
    expect(app.backendRows[0].DATE_COMPLETED).toBe('');
    expect(app.requests).toHaveLength(1);
    await app.assertClean();
  });
}

test('malformed or mismatched acknowledgment never marks the row completed', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  for (const body of [
    { ok: true, sourceUid: 'another-source', completedAt: completionTime, sourceLastUpdated: sourceRevision, alreadyCompleted: false },
    { ok: true, sourceUid: fixtures[0].UNIQUE_ID, completedAt: '', sourceLastUpdated: sourceRevision, alreadyCompleted: false },
    { ok: false, sourceUid: fixtures[0].UNIQUE_ID, completedAt: completionTime, sourceLastUpdated: sourceRevision, alreadyCompleted: false },
    { ok: true, sourceUid: fixtures[0].UNIQUE_ID, completedAt: completionTime, sourceLastUpdated: '2026-09-08T16:00:00.000Z', alreadyCompleted: false },
    { ok: true, sourceUid: fixtures[0].UNIQUE_ID, completedAt: completionTime, sourceLastUpdated: sourceRevision },
  ]) {
    app.replies.push({ body });
    await app.legacyComplete();
    await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind', 'error');
    await expect(app.done()).toBeEnabled();
    await expect(app.card()).toHaveCount(1);
  }
  expect(app.receipts.size).toBe(0);
  await app.assertClean();
});

test('a stale snapshot cannot restore Done, but a newer reopened source stays visible', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await app.legacyComplete();
  await expect.poll(() => app.receipts.size).toBe(1);
  await expect(app.card()).toHaveCount(0);
  await app.refresh(fixtures);
  await expect(app.card()).toHaveCount(0);
  const reopened = fixtures.map((row) => ({ ...row, LAST_UPDATED: '2026-09-08T16:00:00.000Z' }));
  await app.refresh(reopened);
  await expect(app.done()).toBeVisible();
  await app.assertClean();
});

test('an old completion response cannot hide a newer reopened version of the source', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.legacyComplete();
  await expect.poll(() => app.requests.length).toBe(1);
  const reopened = fixtures.map((row) => ({ ...row, LAST_UPDATED: '2026-09-08T16:00:00.000Z' }));
  await app.refresh(reopened);
  release();
  await expect.poll(() => app.receipts.size).toBe(1);
  await expect(app.done()).toBeVisible();
  await expect(app.done()).toBeEnabled();
  await app.assertClean();
});


test('detail Mark Done stays in detail until the global save is confirmed, then returns to Suspend', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ operation: 'complete', wait: new Promise<void>((resolve) => { release = resolve; }) });
  await page.evaluate(() => window.eval("openDockSuspendDcRequestUpdate('dock_suspend_dc_browser-suspend-1')"));
  await expect(page.locator('#request-open-info-modal')).toBeVisible();
  await app.activate(page.locator('#request-open-info-ok'));
  await expect(page.locator('#req-btn-save-complete')).toBeVisible();
  await page.waitForFunction(() => !(window as any).isDetailTransitionActive());
  await setDetailMeasurement(page, 'req-spec', '24');
  await setDetailMeasurement(page, 'req-match', '80');
  if (await page.locator('.request-av-note-sheet__close').isVisible()) await app.activate(page.locator('.request-av-note-sheet__close'));

  await app.activate(page.locator('#req-btn-save-complete'));
  await expect.poll(() => app.requests.filter(request => request.body.operation === 'complete').length).toBe(1);
  await expect(page.locator('#view-detail')).toBeVisible();
  await expect(page.locator('#req-spec')).toHaveValue('24');
  await expect(page.locator('#req-match')).toHaveValue('80');
  expect(app.backendRows[0].DATE_COMPLETED).toBe('');

  release();
  await expect(page.locator('#view-detail')).toBeHidden();
  await expect(page.locator('#view-request')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.eval('activeReqTab'))).toBe('suspend-tag');
  await expect(app.card()).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.eval('Object.keys(getDockSuspendCompletionState().receipts).length'))).toBe(1);
  expect(app.backendRows[0].DOCK_SPEC).toBe('24');
  expect(String(app.backendRows[0].MATCH)).toBe('80');
  await app.assertClean();
});

test('v2311 Item Detail uses shared AV options and saves a note without spec or caliper', {tag:['@v2311-workflow']}, async ({page,baseURL})=>{
  const app=await harness(page,baseURL!);
  await page.evaluate(rows=>{
    const note = 'UPDATED NOTE WITHOUT SPEC';
    Object.assign(window,{__v2311DetailMaster:rows.map(row=>({...row,UNIQUE_ID:'master-'+row.UNIQUE_ID,SPEC:'',CALIPER:''})),__v2311DetailAvNotes:rows.map(row=>({COMMONNAME:row.COMMONNAME,SALESNOTE:note}))});
    window.eval('processAndLoadData({data:window.__v2311DetailMaster,avNotesData:window.__v2311DetailAvNotes,_fromCache:true}); const master=getDatasetState("master"); master.initialLoaded=master.fullLoaded=true; master.fieldCoverage="full"; master.rowCompleteness="complete"; const notes=getDatasetState("avNotes"); notes.initialLoaded=notes.fullLoaded=true;');
  },fixtures);
  await page.evaluate(()=>window.eval("openDockSuspendDcRequestUpdate('dock_suspend_dc_browser-suspend-1')"));
  await expect(page.locator('#request-open-info-modal')).toBeVisible();
  await app.activate(page.locator('#request-open-info-ok'));
  await expect(page.locator('#req-btn-save-complete')).toBeVisible();
  await page.waitForFunction(()=>!(window as any).isDetailTransitionActive());
  await expect(page.locator('#req-spec')).toHaveValue('');
  await expect(page.locator('#req-caliper')).toHaveValue('');
  await expect.poll(()=>page.evaluate(()=>window.eval('getRequestSharedInventoryOptionRows(activeItem).length'))).toBeGreaterThan(0);
  await expect(page.locator('#view-detail')).not.toContainText('Could not load AV options right now.');
  const avHeader=page.locator('#detail-av-options-panel .request-av-options-header');
  await app.activate(avHeader);
  await expect(page.locator('#detail-av-options-panel [data-request-itemcode-option-card]')).toHaveCount(1);
  await app.activate(avHeader);
  const avNoteInput = page.locator('#req-av-note');
  await expect(page.locator('[data-av-note-dropdown-trigger="req-"]')).toBeVisible();
  await app.activate(page.locator('[data-av-note-dropdown-trigger="req-"]'));
  const noteSheet=page.locator('#request-av-note-sheet');
  await expect(noteSheet).toBeVisible();
  await page.locator('#request-av-note-sheet-search').fill('UPDATED NOTE WITHOUT SPEC');
  const noteOption=noteSheet.locator('[data-av-note-option="UPDATED NOTE WITHOUT SPEC"]');
  await expect(noteOption).toBeVisible();
  await app.activate(noteOption);
  await expect(avNoteInput).toHaveValue('UPDATED NOTE WITHOUT SPEC');
  await expect.poll(() => page.evaluate(() => window.eval('getDockSuspendDcRequestFormValues(activeItem).avNote'))).toBe('UPDATED NOTE WITHOUT SPEC');
  if(await page.locator('.request-av-note-sheet__close').isVisible())await app.activate(page.locator('.request-av-note-sheet__close'));
  await app.activate(page.locator('#req-btn-save-complete'));
  await expect.poll(()=>app.backendRows[0].SUSPEND_TAG_STATUS).toBe('completed');
  expect(app.backendRows[0].AV_NOTE).toBe('UPDATED NOTE WITHOUT SPEC');
  await expect(page.locator('#view-detail')).toBeHidden();
  await expect(app.card()).toHaveCount(0);
  await expect(page.locator('#toast-notification')).not.toContainText('Spec and caliper are blank');
  await app.assertClean();
});

test('detail Mark Done completes and returns to Suspend when background inventory refresh is unavailable', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const app = await harness(page, baseURL!, fixtures, { inventoryUnavailable: true });
  await page.evaluate(() => window.eval("openDockSuspendDcRequestUpdate('dock_suspend_dc_browser-suspend-1')"));
  await expect(page.locator('#request-open-info-modal')).toBeVisible();
  await app.activate(page.locator('#request-open-info-ok'));
  await expect(page.locator('#req-btn-save-complete')).toBeVisible();
  await page.waitForFunction(() => !(window as any).isDetailTransitionActive());
  await setDetailMeasurement(page, 'req-spec', '24');
  await setDetailMeasurement(page, 'req-match', '80');
  if (await page.locator('.request-av-note-sheet__close').isVisible()) await app.activate(page.locator('.request-av-note-sheet__close'));

  await app.activate(page.locator('#req-btn-save-complete'));
  await expect.poll(() => app.requests.filter(request => request.body.operation === 'complete').length).toBe(1);
  await expect.poll(() => app.backendRows[0].DATE_COMPLETED).toBe(completionTime);
  await expect.poll(() => app.inventoryLookupCalls.some(call => call.status === 503)).toBe(true);
  await expect(page.locator('#view-detail')).toBeHidden();
  await expect(page.locator('#view-request')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.eval('activeReqTab'))).toBe('suspend-tag');
  await expect(app.card()).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.eval('Object.keys(getDockSuspendCompletionState().receipts).length'))).toBe(1);
  expect(app.backendRows[0].DOCK_SPEC).toBe('24');
  expect(String(app.backendRows[0].MATCH)).toBe('80');
  await app.assertClean();
});

test('late detail completion acknowledgment does not override navigation away from Suspend', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ operation: 'complete', wait: new Promise<void>((resolve) => { release = resolve; }) });
  await page.evaluate(() => window.eval("openDockSuspendDcRequestUpdate('dock_suspend_dc_browser-suspend-1')"));
  await expect(page.locator('#request-open-info-modal')).toBeVisible();
  await app.activate(page.locator('#request-open-info-ok'));
  await expect(page.locator('#req-btn-save-complete')).toBeVisible();
  await page.waitForFunction(() => !(window as any).isDetailTransitionActive());
  await setDetailMeasurement(page, 'req-spec', '24');
  await setDetailMeasurement(page, 'req-match', '80');
  if (await page.locator('.request-av-note-sheet__close').isVisible()) await app.activate(page.locator('.request-av-note-sheet__close'));

  await app.activate(page.locator('#req-btn-save-complete'));
  await expect.poll(() => app.requests.filter(request => request.body.operation === 'complete').length).toBe(1);
  await expect(page.locator('#view-detail')).toBeVisible();
  await app.activate(page.getByRole('button', { name: 'Home' }));
  await expect(page.locator('#view-home')).toBeVisible();

  release();
  await expect.poll(() => app.backendRows[0].DATE_COMPLETED).toBe(completionTime);
  await expect.poll(() => page.evaluate(() => window.eval('Object.keys(getDockSuspendCompletionState().receipts).length'))).toBe(1);
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#view-detail')).toBeHidden();
  expect(app.backendRows[0].DATE_COMPLETED).toBe(completionTime);
  expect(app.backendRows[0].DOCK_SPEC).toBe('24');
  await app.assertClean();
});

test('detail Mark Done preserves failed form edits and only applies a confirmed save', {"tag":["@suspend-tag"]}, async ({page,baseURL})=>{
  test.setTimeout(120000);
  const app=await harness(page,baseURL!);
  await page.evaluate(()=>window.eval("openDockSuspendDcRequestUpdate('dock_suspend_dc_browser-suspend-1')"));
  await expect(page.locator('#request-open-info-modal')).toBeVisible();
  await app.activate(page.locator('#request-open-info-ok'));
  await expect(page.locator('#req-spec')).toBeVisible();
  await page.waitForFunction(()=>!(window as any).isDetailTransitionActive());
  for (const [id,value] of [['req-spec','24'],['req-match','80']]) {
    const custom=await page.evaluate(id=>(window as any).shouldPreferDetailMeasurementKeyboard() && (window as any).isDetailMeasurementKeyboardInput(document.getElementById(id)),id);
    if (custom) {
      await app.activate(page.locator('#'+id));
      await app.activate(page.locator('#detail-measurement-keyboard').getByRole('button',{name:'Clear',exact:true}).first());
      for (const digit of value) await app.activate(page.locator('#detail-measurement-keyboard [data-key-token="'+digit+'"]'));
      await app.activate(page.locator('#detail-measurement-keyboard [data-key-token="__done"]'));
    } else await page.locator('#'+id).fill(value);
    await expect(page.locator('#'+id)).toHaveValue(value);
  }
  if (await page.locator('.request-av-note-sheet__close').isVisible()) await app.activate(page.locator('.request-av-note-sheet__close'));
  app.replies.push({operation:'complete',status:403,body:{ok:false,code:'SUSPEND_TAG_FORBIDDEN'}});
  await app.activate(page.locator('#req-btn-save-complete'));
  await expect.poll(()=>app.requests.filter(r=>r.body.operation==='complete').length).toBeGreaterThan(0);
  await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind','error');
  await expect(page.locator('#view-detail')).toBeVisible();
  await expect(page.locator('#view-home')).toBeHidden();
  await expect(page.locator('#req-spec')).toHaveValue('24');
  expect(app.backendRows[0].DATE_COMPLETED).toBe('');
  await app.activate(page.locator('#req-btn-save-complete'));
  await expect.poll(()=>app.backendRows[0].SUSPEND_TAG_STATUS).toBe('completed');
  expect(app.backendRows[0].DOCK_SPEC).toBe('24');
  expect(String(app.backendRows[0].MATCH)).toBe('80');
  expect(app.requests.filter(r=>r.body.operation==='complete')).toHaveLength(2);
  await app.assertClean();
});

test('approval decision links preselect without mutation and submit the optional message explicitly', {"tag":["@suspend-tag"]},async({page,baseURL})=>{
  test.setTimeout(120000);
  const id='b0000000-0000-4000-8000-000000000001';
  const row={...fixtures[0],DATE_COMPLETED:completionTime,SUSPEND_TAG_STATUS:'awaiting_rep',SUSPEND_TAG_APPROVAL_ID:id};
  const app=await harness(page,baseURL!,[row],{search:'&suspendApproval='+id+'&suspendDecision=approve',expired:true});
  await page.waitForTimeout(1800);
  await expect(page.locator('#suspend-tag-approval-dialog')).toHaveCount(0);
  expect(app.requests).toHaveLength(0);
  await page.evaluate(()=>{(window as any).__suspendTestAuthReady=true;});
  const dialog=page.locator('#suspend-tag-approval-dialog');
  await expect(dialog).toContainText('Synthetic browser customer');
  const approve=dialog.getByRole('button',{name:'Approve',exact:true});
  await expect(approve).toHaveAttribute('aria-pressed','true');
  expect(app.requests.map(r=>r.body.operation)).toEqual(['approval']);
  expect(app.requests.some(r=>r.body.operation==='decide')).toBe(false);
  await dialog.locator('#suspend-tag-decision-message').fill('Please recount the saved location.');
  await app.activate(dialog.getByRole('button',{name:'Submit decision',exact:true}));
  await expect(dialog).toContainText('Your reply email is queued');
  expect(app.requests.map(r=>r.body.operation)).toEqual(['approval','decide']);
  expect(app.requests[1].body.payload).toMatchObject({approvalId:id,decision:'approve',decisionMessage:'Please recount the saved location.'});
  await app.assertClean();
});

test('generated Suspend Tag email and Complete Tag actions keep readable contrast across themes', {"tag":["@suspend-tag"]}, async ({page,baseURL},info)=>{
  const colorFixtures=fixtures.map(row=>({...row,PLANSTART:'2026-10-19'}));
  const app=await harness(page,baseURL!,colorFixtures);
  const card=app.card();
  const actions=card.locator('.app-suspend-tag-actions');
  const email=actions.getByRole('button',{name:'Email',exact:true});
  const markDone=actions.getByRole('button',{name:'Mark Done',exact:true});
  const completeTag=actions.getByRole('button',{name:'Complete Tag',exact:true});
  await expect(email).toBeVisible();
  await expect(markDone).toHaveCount(0);
  await expect(completeTag).toBeVisible();
  const orderedLabels=await actions.locator('button').allTextContents();
  expect(orderedLabels.indexOf('Email')).toBeLessThan(orderedLabels.indexOf('Complete Tag'));
  for (const theme of ['light','dark','outdoor']) {
    await page.evaluate(value=>{
      document.body.dataset.opsTheme=value;
      document.body.classList.toggle('dark',value==='dark');
    },theme);
    await page.mouse.move(1,1);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await card.scrollIntoViewIfNeeded();
    await info.attach(`suspend-email-${theme}.png`, { body: await card.screenshot(), contentType: 'image/png' });
    for (const button of [email,completeTag]) {
      await page.mouse.move(1,1);
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      const colors=await button.evaluate(node=>{
        const style=getComputedStyle(node);
        return {background:style.backgroundColor,color:style.color,textFill:style.getPropertyValue('-webkit-text-fill-color'),
          icons:Array.from(node.querySelectorAll('i,svg')).map(icon=>{
            const iconStyle=getComputedStyle(icon);
            return {color:iconStyle.color,textFill:iconStyle.getPropertyValue('-webkit-text-fill-color'),fill:iconStyle.fill};
          })};
      });
      expect(colors,`${theme} ${await button.innerText()} contrast`).toMatchObject({
        background:'rgb(0, 122, 77)',color:'rgb(255, 255, 255)',textFill:'rgb(255, 255, 255)'
      });
      for (const icon of colors.icons) {
        expect(icon.color).toBe('rgb(255, 255, 255)');
        expect(icon.textFill).toBe('rgb(255, 255, 255)');
        if (icon.fill !== 'none') expect(icon.fill).toBe('rgb(255, 255, 255)');
      }
      const actionScope=await button.evaluate(node=>{
        const uid=node.closest('[data-request-uid]')?.getAttribute('data-request-uid');
        if(!uid)throw new Error('Action card identity is missing');
        return window.eval(`(() => { const uid=${JSON.stringify(uid)}, scope=getSupabaseReadIdentityScope();
          const row=findDockSuspendDcRequestMirrorRowByUniqueId(uid);
          if(!row || row.UNIQUE_ID!==uid || !getDockSuspendDcRequestSourceUid(row))throw new Error('Contrast fixture exact row is unavailable');
          const key=scope+'|'+getDockSuspendDcRequestSourceUid(row);
          suspendTagCompletionActions.add(key);
          if(!setSuspendTagCardActionsBusy(uid,scope,true))throw new Error('Contrast fixture could not lock its mounted row');
          return {uid,scope,key}; })()`) as {uid:string;scope:string;key:string};
      });
      try {
        await expect.poll(()=>button.evaluate(node=>{
          const element=node as HTMLButtonElement,style=getComputedStyle(element);
          return {connected:element.isConnected,disabled:element.matches(':disabled'),background:style.backgroundColor,
            color:style.color,textFill:style.getPropertyValue('-webkit-text-fill-color')};
        }),{timeout:2000,message:`${theme} disabled action style should settle on its accessible palette`}).toMatchObject({
          connected:true,disabled:true,background:'rgb(82, 117, 101)',color:'rgb(255, 255, 255)',textFill:'rgb(255, 255, 255)'
        });
      } finally {
        const released=await page.evaluate(async state=>{
          const result=window.eval(`(() => {
            suspendTagCompletionActions.delete(${JSON.stringify(state.key)});
            const found=setSuspendTagCardActionsBusy(${JSON.stringify(state.uid)},${JSON.stringify(state.scope)},false);
            const row=findDockSuspendDcRequestMirrorRowByUniqueId(${JSON.stringify(state.uid)});
            return {found,scope:getSupabaseReadIdentityScope(),sourceUid:getDockSuspendDcRequestSourceUid(row),locks:Array.from(suspendTagCompletionActions)};
          })()`);
          await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
          return {...result,buttons:Array.from(document.querySelectorAll<HTMLElement>('#request-content [data-request-uid]'))
            .filter(card=>card.dataset.requestUid===state.uid).flatMap(card=>Array.from(card.querySelectorAll<HTMLButtonElement>('.app-suspend-tag-action'))
              .map(button=>({text:button.textContent,disabled:button.disabled,marker:button.getAttribute('data-suspend-action-busy'),title:button.title,html:button.outerHTML}))) };
        },actionScope);
        await info.attach(`suspend-email-${theme}-lock-release.json`,{body:JSON.stringify({theme,actionScope,released}),contentType:'application/json'});
        expect(released.found,'the exact row must remain mounted while its style-only lock is released').toBe(true);
        expect(released.scope).toBe(actionScope.scope);
        expect(released.locks).not.toContain(actionScope.key);
        expect(released.buttons.every(button=>!button.disabled),'all exact-row controls must release their busy state').toBe(true);
      }
      await button.hover();
      await expect.poll(()=>button.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(0, 102, 64)');
      await page.mouse.move(1,1);
      const box=await button.boundingBox();
      if (!box) throw new Error('Suspend Tag action has no visible hit target');
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.down();
      try {
        await expect.poll(()=>button.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(0, 90, 56)');
      } finally {
        // Release outside the action so sampling :active cannot dispatch its click handler.
        await page.mouse.move(1,1);
        await page.mouse.up();
      }
    }
    await page.mouse.move(1,1);
    await email.focus();
    await page.keyboard.press('Tab');
    await expect.poll(()=>completeTag.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(0, 102, 64)');
    const focusColors=await completeTag.evaluate(node=>({
      focused:node.matches(':focus-visible'),background:getComputedStyle(node).backgroundColor,
      color:getComputedStyle(node).color,textFill:getComputedStyle(node).getPropertyValue('-webkit-text-fill-color'),
      outlineColor:getComputedStyle(node).outlineColor,outlineStyle:getComputedStyle(node).outlineStyle,outlineWidth:getComputedStyle(node).outlineWidth
    }));
    expect(focusColors.focused, 'keyboard navigation should exercise the visible focus treatment').toBe(true);
    expect(focusColors).toMatchObject({background:'rgb(0, 102, 64)',color:'rgb(255, 255, 255)',textFill:'rgb(255, 255, 255)'});
    expect(focusColors).toMatchObject({outlineColor:'rgb(251, 191, 36)',outlineStyle:'solid',outlineWidth:'3px'});
  }
  expect(app.requests.filter(request=>request.body.operation!=='rows'),'visual-state sampling must not send a Suspend Tag command').toEqual([]);
  await app.assertClean();
});

test('pending card Email completes the review, queues delivery, and keeps the card visible', {"tag":["@suspend-tag"]}, async ({page,baseURL},info)=>{
  const app=await harness(page,baseURL!,fixtures,{native:true});
  await expect(app.card()).toContainText('Pending');
  await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
  await expect.poll(()=>app.inventoryLookupCalls.filter(call=>call.status===200).length).toBeGreaterThanOrEqual(2);
  await app.card().getByRole('button',{name:'Email',exact:true}).scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>document.body.classList.contains('performance-scroll-active'))).toBe(false);
  await page.evaluate(async()=>{
    await document.fonts.ready;
    const card=document.querySelector<HTMLElement>('#request-content [data-request-uid]');
    if(!card)throw new Error('Pending Suspend Tag card is missing before paint measurement');
    const rect=()=>{const box=card.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};};
    const near=(a:ReturnType<typeof rect>,b:ReturnType<typeof rect>)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.abs(a.width-b.width),Math.abs(a.height-b.height))<=0.5;
    let previous=rect(),stableFrames=0;
    for(let frame=0;frame<120 && stableFrames<3;frame++){
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      const next=rect(); stableFrames=near(previous,next)?stableFrames+1:0; previous=next;
    }
    if(stableFrames<3)throw new Error('Initial native Suspend card did not reach three stable animation frames');
  });
  let releaseComplete!:()=>void;
  app.replies.push({operation:'complete',wait:new Promise<void>(resolve=>{releaseComplete=resolve;})});
  await page.evaluate(()=>{
    const state={startedAt:null as number|null,firstDisabledFrameMs:null as number|null,layoutShift:0,layoutEntries:[] as Array<{startTime:number;value:number;hadRecentInput:boolean}>,baselineRect:null as {x:number;y:number;width:number;height:number}|null,baselineScrollY:0,baselineActiveElement:'',cardMissingFrame:false,cardMutationObserver:null as MutationObserver|null,observer:null as MutationObserver|null,layoutObserver:null as PerformanceObserver|null};
    const card=document.querySelector('#request-content [data-request-uid]');
    const email=card?.querySelector('.app-suspend-tag-actions button');
    if(!email)throw new Error('Pending card Email action is missing');
    const initialRect=card?.getBoundingClientRect();
    if(!initialRect)throw new Error('Pending card geometry is unavailable before the Email action');
    state.baselineRect={x:initialRect.x,y:initialRect.y,width:initialRect.width,height:initialRect.height};
    state.baselineScrollY=window.scrollY;
    state.baselineActiveElement=document.activeElement instanceof HTMLElement
      ? `${document.activeElement.tagName.toLowerCase()}#${document.activeElement.id||''}.${String(document.activeElement.className||'').trim().replace(/\s+/g,'.')}`
      : String(document.activeElement?.nodeName||'');
    let missingFrameScheduled=false;
    state.cardMutationObserver=new MutationObserver(()=>{
      if(missingFrameScheduled)return;
      missingFrameScheduled=true;
      requestAnimationFrame(()=>{
        if(!document.querySelector('#request-content [data-request-uid="dock_suspend_dc_browser-suspend-1"]'))state.cardMissingFrame=true;
        missingFrameScheduled=false;
      });
    });
    const requestContent=document.querySelector('#request-content');
    if(requestContent)state.cardMutationObserver.observe(requestContent,{childList:true,subtree:true});
    const uid=card?.getAttribute('data-request-uid');
    if(!uid)throw new Error('Pending card identity is missing');
    const currentEmail=()=>Array.from(document.querySelectorAll<HTMLElement>('#request-content [data-request-uid]'))
      .find(node=>node.dataset.requestUid===uid)?.querySelector<HTMLButtonElement>('.app-suspend-tag-actions button[onclick*="emailSuspendTagFromCard"]');
    let disabledFrameScheduled=false;
    const sampleDisabledFrame=()=>{
      if(state.startedAt===null || state.firstDisabledFrameMs!==null || disabledFrameScheduled)return;
      disabledFrameScheduled=true;
      requestAnimationFrame(()=>{
        disabledFrameScheduled=false;
        if(currentEmail()?.disabled)state.firstDisabledFrameMs=performance.now()-state.startedAt!;
      });
    };
    const onEmailClick=(event:MouseEvent)=>{
      const action=event.target instanceof Element ? event.target.closest('.app-suspend-tag-actions button[onclick*="emailSuspendTagFromCard"]') : null;
      if(action?.closest('[data-request-uid]')?.getAttribute('data-request-uid')!==uid || state.startedAt!==null)return;
      state.startedAt=performance.now();
      document.removeEventListener('click',onEmailClick,true);
      sampleDisabledFrame();
    };
    document.addEventListener('click',onEmailClick,true);
    state.observer=new MutationObserver(sampleDisabledFrame);
    if(requestContent)state.observer.observe(requestContent,{attributes:true,attributeFilter:['disabled'],childList:true,subtree:true});
    if(typeof PerformanceObserver!=='undefined' && PerformanceObserver.supportedEntryTypes?.includes('layout-shift')){
      state.layoutObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries() as Array<PerformanceEntry & {value:number;hadRecentInput:boolean}>){if(state.startedAt!==null && entry.startTime>=state.startedAt){state.layoutShift+=entry.value;state.layoutEntries.push({startTime:entry.startTime,value:entry.value,hadRecentInput:entry.hadRecentInput});}}});
      state.layoutObserver.observe({type:'layout-shift'});
    }
    (window as any).__suspendEmailPaintProbe=state;
  });
  try {
    await app.activate(app.card().getByRole('button',{name:'Email',exact:true}));
    await expect.poll(()=>page.evaluate(()=>((window as any).__suspendEmailPaintProbe?.firstDisabledFrameMs ?? null)),
      {timeout:2000,message:'wait for the first rendered disabled Email frame'}).not.toBeNull();
    await expect.poll(()=>app.card().getByRole('button',{name:'Email',exact:true}).evaluate(node=>({
      disabled:(node as HTMLButtonElement).disabled,background:getComputedStyle(node).backgroundColor,
      color:getComputedStyle(node).color,textFill:getComputedStyle(node).getPropertyValue('-webkit-text-fill-color')
    }))).toMatchObject({disabled:true,background:'rgb(82, 117, 101)',color:'rgb(255, 255, 255)',textFill:'rgb(255, 255, 255)'});
  } finally {
    // Keep the mocked completion response pending until the disabled frame is
    // observed, so fast mocked network completion cannot race the measurement.
    releaseComplete();
  }
  const operations=()=>app.requests.map(request=>request.body.operation).filter(operation=>operation!=='rows');
  await expect.poll(operations).toEqual(['complete','send']);
  await expect(app.card()).toContainText('Awaiting Rep');
  await expect(app.card()).toBeVisible();
  // Match the unhovered baseline; desktop cards intentionally translate -2px
  // on hover, which the click leaves active until the pointer moves away.
  await page.mouse.move(1,1);
  await expect.poll(()=>app.card().evaluate(node=>getComputedStyle(node).transform)).toBe('none');
  const presentation=await page.evaluate(()=>{
    const state=(window as any).__suspendEmailPaintProbe;
    const pendingEntries=state?.layoutObserver?.takeRecords?.()||[];
    for(const entry of pendingEntries as Array<PerformanceEntry & {value:number;hadRecentInput:boolean}>){
      if(state && state.startedAt!==null && entry.startTime>=state.startedAt){
        state.layoutShift+=entry.value;
        state.layoutEntries.push({startTime:entry.startTime,value:entry.value,hadRecentInput:entry.hadRecentInput});
      }
    }
    state?.observer?.disconnect();state?.layoutObserver?.disconnect();state?.cardMutationObserver?.disconnect();
    const card=document.querySelector<HTMLElement>('#request-content [data-request-uid="dock_suspend_dc_browser-suspend-1"]');
    const rect=card?.getBoundingClientRect();
    const geometryDeltaPx=rect && state?.baselineRect ? Math.max(Math.abs(rect.x-state.baselineRect.x),Math.abs(rect.y-state.baselineRect.y),Math.abs(rect.width-state.baselineRect.width),Math.abs(rect.height-state.baselineRect.height)) : null;
    const documentYDeltaPx=rect && state?.baselineRect ? Math.abs((rect.y+window.scrollY)-(state.baselineRect.y+(state.baselineScrollY||0))) : null;
    const activeElement=document.activeElement instanceof HTMLElement
      ? `${document.activeElement.tagName.toLowerCase()}#${document.activeElement.id||''}.${String(document.activeElement.className||'').trim().replace(/\s+/g,'.')}`
      : String(document.activeElement?.nodeName||'');
    const finalRect=rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null;
    return {elapsedMs:state?.firstDisabledFrameMs,layoutShift:state?.layoutShift,layoutEntries:state?.layoutEntries||[],baselineRect:state?.baselineRect,finalRect,baselineScrollY:state?.baselineScrollY,finalScrollY:window.scrollY,baselineActiveElement:state?.baselineActiveElement,finalActiveElement:activeElement,geometryDeltaPx,documentYDeltaPx,cardMissingFrame:state?.cardMissingFrame,cardVisible:!!card && !!rect && rect.width>0 && rect.height>0};
  });
  await info.attach('suspend-email-presentation.json',{body:JSON.stringify(presentation),contentType:'application/json'});
  console.log('SUSPEND_EMAIL_PRESENTATION ' + JSON.stringify(presentation));
  expect(presentation.elapsedMs,'Email action should paint its disabled state on the first rendered frame').not.toBeNull();
  expect(presentation.elapsedMs).toBeLessThanOrEqual(2000);
  expect(presentation.layoutShift,'Email action should not move the card while it queues').toBeLessThanOrEqual(0.01);
  expect(presentation.geometryDeltaPx).not.toBeNull();
  expect(presentation.geometryDeltaPx,'the card geometry should remain stable through the queued completion/send').toBeLessThanOrEqual(1);
  expect(presentation.cardMissingFrame,'the request area must never paint a frame without the pending card').toBe(false);
  expect(presentation.cardVisible,'the pending card must remain visible after the queued send').toBe(true);
  const freshRows=app.requests.filter(request=>request.body.operation==='rows');
  expect(freshRows).toHaveLength(2);
  expect(freshRows.map(request=>request.body.payload.ids)).toEqual([[fixtures[0].UNIQUE_ID],[fixtures[0].UNIQUE_ID]]);
  await expect(app.card()).toContainText('Awaiting Rep');
  await expect(app.card()).toBeVisible();
  await expect(page.locator('#app-prompt-dialog')).toBeHidden();
  await expect(page.locator('#toast-notification')).toContainText('Email queued');
  expect(app.backendRows[0].SUSPEND_TAG_STATUS).toBe('awaiting_rep');
  await app.assertClean();
});

test('denied card Email records the new review and lets completion queue its approval once', {"tag":["@suspend-tag"]}, async ({page,baseURL},info)=>{
  const app=await harness(page,baseURL!);
  app.backendRows[0].SUSPEND_TAG_STATUS='denied';
  app.backendRows[0].DATE_COMPLETED='';
  await app.refresh();
  await expect(app.card()).toContainText('Denied / Needs Changes');
  await page.evaluate(()=>{
    const toast=document.querySelector('#toast-notification');
    if(!toast)throw new Error('Toast region is missing');
    const history:string[]=[];
    const observer=new MutationObserver(()=>history.push(String(toast.textContent||'').trim()));
    observer.observe(toast,{childList:true,subtree:true,characterData:true,attributes:true});
    (window as any).__suspendToastHistory={history,observer};
  });
  await app.activate(app.card().getByRole('button',{name:'Email',exact:true}));
  await expect.poll(()=>app.requests.map(request=>request.body.operation)).toEqual(['complete']);
  await expect.poll(()=>page.evaluate(()=>((window as any).__suspendToastHistory?.history||[]).some((text:string)=>text.includes('Email queued')))).toBe(true);
  const toastHistory=await page.evaluate(()=>{
    const state=(window as any).__suspendToastHistory;state?.observer?.disconnect();
    return Array.isArray(state?.history)?state.history:[];
  });
  await info.attach('denied-card-email-toast-history.json',{body:JSON.stringify(toastHistory),contentType:'application/json'});
  await expect(app.card()).toContainText('Awaiting Rep');
  await expect(app.card()).toBeVisible();
  await expect(page.locator('#app-prompt-dialog')).toBeHidden();
  expect(app.backendRows[0].SUSPEND_TAG_APPROVAL_ID).toMatch(/^[0-9a-f-]{36}$/i);
  await app.assertClean();
});

test('Retry Delivery safely reuses its persisted command when the response is lost after commit', {"tag":["@suspend-tag"]}, async ({page,baseURL})=>{
  const app=await harness(page,baseURL!);
  app.backendRows[0].SUSPEND_TAG_STATUS='awaiting_rep';
  app.backendRows[0].SUSPEND_TAG_DELIVERY_STATUS='failed';
  await app.refresh();
  app.replies.push({abort:true,commitBeforeAbort:true});
  const retry=app.card().getByRole('button',{name:'Retry Delivery',exact:true});
  await app.activate(retry);
  await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind','error');
  await expect(retry).toBeEnabled();
  expect(app.requests.map(request=>request.body.operation)).toEqual(['retry']);
  const commandId=app.requests[0].body.commandId;
  await app.activate(retry);
  await expect.poll(()=>app.requests.length).toBe(2);
  expect(app.requests.map(request=>request.body.operation)).toEqual(['retry','retry']);
  expect(app.requests[1].body.commandId).toBe(commandId);
  await expect(app.card()).toContainText('Awaiting Rep');
  await expect(app.card()).toBeVisible();
  expect(app.receipts.size).toBe(1);
  await app.assertClean();
});

test('card Email, denial, and re-email preserve the review and create a fresh approval', {"tag":["@suspend-tag"]}, async ({page,baseURL})=>{
  test.setTimeout(120000); // Two complete mobile approval rounds.
  const app=await harness(page,baseURL!);
  await app.activate(app.card().getByRole('button',{name:'Email',exact:true}));
  await expect.poll(() => app.requests.map(r=>r.body.operation)).toEqual(['complete','send']);
  await expect(page.locator('#toast-notification')).toContainText('Email queued');
  await expect(app.card()).toContainText('Awaiting Rep');
  const firstId=String(app.backendRows[0].SUSPEND_TAG_APPROVAL_ID);
  await page.evaluate(id=>window.eval('void openSuspendTagApproval('+JSON.stringify(id)+')'),firstId);
  const dialog=page.locator('#suspend-tag-approval-dialog');
  await expect(dialog).toContainText('Synthetic browser customer');
  await expect(dialog).toContainText('B.01.000');
  await app.activate(dialog.getByRole('button',{name:'Deny',exact:true}));
  await expect(dialog).toContainText('All data and photos are retained');
  await app.activate(dialog.getByRole('button',{name:'Close',exact:true}));
  await app.showStatus('active');
  await app.refresh();
  await expect(app.card()).toContainText('Denied / Needs Changes');
  expect(app.backendRows[0].DOCK_PHOTO_LINK).toBe(fixtures[0].DOCK_PHOTO_LINK);
  expect(app.backendRows[0].AV_NOTE).toBe(fixtures[0].AV_NOTE);
  await app.activate(app.card().getByRole('button',{name:'Email',exact:true}));
  await expect.poll(() => app.requests.map(r=>r.body.operation)).toEqual(['complete','send','approval','decide','complete']);
  // The initial Email queued toast was asserted above. Production deduplicates
  // an identical toast for 15 seconds, so this immediate resubmission verifies
  // the acknowledged new approval and saved state instead of demanding a repeat toast.
  await expect(app.card()).toContainText('Awaiting Rep');
  await expect(app.card()).toBeVisible();
  expect(app.backendRows[0].SUSPEND_TAG_STATUS).toBe('awaiting_rep');
  expect(app.backendRows[0].DOCK_PHOTO_LINK).toBe(fixtures[0].DOCK_PHOTO_LINK);
  expect(app.backendRows[0].AV_NOTE).toBe(fixtures[0].AV_NOTE);
  expect(app.backendRows[0].SUSPEND_TAG_APPROVAL_ID).not.toBe(firstId);
  await page.evaluate(id=>window.eval('void openSuspendTagApproval('+JSON.stringify(id)+',"approve")'),String(app.backendRows[0].SUSPEND_TAG_APPROVAL_ID));
  await expect(dialog).toContainText('Approved. Your reply email is queued.');
  await app.activate(dialog.getByRole('button',{name:'Close',exact:true}));
  await app.refresh();
  await expect(app.card()).toContainText('Approved');
  await app.assertClean();
});


test('published snapshot stays available and Drive completes every Common Name after interrupted import @release-smoke', async ({ page, baseURL }, info) => {
  // This case includes cold fixture bootstrap and all 19 inventory pages.
  // Keep its setup/background-hydration budget separate from the unchanged
  // 2,000 ms detail-opening gate and the runner's five-minute total limit.
  test.setTimeout(120_000);
  const snapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/suspend-v2314.json.gz', import.meta.url))).toString('utf8')) as { masterRows: FixtureRow[]; suspendRows: FixtureRow[] };
  const app = await harness(page, baseURL!, [], { masterRows: snapshot.masterRows, published: true });
  const result = await page.evaluate(async () => window.eval(`(async () => {
    const hydrationStarted = performance.now();
    fullInventory = []; rebuildMasterInventoryIndexes();
    Object.assign(getDatasetState('master'), { initialLoaded: false, fullLoaded: false, rowCompleteness: 'unknown', liveVerifiedScope: '' });
    activeDriveTab = 'name'; driveViewLevel = 0; selectedDriveName = '';
    window.__suspendFixtureFetchAbortContext = 'published-lkg-drive-transition';
    resetProductionLiveSync();
    showOnlyPrimaryView('drive');
    window.__suspendFixtureFetchAbortContext = '';
    const loaded = await getProductionLiveSyncCoordinator().check('visible-view');
    renderDrive();
    return { loaded, rows: fullInventory.length, names: new Set(fullInventory.map(row => row.COMMONNAME)).size,
      coldHydrationMs: performance.now() - hydrationStarted,
      state: getProductionLiveSyncCoordinator().getStatus().state,
      message: getProductionLiveSyncCoordinator().getStatus().message,
      blockedSources: getProductionLiveSyncCoordinator().getStatus().blockedSources || [],
      writeProof: hasCurrentProductionLiveSyncProof() };
  })()`)).catch(async (error: unknown) => {
    await info.attach('published-lkg-failed-read-diagnostic', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ pages: app.publishedReadPages, settingsReads: app.settingsReads,
        failedResources: app.failedResources,
        consoleErrors: app.consoleErrorDetails })),
    });
    throw error;
  });
  await info.attach('published-lkg-initial-read-diagnostic', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    result, expectedSeasonSettingsKey: 'current_season_salesyear', settingsReads: app.settingsReads,
    failedResources: app.failedResources, fetchAbortEvidence: await app.readFetchAbortEvidence(), pages: app.publishedReadPages,
  })) });
  expect(app.settingsReads, 'the interrupted-import read must verify the exact authenticated Current Season settings row').toEqual([
    expect.objectContaining({ status: 200, authorization: 'Bearer browser-only-no-real-session' }),
  ]);
  expect(result.loaded).toBe(true);
  expect(result.rows).toBe(snapshot.masterRows.length);
  expect(result.names).toBe(new Set(snapshot.masterRows.map(row => row.COMMONNAME || row.commonname)).size);
  expect(result.names).toBeGreaterThan(75);
  expect(result.state).toBe('Published data');
  expect(result.writeProof).toBe(false);
  await expect(page.locator('#drive-content')).toHaveAttribute('data-drive-commonname-state', 'complete');
  await expect(page.locator('#drive-content')).not.toContainText('Load Failed');
  await expect(page.locator('#drive-content')).not.toContainText('Data could not be verified');
  const details = await page.evaluate(async () => window.eval(`(async () => {
    const row = fullInventory.find(row => row.ITEMCODE === '010539.030.1' && row.LOCATIONCODE === 'F.16.000' && row.LOTCODE === '27.F1');
    if (!row) throw new Error('Captured Rosy Muhly row missing');
    const locationOnHand = getCardLocationOnHandValue(row);
    const started = performance.now(); openDetail(row.UNIQUE_ID, 'drive');
    const immediateView = getCurrentVisibleViewId();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { locationOnHand, immediateView, view: getCurrentVisibleViewId(), openMs: performance.now() - started, uid: activeItem?.UNIQUE_ID };
  })()`));
  expect(String(details.locationOnHand)).toBe('195');
  expect(Number.isFinite(Number(details.locationOnHand))).toBe(true);
  expect(details.immediateView).toBe('detail');
  expect(details.view).toBe('detail');
  expect(details.openMs).toBeLessThanOrEqual(2000);
  await expect(page.locator('#toast-notification')).not.toContainText('Row Details Unavailable');
  await info.attach('published-snapshot-availability', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ ...result, details })) });
  await app.assertClean();
});
