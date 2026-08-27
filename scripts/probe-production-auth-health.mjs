import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const supabaseUrl = process.env.PRODUCTION_SUPABASE_URL
  || source.match(/const SUPABASE_URL = "([^"]+)"/)?.[1]
  || '';
const publishableKey = process.env.PRODUCTION_SUPABASE_PUBLISHABLE_KEY
  || source.match(/const SUPABASE_KEY = "([^"]+)"/)?.[1]
  || '';
const serviceRoleKey = String(process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const deliveryCronSecret = String(process.env.REQUEST_DELIVERY_CRON_SECRET || '').trim();
const appsScriptDeploymentId = String(process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();
const requireAppsScriptHealth = String(process.env.REQUIRE_APPS_SCRIPT_HEALTH || '').trim() === '1';
const requireLiveReleaseMatch = String(process.env.REQUIRE_LIVE_RELEASE_MATCH || '').trim() === '1';
const appOrigin = String(process.env.PRODUCTION_APP_ORIGIN || 'https://agmetricapp.com').replace(/\/+$/, '');
const expectedRelease = source.match(/window\.__APP_SHELL_VERSION__ = '([^']+)'/)?.[1] || '';
const expectedLifecyclePolicyVersion = 'plant-request-lifecycle-v2';
const expectedLifecycleRequiredRecipientCount = 3;

if (!supabaseUrl || !publishableKey) {
  throw new Error('production_probe_configuration_missing');
}
if (requireAppsScriptHealth && !appsScriptDeploymentId) {
  throw new Error('production_probe_apps_script_deployment_missing');
}

async function checkedFetch(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeCode(value = '') {
  return String(value || 'unknown')
    .trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 64) || 'UNKNOWN';
}

async function probeAppsScriptDeploymentHealth() {
  if (!appsScriptDeploymentId) return null;
  const url = `https://script.google.com/macros/s/${encodeURIComponent(appsScriptDeploymentId)}/exec`;
  let lastCode = 'UNAVAILABLE';
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await checkedFetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'deployment_health' })
      }, 20000);
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok || payload?.ok !== true) {
        lastCode = `HTTP_${response.status}`;
      } else if (!/^[a-f0-9]{7,40}$/i.test(String(payload.deployedCommit || '').trim())) {
        lastCode = 'COMMIT_FINGERPRINT';
      } else if (String(payload.lifecycleRecipientPolicyVersion || '').trim() !== expectedLifecyclePolicyVersion) {
        lastCode = 'POLICY_VERSION';
      } else if (Number(payload.requiredRecipientCount) !== expectedLifecycleRequiredRecipientCount) {
        lastCode = 'RECIPIENT_COUNT';
      } else {
        return {
          status: response.status,
          commit: String(payload.deployedCommit).slice(0, 7),
          policyVersion: String(payload.lifecycleRecipientPolicyVersion),
          requiredRecipientCount: Number(payload.requiredRecipientCount)
        };
      }
    } catch {
      lastCode = 'UNAVAILABLE';
    }
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`production_apps_script_deployment_unhealthy_${sanitizeCode(lastCode)}`);
}

const startedAt = Date.now();
const checks = [];
let deliveryWorkerResult = null;
let requestIntegrityHealth = null;
let recentSemanticFailures = [];
let appsScriptHealth = null;

const shellResponse = await checkedFetch(`${appOrigin}/?health=${Date.now()}`, {
  headers: { 'cache-control': 'no-cache' }
});
const shellText = await shellResponse.text();
if (!shellResponse.ok || !/window\.__APP_SHELL_VERSION__\s*=/.test(shellText)) {
  throw new Error(`app_shell_unhealthy_http_${shellResponse.status}`);
}
const liveRelease = shellText.match(/window\.__APP_SHELL_VERSION__ = '([^']+)'/)?.[1] || 'unknown';
if (requireLiveReleaseMatch && (!expectedRelease || liveRelease !== expectedRelease)) {
  throw new Error('production_live_release_mismatch');
}
checks.push({ name: 'app_shell', status: shellResponse.status, release: liveRelease });

