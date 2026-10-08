// @test-group: inventory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  INVENTORY_MASTER_BROWSE_FIELDS as MASTER_BROWSE_FIELDS,
  INVENTORY_MASTER_FULL_FIELDS as MASTER_FULL_FIELDS,
  INVENTORY_MASTER_INITIAL_BASE_FIELDS as MASTER_INITIAL_BASE_FIELDS,
  INVENTORY_MASTER_INITIAL_FIELDS as MASTER_INITIAL_FIELDS,
  INVENTORY_NCR_QUEUE_FIELDS,
  INVENTORY_NOT_ON_INVENTORY_FIELDS,
  INVENTORY_PO_DETAIL_FIELDS,
  inventoryProjectionMatcher,
  projectInventoryRows,
} from '../supabase/functions/_shared/inventory-projections.ts';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const edgeSource = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const appsScript = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

function availabilityHarness(rpc) {
  const start = html.indexOf('function normalizeHlAvailabilityValue(value)');
  const end = html.indexOf('function getHlOrderAvailabilitySummaryRows', start);
  assert.ok(start >= 0 && end > start, 'availability helper block should exist');
  const context = vm.createContext({
    supabaseRpc: rpc,
    SUPABASE_READ_TIMEOUT_MS: 1000,
    navigator: { onLine: true },
    console: { warn() {} },
    canUseHlOrder: () => true,
    captureHlOrderOwnership: () => ({ readIdentity: context.sessionIdentity }),
    isHlOrderOwnershipCurrent: (owner) => owner.readIdentity === context.sessionIdentity,
    getHlOrderSource: (row) => row,
    sessionIdentity: 'session-a'
  });
  vm.runInContext(`let hlOrderAvailabilityPending = null;
    let hlOrderAvailabilityRows = new Map();
    let hlOrderAvailabilityCacheKey = '';
    let hlOrderAvailabilityLoadedAt = 0;
    ${html.slice(start, end)}
    this.availabilityApi = {
      fetch: fetchHlOrderAvailabilityByItemCodes,
      ensure: ensureHlOrderAvailability,
      rows: () => hlOrderAvailabilityRows,
      reset: () => { hlOrderAvailabilityPending = null; hlOrderAvailabilityRows = new Map(); hlOrderAvailabilityCacheKey = ''; hlOrderAvailabilityLoadedAt = 0; }
    };`, context);
  return { context, api: context.availabilityApi };
}

test('availability RPC deduplicates item codes and batches at 1, 500, and 501', async () => {
  for (const [size, expectedBatches] of [[1, [1]], [500, [500]], [501, [500, 1]]]) {
    const calls = [];
    const { api } = availabilityHarness(async (name, payload) => {
      assert.equal(name, 'hl_order_inventory_availability');
      calls.push(payload.p_itemcodes);
      return [];
    });
    const codes = Array.from({ length: size }, (_, index) => `ITEM-${index}`);
    const result = await api.fetch(codes);
    assert.deepEqual(calls.map((batch) => batch.length), expectedBatches);
    assert.equal(result.failed, false);
    assert.equal(result.rowsByTuple.size, 0);
  }
  const calls = [];
  const { api } = availabilityHarness(async (_name, payload) => { calls.push(payload.p_itemcodes); return []; });
  await api.fetch(['abc', ' ABC ', 'def', '']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['ABC', 'DEF']]);
});

test('availability RPC maps only exact lowercase tuple fields and keeps unmatched or empty rows unknown', async () => {
  const { api } = availabilityHarness(async () => [
    { itemcode: ' abc ', contsize: ' 3g ', season_lot: ' 27.f1 ', computed_balance: '1,234' },
    { itemcode: 'OTHER', contsize: '3G', season_lot: '27.F1', computed_balance: 9 },
    { ITEMCODE: 'ABC', CONTSIZE: '3G', SEASON_LOT: '27.F1', COMPUTED_BALANCE: 8 }
  ]);
  const result = await api.fetch(['ABC']);
  assert.equal(result.failed, false);
  assert.equal(result.rowsByTuple.size, 1);
  const value = result.rowsByTuple.get(JSON.stringify(['ABC', '3G', '27.F1']));
  assert.deepEqual(JSON.parse(JSON.stringify(value)), { itemcode: 'ABC', contsize: '3G', season_lot: '27.F1', computed_balance: 1234 });

  const empty = availabilityHarness(async () => []).api;
  const emptyResult = await empty.fetch(['ABC']);
  assert.equal(emptyResult.failed, false);
  assert.equal(emptyResult.rowsByTuple.size, 0);

  const failed = availabilityHarness(async () => { throw new Error('network failure'); }).api;
  const failedResult = await failed.fetch(['ABC']);
  assert.equal(failedResult.failed, true);
  assert.equal(failedResult.rowsByTuple.size, 0);
});

