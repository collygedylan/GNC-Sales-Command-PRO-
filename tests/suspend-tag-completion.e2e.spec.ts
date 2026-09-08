import { expect, test, type Page, type Route } from '@playwright/test';

type FixtureRow = Record<string, string | number>;
type Reply = {
  status?: number;
  body?: Record<string, unknown>;
  abort?: boolean;
  commitBeforeAbort?: boolean;
  wait?: Promise<void>;
};
type CompletionRequest = { body: Record<string, any> };
const sourceRevision = '2026-09-08T14:00:00.000Z';
const completionTime = '2026-09-08T15:00:00.000Z';
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
  DATE_COMPLETED: '',
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
async function harness(page: Page, baseURL: string, rows = fixtures) {
  const origin = new URL(baseURL).origin;
  const backendRows = structuredClone(rows);
  const receipts = new Map<string, Record<string, unknown>>();
  const requests: CompletionRequest[] = [];
  const unexpectedMutations: string[] = [];
  const pageErrors: string[] = [];
  const runtimeResponses: string[] = [];
  const replies: Reply[] = [];
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
    if (url.pathname === '/rest/v1/rpc/complete_suspend_tag_v1' && request.method() === 'POST') {
      const body = request.postDataJSON() || {};
      requests.push({ body });
      const reply = replies.shift() || {};
      if (reply.wait) await reply.wait;
      if (reply.body) return fulfill(route, reply.body, reply.status || 200);
      if (reply.abort && !reply.commitBeforeAbort) return route.abort('connectionfailed');
      const source = backendRows.find((row) => row.UNIQUE_ID === body.p_source_uid);
      if (!source) return fulfill(route, { message: 'Suspend Tag source row was not found.' }, 404);
      const existing = receipts.get(body.p_request_id);
      const acknowledgment = existing || {
        ok: true,
        sourceUid: body.p_source_uid,
        sourceLastUpdated: sourceRevision,
        completedAt: completionTime,
        alreadyCompleted: Boolean(source.DATE_COMPLETED),
      };
      if (!existing) {
        source.DATE_COMPLETED = String(acknowledgment.completedAt);
        receipts.set(body.p_request_id, acknowledgment);
      }
      if (reply.abort) return route.abort('connectionfailed');
      return fulfill(route, acknowledgment);
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
        getNativeAuthRequestHeaders = async () => ({ Authorization: 'Bearer browser-only-no-real-session', apikey: 'browser-only' });
        requestCapabilityState = {
          status: 'ready', stale: false, errorCode: '', loadedAt: Date.now(), username: 'dylan_collyge',
          capabilities: { username: 'dylan_collyge', scope: 'global', canViewQueue: true, canTakePhoto: true, canEdit: true, canComplete: true, canArchive: true }
        };
        appSeasonSettingsCache = { seasonCode: 'F1', salesYear: 27 };
        Object.keys(DATASET_DEFINITIONS).forEach((key) => {
          const state = getDatasetState(key);
          state.initialLoaded = state.fullLoaded = true;
          state.lastLoadedAt = new Date().toISOString();
        });
        loadDatasetTargetsWithLimit = async () => {
          const snapshot = structuredClone(window.__suspendCompletionFixtureRows);
          if (window.__suspendCompletionDatasetGate) await window.__suspendCompletionDatasetGate;
          processAndLoadData({ socData: snapshot, _fromCache: true });
          return true;
        };
        processAndLoadData({ socData: structuredClone(window.__suspendCompletionFixtureRows), requestsData: [], data: [], _fromCache: true });
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
  await page.goto('/?post_deploy_access_canary=1&suspend_tag_canary=1', { waitUntil: 'load' });
  await seed();
  expect(runtimeResponses, 'must exercise the deferred production-built runtime').toHaveLength(1);
  const card = (row: FixtureRow = rows[0]) => page.locator(`#request-content [data-request-uid="dock_suspend_dc_${row.UNIQUE_ID}"]`);
  const done = (row: FixtureRow = rows[0]) => card(row).locator('button[onclick*="handleDockSuspendDcDonePress"]');
  const complete = async (row: FixtureRow = rows[0]) => {
    await done(row).tap();
    await expect(page.locator('#app-prompt-dialog')).toContainText('Complete Suspend Tag');
    await page.locator('#app-prompt-dialog').getByRole('button', { name: 'Mark Done', exact: true }).tap();
  };
  const refresh = async (nextRows: FixtureRow[] = backendRows) => {
    await page.evaluate((data) => {
      (window as any).__suspendCompletionFixtureRows = data;
      window.eval('processAndLoadData({socData:structuredClone(window.__suspendCompletionFixtureRows),_fromCache:true}); renderRequest();');
    }, nextRows);
  };
  const assertClean = () => {
    expect(unexpectedMutations, 'Done must not issue generic PATCH/DELETE, email or stock writes').toEqual([]);
    expect(pageErrors, 'completion must not throw unhandled browser errors').toEqual([]);
  };
  return { requests, replies, receipts, backendRows, card, done, complete, seed, refresh, assertClean };
}

test('Done waits for server acknowledgment, removes only that source, and survives refresh and app reload', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.complete();
  await expect.poll(() => app.requests.length).toBe(1);
  await expect(app.card()).toHaveCount(1);
  await expect(app.done()).toBeDisabled();
  await expect(page.locator('#toast-notification')).not.toContainText('Suspend Tag row completed.');
  expect(app.backendRows[0].DATE_COMPLETED).toBe('');
  expect(app.requests[0].body.p_source_uid).toBe(fixtures[0].UNIQUE_ID);
  expect(new Date(app.requests[0].body.p_expected_last_updated).toISOString()).toBe(sourceRevision);
  expect(app.requests[0].body.p_request_id).toMatch(/^[0-9a-f-]{36}$/i);
  release();
  await expect(app.card()).toHaveCount(0);
  await expect(app.card(fixtures[1])).toHaveCount(1);
  await app.refresh();
  await expect(app.card()).toHaveCount(0);
  await page.reload({ waitUntil: 'load' });
  await app.seed();
  await expect(app.card()).toHaveCount(0);
  await expect(app.done(fixtures[1])).toBeVisible();
  expect(app.backendRows[0].PTRONHAND).toBe('40');
  expect(app.backendRows[0].PTRAVAILABLE).toBe('30');
  expect(app.backendRows[1].DATE_COMPLETED).toBe('');
  expect(app.requests).toHaveLength(1);
  app.assertClean();
});