appsScriptHealth = await probeAppsScriptDeploymentHealth();
if (appsScriptHealth) {
  checks.push({
    name: 'apps_script_deployment',
    status: appsScriptHealth.status,
    commit: appsScriptHealth.commit,
    policyVersion: appsScriptHealth.policyVersion,
    requiredRecipientCount: appsScriptHealth.requiredRecipientCount
  });
} else {
  checks.push({ name: 'apps_script_deployment', result: 'skipped_not_required' });
}

const probeResponse = await checkedFetch(`${supabaseUrl}/functions/v1/app-api`, {
  method: 'POST',
  headers: {
    apikey: publishableKey,
    authorization: `Bearer ${publishableKey}`,
    'content-type': 'application/json',
    'x-request-id': `hosted-auth-health-${Date.now()}`
  },
  body: JSON.stringify({
    action: 'login',
    username: 'hosted_auth_health_probe_nonexistent',
    password: 'invalid-health-probe'
  })
});
const probeText = await probeResponse.text();
let probePayload = null;
try { probePayload = probeText ? JSON.parse(probeText) : null; } catch {}
const healthyMismatch = probeResponse.status === 200
  && probePayload?.ok === false
  && probePayload?.reason === 'mismatch';
if (!healthyMismatch) {
  const code = sanitizeCode(probePayload?.details?.code || probePayload?.code || `HTTP_${probeResponse.status}`);
  throw new Error(`production_login_bridge_unhealthy_${code}`);
}
checks.push({ name: 'login_bridge_and_data_api', status: probeResponse.status, result: 'expected_mismatch' });

