import { expect, test, type Page, type Route } from '@playwright/test';

type PriorityRow = {
  sourceUid: string; itemcode: string; commonname: string; contsize: string;
  locationcode: string; lotcode: string; source: string; blockalpha: string;
  priority: string; assignedTo: string; warehouseAssignedTo: string[];
  lineageHash: string; scopeFingerprint: string; ptravailable: string;
  noteContext: { seasonSalesNote: string };
};
type PriorityRequest = {
  eventId: string; itemcode: string; sourceUid: string; selectedLineageHash: string;
  lifecycleStatus: 'queued' | 'processing' | 'awaiting_import' | 'delivery_failed' | 'fulfilled' | 'conflict' | 'superseded';
  deliveryStatus: 'queued' | 'processing' | 'delivered' | 'failed' | 'unknown'; canRetry: boolean;
  retryRequest?: Record<string, unknown>;
};

const rows: PriorityRow[] = [
  { sourceUid: 'season-priority-aa-1', itemcode: 'SP.001', commonname: 'Priority Maple', contsize: '#3',
    locationcode: 'AA.01.001', lotcode: '27.F1', source: 'PH', blockalpha: 'AA', priority: '3',
    assignedTo: 'dylan_collyge', warehouseAssignedTo: [], lineageHash: 'lineage-aa-1',
    scopeFingerprint: 'scope-aa-1', ptravailable: '12', noteContext: { seasonSalesNote: 'x' } },
  { sourceUid: 'season-priority-aa-2', itemcode: 'SP.002', commonname: 'Priority Oak', contsize: '#5',
    locationcode: 'AA.01.001', lotcode: '27.F1', source: 'PH', blockalpha: 'AA', priority: '4',
    assignedTo: 'jordan_smith', warehouseAssignedTo: [], lineageHash: 'lineage-aa-2',
    scopeFingerprint: 'scope-aa-2', ptravailable: '8', noteContext: { seasonSalesNote: 'x' } },
  { sourceUid: 'season-priority-bb-1', itemcode: 'SP.003', commonname: 'Unassigned Pine', contsize: '#7',
    locationcode: 'BB.02.004', lotcode: '27.F1', source: 'PH', blockalpha: 'BB', priority: '2',
    assignedTo: '', warehouseAssignedTo: [], lineageHash: 'lineage-bb-1',
    scopeFingerprint: 'scope-bb-1', ptravailable: '5', noteContext: { seasonSalesNote: 'x' } },
];

const options = [
  { value: 'all', label: 'All assigned', count: 3 },
  { value: '__unassigned__', label: 'Unassigned', count: 1 },
  { value: 'dylan_collyge', label: 'Dylan Collyge', count: 1 },
  { value: 'jordan_smith', label: 'Jordan Smith', count: 1 },
];

