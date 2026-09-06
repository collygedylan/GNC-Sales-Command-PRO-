import { expect, test, type Page, type Route } from '@playwright/test';

type FixtureRow = Record<string, string | number>;
type Reply = { status?: number; body?: Record<string, unknown>; abort?: boolean; wait?: Promise<void> };
type CompletionRequest = { body: Record<string, any>; token: string };

const fixtures: FixtureRow[] = [
  { UNIQUE_ID: 'season-done-canonical', MASTER_ID: 'season-done-master-1', SO_SOURCE: 'season', APP_TAB_ASSIGNMENT: 'season' },
  { UNIQUE_ID: 'season-done-no-source', MASTER_ID: 'season-done-master-2', APP_TAB_ASSIGNMENT: 'season' },
  { UNIQUE_ID: 'season-done-flyer', MASTER_ID: 'season-done-master-3', SO_SOURCE: 'flyer', APP_TAB_ASSIGNMENT: 'season' },
  { UNIQUE_ID: 'season-done-legacy', MASTER_ID: 'season-done-master-4', SO_SOURCE: 'legacy', APP_TAB_ASSIGNMENT: 'location' },
  { UNIQUE_ID: 'season-done-location-master', MASTER_ID: 'season-done-master-5', SO_SOURCE: 'season', APP_TAB_ASSIGNMENT: 'location', MASTER_ASSIGNMENT: 'location' },
].map((row, index) => ({
  ...row,
  DOM_ID: `so_${row.UNIQUE_ID}`,
  ITEMCODE: `BROWSER-ONLY-SEASON-${index + 1}`,
  COMMONNAME: `Browser fixture ${index + 1}`,
  CONTSIZE: '#15',
  LOTCODE: '27.F1',
  SEASON: 'F1',
  SALESYEAR: '27',
  LOCATIONCODE: 'C.01.000',
  PTRAVAILABLE: '200',
  AV_NOTE: 'Browser fixture note',
  WORKFLOW_STATUS: 'ready_for_custom_av',
  STATE_REVISION: 1,
  ARRIVED_AT: '2026-09-06T12:00:00Z',
  SOURCE_TABLE: 'ph_sales_office',
}));

/** All service traffic is mocked before navigation; never writes customer data.
 * Only identity and data-loading boundaries are supplied by the harness. The
 * production renderer, eligibility, handlers, transport, caching and toasts run.
 */
