import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../assets/app-runtime.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = runtime.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = runtime.indexOf(endMarker, start);
  assert.ok(end > start, `missing source boundary: ${endMarker}`);
  return runtime.slice(start, end);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('customer map read shares its authenticated promise across access readiness and ignores a caller abort', async () => {
  const state = { identity: 'authenticated-account-1', permission: 'loading', datasetRevision: 'rev-42', requestCount: 0, fetchOptions: null };
  const sourcePromise = deferred();
  const context = vm.createContext({
    AbortController,
    currentUser: 'dylan_collyge',
    nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile-1' },
    hasAuthenticatedOperationalReadIdentity() { return true; },
    getSupabaseReadIdentityScope() { return state.identity; },
    getDatasetLoadSignature() { return state.datasetRevision; },
    getRequestModalCustomerMappingCacheSignature() { return `${state.datasetRevision}:${state.permission}`; },
    fetchAllSupabaseRows(_table, _query, options) {
      state.requestCount += 1;
      state.fetchOptions = options;
      return sourcePromise.promise;
    },
    isActiveRequestCustomerMapping() { return true; }
  });
  vm.runInContext(sourceBetween('        async function fetchRequestCustomerMapRows(options = {}) {', '\n        function prefetchRequestModalCustomerOptions('), context);

  const callerController = new AbortController();
  const first = context.fetchRequestCustomerMapRows({ signal: callerController.signal });
  callerController.abort();
  state.permission = 'ready-v1';
  const second = context.fetchRequestCustomerMapRows({ signal: new AbortController().signal });
  assert.equal(state.requestCount, 1);
  assert.equal(state.fetchOptions.signal, undefined);
  assert.equal(state.fetchOptions.retainOnGenerationChange, true);

  const rows = [{ unique_id: 'pair-1' }];
  sourcePromise.resolve(rows);
  assert.strictEqual(await first, rows);
  assert.strictEqual(await second, rows);
  assert.equal(rows.mappingRevision, 'rev-42:ready-v1');
});

test('customer map read refuses to start before an authenticated session', async () => {
  const context = vm.createContext({
    currentUser: '',
    hasAuthenticatedOperationalReadIdentity() { return false; },
    getSupabaseReadIdentityScope() { throw new Error('identity must not be read before auth'); },
    fetchAllSupabaseRows() { throw new Error('network read must not start before auth'); }
  });
  vm.runInContext(sourceBetween('        async function fetchRequestCustomerMapRows(options = {}) {', '\n        function prefetchRequestModalCustomerOptions('), context);
  await assert.rejects(context.fetchRequestCustomerMapRows(), { code: 'DATASET_AUTH_REQUIRED' });
});

test('customer map auth guard binds legacy sessions to the active username', () => {
  const context = vm.createContext({
    currentUser: 'dylan_collyge',
    nativeAuthReadRequired: false,
    nativeAuthSessionActive: false,
    nativeAuthProfile: null,
    getRequestCapabilityUsernameKey(value) { return String(value || '').trim().toLowerCase(); },
    getCurrentAppSessionToken() { return 'session-token'; },
    readPersistedAppSessionRecord() { return { username: 'another_user' }; }
  });
  vm.runInContext(sourceBetween('        function hasAuthenticatedOperationalReadIdentity()', '\n\n        async function fetchAuthenticatedSupabaseReadPage('), context);
  assert.equal(context.hasAuthenticatedOperationalReadIdentity(), false);
  context.readPersistedAppSessionRecord = () => ({ username: 'DYLAN_COLLYGE' });
  assert.equal(context.hasAuthenticatedOperationalReadIdentity(), true);
  context.nativeAuthSessionActive = true;
  context.nativeAuthProfile = { id: 'profile-1' };
  assert.equal(context.nativeAuthReadRequired, false);
  assert.equal(context.hasAuthenticatedOperationalReadIdentity(), false, 'a native profile must match the active account');
  context.nativeAuthProfile = { id: 'profile-1', username: 'dylan_collyge' };
  assert.equal(context.hasAuthenticatedOperationalReadIdentity(), true);
  context.nativeAuthSessionActive = false;
  context.nativeAuthReadRequired = true;
  assert.equal(context.hasAuthenticatedOperationalReadIdentity(), false, 'native auth recovery cannot fall back to a legacy token');
});

