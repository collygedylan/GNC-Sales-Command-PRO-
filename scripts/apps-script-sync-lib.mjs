import { normalizeRelease } from './deployment-fingerprint-lib.mjs';
import {
  createAppsScriptSigningKeyReconciliationEnvelope,
  createSignedDeploymentHealthEnvelope
} from './apps-script-signing.mjs';

export const APPS_SCRIPT_VERSION_LIMIT = 200;
export const APPS_SCRIPT_VERSION_WARNING_THRESHOLD = 180;
export const APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';
export const REQUEST_LIFECYCLE_POLICY_VERSION = 'plant-request-lifecycle-v2';
export const REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT = 3;

export class AppsScriptSyncError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AppsScriptSyncError';
    this.code = code;
  }
}

function syncError(code) {
  return new AppsScriptSyncError(code);
}

const SAFE_HEALTH_ERROR_CODES = new Set([
  'APPS_SCRIPT_ACTION_SIGNATURE_REQUIRED', 'APPS_SCRIPT_ACTION_SIGNATURE_EXPIRED',
  'APPS_SCRIPT_ACTION_SIGNATURE_INVALID', 'APPS_SCRIPT_ACTION_SIGNING_KEY_MISSING',
  'APPS_SCRIPT_HEALTH_ACTOR_INVALID', 'APPS_SCRIPT_ACTION_PAYLOAD_INVALID',
  'APPS_SCRIPT_ACTION_FORBIDDEN', 'APPS_SCRIPT_POST_SIGNATURE_REQUIRED',
  'APPS_SCRIPT_HEALTH_RECONCILIATION_FORBIDDEN', 'APPS_SCRIPT_SIGNING_KEY_SERVICE_AUTH_REQUIRED'
]);

function safeHealthErrorCode(payload) {
  const candidate = String(payload?.message || payload?.error || payload?.code || '').trim();
  return SAFE_HEALTH_ERROR_CODES.has(candidate) ? candidate : '';
}

async function reconcileDeploymentSigningKey({ deploymentId, serviceRoleKey, githubSha, fetchImpl }) {
  const response = await fetchImpl(healthUrlForDeployment(deploymentId), {
    method: 'POST',
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createAppsScriptSigningKeyReconciliationEnvelope(serviceRoleKey))
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || payload?.ok !== true) {
    const status = Number(response.status) || 0;
    const safeCode = safeHealthErrorCode(payload);
    throw syncError(`APPS_SCRIPT_SIGNING_KEY_RECONCILIATION_HTTP_${status}${safeCode ? `_${safeCode}` : ''}`);
  }
  if (String(payload.deployedCommit || '').trim() !== String(githubSha || '').trim()) {
    throw syncError('APPS_SCRIPT_SIGNING_KEY_RECONCILIATION_COMMIT_MISMATCH');
  }
}

function normalizeAppsScriptFileName(name) {
  return String(name || '').trim().replace(/\.(gs|js)$/i, '');
}

function isCommitFingerprint(value) {
  return /^[a-f0-9]{7,40}$/i.test(String(value || '').trim());
}

export function applyDeploymentFingerprint(source, githubSha) {
  const safeSource = String(source || '');
  const safeSha = String(githubSha || '').trim();
  if (!isCommitFingerprint(safeSha)) throw syncError('APPS_SCRIPT_DEPLOYMENT_COMMIT_MISSING');
  if (!safeSource.includes(APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER)) {
    throw syncError('APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER_MISSING');
  }
  return safeSource.split(APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER).join(safeSha);
}

export async function listAllAppsScriptVersions(script, scriptId) {
  const versions = [];
  let pageToken = undefined;
  do {
    const response = await script.projects.versions.list({
      scriptId,
      pageSize: 50,
      ...(pageToken ? { pageToken } : {})
    });
    const page = Array.isArray(response?.data?.versions) ? response.data.versions : [];
    versions.push(...page);
    pageToken = String(response?.data?.nextPageToken || '').trim() || undefined;
  } while (pageToken);
  return versions;
}

export async function listAllAppsScriptDeployments(script, scriptId) {
  const deployments = [];
  let pageToken;
  do {
    const response = await script.projects.deployments.list({
      scriptId,
      pageSize: 50,
      ...(pageToken ? { pageToken } : {})
    });
    deployments.push(...(Array.isArray(response?.data?.deployments) ? response.data.deployments : []));
    pageToken = String(response?.data?.nextPageToken || '').trim() || undefined;
  } while (pageToken);
  return deployments;
}

