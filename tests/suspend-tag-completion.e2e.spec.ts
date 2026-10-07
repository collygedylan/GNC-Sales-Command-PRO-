import { expect, test, type Page, type Route } from '@playwright/test';
// @test-group: @suspend-tag,suspend



type FixtureRow = Record<string, string | number>;
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
const safeDatasetReads = new Set(['request_queue', 'active_request', 'soc', 'suspend_tag', 'cav', 'reserves', 'sales_office', 'dock_team', 'dock_item', 'dock_issue', 'dock_allocations', 'productivity_history']);
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

/** Runs the built app's real renderer, confirmation, transport and cache logic.
 * Only identity/data-loading boundaries are supplied. Backend state lives in
 * this test process across refresh/reload; no customer record is ever changed.
 */
async function harness(page: Page, baseURL: string, rows = fixtures, options: { search?: string; expired?: boolean } = {}) {
  const origin = new URL(baseURL).origin;
  const backendRows = structuredClone(rows);
  const receipts = new Map<string, Record<string, unknown>>();
  const requests: CompletionRequest[] = [];
  const unexpectedMutations: string[] = [];
  const blockedReadOnlyAppApiCalls: string[] = [];
  const pageErrors: string[] = [];
  const runtimeResponses: string[] = [];
  const replies: Reply[] = [];
  await page.addInitScript(expired => { (window as any).__suspendTestAuthReady = !expired; }, !!options.expired);
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json',
  };
  const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) runtimeResponses.push(response.url());
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (url.pathname === '/functions/v1/app-api' && request.method() === 'POST' && request.postDataJSON()?.action === 'suspend_tag') {
      const body=request.postDataJSON();
      const input=body.payload || {};
      requests.push({body});
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
      if(body.operation==='send' || (body.operation==='complete' && wasDenied)) {
        source.SUSPEND_TAG_STATUS='awaiting_rep'; source.SUSPEND_TAG_APPROVAL_ID='a0000000-0000-4000-8000-'+String(receipts.size+1).padStart(12,'0');
      }
      source.SUSPEND_TAG_VERSION=Number(source.SUSPEND_TAG_VERSION)+1;
      const acknowledgment={ok:true,row:canonical()};
      receipts.set(body.commandId,acknowledgment);
      if(reply.abort) return route.abort('connectionfailed');
      return fulfill(route,{ok:true,data:acknowledgment});
    }
    if (url.pathname === '/functions/v1/app-api' && request.method() === 'POST') {
      const body = request.postDataJSON() || {};
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
      const safeReadOrTelemetry = ['/rest/v1/rpc/report_app_health_event', '/rest/v1/rpc/get_app_user_directory'];
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
    await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
    await page.evaluate((data) => {
      (window as any).__suspendCompletionFixtureRows = data;
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
        loadDatasetTargetsWithLimit = async () => {
          const snapshot = structuredClone(window.__suspendCompletionFixtureRows);
          if (window.__suspendCompletionDatasetGate) await window.__suspendCompletionDatasetGate;
          processAndLoadData({ suspendTagData: snapshot, _fromCache: true });
          return true;
        };
        processAndLoadData({ suspendTagData: structuredClone(window.__suspendCompletionFixtureRows), requestsData: [], data: [], _fromCache: true });
        document.getElementById('view-login').style.setProperty('display', 'none', 'important');
        document.getElementById('app-wrapper').classList.remove('hidden');
        activeReqTab = 'suspend-tag';
        requestSuspendTagCommonNameSearchTerm = '';
        requestSuspendTagAssignedToFilter = 'all';
        requestSuspendTagContSizeFilter = 'all';
        requestSuspendTagDockFilter = 'all';
        showOnlyPrimaryView('request');
        invalidateResolvedViewStateCaches();
        renderRequest();
      })()`);
    }, nextRows);
    await expect(page.locator('#view-request')).toBeVisible();
  };
  await page.goto('/?post_deploy_access_canary=1&suspend_tag_canary=1' + (options.search || ''), { waitUntil: 'load' });
  await seed();
  expect(runtimeResponses, 'must exercise the deferred production-built runtime').toHaveLength(1);
  const card = (row: FixtureRow = rows[0]) => page.locator(`#request-content [data-request-uid="dock_suspend_dc_${row.UNIQUE_ID}"]`);
  const done = (row: FixtureRow = rows[0]) => card(row).locator('button[onclick*="completeDockSuspendDcRequestFromCard"]');
  const complete = async (row: FixtureRow = rows[0]) => {
    await done(row).tap();
    await expect(page.locator('#app-prompt-dialog')).toContainText('Complete Suspend Tag');
    await page.locator('#app-prompt-dialog').getByRole('button', { name: 'Mark Done', exact: true }).tap();
  };
  const refresh = async (nextRows: FixtureRow[] = backendRows) => {
    await page.evaluate((data) => {
      (window as any).__suspendCompletionFixtureRows = data;
      window.eval('processAndLoadData({suspendTagData:structuredClone(window.__suspendCompletionFixtureRows),_fromCache:true}); renderRequest();');
    }, nextRows);
  };
  const assertClean = () => {
    expect(unexpectedMutations, 'Done must not issue generic PATCH/DELETE, email or stock writes').toEqual([]);
    expect(blockedReadOnlyAppApiCalls.filter((call) => call !== 'inventory_read:source_freshness' && ![...safeDatasetReads].some((dataset) => call === `dataset_read:${dataset}`))).toEqual([]);
    expect(pageErrors, 'completion must not throw unhandled browser errors').toEqual([]);
  };
  return { requests, replies, receipts, backendRows, card, done, complete, seed, refresh, assertClean };
}

