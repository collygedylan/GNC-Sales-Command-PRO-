import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { selectReleaseProof } from '../release-proof.mjs';

const COMPLETE_SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

export class ProductionReleaseGuardError extends Error {
  constructor(code) {
    super(`PRODUCTION_RELEASE_GUARD_${code}`);
    this.name = 'ProductionReleaseGuardError';
    this.code = code;
  }
}

function guardError(code) {
  return new ProductionReleaseGuardError(code);
}

export function assertProductionReleaseContext({ eventName, ref, commit, mainCommit }) {
  if (eventName !== 'push' && eventName !== 'workflow_dispatch') {
    throw guardError('EVENT_NOT_ELIGIBLE');
  }
  if (ref !== 'refs/heads/main') throw guardError('REF_NOT_MAIN');
  if (!COMPLETE_SHA.test(commit || '') || !COMPLETE_SHA.test(mainCommit || '')) {
    throw guardError('COMMIT_INVALID');
  }
  if (commit !== mainCommit) throw guardError('COMMIT_NOT_CURRENT_MAIN');
  return commit;
}

export function assertProductionAppsScriptTarget({
  scriptId,
  deploymentId,
  expectedScriptId,
  expectedDeploymentId
}) {
  const actualScript = String(scriptId || '').trim();
  const actualDeployment = String(deploymentId || '').trim();
  const expectedScript = String(expectedScriptId || '').trim();
  const expectedDeployment = String(expectedDeploymentId || '').trim();

  if (!expectedDeployment) throw guardError('EXPECTED_DEPLOYMENT_ID_MISSING');
  if (!actualScript) throw guardError('SCRIPT_ID_MISSING');
  if (!actualDeployment) throw guardError('DEPLOYMENT_ID_MISSING');
  if (expectedScript && actualScript !== expectedScript) throw guardError('SCRIPT_ID_MISMATCH');
  if (actualDeployment !== expectedDeployment) throw guardError('DEPLOYMENT_ID_MISMATCH');
  return { scriptId: actualScript, deploymentId: actualDeployment };
}

export async function verifyAppsScriptDeploymentOwnership({ script, scriptId, deploymentId }) {
  if (!script?.projects?.deployments || typeof script.projects.deployments.get !== 'function') {
    throw guardError('DEPLOYMENT_CLIENT_INVALID');
  }
  let deployment;
  try {
    deployment = await script.projects.deployments.get({ scriptId, deploymentId });
  } catch {
    throw guardError('DEPLOYMENT_OWNERSHIP_UNVERIFIED');
  }
  if (String(deployment?.data?.deploymentId || '').trim() !== deploymentId
      || !deployment?.data?.deploymentConfig) {
    throw guardError('DEPLOYMENT_OWNERSHIP_UNVERIFIED');
  }
  return deployment.data;
}

export async function authorizeProductionRelease({
  repository,
  eventName,
  ref,
  commit,
  api
}) {
  if (!REPOSITORY.test(repository || '') || typeof api !== 'function') {
    throw guardError('IDENTITY_INVALID');
  }
  const mainRef = await api(`repos/${repository}/git/ref/heads/main`);
  const mainCommit = String(mainRef?.object?.sha || '').trim();
  assertProductionReleaseContext({ eventName, ref, commit, mainCommit });
  const proof = await selectReleaseProof({ repository, commit, api });
  return { commit, proof };
}

async function githubApi(endpoint) {
  const token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (!token) throw guardError('GITHUB_TOKEN_MISSING');
  const response = await fetch(`https://api.github.com/${endpoint}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28'
    }
  });
  if (!response.ok) throw guardError(`GITHUB_API_HTTP_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw guardError('GITHUB_API_RESPONSE_INVALID');
  }
}

export async function authorizeProductionReleaseFromEnvironment({
  env = process.env,
  api = githubApi
} = {}) {
  return authorizeProductionRelease({
    repository: String(env.GITHUB_REPOSITORY || '').trim(),
    eventName: String(env.GITHUB_EVENT_NAME || '').trim(),
    ref: String(env.GITHUB_REF || '').trim(),
    commit: String(env.GITHUB_SHA || '').trim(),
    api
  });
}

async function main() {
  const result = await authorizeProductionReleaseFromEnvironment();
  const output = String(process.env.GITHUB_OUTPUT || '').trim();
  if (output) appendFileSync(output, `authorized=true\ncommit=${result.commit}\n`);
  console.log(`Authorized exact current-main release ${result.commit} with candidate proof run ${result.proof.runId} attempt ${result.proof.attempt}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message || 'PRODUCTION_RELEASE_GUARD_FAILED');
    process.exitCode = 1;
  });
}