async function tryDeleteOldestUnusedVersion({ script, scriptId, versions, deleteVersionRequest, beforeMutation, logger }) {
  if (typeof deleteVersionRequest !== 'function' || typeof script?.projects?.deployments?.list !== 'function') return null;
  let deployments;
  try { deployments = await listAllAppsScriptDeployments(script, scriptId); }
  catch (error) {
    logger.warn(`WARNING: APPS_SCRIPT_VERSION_DELETE_SKIPPED; deployment references unavailable (${Number(error?.response?.status) || 'request error'}).`);
    return null;
  }
  const deployedVersions = new Set(deployments.map(deployment => Number(deployment?.deploymentConfig?.versionNumber))
    .filter(version => Number.isSafeInteger(version) && version > 0));
  const latestExistingVersion = Math.max(0, ...versions.map(version => Number(version?.versionNumber))
    .filter(version => Number.isSafeInteger(version) && version > 0));
  const candidate = versions.map(version => Number(version?.versionNumber))
    .filter(version => Number.isSafeInteger(version) && version > 0 && version !== latestExistingVersion && !deployedVersions.has(version))
    .sort((a, b) => a - b)[0];
  if (!candidate) return null;
  // Reauthorize immediately before this optional destructive operation.
  await beforeMutation();
  const url = `https://script.googleapis.com/v1/projects/${encodeURIComponent(String(scriptId))}/versions/${candidate}`;
  try {
    const response = await deleteVersionRequest({ url, method: 'DELETE' });
    const status = Number(response?.status ?? response?.statusCode);
    if (Number.isFinite(status) && (status < 200 || status >= 300)) {
      const error = new Error('Apps Script version delete returned a non-success status.');
      Object.assign(error, { response: { status } });
      throw error;
    }
    return candidate;
  } catch (error) {
    const status = Number(error?.response?.status ?? error?.statusCode ?? error?.code);
    const reason = [404, 405, 501].includes(status) ? 'unsupported API response' : 'delete was unavailable';
    logger.warn(`WARNING: APPS_SCRIPT_VERSION_DELETE_SKIPPED; ${reason} (${Number.isFinite(status) ? status : 'request error'}).`);
    return null;
  }
}

function healthUrlForDeployment(deploymentId) {
  return `https://script.google.com/macros/s/${encodeURIComponent(String(deploymentId || '').trim())}/exec`;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for the issued update to become visible without repeating any write. */
export async function verifyDeploymentVersion({
  script,
  scriptId,
  deploymentId,
  versionNumber,
  sleep = delay,
  now = () => Date.now(),
  attempts = 13,
  retryDelayMs = 5000,
  onObservation = () => {}
}) {
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1
      || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 13
      || !Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5000) {
    throw syncError('APPS_SCRIPT_DEPLOYMENT_VERIFICATION_CONFIGURATION_INVALID');
  }
  const deadline = Number(now()) + 90000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remaining = deadline - Number(now());
    if (!Number.isFinite(remaining) || remaining <= 0) break;
    const deployment = await script.projects.deployments.get({ scriptId, deploymentId }, {
      timeout: Math.min(12000, remaining), retry: false
    });
    const observedVersion = deployment?.data?.deploymentConfig?.versionNumber;
    if (!Number.isSafeInteger(observedVersion) || observedVersion < 1) {
      throw syncError('APPS_SCRIPT_DEPLOYMENT_VERSION_INVALID');
    }
    if (observedVersion > versionNumber) {
      throw syncError('APPS_SCRIPT_DEPLOYMENT_VERSION_ADVANCED');
    }
    const observedAt = Number(now());
    if (!Number.isFinite(observedAt) || observedAt >= deadline) break;
    if (observedVersion === versionNumber) return observedVersion;
    onObservation({ attempt, expectedVersion: versionNumber, observedVersion });
    if (attempt < attempts) await sleep(Math.min(retryDelayMs, Math.max(0, deadline - Number(now()))));
  }
  throw syncError('APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
}

