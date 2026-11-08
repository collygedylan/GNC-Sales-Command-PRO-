import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { googleApiFromClasp } from './google-clasp-api.mjs';
import { patchAppsScriptFunctions } from './apps-script-function-patch.mjs';
import { applyDeploymentFingerprint } from './apps-script-sync-lib.mjs';
import { appsScriptFilesDigest, expectedAppsScriptCommit } from './apps-script-health-fingerprint.mjs';
import { createSignedDeploymentHealthEnvelope } from './apps-script-signing.mjs';

const scriptId = '1mDwtEXFHmvnVANlQAB6cPqnW8F4AqcKeOsLolLYhvQgf2K3Qu_QKCpXT';
const deploymentId = 'AKfycbwhH-eB5Py3xCwhmWReOAcAfl9Zu6mkw0hZYnAbIP9lLANoE4iebK1hXa6-ogU4_1AURA';
const project = 'https://script.googleapis.com/v1/projects/' + scriptId;
const contentUrl = project + '/content';
const deploymentUrl = project + '/deployments/' + deploymentId;

function requireRepair(condition, code) {
  if (!condition) throw new Error('APPS_SCRIPT_FINGERPRINT_' + code);
}

function codeFile(files) {
  const matches = files.filter(file => file.name === 'Code' && file.type === 'SERVER_JS');
  requireRepair(matches.length === 1, 'CODE_FILE_INVALID');
  return matches[0];
}

function deploymentCommit(files) {
  return codeFile(files).source.match(/\bAPPS_SCRIPT_DEPLOYMENT_COMMIT_\s*=\s*['"]([^'"]+)['"]/)?.[1];
}

function withoutFingerprint(source) {
  return source.replace(/(\bAPPS_SCRIPT_DEPLOYMENT_COMMIT_\s*=\s*)['"][^'"]+['"]/, '$1"FINGERPRINT"');
}

export function prepareFingerprintRepair({ webFiles, localSource, expectedCommit }) {
  const original = codeFile(webFiles);
  const patch = patchAppsScriptFunctions({ remoteSource: original.source, localSource,
    functionNames: ['getAppsScriptDeploymentHealth_'] });
  const source = applyDeploymentFingerprint(patch.source, expectedCommit);
  requireRepair(withoutFingerprint(source) === withoutFingerprint(original.source), 'RUNTIME_CHANGED');
  const files = webFiles.map(file => file === original ? { ...file, source } : file);
  requireRepair(deploymentCommit(files) === expectedCommit, 'CANDIDATE_COMMIT_INVALID');
  return { files, digest: appsScriptFilesDigest(files), expectedCommit,
    protectedSourceDigest: patch.protectedSourceDigest };
}

export async function readFingerprintSnapshot(api) {
  const [deployment, head] = await Promise.all([api(deploymentUrl), api(contentUrl)]);
  const version = deployment.deploymentConfig?.versionNumber;
  requireRepair(deployment.deploymentId === deploymentId && Number.isSafeInteger(version), 'TARGET_INVALID');
  requireRepair(deployment.deploymentConfig?.scriptId === scriptId, 'SCRIPT_ID_INVALID');
  const web = await api(contentUrl + '?versionNumber=' + version);
  codeFile(head.files);
  codeFile(web.files);
  return { deployment, headFiles: head.files, webFiles: web.files,
    headDigest: appsScriptFilesDigest(head.files), webDigest: appsScriptFilesDigest(web.files) };
}

async function assertSnapshotCurrent(api, snapshot) {
  const [deployment, head] = await Promise.all([api(deploymentUrl), api(contentUrl)]);
  requireRepair(appsScriptFilesDigest(head.files) === snapshot.headDigest, 'HEAD_CHANGED');
  requireRepair(JSON.stringify(deployment) === JSON.stringify(snapshot.deployment), 'DEPLOYMENT_CHANGED');
}

async function assertFiles(api, url, digest) {
  const content = await api(url);
  requireRepair(appsScriptFilesDigest(content.files) === digest, 'SOURCE_READBACK_MISMATCH');
}

async function restoreOriginalHead(api, snapshot, candidate) {
  const current = await api(contentUrl);
  const digest = appsScriptFilesDigest(current.files);
  if (digest === snapshot.headDigest) return;
  requireRepair(digest === candidate.digest, 'CONCURRENT_HEAD_CHANGE_RETAINED');
  await api(contentUrl, 'PUT', { files: snapshot.headFiles });
  await assertFiles(api, contentUrl, snapshot.headDigest);
}

function deploymentConfig(snapshot, version) {
  return { ...snapshot.deployment.deploymentConfig, versionNumber: version };
}

