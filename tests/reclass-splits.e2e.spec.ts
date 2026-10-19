import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
import { expect, test, type Page } from '@playwright/test';

import { renderDriveLayoutCard, renderVerifiedDriveLayoutCard, restoreDriveLayoutRenderer, settleDriveLayoutShell, suppressDriveLayoutRenderer } from './fixtures/drive-card-layout';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';
import { compactReclassReceiptFixture } from './fixtures/reclass-receipt';
import { captureReclassFailureDiagnostics, installReclassFailureDiagnostics } from './helpers/reclass-failure-diagnostics.mjs';
import { isMasterBrowseInventoryReadBody } from './helpers/reclass-browse-request-tracker.mjs';
import { waitForInitialHomeCohort, waitForVerifiedLiveCohort } from './helpers/initial-home-cohort.mjs';
import { startReclassCdpTimeline } from './helpers/reclass-cdp-timeline.mjs';
import { reclassModalPaintLimitMs, scheduleReclassPaintProbeCheck } from './helpers/reclass-paint-probe.mjs';
import { installReclassStageTiming } from './helpers/reclass-stage-timing.mjs';
// @test-group: @reclass-splits

const DRIVE_EVIDENCE_KEYS = [
  'unique_id', 'itemcode', 'locationcode', 'lotcode', 'last_updated', 'photo_link', 'photo_name', 'match', 'spec', 'caliper', 'initial_ptr', 'loc_match_qty',
  'ptravailable', 'av_note', 'pic_note', 'sales_note', 'date_completed', 'app_tab_assignment', 'av_rule_av_note_updated_at', 'av_rule_bundle_updated_at',
  'av_rule_caliper_updated_at', 'av_rule_holdstop_snapshot', 'av_rule_last_clear_reason', 'av_rule_last_cleared_at', 'av_rule_match_updated_at',
  'av_rule_photo_updated_at', 'av_rule_priority_snapshot', 'av_rule_spec_updated_at',
];

function confirmedEvidence(uid: string, lastUpdated: string) {
  return Object.assign(Object.fromEntries(DRIVE_EVIDENCE_KEYS.map(key => [key, null])), {
    unique_id: uid, itemcode: 'LAYOUT.001-NO-PHOTO', locationcode: 'A.01.001', lotcode: '27.F1', last_updated: lastUpdated,
    ptravailable: '13', av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: lastUpdated,
  });
}

function confirmedHoldReceipt(row: Record<string, any>, reason: string, revision: number, lastUpdated: string, jobId: string) {
  Object.assign(row, { holdstopcode: 'H', HOLDSTOPCODE: 'H', holdstopreason: reason, HOLDSTOPREASON: reason,
    av_rule_last_clear_reason: 'hold_requested', AV_RULE_LAST_CLEAR_REASON: 'hold_requested',
    av_rule_last_cleared_at: lastUpdated, AV_RULE_LAST_CLEARED_AT: lastUpdated, last_updated: lastUpdated, LAST_UPDATED: lastUpdated });
  const evidence = Object.fromEntries(DRIVE_EVIDENCE_KEYS.map(key => [key,
    key === 'last_updated' ? lastUpdated : row[key] ?? row[key.toUpperCase()] ?? null]));
  return { ok: true, status: 'queued', jobId, queuedAt: lastUpdated,
    workflowPolicyVersion: 'reclass-action-workflow-v7-editable-fields-20261009',
    inventoryFields: [], inventoryRevision: String(revision),
    liveEdits: [{ unique_id: String(row.unique_id ?? row.UNIQUE_ID), priority: row.priority ?? row.PRIORITY ?? null,
      holdstopcode: 'H', holdstopreason: reason, av_rule_last_clear_reason: 'hold_requested',
      av_rule_last_cleared_at: lastUpdated, last_updated: lastUpdated, evidence }] };
}


