import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../scripts/probe-production-auth-health.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/performance-monitor.yml', import.meta.url), 'utf8');
const scheduled = readFileSync(new URL('../.github/workflows/production-auth-health.yml', import.meta.url), 'utf8');
const shell = "window.__APP_SHELL_VERSION__ = 'V-fixture';";
function healthyPayloads() {
  return {
    get_hosted_health_snapshot: { health_code: 'HEALTHY' },
    get_pikes_order_assignment_health_v1: { contractVersion: 1, falseUnassignedCount: 0, ambiguousCount: 0 },
    get_po_management_health_snapshot: { contract_version: 'po-management-native-auth-v1', source_authenticated_select: true, view_authenticated_select: true, anonymous_access_denied: true, authenticated_writes_denied: true, manager_policy_present: true, security_invoker_enabled: true, row_count: 1, latest_built_at: new Date().toISOString() },
    get_access_control_health_snapshot_v1: { contract_version: 'app-access-v1', enforcement_mode: 'audit', permission_count: 50, maintainer_count: 3, baseline_missing_count: 0, unknown_permission_count: 0, unmapped_legacy_check_count: 0 },
    get_eval_request_delivery_health_snapshot_v2: { contract_version: 'eval-request-delivery-health-v2', required_manager_recipient_count: 2, creation_order_violation_count: 0, completion_membership_mismatch_count: 0, missing_completion_event_count: 0, eval_origin_scope_mismatch_count: 0, eval_required_recipient_violation_count: 0 },
    get_eval_work_creation_health_snapshot_v1: { contract_version: 'eval-work-creation-health-v1', batch_assignee_insert_contract_healthy: true, single_assignee_insert_contract_healthy: true, healthy: true },
    get_eval_work_assignment_batch_health_v1: { contractVersion: 'eval-work-assignment-batch-v1', createGrouped: true, reassignGuarded: true, cancelGuarded: true, envelopeViolationCount: 0, healthy: true },
    get_request_drive_evidence_health_snapshot_v1: { contract_version: 'request-drive-evidence-health-v1', evidence_mismatch_count: 0 },
    get_drive_evidence_save_health_v2: { contractVersion: 'drive-evidence-save-health-v2', healthy: true, lockWaits: 0, activeSaveSessions: 0 },
    get_photo_delivery_health_v1: { healthy: true, recent_oversized_upload_count: 0, recent_mime_extension_mismatch_count: 0, recent_png_upload_count: 0 },
    get_season_sales_office_health_v1: { ok: true, parity: true },
    get_eval_itemcode_work_health_snapshot_v2: { contract_version: 'eval-itemcode-work-health-v2', scope_contract: 'itemcode-all-rows-v1', stored_membership_mismatch_count: 0, pdf_origin_mismatch_count: 0, excel_attachment_violation_count: 0, over_limit_assignment_count: 0, largest_origin_count: 10 },
    get_codex_ops_health_snapshot_v1: { contract_version: 'mobile-codex-ops-v1', private_table_count: 7, anonymous_table_access_denied: true, authenticated_table_access_denied: true, active_task_count: 0 },
    run_request_integrity_maintenance: { status: 'completed' }
  };
}

async function runProbe({ readOnly = true, mismatch = false, unhealthy = false, withCronSecret = false } = {}) {
  const calls = [], output = [], payloads = healthyPayloads();
  if (mismatch) payloads.get_request_drive_evidence_health_snapshot_v1.evidence_mismatch_count = 1;
  if (mismatch) payloads.get_request_drive_evidence_health_snapshot_v1.mismatch_request_ids = ['fixture-request'];
  if (unhealthy) payloads.get_drive_evidence_save_health_v2.lockWaits = 1;
  const ctx = {
    URL, AbortController, setTimeout, clearTimeout,
    fs: { readFileSync: () => shell, appendFileSync() { throw new Error('No summary configured'); } },
    process: { env: { PRODUCTION_SUPABASE_URL: 'https://backend.test', PRODUCTION_SUPABASE_PUBLISHABLE_KEY: 'fixture-public', PRODUCTION_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', PRODUCTION_PROBE_READ_ONLY: readOnly ? '1' : '0', REQUIRE_BOUNDED_MAINTENANCE: '1', REQUEST_DELIVERY_CRON_SECRET: withCronSecret ? 'fixture-cron' : '', PRODUCTION_APP_ORIGIN: 'https://app.test', APPS_SCRIPT_DEPLOYMENT_ID: 'fixture-deployment', REQUIRE_APPS_SCRIPT_HEALTH: '1' }, stdout: { write: text => output.push(text) } },
    fetch: async (url, options) => {
      const target = new URL(url), body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path: target.pathname, method: options.method || 'GET', body });
      let payload;
      if (target.origin === 'https://app.test') return { ok: true, status: 200, text: async () => shell };
      if (target.origin === 'https://script.google.com') payload = { ok: true, deployedCommit: 'abcdef12', lifecycleRecipientPolicyVersion: 'plant-request-lifecycle-v2', requiredRecipientCount: 3 };
      else if (target.pathname === '/functions/v1/app-api') { assert.equal(body.username, 'hosted_auth_health_probe_nonexistent'); payload = { ok: false, reason: 'mismatch' }; }
      else if (target.pathname === '/functions/v1/request-delivery-worker') payload = { ok: true, claimed: 0, delivered: 0, failed: 0 };
      else if (target.pathname === '/rest/v1/ph_app_health_events') payload = [];
      else if (target.pathname === '/rest/v1/rpc/repair_request_drive_evidence_v1') { payload = { ok: true }; payloads.get_request_drive_evidence_health_snapshot_v1.evidence_mismatch_count = 0; }
      else payload = payloads[target.pathname.split('/').at(-1)];
      assert.ok(payload, `Unexpected endpoint: ${target.pathname}`);
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }
  };
  vm.createContext(ctx);
  const executable = script.replace(/^import fs from 'node:fs';\s*/, '').replaceAll('import.meta.url', "'https://fixtures.test/scripts/probe.mjs'");
  let error = null;
  try { await vm.runInContext(`(async () => { ${executable} })()`, ctx); } catch (failure) { error = failure; }
  return { calls, error, result: output.length ? JSON.parse(output.at(-1)) : null };
}

