import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';

// @test-group: @home-role

// Keep profiler, trace, and screenshot work out of acceptance measurements.
test.use({ trace: 'off', screenshot: 'off' });

type FixtureRow = Record<string, string | number | boolean>;
type AppApiBody = {
  action?: string;
  dataset?: string;
  operation?: string;
  offset?: number;
  limit?: number;
  params?: { offset?: number; limit?: number };
};
type ArchiveMode = 'ok' | 'fail' | 'hold';

function makeRequestRows(prefix: string, count: number, archived = false): FixtureRow[] {
  return Array.from({ length: count }, (_, index) => ({
    unique_id: `${prefix}-${String(index).padStart(4, '0')}`,
    itemcode: `PERF.${String(index).padStart(4, '0')}`,
    commonname: `Performance request ${String(index).padStart(4, '0')}`,
    contsize: '#3',
    locationcode: `C.${String(index % 40).padStart(2, '0')}.001`,
    lotcode: '27.F1',
    season: 'F1',
    saleyear: '27',
    req_status: archived ? 'Complete' : 'Pending',
    req_archived: archived,
    req_qty: String((index % 20) + 1),
    req_match: '100',
    request_folder: 'performance-folder',
    req_customer: `Synthetic customer ${index % 30}`,
    salesrepname: 'Performance Rep',
    requested_by: 'dylan_collyge',
    suspend_tag_version: 1,
    suspend_tag_status: 'pending',
    ...(prefix === 'suspend' ? {
      suspend: 'SUSPEND',
      suspend_to: 'dc',
      source_table: 'ph_soc_master',
      request_source: 'docks',
    } : {}),
    date_completed: archived ? '2026-10-01T12:00:00Z' : '',
  }));
}

async function appEval<T>(page: Page, source: string): Promise<T> {
  return page.evaluate(expression => window.eval(expression) as T, source);
}

async function installRequestListFixture(page: Page, baseURL: string) {
  const pendingRows = makeRequestRows('pending', 200);
  const suspendRows = makeRequestRows('suspend', 1000);
  const archiveRows = makeRequestRows('archive', 1000, true);
  const apiCalls: string[] = [];
  let archiveMode: ArchiveMode = 'ok';
  let releaseArchiveRead: (() => void) | null = null;
  let heldArchiveRead: Promise<void> | null = null;

  const fixture = await installHlOrderFixture(page, baseURL, {
    username: 'dylan_collyge',
    role: 'ADMIN',
    beforeNavigate: async () => {
      await page.route('**/rest/v1/rpc/get_request_capabilities', async (route: Route) => {
        return route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ contract_version: 2, username: 'dylan_collyge', scope: 'global',
            can_create_general: false, can_create_av: false, can_view_queue: true,
            can_take_photo: false, can_edit: true, can_complete: true, can_archive: true }) });
      });
      await page.route('**/functions/v1/app-api', async (route: Route) => {
        const request = route.request();
        const body = (request.postDataJSON() || {}) as AppApiBody;
        if (request.method() !== 'POST') return route.fallback();

        if (body.action === 'dataset_read' && (body.dataset === 'request_queue' || body.dataset === 'suspend_tag')) {
          const sourceRows = body.dataset === 'request_queue' ? pendingRows : suspendRows;
          const offset = Math.max(0, Number(body.params?.offset) || 0);
          const limit = Math.max(1, Math.min(500, Number(body.params?.limit) || 100));
          const rows = sourceRows.slice(offset, offset + limit);
          apiCalls.push(`dataset_read:${body.dataset}:${offset}:${limit}`);
          return route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ ok: true, data: { rows, total: sourceRows.length, offset, limit, hasMore: offset + rows.length < sourceRows.length } }) });
        }

        if (body.action === 'request_archive' && body.operation === 'list') {
          const offset = Math.max(0, Number(body.offset) || 0);
          const limit = Math.max(1, Math.min(500, Number(body.limit) || 100));
          apiCalls.push(`request_archive:list:${offset}:${limit}`);
          if (archiveMode === 'hold') {
            heldArchiveRead = new Promise<void>(resolve => { releaseArchiveRead = resolve; });
            await heldArchiveRead;
          }
          if (archiveMode === 'fail') {
            return route.fulfill({ status: 503, contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({ ok: false, error: 'Synthetic archived page failure' }) });
          }
          const rows = archiveRows.slice(offset, offset + limit);
          return route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ ok: true, data: { rows, total: archiveRows.length, offset, limit, hasMore: offset + rows.length < archiveRows.length } }) });
        }

        return route.fallback();
      });
    },
  });

  return {
    fixture,
    apiCalls,
    setArchiveMode(mode: ArchiveMode) { archiveMode = mode; },
    updateFirstArchiveRow(name: string) { archiveRows[0].commonname = name; },
    releaseArchiveRead() {
      if (!releaseArchiveRead) throw new Error('ARCHIVE_READ_NOT_HELD');
      const release = releaseArchiveRead;
      releaseArchiveRead = null;
      heldArchiveRead = null;
      release();
    },
  };
}