async function fixture(page: Page, baseURL: string, role = 'MANAGER') {
  const origin = new URL(baseURL).origin;
  const listBodies: Record<string, any>[] = [];
  const submitBodies: Record<string, any>[] = [];
  const unexpectedMutations: string[] = [];
  const pageErrors: string[] = [];
  let availableRows = structuredClone(rows);
  let requests: PriorityRequest[] = [];
  let listGate: Promise<void> | null = null;
  let releaseList = () => {};
  let listFailures = 0;
  let submitGate: Promise<void> | null = null;
  let releaseSubmit = () => {};

  const assignedFilter = (body: Record<string, any>) => String(
    body.assignedTo ?? body.assigned_to ?? body.assignee ?? body.filter?.assignedTo ?? 'all'
  );
  const visibleRows = (filter: string) => filter === '__unassigned__'
    ? availableRows.filter(row => !row.assignedTo)
    : filter && filter !== 'all' ? availableRows.filter(row => row.assignedTo === filter) : availableRows;
  const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({
    status,
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (/\/functions\/v1\//.test(url.pathname) && request.method() === 'POST') {
      const body = request.postDataJSON() || {};
      if (body.action === 'drive_reclass_inquiry') {
        if (body.operation === 'season_priority_list') {
          listBodies.push(structuredClone(body));
          if (listGate) await listGate;
          if (listFailures > 0) {
            listFailures--;
            return fulfill(route, { ok: false, error: 'Temporary Season Priority read failure.' });
          }
          return fulfill(route, { ok: true, inventoryRevision: 10, inventoryState: 'ready',
            rows: visibleRows(assignedFilter(body)), assignedToOptions: options });
        }
        if (body.operation === 'season_priority_state') {
          return fulfill(route, { ok: true, inventoryRevision: 10, inventoryState: 'ready', requests });
        }
        if (body.operation === 'season_priority_submit') {
          submitBodies.push(structuredClone(body));
          if (submitGate) await submitGate;
          const sourceRow = availableRows.find(row => row.sourceUid === String(body.sourceUid || ''));
          const created: PriorityRequest = {
            eventId: `season-priority-event-${submitBodies.length}`, itemcode: String(sourceRow?.itemcode || body.itemcode || ''),
            sourceUid: String(body.sourceUid || ''), selectedLineageHash: String(sourceRow?.lineageHash || ''),
            lifecycleStatus: 'queued', deliveryStatus: 'queued', canRetry: false,
          };
          requests = [created];
          return fulfill(route, { ok: true, ...created });
        }
        unexpectedMutations.push(`drive_reclass_inquiry:${body.operation || 'missing'}`);
        return route.abort('blockedbyclient');
      }
      if (body.action === 'navigation_preferences' && body.operation === 'get') {
        return fulfill(route, { ok: true, data: { username: 'dylan_collyge', views: [], shortcuts: null, footerRevision: 0, accessRevision: 0 } });
      }
      // Startup telemetry and read-only access probes stay isolated too.
      return fulfill(route, { ok: true, data: [], allowed: true, canManage: true });
    }
    if (url.pathname === '/rest/v1/rpc/report_app_health_event' && request.method() === 'POST') {
      return fulfill(route, { ok: true });
    }
    if (url.hostname === 'script.google.com' && request.method() === 'POST') {
      let scriptBody: Record<string, unknown> = {};
      try { scriptBody = JSON.parse(request.postData() || '{}'); } catch { /* mutation canary below */ }
      if (scriptBody.type === 'manual_status') return fulfill(route, { ok: true, active: false });
      unexpectedMutations.push(`apps-script:${String(scriptBody.type || 'unknown')}`);
      return route.abort('blockedbyclient');
    }
    if (url.origin !== origin) {
      if (!['GET', 'HEAD'].includes(request.method())) unexpectedMutations.push(`${request.method()}:${url.pathname}`);
      return fulfill(route, []);
    }
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=1&season_priority_canary=1', { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__gncAppRuntimeExecuted === true
    && typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
  await page.evaluate(({ role }) => window.eval(`(() => {
    if (!installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Season Priority Fixture', ${JSON.stringify(role)})) {
      throw new Error('SEASON_PRIORITY_CANARY_IDENTITY_UNAVAILABLE');
    }
    hasAppliedInitialHomeView = true;
    ensureViewDataForRender = () => false;
    document.getElementById('view-login').style.setProperty('display', 'none', 'important');
    document.getElementById('app-wrapper').classList.remove('hidden');
    showOnlyPrimaryView('managers');
    activeHomeTab = 'dashboard';
    renderManagers();
    setHomeTab('season-priority');
  })()`), { role });

  const panel = page.locator('#manager-season-priority');
  const card = (uid: string) => panel.locator(`article[data-season-priority-card="${uid}"]`);
  const openLocation = async () => {
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: 'Open block AA', exact: true }).click();
    await page.getByRole('button', { name: 'Open location AA.01.001', exact: true }).click();
  };
  return {
    panel, card, openLocation, listBodies, submitBodies, unexpectedMutations, pageErrors,
    setRows(next: PriorityRow[]) { availableRows = structuredClone(next); },
    setRequests(next: PriorityRequest[]) { requests = structuredClone(next); },
    failNextList() { listFailures++; },
    holdList() { listGate = new Promise<void>(resolve => { releaseList = resolve; }); },
    releaseList() { releaseList(); listGate = null; },
    holdSubmit() { submitGate = new Promise<void>(resolve => { releaseSubmit = resolve; }); },
    releaseSubmit() { releaseSubmit(); submitGate = null; },
    assertClean() { expect(unexpectedMutations).toEqual([]); expect(pageErrors).toEqual([]); },
  };
}

