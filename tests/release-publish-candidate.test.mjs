import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const yaml = createRequire(import.meta.url)('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const workflow = yaml.load(read('.github/workflows/publish-candidate.yml'));
const pages = yaml.load(read('.github/workflows/pages-static.yml'));
const backend = yaml.load(read('.github/workflows/apps-script-sync.yml'));
const diagnostic = yaml.load(read('.github/workflows/apps-script-database-diagnostic.yml'));
const script = workflow.jobs.publish.steps.find(step => step.uses === 'actions/github-script@v7').with.script;
const repository = 'example/gnc';
const headSha = 'validated-head-sha';
const mergeSha = 'validated-merge-sha';

function fixture(options = {}) {
  const eventRun = { id: 71, run_attempt: 2, head_sha: headSha,
    head_repository: { full_name: repository }, event: 'pull_request', conclusion: 'success', pull_requests: [], ...options.eventRun };
  const validatedRun = { id: 71, run_attempt: 2, path: '.github/workflows/performance-monitor.yml',
    event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: headSha,
    head_repository: { full_name: repository }, ...options.validatedRun };
  let pr = { number: 18, state: 'closed', draft: false, merged: true, merge_commit_sha: mergeSha,
    base: { ref: 'main', repo: { full_name: repository } },
    head: { ref: 'candidate', sha: headSha, repo: { full_name: repository } }, ...options.pr };
  const candidates = options.candidates ?? [pr];
  const calls = { associated: [], merges: [], dispatches: [], notices: [] };
  const workflowRuns = options.workflowRuns ?? [];
  const api = {
    actions: {
      getWorkflowRun: async args => ({ data: validatedRun }),
      listWorkflowRuns: async args => { calls.workflowRuns = args; return { data: workflowRuns }; },
      createWorkflowDispatch: async args => { calls.dispatches.push(args); return { status: 204 }; },
    },
    repos: { listPullRequestsAssociatedWithCommit: async args => { calls.associated.push(args); return { data: candidates }; } },
    pulls: {
      get: async () => ({ data: pr }),
      merge: async args => {
        calls.merges.push(args);
        const result = options.mergeResult ?? { merged: true, sha: mergeSha };
        if (result.merged) pr = { ...pr, state: 'closed', merged: true, merge_commit_sha: mergeSha };
        return { data: result };
      },
    },
    git: { getRef: async args => ({ data: { object: { sha: options.mainSha ?? mergeSha } } }) },
  };
  const github = { rest: api, paginate: async (method, args) => (await method(args)).data };
  const context = { repo: { owner: 'example', repo: 'gnc' }, payload: { workflow_run: eventRun } };
  const core = { notice: message => calls.notices.push(message) };
  return { calls, pr, async execute() {
    await vm.runInNewContext(`(async () => {\n${script}\n})()`, { github, context, core });
    return calls;
  } };
}

test('trusted completed PR validation dispatches the backend handoff for its confirmed main merge', async () => {
  const f = fixture();
  await f.execute();
  assert.equal(f.calls.dispatches.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.dispatches[0])), { owner: 'example', repo: 'gnc', workflow_id: 'apps-script-sync.yml', ref: 'main' });
  assert.equal(f.calls.workflowRuns.workflow_id, 'apps-script-sync.yml');
  assert.deepEqual(f.calls.merges, []);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.associated)), [{ owner: 'example', repo: 'gnc', commit_sha: headSha, per_page: 100 }]);
});

test('empty workflow_run pull_requests are resolved from the validated commit', async () => {
  const f = fixture();
  await f.execute();
  assert.equal(f.calls.dispatches.length, 1);
  assert.equal(f.calls.associated[0].commit_sha, headSha);
});

test('an enabled deferred auto-merge uses the validated head as the merge guard', async () => {
  const f = fixture({ pr: { state: 'open', merged: false, merge_commit_sha: null, auto_merge: { enabled_by: { login: 'bot' } } } });
  await f.execute();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.merges)), [{ owner: 'example', repo: 'gnc', pull_number: 18, sha: headSha, merge_method: 'merge' }]);
  assert.equal(f.calls.dispatches.length, 1);
});