async function harness(page: Page, baseURL: string, rows = fixtures) {
  const origin = new URL(baseURL).origin;
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
    if (url.pathname.endsWith('/functions/v1/app-api') && request.method() === 'POST') {
      const body = request.postDataJSON() || {};
      if (body.action === 'season_sales_office' && body.operation === 'complete') {
        requests.push({ body, token: request.headers()['idempotency-key'] || '' });
        const reply = replies.shift() || {};
        if (reply.wait) await reply.wait;
        if (reply.abort) return route.abort('connectionfailed');
        return fulfill(route, reply.body || { ok: true, status: 'done', masterId: body.masterId, revision: Number(body.expectedRevision || 1) + 1 }, reply.status || 200);
      }
      if (body.action === 'season_sales_office' && body.operation === 'access') {
        return fulfill(route, { ok: true, username: 'dylan_collyge', allowed: true, canManage: true, users: ['dylan_collyge'] });
      }
      // Detect the old generic DELETE even when hidden inside the secure proxy.
      unexpectedMutations.push(`POST:app-api:${body.action}:${body.operation || body.method || ''}`);
      return route.abort('blockedbyclient');
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      if (!['/rest/v1/rpc/report_app_health_event', '/rest/v1/rpc/get_app_user_directory'].includes(url.pathname)) {
        unexpectedMutations.push(`${request.method()}:${url.pathname}`);
      }
      return route.abort('blockedbyclient');
    }
    if (url.origin !== origin) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());

  const seed = async (nextRows: FixtureRow[] = rows) => {
    await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
    await page.evaluate((data) => {
      (window as any).__seasonCompletionFixtureRows = data;
      window.eval(`(() => {
        if (!installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Isolated Season Done Test', 'ADMIN')) {
          throw new Error('SEASON_DONE_CANARY_IDENTITY_UNAVAILABLE');
        }
        appSeasonSettingsCache = { seasonCode: 'F1', salesYear: 27 };
        avBlanksPhotoBypassRemoteLoaded = true;
        avBlanksPhotoBypassAccessCache = { username: 'dylan_collyge', allowed: true, canManage: true, loadedAt: Date.now() };
        Object.keys(DATASET_DEFINITIONS).forEach((key) => {
          const state = getDatasetState(key);
          state.initialLoaded = state.fullLoaded = true;
          state.lastLoadedAt = new Date().toISOString();
        });
        fullInventory = window.__seasonCompletionFixtureRows.map((row, index) => ({
          ...row, UNIQUE_ID: row.MASTER_ID, DOM_ID: 'fi_' + index, APP_TAB_ASSIGNMENT: row.MASTER_ASSIGNMENT || 'season', SOURCE_TABLE: 'ph_master'
        }));
        rebuildMasterInventoryIndexes();
        // Exercise real snapshot ingestion, not a replacement eligibility filter.
        loadDatasetTargetsWithLimit = async (targets) => {
          window.__seasonCompletionLastLoadTargets = targets;
          const snapshot = structuredClone(window.__seasonCompletionFixtureRows);
          if (window.__seasonCompletionDatasetGate) await window.__seasonCompletionDatasetGate;
          processAndLoadData({ salesOfficeData: snapshot, _fromCache: true });
          return true;
        };
        processAndLoadData({ salesOfficeData: structuredClone(window.__seasonCompletionFixtureRows), _fromCache: true });
        document.getElementById('view-login').style.setProperty('display', 'none', 'important');
        document.getElementById('app-wrapper').classList.remove('hidden');
        activeSalesOfficeTab = 'season';
        showOnlyPrimaryView('sales-office');
        invalidateResolvedViewStateCaches();
        renderSalesOffice();
      })()`);
    }, nextRows);
    await expect(page.locator('#view-sales-office')).toBeVisible();
  };

  await page.goto('/?post_deploy_access_canary=1&season_sales_office_canary=1', { waitUntil: 'load' });
  await seed();
  expect(runtimeResponses, 'must run the deferred production-built runtime').toHaveLength(1);
  const card = (row: FixtureRow) => page.locator(`#sales-office-content [data-dom-id="so_${row.UNIQUE_ID}"]`);
  const done = (row: FixtureRow) => card(row).getByRole('button', { name: /done$/i });
  const refresh = async (nextRows: FixtureRow[] = rows) => {
    await page.evaluate(async (data) => {
      (window as any).__seasonCompletionFixtureRows = data;
      await window.eval('refreshSeasonSalesOfficeDataset()');
      window.eval('renderSalesOffice()');
    }, nextRows);
  };
  const assertClean = () => {
    expect(unexpectedMutations, 'Season completion must never fall through to generic deletion or another business write').toEqual([]);
    expect(pageErrors, 'the real completion lifecycle must not throw unhandled browser errors').toEqual([]);
  };
  return { requests, replies, card, done, seed, refresh, assertClean };
}

test('every eligible Season card uses protected Done and stays absent across stale refresh and reload', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  for (const row of fixtures) {
    await expect(app.done(row)).toBeVisible();
    await expect(app.done(row)).toHaveAttribute('onclick', /markSeasonSalesOfficeComplete/);
    await app.done(row).tap();
    await expect(app.card(row), 'confirmed Done disappears even if refresh returns its old snapshot').toHaveCount(0);
    const saved = app.requests.at(-1)!;
    expect(saved.body.masterId).toBe(row.MASTER_ID);
    expect(saved.body.expectedRevision).toBe(1);
    expect(saved.token).toBeTruthy();
    expect(saved.body.idempotencyKey).toBe(saved.token);
  }
  expect(app.requests).toHaveLength(fixtures.length);
  await app.refresh();
  await expect(page.locator('#sales-office-content .item-row')).toHaveCount(0);
  await page.reload({ waitUntil: 'load' });
  await app.seed();
  await expect(page.locator('#sales-office-content .item-row')).toHaveCount(0);
  expect(app.requests).toHaveLength(fixtures.length);
  app.assertClean();
});

