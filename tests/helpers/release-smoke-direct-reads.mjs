import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { inventoryReadFixture } from '../fixtures/inventory-list-read-fixture.mjs';
import { createPreindexedMasterPageFixture } from '../fixtures/preindexed-master-page-fixture.mjs';
import { readReleaseSmokeSocPage } from './release-smoke-soc-read.mjs';
import { poManagementDirectReadFixture, RELEASE_SMOKE_SUPABASE_ORIGIN } from './release-smoke-route-policy.mjs';

const databaseTypesSource = readFileSync(new URL('../../supabase/functions/_shared/database.types.ts', import.meta.url), 'utf8');

function readViewFieldTypes(view) {
  const match = databaseTypesSource.match(new RegExp(`${view}: \\{\\s+Row: \\{([\\s\\S]*?)\\n\\s+\\}\\n\\s+(?:Insert:|Relationships:)`));
  if (!match) throw new Error(`Missing generated database view contract: ${view}`);
  return [...match[1].matchAll(/^\s+([a-z0-9_]+): (string|number|boolean|Json)( \| null)?$/gm)]
    .map(([, field, type, nullable]) => [field, type, !!nullable]);
}

const activeSuspendFieldTypes = readViewFieldTypes('ph_active_suspend');
const socMasterFieldTypes = readViewFieldTypes('ph_soc_master');

export const RELEASE_SMOKE_DIRECT_OPERATIONAL_PATHS = new Set([
  '/rest/v1/ph_master_inventory',
  '/rest/v1/ph_soc_master',
  '/rest/v1/ph_reserves',
  '/rest/v1/ph_cav_import',
  '/rest/v1/ph_requests_pending',
  '/rest/v1/ph_active_suspend',
  '/rest/v1/ph_inventory_row_assignments',
  '/rest/v1/ph_location_sales_notes',
  '/rest/v1/user_access'
]);

const directReadSpecs = Object.freeze({
  ph_soc_master: { keys: 'limit,offset,order,select', order: 'unique_id.asc' },
  ph_reserves: { keys: 'limit,offset,select', order: null },
  ph_cav_import: { keys: 'limit,offset,select', order: null },
  ph_active_suspend: { keys: 'limit,offset,order,select', order: 'unique_id.asc' },
  ph_requests_pending: { keys: 'date_completed,limit,move_batch_id,offset,order,select', order: 'created_at.desc,unique_id.desc' },
  ph_inventory_row_assignments: { keys: 'limit,offset,order,present_in_drive,select', order: 'master_unique_id.asc' }
});

