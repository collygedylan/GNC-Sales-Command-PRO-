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
const BACKEND_DEPLOY_JOB = 'Apply backend migrations and deploy Edge Functions';
const fail = code => { throw Object.assign(new Error(`APPS_SCRIPT_DEPLOYMENT_${code}`), { code: `APPS_SCRIPT_DEPLOYMENT_${code}` }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const sameRepo = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

// Backend source publication uses the merged PR's standard unit/lint gate.
// It neither consumes nor authorizes a Pages publication artifact.
export async function authorizeAppsScriptDeployment({ repository, eventName, ref, commit,
  expectedCommit = '', workflowRef, backendRunId, backendRunAttempt, backendRunSha, api }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || typeof api !== 'function') fail('IDENTITY_INVALID');
  if (workflowRef !== `${repository}/${DEPLOYMENT_PATH}@refs/heads/main`) fail('WORKFLOW_NOT_TRUSTED');
  if (expectedCommit && (!SHA.test(expectedCommit) || expectedCommit !== commit)) fail('EXPECTED_COMMIT_MISMATCH');
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
  const required = ['validation / lint', 'validation / pr-gate', ...[1, 2, 3, 4].map(shard => `validation / unit (${shard})`)];
  for (const name of required) {
    const matching = jobs.filter(job => job.name === name);
    if (matching.length !== 1 || matching[0].conclusion !== 'success') fail('UNIT_LINT_GATE_MISSING');
  }
  const gate = jobs.find(job => job.name === 'validation / pr-gate');
  if (!gate.steps?.some(step => step.name === 'Require the selected unit and lint checks'
    && step.status === 'completed' && step.conclusion === 'success')) fail('UNIT_LINT_GATE_NOT_ATTESTED');
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
    backendRunAttempt: Number(env.APPS_SCRIPT_BACKEND_RUN_ATTEMPT), backendRunSha: env.APPS_SCRIPT_BACKEND_RUN_SHA, api });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  authorizeProductionAppsScriptDeploymentFromEnvironment().then(result => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `authorized=true\ncommit=${result.commit}\nscript-changed=${result.scriptChanged}\n`);
    console.log(`Authorized Apps Script commit ${result.commit} from PR #${result.pullRequest}, validation ${result.runId}/${result.attempt}.`);
  }).catch(error => { console.error(error.code || 'APPS_SCRIPT_DEPLOYMENT_AUTHORIZATION_FAILED'); process.exitCode = 1; });
}