test('availability RPC response from an old session is discarded after an account change', async () => {
  let finish;
  const { context, api } = availabilityHarness(() => new Promise((resolve) => { finish = resolve; }));
  const pending = api.ensure([{ itemcode: 'ABC', contsize: '3G' }]);
  await Promise.resolve();
  context.sessionIdentity = 'session-b';
  finish([{ itemcode: 'ABC', contsize: '3G', season_lot: '27.F1', computed_balance: 12 }]);
  await pending;
  assert.equal(api.rows().size, 0);
});

test('availability refresh preserves verified cached tuples on RPC failure and clears them after a successful empty result', async () => {
  const key = JSON.stringify(['ABC', '3G', '27.F1']);
  const cached = { itemcode: 'ABC', contsize: '3G', season_lot: '27.F1', computed_balance: 41 };
  const failed = availabilityHarness(async () => { throw new Error('temporary outage'); }).api;
  failed.rows().set(key, cached);
  await failed.ensure([{ itemcode: 'ABC', contsize: '3G' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(failed.rows().get(key))), cached);

  const empty = availabilityHarness(async () => []).api;
  empty.rows().set(key, cached);
  await empty.ensure([{ itemcode: 'ABC', contsize: '3G' }]);
  assert.equal(empty.rows().has(key), false);
});

function appApiHarness({ moduleAllowed = true } = {}) {
  const start = edgeSource.indexOf('const INVENTORY_MASTER_INITIAL_FIELDS');
  const end = edgeSource.indexOf('const AURA_V2_OPERATIONS', start);
  assert.ok(start >= 0 && end > start, 'inventory read handler block should exist');
  const transpiled = ts.transpileModule(`${edgeSource.slice(start, end)}\nthis.inventoryReadTest = handleInventoryRead;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const queries = [];
  const context = vm.createContext({
    jsonValue: value => value,
    jsonObject: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('JSON object required');
      return value;
    },
    projectInventoryRows,
    MASTER_BROWSE_FIELDS,
    MASTER_FULL_FIELDS,
    MASTER_INITIAL_BASE_FIELDS,
    MASTER_INITIAL_FIELDS,
    INVENTORY_NCR_QUEUE_FIELDS,
    INVENTORY_NOT_ON_INVENTORY_FIELDS,
    INVENTORY_PO_DETAIL_FIELDS,
    normalizeUsername: (value) => String(value || '').trim().toLowerCase(),
    FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge', 'jd_jones', 'megan_kelly']),
    hasTableReadAccess: (role, _table, username) => ['admin', 'qc supervisor', 'rep'].includes(String(role || '').toLowerCase())
      || ['dylan_collyge', 'jd_jones', 'megan_kelly'].includes(String(username || '').toLowerCase()),
    getRoleAccessState: (role) => ({
      isRepLike: String(role || '').toLowerCase() === 'rep',
      isAdmin: String(role || '').toLowerCase() === 'admin',
      isQcSupervisor: String(role || '').toLowerCase() === 'qc supervisor'
    }),
    resolveActiveSessionProfile: async (session) => {
      if (session.inactive) throw new Error('inactive profile');
      return session.actor;
    },
    resolveModuleAllowed: async (_client, _actor, module) => moduleAllowed && module === 'po-management',
    errorResponse: (message, status, details = {}) => ({ status, body: { error: message, ...details } }),
    jsonResponse: (body) => ({ status: 200, body }),
    supabase: {
      from(table) {
        const query = { table, calls: [], result: { data: [], error: null, count: 0 } };
        queries.push(query);
        for (const method of ['select', 'not', 'or', 'order', 'range', 'eq', 'in', 'gt', 'limit']) {
          query[method] = (...args) => { query.calls.push([method, ...args]); return query; };
        }
        query.maybeSingle = async () => ({ data: null, error: null });
        query.then = (resolve, reject) => Promise.resolve(query.result).then(resolve, reject);
        return query;
      }
    }
  });
  vm.runInContext(`${transpiled}\nthis.inventoryProjectionTest = projectInventoryRows;`, context);
  return { handler: context.inventoryReadTest, queries, context };
}

test('inventory row projection validates rows and copies only selected fields in source order', () => {
  const { context } = appApiHarness();
  const project = context.inventoryProjectionTest;
  const source = { unique_id: 'row-1', itemcode: null, unexpected: { nested: true } };
  const projected = project([source], 'unique_id,itemcode');
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), [{ unique_id: 'row-1', itemcode: null }]);
  assert.deepEqual(Object.keys(projected[0]), ['unique_id', 'itemcode']);
  assert.deepEqual(source, { unique_id: 'row-1', itemcode: null, unexpected: { nested: true } });
  assert.equal(inventoryProjectionMatcher(MASTER_BROWSE_FIELDS), inventoryProjectionMatcher(MASTER_BROWSE_FIELDS));
  assert.notEqual(inventoryProjectionMatcher('unique_id,itemcode'), inventoryProjectionMatcher('unique_id,itemcode'));
  assert.deepEqual(JSON.parse(JSON.stringify(project([source], '*'))), [source]);
  assert.deepEqual(project(null, 'unique_id'), []);
  assert.throws(() => project([null], 'unique_id'), /Expected a JSON object/);
  assert.throws(() => project([{ unique_id: 'row-2', unexpected: () => 'not JSON' }], 'unique_id'), /Expected a finite JSON value/);
});

test('browse inventory preserves filters and readouts with explicit field coverage and bounded pages', async () => {
  const { handler, queries } = appApiHarness();
  const actor = { actor: { username: 'riley_sales', role: 'rep' } };
  const page = await handler(actor, { operation: 'master_page', params: { dataset: 'avOpen', projection: 'browse', limit: 1000 } });
  assert.equal(page.status, 200);
  assert.equal(page.body.data.projection, 'browse');
  assert.equal(page.body.data.fieldCoverage, 'browse');
  const fields = page.body.data.columns;
  assert.equal(fields.length, 161);
  const contractContext = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../assets/inventory-list-contract.js', import.meta.url), 'utf8'), contractContext);
  assert.deepEqual(Array.from(fields).sort(), Array.from(contractContext.AgMetricInventoryList.columns).sort());
  assert.equal(new Set(fields).size, fields.length);
  for (const field of ['unique_id', 'ptronhand', 'ptrreviewed', 'ptravailable', 'season_oh', 'listprice', 'locationptn1', 'locationptn2', 'saleyear', 'filename', 'last_updated', 'hold_release_approved_at', 'eval_task_status', 'ncr_approval_type']) {
    assert.ok(fields.includes(field), field);
  }
  assert.ok(!fields.includes('shiptotelephone_1'));
  assert.ok(queries[0].calls.some(([method, value]) => method === 'or' && value === 'season.is.null,season.not.ilike.U3'));
  assert.ok(queries[0].calls.some(([method, from, to]) => method === 'range' && from === 0 && to === 499));
  const full = await handler(actor, { operation: 'master_page', params: { dataset: 'lookup', projection: 'full', uniqueId: 'row-1' } });
  assert.equal(full.body.data.fieldCoverage, 'full');
  assert.equal(full.body.data.columns.length, 213);
  assert.ok(full.body.data.columns.includes('shiptotelephone_1'));
  assert.ok(queries[1].calls.some(([method, field, value]) => method === 'eq' && field === 'unique_id' && value === 'row-1'));
  assert.ok(queries.every(query => query.calls.filter(([method]) => method === 'select').every(([, fields]) => !fields.includes('*'))));
});

test('inventory freshness does not count all matching rows', async () => {
  const { handler, queries } = appApiHarness();
  const response = await handler({ actor: { username: 'reader', role: 'admin' } }, { operation: 'source_freshness' });
  assert.equal(response.status, 200);
  const select = queries[0].calls.find(([method]) => method === 'select');
  assert.equal(select[1], 'filename,last_updated');
  assert.equal(select[2].count, undefined);
  assert.ok(queries[0].calls.some(([method, size]) => method === 'limit' && size === 1));
});

test('legacy app-api database proxy cannot read ph_master_inventory around the operation allowlist', async () => {
  const start = edgeSource.indexOf('async function handleDb(');
  const end = edgeSource.indexOf('const INVENTORY_MASTER_INITIAL_FIELDS', start);
  assert.ok(start >= 0 && end > start, 'legacy database proxy should exist');
  const transpiled = ts.transpileModule(`${edgeSource.slice(start, end)}\nthis.legacyDbTest = handleDb;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = vm.createContext({
    normalizeTableName: value => String(value || '').trim().toLowerCase(),
    errorResponse: (message, status, details = {}) => ({ status, body: { error: message, ...details } })
  });
  vm.runInContext(transpiled, context);
  const denied = await context.legacyDbTest({ username: 'reader', role: 'ADMIN' }, { table: 'ph_master_inventory', method: 'GET', query: 'select=*' });
  assert.equal(denied.status, 410);
  assert.equal(denied.body.code, 'INVENTORY_READ_API_REQUIRED');
});

test('inventory_read rejects missing, forced-password, inactive, unauthorized, and invalid requests', async () => {
  const { handler, queries } = appApiHarness();
  assert.equal((await handler(null, { operation: 'master_page' })).status, 401);
  assert.equal((await handler({ mustChangePassword: true }, { operation: 'master_page' })).status, 403);
  assert.equal((await handler({ inactive: true }, { operation: 'master_page' })).status, 403);
  assert.equal((await handler({ actor: { username: 'reader', role: 'guest' } }, { operation: 'master_page' })).status, 403);
  const invalid = await handler({ actor: { username: 'reader', role: 'admin' } }, { operation: 'invented_operation' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'INVENTORY_READ_OPERATION_INVALID');
  assert.equal(queries.length, 0);
});

test('inventory_read applies fixed projections, capped pagination, module access, and assignment scope', async () => {
  const { handler, queries } = appApiHarness();
  const admin = { actor: { username: 'dylan_collyge', role: 'admin' } };
  const page = await handler(admin, { operation: 'master_page', params: { dataset: 'master', projection: 'initial', limit: 501, offset: 0 } });
  assert.equal(page.status, 200);
  const read = queries.at(-1);
  assert.equal(read.table, 'ph_master_inventory');
  assert.ok(read.calls.some(([method, fields]) => method === 'select' && fields.includes('itemcode')));
  assert.ok(read.calls.some(([method, from, to]) => method === 'range' && from === 0 && to === 499));

  const avOpen = await handler(admin, { operation: 'master_page', params: { dataset: 'avOpen', projection: 'full', limit: 50 } });
  assert.equal(avOpen.status, 200);
  assert.ok(queries.at(-1).calls.some(([method, field, values]) => method === 'in' && field === 'season' && values.join(',') === 'F1,S1,U1,U2'));

  const injected = await handler(admin, { operation: 'master_page', params: { dataset: 'master', select: '*' } });
  assert.equal(injected.status, 400);
  assert.equal(queries.length, 2);

  const allowedAssignment = await handler(admin, {
    operation: 'ncr_queue', params: { queueType: 'new-crop', assignment: 'ncr_approval_new_crop_dylan' }
  });
  assert.equal(allowedAssignment.status, 200);
  assert.ok(queries.at(-1).calls.some(([method, field, value]) => method === 'eq' && field === 'app_tab_assignment' && value === 'ncr_approval_new_crop_dylan'));
  assert.ok(queries.at(-1).calls.some(([method, fields]) => method === 'select' && fields.includes('unique_id') && fields.includes('locationcode') && !fields.includes('*')));

  const recount = await handler({ actor: { username: 'dylan_collyge', role: 'staff' } }, { operation: 'recount_queue' });
  assert.equal(recount.status, 200);
  assert.ok(queries.at(-1).calls.some(([method, field, value]) => method === 'eq' && field === 'app_tab_assignment' && value === 'ncr_inventory_recount'));

  const notOnInventory = await handler(admin, {
    operation: 'not_on_inventory_queue', params: { assignment: 'not_on_inventory_dylan' }
  });
  assert.equal(notOnInventory.status, 200);
  assert.ok(queries.at(-1).calls.some(([method, field, value]) => method === 'eq' && field === 'app_tab_assignment' && value === 'not_on_inventory_dylan'));
  assert.ok(queries.at(-1).calls.some(([method, fields]) => method === 'select' && fields.includes('locationcode') && fields.includes('ptronhand')));

  const deniedAssignment = await handler({ actor: { username: 'outsider', role: 'admin' } }, {
    operation: 'ncr_queue', params: { queueType: 'new-crop', assignment: 'ncr_approval_new_crop_dylan' }
  });
  assert.equal(deniedAssignment.status, 403);
  assert.equal(deniedAssignment.body.code, 'QUEUE_ASSIGNMENT_FORBIDDEN');

  const poDenied = appApiHarness({ moduleAllowed: false });
  const po = await poDenied.handler({ actor: { username: 'dylan_collyge', role: 'admin' } }, {
    operation: 'po_detail', params: { itemCode: 'A', contSize: '3G' }
  });
  assert.equal(po.status, 403);
  assert.equal(po.body.code, 'PO_ACCESS_FORBIDDEN');
  assert.equal(poDenied.queries.length, 0);
});

test('inventory_read capability and row verification responses include explicit status data', async () => {
  const { handler } = appApiHarness();
  const admin = { actor: { username: 'dylan_collyge', role: 'admin' } };
  const capabilities = await handler(admin, { operation: 'schema_capabilities' });
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.body.data.status, 'checked');
  assert.equal(capabilities.body.data.capabilities.evalTask.available, true);

  const missingRow = await handler(admin, { operation: 'verify_row', params: {
    kind: 'not_on_inventory', uniqueId: 'missing-id', expectedAssignment: 'not_on_inventory_dylan'
  } });
  assert.equal(missingRow.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(missingRow.body.data)), { status: 'missing', matches: false });
});