test('Done waits for server acknowledgment, completes only that source and retains it, and survives refresh and app reload', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.complete();
  await expect.poll(() => app.requests.length).toBe(1);
  await expect(app.card()).toHaveCount(1);
  await expect(app.done()).toBeDisabled();
  await expect(page.locator('#toast-notification')).not.toContainText('Suspend Tag row completed.');
  expect(app.backendRows[0].DATE_COMPLETED).toBe('');
  expect(app.requests[0].body.payload.sourceUid).toBe(fixtures[0].UNIQUE_ID);
  expect(new Date(app.requests[0].body.payload.expectedLastUpdated).toISOString()).toBe(sourceRevision);
  expect(app.requests[0].body.commandId).toMatch(/^[0-9a-f-]{36}$/i);
  release();
  await expect(app.card()).toHaveCount(1);
  await expect(app.card()).toContainText('Completed — Ready to Email');
  await expect(app.card(fixtures[1])).toHaveCount(1);
  await app.refresh();
  await expect(app.card()).toHaveCount(1);
  await expect(app.card()).toContainText('Completed — Ready to Email');
  await page.reload({ waitUntil: 'load' });
  await app.seed();
  await expect(app.card()).toHaveCount(1);
  await expect(app.card()).toContainText('Completed — Ready to Email');
  await expect(app.done(fixtures[1])).toBeVisible();
  expect(app.backendRows[0].PTRONHAND).toBe('40');
  expect(app.backendRows[0].PTRAVAILABLE).toBe('30');
  expect(app.backendRows[1].DATE_COMPLETED).toBe('');
  expect(app.requests).toHaveLength(1);
  app.assertClean();
});

test('canceling confirmation retains the row and makes no completion request', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await app.done().tap();
  await page.locator('#app-prompt-dialog').getByRole('button', { name: 'Keep Pending', exact: true }).tap();
  await expect(app.done()).toBeEnabled();
  expect(app.requests).toHaveLength(0);
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
});

test('double activation sends one completion even through a stale rerendered button', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.complete();
  await expect.poll(() => app.requests.length).toBe(1);
  await page.evaluate((uid) => window.eval(`void completeDockSuspendDcRequestFromCard(${JSON.stringify('dock_suspend_dc_' + uid)}, null)`), fixtures[0].UNIQUE_ID);
  await expect(page.locator('#app-prompt-dialog')).toBeHidden();
  await expect(app.card()).toHaveCount(1);
  expect(app.requests).toHaveLength(1);
  release();
  await expect(app.card()).toHaveCount(1);
  await expect(app.card()).toContainText('Completed — Ready to Email');
  expect(app.receipts.size).toBe(1);
  app.assertClean();
});

