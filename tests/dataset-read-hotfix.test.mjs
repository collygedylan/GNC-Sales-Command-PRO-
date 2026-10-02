import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const errorHelperStart = source.indexOf('function databaseFailureResponse(');
const errorHelperEnd = source.indexOf('\nfunction ensureServerConfig(', errorHelperStart);
assert.ok(errorHelperStart >= 0 && errorHelperEnd > errorHelperStart, 'database error mapping should be present');
const errorHelper = source.slice(errorHelperStart, errorHelperEnd);
const start = source.indexOf('// This read boundary deliberately accepts dataset and typed filter names');
const end = source.indexOf('function hasTableWriteAccess(', start);
assert.ok(start >= 0 && end > start, 'dataset read and productivity handlers should be present');
const datasetEnd = source.indexOf('function productionScheduleBase64Url(', start);
const productivityStart = source.indexOf('async function handleAppendProductivityHistory(', datasetEnd);
assert.ok(datasetEnd > start && productivityStart > datasetEnd && productivityStart < end);
const block = source.slice(start, datasetEnd) + source.slice(productivityStart, end);

function harness({ readable = true, writable = true, role = 'admin', username = 'dylan_collyge', rows = [{ unique_id: 'one' }], count = 1, dbError = null, writeError = null } = {}) {
  const queries = [];
  const tables = [];
  const transpiled = ts.transpileModule(`function errorResponse(message, status = 400, extra = {}) { return { status, body: { error: message, ...extra } }; }\n${errorHelper}\n${block}\nthis.datasetReadTest = handleDatasetRead; this.productivityWriteTest = handleAppendProductivityHistory;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({
    normalizeUsername: (value) => String(value || '').trim().toLowerCase(),
    FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge', 'jd_jones', 'megan_kelly']),
    hasTableReadAccess: (_role, table) => readable && table !== 'ph_master_inventory',
    hasTableWriteAccess: (_role, table) => writable && table === 'ph_productivity_history',
    getRoleAccessState: (value) => ({ isAdmin: String(value).toLowerCase() === 'admin', isRep: String(value).toLowerCase() === 'rep' }),
    resolveActiveSessionProfile: async (session) => {
      if (!session?.actor) throw new Error('inactive');
      return session.actor;
    },
    errorResponse: (message, status, details = {}) => ({ status, body: { error: message, ...details } }),
    jsonResponse: (body) => ({ status: 200, body }),
    supabase: {
      from(table) {
        tables.push(table);
        const query = { table, calls: [], result: { data: rows, error: table === 'ph_productivity_history' ? writeError : dbError, count } };
        queries.push(query);
        for (const method of ['select', 'filter', 'eq', 'neq', 'in', 'ilike', 'is', 'not', 'or', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'upsert']) {
          query[method] = (...args) => { query.calls.push([method, ...args]); return query; };
        }
        query.then = (resolve, reject) => Promise.resolve(query.result).then(resolve, reject);
        return query;
      },
    },
  });
  vm.runInContext(transpiled, context);
  const session = (actorRole = role, actorUsername = username) => ({ actor: { id: 'profile-1', username: actorUsername, display_name: 'Dylan Collyge', role: actorRole } });
  return { context, queries, tables, session };
}

test('dataset_read requires active session profile and denies before opening the dataset query', async () => {
  const h = harness({ readable: false });
  assert.equal((await h.context.datasetReadTest(null, { dataset: 'soc', params: {} })).status, 401);
  assert.equal((await h.context.datasetReadTest({ mustChangePassword: true }, { dataset: 'soc', params: {} })).status, 403);
  assert.equal((await h.context.datasetReadTest({ inactive: true }, { dataset: 'soc', params: {} })).status, 403);
  const denied = await h.context.datasetReadTest(h.session('rep', 'rep_user'), { dataset: 'soc', params: {} });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'DATASET_READ_FORBIDDEN');
  assert.deepEqual(h.tables, []);
});

test('database SQLSTATE and terminal HTTP statuses survive dataset and productivity boundaries', async () => {
  const deniedRead = harness({ dbError: { code: '42501', message: 'permission denied' } });
  const readResponse = await deniedRead.context.datasetReadTest(deniedRead.session(), { dataset: 'soc', params: {} });
  assert.equal(readResponse.status, 403);
  assert.equal(readResponse.body.code, '42501');

  const conflictRead = harness({ dbError: { code: '40001', message: 'serialization failure' } });
  const conflictResponse = await conflictRead.context.datasetReadTest(conflictRead.session(), { dataset: 'soc', params: {} });
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflictResponse.body.code, '40001');

  const deniedWrite = harness({ writeError: { code: '42501', message: 'permission denied' } });
  const writeResponse = await deniedWrite.context.productivityWriteTest(deniedWrite.session(), { entries: [{
    event_key: 'ph_active_request|request|req-1|2026-09-30T18:00:00.000Z|rep_user',
    completed_by_username: 'rep_user', completed_by_display: 'Rep User', completed_at: '2026-09-30T18:00:00.000Z',
    source_table: 'ph_active_request', source_kind: 'request', source_unique_id: 'req-1', snapshot: {},
  }] });
  assert.equal(writeResponse.status, 403);
  assert.equal(writeResponse.body.code, '42501');
});

test('dataset_read uses fixed sources, typed filters, stable order, and a 500 row cap', async () => {
  const h = harness({ rows: [{ unique_id: 'A' }], count: 701 });
  const result = await h.context.datasetReadTest(h.session(), {
    dataset: 'request_queue',
    params: {
      projection: 'signature', limit: 501, offset: 500,
      filters: [{ field: 'req_status', op: 'eq', value: 'open' }],
      order: [{ field: 'created_at', ascending: false }],
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.data)), { rows: [{ unique_id: 'A' }], total: 701, offset: 500, limit: 500, hasMore: true });
  assert.equal(h.tables[0], 'ph_request_queue_live_rows');
  const calls = h.queries[0].calls;
  assert.ok(calls.some(([method, fields]) => method === 'select' && fields.includes('delivery_status')));
  assert.ok(calls.some(([method, field, op, value]) => method === 'filter' && field === 'req_status' && op === 'eq' && value === 'open'));
  assert.ok(calls.some(([method, from, to]) => method === 'range' && from === 500 && to === 999));
  assert.ok(calls.some(([method, field]) => method === 'order' && field === 'unique_id'));

  const arbitrary = await h.context.datasetReadTest(h.session(), { dataset: 'ph_master_inventory', params: {} });
  assert.equal(arbitrary.status, 400);
  assert.equal(h.tables.length, 1);
});

test('default projections are explicit current columns and Request signatures are a valid subset', () => {
  const projectionBlock = source.match(/const DATASET_READ_COLUMN_PROJECTIONS:[\s\S]*?= \{([\s\S]*?)\n\};/);
  assert.ok(projectionBlock, 'server projection allowlist should exist');
  const projections = new Map();
  for (const match of projectionBlock[1].matchAll(/^\s*([a-z_]+): ("[^"]*"),$/gm)) {
    projections.set(match[1], JSON.parse(match[2]).split(','));
  }
  assert.equal(projections.size, 13);
  assert.ok([...projections.values()].every((fields) => fields.length > 1 && fields.every((field) => /^[a-z][a-z0-9_]*$/.test(field))));
  assert.doesNotMatch(projectionBlock[1], /:\s*"\*"/);
  const request = source.match(/request_queue:\s*\{[\s\S]*?signatures:\s*"([^"]+)"/);
  assert.ok(request, 'Request signature projection should exist');
  assert.ok(request[1].split(',').every((field) => projections.get('ph_request_queue_live_rows').includes(field)));
});

test('Inventory edits and Shear use authorized bounded reads without changing role access', async () => {
  for (const [dataset, table, key, order] of [
    ['inventory_edits', 'ph_inventory_edit_requests', 'id', 'stage_updated_at'],
    ['shear', 'ph_shear_list', 'unique_id', 'created_at'],
  ]) {
    const denied = harness({ readable: false });
    assert.equal((await denied.context.datasetReadTest(denied.session('rep', 'floor_user'), { dataset, params: {} })).status, 403);
    assert.deepEqual(denied.tables, []);
    const h = harness({ rows: [{ [key]: 'row-1' }], count: 550 });
    const result = await h.context.datasetReadTest(h.session(), { dataset, params: { limit: 1000, offset: 0, filters: [{ field: 'status', op: 'eq', value: 'open' }], order: [{ field: order, ascending: false }] } });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.limit, 500);
    assert.equal(result.body.data.total, 550);
    assert.equal(result.body.data.hasMore, true);
    assert.equal(h.tables[0], table);
    assert.ok(h.queries[0].calls.some(([method, field]) => method === 'order' && field === key));
    assert.ok(h.queries[0].calls.some(([method, fields]) => method === 'select' && fields !== '*' && fields.includes('lotcode')));
  }
});

test('dataset_read validates filter names and safely builds typed OR expressions', async () => {
  const h = harness({ role: 'rep', username: 'rep_user' });
  const bad = await h.context.datasetReadTest(h.session(), { dataset: 'soc', params: { filters: [{ field: 'secret_column', op: 'eq', value: 'x' }] } });
  assert.equal(bad.status, 400);
  assert.equal(h.queries[0].calls.some(([method]) => method === 'range'), false);

  const result = await h.context.datasetReadTest(h.session('rep', 'rep_user'), {
    dataset: 'reserves', params: { anyOf: [
      { field: 'itemcode', op: 'eq', value: 'A.01, "quote"' },
      { field: 'itemcode', op: 'eq', value: 'B.02' },
    ] },
  });
  assert.equal(result.status, 200);
  const orCall = h.queries[1].calls.find(([method]) => method === 'or');
  assert.ok(orCall);
  assert.match(orCall[1], /salesrepname\.ilike/);
  assert.match(orCall[1], /and\(or\(/);
  assert.match(orCall[1], /itemcode\.eq\."A\.01, \\"quote\\""/);
});

test('productivity history writes are role gated, validated, bounded, and idempotent', async () => {
  const entry = {
    event_key: 'ph_active_request|request|req-1|2026-09-30T18:00:00.000Z|rep_user',
    completed_by_username: 'rep_user', completed_by_display: 'Rep User', completed_at: '2026-09-30T18:00:00.000Z',
    source_table: 'ph_active_request', source_kind: 'request', source_unique_id: 'req-1', source_assignment: 'request',
    itemcode: 'ITEM-1', commonname: 'Plant', contsize: '3G', locationcode: 'A.01', lotcode: '27.F1',
    customer_name: 'Customer', request_folder: 'folder-1', snapshot: { source_kind: 'request' },
  };
  const denied = harness({ writable: false });
  assert.equal((await denied.context.productivityWriteTest(denied.session('rep', 'rep_user'), { entries: [entry] })).status, 403);
  assert.deepEqual(denied.tables, []);

  const h = harness();
  const saved = await h.context.productivityWriteTest(h.session(), { action: 'append_productivity_history', entries: [entry] });
  assert.equal(saved.status, 200);
  assert.equal(h.tables[0], 'ph_productivity_history');
  const upsert = h.queries[0].calls.find(([method]) => method === 'upsert');
  assert.equal(upsert[1][0].completed_by_username, 'rep_user', 'privileged backfills preserve source identity');
  assert.equal(upsert[1][0].completed_at, entry.completed_at);
  assert.deepEqual(JSON.parse(JSON.stringify(upsert[2])), { onConflict: 'event_key' });

  const malformed = harness();
  const invalid = await malformed.context.productivityWriteTest(malformed.session(), { entries: [{ ...entry, event_key: 'wrong-key' }] });
  assert.equal(invalid.status, 400);
  assert.deepEqual(malformed.tables, []);
  const tooMany = await malformed.context.productivityWriteTest(malformed.session(), { entries: Array(501).fill(entry) });
  assert.equal(tooMany.body.code, 'PRODUCTIVITY_HISTORY_PAYLOAD_INVALID');
});

test('inventory source_freshness uses only the authorized minimal metadata projection', async () => {
  const handlerStart = source.indexOf('async function handleInventoryRead(');
  const handlerEnd = source.indexOf('const AURA_V2_OPERATIONS', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const inventoryHandler = source.slice(handlerStart, handlerEnd);
  const transpiled = ts.transpileModule(`${inventoryHandler}\nthis.inventoryReadTest = handleInventoryRead;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const calls = [];
  const context = vm.createContext({
    normalizeUsername: (value) => String(value || '').trim().toLowerCase(),
    FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge']),
    getRoleAccessState: () => ({ isRepLike: false, isRep: false, isAdmin: true, isQcSupervisor: false }),
    hasTableReadAccess: (role, table) => table === 'ph_master_inventory' && String(role).toLowerCase() === 'admin',
    resolveActiveSessionProfile: async (session) => session.actor,
    inventoryReadParams: (payload, allowed) => {
      assert.deepEqual(Object.keys(payload).filter((key) => !['operation', 'action'].includes(key)), []);
      assert.equal(allowed.length, 0);
      return {};
    },
    inventoryReadQuery: (table, fields) => {
      const query = { table, fields, calls };
      for (const method of ['not', 'order', 'limit']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
      query.then = (resolve) => Promise.resolve({ data: [{ filename: 'weekly.csv', last_updated: '2026-09-30T12:00:00Z' }], error: null }).then(resolve);
      calls.push(['select', table, fields]);
      return query;
    },
    errorResponse: (message, status, details = {}) => ({ status, body: { error: message, ...details } }),
    jsonResponse: (body) => ({ status: 200, body }),
  });
  vm.runInContext(transpiled, context);
  const session = { actor: { username: 'dylan_collyge', role: 'admin' } };
  const response = await context.inventoryReadTest(session, { operation: 'source_freshness' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.data)), { filename: 'weekly.csv', last_updated: '2026-09-30T12:00:00Z' });
  assert.ok(calls.some(([method]) => method === 'select' && calls[0][2] === 'filename,last_updated'));
  assert.ok(calls.some(([method, field, op, value]) => method === 'not' && field === 'last_updated' && op === 'is' && value === null));
  assert.ok(calls.some(([method, field]) => method === 'order' && field === 'last_updated'));
  assert.ok(calls.some(([method, limit]) => method === 'limit' && limit === 1));
  const denied = await context.inventoryReadTest({ ...session, actor: { username: 'rep', role: 'rep' } }, { operation: 'source_freshness' });
  assert.equal(denied.status, 403);
});

test('app-api dispatch exposes only the named dataset and productivity actions', () => {
  assert.match(source, /action === "dataset_read"\) return await handleDatasetRead\(session, payload\)/);
  assert.match(source, /action === "append_productivity_history"\) return await handleAppendProductivityHistory\(session, payload\)/);
  assert.doesNotMatch(source, /dataset_read[\s\S]{0,500}payload\.query/);
});
