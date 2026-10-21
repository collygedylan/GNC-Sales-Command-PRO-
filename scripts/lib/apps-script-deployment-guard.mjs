import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { listGitHubApiItems } from '../github-api-pagination.mjs';
import { fetchGitHubJson } from './github-json-transport.mjs';
import { assertProductionReleaseContext } from './production-release-guard.mjs';

const SHA = /^[a-f0-9]{40}$/;
const VALIDATION_PATH = '.github/workflows/performance-monitor.yml';
const DEPLOYMENT_PATH = '.github/workflows/apps-script-deploy.yml';
const BACKEND_PATH = '.github/workflows/apps-script-sync.yml';
const COORDINATOR_PATH = '.github/workflows/pages-static.yml';
const BACKEND_DEPLOY_JOB = 'Apply backend migrations and deploy Edge Functions';
const fail = code => { throw Object.assign(new Error(`APPS_SCRIPT_DEPLOYMENT_${code}`), { code: `APPS_SCRIPT_DEPLOYMENT_${code}` }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const sameRepo = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

// Direct main publication uses the coordinator's authenticated fast gate.
// Merged-PR publication requires the current fast PR gate and its executed checks.
// It neither consumes nor authorizes a Pages publication artifact.
export async function authorizeAppsScriptDeployment({ repository, eventName, ref, commit,
  expectedCommit = '', workflowRef, backendRunId, backendRunAttempt, backendRunSha,
  coordinatorRunId, coordinatorRunAttempt, requireSupabase, scriptChanged: requestedScriptChange, api }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || typeof api !== 'function') fail('IDENTITY_INVALID');
  if (workflowRef !== `${repository}/${DEPLOYMENT_PATH}@refs/heads/main`) fail('WORKFLOW_NOT_TRUSTED');
  if (expectedCommit && (!SHA.test(expectedCommit) || expectedCommit !== commit)) fail('EXPECTED_COMMIT_MISMATCH');
  if (eventName === 'workflow_dispatch' && (!positive(coordinatorRunId) || !positive(coordinatorRunAttempt)
    || !positive(backendRunId) || !positive(backendRunAttempt) || backendRunSha !== commit)) fail('COORDINATOR_RUN_REQUIRED');
  if (eventName === 'workflow_dispatch' && ![true, false, 'true', 'false'].includes(requireSupabase)) {
    fail('COORDINATOR_SCOPE_INVALID');
  }
  if (eventName === 'workflow_dispatch' && requestedScriptChange !== true && requestedScriptChange !== 'true') {
    fail('SCRIPT_CHANGE_NOT_AUTHORIZED');
  }
  const root = `repos/${repository}`;
  if (eventName === 'workflow_run') {
    if (!positive(backendRunId) || !positive(backendRunAttempt) || backendRunSha !== commit) fail('BACKEND_RUN_INVALID');
  }
  const assertCurrentMain = async () => {
    const main = await api(`${root}/git/ref/heads/main`);
    assertProductionReleaseContext({ eventName: eventName === 'workflow_run' ? 'workflow_dispatch' : eventName,
      ref, commit, mainCommit: main?.object?.sha });
  };
  await assertCurrentMain();
  const associated = await api(`${root}/commits/${commit}/pulls?per_page=100`);
  if (!Array.isArray(associated) || associated.length >= 100) fail('PRS_INCOMPLETE');
  const matches = associated.filter(pr => pr.merge_commit_sha === commit && pr.merged_at
    && pr.base?.ref === 'main' && sameRepo(pr.base?.repo?.full_name, repository)
    && sameRepo(pr.head?.repo?.full_name, repository));
  if (positive(coordinatorRunId) && eventName === 'workflow_dispatch') {
    const coordinator = await api(`${root}/actions/workflows/pages-static.yml`);
    if (!positive(coordinator?.id) || coordinator.path !== COORDINATOR_PATH || coordinator.state !== 'active') {
      fail('COORDINATOR_WORKFLOW_INVALID');
    }
    if (!positive(coordinatorRunAttempt)) fail('COORDINATOR_RUN_INVALID');
    const releaseRun = await api(`${root}/actions/runs/${coordinatorRunId}`);
    if (!releaseRun || releaseRun.id !== coordinatorRunId || releaseRun.workflow_id !== coordinator.id
      || releaseRun.path !== COORDINATOR_PATH || !['push', 'workflow_dispatch'].includes(releaseRun.event)
      || releaseRun.head_branch !== 'main' || releaseRun.head_sha !== commit
      || !sameRepo(releaseRun.head_repository?.full_name, repository)
      || releaseRun.run_attempt !== coordinatorRunAttempt
      || !['in_progress', 'completed'].includes(releaseRun.status)) fail('COORDINATOR_RUN_INVALID');
    if (releaseRun.status === 'completed' && releaseRun.conclusion !== 'success') fail('COORDINATOR_RUN_FAILED');
    const coordinatorJobs = await listGitHubApiItems({ api,
      endpoint: `${root}/actions/runs/${releaseRun.id}/attempts/${releaseRun.run_attempt}/jobs`, field: 'jobs' });
    const byName = name => coordinatorJobs.filter(job => job.name === name && job.run_id === releaseRun.id
      && job.head_sha === commit
      && job.status === 'completed' && job.conclusion === 'success');
    if (byName('fast-gate').length !== 1) fail('COORDINATOR_VALIDATION_NOT_GREEN');
    const backendPublication = coordinatorJobs.filter(job => job.run_id === releaseRun.id && job.name === 'backend-publication'
      && job.head_sha === commit && (job.status === 'in_progress'
        || (job.status === 'completed' && job.conclusion === 'success')));
    if (backendPublication.length !== 1) fail('COORDINATOR_BACKEND_NOT_ACTIVE');
    const backendWorkflow = await api(`${root}/actions/workflows/apps-script-sync.yml`);
    if (!positive(backendWorkflow?.id) || backendWorkflow.path !== BACKEND_PATH) fail('BACKEND_WORKFLOW_INVALID');
    if (!positive(backendRunId) || !positive(backendRunAttempt) || backendRunSha !== commit) fail('BACKEND_RUN_INVALID');
    const backendRun = await api(`${root}/actions/runs/${backendRunId}`);
    if (!backendRun || backendRun.id !== backendRunId || backendRun.workflow_id !== backendWorkflow.id || backendRun.path !== BACKEND_PATH
      || backendRun.event !== 'workflow_dispatch' || backendRun.head_branch !== 'main' || backendRun.head_sha !== commit
      || backendRun.status !== 'completed' || backendRun.conclusion !== 'success'
      || backendRun.run_attempt !== backendRunAttempt
      || !sameRepo(backendRun.head_repository?.full_name, repository)) fail('BACKEND_RUN_NOT_TRUSTED');
    const backendJobs = await listGitHubApiItems({ api,
      endpoint: `${root}/actions/runs/${backendRun.id}/attempts/${backendRun.run_attempt}/jobs`, field: 'jobs' });
    const deploy = backendJobs.filter(job => job.run_id === backendRun.id && job.name === BACKEND_DEPLOY_JOB
      && job.head_sha === commit && job.status === 'completed'
      && (requireSupabase === true || requireSupabase === 'true'
        ? job.conclusion === 'success' : ['success', 'skipped'].includes(job.conclusion)));
    if (deploy.length !== 1) fail('BACKEND_DEPLOY_NOT_SUCCESSFUL');
    if (requestedScriptChange !== true && requestedScriptChange !== 'true') fail('SCRIPT_CHANGE_NOT_AUTHORIZED');
    await assertCurrentMain();
    const latest = await api(`${root}/actions/runs/${coordinatorRunId}`);
    if (latest?.id !== releaseRun.id || latest?.workflow_id !== coordinator.id || latest?.path !== COORDINATOR_PATH
      || latest?.run_attempt !== coordinatorRunAttempt || latest?.head_sha !== commit
      || !sameRepo(latest?.head_repository?.full_name, repository)) fail('COORDINATOR_RUN_CHANGED');
    await assertCurrentMain();
    return { commit, pullRequest: matches[0]?.number || null, runId: releaseRun.id, attempt: releaseRun.run_attempt,
      scriptChanged: requestedScriptChange === true || requestedScriptChange === 'true' };
  }
  if (matches.length !== 1 || !positive(matches[0].number)) fail('NO_UNIQUE_MERGED_PR');
  const number = matches[0].number;
  const readPr = () => api(`${root}/pulls/${number}`);
  const pr = await readPr();
  const validPr = candidate => candidate?.number === number && candidate.merged && !candidate.draft
    && candidate.merge_commit_sha === commit && SHA.test(candidate.head?.sha || '')
    && candidate.base?.ref === 'main' && sameRepo(candidate.base?.repo?.full_name, repository)
    && sameRepo(candidate.head?.repo?.full_name, repository);
  if (!validPr(pr)) fail('PR_IDENTITY_CHANGED');
  const workflow = await api(`${root}/actions/workflows/performance-monitor.yml`);
  if (!positive(workflow?.id) || workflow.path !== VALIDATION_PATH || workflow.state !== 'active') fail('VALIDATION_WORKFLOW_INVALID');
  const latestRun = async () => {
    const runs = await listGitHubApiItems({ api,
      endpoint: `${root}/actions/workflows/${workflow.id}/runs?head_sha=${pr.head.sha}&event=pull_request`, field: 'workflow_runs' });
    if (!runs.length || new Set(runs.map(run => run.run_number)).size !== runs.length) fail('VALIDATION_RUNS_INVALID');
    for (const run of runs) {
      if (!positive(run.run_number) || !positive(run.run_attempt) || run.workflow_id !== workflow.id
        || run.path !== VALIDATION_PATH || run.event !== 'pull_request' || run.head_sha !== pr.head.sha
        || !sameRepo(run.head_repository?.full_name, repository)) fail('VALIDATION_RUN_IDENTITY_INVALID');
    }
    const latest = [...runs].sort((a, b) => b.run_number - a.run_number)[0];
    if (latest.status !== 'completed' || latest.conclusion !== 'success') fail('LATEST_VALIDATION_NOT_GREEN');
    return latest;
  };
  const run = await latestRun();
  const jobs = await listGitHubApiItems({ api, endpoint: `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, field: 'jobs' });
  if (jobs.some(job => job.run_id !== run.id || job.head_sha !== pr.head.sha || job.status !== 'completed'
    || !['success', 'skipped'].includes(job.conclusion))) fail('VALIDATION_JOB_INVALID');
  const gates = jobs.filter(job => job.name === 'validation / fast-pr');
  if (gates.length !== 1 || gates[0].conclusion !== 'success') fail('UNIT_LINT_GATE_MISSING');
  for (const name of ['Validate inline application scripts', 'Run focused release tooling contracts']) {
    if (!gates[0].steps?.some(step => step.name === name
      && step.status === 'completed' && step.conclusion === 'success')) fail('UNIT_LINT_GATE_NOT_ATTESTED');
  }
  const latest = await latestRun();
  if (latest.id !== run.id || latest.run_attempt !== run.run_attempt) fail('VALIDATION_SUPERSEDED');
  const finalPr = await readPr();
  if (!validPr(finalPr) || finalPr.head.sha !== pr.head.sha) fail('PR_IDENTITY_CHANGED');
  if (!Number.isSafeInteger(finalPr.changed_files) || finalPr.changed_files < 1 || finalPr.changed_files >= 3000) fail('CHANGED_PATHS_INCOMPLETE');
  const files = [];
  for (let page = 1; files.length < finalPr.changed_files; page++) {
    const rows = await api(`${root}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(rows) || !rows.length || rows.length > 100
      || rows.some(file => typeof file.filename !== 'string' || !file.filename
        || (file.status === 'renamed' && !file.previous_filename))) fail('CHANGED_PATHS_INCOMPLETE');
    files.push(...rows);
  }
  if (files.length !== finalPr.changed_files || new Set(files.map(file => file.filename)).size !== files.length) fail('CHANGED_PATHS_INCOMPLETE');
  const scriptPath = name => ['Code.gs', DEPLOYMENT_PATH, 'scripts/sync-codegs-to-apps-script.js',
    'scripts/apply-item-low-stock-migration.mjs', BACKEND_PATH,
    'scripts/apps-script-sync-lib.mjs', 'scripts/apps-script-recovery-evidence.mjs',
    'scripts/lib/apps-script-deployment-guard.mjs', 'scripts/lib/production-release-guard.mjs',
    'scripts/github-api-pagination.mjs', 'scripts/lib/github-json-transport.mjs',
    'scripts/release-proof.mjs', 'scripts/pages-release.mjs'].includes(name);
  const underBackendRoot = name => typeof name === 'string'
    && (name.startsWith('supabase/') || name.startsWith('database/'));
  const changedPath = file => [file.filename, file.previous_filename].filter(Boolean);
  const backendChanged = files.some(file => changedPath(file).some(underBackendRoot));
  const scriptChanged = eventName === 'workflow_dispatch'
    || files.some(file => changedPath(file).some(scriptPath));

  const backendWorkflow = await api(`${root}/actions/workflows/apps-script-sync.yml`);
  if (!positive(backendWorkflow?.id) || backendWorkflow.path !== BACKEND_PATH || backendWorkflow.state !== 'active') {
    fail('BACKEND_WORKFLOW_INVALID');
  }
  const loadBackendRunJobs = async run => {
    const jobs = await listGitHubApiItems({ api,
      endpoint: `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, field: 'jobs' });
    if (jobs.some(job => job.run_id !== run.id || job.head_sha !== commit || job.status !== 'completed'
      || !['success', 'skipped'].includes(job.conclusion))) fail('BACKEND_JOB_INVALID');
    const deployJobs = jobs.filter(job => job.name === BACKEND_DEPLOY_JOB);
    if (deployJobs.length !== 1) fail('BACKEND_DEPLOY_JOB_MISSING');
    return deployJobs[0];
  };
  const assertBackendRun = async (run, { expectedId, expectedAttempt } = {}) => {
    if (!run || run.workflow_id !== backendWorkflow.id || run.path !== BACKEND_PATH
      || run.event !== 'workflow_dispatch' || run.head_branch !== 'main' || run.head_sha !== commit
      || !sameRepo(run.head_repository?.full_name, repository) || run.status !== 'completed'
      || run.conclusion !== 'success' || (expectedId !== undefined && run.id !== expectedId)
      || (expectedAttempt !== undefined && run.run_attempt !== expectedAttempt)) fail('BACKEND_RUN_NOT_TRUSTED');
    const deployJob = await loadBackendRunJobs(run);
    if (backendChanged && deployJob.conclusion !== 'success') fail('BACKEND_DEPLOY_NOT_SUCCESSFUL');
    if (!backendChanged && !['success', 'skipped'].includes(deployJob.conclusion)) fail('BACKEND_DEPLOY_JOB_INVALID');
  };
  if (eventName === 'workflow_run') {
    const backendRun = await api(`${root}/actions/runs/${backendRunId}`);
    await assertBackendRun(backendRun, { expectedId: backendRunId, expectedAttempt: backendRunAttempt });
  } else if (backendChanged) {
    const runs = await listGitHubApiItems({ api,
      endpoint: `${root}/actions/workflows/${backendWorkflow.id}/runs?head_sha=${commit}&event=workflow_dispatch`, field: 'workflow_runs' });
    if (!runs.length || new Set(runs.map(run => run.run_number)).size !== runs.length) fail('BACKEND_RUNS_INVALID');
    for (const run of runs) {
      if (!positive(run.run_number) || !positive(run.run_attempt) || run.workflow_id !== backendWorkflow.id
        || run.path !== BACKEND_PATH || run.event !== 'workflow_dispatch' || run.head_sha !== commit
        || run.head_branch !== 'main' || !sameRepo(run.head_repository?.full_name, repository)) fail('BACKEND_RUN_IDENTITY_INVALID');
    }
    const latestRun = [...runs].sort((a, b) => b.run_number - a.run_number)[0];
    await assertBackendRun(latestRun);
  }
  await assertCurrentMain();
  return { commit, pullRequest: number, runId: run.id, attempt: run.run_attempt, scriptChanged };
}

async function githubApi(endpoint) {
  return fetchGitHubJson({ endpoint, token: String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim() });
}

export async function authorizeProductionAppsScriptDeploymentFromEnvironment({ env = process.env, api = githubApi } = {}) {
  return authorizeAppsScriptDeployment({ repository: env.GITHUB_REPOSITORY, eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF, commit: env.GITHUB_SHA, workflowRef: env.GITHUB_WORKFLOW_REF,
    expectedCommit: env.EXPECTED_COMMIT || '', backendRunId: Number(env.APPS_SCRIPT_BACKEND_RUN_ID),
    backendRunAttempt: Number(env.APPS_SCRIPT_BACKEND_RUN_ATTEMPT), backendRunSha: env.APPS_SCRIPT_BACKEND_RUN_SHA,
    coordinatorRunId: Number(env.APPS_SCRIPT_COORDINATOR_RUN_ID),
    coordinatorRunAttempt: Number(env.APPS_SCRIPT_COORDINATOR_RUN_ATTEMPT),
    requireSupabase: env.APPS_SCRIPT_SUPABASE_REQUIRED,
    scriptChanged: env.APPS_SCRIPT_SCRIPT_CHANGED, api });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  authorizeProductionAppsScriptDeploymentFromEnvironment().then(result => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `authorized=true\ncommit=${result.commit}\nscript-changed=${result.scriptChanged}\n`);
    console.log(result.pullRequest
      ? `Authorized Apps Script commit ${result.commit} from PR #${result.pullRequest}, validation ${result.runId}/${result.attempt}.`
      : `Authorized Apps Script commit ${result.commit} through coordinator ${result.runId}/${result.attempt}.`);
  }).catch(error => { console.error(error.code || 'APPS_SCRIPT_DEPLOYMENT_AUTHORIZATION_FAILED'); process.exitCode = 1; });
}