export async function verifyDeploymentHealth({
  deploymentId,
  githubSha,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  attempts = 12,
  retryDelayMs = 5000
}) {
  if (typeof fetchImpl !== 'function') throw syncError('APPS_SCRIPT_DEPLOYMENT_HEALTH_FETCH_UNAVAILABLE');
  const totalAttempts = Math.max(1, Number(attempts) || 1);
  let lastCode = 'APPS_SCRIPT_DEPLOYMENT_HEALTH_UNAVAILABLE';

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(healthUrlForDeployment(deploymentId), {
        method: 'POST',
        redirect: 'follow',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createSignedDeploymentHealthEnvelope(serviceRoleKey))
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch {}

      if (!response.ok || payload?.ok !== true) {
        const safeCode = safeHealthErrorCode(payload);
        lastCode = `APPS_SCRIPT_DEPLOYMENT_HEALTH_HTTP_${Number(response.status) || 0}${safeCode ? `_${safeCode}` : ''}`;
      } else if (String(payload.deployedCommit || '').trim() !== String(githubSha || '').trim()) {
        lastCode = 'APPS_SCRIPT_DEPLOYMENT_HEALTH_COMMIT_MISMATCH';
      } else if (String(payload.lifecycleRecipientPolicyVersion || '').trim() !== REQUEST_LIFECYCLE_POLICY_VERSION) {
        lastCode = 'APPS_SCRIPT_DEPLOYMENT_HEALTH_POLICY_MISMATCH';
      } else if (Number(payload.requiredRecipientCount) !== REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT) {
        lastCode = 'APPS_SCRIPT_DEPLOYMENT_HEALTH_RECIPIENT_COUNT_MISMATCH';
      } else {
        return {
          deployedCommit: String(payload.deployedCommit),
          lifecycleRecipientPolicyVersion: String(payload.lifecycleRecipientPolicyVersion),
          requiredRecipientCount: Number(payload.requiredRecipientCount)
        };
      }
    } catch {
      lastCode = 'APPS_SCRIPT_DEPLOYMENT_HEALTH_UNAVAILABLE';
    }

    if (attempt < totalAttempts) await sleep(retryDelayMs);
  }

  throw syncError(lastCode);
}

