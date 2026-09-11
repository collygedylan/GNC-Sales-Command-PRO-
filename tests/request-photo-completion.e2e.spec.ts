import { expect, test, type Page, type Route } from '@playwright/test';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

// Only transport/session fixtures are replaced. Native access bootstrap, list
// projection, exact-detail store, coordinator, camera processing and Request
// saveData/canonicalization all execute from the compiled release artifact.
const UID = 'request-photo-master-fixture';
const REQUEST_ID = 'request-photo-completion-fixture';
const USER = 'kayla_knepp';
const PROFILE_ID = '97000000-0000-4000-8000-000000000010';
const person = { id: PROFILE_ID, username: USER, display_name: 'Synthetic Kayla', role: 'ADMIN',
  division: '10', language: 'English', disabled_at: null, locked_until: null,
  must_change_password: false, passkey_pilot: false };
const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
type ResponseGate = { promise: Promise<void>; release: () => void };
const diagnostics = new WeakMap<Page, { report: () => unknown; release: () => void }>();

function authSession() {
  const claims = { sub: PROFILE_ID, aud: 'authenticated', role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'), 'synthetic-signature'].join('.');
  return { access_token: token, refresh_token: 'synthetic-request-refresh', expires_at: claims.exp,
    expires_in: 3600, token_type: 'bearer', user: { id: PROFILE_ID, aud: 'authenticated', role: 'authenticated',
      email: 'kayla-fixture@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
}

async function browserState(page: Page) {
  return page.evaluate(({ uid, requestId }) => window.eval(`(() => {
    const canonical=findRequestRowByUniqueId(${JSON.stringify(requestId)});
    return { view:getCurrentVisibleViewId(), detailStatus:productionMasterDetailSession?.status,
      projection:getDatasetState('master').listProjectionVersion, uid:activeItem?.UNIQUE_ID,
      sameCanonical:activeItem===canonical, detailVerified:hasProductionMasterDetailForItem(activeItem),
      canonicalVerified:hasProductionMasterDetailForItem(canonical),
      exactStoreReady:!!getProductionMasterDetailStore()?.getVerifiedRows([${JSON.stringify(uid)}]),
      datasetsVerified:canUseVerifiedProductionData(['master','requests']),
      rolePhoto:canCurrentUserWorkRequestItem(activeItem,'photo'),
      roleComplete:canCurrentUserWorkRequestItem(activeItem,'complete'),
      photo:activeItem?.REQ_PHOTO_LINK, avNote:document.getElementById('req-av-note')?.value,
      hidden:document.hidden, online:navigator.onLine,
      ownSaveDeferred:!!productionMasterDetailSession?.requestOwnSave?.deferred,
      retainedFiles:typeof pendingRequestCameraSelection === 'undefined' ? [] : (pendingRequestCameraSelection?.files || []).map(file=>file.name),
      retainedState:typeof pendingRequestCameraSelection === 'undefined' ? null : pendingRequestCameraSelection?.state,
      indexedDbErrors:window.__requestIndexedDbErrors || [],
      diagnostics:window.__requestRepairObservations };
  })()`), { uid: UID, requestId: REQUEST_ID });
}

test.afterEach(async ({ page }, info) => {
  const entry = diagnostics.get(page);
  if (!entry) return;
  await info.attach('request-photo-completion-evidence', { contentType: 'application/json',
    body: JSON.stringify({ browser: await browserState(page).catch(error => ({ error: String(error) })),
      network: entry.report() }, null, 2) });
  entry.release();
});

async function fixture(page: Page, baseURL: string, allowed = true) {
  const origin = new URL(baseURL).origin;
  const master = inventoryReadFixture.row({ unique_id: UID, itemcode: 'SYNTH.070.1',
    commonname: 'Synthetic Purple Holly', contsize: '#7', locationcode: 'F.10.000', lotcode: '27.F1',
    source: 'LD', season: 'F1', saleyear: '27', warehouseid: '10', warehousei: '10',
    ptronhand: '42', ptravailable: '42', s_lts: '42', a_lts: '42', si_lts: '42', ai_lts: '42',
    last_updated: '2026-09-10T12:00:00Z', photo_link: '', photo_name: '',
    spec: '24-30 H', caliper: 'N/A', match: '100', av_note: 'HEALTHY', holdstopcode: '' });
  const requestRow: Record<string, any> = { ...master, unique_id: REQUEST_ID, master_id: UID,
    source_table: 'ph_active_request', request_folder: 'Synthetic Request Folder', req_customer: 'Synthetic Customer',
    req_status: 'Pending', req_qty: '1', req_match: 100, req_spec: '24-30 H', req_caliper: 'N/A',
    req_reserve: 'NO', req_photo_link: '', req_photo_name: '', req_comments: '', row_version: 1,
    requested_by: 'Synthetic Other Rep', date_requested: '2026-09-10T12:00:00Z',
    updated_at: '2026-09-10T12:00:00Z', date_completed: null };
  const state = { allowed, permission: 'request-photo-policy-1', revisions: {} as Record<string, number>,
    historyRow: null as null | Record<string, any>,
    master, requestRow, uploads: [] as any[], saves: [] as any[], reads: [] as any[], productivity: [] as any[],
    metadata: [] as string[][], unexpectedWrites: [] as string[], errors: [] as string[], runtime: [] as string[],
    heldMetadata: 0, gate: null as null | ResponseGate, saveAckGate: null as null | ResponseGate,
    uploadGate: null as null | ResponseGate };
  diagnostics.set(page, { report: () => ({ ...state, gate: !!state.gate, saveAckGate: !!state.saveAckGate, uploadGate: !!state.uploadGate }),
    release: () => { state.gate?.release(); state.saveAckGate?.release(); state.uploadGate?.release(); } });
  const json = (route: Route, value: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({
    status, contentType: 'application/json', headers: { 'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      // Authorization is a CORS non-wildcard header; name it explicitly when
      // a fulfilled request has no browser-generated preflight header list.
      'access-control-allow-headers': route.request().headers()['access-control-request-headers']
        || 'authorization, apikey, content-type, prefer, cache-control, pragma, x-client-info, x-supabase-api-version',
      'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(value) });
  const liveRequest = () => {
    const row = structuredClone(state.requestRow);
    delete row.source; delete row.source_table;
    Object.assign(row, { drive_row_missing: false, drive_last_updated: state.master.last_updated,
      drive_assignedto: state.master.assignedto });
    for (const key of ['match', 'loc_match_qty', 'spec', 'caliper', 'pic_note', 'av_note', 'photo_link', 'photo_name']) row[`drive_${key}`] = state.master[key];
    for (const key of Object.keys(state.master).filter(key => key.startsWith('av_rule_'))) row[key] = state.master[key];
    return row;
  };
  const readTable = (table: string, query = '') => {
    if (table === 'ph_master_inventory') {
      const params = new URLSearchParams(query);
      const itemcode = params.get('itemcode');
      let source = [state.master];
      if (itemcode) {
        if (!itemcode.startsWith('eq.')) throw new Error(`Unsupported Request fixture itemcode filter: ${itemcode}`);
        source = source.filter(row => row.itemcode === itemcode.slice(3).replace(/^"|"$/g, ''));
        params.delete('itemcode');
      }
      for (const key of ['commonname', 'contsize']) {
        const filter = params.get(key);
        if (!filter) continue;
        if (filter.startsWith('eq.')) source = source.filter(row => String(row[key]) === filter.slice(3).replace(/^"|"$/g, ''));
        else if (key === 'commonname' && filter.startsWith('ilike.')) {
          const parts = filter.slice(6).split('*').filter(Boolean).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          const pattern = new RegExp(parts.join('.*'), 'i');
          source = source.filter(row => pattern.test(String(row[key])));
        } else throw new Error(`Unsupported Request fixture ${key} filter: ${filter}`);
        params.delete(key);
      }
      const selected = inventoryReadFixture.read(source, params.toString());
      state.reads.push({ table, select: selected.select, exact: selected.exact,
        ids: selected.uniqueIds, fields: selected.rows[0] ? Object.keys(selected.rows[0]).length : 0 });
      return selected.rows;
    }
    state.reads.push({ table, query });
    if (['ph_active_request', 'ph_active_request_live_rows', 'ph_request_queue_live_rows'].includes(table)) {
      const params = new URLSearchParams(query);
      if (params.get('date_completed') === 'is.null' && state.requestRow.date_completed) return [];
      if (params.has('unique_id') && params.get('unique_id') !== `eq.${REQUEST_ID}`) throw new Error(`Unsupported Request identity filter: ${query}`);
      return [table === 'ph_active_request' ? structuredClone(state.requestRow)
        : table === 'ph_request_queue_live_rows' ? { ...liveRequest(), delivery_status: state.requestRow.date_completed ? 'pending' : null }
        : liveRequest()];
    }
    if (table === 'ph_request_history') return state.historyRow ? [structuredClone(state.historyRow)] : [];
    if (table === 'ph_app_settings') return [{ key: 'current_season_salesyear', value: { seasonCode: 'F1', salesYear: 27 } }];
    return [];
  };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('response', response => { if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) state.runtime.push(response.url()); });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === origin && readMethods.has(method)) return route.continue();
    if (method === 'OPTIONS') return json(route, {});
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/user') && method === 'GET') return json(route, authSession().user);
      if (url.pathname.endsWith('/token')) return json(route, authSession());
      return json(route, { error: 'Synthetic auth endpoint unavailable' }, 404);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const operation = url.pathname.split('/').pop()!;
      const body = request.postDataJSON() || {};
      if (operation === 'get_my_app_permissions_v1') return json(route, {
        contractVersion: 'app-access-v1', enforcementMode: 'enforced', username: USER, role: person.role,
        permissions: ['home', 'drive', 'av', 'request', 'hours', 'managers'].map(key => ({ permissionKey: `module.${key}.view`,
          kind: 'module', moduleKey: key, allowed: true, scope: 'global' })) });
      if (operation === 'get_request_capabilities') return json(route, { contract_version: 2, username: USER,
        scope: 'global', can_view_queue: true, can_take_photo: state.allowed, can_edit: state.allowed,
        can_complete: state.allowed, can_archive: state.allowed, can_create_general: state.allowed, can_create_av: state.allowed });
      if (operation === 'get_my_dataset_revisions_v1') {
        state.metadata.push(body.p_dataset_keys || []);
        if (state.gate) { state.heldMetadata++; await state.gate.promise; }
        return json(route, { contractVersion: 1, permissionVersion: state.permission,
          sources: (body.p_dataset_keys || []).map((key: string) => ({ key, revision: String(state.revisions[key] || 1), state: 'ready' })) });
      }
      if (operation === 'get_request_schema_compatibility') return json(route, { compatible: true, contract_version: 2 });
      if (operation === 'save_request_work') {
        state.saves.push(structuredClone(body));
        if (!state.allowed || body.request_id !== REQUEST_ID) return json(route, { message: 'REQUEST_WORK_FORBIDDEN' }, 403);
        if (Number(body.expected_version) !== state.requestRow.row_version) return json(route, { message: 'REQUEST_VERSION_CONFLICT' }, 409);
        if (body.complete && !body.patch?.req_photo_link) return json(route, { message: 'REQUEST_PHOTO_REQUIRED' }, 400);
        // Model the deployed v1 transaction and live-view acknowledgement: every
        // save also updates the linked master, and its evidence trigger can bump
        // the still-pending Request a second time. Never hold its revision fixed.
        const patch = body.patch || {}, savedAt = new Date().toISOString();
        const before = structuredClone(state.master);
        const mapping: Record<string, string> = { req_match: 'match', loc_match_qty: 'loc_match_qty',
          req_spec: 'spec', req_caliper: 'caliper', req_pic_note: 'pic_note', av_note: 'av_note',
          drive_photo_link: 'photo_link', drive_photo_name: 'photo_name' };
        const present = (key: string) => Object.prototype.hasOwnProperty.call(patch, key);
        const numericMatch = (value: unknown, previous: unknown) => value == null || String(value).trim() === '' ? null
          : /^-?[0-9]+([.][0-9]+)?$/.test(String(value).trim()) ? Number(value) : previous;
        const requestTextKeys = new Set(['req_spec', 'req_caliper', 'req_pic_note', 'req_sales_note', 'req_comments',
          'av_note', 'req_reserve', 'req_photo_link', 'req_photo_name', 'req_photo_mode', 'req_rep_action', 'request_note', 'req_status']);
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'req_match') state.requestRow[key] = numericMatch(value, state.requestRow[key]);
          else if (requestTextKeys.has(key)) state.requestRow[key] = value == null ? null : String(value);
          else if (key === 'req_archived') state.requestRow[key] = value === true || value === 'true';
        }
        Object.assign(state.requestRow, { row_version: state.requestRow.row_version + 1, updated_at: savedAt });
        if (body.complete) Object.assign(state.requestRow, { req_status: 'Complete', date_completed: savedAt,
          req_archived: false, completed_by_username: USER, completed_by_display: person.display_name,
          completed_by_email: authSession().user.email });
        for (const [key, column] of Object.entries(mapping)) if (present(key)) state.master[column] = patch[key] == null ? null : String(patch[key]);
        const evidenceKeys = ['req_match', 'req_spec', 'req_caliper', 'req_pic_note', 'av_note'];
        if (evidenceKeys.some(present)) {
          state.master.av_rule_priority_snapshot = state.master.priority;
          state.master.av_rule_holdstop_snapshot = [state.master.holdstopcode, state.master.holdstopreason].map(value => String(value || '').trim()).filter(Boolean).join('|');
        }
        for (const [key, column] of Object.entries({ req_match: 'match', req_spec: 'spec', req_caliper: 'caliper', av_note: 'av_note' })) {
          if (present(key)) state.master[`av_rule_${column}_updated_at`] = savedAt;
        }
        if (['drive_photo_link', 'drive_photo_name'].some(present)) state.master.av_rule_photo_updated_at = savedAt;
        if ([...evidenceKeys, 'drive_photo_link', 'drive_photo_name'].some(present)) state.master.av_rule_bundle_updated_at = savedAt;
        if (!body.complete && ['match', 'spec', 'caliper', 'pic_note', 'av_note'].some(key => before[key] !== state.master[key])) {
          for (const [key, column] of Object.entries({ req_match: 'match', req_spec: 'spec', req_caliper: 'caliper', req_pic_note: 'pic_note', av_note: 'av_note' })) {
            state.requestRow[key] = key === 'req_match' ? numericMatch(state.master[column], state.requestRow[key]) : state.master[column];
          }
          state.requestRow.row_version++;
        }
        state.revisions.ph_active_request = (state.revisions.ph_active_request || 1) + 1;
        state.revisions.ph_master_inventory = (state.revisions.ph_master_inventory || 1) + 1;
        const response = { ok: true, row: liveRequest(), row_version: state.requestRow.row_version,
          delivery_state: body.complete ? 'pending' : 'not_queued' };
        if (body.complete) {
          // save_request_work_v1 freezes history in the same transaction.
          // Completed rows can disappear from the pending-only fallback read;
          // their saved photo/note must remain available from this frozen row.
          state.historyRow = { ...structuredClone(response.row), source_table: 'ph_active_request',
            request_customer: state.requestRow.req_customer, photo_link: state.requestRow.req_photo_link,
            photo_name: state.requestRow.req_photo_name, last_event: 'completed', delivery_state: 'pending',
            snapshot: structuredClone(response.row) };
          state.revisions.ph_request_history = (state.revisions.ph_request_history || 1) + 1;
        }
        if (state.saveAckGate) await state.saveAckGate.promise;
        return json(route, response);
      }
      if (operation === 'report_app_health_event') return json(route, { ok: true });
      if (/^(get_|list_|search_)/.test(operation)) return json(route, []);
      state.unexpectedWrites.push(`RPC ${operation}`);
      return json(route, { error: 'Unconfigured mutation is blocked' }, 403);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop()!;
      if (table === 'ph_productivity_history' && method === 'POST') {
        const rows = request.postDataJSON();
        if (!state.allowed || !state.requestRow.date_completed || !Array.isArray(rows) || rows.length !== 1
          || rows[0].source_table !== 'ph_active_request' || rows[0].source_unique_id !== REQUEST_ID
          || rows[0].completed_by_username !== USER) {
          state.unexpectedWrites.push('Invalid Request productivity history'); return json(route, {}, 403);
        }
        state.productivity.push(...structuredClone(rows));
        return json(route, rows, 201);
      }
      if (!readMethods.has(method)) { state.unexpectedWrites.push(`${method} ${table}`); return json(route, {}, 403); }
      if (table === 'profiles') return json(route, /vnd\.pgrst\.object/.test(request.headers().accept || '') ? person : [person]);
      const rows = readTable(table, url.searchParams.toString());
      return json(route, rows, 200, { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' });
    }
    if (url.pathname.endsWith('/functions/v1/app-api')) {
      if (/multipart\/form-data/.test(request.headers()['content-type'] || '')) {
        const body = request.postDataBuffer()?.toString('latin1') || '';
        state.uploads.push({ prefix: /name="prefix"\r\n\r\n([^\r]+)/.exec(body)?.[1],
          contract: /name="uploadContract"\r\n\r\n([^\r]+)/.exec(body)?.[1],
          hasThumb144: body.includes('name="thumbnail144"'), hasThumb320: body.includes('name="thumbnail320"') });
        if (!state.allowed) return json(route, { error: 'REQUEST_WORK_FORBIDDEN' }, 403);
        if (state.uploadGate) await state.uploadGate.promise;
        return json(route, { ok: true, publicUrl: `https://request-photo-fixture.invalid/storage/v1/object/public/plant_photos/v2/photo-${state.uploads.length}.webp`,
          fileName: `request-fixture-${state.uploads.length}.webp`, contentType: 'image/webp' });
      }
      const body = request.postDataJSON() || {};
      if (body.action === 'native_session_bridge') return json(route, { ok: true, session: { token: 'synthetic-request-bridge',
        expiresAt: Date.now() + 3600000, username: USER, displayName: person.display_name, role: person.role } });
      if (body.action === 'db' && String(body.method).toUpperCase() === 'GET') return json(route, { ok: true, data: readTable(body.table, body.query) });
      if (body.action === 'season_sales_office' && body.operation === 'access') return json(route, { ok: true, allowed: false, canManage: false, users: [] });
      if (['eval_work', 'shear_location_work', 'location_work', 'dock_trip_status'].includes(body.action)
        && ['list', 'get', 'state'].includes(body.operation || 'list')) return json(route, { ok: true, data: [], manager: false });
      if (/get|load|state|status|preferences|capabilit|health|diagnostic|telemetry|event/.test(String(body.action || ''))) return json(route, { ok: true, eligible: false, data: [], preferences: {} });
      state.unexpectedWrites.push(`API ${body.action}:${body.operation || body.method || ''}`);
      return json(route, { ok: false, error: 'Unconfigured mutation is blocked' }, 403);
    }
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(session => localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(session)), authSession());
  await page.addInitScript(() => {
    const w = window as any; w.__requestIndexedDbErrors = [];
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      const store = this.name;
      result.addEventListener('error', () => w.__requestIndexedDbErrors.push({ store,
        name: result.error?.name, message: result.error?.message }));
      return result;
    };
  });
  // Dismiss unrelated notification onboarding through its real Close handler,
  // including when the Request AV-note sheet is already above that popup.
  await page.addLocatorHandler(page.locator('#push-permission-help-modal'), async modal => modal.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click'));
  await page.addLocatorHandler(page.locator('#mobile-push-enable-prompt'), async prompt => prompt.getByRole('button', { name: 'Dismiss', exact: true }).dispatchEvent('click'));
  const open = async (completed = false) => {
    await page.goto('/?request-photo-completion-fixture=1', { waitUntil: 'load' });
    await expect(page.locator('#view-home')).toBeVisible();
    expect(state.runtime.length, 'Must execute the compiled artifact').toBeGreaterThan(0);
    await page.evaluate(completed => {
      const w = window as any;
      w.__requestRepairObservations = { toasts: [], calls: [], settled: [], selection: [] };
      w.__requestSelectionSnapshot = () => window.eval(`(() => {
        const s=typeof pendingRequestCameraSelection === 'undefined' ? null : pendingRequestCameraSelection || requestCameraPickerOwner;
        const t=productionMasterDetailSession?.requestOwnSave;
        return { at:performance.now(), selection:s ? {reviewed:s.reviewed,state:s.state,
          ownerCurrent:isLoginSessionOwnershipCurrent(s.owner),readIdentityCurrent:s.readIdentity===getSupabaseReadIdentityScope(),
          sessionCurrent:s.session===productionMasterDetailSession, token:s.token, currentToken:detailHydrationToken,
          identity:s.rowIdentity, activeIdentity:getProductionMasterDetailIdentity(activeItem),fence:s.fence,
          currentFence:getProductionMasterDetailContext(),ownerPredicate:requestPhotoSelectionOwnerIsCurrent(s),
          currentPredicate:requestPhotoSelectionIsCurrent(s),files:s.files.map(f=>f.name),uploading:s.uploading||0} : null,
          ticket:t ? {deferred:t.deferred,checking:t.checking,rebound:t.rebound,finished:t.finished,fence:t.fence,
            selections:t.selections.map(s=>({fence:s.fence,identity:s.rowIdentity,isCurrent:s===pendingRequestCameraSelection||s===requestCameraPickerOwner}))} : null,
          detailStatus:productionMasterDetailSession?.status,detailVerified:hasProductionMasterDetailForItem(activeItem),
          bindingCurrent:isProductionMasterDetailBindingCurrent(activeItem),
          sessionCurrent:isProductionMasterDetailSessionCurrent(productionMasterDetailSession),
          sessionIdentity:productionMasterDetailSession?.rowIdentity,
          masterOwnSaveChecking:!!productionMasterDetailSession?.ownSave?.checking,
          requestOwnSaveChecking:!!productionMasterDetailSession?.requestOwnSave?.checking,
          canonicalIdentity:getProductionMasterDetailIdentity(findRequestRowByUniqueId(activeItem?.UNIQUE_ID)),
          canonicalVerified:hasProductionMasterDetailForItem(findRequestRowByUniqueId(activeItem?.UNIQUE_ID)),
          nativePhotoAllowed:canCurrentUserWorkRequestItem(activeItem,'photo'),
          nativeCompleteAllowed:canCurrentUserWorkRequestItem(activeItem,'complete'),
          detailFence:getProductionMasterDetailContext(),
          datasetsVerified:canUseVerifiedProductionData(getProductionDetailDatasetKeys('req-'))};
      })()`);
      for (const name of ['showToast', 'saveData', 'handlePhotoUpload', 'captureRequestPhotoSelectionOwner',
        'ensureRequestPhotoSelectionReady', 'queueRowPhotoUpload', 'continueProductionRequestDetailOwnSave', 'finishProductionRequestDetailOwnSave',
        'getRequestPhotoOwnerItem', 'transferProductionRequestDetailBinding', 'mergeRequestPhotoFields']) {
        const original = w[name];
        if (typeof original !== 'function') continue; // Baseline .02 has no repair helpers.
        w[name] = function (...args: any[]) {
          if (name === 'showToast') w.__requestRepairObservations.toasts.push(args.slice(0, 3));
          else w.__requestRepairObservations.calls.push({ name, prefix: typeof args[1] === 'string' ? args[1] : undefined, complete: name === 'saveData' && args[0] === true });
          const observe = (phase: string, result?: unknown) => {
            if (['showToast', 'handlePhotoUpload'].includes(name)) return;
            try {
              const rowState = (row: any) => row && typeof row === 'object' ? { uid: row.UNIQUE_ID || row.unique_id,
                sourceTable: row.SOURCE_TABLE || row.source_table, sourceUpper: row.SOURCE, sourceLower: row.source,
                identity: w.getProductionMasterDetailIdentity(row), bindingCurrent: w.isProductionMasterDetailBindingCurrent(row),
                verified: w.hasProductionMasterDetailForItem(row), photoAllowed: w.canUploadRowPhoto('req-', row),
                nativePhotoAllowed: w.canCurrentUserWorkRequestItem(row, 'photo'),
                masterIds: w.getProductionMasterDetailIds(row) } : null;
              w.__requestRepairObservations.selection.push({ name, phase, result: typeof result === 'boolean' ? result : undefined,
                ...w.__requestSelectionSnapshot(), ...(['getRequestPhotoOwnerItem', 'transferProductionRequestDetailBinding', 'mergeRequestPhotoFields'].includes(name)
                  ? { sourceRow: rowState(args[0]), targetRow: rowState(args[1]), resultRow: rowState(result) } : {}) });
            } catch (error) { w.__requestRepairObservations.selection.push({ name, phase, observerError: String(error) }); }
          };
          observe('before');
          const result = original.apply(this, args);
          if (result?.then) result.then((value: unknown) => observe('resolved', value), () => observe('rejected'));
          else observe('after', result);
          if (result?.then) result.then(() => w.__requestRepairObservations.settled.push({ name, complete: args[0] === true }),
            () => w.__requestRepairObservations.settled.push({ name, complete: args[0] === true, rejected: true }));
          return result;
        };
      }
      if (completed) w.openManagerSalesRepsModule();
      else w.switchView('request');
    }, completed);
    const requiredDatasets = completed ? ['master', 'requests', 'requestHistory', 'salesCredits'] : ['master', 'requests'];
    await expect.poll(() => page.evaluate(keys => window.eval(`canUseVerifiedProductionData(${JSON.stringify(keys)})`), requiredDatasets)).toBe(true);
    if (completed) await expect.poll(() => page.evaluate(() => window.eval('activeReqTab'))).toBe('reps');
    // A verified empty pending queue is not a published completed Request.
    // Wait for the real queue/history loader to publish the exact lookup row.
    await expect.poll(() => page.evaluate(id => window.eval(`findRequestRowByUniqueId(${JSON.stringify(id)})?.UNIQUE_ID`), REQUEST_ID)).toBe(REQUEST_ID);
    await page.evaluate(id => (window as any).openDetail(id, 'request', { skipRequestOpenInfoModal: true }), REQUEST_ID);
    await expect(page.locator('#view-detail')).toBeVisible();
    await expect(page.locator('#req-av-note')).toBeVisible();
    await expect.poll(() => page.evaluate(uid => window.eval(`productionMasterDetailSession?.status === 'ready'
      && !!getProductionMasterDetailStore()?.getVerifiedRows([${JSON.stringify(uid)}])`), UID)).toBe(true);
    expect(state.reads.some(read => read.table === 'ph_master_inventory' && !read.exact && read.fields === 161)).toBe(true);
    expect(state.reads.some(read => read.table === 'ph_master_inventory' && read.exact && read.fields === 213
      && read.ids.length === 1 && read.ids[0] === UID)).toBe(true);
  };
  const holdResponse = (key: 'gate' | 'saveAckGate' | 'uploadGate') => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    state[key] = { promise, release };
    return () => { state[key] = null; release(); };
  };
  return { state, open, holdMetadata: () => holdResponse('gate'),
    holdSaveAcknowledgement: () => holdResponse('saveAckGate'), holdUpload: () => holdResponse('uploadGate') };
}

async function chooseCameraPhoto(page: Page, captureOriginalBytes = false) {
  return page.locator('#camera-btn-req input[type=file]').evaluate(async (element, captureBytes) => {
    const canvas = document.createElement('canvas'); canvas.width = 60; canvas.height = 40;
    const context = canvas.getContext('2d')!; context.fillStyle = '#39795e'; context.fillRect(0, 0, 60, 40);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const file = new File([blob], 'synthetic-camera.png', { type: 'image/png' });
    // Only the durability test needs a byte oracle. Other camera cases must
    // dispatch the File without an extra test-only read, including offline.
    const original = { name: file.name, type: file.type, lastModified: file.lastModified,
      bytes: captureBytes ? Array.from(new Uint8Array(await file.arrayBuffer())) : [] };
    const transfer = new DataTransfer(); transfer.items.add(file);
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return original;
  }, captureOriginalBytes);
}

async function launchCamera(page: Page) {
  // Run the real input activation handler before foreground verification can
  // begin. On iOS it captures ownership and blurs the AV-note for autosave.
  await page.locator('#camera-btn-req input[type=file]').dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
}

async function setCameraPageHidden(page: Page, hidden: boolean) {
  // Mobile camera UI is outside browser automation. Change only the platform
  // visibility boundary; the app's real visibility listeners/coordinator run.
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function clickMarkDone(page: Page) {
  const button = page.locator('#req-btn-save-complete');
  // Center the button above fixed mobile navigation, then retain Playwright's
  // real visibility, enabled-state and pointer hit-testing for the click.
  await button.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const geometry = await button.evaluate(element => {
    const wrap = document.getElementById('req-save-action-wrap')!, footer = document.getElementById('bottom-nav')!;
    const rect = element.getBoundingClientRect(), root = getComputedStyle(document.documentElement);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const active = document.activeElement as HTMLInputElement;
    return { bodyClasses: document.body.className, activeId: active?.id, activeTag: active?.tagName, activeType: active?.type,
      keyboardOffset: root.getPropertyValue('--keyboard-offset'), navReserve: root.getPropertyValue('--mobile-bottom-nav-reserve'),
      footerReserve: root.getPropertyValue('--footer-nav-reserve'),
      buttonRect: rect.toJSON(), wrapRect: wrap.getBoundingClientRect().toJSON(), footerRect: footer.getBoundingClientRect().toJSON(),
      wrapPosition: getComputedStyle(wrap).position, wrapBottom: getComputedStyle(wrap).bottom,
      footerPointerEvents: getComputedStyle(footer).pointerEvents, footerOpacity: getComputedStyle(footer).opacity,
      hitId: hit?.id, hitLabel: hit?.getAttribute('aria-label'), receivesPointer: hit === element || element.contains(hit) };
  });
  await test.info().attach('request-mark-done-geometry', { contentType: 'application/json', body: JSON.stringify(geometry) });
  if (!geometry.receivesPointer) console.log('Request Mark Done hit-test diagnostics:', JSON.stringify(geometry));
  await button.click();
}

test('Kayla Request AV-note blur then Use Photo retains verification through canonical save and Mark Done', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  expect((await browserState(page)).rolePhoto).toBe(true);
  await page.locator('#req-av-note').focus();
  await page.locator('#req-av-note').evaluate(element => { (element as HTMLInputElement).value = 'HEALTHY LOCAL NOTE'; });
  await launchCamera(page);
  await page.locator('#req-av-note').evaluate(element => (element as HTMLInputElement).blur());
  await expect.poll(() => page.evaluate(() => (window as any).__requestRepairObservations.calls.some((call: any) => call.name === 'saveData'))).toBe(true);
  await chooseCameraPhoto(page);
  await expect.poll(() => f.state.uploads.length, { message: 'The selected camera File must reach the actual protected upload after Request blur canonicalization' }).toBe(1);
  await expect.poll(() => String(f.state.requestRow.req_photo_link)).toContain('photo-1.webp');
  await expect(page.locator('#req-btn-save-complete')).toBeEnabled();
  await page.locator('#req-btn-save-complete').click();
  await expect(page.getByRole('heading', { name: 'Publish in app?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NO', exact: true }).click();
  await expect(page.locator('#mark-done-confirm-modal')).toBeVisible();
  await page.locator('#mark-done-confirm-modal').getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => f.state.saves.filter(save => save.complete).length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__requestRepairObservations.settled.some((call: any) => call.name === 'saveData' && call.complete))).toBe(true);
  expect(f.state.requestRow.req_status).toBe('Complete');
  expect(f.state.requestRow.req_photo_link).toContain('photo-1.webp');
  expect(f.state.requestRow.av_note).toBe('HEALTHY LOCAL NOTE');
  expect(f.state.master.av_note).toBe('HEALTHY LOCAL NOTE');
  expect(f.state.master.photo_link).toContain('photo-1.webp');
  await expect.poll(() => f.state.productivity.length).toBe(1);
  const acknowledgedVersion = f.state.requestRow.row_version;
  // Reopen after the completed Request view has published its acknowledged
  // history and finished deferred reads. The separate durability scenario
  // intentionally reloads during an unfinished upload acknowledgement.
  await page.evaluate(() => (window as any).openManagerSalesRepsModule());
  await expect.poll(() => page.evaluate(() => window.eval(`activeReqTab === 'reps'
    && canUseVerifiedProductionData(['master','requests','requestHistory','salesCredits'])`))).toBe(true);
  await expect.poll(() => page.evaluate(id => window.eval(`findRequestRowByUniqueId(${JSON.stringify(id)})?.DATE_COMPLETED`), REQUEST_ID))
    .toBe(f.state.requestRow.date_completed);
  await page.waitForLoadState('networkidle');
  await f.open(true);
  await expect(page.locator('#req-av-note')).toHaveValue('HEALTHY LOCAL NOTE');
  await expect.poll(() => browserState(page)).toMatchObject({ photo: expect.stringContaining('photo-1.webp') });
  expect(f.state.requestRow.row_version).toBe(acknowledgedVersion);
  expect(f.state.saves.filter(save => save.complete)).toHaveLength(1);
  expect(f.state.productivity).toHaveLength(1);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('Request camera return waits for unchanged foreground verification without losing the selected File', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  const release = f.holdMetadata();
  await page.evaluate(() => { (window as any).__requestForegroundCheck = (window as any).getProductionLiveSyncCoordinator().check('request-camera-return'); });
  await expect.poll(() => f.state.heldMetadata).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.eval(`isProductionMasterDetailBindingCurrent(activeItem)`))).toBe(true);
  // An already-reviewed row can be temporarily checking when the camera opens.
  // Retaining that File is distinct from permitting its upload before checking.
  await launchCamera(page);
  await chooseCameraPhoto(page);
  expect(f.state.uploads).toHaveLength(0);
  release();
  await expect.poll(() => f.state.uploads.length).toBe(1);
  await expect.poll(() => String(f.state.requestRow.req_photo_link)).toContain('photo-1.webp');
  expect(f.state.unexpectedWrites).toEqual([]);
});

