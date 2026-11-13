import assert from 'node:assert/strict';
import vm from 'node:vm';
import {read,functionSource,runFunctions,plain} from './golden-test-environment.mjs';
import {buildColdHydrationJoinFixture} from '../../src/core/golden-cold-hydration-fixture.mjs';
const createColdHydrationJoinFixture=(identity,getIdentity)=>buildColdHydrationJoinFixture(runFunctions,identity,getIdentity);

export async function invariant157() {
  const context = vm.createContext({ module: { exports: {} }, Date, Promise,
    MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, APP_API_FUNCTION_URL: '/app-api',
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
    applyManualSyncStatus() {}, setTimeout: callback => { callback(); return 0; } });
  context.postAppFunctionJson = async (_url, body) => {
    context.sliceRowLimits.push(body.maxRowsPerSlice);
    if (context.sliceFailures-- > 0) throw Object.assign(new Error('worker limit'), { status: 546 });
    return { ok: true, status: 'DONE', data: { runStatus: { active: false, runId: 'run-six-retries' } } };
  };
  context.sliceRowLimits = [];
  context.sliceFailures = 6;
  runFunctions('assets/app-runtime.js', ['getTransientManualErpSliceStatus','reduceManualErpSliceLimit','continueManualErpSync'], context);
  const result = await context.continueManualErpSync({ runId: 'run-six-retries' });
  assert.equal(result.active, false);
  assert.deepEqual(plain(context.sliceRowLimits), [2500,1250,600,600,600,600,600]);
}

export async function invariant163() {
  const access = { canViewAssignedItemsExport: true, canManageCustomerRepMappings: true, canManageAccessControl: true };
  const managerItems = runFunctions('assets/app-runtime.js', ['getManagerTableManagementItems'], {
    canUseHistoricalRequests: () => true, canOpenPhotoHistory: () => true,
  }).getManagerTableManagementItems(access);
  const editable = managerItems.filter(item => item.section === 'editable').map(item => item.id);
  const archive = managerItems.filter(item => item.section === 'archive').map(item => item.id);
  assert.deepEqual(plain(editable), ['assigned-items', 'company-directory', 'inquiry-coverage', 'customer-assignments', 'user-role-access']);
  assert.deepEqual(plain(archive), ['historical-drive-mode', 'historical-soc-open-orders', 'historical-soc-reserves', 'historical-requests', 'photo-history']);

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://agdata.invalid/' });
  try {
    dom.window.confirm = () => true;
    vm.runInContext(read('assets/manager-table-management.js'), vm.createContext({ window: dom.window, document: dom.window.document,
      Blob: dom.window.Blob, FormData: dom.window.FormData, URL: dom.window.URL, CSS: { escape: value => String(value) }, setTimeout, clearTimeout }));
    const rootNode = dom.window.document.getElementById('root');
    const view = dom.window.GncManagerTableManagement.mountManagerTableManagement(rootNode, {
      tables: managerItems.map(item => item.id), request: async request => ({ rows: request.operation === 'users' ? [{ username: 'any_app_user', display_name: 'Any App User' }] : [], total: 487 }), openTable() {},
    });
    assert.equal(rootNode.querySelectorAll('[data-table-select]').length, 10);
    assert.equal(rootNode.querySelectorAll('.tm-choice em').length, 10);
    rootNode.querySelector('[data-table-select="inquiry-coverage"]').click();
    await new Promise(resolve => setImmediate(resolve));
    rootNode.querySelector('[data-add]').click();
    assert.equal(rootNode.querySelector('[name="primary_user"] option[value="any_app_user"]')?.textContent.includes('Any App User'), true,
      'coverage user options are supplied by the app-wide users read');
    view.destroy();
  } finally { dom.window.close(); }
}

