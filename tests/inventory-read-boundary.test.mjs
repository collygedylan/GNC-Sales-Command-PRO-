import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: inventory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { hasAnyCanonicalUserAccessFlag } from '../supabase/functions/_shared/canonical-user-access.ts';
import { captureInventoryLocationRevision, enrichInventoryLocationRows } from '../supabase/functions/_shared/inventory-location-on-hand.ts';
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

const html = readComposedAppSource();
const edgeSource = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const appsScript = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

function inventoryReadRetryHarness() {
  const start = html.indexOf('function getSupabaseReadErrorCode(error)');
  const end = html.indexOf('function makeSupabaseReadCooldownError', start);
  assert.ok(start >= 0 && end > start, 'inventory retry helpers should exist');
  const context = vm.createContext({});
  vm.runInContext(`${html.slice(start, end)}; this.retry = isSupabaseReadRetryable; this.semantic = isInventorySourceReadinessError;`, context);
  return context;
}

test('inventory readiness and revision conflict codes bypass generic read retries', () => {
  const retry = inventoryReadRetryHarness();
  for (const code of ['LOC_ON_HAND_SOURCE_NOT_READY', 'LOC_SOURCE_NOT_READY', 'DATASET_NOT_READY', 'LOC_ON_HAND_REVISION_CHANGED', 'LOC_REVISION_CHANGED', 'MANAGER_REPORT_SOURCE_REVISION_CHANGED']) {
    assert.equal(retry.semantic({ code, status: 0 }), true, `${code} should be recognized as a source readiness condition`);
    assert.equal(retry.retry({ code, status: 0 }), false, `${code} must not enter generic retry/backoff`);
  }
  assert.equal(retry.retry({ code: 'NETWORK_ERROR', status: 0, message: 'network failed' }), true, 'ordinary transient failures remain retryable');
});

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

