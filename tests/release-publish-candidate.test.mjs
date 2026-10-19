import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const yaml = createRequire(import.meta.url)('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const workflow = yaml.load(read('.github/workflows/publish-candidate.yml'));
const pages = yaml.load(read('.github/workflows/pages-static.yml'));
const prValidation = yaml.load(read('.github/workflows/pr-validation.yml'));
const backend = yaml.load(read('.github/workflows/apps-script-sync.yml'));
const diagnostic = yaml.load(read('.github/workflows/apps-script-database-diagnostic.yml'));
const script = workflow.jobs.publish.steps.find(step => step.uses === 'actions/github-script@v7').with.script;
const repository = 'example/gnc';
const headSha = 'validated-head-sha';
const mergeSha = 'validated-merge-sha';
const openCodexPr = { state: 'open', merged: false, merge_commit_sha: null, auto_merge: null,
  head: { ref: 'codex/aura-repair', sha: headSha, repo: { full_name: repository } } };

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
  const calls = { associated: [], merges: [], dispatches: [], notices: [], warnings: [], workflowRuns: [], events: [] };
  const workflowRuns = options.workflowRuns ?? [];
  const dispatchedBackendRun = options.dispatchedBackendRun ?? null;
  const api = {
    actions: {
      getWorkflowRun: async args => {
        calls.events.push(`get:${args.run_id}`);
        return { data: args.run_id === (dispatchedBackendRun?.id ?? -1) ? dispatchedBackendRun : validatedRun };
      },
      listWorkflowRuns: async args => {
        calls.workflowRuns.push(args);
        const values = Array.isArray(workflowRuns) ? workflowRuns : (workflowRuns[args.workflow_id] || []);
        const backendAlreadyDispatched = calls.dispatches.some(run => run.workflow_id === 'apps-script-sync.yml');
        const dispatched = args.workflow_id === 'apps-script-sync.yml' && backendAlreadyDispatched && dispatchedBackendRun
          ? [dispatchedBackendRun] : [];
        return { data: [...dispatched, ...values] };
      },
      createWorkflowDispatch: async args => {
        calls.dispatches.push(args);
        calls.events.push(`dispatch:${args.workflow_id}`);
        if (options.backendError && args.workflow_id === 'apps-script-sync.yml') throw new Error('backend unavailable');
        return { status: 204 };
      },
    },
    repos: {
      listPullRequestsAssociatedWithCommit: async args => { calls.associated.push(args); return { data: candidates }; },
      getContent: async args => ({ data: { content: Buffer.from(JSON.stringify({ version: options.releaseVersion ?? '2.3.10' })).toString('base64') } }),
    },
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
  const core = { notice: message => calls.notices.push(message), warning: message => calls.warnings.push(message) };
  return { calls, pr, async execute() {
    await vm.runInNewContext(`(async () => {\n${script}\n})()`, { github, context, core, Buffer,
      Date, setTimeout: callback => setTimeout(callback, 0) });
    return calls;
  } };
}

test('trusted completed PR validation dispatches Pages first and an independent backend for its confirmed main merge', async () => {
  const f = fixture();
  await f.execute();
  assert.equal(f.calls.dispatches.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.dispatches)), [
    { owner: 'example', repo: 'gnc', workflow_id: 'pages-static.yml', ref: 'main', inputs: { 'expected-commit': mergeSha } },
    { owner: 'example', repo: 'gnc', workflow_id: 'apps-script-sync.yml', ref: 'main', inputs: { 'expected-commit': mergeSha } },
  ]);
  assert.deepEqual(f.calls.workflowRuns.map(run => run.workflow_id), ['pages-static.yml', 'apps-script-sync.yml']);
  assert.deepEqual(f.calls.merges, []);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.associated)), [{ owner: 'example', repo: 'gnc', commit_sha: headSha, per_page: 100 }]);
});