// The real editor/submit handlers run against intercepted requests. Unknown
// writes remain rejected by the existing fixture; no real inventory/email is used.
async function fixture(page: Page, baseURL: string, project: string,
  scope: { season: string; salesYear: string } = { season: 'F1', salesYear: '27' },
  inventoryRows = 1, sourceQuantity = 25, verifyGlobalFullSnapshot = true) {
  const lotcode = `${scope.salesYear}.${scope.season}`;
  // The backend fixture must return the same row as the mounted Drive card.
  // Background inventory hydration can replace manually mounted rows.
  const control = await installHlOrderFixture(page, baseURL, { role: 'ADMIN', username: 'dylan_collyge',
    appPermissions: [{permissionKey:'module.po-management.view',kind:'module',moduleKey:'po-management',allowed:true},{permissionKey:'drive.reclass.submit',kind:'action',moduleKey:'drive',allowed:true}],
    master: [hlMaster('drive-layout-synthetic-1-no-photo', { itemcode: 'LAYOUT.001-NO-PHOTO',
      commonname: 'Synthetic Drive Card', contsize: '#3', locationcode: 'A.01.001', lotcode,
      season: scope.season, saleyear: scope.salesYear,
      ptronhand: String(sourceQuantity), ptrreviewed: '2', ptravailable: String(sourceQuantity), priority: '2', holdstopcode: '',
      photo_link: null, photo_name: null, spec: 'old spec', caliper: 'old caliper',
      match: 'old match', av_note: 'old AV note', pic_note: 'old pick', sales_note: 'old sales', last_updated: '2026-10-08T12:00:00Z' }),
      ...Array.from({ length: Math.max(0, inventoryRows - 1) }, (_, index) => hlMaster(`zz-volume-${String(index).padStart(4, '0')}`, {
        itemcode: `VOLUME.${String(index).padStart(4, '0')}`, commonname: `Synthetic volume row ${index}`, locationcode: `Z.${String(index).padStart(5, '0')}`,
        lotcode: '27.F1', season: 'F1', saleyear: '27', ptronhand: '100', ptravailable: '100' }))],
  });
  const activeMasterBrowseRequests = new Set<import('@playwright/test').Request>();
  const isMasterBrowseRead = (request: import('@playwright/test').Request) => {
    if (!request.url().includes('/functions/v1/app-api') || request.method() !== 'POST') return false;
    try {
      return isMasterBrowseInventoryReadBody(request.postDataJSON());
    } catch (_) { return false; }
  };
  const trackBrowseStart = (request: import('@playwright/test').Request) => { if (isMasterBrowseRead(request)) activeMasterBrowseRequests.add(request); };
  const trackBrowseEnd = (request: import('@playwright/test').Request) => { activeMasterBrowseRequests.delete(request); };
  page.on('request', trackBrowseStart);
  page.on('requestfinished', trackBrowseEnd);
  page.on('requestfailed', trackBrowseEnd);
  await settleDriveLayoutShell(page, project);
  const calls: any[] = [];
  const createReplies: Array<Record<string, unknown>> = [];
  let rejectNext = false;
  let deliveryStatus = 'queued';
  let createReply: ((body: Record<string, any>) => unknown) | null = null;
  const summarizeCreateReply = (payload: unknown) => {
    const value = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
    return { ok: value.ok === true, status: String(value.status || ''), code: String(value.code || ''),
      jobIdPresent: typeof value.jobId === 'string' && !!value.jobId, workflowPolicyVersion: String(value.workflowPolicyVersion || ''),
      inventoryRevision: String(value.inventoryRevision || ''), liveEditCount: Array.isArray(value.liveEdits) ? value.liveEdits.length : 0,
      inventoryFieldReceiptCount: Array.isArray(value.inventoryFields) ? value.inventoryFields.length : 0 };
  };
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'drive_reclass_inquiry') return route.fallback();
    const reply = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    if (body.operation === 'create') {
      calls.push(structuredClone(body));
      if (rejectNext) {
        rejectNext = false;
        const payload = { ok: false, error: 'Synthetic queue failure; your draft is retained.' };
        createReplies.push(summarizeCreateReply(payload));
        return reply(payload);
      }
      if (createReply) {
        const payload = await createReply(body);
        createReplies.push(summarizeCreateReply(payload));
        return reply(payload);
      }
      const payload = { ok: true, status: 'queued', jobId: 'synthetic-reclass', queuedAt: new Date().toISOString() };
      createReplies.push(summarizeCreateReply(payload));
      return reply(payload);
    }
    if (body.operation === 'status') return reply({ ok: true, status: deliveryStatus, jobId: 'synthetic-reclass' });
    return route.fallback();
  });
  let verifiedFullSnapshot: { revision: string; scope: string; permission: string; complete: boolean; rowCount: number;
    uniqueIdCount: number; uniqueCommonNameCount: number; requiredFieldsPresent: boolean } | null = null;
  if (inventoryRows >= 1200 && verifyGlobalFullSnapshot) {
    const failedRequests: Array<{ method: string; url: string; failure: string }> = [];
    const responseDiagnostics: Array<Record<string, unknown>> = [];
    const failedRequestHandler = (request: import('@playwright/test').Request) => {
      let urlPath = '';
      try { urlPath = new URL(request.url()).pathname; } catch (_) {}
      failedRequests.push({ method: request.method(), url: urlPath, failure: request.failure()?.errorText || 'unknown request failure' });
    };
    const responseHandler = async (response: import('@playwright/test').Response) => {
      try {
        const url = new URL(response.url());
        const isSupabaseApi = url.hostname.endsWith('.supabase.co');
        const isRestRead = url.pathname.startsWith('/rest/v1/');
        if (!isSupabaseApi || (!isRestRead && !['/functions/v1/app-api', '/rest/v1/rpc/get_my_dataset_revisions_v1'].includes(url.pathname))) return;
        const request = response.request();
        let body: Record<string, unknown> | null = null;
        try { body = request.postDataJSON() as Record<string, unknown> | null; } catch (_) {}
        const headers = await response.allHeaders();
        responseDiagnostics.push({ method: request.method(), path: url.pathname, status: response.status(),
          contentRange: headers['content-range'] || '',
          action: typeof body?.action === 'string' ? body.action : '', operation: typeof body?.operation === 'string' ? body.operation : '',
          dataset: typeof body?.dataset === 'string' ? body.dataset : '',
          allowOrigin: headers['access-control-allow-origin'] || '', allowCredentials: headers['access-control-allow-credentials'] || '',
          allowMethods: headers['access-control-allow-methods'] || '', allowHeaders: headers['access-control-allow-headers'] || '' });
      } catch (_) { /* Diagnostics must never affect the fixture read. */ }
    };
    page.on('requestfailed', failedRequestHandler);
    page.on('response', responseHandler);
    await page.evaluate(factory => {
      const root = window as any;
      root.__reclassFailureDiagnostics = window.eval(`(${factory})`)(window);
    }, installReclassFailureDiagnostics.toString());
    let loadResult: boolean | null = null;
    let loadError = '';
    let diagnostics: Record<string, unknown> | null = null;
    let loadInstrumentation: Record<string, unknown> | null;
    let startupCohort: Record<string, unknown> | null = null;
    let driveCohort: Record<string, unknown> | null = null;
    try {
      startupCohort = await waitForInitialHomeCohort(async () => page.evaluate(() => window.eval(`(() => {
        const context = getProductionLiveSyncContext();
        const coordinator = getProductionLiveSyncCoordinator();
        const status = coordinator.getStatus();
        const contextKey = productionVerifiedViewKey(context);
        const verifiedView = productionLiveSyncVerifiedView;
        const accessPermission = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
        const roleReady = document.body.classList.contains('role-access-ready');
        const initialHomeApplied = hasAppliedInitialHomeView === true;
        const ready = roleReady && initialHomeApplied && String(currentRole || '').toUpperCase() === 'ADMIN'
          && !!context.scope && !!context.dataPermissionVersion && context.dataPermissionVersion === accessPermission
          && status.state === 'Up to date' && status.contextKey === contextKey && verifiedView === contextKey;
        return { ready, status, role: String(currentRole || ''), user: String(currentUser || ''), roleReady, initialHomeApplied,
          scope: context.scope, permission: context.dataPermissionVersion, accessPermission, view: context.view,
          contextKey, verifiedView };
      })()`)));
      await suppressDriveLayoutRenderer(page);
      await page.evaluate(() => window.eval(`(() => { switchView('drive'); return true; })()`));
      driveCohort = await waitForVerifiedLiveCohort(async () => page.evaluate(() => window.eval(`(() => {
        const context = getProductionLiveSyncContext();
        const coordinator = getProductionLiveSyncCoordinator();
        const status = coordinator.getStatus();
        const contextKey = productionVerifiedViewKey(context);
        const verifiedView = productionLiveSyncVerifiedView;
        const master = context.adapters.find(adapter => adapter.id === 'core:master');
        const state = getDatasetState('master');
        const ready = document.body.classList.contains('role-access-ready') && context.view === 'drive'
          && master?.projection === 'browse' && !!context.scope && !!context.dataPermissionVersion
          && status.state === 'Up to date' && status.contextKey === contextKey && verifiedView === contextKey
          && state.initialLoaded === true && state.liveVerifiedScope === context.scope
          && state.liveVerifiedPermission === context.dataPermissionVersion;
        return { ready, status, view: context.view, scope: context.scope, permission: context.dataPermissionVersion,
          contextKey, verifiedView, masterProjection: master?.projection || '', rowCount: fullInventory.length,
          revision: String(state.liveVerifiedRevision || '') };
      })()`)), { label: 'Drive', timeoutMs: 60_000 });
      loadResult = await page.evaluate(() => window.eval("(async () => await ensureDatasetLoaded('master', 'full', { force: true }))()"));
      if (!loadResult) diagnostics = await page.evaluate(() => window.eval(`(() => {
        const coordinator = getProductionLiveSyncCoordinator();
        const state = getDatasetState('master');
        const context = getProductionLiveSyncContext();
        const requestedFull = createProductionCoreLiveAdapter('master', 'full');
        const ids = fullInventory.map(row => String(row.UNIQUE_ID || row.unique_id || '').trim());
        const uniqueNames = countUniqueCacheCommonNames(fullInventory);
        const requiredFields = ['UNIQUE_ID', 'ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SEASON', 'SALEYEAR', 'PTRONHAND', 'PTRAVAILABLE'];
        return { coordinatorStatus: coordinator.getStatus(), coordinatorStatistics: coordinator.getStatistics(),
          datasetState: { initialLoaded: state.initialLoaded, fullLoaded: state.fullLoaded, rowCompleteness: state.rowCompleteness,
            fieldCoverage: state.fieldCoverage, liveVerifiedRevision: String(state.liveVerifiedRevision || ''),
            liveVerifiedScope: state.liveVerifiedScope, liveVerifiedPermission: state.liveVerifiedPermission },
          inventory: { rowCount: fullInventory.length, uniqueIdCount: new Set(ids.filter(Boolean)).size, emptyIdCount: ids.filter(id => !id).length,
            uniqueCommonNameCount: uniqueNames,
            requiredFieldsPresent: fullInventory.every(row => requiredFields.every(field => Object.prototype.hasOwnProperty.call(row, field))),
            partialGuard: masterRowsLookPartialForCurrentScope(fullInventory) },
          context: { visible: context.visible, online: context.online, scope: context.scope,
            permissionVersion: context.dataPermissionVersion, view: context.view, surfaces: context.surfaces,
            adapters: context.adapters.map(adapter => ({ id: adapter.id, cacheKey: adapter.cacheKey, sourceKeys: adapter.sourceKeys })) },
          requestedFullAdapter: { id: requestedFull.id, cacheKey: requestedFull.cacheKey, sourceKeys: requestedFull.sourceKeys },
          coordinatorEvents: window.__reclassFailureDiagnostics?.coordinatorEvents || [] };
      })()`));
    } catch (error) {
      const failure = await captureReclassFailureDiagnostics(error, () => page.evaluate(() => {
        const root = window as any;
        const safe = (read: () => unknown) => { try { return read(); } catch (diagnosticError) { return { error: String(diagnosticError) }; } };
        const coordinator = typeof getProductionLiveSyncCoordinator === 'function' ? safe(() => getProductionLiveSyncCoordinator()) as any : null;
        const state = typeof getDatasetState === 'function' ? safe(() => getDatasetState('master')) as any : null;
        const visible = (selector: string) => {
          const element = document.querySelector(selector);
          return !!element && !!element.getClientRects().length && getComputedStyle(element).display !== 'none';
        };
        return { url: location.href, readyState: document.readyState, loginVisible: visible('#view-login'),
          runtimeLoaded: typeof getProductionLiveSyncCoordinator === 'function',
          shell: { version: root.__APP_SHELL_VERSION__ || '', build: root.__APP_SHELL_BUILD__ || '',
            queryBuild: new URL(location.href).searchParams.get('shellv') || '' },
          coordinatorStatus: coordinator?.getStatus?.() || null, coordinatorStatistics: coordinator?.getStatistics?.() || null,
          state: state ? { fullLoaded: state.fullLoaded, revision: state.liveVerifiedRevision, scope: state.liveVerifiedScope,
            permission: state.liveVerifiedPermission } : null,
          contexts: root.__reclassFailureDiagnostics?.contextSnapshots || [], events: root.__reclassFailureDiagnostics?.coordinatorEvents || [] };
      }), { pageUrl: page.url(), pageClosed: page.isClosed() });
      loadError = failure.loadError;
      diagnostics = { ...failure.diagnostics, diagnosticCaptureError: failure.diagnosticCaptureError };
    } finally {
      try {
        loadInstrumentation = await page.evaluate(() => {
          const root = window as any;
          const handle = root.__reclassFailureDiagnostics;
          if (!handle) return null;
          const result = { records: handle.records, contextSnapshots: handle.contextSnapshots, coordinatorEvents: handle.coordinatorEvents };
          handle.restore();
          delete root.__reclassFailureDiagnostics;
          return result;
        });
      } catch (error) {
        loadInstrumentation = { captureError: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
      }
      page.off('requestfailed', failedRequestHandler);
      page.off('response', responseHandler);
      if (diagnostics) {
        diagnostics.startupCohort = startupCohort;
        diagnostics.driveCohort = driveCohort;
        diagnostics.failureInstrumentation = loadInstrumentation;
        diagnostics.shellDiagnostics = control.shellDiagnostics;
        diagnostics.loadError = loadError;
        diagnostics.failedRequests = failedRequests;
        diagnostics.corsResponses = responseDiagnostics;
        await test.info().attach('reclass-full-inventory-load-diagnostics.json', { contentType: 'application/json', body: JSON.stringify(diagnostics, null, 2) });
      }
    }
    if (loadResult === true) {
      const successfulLoad = await page.evaluate(() => window.eval(`(() => {
        const state = getDatasetState('master');
        const status = getProductionLiveSyncCoordinator()?.getStatus?.();
        return { coordinatorStatus: status, rowCount: fullInventory.length, rowCompleteness: state.rowCompleteness,
          fieldCoverage: state.fieldCoverage, revision: String(state.liveVerifiedRevision || ''),
          scope: String(state.liveVerifiedScope || ''), permission: String(state.liveVerifiedPermission || '') };
      })()`));
      await test.info().attach('reclass-full-inventory-load-diagnostics.json', { contentType: 'application/json', body: JSON.stringify({
        loadResult, successfulLoad, instrumentation: loadInstrumentation,
        startupCohort, driveCohort,
        failedRequests, corsResponses: responseDiagnostics,
        shellDiagnostics: control.shellDiagnostics,
      }, null, 2) });
    }
    expect(loadResult, `the representative full inventory must load through the production verified read path${loadError ? `: ${loadError}` : ''}`).toBe(true);
    verifiedFullSnapshot = await page.evaluate(() => window.eval(`(() => {
      const state = getDatasetState('master');
      const context = getProductionLiveSyncContext();
      return { revision: String(state.liveVerifiedRevision || ''), scope: String(state.liveVerifiedScope || ''), permission: String(state.liveVerifiedPermission || ''),
        complete: state.initialLoaded === true && state.fullLoaded === true && state.rowCompleteness === 'complete' && state.fieldCoverage === 'full'
          && state.liveVerifiedScope === context.scope && state.liveVerifiedPermission === context.dataPermissionVersion
          && isConfirmedInventoryReadRevisionCurrent(state.liveVerifiedRevision)
          && !masterRowsLookPartialForCurrentScope(fullInventory), rowCount: fullInventory.length,
        uniqueIdCount: new Set(fullInventory.map(row => String(row.UNIQUE_ID || row.unique_id || '').trim()).filter(Boolean)).size,
        uniqueCommonNameCount: countUniqueCacheCommonNames(fullInventory),
        requiredFieldsPresent: fullInventory.every(row => ['UNIQUE_ID', 'ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SEASON', 'SALEYEAR', 'PTRONHAND', 'PTRAVAILABLE']
          .every(field => Object.prototype.hasOwnProperty.call(row, field))) };
    })()`));
    expect(verifiedFullSnapshot.revision, 'a revision from a completed full production read is required').toMatch(/^[1-9]\d*$/);
    expect(verifiedFullSnapshot.complete).toBe(true);
    expect(verifiedFullSnapshot.rowCount).toBe(inventoryRows);
    expect(verifiedFullSnapshot.uniqueIdCount).toBe(inventoryRows);
    expect(verifiedFullSnapshot.uniqueCommonNameCount).toBeGreaterThanOrEqual(1200);
    expect(verifiedFullSnapshot.requiredFieldsPresent).toBe(true);
  }
  const mount = async () => {
    const preserveVerifiedInventory = !!verifiedFullSnapshot;
    if (preserveVerifiedInventory) {
      const mounted = await renderVerifiedDriveLayoutCard(page, { theme: 'light', knownQuantities: true },
        'drive-layout-synthetic-1-no-photo', verifiedFullSnapshot!, inventoryRows, sourceQuantity);
      expect(mounted.rowCount).toBe(inventoryRows);
      expect(mounted.sourceUid).toBe('drive-layout-synthetic-1-no-photo');
      return;
    }
    await renderDriveLayoutCard(page, { theme: 'light', knownQuantities: true });
    await page.evaluate(({ scope, lotcode, sourceQuantity }) => {
      const root = window as any;
      root.__reclassFixtureBridge = { scope, lotcode, sourceQuantity };
      try {
        return window.eval(`(() => {
          const { scope, lotcode, sourceQuantity } = window.__reclassFixtureBridge;
          const source = fullInventory.find(row => row.UNIQUE_ID === 'drive-layout-synthetic-1-no-photo' || row.unique_id === 'drive-layout-synthetic-1-no-photo');
          if (!source) throw new Error('Reclass fixture source row is missing after inventory mount.');
          source.PTRONHAND = sourceQuantity; source.PTRAVAILABLE = sourceQuantity;
          source.ptronhand = String(sourceQuantity); source.ptravailable = String(sourceQuantity);
          source.SEASON = scope.season; source.SALEYEAR = scope.salesYear; source.LOTCODE = lotcode;
          source.season = scope.season; source.saleyear = scope.salesYear; source.lotcode = lotcode;
          source.LAST_UPDATED = '2026-10-08T12:00:00Z'; source.last_updated = '2026-10-08T12:00:00Z';
          source.DOM_ID = source.DOM_ID || 'fi_0';
          rebuildMasterInventoryIndexes();
          return true;
        })()`);
      } finally { delete root.__reclassFixtureBridge; }
    }, { scope, lotcode, sourceQuantity });
  };
  await mount();
  const confirmInventoryRevision = async () => page.evaluate(({ snapshot }) => {
    const root = window as any;
    root.__reclassVerifiedSnapshot = snapshot;
    try {
      return window.eval(`(() => {
    const snapshot = window.__reclassVerifiedSnapshot;
    const context = getProductionLiveSyncContext();
    const master = getDatasetState('master');
    if (snapshot) {
      if (!master.initialLoaded || !master.fullLoaded || master.rowCompleteness !== 'complete' || master.fieldCoverage !== 'full'
          || String(master.liveVerifiedRevision || '') !== snapshot.revision
          || master.liveVerifiedScope !== snapshot.scope || master.liveVerifiedPermission !== snapshot.permission
          || context.scope !== snapshot.scope || context.dataPermissionVersion !== snapshot.permission
          || !isConfirmedInventoryReadRevisionCurrent(snapshot.revision)) throw new Error('RECLASS_FIXTURE_VERIFIED_SNAPSHOT_CHANGED');
      return true;
    }
    master.initialLoaded = true;
    master.fullLoaded = true;
    master.rowCompleteness = 'complete';
    master.fieldCoverage = 'full';
    master.liveVerifiedRevision = '1';
    master.liveVerifiedScope = context.scope;
    master.liveVerifiedPermission = context.dataPermissionVersion;
    return true;
      })()`);
    } finally {
      delete root.__reclassVerifiedSnapshot;
    }
  }, { snapshot: verifiedFullSnapshot });
  const open = async (expand = true) => {
    await confirmInventoryRevision();
    if (verifiedFullSnapshot) {
      expect(activeMasterBrowseRequests.size, 'the verified Drive browse cohort must be fully settled before opening the warm Item Inquiry').toBe(0);
      await page.evaluate(() => window.eval(`(() => {
        const context = getProductionLiveSyncContext();
        const coordinator = getProductionLiveSyncCoordinator();
        const status = coordinator.getStatus();
        const state = getDatasetState('master');
        const contextKey = productionVerifiedViewKey(context);
        if (context.view !== 'drive' || status.state !== 'Up to date' || status.contextKey !== contextKey
            || productionLiveSyncVerifiedView !== contextKey || !state.fullLoaded || state.fieldCoverage !== 'full'
            || state.rowCompleteness !== 'complete' || state.liveVerifiedScope !== context.scope
            || state.liveVerifiedPermission !== context.dataPermissionVersion) throw new Error('RECLASS_FIXTURE_OPEN_REQUIRES_SETTLED_VERIFIED_DRIVE:' + JSON.stringify({
              view: context.view, surfaces: context.surfaces, viewKey: context.viewKey, status,
              contextKey, verifiedView: productionLiveSyncVerifiedView,
              state: { fullLoaded: state.fullLoaded, fieldCoverage: state.fieldCoverage, rowCompleteness: state.rowCompleteness,
                scope: state.liveVerifiedScope, permission: state.liveVerifiedPermission },
              scope: context.scope, permission: context.dataPermissionVersion,
            }));
        return true;
      })()`));
    }
    const warmSnapshot = await page.evaluate(() => window.eval(`(() => {
      const row = findItemByUniqueId('drive-layout-synthetic-1-no-photo');
      const group = getVerifiedCachedArgosItemInquiryGroup(row);
      return group ? { scope: group.scope, permission: group.permission } : null;
    })()`));
    const context = await page.evaluate(() => window.eval('getProductionLiveSyncContext()'));
    expect(warmSnapshot, 'the Item Inquiry must use the verified complete warm snapshot under the current coordinator scope and permission').toEqual({ scope: context.scope, permission: context.dataPermissionVersion });
    await page.locator('#drive-content .app-drive-card-reclass .app-card-bottom-btn').click();
    await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
    const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
    if (expand && await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') await row.locator('.argos-reclass-row-toggle').click();
    return row;
  };
  return { control, calls, createReplies, open, mount, confirmInventoryRevision, failNext: () => { rejectNext = true; }, conflict: () => { deliveryStatus = 'conflict'; }, setCreateReply: (replyFactory: (body: Record<string, any>) => unknown) => { createReply = replyFactory; } };
}

async function expectReclassModalHiddenWithDiagnostics(page: Page, f: Awaited<ReturnType<typeof fixture>>, moveRequests: Array<Record<string, any>>, context = '') {
  try {
    await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  } catch (error) {
    const browserState = await page.evaluate(() => window.eval(`(() => {
      const state = argosInventoryTransactionState;
      const source = fullInventory.find(row => String(row.UNIQUE_ID || row.unique_id || '') === 'drive-layout-synthetic-1-no-photo');
      const toast = document.getElementById('toast-notification');
      const apply = document.getElementById('argos-inventory-transaction-apply');
      const pending = state?.pendingReclassMove;
      const holdProposals = argosReclassMultiActionState?.holdStopProposals || {};
      const hold = Object.values(holdProposals)[0] || null;
      const proposals = getArgosReclassRowProposalMap('drive-layout-synthetic-1-no-photo', false) || {};
      const draftErrors = Array.from(document.querySelectorAll('#argos-inventory-transaction-modal [aria-invalid="true"], #argos-inventory-transaction-modal [role="alert"], #argos-inventory-transaction-modal .field-error, #argos-inventory-transaction-modal .argos-reclass-error'))
        .map(node => String(node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 240)).filter(Boolean).slice(0, 12);
      return { sourceView: String(state?.sourceView || ''), globalMaster: { fullLoaded: getDatasetState('master').fullLoaded === true,
          revision: String(getDatasetState('master').liveVerifiedRevision || ''), scope: String(getDatasetState('master').liveVerifiedScope || ''),
          permission: String(getDatasetState('master').liveVerifiedPermission || '') },
        inquiryGroup: state?.verifiedInquiryGroup ? { revision: String(state.verifiedInquiryGroup.revision || ''),
          sourceSignature: String(state.verifiedInquiryGroup.sourceSignature || ''), scope: String(state.verifiedInquiryGroup.scope || ''),
          permission: String(state.verifiedInquiryGroup.permission || '') } : null,
        modalVisible: !!document.getElementById('argos-inventory-transaction-modal')?.getClientRects().length,
        toastText: String(toast?.innerText || '').slice(0, 500), applyText: String(apply?.textContent || ''), applyDisabled: !!apply?.disabled,
        submitting: !!state?.submitting, pendingMove: pending ? { uncertain: !!pending.uncertain, inFlight: !!pending.inFlight,
          commandIdPresent: !!pending.command?.commandId, movedUidCount: Array.isArray(pending.movedUids) ? pending.movedUids.length : 0 } : null,
        holdDraft: hold ? { action: String(hold.action || ''), reasonPresent: !!String(hold.reason || '').trim(),
          reasonLength: String(hold.reason || '').length, sourceUidPresent: !!String(hold.sourceUid || '').trim() } : null,
        draftErrorState: { validationMessages: draftErrors,
          modelErrorPresent: !!(state?.inquiryModel?.error || state?.inquiryModel?.draftError),
          invalidFieldCount: document.querySelectorAll('#argos-inventory-transaction-modal [aria-invalid="true"]').length },
        proposalActions: Object.keys(proposals).sort(), source: source ? { onHand: String(source.PTRONHAND ?? source.ptronhand ?? ''),
          available: String(source.PTRAVAILABLE ?? source.ptravailable ?? ''), season: String(source.SEASON ?? source.season ?? ''),
          holdCode: String(source.HOLDSTOPCODE ?? source.holdstopcode ?? '') } : null };
    })()`));
    const source = f.control.master.find((row: any) => row.unique_id === 'drive-layout-synthetic-1-no-photo');
    const submitProbe = await page.evaluate(() => window.eval('window.__reclassSubmitProbe || null'));
    await test.info().attach('reclass-final-submit-failure-diagnostics.json', { contentType: 'application/json', body: JSON.stringify({
      context, error: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200), browserState,
      submitProbe,
      createRequestCount: f.calls.length, createReplies: f.createReplies,
      moveRequestCount: moveRequests.length, moveOperations: moveRequests.map(request => String(request.operation || '')),
      datasetRevision: String(f.control.datasetRevision || ''), sourceControl: source ? { onHand: String(source.PTRONHAND ?? source.ptronhand ?? ''),
        available: String(source.PTRAVAILABLE ?? source.ptravailable ?? ''), season: String(source.SEASON ?? source.season ?? ''),
        holdCode: String(source.HOLDSTOPCODE ?? source.holdstopcode ?? '') } : null,
    }, null, 2) });
    throw error;
  }
}