test('lost response leaves row actionable and retry after reload reuses the persisted request token', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  app.replies.push({ abort: true, commitBeforeAbort: true });
  await app.complete();
  await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind', 'error');
  await expect(app.done()).toBeEnabled();
  expect(app.requests).toHaveLength(1);
  const token = app.requests[0].body.commandId;
  // Simulate cached data after a lost response, while the backend retains Done.
  await page.reload({ waitUntil: 'load' });
  await app.seed(fixtures);
  await app.complete();
  await expect(app.card()).toHaveCount(1);
  await expect(app.card()).toContainText('Completed — Ready to Email');
  expect(app.requests).toHaveLength(2);
  expect(app.requests[1].body.commandId).toBe(token);
  expect(app.receipts.size).toBe(1);
  app.assertClean();
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
    await app.complete();
    await expect(page.locator('#toast-notification')).toContainText(failure.message);
    await expect(app.done()).toBeEnabled();
    await app.refresh();
    await expect(app.done()).toBeEnabled();
    expect(app.backendRows[0].DATE_COMPLETED).toBe('');
    expect(app.requests).toHaveLength(1);
    app.assertClean();
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
    await app.complete();
    await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind', 'error');
    await expect(app.done()).toBeEnabled();
    await expect(app.card()).toHaveCount(1);
  }
  expect(app.receipts.size).toBe(0);
  app.assertClean();
});

test('a stale snapshot cannot restore Done, but a newer reopened source stays visible', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await app.complete();
  await expect(app.card()).toHaveCount(1);
  await expect(app.card()).toContainText('Completed — Ready to Email');
  await app.refresh(fixtures);
  await expect(app.card()).toHaveCount(1);
  await expect(app.card()).toContainText('Completed — Ready to Email');
  const reopened = fixtures.map((row) => ({ ...row, LAST_UPDATED: '2026-09-08T16:00:00.000Z' }));
  await app.refresh(reopened);
  await expect(app.done()).toBeVisible();
  app.assertClean();
});

test('an old completion response cannot hide a newer reopened version of the source', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.complete();
  await expect.poll(() => app.requests.length).toBe(1);
  const reopened = fixtures.map((row) => ({ ...row, LAST_UPDATED: '2026-09-08T16:00:00.000Z' }));
  await app.refresh(reopened);
  release();
  await expect.poll(() => app.receipts.size).toBe(1);
  await expect(app.done()).toBeVisible();
  await expect(app.done()).toBeEnabled();
  app.assertClean();
});


test('detail Mark Done preserves failed form edits and only applies a confirmed save', {"tag":["@suspend-tag"]}, async ({page,baseURL})=>{
  test.setTimeout(120000);
  const app=await harness(page,baseURL!);
  await page.evaluate(()=>window.eval("openDockSuspendDcRequestUpdate('dock_suspend_dc_browser-suspend-1')"));
  await expect(page.locator('#request-open-info-modal')).toBeVisible();
  await page.locator('#request-open-info-ok').tap();
  await expect(page.locator('#req-spec')).toBeVisible();
  await page.waitForFunction(()=>!(window as any).isDetailTransitionActive());
  for (const [id,value] of [['req-spec','24'],['req-match','80']]) {
    const custom=await page.evaluate(id=>(window as any).shouldPreferDetailMeasurementKeyboard() && (window as any).isDetailMeasurementKeyboardInput(document.getElementById(id)),id);
    if (custom) {
      await page.locator('#'+id).tap();
      await page.locator('#detail-measurement-keyboard').getByRole('button',{name:'Clear',exact:true}).first().tap({timeout:10000});
      for (const digit of value) await page.locator('#detail-measurement-keyboard [data-key-token="'+digit+'"]').tap();
      await page.locator('#detail-measurement-keyboard [data-key-token="__done"]').tap();
    } else await page.locator('#'+id).fill(value);
    await expect(page.locator('#'+id)).toHaveValue(value);
  }
  if (await page.locator('.request-av-note-sheet__close').isVisible()) await page.locator('.request-av-note-sheet__close').tap();
  app.replies.push({operation:'complete',status:403,body:{ok:false,code:'SUSPEND_TAG_FORBIDDEN'}});
  await page.locator('#req-btn-save-complete').tap({timeout:10000});
  await expect.poll(()=>app.requests.filter(r=>r.body.operation==='complete').length).toBeGreaterThan(0);
  await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind','error');
  await expect(page.locator('#req-spec')).toHaveValue('24');
  expect(app.backendRows[0].DATE_COMPLETED).toBe('');
  await page.locator('#req-btn-save-complete').tap();
  await expect.poll(()=>app.backendRows[0].SUSPEND_TAG_STATUS).toBe('completed');
  expect(app.backendRows[0].DOCK_SPEC).toBe('24');
  expect(String(app.backendRows[0].MATCH)).toBe('80');
  expect(app.requests.filter(r=>r.body.operation==='complete')).toHaveLength(2);
  app.assertClean();
});

