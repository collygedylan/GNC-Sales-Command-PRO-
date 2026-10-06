const ALLOWED_APP_API = new Set(['bootstrap', 'save', 'capture_delivery', 'photo_upload_url', 'photo_commit']);
const PATCH_FIELDS = new Set(['note', 'notes', 'dock_spec', 'dockspec', 'caliper', 'av_note', 'avnote', 'locationcode', 'quantity', 'ptravailable', 'completed', 'match_percent', 'match_quantity', 'initial_ptr']);

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const jsonResponse = (value, status, ResponseCtor) => new ResponseCtor(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const normalized = (value) => String(value ?? '').trim().toLowerCase();

function rowMatches(row, filter = {}) {
  const value = row?.[filter.field] ?? row?.[String(filter.field || '').toUpperCase()];
  const expected = filter.value;
  switch (filter.op) {
    case 'eq': return String(value ?? '') === String(expected ?? '');
    case 'neq': return String(value ?? '') !== String(expected ?? '');
    case 'in': return Array.isArray(expected) && expected.some((entry) => String(value ?? '') === String(entry));
    case 'is': return expected === null ? value == null : value === expected;
    case 'not.is': return expected === null ? value != null : value !== expected;
    case 'ilike': return normalized(value).includes(normalized(expected).replaceAll('%', ''));
    case 'not.ilike': return !normalized(value).includes(normalized(expected).replaceAll('%', ''));
    case 'gte': return String(value ?? '') >= String(expected ?? '');
    case 'lte': return String(value ?? '') <= String(expected ?? '');
    case 'gt': return String(value ?? '') > String(expected ?? '');
    case 'lt': return String(value ?? '') < String(expected ?? '');
    default: return false;
  }
}

function pageRows(rows, params = {}) {
  const filters = Array.isArray(params.filters) ? params.filters : [];
  const anyOf = Array.isArray(params.anyOf) ? params.anyOf : [];
  let selected = rows.filter((row) => filters.every((filter) => rowMatches(row, filter))
    && (!anyOf.length || anyOf.some((filter) => rowMatches(row, filter))));
  for (const order of [...(params.order || [])].reverse()) {
    const field = order.field;
    selected = selected.slice().sort((a, b) => String(a?.[field] ?? '').localeCompare(String(b?.[field] ?? '')) * (order.ascending === false ? -1 : 1));
  }
  const offset = Math.max(0, Number(params.offset) || 0);
  const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
  return { rows: selected.slice(offset, offset + limit), total: selected.length, offset, limit, hasMore: offset + limit < selected.length };
}

function withLegacyPhotoFields(row = {}) {
  const photos = Array.isArray(row.photos) ? row.photos : [];
  const links = photos.map((photo) => String(photo?.url || '')).filter(Boolean);
  const names = photos.map((photo) => String(photo?.name || '')).filter(Boolean);
  const link = links.join(',');
  const name = names.join(',');
  return { ...row, photo_links: links, photo_names: names, photo_link: link, PHOTO_LINK: link,
    saved_photo_link: link, SAVED_PHOTO_LINK: link, photo_name: name, PHOTO_NAME: name,
    saved_photo_name: name, SAVED_PHOTO_NAME: name };
}

function bearer(headers) {
  const value = headers.get('authorization') || headers.get('Authorization') || '';
  return value.startsWith('Bearer ') ? value : '';
}

function legacyCollection(table) {
  if (['ph_master_inventory', 'ph_master_inventory_live_rows'].includes(String(table).toLowerCase())) return 'inventory';
  if (['ph_active_request', 'ph_active_request_live_rows', 'ph_request_queue_live_rows'].includes(String(table).toLowerCase())) return 'requests';
  return '';
}

function stagingPatch(collection, body = {}) {
  const aliases = collection === 'requests' ? {
    spec: 'dock_spec', req_spec: 'dock_spec', SPEC: 'dock_spec', REQ_SPEC: 'dock_spec',
    req_caliper: 'caliper', CALIPER: 'caliper', REQ_CALIPER: 'caliper',
    req_pic_note: 'note', pic_note: 'note', PIC_NOTE: 'note', REQ_PIC_NOTE: 'note',
    req_av_note: 'av_note', AV_NOTE: 'av_note', REQ_AV_NOTE: 'av_note',
    match: 'match_percent', req_match: 'match_percent', MATCH: 'match_percent', REQ_MATCH: 'match_percent',
    loc_match_qty: 'match_quantity', LOC_MATCH_QTY: 'match_quantity', initial_ptr: 'initial_ptr', INITIAL_PTR: 'initial_ptr',
  } : { SPEC: 'dock_spec', spec: 'dock_spec', CALIPER: 'caliper', AV_NOTE: 'av_note', MATCH: 'match_percent', LOC_MATCH_QTY: 'match_quantity', INITIAL_PTR: 'initial_ptr', SALES_NOTE: 'note', sales_note: 'note' };
  const patch = {};
  for (const [key, value] of Object.entries(object(body))) {
    const field = aliases[key] || key.toLowerCase();
    if (PATCH_FIELDS.has(field)) patch[field] = value;
  }
  return patch;
}

async function stableCommandId(value) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  const hex = [...digest].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('').split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const valueHex = hex.join('');
  return `${valueHex.slice(0, 8)}-${valueHex.slice(8, 12)}-${valueHex.slice(12, 16)}-${valueHex.slice(16, 20)}-${valueHex.slice(20)}`;
}