async function installReclassSubmitDiagnostics(page: Page) {
  await page.evaluate(() => {
    const root = window as any;
    const probe: any = root.__reclassSubmitProbe = { events: [], payloads: [], toastEvents: [] };
    const summarizePayload = (payload: any) => ({
      requestActions: Array.isArray(payload?.transaction?.requestActions) ? payload.transaction.requestActions.map(String) : [],
      holdStopProposals: Array.isArray(payload?.transaction?.holdStopProposals) ? payload.transaction.holdStopProposals.map((item: any) => ({
        action: String(item?.action || ''), reasonPresent: !!String(item?.reason || '').trim(), sourceUidPresent: !!String(item?.sourceUid || '').trim(),
      })) : [],
      rowOverlays: Array.isArray(payload?.rowOverlays) ? payload.rowOverlays.map((overlay: any) => ({
        uniqueId: String(overlay?.unique_id || ''), actions: Array.isArray(overlay?.proposals) ? overlay.proposals.map((item: any) => String(item?.action || '')) : [],
        moveLines: Array.isArray(overlay?.proposals) ? overlay.proposals.filter((item: any) => ['move_up', 'move_down'].includes(String(item?.action || '')))
          .flatMap((item: any) => Array.isArray(item?.splits) ? item.splits.map((split: any) => ({ quantity: Number(split.quantity), destinationSeason: String(split.destinationSeason || '') })) : []) : [],
      })) : [],
    });
    const originalBuild = root.buildArgosInventoryTransactionPayload;
    if (typeof originalBuild === 'function') {
      root.buildArgosInventoryTransactionPayload = function(...args: any[]) {
        try {
          const payload = originalBuild.apply(this, args);
          probe.payloads.push(summarizePayload(payload));
          return payload;
        } catch (error) {
          probe.payloads.push({ buildError: String((error as Error)?.message || error).slice(0, 300) });
          throw error;
        }
      };
      probe.originalBuild = originalBuild;
    }
    const originalSubmit = root.submitArgosInventoryTransaction;
    if (typeof originalSubmit === 'function') {
      root.submitArgosInventoryTransaction = function(...args: any[]) {
        const state = window.eval('argosInventoryTransactionState');
        const actionState = window.eval('argosReclassMultiActionState');
        const holds = actionState?.holdStopProposals || {};
        const event: any = { at: performance.now(), type: 'submit-start', uid: String(state?.snapshot?.uniqueId || state?.uid || ''),
          submitting: !!state?.submitting, pendingMove: !!state?.pendingReclassMove,
          holdActions: Object.values(holds).map((item: any) => ({ action: String(item?.action || ''),
            reasonPresent: !!String(item?.reason || '').trim(), sourceUidPresent: !!String(item?.sourceUid || '').trim() })) };
        probe.events.push(event);
        let result: any;
        try { result = originalSubmit.apply(this, args); }
        catch (error) { event.type = 'submit-throw'; event.error = String((error as Error)?.message || error).slice(0, 300); throw error; }
        if (result && typeof result.then === 'function') return Promise.resolve(result).then((value: unknown) => {
          event.type = 'submit-finish'; event.result = value === false ? 'false' : value === true ? 'true' : typeof value; return value;
        }, (error: unknown) => { event.type = 'submit-reject'; event.error = String((error as Error)?.message || error).slice(0, 300); throw error; });
        event.type = 'submit-finish'; event.result = result === false ? 'false' : result === true ? 'true' : typeof result; return result;
      };
      probe.originalSubmit = originalSubmit;
    }
    const originalShowToast = root.showToast;
    if (typeof originalShowToast === 'function') {
      root.showToast = function(...args: any[]) {
        probe.toastEvents.push({ at: performance.now(), title: String(args[0] || '').slice(0, 120),
          message: String(args[1] || '').slice(0, 300), isError: args[2] === true });
        return originalShowToast.apply(this, args);
      };
      probe.originalShowToast = originalShowToast;
    }
    const toast = document.getElementById('toast-notification');
    if (toast && typeof MutationObserver !== 'undefined') {
      let previous = '';
      const observer = new MutationObserver(() => {
        const text = String(toast.innerText || '').trim().slice(0, 300);
        if (text && text !== previous) { probe.toastEvents.push({ at: performance.now(), text }); previous = text; }
      });
      observer.observe(toast, { subtree: true, childList: true, characterData: true, attributes: true });
      probe.toastObserver = observer;
    }
  });
}

async function installLiveMoveEndpoint(page: Page, baseURL: string, control: any) {
  const requests: Record<string, any>[] = [];
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    const reply = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    requests.push(structuredClone(body));
    if (body.operation === 'status') return reply({ ok: true, data: { ok: true, status: 'missing' } });
    const sourceUid = body.moves[0].source.uniqueId;
    const sourceBefore = control.master.find((item: any) => item.unique_id === sourceUid);
    if (!sourceBefore) return reply({ ok: false, code: 'INVENTORY_RECLASS_SOURCE_CHANGED', message: 'Source row is missing.' });
    const total = body.moves.flatMap((move: any) => move.lines).reduce((sum: number, line: any) => sum + Number(line.quantity), 0);
    const sourceAfter = { ...sourceBefore, ptronhand: String(Number(sourceBefore.ptronhand) - total), ptravailable: String(Number(sourceBefore.ptravailable) - total),
      PTRONHAND: String(Number(sourceBefore.ptronhand) - total), PTRAVAILABLE: String(Number(sourceBefore.ptravailable) - total), last_updated: '2026-10-15T12:00:00Z' };
    const targets = new Map<string, Record<string, any>>();
    for (const move of body.moves) for (const line of move.lines) {
      const season = String(line.destinationSeason).toUpperCase();
      const existing = targets.get(season) || control.master.find((item: any) => item.unique_id === `server-target-${season.toLowerCase()}`);
      const current = existing || { ...sourceBefore, unique_id: `server-target-${season.toLowerCase()}`, UNIQUE_ID: `server-target-${season.toLowerCase()}`,
        lotcode: `${String(sourceBefore.lotcode).replace(/[.][^.]+$/, '')}.${season}`, season, ptronhand: '0', ptravailable: '0' };
      const onHand = Number(current.ptronhand ?? current.PTRONHAND ?? 0) + Number(line.quantity);
      const available = Number(current.ptravailable ?? current.PTRAVAILABLE ?? 0) + Number(line.quantity);
      targets.set(season, { ...current, lotcode: `${String(sourceBefore.lotcode).replace(/[.][^.]+$/, '')}.${season}`, LOTCODE: `${String(sourceBefore.lotcode).replace(/[.][^.]+$/, '')}.${season}`,
        season, SEASON: season, ptronhand: String(onHand), ptravailable: String(available), PTRONHAND: String(onHand), PTRAVAILABLE: String(available),
        last_updated: '2026-10-15T12:00:00Z' });
    }
    const targetRows = [...targets.values()];
    control.master = control.master.filter((item: any) => item.unique_id !== sourceUid && !targetRows.some(target => target.unique_id === item.unique_id))
      .concat(sourceAfter, ...targetRows);
    control.datasetRevision += 1;
    const receipt = { ok: true, commandId: body.commandId, requestId: `reclass-move-${requests.length}`, revision: 600 + requests.length,
      rows: [{ table: 'ph_master_inventory', row: sourceAfter }, ...targetRows.map(row => ({ table: 'ph_master_inventory', row }))],
      movements: body.moves.flatMap((move: any) => move.lines.map((line: any) => ({ direction: line.direction, destinationSeason: line.destinationSeason,
        quantity: line.quantity, sourceUniqueId: move.source.uniqueId, destinationUniqueId: `server-target-${String(line.destinationSeason).toLowerCase()}` }))),
      status: 'applied', importStatus: 'pending' };
    return reply({ ok: true, data: receipt });
  });
  return requests;
}

async function installPaintTimingProbe(page: Page, options: { phase: 'open' | 'expand' | 'optimistic'; uid: string; sourceQuantity?: number; targetQuantity?: number; requireHydrated?: boolean }) {
  await page.evaluate(({ config, schedulerSource }) => {
    const schedulePaintCheck = new Function(`return (${schedulerSource})`)();
    const root = window as any;
    const probe: any = { startedAt: null, result: null, observer: null, rafScheduled: false, frameTimesMs: [] };
    const visible = (element: Element | null) => !!element && !!element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    const findCard = (uid: string) => [...document.querySelectorAll('[data-reclass-row-card]')]
      .find(card => card.getAttribute('data-reclass-row-card') === uid) || null;
    const finishAfterPaint = () => {
      if (probe.result) return;
      const state = window.eval('argosInventoryTransactionState') as any;
      const modal = document.getElementById('argos-inventory-transaction-modal');
      if (!visible(modal) || !state || state.uid !== config.uid || !state.inquiryModel) return;
      const sourceEntry = state.inquiryModel.locationRows?.find((entry: any) => String(entry.unique_id || '') === config.uid);
      const sourceCard = findCard(config.uid);
      if (!sourceEntry || !visible(sourceCard)) return;
      if (config.phase === 'open') {
        const source = state.inquiryModel.rows?.find((row: any) => String(row.UNIQUE_ID || row.unique_id || '') === config.uid);
        const quantity = (row: any, key: string) => Number(row && (row[key] ?? row[key.toLowerCase()]));
        const metrics = sourceCard.querySelector('.argos-reclass-row-toggle-meta')?.textContent || '';
        if (quantity(source, 'PTRONHAND') !== config.sourceQuantity || quantity(source, 'PTRAVAILABLE') !== config.sourceQuantity
          || !metrics.includes(`OH ${config.sourceQuantity}`) || !metrics.includes(`AVL ${config.sourceQuantity}`)) return;
      }
      if (config.requireHydrated && sourceCard.querySelector('[data-reclass-row-hydrated="true"]') == null) return;
      if (config.phase === 'expand' && sourceCard.querySelector('[data-reclass-row-hydrated="true"]') == null) return;
      if (config.phase === 'optimistic') {
        const pending = state.pendingReclassMove;
        const source = state.inquiryModel.rows?.find((row: any) => String(row.UNIQUE_ID || row.unique_id || '') === config.uid);
        const target = state.inquiryModel.rows?.find((row: any) => String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
        const quantity = (row: any, key: string) => Number(row && (row[key] ?? row[key.toLowerCase()]));
        if (!pending || quantity(source, 'PTRONHAND') !== config.sourceQuantity || quantity(source, 'PTRAVAILABLE') !== config.sourceQuantity
          || quantity(target, 'PTRONHAND') !== config.targetQuantity || quantity(target, 'PTRAVAILABLE') !== config.targetQuantity) return;
        const targetCard = target && findCard(String(target.UNIQUE_ID || target.unique_id || ''));
        const sourceMetrics = sourceCard.querySelector('.argos-reclass-row-toggle-meta')?.textContent || '';
        const targetMetrics = targetCard?.querySelector('.argos-reclass-row-toggle-meta')?.textContent || '';
        if (!visible(targetCard) || !sourceMetrics.includes(`OH ${config.sourceQuantity}`) || !sourceMetrics.includes(`AVL ${config.sourceQuantity}`)
          || !targetMetrics.includes(`OH ${config.targetQuantity}`) || !targetMetrics.includes(`AVL ${config.targetQuantity}`)) return;
        if (visible(document.getElementById('loading-spinner')) || visible(document.querySelector('.argos-reclass-move-waiting'))) return;
      }
      probe.result = { elapsedMs: performance.now() - probe.startedAt, phase: config.phase, frameTimesMs: probe.frameTimesMs.slice() };
      if (config.phase === 'optimistic') {
        try {
          performance.mark('reclass-610-optimistic-painted');
          performance.measure('reclass-610-click-to-optimistic-paint', 'reclass-610-apply-captured', 'reclass-610-optimistic-painted');
        } catch {}
      }
      probe.observer?.disconnect();
    };
    probe.finishAfterPaint = finishAfterPaint;
    const check = () => schedulePaintCheck(probe, (callback: FrameRequestCallback) => requestAnimationFrame(timestamp => {
      probe.frameTimesMs.push(performance.now() - probe.startedAt);
      callback(timestamp);
    }));
    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const matches = config.phase === 'open'
        ? !!target?.closest('.app-drive-card-reclass .app-card-bottom-btn')
        : config.phase === 'expand'
          ? !!target?.closest(`[data-reclass-row-card="${CSS.escape(config.uid)}"] .argos-reclass-row-toggle`)
        : !!target?.closest('#argos-inventory-transaction-apply');
      if (!matches || probe.startedAt != null) return;
      probe.startedAt = performance.now();
      probe.observer = new MutationObserver(check);
      probe.observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      check();
    };
    document.addEventListener('click', onClick, true);
    root.__reclassPaintTimingProbe = probe;
  }, { config: options, schedulerSource: scheduleReclassPaintProbeCheck.toString() });
}