test('production browser and Apps Script inventory reads use app-api or the availability RPC', () => {
  assert.doesNotMatch(html, /GET\s+['"`]\/rest\/v1\/ph_master_inventory|\/rest\/v1\/ph_master_inventory\?/i);
  assert.match(html, /LIVE_SYNC_VIEW_POLICY[\s\S]*?'hl-order': \{ realtimeTables: \['ph_soc_master'\]/);
  assert.match(html, /supabaseRpc\('hl_order_inventory_availability', \{ p_itemcodes: batch \}/);
  assert.match(appsScript, /callSupabaseRpc_\('hl_order_inventory_availability'/);
  assert.doesNotMatch(appsScript, /\/rest\/v1\/ph_master_inventory/);
  assert.match(edgeSource, /action === "inventory_read"[\s\S]*?handleInventoryRead\(session, payload\)/);
  for (const operation of ['master_page', 'master_delta', 'po_detail', 'recount_queue', 'ncr_queue', 'not_on_inventory_queue', 'verify_row', 'schema_capabilities']) {
    assert.ok(edgeSource.includes(`operation === "${operation}"`) || edgeSource.includes(`"${operation}"`), `${operation} should be an explicit app-api operation`);
  }
  const realtimeStart = html.indexOf('function normalizeRealtimeTableList(tables = [])');
  const realtimeEnd = html.indexOf('function normalizeAppLiveEventAreaList', realtimeStart);
  const realtimeContext = vm.createContext({ normalizeAppTableName: value => String(value || '').trim().toLowerCase(), isRetiredSupabaseRuntimeTable: () => false });
  vm.runInContext(`${html.slice(realtimeStart, realtimeEnd)}\nthis.normalizeTables = normalizeRealtimeTableList;`, realtimeContext);
  assert.deepEqual(JSON.parse(JSON.stringify(realtimeContext.normalizeTables(['ph_master_inventory', 'ph_soc_master']))), ['ph_soc_master']);
});
