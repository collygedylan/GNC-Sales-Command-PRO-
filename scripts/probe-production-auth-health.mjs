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
const requireBoundedMaintenance = String(process.env.REQUIRE_BOUNDED_MAINTENANCE || '').trim() === '1';
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
let poManagementHealth = null;
let accessControlHealth = null;
let evalRequestDeliveryHealth = null;
let evalWorkCreationHealth = null;
let evalWorkAssignmentBatchHealth = null;
let evalItemcodeWorkHealth = null;
let requestDriveEvidenceHealth = null;
let driveEvidenceSaveHealth = null;
let seasonSalesOfficeHealth = null;
let photoDeliveryHealth = null;
let codexOpsHealth = null;
let boundedMaintenance = null;
let pikesAssignmentHealth = null;
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

  if (requireBoundedMaintenance) {
    const boundedStartedAt = Date.now();
    const boundedResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/run_request_integrity_maintenance`, {
      method: 'POST',
      headers: serviceHeaders,
      body: '{}'
    }, 60000);
    const boundedText = await boundedResponse.text();
    try { boundedMaintenance = boundedText ? JSON.parse(boundedText) : null; } catch {}
    const boundedStatus = String(boundedMaintenance?.status || '').toLowerCase();
    const deferredHealthy = boundedStatus === 'deferred'
      && sanitizeCode(boundedMaintenance?.errorCode) === 'MAINTENANCE_DEFERRED';
    if (!boundedResponse.ok || !boundedMaintenance || (boundedStatus !== 'completed' && !deferredHealthy)) {
      throw new Error(`production_bounded_maintenance_unhealthy_${sanitizeCode(boundedMaintenance?.errorCode || `HTTP_${boundedResponse.status}`)}`);
    }
    checks.push({
      name: 'bounded_request_maintenance',
      status: boundedResponse.status,
      result: boundedStatus,
      durationMs: Date.now() - boundedStartedAt
    });
  }

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

  const pikesAssignmentResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_pikes_order_assignment_health_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const pikesAssignmentText = await pikesAssignmentResponse.text();
  try { pikesAssignmentHealth = pikesAssignmentText ? JSON.parse(pikesAssignmentText) : null; } catch {}
  if (!pikesAssignmentResponse.ok
      || Number(pikesAssignmentHealth?.contractVersion) !== 1
      || Number(pikesAssignmentHealth?.falseUnassignedCount) !== 0
      || Number(pikesAssignmentHealth?.ambiguousCount) !== 0) {
    throw new Error(`production_pikes_assignment_health_unhealthy_HTTP_${pikesAssignmentResponse.status}`);
  }
  checks.push({
    name: 'pikes_assignment_authority',
    status: pikesAssignmentResponse.status,
    inventoryRowCount: Math.max(0, Number(pikesAssignmentHealth?.inventoryRowCount) || 0),
    snapshotUnassignedCount: Math.max(0, Number(pikesAssignmentHealth?.snapshotUnassignedCount) || 0),
    falseUnassignedCount: 0
  });

  const poHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_po_management_health_snapshot`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const poHealthText = await poHealthResponse.text();
  try { poManagementHealth = poHealthText ? JSON.parse(poHealthText) : null; } catch {}
  if (!poHealthResponse.ok || !poManagementHealth || typeof poManagementHealth !== 'object') {
    throw new Error(`production_po_management_health_unavailable_HTTP_${poHealthResponse.status}`);
  }
  const poContractHealthy = poManagementHealth.contract_version === 'po-management-native-auth-v1'
    && poManagementHealth.source_authenticated_select === true
    && poManagementHealth.view_authenticated_select === true
    && poManagementHealth.anonymous_access_denied === true
    && poManagementHealth.authenticated_writes_denied === true
    && poManagementHealth.manager_policy_present === true
    && poManagementHealth.security_invoker_enabled === true;
  const poRowCount = Math.max(0, Number(poManagementHealth.row_count) || 0);
  const poLatestBuiltAtMs = Date.parse(String(poManagementHealth.latest_built_at || ''));
  const poAgeMs = Number.isFinite(poLatestBuiltAtMs) ? Date.now() - poLatestBuiltAtMs : Number.POSITIVE_INFINITY;
  const poStaleAfterMs = 72 * 60 * 60 * 1000;
  if (!poContractHealthy) throw new Error('production_po_management_auth_contract_unhealthy');
  if (poRowCount < 1) throw new Error('production_po_management_empty');
  if (poAgeMs < 0 || poAgeMs > poStaleAfterMs) throw new Error('production_po_management_stale');
  checks.push({
    name: 'po_management',
    status: poHealthResponse.status,
    contractVersion: poManagementHealth.contract_version,
    rowCount: poRowCount,
    ageMinutes: Math.max(0, Math.round(poAgeMs / 60000))
  });

  const accessControlHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_access_control_health_snapshot_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const accessControlHealthText = await accessControlHealthResponse.text();
  try { accessControlHealth = accessControlHealthText ? JSON.parse(accessControlHealthText) : null; } catch {}
  if (!accessControlHealthResponse.ok || !accessControlHealth || typeof accessControlHealth !== 'object') {
    throw new Error(`production_access_control_health_unavailable_HTTP_${accessControlHealthResponse.status}`);
  }
  const accessControlContractHealthy = accessControlHealth.contract_version === 'app-access-v1'
    && accessControlHealth.enforcement_mode === 'audit'
    && Number(accessControlHealth.permission_count) >= 50
    && Number(accessControlHealth.maintainer_count) === 3
    && Number(accessControlHealth.baseline_missing_count) === 0
    && Number(accessControlHealth.unknown_permission_count) === 0
    && Number(accessControlHealth.unmapped_legacy_check_count) === 0;
  if (!accessControlContractHealthy) throw new Error('production_access_control_audit_contract_unhealthy');
  checks.push({
    name: 'access_control',
    status: accessControlHealthResponse.status,
    contractVersion: accessControlHealth.contract_version,
    enforcementMode: accessControlHealth.enforcement_mode,
    permissionCount: Math.max(0, Number(accessControlHealth.permission_count) || 0),
    legacyCheckCount: Math.max(0, Number(accessControlHealth.legacy_check_count) || 0),
    legacyMismatchCount: Math.max(0, Number(accessControlHealth.legacy_mismatch_count) || 0),
    unknownRoleCount: Math.max(0, Number(accessControlHealth.unknown_role_count) || 0)
  });

  const evalRequestHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_eval_request_delivery_health_snapshot_v2`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const evalRequestHealthText = await evalRequestHealthResponse.text();
  try { evalRequestDeliveryHealth = evalRequestHealthText ? JSON.parse(evalRequestHealthText) : null; } catch {}
  if (!evalRequestHealthResponse.ok || !evalRequestDeliveryHealth || typeof evalRequestDeliveryHealth !== 'object') {
    throw new Error(`production_eval_request_delivery_health_unavailable_HTTP_${evalRequestHealthResponse.status}`);
  }
  const evalRequestContractHealthy = evalRequestDeliveryHealth.contract_version === 'eval-request-delivery-health-v2'
    && Number(evalRequestDeliveryHealth.required_manager_recipient_count) === 2
    && Number(evalRequestDeliveryHealth.creation_order_violation_count) === 0
    && Number(evalRequestDeliveryHealth.completion_membership_mismatch_count) === 0
    && Number(evalRequestDeliveryHealth.missing_completion_event_count) === 0
    && Number(evalRequestDeliveryHealth.eval_origin_scope_mismatch_count) === 0
    && Number(evalRequestDeliveryHealth.eval_required_recipient_violation_count) === 0;
  if (!evalRequestContractHealthy) throw new Error('production_eval_request_delivery_contract_unhealthy');
  checks.push({
    name: 'eval_request_delivery_v2',
    status: evalRequestHealthResponse.status,
    contractVersion: evalRequestDeliveryHealth.contract_version,
    requiredManagerRecipientCount: Number(evalRequestDeliveryHealth.required_manager_recipient_count),
    missingCompletionEventCount: Number(evalRequestDeliveryHealth.missing_completion_event_count)
  });

  const evalWorkCreationHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_eval_work_creation_health_snapshot_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const evalWorkCreationHealthText = await evalWorkCreationHealthResponse.text();
  try { evalWorkCreationHealth = evalWorkCreationHealthText ? JSON.parse(evalWorkCreationHealthText) : null; } catch {}
  if (!evalWorkCreationHealthResponse.ok || !evalWorkCreationHealth || typeof evalWorkCreationHealth !== 'object') {
    throw new Error(`production_eval_work_creation_health_unavailable_HTTP_${evalWorkCreationHealthResponse.status}`);
  }
  const evalWorkCreationContractHealthy = evalWorkCreationHealth.contract_version === 'eval-work-creation-health-v1'
    && evalWorkCreationHealth.batch_assignee_insert_contract_healthy === true
    && evalWorkCreationHealth.single_assignee_insert_contract_healthy === true
    && evalWorkCreationHealth.healthy === true;
  if (!evalWorkCreationContractHealthy) throw new Error('production_eval_work_creation_contract_unhealthy');
  checks.push({
    name: 'eval_work_creation_v1',
    status: evalWorkCreationHealthResponse.status,
    contractVersion: evalWorkCreationHealth.contract_version,
    batchAssigneeInsertContractHealthy: evalWorkCreationHealth.batch_assignee_insert_contract_healthy === true,
    singleAssigneeInsertContractHealthy: evalWorkCreationHealth.single_assignee_insert_contract_healthy === true
  });

  const evalWorkAssignmentBatchHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_eval_work_assignment_batch_health_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const evalWorkAssignmentBatchHealthText = await evalWorkAssignmentBatchHealthResponse.text();
  try { evalWorkAssignmentBatchHealth = evalWorkAssignmentBatchHealthText ? JSON.parse(evalWorkAssignmentBatchHealthText) : null; } catch {}
  if (!evalWorkAssignmentBatchHealthResponse.ok || !evalWorkAssignmentBatchHealth || typeof evalWorkAssignmentBatchHealth !== 'object') {
    throw new Error(`production_eval_work_assignment_batch_health_unavailable_HTTP_${evalWorkAssignmentBatchHealthResponse.status}`);
  }
  const evalWorkAssignmentBatchContractHealthy = evalWorkAssignmentBatchHealth.contractVersion === 'eval-work-assignment-batch-v1'
    && evalWorkAssignmentBatchHealth.createGrouped === true
    && evalWorkAssignmentBatchHealth.reassignGuarded === true
    && evalWorkAssignmentBatchHealth.cancelGuarded === true
    && Number(evalWorkAssignmentBatchHealth.envelopeViolationCount) === 0
    && evalWorkAssignmentBatchHealth.healthy === true;
  if (!evalWorkAssignmentBatchContractHealthy) throw new Error('production_eval_work_assignment_batch_contract_unhealthy');
  checks.push({
    name: 'eval_work_assignment_batch_v1',
    status: evalWorkAssignmentBatchHealthResponse.status,
    contractVersion: evalWorkAssignmentBatchHealth.contractVersion
  });

  const requestDriveHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_request_drive_evidence_health_snapshot_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const requestDriveHealthText = await requestDriveHealthResponse.text();
  try { requestDriveEvidenceHealth = requestDriveHealthText ? JSON.parse(requestDriveHealthText) : null; } catch {}
  if (!requestDriveHealthResponse.ok || !requestDriveEvidenceHealth || typeof requestDriveEvidenceHealth !== 'object') {
    throw new Error(`production_request_drive_evidence_health_unavailable_HTTP_${requestDriveHealthResponse.status}`);
  }
  const requestDriveContractHealthy = requestDriveEvidenceHealth.contract_version === 'request-drive-evidence-health-v1'
    && Number(requestDriveEvidenceHealth.evidence_mismatch_count) === 0;
  checks.push({
    name: 'request_drive_evidence_v1',
    status: requestDriveHealthResponse.status,
    contractVersion: requestDriveEvidenceHealth.contract_version,
    recentCompletedCount: Math.max(0, Number(requestDriveEvidenceHealth.recent_completed_count) || 0)
  });

  const driveEvidenceSaveHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_drive_evidence_save_health_v2`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 30000);
  const driveEvidenceSaveHealthText = await driveEvidenceSaveHealthResponse.text();
  try { driveEvidenceSaveHealth = driveEvidenceSaveHealthText ? JSON.parse(driveEvidenceSaveHealthText) : null; } catch {}
  if (!driveEvidenceSaveHealthResponse.ok || !driveEvidenceSaveHealth || typeof driveEvidenceSaveHealth !== 'object') {
    throw new Error(`production_drive_evidence_save_health_unavailable_HTTP_${driveEvidenceSaveHealthResponse.status}`);
  }
  const driveEvidenceOutcomes = driveEvidenceSaveHealth.outcomes && typeof driveEvidenceSaveHealth.outcomes === 'object'
    ? driveEvidenceSaveHealth.outcomes
    : {};
  const recentUniqueConflicts = ['DRIVE_ROW_STALE', 'DRIVE_COMPLETION_STALE', 'DRIVE_FIELD_CONFLICT', 'DRIVE_ROW_IDENTITY_CONFLICT']
    .reduce((total, code) => total + Math.max(0, Number(driveEvidenceOutcomes[code]) || 0), 0);
  const driveEvidenceSaveHealthy = driveEvidenceSaveHealth.contractVersion === 'drive-evidence-save-health-v2'
    && driveEvidenceSaveHealth.healthy === true
    && Number(driveEvidenceSaveHealth.lockWaits) === 0
    && Number(driveEvidenceSaveHealth.activeSaveSessions) <= 10
    && recentUniqueConflicts <= 25;
  if (!driveEvidenceSaveHealthy) throw new Error('production_drive_evidence_retry_storm_detected');
  checks.push({
    name: 'drive_evidence_save_health_v2',
    status: driveEvidenceSaveHealthResponse.status,
    activeSaveSessions: Math.max(0, Number(driveEvidenceSaveHealth.activeSaveSessions) || 0),
    lockWaits: Math.max(0, Number(driveEvidenceSaveHealth.lockWaits) || 0),
    recentUniqueConflicts
  });
  if (!requestDriveContractHealthy) throw new Error('production_request_drive_evidence_contract_unhealthy');

  const photoDeliveryHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_photo_delivery_health_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const photoDeliveryHealthText = await photoDeliveryHealthResponse.text();
  try { photoDeliveryHealth = photoDeliveryHealthText ? JSON.parse(photoDeliveryHealthText) : null; } catch {}
  if (!photoDeliveryHealthResponse.ok || !photoDeliveryHealth || typeof photoDeliveryHealth !== 'object') {
    throw new Error(`production_photo_delivery_health_unavailable_HTTP_${photoDeliveryHealthResponse.status}`);
  }
  if (photoDeliveryHealth.healthy !== true
      || Number(photoDeliveryHealth.recent_oversized_upload_count) !== 0
      || Number(photoDeliveryHealth.recent_mime_extension_mismatch_count) !== 0
      || Number(photoDeliveryHealth.recent_png_upload_count) !== 0) {
    throw new Error('production_photo_delivery_contract_unhealthy');
  }
  checks.push({
    name: 'photo_delivery_v1',
    status: photoDeliveryHealthResponse.status,
    recentUploads: Math.max(0, Number(photoDeliveryHealth.recent_upload_count) || 0),
    activeReferences: Math.max(0, Number(photoDeliveryHealth.active_reference_count) || 0),
    staticThumbnailCoveragePercent: Math.max(0, Number(photoDeliveryHealth.static_thumbnail_coverage_percent) || 0)
  });

  const seasonSalesHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_season_sales_office_health_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const seasonSalesHealthText = await seasonSalesHealthResponse.text();
  try { seasonSalesOfficeHealth = seasonSalesHealthText ? JSON.parse(seasonSalesHealthText) : null; } catch {}
  if (!seasonSalesHealthResponse.ok || !seasonSalesOfficeHealth || typeof seasonSalesOfficeHealth !== 'object') {
    throw new Error(`production_season_sales_office_health_unavailable_HTTP_${seasonSalesHealthResponse.status}`);
  }
  if (seasonSalesOfficeHealth.ok !== true || seasonSalesOfficeHealth.parity !== true) {
    throw new Error('production_season_sales_office_parity_unhealthy');
  }
  checks.push({
    name: 'season_sales_office_staging_v1',
    status: seasonSalesHealthResponse.status,
    openStates: Math.max(0, Number(seasonSalesOfficeHealth.openStates) || 0),
    mirrorCount: Math.max(0, Number(seasonSalesOfficeHealth.mirrorCount) || 0)
  });

  const evalItemcodeHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_eval_itemcode_work_health_snapshot_v2`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const evalItemcodeHealthText = await evalItemcodeHealthResponse.text();
  try { evalItemcodeWorkHealth = evalItemcodeHealthText ? JSON.parse(evalItemcodeHealthText) : null; } catch {}
  if (!evalItemcodeHealthResponse.ok || !evalItemcodeWorkHealth || typeof evalItemcodeWorkHealth !== 'object') {
    throw new Error(`production_eval_itemcode_health_unavailable_HTTP_${evalItemcodeHealthResponse.status}`);
  }
  const evalItemcodeContractHealthy = evalItemcodeWorkHealth.contract_version === 'eval-itemcode-work-health-v2'
    && evalItemcodeWorkHealth.scope_contract === 'itemcode-all-rows-v1'
    && Number(evalItemcodeWorkHealth.stored_membership_mismatch_count) === 0
    && Number(evalItemcodeWorkHealth.pdf_origin_mismatch_count) === 0
    && Number(evalItemcodeWorkHealth.excel_attachment_violation_count) === 0
    && Number(evalItemcodeWorkHealth.over_limit_assignment_count) === 0
    && Number(evalItemcodeWorkHealth.largest_origin_count) <= 100;
  if (!evalItemcodeContractHealthy) throw new Error('production_eval_itemcode_work_contract_unhealthy');
  checks.push({
    name: 'eval_itemcode_work_v1',
    status: evalItemcodeHealthResponse.status,
    contractVersion: evalItemcodeWorkHealth.contract_version,
    scopedAssignments: Math.max(0, Number(evalItemcodeWorkHealth.scoped_assignment_count) || 0),
    largestOriginCount: Math.max(0, Number(evalItemcodeWorkHealth.largest_origin_count) || 0),
    historicalPdfOriginMismatchCount: Math.max(0, Number(evalItemcodeWorkHealth.historical_pdf_origin_mismatch_count) || 0)
  });

  const codexOpsHealthResponse = await checkedFetch(`${supabaseUrl}/rest/v1/rpc/get_codex_ops_health_snapshot_v1`, {
    method: 'POST',
    headers: serviceHeaders,
    body: '{}'
  }, 60000);
  const codexOpsHealthText = await codexOpsHealthResponse.text();
  try { codexOpsHealth = codexOpsHealthText ? JSON.parse(codexOpsHealthText) : null; } catch {}
  if (!codexOpsHealthResponse.ok || !codexOpsHealth || typeof codexOpsHealth !== 'object') {
    throw new Error(`production_codex_ops_health_unavailable_HTTP_${codexOpsHealthResponse.status}`);
  }
  const codexOpsContractHealthy = codexOpsHealth.contract_version === 'mobile-codex-ops-v1'
    && Number(codexOpsHealth.private_table_count) === 7
    && codexOpsHealth.anonymous_table_access_denied === true
    && codexOpsHealth.authenticated_table_access_denied === true
    && Number(codexOpsHealth.active_task_count) <= 1;
  if (!codexOpsContractHealthy) throw new Error('production_codex_ops_contract_unhealthy');
  checks.push({
    name: 'codex_ops_v1',
    status: codexOpsHealthResponse.status,
    contractVersion: codexOpsHealth.contract_version,
    submissionEnabled: codexOpsHealth.submission_enabled === true,
    deploymentEnabled: codexOpsHealth.deployment_enabled === true,
    activeTaskCount: Math.max(0, Number(codexOpsHealth.active_task_count) || 0)
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
  boundedMaintenance: boundedMaintenance ? {
    status: String(boundedMaintenance.status || ''),
    errorCode: boundedMaintenance.errorCode ? sanitizeCode(boundedMaintenance.errorCode) : ''
  } : null,
  pikesAssignments: pikesAssignmentHealth ? {
    contractVersion: Number(pikesAssignmentHealth.contractVersion) || 0,
    inventoryRowCount: Math.max(0, Number(pikesAssignmentHealth.inventoryRowCount) || 0),
    snapshotUnassignedCount: Math.max(0, Number(pikesAssignmentHealth.snapshotUnassignedCount) || 0),
    falseUnassignedCount: Math.max(0, Number(pikesAssignmentHealth.falseUnassignedCount) || 0),
    ambiguousCount: Math.max(0, Number(pikesAssignmentHealth.ambiguousCount) || 0)
  } : null,
  poManagement: poManagementHealth ? {
    contractVersion: String(poManagementHealth.contract_version || ''),
    rowCount: Math.max(0, Number(poManagementHealth.row_count) || 0),
    latestBuiltAt: String(poManagementHealth.latest_built_at || '')
  } : null,
  accessControl: accessControlHealth ? {
    contractVersion: String(accessControlHealth.contract_version || ''),
    enforcementMode: String(accessControlHealth.enforcement_mode || ''),
    permissionCount: Math.max(0, Number(accessControlHealth.permission_count) || 0),
    legacyCheckCount: Math.max(0, Number(accessControlHealth.legacy_check_count) || 0),
    legacyMismatchCount: Math.max(0, Number(accessControlHealth.legacy_mismatch_count) || 0),
    unknownRoleCount: Math.max(0, Number(accessControlHealth.unknown_role_count) || 0)
  } : null,
  evalRequestDelivery: evalRequestDeliveryHealth ? {
    contractVersion: String(evalRequestDeliveryHealth.contract_version || ''),
    requiredManagerRecipientCount: Math.max(0, Number(evalRequestDeliveryHealth.required_manager_recipient_count) || 0),
    creationOrderViolationCount: Math.max(0, Number(evalRequestDeliveryHealth.creation_order_violation_count) || 0),
    completionMembershipMismatchCount: Math.max(0, Number(evalRequestDeliveryHealth.completion_membership_mismatch_count) || 0),
    missingCompletionEventCount: Math.max(0, Number(evalRequestDeliveryHealth.missing_completion_event_count) || 0),
    evalOriginScopeMismatchCount: Math.max(0, Number(evalRequestDeliveryHealth.eval_origin_scope_mismatch_count) || 0),
    evalRequiredRecipientViolationCount: Math.max(0, Number(evalRequestDeliveryHealth.eval_required_recipient_violation_count) || 0)
  } : null,
  evalWorkCreation: evalWorkCreationHealth ? {
    contractVersion: String(evalWorkCreationHealth.contract_version || ''),
    batchAssigneeInsertContractHealthy: evalWorkCreationHealth.batch_assignee_insert_contract_healthy === true,
    singleAssigneeInsertContractHealthy: evalWorkCreationHealth.single_assignee_insert_contract_healthy === true
  } : null,
  evalWorkAssignmentBatch: evalWorkAssignmentBatchHealth ? {
    contractVersion: String(evalWorkAssignmentBatchHealth.contractVersion || ''),
    createGrouped: evalWorkAssignmentBatchHealth.createGrouped === true,
    reassignGuarded: evalWorkAssignmentBatchHealth.reassignGuarded === true,
    cancelGuarded: evalWorkAssignmentBatchHealth.cancelGuarded === true,
    envelopeViolationCount: Math.max(0, Number(evalWorkAssignmentBatchHealth.envelopeViolationCount) || 0)
  } : null,
  requestDriveEvidence: requestDriveEvidenceHealth ? {
    contractVersion: String(requestDriveEvidenceHealth.contract_version || ''),
    recentCompletedCount: Math.max(0, Number(requestDriveEvidenceHealth.recent_completed_count) || 0),
    evidenceMismatchCount: Math.max(0, Number(requestDriveEvidenceHealth.evidence_mismatch_count) || 0)
  } : null,
  driveEvidenceSave: driveEvidenceSaveHealth ? {
    contractVersion: String(driveEvidenceSaveHealth.contractVersion || ''),
    recentUniqueTokens: Math.max(0, Number(driveEvidenceSaveHealth.recentUniqueTokens) || 0),
    activeSaveSessions: Math.max(0, Number(driveEvidenceSaveHealth.activeSaveSessions) || 0),
    lockWaits: Math.max(0, Number(driveEvidenceSaveHealth.lockWaits) || 0),
    outcomes: driveEvidenceSaveHealth.outcomes && typeof driveEvidenceSaveHealth.outcomes === 'object' ? driveEvidenceSaveHealth.outcomes : {}
  } : null,
  seasonSalesOffice: seasonSalesOfficeHealth ? {
    openStates: Math.max(0, Number(seasonSalesOfficeHealth.openStates) || 0),
    doneStates: Math.max(0, Number(seasonSalesOfficeHealth.doneStates) || 0),
    mirrorCount: Math.max(0, Number(seasonSalesOfficeHealth.mirrorCount) || 0),
    parity: seasonSalesOfficeHealth.parity === true
  } : null,
  evalItemcodeWork: evalItemcodeWorkHealth ? {
    contractVersion: String(evalItemcodeWorkHealth.contract_version || ''),
    scopeContract: String(evalItemcodeWorkHealth.scope_contract || ''),
    scopedAssignmentCount: Math.max(0, Number(evalItemcodeWorkHealth.scoped_assignment_count) || 0),
    storedMembershipMismatchCount: Math.max(0, Number(evalItemcodeWorkHealth.stored_membership_mismatch_count) || 0),
    pdfOriginMismatchCount: Math.max(0, Number(evalItemcodeWorkHealth.pdf_origin_mismatch_count) || 0),
    excelAttachmentViolationCount: Math.max(0, Number(evalItemcodeWorkHealth.excel_attachment_violation_count) || 0),
    largestOriginCount: Math.max(0, Number(evalItemcodeWorkHealth.largest_origin_count) || 0)
  } : null,
  codexOps: codexOpsHealth ? {
    contractVersion: String(codexOpsHealth.contract_version || ''),
    submissionEnabled: codexOpsHealth.submission_enabled === true,
    deploymentEnabled: codexOpsHealth.deployment_enabled === true,
    activeTaskCount: Math.max(0, Number(codexOpsHealth.active_task_count) || 0),
    pendingAttachmentCount: Math.max(0, Number(codexOpsHealth.pending_attachment_count) || 0)
  } : null,
  appsScript: appsScriptHealth,
  recentSemanticFailureCount: recentSemanticFailures.length
};

process.stdout.write(`${JSON.stringify(result)}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Production health\n\n- Status: healthy\n- App shell: ${liveRelease}\n- Apps Script lifecycle policy: ${result.appsScript ? `${result.appsScript.policyVersion} (${result.appsScript.requiredRecipientCount} required recipients, commit ${result.appsScript.commit})` : 'not required'}\n- Login bridge/Data API: HTTP 200 expected mismatch\n- Delivery: ${result.delivery ? `${result.delivery.delivered} delivered, ${result.delivery.failed} failed` : 'secure check skipped'}\n- Request integrity: ${result.requestIntegrity?.healthCode || 'secure check skipped'}\n- Drive evidence saves: ${result.driveEvidenceSave ? `${result.driveEvidenceSave.activeSaveSessions} active, ${result.driveEvidenceSave.lockWaits} lock waits, ${result.driveEvidenceSave.recentUniqueTokens} recent tokens` : 'secure check skipped'}\n- Bounded maintenance: ${result.boundedMaintenance?.status || 'not required'}\n- Pikes assignments: ${result.pikesAssignments ? `${result.pikesAssignments.inventoryRowCount} rows, ${result.pikesAssignments.falseUnassignedCount} false unassigned` : 'secure check skipped'}\n- PO Management: ${result.poManagement ? `${result.poManagement.rowCount} rows, ${result.poManagement.contractVersion}` : 'secure check skipped'}\n- Access Control: ${result.accessControl ? `${result.accessControl.permissionCount} permissions, ${result.accessControl.legacyMismatchCount} legacy mismatches, ${result.accessControl.enforcementMode}` : 'secure check skipped'}\n- Eval/Request delivery V2: ${result.evalRequestDelivery ? `${result.evalRequestDelivery.contractVersion}, ${result.evalRequestDelivery.requiredManagerRecipientCount} locked manager recipients` : 'secure check skipped'}\n- Eval Reports #2 assignment email: ${result.evalWorkAssignmentBatch ? `${result.evalWorkAssignmentBatch.contractVersion}, grouped ${result.evalWorkAssignmentBatch.createGrouped}` : 'secure check skipped'}\n- ITEMCODE-wide Eval Work: ${result.evalItemcodeWork ? `${result.evalItemcodeWork.contractVersion}, ${result.evalItemcodeWork.scopedAssignmentCount} scoped assignments, largest ${result.evalItemcodeWork.largestOriginCount} rows` : 'secure check skipped'}\n- Season Sales Notes: ${result.seasonSalesOffice ? `${result.seasonSalesOffice.openStates} open winners, ${result.seasonSalesOffice.mirrorCount} staged, parity ${result.seasonSalesOffice.parity}` : 'secure check skipped'}\n- Recent semantic failures: ${result.recentSemanticFailureCount}\n- Duration: ${result.durationMs} ms\n`
  );
}