export function parseReleaseSmokeDirectOperationalRead(method, value) {
  const url = value instanceof URL ? value : new URL(value);
  if (String(method || '').toUpperCase() !== 'GET' || !RELEASE_SMOKE_DIRECT_OPERATIONAL_PATHS.has(url.pathname)) return null;
  const table = url.pathname.slice('/rest/v1/'.length);
  if (table === 'ph_master_inventory') {
    if (url.search === '?select=filename%2Clast_updated&last_updated=not.is.null&order=last_updated.desc&limit=30&offset=0') {
      return { table, limit: 30, offset: 0, metadata: true };
    }
    const keys = [...url.searchParams.keys()].sort().join(',');
    const select = url.searchParams.get('select') || '';
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset') || 0);
    const identity = keys === 'limit,select' && select === 'unique_id' && limit === 1;
    const offsetPage = keys === 'limit,offset,order,select';
    const cursor = url.searchParams.get('unique_id') || '';
    const keysetPage = keys === 'limit,order,select,unique_id' && /^gt\.[^\u0000-\u001f]{1,240}$/.test(cursor);
    const exactRow = keys === 'limit,offset,order,select,unique_id' && /^eq\.[^\u0000-\u001f]{1,240}$/.test(cursor)
      && limit === 1 && offset === 0;
    const page = (offsetPage || keysetPage || exactRow) && /^[a-z0-9_,]+$/.test(select)
      && url.searchParams.get('order') === 'unique_id.asc' && Number.isInteger(limit) && limit >= 1 && limit <= 5000
      && Number.isInteger(offset) && offset >= 0;
    return identity || page ? { table, limit, offset, query: url.searchParams.toString() } : null;
  }
  if (table === 'user_access') return url.search === '?select=*&order=username.asc&limit=1000'
    ? { table, limit: 1000, offset: 0 } : null;
  if (table === 'ph_location_sales_notes') {
    const itemCode = url.searchParams.get('itemcode') || '';
    return [...url.searchParams.keys()].sort().join(',') === 'itemcode,limit,select'
      && url.searchParams.get('select') === '*' && url.searchParams.get('limit') === '1000'
      && /^eq\.[A-Za-z0-9._-]{1,80}$/.test(itemCode) ? { table, limit: 1000, offset: 0 } : null;
  }
  if (['ph_soc_master', 'ph_reserves', 'ph_cav_import'].includes(table)
    && url.search === '?select=filename%2Clast_updated&last_updated=not.is.null&order=last_updated.desc&limit=30&offset=0') {
    return { table, limit: 30, offset: 0, metadata: true };
  }
  const spec = directReadSpecs[table];
  if (!spec) return null;
  const limit = Number(url.searchParams.get('limit'));
  const offset = Number(url.searchParams.get('offset'));
  if ([...url.searchParams.keys()].sort().join(',') !== spec.keys || url.searchParams.get('select') !== '*'
    || url.searchParams.get('order') !== spec.order || !Number.isInteger(limit) || limit < 1 || limit > 1000
    || !Number.isInteger(offset) || offset < 0
    || table === 'ph_requests_pending' && (url.searchParams.get('date_completed') !== 'is.null' || url.searchParams.get('move_batch_id') !== 'is.null')
    || table === 'ph_inventory_row_assignments' && url.searchParams.get('present_in_drive') !== 'eq.true') return null;
  return { table, limit, offset };
}

export function readReleaseSmokeDirectOperationalRows(spec, sourceRows = []) {
  if (!spec || spec.metadata || ['ph_requests_pending', 'ph_inventory_row_assignments', 'ph_location_sales_notes', 'ph_reserves', 'ph_cav_import'].includes(spec.table)) return [];
  if (spec.table === 'user_access') return releaseSmokeUserAccessRows();
  if (spec.table === 'ph_master_inventory') {
    let canonical = sourceRows.map(row => inventoryReadFixture.fromFixtureShape(row));
    const params = new URLSearchParams(spec.query);
    const cursor = params.get('unique_id') || '';
    if (cursor.startsWith('gt.')) canonical = canonical.filter(row => row.unique_id > cursor.slice(3));
    if (cursor.startsWith('eq.')) canonical = canonical.filter(row => row.unique_id === cursor.slice(3));
    params.delete('unique_id');
    return inventoryReadFixture.read(canonical, params.toString()).rows;
  }
  const dataset = spec.table === 'ph_active_suspend' ? 'suspend_tag' : 'soc';
  const operationalRows = spec.table === 'ph_active_suspend' ? selectLatestReleaseSmokeSourceRows(sourceRows) : sourceRows;
  const rows = readReleaseSmokeSocPage(operationalRows, dataset, { projection: 'default', offset: spec.offset,
    limit: Math.min(500, spec.limit), filters: [], anyOf: [], order: [{ field: 'unique_id', ascending: true }] }).rows;
  if (spec.table === 'ph_active_suspend') return rows.map(activeSuspendTableRow);
  return spec.table === 'ph_soc_master' ? rows.map(row => databaseTableRow(socMasterFieldTypes, row)) : rows;
}

export function selectLatestReleaseSmokeSourceRows(rows) {
  const latest = rows.reduce((winner, row) => String(row.LAST_UPDATED ?? row.last_updated ?? '')
    > String(winner?.LAST_UPDATED ?? winner?.last_updated ?? '') ? row : winner, null);
  const filename = String(latest?.FILENAME ?? latest?.filename ?? '');
  return filename ? rows.filter(row => String(row.FILENAME ?? row.filename ?? '') === filename) : rows;
}

