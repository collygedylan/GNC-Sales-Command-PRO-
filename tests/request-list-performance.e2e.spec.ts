import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
type CustomerMappingWarmup = {
  rowCount?: number;
  startupMode?: 'cold' | 'restored';
  beforeOptionsResponse?: () => Promise<void>;
  beforeLogin?: () => Promise<void>;
};

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

async function installRequestListFixture(page: Page, baseURL: string, customerMappingWarmup?: CustomerMappingWarmup) {
  const pendingRows = makeRequestRows('pending', 200);
  const suspendRows = makeRequestRows('suspend', 1000);
  const archiveRows = makeRequestRows('archive', 1000, true);
  const customerMappingRows = Array.from({ length: Math.max(1, Number(customerMappingWarmup?.rowCount) || 1) }, (_, index) => ({
    unique_id: `mapping-${String(index).padStart(5, '0')}`,
    salesrepid: 'BENCH.REP', salesrepname: 'Abbey Burka',
    customeridentityid: `C${String(index).padStart(6, '0')}`, customername: `Benchmark Customer ${String(index).padStart(5, '0')}`,
    consigneeid: `D${String(index).padStart(6, '0')}`, consigneename: `Benchmark Dock ${String(index).padStart(5, '0')}`,
    customerstatus: 'A', consigneestatus: 'A', territorycode: '', territorydesc: '',
  }));
  let customerMappingRevision = 'customer-map-r1';
  const apiCalls: string[] = [];
  const customerOptionCalls: string[] = [];
  let archiveMode: ArchiveMode = 'ok';
  let releaseArchiveRead: (() => void) | null = null;
  let heldArchiveRead: Promise<void> | null = null;

  const fixture = await installHlOrderFixture(page, baseURL, {
    username: 'dylan_collyge',
    role: 'ADMIN',
    startupMode: customerMappingWarmup?.startupMode,
    appPermissions: customerMappingWarmup ? [
      { permissionKey: 'module.po-management.view', kind: 'module', moduleKey: 'po-management', allowed: true },
      { permissionKey: 'module.request.view', kind: 'module', moduleKey: 'request', allowed: true },
    ] : undefined,
    beforeLogin: customerMappingWarmup?.beforeLogin,
    beforeNavigate: async () => {
      if (customerMappingWarmup) {
        await page.route('**/rest/v1/ph_customer_consignee_sales_reps**', async (route: Route) => {
          const request = route.request();
          const url = new URL(request.url());
          const range = request.headers().range || '0-999';
          const [startText, endText] = range.split('-');
          const start = Math.max(0, Number(url.searchParams.get('offset')) || Number(startText) || 0);
          const limit = Math.max(1, Number(url.searchParams.get('limit')) || (Number(endText) - Number(startText) + 1) || 1000);
          const end = Math.min(customerMappingRows.length, start + limit);
          const rows = customerMappingRows.slice(start, end);
          return route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*', 'content-range': `${start}-${Math.max(start, end - 1)}/${customerMappingRows.length}` },
            body: JSON.stringify(rows) });
        });
        await page.route('**/rest/v1/ph_app_users**', async (route: Route) => {
          if (route.request().method() !== 'GET') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture is read only.' }) });
          return route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/1' },
            body: JSON.stringify([{ username: 'abbey_burka', display_name: 'Abbey Burka', role: 'REP' }]) });
        });
        // Native-auth reads of ph_app_users use the protected RPC, not the REST
        // table endpoint. Keep the synthetic directory on the production path.
        await page.route('**/rest/v1/rpc/get_app_user_directory', async (route: Route) => {
          if (route.request().method() !== 'POST') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture is read only.' }) });
          return route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify([{ username: 'abbey_burka', display_name: 'Abbey Burka', role: 'REP', division: null, language: null }]) });
        });
      }
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

        if (customerMappingWarmup && body.action === 'customer-rep-map' && body.operation === 'options') {
          const details = request.postDataJSON() as { page?: number; pageSize?: number; salesrepId?: string };
          const pageNumber = Math.max(0, Number(details.page) || 0);
          const pageSize = Math.max(1, Math.min(200, Number(details.pageSize) || 200));
          const repRows = details.salesrepId === 'BENCH.REP' ? customerMappingRows : [];
          const rows = repRows.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize);
          if (details.salesrepId === 'BENCH.REP') {
            customerOptionCalls.push(`${pageNumber}:${rows.length}`);
            if (pageNumber === 0) await customerMappingWarmup.beforeOptionsResponse?.();
          }
          return route.fulfill({ status: 200, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ ok: true, revision: customerMappingRevision, total: repRows.length, rows }) });
        }

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
    customerOptionCalls,
    updateFirstCustomerMapping(name: string, revision: string) {
      customerMappingRows[0].customername = name;
      customerMappingRevision = revision;
    },
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
  const captureBrowserScheduling = process.env.REQUEST_RENDER_DIAGNOSTICS === '1';
  await appEval(page, `(() => {
    const profile = window.__requestListProfile = {
      renderDurations: [], chunkDurations: [], operations: [], stage: 'setup',
      activeRender: 0, nextRender: 1, longTasks: [], frameGaps: [], lastFrameTimestamp: 0,
      schedulingDiagnosticsEnabled: ${captureBrowserScheduling},
    };
    if (profile.schedulingDiagnosticsEnabled && typeof PerformanceObserver !== 'undefined'
        && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      try {
        const observer = new PerformanceObserver(entries => {
          for (const entry of entries.getEntries()) {
            profile.longTasks.push({ stage: profile.stage, startTime: entry.startTime, durationMs: entry.duration });
          }
          if (profile.longTasks.length > 100) profile.longTasks.splice(0, profile.longTasks.length - 100);
        });
        observer.observe({ type: 'longtask', buffered: true });
        window.__requestListLongTaskObserver = observer;
      } catch (_) {}
    }
    const timedFunctions = [
      'syncRequestRenderChrome', 'syncRequestHeaderSearchChrome', 'getScopedRequestItems',
      'appendDockSuspendDcRequestMirrorRows', 'reconcileRequestDrillState',
      'buildPendingRequestRenderPlan', 'getRequestTabQueueCounts', 'buildRequestChunkRenderKey',
      'buildSuspendTagRenderPlan', 'getSortedSuspendTagSourceRows',
      'ensureRequestSuspendTagRenderShell', 'renderRequestSuspendTagFilters',
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
      if (profile.schedulingDiagnosticsEnabled && profile.lastFrameTimestamp) {
        const gapMs = timestamp - profile.lastFrameTimestamp;
        if (gapMs >= 50) {
          profile.frameGaps.push({ stage: profile.stage, gapMs });
          if (profile.frameGaps.length > 100) profile.frameGaps.shift();
        }
      }
      if (profile.schedulingDiagnosticsEnabled) profile.lastFrameTimestamp = timestamp;
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
    longTasks?: Array<{ stage: string; startTime: number; durationMs: number }>;
    frameGaps?: Array<{ stage: string; gapMs: number }>;
    schedulingDiagnosticsEnabled?: boolean;
  }>(page, 'window.__requestListProfile');
  const durations = result.renderDurations.filter(item => item.stage === stage);
  const chunks = result.chunkDurations.filter(item => item.stage === stage);
  const operations = result.operations.filter(item => item.stage === stage);
  const limitMs = 400;
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
    visibility: await appEval(page, '({ state: document.visibilityState, focused: document.hasFocus() })'),
    schedulingDiagnostics: result.schedulingDiagnosticsEnabled ? {
      longTasks: result.longTasks || [], frameGaps: result.frameGaps || [],
    } : 'disabled (set REQUEST_RENDER_DIAGNOSTICS=1 for failure investigation)',
    cacheConditions: 'Fresh isolated login then repeated renders in the same verified context.' }));
  const maximumMeasuredMs = Math.max(...durations.map(item => item.durationMs), ...chunks.map(item => item.durationMs));
  assertFrontendUiTiming(expect.soft(maximumMeasuredMs), test.info().project, limitMs);
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
    const profilePath = testInfo.outputPath('request-cpu-profile.json');
    await writeFile(profilePath, JSON.stringify({ profile, hottest }, null, 2));
    await testInfo.attach('request-cpu-profile.json', {
      path: profilePath, contentType: 'application/json',
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
      longTasks?: Array<{ stage: string; startTime: number; durationMs: number }>;
      frameGaps?: Array<{ stage: string; gapMs: number }>;
      schedulingDiagnosticsEnabled?: boolean;
    }>(page, 'window.__requestListProfile');
    const timingsPath = testInfo.outputPath('request-render-timings.json');
    await writeFile(timingsPath, JSON.stringify({
        browserVersion: await page.context().browser()?.version(), viewport: page.viewportSize(),
        datasetRows: { pending: 200, suspend: 1000 },
        acceptedLimitsMs: { pending: 400, suspend: 400 },
        cacheConditions: 'Fresh isolated login then repeated renders in the same verified context.',
        ...evidence,
      }, null, 2));
    await testInfo.attach('request-render-timings.json', {
      path: timingsPath,
      contentType: 'application/json',
    });
  } catch (error) {
    await testInfo.attach('request-render-timings-error.txt', {
      body: Buffer.from(String(error)), contentType: 'text/plain',
    });
  }
}

test('cold Request startup stays locked until 12,000 customer choices are warm, then Select Customer paints within 400 ms', { tag: ['@home-role'] }, async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The Request customer picker fixture requires a base URL.');
  let releaseOptions!: () => void;
  const optionsGate = new Promise<void>(resolve => { releaseOptions = resolve; });
  let signalOptionsStarted!: () => void;
  const optionsStarted = new Promise<void>(resolve => { signalOptionsStarted = resolve; });
  let startupObservation: {
    loginVisible: boolean; shellHidden: boolean; modalHidden: boolean; progressText: string;
    currentUser: string; currentRole: string; nativeAuthSessionActive: boolean; appAccessStatus: string;
    appAccessStale: boolean; appAccessUsername: string; roleAccessReady: boolean;
    requestAllowed: boolean; requestScopedAllowed: boolean; homeApplied: boolean;
    requestRepDirectory: { ready: boolean; loading: boolean; count: number; error: string };
    sharedUserDirectory: { loaded: boolean; count: number };
    coordinator: { status: unknown; statistics: unknown };
    startupProbe: unknown[];
  } | null = null;
  const observedCustomerReads: Array<{ method: string; path: string; detail?: string; status?: number; failure?: string; count?: number; elapsedMs?: number }> = [];
  const browserErrors: string[] = [];
  const diagnosticStartedAt = Date.now();
  page.on('request', request => {
    const url = new URL(request.url());
    if (/customer|app-api|revision|source|ph_app_users|get_app_user_directory/.test(url.pathname)) {
      const body = request.postDataJSON?.() as Record<string, unknown> | null;
      const detail = request.method() === 'POST' ? [body?.action, body?.operation, body?.dataset, body?.salesrepId,
        JSON.stringify(body?.requested_roles ?? null), JSON.stringify(body?.p_dataset_keys ?? null)].filter(Boolean).join(':')
        : [request.headers()['range'] || '', url.searchParams.get('select') || ''].filter(Boolean).join(':');
      const entry = observedCustomerReads.find(item => item.method === request.method() && item.path === url.pathname && item.detail === detail);
      if (entry) entry.count = Number(entry.count || 1) + 1;
      else if (observedCustomerReads.length < 80) observedCustomerReads.push({ method: request.method(), path: url.pathname, detail, count: 1, elapsedMs: Date.now() - diagnosticStartedAt });
    }
  });
  page.on('requestfinished', async request => {
    const url = new URL(request.url());
    if (!/customer|app-api|revision|source|ph_app_users|get_app_user_directory/.test(url.pathname)) return;
    try {
      const status = (await request.response())?.status();
      const entry = [...observedCustomerReads].reverse().find(item => item.method === request.method() && item.path === url.pathname && item.status === undefined && !item.failure);
      if (entry && status !== undefined) entry.status = status;
    } catch { /* Diagnostic only. */ }
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (!/customer|app-api|revision|source|ph_app_users|get_app_user_directory/.test(url.pathname)) return;
    const entry = [...observedCustomerReads].reverse().find(item => item.method === request.method() && item.path === url.pathname && item.status === undefined && !item.failure);
    if (entry) entry.failure = request.failure()?.errorText || 'request failed';
  });
  page.on('pageerror', error => browserErrors.push(error.message));
  const setupPromise = installRequestListFixture(page, baseURL, {
    rowCount: 12000,
    startupMode: 'cold',
      beforeLogin: async () => {
        await page.waitForFunction(() => window.eval('typeof initializeAppAccessSnapshot === "function" && typeof prepareRequestModalChoicesForStartup === "function"'), null, { timeout: 15_000 });
        await page.evaluate(() => window.eval(`(() => {
          const probe = window.__requestStartupProbe = [];
          let lastLookupOwner = null;
          const originalLookupOwner = getRequestModalLookupOwnerSignature;
          getRequestModalLookupOwnerSignature = function(...args) {
            const value = originalLookupOwner.apply(this, args);
            if (lastLookupOwner !== null && lastLookupOwner !== value) probe.push({ type: 'lookup-owner-changed', at: performance.now(), previous: lastLookupOwner, next: value });
            lastLookupOwner = value;
            return value;
          };
          const originalRepNormalizer = normalizeRequestRepUserOption;
          normalizeRequestRepUserOption = function(row) {
            const value = originalRepNormalizer.call(this, row);
            probe.push({ type: 'rep-option-normalized', at: performance.now(), row: {
              username: row?.username ?? row?.USERNAME ?? '', role: row?.role ?? row?.ROLE ?? '',
              display_name: row?.display_name ?? row?.displayName ?? row?.display ?? '',
            }, result: value ? { username: value.username, label: value.label, role: value.role } : null });
            return value;
          };
          const originalAllowedRepOptions = getAllowedRequestModalRepOptions;
          let allowedRepProbeCount = 0;
          getAllowedRequestModalRepOptions = function(...args) {
            const value = originalAllowedRepOptions.apply(this, args);
            if (allowedRepProbeCount++ < 30) probe.push({ type: 'allowed-reps', at: performance.now(), count: value?.length ?? -1,
              rows: value?.slice(0, 3).map(option => ({ label: option.label, salesrepId: option.salesrepId })) || [],
              csr: isCsrRequestAssistantUser(), requestReady: requestModalRepUserOptionsReady === true,
              requestError: String(requestModalRepUserOptionsError || ''), mappingSignature: getDatasetLoadSignature('customerRepMap') });
            return value;
          };
          const snapshot = () => ({ user: String(currentUser || ''), role: String(currentRole || ''), nativeAuth: nativeAuthSessionActive === true,
            accessStatus: String(appAccessSnapshotState?.status || ''), accessStale: appAccessSnapshotState?.stale === true,
            accessUsername: String(appAccessSnapshotState?.username || ''), roleReady: document.body?.classList.contains('role-access-ready') === true,
            requestAllowed: typeof canAccessView === 'function' && canAccessView('request'),
            requestScopedAllowed: typeof canUseRequestRepScopedAccess === 'function' && canUseRequestRepScopedAccess(),
            mapRows: Array.isArray(customerRepMapRows) ? customerRepMapRows.length : -1,
            mapFull: typeof isDatasetLoaded === 'function' && isDatasetLoaded('customerRepMap', 'full'),
            reps: typeof getAllowedRequestModalRepOptions === 'function' ? getAllowedRequestModalRepOptions().map(option => option.label).slice(0, 5) : [] });
          const originalAccess = initializeAppAccessSnapshot;
          initializeAppAccessSnapshot = async function(...args) {
            const startedAt = performance.now(); probe.push({ type: 'access-start', at: startedAt, args: args[0] || null, state: snapshot() });
            try { const value = await originalAccess.apply(this, args); probe.push({ type: 'access-end', at: performance.now(), elapsedMs: performance.now() - startedAt, state: snapshot(), hasValue: !!value }); return value; }
            catch (error) { probe.push({ type: 'access-error', at: performance.now(), elapsedMs: performance.now() - startedAt, message: String(error?.message || error), state: snapshot() }); throw error; }
          };
          const originalWarmup = prepareRequestModalChoicesForStartup;
          prepareRequestModalChoicesForStartup = async function(...args) {
            const startedAt = performance.now(); probe.push({ type: 'warmup-start', at: startedAt, args, state: snapshot() });
            try { const value = await originalWarmup.apply(this, args); probe.push({ type: 'warmup-end', at: performance.now(), elapsedMs: performance.now() - startedAt, ready: value, state: snapshot() }); return value; }
            catch (error) { probe.push({ type: 'warmup-error', at: performance.now(), elapsedMs: performance.now() - startedAt, message: String(error?.message || error), state: snapshot() }); throw error; }
          };
          const originalPrefetch = prefetchRequestModalCustomerOptions;
          prefetchRequestModalCustomerOptions = function(...args) {
            const startedAt = performance.now(); probe.push({ type: 'prefetch-start', at: startedAt, args, state: snapshot() });
            return originalPrefetch.apply(this, args).then(value => {
              probe.push({ type: 'prefetch-end', at: performance.now(), elapsedMs: performance.now() - startedAt,
                ready: value, state: snapshot(), owner: prefetchRequestModalCustomerOptions.owner || '',
                completedOwner: prefetchRequestModalCustomerOptions.completedOwner || '' }); return value;
            }, error => { probe.push({ type: 'prefetch-error', at: performance.now(), elapsedMs: performance.now() - startedAt,
                message: String(error?.message || error), state: snapshot() }); throw error; });
          };
          const originalRepDirectory = ensureRequestRepUserOptionsReady;
          ensureRequestRepUserOptionsReady = async function(...args) {
            const startedAt = performance.now(); probe.push({ type: 'rep-directory-start', at: startedAt, args,
              owner: getRequestModalLookupOwnerSignature(), cacheOwner: ensureRequestRepUserOptionsReady.cacheOwner || '',
              shared: typeof shouldUseProductionLiveSyncSideLoad === 'function' && shouldUseProductionLiveSyncSideLoad(), state: snapshot() });
            try { const value = await originalRepDirectory.apply(this, args); probe.push({ type: 'rep-directory-end', at: performance.now(),
              elapsedMs: performance.now() - startedAt, count: Array.isArray(value) ? value.length : -1,
              ready: requestModalRepUserOptionsReady === true, error: String(requestModalRepUserOptionsError || ''),
              owner: getRequestModalLookupOwnerSignature(), cacheOwner: ensureRequestRepUserOptionsReady.cacheOwner || '',
              mappingSignature: getDatasetLoadSignature('customerRepMap'),
              sharedLoaded: assignableAppUsersLoaded === true, sharedCount: assignableAppUsers?.length ?? -1 }); return value; }
            catch (error) { probe.push({ type: 'rep-directory-error', at: performance.now(), elapsedMs: performance.now() - startedAt,
              message: String(error?.message || error), state: snapshot(), sharedLoaded: assignableAppUsersLoaded === true,
              sharedCount: assignableAppUsers?.length ?? -1 }); throw error; }
          };
          const originalSideData = ensureProductionLiveSyncSideData;
          ensureProductionLiveSyncSideData = async function(id, ...args) {
            const startedAt = performance.now(); probe.push({ type: 'side-data-start', at: startedAt, id, state: snapshot() });
            try { const value = await originalSideData.call(this, id, ...args); probe.push({ type: 'side-data-end', at: performance.now(),
              id, elapsedMs: performance.now() - startedAt, ready: value, sharedLoaded: assignableAppUsersLoaded === true,
              sharedCount: assignableAppUsers?.length ?? -1, userNames: assignableAppUsers?.slice(0, 3).map(row => row.username) ?? [],
              coordinator: getProductionLiveSyncCoordinator?.().getStatus?.() || null,
              statistics: getProductionLiveSyncCoordinator?.().getStatistics?.() || null }); return value; }
            catch (error) { probe.push({ type: 'side-data-error', at: performance.now(), id, elapsedMs: performance.now() - startedAt,
              message: String(error?.message || error), state: snapshot(),
              coordinator: getProductionLiveSyncCoordinator?.().getStatus?.() || null,
              statistics: getProductionLiveSyncCoordinator?.().getStatistics?.() || null,
              context: (() => { const value = getProductionLiveSyncContext?.(); return { viewKey: value?.viewKey,
                adapters: value?.adapters?.map(adapter => adapter.id) || [], scope: value?.scope, visible: value?.visible }; })() }); throw error; }
          };
          const originalSchedule = scheduleRequestModalReferencePrefetch;
          scheduleRequestModalReferencePrefetch = function(...args) { probe.push({ type: 'scheduled-prefetch', at: performance.now(), args, state: snapshot() }); return originalSchedule.apply(this, args); };
          return true;
        })()`));
      },
    beforeOptionsResponse: async () => {
      startupObservation = await page.evaluate(() => ({
        loginVisible: !!document.getElementById('view-login')?.getClientRects().length,
        shellHidden: !!document.getElementById('app-wrapper')?.classList.contains('hidden'),
        modalHidden: !!document.getElementById('request-rep-modal')?.classList.contains('hidden'),
        progressText: String(document.getElementById('login-progress-label')?.textContent || ''),
        currentUser: String(currentUser || ''), currentRole: String(currentRole || ''),
        nativeAuthSessionActive: nativeAuthSessionActive === true,
        appAccessStatus: String(appAccessSnapshotState?.status || ''), appAccessStale: appAccessSnapshotState?.stale === true,
        appAccessUsername: String(appAccessSnapshotState?.username || ''),
        roleAccessReady: document.body?.classList.contains('role-access-ready') === true,
        requestAllowed: typeof canAccessView === 'function' && canAccessView('request'),
        requestScopedAllowed: typeof canUseRequestRepScopedAccess === 'function' && canUseRequestRepScopedAccess(),
        homeApplied: hasAppliedInitialHomeView === true,
        requestRepDirectory: {
          ready: requestModalRepUserOptionsReady === true,
          loading: requestModalRepUserOptionsLoading === true,
          count: Array.isArray(requestModalRepUserOptions) ? requestModalRepUserOptions.length : -1,
          error: String(requestModalRepUserOptionsError || ''),
        },
        sharedUserDirectory: {
          loaded: assignableAppUsersLoaded === true,
          count: Array.isArray(assignableAppUsers) ? assignableAppUsers.length : -1,
        },
        coordinator: (() => { const live = getProductionLiveSyncCoordinator?.(); return {
          status: live?.getStatus?.() || null,
          statistics: live?.getStatistics?.() || null,
        }; })(),
        startupProbe: window.__requestStartupProbe || [],
      }));
      signalOptionsStarted();
      await optionsGate;
    },
  });
  const optionRequestStarted = await Promise.race([
    optionsStarted.then(() => true),
    page.waitForTimeout(10000).then(() => false),
  ]);
  if (!optionRequestStarted) {
    const startupState = await page.evaluate(() => window.eval(`JSON.stringify({
      currentUser: currentUser || '', currentRole: currentRole || '', nativeAuthSessionActive: !!nativeAuthSessionActive,
      currentUserIsCsrAssistant: typeof isCsrRequestAssistantUser === 'function' ? isCsrRequestAssistantUser() : null,
      allowedRequestReps: typeof getAllowedRequestModalRepOptions === 'function' ? getAllowedRequestModalRepOptions().map(option => option.label).slice(0, 5) : [],
      requestRepDirectory: { ready: !!requestModalRepUserOptionsReady, loading: !!requestModalRepUserOptionsLoading,
        count: requestModalRepUserOptions?.length ?? -1 },
      mappedRepOptions: requestMappedRepOptions?.map(option => ({ label: option.label, salesrepId: option.salesrepId })).slice(0, 5) ?? [],
      abbeyId: typeof getRequestSelectedSalesrepId === 'function' ? getRequestSelectedSalesrepId('Abbey Burka') : '',
      requestAccess: typeof canAccessView === 'function' ? canAccessView('request') : null,
      scopedAccess: typeof canUseRequestRepScopedAccess === 'function' ? canUseRequestRepScopedAccess() : null,
      requestRepDirectory: { ready: !!requestModalRepUserOptionsReady, loading: !!requestModalRepUserOptionsLoading,
        count: requestModalRepUserOptions?.length ?? -1, error: String(requestModalRepUserOptionsError || '') },
      sharedUserDirectory: { loaded: !!assignableAppUsersLoaded, count: assignableAppUsers?.length ?? -1,
        users: assignableAppUsers?.slice(0, 3) ?? [] },
      bodyRoleReady: !!document.body?.classList.contains('role-access-ready'),
      appAccessState: appAccessSnapshotState?.status || '', appAccessStale: !!appAccessSnapshotState?.stale,
      requestCapability: getRequestCapabilities?.() || null,
      mappingRows: Array.isArray(customerRepMapRows) ? customerRepMapRows.length : -1,
      modalCache: requestMappingRpcCache?.size ?? -1,
      mappingDataset: (() => { const state = getDatasetState('customerRepMap') || {}; return {
        initialLoaded: !!state.initialLoaded, fullLoaded: !!state.fullLoaded, loading: !!state.loading,
        initialPromise: !!state.initialPromise, fullPromise: !!state.fullPromise, error: String(state.error || ''),
      }; })(),
      coordinator: (() => { const live = getProductionLiveSyncCoordinator?.(); return {
        status: live?.getStatus?.() || null, statistics: live?.getStatistics?.() || null,
      }; })(),
      prefetchOwner: prefetchRequestModalCustomerOptions.owner || '',
      prefetchCompletedOwner: prefetchRequestModalCustomerOptions.completedOwner || '',
      startupProbe: window.__requestStartupProbe || [],
    })`));
    throw new Error(`Request customer mapping prefetch did not start: ${startupState}; requests=${JSON.stringify(observedCustomerReads)}; browserErrors=${JSON.stringify(browserErrors)}`);
  }
  expect(startupObservation, `First customer-options request observed startup state: ${JSON.stringify(startupObservation)}; requests=${JSON.stringify(observedCustomerReads)}; browserErrors=${JSON.stringify(browserErrors)}`)
    .toMatchObject({ loginVisible: true, shellHidden: true, modalHidden: true });
  expect(startupObservation?.progressText,
    `Startup remained locked while the first options read was held: ${JSON.stringify(startupObservation)}`)
    .toMatch(/Preparing Request customer choices|Finalizing app/i);
  await page.waitForTimeout(160);
  const heldObservation = await page.evaluate(() => ({
    loginVisible: !!document.getElementById('view-login')?.getClientRects().length,
    shellHidden: !!document.getElementById('app-wrapper')?.classList.contains('hidden'),
    modalVisible: !!document.getElementById('request-rep-modal')?.getClientRects().length,
  }));
  expect(heldObservation).toEqual({ loginVisible: true, shellHidden: true, modalVisible: false });
  releaseOptions();
  const fixture = await setupPromise;
  expect(fixture.customerOptionCalls).toHaveLength(60);
  expect(fixture.customerOptionCalls[0]).toBe('0:200');
  expect(fixture.customerOptionCalls.at(-1)).toBe('59:200');
  expect(fixture.customerOptionCalls.reduce((sum, entry) => sum + Number(entry.split(':')[1]), 0)).toBe(12000);

  const selection = await page.evaluate(() => window.eval(`(() => {
    const operationMs = {};
    const originals = new Map();
    for (const name of ['resolveRequestRepSelectionForCurrentUser', 'buildRequestModalCustomerOptionsCache',
      'getRequestModalCustomerOptionsForRep', 'buildExistingRequestFolderCustomerGroups',
      'getExistingRequestFolderRepRows', 'getExistingRequestFolderRowsSignature',
      'renderExistingRequestFolderPickerContent', 'filterRepList']) {
      if (typeof window[name] !== 'function') continue;
      const original = window[name];
      originals.set(name, original);
      window[name] = function (...args) {
        const started = performance.now();
        try { return original.apply(this, args); }
        finally {
          const duration = performance.now() - started;
          const entry = operationMs[name] || (operationMs[name] = { calls: 0, totalMs: 0, maxMs: 0 });
          entry.calls++; entry.totalMs += duration; entry.maxMs = Math.max(entry.maxMs, duration);
        }
      };
    }
    const modalStarted = performance.now();
    showRequestModalBase();
    return new Promise((resolve, reject) => requestAnimationFrame(() => {
      const elapsedToModalFrameMs = performance.now() - modalStarted;
      const rep = Array.from(document.querySelectorAll('#rep-list-container .request-rep-option'))
        .find(button => button.textContent.includes('Abbey Burka'));
      if (!rep) { reject(new Error('BENCHMARK_REP_NOT_RENDERED')); return; }
      const selectionStarted = performance.now();
      rep.click();
      const syncDurationMs = performance.now() - selectionStarted;
      requestAnimationFrame(() => {
        for (const [name, original] of originals) window[name] = original;
        resolve({
        elapsedToModalFrameMs,
        elapsedToCustomerFrameMs: performance.now() - selectionStarted,
        syncDurationMs,
        customerHeading: document.querySelector('#existing-folder-container .request-step-header h3')?.textContent || '',
        firstCustomer: document.querySelector('#existing-folder-container .request-choice-card .request-choice-title')?.textContent || '',
        customerLoading: document.querySelector('#existing-folder-container .request-empty-state')?.textContent || '',
        visibleCount: document.querySelectorAll('#existing-folder-container .request-choice-card').length,
        operationMs,
      }); });
    }));
  })()`));
  console.log('REQUEST_CUSTOMER_PICKER_MEASUREMENT', JSON.stringify({
    browserVersion: await page.context().browser()?.version(), viewport: page.viewportSize(),
    mappingRows: 12000, optionsPages: 60, cache: 'cold startup prefetch completed before shell became interactive',
    startupLockMs: 160, selection, customerLimitMs: 400, otherModalLimitMs: 400, instrumentation: { trace: 'off', screenshots: 'off' },
  }));
  expect(selection).toMatchObject({ customerHeading: 'Select Customer' });
  // The rep screen and the cached Select Customer choice use the same global 400 ms UI gate.
  assertFrontendUiTiming(expect(selection.elapsedToModalFrameMs), test.info().project);
  expect(selection.customerLoading).toBe('');
  expect(selection.firstCustomer).toBe('Benchmark Customer 00000');
  expect(selection.visibleCount).toBeGreaterThan(0);
  assertFrontendUiTiming(expect(selection.elapsedToCustomerFrameMs), test.info().project);

  const card = page.locator('#existing-folder-container .request-choice-card').first();
  const originalCard = await card.elementHandle();
  expect(originalCard).not.toBeNull();
  const originalGeometry = await card.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const optionsRequestsBeforeRevisionRefresh = fixture.customerOptionCalls.length;
  // Retain this customer's sort position: moving it outside the visible page
  // should legitimately unmount it and is not a background-remount regression.
  fixture.updateFirstCustomerMapping('Benchmark Customer 00000 Updated', 'customer-map-r2');
  await appEval(page, `(() => {
    const original = getDatasetLoadSignature;
    getDatasetLoadSignature = key => key === 'customerRepMap' ? original(key) + ':fixture-revision-r2' : original(key);
    return true;
  })()`);
  expect(await appEval<boolean>(page, 'prefetchRequestModalCustomerOptions()'),
    'a dataset revision change must warm new per-rep options even when the session and permissions stay the same').toBe(true);
  expect(fixture.customerOptionCalls.length).toBeGreaterThan(optionsRequestsBeforeRevisionRefresh);
  expect(await appEval<string>(page, 'prefetchRequestModalCustomerOptions.completedOwner'))
    .toBe(await appEval<string>(page, 'getRequestModalCustomerMappingCacheSignature()'));
  await page.evaluate(() => window.eval('ensureRequestModalCustomerOptionsReady(true)'));
  await expect.poll(() => page.evaluate(() => window.eval('requestModalCustomerOptionsReady === true'))).toBe(true);
  expect(await originalCard?.evaluate(node => node.isConnected)).toBe(true);
  expect(await card.textContent()).toContain('Benchmark Customer 00000 Updated');
  const refreshedGeometry = await card.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(refreshedGeometry).toEqual(originalGeometry);
});

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