async function readPaintTimingProbe(page: Page) {
  try {
    await page.waitForFunction(() => !!(window as any).__reclassPaintTimingProbe?.result, null, { timeout: 5000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const root = window as any, probe = root.__reclassPaintTimingProbe, state = window.eval('argosInventoryTransactionState') as any;
      const card = document.querySelector('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
      const modal = document.getElementById('argos-inventory-transaction-modal');
      return { probeStarted: probe?.startedAt != null, probeResult: probe?.result, uid: state?.uid,
        modelUid: state?.inquiryModel?.locationRows?.map((entry: any) => entry.unique_id), modalClass: modal?.className,
        modalVisible: !!modal?.getClientRects().length, cardFound: !!card,
        hydrated: !!card?.querySelector('[data-reclass-row-hydrated="true"]'),
        clickButtonClass: document.querySelector('.app-drive-card-reclass .app-card-bottom-btn')?.className };
    });
    throw new Error(`RECLASS_PAINT_PROBE_TIMEOUT:${JSON.stringify(diagnostic)}; ${String(error)}`, { cause: error });
  }
  return page.evaluate(() => (window as any).__reclassPaintTimingProbe.result as { elapsedMs: number; phase: string });
}

async function installApplyStageTiming(page: Page) {
  const names = [
    'submitArgosInventoryTransaction',
    'collectArgosReclassV3Draft',
    'buildInventoryReclassMoveCommand',
    'buildOptimisticInventoryReclassMoveModel',
    'buildItemInquiryViewModel',
    'renderArgosInventoryTransactionInquiryModel',
    'renderArgosReclassInquiryEditor',
    'setArgosReclassMoveInputsLocked',
    'persistPendingArgosInventoryReclassMove',
  ];
  const missing = await page.evaluate(({ source, targetNames }) => {
    const install = new Function(`return (${source})`)();
    const handle = install(window, targetNames);
    (window as any).__reclass610StageTiming = handle;
    return handle.missing;
  }, { source: installReclassStageTiming.toString(), targetNames: names });
  return missing as string[];
}

async function installOpenStageTiming(page: Page) {
  const names = [
    'openArgosInventoryTransactionModal',
    'getVerifiedCachedArgosItemInquiryGroup',
    'ensureArgosInventoryTransactionModal',
    'buildItemInquiryViewModel',
    'renderArgosReclassInquiryEditor',
    'captureArgosInventoryTransactionDraftBaseline',
    'loadArgosItemInquiryRows',
    'refreshArgosInventoryTransactionLotOptions',
    'refreshArgosInventoryTransactionPriorityOptions',
  ];
  return await page.evaluate(({ source, targetNames }) => {
    const install = new Function(`return (${source})`)();
    const handle = install(window, targetNames, undefined, {
      selector: '.app-drive-card-reclass .app-card-bottom-btn',
      markName: 'reclass-610-open-captured',
      label: 'Open',
    });
    (window as any).__reclass610OpenStageTiming = handle;
    return handle.missing;
  }, { source: installReclassStageTiming.toString(), targetNames: names }) as string[];
}

async function takeOpenStageTiming(page: Page) {
  return await page.evaluate(() => {
    const root = window as any;
    const handle = root.__reclass610OpenStageTiming;
    if (!handle) return null;
    const result = { missing: handle.missing, ...handle.getSnapshot() };
    handle.restore();
    delete root.__reclass610OpenStageTiming;
    return result;
  }).catch((error) => ({ captureError: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
}

async function installReclassDisclosureDiagnostics(page: Page, uid: string) {
  await page.evaluate((targetUid) => {
    const root = window as any;
    const host = document.getElementById('argos-reclass-item-inquiry');
    let card = host?.querySelector(`[data-reclass-row-card="${CSS.escape(targetUid)}"]`) || null;
    const events: Array<Record<string, unknown>> = [];
    const cardIds = new WeakMap<Element, number>();
    let nextCardId = 1;
    const cardId = (element: Element | null) => {
      if (!element) return null;
      let id = cardIds.get(element);
      if (!id) { id = nextCardId++; cardIds.set(element, id); }
      return id;
    };
    const rowFor = (element: Element | null) => {
      const row = element?.closest('[data-reclass-row-card]') || null;
      return row?.getAttribute('data-reclass-row-card') === targetUid ? row : null;
    };
    const push = (entry: Record<string, unknown>) => {
      if (events.length >= 40) return;
      events.push({ at: performance.now(), ...entry });
    };
    const state = (row: Element | null) => row ? { cardId: cardId(row), expanded: row.getAttribute('data-reclass-row-expanded'),
      ariaExpanded: row.querySelector('.argos-reclass-row-toggle')?.getAttribute('aria-expanded') || '',
      hydrated: row.querySelector('[data-reclass-row-hydrated="true"]') != null } : null;
    const record = (type: string, target: Element | null, attribute = '', event?: Event) => {
      const row = rowFor(target);
      if (!row) return;
      push({ type, attribute, ...state(row), action: target?.getAttribute('data-reclass-v3-action') || '',
        targetClass: typeof target?.className === 'string' ? target.className.slice(0, 100) : '',
        isTrusted: event?.isTrusted, clickDetail: (event as MouseEvent | undefined)?.detail });
    };
    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      record('click', target, '', event);
    };
    const cardObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) record('attribute', mutation.target instanceof Element ? mutation.target : null, mutation.attributeName || '');
    });
    const observeCard = (next: Element | null) => {
      cardObserver.disconnect();
      card = next;
      if (card) cardObserver.observe(card, { subtree: true, attributes: true, attributeFilter: ['data-reclass-row-expanded', 'aria-expanded'] });
    };
    observeCard(card);
    const hostObserver = new MutationObserver(() => {
      const next = host?.querySelector(`[data-reclass-row-card="${CSS.escape(targetUid)}"]`) || null;
      if (next === card) return;
      const previous = card;
      push({ type: 'card-replaced', previousCardId: cardId(previous), nextCardId: cardId(next),
        previous: state(previous), next: state(next) });
      observeCard(next);
    });
    if (host) hostObserver.observe(host, { subtree: true, childList: true });
    const originalRenderer = root.renderArgosReclassInquiryEditor;
    const wrappedRenderer = typeof originalRenderer === 'function' ? function (this: unknown, ...args: unknown[]) {
      const before = host?.querySelector(`[data-reclass-row-card="${CSS.escape(targetUid)}"]`) || null;
      const stack = String(new Error().stack || '').split('\n').slice(1, 5).map((line) => line.trim());
      const result = Reflect.apply(originalRenderer, this, args);
      push({ type: 'render-call', previousCardId: cardId(before), caller: stack });
      return result;
    } : null;
    if (wrappedRenderer) root.renderArgosReclassInquiryEditor = wrappedRenderer;
    document.addEventListener('click', onClick, true);
    root.__reclassDisclosureDiagnostics = {
      getSnapshot: () => ({ events: events.slice(), finalCardId: cardId(card), ...state(card) }),
      restore: () => { cardObserver.disconnect(); hostObserver.disconnect(); document.removeEventListener('click', onClick, true);
        if (wrappedRenderer && root.renderArgosReclassInquiryEditor === wrappedRenderer) root.renderArgosReclassInquiryEditor = originalRenderer;
        return true; },
    };
  }, uid);
}

async function takeReclassDisclosureDiagnostics(page: Page) {
  return await page.evaluate(() => {
    const root = window as any;
    const handle = root.__reclassDisclosureDiagnostics;
    if (!handle) return null;
    const snapshot = handle.getSnapshot();
    handle.restore();
    delete root.__reclassDisclosureDiagnostics;
    return snapshot;
  }).catch((error) => ({ captureError: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
}

async function populate(page: Page, action: 'move_up' | 'move_down' = 'move_up') {
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  const label = action === 'move_up' ? 'Move Up' : 'Move Down';
  await row.locator(`[data-reclass-v3-action="${action}"]`).click();
  const move = row.locator(`[data-reclass-move-action="${action}"]`);
  await move.getByLabel(`${label} quantity 1`, { exact: true }).fill('15');
  await move.getByLabel(`${label} destination 1`, { exact: true }).selectOption('X');
  for (const [index, season] of [[2, 'S1'], [3, 'U1']] as const) {
    await move.getByRole('button', { name: 'Add destination', exact: true }).click();
    await move.getByLabel(`${label} quantity ${index}`, { exact: true }).fill('5');
    await move.getByLabel(`${label} destination ${index}`, { exact: true }).selectOption(season);
  }
  return { row, move };
}

async function openTargetedReclassFromMountedDriveCard(page: Page) {
  await page.locator('#drive-content .app-drive-card-reclass .app-card-bottom-btn').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible({ timeout: 30_000 });
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await expect(row).toBeVisible();
  if (await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') {
    await row.locator('.argos-reclass-row-toggle').click();
  }
  await expect(row.locator('[data-reclass-row-hydrated="true"]')).toBeVisible();
  return row;
}

async function installReclassEventToPaintProbe(page: Page) {
  await page.evaluate(() => {
    const root = window as any;
    const probe: any = { starts: {}, paints: {}, pending: {} };
    const modal = () => document.getElementById('argos-inventory-transaction-modal');
    const visible = (element: Element | null) => !!element && !!(element as HTMLElement).getClientRects().length
      && (element as HTMLElement).getAttribute('aria-hidden') !== 'true';
    const mark = (stage: string) => {
      if (probe.starts[stage] == null || probe.paints[stage] != null || probe.pending[stage]) return;
      const ready = stage === 'open' ? visible(modal())
        : stage === 'details' ? visible(modal()?.querySelector('[data-reclass-row-hydrated="true"]') || null)
        : stage === 'expand' ? probe.expandRow?.getAttribute('aria-expanded') === 'true'
        : stage === 'submit-pending' ? !!document.getElementById('argos-inventory-transaction-apply')?.hasAttribute('disabled')
        : stage === 'submit-feedback' ? (!!document.getElementById('argos-inventory-transaction-apply')?.hasAttribute('disabled') || !visible(modal()))
        : stage === 'submit-closed' ? !visible(modal()) : false;
      if (!ready) return;
      probe.pending[stage] = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const stillReady = stage === 'open' ? visible(modal())
          : stage === 'details' ? visible(modal()?.querySelector('[data-reclass-row-hydrated="true"]') || null)
          : stage === 'expand' ? probe.expandRow?.getAttribute('aria-expanded') === 'true'
          : stage === 'submit-pending' ? !!document.getElementById('argos-inventory-transaction-apply')?.hasAttribute('disabled')
          : stage === 'submit-feedback' ? (!!document.getElementById('argos-inventory-transaction-apply')?.hasAttribute('disabled') || !visible(modal()))
          : stage === 'submit-closed' ? !visible(modal()) : false;
        if (stillReady) probe.paints[stage] = performance.now() - probe.starts[stage];
        probe.pending[stage] = false;
      }));
    };
    const begin = (stage: string) => {
      delete probe.paints[stage]; delete probe.pending[stage];
      probe.starts[stage] = performance.now();
      if (stage === 'open') {
        delete probe.paints.details; delete probe.pending.details;
        // If the modal supplies its expanded/hydrated row immediately, detail
        // readiness is part of this open action. A later real row-toggle event
        // resets the origin below when hydration is lazy until expansion.
        probe.starts.details = probe.starts.open;
      }
      if (stage === 'submit') {
        delete probe.paints['submit-pending']; delete probe.pending['submit-pending'];
        delete probe.paints['submit-feedback']; delete probe.pending['submit-feedback'];
        delete probe.paints['submit-closed']; delete probe.pending['submit-closed'];
        probe.starts['submit-pending'] = probe.starts.submit;
        probe.starts['submit-feedback'] = probe.starts.submit;
        probe.starts['submit-closed'] = probe.starts.submit;
      }
      mark(stage);
      if (stage === 'open') mark('details');
    };
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const stage = target.closest('#drive-content .app-drive-card-reclass .app-card-bottom-btn') ? 'open'
        : target.closest('#argos-inventory-transaction-modal .argos-reclass-row-toggle') ? 'expand'
        : target.closest('#argos-inventory-transaction-apply') ? 'submit' : '';
      if (!stage) return;
      if (stage === 'expand') {
        // aria-expanded belongs to the toggle button, not the surrounding row.
        // Start both measurements on this trusted user action: one ends when
        // the expansion state paints, the other when its hydrated detail paints.
        probe.expandRow = target.closest('.argos-reclass-row-toggle');
        begin('details');
      }
      begin(stage);
    }, true);
    const observer = new MutationObserver(() => {
      mark('open'); mark('details'); mark('expand'); mark('submit-pending'); mark('submit-feedback'); mark('submit-closed');
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'disabled', 'data-reclass-row-hydrated'] });
    root.__v239ReclassEventToPaintProbe = {
      begin,
      snapshot: () => ({ starts: { ...probe.starts }, paints: { ...probe.paints } }),
      dispose: () => observer.disconnect(),
    };
  });
}

async function readReclassEventToPaintProbe(page: Page) {
  return page.evaluate(() => {
    const root = window as any;
    const probe = root.__v239ReclassEventToPaintProbe;
    return probe?.snapshot?.() || null;
  });
}

async function disposeReclassEventToPaintProbe(page: Page) {
  await page.evaluate(() => {
    const root = window as any;
    root.__v239ReclassEventToPaintProbe?.dispose?.();
    delete root.__v239ReclassEventToPaintProbe;
  });
}

async function expectGlobalMasterIsNotFull(page: Page) {
  const proof = await page.evaluate(() => window.eval(`(() => {
    const state = getDatasetState('master');
    return { fullLoaded: state.fullLoaded === true, rowCompleteness: String(state.rowCompleteness || ''),
      fieldCoverage: String(state.fieldCoverage || ''), revision: String(state.liveVerifiedRevision || '') };
  })()`));
  expect(proof.fullLoaded, 'this regression must not be hidden by a global full-master proof').toBe(false);
  expect(proof.fieldCoverage).not.toBe('full');
  return proof;
}