test('v2.3.11 waits for the exact backend deployment to succeed before dispatching Pages', async () => {
  const backendRun = { id: 91, head_branch: 'main', head_sha: mergeSha, event: 'workflow_dispatch',
    status: 'completed', conclusion: 'success' };
  const f = fixture({ releaseVersion: '2.3.11', dispatchedBackendRun: backendRun });
  await f.execute();
  assert.deepEqual(f.calls.dispatches.map(run => run.workflow_id), ['apps-script-sync.yml', 'pages-static.yml']);
  assert.ok(f.calls.events.indexOf('dispatch:apps-script-sync.yml') < f.calls.events.indexOf('get:91'));
  assert.ok(f.calls.events.indexOf('get:91') < f.calls.events.indexOf('dispatch:pages-static.yml'));
  assert.equal(f.calls.dispatches.every(run => run.inputs['expected-commit'] === mergeSha), true);
});

test('v2.3.11 does not dispatch Pages when the exact backend deployment fails', async () => {
  const backendRun = { id: 92, head_branch: 'main', head_sha: mergeSha, event: 'workflow_dispatch',
    status: 'completed', conclusion: 'failure' };
  const f = fixture({ releaseVersion: '2.3.11', dispatchedBackendRun: backendRun });
  await assert.rejects(f.execute(), /BACKEND_WORKFLOW_FAILED:apps-script-sync\.yml:failure/);
  assert.deepEqual(f.calls.dispatches.map(run => run.workflow_id), ['apps-script-sync.yml']);
});

test('empty workflow_run pull_requests are resolved from the validated commit', async () => {
  const f = fixture();
  await f.execute();
  assert.equal(f.calls.dispatches.length, 2);
  assert.equal(f.calls.associated[0].commit_sha, headSha);
});

test('an enabled deferred auto-merge uses the validated head as the merge guard', async () => {
  const f = fixture({ pr: { state: 'open', merged: false, merge_commit_sha: null, auto_merge: { enabled_by: { login: 'bot' } } } });
  await f.execute();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.merges)), [{ owner: 'example', repo: 'gnc', pull_number: 18, sha: headSha, merge_method: 'merge' }]);
  assert.equal(f.calls.dispatches.length, 2);
});

test('an open codex candidate without auto-merge is merged only after the exact successful validation run', async () => {
  const f = fixture({ pr: openCodexPr });
  await f.execute();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.merges)), [{ owner: 'example', repo: 'gnc', pull_number: 18, sha: headSha, merge_method: 'merge' }]);
  assert.equal(f.calls.dispatches.length, 2);
});

test('untrusted, failed, cancelled, superseded, or non-PR validation runs cannot publish', async t => {
  const cases = [
    ['failed', { validatedRun: { conclusion: 'failure' }, pr: openCodexPr }],
    ['cancelled', { validatedRun: { conclusion: 'cancelled' }, pr: openCodexPr }],
    ['wrong workflow', { validatedRun: { path: '.github/workflows/other.yml' }, pr: openCodexPr }],
    ['wrong attempt', { validatedRun: { run_attempt: 1 }, pr: openCodexPr }],
    ['wrong source event', { validatedRun: { event: 'push' }, pr: openCodexPr }],
    ['fork validation', { validatedRun: { head_repository: { full_name: 'fork/gnc' } }, pr: openCodexPr }],
    ['superseded successful run', { eventRun: { run_attempt: 3 }, pr: openCodexPr }],
    ['fork PR', { candidates: [{ ...fixture().pr, head: { ref: 'candidate', sha: headSha, repo: { full_name: 'fork/gnc' } } }] }],
    ['changed head', { candidates: [{ ...fixture().pr, head: { ref: 'candidate', sha: 'new-head', repo: { full_name: repository } } }] }],
    ['codex branch with changed head', { pr: { state: 'open', merged: false, merge_commit_sha: null, auto_merge: null,
      head: { ref: 'codex/aura-repair', sha: 'new-head', repo: { full_name: repository } } } }],
    ['non-main PR', { candidates: [{ ...fixture().pr, base: { ref: 'release', repo: { full_name: repository } } }] }],
    ['codex branch targeting non-main', { pr: { state: 'open', merged: false, merge_commit_sha: null, auto_merge: null,
      base: { ref: 'release', repo: { full_name: repository } },
      head: { ref: 'codex/aura-repair', sha: headSha, repo: { full_name: repository } } } }],
    ['ambiguous PR', { candidates: [fixture().pr, { ...fixture().pr, number: 19 }] }],
    ['closed without merge', { pr: { state: 'closed', merged: false, merge_commit_sha: null, auto_merge: null } }],
    ['non-codex branch without auto-merge opt-in', { pr: { state: 'open', merged: false, merge_commit_sha: null, auto_merge: null } }],
    ['draft PR', { pr: { draft: true } }],
    ['main advanced', { mainSha: 'newer-main-sha' }],
  ];
  for (const [name, options] of cases) await t.test(name, async () => {
    const f = fixture(options);
    await f.execute();
    assert.deepEqual(f.calls.dispatches, []);
    assert.deepEqual(f.calls.merges, []);
  });
});

