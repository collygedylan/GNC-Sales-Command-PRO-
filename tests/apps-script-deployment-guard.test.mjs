// @test-group: node-unit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { authorizeAppsScriptDeployment } from '../scripts/lib/apps-script-deployment-guard.mjs';

const repository = 'example/app';
const commit = 'a'.repeat(40), head = 'b'.repeat(40);
const backendPath = '.github/workflows/apps-script-sync.yml';
const options = { repository, eventName: 'workflow_run', ref: 'refs/heads/main', commit,
  expectedCommit: commit, workflowRef: `${repository}/.github/workflows/apps-script-deploy.yml@refs/heads/main`,
  backendRunId: 88, backendRunAttempt: 1, backendRunSha: commit };
function harness(change = {}) {
  const calls = [];
  const pr = { number: 391, merged: true, merged_at: '2026-10-13T12:00:00Z', draft: false,
    merge_commit_sha: commit, changed_files: 1, base: { ref: 'main', repo: { full_name: repository } },
    head: { sha: head, repo: { full_name: repository } }, ...change.pr };
  const run = { id: 100, workflow_id: 9, run_number: 12, run_attempt: 1,
    path: '.github/workflows/performance-monitor.yml', event: 'pull_request', head_sha: head,
    head_repository: { full_name: repository }, status: 'completed', conclusion: 'success', ...change.run };
  let jobs = [{ id: 200, run_id: run.id, head_sha: head, name: 'validation / fast-pr',
    status: 'completed', conclusion: 'success',
    steps: ['Validate inline application scripts', 'Run focused release tooling contracts']
      .map(name => ({ name, status: 'completed', conclusion: 'success' }))
  }];
  if (change.jobs) jobs = change.jobs(jobs);
  const backendWorkflow = { id: 10, path: backendPath, state: 'active', ...change.backendWorkflow };
  const backendRun = { id: 88, workflow_id: backendWorkflow.id, run_number: 14, run_attempt: 1,
    path: backendPath, event: 'workflow_dispatch', head_branch: 'main', head_sha: commit,
    head_repository: { full_name: repository }, status: 'completed', conclusion: 'success', ...change.backendRun };
  const backendJobs = [{ id: 310, run_id: backendRun.id, head_sha: commit,
    name: 'Apply backend migrations and deploy Edge Functions', status: 'completed', conclusion: 'success',
    ...change.backendDeployJob }];
  let mainReads = 0, runReads = 0, prReads = 0;
  const api = async endpoint => {
    calls.push(endpoint);
    if (endpoint.endsWith('/git/ref/heads/main')) {
      mainReads++;
      return { object: { sha: change.advanceMain && mainReads > 1 ? 'c'.repeat(40) : commit } };
    }
    if (endpoint.endsWith('/actions/workflows/apps-script-sync.yml')) return backendWorkflow;
    if (endpoint.endsWith('/actions/runs/88')) return backendRun;
    const backendJobRun = endpoint.match(/\/actions\/runs\/(\d+)\/attempts\//);
    const backendRunIds = new Set([backendRun.id, ...(change.backendRuns || []).map(candidate => candidate.id)]);
    if (backendJobRun && backendRunIds.has(Number(backendJobRun[1]))) {
      const runId = Number(backendJobRun[1]);
      const rows = backendJobs.map(job => ({ ...job, run_id: runId }));
      return { total_count: rows.length, jobs: rows };
    }
    if (endpoint.includes(`/actions/workflows/${backendWorkflow.id}/runs?`)) {
      const runs = change.backendRuns || [];
      return { total_count: runs.length, workflow_runs: runs };
    }
    if (endpoint.includes('/commits/')) return [pr];
    if (endpoint.includes('/files?')) return change.files || [{ filename: 'Code.gs', status: 'modified' }];
    if (endpoint.endsWith('/pulls/391')) {
      prReads++;
      return change.changePr && prReads > 1 ? { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } } : pr;
    }
    if (endpoint.endsWith('/actions/workflows/performance-monitor.yml')) return { id: 9, path: run.path, state: 'active', ...change.workflow };
    if (endpoint.includes('/runs?')) {
      runReads++;
      const runs = change.runs || [change.rerun && runReads > 1 ? { ...run, run_attempt: 2 } : run];
      return { total_count: runs.length, workflow_runs: runs };
    }
    if (endpoint.includes('/jobs?')) return { total_count: jobs.length, jobs };
    throw new Error(`Unexpected API path ${endpoint}`);
  };
  return { api, calls };
}