test('closing a pending inquiry and reopening preserves the new inquiry draft when stale work completes', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name, { season: 'F1', salesYear: '27' }, 1, 100);
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
  await f.open();
  let row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="hold"]').click();
  await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('first pending inquiry');
  let finish!: (result: unknown) => void;
  f.setCreateReply(() => new Promise(resolve => { finish = resolve; }));
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect.poll(() => f.calls.length).toBe(1);
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeDisabled();
  await page.locator('#argos-inventory-transaction-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await f.open(); const { move } = await populate(page, 'move_down');
  row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="hold"]').click();
  await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('new inquiry draft');
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeEnabled();
  const firstSource = f.control.master.find((candidate: any) => candidate.unique_id === 'drive-layout-synthetic-1-no-photo');
  if (!firstSource) throw new Error('The first confirmed Hold receipt requires the source row.');
  f.control.datasetRevision = 500;
  finish(confirmedHoldReceipt(firstSource, 'first pending inquiry', 500, '2026-10-16T12:00:00Z', 'first-inquiry'));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gnc_reclass_delivery_jobs_v1') || '[]').length)).toBe(1);
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
  await expect(move.getByLabel('Move Down quantity 1', { exact: true })).toHaveValue('15');
  await expect(row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('new inquiry draft');
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeEnabled();
  const refreshResult = await page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().check("stale-inquiry-receipt-settle")'));
  expect(refreshResult, 'the new move must use a fresh permission-scoped inventory read after the prior Hold receipt').toBe(true);
  await expect.poll(() => page.evaluate(() => window.eval(`(() => {
    const context = getProductionLiveSyncContext();
    const state = getDatasetState('master');
    return !!state.liveVerifiedRevision && state.liveVerifiedScope === context.scope
      && state.liveVerifiedPermission === context.dataPermissionVersion
      && isConfirmedInventoryReadRevisionCurrent(state.liveVerifiedRevision)
      && productionLiveSyncVerifiedView === productionVerifiedViewKey(context);
  })()`))).toBe(true);
  await expect(row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('new inquiry draft');
  expect(await page.evaluate(() => window.eval(`(() => {
    const source = findItemByUniqueId('drive-layout-synthetic-1-no-photo');
    return source?.HOLDSTOPREASON ?? source?.holdstopreason;
  })()`)))
    .toBe('first pending inquiry');
  f.setCreateReply(() => {
    const row = f.control.master.find((candidate: any) => candidate.unique_id === 'drive-layout-synthetic-1-no-photo');
    if (!row) throw new Error('The confirmed Hold reply requires the current source row.');
    const lastUpdated = '2026-10-16T12:01:00Z';
    Object.assign(row, { holdstopcode: 'H', holdstopreason: 'new inquiry draft',
      av_rule_last_clear_reason: 'hold_requested', av_rule_last_cleared_at: lastUpdated, last_updated: lastUpdated });
    const evidence = Object.fromEntries(DRIVE_EVIDENCE_KEYS.map(key => [key, key === 'last_updated' ? lastUpdated : row[key] ?? null]));
    f.control.datasetRevision = Math.max(900, Number(f.control.datasetRevision || 0) + 1);
    return { ok: true, status: 'queued', jobId: 'second-inquiry', queuedAt: lastUpdated,
      workflowPolicyVersion: 'reclass-action-workflow-v7-editable-fields-20261009',
      inventoryFields: [], inventoryRevision: String(f.control.datasetRevision),
      liveEdits: [{ unique_id: row.unique_id, priority: row.priority ?? null, holdstopcode: 'H', holdstopreason: 'new inquiry draft',
        av_rule_last_clear_reason: 'hold_requested', av_rule_last_cleared_at: lastUpdated, last_updated: lastUpdated, evidence }] };
  });
  await installReclassSubmitDiagnostics(page);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expectReclassModalHiddenWithDiagnostics(page, f, moveRequests);
  expect(f.calls).toHaveLength(2);
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests.map(request => request.moves[0].lines[0].direction)).toEqual(['move_down']);
  expect(f.calls[0].idempotencyToken).not.toBe(f.calls[1].idempotencyToken);
  expect(f.calls[0].transaction.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'first pending inquiry' })]);
  expect(f.calls[1].transaction.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'new inquiry draft' })]);
  expect(f.control.blockedMutations).toEqual([]);
});

async function populatePriorityAndHold(page: Page) {
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="priority_change"]').click();
  await row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]').fill('1');
  await row.locator('[data-reclass-v3-action="hold"]').click();
  await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Quality Review');
  return row;
}

function confirmedLiveEditResponse(priority = '1') {
  return {
    ok: true, status: 'queued', jobId: 'synthetic-reclass-live', queuedAt: '2026-10-09T12:01:00Z',
    workflowPolicyVersion: 'reclass-action-workflow-v7-editable-fields-20261009',
    inventoryFields: [],
    inventoryRevision: '501',
    liveEdits: [{ unique_id: 'drive-layout-synthetic-1-no-photo', priority, holdstopcode: 'H', holdstopreason: 'quality review',
      av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z',
      evidence: confirmedEvidence('drive-layout-synthetic-1-no-photo', '2026-10-09T12:01:00Z') }],
  };
}

function confirmedPriorityResponse(priority = '1') {
  return {
    ok: true, status: 'queued', jobId: 'synthetic-reclass-live', queuedAt: '2026-10-09T12:01:00Z',
    workflowPolicyVersion: 'reclass-action-workflow-v7-editable-fields-20261009',
    inventoryFields: [],
    inventoryRevision: '502',
    liveEdits: [{ unique_id: 'drive-layout-synthetic-1-no-photo', priority, holdstopcode: null, holdstopreason: null,
      av_rule_last_clear_reason: 'priority_changed', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z',
      evidence: { ...confirmedEvidence('drive-layout-synthetic-1-no-photo', '2026-10-09T12:01:00Z'), av_rule_last_clear_reason: 'priority_changed' } }],
  };
}

test('Move Down commits live inventory and a failed inquiry retains the separate Hold request', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
  const { row, move } = await populate(page, 'move_down');
  await expect(row.locator('[data-reclass-v3-action="hold"]')).toBeVisible();
  await expect(row.locator('[data-reclass-v3-action="take_off_hold"]')).toBeVisible();
  await expect(move.getByRole('checkbox')).toHaveCount(0);
  await expect(move.locator('[data-reclass-move-balance]')).toContainText('Remaining: 0');
  await page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"] [data-reclass-v3-action="hold"]').click();
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Hold/Stop Reason');
  expect(f.calls).toHaveLength(0);
  await page.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Quality Review');
  f.setCreateReply(() => {
    const source = f.control.master.find((item: any) => item.unique_id === 'drive-layout-synthetic-1-no-photo');
    if (!source) throw new Error('The confirmed Hold reply requires the current source row.');
    const lastUpdated = '2026-10-16T12:01:00Z';
    Object.assign(source, { priority: '2', PRIORITY: '2' });
    const revision = Math.max(602, 600 + moveRequests.length + 1);
    f.control.datasetRevision = revision;
    return confirmedHoldReceipt(source, 'quality review', revision, lastUpdated, 'move-down-hold');
  });
  f.failNext(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Inventory moves were saved. Your remaining inquiry draft is still open; retry to send only those remaining actions.');
  await expect(page.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('quality review');
  expect(f.calls).toHaveLength(1, 'the inquiry request fails after the independent stock move has committed');
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests[0].moves[0].lines).toEqual([
    { direction: 'move_down', destinationSeason: 'X', quantity: 15 },
    { direction: 'move_down', destinationSeason: 'S1', quantity: 5 },
    { direction: 'move_down', destinationSeason: 'U1', quantity: 5 },
  ]);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].idempotencyToken).toBe(f.calls[0].idempotencyToken);
  expect(f.calls[1].workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
  expect(f.calls[1].transaction.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' })]);
  expect(f.calls[0].rowOverlays.flatMap((overlay: any) => overlay.proposals)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'move_down' }),
  ]));
  expect(f.calls[1].rowOverlays.flatMap((overlay: any) => overlay.proposals)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'move_down' }),
  ]));
  expect(moveRequests).toHaveLength(1, 'retrying the separate Hold inquiry must not replay stock');
  expect(await page.evaluate(() => window.eval(`({oh:Number(fullInventory[0].PTRONHAND),season:fullInventory[0].SEASON,hold:fullInventory[0].HOLDSTOPCODE})`)))
    .toEqual({ oh: 0, season: 'F1', hold: 'H' });
  expect(f.control.blockedMutations).toEqual([]);
});

test('V6 confirms priority and Hold locally only after the server returns the live edit, then queues the inquiry', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  await populatePriorityAndHold(page);
  f.setCreateReply(() => {
    Object.assign(f.control.master[0], { priority: '1', holdstopcode: 'H', holdstopreason: 'quality review',
      av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z' });
    f.control.datasetRevision = 501;
    return confirmedLiveEditResponse();
  });
  await restoreDriveLayoutRenderer(page);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.locator('#toast-notification')).toContainText('Live edits are confirmed');
  expect(f.calls).toHaveLength(1);
  const sent = f.calls[0];
  expect(sent.workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
  expect(sent.transaction.requestActions).toEqual(expect.arrayContaining(['priority_change', 'hold']));
  expect(sent.transaction.holdStopProposals).toEqual([{ action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' }]);
  expect(sent.rowOverlays[0].expected).toMatchObject({ priority: '2', holdstopcode: '', holdstopreason: '' });
  expect(sent.rowOverlays[0].proposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'priority_change', priority: '1' }),
  ]));
  const state = await page.evaluate(() => window.eval(`(() => {
    const uid = 'drive-layout-synthetic-1-no-photo';
    const master = fullInventory.find(row => String(row.UNIQUE_ID || row.unique_id) === uid);
    const av = avOpenInventory.find(row => String(row.UNIQUE_ID || row.unique_id) === uid);
    return { master: [master?.PRIORITY, master?.HOLDSTOPCODE, master?.HOLDSTOPREASON],
      av: [av?.PRIORITY, av?.HOLDSTOPCODE, av?.HOLDSTOPREASON],
      evidence: [master?.PHOTO_LINK, master?.SAVED_PHOTO_LINK, master?.SPEC, master?.CALIPER, master?.MATCH, master?.AV_NOTE, master?.PIC_NOTE, master?.SALES_NOTE] };
  })()`));
  expect(state.master).toEqual(['1', 'H', 'quality review']);
  expect(state.av).toEqual(['1', 'H', 'quality review']);
  expect(state.evidence).toEqual(['', '', null, null, null, null, null, null]);
  await page.locator('#drive-content [aria-label="Open Synthetic Drive Card"]').click();
  await page.locator('#drive-content [aria-label="Open #3"]').click();
  await page.locator('#drive-content [aria-label="Open season F1"]').click();
  await expect(page.locator('#drive-content .app-drive-compact-card')).toContainText('quality review');
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('gnc_reclass_delivery_jobs_v1') || '[]'));
  expect(queued).toHaveLength(1);
  expect(queued[0].payload.workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
  expect(f.control.blockedMutations).toEqual([]);
});

for (const scope of [{ season: 'S1', salesYear: '27' }, { season: 'F1', salesYear: '28' }]) {
  test(`future row ${scope.salesYear}.${scope.season} can submit a selected-row Hold inquiry`, { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
    const f = await fixture(page, baseURL!, info.project.name, scope);
    const row = await f.open();
    await expect(row.locator('[data-reclass-v3-action="hold"]')).toBeEnabled();
    await expect(row.locator('[data-reclass-v3-action="stop_ship"]')).toBeEnabled();
    await row.locator('[data-reclass-v3-action="hold"]').click();
    await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Quality Review');
    f.setCreateReply(() => {
      const reply = confirmedLiveEditResponse('2');
      Object.assign(f.control.master[0], {holdstopcode:'H',holdstopreason:'quality review',last_updated:reply.liveEdits[0].last_updated});
      f.control.datasetRevision = 501;
      Object.assign(reply.liveEdits[0].evidence, { lotcode: `${scope.salesYear}.${scope.season}` });
      return reply;
    });
    await page.locator('#argos-inventory-transaction-apply').click();
    await expectReclassModalHiddenWithDiagnostics(page, f, moveRequests);
    await expect(page.locator('#toast-notification')).toContainText('Live edits are confirmed');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
    expect(f.calls[0].transaction.holdStopProposals).toEqual([
      { action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' },
    ]);
    expect(f.calls[0].rowOverlays).toHaveLength(1);
    expect(f.calls[0].rowOverlays[0].expected).toMatchObject({ priority: '2', holdstopcode: '', holdstopreason: '' });
    expect(await page.evaluate(() => window.eval(`(() => ({
      quantity: Number(fullInventory[0].PTRONHAND), season: fullInventory[0].SEASON, year: fullInventory[0].SALEYEAR,
      hold: fullInventory[0].HOLDSTOPCODE, reason: fullInventory[0].HOLDSTOPREASON
    }))()`))).toEqual({ quantity: 25, season: scope.season, year: scope.salesYear, hold: 'H', reason: 'quality review' });
    expect(f.control.blockedMutations).toEqual([]);
  });
}

test('rejected and stale V6 replies do not overwrite local inventory or discard the inquiry draft', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const row = await populatePriorityAndHold(page);
  f.failNext(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
  await expect(row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]')).toHaveValue('1');
  await expect(row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('quality review');
  const beforeStale = await page.evaluate(() => window.eval(`(() => ({ priority: String(fullInventory[0].PRIORITY || ''), hold: String(fullInventory[0].HOLDSTOPCODE || ''), reason: String(fullInventory[0].HOLDSTOPREASON || '') }))()`));

  await page.evaluate(() => window.eval(`getDatasetState('master').liveVerifiedRevision = '900'`));
  f.setCreateReply(() => confirmedLiveEditResponse());
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.locator('#toast-notification')).toContainText('Your inquiry was accepted. The latest inventory status is being refreshed automatically.');
  const afterStale = await page.evaluate(() => window.eval(`(() => ({ priority: String(fullInventory[0].PRIORITY || ''), hold: String(fullInventory[0].HOLDSTOPCODE || ''), reason: String(fullInventory[0].HOLDSTOPREASON || '') }))()`));
  expect(afterStale).toEqual(beforeStale);
  expect(f.calls).toHaveLength(2);
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('gnc_reclass_delivery_jobs_v1') || '[]'));
  expect(queued).toHaveLength(1);
  expect(queued[0].payload.rowOverlays[0].proposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'priority_change', priority: '1' }),
  ]));
  expect(queued[0].payload.transaction.holdStopProposals).toEqual([{ action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' }]);
  expect(f.control.blockedMutations).toEqual([]);
});

test('Move Up and Hold remain selected together with a row reason and stamped date', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name);
  const row = await f.open();
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  await row.getByLabel('Move Up quantity 1', { exact: true }).fill('5');
  await row.getByLabel('Move Up destination 1', { exact: true }).selectOption('X');
  await expect(row.locator('[data-reclass-v3-action="hold"]')).toBeEnabled();
  await row.locator('[data-reclass-v3-action="hold"]').click();
  await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Concurrent quality review');
  await expect(row.locator('[data-reclass-hold-begin-date]')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await expect(row.locator('[data-reclass-v3-action="move_up"]')).toHaveAttribute('aria-pressed', 'true');
  const draft = await page.evaluate(() => window.eval('collectArgosReclassV3Draft()'));
  expect(draft.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'concurrent quality review' })]);
  expect(draft.requestActions).toEqual(expect.arrayContaining(['hold', 'move_up']));
  expect(draft.rowOverlays[0].proposals).toEqual([expect.objectContaining({ action: 'move_up' })]);
  expect(f.control.blockedMutations).toEqual([]);
});

