import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { hasAnyCanonicalUserAccessFlag } from '../../supabase/functions/_shared/canonical-user-access.ts';
import { captureInventoryLocationRevision, enrichInventoryLocationRows } from '../../supabase/functions/_shared/inventory-location-on-hand.ts';
import {
  INVENTORY_MASTER_BROWSE_FIELDS as MASTER_BROWSE_FIELDS,
  INVENTORY_MASTER_FULL_FIELDS as MASTER_FULL_FIELDS,
  INVENTORY_MASTER_INITIAL_BASE_FIELDS as MASTER_INITIAL_BASE_FIELDS,
  INVENTORY_MASTER_INITIAL_FIELDS as MASTER_INITIAL_FIELDS,
  INVENTORY_NCR_QUEUE_FIELDS,
  INVENTORY_NOT_ON_INVENTORY_FIELDS,
  INVENTORY_PO_DETAIL_FIELDS,
  projectInventoryRows,
} from '../../supabase/functions/_shared/inventory-projections.ts';

const edgeSource = fs.readFileSync(new URL('../../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');

function inventoryReadGlobals(moduleAllowed) {
  return {
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
  };
}

function inventoryFixtureQuery(context, queries, table) {
        const query = { table, calls: [], result: { data: context.inventoryReadRows, error: null, count: context.inventoryReadRows.length } };
        queries.push(query);
        for (const method of ['select', 'not', 'or', 'order', 'range', 'eq', 'in', 'gt', 'limit']) {
          query[method] = (...args) => { query.calls.push([method, ...args]); return query; };
        }
        query.maybeSingle = async () => ({ data: null, error: null });
        query.then = (resolve, reject) => Promise.resolve(query.result).then(resolve, reject);
        return query;
}

function inventoryRevisionFixture(sourceState, sourceRevision) {
  const source = { select:() => source, eq:() => source,
    maybeSingle:async () => ({ data:sourceState === null ? null : { revision:sourceRevision, state:sourceState }, error:null }) };
  return source;
}

function inventoryReadRpc(context, sourceState, name, args) {
  if (name === 'reconcile_inventory_location_evidence_v1') return { data:null, error:null };
  if (name === 'inventory_master_identity_batch_read_v1') {
    context.identityCalls.push([name,args]);
    return { data:context.identityResult, error:context.identityError };
  }
  assert.equal(name, 'inventory_location_on_hand_read_v1');
  context.locationCalls.push(args);
  if (sourceState !== 'ready') return { data:null, error:{ message:'LOC_ON_HAND_SOURCE_NOT_READY' } };
  const rows = args.p_pairs.map(pair => ({ ...pair, loc_on_hand:2000, loc_on_hand_revision:'12' }));
  return { data:{ inventoryRevision:'12', rows }, error:null };
}

function inventoryReadFrom(context, queries, sourceState, sourceRevision, table) {
  if (table === 'app_dataset_revisions') return inventoryRevisionFixture(sourceState, sourceRevision);
  return inventoryFixtureQuery(context, queries, table);
}

function inventoryReadTransport(context, queries, sourceState, sourceRevision) {
  return { rpc:inventoryReadRpc.bind(null,context,sourceState),
    from:inventoryReadFrom.bind(null,context,queries,sourceState,sourceRevision) };
}

export function appApiHarness({ moduleAllowed = true, sourceState = 'ready', sourceRevision = 12 } = {}) {
  const start = edgeSource.indexOf('const INVENTORY_MASTER_INITIAL_FIELDS');
  const end = edgeSource.indexOf('const AURA_V2_OPERATIONS', start);
  assert.ok(start >= 0 && end > start, 'inventory read handler block should exist');
  const helpers = edgeSource.slice(edgeSource.indexOf('async function captureReadyInventoryLocationRevision('), edgeSource.indexOf('function ensureServerConfig('));
  const retained = edgeSource.slice(edgeSource.indexOf('function retainedReadResponse('), edgeSource.indexOf('async function failOpenInventoryConflict('));
  const canonicalHelpers = edgeSource.slice(edgeSource.indexOf('const CANONICAL_DATASET_READ_FLAGS:'), edgeSource.indexOf('// This read boundary deliberately accepts dataset'));
  const transpiled = ts.transpileModule(`${retained}\n${canonicalHelpers}\n${helpers}\n${edgeSource.slice(start, end)}\nthis.inventoryReadTest = handleInventoryRead;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const queries = [];
  const context = vm.createContext(inventoryReadGlobals(moduleAllowed));
  context.supabase = inventoryReadTransport(context, queries, sourceState, sourceRevision);
  vm.runInContext(`${transpiled}\nthis.inventoryProjectionTest = projectInventoryRows;`, context);
  return { handler: context.inventoryReadTest, queries, context };
}

export function inventoryIdentityReadFixture() {
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
  const actor = { role: 'admin', actor: { id: 'profile-1', username: 'reader', role: 'admin' } };
  const queueIdentities = [
    { masterUid: 'MIB-API-1', lotCode: 'LOT-1' },
    { itemCode: 'NO-MATCH', locationCode: 'C.09.000', lotCode: '' },
    { itemCode: 'AMBIGUOUS', locationCode: 'C.09.000', lotCode: 'LOT-2' },
  ];
  return { handler, context, actor, queueIdentities };
}