test('canceling confirmation retains the row and makes no completion request', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await app.done().tap();
  await page.locator('#app-prompt-dialog').getByRole('button', { name: 'Keep Pending', exact: true }).tap();
  await expect(app.done()).toBeEnabled();
  expect(app.requests).toHaveLength(0);
  app.assertClean();
});

test('double activation sends one completion even through a stale rerendered button', async ({ page, baseURL }) => {
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
  await expect(app.card()).toHaveCount(0);
  expect(app.receipts.size).toBe(1);
  app.assertClean();
});

test('lost response leaves row actionable and retry after reload reuses the persisted request token', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  app.replies.push({ abort: true, commitBeforeAbort: true });
  await app.complete();
  await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind', 'error');
  await expect(app.done()).toBeEnabled();
  expect(app.requests).toHaveLength(1);
  const token = app.requests[0].body.p_request_id;
  // Simulate cached data after a lost response, while the backend retains Done.
  await page.reload({ waitUntil: 'load' });
  await app.seed(fixtures);
  await app.complete();
  await expect(app.card()).toHaveCount(0);
  expect(app.requests).toHaveLength(2);
  expect(app.requests[1].body.p_request_id).toBe(token);
  expect(app.receipts.size).toBe(1);
  app.assertClean();
});

for (const failure of [
  { status: 401, message: 'Session expired. Sign in again to complete Suspend Tag.' },
  { status: 403, message: 'You do not have permission to complete Suspend Tag.' },
  { status: 400, message: 'Suspend Tag source revision is required.' },
  { status: 409, message: 'Suspend Tag row changed. Refresh and review before completing.' },
]) {
  test(`HTTP ${failure.status} preserves actionable row and shows the actual error`, async ({ page, baseURL }) => {
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

test('malformed or mismatched acknowledgment never removes the row', async ({ page, baseURL }) => {
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

test('a stale snapshot cannot restore Done, but a newer reopened source stays visible', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await app.complete();
  await expect(app.card()).toHaveCount(0);
  await app.refresh(fixtures);
  await expect(app.card()).toHaveCount(0);
  const reopened = fixtures.map((row) => ({ ...row, LAST_UPDATED: '2026-09-08T16:00:00.000Z' }));
  await app.refresh(reopened);
  await expect(app.done()).toBeVisible();
  app.assertClean();
});

test('an old completion response cannot hide a newer reopened version of the source', async ({ page, baseURL }) => {
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