export async function syncAppsScriptProject({
  script,
  scriptId,
  deploymentId = '',
  source,
  githubSha = '',
  serviceRoleKey = '',
  logger = console,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  healthAttempts = 12,
  healthRetryDelayMs = 5000,
  deleteVersionRequest,
  beforeMutation = async () => {}
}) {
  if (!scriptId) throw syncError('APPS_SCRIPT_SCRIPT_ID_MISSING');
  if (!String(source || '').trim()) throw syncError('APPS_SCRIPT_SOURCE_EMPTY');
  if (typeof beforeMutation !== 'function') throw syncError('APPS_SCRIPT_MUTATION_GUARD_INVALID');

  const deploymentRequested = !!String(deploymentId || '').trim();
  const deploymentSource = deploymentRequested
    ? applyDeploymentFingerprint(source, githubSha)
    : String(source);

  const current = await script.projects.getContent({ scriptId });
  const files = Array.isArray(current?.data?.files) ? current.data.files.slice() : [];
  if (!files.length) throw syncError('APPS_SCRIPT_PROJECT_CONTENT_EMPTY');

  const codeFileIndex = files.findIndex((file) => {
    return normalizeAppsScriptFileName(file?.name) === 'Code' && file?.type === 'SERVER_JS';
  });
  const nextCodeFile = { name: 'Code', type: 'SERVER_JS', source: deploymentSource };
  if (codeFileIndex >= 0) files[codeFileIndex] = { ...files[codeFileIndex], ...nextCodeFile };
  else files.push(nextCodeFile);

  await beforeMutation();
  await script.projects.updateContent({ scriptId, requestBody: { files } });
  const versions = await listAllAppsScriptVersions(script, scriptId);
  const versionCount = versions.length;
  if (versionCount >= APPS_SCRIPT_VERSION_WARNING_THRESHOLD) {
    logger.warn(`WARNING: APPS_SCRIPT_VERSION_CAPACITY_LOW (${versionCount}/${APPS_SCRIPT_VERSION_LIMIT})`);
  }
  if (!deploymentRequested) {
    return { ok: true, headUpdated: true, versionCapacityExhausted: versionCount >= APPS_SCRIPT_VERSION_LIMIT,
      versionCreated: false, versionCountBefore: versionCount, sourceUpdated: true, deploymentUpdated: false };
  }

  const release = normalizeRelease(deploymentSource.match(/const APP_RELEASE_VERSION_\s*=\s*['"]([^'"]+)['"]/)?.[1]);
  const description = release ? `${release} (${String(githubSha).slice(0, 7)})` : `GitHub Code.gs sync ${String(githubSha).slice(0, 7)}`;
  let versionCapacityExhausted = versionCount >= APPS_SCRIPT_VERSION_LIMIT;
  let versionNumber;
  let deletedVersionNumber = null;
  const createVersion = async () => {
    await beforeMutation();
    try {
      const versionResponse = await script.projects.versions.create({ scriptId, requestBody: { description } });
      versionNumber = Number(versionResponse?.data?.versionNumber);
      return true;
    } catch (error) {
      const message = [error?.code, error?.message, error?.response?.data?.error?.message].join(' ');
      if (!/APPS_SCRIPT_VERSION_CAPACITY_EXHAUSTED|quota exceeded|maximum number of versions|version.{0,80}(?:limit|quota)/i.test(message)) throw error;
      versionCapacityExhausted = true;
      return false;
    }
  };
  if (versionCapacityExhausted) {
    deletedVersionNumber = await tryDeleteOldestUnusedVersion({ script, scriptId, versions, deleteVersionRequest, beforeMutation, logger });
    if (deletedVersionNumber != null) {
      versions.splice(versions.findIndex(version => Number(version.versionNumber) === deletedVersionNumber), 1);
      versionCapacityExhausted = versions.length >= APPS_SCRIPT_VERSION_LIMIT;
    }
    if (!versionCapacityExhausted) await createVersion();
  } else if (!(await createVersion())) {
    // A concurrent publisher can fill the final slot after the initial list.
    // Attempt one guarded deletion and one retry, then use the existing fallback.
    deletedVersionNumber = await tryDeleteOldestUnusedVersion({ script, scriptId, versions, deleteVersionRequest, beforeMutation, logger });
    if (deletedVersionNumber != null) {
      versions.splice(versions.findIndex(version => Number(version.versionNumber) === deletedVersionNumber), 1);
      versionCapacityExhausted = versions.length >= APPS_SCRIPT_VERSION_LIMIT;
      if (!versionCapacityExhausted) await createVersion();
    }
  }
  if (versionCapacityExhausted) {
    versionNumber = Math.max(0, ...versions.map(version => Number(version.versionNumber)).filter(Number.isSafeInteger));
    logger.warn(`WARNING: APPS_SCRIPT_VERSION_CAPACITY_EXHAUSTED; @HEAD updated; web app retains existing version ${versionNumber}.`);
  }
  if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
    throw syncError('APPS_SCRIPT_VERSION_NUMBER_MISSING');
  }

  await beforeMutation();
  await script.projects.deployments.update({
    scriptId,
    deploymentId,
    requestBody: {
      deploymentConfig: {
        versionNumber,
        manifestFileName: 'appsscript',
        description: versionCapacityExhausted ? `Existing version ${versionNumber}; @HEAD synced ${String(githubSha).slice(0, 7)}` : description
      }
    }
  });

  const deployedVersionNumber = await verifyDeploymentVersion({
    script, scriptId, deploymentId, versionNumber, sleep,
    onObservation: observation => logger.warn(`APPS_SCRIPT_DEPLOYMENT_VERSION_PENDING ${JSON.stringify(observation)}`)
  });

  if (versionCapacityExhausted) {
    return { ok: true, headUpdated: true, versionCapacityExhausted: true, versionCreated: false,
      versionCountBefore: versionCount, versionCountAfter: versions.length, sourceUpdated: true,
      deploymentUpdated: true, versionNumber, deployedVersionNumber, health: null };
  }

  await reconcileDeploymentSigningKey({ deploymentId, serviceRoleKey, githubSha, fetchImpl });

  const health = await verifyDeploymentHealth({
    deploymentId,
    githubSha,
    serviceRoleKey,
    fetchImpl,
    sleep,
    attempts: healthAttempts,
    retryDelayMs: healthRetryDelayMs
  });

  return {
    ok: true,
    headUpdated: true,
    versionCapacityExhausted: false,
    versionCreated: true,
    versionCountBefore: versionCount,
    versionCountAfter: versions.length + 1,
    sourceUpdated: true,
    deploymentUpdated: true,
    versionNumber,
    deployedVersionNumber,
    health
  };
}