test('merged PR fast gate remains independent of publication artifacts', async () => {
  const { api, calls } = harness();
  const result = await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
    backendRunAttempt: 1, backendRunSha: commit, api });
  assert.deepEqual(result, { commit, pullRequest: 391, runId: 100, attempt: 1, scriptChanged: true });
  assert.ok(!calls.some(path => /artifacts|pages-static|release-proof/.test(path)));
  assert.equal(calls.filter(path => path.endsWith('/git/ref/heads/main')).length, 2);
});

test('trusted direct-main coordinator publishes Apps Script without requiring a merged PR', async () => {
  const coordinator = { id: 12, path: '.github/workflows/pages-static.yml', state: 'active' };
  const coordinatorRun = { id: 120, workflow_id: 12, run_number: 19, run_attempt: 1,
    path: coordinator.path, event: 'push', head_branch: 'main', head_sha: commit,
    head_repository: { full_name: repository }, status: 'in_progress', conclusion: null };
  const coordinatorJobs = ['fast-gate', 'backend-publication'].map((name, i) => ({
    id: 500 + i, run_id: coordinatorRun.id, head_sha: commit, name,
    status: name === 'backend-publication' ? 'in_progress' : 'completed',
    conclusion: name === 'backend-publication' ? null : 'success'
  }));
  const backendRun = { id: 88, workflow_id: 10, run_number: 14, run_attempt: 1, path: backendPath,
    event: 'workflow_dispatch', head_branch: 'main', head_sha: commit,
    head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' };
  const backendJobs = [{ id: 310, run_id: 88, head_sha: commit,
    name: 'Apply backend migrations and deploy Edge Functions', status: 'completed', conclusion: 'skipped' }];
  const api = async endpoint => {
    if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: commit } };
    if (endpoint.endsWith('/commits/' + commit + '/pulls?per_page=100')) return [];
    if (endpoint.endsWith('/actions/workflows/pages-static.yml')) return coordinator;
    if (endpoint.endsWith('/actions/runs/120')) return coordinatorRun;
    if (endpoint.includes('/actions/runs/120/attempts/1/jobs')) return { total_count: coordinatorJobs.length, jobs: coordinatorJobs };
    if (endpoint.endsWith('/actions/workflows/apps-script-sync.yml')) return { id: 10, path: backendPath, state: 'active' };
    if (endpoint.endsWith('/actions/runs/88')) return backendRun;
    if (endpoint.includes('/actions/runs/88/attempts/1/jobs')) return { total_count: 1, jobs: backendJobs };
    throw new Error(`Unexpected API path ${endpoint}`);
  };
  const result = await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_dispatch', backendRunId: 88,
    backendRunAttempt: 1, backendRunSha: commit, coordinatorRunId: 120, coordinatorRunAttempt: 1,
    requireSupabase: false, scriptChanged: true, api });
  assert.deepEqual(result, { commit, pullRequest: null, runId: 120, attempt: 1, scriptChanged: true });
});