test('Move Up commits live stock before Priority inquiry and does not queue the move as an inquiry', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="priority_change"]').click();
  await row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]').fill('1');
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('5');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('X');
  const moveRequests: Record<string, any>[] = [];
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    moveRequests.push(structuredClone(body));
    const source = { ...f.control.master[0], ptronhand: '20', ptravailable: '20', last_updated: '2026-10-15T12:00:00Z' };
    const target = { ...f.control.master[0], unique_id: 'server-target-x', lotcode: '27.X', season: 'X', ptronhand: '5', ptravailable: '5', last_updated: '2026-10-15T12:00:00Z' };
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL!).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: true, data: { ok: true, commandId: body.commandId, requestId: 'five-unit-move', revision: 11,
        rows: [{ table: 'ph_master_inventory', row: source }, { table: 'ph_master_inventory', row: target }],
        movements: [{ direction: 'move_up', destinationSeason: 'X', quantity: 5, sourceUniqueId: body.moves[0].source.uniqueId, destinationUniqueId: 'server-target-x' }],
        status: 'applied', importStatus: 'pending' } }) });
  });
  f.setCreateReply(() => confirmedPriorityResponse());
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(1);
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests[0].moves[0].lines).toEqual([{ direction: 'move_up', destinationSeason: 'X', quantity: 5 }]);
  expect(f.calls[0].transaction.requestActions).toEqual(['priority_change']);
  expect(f.calls[0].transaction.holdStopProposals).toEqual([]);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'priority_change', priority: '1' }),
  ]));
  expect(f.control.blockedMutations).toEqual([]);
});

test('610-unit live move stays responsive, replays the exact command after timeout, and queues only the remaining draft once', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  // This representative fixture verifies Drive browse and full 10k-row reads;
  // iPhone also performs two authenticated shell boots. Keep interaction gates
  // below strict; allow setup to finish so they can report independently.
  test.setTimeout(180_000);
  if (process.env.GNC_RECLASS_PAINT_WORK === '1') await page.addInitScript(() => {
    const root = window as any;
    const events: Array<Record<string, unknown>> = [];
    let startedAt: number | null = null;
    document.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('.app-drive-card-reclass .app-card-bottom-btn')) {
        startedAt = performance.now();
        events.length = 0;
      }
    }, true);
    const observe = (kind: string, callback: (...args: any[]) => any) => function(this: unknown, ...args: any[]) {
      const begin = performance.now();
      try { return Reflect.apply(callback, this, args); }
      finally {
        const duration = performance.now() - begin;
        if (startedAt !== null && duration >= 2 && events.length < 40) events.push({ kind, sinceCaptureMs: begin - startedAt,
          durationMs: duration, callback: Function.prototype.toString.call(callback).slice(0, 200) });
      }
    };
    const originalFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => originalFrame.call(window, observe('animation-frame', callback));
    const originalTimeout = window.setTimeout;
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) => originalTimeout.call(window,
      typeof callback === 'function' ? observe('timeout', callback as (...args: any[]) => any) : callback, delay, ...args)) as typeof setTimeout;
    const OriginalObserver = window.MutationObserver;
    window.MutationObserver = class extends OriginalObserver {
      constructor(callback: MutationCallback) { super(observe('mutation-observer', callback)); }
    };
    root.__reclassPaintWork = { events };
  });
  if (info.project.name === 'cache-iphone') {
    // Measure the same native-click/two-frame observer on a tiny page before
    // loading the application. This diagnoses simulator pacing; it never
    // changes the application threshold or subtracts time from its result.
    await page.setContent('<button id="paint-baseline-open">Open baseline</button><section id="paint-baseline-card" hidden>610 units</section>');
    await page.evaluate(() => {
      const root = window as any;
      root.__paintBaseline = [];
      document.getElementById('paint-baseline-open')!.onclick = () => {
        const started = performance.now();
        document.getElementById('paint-baseline-card')!.hidden = false;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          root.__paintBaseline.push(performance.now() - started);
          document.getElementById('paint-baseline-card')!.hidden = true;
        }));
      };
    });
    for (let sample = 0; sample < 3; sample++) {
      await page.locator('#paint-baseline-open').click();
      await page.waitForFunction(count => (window as any).__paintBaseline.length === count, sample + 1);
    }
    await info.attach('reclass-iphone-minimal-paint-baseline.json', { contentType: 'application/json',
      body: JSON.stringify({ nativeClickTwoFrameMs: await page.evaluate(() => (window as any).__paintBaseline), trace: info.project.use.trace }) });
  }
  const f = await fixture(page, baseURL!, info.project.name, { season: 'F1', salesYear: '27' }, 10_000, 1000);
  const mobileEditor = await page.evaluate(() => matchMedia('(max-width: 640px)').matches);
  const missingOpenTimingTargets = await installOpenStageTiming(page);
  await installPaintTimingProbe(page, { phase: 'open', uid: 'drive-layout-synthetic-1-no-photo', sourceQuantity: 1000, requireHydrated: !mobileEditor });
  let row: Awaited<ReturnType<typeof f.open>>;
  let cachedInquiryOpen: Awaited<ReturnType<typeof readPaintTimingProbe>>;
  let openStageTiming: unknown;
  try {
    row = await f.open(false);
    cachedInquiryOpen = await readPaintTimingProbe(page);
  } finally {
    openStageTiming = await takeOpenStageTiming(page);
    await info.attach('reclass-610-open-stage-timing.json', { contentType: 'application/json', body: JSON.stringify({
      datasetRows: 10_000,
      warmCache: true,
      missingOpenTimingTargets,
      paintProbe: await page.evaluate(() => (window as any).__reclassPaintTimingProbe?.result || null).catch(() => null),
      callbackWork: await page.evaluate(() => (window as any).__reclassPaintWork?.events || null).catch(() => null),
      timing: openStageTiming,
    }, null, 2) });
  }
  await info.attach('reclass-610-open-paint-metrics.json', { contentType: 'application/json', body: JSON.stringify({
    datasetRows: 10_000, warmCache: true, cachedInquiryOpenMs: cachedInquiryOpen.elapsedMs,
  }, null, 2) });
  // Retain the gate at the end so a slow first paint still produces the full
  // retry, quantity-conservation, and subsequent-interaction diagnostics.
  expect(await page.locator('#toast-notification').innerText()).not.toContain('Loading Item Inquiry');
  let cdpTimeline: Awaited<ReturnType<typeof startReclassCdpTimeline>> = null;
  let cdpTimelineAttached = false;
  const attachCdpTimeline = async () => {
    if (!cdpTimeline || cdpTimelineAttached) return;
    cdpTimelineAttached = true;
    const capture = await cdpTimeline.stop();
    cdpTimeline = null;
    if (capture.rawTrace) await info.attach('reclass-610-chromium-timeline.json', { contentType: 'application/json', body: capture.rawTrace });
    await info.attach('reclass-610-chromium-timeline-summary.json', { contentType: 'application/json', body: JSON.stringify({
      enabledBy: 'GNC_RECLASS_TIMELINE=1', startError: capture.startError, stopError: capture.stopError, summary: capture.summary,
    }, null, 2) });
  };
  try {
  await installReclassDisclosureDiagnostics(page, 'drive-layout-synthetic-1-no-photo');
  let hydratedEditorOpen = cachedInquiryOpen;
  if (mobileEditor) {
    expect(await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded')).toBe('false');
    await installPaintTimingProbe(page, { phase: 'expand', uid: 'drive-layout-synthetic-1-no-photo' });
    await row.locator('.argos-reclass-row-toggle').click();
    hydratedEditorOpen = await readPaintTimingProbe(page);
  } else {
    // Desktop intentionally renders the editor expanded and hydrated, and CSS
    // disables its disclosure button. The open-click probe includes hydration.
    expect(await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(await row.locator('[data-reclass-row-hydrated="true"]')).toHaveCount(1);
  }
  await row.locator('[data-reclass-v3-action="priority_change"]').click();
  await row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]').fill('1');
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('610');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('U1');

  const moveRequests: Array<{ body: Record<string, any>; idempotencyKey?: string }> = [];
  const statusRequests: Record<string, any>[] = [];
  const consoleFailures: string[] = [];
  const pageFailures: string[] = [];
  const apiResponses: Record<string, any>[] = [];
  const apiResponseReads: Promise<void>[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleFailures.push(message.text()); });
  page.on('pageerror', error => pageFailures.push(error.stack || error.message));
  page.on('response', response => {
    if (!response.url().includes('/functions/v1/app-api')) return;
    const request = response.request();
    let action = '', operation = '';
    try {
      const requestBody = request.postDataJSON();
      action = String(requestBody.action || '');
      operation = String(requestBody.operation || '');
    } catch {}
    const status = response.status();
    const contentLength = Number(response.headers()['content-length'] || 0);
    if (action !== 'inventory_reclass_move' && status < 400) {
      apiResponses.push({ status, action, operation, bodyCaptured: false, contentLength });
      return;
    }
    const read = response.text().then(body => apiResponses.push({ status, action, operation, body })).catch(error => {
      apiResponses.push({ status, action, operation, bodyError: String(error) });
    });
    apiResponseReads.push(read);
  });
  let firstRequestStarted!: () => void;
  let releaseFirstRequest!: () => void;
  const firstStarted = new Promise<void>(resolve => { firstRequestStarted = resolve; });
  const firstGate = new Promise<void>(resolve => { releaseFirstRequest = resolve; });
  let receipt: Record<string, any> | null = null;
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    const reply = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL!).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    if (body.operation === 'status') {
      statusRequests.push(structuredClone(body));
      return reply(200, { ok: true, data: { ok: true, status: 'missing' } });
    }
    moveRequests.push({ body: structuredClone(body), idempotencyKey: route.request().headers()['idempotency-key'] });
    if (moveRequests.length === 1) {
      firstRequestStarted();
      await firstGate;
      return reply(503, { ok: false, code: 'INVENTORY_RECLASS_UNAVAILABLE', message: 'Synthetic lost response.' });
    }
    const sourceUid = body.moves[0].source.uniqueId;
    const sourceBefore = f.control.master.find((item: any) => item.unique_id === sourceUid);
    const sourceAfter = { ...sourceBefore, ptronhand: '390', ptravailable: '390', PTRONHAND: '390', PTRAVAILABLE: '390',
      last_updated: '2026-10-15T12:00:00Z' };
    const targetAfter = { ...sourceBefore, unique_id: 'server-target-u1', UNIQUE_ID: 'server-target-u1', lotcode: '27.U1', LOTCODE: '27.U1', season: 'U1', SEASON: 'U1',
      ptronhand: '610', ptravailable: '610', PTRONHAND: '610', PTRAVAILABLE: '610', last_updated: '2026-10-15T12:00:00Z' };
    f.control.master = f.control.master.filter((item: any) => item.unique_id !== sourceUid).concat(sourceAfter, targetAfter);
    f.control.datasetRevision = 610;
    receipt = { ok: true, commandId: body.commandId, requestId: '610-move-request', revision: 610,
      rows: [{ table: 'ph_master_inventory', row: sourceAfter }, { table: 'ph_master_inventory', row: targetAfter }],
      movements: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 610, sourceUniqueId: sourceUid, destinationUniqueId: 'server-target-u1' }],
      status: 'applied', importStatus: 'pending' };
    expect(body.receiptEncoding).toBe('master-null-elision-v1');
    const compactReceipt = compactReclassReceiptFixture({ ...receipt,
      rows: [{ table: 'ph_master_inventory', row: inventoryReadFixture.fromFixtureShape(sourceAfter) },
        { table: 'ph_master_inventory', row: inventoryReadFixture.fromFixtureShape(targetAfter) }] });
    return reply(200, { ok: true, data: compactReceipt });
  });
  f.setCreateReply(() => {
    const response = confirmedPriorityResponse('1');
    // This edit follows the committed move at revision 610. Return a newer
    // inventory revision and timestamp so it is valid after the move fence.
    response.inventoryRevision = '611';
    response.liveEdits[0].last_updated = '2026-10-15T12:01:00Z';
    response.liveEdits[0].av_rule_last_cleared_at = '2026-10-15T12:01:00Z';
    response.liveEdits[0].evidence.last_updated = '2026-10-15T12:01:00Z';
    response.liveEdits[0].evidence.av_rule_last_cleared_at = '2026-10-15T12:01:00Z';
    // Its evidence must also reflect the source's post-move availability.
    response.liveEdits[0].evidence.ptravailable = '390';
    return response;
  });

  const missingTimingTargets = await installApplyStageTiming(page);
  expect(missingTimingTargets).toEqual([]);
  await installPaintTimingProbe(page, { phase: 'optimistic', uid: 'drive-layout-synthetic-1-no-photo', sourceQuantity: 390, targetQuantity: 610 });
  cdpTimeline = await startReclassCdpTimeline(page);
  await page.locator('#argos-inventory-transaction-apply').click();
  await firstStarted;
  const optimisticVisible = await readPaintTimingProbe(page);
  await attachCdpTimeline();
  assertFrontendUiTiming(expect(optimisticVisible.elapsedMs), test.info().project);
  const immediate = await page.evaluate(() => window.eval(`(() => {
    const model = argosInventoryTransactionState.inquiryModel;
    const source = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').includes('drive-layout-synthetic-1-no-photo'));
    const target = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
    const visible = element => !!element && !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    return { source: Number(source && (source.PTRONHAND ?? source.ptronhand)), target: Number(target && (target.PTRONHAND ?? target.ptronhand)),
      waitingOverlay: visible(document.getElementById('loading-spinner')) || visible(document.querySelector('.argos-reclass-move-waiting')) };
  })()`));
  expect(immediate).toEqual({ source: 390, target: 610, waitingOverlay: false });
  releaseFirstRequest();
  await expect(page.locator('#toast-notification')).toContainText('Move Confirmation Pending');
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();

  await page.locator('#argos-inventory-transaction-apply').click();
  try {
    await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden({ timeout: 15_000 });
  } catch (error) {
    await Promise.all(apiResponseReads);
    const appState = await page.evaluate(() => window.eval(`(() => {
      const state = argosInventoryTransactionState;
      const sourceUid = 'drive-layout-synthetic-1-no-photo';
      const rows = state && state.inquiryModel && state.inquiryModel.rows || [];
      const summarize = row => row ? { uid: row.UNIQUE_ID || row.unique_id, lot: row.LOTCODE || row.lotcode,
        season: row.SEASON || row.season, ptronhand: row.PTRONHAND ?? row.ptronhand,
        ptravailable: row.PTRAVAILABLE ?? row.ptravailable } : null;
      let proposalState = null;
      try { proposalState = { moves: [...argosReclassMultiActionState.rowProposals.entries()] }; } catch (_) {}
      const source = rows.find(row => String(row.UNIQUE_ID || row.unique_id || '') === sourceUid);
      const target = rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').includes('target-u1')
        || String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
      const apply = document.getElementById('argos-inventory-transaction-apply');
      const toast = document.getElementById('toast-notification');
      return { modalVisible: !!document.getElementById('argos-inventory-transaction-modal')?.getClientRects().length,
        toast: toast?.innerText || '', applyText: apply?.textContent || '', applyDisabled: !!apply?.disabled,
        pending: state?.pendingReclassMove ? { command: state.pendingReclassMove.command,
          uncertain: state.pendingReclassMove.uncertain, inFlight: state.pendingReclassMove.inFlight } : null,
        rows: { source: summarize(source), target: summarize(target) }, proposalState };
    })()`));
    await info.attach('reclass-610-retry-failure.json', { contentType: 'application/json', body: JSON.stringify({
      appState, moveRequests, statusRequests, apiResponses, inquiryRequests: f.calls,
      consoleFailures, pageFailures
    }, null, 2) });
    throw new Error('The 610-unit move retry did not close the Item Inquiry after replay.', { cause: error });
  }
  expect(statusRequests).toEqual([{ action: 'inventory_reclass_move', operation: 'status', commandId: moveRequests[0].body.commandId,
    receiptEncoding: 'master-null-elision-v1' }]);
  expect(moveRequests).toHaveLength(2);
  expect(moveRequests[1].body).toEqual(moveRequests[0].body);
  expect(moveRequests[1].idempotencyKey).toBe(moveRequests[0].idempotencyKey);
  expect(moveRequests[0].body.moves[0].lines).toEqual([{ direction: 'move_up', destinationSeason: 'U1', quantity: 610 }]);
  expect(receipt?.importStatus).toBe('pending');
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual([expect.objectContaining({ action: 'priority_change', priority: '1' })]);
  expect(f.calls[0].transaction.requestActions).toEqual(['priority_change']);
  expect(await page.evaluate(() => window.eval(`(() => {
    const source = fullInventory.find(row => row.UNIQUE_ID === 'drive-layout-synthetic-1-no-photo');
    const target = fullInventory.find(row => row.UNIQUE_ID === 'server-target-u1');
    return [Number(source.PTRONHAND), Number(source.PTRAVAILABLE), Number(target.PTRONHAND), Number(target.PTRAVAILABLE)];
  })()`))).toEqual([390, 390, 610, 610]);
  const modalPaintLimitMs = reclassModalPaintLimitMs(info.project);
  assertFrontendUiTiming(expect(cachedInquiryOpen.elapsedMs), test.info().project);
  assertFrontendUiTiming(expect(hydratedEditorOpen.elapsedMs), test.info().project);
  assertFrontendUiTiming(expect(optimisticVisible.elapsedMs), test.info().project);
  await info.attach('reclass-610-paint-metrics.json', { contentType: 'application/json', body: JSON.stringify({
    datasetRows: 10_000,
    warmCache: true,
    modalPaintLimitMs,
    cachedInquiryOpenMs: cachedInquiryOpen.elapsedMs,
    hydratedEditorOpenMs: hydratedEditorOpen.elapsedMs,
    optimisticQuantityPaintMs: optimisticVisible.elapsedMs,
  }, null, 2) });
  expect(f.control.blockedMutations).toEqual([]);
  } finally {
    await attachCdpTimeline();
    const disclosureDiagnostics = await takeReclassDisclosureDiagnostics(page);
    await info.attach('reclass-610-disclosure-diagnostics.json', { contentType: 'application/json', body: JSON.stringify(disclosureDiagnostics, null, 2) });
    let timing: unknown;
    try {
      timing = await page.evaluate(() => {
        const root = window as any;
        const handle = root.__reclass610StageTiming;
        if (!handle) return null;
        const result = handle.getSnapshot();
        handle.restore();
        delete root.__reclass610StageTiming;
        return result;
      });
    } catch (error) {
      timing = { captureError: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
    await info.attach('reclass-610-stage-timing.json', { contentType: 'application/json', body: JSON.stringify({
      timing,
      paintProbe: await page.evaluate(() => (window as any).__reclassPaintTimingProbe?.result || null).catch(() => null),
    }, null, 2) });
  }
});