test('Request Mark Done waits for verification started while its confirmation is open', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  await launchCamera(page);
  await chooseCameraPhoto(page);
  await expect.poll(() => String(f.state.requestRow.req_photo_link)).toContain('photo-1.webp');
  await expect.poll(() => browserState(page)).toMatchObject({ detailVerified: true, datasetsVerified: true });
  await clickMarkDone(page);
  await expect(page.getByRole('heading', { name: 'Publish in app?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NO', exact: true }).click();
  await expect(page.locator('#mark-done-confirm-modal')).toBeVisible();
  const releaseMetadata = f.holdMetadata();
  await page.evaluate(() => {
    (window as any).__requestCompletionCheck = (window as any).getProductionLiveSyncCoordinator()
      .check('request-completion-confirmation');
  });
  await expect.poll(() => f.state.heldMetadata).toBeGreaterThan(0);
  await expect.poll(() => browserState(page)).toMatchObject({ datasetsVerified: false });
  await page.locator('#mark-done-confirm-modal').getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('#mark-done-confirm-modal')).not.toBeVisible();
  expect(f.state.saves.filter(save => save.complete)).toHaveLength(0);
  expect(f.state.requestRow.req_status).toBe('Pending');
  releaseMetadata();
  await expect.poll(() => f.state.saves.filter(save => save.complete).length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__requestRepairObservations.settled
    .some((call: any) => call.name === 'saveData' && call.complete))).toBe(true);
  expect(f.state.requestRow.req_status).toBe('Complete');
  expect(f.state.requestRow.req_photo_link).toContain('photo-1.webp');
  expect(f.state.uploads).toHaveLength(1);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('Request Mark Done waits for current verification before opening its confirmation', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  await launchCamera(page);
  await chooseCameraPhoto(page);
  await expect.poll(() => String(f.state.requestRow.req_photo_link)).toContain('photo-1.webp');
  await expect.poll(() => browserState(page)).toMatchObject({ detailVerified: true, datasetsVerified: true });
  await expect(page.locator('#req-btn-save-complete')).toBeEnabled();
  const releaseMetadata = f.holdMetadata();
  await page.evaluate(() => {
    // Start the real check at the user's initially enabled click boundary,
    // before its normal inline saveData handler runs. No action is forced.
    document.getElementById('req-btn-save-complete')!.addEventListener('click', () => {
      (window as any).__requestCompletionEntryCheck = (window as any).getProductionLiveSyncCoordinator()
        .check('request-completion-entry');
    }, { capture: true, once: true });
  });
  await clickMarkDone(page);
  await expect.poll(() => f.state.heldMetadata).toBeGreaterThan(0);
  await expect.poll(() => browserState(page)).toMatchObject({ datasetsVerified: false });
  expect(await page.evaluate(() => window.eval('isProductionMasterDetailBindingCurrent(activeItem)'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Publish in app?', exact: true })).not.toBeVisible();
  expect(f.state.saves.filter(save => save.complete)).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__requestRepairObservations.toasts
    .some((toast: any[]) => toast[0] === 'Restricted'))).toBe(false);
  releaseMetadata();
  await expect(page.getByRole('heading', { name: 'Publish in app?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NO', exact: true }).click();
  await expect(page.locator('#mark-done-confirm-modal')).toBeVisible();
  await page.locator('#mark-done-confirm-modal').getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => f.state.saves.filter(save => save.complete).length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__requestRepairObservations.settled
    .some((call: any) => call.name === 'saveData' && call.complete))).toBe(true);
  expect(f.state.requestRow.req_status).toBe('Complete');
  expect(f.state.requestRow.req_photo_link).toContain('photo-1.webp');
  expect(f.state.uploads).toHaveLength(1);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('Request photo and completion remain denied when native Request capabilities are denied', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!, false); await f.open();
  expect((await browserState(page)).rolePhoto).toBe(false);
  await chooseCameraPhoto(page);
  await page.evaluate(async () => { await (window as any).saveData(true, 'req-'); });
  expect(f.state.uploads).toHaveLength(0);
  expect(f.state.saves).toHaveLength(0);
  expect(f.state.unexpectedWrites).toEqual([]);
});

