import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
const code = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const pinnedFinishRpc = 'finish_dataset_import_with_sources_v1';

function revisionImportRpc(events, reconciliationRequests, { recovery = false,
  deferredAttempts = 0, codeOnlyDeferred = false, reconciliationFailure = false,
  heartbeatFailure = false, lostBeginResponse = false, batchFailure = false } = {}) {
  let lost = lostBeginResponse;
  let reconciliationCalls = 0;
  return (name, payload) => {
    if (name === 'reconcile_season_sales_office_v1' && payload.p_dry_run) {
      reconciliationRequests.push(plain(payload));
      return {
        ok: true, status: 'dry_run', seasonCode: 'F1', salesYear: 27,
        scopeCount: 1, itemcodes: ['SYNTHETIC'], scopeHash: 'a'.repeat(64),
        winnerCount: 1, openCount: 0, doneCount: 0, newStateCount: 0,
        winnerChangeCount: 0, reopenCount: 0, retireCount: 0, mirrorUpsertCount: 0
      };
    }
    events.push({ action: name, payload: plain(payload) });
    if (name === 'get_dataset_import_status_v1') return { ok: true, requiresRecovery: recovery };
    if (name === 'begin_dataset_import_v1' && lost) {
      lost = false;
      throw new Error('Network response lost');
    }
    if (name === 'heartbeat_dataset_import_v1' && heartbeatFailure) throw new Error('DATASET_IMPORT_FENCE_LOST');
    if (name === 'begin_dataset_import_v1' || name === 'heartbeat_dataset_import_v1') return { ok: true, state: 'active' };
    if (name === 'finish_dataset_import_v1') return { ok: true, state: 'completed' };
    if (name === pinnedFinishRpc) return { ok: true, state: 'completed', sourceMetadataStamped: true };
    if (name === 'fail_dataset_import_v1') return { ok: true, state: 'failed' };
    if (name !== 'reconcile_season_sales_office_v1') throw new Error(`Unexpected RPC ${name}`);
    reconciliationRequests.push(plain(payload));
    reconciliationCalls++;
    if (reconciliationFailure) throw new Error('ordinary synthetic failure');
    if (reconciliationCalls <= deferredAttempts && codeOnlyDeferred) return { ok: true, code: 'MAINTENANCE_DEFERRED' };
    if (reconciliationCalls <= deferredAttempts) return { ok: true, status: 'maintenance_deferred' };
    if (batchFailure) return { ok: false, status: 'failed' };
    return {
      ok: true, status: 'completed', seasonCode: 'F1', salesYear: 27,
      winnerCount: 1, openCount: 1, doneCount: 0, newStateCount: 0,
      winnerChangeCount: 0, reopenCount: 0, retireCount: 0,
      mirrorUpsertCount: 1, scopeHash: 'b'.repeat(64),
    };
  };
}

function recordRevisionDeletes(requests, events, deleteFailure) {
  const status = deleteFailure ? 503 : 204;
  const body = deleteFailure ? 'synthetic failure' : '';
  return requests.map(request => {
    events.push({ action: 'delete', headers: plain(request.headers) });
    return { getResponseCode: () => status, getContentText: () => body };
  });
}