async function openRequestView(page: Page) {
  await page.locator('#footer-request-btn').click();
  await page.locator('#view-request').waitFor({ state: 'visible' });
  await page.locator('#request-content').waitFor({ state: 'visible' });
}

async function instrumentRequestRender(page: Page) {
  await appEval(page, `(() => {
    const profile = window.__requestListProfile = {
      renderDurations: [], chunkDurations: [], operations: [], stage: 'setup',
      activeRender: 0, nextRender: 1,
    };
    const timedFunctions = [
      'syncRequestRenderChrome', 'syncRequestHeaderSearchChrome', 'getScopedRequestItems',
      'appendDockSuspendDcRequestMirrorRows', 'reconcileRequestDrillState',
      'buildPendingRequestRenderPlan', 'getRequestTabQueueCounts', 'buildRequestChunkRenderKey',
      'syncRequestTabButtons', 'updateRequestTabButtonLabels', 'renderRequestCategoryToolbar',
      'updateFooterRequestBadge', 'renderMarkupChunkedByKey', 'generateCard',
      'setContainerHtml', 'setContainerHtmlWithSignature', 'appendHtmlFragment',
    ];
    for (const name of timedFunctions) {
      const originalOperation = window[name];
      if (typeof originalOperation !== 'function') continue;
      window[name] = function(...args) {
        const started = performance.now();
        try { return originalOperation.apply(this, args); }
        finally {
          profile.operations.push({ stage: profile.stage, renderId: profile.activeRender,
            name, durationMs: performance.now() - started });
        }
      };
    }
    const originalFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const associatedRender = profile.activeRender;
      const associatedStage = profile.stage;
      return originalFrame(timestamp => {
      const started = performance.now();
      const previousRender = profile.activeRender;
      const previousStage = profile.stage;
      if (callback.name === 'renderNextChunk') profile.activeRender = associatedRender;
      if (callback.name === 'renderNextChunk') profile.stage = associatedStage;
      try { callback(timestamp); }
      finally {
        if (callback.name === 'renderNextChunk') {
          profile.chunkDurations.push({ stage: associatedStage, durationMs: performance.now() - started });
        }
        profile.activeRender = previousRender;
        profile.stage = previousStage;
      }
      });
    };
    const original = renderRequest;
    renderRequest = function(...args) {
      const started = performance.now();
      const renderId = profile.nextRender++;
      const previousRender = profile.activeRender;
      profile.activeRender = renderId;
      try { return original.apply(this, args); }
      finally {
        profile.renderDurations.push({ stage: profile.stage, renderId, durationMs: performance.now() - started });
        profile.activeRender = previousRender;
      }
    };
  })()`);
}

async function assertRequestRenderGate(page: Page, stage: 'Pending' | 'Suspend') {
  const result = await appEval<{
    renderDurations: Array<{ stage: string; renderId: number; durationMs: number }>;
    chunkDurations: Array<{ stage: string; durationMs: number }>;
    operations: Array<{ stage: string; renderId: number; name: string; durationMs: number }>;
  }>(page, 'window.__requestListProfile');
  const durations = result.renderDurations.filter(item => item.stage === stage);
  const chunks = result.chunkDurations.filter(item => item.stage === stage);
  const operations = result.operations.filter(item => item.stage === stage);
  const limitMs = stage === 'Pending' ? 100 : 200;
  expect(durations.length).toBeGreaterThan(0);
  const operationSummary = operations.reduce<Record<string, typeof operations>>((summary, item) => {
    (summary[item.name] ||= []).push(item);
    return summary;
  }, {});
  console.log('REQUEST_LIST_RENDER_MEASUREMENT', JSON.stringify({ stage, renderMs: durations, chunkMs: chunks,
    operationMs: Object.fromEntries(Object.entries(operationSummary).map(([name, entries]) => [name, {
      calls: entries?.length || 0,
      totalMs: Number((entries || []).reduce((sum, item) => sum + item.durationMs, 0).toFixed(2)),
      maxMs: Number(Math.max(0, ...(entries || []).map(item => item.durationMs)).toFixed(2)),
    }])),
    browserVersion: await page.context().browser()?.version(), viewport: page.viewportSize(),
    datasetRows: { pending: 200, suspend: 1000 },
    acceptedRenderAndChunkLimitMs: limitMs,
    instrumentation: { trace: 'off', screenshots: 'off' },
    cacheConditions: 'Fresh isolated login then repeated renders in the same verified context.' }));
  const maximumMeasuredMs = Math.max(...durations.map(item => item.durationMs), ...chunks.map(item => item.durationMs));
  if (stage === 'Pending') expect.soft(maximumMeasuredMs).toBeLessThan(100);
  else expect.soft(maximumMeasuredMs).toBeLessThanOrEqual(200);
}