function releaseSmokeUserAccessRows() {
  const viewPermissions = Object.fromEntries([
    'home', 'drive', 'drive_mode', 'av', 'que', 'que_request', 'que_suspend', 'managers', 'docks',
    'eval_reports', 'eval_reports_2', 'nursery_command_tables', 'inventory', 'qc', 'production',
    'comm', 'sales_office', 'historical_requests', 'hl_order'
  ].map(view => [`view_${view}`, 'Y']));
  return ['dylan_collyge', 'megan_kelly', 'jd_jones'].map(username => ({
    username, role: 'ADMIN', display_name: 'Isolated Suspend Done Test',
    make_request: 'Y', can_make_request: 'Y', request_all_reps: 'Y', view_all_requests: 'Y',
    view_all_suspend: 'Y', edit_any_row: 'Y', can_edit_all_rows: 'Y', view_permissions: viewPermissions
  }));
}

function activeSuspendValue(type, value) {
  if (value == null || String(value).trim() === '') return null;
  if (type === 'Json') return value;
  if (type === 'string') return String(value);
  if (type === 'boolean') return value === true || String(value).toLowerCase() === 'true';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function activeSuspendTableRow(row) {
  const source = { ...row };
  source.suspendto ??= source.suspend_to;
  source.status ??= 'Pending';
  source.request_type ??= 'suspend_tag';
  source.is_suspend_tag ??= true;
  return databaseTableRow(activeSuspendFieldTypes, source);
}

function databaseTableRow(fieldTypes, source) {
  return Object.fromEntries(fieldTypes.map(([field, type, nullable]) => {
    const value = activeSuspendValue(type, source[field]);
    if (!nullable && type !== 'Json' && value === null) throw new Error(`Missing required direct-read fixture field: ${field}`);
    return [field, value];
  }));
}

const sourceFreeDirectTables = new Set([
  'ph_requests_pending', 'ph_inventory_row_assignments', 'ph_reserves', 'ph_cav_import', 'user_access',
  'ph_location_sales_notes'
]);
const directOperationalCaches = new WeakMap();
let capturedSnapshot;

function readBrowserOperationalFixtureRows(table) {
  const key = table === 'ph_master_inventory' ? '__suspendCompletionMasterRows' : '__suspendCompletionFixtureRows';
  const rows = globalThis[key];
  return Array.isArray(rows) ? structuredClone(rows) : null;
}

function acceptsSyntheticDirectRead(headers) {
  const authorization = headers.authorization || '';
  const apiKey = headers.apikey || '';
  return authorization === 'Bearer browser-only-no-real-session'
    || !!apiKey && authorization === `Bearer ${apiKey}`;
}

async function directOperationalSourceRows(page, cache, spec) {
  if (spec.metadata || sourceFreeDirectTables.has(spec.table)) return [];
  if (spec.table === 'ph_master_inventory' && cache.master) return cache.master;
  if (spec.table === 'ph_active_suspend' && cache.suspend) return cache.suspend;
  const rows = await page.evaluate(readBrowserOperationalFixtureRows, spec.table).catch(() => null);
  if (spec.table === 'ph_master_inventory' && rows) cache.master = rows;
  if (spec.table === 'ph_active_suspend' && rows) cache.suspend = rows;
  return rows;
}

function createDirectOperationalRouteHandler(page, cache) {
  return async route => {
    const request = route.request();
    const url = new URL(request.url());
    let diagnostic = null;
    const tracedPath = ['/functions/v1/app-api', '/rest/v1/ph_soc_master', '/rest/v1/ph_active_suspend'].includes(url.pathname);
    if (url.origin === RELEASE_SMOKE_SUPABASE_ORIGIN && tracedPath) {
      let body = null;
      try { body = request.postDataJSON(); } catch {}
      diagnostic = { path: url.pathname, query: url.search, authorization: request.headers().authorization || '', body, matched: false };
      cache.diagnostics.push(diagnostic);
    }
    if (url.origin !== RELEASE_SMOKE_SUPABASE_ORIGIN || !acceptsSyntheticDirectRead(request.headers())) return route.fallback();
    const supplemental = readSupplementalFixture(request, url, cache);
    if (supplemental) {
      if (diagnostic) diagnostic.matched = true;
      return fulfillSupplementalFixture(route, supplemental);
    }
    const spec = parseReleaseSmokeDirectOperationalRead(request.method(), request.url());
    if (!spec) return route.fallback();
    const sourceRows = await directOperationalSourceRows(page, cache, spec);
    if (!sourceRows) return route.fallback();
    if (diagnostic) diagnostic.matched = true;
    const rows = readReleaseSmokeDirectOperationalRows(spec, sourceRows);
    const totalRows = spec.table === 'ph_master_inventory' ? sourceRows.length
      : readReleaseSmokeDirectOperationalRows({ ...spec, offset: 0, limit: 1000 }, sourceRows).length;
    const contentRange = rows.length ? `${spec.offset}-${spec.offset + rows.length - 1}/${totalRows}` : `*/${totalRows}`;
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*',
      'access-control-expose-headers': 'Content-Range', 'content-range': contentRange,
      'content-type': 'application/json' }, body: JSON.stringify(rows) });
  };
}