test('queued, running, or successful handoffs deduplicate independently; a failed run can retry', async t => {
  for (const existing of [
    { status: 'queued', conclusion: null },
    { status: 'in_progress', conclusion: null },
    { status: 'completed', conclusion: 'success' },
  ]) await t.test(`${existing.status}/${existing.conclusion || 'pending'}`, async () => {
    const f = fixture({ workflowRuns: [{ head_branch: 'main', head_sha: mergeSha, event: 'workflow_dispatch', ...existing }] });
    await f.execute();
    assert.deepEqual(f.calls.dispatches, []);
  });
  const failed = fixture({ workflowRuns: [{ head_branch: 'main', head_sha: mergeSha, event: 'workflow_dispatch', status: 'completed', conclusion: 'failure' }] });
  await failed.execute();
  assert.equal(failed.calls.dispatches.length, 2);
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
  assert.match(script, /dispatchOnce\('pages-static\.yml'\)/);
  assert.match(script, /dispatchOnce\('apps-script-sync\.yml'\)/);
  assert.match(script, /getContent\([\s\S]*path: 'package\.json'[\s\S]*ref: pr\.merge_commit_sha/);
  assert.match(script, /releaseVersion === '2\.3\.11'/);
  assert.match(script, /waitForSuccessfulWorkflow\('apps-script-sync\.yml', backendDispatch\)/);
  assert.match(script, /BACKEND_WORKFLOW_FAILED/);
  assert.ok(workflow.jobs.publish['timeout-minutes'] >= 40);
  assert.match(script, /'expected-commit': pr\.merge_commit_sha/);
  assert.ok(Object.hasOwn(backend.on, 'workflow_dispatch'));
  assert.equal(Object.hasOwn(backend.on, 'push'), false, 'only a validated candidate or guarded recovery starts backend publication');
  assert.equal(diagnostic.name, 'Diagnose low-stock database connection');
  assert.ok(Object.hasOwn(diagnostic.on, 'workflow_dispatch'));
  assert.equal(diagnostic.jobs['diagnose-database'].if, "github.ref == 'refs/heads/main'");
  assert.match(script, /dispatchOnce\('apps-script-sync\.yml'\)/);
  assert.doesNotMatch(script, /apps-script-database-diagnostic\.yml/);
  assert.ok(Object.hasOwn(pages.on, 'workflow_dispatch'));
  assert.equal(Object.hasOwn(pages.on, 'push'), false, 'only the trusted publisher or guarded manual dispatch starts publication');
  assert.doesNotMatch(workflow.on.workflow_run.workflows.join(' '), /Publish validated candidate|Deploy static app to Pages/);
});

test('no pull-request workflow can merge early or enable auto-merge before validation', () => {
  const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
  const names = fs.readdirSync(workflowDirectory).filter(name => /\.ya?ml$/i.test(name));
  assert.equal(names.includes('auto-merge.yml'), false, 'the old eager auto-merge workflow must stay removed');
  for (const name of names) {
    const candidate = yaml.load(fs.readFileSync(new URL(name, workflowDirectory), 'utf8'));
    if (!['pull_request', 'pull_request_target'].some(event => Object.hasOwn(candidate.on || {}, event))) continue;
    assert.doesNotMatch(JSON.stringify(candidate.jobs || {}), /gh\s+pr\s+merge|pulls\.merge\s*\(|enablePullRequestAutoMerge|mergePullRequest/i,
      `${name} must not merge or enable auto-merge from a pull-request event`);
  }
});

test('backend dispatch failure cannot fail or delay the queued frontend handoff', async () => {
  const f = fixture({ backendError: true });
  await f.execute();
  assert.deepEqual(f.calls.dispatches.map(run => run.workflow_id), ['pages-static.yml', 'apps-script-sync.yml']);
  assert.equal(f.calls.warnings.length, 1);
  assert.match(f.calls.warnings[0], /BACKEND_DISPATCH_FAILED/);
});

test('an existing backend run does not prevent a new frontend dispatch', async () => {
  const f = fixture({ workflowRuns: { 'apps-script-sync.yml': [
    { head_branch: 'main', head_sha: mergeSha, event: 'workflow_dispatch', status: 'in_progress' },
  ] } });
  await f.execute();
  assert.deepEqual(f.calls.dispatches.map(run => run.workflow_id), ['pages-static.yml']);
});

test('Pages publishes the same-run verified artifact independently of backend results', () => {
  const publish = pages.jobs.deploy;
  assert.deepEqual(publish.needs, ['authorize-main', 'validation']);
  assert.equal(backend.jobs['publish-pages'], undefined);
  assert.equal(pages.jobs.validation.with['run-backend-tests'], false);
  assert.equal(pages.jobs.validation.with['run-nightly-suites'], false);
  assert.equal(pages.jobs.validation.with['run-schema-tests'], false);
  assert.equal(pages.jobs.validation.with['production-health'], false);
  assert.doesNotMatch(JSON.stringify(pages), /SUPABASE_|APPS_SCRIPT_|production-release-guard|pages-release.mjs|check-compatible-apps-script|probe-production-auth-health/);
  const download = publish.steps.find(step => step.uses === './.github/actions/download-release');
  assert.equal(download.with.digest, '${{ needs.validation.outputs.digest }}');
  assert.equal(download.with['run-id'], '${{ github.run_id }}');
  assert.equal(download.with.commit, '${{ github.sha }}');
  const push = publish.steps.find(step => step.name === 'Deploy verified artifact to Pages');
  assert.match(push.run, /HEAD:gh-pages/);
  assert.doesNotMatch(push.run, /--force/);
  assert.match(push.run, /CNAME/);
  assert.match(push.run, /\.nojekyll/);
  assert.equal(publish.permissions.contents, 'write');
  assert.equal(publish.permissions.pages, 'write');
  const pagesBuild = publish.steps.find(step => step.name === 'Request the GitHub Pages build for the published branch');
  assert.match(pagesBuild.run, /pages\/builds/);
});

test('PR validation emits no publication proof and has conditional frontend/backend lanes', () => {
  assert.ok(prValidation.on.workflow_call);
  assert.equal(prValidation.on.workflow_call.inputs['run-frontend-tests'].default, true);
  assert.equal(prValidation.on.workflow_call.inputs['run-backend-tests'].default, true);
  assert.deepEqual(prValidation.on.workflow_call.outputs, undefined);
  assert.deepEqual(prValidation.jobs['pr-gate'].needs, ['lint', 'unit', 'react', 'contracts', 'backend-unit']);
  assert.match(prValidation.jobs.react.if, /inputs\.run-frontend-tests/);
  assert.match(prValidation.jobs['backend-unit'].if, /inputs\.run-backend-tests/);
  assert.doesNotMatch(JSON.stringify(prValidation.jobs['pr-gate'].steps), /artifact|proof|playwright|chromium|lighthouse|performance/i);
});

test('live notification requires both the current descriptor and immutable commit fingerprint', () => {
  const live = pages.jobs['exact-live'];
  assert.equal(live.needs, 'deploy');
  const wait = live.steps.find(step => step.run === 'node scripts/wait-for-live-release.mjs');
  assert.equal(wait.env.REQUIRE_CURRENT_LIVE_DESCRIPTOR, '1');
  assert.equal(wait.env.EXPECTED_COMMIT, '${{ needs.deploy.outputs.build-commit }}');
  const report = live.steps.find(step => step.name === 'Report the verified live version');
  assert.ok(live.steps.indexOf(report) > live.steps.indexOf(wait));
  assert.match(report.run, /await readExpectedRelease\(\)/);
  assert.match(report.run, /deployment-fingerprint-lib\.mjs/);
  assert.match(report.run, /is now LIVE/);
  assert.match(report.run, /GITHUB_STEP_SUMMARY/);
});
