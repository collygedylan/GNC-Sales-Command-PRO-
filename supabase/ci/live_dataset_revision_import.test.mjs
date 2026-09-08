import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
const code = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function environment({ changed = true, recovery = false, deleteFailure = false, archiveFailure = false, deferred = false, lostBeginResponse = false } = {}) {
  const events = []; let locked = false; let lost = lostBeginResponse;
  const lock = { hasLock: () => locked, waitLock: () => { assert.equal(locked, false); locked = true; events.push('lock'); }, releaseLock: () => { locked = false; events.push('unlock'); } };
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    LockService: { getScriptLock: () => lock },
    Utilities: { getUuid: randomUUID, sleep() {}, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => Array.from(createHash('sha256').update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') },
    UrlFetchApp: { fetchAll: requests => requests.map(request => {
      events.push({ action: 'delete', headers: plain(request.headers) });
      return { getResponseCode: () => deleteFailure ? 503 : 204, getContentText: () => deleteFailure ? 'synthetic failure' : '' };
    }) },
    events, changed, recovery, archiveFailure,
  });
  new vm.Script(code).runInContext(ctx);
  ctx.callSupabaseRpc_ = (name, payload) => {
    events.push({ action: name, payload: plain(payload) });
    if (name === 'get_dataset_import_status_v1') return { ok: true, requiresRecovery: recovery };
    if (name === 'begin_dataset_import_v1') {
      if (lost) { lost = false; throw new Error('Network response lost'); }
      return { ok: true, state: 'active' };
    }
    if (name === 'heartbeat_dataset_import_v1') return { ok: true, state: 'active' };
    if (name === 'finish_dataset_import_v1') return { ok: true, state: 'completed' };
    if (name === 'fail_dataset_import_v1') return { ok: true, state: 'failed' };
    if (name === 'reconcile_season_sales_office_v1') return { ok: true, status: deferred ? 'maintenance_deferred' : 'completed', openCount: 1 };
    throw new Error(`Unexpected RPC ${name}`);
  };
  vm.runInContext(`
    getDriveFolderByIdWithRetry_ = () => ({});
    listDriveFilesWithRetry_ = () => { let used=false; return { hasNext:()=>!used, next:()=>{used=true;return {getName:()=> 'synthetic.csv',getLastUpdated:()=>new Date(0)}} }; };
    extractDataFromFile = () => [['ITEMCODE'],['SYNTHETIC']];
    fetchAllSupabaseData = () => [];
    getPayloadSelectColumns_ = () => 'unique_id';
    getSupabaseFetchOptionsForTable_ = () => ({});
    combineSnapshotDeleteIds_ = () => changed ? ['obsolete'] : [];
    shouldAbortSnapshotDelete_ = () => false;
    pushToSupabase = () => events.push({action:'upsert',headers:getSupabaseHeaders_()});
    emitTableSyncLiveEvent_ = () => {};
    moveDriveFileToFolderWithRetry_ = () => { events.push('archive'); if(archiveFailure) throw new Error('Drive unavailable'); };
    __build = () => ({upserts: changed ? [{unique_id:'present'}] : [],seenIds:new Set(['present']),totalRows:1,stats:{sourceRows:1}});
    __run = () => processLatestFileOnlyFolder('source','processed','ph_soc_master',__build,{deltaMode:true,
      afterCommit:()=>reconcileSeasonSalesOfficeAfterImport_('synthetic-version','test')});
  `, ctx);
  return { ctx, events, run: () => vm.runInContext('__run()', ctx), locked: () => locked };
}
const actions = env => env.events.map(event => typeof event === 'string' ? event : event.action);
test('full import locks before reads, fences writes/derived reconciliation, then archives', () => {
  const env = environment(); const result = env.run();
  assert.equal(result.failedFiles, 0);
  const names = actions(env);
  assert.deepEqual(names, ['lock','begin_dataset_import_v1','upsert','delete','reconcile_season_sales_office_v1','finish_dataset_import_v1','archive','unlock']);
  const begin = env.events.find(event => event.action === 'begin_dataset_import_v1');
  for (const event of env.events.filter(event => event.headers)) assert.equal(event.headers['x-gnc-import-run-id'], begin.payload.p_run_id);
  assert.deepEqual(begin.payload.p_canonical_keys, ['ph_soc_master']);
  assert.equal(env.locked(), false);
});
test('failed pruning does not publish ready or archive canonical input', () => {
  const env = environment({ deleteFailure: true });
  assert.equal(env.run().failedFiles, 1);
  assert.ok(actions(env).includes('fail_dataset_import_v1'));
  assert.ok(!actions(env).includes('finish_dataset_import_v1'));
  assert.ok(!actions(env).includes('archive'));
  assert.equal(env.locked(), false);
});
test('deferred derived reconciliation leaves the file retryable and interrupted', () => {
  const env = environment({ deferred: true });
  assert.equal(env.run().failedFiles, 1);
  assert.ok(actions(env).includes('fail_dataset_import_v1'));
  assert.ok(!actions(env).includes('finish_dataset_import_v1'));
  assert.ok(!actions(env).includes('archive'));
});
test('normal zero-delta imports do not emit a revision fence', () => {
  const env = environment({ changed: false });
  assert.equal(env.run().failedFiles, 0);
  assert.ok(actions(env).includes('get_dataset_import_status_v1'));
  assert.ok(!actions(env).includes('begin_dataset_import_v1'));
});
test('complete zero-delta retry recovers an interrupted prior import', () => {
  const env = environment({ changed: false, recovery: true });
  assert.equal(env.run().failedFiles, 0);
  assert.ok(actions(env).includes('begin_dataset_import_v1'));
  assert.ok(actions(env).includes('finish_dataset_import_v1'));
  assert.ok(!actions(env).includes('upsert'));
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
  assert.ok(actions(env).includes('finish_dataset_import_v1'));
  assert.ok(!actions(env).includes('fail_dataset_import_v1'));
});
test('Master/CAV fence scopes cover actual Crop Roll, Request and evidence side effects', () => {
  const env = environment();
  const keys = plain(vm.runInContext("getDatasetImportFenceSources_('ph_master_inventory')", env.ctx));
  for (const key of ['ph_crop_roll_drive_rows','ph_active_request','ph_request_delivery_outbox','ph_sales_office','ph_eval_work','ph_hold_learning_events']) assert.ok(keys.includes(key));
  assert.deepEqual(plain(vm.runInContext("getDatasetImportFenceSources_('nc_master_inventory')", env.ctx)), ['nc_master_inventory']);
});