export function primeReleaseSmokeDirectOperationalRows(page, rows = []) {
  const cache = directOperationalCaches.get(page);
  if (!cache || !Array.isArray(rows)) return false;
  cache.master = structuredClone(rows);
  cache.masterPage = createPreindexedMasterPageFixture(cache.master);
  return true;
}

export function primeReleaseSmokeCapturedSnapshot(page) {
  const cache = directOperationalCaches.get(page);
  if (!cache) return false;
  capturedSnapshot ??= JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/suspend-v2314.json.gz', import.meta.url))).toString('utf8'));
  cache.master = capturedSnapshot.masterRows;
  cache.suspend = capturedSnapshot.suspendRows;
  cache.masterPage = createPreindexedMasterPageFixture(cache.master);
  return true;
}

export function readReleaseSmokeDirectDiagnostics(page) {
  return structuredClone(directOperationalCaches.get(page)?.diagnostics || []);
}

function installCurrentSuspendProjection(excludedPrefix) {
  let currentRows = [];
  const selectSuspendTab = () => {
    if (!currentRows.length || typeof globalThis.setReqTab !== 'function') return;
    const button = document.getElementById('tab-req-suspend-tag');
    if (!(button instanceof HTMLButtonElement) || button.getAttribute('aria-pressed') === 'true') return;
    button.click();
  };
  const tabObserver = new MutationObserver(selectSuspendTab);
  tabObserver.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed'] });
  Object.defineProperty(globalThis, '__suspendCompletionFixtureRows', {
    configurable: true,
    get: () => currentRows,
    set: rows => {
      currentRows = Array.isArray(rows) ? rows.filter(row => {
        const id = String(row?.UNIQUE_ID ?? row?.unique_id ?? '');
        const suspend = String(row?.SUSPEND ?? row?.suspend ?? '').trim().toUpperCase();
        const target = String(row?.SUSPENDTO ?? row?.SUSPEND_TO ?? row?.suspendto ?? row?.suspend_to ?? '').trim().toUpperCase();
        const completed = String(row?.DATE_COMPLETED ?? row?.date_completed ?? '').trim();
        return !id.startsWith(excludedPrefix) && suspend === 'SUSPEND' && target === 'DC' && !completed;
      }) : rows;
      queueMicrotask(selectSuspendTab);
    }
  });
}

export function installReleaseSmokeCurrentSuspendProjection(page) {
  return page.addInitScript(installCurrentSuspendProjection, 'isolated-older-source-');
}

function hasExactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === keys;
}