function appApiHarness({ moduleAllowed = true, sourceState = 'ready', sourceRevision = 12 } = {}) {
  const start = edgeSource.indexOf('const INVENTORY_MASTER_INITIAL_FIELDS');
  const end = edgeSource.indexOf('const AURA_V2_OPERATIONS', start);
  assert.ok(start >= 0 && end > start, 'inventory read handler block should exist');
  const helpers = edgeSource.slice(edgeSource.indexOf('async function captureReadyInventoryLocationRevision('), edgeSource.indexOf('function ensureServerConfig('));
  const canonicalHelpers = edgeSource.slice(edgeSource.indexOf('const CANONICAL_DATASET_READ_FLAGS:'), edgeSource.indexOf('// This read boundary deliberately accepts dataset'));
  const transpiled = ts.transpileModule(`${canonicalHelpers}\n${helpers}\n${edgeSource.slice(start, end)}\nthis.inventoryReadTest = handleInventoryRead;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const queries = [];
  const context = vm.createContext({
    Error,
    hasAnyCanonicalUserAccessFlag,
    inventoryReadRows: [],
    locationCalls: [],
    identityCalls: [],
    identityResult: null,
    identityError: null,
    jsonValue: value => value,
    jsonObject: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('JSON object required');
      return value;
    },
    projectInventoryRows,
    captureInventoryLocationRevision,
    enrichInventoryLocationRows,
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
      async rpc(name, args) {
        if (name === 'inventory_master_identity_batch_read_v1') {
          context.identityCalls.push([name, args]);
          return { data: context.identityResult, error: context.identityError };
        }
        assert.equal(name, 'inventory_location_on_hand_read_v1');
        context.locationCalls.push(args);
        if (sourceState !== 'ready') return { data: null, error: { message: 'LOC_ON_HAND_SOURCE_NOT_READY' } };
        return { data: { inventoryRevision: '12', rows: args.p_pairs.map(pair => ({ ...pair, loc_on_hand: 2000, loc_on_hand_revision: '12' })) }, error: null };
      },
      from(table) {
        if (table === 'app_dataset_revisions') {
          const source = { select: () => source, eq: () => source,
            maybeSingle: async () => ({ data: sourceState === null ? null : { revision: sourceRevision, state: sourceState }, error: null }) };
          return source;
        }
        const query = { table, calls: [], result: { data: context.inventoryReadRows, error: null, count: context.inventoryReadRows.length } };
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
  assert.ok(queries[0].calls.every(([method]) => method !== 'or'), 'Rep inventory reads include all lot codes and seasons');
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

test('master lookup reads all rows for one exact item and location pair', async () => {
  const { handler, queries, context } = appApiHarness();
  context.inventoryReadRows = [
    { unique_id: 'row-a', itemcode: 'ABC', locationcode: 'C.16.000', lotcode: 'LOT-1', priority: '1', holdstopcode: 'H', holdstopreason: 'Check' },
    { unique_id: 'row-b', itemcode: 'ABC', locationcode: 'C.16.000', lotcode: 'LOT-2', priority: null, holdstopcode: null, holdstopreason: null },
  ];
  const response = await handler({ actor: { id: 'profile-1', username: 'reader', role: 'admin' } }, {
    operation: 'master_page', params: { dataset: 'lookup', projection: 'full', itemCode: 'ABC', locationCode: 'C.16.000', limit: 100 },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.fieldCoverage, 'full');
  assert.deepEqual(response.body.data.rows.map(row => row.unique_id), ['row-a', 'row-b']);
  assert.ok(response.body.data.columns.includes('priority'));
  assert.ok(response.body.data.columns.includes('holdstopcode'));
  assert.ok(response.body.data.columns.includes('holdstopreason'));
  assert.ok(queries[0].calls.some(([method, field, value]) => method === 'eq' && field === 'itemcode' && value === 'ABC'));
  assert.ok(queries[0].calls.some(([method, field, value]) => method === 'eq' && field === 'locationcode' && value === 'C.16.000'));
  assert.ok(queries[0].calls.some(([method]) => method === 'range'));
  assert.ok(!queries[0].calls.some(([method, field]) => method === 'eq' && ['lotcode', 'source'].includes(field)));
  const exact = await handler({ actor: { id: 'profile-1', username: 'reader', role: 'admin' } }, {
    operation: 'master_page', params: { dataset: 'lookup', projection: 'full', itemCode: 'ABC', locationCode: 'C.16.000', lotCode: 'LOT-1', source: 'warehouse', offset: 2, limit: 1 },
  });
  assert.equal(exact.status, 200);
  assert.ok(queries.at(-1).calls.some(([method, field, value]) => method === 'eq' && field === 'lotcode' && value === 'LOT-1'));
  assert.ok(queries.at(-1).calls.some(([method, field, value]) => method === 'eq' && field === 'source' && value === 'warehouse'));
  const partial = await handler({ actor: { id: 'profile-1', username: 'reader', role: 'admin' } }, {
    operation: 'master_page', params: { dataset: 'lookup', itemCode: 'ABC', locationCode: 'C.16.000', lotCode: 'LOT-1' },
  });
  assert.equal(partial.status, 400, 'incomplete exact-row filters remain invalid');
});

test('master pages and deltas append full pair totals after the physical projection and fence source changes', async () => {
  const { handler, context } = appApiHarness();
  context.inventoryReadRows = [{ unique_id: 'C-1', itemcode: '001973.030.1', locationcode: 'C.16.000', ptronhand: '2,000', loc_on_hand: 37492 }];
  const actor = { actor: { id: 'profile-1', username: 'reader', role: 'admin' } };
  for (const payload of [
    { operation: 'master_page', params: { dataset: 'master', projection: 'browse' } },
    { operation: 'master_delta', params: { since: '2026-10-01T00:00:00Z' } },
  ]) {
    const response = await handler(actor, payload);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.rows[0].loc_on_hand, 2000);
    assert.equal(response.body.data.rows[0].loc_on_hand_revision, '12');
    assert.equal(response.body.data.rows[0].ptronhand, '2,000');
  }
  assert.equal(context.locationCalls.length, 4, 'one revision capture and one batched enrichment per page');
  context.supabase.rpc = async (_name, args) => ({ data: { inventoryRevision: args.p_expected_revision ? '13' : '12', rows: [] }, error: null });
  const changed = await handler(actor, { operation: 'master_page', params: { dataset: 'master', projection: 'browse' } });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'LOC_ON_HAND_REVISION_CHANGED');
  assert.equal(changed.body.retryable, false);
});

test('master identity batch enforces access and bounds, returns full rows plus fenced LOC_ON_HAND, and preserves misses', async () => {
  const { handler, context } = appApiHarness();
  const fullSourceRow = Object.fromEntries(MASTER_FULL_FIELDS.split(',').map(field => [field, null]));
  Object.assign(fullSourceRow, { unique_id: 'MIB-API-1', itemcode: '004380.010.1', locationcode: 'C.09.000', lotcode: 'LOT-1' });
  context.identityResult = {
    inventoryRevision: '12',
    rows: [
      { inputIndex: 0, matchCount: 1, row: fullSourceRow },
      { inputIndex: 1, matchCount: 0, row: null },
      { inputIndex: 2, matchCount: 2, row: null },
    ],
  };
  const actor = { actor: { id: 'profile-1', username: 'reader', role: 'admin' } };
  const queueIdentities = [
    { masterUid: 'MIB-API-1', lotCode: 'LOT-1' },
    { itemCode: 'NO-MATCH', locationCode: 'C.09.000', lotCode: '' },
    { itemCode: 'AMBIGUOUS', locationCode: 'C.09.000', lotCode: 'LOT-2' },
  ];
  const response = await handler(actor, {
    operation: 'master_identity_batch', params: { queueIdentities, expectedInventoryRevision: '12' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.projection, 'full');
  assert.equal(response.body.data.fieldCoverage, 'full');
  assert.deepEqual(Array.from(response.body.data.columns), MASTER_FULL_FIELDS.split(','));
  assert.equal(response.body.data.columns.length, 213);
  assert.equal(response.body.data.inventoryRevision, '12');
  assert.equal(response.body.data.rows[0].row.unique_id, 'MIB-API-1');
  assert.equal(response.body.data.rows[0].row.loc_on_hand, 2000);
  assert.equal(response.body.data.rows[0].row.loc_on_hand_revision, '12');
  assert.equal(response.body.data.rows[1].row, null);
  assert.equal(response.body.data.rows[2].row, null);
  assert.equal(context.identityCalls.length, 1, 'identity lookup is one bounded batch RPC');
  assert.equal(context.identityCalls[0][1].p_expected_revision, '12');
  assert.equal(context.locationCalls.length, 1, 'only unique matched rows are sent to LOC_ON_HAND enrichment');
  assert.equal(context.locationCalls[0].p_expected_revision, '12');
  assert.equal(context.locationCalls[0].p_pairs.length, 1);

  const denied = appApiHarness();
  const forbidden = await denied.handler({ actor: { id: 'guest', username: 'outsider', role: 'guest' } }, {
    operation: 'master_identity_batch', params: { queueIdentities: [queueIdentities[0]] },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(denied.context.identityCalls.length, 0, 'unauthorized roles cannot reach the service RPC');

  const invalid = await handler(actor, {
    operation: 'master_identity_batch', params: { queueIdentities: Array.from({ length: 101 }, () => queueIdentities[0]) },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'INVENTORY_READ_IDENTITY_BATCH_INVALID');
  assert.equal(context.identityCalls.length, 1, 'oversized requests are rejected before database access');

  const stale = appApiHarness();
  stale.context.identityError = { message: 'MASTER_IDENTITY_REVISION_CHANGED' };
  const conflict = await stale.handler(actor, {
    operation: 'master_identity_batch', params: { queueIdentities: [queueIdentities[0]], expectedInventoryRevision: '11' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'MASTER_IDENTITY_REVISION_CHANGED');
  assert.equal(stale.context.locationCalls.length, 0, 'a stale identity result is not enriched');

  const unfenced = appApiHarness();
  unfenced.context.identityResult = { inventoryRevision: '12', rows: [{ inputIndex: 0, matchCount: 0, row: null }] };
  const unpinned = await unfenced.handler(actor, {
    operation: 'master_identity_batch', params: { queueIdentities: [queueIdentities[0]] },
  });
  assert.equal(unpinned.status, 200, 'an omitted expected revision keeps the SQL default and does not reject a valid read');
  assert.equal(unfenced.context.identityCalls[0][1].p_expected_revision, undefined,
    'the optional generated RPC argument is omitted instead of passing null');
  assert.equal(unfenced.context.locationCalls.length, 1, 'the batch performs the location revision handshake');
  assert.equal(unfenced.context.locationCalls[0].p_pairs.length, 0, 'unmatched identities are not sent for LOC_ON_HAND enrichment');
});

test('unattested import readiness permits only an empty revision probe before blocking rows and totals', async () => {
  const actor = { actor: { id: 'profile-1', username: 'reader', role: 'admin' } };
  for (const sourceState of ['importing', 'interrupted', null]) {
    const { handler, queries, context } = appApiHarness({ sourceState });
    const response = await handler(actor, { operation: 'master_page', params: { dataset: 'master', projection: 'browse' } });
    assert.equal(response.status, 423);
    assert.equal(response.body.code, 'LOC_ON_HAND_SOURCE_NOT_READY');
    assert.equal(response.body.retryable, false);
    assert.equal(response.body.retryAfterMs, 30000);
    assert.equal(context.locationCalls.length, sourceState === null ? 0 : 1, 'valid fenced revisions require the authoritative read-only readiness probe');
    assert.ok(context.locationCalls.every(call => call.p_pairs.length === 0), 'no physical pair totals may be requested');
    assert.equal(queries.length, 0, 'non-ready sources must not query partial inventory rows');
  }
});

test('legacy app-api database proxy cannot read ph_master_inventory around the operation allowlist', async () => {
  const start = edgeSource.indexOf('async function handleDb(');
  const end = edgeSource.indexOf('const INVENTORY_MASTER_INITIAL_FIELDS', start);
  assert.ok(start >= 0 && end > start, 'legacy database proxy should exist');
  const guardStart = edgeSource.indexOf('const INTERNAL_MOVE_REQUEST_INSERT_FIELDS = new Set(');
  const guardEnd = edgeSource.indexOf('async function restRequest(', guardStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart, 'request write guards should exist');
  const transpiled = ts.transpileModule(`${edgeSource.slice(guardStart, guardEnd)}\n${edgeSource.slice(start, end)}\nthis.legacyDbTest = handleDb;`, {
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
  assert.match(edgeSource, /action === "inventory_read"[\s\S]*?handleInventoryRead\(session, payload, canonicalAccessForRequest\)/);
  for (const operation of ['master_page', 'master_delta', 'po_detail', 'recount_queue', 'ncr_queue', 'not_on_inventory_queue', 'verify_row', 'schema_capabilities']) {
    assert.ok(edgeSource.includes(`operation === "${operation}"`) || edgeSource.includes(`"${operation}"`), `${operation} should be an explicit app-api operation`);
  }
  const realtimeStart = html.indexOf('function normalizeRealtimeTableList(tables = [])');
  const realtimeEnd = html.indexOf('function normalizeAppLiveEventAreaList', realtimeStart);
  const realtimeContext = vm.createContext({ normalizeAppTableName: value => String(value || '').trim().toLowerCase(), isRetiredSupabaseRuntimeTable: () => false });
  vm.runInContext(`${html.slice(realtimeStart, realtimeEnd)}\nthis.normalizeTables = normalizeRealtimeTableList;`, realtimeContext);
  assert.deepEqual(JSON.parse(JSON.stringify(realtimeContext.normalizeTables(['ph_master_inventory', 'ph_soc_master']))), ['ph_soc_master']);
});