test('only a newer reopened revision can return a confirmed item', async ({ page, baseURL }) => {
  const row = fixtures[0];
  const app = await harness(page, baseURL!, [row]);
  await app.done(row).tap();
  await expect(app.card(row)).toHaveCount(0);
  await app.refresh([{ ...row, STATE_REVISION: 2 }]);
  await expect(app.card(row)).toHaveCount(0);
  await app.refresh([{ ...row, STATE_REVISION: 3, WORKFLOW_STATUS: 'reopened_cav_blank' }]);
  await expect(app.done(row)).toBeVisible();
  await app.done(row).tap();
  await expect.poll(() => app.requests.length).toBe(2);
  await expect(app.card(row)).toHaveCount(0);
  expect(app.requests[1].body.expectedRevision).toBe(3);
  expect(app.requests[1].token).not.toBe(app.requests[0].token);
  app.assertClean();
});

test('rapid repeated activation sends one completion and keeps card until acknowledgment', async ({ page, baseURL }) => {
  const row = fixtures[0];
  const app = await harness(page, baseURL!, [row]);
  let release!: () => void;
  app.replies.push({ wait: new Promise<void>((resolve) => { release = resolve; }) });
  await app.done(row).tap();
  await expect.poll(() => app.requests.length).toBe(1);
  await expect(app.done(row)).toBeDisabled();
  await expect(app.card(row)).toHaveCount(1);
  // A stale/re-rendered activation must be deduplicated even without the disabled button.
  await page.evaluate((uid) => {
    window.eval(`void markSeasonSalesOfficeComplete(${JSON.stringify(uid)}, ${JSON.stringify('so_' + uid)}, null)`);
  }, row.UNIQUE_ID);
  expect(app.requests).toHaveLength(1);
  release();
  await expect(app.card(row)).toHaveCount(0);
  expect(app.requests).toHaveLength(1);
  app.assertClean();
});

test('ambiguous network failure leaves Done actionable and reuses the request token after app reopen', async ({ page, baseURL }) => {
  const row = fixtures[0];
  const app = await harness(page, baseURL!, [row]);
  app.replies.push({ abort: true });
  await app.done(row).tap();
  await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind', 'error');
  await expect(app.done(row)).toBeEnabled();
  await expect(app.card(row)).toHaveCount(1);
  expect(app.requests).toHaveLength(1);
  const firstToken = app.requests[0].token;
  await page.reload({ waitUntil: 'load' });
  await app.seed();
  await expect(app.done(row)).toBeEnabled();
  await app.done(row).tap();
  await expect(app.card(row)).toHaveCount(0);
  expect(app.requests).toHaveLength(2);
  expect(app.requests[1].token).toBe(firstToken);
  expect(app.requests[1].body.idempotencyKey).toBe(firstToken);
  app.assertClean();
});

test('a dataset read started before Done cannot resurrect its card when it arrives late', async ({ page, baseURL }) => {
  const row = fixtures[0];
  const app = await harness(page, baseURL!, [row]);
  await page.evaluate(() => window.eval(`
    window.__seasonCompletionDatasetGate = new Promise(resolve => {
      window.__releaseSeasonCompletionDataset = resolve;
    });
    window.__seasonCompletionOldRead = refreshSeasonSalesOfficeDataset();
  `));
  await app.done(row).tap();
  await expect(app.card(row), 'Done does not wait for the older pending read').toHaveCount(0);
  await page.evaluate(async () => {
    (window as any).__releaseSeasonCompletionDataset();
    await (window as any).__seasonCompletionOldRead;
    window.eval('renderSalesOffice()');
  });
  await expect(app.card(row)).toHaveCount(0);
  expect(app.requests).toHaveLength(1);
  app.assertClean();
});