function readDefaultOwnerFixture(request, url) {
  if (request.method() !== 'GET' || url.pathname !== '/rest/v1/ph_itemcode_default_owners') return null;
  const keys = [...url.searchParams.keys()].sort().join(',');
  if (keys !== 'limit,offset,order,select' || url.searchParams.get('select') !== '*'
    || url.searchParams.get('order') !== 'itemcode_normalized.asc'
    || url.searchParams.get('limit') !== '1000' || !/^\d+$/.test(url.searchParams.get('offset') || '')) return null;
  return { rows: [] };
}

function readSupplementalFixture(request, url, cache) {
  const defaultOwners = readDefaultOwnerFixture(request, url);
  if (defaultOwners) return defaultOwners;
  const poRows = poManagementDirectReadFixture(request.method(), url.href);
  if (poRows && url.pathname.startsWith('/rest/v1/')) return { rows: poRows };
  if (request.method() !== 'POST' || url.pathname !== '/functions/v1/app-api'
    || url.search || request.headers()['idempotency-key']) return null;
  let body;
  try { body = request.postDataJSON(); } catch { return null; }
  if (hasExactKeys(body, 'action') && body.action === 'projects_read') return { body: { ok: true, data: { projects: [], rows: [] } } };
  if (hasExactKeys(body, 'action') && body.action === 'watchdog_list_events') return { body: { ok: true, data: [], fixBrief: '', hasMore: false } };
  if (hasExactKeys(body, 'action,operation,params') && body.action === 'inventory_read'
    && body.operation === 'master_page') return readSupplementalMasterPage(cache, body.params);
  if (hasExactKeys(body, 'action,dataset,params') && body.action === 'dataset_read'
    && body.dataset === 'suspend_tag') return readSupplementalSuspendPage(cache, body.params);
  return null;
}

function readSupplementalMasterPage(cache, params) {
  const baseKeys = 'dataset,limit,offset,projection';
  const master = hasExactKeys(params, baseKeys) && params.dataset === 'master';
  const lookup = hasExactKeys(params, 'dataset,limit,offset,projection,uniqueId') && params.dataset === 'lookup'
    && typeof params.uniqueId === 'string' && !!params.uniqueId.trim() && params.limit === 1 && params.offset === 0;
  if (!cache.masterPage || !(master || lookup) || !['browse', 'full'].includes(params.projection)
    || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 500
    || !Number.isSafeInteger(params.offset) || params.offset < 0) return null;
  return { body: { ok: true, data: cache.masterPage.readPage(params) } };
}

function readSupplementalSuspendPage(cache, params) {
  if (!cache.suspend || !hasExactKeys(params, 'filters,limit,offset,order,projection')
    || params.projection !== 'default' || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 500
    || !Number.isSafeInteger(params.offset) || params.offset < 0
    || !Array.isArray(params.filters) || params.filters.length
    || !Array.isArray(params.order) || params.order.length !== 1
    || !hasExactKeys(params.order[0], 'ascending,field') || params.order[0].field !== 'unique_id'
    || params.order[0].ascending !== true) return null;
  return { body: { ok: true, data: readReleaseSmokeSocPage(selectLatestReleaseSmokeSourceRows(cache.suspend), 'suspend_tag', params) } };
}

function fulfillSupplementalFixture(route, fixture) {
  return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*',
    'content-type': 'application/json' }, body: JSON.stringify(fixture.body ?? fixture.rows) });
}

export function installReleaseSmokeDirectOperationalRoute(page) {
  const cache = { master: null, suspend: null, masterPage: null, diagnostics: [] };
  directOperationalCaches.set(page, cache);
  const registerRoute = page.route.bind(page);
  const directHandler = createDirectOperationalRouteHandler(page, cache);
  const restore = () => Object.defineProperty(page, 'route', { configurable: true, writable: true, value: registerRoute });
  const patchedRoute = async (url, handler, options) => {
    try {
      await registerRoute(url, handler, options);
      if (url === '**/*') await registerRoute('**/*', directHandler);
    } finally { restore(); }
  };
  Object.defineProperty(page, 'route', { configurable: true, writable: true, value: patchedRoute });
}
