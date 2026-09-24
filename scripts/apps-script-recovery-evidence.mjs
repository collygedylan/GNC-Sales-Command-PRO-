import { createHash } from 'node:crypto';

const COMPLETE_SHA = /^[a-f0-9]{40}$/;

export class AppsScriptRecoveryEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AppsScriptRecoveryEvidenceError';
    this.code = code;
  }
}

function evidenceError(code) {
  return new AppsScriptRecoveryEvidenceError(`APPS_SCRIPT_RECOVERY_EVIDENCE_${code}`);
}

function deploymentVersion(response, deploymentId) {
  const deployment = response?.data;
  const versionNumber = Number(deployment?.deploymentConfig?.versionNumber);
  if (String(deployment?.deploymentId || '').trim() !== deploymentId
      || !Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw evidenceError('DEPLOYMENT_INVALID');
  }
  return versionNumber;
}

function codeSource(response) {
  const files = Array.isArray(response?.data?.files) ? response.data.files : [];
  const code = files.find((file) => String(file?.name || '').replace(/\.(gs|js)$/i, '') === 'Code'
    && file?.type === 'SERVER_JS');
  if (!String(code?.source || '').trim()) throw evidenceError('CODE_SOURCE_MISSING');
  return String(code.source);
}

function fingerprintFromSource(source) {
  const matches = [...source.matchAll(/\bAPPS_SCRIPT_DEPLOYMENT_COMMIT_\s*=\s*(['"])([a-f0-9]{40})\1\s*;/g)];
  if (matches.length !== 1) throw evidenceError('COMMIT_FINGERPRINT_INVALID');
  return matches[0][2];
}

export async function createAppsScriptRecoveryEvidence({
  script,
  scriptId,
  deploymentId,
  expectedCommit,
  expectedVersionNumber,
  expectedSource,
  attempts = 1,
  retryDelayMs = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onObservation = () => {},
  now = () => Date.now()
}) {
  const commit = String(expectedCommit || '').trim();
  if (!script?.projects?.deployments || typeof script.projects.deployments.get !== 'function'
      || typeof script?.projects?.getContent !== 'function') throw evidenceError('CLIENT_INVALID');
  if (!String(scriptId || '').trim() || !String(deploymentId || '').trim()) throw evidenceError('TARGET_MISSING');
  if (!COMPLETE_SHA.test(commit)) throw evidenceError('EXPECTED_COMMIT_INVALID');
  if (expectedVersionNumber !== undefined && (!Number.isSafeInteger(expectedVersionNumber) || expectedVersionNumber < 1)) throw evidenceError('EXPECTED_VERSION_INVALID');
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 13
      || !Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5000) throw evidenceError('RETRY_CONFIGURATION_INVALID');
  if (attempts > 1 && (expectedVersionNumber === undefined || !String(expectedSource || '').trim())) throw evidenceError('PINNED_SOURCE_REQUIRED');

  const deadline = Number(now()) + 90000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let observedVersion = null;
    let observedCommit = null;
    try {
      const requestOptions = () => {
        const remaining = deadline - Number(now());
        if (!Number.isFinite(remaining) || remaining <= 0) throw evidenceError('READ_DEADLINE_EXCEEDED');
        return { timeout: Math.min(12000, remaining), retry: false };
      };
      const before = await script.projects.deployments.get({ scriptId, deploymentId }, requestOptions());
      observedVersion = deploymentVersion(before, deploymentId);
      if (expectedVersionNumber !== undefined && observedVersion !== expectedVersionNumber) {
        throw evidenceError(observedVersion > expectedVersionNumber ? 'DEPLOYMENT_ADVANCED' : 'VERSION_NOT_VISIBLE');
      }
      const versionNumber = expectedVersionNumber ?? observedVersion;
      const content = await script.projects.getContent({ scriptId, versionNumber }, requestOptions());
      const source = codeSource(content);
      observedCommit = fingerprintFromSource(source);
      if (observedCommit !== commit) throw evidenceError('COMMIT_MISMATCH');
      if (expectedSource !== undefined && source !== expectedSource) throw evidenceError('SOURCE_MISMATCH');

      const after = await script.projects.deployments.get({ scriptId, deploymentId }, requestOptions());
      if (deploymentVersion(after, deploymentId) !== versionNumber) throw evidenceError('DEPLOYMENT_CHANGED_DURING_VERIFICATION');
      const verifiedAtMs = Number(now());
      if (!Number.isFinite(verifiedAtMs)) throw evidenceError('TIME_INVALID');
      return {
        schemaVersion: 'gnc-apps-script-recovery-evidence-v1', commit, versionNumber,
        verifiedAt: new Date(verifiedAtMs).toISOString(),
        sourceDigest: createHash('sha256').update(source).digest('hex')
      };
    } catch (error) {
      const retryable = ['VERSION_NOT_VISIBLE', 'COMMIT_MISMATCH', 'SOURCE_MISMATCH']
        .some(code => error?.code === `APPS_SCRIPT_RECOVERY_EVIDENCE_${code}`);
      onObservation({ attempt, expectedVersion: expectedVersionNumber ?? null, observedVersion, observedCommit,
        code: error instanceof AppsScriptRecoveryEvidenceError ? error.code : 'APPS_SCRIPT_RECOVERY_EVIDENCE_READ_FAILED' });
      if (!retryable || attempt === attempts || Number(now()) >= deadline) throw error;
      await sleep(Math.min(retryDelayMs, deadline - Number(now())));
    }
  }
}
