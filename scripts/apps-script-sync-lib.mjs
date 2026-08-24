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

function healthUrlForDeployment(deploymentId) {
  return `https://script.google.com/macros/s/${encodeURIComponent(String(deploymentId || '').trim())}/exec`;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyDeploymentHealth({
  deploymentId,
  githubSha,
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
        body: JSON.stringify({ type: 'deployment_health' })
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch {}

      if (!response.ok || payload?.ok !== true) {
        lastCode = `APPS_SCRIPT_DEPLOYMENT_HEALTH_HTTP_${Number(response.status) || 0}`;
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
  logger = console,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  healthAttempts = 12,
  healthRetryDelayMs = 5000
}) {
  if (!scriptId) throw syncError('APPS_SCRIPT_SCRIPT_ID_MISSING');
  if (!String(source || '').trim()) throw syncError('APPS_SCRIPT_SOURCE_EMPTY');

  const versions = await listAllAppsScriptVersions(script, scriptId);
  const versionCount = versions.length;
  if (versionCount >= APPS_SCRIPT_VERSION_LIMIT) {
    throw syncError('APPS_SCRIPT_VERSION_CAPACITY_EXHAUSTED');
  }
  if (versionCount >= APPS_SCRIPT_VERSION_WARNING_THRESHOLD) {
    logger.warn(`WARNING: APPS_SCRIPT_VERSION_CAPACITY_LOW (${versionCount}/${APPS_SCRIPT_VERSION_LIMIT})`);
  }

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

  await script.projects.updateContent({ scriptId, requestBody: { files } });
  if (!deploymentRequested) {
    return { versionCountBefore: versionCount, sourceUpdated: true, deploymentUpdated: false };
  }

  const description = `GitHub Code.gs sync ${String(githubSha).slice(0, 7)}`;
  const versionResponse = await script.projects.versions.create({
    scriptId,
    requestBody: { description }
  });
  const versionNumber = Number(versionResponse?.data?.versionNumber);
  if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
    throw syncError('APPS_SCRIPT_VERSION_NUMBER_MISSING');
  }

  await script.projects.deployments.update({
    scriptId,
    deploymentId,
    requestBody: {
      deploymentConfig: {
        versionNumber,
        manifestFileName: 'appsscript',
        description
      }
    }
  });

  const deployment = await script.projects.deployments.get({ scriptId, deploymentId });
  const deployedVersionNumber = Number(deployment?.data?.deploymentConfig?.versionNumber);
  if (deployedVersionNumber !== versionNumber) {
    throw syncError('APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  }

  const health = await verifyDeploymentHealth({
    deploymentId,
    githubSha,
    fetchImpl,
    sleep,
    attempts: healthAttempts,
    retryDelayMs: healthRetryDelayMs
  });

  return {
    versionCountBefore: versionCount,
    versionCountAfter: versionCount + 1,
    sourceUpdated: true,
    deploymentUpdated: true,
    versionNumber,
    deployedVersionNumber,
    health
  };
}