async function startRequestCpuProfile(page: Page) {
  if (process.env.REQUEST_CPU_PROFILE !== '1') return null;
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  await session.send('Profiler.start');
  return session;
}

async function stopRequestCpuProfile(session: Awaited<ReturnType<typeof startRequestCpuProfile>>, testInfo: TestInfo) {
  if (!session) return;
  try {
    const { profile } = await session.send('Profiler.stop') as { profile: {
      nodes: Array<{ callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; id: number }>;
      samples?: number[]; timeDeltas?: number[];
    } };
    const byId = new Map(profile.nodes.map(node => [node.id, node]));
    const selfTime = new Map<string, number>();
    (profile.samples || []).forEach((id, index) => {
      const node = byId.get(id);
      if (!node) return;
      const key = `${node.callFrame.functionName || '(anonymous)'} @ ${node.callFrame.url}:${node.callFrame.lineNumber + 1}`;
      selfTime.set(key, (selfTime.get(key) || 0) + ((profile.timeDeltas || [])[index] || 0));
    });
    const hottest = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
      .map(([functionName, microseconds]) => ({ functionName, milliseconds: Number((microseconds / 1000).toFixed(2)) }));
    console.log('REQUEST_CPU_PROFILE_SUMMARY', JSON.stringify({ samples: profile.samples?.length || 0, hottest }));
    await testInfo.attach('request-cpu-profile.json', {
      body: Buffer.from(JSON.stringify({ profile, hottest }, null, 2)), contentType: 'application/json',
    });
  } finally {
    await session.detach();
  }
}

async function attachRequestRenderTimings(page: Page, testInfo: TestInfo) {
  try {
    const evidence = await appEval<{
      renderDurations: Array<{ stage: string; renderId: number; durationMs: number }>;
      chunkDurations: Array<{ stage: string; durationMs: number }>;
      operations: Array<{ stage: string; renderId: number; name: string; durationMs: number }>;
    }>(page, 'window.__requestListProfile');
    await testInfo.attach('request-render-timings.json', {
      body: Buffer.from(JSON.stringify({
        browserVersion: await page.context().browser()?.version(), viewport: page.viewportSize(),
        datasetRows: { pending: 200, suspend: 1000 },
        acceptedLimitsMs: { pending: 100, suspend: 200 },
        cacheConditions: 'Fresh isolated login then repeated renders in the same verified context.',
        ...evidence,
      }, null, 2)),
      contentType: 'application/json',
    });
  } catch (error) {
    await testInfo.attach('request-render-timings-error.txt', {
      body: Buffer.from(String(error)), contentType: 'text/plain',
    });
  }
}

