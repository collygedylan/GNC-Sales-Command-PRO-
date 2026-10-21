import { releaseSnapshotReadFixture } from './helpers/release-smoke-route-policy.mjs';
// @test-group: @v2311-frontend-smoke
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { hlMaster, installHlOrderFixture, hlUserId } from './fixtures/hl-order-state.mjs';
import { createV2311CanonicalAccessFixture } from './fixtures/v2311-canonical-access.mjs';
import { syntheticMappingSnapshot } from '../supabase/ci/customer_rep_mapping_http.mjs';

const access = (overrides: Record<string, boolean | null> = {}) => ({
  can_access_drive_mode: false,
  can_access_av: false,
  can_access_que: true,
  can_access_manager_tab: true,
  can_manage_user_access: true,
  can_access_eval_reports_2: false,
  can_submit_reclass: true,
  can_complete_suspend_tag: true,
  can_approve_deny_suspend: false,
  ...overrides,
});

test('v2.3.11 canonical Manager access editor updates a role baseline and a user override @v2311-frontend-smoke', { tag: '@v2311-frontend-smoke' }, async ({ page, baseURL }, info) => {
  if (!baseURL) throw new Error('The isolated release artifact baseURL is required.');
  const baselines = [
    { role: 'admin', permissions: access() },
    { role: 'evaluator', permissions: access({ can_manage_user_access: false, can_access_manager_tab: false, can_access_que: false }) },
    { role: 'sales_rep', permissions: access({ can_manage_user_access: false, can_access_manager_tab: false, can_access_que: false, can_access_av: true }) },
  ];
  const users = [
    { id: hlUserId, username: 'dylan_collyge', display_name: 'Dylan College', role: 'admin', active: true,
      baseline: { role: 'admin', permissions: access() }, permission_overrides: access(Object.fromEntries(Object.keys(access()).map(key => [key, null]))) },
    { id: 'bcd56899-e4aa-470d-9016-2d525aaf43a3', username: 'annette_hancock', display_name: 'Annette Hancock', role: 'sales_rep', active: true,
      salesrep_id: 'S05', salesrep_match_names: ['Annette Hancock', 'Hancock, Annette'],
      baseline: { role: 'sales_rep', permissions: baselines[2].permissions },
      permission_overrides: Object.fromEntries(Object.keys(access()).map(key => [key, null])) },
    { id: 'b94e728e-12f3-4b34-8a32-80b09d41df2a', username: 'evaluator_one', display_name: 'Evaluator One', role: 'evaluator', active: true,
      baseline: { role: 'evaluator', permissions: baselines[1].permissions },
      permission_overrides: Object.fromEntries(Object.keys(access()).map(key => [key, null])) },
    { id: 'a9577e7a-8c20-4a6d-9af5-6d3703db1891', username: 'evaluator_two', display_name: 'Evaluator Two', role: 'evaluator', active: true,
      baseline: { role: 'evaluator', permissions: baselines[1].permissions },
      permission_overrides: Object.fromEntries(Object.keys(access()).map(key => [key, null])) },
    { id: '', username: 'legacy_only_user', display_name: 'Legacy Only', role: 'sales_rep', active: false,
      baseline: { role: 'sales_rep', permissions: baselines[2].permissions }, permission_overrides: {} },
  ];
  const accessFixture = createV2311CanonicalAccessFixture({ username: 'dylan_collyge', role: 'admin', revision: 23, roleBaselines: baselines, users });
  const fixture = await installHlOrderFixture(page, baseURL, {
    username: 'dylan_collyge', role: 'ADMIN',
    canonicalAccessFixture: accessFixture,
  });
  await page.evaluate(() => {
    window.eval("switchView('managers'); setHomeTab('access-control')");
  });
  const editor = page.locator('#canonical-user-access-editor');
  await expect(editor.locator('[data-access-status]')).toHaveText('4 active profiles loaded from the server.');
  await expect(editor.locator('[data-user-count]')).toHaveText('4');
  await expect(editor.locator('[data-user-select] option')).toContainText(['Annette Hancock', 'Legacy Only']);

  await editor.locator('[data-role-select]').selectOption('evaluator');
  await editor.locator('[data-role-permission="can_access_eval_reports_2"]').check();
  await editor.locator('[data-role-save]').click();
  try {
    await expect.poll(() => accessFixture.state.baselines.get('evaluator')?.can_access_eval_reports_2).toBe(true);
  } catch (error) {
    await info.attach('canonical-manager-save-state', { contentType: 'application/json', body: JSON.stringify({
      calls: accessFixture.state.calls, blocked: accessFixture.state.blocked, revision: accessFixture.state.revision,
      baseline: accessFixture.state.baselines.get('evaluator'), status: await editor.locator('[data-access-status]').textContent(),
      selectedRole: await editor.locator('[data-role-select]').inputValue(),
      checked: await editor.locator('[data-role-permission="can_access_eval_reports_2"]').isChecked(),
    }) });
    throw error;
  }
  await expect.poll(() => accessFixture.state.users.find(user => user.username === 'evaluator_one')?.baseline.permissions.can_access_eval_reports_2).toBe(true);
  await expect.poll(() => accessFixture.state.users.find(user => user.username === 'evaluator_two')?.baseline.permissions.can_access_eval_reports_2).toBe(true);
  expect(accessFixture.state.users.find(user => user.username === 'annette_hancock')?.baseline.permissions.can_access_eval_reports_2).toBe(false);

  await editor.locator('[data-user-select]').selectOption('annette_hancock');
  await expect(editor.locator('[data-user-permission="can_access_av"]')).toHaveValue('inherit');
  await editor.locator('[data-user-permission="can_access_av"]').selectOption('false');
  await editor.locator('[data-user-save]').click();
  await expect.poll(() => accessFixture.state.users.find(user => user.username === 'annette_hancock')?.permission_overrides.can_access_av).toBe(false);
  await expect.poll(() => accessFixture.state.revision).toBe(25);
  expect(accessFixture.state.calls.map(call => call.operation)).toEqual(['resolve', 'directory', 'save_role_baseline', 'save_user_overrides']);
  expect(accessFixture.state.blocked).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('v2.3.11 Request picker shows and searches all 103 mapped customers for Annette @v2311-frontend-smoke', { tag: '@v2311-frontend-smoke' }, async ({ page, baseURL }, info) => {
  if (!baseURL) throw new Error('The isolated release artifact baseURL is required.');
  const mappingTemplate = syntheticMappingSnapshot()[0];
  const mapRows = Array.from({ length: 103 }, (_, customerIndex) => Array.from({
    length: customerIndex === 0 ? 100 : 1,
  }, (_, locationIndex) => {
    const customerIdentityId = String(customerIndex + 1).padStart(7, '0');
    const customerName = customerIndex === 102 ? "V2311 O'Brian & Sons 103" : `V2311 Customer ${String(customerIndex + 1).padStart(3, '0')}`;
    const consigneeId = String(1001 + customerIndex * 100 + locationIndex).padStart(8, '0');
    const consigneeName = `V2311 Location ${String(customerIndex + 1).padStart(3, '0')}${locationIndex ? `-${locationIndex + 1}` : ''}`;
    return {
      ...mappingTemplate,
      unique_id: `v2311-customer-${customerIndex + 1}-${locationIndex + 1}`,
      source_row_number: customerIndex * 100 + locationIndex + 1,
      customeridentityid: customerIdentityId,
      customername: customerName,
      consigneeid: consigneeId,
      consigneename: consigneeName,
      salesrepid: 'S05',
      salesrepname: 'Annette Hancock',
      customerstatus: 'A',
      consigneestatus: 'A',
      raw_data: {
        ...mappingTemplate.raw_data,
        CUSTOMERIDENTITYID: customerIdentityId,
        CUSTOMERNAME: customerName,
        CONSIGNEEID: consigneeId,
        CONSIGNEENAME: consigneeName,
        SALESREPID: 'S05',
        SALESREPNAME: 'Annette Hancock',
        CUSTOMERSTATUS: 'A',
        CONSIGNEESTATUS: 'A',
      },
    };
  })).flat();
  const customerMapApi: { driftNextRead: boolean; failNextRead: boolean; restReads: number; optionsReads: number; restRows: number[] } = {
    driftNextRead: false, failNextRead: false, restReads: 0, optionsReads: 0, restRows: [],
  };
  const requestLoadErrors: string[] = [];
  page.on('pageerror', error => requestLoadErrors.push(String(error.message || error).slice(0, 240)));
  page.on('console', message => {
    if (message.type() === 'error' && requestLoadErrors.length < 8) requestLoadErrors.push(String(message.text() || '').slice(0, 240));
  });
  const origin = new URL(baseURL).origin;
  const fixture = await installHlOrderFixture(page, baseURL, { username: 'dylan_collyge', role: 'ADMIN', beforeNavigate: async () => {
    // Install these after the fixture catch-all, but before initial app sync;
    // otherwise startup can cache an empty map under the same synthetic revision.
    await page.route('**/rest/v1/ph_customer_consignee_sales_reps*', route => {
      customerMapApi.restReads += 1;
      customerMapApi.restRows.push(mapRows.length);
      const requested = new URL(route.request().url()).searchParams.get('select')?.split(',') || [];
      const projectedRows = mapRows.map(row => Object.fromEntries(requested.map(column => [column, row[column as keyof typeof row]])));
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(projectedRows),
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'content-range', 'content-range': `0-${projectedRows.length - 1}/${projectedRows.length}` },
      });
    });
    await page.route('**/functions/v1/app-api*', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, body: '', headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization, apikey, content-type', 'access-control-allow-credentials': 'true' } });
    const body = request.postDataJSON() || {};
    if (request.method() !== 'POST' || body.action !== 'customer-rep-map' || !['options','preload'].includes(body.operation)) return route.fallback();
    customerMapApi.optionsReads += 1;
    if (customerMapApi.failNextRead) {
      customerMapApi.failNextRead = false;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'fixture mapping temporarily unavailable' }), headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } });
    }
    if (body.operation === 'preload') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(releaseSnapshotReadFixture(body,mapRows)),headers:{'access-control-allow-origin':origin,'access-control-allow-credentials':'true'}});
    const pageIndex = Math.max(0, Number(body.page) || 0), pageSize = Math.min(200, Math.max(1, Number(body.pageSize) || 200));
    let revision = 'v2311-customer-map-r1';
    if (customerMapApi.driftNextRead) {
      revision = pageIndex === 0 ? 'v2311-customer-map-r2' : 'v2311-customer-map-r3';
      if (pageIndex > 0) customerMapApi.driftNextRead = false;
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, revision, total: mapRows.length,
      rows: mapRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    }), headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization, apikey, content-type', 'access-control-allow-credentials': 'true' } });
    });
  } });
  await page.evaluate(() => window.eval(`(() => {
    const diagnostics = window.__v2311RequestPickerDiagnostics = { stages: [], commits: [], processErrors: [], dedupeReads: [], readFailures: [] };
    const originalBackoff = runSupabaseReadWithBackoff;
    runSupabaseReadWithBackoff = async function(cooldownKey, taskFn, ...args) {
      let readKey = '';
      try { readKey = String(JSON.parse(cooldownKey || '[]')?.[1] || '').slice(0, 180); } catch (_) {}
      const prior = supabaseReadFailureCooldowns.get(cooldownKey);
      const entry = { readKey, priorFailures: Number(prior?.failures || 0), priorUntil: Number(prior?.until || 0) };
      try { return await originalBackoff.call(this, cooldownKey, taskFn, ...args); }
      catch (error) {
        entry.code = String(error?.code || error?.payload?.code || '').slice(0, 80);
        entry.message = String(error?.message || error || '').slice(0, 240);
        entry.status = Number(error?.status || error?.payload?.status || 0);
        diagnostics.readFailures.push(entry);
        throw error;
      }
    };
    const originalDedupe = runDedupeSupabaseRead;
    runDedupeSupabaseRead = function(readKey, taskFn, options = {}) {
      const entry = { readKey: String(readKey || '').slice(0, 180), explicitRetry: options?.explicitRetry === true };
      diagnostics.dedupeReads.push(entry);
      try {
        return originalDedupe.call(this, readKey, taskFn, options).catch(error => {
          entry.outcome = 'rejected';
          entry.code = String(error?.code || error?.payload?.code || '').slice(0, 80);
          entry.message = String(error?.message || error || '').slice(0, 240);
          throw error;
        });
      } catch (error) {
        entry.outcome = 'threw';
        entry.code = String(error?.code || error?.payload?.code || '').slice(0, 80);
        entry.message = String(error?.message || error || '').slice(0, 240);
        throw error;
      }
    };
    const originalAdapterFactory = createProductionCoreLiveAdapter;
    createProductionCoreLiveAdapter = function(key, ...args) {
      const adapter = originalAdapterFactory.call(this, key, ...args);
      if (!['requests', 'master', 'customerRepMap'].includes(String(key || ''))) return adapter;
      const originalStage = adapter.stage;
      adapter.stage = async function(options = {}) {
        const entry = { key: String(key), projection: String(adapter.projection || ''), sourceKeys: [...(adapter.sourceKeys || [])], outcome: 'pending' };
        diagnostics.stages.push(entry);
        try {
          const snapshot = await originalStage.call(this, options);
          entry.outcome = 'resolved';
          entry.rows = Number(snapshot?.rowCount || snapshot?.rawRows?.length || 0);
          entry.fieldCoverage = String(snapshot?.fieldCoverage || '');
          return snapshot;
        } catch (error) {
          entry.outcome = 'rejected';
          entry.error = String(error?.message || error || '').slice(0, 240);
          entry.code = String(error?.code || error?.payload?.code || '').slice(0, 80);
          entry.status = Number(error?.status || error?.payload?.status || 0);
          throw error;
        }
      };
      return adapter;
    };
    const originalProcess = processAndLoadData;
    processAndLoadData = function(payload, ...args) {
      const entry = { keys: Object.keys(payload || {}), mapRows: Array.isArray(payload?.customerRepMapData) ? payload.customerRepMapData.length : null };
      diagnostics.commits.push(entry);
      try { return originalProcess.call(this, payload, ...args); }
      catch (error) { diagnostics.processErrors.push(String(error?.message || error || '').slice(0, 240)); throw error; }
    };
  })()`));
  // Enter the real Request picker path. It must resolve the rep ID, load the
  // complete server options, and show all mapped customers without a test-only
  // forced coordinator read or a prerequisite wait on unrelated Request data.
  await page.evaluate(() => window.eval("switchView('request')"));
  await expect(page.locator('#view-request')).toBeVisible();
  await page.evaluate(() => window.eval("selectRepForRequest('Annette Hancock', 'S05')"));
  const picker = page.locator('#existing-folder-container');
  try {
    await expect(picker.locator('[data-render-key^="request-customer:"]')).toHaveCount(103, { timeout: 30000 });
  } catch (error) {
    const loadFailure = await page.evaluate(() => window.eval(`(() => {
      const state = getDatasetState('customerRepMap');
      let coordinator = null;
      try {
        const status = getProductionLiveSyncCoordinator()?.getStatus?.() || {};
        const stats = getProductionLiveSyncCoordinator()?.getStatistics?.() || {};
        coordinator = {
          state: String(status.state || ''), pending: status.pending === true,
          message: String(status.message || '').slice(0, 240), code: String(status.code || '').slice(0, 80),
          status: Number(status.status || 0), authorizationDenied: status.authorizationDenied === true,
          adapterReads: Number(stats.adapterReads || 0), revisionReads: Number(stats.revisionReads || 0),
          commits: Number(stats.commits || 0), discardedLoads: Number(stats.discardedLoads || 0),
        };
      } catch (_) {}
      return {
        dataset: { initialLoaded: state.initialLoaded, fullLoaded: state.fullLoaded,
          fieldCoverage: state.fieldCoverage, rowCompleteness: state.rowCompleteness,
          lastError: String(state.lastError?.message || state.lastError || '').slice(0, 240),
          loadSignature: String(state.loadSignature || '').slice(0, 180) },
        mapRows: customerRepMapRows.length, resolvedRep: getRequestSelectedSalesrepId('Annette Hancock'),
        activeView: getCurrentVisibleViewId(), optionLoading: requestModalCustomerOptionsLoading,
        optionError: String(requestModalCustomerOptionsError || '').slice(0, 240),
        renderedCustomers: document.querySelectorAll('#existing-folder-container [data-render-key^="request-customer:"]').length,
        coordinator,
        cooldowns: [...supabaseReadFailureCooldowns.entries()].map(([key, value]) => {
          let readKey = '';
          try { readKey = String(JSON.parse(key)?.[1] || '').slice(0, 180); } catch (_) {}
          return { readKey, failures: Number(value?.failures || 0), until: Number(value?.until || 0) };
        }).filter(entry => /customer_consignee_sales_reps|customerRepMap/i.test(entry.readKey)),
        liveSyncDiagnostics: window.__v2311RequestPickerDiagnostics || null,
      };
    })()`));
    await info.attach('request-picker-options-not-ready', {
      contentType: 'application/json', body: JSON.stringify({ ...loadFailure, routeCounters: customerMapApi, requestLoadErrors }),
    });
    await writeFile(info.outputPath('request-picker-options-not-ready.json'), JSON.stringify({ ...loadFailure, routeCounters: customerMapApi, requestLoadErrors }, null, 2), 'utf8');
    throw error;
  }
  await expect(picker).toContainText("V2311 O'Brian & Sons 103");
  customerMapApi.failNextRead = true;
  const errorRefreshSucceeded = await page.evaluate(() => window.eval('ensureRequestModalCustomerOptionsReady(true)'));
  expect(errorRefreshSucceeded).toBe(false);
  await expect(picker.locator('[data-render-key^="request-customer:"]')).toHaveCount(103);
  await expect(picker).toContainText("V2311 O'Brian & Sons 103");
  customerMapApi.driftNextRead = true;
  const refreshSucceeded = await page.evaluate(() => window.eval('ensureRequestModalCustomerOptionsReady(true)'));
  expect(refreshSucceeded).toBe(false);
  await expect(picker.locator('[data-render-key^="request-customer:"]')).toHaveCount(103);
  await expect(picker).toContainText('Showing saved customer choices while the current mapping revision is verified.');
  await picker.locator('#existing-request-customer-search-input').fill("O'Brian");
  const customer = picker.locator('[data-render-key^="request-customer:"]');
  await expect(customer).toHaveCount(1);
  await expect(customer.first()).toContainText("V2311 O'Brian & Sons 103");
  await customer.first().click();
  await expect(picker.locator('[data-render-key^="request-consignee:"]')).toHaveCount(1);
  await expect(picker).toContainText('V2311 Location 103');
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('v2.3.11 confirmed H/S receipt updates canonical fields and paints status across inventory surfaces @v2311-frontend-smoke', { tag: '@v2311-frontend-smoke' }, async ({ page, baseURL }, info) => {
  if (!baseURL) throw new Error('The isolated release artifact baseURL is required.');
  const master = [hlMaster('v2311-hs-confirmed-row', {
    itemcode: 'V2311.HS.001', commonname: 'V2311 H/S Confirmed Plant', contsize: '#3',
    locationcode: 'G.21.000', lotcode: '27.F1', season: 'F1', saleyear: '27',
    ptronhand: '25', ptrreviewed: '2', ptravailable: '25', s_lts: '25', priority: '2', holdstopcode: '', holdstopreason: '',
    photo_link: '', photo_name: '', match: '',
  })];
  const fixture = await installHlOrderFixture(page, baseURL, { username: 'dylan_collyge', role: 'ADMIN', master });
  await page.evaluate(() => window.eval("switchView('drive')"));
  await expect(page.locator('#view-drive')).toBeVisible();
  const masterLoaded = await page.evaluate(() => window.eval("ensureDatasetLoaded('master', 'full', { force: true })"));
  expect(masterLoaded).toBe(true);
  await page.waitForFunction(() => window.eval("fullInventory.some(row => String(row.UNIQUE_ID || row.unique_id) === 'v2311-hs-confirmed-row')"));
  const before = await page.evaluate(() => window.eval(`(() => {
    const state = getDatasetState('master');
    const context = getProductionLiveSyncContext();
    const row = fullInventory.find(candidate => String(candidate.UNIQUE_ID || candidate.unique_id) === 'v2311-hs-confirmed-row');
    if (!row) throw new Error('Fixture master row was not loaded');
    state.initialLoaded = true;
    state.rowCompleteness = 'complete';
    state.liveVerifiedRevision = '500';
    state.liveVerifiedScope = context.scope;
    state.liveVerifiedPermission = context.dataPermissionVersion;
    return { scope: state.liveVerifiedScope, permission: state.liveVerifiedPermission,
      onHand: getCardLocationOnHandValue(row), reviewed: String(row.PTRREVIEWED ?? row.ptrreviewed ?? '') };
  })()`));
  expect(before.onHand).toBe('25');

  const result = await page.evaluate(() => window.eval(`(async () => {
    const uid = 'v2311-hs-confirmed-row';
    let row = fullInventory.find(candidate => String(candidate.UNIQUE_ID || candidate.unique_id) === uid);
    row.LAST_UPDATED = row.last_updated = '';
    const permission = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
    managerReportScopedRows.set(JSON.stringify([getSupabaseReadIdentityScope(), permission, uid]),
      { ...row, PRIORITY: '9', HOLDSTOPCODE: 'overlay', HOLDSTOPREASON: 'stale report row' });
    const evidence = Object.fromEntries(window.GncDatabase.driveEvidenceColumns.map(key => [key, null]));
    Object.assign(evidence, { unique_id: uid, itemcode: row.ITEMCODE, locationcode: row.LOCATIONCODE, lotcode: row.LOTCODE,
      last_updated: '2026-10-19T12:01:00Z', ptravailable: '25',
      photo_link: null, photo_name: null, match: null, spec: null, caliper: null, av_note: null });
    const revision = String(BigInt(getDatasetState('master').liveVerifiedRevision) + 1n);
    const receipt = { inventoryRevision: revision, workflowPolicyVersion: 'reclass-action-workflow-v7-editable-fields-20261009',
      inventoryFields: [], liveEdits: [{ unique_id: uid, priority: '1', holdstopcode: 'H', holdstopreason: 'quality review',
        av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: evidence.last_updated,
        last_updated: evidence.last_updated, evidence }] };
    const originalPersistCurrentCache = persistCurrentCache;
    let persistCalls = 0;
    persistCurrentCache = (...args) => { persistCalls += 1; return originalPersistCurrentCache(...args); };
    const applied = applyConfirmedArgosReclassLiveEdits(receipt, getArgosReclassLiveEditIdentityKey());
    persistCurrentCache = originalPersistCurrentCache;
    // The shared publication replaces rows; read the newly published canonical row.
    row = getCanonicalMasterInventoryRowByUniqueId(uid);
    return { applied, row: { priority: String(row.PRIORITY || ''), hold: String(row.HOLDSTOPCODE || ''),
        reason: String(row.HOLDSTOPREASON || ''), available: String(row.PTRAVAILABLE ?? ''), reviewed: String(row.PTRREVIEWED ?? ''),
        photo: String(row.PHOTO_LINK || ''), photoName: String(row.PHOTO_NAME || ''), avNote: String(row.AV_NOTE || ''),
        spec: String(row.SPEC || ''), caliper: String(row.CALIPER || ''), matchKnown: row.PHOTO_MATCH_PTR_AVAILABLE_KNOWN,
        photoMatchQty: getPhotoQualifiedLocMatchQtyValue(row, 'drive', { now: Date.parse('2026-10-19T13:00:00Z') }),
        locationOnHand: getCardLocationOnHandValue(row) },
      state: { revision: String(getDatasetState('master').liveVerifiedRevision || ''), scope: String(getDatasetState('master').liveVerifiedScope || ''),
        permission: String(getDatasetState('master').liveVerifiedPermission || '') },
      overlay: managerReportScopedRows.get(JSON.stringify([getSupabaseReadIdentityScope(), permission, uid])), persistCalls,
      painted: await (async () => {
        const surfaces = {};
        for (const sourceView of ['drive', 'av', 'request']) {
          // Measure a visible card update. Appending below the entire Drive
          // page and scrolling there also measured unrelated scroll/layout work.
          const host = document.createElement('div');
          host.className = 'w-full';
          const view = document.getElementById('view-drive');
          if (!view) throw new Error('H/S visible Drive view is missing');
          view.prepend(host);
          host.scrollIntoView({ block: 'start', behavior: 'instant' });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const startedAt = performance.now();
          host.innerHTML = generateCard(row, sourceView);
          const renderMs = performance.now() - startedAt;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const card = host.firstElementChild;
          surfaces[sourceView] = { renderMs, paintMs: performance.now() - startedAt, text: card?.textContent || '', holdClass: card?.classList.contains('app-card-hold') || false,
            stopClass: card?.classList.contains('app-card-stop') || false,
            code: card?.querySelector('[data-inventory-card-field="holdstopcode"]')?.textContent || '',
            reason: card?.querySelector('[data-inventory-card-field="holdstopreason"]')?.textContent || '',
            metrics: Array.from(card?.querySelectorAll('[data-inventory-card-metric]') || []).map(metric => ({
              label: metric.querySelector('.app-card-qty-label')?.textContent?.trim() || '',
              value: metric.querySelector('.app-card-qty-value')?.textContent?.trim() || '',
            })) };
          host.remove();
        }
        const stopHost = document.createElement('div');
        stopHost.innerHTML = generateCard({ ...row, DOM_ID: String(row.DOM_ID) + '-stop-check', HOLDSTOPCODE: 'S', holdstopcode: 'S', HOLDSTOPREASON: 'shipment blocked', holdstopreason: 'shipment blocked' }, 'drive');
        const stopCard = stopHost.firstElementChild;
        surfaces.stop = { class: stopCard?.classList.contains('app-card-stop') || false, text: stopCard?.textContent || '' };
        selectedItems.add(row.DOM_ID);
        const bloomStartedAt = performance.now();
        renderBloomPickerOrderList();
        const bloomModal = document.getElementById('bloom-picker-modal');
        bloomModal?.classList.remove('hidden');
        const bloom = document.getElementById('bloom-picker-list-container');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        surfaces.bloom = { paintMs: performance.now() - bloomStartedAt, text: bloom?.textContent || '', visible: !!bloom && getComputedStyle(bloom).display !== 'none' };
        return surfaces;
      })() };
  })()`));
  await info.attach('v2311-hold-stop-paint.json', {contentType:'application/json',body:JSON.stringify(result.painted)});
  expect(result.applied).toEqual({ applied: 1, stale: false });
  expect(result.row).toMatchObject({ priority: '1', hold: 'H', reason: 'quality review', available: '25', reviewed: before.reviewed,
    photo: '', photoName: '', avNote: '', spec: '', caliper: '', matchKnown: true, photoMatchQty: null, locationOnHand: '25' });
  expect(result.state).toEqual({ revision: '500', scope: before.scope, permission: before.permission });
  // The trusted V7 receipt synchronizes the canonical row into the scoped
  // report overlay so later card/detail lookups cannot keep showing stale H/S.
  expect(result.overlay).toMatchObject({ PRIORITY: '1', HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'quality review' });
  expect(result.persistCalls).toBeGreaterThan(0);
  for (const surface of ['drive', 'av', 'request']) {
    expect(result.painted[surface].paintMs).toBeLessThanOrEqual(2000);
    expect(result.painted[surface].holdClass).toBe(true);
    if (surface === 'request') {
      expect(result.painted[surface].text).toContain('HOLD: H');
      expect(result.painted[surface].text).toContain('quality review');
    } else {
      expect(result.painted[surface].code).toContain('H');
      expect(result.painted[surface].reason).toContain('quality review');
    }
  }
  expect(result.painted.stop.class).toBe(true);
  expect(result.painted.stop.text).toContain('shipment blocked');
  for (const surface of ['drive', 'av']) {
    const quantityValues = result.painted[surface].metrics.map(metric => metric.value);
    expect(quantityValues).toEqual(expect.arrayContaining(['25', '2', '25']));
  }
  expect(result.painted.bloom.paintMs).toBeLessThanOrEqual(2000);
  expect(result.painted.bloom.visible).toBe(true);
  expect(result.painted.bloom.text).toContain('HOLD H');
  expect(result.painted.bloom.text).toContain('quality review');
  expect(result.painted.bloom.text).not.toContain('plant.webp');
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('v2.3.11 Drive Bloom tray preserves all six inventory metrics before and after opening Actions @v2311-frontend-smoke', { tag: '@v2311-frontend-smoke' }, async ({ page, baseURL }, info) => {
  if (!baseURL) throw new Error('The isolated release artifact baseURL is required.');
  const itemcode = 'V2311.BLOOM.001';
  const photoUrl = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2311-bloom/blue-point.svg';
  const master = [
    hlMaster('v2311-bloom-metrics-main', {
      itemcode, commonname: 'V2311 Bloom Metric Plant', contsize: '#3',
      locationcode: 'G.11.000', lotcode: '27.F1', season: 'F1', saleyear: '27',
      ptronhand: '88', ptrreviewed: '10', ptravailable: '78', s_lts: '85', priority: '1', desigloc: 'NORTH',
      loc_match_qty: '', match: '', warehouseid: '10', warehousei: '10',
      photo_link: photoUrl, photo_name: 'Blue Point Juniper', av_rule_photo_updated_at: new Date().toISOString(),
    }),
    hlMaster('v2311-bloom-metrics-second-location', {
      itemcode, commonname: 'V2311 Bloom Metric Plant', contsize: '#3',
      locationcode: 'G.11.001', lotcode: '27.F1', season: 'F1', saleyear: '27',
      ptronhand: '1', ptrreviewed: '0', ptravailable: '1', s_lts: '85',
      loc_match_qty: '', match: '', warehouseid: '10', warehousei: '10',
      photo_link: photoUrl, photo_name: 'Blue Point Juniper', av_rule_photo_updated_at: new Date().toISOString(),
    }),
  ];
  const fixture = await installHlOrderFixture(page, baseURL, { username: 'dylan_collyge', role: 'ADMIN', master });
  await page.route('**/storage/v1/**/public/request_photos/v2311-bloom/blue-point.svg*', route => route.fulfill({
    status: 200, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#2d8a54"/></svg>',
  }));
  await page.evaluate(() => window.eval("switchView('drive')"));
  await expect(page.locator('#view-drive')).toBeVisible();
  // Location totals require a complete, authorized master snapshot.
  expect(await page.evaluate(() => window.eval("ensureDatasetLoaded('master', 'full', { force: true })"))).toBe(true);
  await page.evaluate(() => window.eval("selectDriveName('V2311 Bloom Metric Plant'); selectDriveSize('#3'); selectDriveSeason('F1')"));
  const card = page.locator('#drive-content [role="button"][aria-label="Open drive row"]').filter({ hasText: 'G.11.000' }).first();
  await expect(card).toBeVisible();
  const expectedLabels = ['On Hand', 'Review', 'Available', 'Open Stock', 'Loc Photo Match', 'Loc On Hand'];
  const readMetrics = async (locator: import('@playwright/test').Locator) => locator.locator('[data-inventory-card-metric]').evaluateAll(nodes => nodes.map(node => ({
    label: node.querySelector('.app-card-qty-label')?.textContent?.trim() || '',
    value: node.querySelector('.app-card-qty-value')?.textContent?.trim() || '',
  })));
  const driveMetrics = await readMetrics(card);
  await info.attach('bloom-master-receipt', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => window.eval(`(() => ({ state: getDatasetState('master'), context: getProductionLiveSyncContext(), rows: fullInventory.length, values: fullInventory.map(row => getCardLocationOnHandValue(row)) }))()`))) });
  expect(driveMetrics.map(metric => metric.label)).toEqual(expectedLabels);
  expect(driveMetrics.map(metric => metric.value)).toEqual(['88', '10', '78', '85', 'N/A', '88']);
  const drivePhoto = card.locator('img').first();
  await expect(drivePhoto).toBeVisible();
  await expect.poll(() => drivePhoto.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const driveCellStyles = await card.locator('[data-inventory-card-metric]').evaluateAll(nodes => nodes.map(node => {
    const label = node.querySelector('.app-card-qty-label') as HTMLElement | null;
    const value = node.querySelector('.app-card-qty-value') as HTMLElement | null;
    return [label, value].filter((element): element is HTMLElement => !!element).map(element => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      textOverflow: getComputedStyle(element).textOverflow,
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight) || 0,
    }));
  }));
  expect(driveCellStyles).toHaveLength(6);
  for (const cell of driveCellStyles.flat()) {
    expect(cell.whiteSpace).toBe('nowrap');
    expect(cell.height).toBeLessThanOrEqual(cell.lineHeight + 1);
  }
  const secondLocation = page.locator('#drive-content [role="button"][aria-label="Open drive row"]').filter({ hasText: 'G.11.001' }).first();
  await expect(secondLocation).toBeVisible();
  expect((await readMetrics(secondLocation)).find(metric => metric.label === 'Loc On Hand')?.value).toBe('1');

  await card.getByRole('button', { name: /Add To Bloom Picker$/ }).click();
  await page.locator('#footer-cart-btn').click();
  const tray = page.locator('#bloom-picker-tray');
  await expect(tray).toBeVisible();
  const trayCard = tray.locator('.bloom-picker-tray-row').first();
  const beforeActions = await readMetrics(trayCard);
  expect(beforeActions.map(metric => metric.label)).toEqual(expectedLabels);
  expect(beforeActions.map(metric => metric.value)).toEqual(driveMetrics.map(metric => metric.value));
  expect(await readMetrics(card)).toEqual(driveMetrics);
  const bloomGridColumns = await trayCard.locator('.app-bloom-card-metrics .app-card-qty-row').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  const expectedColumns = (page.viewportSize()?.width || 0) < 768 ? 3 : 6;
  expect(bloomGridColumns).toBe(expectedColumns);
  const meta = trayCard.locator('.app-bloom-card-meta');
  await expect(meta.locator(':scope > span')).toHaveText(['LOC G.11.000', 'LOT 27.F1', 'PRI 1', 'DESIGLOC NORTH']);
  expect(await meta.evaluate(element => getComputedStyle(element).flexWrap)).toBe('wrap');
  await expect(trayCard.locator('img').first()).toBeVisible();
  await expect.poll(() => trayCard.locator('img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const bloomCells = await trayCard.locator('.app-bloom-card-metrics [data-inventory-card-metric]').evaluateAll(nodes => nodes.map(node => {
    const label = node.querySelector('.app-card-qty-label') as HTMLElement | null;
    const value = node.querySelector('.app-card-qty-value') as HTMLElement | null;
    return [label, value].filter((element): element is HTMLElement => !!element).map(element => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      textOverflow: getComputedStyle(element).textOverflow,
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight) || 0,
    }));
  }));
  const geometry = await trayCard.locator('.app-bloom-card-metrics [data-inventory-card-metric]').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    const value = node.querySelector('.app-card-qty-value') as HTMLElement;
    return { top: rect.top, height: rect.height, children: node.children.length,
      valueCount: node.querySelectorAll('.app-card-qty-value').length, fits: value.scrollWidth <= value.clientWidth + 1,
      before: getComputedStyle(value, '::before').content, after: getComputedStyle(value, '::after').content };
  }));
  expect(new Set(geometry.map(cell => Math.round(cell.top))).size).toBe(expectedColumns === 3 ? 2 : 1);
  expect(Math.max(...geometry.map(cell => cell.height)) - Math.min(...geometry.map(cell => cell.height))).toBeLessThanOrEqual(1);
  for (const cell of geometry) {
    expect(cell.children).toBe(2); expect(cell.valueCount).toBe(1); expect(cell.fits).toBe(true);
    expect(['none', 'normal', '""']).toContain(cell.before); expect(['none', 'normal', '""']).toContain(cell.after);
  }
  expect(bloomCells).toHaveLength(6);
  for (const cell of bloomCells.flat()) {
    expect(cell.whiteSpace).toBe('nowrap');
    expect(cell.textOverflow).toBe('ellipsis');
    expect(cell.height).toBeLessThanOrEqual(cell.lineHeight + 1);
  }
  const actions = page.locator('#bloom-picker-actions-toggle');
  await expect(actions).toBeVisible();
  await actions.click();
  await expect(trayCard.locator('.app-bloom-card-metrics [data-inventory-card-metric]')).toHaveCount(6);
  const afterActions = await readMetrics(trayCard);
  expect(afterActions).toEqual(beforeActions);
  expect(await readMetrics(card)).toEqual(driveMetrics);
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