test('direct coordinator requires exact backend identity and a successful Supabase job when selected', async () => {
  const invoke = (change = {}, overrides = {}) => {
    const coordinator = { id: 12, path: '.github/workflows/pages-static.yml', state: 'active' };
    const coordinatorRun = { id: 120, workflow_id: 12, run_number: 19, run_attempt: 1,
      path: coordinator.path, event: 'workflow_dispatch', head_branch: 'main', head_sha: commit,
      head_repository: { full_name: repository }, status: 'in_progress', conclusion: null };
    const coordinatorJobs = (change.coordinatorNames || ['fast-gate', 'backend-publication']).map((name, i) => ({
      id: 500 + i, run_id: coordinatorRun.id, head_sha: commit, name,
      status: name === 'backend-publication' ? 'in_progress' : 'completed',
      conclusion: name === 'backend-publication' ? null : 'success',
      ...(name === 'fast-gate' ? change.fastGate : {}),
    }));
    const backendRun = { id: 88, workflow_id: 10, run_number: 14, run_attempt: 1, path: backendPath,
      event: 'workflow_dispatch', head_branch: 'main', head_sha: commit,
      head_repository: { full_name: repository }, status: 'completed', conclusion: 'success', ...change.backendRun };
    const backendJobs = [{ id: 310, run_id: change.jobRunId ?? backendRun.id, head_sha: commit,
      name: 'Apply backend migrations and deploy Edge Functions', status: 'completed',
      conclusion: change.jobConclusion ?? 'success' }];
    const api = async endpoint => {
      if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: commit } };
      if (endpoint.endsWith('/commits/' + commit + '/pulls?per_page=100')) return [];
      if (endpoint.endsWith('/actions/workflows/pages-static.yml')) return coordinator;
      if (endpoint.endsWith('/actions/runs/120')) return coordinatorRun;
      if (endpoint.includes('/actions/runs/120/attempts/1/jobs')) return { total_count: coordinatorJobs.length, jobs: coordinatorJobs };
      if (endpoint.endsWith('/actions/workflows/apps-script-sync.yml')) return { id: 10, path: backendPath, state: 'active' };
      if (endpoint.endsWith('/actions/runs/88')) return { ...backendRun, id: change.backendResponseId ?? backendRun.id };
      if (endpoint.includes('/actions/runs/88/attempts/1/jobs')) return { total_count: 1, jobs: backendJobs };
      throw new Error('Unexpected API path ' + endpoint);
    };
    return authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_dispatch', backendRunId: overrides.backendRunId ?? 88,
      backendRunAttempt: 1, backendRunSha: commit, coordinatorRunId: 120, coordinatorRunAttempt: overrides.coordinatorRunAttempt ?? 1,
      requireSupabase: overrides.requireSupabase ?? true, scriptChanged: overrides.scriptChanged ?? true, api });
  };
  for (const conclusion of ['failure', 'skipped', 'cancelled']) {
    await assert.rejects(invoke({ fastGate: { conclusion } }), /COORDINATOR_VALIDATION_NOT_GREEN/);
  }
  await assert.rejects(invoke({ fastGate: { status: 'in_progress' } }), /COORDINATOR_VALIDATION_NOT_GREEN/);
  await assert.rejects(invoke({ fastGate: { head_sha: 'f'.repeat(40) } }), /COORDINATOR_VALIDATION_NOT_GREEN/);
  await assert.rejects(invoke({ fastGate: { run_id: 121 } }), /COORDINATOR_VALIDATION_NOT_GREEN/);
  await assert.rejects(invoke({ coordinatorNames: ['fast-gate', 'fast-gate', 'backend-publication'] }), /COORDINATOR_VALIDATION_NOT_GREEN/);
  await assert.rejects(invoke({ coordinatorNames: ['authorize-main', 'scope', 'node-validation / pr-gate', 'backend-publication'] }),
    /COORDINATOR_VALIDATION_NOT_GREEN/);
  await assert.rejects(invoke({ jobConclusion: 'skipped' }), /BACKEND_DEPLOY_NOT_SUCCESSFUL/);
  await assert.rejects(invoke({ backendResponseId: 89 }), /BACKEND_RUN_NOT_TRUSTED/);
  await assert.rejects(invoke({ backendRun: { run_attempt: 2 } }), /BACKEND_RUN_NOT_TRUSTED/);
  await assert.rejects(invoke({ jobRunId: 89 }), /BACKEND_DEPLOY_NOT_SUCCESSFUL/);
  await assert.rejects(invoke({}, { scriptChanged: false }), /SCRIPT_CHANGE_NOT_AUTHORIZED/);
  await assert.rejects(invoke({}, { coordinatorRunAttempt: 2 }), /COORDINATOR_RUN_INVALID/);
});