test('definitive live move rejection restores the original worksheet and retains the draft', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  test.setTimeout(180_000);
  const f = await fixture(page, baseURL!, info.project.name, { season: 'F1', salesYear: '27' }, 10_000, 1000);
  const row = await f.open();
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('610');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('U1');
  const requests: Record<string, any>[] = [];
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    requests.push(structuredClone(body));
    return route.fulfill({ status: 409, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL!).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: false, code: 'INVENTORY_RECLASS_SOURCE_CHANGED', message: 'Source changed.' }) });
  });
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Source changed');
  expect(requests).toHaveLength(1);
  const restored = await page.evaluate(() => window.eval(`(() => {
    const model = argosInventoryTransactionState.inquiryModel;
    const source = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').includes('drive-layout-synthetic-1-no-photo'));
    const target = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
    return { source: Number(source && (source.PTRONHAND ?? source.ptronhand)), hasTemporaryTarget: !!target,
      moveDraft: Number(getArgosReclassRowProposalMap('drive-layout-synthetic-1-no-photo', false)?.move_up?.splits?.[0]?.quantity) };
  })()`));
  expect(restored).toEqual({ source: 1000, hasTemporaryTarget: false, moveDraft: 610 });
  expect(f.calls).toHaveLength(0);
  expect(f.control.blockedMutations).toEqual([]);
});

test('both directions share the OH cap and split controls fit mobile widths', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
  const { row, move } = await populate(page);
  await move.getByRole('button', { name: 'Remove Move Up destination 2', exact: true }).click();
  await expect(move.getByLabel('Move Up destination 2', { exact: true })).toHaveValue('U1');
  await row.locator('[data-reclass-v3-action="move_down"]').click();
  const down = row.locator('[data-reclass-move-action="move_down"]');
  await down.getByLabel('Move Down quantity 1', { exact: true }).fill('6');
  await down.getByLabel('Move Down destination 1', { exact: true }).selectOption('Y');
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('cannot exceed original OH');
  expect(f.calls).toHaveLength(0);
  await down.getByLabel('Move Down quantity 1', { exact: true }).fill('5');
  const bounds = await row.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth,
    smallButtons: [...element.querySelectorAll('[data-reclass-move-action] button')].filter(button => button.getBoundingClientRect().height < 44).length }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.smallButtons).toBe(0);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests[0].moves[0].lines).toEqual([
    { direction: 'move_up', destinationSeason: 'X', quantity: 15 },
    { direction: 'move_up', destinationSeason: 'U1', quantity: 5 },
    { direction: 'move_down', destinationSeason: 'Y', quantity: 5 },
  ]);
  expect(f.calls).toHaveLength(0, 'pure movement has no inquiry payload');
  expect(await page.evaluate(() => window.eval(`(() => ({
    source: Number(fullInventory.find(row => row.UNIQUE_ID === 'drive-layout-synthetic-1-no-photo').PTRONHAND),
    targets: ['server-target-x','server-target-u1','server-target-y'].map(uid => Number(fullInventory.find(row => row.UNIQUE_ID === uid)?.PTRONHAND))
  }))()`))).toEqual({ source: 0, targets: [15, 5, 5] });
  expect(f.control.blockedMutations).toEqual([]);
});

test('refresh and Review and Resend restore the separate Hold request without replaying a confirmed Move Down', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
  await populate(page, 'move_down');
  await page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"] [data-reclass-v3-action="hold"]').click();
  await page.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Keep for review');
  f.setCreateReply(() => {
    const receipt = confirmedLiveEditResponse('2');
    receipt.liveEdits[0].holdstopreason = 'keep for review';
    return receipt;
  });
  f.conflict(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Review and Resend', exact: true })).toBeVisible();
  const token = f.calls[0].idempotencyToken;
  await page.reload(); await page.locator('#view-login').waitFor({ state: 'hidden' }); await f.mount();
  await page.getByRole('button', { name: 'Review and Resend', exact: true }).click();
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  if (await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') await row.locator('.argos-reclass-row-toggle').click();
  await expect(row.locator('[data-reclass-v3-action="move_down"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(row.locator('[data-reclass-v3-action="hold"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('keep for review');
  expect(await page.evaluate(() => window.eval('argosInventoryTransactionState.idempotencyToken'))).not.toBe(token);
  f.setCreateReply(() => ({ ok: true, status: 'queued', jobId: 'synthetic-reclass-retry', queuedAt: new Date().toISOString() }));
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].transaction.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'keep for review' })]);
  expect(f.calls[1].rowOverlays.flatMap((overlay: any) => overlay.proposals)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'move_down' }),
  ]));
  expect(moveRequests).toHaveLength(1, 'resending the inquiry cannot repeat the committed movement');
  expect(f.control.blockedMutations).toEqual([]);
});


test('V7 field-only inquiry enables submission, preserves the draft on failure and reconciles confirmed values', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name);
  const row = await f.open();
  if (!await row.locator('[data-reclass-location-details]').evaluate(element => element.hasAttribute('open'))) await row.locator('[data-reclass-location-details] > summary').click();
  const note = row.locator('[data-reclass-temporary-field="locationnote"]');
  await note.fill('New location instructions');
  await row.locator('[data-reclass-temporary-field="salesnote"]').fill('New sales instructions');
  await row.locator('[data-reclass-temporary-field="suspend"]').selectOption('yes');
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeEnabled();
  f.failNext();
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(note).toHaveValue('New location instructions');
  expect(f.calls[0].transaction.requestActions).toEqual(['inventory_fields']);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual([]);
  expect(f.calls[0].rowOverlays[0].fieldEdits).toEqual([
    {field:'locationnote',expected:'',value:'New location instructions'},
    {field:'salesnote',expected:'',value:'New sales instructions'},
    {field:'suspend',expected:'',decision:'yes'},
  ]);
  f.setCreateReply(() => {
    const receipt = confirmedPriorityResponse('2');
    Object.assign(f.control.master[0], {locationnote:'New location instructions',salesnote:'New sales instructions',suspend:'DC',prisetby:'DC',priupdated:'2026-10-09',locationnotedate:'2026-10-09',last_updated:receipt.liveEdits[0].last_updated});
    f.control.datasetRevision = 502;
    const before = Object.fromEntries(['locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility','oversellpercentage','salesnote','suspend'].map(field => [field,null]));
    return { ...receipt, workflowPolicyVersion:'reclass-action-workflow-v7-editable-fields-20261009',
      inventoryFields:[{unique_id:receipt.liveEdits[0].unique_id,before,
        after:{...before,locationnote:'New location instructions',salesnote:'New sales instructions',suspend:'DC'},
        changedFields:['locationnote','salesnote','suspend'],
        stamps:{prisetby:'DC',priupdated:'2026-10-09',locationnotedate:'2026-10-09',evaldate:'2026-10-09'}}] };
  });
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls[1].idempotencyToken).toBe(f.calls[0].idempotencyToken);
  expect(await page.evaluate(() => window.eval(`(() => {const row=fullInventory.find(row=>row.UNIQUE_ID==='drive-layout-synthetic-1-no-photo');return {note:row.LOCATIONNOTE,sales:row.SALESNOTE,sus:row.SUSPEND,onHand:Number(row.PTRONHAND)};})()`)))
    .toEqual({note:'New location instructions',sales:'New sales instructions',sus:'DC',onHand:25});
  expect(f.control.blockedMutations).toEqual([]);
});

test('Take off hold YES queues the inquiry and retains confirmed photos and specs', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name);
  const photo = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/2026-10-09/keep.webp';
  // Seed both the mounted cache and the authoritative fixture row. Background
  // master reads must see the already-saved capture before the live Hold edit.
  Object.assign(f.control.master[0], {
    holdstopcode: 'H', holdstopreason: 'test hold', photo_link: photo, photo_name: '2026-10-09-keep.webp',
    spec: 'keep specs', caliper: '2', match: '100', av_note: 'keep note', last_updated: '2026-10-09T12:00:00Z',
  });
  f.control.datasetRevision = 501;
  await page.evaluate(photo => window.eval(`(() => {
    Object.assign(fullInventory[0], {HOLDSTOPCODE:'H',HOLDSTOPREASON:'test hold',PHOTO_LINK:${JSON.stringify(photo)},PHOTO_NAME:'2026-10-09-keep.webp',SAVED_PHOTO_LINK:${JSON.stringify(photo)},SPEC:'keep specs',CALIPER:'2',MATCH:'100',AV_NOTE:'keep note',LAST_UPDATED:'2026-10-09T12:00:00Z',last_updated:'2026-10-09T12:00:00Z'});
    rebuildMasterInventoryIndexes();
    if (!canSubmitLiveHoldRemoval(fullInventory[0])) throw new Error('Fixture must be authorized for live Hold removal');
    void sendDriveRowToHoldRelease(fullInventory[0].UNIQUE_ID);
  })()`), photo);
  await expect(page.locator('#hold-release-modal')).toBeVisible();
  f.setCreateReply(() => {
    const response = confirmedPriorityResponse('2');
    Object.assign(response.liveEdits[0].evidence, {photo_link:photo,photo_name:'2026-10-09-keep.webp',spec:'keep specs',caliper:'2',match:'100',av_note:'keep note',av_rule_last_clear_reason:null,av_rule_last_cleared_at:null});
    Object.assign(response.liveEdits[0], {av_rule_last_clear_reason:null,av_rule_last_cleared_at:null});
    Object.assign(f.control.master[0], response.liveEdits[0].evidence, {holdstopcode:null,holdstopreason:null});
    f.control.datasetRevision = 502;
    return {...response,workflowPolicyVersion:'reclass-action-workflow-v7-editable-fields-20261009',inventoryFields:[]};
  });
  await page.locator('#hold-release-yes-btn').click();
  await expect.poll(() => f.calls.length).toBe(1);
  await expect(page.locator('#toast-notification')).toContainText('Hold removed');
  expect(f.calls[0].transaction.requestActions).toEqual(['take_off_hold']);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual([]);
  expect(await page.evaluate(() => window.eval(`(() => {const row=fullInventory.find(row=>row.UNIQUE_ID==='drive-layout-synthetic-1-no-photo');return {hold:String(row.HOLDSTOPCODE || ''),photo:row.PHOTO_LINK,spec:row.SPEC,onHand:Number(row.PTRONHAND)};})()`)))
    .toEqual({hold:'',photo,spec:'keep specs',onHand:25});
  expect(f.control.blockedMutations).toEqual([]);
});