test('direct heavy table reads reject before session lookup or network on pre-login routes', async () => {
  let sessionLookups = 0;
  let networkReads = 0;
  const context = vm.createContext({
    WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments',
    SUPABASE_READ_TIMEOUT_MS: 1000,
    SUPABASE_KEY: 'test-key',
    SUPABASE_URL: 'https://db.example',
    normalizeAppTableName(table) { return table; },
    hasAuthenticatedOperationalReadIdentity() { return false; },
    getNativeAuthRequestHeaders() { sessionLookups += 1; return null; },
    window: { GncDatabase: { fetchTable() { networkReads += 1; throw new Error('must not start'); } } }
  });
  vm.runInContext(sourceBetween('        async function fetchDirectPostgrestReadPage(', '\n        function classifyDatasetLoadFailureCode('), context);
  for (const table of ['ph_master_inventory', 'ph_customer_consignee_sales_reps', 'ph_soc_master', 'ph_inventory_row_assignments', 'ph_warehouse_assigned_items']) {
    await assert.rejects(context.fetchDirectPostgrestReadPage(table), { code: 'DATASET_AUTH_REQUIRED' }, table);
  }
  assert.equal(sessionLookups, 0);
  assert.equal(networkReads, 0);
});

test('authenticated heavy reads remain eligible while the separate access snapshot is loading', async () => {
  let networkReads = 0;
  const context = vm.createContext({
    WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments',
    SUPABASE_READ_TIMEOUT_MS: 1000,
    SUPABASE_KEY: 'test-key',
    SUPABASE_URL: 'https://db.example',
    normalizeAppTableName(table) { return table; },
    hasAuthenticatedOperationalReadIdentity() { return true; },
    parseSupabaseContentRangeTotal() { return 1; },
    getNativeAuthRequestHeaders() { return Promise.resolve({ Authorization: 'Bearer verified' }); },
    window: { GncDatabase: { fetchTable() {
      networkReads += 1;
      return Promise.resolve({ ok: true, headers: { get: () => '0-0/1' }, text: async () => '[{"unique_id":"row-1"}]' });
    } } }
  });
  vm.runInContext(sourceBetween('        async function fetchDirectPostgrestReadPage(', '\n        function classifyDatasetLoadFailureCode('), context);
  const result = await context.fetchDirectPostgrestReadPage('ph_soc_master');
  assert.equal(result.rows.length, 1);
  assert.equal(networkReads, 1);
});

test('identity-scoped reads survive same-account generation changes and abort on account changes', async () => {
  const context = vm.createContext({
    AbortController,
    SUPABASE_URL: 'https://db.example',
    nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile-1' },
    currentUser: 'dylan_collyge',
    currentRole: 'admin',
    currentUserDivision: '10',
    productionLiveSyncReadAuthEpoch: 1,
    getCurrentLoginCacheScopeKey() { return 'account-1'; },
    incrementInternalPerfCounter() {},
    runSupabaseReadTask(task) { return task(); },
    runSupabaseReadWithBackoff(_key, task) { return task(); },
    redactEvalSensitiveData(value) { return value; }
  });
  const sharedHelpers = sourceBetween('        const supabaseReadInFlight = new Map();', '        function isSupabaseReadTerminalDenial(');
  const dedupe = sourceBetween('        function runDedupeSupabaseRead(', '\n        async function getResponseError(');
  vm.runInContext(`${sharedHelpers}\n${dedupe}`, context);
  vm.runInContext('globalThis.bumpGeneration = () => { productionLiveSyncReadGeneration += 1; }; globalThis.changeAuthEpoch = () => { productionLiveSyncReadAuthEpoch += 1; };', context);

  const pending = deferred();
  let activeSignal;
  const first = context.runDedupeSupabaseRead('all:customer-map', ({ signal }) => {
    activeSignal = signal;
    return pending.promise;
  }, { retainOnGenerationChange: true });
  await Promise.resolve();
  context.bumpGeneration();
  context.abortSupabaseReadsBeforeGeneration();
  const second = context.runDedupeSupabaseRead('all:customer-map', () => assert.fail('a second transport started'), {
    retainOnGenerationChange: true
  });
  assert.equal(activeSignal.aborted, false);
  assert.strictEqual(first, second);
  pending.resolve(['rows']);
  assert.deepEqual(await first, ['rows']);

  const accountPending = deferred();
  let accountSignal;
  const accountRead = context.runDedupeSupabaseRead('all:account-scoped', ({ signal }) => {
    accountSignal = signal;
    return accountPending.promise;
  }, { retainOnGenerationChange: true });
  await Promise.resolve();
  context.currentUser = 'another_user';
  context.changeAuthEpoch();
  context.bumpGeneration();
  context.abortSupabaseReadsBeforeGeneration();
  assert.equal(accountSignal.aborted, true);
  accountPending.resolve(['stale']);
  await assert.rejects(accountRead, { code: 'DATASET_READ_SCOPE_CHANGED' });
});