function environment({ changed = true, deleteFailure = false, archiveFailure = false, ...rpcOptions } = {}) {
  const events = [];
  const reconciliationRequests = [];
  let locked = false;
  const lock = { hasLock: () => locked, waitLock: () => { assert.equal(locked, false); locked = true; events.push('lock'); }, releaseLock: () => { locked = false; events.push('unlock'); } };
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    LockService: { getScriptLock: () => lock },
    Utilities: { getUuid: randomUUID, sleep: ms => events.push({ action: 'sleep', ms }), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => Array.from(createHash('sha256').update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') },
    UrlFetchApp: { fetchAll: requests => recordRevisionDeletes(requests, events, deleteFailure) },
    events, changed, archiveFailure,
  });
  new vm.Script(code).runInContext(ctx);
  ctx.callSupabaseRpc_ = revisionImportRpc(events, reconciliationRequests, rpcOptions);
  vm.runInContext(`
    getDriveFolderByIdWithRetry_ = () => ({});
    listDriveFilesWithRetry_ = () => { let used=false; return { hasNext:()=>!used, next:()=>{used=true;return {getId:()=> 'synthetic-drive-file',getName:()=> 'synthetic.csv',getLastUpdated:()=>new Date(0)}} }; };
    extractDataFromFile = () => [['ITEMCODE'],['SYNTHETIC']];
    fetchAllSupabaseData = () => [];
    getPayloadSelectColumns_ = () => 'unique_id';
    getSupabaseFetchOptionsForTable_ = () => ({});
    combineSnapshotDeleteIds_ = () => changed ? ['obsolete'] : [];
    pushToSupabase = () => events.push({action:'upsert',headers:getSupabaseHeaders_()});
    emitTableSyncLiveEvent_ = () => {};
    moveDriveFileToFolderWithRetry_ = () => { events.push('archive'); if(archiveFailure) throw new Error('Drive unavailable'); };
    __build = () => ({upserts: changed ? [{unique_id:'present'}] : [],seenIds:new Set(['present']),totalRows:1,stats:{sourceRows:1,validIdentityRows:1}});
    __run = () => processLatestFileOnlyFolder('source','processed','ph_soc_master',__build,{deltaMode:true,
      afterCommit:()=>reconcileSeasonSalesOfficeAfterImport_('synthetic-version','test')});
  `, ctx);
  return { ctx, events, reconciliationRequests, run: () => vm.runInContext('__run()', ctx), locked: () => locked };
}
const actions = env => env.events.map(event => typeof event === 'string' ? event : event.action);
const hasFinish = env => actions(env).some(action => action === pinnedFinishRpc || action === 'finish_dataset_import_v1');

test('SOC timeout batches split serially without changing rows or import headers', () => {
  const env = environment(); const requests = []; const batchSizes = [];
  const response = rows => ({ getResponseCode: () => rows.length > 100 ? 500 : 201,
    getContentText: () => rows.length > 100 ? JSON.stringify({ code: '57014', message: 'synthetic timeout' }) : '' });
  env.ctx.UrlFetchApp.fetch = (_, request) => { const rows = JSON.parse(request.payload); requests.push(request); return response(rows); };
  env.ctx.executeFetchAllBatches = (batch, size) => { batchSizes.push(size); return batch.map(request => {
    requests.push(request); return response(JSON.parse(request.payload));
  }); };
  const rows = Array.from({ length: 1000 }, (_, i) => ({ unique_id: 'synthetic-' + i }));
  env.ctx.testRows = rows;
  const failures = vm.runInContext(`datasetImportFenceContext_ = {runId:'fixture-fence'}; executeSupabaseUpsert_('ph_soc_master', testRows)`, env.ctx);
  assert.equal(failures.length, 0);
  assert.deepEqual(batchSizes, [1]);
  const successful = requests.map(request => JSON.parse(request.payload)).filter(chunk => chunk.length <= 100).flat();
  assert.deepEqual(successful, rows);
  for (const request of requests) assert.equal(request.headers['x-gnc-import-run-id'], 'fixture-fence');
});

test('SOC permanent errors stop without splitting; generic imports retain their batching', () => {
  const env = environment(); let extraFetches = 0;
  env.ctx.UrlFetchApp.fetch = () => { extraFetches++; throw new Error('unexpected retry'); };
  env.ctx.response = { getResponseCode: () => 400, getContentText: () => JSON.stringify({ code: '23505' }) };
  env.ctx.request = { payload: JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ unique_id: 'synthetic-' + i }))) };
  const failures = vm.runInContext(`executeSupabaseUpsertRequestWithRecovery_('ph_soc_master',request,response,1,0)`, env.ctx);
  assert.equal(failures.length, 1); assert.equal(extraFetches, 0);
  assert.equal(vm.runInContext(`usesBoundedImportUpserts_('ph_cav_import')`, env.ctx), false);
});

