import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { collectRecoveryDiagnostics, migrationDigest } from '../scripts/recovery-diagnostics.mjs';
import { isolationHeaders, localBackendOrigin } from '../scripts/isolated-preview.mjs';
import { buildSandboxSource } from '../scripts/apps-script-sandbox.mjs';

const code = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);
const context = () => {
  const values = new Map();
  const ctx = vm.createContext({ console: { warn() {}, log() {} }, PropertiesService: { getScriptProperties: () => ({
    getProperty: key => values.get(key) || '', setProperty: (key, value) => values.set(key, value)
  }) } });
  new vm.Script(code).runInContext(ctx);
  return { ctx, values };
};
test('failed import evidence survives retries and success, deduplicated by run', () => {
  const { ctx, values } = context();
  const save = status => { ctx.input = status; vm.runInContext('saveManualSyncStatus_(input)', ctx); };
  const status = { runId: 'run-1', currentStage: 'drive', errorCode: 'DATABASE_57014', error: 'private filename and credential', updatedAt: new Date().toISOString() };
  save(status); save({ ...status, finishedAt: new Date(Date.now() + 100).toISOString() });
  save({ runId: 'run-2', currentStage: 'queued', active: true });
  save({ runId: 'run-2', currentStage: 'completed', active: false });
  const history = JSON.parse(values.get('MANUAL_SYNC_FAILURE_HISTORY_V1'));
  assert.equal(history.length, 1); assert.equal(history[0].code, 'DATABASE_57014');
  assert.ok(!JSON.stringify(history).includes('private'));
  const health = vm.runInContext('getAppsScriptDeploymentHealth_()', ctx);
  assert.equal(health.importDiagnostics.failureCountLastSevenDays, 1);
  assert.equal(health.importDiagnostics.recentFailures, undefined);
});
test('history is bounded, handles malformed storage and drops stale public counts', () => {
  const { ctx, values } = context();
  values.set('MANUAL_SYNC_FAILURE_HISTORY_V1', 'broken');
  for (let i = 0; i < 12; i++) {
    ctx.input = { runId: `run-${i}`, currentStage: 'trigger_failed', error: 'anything', updatedAt: new Date(Date.now() - i * 86400000).toISOString() };
    vm.runInContext('saveManualSyncStatus_(input)', ctx);
  }
  assert.equal(JSON.parse(values.get('MANUAL_SYNC_FAILURE_HISTORY_V1')).length, 8);
  assert.ok(vm.runInContext('getManualSyncImportDiagnostics_().recentFailures.length', ctx) <= 3);
});
test('a read-only stale-status inspection does not save status or remove triggers', () => {
  const { ctx, values } = context();
  values.set('MANUAL_SYNC_STATUS', JSON.stringify({ active: true, currentStage: 'queued', startedAt: '2020-01-01T00:00:00Z' }));
  const before = [...values];
  assert.equal(vm.runInContext('getManualSyncImportDiagnostics_().stale', ctx), true);
  assert.deepEqual([...values], before);
});
test('preview rejects production, credentials, alternate schemes and path overrides', () => {
  for (const url of ['https://production.supabase.co', 'http://127.0.0.1.evil.test', 'https://localhost', 'http://u:p@localhost', 'http://localhost/path']) {
    assert.throws(() => localBackendOrigin(url));
  }
  const csp = isolationHeaders()['Content-Security-Policy'];
  assert.match(csp, /connect-src 'self' http:\/\/127.0.0.1:54321 ws:\/\/127.0.0.1:54321/);
  assert.match(csp, /worker-src 'none'/); assert.match(csp, /form-action 'none'/);
  assert.ok(!csp.includes('https:'));
});
test('sandbox maps known folders and cannot open or move to production folders', () => {
  const calls = []; const nativeFolder = { getId: () => 'test-folder-0001', getName: () => 'test', createFile: () => ({
    getId: () => 'test-file-0001', moveTo: f => calls.push(['move', f.getId()])
  }) };
  const generated = buildSandboxSource("const FOLDER='production-folder-0001'; function work(){return DriveApp.getFolderById(FOLDER);}", {
    scriptId: 'test-script-1', folderIds: ['test-folder-0001'], folderMap: { 'production-folder-0001': 'test-folder-0001' }
  });
  const ctx = vm.createContext({ DriveApp: { getFolderById: id => { calls.push(['get', id]); return nativeFolder; } } });
  new vm.Script(generated).runInContext(ctx);
  assert.equal(vm.runInContext('work().getId()', ctx), 'test-folder-0001');
  assert.throws(() => vm.runInContext("GncSandbox_DriveApp.getFolderById('production-folder-0001')", ctx), /BLOCKED/);
  assert.throws(() => vm.runInContext("work().createFile('test').moveTo({getId:()=> 'production-folder-0001'})", ctx), /BLOCKED/);
  assert.ok(calls.every(c => c[1] !== 'production-folder-0001'));
});
test('sandbox intercepts email and rejects external network and scheduled triggers', () => {
  const ctx = vm.createContext({ DriveApp: {}, PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) }, console });
  new vm.Script(buildSandboxSource(code, { scriptId: 'test-script', folderIds: ['test-folder-0001'] })).runInContext(ctx);
  vm.runInContext("GncSandbox_GmailApp.sendEmail('real@example.com','private subject','private body')", ctx);
  assert.equal(vm.runInContext('GNC_SANDBOX_MAIL.length', ctx), 1);
  assert.ok(!vm.runInContext('JSON.stringify(GNC_SANDBOX_MAIL)', ctx).includes('real@example'));
  assert.throws(() => vm.runInContext("GncSandbox_UrlFetchApp.fetch('https://production.supabase.co')", ctx), /BLOCKED/);
  assert.throws(() => vm.runInContext('setupDropFolderAutoSyncTrigger()', ctx), /BLOCKED/);
});
function fakeDb(state = 'ready') {
  const queries = [];
  return { queries, query: async q => {
    queries.push(q);
    if (q.includes('app_dataset_revisions')) return { rows: [{ key: 'ph_master_inventory', state, changed_at: '2026-01-01' }] };
    if (q.includes('schema_migrations')) return { rows: [{ version: '20260922225000' }] };
    if (q.includes('max(finished_at)')) return { rows: [{ at: '2026-01-01' }] };
    return { rows: [] };
  } };
}
function fakeFetch(calls) { return async (url, options) => {
  calls.push({ url, options });
  let payload = [];
  if (url.includes('/deployment.json')) payload = { schemaVersion: 'gnc-deployment-fingerprint-v1', release: 'V2026.09.22.04', commit: sha };
  if (url.includes('script.google')) payload = { ok: true, deployedCommit: sha, importDiagnostics: { active: false, stale: false, failureCountLastSevenDays: 0 } };
  return { ok: true, json: async () => payload };
}; }
test('diagnostics use only bounded reads, rollback, and no business rows in output', async () => {
  const db = fakeDb(), calls = [];
  const result = await collectRecoveryDiagnostics({ db, fetchImpl: fakeFetch(calls), deploymentId: 'deployment', supabaseUrl: 'https://fixture.test', serviceKey: 'secret-fixture' });
  assert.equal(result.ok, true); assert.equal(db.queries[0], 'BEGIN READ ONLY'); assert.equal(db.queries.at(-1), 'ROLLBACK');
  assert.ok(calls.every(c => !c.options.method || (c.options.method === 'POST' && c.options.body === '{"type":"deployment_health"}')));
  assert.ok(!calls.some(c => c.url.includes('select=*')));
  assert.ok(!JSON.stringify(result).includes('secret-fixture'));
});
test('interrupted imports fail diagnostics without hiding live versions or API timings', async () => {
  const result = await collectRecoveryDiagnostics({ db: fakeDb('interrupted'), fetchImpl: fakeFetch([]), deploymentId: 'deployment' });
  assert.equal(result.ok, false); assert.equal(result.checks.database.ok, false);
  assert.equal(result.checks.frontend.commit, sha); assert.equal(result.checks.apiDrive.code, 'CONFIGURATION_MISSING');
});
test('migration compatibility digest is ordering independent and detects additions', () => {
  assert.equal(migrationDigest(['2', '1']), migrationDigest(['1', '2']));
  assert.notEqual(migrationDigest(['1']), migrationDigest(['1', '2']));
});