for (const failure of [
  { status: 401, message: 'Session expired. Sign in again to complete Season Sales Notes.' },
  { status: 403, message: 'You are not assigned to complete Season Sales Notes.' },
  { status: 409, message: 'Season Sales Note changed. Refresh and review before completing.' },
]) {
  test(`HTTP ${failure.status} keeps row actionable and displays the real protected API error`, async ({ page, baseURL }) => {
    const row = fixtures[0];
    const app = await harness(page, baseURL!, [row]);
    app.replies.push({ status: failure.status, body: { ok: false, error: failure.message } });
    await app.done(row).tap();
    await expect(page.locator('#toast-notification')).toContainText(failure.message);
    await expect(app.done(row)).toBeEnabled();
    await expect(app.card(row)).toHaveCount(1);
    await app.refresh();
    await expect(app.done(row)).toBeVisible();
    expect(app.requests).toHaveLength(1);
    app.assertClean();
  });
}

test('all Season row origins use the same read-only permission gate', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await page.evaluate(() => window.eval(`
    avBlanksPhotoBypassAccessCache = { username: 'dylan_collyge', allowed: false, canManage: false, loadedAt: Date.now() };
    invalidateResolvedViewStateCaches();
    document.getElementById('sales-office-content').dataset.salesOfficeRenderKey = '';
    renderSalesOffice();
  `));
  for (const row of fixtures) {
    await expect(app.card(row)).toContainText('Read only');
    await expect(app.done(row)).toHaveCount(0);
  }
  expect(app.requests).toHaveLength(0);
  app.assertClean();
});

test('legacy row without revision uses its canonical revision and removes only Season-view duplicates', async ({ page, baseURL }) => {
  const canonical = { ...fixtures[0], STATE_REVISION: 3 };
  const legacy: FixtureRow = {
    ...canonical, UNIQUE_ID: 'season-done-legacy-duplicate', SO_SOURCE: 'flyer_folder',
  };
  delete legacy.STATE_REVISION;
  const bloom = { ...canonical, UNIQUE_ID: 'season-done-keep-bloom', SO_SOURCE: 'bloom_picker', ORDER_FOLDER: 'Browser-only order' };
  const move = { ...canonical, UNIQUE_ID: 'season-done-keep-move', SO_SOURCE: 'moves' };
  const app = await harness(page, baseURL!, [canonical, legacy, bloom, move]);
  app.replies.push({ body: { ok: true, status: 'done', masterId: canonical.MASTER_ID, revision: 4 } });
  await app.done(legacy).tap();
  await expect(app.card(legacy)).toHaveCount(0);
  await expect(app.card(canonical)).toHaveCount(0);
  expect(app.requests).toHaveLength(1);
  expect(app.requests[0].body.expectedRevision).toBe(3);
  expect(app.requests[0].body.masterId).toBe(canonical.MASTER_ID);
  const remainingIds = await page.evaluate(() => window.eval('salesOfficeInventory.map(row => row.UNIQUE_ID)'));
  expect(remainingIds).toContain(bloom.UNIQUE_ID);
  expect(remainingIds).toContain(move.UNIQUE_ID);
  app.assertClean();
});

test('local completion receipts stay scoped to the signed-in user', async ({ page, baseURL }) => {
  const row = fixtures[0];
  const app = await harness(page, baseURL!, [row]);
  await app.done(row).tap();
  await expect(app.card(row)).toHaveCount(0);
  await page.evaluate(() => window.eval(`
    installMutationBlockedAccessCanaryIdentity('kayla_knepp', 'Isolated second test identity', 'ADMIN');
    avBlanksPhotoBypassAccessCache = { username: 'kayla_knepp', allowed: true, canManage: false, loadedAt: Date.now() };
  `));
  // Deliberately serve an old snapshot: the first user's local receipt cannot
  // become an authorization or visibility rule for a different account.
  await app.refresh();
  await expect(app.done(row)).toBeVisible();
  expect(app.requests).toHaveLength(1);
  app.assertClean();
});
