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
  assert.equal(Object.hasOwn(backend.on, 'push'), false, 'only a validated candidate or guarded recovery starts backend publication');
  assert.equal(diagnostic.name, 'Diagnose low-stock database connection');
  assert.ok(Object.hasOwn(diagnostic.on, 'workflow_dispatch'));
  assert.equal(diagnostic.jobs['diagnose-database'].if, "github.ref == 'refs/heads/main'");
  assert.match(script, /workflow_id: 'apps-script-sync\.yml'/);
  assert.doesNotMatch(script, /apps-script-database-diagnostic\.yml/);
  assert.ok(Object.hasOwn(pages.on, 'workflow_dispatch'));
  assert.equal(Object.hasOwn(pages.on, 'push'), false, 'main pushes cannot race the backend-first release');
  assert.doesNotMatch(workflow.on.workflow_run.workflows.join(' '), /Publish validated candidate|Deploy static app to Pages/);
});

const publish = backend.jobs['publish-pages'];

test('backend schema and functions deploy before guarded Pages publication', () => {
  assert.deepEqual(publish.needs, ['authorize-production', 'sync-codegs']);
  assert.match(publish.if, /refs\/heads\/main/);
  assert.match(publish.if, /authorized == 'true'/);
  assert.doesNotMatch(publish.if, /always\(|failure\(|cancelled\(/);
  assert.equal(backend.permissions['pull-requests'], 'read');
  assert.equal(backend.permissions.actions, 'read');
  assert.doesNotMatch(JSON.stringify(publish), /APPS_SCRIPT_CLASPRC_JSON/);

  const backendSteps = backend.jobs['sync-codegs'].steps;
  const migration = backendSteps.findIndex(step => step.name === 'Apply backend release migrations and synchronize reminder Vault credentials');
  const functions = backendSteps.findIndex(step => step.name === 'Configure Production Schedule dispatch and deploy backend functions');
  assert.ok(migration >= 0 && functions > migration, 'migration and backend deployment precede the Pages dependency');
  assert.match(backendSteps[functions].run, /supabase functions deploy app-api/);
  assert.match(backendSteps[functions].run, /supabase functions deploy calendar-reminder-sweep/);
  const deploys = backendSteps[functions].run.split('\n').filter(line => /supabase functions deploy/.test(line));
  assert.equal(deploys.length, 8);
  assert.deepEqual(deploys.map(line => line.match(/deploy ([\w-]+)/)[1]),
    ['app-api', 'send-push-alert', 'request-delivery-worker', 'calendar-reminder-sweep', 'scheduled-offboarding', 'auth-admin', 'inventory-assistant', 'aura-llm-router']);
  for (const line of deploys) {
    assert.match(line, /--use-api\b/, 'server-side bundling avoids Docker registry throttling');
    assert.match(line, /--project-ref "\$project_ref"/);
    assert.doesNotMatch(line, /--no-verify-jwt|--prune/);
  }
  assert.equal(backendSteps.some(step => step['continue-on-error']), false);
  assert.match(read('scripts/sync-codegs-to-apps-script.js'), /await createAppsScriptRecoveryEvidence/);
  assert.match(read('.github/workflows/pages-static.yml'), /node scripts\/check-compatible-apps-script\.mjs/);
});

test('Pages publication rebuilds from guarded main without importing workbook data, then pushes without force', () => {
  const steps = publish.steps;
  const guardBefore = steps.findIndex(step => step.name === 'Verify current main before building');
  const build = steps.findIndex(step => step.name === 'Install dependencies and build the complete site');
  const guardAfter = steps.findIndex(step => step.name === 'Recheck current main and release proof before publication');
  const push = steps.find(step => step.name === 'Push the verified static site to gh-pages without force');
  assert.ok(guardBefore >= 0 && build > guardBefore && guardAfter > build);
  assert.doesNotMatch(JSON.stringify(backend), /seed-production-schedule-release|PRODUCTION_SCHEDULE_IMPORT_TIMEOUT_MS|production_schedule_start_import_v1/);
  assert.equal(publish['timeout-minutes'], 25);
  assert.ok(push && steps.indexOf(push) > guardAfter);
  assert.match(push.run, /git -C .* push .*HEAD:gh-pages/);
  assert.doesNotMatch(push.run, /--force(?:-with-lease)?/);
  assert.match(push.run, /test -f "\$pages_dir\/CNAME"/);
  assert.match(push.run, /test -f "\$pages_dir\/\.nojekyll"/);
  assert.match(steps[guardAfter].run, /production-release-guard/);
  assert.equal(publish.permissions.contents, 'write');
  assert.doesNotMatch(JSON.stringify(publish), /actions\/github-script@v7/);
});

test('backend success must pass read-only production health before publishing, then verify the exact live descriptor', () => {
  const steps = publish.steps;
  const health = steps.findIndex(step => step.run === 'node scripts/probe-production-auth-health.mjs');
  const guard = steps.findIndex(step => step.name === 'Recheck current main and release proof before publication');
  const push = steps.findIndex(step => step.name === 'Push the verified static site to gh-pages without force');
  const live = steps.findIndex(step => step.run === 'node scripts/wait-for-live-release.mjs');
  assert.ok(health >= 0 && guard > health && push > guard && live > push);
  assert.equal(steps[health].env.PRODUCTION_PROBE_READ_ONLY, '1');
  assert.equal(steps[health].env.REQUIRE_APPS_SCRIPT_HEALTH, '1');
  assert.equal(steps[health].env.REQUIRE_BOUNDED_MAINTENANCE, '1');
  assert.equal(steps[health].env.APPS_SCRIPT_DEPLOYMENT_ID, '${{ vars.APPS_SCRIPT_PRODUCTION_DEPLOYMENT_ID }}');
  assert.equal(steps[live].env.EXPECTED_COMMIT, '${{ github.sha }}');
  assert.equal(steps[live].env.REQUIRE_CURRENT_LIVE_DESCRIPTOR, '1');
  assert.equal(steps[live].env.CANARY_BASE_URL, 'https://agmetricapp.com');
  assert.equal(steps[live].env.CANARY_WAIT_TIMEOUT_MS, '600000');
  assert.equal(steps.some(step => step['continue-on-error']), false);
  assert.doesNotMatch(JSON.stringify(steps[health]), /REQUIRE_LIVE_RELEASE_MATCH/,
    'the previous frontend remains live until the backend has passed health');
});
