import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appsScriptFilesDigest } from './apps-script-function-patch.mjs';
import { APPS_SCRIPT_DEPLOYMENT_CONFIG_FIELDS, sameAppsScriptDeploymentConfig } from '../src/services/apps-script-deployment-rollback.mjs';

const COMPLETE_SHA = /^[a-f0-9]{40}$/;

export class AppsScriptRecoveryEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AppsScriptRecoveryEvidenceError';
    this.code = code;
  }
}

export async function writeAppsScriptHeadOnlyEvidence({ script, scriptId, deploymentId,
  expectedCommit, expectedDeploymentVersion, expectedFilesDigest, evidenceDirectory,
  fileSystem = fs, now = () => Date.now() }) {
  const commit = String(expectedCommit || '').trim();
  if (!script?.projects?.getContent || !script?.projects?.deployments?.get) throw evidenceError('CLIENT_INVALID');
  if (!String(scriptId || '').trim() || !String(deploymentId || '').trim()) throw evidenceError('TARGET_MISSING');
  if (!COMPLETE_SHA.test(commit)) throw evidenceError('EXPECTED_COMMIT_INVALID');
  if (!Number.isSafeInteger(expectedDeploymentVersion) || expectedDeploymentVersion < 1) throw evidenceError('EXPECTED_VERSION_INVALID');
  if (!/^[a-f0-9]{64}$/.test(String(expectedFilesDigest || ''))) throw evidenceError('EXPECTED_SOURCE_DIGEST_INVALID');
  if (!String(evidenceDirectory || '').trim() || !fileSystem?.mkdirSync || !fileSystem?.writeFileSync) throw evidenceError('EVIDENCE_PATH_INVALID');

  const content = await script.projects.getContent({ scriptId });
  const observedDigest = appsScriptFilesDigest(content?.data?.files || []);
  if (observedDigest !== expectedFilesDigest) throw evidenceError('HEAD_SOURCE_MISMATCH');
  const deployment = await script.projects.deployments.get({ scriptId, deploymentId });
  const deployedVersion = Number(deployment?.data?.deploymentConfig?.versionNumber);
  if (String(deployment?.data?.deploymentId || '').trim() !== deploymentId
      || deployedVersion !== expectedDeploymentVersion) throw evidenceError('DEPLOYMENT_ADVANCED');
  const verifiedAtMs = Number(now());
  if (!Number.isFinite(verifiedAtMs)) throw evidenceError('TIME_INVALID');
  const evidence = { schemaVersion: 'gnc-apps-script-head-only-evidence-v1', publicationMode: 'head-only',
    headCommit: commit, headUpdated: true, headSourceDigest: observedDigest,
    existingDeploymentVersion: deployedVersion, deploymentUnchanged: true,
    deploymentUpdated: false, versionCreated: false, verifiedAt: new Date(verifiedAtMs).toISOString() };
  fileSystem.mkdirSync(evidenceDirectory, { recursive: true });
  fileSystem.writeFileSync(path.join(evidenceDirectory, 'apps-script-recovery-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
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

function requireDeploymentVersion(observed, expected) {
  if (expected !== undefined && observed !== expected) {
    throw evidenceError(observed > expected ? 'DEPLOYMENT_ADVANCED' : 'VERSION_NOT_VISIBLE');
  }
}

function requireDeploymentConfig(response, expected) {
  if (expected && !sameAppsScriptDeploymentConfig(response.data?.deploymentConfig, expected)) {
    throw evidenceError('DEPLOYMENT_CONFIG_MISMATCH');
  }
}

async function readRecoveryEvidenceAttempt({
  script, scriptId, deploymentId, commit, expectedVersionNumber, expectedDeploymentConfig, expectedSource,
  observed, requestOptions, now,
}) {
  const deploymentTarget = { scriptId, deploymentId, fields: APPS_SCRIPT_DEPLOYMENT_CONFIG_FIELDS };
  const before = await script.projects.deployments.get(deploymentTarget, requestOptions());
  observed.observedVersionBefore = deploymentVersion(before, deploymentId);
  requireDeploymentVersion(observed.observedVersionBefore, expectedVersionNumber);
  requireDeploymentConfig(before, expectedDeploymentConfig);

  const versionNumber = expectedVersionNumber ?? observed.observedVersionBefore;
  const content = await script.projects.getContent({ scriptId, versionNumber }, requestOptions());
  const source = codeSource(content);
  observed.observedCommit = fingerprintFromSource(source);
  if (observed.observedCommit !== commit) throw evidenceError('COMMIT_MISMATCH');
  if (expectedSource !== undefined && source !== expectedSource) throw evidenceError('SOURCE_MISMATCH');

  const after = await script.projects.deployments.get(deploymentTarget, requestOptions());
  observed.observedVersionAfter = deploymentVersion(after, deploymentId);
  requireDeploymentVersion(observed.observedVersionAfter, versionNumber);
  requireDeploymentConfig(after, expectedDeploymentConfig);
  const verifiedAtMs = Number(now());
  if (!Number.isFinite(verifiedAtMs)) throw evidenceError('TIME_INVALID');
  return {
    schemaVersion: 'gnc-apps-script-recovery-evidence-v1', commit, versionNumber,
    verifiedAt: new Date(verifiedAtMs).toISOString(),
    sourceDigest: createHash('sha256').update(source).digest('hex')
  };
}

export async function createAppsScriptRecoveryEvidence({
  script,
  scriptId,
  deploymentId,
  expectedCommit,
  expectedVersionNumber,
  expectedDeploymentConfig,
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
  const requestOptions = () => {
    const remaining = deadline - Number(now());
    if (!Number.isFinite(remaining) || remaining <= 0) throw evidenceError('READ_DEADLINE_EXCEEDED');
    return { timeout: Math.min(12000, remaining), retry: false };
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const observed = { observedVersionBefore: null, observedVersionAfter: null, observedCommit: null };
    try {
      return await readRecoveryEvidenceAttempt({ script, scriptId, deploymentId, commit, expectedVersionNumber,
        expectedDeploymentConfig, expectedSource, observed, requestOptions, now });
    } catch (error) {
      const retryable = ['VERSION_NOT_VISIBLE', 'COMMIT_MISMATCH', 'SOURCE_MISMATCH']
        .some(code => error?.code === `APPS_SCRIPT_RECOVERY_EVIDENCE_${code}`);
      onObservation({ attempt, expectedVersion: expectedVersionNumber ?? null,
        observedVersion: observed.observedVersionAfter ?? observed.observedVersionBefore, ...observed,
        code: error instanceof AppsScriptRecoveryEvidenceError ? error.code : 'APPS_SCRIPT_RECOVERY_EVIDENCE_READ_FAILED' });
      if (!retryable || attempt === attempts || Number(now()) >= deadline) throw error;
      await sleep(Math.min(retryDelayMs, deadline - Number(now())));
    }
  }
}