test('untrusted, failed, cancelled, superseded, or non-PR validation runs cannot publish', async t => {
  const cases = [
    ['failed', { validatedRun: { conclusion: 'failure' } }],
    ['cancelled', { validatedRun: { conclusion: 'cancelled' } }],
    ['wrong workflow', { validatedRun: { path: '.github/workflows/other.yml' } }],
    ['wrong attempt', { validatedRun: { run_attempt: 1 } }],
    ['wrong source event', { validatedRun: { event: 'push' } }],
    ['fork validation', { validatedRun: { head_repository: { full_name: 'fork/gnc' } } }],
    ['fork PR', { candidates: [{ ...fixture().pr, head: { ref: 'candidate', sha: headSha, repo: { full_name: 'fork/gnc' } } }] }],
    ['changed head', { candidates: [{ ...fixture().pr, head: { ref: 'candidate', sha: 'new-head', repo: { full_name: repository } } }] }],
    ['non-main PR', { candidates: [{ ...fixture().pr, base: { ref: 'release', repo: { full_name: repository } } }] }],
    ['ambiguous PR', { candidates: [fixture().pr, { ...fixture().pr, number: 19 }] }],
    ['closed without merge', { pr: { state: 'closed', merged: false, merge_commit_sha: null, auto_merge: null } }],
    ['no auto-merge opt-in', { pr: { state: 'open', merged: false, merge_commit_sha: null, auto_merge: null } }],
    ['draft PR', { pr: { draft: true } }],
    ['main advanced', { mainSha: 'newer-main-sha' }],
  ];
  for (const [name, options] of cases) await t.test(name, async () => {
    const f = fixture(options);
    await f.execute();
    assert.deepEqual(f.calls.dispatches, []);
    if (['closed without merge', 'no auto-merge opt-in', 'draft PR'].includes(name)) assert.deepEqual(f.calls.merges, []);
  });
});

test('queued, running, or successful backend handoffs deduplicate dispatch; a failed run can retry', async t => {
  for (const existing of [
    { status: 'queued', conclusion: null },
    { status: 'in_progress', conclusion: null },
    { status: 'completed', conclusion: 'success' },
  ]) await t.test(`${existing.status}/${existing.conclusion || 'pending'}`, async () => {
    const f = fixture({ workflowRuns: [{ head_branch: 'main', head_sha: mergeSha, ...existing }] });
    await f.execute();
    assert.deepEqual(f.calls.dispatches, []);
  });
  const failed = fixture({ workflowRuns: [{ head_branch: 'main', head_sha: mergeSha, status: 'completed', conclusion: 'failure' }] });
  await failed.execute();
  assert.equal(failed.calls.dispatches.length, 1);
});

test('a failed guarded merge cannot dispatch the backend handoff', async () => {
  const f = fixture({ pr: { state: 'open', merged: false, merge_commit_sha: null, auto_merge: { enabled_by: { login: 'bot' } } },
    mergeResult: { merged: false, message: 'head changed' } });
  await assert.rejects(f.execute(), /CANDIDATE_MERGE_NOT_COMPLETED/);
  assert.deepEqual(f.calls.dispatches, []);
});