test('release read-only probe retains all health reads but never wakes delivery or repairs inventory', async () => {
  const f = await runProbe({ readOnly: true });
  assert.equal(f.error, null);
  assert.equal(f.result.mode, 'read-only');
  assert.equal(f.result.delivery, null); assert.equal(f.result.boundedMaintenance, null);
  assert.equal(f.calls.filter(call => call.path.startsWith('/rest/v1/rpc/get_')).length, 13);
  assert.ok(!f.calls.some(call => /request-delivery-worker|run_request_integrity_maintenance|repair_request_drive_evidence/.test(call.path)));
  assert.equal(f.result.checks.find(check => check.name === 'request_delivery_worker').result, 'skipped_read_only');
  assert.equal(f.result.checks.find(check => check.name === 'bounded_request_maintenance').result, 'skipped_read_only');
});

test('read-only mismatch fails visibly without attempting evidence repair', async () => {
  const f = await runProbe({ readOnly: true, mismatch: true });
  assert.match(f.error?.message || '', /production_request_drive_evidence_contract_unhealthy/);
  assert.ok(!f.calls.some(call => /repair_request_drive_evidence/.test(call.path)));
});

test('read-only mode still rejects unhealthy production metrics', async () => {
  const f = await runProbe({ readOnly: true, unhealthy: true });
  assert.match(f.error?.message || '', /production_drive_evidence_retry_storm_detected/);
});

test('scheduled recovery keeps delivery wake, maintenance and evidence repair defaults', async () => {
  const f = await runProbe({ readOnly: false, mismatch: true, withCronSecret: true });
  assert.equal(f.error, null); assert.equal(f.result.mode, 'scheduled-recovery');
  for (const name of ['request-delivery-worker', 'run_request_integrity_maintenance', 'repair_request_drive_evidence_v1']) assert.ok(f.calls.some(call => call.path.endsWith(name)), name);
  const missingSecret = await runProbe({ readOnly: false });
  assert.match(missingSecret.error?.message || '', /delivery_cron_secret_missing/);
});

test('read-only fetch gate blocks unknown writes, altered login subjects and unexpected RPC payloads', () => {
  const start = script.indexOf('function assertReadOnlyProbeRequest('), end = script.indexOf('function sanitizeCode(', start);
  const ctx = { URL, appOrigin: 'https://app.test', supabaseUrl: 'https://backend.test', appsScriptDeploymentId: 'fixture-deployment' };
  vm.createContext(ctx); vm.runInContext(script.slice(start, end), ctx);
  for (const [path, body] of [
    ['/functions/v1/request-delivery-worker', { source: 'cron' }],
    ['/rest/v1/rpc/repair_request_drive_evidence_v1', { p_dry_run: false }],
    ['/functions/v1/app-api', { action: 'login', username: 'real-user', password: 'invalid-health-probe' }],
    ['/rest/v1/rpc/get_hosted_health_snapshot', { injected: true }]
  ]) assert.throws(() => ctx.assertReadOnlyProbeRequest(`https://backend.test${path}`, { method: 'POST', body: JSON.stringify(body) }), /mutation_blocked/);
});

test('only the release performance probe opts into read-only mode', () => {
  assert.match(workflow, /name: Probe production login bridge and Data API\s+env:\s+PRODUCTION_PROBE_READ_ONLY: '1'/);
  assert.doesNotMatch(scheduled, /PRODUCTION_PROBE_READ_ONLY/);
});
