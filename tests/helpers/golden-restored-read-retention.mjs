import assert from 'node:assert/strict';
import {read,functionSource,runFunctions} from './golden-test-environment.mjs';

async function assertReadOwners() {
const coldLoader = functionSource('assets/app-runtime.js', 'hydrateColdSource');
assert.match(coldLoader, /retryOnCancellation: true,\s*retainOnGenerationChange: true/);
const datasetLoader = read('assets/dataset-load-runtime.js');
assert.match(datasetLoader, /options\.retainOnGenerationChange === true \? \{retainOnGenerationChange:true\} : \{\}/,
    'explicit cold-read retention must reach generic full dataset fetches');
const genericReader = functionSource('assets/app-runtime.js', 'fetchAllSupabaseRows');
assert.match(genericReader, /signal: identityScopedAssignmentRead \|\| identityScopedOperationalRead \|\| opts\.retainOnGenerationChange === true \? null/,
    'explicitly retained generic reads must detach their initiating view signal');
}

async function assertRevisionScope() {
let owner = 'same-account';
let callCount = 0;
const transportSignals = [];
const dedupeOptions = [];
const ctx = runFunctions('assets/app-runtime.js', ['supabaseRpc'], {
    APP_API_FUNCTION_URL: '/app-api',
    assertEvalDataSourceAllowed() {},
    getSupabaseReadIdentityScope: () => owner,
    staleSupabaseReadScopeError: () => Object.assign(new Error('stale identity'), { code: 'STALE_SCOPE' }),
    runDedupeSupabaseRead: async (key, task, options) => {
      callCount += 1; dedupeOptions.push({ key, ...options });
      return task({ signal: new AbortController().signal });
    },
    SUPABASE_URL: 'https://fixture.test', getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer native' }),
    window: { GncDatabase: { fetchRpc: async (_url, _rpc, options) => {
      transportSignals.push(options.signal);
      return Response.json({ accepted: JSON.parse(options.body).p_dataset_keys });
    } } },
  });
const external = new AbortController();
const result = await ctx.supabaseRpc('get_my_dataset_revisions_v1', {
    p_dataset_keys: [' ph_soc_master ', 'ph_master_inventory', 'ph_soc_master'],
  }, { signal: external.signal });
assert.deepEqual(Array.from(result.accepted), ['ph_master_inventory', 'ph_soc_master']);
assert.equal(callCount, 1);
assert.equal(dedupeOptions[0].key, 'dataset-revisions:["ph_master_inventory","ph_soc_master"]');
assert.equal(dedupeOptions[0].signal, null, 'a view cancellation cannot abort the shared revisions transport');
assert.equal(dedupeOptions[0].retainOnGenerationChange, true, 'navigation/permission generation changes retain same-account metadata work');
assert.ok(transportSignals[0] instanceof AbortSignal);
const preAborted = new AbortController();
preAborted.abort();
await assert.rejects(ctx.supabaseRpc('get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] }, { signal: preAborted.signal }),
    error => error?.code === 'REQUEST_ABORTED');
assert.equal(callCount, 1, 'an already-cancelled caller must not start the network request');
let releaseTransport;
const fenced = runFunctions('assets/app-runtime.js', ['supabaseRpc'], {
    APP_API_FUNCTION_URL: '/app-api', assertEvalDataSourceAllowed: () => {},
    getSupabaseReadIdentityScope: () => owner,
    staleSupabaseReadScopeError: () => Object.assign(new Error('stale identity'), { code: 'STALE_SCOPE' }),
    runDedupeSupabaseRead: (_key, task) => task({ signal: new AbortController().signal }),
    SUPABASE_URL: 'https://fixture.test', getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer native' }),
    window: { GncDatabase: { fetchRpc: () => new Promise(resolve => { releaseTransport = resolve; }) } },
  });
const pending = fenced.supabaseRpc('get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] });
await new Promise(resolve => setImmediate(resolve));
owner = 'different-account';
releaseTransport(Response.json({ shouldNotEscape: true }));
await assert.rejects(pending, error => error?.code === 'STALE_SCOPE', 'a retained response cannot cross an account change');
}

async function assertColdReadScope() {
let readOwner = 'owner-a';
let generation = 1;
let factoryCalls = 0;
let finishFirstRead;
const readCtx = runFunctions('assets/app-runtime.js', ['runDedupeSupabaseRead'], {
    AbortController,
    productionLiveSyncReadGeneration: generation,
    getSupabaseReadIdentityScope: () => readOwner,
    getSupabaseReadCooldownKey: (identity, key) => `${identity}:${key}`,
    getSupabaseReadTerminalKey: (identity, key) => `${identity}:${key}`,
    supabaseReadInFlight: new Map(), supabaseReadLatestByKey: new Map(),
    supabaseReadTerminalDenials: new Map(), supabaseReadFailureCooldowns: new Map(),
    incrementInternalPerfCounter() {},
    runSupabaseReadTask: task => task(), runSupabaseReadWithBackoff: (_key, task) => task(),
    redactEvalSensitiveData: value => value,
    staleSupabaseReadScopeError: () => Object.assign(new Error('stale read'), { code: 'STALE_SCOPE' }),
  });
const coldRead = readCtx.runDedupeSupabaseRead('all:ph_soc_master:select=*', () => {
    factoryCalls += 1; return new Promise(resolve => { finishFirstRead = resolve; });
  }, { retainOnGenerationChange: true });
generation += 1;
readCtx.productionLiveSyncReadGeneration = generation;
const coordinatorRead = readCtx.runDedupeSupabaseRead('all:ph_soc_master:select=*', () => {
    factoryCalls += 1; return Promise.resolve('duplicate');
  });
assert.equal(factoryCalls, 1, 'ordinary coordinator callers join a retained same-owner cold transport across generations');
finishFirstRead('shared');
assert.equal(await coldRead, 'shared');
assert.equal(await coordinatorRead, 'shared');
readOwner = 'owner-b';
let finishSecondRead;
const otherAccountRead = readCtx.runDedupeSupabaseRead('all:ph_soc_master:select=*', () => {
    factoryCalls += 1; return new Promise(resolve => { finishSecondRead = resolve; });
  });
assert.equal(factoryCalls, 2, 'a different account cannot join the previous owner’s retained result');
finishSecondRead('owner-b');
assert.equal(await otherAccountRead, 'owner-b');
}

export async function invariant182(){
 await assertReadOwners();
 await assertRevisionScope();
 await assertColdReadScope();
}