if (serviceRoleKey) {
  if (!deliveryCronSecret) throw new Error('production_probe_delivery_cron_secret_missing');
  const serviceHeaders = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json'
  };

  // Idempotently wake delivery so this monitor can recover a delayed cron wake
  // or an expired worker lease before it declares an incident.
  const workerResponse = await checkedFetch(`${supabaseUrl}/functions/v1/request-delivery-worker`, {
    method: 'POST',
    headers: { ...serviceHeaders, 'x-delivery-cron-secret': deliveryCronSecret },
    body: JSON.stringify({ source: 'cron' })
  }, 60000);
  const workerText = await workerResponse.text();
  try { deliveryWorkerResult = workerText ? JSON.parse(workerText) : null; } catch {}
  const workerFailed = Number(deliveryWorkerResult?.failed || 0);
  if (!workerResponse.ok || deliveryWorkerResult?.ok !== true || workerFailed > 0 || deliveryWorkerResult?.errorCode) {
    const code = sanitizeCode(deliveryWorkerResult?.errorCode || `HTTP_${workerResponse.status}`);
    throw new Error(`production_delivery_worker_unhealthy_${code}`);
  }
  checks.push({
    name: 'request_delivery_worker',
    status: workerResponse.status,
    claimed: Number(deliveryWorkerResult?.claimed || 0),
    delivered: Number(deliveryWorkerResult?.delivered || 0),
    failed: workerFailed
  });

  // Record a fast sanitized request-integrity audit after delivery has had a
  // chance to heal. Heavy ItemCode reconciliation stays on its own schedule.
  const maintenanceResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_hosted_health_snapshot`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const maintenanceText = await maintenanceResponse.text();
  let maintenancePayload = null;
  try { maintenancePayload = maintenanceText ? JSON.parse(maintenanceText) : null; } catch {}
  if (!maintenanceResponse.ok || !maintenancePayload || typeof maintenancePayload !== 'object') {
    throw new Error(`production_request_maintenance_unhealthy_HTTP_${maintenanceResponse.status}`);
  }
  requestIntegrityHealth = maintenancePayload;
  const criticalHealthFields = [
    'missing_history_count',
    'delivery_retry_exhausted_count',
    'delivery_stalled_count',
    'delivery_expired_lease_count',
    'delivery_worker_stale_count',
    'delivery_canary_stale_count'
  ];
  const criticalHealthCount = criticalHealthFields.reduce(
    (total, field) => total + Math.max(0, Number(requestIntegrityHealth?.[field]) || 0),
    0
  );
  if (criticalHealthCount > 0) {
    throw new Error(`production_request_integrity_unhealthy_${sanitizeCode(requestIntegrityHealth?.health_code)}`);
  }
  checks.push({
    name: 'request_integrity',
    status: maintenanceResponse.status,
    healthCode: sanitizeCode(requestIntegrityHealth?.health_code || 'UNKNOWN'),
    missingDriveRows: Math.max(0, Number(requestIntegrityHealth?.missing_drive_row_count) || 0),
    missingThreads: Math.max(0, Number(requestIntegrityHealth?.delivery_missing_thread_count) || 0),
    unassignedItemcodes: Math.max(0, Number(requestIntegrityHealth?.unassigned_itemcode_count) || 0)
  });

  // Read only non-PII health fields. The current scheduled audit was evaluated
  // above, so older audit rows are excluded from semantic client failures.
  const recentSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const healthUrl = new URL(`${supabaseUrl}/rest/v1/ph_app_health_events`);
  healthUrl.searchParams.set('select', 'event_name,area,severity,sanitized_code,occurred_at');
  healthUrl.searchParams.set('severity', 'in.(error,critical)');
  healthUrl.searchParams.set('event_name', 'neq.scheduled_request_health_audit');
  healthUrl.searchParams.set('sanitized_code', 'neq.LOCAL_REQUEST_BLOB_PENDING');
  healthUrl.searchParams.set('occurred_at', `gte.${recentSince}`);
  healthUrl.searchParams.set('order', 'occurred_at.desc');
  healthUrl.searchParams.set('limit', '50');
  const healthResponse = await checkedFetch(healthUrl, { headers: serviceHeaders });
  const healthText = await healthResponse.text();
  try { recentSemanticFailures = healthText ? JSON.parse(healthText) : []; } catch { recentSemanticFailures = []; }
  if (!healthResponse.ok || !Array.isArray(recentSemanticFailures)) {
    throw new Error(`production_health_event_probe_unhealthy_HTTP_${healthResponse.status}`);
  }
  recentSemanticFailures = recentSemanticFailures.map((event) => ({
    eventName: sanitizeCode(event?.event_name),
    area: sanitizeCode(event?.area),
    severity: String(event?.severity || 'error').toLowerCase() === 'critical' ? 'critical' : 'error',
    code: sanitizeCode(event?.sanitized_code),
    occurredAt: String(event?.occurred_at || '')
  }));
  if (recentSemanticFailures.length) {
    throw new Error(`production_semantic_health_unhealthy_${recentSemanticFailures[0].code}`);
  }
  checks.push({ name: 'recent_semantic_health', status: healthResponse.status, failures: 0 });
} else {
  checks.push({ name: 'secure_production_recovery', result: 'skipped_no_service_role' });
}

const result = {
  ok: true,
  checkedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  expectedRelease,
  liveRelease,
  checks,
  delivery: deliveryWorkerResult ? {
    claimed: Number(deliveryWorkerResult.claimed || 0),
    delivered: Number(deliveryWorkerResult.delivered || 0),
    failed: Number(deliveryWorkerResult.failed || 0)
  } : null,
  requestIntegrity: requestIntegrityHealth ? {
    healthCode: sanitizeCode(requestIntegrityHealth.health_code || 'UNKNOWN'),
    missingDriveRows: Math.max(0, Number(requestIntegrityHealth.missing_drive_row_count) || 0),
    missingThreads: Math.max(0, Number(requestIntegrityHealth.delivery_missing_thread_count) || 0),
    unassignedItemcodes: Math.max(0, Number(requestIntegrityHealth.unassigned_itemcode_count) || 0)
  } : null,
  appsScript: appsScriptHealth,
  recentSemanticFailureCount: recentSemanticFailures.length
};

process.stdout.write(`${JSON.stringify(result)}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Production health\n\n- Status: healthy\n- App shell: ${liveRelease}\n- Apps Script lifecycle policy: ${result.appsScript ? `${result.appsScript.policyVersion} (${result.appsScript.requiredRecipientCount} required recipients, commit ${result.appsScript.commit})` : 'not required'}\n- Login bridge/Data API: HTTP 200 expected mismatch\n- Delivery: ${result.delivery ? `${result.delivery.delivered} delivered, ${result.delivery.failed} failed` : 'secure check skipped'}\n- Request integrity: ${result.requestIntegrity?.healthCode || 'secure check skipped'}\n- Recent semantic failures: ${result.recentSemanticFailureCount}\n- Duration: ${result.durationMs} ms\n`
  );
}