export function createStagingAdapter({ config, fetchImpl = globalThis.fetch, ResponseCtor = globalThis.Response, eventTarget = globalThis.window }) {
  const sandbox = new URL(config.sandboxUrl);
  const appOrigin = new URL(config.appOrigin).origin;
  const prefix = `https://${sandbox.hostname}`;
  const bootstrapCache = new Map();
  const BOOTSTRAP_TTL_MS = 10_000;
  let activeDisposer = null;

  function clearBootstrapCache(authorization = '') {
    if (authorization) bootstrapCache.delete(authorization);
    else bootstrapCache.clear();
  }

  async function callBackend(command, authorization) {
    if (!authorization) return { ok: false, status: 401, payload: { error: 'TEARDOWN_SIGN_IN_REQUIRED' } };
    const response = await fetchImpl(`${prefix}/functions/v1/teardown-api`, {
      method: 'POST', headers: { apikey: config.publishableKey, Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    let payload;
    try { payload = await response.json(); }
    catch (error) {
      return { ok: false, status: response.status, payload: { error: 'TEARDOWN_INVALID_BACKEND_RESPONSE', message: String(error?.message || 'Backend returned invalid JSON.').slice(0, 160) } };
    }
    return { ok: response.ok, status: response.status, payload: object(payload) };
  }

  async function bootstrap(authorization) {
    if (!authorization) throw Object.assign(new Error('TEARDOWN_SIGN_IN_REQUIRED'), { status: 401 });
    const key = authorization;
    const cached = bootstrapCache.get(key);
    if (cached && Date.now() - cached.at < BOOTSTRAP_TTL_MS) return cached.data;
    clearBootstrapCache();
    const result = await callBackend({ operation: 'bootstrap' }, authorization);
    if (!result.ok) throw Object.assign(new Error(result.payload.error || 'TEARDOWN_LOAD_FAILED'), { status: result.status });
    const data = { ...result.payload,
      inventory: (result.payload.inventory || []).map(withLegacyPhotoFields),
      requests: (result.payload.requests || []).map(withLegacyPhotoFields) };
    bootstrapCache.set(key, { at: Date.now(), data });
    return data;
  }

  async function backendResponse(command, authorization) {
    const result = await callBackend(command, authorization);
    if (command.operation === 'save' || command.operation === 'photo_commit') clearBootstrapCache(authorization);
    return jsonResponse(result.ok ? result.payload : { ...object(result.payload), error: result.payload.error || 'TEARDOWN_REQUEST_FAILED' }, result.ok ? 200 : result.status, ResponseCtor);
  }

  async function legacyApi(url, body, request, authorization) {
    if (body.operation && ALLOWED_APP_API.has(body.operation)) return backendResponse(body, authorization);
    if (body.action === 'native_session_bridge') {
      const data = await bootstrap(authorization);
      return jsonResponse({ ok: true, session: { token: 'teardown-sandbox-session', expiresAt: Date.now() + 3600000,
        username: data.profile.username, displayName: data.profile.display_name || data.profile.full_name, role: data.profile.role } }, 200, ResponseCtor);
    }
    if (body.action === 'inventory_read' && ['master_page', 'master_delta'].includes(body.operation)) {
      const data = await bootstrap(authorization);
      const params = object(body.params);
      const selected = data.inventory || [];
      const rows = params.uniqueId ? selected.filter((row) => row.unique_id === params.uniqueId) : selected;
      const page = pageRows(rows, params);
      const contract = eventTarget?.AgMetricInventoryList || {};
      const projection = String(params.projection || 'initial_base');
      const validatedProjection = ['browse', 'full'].includes(projection) ? projection : '';
      const columns = validatedProjection ? (validatedProjection === 'full' ? contract.physicalColumns : contract.columns) || [] : [];
      return jsonResponse({ ok: true, data: { ...page, projection: validatedProjection, fieldCoverage: validatedProjection, columns } }, 200, ResponseCtor);
    }
    if (body.action === 'dataset_read' && ['active_request', 'request_queue'].includes(body.dataset)) {
      const data = await bootstrap(authorization);
      return jsonResponse({ ok: true, data: pageRows(data.requests || [], object(body.params)) }, 200, ResponseCtor);
    }
    if (body.action === 'db') return databaseAction(body, request, authorization);
    const params = new URL(url).searchParams;
    if (params.get('legacy_delivery') === 'email') return captureLegacyDelivery(body, authorization);
    return unavailable(body.action || body.operation || 'request');
  }

  async function databaseAction(body, request, authorization) {
    const collection = legacyCollection(body.table);
    if (!collection) return unavailable(`database:${String(body.table || 'unknown')}`);
    if (body.method === 'GET') {
      const data = await bootstrap(authorization);
      const source = collection === 'inventory' ? data.inventory : data.requests;
      const params = new URLSearchParams(String(body.query || ''));
      const rows = source.filter((row) => [...params].every(([field, expression]) => {
        if (['select', 'order', 'limit', 'offset'].includes(field)) return true;
        const dot = expression.indexOf('.');
        if (dot < 0) return true;
        return rowMatches(row, { field, op: expression.slice(0, dot), value: expression.slice(dot + 1) });
      }));
      return jsonResponse({ ok: true, data: rows }, 200, ResponseCtor);
    }
    if (!['PATCH', 'POST'].includes(body.method) || body.method === 'POST') return unavailable(`database:${body.method}`);
    const data = await bootstrap(authorization);
    const source = collection === 'inventory' ? data.inventory : data.requests;
    const idMatch = String(body.query || '').match(/(?:^|&)unique_id=eq\.([^&]+)/i);
    const id = decodeURIComponent(idMatch?.[1] || body.body?.unique_id || body.body?.UNIQUE_ID || body.body?.id || '');
    const row = source.find((entry) => entry.unique_id === id);
    if (!row) return unavailable(`row:${id || 'unknown'}`);
    const supplied = object(body.body);
    const patch = stagingPatch(collection, supplied);
    if (!Object.keys(patch).length) {
      const photoLink = String(supplied.photo_link || supplied.PHOTO_LINK || supplied.saved_photo_link || supplied.SAVED_PHOTO_LINK || '').trim();
      const alreadyCommitted = photoLink && (row.photos || []).some((photo) => photo.url === photoLink || photo.path === photoLink);
      if (alreadyCommitted) return jsonResponse({ ok: true, data: [row] }, 200, ResponseCtor);
      return unavailable('write-fields');
    }
    const suppliedId = request.headers.get('idempotency-key') || request.headers.get('x-request-id') || '';
    const idempotency = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId)
      ? suppliedId : globalThis.crypto?.randomUUID?.();
    const command = { operation: 'save', collection, id, expectedRevision: Number(row._staging_revision || 1), requestId: idempotency, patch };
    const result = await callBackend(command, authorization);
    if (!result.ok) return jsonResponse({ ok: false, error: result.payload.error || 'TEARDOWN_SAVE_FAILED', status: result.status }, result.status, ResponseCtor);
    clearBootstrapCache(authorization);
    return jsonResponse({ ok: true, data: [result.payload.row] }, 200, ResponseCtor);
  }

  async function driveEvidenceRpc(request, authorization) {
    let args;
    try { args = object(await request.clone().json()); }
    catch (error) { return unavailable(`drive-save-json:${String(error?.message || 'invalid JSON').slice(0, 40)}`); }
    const data = await bootstrap(authorization);
    const id = String(args.p_master_uid || '').trim();
    const row = (data.inventory || []).find((candidate) => candidate.unique_id === id);
    if (!row) return jsonResponse({ ok: false, code: 'DRIVE_ROW_NOT_FOUND', canonicalConfirmed: false }, 200, ResponseCtor);
    const expectedIdentity = [
      ['p_expected_itemcode', 'itemcode'], ['p_expected_locationcode', 'locationcode'], ['p_expected_lotcode', 'lotcode'],
    ];
    const identityConflict = expectedIdentity.some(([expected, field]) => args[expected]
      && String(args[expected]).trim().toLowerCase() !== String(row[field] ?? '').trim().toLowerCase());
    const evidence = object(args.p_evidence);
    const evidenceKeys = Object.keys(evidence);
    const photoOnlyCommittedUpdate = evidenceKeys.length > 0
      && evidenceKeys.every((key) => ['photo_link', 'photo_name'].includes(key))
      && (row.photos || []).some((photo) => String(evidence.photo_link || '').split(',').includes(String(photo.url || '')));
    if (identityConflict || (args.p_expected_signature && String(args.p_expected_signature) !== String(row.last_updated || '') && !photoOnlyCommittedUpdate)) {
      return jsonResponse({ ok: false, code: 'DRIVE_ROW_STALE', canonicalConfirmed: false, row: withLegacyPhotoFields(row), conflictFields: [] }, 200, ResponseCtor);
    }
    const patch = {};
    const fields = {
      spec: 'dock_spec', caliper: 'caliper', match: 'match_percent', loc_match_qty: 'match_quantity',
      initial_ptr: 'initial_ptr', av_note: 'av_note', pick_note: 'note', comments: 'notes',
    };
    for (const [source, target] of Object.entries(fields)) if (Object.hasOwn(evidence, source)) patch[target] = evidence[source];
    if (args.p_complete === true) patch.completed = true;
    if (!Object.keys(patch).length) {
      return jsonResponse({ ok: true, code: 'NO_CHANGES', canonicalConfirmed: true, row: withLegacyPhotoFields(row), requestRows: [] }, 200, ResponseCtor);
    }
    const requestId = await stableCommandId(args.p_idempotency_key || JSON.stringify({ id, patch }));
    const result = await callBackend({ operation: 'save', collection: 'inventory', id,
      expectedRevision: Number(row._staging_revision || 1), requestId, patch }, authorization);
    if (!result.ok) {
      const errorCode = String(result.payload.error || 'TEARDOWN_SAVE_FAILED');
      const code = errorCode === 'TEARDOWN_REVISION_CONFLICT' ? 'DRIVE_ROW_STALE'
        : errorCode === 'TEARDOWN_ROW_NOT_FOUND' ? 'DRIVE_ROW_NOT_FOUND'
          : errorCode === 'TEARDOWN_FIELD_FORBIDDEN' ? 'DRIVE_FIELD_CONFLICT' : 'DRIVE_SAVE_UNAVAILABLE';
      return jsonResponse({ ok: false, code, canonicalConfirmed: false, row: withLegacyPhotoFields(row), conflictFields: [] }, 200, ResponseCtor);
    }
    clearBootstrapCache(authorization);
    return jsonResponse({ ok: true, code: 'SAVED', canonicalConfirmed: true,
      row: withLegacyPhotoFields(result.payload.row), requestRows: [] }, 200, ResponseCtor);
  }

  async function uploadLegacyPhoto(request, authorization) {
    let form;
    try { form = await request.formData(); }
    catch (error) { return unavailable(`photo-form:${String(error?.message || 'invalid form data').slice(0, 40)}`); }
    const file = form.get('file');
    if (!(file instanceof Blob) || !file.size) return unavailable('photo-file');
    const prefixValue = String(form.get('prefix') || 'default');
    const collection = prefixValue === 'req-' ? 'requests' : 'inventory';
    const rowId = String(form.get('masterUid') || form.get('rowId') || form.get('unique_id') || '').trim();
    if (!rowId) return unavailable('photo-row-identity');
    const name = String(form.get('fileName') || file.name || 'photo.jpg').slice(0, 200);
    const contentType = String(file.type || 'application/octet-stream');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return unavailable('photo-type');
    const before = await bootstrap(authorization);
    const current = (collection === 'inventory' ? before.inventory : before.requests).find((row) => row.unique_id === rowId);
    if (!current) return unavailable(`photo-row:${rowId}`);
    const reservation = await callBackend({ operation: 'photo_upload_url', rowId, filename: name, contentType }, authorization);
    if (!reservation.ok) return jsonResponse({ ok: false, error: reservation.payload.error || 'TEARDOWN_UPLOAD_UNAVAILABLE' }, reservation.status, ResponseCtor);
    const signed = reservation.payload;
    const uploaded = await fetchImpl(signed.signedUrl, { method: signed.uploadMethod || 'PUT',
      headers: { ...object(signed.headers), 'Content-Type': signed.contentType || contentType }, body: file });
    if (!uploaded.ok) return jsonResponse({ ok: false, error: 'TEARDOWN_UPLOAD_FAILED' }, uploaded.status, ResponseCtor);
    const committed = await callBackend({ operation: 'photo_commit', collection, rowId, path: signed.path, filename: name,
      contentType, expectedRevision: Number(current._staging_revision || 1), requestId: globalThis.crypto?.randomUUID?.() }, authorization);
    if (!committed.ok) return jsonResponse({ ok: false, error: committed.payload.error || 'TEARDOWN_PHOTO_COMMIT_FAILED' }, committed.status, ResponseCtor);
    clearBootstrapCache(authorization);
    const photo = (committed.payload.row?.photos || []).find((entry) => entry.path === signed.path);
    return jsonResponse({ ok: true, publicUrl: photo?.url || '', filePath: signed.path, fileName: name, contentType }, 200, ResponseCtor);
  }

  async function captureLegacyDelivery(body, authorization) {
    const id = body.unique_id || body.rowId || body.item?.unique_id || body.row?.unique_id;
    if (!id) return unavailable('email-row-identity');
    const command = { operation: 'capture_delivery', collection: legacyCollection(body.table) || 'requests', rowId: String(id),
      channel: 'email', requestId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '')
        ? body.requestId : globalThis.crypto?.randomUUID?.() };
    const result = await callBackend(command, authorization);
    return jsonResponse(result.ok ? { status: 'success', captured: true, delivery: result.payload }
      : { status: 'error', error: result.payload.error || 'TEARDOWN_DELIVERY_FAILED' }, result.ok ? 200 : result.status, ResponseCtor);
  }

  function unavailable(scope) {
    return jsonResponse({ ok: false, error: 'TEARDOWN_MODULE_UNAVAILABLE', message: `This workflow is not enabled in the focused staging sandbox (${String(scope).slice(0, 80)}).` }, 422, ResponseCtor);
  }

  async function route({ input, init = {} }) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const authorization = bearer(request.headers);
    if (url.origin !== sandbox.origin && url.origin !== appOrigin) return jsonResponse({ error: 'TEARDOWN_EXTERNAL_REQUEST_BLOCKED' }, 403, ResponseCtor);
    if (url.origin === appOrigin) return null;
    if (url.pathname === '/auth/v1/logout') {
      clearBootstrapCache(authorization);
      return null;
    }
    if (url.pathname === '/auth/v1/token') clearBootstrapCache();
    if (url.pathname.startsWith('/auth/v1/')) return null;
    if (request.method === 'PUT' && /^\/storage\/v1\/object\/upload\/sign\/teardown-photos\//.test(url.pathname)) return null;
    if (request.method === 'GET' && /^\/storage\/v1\/object\/sign\/teardown-photos\//.test(url.pathname)) return null;
    if (url.pathname === '/rest/v1/profiles' && request.method === 'GET') {
      try { return jsonResponse((await bootstrap(authorization)).profile, 200, ResponseCtor); }
      catch (error) { return jsonResponse({ error: error.message }, error.status || 401, ResponseCtor); }
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      if (url.pathname === '/functions/v1/teardown-api' && request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) {
        return uploadLegacyPhoto(request, authorization);
      }
      let body = {};
      try { body = await request.clone().json(); }
      catch (error) { return unavailable(`malformed-function-payload:${String(error?.message || 'invalid JSON').slice(0, 40)}`); }
      if (url.pathname === '/functions/v1/teardown-api') {
        if (url.searchParams.get('legacy_delivery') === 'email') return captureLegacyDelivery(body, authorization);
        if (ALLOWED_APP_API.has(body.operation)) return backendResponse(body, authorization);
        return legacyApi(url, body, request, authorization);
      }
      return unavailable(url.pathname.split('/').pop());
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (url.pathname === '/rest/v1/rpc/get_request_capabilities' && request.method === 'POST') {
        const data = await bootstrap(authorization);
        return data.request_capabilities
          ? jsonResponse(data.request_capabilities, 200, ResponseCtor)
          : unavailable('rpc:get_request_capabilities');
      }
      if (url.pathname === '/rest/v1/rpc/get_my_app_permissions_v1' && request.method === 'POST') {
        const data = await bootstrap(authorization);
        return data.app_access
          ? jsonResponse(data.app_access, 200, ResponseCtor)
          : unavailable('rpc:get_my_app_permissions_v1');
      }
      if (url.pathname === '/rest/v1/rpc/save_drive_evidence_v2' && request.method === 'POST') return driveEvidenceRpc(request, authorization);
      if (!['GET', 'HEAD'].includes(request.method)) return unavailable('direct-database-write');
      const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length).split('/')[0]);
      const collection = legacyCollection(table);
      if (!collection) return unavailable(`database:${table}`);
      const data = await bootstrap(authorization);
      const source = collection === 'inventory' ? data.inventory : data.requests;
      const rows = source.filter((row) => [...url.searchParams].every(([field, expression]) => {
        if (['select', 'order', 'limit', 'offset'].includes(field)) return true;
        const dot = expression.indexOf('.');
        return dot < 0 || rowMatches(row, { field, op: expression.slice(0, dot), value: expression.slice(dot + 1) });
      }));
      return jsonResponse(pageRows(rows, { limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }).rows, 200, ResponseCtor);
    }
    return unavailable(`sandbox-endpoint:${request.method}:${url.pathname}`);
  }

  function install() {
    if (activeDisposer) return activeDisposer;
    const listener = (event) => {
      const detail = object(event.detail);
      if (typeof detail.respond !== 'function' || typeof detail.continue !== 'function') return;
      detail.respond(route({ input: detail.input, init: detail.init }).catch((error) => jsonResponse({
        error: 'TEARDOWN_ADAPTER_FAILED', message: String(error?.message || 'Staging request failed.').slice(0, 160),
      }, 502, ResponseCtor)));
    };
    const clearOnPageLifecycle = () => clearBootstrapCache();
    const clearWhenHidden = () => {
      if (eventTarget.document.visibilityState === 'hidden') clearBootstrapCache();
    };
    eventTarget.addEventListener('gnc:staging-fetch', listener);
    eventTarget.addEventListener('pagehide', clearOnPageLifecycle);
    eventTarget.addEventListener('pageshow', clearOnPageLifecycle);
    eventTarget.document?.addEventListener('visibilitychange', clearWhenHidden);
    showBanner(eventTarget.document);
    let disposed = false;
    activeDisposer = () => {
      if (disposed) return;
      disposed = true;
      eventTarget.removeEventListener('gnc:staging-fetch', listener);
      eventTarget.removeEventListener('pagehide', clearOnPageLifecycle);
      eventTarget.removeEventListener('pageshow', clearOnPageLifecycle);
      eventTarget.document?.removeEventListener('visibilitychange', clearWhenHidden);
      clearBootstrapCache();
      activeDisposer = null;
    };
    return activeDisposer;
  }

  return { route, install };
}

function showBanner(documentRef) {
  if (!documentRef?.body || documentRef.getElementById('gnc-staging-banner')) return;
  const configNode = documentRef.getElementById('gnc-staging-config');
  const config = JSON.parse(configNode?.textContent || '{}');
  const banner = documentRef.createElement('aside');
  banner.id = 'gnc-staging-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = `STAGING — SYNTHETIC DATA · ${String(config.commitSha || 'unpublished').slice(0, 12)} · Home, Que and Drive review only; other workflows unavailable. Email and push are captured.`;
  documentRef.body.prepend(banner);
}