test('emailed approval opens after sign-in and URL decision text never records a decision', {"tag":["@suspend-tag"]},async({page,baseURL})=>{
  test.setTimeout(120000);
  const id='b0000000-0000-4000-8000-000000000001';
  const row={...fixtures[0],DATE_COMPLETED:completionTime,SUSPEND_TAG_STATUS:'awaiting_rep',SUSPEND_TAG_APPROVAL_ID:id};
  const app=await harness(page,baseURL!,[row],{search:'&suspendApproval='+id+'&decision=approve',expired:true});
  await page.waitForTimeout(1800);
  await expect(page.locator('#suspend-tag-approval-dialog')).toHaveCount(0);
  expect(app.requests).toHaveLength(0);
  await page.evaluate(()=>{(window as any).__suspendTestAuthReady=true;});
  const dialog=page.locator('#suspend-tag-approval-dialog');
  await expect(dialog).toContainText('Synthetic browser customer');
  await expect(dialog.getByRole('button',{name:'Approve',exact:true})).toBeVisible();
  expect(app.requests.map(r=>r.body.operation)).toEqual(['approval']);
  await dialog.getByRole('button',{name:'Approve',exact:true}).tap();
  await expect(dialog).toContainText('Your reply email is queued');
  expect(app.requests.map(r=>r.body.operation)).toEqual(['approval','decide']);
  app.assertClean();
});

test('manual first email, denial preserves work, and re-completion starts a fresh approval', {"tag":["@suspend-tag"]}, async ({page,baseURL})=>{
  test.setTimeout(120000); // Two complete mobile approval rounds.
  const app=await harness(page,baseURL!);
  await app.complete();
  await expect(app.card()).toContainText('Completed — Ready to Email');
  expect(app.requests.map(r=>r.body.operation)).toEqual(['complete']);
  await app.card().getByRole('button',{name:'Email Rep for Approval',exact:true}).tap();
  await page.locator('#app-prompt-dialog').getByRole('button',{name:'Send',exact:true}).tap();
  await expect.poll(() => app.requests.map(r => r.body.operation)).toContain('send');
  await expect(page.locator('#toast-notification')).toContainText('Approval Queued');
  await expect(app.card()).toContainText('Awaiting Rep');
  const firstId=String(app.backendRows[0].SUSPEND_TAG_APPROVAL_ID);
  await page.evaluate(id=>window.eval('void openSuspendTagApproval('+JSON.stringify(id)+')'),firstId);
  const dialog=page.locator('#suspend-tag-approval-dialog');
  await expect(dialog).toContainText('Synthetic browser customer');
  await expect(dialog).toContainText('B.01.000');
  await dialog.getByRole('button',{name:'Deny',exact:true}).tap();
  await expect(dialog).toContainText('All data and photos are retained');
  await dialog.getByRole('button',{name:'Close',exact:true}).tap();
  await app.refresh();
  await expect(app.card()).toContainText('Denied / Needs Changes');
  expect(app.backendRows[0].DOCK_PHOTO_LINK).toBe(fixtures[0].DOCK_PHOTO_LINK);
  expect(app.backendRows[0].AV_NOTE).toBe(fixtures[0].AV_NOTE);
  await app.complete();
  await expect(app.card()).toContainText('Awaiting Rep');
  expect(app.backendRows[0].SUSPEND_TAG_APPROVAL_ID).not.toBe(firstId);
  await page.evaluate(id=>window.eval('void openSuspendTagApproval('+JSON.stringify(id)+',"approve")'),String(app.backendRows[0].SUSPEND_TAG_APPROVAL_ID));
  await expect(dialog).toContainText('Approved. Your reply email is queued.');
  await dialog.getByRole('button',{name:'Close',exact:true}).tap();
  await app.refresh();
  await expect(app.card()).toContainText('Approved');
  app.assertClean();
});
