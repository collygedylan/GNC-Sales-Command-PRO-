// @test-group: node-unit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { authorizeAppsScriptDeployment } from '../scripts/lib/apps-script-deployment-guard.mjs';

const repository = 'example/app';
const commit = 'a'.repeat(40), head = 'b'.repeat(40);
const options = { repository, eventName: 'workflow_dispatch', ref: 'refs/heads/main', commit,
  expectedCommit: commit, workflowRef: `${repository}/.github/workflows/apps-script-deploy.yml@refs/heads/main` };
function harness(change = {}) {
  const calls = [];
  const pr = { number: 391, merged: true, merged_at: '2026-10-13T12:00:00Z', draft: false,
    merge_commit_sha: commit, changed_files: 1, base: { ref: 'main', repo: { full_name: repository } },
    head: { sha: head, repo: { full_name: repository } }, ...change.pr };
  const run = { id: 100, workflow_id: 9, run_number: 12, run_attempt: 1,
    path: '.github/workflows/performance-monitor.yml', event: 'pull_request', head_sha: head,
    head_repository: { full_name: repository }, status: 'completed', conclusion: 'success', ...change.run };
  let jobs = ['validation / lint', ...[1, 2, 3, 4].map(n => `validation / unit (${n})`), 'validation / pr-gate'].map((name, i) => ({
    id: 200 + i, run_id: run.id, head_sha: head, name, status: 'completed', conclusion: 'success',
    steps: name === 'validation / pr-gate' ? [{ name: 'Require the selected unit and lint checks', status: 'completed', conclusion: 'success' }] : []
  }));
  if (change.jobs) jobs = change.jobs(jobs);
  let mainReads = 0, runReads = 0, prReads = 0;
  const api = async endpoint => {
    calls.push(endpoint);
    if (endpoint.endsWith('/git/ref/heads/main')) {
      mainReads++;
      return { object: { sha: change.advanceMain && mainReads > 1 ? 'c'.repeat(40) : commit } };
    }
    if (endpoint.endsWith('/actions/runs/88')) return { id: 88, path: '.github/workflows/publish-candidate.yml',
      event: 'workflow_run', head_branch: 'main', head_repository: { full_name: repository },
      status: 'completed', conclusion: 'success', ...change.publisher };
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

test('standard merged PR units and lint authorize Apps Script independently of publication artifacts', async () => {
  const { api, calls } = harness();
  const result = await authorizeAppsScriptDeployment({ ...options, api });
  assert.deepEqual(result, { commit, pullRequest: 391, runId: 100, attempt: 1, scriptChanged: true });
  assert.ok(!calls.some(path => /artifacts|pages-static|release-proof/.test(path)));
  assert.equal(calls.filter(path => path.endsWith('/git/ref/heads/main')).length, 2);
});

test('trusted merge-controller completion publishes the newly merged current main', async () => {
  const { api } = harness();
  const result = await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', publisherRunId: 88, api });
  assert.equal(result.scriptChanged, true);
});

test('an unrelated merged UI PR does not republish Apps Script automatically', async () => {
  const { api } = harness({ files: [{ filename: 'index.html', status: 'modified' }] });
  const result = await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', publisherRunId: 88, api });
  assert.equal(result.scriptChanged, false);
});

test('renamed deployment consumers retain Apps Script path scope', async () => {
  const { api } = harness({ files: [{ filename: 'scripts/retired-script.mjs', previous_filename: 'scripts/apps-script-sync-lib.mjs', status: 'renamed' }] });
  assert.equal((await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', publisherRunId: 88, api })).scriptChanged, true);
});

test('authorization dependencies and renamed dependencies retain deployment scope', async () => {
  for (const dependency of ['scripts/github-api-pagination.mjs', 'scripts/lib/github-json-transport.mjs',
    'scripts/release-proof.mjs', 'scripts/pages-release.mjs']) {
    for (const file of [{ filename: dependency, status: 'modified' },
      { filename: 'scripts/retired-dependency.mjs', previous_filename: dependency, status: 'renamed' }]) {
      const { api } = harness({ files: [file] });
      assert.equal((await authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', publisherRunId: 88, api })).scriptChanged, true);
    }
  }
});

for (const [name, overrides, error] of [
  ['branch', { ref: 'refs/heads/codex/repair' }, 'REF_NOT_MAIN'],
  ['expected SHA', { expectedCommit: 'c'.repeat(40) }, 'EXPECTED_COMMIT_MISMATCH'],
  ['workflow', { workflowRef: `${repository}/.github/workflows/other.yml@refs/heads/main` }, 'WORKFLOW_NOT_TRUSTED'],
  ['untrusted event', { eventName: 'pull_request' }, 'EVENT_NOT_ELIGIBLE'],
  ['missing publisher', { eventName: 'workflow_run' }, 'PUBLISHER_RUN_INVALID']
]) test(`deployment rejects invalid ${name}`, async () => {
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, ...overrides, api: harness().api }), new RegExp(error));
});

for (const [name, change, error] of [
  ['unmerged PR', { pr: { merged: false } }, 'PR_IDENTITY_CHANGED'],
  ['draft PR', { pr: { draft: true } }, 'PR_IDENTITY_CHANGED'],
  ['wrong workflow', { workflow: { path: '.github/workflows/untrusted.yml' } }, 'VALIDATION_WORKFLOW_INVALID'],
  ['failed run', { run: { conclusion: 'failure' } }, 'LATEST_VALIDATION_NOT_GREEN'],
  ['fork validation', { run: { head_repository: { full_name: 'attacker/app' } } }, 'VALIDATION_RUN_IDENTITY_INVALID'],
  ['missing unit shard', { jobs: jobs => jobs.filter(j => j.name !== 'validation / unit (4)') }, 'UNIT_LINT_GATE_MISSING'],
  ['skipped lint', { jobs: jobs => jobs.map(j => j.name === 'validation / lint' ? { ...j, conclusion: 'skipped' } : j) }, 'UNIT_LINT_GATE_MISSING'],
  ['failed gate', { jobs: jobs => jobs.map(j => j.name === 'validation / pr-gate' ? { ...j, conclusion: 'failure' } : j) }, 'VALIDATION_JOB_INVALID'],
  ['missing gate attestation', { jobs: jobs => jobs.map(j => ({ ...j, steps: [] })) }, 'UNIT_LINT_GATE_NOT_ATTESTED'],
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

test('untrusted controller and incomplete changed paths cannot publish', async () => {
  for (const change of [{ publisher: { path: '.github/workflows/other.yml' } },
    { publisher: { conclusion: 'failure' } }, { publisher: { head_repository: { full_name: 'attacker/app' } } }]) {
    await assert.rejects(authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', publisherRunId: 88, api: harness(change).api }), /PUBLISHER_NOT_TRUSTED/);
  }
  await assert.rejects(authorizeAppsScriptDeployment({ ...options, eventName: 'workflow_run', publisherRunId: 88,
    api: harness({ files: [] }).api }), /CHANGED_PATHS_INCOMPLETE/);
});

test('Apps Script deployment is independent, guarded, and uses existing configured credentials', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/apps-script-deploy.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.workflow_run.workflows, ['Publish validated candidate']);
  assert.ok(workflow.on.workflow_dispatch.inputs['expected-commit']);
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
  assert.match(source, /beforeMutation: \(\) => authorizeProductionAppsScriptDeploymentFromEnvironment\(\)/);
  assert.ok(source.indexOf('await authorizeProductionAppsScriptDeploymentFromEnvironment()') < source.indexOf('const claspRc = parseClaspRc'));
});