test('targeted item snapshot authorizes Reclass without promoting the global master across source contexts', { tag: ['@local-e2e', '@reclass-splits'] }, async ({ page, baseURL }, info) => {
  test.setTimeout(180_000);
  const f = await fixture(page, baseURL!, info.project.name, { season: 'S1', salesYear: '27' }, 10_001, 1000, false);
  // Keep synthetic targeted-read revisions aligned with the move-receipt
  // revisions (600 -> receipt 601 -> next snapshot 601).
  f.control.datasetRevision = 600;
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
  const masterCount = await page.evaluate(() => window.eval('fullInventory.length'));
  expect(masterCount).toBeLessThan(10_001);
  await expectGlobalMasterIsNotFull(page);

  // The visible fixture card is Drive-mounted. The same modal entry function
  // is then exercised with each production source-view identifier; this is a
  // modal source-context matrix, not five independently mounted module flows.
  const missingOpenTimingTargets = await installOpenStageTiming(page);
  await installReclassEventToPaintProbe(page);
  const sourceViews = ['drive', 'eval-report-2', 'sales-inventory', 'request', 'suspend-tag'];
  const timing: Array<{ sourceView: string; modalOpenMs: number; detailsReadyMs: number; expansionMs: number; submitPendingMs: number; submitFeedbackMs: number; receiptAndCloseMs: number }> = [];
  for (const [index, sourceView] of sourceViews.entries()) {
    if (index === 0) {
      // First iteration clicks the real rendered Drive card and performs a cold
      // item-scoped read against a 10,001-row fixture.
      await openTargetedReclassFromMountedDriveCard(page);
      const openStages = await takeOpenStageTiming(page);
      console.log(`[V239_RECLASS_OPEN_STAGES] ${JSON.stringify({ environment: info.project.name, missingOpenTimingTargets, openStages })}`);
      await test.info().attach('reclass-open-stage-timing.json', { contentType: 'application/json', body: JSON.stringify({
        environment: info.project.name, missingOpenTimingTargets, openStages,
      }, null, 2) });
      const probe = await readReclassEventToPaintProbe(page);
      const modalOpenMs = Number(probe?.paints?.open);
      const detailsReadyMs = Number(probe?.paints?.details);
      const expansionMs = Number(probe?.paints?.expand || 0);
      timing.push({ sourceView, modalOpenMs, detailsReadyMs, expansionMs, submitPendingMs: 0, submitFeedbackMs: 0, receiptAndCloseMs: 0 });
      console.log(`[V239_RECLASS_UI_PAINT] ${JSON.stringify({ environment: info.project.name, sourceView, modalOpenMs, detailsReadyMs, expansionMs })}`);
      await test.info().attach('reclass-initial-event-to-paint.json', { contentType: 'application/json', body: JSON.stringify({
        environment: info.project.name, modalOpenMs, detailsReadyMs, expansionMs,
        harnessRoundTripsExcluded: true,
      }, null, 2) });
      expect(modalOpenMs, 'cold targeted Item Inquiry should stay within the approved interactive UI budget').toBeLessThanOrEqual(400);
      expect(detailsReadyMs, 'targeted item detail must paint within the approved interactive UI budget').toBeLessThanOrEqual(400);
      if (expansionMs) expect(expansionMs, 'row expansion must paint within the approved interactive UI budget').toBeLessThanOrEqual(400);
    } else {
      await page.evaluate(source => window.eval(`(() => {
        window.__v239ReclassEventToPaintProbe?.begin?.('open');
        closeArgosInventoryTransactionModal();
        openArgosInventoryTransactionModal(${JSON.stringify('drive-layout-synthetic-1-no-photo')}, 'reclass', ${JSON.stringify(source)});
        return true;
      })()`), sourceView);
      await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible({ timeout: 30_000 });
      timing.push({ sourceView, modalOpenMs: 0, detailsReadyMs: 0, expansionMs: 0, submitPendingMs: 0, submitFeedbackMs: 0, receiptAndCloseMs: 0 });
    }
    const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
    await expect(row).toBeVisible();
    if (await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') await row.locator('.argos-reclass-row-toggle').click();
    await expect(row.locator('[data-reclass-row-hydrated="true"]')).toBeVisible();
    const state = await page.evaluate(() => window.eval(`(() => {
      const context = getProductionLiveSyncContext();
      const item = argosInventoryTransactionState;
      return { sourceView: String(item?.sourceView || ''), uniqueId: String(item?.snapshot?.uniqueId || ''),
        locations: Number(item?.inquiryModel?.locationRows?.length || 0),
        locationIds: (item?.inquiryModel?.locationRows || []).map(entry => String(entry?.unique_id || '')).sort(),
        scope: String(context.scope || ''),
        permission: String(context.dataPermissionVersion || ''),
        group: item?.verifiedInquiryGroup ? { scope: String(item.verifiedInquiryGroup.scope || ''),
          readScope: String(item.verifiedInquiryGroup.readScope || ''), permission: String(item.verifiedInquiryGroup.permission || ''),
          revision: String(item.verifiedInquiryGroup.revision || ''), identityKey: String(item.verifiedInquiryGroup.identityKey || ''),
          sourceState: String(item.verifiedInquiryGroup.sourceState || ''), sourceSignature: String(item.verifiedInquiryGroup.sourceSignature || '') } : null };
    })()`));
    expect(state.sourceView).toBe(sourceView);
    expect(state.uniqueId).toBe('drive-layout-synthetic-1-no-photo');
    const expectedLocationIds = f.control.master.filter((candidate: any) =>
      String(candidate.itemcode || candidate.ITEMCODE || '').trim().toUpperCase() === 'LAYOUT.001-NO-PHOTO')
      .map((candidate: any) => String(candidate.unique_id || candidate.UNIQUE_ID || '')).sort();
    expect(state.locationIds).toEqual(expectedLocationIds);
    expect(state.locations).toBe(expectedLocationIds.length);
    expect(state.scope).toBeTruthy(); expect(state.permission).toBeTruthy();
    expect(state.group).toEqual(expect.objectContaining({ scope: state.scope, readScope: expect.any(String),
      permission: state.permission, revision: expect.stringMatching(/^[1-9]\d*$/), identityKey: expect.any(String),
      sourceState: expect.any(String), sourceSignature: expect.any(String) }));
    expect(state.group.readScope).toBeTruthy(); expect(state.group.identityKey).toBeTruthy();
    expect(state.group.sourceState).toBeTruthy(); expect(state.group.sourceSignature).toBeTruthy();
    await expectGlobalMasterIsNotFull(page);
    await expect(page.locator('#toast-notification')).not.toContainText(/inventory and permissions are not verified|could not be verified/i);

    await row.locator('[data-reclass-v3-action="move_up"]').click();
    const move = row.locator('[data-reclass-move-action="move_up"]');
    await move.getByLabel('Move Up quantity 1', { exact: true }).fill('34');
    await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('F1');
    const sourceProof = await page.evaluate(() => window.eval(`(() => {
      const state = argosInventoryTransactionState;
      const context = getProductionLiveSyncContext();
      return { globalFull: getDatasetState('master').fullLoaded === true,
        scope: String(context.scope || ''), permission: String(context.dataPermissionVersion || ''),
        rowCount: Number(state?.inquiryModel?.locationRows?.length || 0),
        locationIds: (state?.inquiryModel?.locationRows || []).map(entry => String(entry?.unique_id || '')).sort(),
        revision: String(state?.verifiedInquiryGroup?.revision || ''),
        sourceQuantity: Number(String(state?.snapshot?.ptrAvailable || state?.snapshot?.ptrOnHand || '0').replace(/,/g, '')) };
    })()`));
    expect(sourceProof.globalFull).toBe(false);
    expect(sourceProof.scope).toBe(state.scope);
    expect(sourceProof.permission).toBe(state.permission);
    expect(sourceProof.locationIds).toEqual(expectedLocationIds);
    expect(sourceProof.rowCount).toBe(expectedLocationIds.length);
    expect(sourceProof.sourceQuantity).toBeGreaterThan(0);

    if (index === 0) {
      // A draft must survive loss of its cached proof; submission then obtains
      // a fresh targeted read without promoting the global master snapshot.
      await page.evaluate(() => window.eval(`(() => {
        if (!argosInventoryTransactionState) throw new Error('Reclass draft state is missing.');
        argosInventoryTransactionState.verifiedInquiryGroup = null;
        return true;
      })()`));
      await expect(move.getByLabel('Move Up quantity 1', { exact: true })).toHaveValue('34');
      await expect(move.getByLabel('Move Up destination 1', { exact: true })).toHaveValue('F1');
      await expectGlobalMasterIsNotFull(page);
    }

    await page.locator('#argos-inventory-transaction-apply').click();
    await expectReclassModalHiddenWithDiagnostics(page, f, moveRequests, sourceView);
    await page.waitForFunction(() => Number.isFinite(Number((window as any).__v239ReclassEventToPaintProbe?.snapshot?.()?.paints?.['submit-feedback'])), null, { timeout: 5000 });
    const submitProbe = await readReclassEventToPaintProbe(page);
    const submitPendingMs = Number(submitProbe?.paints?.['submit-pending']);
    const submitFeedbackMs = Number(submitProbe?.paints?.['submit-feedback']);
    const receiptAndCloseMs = Number(submitProbe?.paints?.['submit-closed']);
    timing[timing.length - 1].submitPendingMs = submitPendingMs;
    timing[timing.length - 1].submitFeedbackMs = submitFeedbackMs;
    timing[timing.length - 1].receiptAndCloseMs = receiptAndCloseMs;
    console.log(`[V239_RECLASS_SUBMIT_PAINT] ${JSON.stringify({ environment: info.project.name, sourceView, submitPendingMs: Number.isFinite(submitPendingMs) ? submitPendingMs : null, submitFeedbackMs, receiptAndCloseMs: Number.isFinite(receiptAndCloseMs) ? receiptAndCloseMs : null })}`);
    expect(Number.isFinite(submitFeedbackMs), `${sourceView} submit must paint pending or completed feedback`).toBe(true);
    expect(submitFeedbackMs, `${sourceView} submit feedback should paint within the approved interactive UI budget`).toBeLessThanOrEqual(400);
    const request = moveRequests[moveRequests.length - 1];
    expect(request.expectedRevision).toBe(Number(sourceProof.revision));
    expect(request.moves).toEqual([expect.objectContaining({
      source: expect.objectContaining({ uniqueId: 'drive-layout-synthetic-1-no-photo', identity: expect.objectContaining({
        itemcode: 'LAYOUT.001-NO-PHOTO', lotcode: '27.S1', season: 'S1',
      }) }),
      lines: [{ direction: 'move_up', destinationSeason: 'F1', quantity: 34 }],
    })]);
    expect(moveRequests).toHaveLength(index + 1);
    await expectGlobalMasterIsNotFull(page);
  }
  await test.info().attach('reclass-targeted-snapshot-timing.json', { contentType: 'application/json', body: JSON.stringify({
    environment: info.project.name, fixtureSourceRows: f.control.master.length, globalRowsBefore: masterCount,
    operation: 'cold click-to-open and apply from a targeted item snapshot', cache: 'global master remains browse-only',
    sourceViews: timing, sourceContextMatrixMounted: false,
  }, null, 2) });
  await disposeReclassEventToPaintProbe(page);
});

test('Send as Review preserves a targeted 34-unit F1 proposal without applying stock or sending real email', { tag: ['@local-e2e', '@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name, { season: 'S1', salesYear: '27' }, 10_001, 1000, false);
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
  const reviewRequests: Record<string, any>[] = [];
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'eval_work' || body.operation !== 'create') return route.fallback();
    reviewRequests.push(structuredClone(body));
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL!).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: true, data: { id: 'synthetic-targeted-reclass-review', status: 'assigned' } }) });
  });
  await expectGlobalMasterIsNotFull(page);
  const row = await openTargetedReclassFromMountedDriveCard(page);
  await expect(page.locator('#toast-notification')).not.toContainText(/inventory and permissions are not verified|could not be verified/i);
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('34');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('F1');
  await page.locator('#argos-inventory-transaction-review').click();
  await expect(page.locator('#eval-work-setup-modal')).toBeVisible();
  await page.evaluate(() => window.eval(`(() => {
    evalWorkSetupState.assigneeUsernames = ['josh_vann'];
    evalWorkSetupState.instructions = 'Verify the 34-unit F1 move proposal.';
    evalWorkSetupState.completionRecipients = ['qa-reclass@example.test'];
    syncEvalWorkSetupSummary();
    return true;
  })()`));
  await expect(page.locator('#eval-work-setup-create')).toBeEnabled();
  await page.locator('#eval-work-setup-create').click();
  await page.locator('.app-prompt-confirm').click();
  await expect(page.locator('#eval-work-setup-modal')).toBeHidden();

  expect(reviewRequests).toHaveLength(1);
  expect(reviewRequests[0].inquiry.rowOverlays).toEqual(expect.arrayContaining([expect.objectContaining({
    unique_id: 'drive-layout-synthetic-1-no-photo',
    proposals: expect.arrayContaining([expect.objectContaining({ action: 'move_up', splits: [
      expect.objectContaining({ destinationSeason: 'F1', quantity: 34 }),
    ] })]),
  })]));
  expect(moveRequests).toHaveLength(0);
  expect(f.control.blockedMutations).toEqual([]);
  await expectGlobalMasterIsNotFull(page);
});
