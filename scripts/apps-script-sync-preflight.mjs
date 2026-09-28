import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { waitForCompatibleAppsScript } from './check-compatible-apps-script.mjs';
import { assertProductionAppsScriptTarget } from './lib/production-release-guard.mjs';

const FAIL = code => { throw new Error(`APPS_SCRIPT_SYNC_PREFLIGHT_${code}`); };
const mismatchOrUnavailable = new Set([
  'CODE_MISMATCH',
  'HEALTH_UNAVAILABLE',
  'COMPATIBLE_APPS_SCRIPT_CODE_MISMATCH',
  'COMPATIBLE_APPS_SCRIPT_HEALTH_UNAVAILABLE'
]);

export async function getAppsScriptSyncPreflight({
  repository,
  candidateCommit,
  scriptId,
  deploymentId,
  expectedScriptId,
  expectedDeploymentId,
  token,
  fetchImpl = globalThis.fetch
}) {
  const target = assertProductionAppsScriptTarget({
    scriptId, deploymentId, expectedScriptId, expectedDeploymentId
  });
  try {
    const result = await waitForCompatibleAppsScript({
      repository,
      candidateCommit,
      deploymentId: target.deploymentId,
      token,
      fetchImpl,
      attempts: 1,
      retryDelayMs: 0,
      timeoutMs: 12000,
      requestTimeoutMs: 12000
    });
    if (result?.compatible === true) return { syncRequired: false };
    FAIL('RESULT_INVALID');
  } catch (error) {
    const code = String(error?.code || error?.message || '').trim();
    if (mismatchOrUnavailable.has(code)) return { syncRequired: true };
    throw error;
  }
}

async function main() {
  const env = process.env;
  if (!env.GITHUB_OUTPUT) FAIL('OUTPUT_MISSING');
  const result = await getAppsScriptSyncPreflight({
    repository: String(env.GITHUB_REPOSITORY || '').trim(),
    candidateCommit: String(env.GITHUB_SHA || '').trim(),
    scriptId: env.APPS_SCRIPT_SCRIPT_ID,
    deploymentId: env.APPS_SCRIPT_DEPLOYMENT_ID,
    expectedScriptId: env.APPS_SCRIPT_PRODUCTION_SCRIPT_ID,
    expectedDeploymentId: env.APPS_SCRIPT_PRODUCTION_DEPLOYMENT_ID,
    token: String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim()
  });
  appendFileSync(env.GITHUB_OUTPUT, `sync-required=${result.syncRequired}\n`);
  if (result.syncRequired) {
    console.log('Apps Script backend is not proven compatible; a guarded sync is required.');
  } else {
    console.log('Apps Script backend already matches current Code.gs; skipping version creation.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const code = String(error?.code || error?.message || '').trim();
    console.error(/^[A-Z0-9_]+$/.test(code) ? code : 'APPS_SCRIPT_SYNC_PREFLIGHT_FAILED');
    process.exitCode = 1;
  });
}
