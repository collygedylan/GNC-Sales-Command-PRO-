import { pathToFileURL } from 'node:url';
import path from 'node:path';

const COMPLETE_SHA = /^[a-f0-9]{40}$/;
const BLOB_SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

export class CompatibleAppsScriptError extends Error {
  constructor(code) {
    super(`COMPATIBLE_APPS_SCRIPT_${code}`);
    this.name = 'CompatibleAppsScriptError';
    this.code = code;
  }
}

function compatibilityError(code) {
  return new CompatibleAppsScriptError(code);
}

async function responseJson(response, code) {
  if (!response?.ok) throw compatibilityError(`${code}_HTTP_${Number(response?.status) || 0}`);
  try { return await response.json(); } catch { throw compatibilityError(`${code}_INVALID`); }
}

async function githubCodeBlob({ repository, commit, token, fetchImpl, requestTimeoutMs }) {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/contents/Code.gs?ref=${commit}`, {
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28'
    }
  });
  const payload = await responseJson(response, 'GITHUB_CONTENTS');
  if (payload?.type !== 'file' || !BLOB_SHA.test(String(payload?.sha || ''))) {
    throw compatibilityError('GITHUB_BLOB_INVALID');
  }
  return payload.sha;
}

async function deployedCommit({ deploymentId, fetchImpl, requestTimeoutMs }) {
  const response = await fetchImpl(`https://script.google.com/macros/s/${encodeURIComponent(deploymentId)}/exec`, {
    method: 'POST',
    signal: AbortSignal.timeout(requestTimeoutMs),
    redirect: 'follow',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'deployment_health' })
  });
  const payload = await responseJson(response, 'HEALTH');
  const commit = String(payload?.deployedCommit || '').trim();
  if (payload?.ok !== true || !COMPLETE_SHA.test(commit)) throw compatibilityError('HEALTH_INVALID');
  return commit;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function waitForCompatibleAppsScript({
  repository,
  candidateCommit,
  deploymentId,
  token,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  attempts = 49,
  retryDelayMs = 5000,
  timeoutMs = 240000,
  requestTimeoutMs = 12000,
  now = () => Date.now()
}) {
  if (!REPOSITORY.test(String(repository || '')) || !COMPLETE_SHA.test(String(candidateCommit || ''))
      || !String(deploymentId || '').trim() || !String(token || '').trim()
      || typeof fetchImpl !== 'function' || typeof sleep !== 'function'
      || !Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) < 1
      || !Number.isFinite(Number(requestTimeoutMs)) || Number(requestTimeoutMs) < 1) {
    throw compatibilityError('CONFIGURATION_INVALID');
  }
  const deadline = now() + Number(timeoutMs);
  const remainingRequestTime = () => Math.max(1, Math.min(Number(requestTimeoutMs), deadline - now()));
  const candidateBlob = await githubCodeBlob({ repository, commit: candidateCommit, token, fetchImpl,
    requestTimeoutMs: remainingRequestTime() });
  const totalAttempts = Math.max(1, Math.min(120, Number(attempts) || 1));
  let lastCommit = '';
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    if (now() >= deadline) break;
    try {
      lastCommit = await deployedCommit({ deploymentId, fetchImpl, requestTimeoutMs: remainingRequestTime() });
      const liveBlob = await githubCodeBlob({ repository, commit: lastCommit, token, fetchImpl,
        requestTimeoutMs: remainingRequestTime() });
      if (liveBlob === candidateBlob) {
        return { compatible: true, candidateCommit, appsScriptCommit: lastCommit, codeBlobSha: candidateBlob };
      }
    } catch (error) {
      if (error?.code === 'CONFIGURATION_INVALID') throw error;
    }
    if (attempt < totalAttempts && now() < deadline) await sleep(Math.min(Math.max(0, Number(retryDelayMs) || 0), deadline - now()));
  }
  throw compatibilityError(lastCommit ? 'CODE_MISMATCH' : 'HEALTH_UNAVAILABLE');
}

async function main() {
  const result = await waitForCompatibleAppsScript({
    repository: String(process.env.GITHUB_REPOSITORY || '').trim(),
    candidateCommit: String(process.env.GITHUB_SHA || '').trim(),
    deploymentId: String(process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim(),
    token: String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim(),
    attempts: Number(process.env.APPS_SCRIPT_COMPATIBILITY_ATTEMPTS || 49),
    retryDelayMs: Number(process.env.APPS_SCRIPT_COMPATIBILITY_INTERVAL_MS || 5000),
    timeoutMs: Number(process.env.APPS_SCRIPT_COMPATIBILITY_TIMEOUT_MS || 240000)
  });
  console.log(`Compatible Apps Script source verified at commit ${result.appsScriptCommit.slice(0, 7)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error?.message || 'COMPATIBLE_APPS_SCRIPT_FAILED'); process.exitCode = 1; });
}