async function assertPublishedDeployment(api, snapshot, version) {
  const deployed = await api(deploymentUrl);
  requireRepair(deployed.deploymentId === deploymentId, 'DEPLOYMENT_ID_CHANGED');
  requireRepair(deployed.deploymentConfig?.versionNumber === version, 'VERSION_NOT_PUBLISHED');
  requireRepair(JSON.stringify(deployed.entryPoints) === JSON.stringify(snapshot.deployment.entryPoints),
    'DEPLOYMENT_PERMISSIONS_CHANGED');
}

export async function publishFingerprintRepair({ api, snapshot, candidate }) {
  await assertSnapshotCurrent(api, snapshot);
  try {
    await api(contentUrl, 'PUT', { files: candidate.files });
    await assertFiles(api, contentUrl, candidate.digest);
    const created = await api(project + '/versions', 'POST', {
      description: 'Repair deployed commit fingerprint; application behavior unchanged'
    });
    const version = created.versionNumber;
    requireRepair(Number.isSafeInteger(version), 'CREATED_VERSION_INVALID');
    await assertFiles(api, contentUrl + '?versionNumber=' + version, candidate.digest);
    await api(deploymentUrl, 'PUT', { deploymentConfig: deploymentConfig(snapshot, version) });
    await assertPublishedDeployment(api, snapshot, version);
    return { version, previousVersion: snapshot.deployment.deploymentConfig.versionNumber,
      expectedCommit: candidate.expectedCommit, sourceDigest: candidate.digest };
  } finally {
    await restoreOriginalHead(api, snapshot, candidate);
  }
}

async function signedHealth(key) {
  const response = await fetch('https://script.google.com/macros/s/' + deploymentId + '/exec', {
    method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createSignedDeploymentHealthEnvelope(key))
  });
  const payload = await response.json();
  requireRepair(response.ok && payload.ok === true, 'SIGNED_HEALTH_FAILED');
  requireRepair(payload.lifecycleRecipientPolicyVersion === 'plant-request-lifecycle-v2'
    && Number(payload.requiredRecipientCount) === 5, 'HEALTH_POLICY_CHANGED');
  return { status: response.status, deployedCommit: payload.deployedCommit,
    policyVersion: payload.lifecycleRecipientPolicyVersion, requiredRecipientCount: payload.requiredRecipientCount };
}

async function verifySignedPublication(key, expectedCommit) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const health = await signedHealth(key);
    if (health.deployedCommit === expectedCommit) return health;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('APPS_SCRIPT_FINGERPRINT_WEB_READBACK_MISMATCH');
}

function saveEvidence(directory, name, data) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');
}

async function rollbackDeployment(api, snapshot, receipt) {
  await assertPublishedDeployment(api, snapshot, receipt.version);
  await api(deploymentUrl, 'PUT', { deploymentConfig: snapshot.deployment.deploymentConfig });
  await assertPublishedDeployment(api, snapshot, receipt.previousVersion);
  await assertFiles(api, contentUrl, snapshot.headDigest);
}

async function main() {
  requireRepair(process.argv.slice(2).join(' ') === '--apply', 'EXPLICIT_APPLY_REQUIRED');
  const key = process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY;
  requireRepair(Boolean(key), 'HEALTH_SIGNING_KEY_REQUIRED');
  const directory = 'G:/My Drive/GNC/AgData/Release Evidence/apps-script-fingerprint-repair-20261108';
  const api = await googleApiFromClasp();
  const snapshot = await readFingerprintSnapshot(api);
  const healthBefore = await signedHealth(key);
  requireRepair(healthBefore.deployedCommit === deploymentCommit(snapshot.webFiles), 'LIVE_SOURCE_MISMATCH');
  const candidate = prepareFingerprintRepair({ webFiles: snapshot.webFiles,
    localSource: fs.readFileSync('Code.gs', 'utf8'), expectedCommit: expectedAppsScriptCommit() });
  saveEvidence(directory, 'source-backup.json', { ...snapshot, observedAt: new Date().toISOString() });
  const receipt = await publishFingerprintRepair({ api, snapshot, candidate });
  try {
    receipt.health = await verifySignedPublication(key, candidate.expectedCommit);
  } catch (error) {
    await rollbackDeployment(api, snapshot, receipt);
    throw error;
  }
  receipt.headDigestRestored = snapshot.headDigest;
  receipt.healthBefore = healthBefore;
  receipt.verifiedAt = new Date().toISOString();
  saveEvidence(directory, 'receipt.json', receipt);
  process.stdout.write(JSON.stringify(receipt) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