test('Managers navigation drills through the full AA location and assigned filtering is server-side', async ({ page, baseURL }, testInfo) => {
  const app = await fixture(page, baseURL!);
  const filter = page.locator('select#season-priority-assigned');
  await expect(filter).toBeVisible();
  await expect.poll(async () => (await filter.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
  const filterBounds = await filter.boundingBox();
  expect(filterBounds!.x).toBeGreaterThanOrEqual(0);
  expect(filterBounds!.x + filterBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await filter.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value)))
    .toEqual(expect.arrayContaining(['all', '__unassigned__', 'dylan_collyge']));
  await app.openLocation();
  await expect(app.card(rows[0].sourceUid)).toContainText('Priority Maple');
  await expect(app.card(rows[1].sourceUid)).toContainText('Priority Oak');
  const requiredVisualAssets = [
    '/assets/live-tailwind-v2026082010.min.css',
    '/assets/vendor/phosphor/regular/style.css',
    '/assets/vendor/phosphor/regular/Phosphor.woff2',
  ];
  const visualAssetResponses = await page.evaluate(async paths => Promise.all(paths.map(async path => {
    const response = await fetch(path, { cache: 'no-store' });
    return { path, status: response.status };
  })), requiredVisualAssets);
  expect(visualAssetResponses).toEqual(requiredVisualAssets.map(path => ({ path, status: 200 })));
  const firstCard = app.card(rows[0].sourceUid);
  const priorityButton = firstCard.getByRole('button', { name: 'Make Priority 1', exact: true });
  await expect.poll(() => firstCard.evaluate(node => parseFloat(getComputedStyle(node).borderTopLeftRadius)))
    .toBeGreaterThanOrEqual(12);
  await expect.poll(() => priorityButton.evaluate(node => parseFloat(getComputedStyle(node).minHeight)))
    .toBeGreaterThanOrEqual(44);
  await expect.poll(async () => (await priorityButton.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('season-priority-location.png'), fullPage: true });
  await filter.selectOption('dylan_collyge');
  await expect.poll(() => app.listBodies.at(-1) && String(app.listBodies.at(-1).assignedTo ?? app.listBodies.at(-1).assigned_to ?? app.listBodies.at(-1).assignee ?? app.listBodies.at(-1).filter?.assignedTo)).toBe('dylan_collyge');
  await app.openLocation();
  await expect(app.card(rows[0].sourceUid)).toBeVisible();
  await expect(app.card(rows[1].sourceUid)).toHaveCount(0);
  app.assertClean();
});

test('one Make Priority 1 submission is deduplicated and pending survives Managers navigation', async ({ page, baseURL }) => {
  const app = await fixture(page, baseURL!);
  await app.openLocation();
  const button = app.card(rows[0].sourceUid).getByRole('button', { name: 'Make Priority 1', exact: true });
  app.holdSubmit();
  const first = button.click();
  await expect.poll(() => app.submitBodies.length).toBe(1);
  await expect(button).toHaveCount(0);
  await page.evaluate((uid) => (document.querySelector(`article[data-season-priority-card="${uid}"] button`) as HTMLButtonElement)?.click(), rows[0].sourceUid);
  expect(app.submitBodies).toHaveLength(1);
  app.releaseSubmit();
  await first;
  await expect(app.card(rows[0].sourceUid)).toContainText(/pending|queued/i);
  const body = app.submitBodies[0];
  expect(body.sourceUid).toBe(rows[0].sourceUid);
  expect(String(body.expectedPriority)).toBe(rows[0].priority);
  expect(body.scopeFingerprint).toBe(rows[0].scopeFingerprint);
  expect(String(body.idempotencyToken || '')).not.toBe('');
  await page.evaluate(() => window.eval(`setHomeTab('dashboard'); setHomeTab('season-priority');`));
  // Re-entering the tab intentionally preserves the open location drilldown.
  await expect(app.card(rows[0].sourceUid)).toContainText(/pending|queued/i);
  expect(app.submitBodies).toHaveLength(1);
  app.assertClean();
});