test('tooling validation alone cannot authorize Apps Script deployment', async () => {
  const coordinator = { id: 12, path: '.github/workflows/pages-static.yml', state: 'active' };
  const coordinatorRun = { id: 120, workflow_id: 12, run_number: 19, run_attempt: 1,
    path: coordinator.path, event: 'push', head_branch: 'main', head_sha: commit,
    head_repository: { full_name: repository }, status: 'in_progress', conclusion: null };
  const jobs = ['authorize-main', 'scope', 'tooling-validation', 'backend-publication'].map((name, i) => ({
    id: 500 + i, run_id: coordinatorRun.id, head_sha: commit, name, status: 'completed', conclusion: 'success'
  }));
  const api = async endpoint => {
    if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: commit } };
    if (endpoint.endsWith('/commits/' + commit + '/pulls?per_page=100')) return [];
    if (endpoint.endsWith('/actions/workflows/pages-static.yml')) return coordinator;
    if (endpoint.endsWith('/actions/runs/120')) return coordinatorRun;
    if (endpoint.includes('/actions/runs/120/attempts/1/jobs')) return { total_count: jobs.length, jobs };
    throw new Error('Unexpected API path ' + endpoint);
  };
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_dispatch', coordinatorRunId: 120, coordinatorRunAttempt: 1,
    backendRunId: 88, backendRunAttempt: 1, backendRunSha: commit, requireSupabase: false, scriptChanged: true, api }),
  /COORDINATOR_VALIDATION_NOT_GREEN/);
});

test('an unrelated merged UI PR does not republish Apps Script automatically', async () => {
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_dispatch', api: harness().api }),
    /COORDINATOR_RUN_REQUIRED/);
  const { api } = harness({ files: [{ filename: 'index.html', status: 'modified' }] });
  const result = await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
    backendRunAttempt: 1, backendRunSha: commit, api });
  assert.equal(result.scriptChanged, false);
});

test('GAS-only changes allow the backend deploy job to be skipped', async () => {
  const { api } = harness({ files: [{ filename: 'Code.gs', status: 'modified' }],
    backendDeployJob: { conclusion: 'skipped' } });
  const result = await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
    backendRunAttempt: 1, backendRunSha: commit, api });
  assert.equal(result.scriptChanged, true);
});

test('backend migration runner and dispatch-workflow edits stay in the production release scope', async () => {
  for (const filename of ['scripts/apply-item-low-stock-migration.mjs', '.github/workflows/apps-script-sync.yml']) {
    const { api } = harness({ files: [{ filename, status: 'modified' }] });
    const result = await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
      backendRunAttempt: 1, backendRunSha: commit, api });
    assert.equal(result.scriptChanged, true, filename);
  }
});

test('renamed deployment consumers retain Apps Script path scope', async () => {
  const { api } = harness({ files: [{ filename: 'scripts/retired-script.mjs', previous_filename: 'scripts/apps-script-sync-lib.mjs', status: 'renamed' }] });
  assert.equal((await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
    backendRunAttempt: 1, backendRunSha: commit, api })).scriptChanged, true);
});

test('authorization dependencies and renamed dependencies retain deployment scope', async () => {
  for (const dependency of ['scripts/github-api-pagination.mjs', 'scripts/lib/github-json-transport.mjs',
    'scripts/release-proof.mjs', 'scripts/pages-release.mjs']) {
    for (const file of [{ filename: dependency, status: 'modified' },
      { filename: 'scripts/retired-dependency.mjs', previous_filename: dependency, status: 'renamed' }]) {
      const { api } = harness({ files: [file] });
      assert.equal((await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
        backendRunAttempt: 1, backendRunSha: commit, api })).scriptChanged, true);
    }
  }
});

