import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
// @test-group: @suspend-tag,suspend

import { confirmedDriveEvidence, driveEvidenceColumns } from '../services/driveEvidence.ts';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';


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

/** Runs the built app's real renderer, confirmation, transport and cache logic.
 * Only identity/data-loading boundaries are supplied. Backend state lives in
 * this test process across refresh/reload; no customer record is ever changed.
 */
async function harness(page: Page, baseURL: string, rows = fixtures, options: { search?: string; expired?: boolean; inventoryUnavailable?: boolean; native?: boolean } = {}) {
  const origin = new URL(baseURL).origin;
  const backendRows = structuredClone(rows);
  const receipts = new Map<string, Record<string, unknown>>();
  const requests: CompletionRequest[] = [];
  const unexpectedMutations: string[] = [];
  const blockedReadOnlyAppApiCalls: string[] = [];
  const pageErrors: string[] = [];
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
  const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) runtimeResponses.push(response.url());
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    // A real HTTP image failure dispatches the browser's error event consistently;
    // an intercepted cancellation can leave WebKit's deferred image unsettled.
    if (request.method() === 'GET' && url.href === 'https://example.test/photo.jpg') {
      return route.fulfill({ status: 404, contentType: 'image/jpeg', body: '' });
    }
    if (options.native && url.pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1' && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (!Array.isArray(body.p_dataset_keys) || Object.keys(body).some(key => key !== 'p_dataset_keys')) throw new Error('Unexpected revision read');
      return fulfill(route, { contractVersion: 1, permissionVersion: 'suspend-fixture-access-1', serverTime: new Date().toISOString(),
        sources: body.p_dataset_keys.map((key: string) => ({ key, revision: String(nativeRevision), state: 'ready' })) });
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
      if (options.native && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && body.action === 'eval_work' && body.operation === 'list'
        && Object.keys(body).sort().join(',') === 'action,operation'
        && !request.headers()['idempotency-key']) {
        return fulfill(route, { ok: true, data: [], manager: true });
      }
      if (options.native && url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
        && body.action === 'shear_location_work' && body.operation === 'list' && body.status === 'active'
        && Object.keys(body).sort().join(',') === 'action,operation,status'
        && !request.headers()['idempotency-key']) {
        return fulfill(route, { ok: true, data: [] });
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
      if (options.native && ['sales_credit', 'request_history'].includes(body.action) && body.operation === 'compatibility'
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
          if (options.native && body.dataset === 'suspend_tag') {
            const source = backendRows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])));
            const rows = source.slice(params.offset, params.offset + params.limit);
            return fulfill(route, { ok: true, data: { rows, total: source.length, offset: params.offset, limit: params.limit,
              hasMore: params.offset + rows.length < source.length } });
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
        requestSuspendTagStatusFilter = 'active';
        showOnlyPrimaryView('request');
        invalidateResolvedViewStateCaches();
        renderRequest();
      })()`);
    }, nextRows);
    await expect(page.locator('#view-request')).toBeVisible();
  };
  await page.goto('/?post_deploy_access_canary=1&suspend_tag_canary=1' + (options.search || ''), { waitUntil: 'load' });
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
          permissions: [{ permissionKey: 'module.request.view', kind: 'module', moduleKey: 'request', allowed: true }]
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
  const assertClean = () => {
    expect(unexpectedMutations, 'Suspend Tag actions must not bypass the scoped idempotent API with generic writes').toEqual([]);
    expect(blockedReadOnlyAppApiCalls.filter((call) => call !== 'inventory_read:source_freshness' && ![...safeDatasetReads].some((dataset) => call === `dataset_read:${dataset}`))).toEqual([]);
    expect(pageErrors, 'completion must not throw unhandled browser errors').toEqual([]);
  };
  return { requests, replies, receipts, backendRows, inventoryLookupCalls, card, done, activate, legacyComplete, beginLegacyCompletion, seed, refresh, nativeRefresh, showStatus, assertClean };
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
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
});

test('canceling confirmation retains the row and makes no completion request', {"tag":["@suspend-tag"]}, async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!);
  await app.beginLegacyCompletion();
  await app.activate(page.locator('#app-prompt-dialog').getByRole('button', { name: 'Keep Pending', exact: true }));
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
  app.assertClean();
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
    await app.legacyComplete();
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
    await app.legacyComplete();
    await expect(page.locator('#toast-notification')).toHaveAttribute('data-kind', 'error');
    await expect(app.done()).toBeEnabled();
    await expect(app.card()).toHaveCount(1);
  }
  expect(app.receipts.size).toBe(0);
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
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
  await app.activate(dialog.getByRole('button',{name:'Approve',exact:true}));
  await expect(dialog).toContainText('Your reply email is queued');
  expect(app.requests.map(r=>r.body.operation)).toEqual(['approval','decide']);
  app.assertClean();
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
  app.assertClean();
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
  expect(presentation.elapsedMs).toBeLessThanOrEqual(400);
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
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
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
  app.assertClean();
});