test('failed delivery exposes Retry and an empty server result renders safely', async ({ page, baseURL }) => {
  const app = await fixture(page, baseURL!);
  app.setRequests([{ eventId: 'failed-1', itemcode: rows[0].itemcode, sourceUid: rows[0].sourceUid,
    selectedLineageHash: rows[0].lineageHash, lifecycleStatus: 'delivery_failed', deliveryStatus: 'failed', canRetry: true,
    retryRequest: { sourceUid: rows[0].sourceUid, expectedPriority: rows[0].priority,
      scopeFingerprint: rows[0].scopeFingerprint, idempotencyToken: 'retry-token-1' } }]);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await app.openLocation();
  await app.card(rows[0].sourceUid).getByRole('button', { name: /^Retry/ }).click();
  await expect.poll(() => app.submitBodies.length).toBe(1);
  expect(app.submitBodies[0].sourceUid).toBe(rows[0].sourceUid);
  await expect(app.card(rows[0].sourceUid)).toContainText(/pending|queued/i);
  app.failNextList();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  const readAlert = page.getByRole('alert');
  await expect(readAlert).toContainText('Temporary Season Priority read failure.');
  await readAlert.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(readAlert).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  app.failNextList();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('You are offline. Reconnect, then retry.');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByRole('alert')).toHaveCount(0);
  app.setRows([]);
  await page.locator('select#season-priority-assigned').selectOption('__unassigned__');
  await expect(app.panel).toContainText(/No .*priority|No items/i);
  app.assertClean();
});

test('a changed source UID keeps its stable-lineage request blocked until import fulfills it', async ({ page, baseURL }) => {
  const app = await fixture(page, baseURL!);
  const importedRow: PriorityRow = {
    ...rows[0],
    sourceUid: 'season-priority-aa-1-reimported',
    scopeFingerprint: 'scope-aa-1-reimported',
    priority: '2',
  };
  app.setRows([importedRow]);
  app.setRequests([{ eventId: 'awaiting-prior-import', itemcode: rows[0].itemcode,
    sourceUid: rows[0].sourceUid, selectedLineageHash: rows[0].lineageHash,
    lifecycleStatus: 'awaiting_import', deliveryStatus: 'delivered', canRetry: false }]);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await app.openLocation();
  await expect(app.card(rows[0].sourceUid)).toHaveCount(0);
  await expect(app.card(importedRow.sourceUid)).toContainText('Priority Maple');
  await expect(app.card(importedRow.sourceUid)
    .getByRole('button', { name: 'Requested — awaiting import', exact: true })).toBeDisabled();
  app.setRows([]);
  app.setRequests([{ eventId: 'awaiting-prior-import', itemcode: rows[0].itemcode,
    sourceUid: rows[0].sourceUid, selectedLineageHash: rows[0].lineageHash,
    lifecycleStatus: 'fulfilled', deliveryStatus: 'delivered', canRetry: false }]);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(app.panel).toContainText('Verified by inventory import');
  await expect(app.card(importedRow.sourceUid)).toHaveCount(0);
  expect(app.submitBodies).toHaveLength(0);
  app.assertClean();
});

test('late list responses cannot repaint after navigation or an account change', async ({ page, baseURL }) => {
  const app = await fixture(page, baseURL!);
  app.holdList();
  await page.evaluate(() => window.eval(`void loadManagerSeasonPriority(true)`));
  await expect.poll(() => app.listBodies.length).toBeGreaterThan(1);
  await page.evaluate(() => window.eval(`setHomeTab('dashboard')`));
  app.releaseList();
  await expect(app.panel).toHaveCount(0);
  await page.evaluate(() => window.eval(`
    installMutationBlockedAccessCanaryIdentity('second_manager', 'Second Manager', 'MANAGER');
    setHomeTab('season-priority');
  `));
  await expect(app.panel).toBeVisible();
  expect(await page.evaluate(() => window.eval('currentUser'))).toBe('second_manager');
  app.assertClean();
});

test('Season Priority is restricted to managers and admins', async ({ page, baseURL }) => {
  const denied = await fixture(page, baseURL!, 'REP');
  await expect(denied.panel).toHaveCount(0);
  expect(await page.evaluate(() => window.eval('activeHomeTab'))).not.toBe('season-priority');
  expect(denied.listBodies).toHaveLength(0);
  await page.evaluate(() => window.eval(`
    installMutationBlockedAccessCanaryIdentity('admin_fixture', 'Admin Fixture', 'ADMIN');
    setHomeTab('season-priority');
  `));
  await expect(page.locator('#manager-season-priority')).toBeVisible();
  denied.assertClean();
});