test('Request camera return does not reuse a reviewed binding after a changed master revision', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  await launchCamera(page);
  const release = f.holdMetadata();
  await page.evaluate(() => { (window as any).__requestForegroundCheck = (window as any).getProductionLiveSyncCoordinator().check('request-camera-return'); });
  await expect.poll(() => f.state.heldMetadata).toBeGreaterThan(0);
  await chooseCameraPhoto(page);
  f.state.master.spec = 'CHANGED REMOTELY'; f.state.revisions.ph_master_inventory = 2;
  release();
  await expect.poll(() => page.evaluate(() => window.eval(`productionMasterDetailSession?.status`))).toBe('changed');
  await page.evaluate(async () => { await (window as any).saveData(true, 'req-'); });
  expect(f.state.uploads).toHaveLength(0);
  expect(f.state.saves).toHaveLength(0);
  expect((await browserState(page)).detailVerified).toBe(false);
});

test('Request AV-note blur waits for verification and autosaves the valid edit exactly once', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  const note = page.locator('#req-av-note');
  await expect.poll(() => page.evaluate(() => window.eval(`cellularPushEnrollmentTimer === null`))).toBe(true);
  for (const [selector, label] of [['#push-permission-help-modal', 'Close'], ['#mobile-push-enable-prompt', 'Dismiss']]) {
    const prompt = page.locator(selector);
    await page.removeLocatorHandler(prompt);
    if (await prompt.isVisible()) await prompt.getByRole('button', { name: label, exact: true }).click();
  }
  await expect(note).toBeEditable();
  await page.waitForLoadState('networkidle');
  await expect.poll(() => browserState(page)).toMatchObject({ detailVerified: true, datasetsVerified: true });
  const baselineSaves = f.state.saves.length;
  const baselineVersion = f.state.requestRow.row_version;
  const baselineCalls = await page.evaluate(() => (window as any).__requestRepairObservations.calls
    .filter((call: any) => call.name === 'saveData' && !call.complete).length);
  const releaseMetadata = f.holdMetadata();
  const editedInput = await note.evaluate(element => {
    const input = element as HTMLInputElement;
    if (input.disabled || input.readOnly || !window.eval(`hasProductionMasterDetailForItem(activeItem)
      && canUseVerifiedProductionData(getProductionDetailDatasetKeys('req-'))`)) {
      throw new Error('The Request field must be editable and verified before the edit');
    }
    // The edit occurs while enabled. Its native blur starts a real check
    // before the original 200ms autosave, matching the observed camera race.
    element.addEventListener('blur', () => {
      (window as any).__requestBlurCheck = (window as any).getProductionLiveSyncCoordinator()
        .check('request-note-blur');
    }, { capture: true, once: true });
    // Keep the input/blur boundary in one browser turn. Both real app handlers
    // run, including the normal input debounce, before the held check resolves.
    input.focus();
    input.value = 'HEALTHY VERIFIED BLUR NOTE';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const edited = { value: input.value, editable: !input.disabled,
      timerPending: window.eval(`!!detailInputSaveTimers['req-']`) };
    input.blur();
    return edited;
  });
  expect(editedInput).toEqual({
    value: 'HEALTHY VERIFIED BLUR NOTE', editable: true, timerPending: true });
  await expect.poll(() => f.state.heldMetadata).toBeGreaterThan(0);
  // Keep checking through both the 200ms blur save and the real input debounce;
  // neither may silently consume the draft while its verification is pending.
  await expect.poll(() => page.evaluate(() => (window as any).__requestRepairObservations.calls
    .filter((call: any) => call.name === 'saveData' && !call.complete).length)).toBeGreaterThanOrEqual(baselineCalls + 2);
  await expect.poll(() => page.evaluate(() => window.eval(`!!detailInputSaveTimers['req-']`))).toBe(false);
  await expect.poll(() => browserState(page)).toMatchObject({ datasetsVerified: false });
  expect(f.state.saves).toHaveLength(baselineSaves);
  releaseMetadata();
  await expect.poll(() => f.state.saves.length).toBe(baselineSaves + 1);
  await expect.poll(() => page.evaluate(() => (window as any).__requestRepairObservations.settled
    .some((call: any) => call.name === 'saveData' && !call.complete))).toBe(true);
  await expect.poll(() => browserState(page)).toMatchObject({ detailVerified: true, datasetsVerified: true });
  await page.waitForLoadState('networkidle');
  expect(f.state.requestRow.av_note).toBe('HEALTHY VERIFIED BLUR NOTE');
  expect(f.state.master.av_note).toBe('HEALTHY VERIFIED BLUR NOTE');
  expect(f.state.saves).toHaveLength(baselineSaves + 1);
  expect(f.state.saves[baselineSaves]).toMatchObject({ complete: false, expected_version: baselineVersion });
  expect(f.state.uploads).toHaveLength(0);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('Request camera hidden across AV-note acknowledgement resumes exact verification before using the retained photo', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  const releaseAck = f.holdSaveAcknowledgement();
  await page.locator('#req-av-note').focus();
  await page.locator('#req-av-note').fill('HEALTHY CAMERA NOTE');
  await launchCamera(page);
  await page.locator('#req-av-note').evaluate(element => (element as HTMLInputElement).blur());
  await expect.poll(() => f.state.saves.length).toBe(1);
  await setCameraPageHidden(page, true);
  releaseAck();
  await expect.poll(() => browserState(page)).toMatchObject({ hidden: true, ownSaveDeferred: true, detailVerified: false });
  expect(f.state.master.av_note).toBe('HEALTHY CAMERA NOTE');
  expect(f.state.revisions.ph_master_inventory).toBe(2);
  expect(f.state.uploads).toHaveLength(0);
  await setCameraPageHidden(page, false);
  await chooseCameraPhoto(page);
  await expect.poll(() => String(f.state.requestRow.req_photo_link)).toContain('photo-1.webp');
  await expect.poll(() => browserState(page)).toMatchObject({ detailStatus: 'ready', detailVerified: true, retainedFiles: [] });
  await expect(page.locator('#req-av-note')).toHaveValue('HEALTHY CAMERA NOTE');
  expect(f.state.master.av_note).toBe('HEALTHY CAMERA NOTE');
  expect(f.state.uploads).toHaveLength(1);
  expect(f.state.saves.filter(save => save.complete)).toHaveLength(0);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('Request retains an offline camera File, blocks Done despite an existing photo, and retries exactly once', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  const existing = 'https://request-photo-fixture.invalid/storage/v1/object/public/plant_photos/v2/existing.webp';
  Object.assign(f.state.master, { photo_link: existing, photo_name: 'existing.webp' });
  Object.assign(f.state.requestRow, { req_photo_link: existing, req_photo_name: 'existing.webp' });
  await f.open();
  expect((await browserState(page)).photo).toContain('existing.webp');
  await launchCamera(page);
  await page.context().setOffline(true);
  await chooseCameraPhoto(page);
  await expect(page.locator('#request-photo-selection-state')).toContainText('Reconnect');
  await expect(page.locator('[data-request-photo-retry]')).toBeDisabled();
  await expect.poll(() => browserState(page)).toMatchObject({ online: false, retainedFiles: ['synthetic-camera.png'] });
  await page.evaluate(() => { (window as any).saveData(true, 'req-'); });
  await expect.poll(() => page.evaluate(() => (window as any).__requestRepairObservations.toasts.some((toast: any[]) => toast[0] === 'Photo Not Saved'))).toBe(true);
  await expect(page.locator('#mark-done-confirm-modal')).not.toBeVisible();
  expect(f.state.saves).toHaveLength(0);
  expect(f.state.uploads).toHaveLength(0);
  const releaseUpload = f.holdUpload();
  await page.context().setOffline(false);
  await expect(page.locator('[data-request-photo-retry]')).toBeEnabled();
  await page.locator('[data-request-photo-retry]').click();
  await expect.poll(() => f.state.uploads.length).toBe(1);
  await expect(page.locator('[data-request-photo-retry]')).toBeDisabled();
  // The real handler must reject overlapping retry while its upload is pending.
  await page.locator('[data-request-photo-retry]').dispatchEvent('click');
  expect(f.state.uploads).toHaveLength(1);
  releaseUpload();
  await expect.poll(() => String(f.state.requestRow.req_photo_link)).toContain('photo-1.webp');
  await expect.poll(() => browserState(page)).toMatchObject({ retainedFiles: [], detailVerified: true });
  await expect(page.locator('#request-photo-selection-state')).not.toBeVisible();
  expect(f.state.requestRow.req_photo_link).toContain('existing.webp');
  expect(f.state.uploads).toHaveLength(1);
  expect(f.state.saves.filter(save => save.complete)).toHaveLength(0);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('Request photo upload response cannot publish or save into a changed reviewed row', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  const releaseUpload = f.holdUpload();
  await launchCamera(page);
  await chooseCameraPhoto(page);
  await expect.poll(() => f.state.uploads.length).toBe(1);
  f.state.master.spec = 'REMOTE CHANGE DURING UPLOAD';
  f.state.revisions.ph_master_inventory = 2;
  await page.evaluate(() => { (window as any).__requestUploadFenceCheck = (window as any).getProductionLiveSyncCoordinator().check('request-upload-remote-change'); });
  await expect.poll(() => page.evaluate(() => window.eval(`productionMasterDetailSession?.status`))).toBe('changed');
  releaseUpload();
  await expect.poll(() => page.evaluate(() => window.eval(`pendingRequestCameraSelection?.uploading || 0`))).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).pendingPhotoUploads.size)).toBe(0);
  expect(f.state.saves).toHaveLength(0);
  expect(f.state.requestRow.req_photo_link).toBe('');
  await expect.poll(() => browserState(page)).toMatchObject({ detailVerified: false, photo: '',
    retainedFiles: ['synthetic-camera.png'], retainedState: 'retry' });
  await expect(page.locator('#request-photo-selection-state')).toContainText('retained');
  const stored = await page.evaluate(async () => (await (window as any).getAllIndexedDbRecords('request_blobs'))
    .map((record: any) => ({ requestId: record.requestId, acknowledged: record.acknowledged, bytes: record.blob?.size || 0 })));
  expect(stored).toEqual([expect.objectContaining({ requestId: REQUEST_ID, acknowledged: false, bytes: expect.any(Number) })]);
  expect(stored[0].bytes).toBeGreaterThan(0);
  expect(f.state.uploads).toHaveLength(1);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});