test('import diagnostics expose only recognized SQLSTATE or internal stage codes', () => {
  const env = environment();
  for (const [message, expected] of [
    ['Supabase upsert failed for ph_soc_master (500): {"code":"57014","details":"private row contents"}', 'IMPORT_DATABASE_57014'],
    ['Supabase delete failed for ph_soc_master (400): {"code":"23503"}', 'IMPORT_DATABASE_23503'],
    ['SEASON_SALES_RECONCILIATION_FAILED', 'SEASON_SALES_RECONCILIATION_FAILED'],
    ['private row contents 57014', 'MANUAL_SYNC_STAGE_FAILED'],
    ['Supabase upsert failed for ph_soc_master (500): {"code":"private row contents"}', 'MANUAL_SYNC_STAGE_FAILED']
  ]) {
    env.ctx.testMessage = message;
    assert.equal(vm.runInContext(`normalizeManualSyncFailedFileEntries_({failedFileErrors:[{name:'fixture',error:testMessage}]})[0].errorCode`, env.ctx), expected);
  }
});
test('full import locks before reads, fences writes/derived reconciliation, then archives', () => {
  const env = environment(); const result = env.run();
  assert.equal(result.failedFiles, 0, JSON.stringify(result.failedFileErrors));
  const names = actions(env);
  assert.deepEqual(names, ['lock','begin_dataset_import_v1','upsert','delete','heartbeat_dataset_import_v1','reconcile_season_sales_office_v1',pinnedFinishRpc,'archive','unlock']);
  const begin = env.events.find(event => event.action === 'begin_dataset_import_v1');
  for (const event of env.events.filter(event => event.headers)) assert.equal(event.headers['x-gnc-import-run-id'], begin.payload.p_run_id);
  assert.deepEqual(begin.payload.p_canonical_keys, ['ph_soc_master']);
  assert.deepEqual(env.events.find(event => event.action === pinnedFinishRpc)?.payload, {
    p_run_id: begin.payload.p_run_id, p_sources: [{ key: 'ph_soc_master', fileName: 'synthetic.csv', fileId: 'synthetic-drive-file' }],
  });
  assert.deepEqual(env.reconciliationRequests.map(request => request.p_dry_run), [true, false, true]);
  assert.deepEqual(env.reconciliationRequests[1].p_itemcodes, ['SYNTHETIC']);
  assert.ok(env.reconciliationRequests[1].p_idempotency_key);
  assert.equal(env.reconciliationRequests[0].p_itemcodes, null);
  assert.equal(env.reconciliationRequests[2].p_itemcodes, null);
  assert.equal(env.locked(), false);
});
test('master fence batches assignment reconciliation with a heartbeat before each batch', () => {
  const env = environment();
  const batchResponses = [
    { ok: true, status: 'in_progress', processed: 100, total: 250, cursor: 'c1' },
    { ok: true, status: 'in_progress', processed: 200, total: 250, cursor: 'c2' },
    { ok: true, status: 'completed', processed: 250, total: 250, cursor: null }
  ];
  env.ctx.callSupabaseRpc_ = (name, payload) => {
    env.events.push({ action: name, payload: plain(payload) });
    if (name === 'heartbeat_dataset_import_v1') return { ok: true, state: 'active' };
    if (name === 'reconcile_inventory_row_assignments_batch_v1') return batchResponses.shift();
    if (name === 'finish_dataset_import_v1') return { ok: true, state: 'completed' };
    if (name === 'fail_dataset_import_v1') return { ok: true, state: 'failed' };
    throw new Error(`Unexpected RPC ${name}`);
  };
  env.ctx.assignmentContext = { runId: 'master-run', keys: ['ph_master_inventory'], canonicalKeys: ['ph_master_inventory'], lock: { releaseLock() {} }, ownsLock: false };
  vm.runInContext('datasetImportFenceContext_ = assignmentContext; closeDatasetImportFence_(assignmentContext, true)', env.ctx);
  const names = actions(env);
  assert.deepEqual(names, [
    'heartbeat_dataset_import_v1', 'reconcile_inventory_row_assignments_batch_v1',
    'heartbeat_dataset_import_v1', 'reconcile_inventory_row_assignments_batch_v1',
    'heartbeat_dataset_import_v1', 'reconcile_inventory_row_assignments_batch_v1',
    'finish_dataset_import_v1'
  ]);
  const batches = env.events.filter(event => event.action === 'reconcile_inventory_row_assignments_batch_v1');
  assert.deepEqual(batches.map(event => event.payload), [
    { p_import_run_id: 'master-run', p_batch_size: 100 },
    { p_import_run_id: 'master-run', p_batch_size: 100 },
    { p_import_run_id: 'master-run', p_batch_size: 100 }
  ]);
});
test('assignment reconciliation failure never finishes the import as ready', () => {
  const env = environment();
  env.ctx.callSupabaseRpc_ = (name, payload) => {
    env.events.push({ action: name, payload: plain(payload) });
    if (name === 'heartbeat_dataset_import_v1') return { ok: true, state: 'active' };
    if (name === 'reconcile_inventory_row_assignments_batch_v1') return { ok: false, status: 'failed', processed: 0, total: 10, cursor: null };
    if (name === 'fail_dataset_import_v1') return { ok: true, state: 'failed' };
    if (name === 'finish_dataset_import_v1') return { ok: true, state: 'completed' };
    throw new Error(`Unexpected RPC ${name}`);
  };
  env.ctx.assignmentContext = { runId: 'master-run', keys: ['ph_master_inventory'], canonicalKeys: ['ph_master_inventory'], lock: { releaseLock() {} }, ownsLock: false };
  assert.throws(() => vm.runInContext('datasetImportFenceContext_ = assignmentContext; closeDatasetImportFence_(assignmentContext, true)', env.ctx), /ASSIGNMENT_RECONCILIATION/);
  assert.ok(!actions(env).includes('finish_dataset_import_v1'));
});
test('assignment reconciliation accepts one explicit witness reset and stops on a second reset', () => {
  const env = environment(); let calls = 0;
  env.ctx.callSupabaseRpc_ = (name, payload) => {
    env.events.push({ action: name, payload: plain(payload) });
    if (name === 'heartbeat_dataset_import_v1') return { ok: true, state: 'active' };
    if (name === 'reconcile_inventory_row_assignments_batch_v1') {
      calls++;
      return calls === 1
        ? { ok: true, status: 'reset', processed: 0, total: 120, cursor: null }
        : calls === 2
          ? { ok: true, status: 'in_progress', processed: 100, total: 120, cursor: 'c1' }
          : { ok: true, status: 'completed', processed: 120, total: 120, cursor: null };
    }
    if (name === 'finish_dataset_import_v1') return { ok: true, state: 'completed' };
    throw new Error(`Unexpected RPC ${name}`);
  };
  env.ctx.assignmentContext = { runId: 'master-run', keys: ['ph_master_inventory'], canonicalKeys: ['ph_master_inventory'], lock: { releaseLock() {} }, ownsLock: false };
  vm.runInContext('datasetImportFenceContext_ = assignmentContext; closeDatasetImportFence_(assignmentContext, true)', env.ctx);
  assert.equal(actions(env).filter(action => action === 'reconcile_inventory_row_assignments_batch_v1').length, 3);
  assert.ok(actions(env).includes('finish_dataset_import_v1'));

  const repeatedReset = environment();
  repeatedReset.ctx.callSupabaseRpc_ = (name, payload) => {
    repeatedReset.events.push({ action: name, payload: plain(payload) });
    if (name === 'heartbeat_dataset_import_v1') return { ok: true, state: 'active' };
    if (name === 'reconcile_inventory_row_assignments_batch_v1') return { ok: true, status: 'reset', processed: 0, total: 1, cursor: null };
    if (name === 'fail_dataset_import_v1') return { ok: true, state: 'failed' };
    throw new Error(`Unexpected RPC ${name}`);
  };
  repeatedReset.ctx.assignmentContext = { runId: 'master-run', keys: ['ph_master_inventory'], canonicalKeys: ['ph_master_inventory'], lock: { releaseLock() {} }, ownsLock: false };
  assert.throws(() => vm.runInContext('datasetImportFenceContext_ = assignmentContext; closeDatasetImportFence_(assignmentContext, true)', repeatedReset.ctx), /ASSIGNMENT_RECONCILIATION_RESET_INVALID/);
  assert.ok(!actions(repeatedReset).includes('finish_dataset_import_v1'));
});
test('assignment batching preserves the database source-and-canonical master gate', () => {
  const env = environment();
  env.ctx.callSupabaseRpc_ = (name, payload) => { env.events.push({ action: name, payload: plain(payload) }); return { ok: true, state: 'completed' }; };
  env.ctx.assignmentContext = { runId: 'master-run', keys: ['ph_master_inventory'], canonicalKeys: ['ph_soc_master'], lock: { releaseLock() {} }, ownsLock: false };
  vm.runInContext('datasetImportFenceContext_ = assignmentContext; closeDatasetImportFence_(assignmentContext,true)', env.ctx);
  assert.deepEqual(actions(env), ['finish_dataset_import_v1']);
});
test('failed pruning does not publish ready or archive canonical input', () => {
  const env = environment({ deleteFailure: true });
  assert.equal(env.run().failedFiles, 1);
  assert.ok(actions(env).includes('fail_dataset_import_v1'));
  assert.equal(hasFinish(env), false);
  assert.ok(!actions(env).includes('archive'));
  assert.equal(env.locked(), false);
});
test('deferred derived reconciliation retries with bounded backoff and completes before ready', () => {
  const env = environment({ deferredAttempts: 3 });
  assert.equal(env.run().failedFiles, 0);
  assert.equal(actions(env).filter(action => action === 'reconcile_season_sales_office_v1').length, 4);
  assert.deepEqual(env.events.filter(event => event.action === 'sleep').map(event => event.ms), [2000, 4000, 8000]);
  assert.equal(actions(env).filter(action => action === 'heartbeat_dataset_import_v1').length, 4,
    'heartbeat once before each batch plus once after each deferred backoff');
  assert.ok(actions(env).includes(pinnedFinishRpc));
});
test('code-only maintenance deferral retries and completes before ready', () => {
  const env = environment({ deferredAttempts: 1, codeOnlyDeferred: true });
  assert.equal(env.run().failedFiles, 0);
  assert.equal(actions(env).filter(action => action === 'reconcile_season_sales_office_v1').length, 2);
  assert.deepEqual(env.events.filter(event => event.action === 'sleep').map(event => event.ms), [2000]);
  assert.equal(actions(env).filter(action => action === 'heartbeat_dataset_import_v1').length, 2);
  assert.ok(actions(env).includes(pinnedFinishRpc));
});
test('exhausted deferred reconciliation fails the fence and leaves the file retryable', () => {
  const env = environment({ deferredAttempts: 4 });
  assert.equal(env.run().failedFiles, 1);
  assert.equal(actions(env).filter(action => action === 'reconcile_season_sales_office_v1').length, 4);
  assert.ok(actions(env).includes('fail_dataset_import_v1'));
  assert.equal(hasFinish(env), false);
  assert.ok(!actions(env).includes('archive'));
});
test('ordinary reconciliation failures are not retried and persist only a safe stage code', () => {
  const env = environment({ reconciliationFailure: true });
  const result = env.run();
  assert.equal(result.failedFiles, 1);
  assert.equal(actions(env).filter(action => action === 'reconcile_season_sales_office_v1').length, 1);
  assert.equal(result.failedFileErrors[0].error, 'SEASON_SALES_RECONCILIATION_FAILED');
  assert.ok(actions(env).includes('fail_dataset_import_v1'));
});
test('failed Season batch keeps the import fenced and canonical file retryable', () => {
  const env = environment({ batchFailure: true });
  const result = env.run();
  assert.equal(result.failedFiles, 1);
  assert.deepEqual(env.reconciliationRequests.map(request => request.p_dry_run), [true, false]);
  assert.ok(actions(env).includes('fail_dataset_import_v1'));
  assert.equal(hasFinish(env), false);
  assert.ok(!actions(env).includes('archive'));
  assert.equal(env.locked(), false);
});
test('heartbeat lease failure stops deferred reconciliation before another attempt', () => {
  const env = environment({ deferredAttempts: 1, heartbeatFailure: true });
  const result = env.run();
  assert.equal(result.failedFiles, 1);
  assert.equal(actions(env).filter(action => action === 'reconcile_season_sales_office_v1').length, 0,
    'a failed required heartbeat must stop before submitting the planned batch');
  assert.deepEqual(env.reconciliationRequests.map(request => request.p_dry_run), [true]);
  assert.equal(actions(env).filter(action => action === 'heartbeat_dataset_import_v1').length, 1);
  assert.equal(result.failedFileErrors[0].error, 'DATASET_IMPORT_FENCE_LOST');
  assert.ok(actions(env).includes('fail_dataset_import_v1'));
  assert.equal(hasFinish(env), false);
});
test('an unpinned zero-delta check does not emit a revision fence', () => {
  const env = environment({ changed: false });
  assert.equal(vm.runInContext("beginDatasetImportFenceIfNeeded_('ph_soc_master', false)", env.ctx), null);
  assert.ok(actions(env).includes('get_dataset_import_status_v1'));
  assert.ok(!actions(env).includes('begin_dataset_import_v1'));
});
test('a pending zero-delta file stamps the exact source before archival', () => {
  const env = environment({ changed: false });
  assert.equal(env.run().failedFiles, 0);
  assert.ok(actions(env).includes('begin_dataset_import_v1'));
  assert.ok(actions(env).includes(pinnedFinishRpc));
  assert.ok(!actions(env).includes('upsert'));
});
test('an unpinned zero-delta recovery closes the interrupted fence without source metadata', () => {
  const env = environment({ changed: false, recovery: true });
  vm.runInContext("closeDatasetImportFence_(beginDatasetImportFenceIfNeeded_('ph_soc_master', false), true)", env.ctx);
  assert.deepEqual(actions(env), ['get_dataset_import_status_v1', 'lock', 'begin_dataset_import_v1', 'finish_dataset_import_v1', 'unlock']);
});
test('lost fence response retries exactly the same run token and request', () => {
  const env = environment({ lostBeginResponse: true });
  assert.equal(env.run().failedFiles, 0);
  const begins = env.events.filter(event => event.action === 'begin_dataset_import_v1');
  assert.equal(begins.length, 2);
  assert.deepEqual(begins[0].payload, begins[1].payload);
});
test('Drive archival failure does not falsely interrupt committed database work', () => {
  const env = environment({ archiveFailure: true });
  assert.equal(env.run().failedFiles, 1);
  assert.ok(actions(env).includes(pinnedFinishRpc));
  assert.ok(!actions(env).includes('fail_dataset_import_v1'));
});
test('processor and fence reuse the exact outer manual-stage lock without acquiring or releasing it', () => {
  const env = environment();
  env.ctx.outerLock = { hasLock: () => true, waitLock: () => assert.fail('Outer lock reacquired'), releaseLock: () => assert.fail('Outer lock released') };
  env.ctx.LockService.getScriptLock = () => assert.fail('Nested code requested a different lock wrapper');
  const result = vm.runInContext('withDatasetImportProcessorLock_(__run, outerLock)', env.ctx);
  assert.equal(result.failedFiles, 0);
  assert.ok(actions(env).includes(pinnedFinishRpc));
});
test('Master/CAV fence scopes cover actual Crop Roll, Request and evidence side effects', () => {
  const env = environment();
  const keys = plain(vm.runInContext("getDatasetImportFenceSources_('ph_master_inventory')", env.ctx));
  for (const key of ['ph_crop_roll_drive_rows','ph_requests_pending','ph_request_delivery_outbox','ph_sales_office','ph_eval_work','ph_hold_learning_events']) assert.ok(keys.includes(key), key);
  assert.deepEqual(plain(vm.runInContext("getDatasetImportFenceSources_('nc_master_inventory')", env.ctx)), ['nc_master_inventory']);
});