test('Request and Suspend hydrate paged lists within the render gate', { tag: ['@home-role'] }, async ({ page, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('The request list fixture requires a base URL.');
  const fixture = await installRequestListFixture(page, baseURL);
  await instrumentRequestRender(page);
  const cpuProfile = await startRequestCpuProfile(page);
  try {
    await appEval(page, `window.__requestListProfile.stage = 'Pending'`);
    await openRequestView(page);
    await expect.poll(() => fixture.apiCalls.some(call => call.startsWith('dataset_read:request_queue:'))).toBe(true);
    await expect(page.locator('#request-content [data-request-uid]')).toHaveCount(100);
    await appEval(page, 'renderRequest()');
    await assertRequestRenderGate(page, 'Pending');
    await expect(page.locator('#request-content .browse-page-footer')).toContainText(/Rows 1[–-]100 of 200/);

    await appEval(page, `window.__requestListProfile.stage = 'Suspend'`);
    await appEval(page, `setReqTab('suspend-tag')`);
    await expect.poll(() => fixture.apiCalls.some(call => call.startsWith('dataset_read:suspend_tag:'))).toBe(true);
    await page.waitForFunction(() => window.eval('Array.isArray(suspendTagInventory) && suspendTagInventory.length === 1000'));
    // Wait for Suspend's own cards and footer. The Pending page remains mounted
    // during background hydration, so a count-only wait can pass too early and
    // the explicit rerender below would cancel Suspend's scheduled render.
    await expect(page.locator('#request-content [data-request-uid="dock_suspend_dc_suspend-0000"]')).toBeVisible();
    await expect(page.locator('#request-content .browse-page-footer')).toContainText(/Rows 1[–-]100 of 1,?000/);
    await expect(page.locator('#request-content [data-request-uid]')).toHaveCount(100);
    await appEval(page, 'renderRequest()');
    await assertRequestRenderGate(page, 'Suspend');
    await expect(page.locator('#request-content .browse-page-footer')).toContainText(/Rows 1[–-]100 of 1,?000/);
    const pages = await page.locator('#request-content .browse-page-footer').allTextContents();
    expect(pages.join(' ')).toMatch(/Rows 1[–-]100 of 1,?000/);
  } finally {
    try { await attachRequestRenderTimings(page, testInfo); }
    finally { await stopRequestCpuProfile(cpuProfile, testInfo); }
  }
});

test('Archived Requests keeps the visible page stable through refresh, failure, retry, and pagination', { tag: ['@home-role'] }, async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The request archive fixture requires a base URL.');
  const fixture = await installRequestListFixture(page, baseURL);
  await openRequestView(page);
  await appEval(page, `setReqTab('archived')`);
  const cards = page.locator('#request-archive-page-list .request-archive-card');
  await expect(cards).toHaveCount(100);
  await expect(page.locator('#request-archive-page-pager')).toContainText('1 / 10 · 1000 rows');
  const firstCard = await cards.first().elementHandle();
  const firstNextButton = await page.locator('#request-archive-page-pager button').last().elementHandle();
  expect(firstCard).not.toBeNull();
  expect(firstNextButton).not.toBeNull();

  fixture.setArchiveMode('hold');
  const requestPromise = page.waitForRequest(request => {
    return request.method() === 'POST' && request.url().includes('/functions/v1/app-api')
      && request.postDataJSON()?.action === 'request_archive';
  });
  const refreshPromise = appEval<boolean>(page, 'loadRequestArchivePage(0, true)');
  await requestPromise;
  await expect(cards).toHaveCount(100);
  expect(await firstCard?.evaluate(node => node.isConnected)).toBe(true);
  expect(await firstNextButton?.evaluate(node => node.isConnected && !node.hasAttribute('disabled'))).toBe(true);
  await expect(page.locator('#request-archive-status')).toContainText(/Refreshing/);
  await expect(page.locator('#request-archive-page-list')).not.toContainText(/Loading archived request rows/);
  await expect(page.locator('#request-content .skeleton')).toHaveCount(0);

  fixture.setArchiveMode('ok');
  fixture.releaseArchiveRead();
  expect(await refreshPromise).toBe(true);
  expect(await firstCard?.evaluate(node => node.isConnected)).toBe(true);

  fixture.setArchiveMode('fail');
  await appEval(page, 'loadRequestArchivePage(0, true)');
  await expect(cards).toHaveCount(100);
  await expect(page.locator('#request-archive-status')).toContainText('Synthetic archived page failure');
  expect(await firstCard?.evaluate(node => node.isConnected)).toBe(true);
  expect(await firstNextButton?.evaluate(node => node.isConnected && !node.hasAttribute('disabled'))).toBe(true);

  fixture.updateFirstArchiveRow('Updated archive request');
  fixture.setArchiveMode('ok');
  const retry = page.locator('#request-archive-status button');
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(cards.first()).toContainText('Updated archive request');
  expect(await firstCard?.evaluate(node => node.isConnected)).toBe(false);

  await appEval(page, `loadRequestArchivePage(100, true)`);
  await expect(page.locator('#request-archive-page-pager')).toContainText('2 / 10 · 1000 rows');
  await expect(cards.first()).toContainText('Performance request 0100');
  await expect(page.locator('#request-archive-page-pager button').last()).toBeEnabled();
  await firstCard?.dispose();
  await firstNextButton?.dispose();
});
