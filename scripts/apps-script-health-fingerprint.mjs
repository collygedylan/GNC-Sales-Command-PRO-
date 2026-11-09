import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { APPS_SCRIPT_RELEASE_SOURCE_PATHS, sameAppsScriptSourceBlobs } from '../src/services/apps-script-release-source.mjs';

export function expectedAppsScriptCommit(cwd = process.cwd()) {
  const sha = execFileSync('git', ['log', '-1', '--first-parent', '--format=%H', '--', ...APPS_SCRIPT_RELEASE_SOURCE_PATHS],
    { cwd, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('APPS_SCRIPT_SOURCE_COMMIT_MISSING');
  return sha;
}
export function matchesAppsScriptFingerprint(payload,expected) {
  return /^[a-f0-9]{40}$/.test(String(expected||'')) && String(payload?.deployedCommit||'').toLowerCase()===expected.toLowerCase();
}

function readAppsScriptGitBlobs(sha) {
  const entries = execFileSync('git', ['ls-tree', '-r', '--full-tree', sha, '--', ...APPS_SCRIPT_RELEASE_SOURCE_PATHS],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim();
  const byPath = new Map();
  for (const entry of entries.split('\n').filter(Boolean)) {
    const blob = /^100(?:644|755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!blob) throw new Error('APPS_SCRIPT_SOURCE_BLOB_INVALID');
    byPath.set(blob[2], blob[1]);
  }
  return APPS_SCRIPT_RELEASE_SOURCE_PATHS.map(path => byPath.get(path) ?? null);
}

export function matchesAppsScriptSourceFingerprint(payload, expected, readBlobs = readAppsScriptGitBlobs) {
  if (matchesAppsScriptFingerprint(payload, expected)) return true;
  const deployed = String(payload?.deployedCommit || '');
  if (!/^[a-f0-9]{40}$/i.test(deployed) || !/^[a-f0-9]{40}$/i.test(String(expected || ''))) return false;
  try {
    return sameAppsScriptSourceBlobs(readBlobs(expected), readBlobs(deployed));
  } catch {
    return false;
  }
}

export function appsScriptFilesDigest(files) {
  return createHash('sha256').update(JSON.stringify(files.map(file => ({ name: file.name, type: file.type, source: file.source }))
    .sort((a, b) => a.name.localeCompare(b.name)))).digest('hex');
}

// Verified head-only publication, Actions run 41541717686. The /exec endpoint
// and time-driven triggers execute different sources at the version limit.
const verifiedPublication = Object.freeze({
  head: 'a3c49fae64db2184503bdf8c99e6f5e47172a2f6',
  filesDigest: '997cf482ef8c04c751f5a095b076605bc9a3086f891c1ce0737a7defd71e7f0a',
  version: 376,
  web: 'd5d7fb8dcffd4e4d585ca0fd6b51028c45c56bd2'
});

export async function verifyHeadOnlyAppsScript(payload, expectedHead, scriptId, deploymentId, api) {
  if (!matchesAppsScriptFingerprint(payload, verifiedPublication.web)
      || expectedHead !== verifiedPublication.head || !scriptId || !deploymentId) return false;
  const project = 'https://script.googleapis.com/v1/projects/' + encodeURIComponent(scriptId);
  const [deployment, head] = await Promise.all([
    // Extra deployment metadata can fail with HTTP 503. Read every identity field used below.
    api(project + '/deployments/' + encodeURIComponent(deploymentId)
      + '?fields=deploymentId,deploymentConfig(scriptId,versionNumber)'),
    api(project + '/content')
  ]);
  return deployment.deploymentId === deploymentId && deployment.deploymentConfig?.scriptId === scriptId
      && deployment.deploymentConfig.versionNumber === verifiedPublication.version
      && Array.isArray(head.files) && appsScriptFilesDigest(head.files) === verifiedPublication.filesDigest;
}