for (const [name, overrides, error] of [
  ['branch', { ref: 'refs/heads/codex/repair' }, 'REF_NOT_MAIN'],
  ['expected SHA', { expectedCommit: 'c'.repeat(40) }, 'EXPECTED_COMMIT_MISMATCH'],
  ['workflow', { workflowRef: `${repository}/.github/workflows/other.yml@refs/heads/main` }, 'WORKFLOW_NOT_TRUSTED'],
  ['untrusted event', { eventName: 'pull_request' }, 'EVENT_NOT_ELIGIBLE'],
  ['missing backend run', { eventName: 'workflow_run', backendRunId: 0 }, 'BACKEND_RUN_INVALID']
]) test(`deployment rejects invalid ${name}`, async () => {
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, ...overrides, api: harness().api }), new RegExp(error));
});

for (const [name, change, error] of [
  ['unmerged PR', { pr: { merged: false } }, 'PR_IDENTITY_CHANGED'],
  ['draft PR', { pr: { draft: true } }, 'PR_IDENTITY_CHANGED'],
  ['wrong workflow', { workflow: { path: '.github/workflows/untrusted.yml' } }, 'VALIDATION_WORKFLOW_INVALID'],
  ['failed run', { run: { conclusion: 'failure' } }, 'LATEST_VALIDATION_NOT_GREEN'],
  ['fork validation', { run: { head_repository: { full_name: 'attacker/app' } } }, 'VALIDATION_RUN_IDENTITY_INVALID'],
  ['missing fast PR gate', { jobs: () => [] }, 'UNIT_LINT_GATE_MISSING'],
  ['legacy gate alone', { jobs: jobs => jobs.map(j => ({ ...j, name: 'validation / pr-gate' })) }, 'UNIT_LINT_GATE_MISSING'],
  ['duplicate fast PR gate', { jobs: jobs => [...jobs, { ...jobs[0], id: 201 }] }, 'UNIT_LINT_GATE_MISSING'],
  ['skipped fast PR gate', { jobs: jobs => jobs.map(j => ({ ...j, conclusion: 'skipped' })) }, 'UNIT_LINT_GATE_MISSING'],
  ['failed gate', { jobs: jobs => jobs.map(j => ({ ...j, conclusion: 'failure' })) }, 'VALIDATION_JOB_INVALID'],
  ['missing gate attestation', { jobs: jobs => jobs.map(j => ({ ...j, steps: [] })) }, 'UNIT_LINT_GATE_NOT_ATTESTED'],
  ['missing inline attestation', { jobs: jobs => jobs.map(j => ({ ...j, steps: j.steps.slice(1) })) }, 'UNIT_LINT_GATE_NOT_ATTESTED'],
  ['missing tooling attestation', { jobs: jobs => jobs.map(j => ({ ...j, steps: j.steps.slice(0, 1) })) }, 'UNIT_LINT_GATE_NOT_ATTESTED'],
  ['failed gate step', { jobs: jobs => jobs.map(j => ({ ...j, steps: j.steps.map(step => ({ ...step, conclusion: 'failure' })) })) }, 'UNIT_LINT_GATE_NOT_ATTESTED'],
  ['job SHA drift', { jobs: jobs => jobs.map(j => ({ ...j, head_sha: commit })) }, 'VALIDATION_JOB_INVALID'],
  ['rerun', { rerun: true }, 'VALIDATION_SUPERSEDED'],
  ['PR drift', { changePr: true }, 'PR_IDENTITY_CHANGED'],
  ['main drift', { advanceMain: true }, 'COMMIT_NOT_CURRENT_MAIN']
]) test(`deployment fails closed on ${name}`, async () => {
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, api: harness(change).api }), new RegExp(error));
});

test('new failed validation prevents fallback to older green validation', async () => {
  const base = { workflow_id: 9, path: '.github/workflows/performance-monitor.yml', event: 'pull_request', head_sha: head,
    head_repository: { full_name: repository }, run_attempt: 1, status: 'completed' };
  const { api } = harness({ runs: [{ ...base, id: 100, run_number: 12, conclusion: 'success' },
    { ...base, id: 101, run_number: 13, conclusion: 'failure' }] });
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, api }), /LATEST_VALIDATION_NOT_GREEN/);
});