export async function invariant180() {
  const homeContext = functionSource('assets/app-runtime.js', 'getProductionLiveSyncContext');
  const homeFallback = homeContext.slice(homeContext.indexOf("if (view === 'home'"), homeContext.indexOf('const hasDataCohort'));
  assert.match(homeFallback, /getProductionCoreLiveProjection\('master', view, foregroundContext\)/,
    'Home fallback must use the canonical projection selector while a cold full master load is active');
  assert.match(homeFallback, /createProductionCoreLiveAdapter\('master', projection/);

  const loaderSource = functionSource('assets/app-runtime.js','getOwnedColdDatasetLoad');
  assert.match(functionSource('assets/app-runtime.js','ensureDatasetLoaded'),/getOwnedColdDatasetLoad\(key,mode\)[\s\S]*?ensureCoordinatedDataset/);
  assert.match(loaderSource, /coldSourceHydrations\.has\(key\)[\s\S]*?ownerIdentity !== owner[\s\S]*?state\.fullPromise\.then/,
    'the coordinator path must join the same owner’s in-flight cold full promise before creating another adapter');
  assert.match(functionSource('assets/app-runtime.js', 'hydrateColdSource'),
    /Object\.defineProperty\(promise, 'ownerIdentity', \{ value: owner/,
    'the cold promise must carry its identity owner for safe joining');

  const sameOwner = createColdHydrationJoinFixture('account-a');
  assert.equal(sameOwner.calls(), 0, 'same-owner cold full load joins without starting a coordinator request');
  sameOwner.resolveFull(true);
  assert.equal(await sameOwner.promise, true, 'joined caller receives the cold full result');

  let currentOwner = 'account-a';
  const stale = createColdHydrationJoinFixture('account-a',() => currentOwner);
  currentOwner = 'account-c';
  stale.resolveFull(true);
  assert.equal(await stale.promise,false,'an identity change while awaiting the cold promise discards its result');
  assert.equal(stale.calls(),0,'stale cold work is not replaced by a second coordinator fetch');

  const assignmentReader = functionSource('assets/app-runtime.js', 'fetchAllSupabaseRows');
  assert.match(assignmentReader, /identityScopedAssignmentRead = String\(table \|\| ''\)\.trim\(\) === WAREHOUSE_ASSIGNED_ITEMS_TABLE/,
    'the physical assignment table must share its canonical full-snapshot query across callers');
  const routed = [];
  const routing = runFunctions('assets/app-runtime.js', ['fetchAllSupabaseRows'], {
    REQUEST_HISTORY_TABLE: 'history', SALES_CREDIT_REQUESTS_TABLE: 'credits', WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments',
    runDedupeSupabaseRead: (_key, _task, options) => { routed.push(options); return Promise.resolve([]); },
  });
  const signal = new AbortController().signal;
  await routing.fetchAllSupabaseRows('ph_inventory_row_assignments', 'select=*', { signal });
  assert.equal(routed[0].signal, null); assert.equal(routed[0].retainOnGenerationChange, true);
  await routing.fetchAllSupabaseRows('ph_soc_master', 'select=*', { signal, retainOnGenerationChange: true });
  assert.equal(routed[1].signal, null); assert.equal(routed[1].retainOnGenerationChange, true);
  await routing.fetchAllSupabaseRows('ph_soc_master', 'select=*', { signal });
  assert.equal(routed[2].signal, signal); assert.equal(routed[2].retainOnGenerationChange, false);
}

export async function invariant209() {
  const tasks = [], calls = [];
  const relay = runFunctions('supabase/functions/app-api/index.ts', ['dispatchCloudErpSync'], {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', ERP_SYNC_CLOUD_WORKER_KEY: 'private-worker',
    EdgeRuntime: { waitUntil: task => tasks.push(task) }, AbortSignal, Date, Promise,
    setTimeout: callback => { callback(); return 0; }, recordHandledError() {},
    fetch: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ claimed: true }) }; }
  });
  await relay.dispatchCloudErpSync({ runId: 'durable-run' }, 0); await Promise.all(tasks);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://example.supabase.co/functions/v1/app-api');
  assert.deepEqual(plain(calls[0].body), { action: 'erp_sync', operation: 'continue', runId: 'durable-run', relayHop: 1 });
  assert.equal(calls[0].headers.authorization, 'Bearer private-worker');
  relay.dispatchCloudErpSync({ runId: 'durable-run' }, 40); assert.equal(calls.length, 1);
  const { validateErpSyncCommand } = await import('../../supabase/functions/_shared/erp-sync.mjs');
  assert.equal(validateErpSyncCommand({ action: 'erp_sync', operation: 'status', autoRelay: false }).ok, true);
  assert.equal(validateErpSyncCommand({ action: 'erp_sync', operation: 'status', autoRelay: 'false' }).ok, false);
  let wakes = 0;
  const status = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncAction'], {
    validateErpSyncCommand, jsonObject: value => value, jsonResponse: value => value,
    supabase: { rpc: async () => ({ data: { active: true, runId: 'durable-run' } }) }, dispatchCloudErpSync: () => { wakes++; }
  });
  await status.handleErpSyncAction({}, { operation: 'status', autoRelay: false }, {}); assert.equal(wakes, 0);
  await status.handleErpSyncAction({}, { operation: 'status' }, {}); assert.equal(wakes, 1);
  const auth = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncContinuation'], {
    ERP_SYNC_CLOUD_WORKER_KEY: 'private-worker', errorResponse: (_message, code) => ({ status: code })
  });
  assert.equal((await auth.handleErpSyncContinuation({ operation: 'continue' }, new Request('https://example.test', {headers:{authorization:'Bearer anon','x-agdata-internal-relay':'1'}}))).status, 401);
  const writes = [], updates = [];
  const client = runFunctions('assets/app-runtime.js', ['runGoogleAppsScriptTrigger', 'continueManualErpSync', 'refreshManualSyncOnForeground'], {
    isRunScriptActive: false, window: {}, currentUser: 'dylan_collyge', document: { hidden: false }, navigator: { onLine: true },
    releaseStaleManualSyncClientStateIfNeeded() {}, canRunManualInventoryImport: () => true, syncGoogleScriptButton() {}, showToast() {},
    getSupabaseReadIdentityScope: () => 'same', getNativeAuthRequestHeaders: async () => ({ Authorization:'Bearer verified' }),
    crypto: { randomUUID: () => 'command' }, MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT: [], APP_API_FUNCTION_URL: '/api',
    applyManualSyncStatus: value => updates.push(value), lastManualSyncStatusCheckedAt: 1,
    postAppFunctionJson: async (_url, body, options) => { writes.push({body,options}); return { ok:true,cloudRelay:true,data:{active:true,runId:'durable-run'} }; },
    refreshManualSyncStatus: async force => { assert.equal(force,true); updates.push('status'); },
    refreshDashboardSyncMetadata: async () => updates.push('metadata'),
    getProductionLiveSyncCoordinator: () => ({ check: async () => updates.push('revisions') }),
    MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 60000, Date, Promise,
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== '')
  });
  await client.runGoogleAppsScriptTrigger(); assert.equal(writes.length,1); assert.equal(writes[0].body.operation,'start');
  assert.equal(writes[0].options.keepalive,true); assert.equal(client.isRunScriptActive,false);
  client.document.hidden=true; await client.continueManualErpSync({runId:'durable-run'}); assert.equal(writes.length,1);
  client.document.hidden=false; assert.equal(client.refreshManualSyncOnForeground(),true);
  assert.ok(updates.includes('status')); assert.ok(updates.includes('metadata')); assert.ok(updates.includes('revisions'));
  const source=read('assets/app-runtime.js');
  assert.match(source,/pageshow[^]*refreshManualSyncOnForeground/);
  assert.match(source,/visibilitychange[^]*refreshManualSyncOnForeground/);
  assert.doesNotMatch(source,/throw new Error\([^\n]*ERP_SYNC_CONTINUE_DEADLINE/);
}
