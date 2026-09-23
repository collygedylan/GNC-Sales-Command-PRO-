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
  now = () => Date.now()
}) {
  const commit = String(expectedCommit || '').trim();
  if (!script?.projects?.deployments || typeof script.projects.deployments.get !== 'function'
      || typeof script?.projects?.getContent !== 'function') throw evidenceError('CLIENT_INVALID');
  if (!String(scriptId || '').trim() || !String(deploymentId || '').trim()) throw evidenceError('TARGET_MISSING');
  if (!COMPLETE_SHA.test(commit)) throw evidenceError('EXPECTED_COMMIT_INVALID');

  const before = await script.projects.deployments.get({ scriptId, deploymentId });
  const versionNumber = deploymentVersion(before, deploymentId);
  const content = await script.projects.getContent({ scriptId, versionNumber });
  const source = codeSource(content);
  if (fingerprintFromSource(source) !== commit) throw evidenceError('COMMIT_MISMATCH');

  const after = await script.projects.deployments.get({ scriptId, deploymentId });
  if (deploymentVersion(after, deploymentId) !== versionNumber) {
    throw evidenceError('DEPLOYMENT_CHANGED_DURING_VERIFICATION');
  }
  const verifiedAtMs = Number(now());
  if (!Number.isFinite(verifiedAtMs)) throw evidenceError('TIME_INVALID');
  const verifiedAt = new Date(verifiedAtMs).toISOString();
  return {
    schemaVersion: 'gnc-apps-script-recovery-evidence-v1',
    commit,
    versionNumber,
    verifiedAt,
    sourceDigest: createHash('sha256').update(source).digest('hex')
  };
}