test('Request photo bytes, MIME and filenames survive reload in native IndexedDB before upload acknowledgement', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!); await f.open();
  const releaseUpload = f.holdUpload();
  await launchCamera(page);
  const original = await chooseCameraPhoto(page, true);
  // Reaching the held HTTP upload requires the real Request queue to complete
  // its durable write first. No upload response or Request save is acknowledged.
  await expect.poll(() => f.state.uploads.length).toBe(1);
  const readRetainedPhoto = async () => page.evaluate(async requestId => {
    const w = window as any;
    const records = await w.getAllIndexedDbRecords('request_blobs');
    const matches = records.filter((record: any) => record.requestId === requestId);
    if (matches.length !== 1) throw new Error(`Expected one retained Request photo; found ${matches.length}.`);
    const record = matches[0], blob = record.blob;
    const db = await w.openDB();
    let raw;
    try {
      raw = await new Promise<any>((resolve, reject) => {
        const request = db.transaction('request_blobs', 'readonly').objectStore('request_blobs').get(record.blobId);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
    return { count: matches.length, blobId: record.blobId, requestId: record.requestId,
      fileName: record.fileName, contentType: record.contentType, acknowledged: record.acknowledged,
      file: { name: blob.name, type: blob.type, lastModified: blob.lastModified,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) },
      native: { storage: raw.blobStorage, hasBlob: Object.prototype.hasOwnProperty.call(raw, 'blob'),
        bytesType: Object.prototype.toString.call(raw.blobBytes),
        bytes: Array.from(new Uint8Array(raw.blobBytes)) } };
  }, REQUEST_ID);
  const before = await readRetainedPhoto();
  expect(before).toMatchObject({ count: 1, requestId: REQUEST_ID, contentType: 'image/png', acknowledged: false,
    file: original, native: { storage: 'arraybuffer-v1', hasBlob: false,
      bytesType: '[object ArrayBuffer]', bytes: original.bytes } });
  expect(before.fileName).toMatch(/\.png$/i);
  expect(before.blobId).toContain(`request:${REQUEST_ID}:`);
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#view-home')).toBeVisible();
  releaseUpload();
  expect(await readRetainedPhoto()).toEqual(before);
  expect(f.state.requestRow.req_photo_link).toBe('');
  expect(f.state.uploads).toHaveLength(1);
  expect(f.state.saves).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__requestIndexedDbErrors)).toEqual([]);
  expect(f.state.unexpectedWrites).toEqual([]);
  expect(f.state.errors).toEqual([]);
});