test('the dispatcher is trusted, least-scoped, and cannot recursively dispatch itself', () => {
  assert.deepEqual(workflow.on.workflow_run.workflows, ['PWA and Supabase performance']);
  assert.deepEqual(workflow.on.workflow_run.types, ['completed']);
  assert.deepEqual(workflow.permissions, { contents: 'write', 'pull-requests': 'write', actions: 'write' });
  assert.match(workflow.jobs.publish.if, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow.jobs.publish.if, /workflow_run\.event == 'pull_request'/);
  assert.match(workflow.jobs.publish.if, /head_repository\.full_name == github\.repository/);
  assert.equal(workflow.jobs.publish.steps.some(step => step.uses?.startsWith('actions/checkout@')), false);
  assert.deepEqual(workflow.jobs.publish.steps.filter(step => step.uses).map(step => step.uses), ['actions/github-script@v7']);
  assert.match(script, /getWorkflowRun/);
  assert.match(script, /run\.head_sha !== event\.head_sha/);
  assert.match(script, /pulls\.merge\([\s\S]*sha: run\.head_sha/);
  assert.match(script, /workflow_id: 'apps-script-sync\.yml'[\s\S]*ref: 'main'/);
  assert.doesNotMatch(script, /workflow_id: 'pages-static\.yml'/);
  assert.ok(Object.hasOwn(backend.on, 'workflow_dispatch'));
  assert.equal(diagnostic.name, 'Diagnose low-stock database connection');
  assert.ok(Object.hasOwn(diagnostic.on, 'workflow_dispatch'));
  assert.equal(diagnostic.jobs['diagnose-database'].if, "github.ref == 'refs/heads/main'");
  assert.match(script, /workflow_id: 'apps-script-sync\.yml'/);
  assert.doesNotMatch(script, /apps-script-database-diagnostic\.yml/);
  assert.ok(Object.hasOwn(pages.on, 'workflow_dispatch'));
  assert.doesNotMatch(workflow.on.workflow_run.workflows.join(' '), /Publish validated candidate|Deploy static app to Pages/);
});

const handoff = backend.jobs['publish-pages'];
const handoffScript = handoff.steps.find(step => step.uses === 'actions/github-script@v7').with.script;

async function runHandoff({ mainShas = [mergeSha, mergeSha], existing = [], lookupError = false } = {}) {
  const calls = { dispatches: [], notices: [], refs: 0 };
  const github = { rest: {
    git: { getRef: async () => ({ data: { object: { sha: mainShas[calls.refs++] } } }) },
    actions: {
      listWorkflowRuns: async args => {
        assert.equal(args.workflow_id, 'pages-static.yml');
        assert.equal(args.head_sha, mergeSha);
        if (lookupError) throw Error('GITHUB_API_UNAVAILABLE');
        return { data: existing };
      },
      createWorkflowDispatch: async args => { calls.dispatches.push(JSON.parse(JSON.stringify(args))); },
    },
  }, paginate: async (method, args) => (await method(args)).data };
  await vm.runInNewContext(`(async () => {\n${handoffScript}\n})()`, {
    github, context: { repo: { owner: 'example', repo: 'gnc' }, sha: mergeSha },
    core: { notice: message => calls.notices.push(message) },
  });
  return calls;
}

test('schema and verified Apps Script health must succeed before the Pages handoff', () => {
  assert.deepEqual(handoff.needs, ['authorize-production', 'sync-codegs']);
  assert.match(handoff.if, /refs\/heads\/main/);
  assert.match(handoff.if, /authorized == 'true'/);
  assert.doesNotMatch(handoff.if, /always\(|failure\(|cancelled\(/);
  assert.equal(backend.permissions['pull-requests'], 'read');
  assert.equal(backend.permissions.actions, 'read');
  assert.deepEqual(handoff.permissions, { contents: 'read', actions: 'write' });
  assert.doesNotMatch(JSON.stringify(handoff), /secrets\.|APPS_SCRIPT_CLASPRC_JSON/);
  const steps = backend.jobs['sync-codegs'].steps;
  const schema = steps.findIndex(step => step.run === 'node scripts/apply-item-low-stock-migration.mjs');
  const compatibility = steps.findIndex(step => step.run === 'node scripts/apps-script-sync-preflight.mjs');
  const deploy = steps.findIndex(step => step.run === 'node scripts/sync-codegs-to-apps-script.js');
  assert.ok(schema >= 0 && compatibility > schema && deploy > compatibility);
  assert.equal(steps[deploy].if, "steps.compatibility.outputs.sync-required == 'true'");
  assert.equal(steps.find(step => step.uses === 'actions/upload-artifact@v4').if, steps[deploy].if);
  assert.equal(steps[compatibility].env.APPS_SCRIPT_PRODUCTION_DEPLOYMENT_ID, '${{ vars.APPS_SCRIPT_PRODUCTION_DEPLOYMENT_ID }}');
  assert.equal(steps.some(step => step['continue-on-error']), false);
  assert.match(read('scripts/sync-codegs-to-apps-script.js'), /await createAppsScriptRecoveryEvidence/);
  assert.match(read('.github/workflows/pages-static.yml'), /node scripts\/check-compatible-apps-script\.mjs/);
});

test('successful backend handoff dispatches Pages on current main', async () => {
  const calls = await runHandoff();
  assert.deepEqual(calls.dispatches, [{ owner: 'example', repo: 'gnc', workflow_id: 'pages-static.yml', ref: 'main' }]);
  assert.equal(calls.refs, 2);
});

test('Pages handoff rejects main advancing before or during lookup and fails closed on API errors', async () => {
  for (const mainShas of [['newer-main'], [mergeSha, 'newer-main']]) {
    assert.deepEqual((await runHandoff({ mainShas })).dispatches, []);
  }
  await assert.rejects(runHandoff({ lookupError: true }), /GITHUB_API_UNAVAILABLE/);
});

test('Pages handoff deduplicates the same main release and permits recovery from a failed run', async () => {
  for (const state of [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }]) {
    assert.deepEqual((await runHandoff({ existing: [{ head_branch: 'main', head_sha: mergeSha, ...state }] })).dispatches, []);
  }
  for (const existing of [
    [{ head_branch: 'main', head_sha: mergeSha, status: 'completed', conclusion: 'failure' }],
    [{ head_branch: 'main', head_sha: 'older-sha', status: 'completed', conclusion: 'success' }],
    [{ head_branch: 'feature', head_sha: mergeSha, status: 'in_progress' }],
  ]) assert.equal((await runHandoff({ existing })).dispatches.length, 1);
});