test('untrusted backend run and incomplete changed paths cannot publish', async () => {
  for (const change of [{ backendRun: { path: '.github/workflows/other.yml' } },
    { backendRun: { conclusion: 'failure' } }, { backendRun: { head_repository: { full_name: 'attacker/app' } } }]) {
    await assert.rejects(authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
      backendRunAttempt: 1, backendRunSha: commit, api: harness(change).api }), /BACKEND_RUN_NOT_TRUSTED/);
  }
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', backendRunId: 88,
    backendRunAttempt: 1, backendRunSha: commit,
    api: harness({ files: [] }).api }), /CHANGED_PATHS_INCOMPLETE/);
});

test('backend migrations require the exact successful backend event and do not imply a script change', async () => {
  const files = [{ filename: 'supabase/migrations/feature.sql', status: 'added' }];
  await assert.rejects(authorizeAppsScriptDeployment({ ...options,
    api: harness({ files, backendRun: { head_sha: 'f'.repeat(40) } }).api }), /BACKEND_RUN_NOT_TRUSTED/);
  const result = await authorizeAppsScriptDeployment({ ...options, api: harness({ files }).api });
  assert.equal(result.scriptChanged, false);
});

test('backend changes reject skipped or failed deploy jobs and do not fall back to an older success', async () => {
  const files = [{ filename: 'database/schema.sql', status: 'modified' }];
  const successful = { id: 89, workflow_id: 10, run_number: 15, run_attempt: 1, path: backendPath,
    event: 'workflow_dispatch', head_branch: 'main', head_sha: commit,
    head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' };
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, api: harness({ files, backendRuns: [successful],
    backendDeployJob: { conclusion: 'skipped' } }).api }), /BACKEND_DEPLOY_NOT_SUCCESSFUL/);
  const failedLatest = { ...successful, id: 88, run_number: 16, conclusion: 'failure' };
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, api: harness({ files,
    backendRun: failedLatest, backendRuns: [successful, failedLatest] }).api }), /BACKEND_RUN_NOT_TRUSTED/);
});

test('Apps Script deployment is independent, guarded, and uses existing configured credentials', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/apps-script-deploy.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.on.workflow_run, undefined);
  assert.ok(workflow.on.workflow_dispatch.inputs['expected-commit']);
  assert.ok(workflow.on.workflow_dispatch.inputs['coordinator-run-id']);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const job = workflow.jobs['deploy-apps-script'];
  assert.equal(job.needs, undefined);
  assert.match(job.if, /refs\/heads\/main/);
  const authorize = job.steps.find(step => step.id === 'authorize');
  const deploy = job.steps.find(step => step.run === 'node scripts/sync-codegs-to-apps-script.js');
  assert.ok(job.steps.indexOf(authorize) < job.steps.indexOf(deploy));
  assert.match(deploy.if, /script-changed == 'true'/);
  assert.deepEqual(Object.keys(deploy.env).sort(), ['APPS_SCRIPT_CLASPRC_JSON', 'APPS_SCRIPT_DEPLOYMENT_ID',
    'APPS_SCRIPT_PRODUCTION_DEPLOYMENT_ID', 'APPS_SCRIPT_SCRIPT_ID']);
  assert.doesNotMatch(JSON.stringify(workflow.jobs), /pages-static|run-schema-tests|browser|supabase functions deploy/);
  const source = readFileSync(new URL('../scripts/sync-codegs-to-apps-script.js', import.meta.url), 'utf8');
  assert.match(source, /beforeMutation: patchEvidence \? createAppsScriptSourceGuard\(\{[\s\S]*?authorize: authorizeProductionAppsScriptDeploymentFromEnvironment,[\s\S]*?\}\) : authorizeProductionAppsScriptDeploymentFromEnvironment/);
  assert.ok(source.indexOf('await authorizeProductionAppsScriptDeploymentFromEnvironment()') < source.indexOf('const claspRc = parseClaspRc'));
});
