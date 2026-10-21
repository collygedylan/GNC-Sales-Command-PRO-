import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mayRetryLighthouse } from '../scripts/run-release-lighthouse.mjs';
import { testScopeForPaths } from '../scripts/ci-test-scope.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const pages = yaml.load(read('.github/workflows/pages-static.yml'));
const validation = yaml.load(read('.github/workflows/release-validation.yml'));
const performance = yaml.load(read('.github/workflows/performance-monitor.yml'));
const nightly = yaml.load(read('.github/workflows/nightly-validation.yml'));
const prValidation = yaml.load(read('.github/workflows/pr-validation.yml'));
const download = yaml.load(read('.github/actions/download-release/action.yml'));

test('unit contracts can read the immutable performance baseline from Git history', () => {
  const checkout = validation.jobs.unit.steps.find(step => step.uses === 'actions/checkout@v4');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(validation.jobs.unit.needs, undefined);
});

test('superseded validation cancels only the matching workflow and PR or branch', () => {
  const names = ['release-validation', 'release-database', 'bloomscapes-pending-tests',
    'live-dataset-revisions', 'suspend-tag-tests', 'codex-mobile-path-policy'];
  const workflows = [performance, ...names.map(name => {
    const workflow = yaml.load(read(`.github/workflows/${name}.yml`));
    assert.equal(workflow.concurrency.group,
      name + '-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}');
    return workflow;
  })];
  const group = (workflow, { pr = 42, ref = 'refs/pull/42/merge', caller = performance.name, sha = 'old' } = {}) =>
    workflow.concurrency.group.replace(/\$\{\{(.*?)\}\}/g, (_, expression) => String(vm.runInNewContext(expression,
      { github: { workflow: caller, ref, sha, event: { pull_request: { number: pr } } } })));
  assert.equal(performance.concurrency.group, 'performance-${{ github.event.pull_request.number || github.ref }}');
  assert.equal(new Set(workflows.map(workflow => group(workflow))).size, workflows.length,
    'Caller and reusable children must never cancel one another');
  for (const workflow of workflows) {
    assert.equal(workflow.concurrency['cancel-in-progress'], true, workflow.name);
    assert.equal(group(workflow), group(workflow, { sha: 'new' }), 'New commits supersede the same group');
    assert.notEqual(group(workflow), group(workflow, { pr: 43 }), 'Other PRs remain independent');
    assert.notEqual(group(workflow, { pr: null, ref: 'refs/heads/main' }),
      group(workflow, { pr: null, ref: 'refs/heads/other' }), 'Manual branches remain independent');
  }
  for (const workflow of workflows.slice(1, 3)) {
    assert.notEqual(group(workflow), group(workflow, { caller: pages.name }), 'Publication callers have a distinct namespace');
  }
  for (const name of ['pages-static', 'publish-candidate', 'apps-script-sync', 'codex-ops',
    'apps-script-lifecycle-canary', 'test-sandbox-setup', 'production-auth-health', 'photo-archive', 'weather-hold-learning']) {
    assert.equal(yaml.load(read(`.github/workflows/${name}.yml`)).concurrency['cancel-in-progress'], false, name);
  }
});

test('CI commands defer retries to their configs and retain exhausted-failure gates', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.doesNotMatch(manifest.scripts['test:foundation'], /--retries/);
  for (const name of ['release-validation', 'release-database', 'pages-static']) {
    const source = read(`.github/workflows/${name}.yml`);
    assert.doesNotMatch(source, /--retries[= ]0|--fail-on-flaky-tests/);
  }
  for (const name of ['foundation', 'functional', 'compiled', 'timing']) {
    const job = validation.jobs[name];
    assert.equal(job.strategy['fail-fast'], true);
    assert.ok(job.steps.some(step => /--max-failures=1/.test(step.run || '')), name);
  }
});

test('Pages uses one current-main coordinator and binds frontend publication to its validated artifact', () => {
  assert.equal(pages.permissions.actions, 'read');
  assert.equal(validation.jobs['release-gate'].outputs['proof-id'], '${{ steps.proof.outputs.artifact-id }}');
  assert.equal(validation.on.workflow_call.outputs['proof-id'].value, '${{ jobs.release-gate.outputs.proof-id }}');
  assert.equal(validation.on.workflow_call.outputs['site-id'].value, '${{ jobs.release-gate.outputs.site-id }}');
  assert.equal(validation.jobs['release-gate'].steps.find(s => s.uses === 'actions/upload-artifact@v4').id, 'proof');
  assert.ok(pages.jobs['fast-gate'].steps.some(step => step.uses === './.github/actions/prepare-native-release'));
  assert.deepEqual(pages.on.push.branches, ['main']);
  assert.equal(pages.on.workflow_dispatch.inputs['expected-commit'].required, false);
  assert.deepEqual(pages.jobs['backend-publication'].needs, ['fast-gate']);
  assert.equal(pages.jobs.deploy.needs.includes('fast-gate'), true);
  assert.equal(pages.jobs.deploy.steps.find(s => s.uses === './.github/actions/download-release').with['run-id'],
    '${{ github.run_id }}');
  assert.equal(pages.jobs.deploy.steps.find(s => s.uses === './.github/actions/download-release').with.commit,
    '${{ github.sha }}');
  assert.equal(pages.jobs['exact-live'].needs, 'deploy');
  assert.match(pages.jobs.deploy.if, /github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(JSON.stringify(pages.jobs['fast-gate']), /run-release-unit-checks|run-release-smoke|playwright|Dockerfile/);
  const download = pages.jobs.deploy.steps.find(step => step.uses === './.github/actions/download-release');
  assert.equal(download.with.digest, '${{ needs.fast-gate.outputs.digest }}');
  assert.equal(download.with['artifact-id'], '${{ needs.fast-gate.outputs.site-id }}');
  const gate = validation.jobs['release-gate'].steps[0].run;
  assert.match(gate, /jobs\[name\]\?\.result !== 'success'/);
  assert.match(gate, /RELEASE_DIGEST_MISSING/);
  for (const job of Object.values(validation.jobs)) assert.notEqual(job['continue-on-error'], true);
  assert.equal(validation.jobs.database.uses, './.github/workflows/release-database.yml');
});

test('Pages publication directly requires current-main authorization and compact validation', () => {
  assert.match(pages.jobs['fast-gate'].if, /refs\/heads\/main/);
  assert.match(pages.jobs['fast-gate'].steps[0].with.script, /FRONTEND_EXPECTED_COMMIT_MISMATCH/);
  assert.match(pages.jobs['fast-gate'].steps[0].with.script, /FRONTEND_MAIN_SUPERSEDED/);
  assert.match(pages.jobs.deploy.if, /needs\.fast-gate\.result == 'success'/);
  assert.match(pages.jobs.deploy.if, /!cancelled\(\)/);
  assert.match(pages.jobs['exact-live'].steps.find(step => step.name === 'Report the verified live version').run,
    /\$\{version\} is now LIVE/);
  assert.match(pages.jobs['backend-publication'].steps[0].with.script, /createWorkflowDispatch/);
  assert.match(pages.jobs['backend-publication'].steps[0].with.script, /BACKEND_RUN_IDENTITY_MISMATCH/);
  const build = pages.jobs['fast-gate'].steps.find(step => step.uses === './.github/actions/prepare-native-release');
  assert.equal(build.if, "steps.classify.outputs.frontend == 'true'", 'tooling-only paths skip native compilation');
  assert.doesNotMatch(read('.github/workflows/release-database.yml'), /V238|V2311|V2313|scopedValidationReceipt|retained/);
});

test('Pages recovery scope uses a real deployment baseline and preserves tooling-only fast path', () => {
  const classify = pages.jobs['fast-gate'].steps.find(step => step.id === 'classify').run;
  assert.match(classify, /findLastSuccessfulDeploymentBaseline/);
  assert.match(classify, /packageMetadataSafe\(before\)/);
  assert.match(classify, /initialScope\.deploy\.frontend \? await recover\('frontend'\)/);
  assert.match(classify, /initialScope\.deploy\.supabase \|\| initialScope\.deploy\.appsScript/);
  assert.match(classify, /merge-base', '--is-ancestor/);
  assert.match(classify, /selectReleaseRecoveryBase/);
  assert.match(classify, /changedReleasePaths\(\{ before, after: commit \}\)/);
});

test('Pages backend handoff reuses the exact Apps Script run and checks attempt-specific jobs', async () => {
  const job = pages.jobs['backend-publication'].steps.find(step => step.uses === 'actions/github-script@v7');
  const source = job.with.script;
  const sha = 'a'.repeat(40);
  const backendWorkflow = { id: 10, path: '.github/workflows/apps-script-sync.yml', state: 'active' };
  const scriptWorkflow = { id: 11, path: '.github/workflows/apps-script-deploy.yml', state: 'active' };
  const backendRun = { id: 20, workflow_id: 10, path: backendWorkflow.path, event: 'workflow_dispatch',
    head_branch: 'main', head_sha: sha, head_repository: { full_name: 'example/app' },
    run_attempt: 3, run_number: 4, status: 'completed', conclusion: 'success' };
  const scriptRun = { id: 21, workflow_id: 11, path: scriptWorkflow.path, event: 'workflow_dispatch',
    head_branch: 'main', head_sha: sha, head_repository: { full_name: 'example/app' },
    run_attempt: 2, run_number: 5, status: 'completed', conclusion: 'success' };
  const backendJob = { id: 30, run_id: backendRun.id, head_sha: sha,
    name: 'Apply backend migrations and deploy Edge Functions', status: 'completed', conclusion: 'success' };
  const publishJob = { id: 31, run_id: scriptRun.id, head_sha: sha, name: 'deploy-apps-script',
    status: 'completed', conclusion: 'success', steps: [{ name: 'Publish the guarded production Apps Script version',
      status: 'completed', conclusion: 'success' }] };
  const attempts = [];
  const dispatches = [];
  const api = {
    git: { getRef: async () => ({ data: { object: { sha } } }) },
    actions: {
      getWorkflow: async ({ workflow_id }) => ({ data: workflow_id === 'apps-script-sync.yml' ? backendWorkflow : scriptWorkflow }),
      listWorkflowRuns: async ({ workflow_id }) => ({ data: workflow_id === 10 ? [backendRun] : [scriptRun] }),
      getWorkflowRun: async ({ run_id }) => ({ data: run_id === backendRun.id ? backendRun : scriptRun }),
      listJobsForWorkflowRunAttempt: async args => {
        attempts.push(args);
        return { data: { jobs: args.run_id === backendRun.id ? [backendJob] : [publishJob] } };
      },
      createWorkflowDispatch: async args => { dispatches.push(args); return { status: 204 }; },
    },
  };
  const github = { rest: api, paginate: async (method, args) => (await method(args)).data };
  const context = { repo: { owner: 'example', repo: 'app' }, runId: 44 };
  const process = { env: { EXPECTED_COMMIT: sha, COORDINATOR_RUN_ATTEMPT: '7', REQUIRE_SUPABASE: 'true',
    REQUIRE_APPS_SCRIPT: 'true', RELEASE_MIGRATIONS: '["supabase/migrations/m.sql"]', RELEASE_EDGE_FUNCTIONS: '["app-api"]' } };
  await vm.runInNewContext(`(async () => {${source}\n})()`, {
    github, context, process, Date, setTimeout: callback => setTimeout(callback, 0),
  });
  assert.deepEqual(attempts.map(({ run_id, attempt_number }) => [run_id, attempt_number]), [[20, 3], [21, 2]]);
  assert.deepEqual(dispatches, [], 'a matching successful Apps Script run is reused');
  assert.match(source, /process\.env\.COORDINATOR_RUN_ATTEMPT/);
  assert.equal(Object.hasOwn(context, 'runAttempt'), false, 'the workflow attempt comes from the trusted environment input');
});

test('Pages backend handoff rejects a stale run identity before accepting its attempt jobs', async () => {
  const job = pages.jobs['backend-publication'].steps.find(step => step.uses === 'actions/github-script@v7');
  const source = job.with.script;
  const sha = 'b'.repeat(40);
  const workflow = { id: 10, path: '.github/workflows/apps-script-sync.yml', state: 'active' };
  const run = { id: 20, workflow_id: 10, path: workflow.path, event: 'workflow_dispatch', head_branch: 'main',
    head_sha: sha, head_repository: { full_name: 'example/app' }, run_attempt: 3, run_number: 4,
    status: 'completed', conclusion: 'success' };
  const staleRun = { ...run, head_sha: 'c'.repeat(40) };
  const api = { git: { getRef: async () => ({ data: { object: { sha } } }) }, actions: {
    getWorkflow: async () => ({ data: workflow }),
    listWorkflowRuns: async () => ({ data: [run] }),
    getWorkflowRun: async () => ({ data: staleRun }),
    listJobsForWorkflowRunAttempt: async () => ({ data: { jobs: [] } }),
    createWorkflowDispatch: async () => ({ status: 204 }),
  } };
  const github = { rest: api, paginate: async (method, args) => (await method(args)).data };
  const context = { repo: { owner: 'example', repo: 'app' }, runId: 44 };
  const process = { env: { EXPECTED_COMMIT: sha, COORDINATOR_RUN_ATTEMPT: '7', REQUIRE_SUPABASE: 'true',
    REQUIRE_APPS_SCRIPT: 'false', RELEASE_MIGRATIONS: '[]', RELEASE_EDGE_FUNCTIONS: '[]' } };
  await assert.rejects(vm.runInNewContext(`(async () => {${source}\n})()`, {
    github, context, process, Date, setTimeout: callback => setTimeout(callback, 0),
  }), /BACKEND_RUN_IDENTITY_MISMATCH/);
});

test('expanded browser shards remain intact for the nightly workflow, outside standard release validation', () => {
  assert.deepEqual(validation.jobs.functional.strategy.matrix.project, ['chromium','firefox','webkit']);
  assert.deepEqual(validation.jobs.functional.strategy.matrix.shard, [1,2,3,4]);
  for (const name of ['foundation','functional','compiled','timing']) {
    assert.equal(validation.jobs[name].strategy['fail-fast'], true);
    assert.equal(validation.jobs[name].strategy['max-parallel'], undefined);
  }
  assert.match(validation.jobs.functional.steps.find(s => s.run?.includes('playwright test')).run, /--workers=1.*--shard=.*--project=.*--max-failures=1/);
  const entries = validation.jobs.compiled.strategy.matrix.include;
  assert.equal(entries.filter(x => x.suite === 'command-center').length, 1);
  const home = entries.filter(x => x.config === 'playwright.home-role.config.ts');
  assert.equal(home.length, 8);
  for (const project of new Set(home.map(x => x.project))) {
    assert.deepEqual(home.filter(x => x.project === project).map(x => [x.shard,x.total]), [[1,2],[2,2]]);
  }
  const hl = entries.filter(x => x.config === 'playwright.hl-order.config.ts');
  assert.deepEqual(hl.map(x => x.project), ['cache-chromium','cache-firefox','cache-webkit','cache-android','cache-iphone']);
  assert.ok(hl.every(x => x.shard === 1 && x.total === 1));
  assert.equal(validation.jobs.compiled['timeout-minutes'], 20);
  assert.match(validation.jobs.compiled.steps.find(s => s.run?.includes('playwright test')).run, /--workers=1.*--project=.*--shard=.*--max-failures=1/);
  assert.deepEqual(validation.jobs.timing.strategy.matrix.include.map(x=>[x.project,x.config]), [
    ['chromium','playwright.release-timing.config.ts'], ['firefox','playwright.release-timing.config.ts'],
    ['webkit','playwright.release-timing.config.ts'], ['android','playwright.release-android.config.ts']
  ]);
  const preview = validation.jobs.timing.steps.filter(s => s.run === 'node scripts/check-isolated-preview.mjs');
  assert.equal(preview.length, 1);
  assert.equal(preview[0].if, "matrix.project == 'chromium'");
  assert.equal(validation.jobs.lighthouse['runs-on'], 'ubuntu-latest');
  for (const name of ['foundation','functional','compiled','timing','performance','lighthouse']) {
    assert.match(validation.jobs[name].if, /inputs\.run-nightly-suites/);
  }
  assert.equal(nightly.on.schedule[0].cron, '30 1,2 * * *');
  assert.ok('workflow_dispatch' in nightly.on);
  assert.equal(nightly.jobs['expanded-validation'].with['run-nightly-suites'], true);
  assert.equal(nightly.jobs['expanded-validation'].with['run-schema-tests'], false);
  assert.equal(validation.jobs['release-mode'].steps[0].env.RUN_NIGHTLY_SUITES, '${{ inputs.run-nightly-suites }}');
  assert.match(validation.jobs['release-mode'].steps[0].with.script, /const nightly = process\.env\.RUN_NIGHTLY_SUITES === 'true'/);
  assert.match(validation.jobs['release-mode'].steps[0].with.script, /let hotfix = !nightly/);
  assert.equal(validation.jobs['release-mode'].steps[0].env.RUN_NIGHTLY_SUITES, '${{ inputs.run-nightly-suites }}');
  assert.match(validation.jobs['release-mode'].steps[0].with.script, /const nightly = process\.env\.RUN_NIGHTLY_SUITES === 'true'/);
  assert.match(validation.jobs['release-mode'].steps[0].with.script, /let hotfix = !nightly/);
});

test('every build consumer verifies the original manifest, never rebuilds or reseals', () => {
  for (const name of ['foundation','functional','compiled','timing','performance','lighthouse']) {
    const job = validation.jobs[name];
    assert.deepEqual(job.needs, ['build', 'release-mode']);
    assert.equal(job.steps.filter(s => s.uses === './.github/actions/download-release').length, 1);
    assert.doesNotMatch(job.steps.map(s=>s.run||'').join('\n'), /npm run build|artifact\.mjs seal/);
  }
  const publish = pages.jobs.deploy.steps;
  assert.ok(publish.some(s=>s.uses === './.github/actions/download-release'));
  assert.ok(publish.some(s=>s.run?.includes('HEAD:gh-pages')));
  assert.doesNotMatch(publish.map(s=>s.run||'').join('\n'), /npm run build|artifact\.mjs seal/);
  assert.equal(publish.find(s=>s.uses === './.github/actions/download-release').with.commit, '${{ github.sha }}');
  assert.match(download.runs.steps[1].run, /release-artifact.mjs verify/);
  assert.equal(download.runs.steps[1].env.EXPECTED_RELEASE_DIGEST, '${{ inputs.digest }}');
  assert.equal(download.runs.steps[1].env.EXPECTED_RELEASE_COMMIT, '${{ inputs.commit || github.sha }}');
  assert.equal(download.runs.steps[1].env.GITHUB_SHA, undefined);
  assert.equal(validation.jobs.build.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@')).with['include-hidden-files'], true);
});

test('nightly performance remains a serial paired comparison with immutable baseline evidence', () => {
  const job = validation.jobs.performance;
  assert.equal(job.strategy, undefined, 'matched measurements share one quiet runner');
  assert.ok(job.steps.some(step => step.run === 'node scripts/build-performance-baseline.mjs'));
  assert.ok(job.steps.some(step => step.run === 'node scripts/run-performance-browser.mjs'));
  assert.ok(job.steps.some(step => step.run === 'node scripts/release-artifact.mjs verify'));
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.path, 'artifacts/performance');
  assert.match(validation.jobs['release-gate'].steps[0].run, /RUN_NIGHTLY_SUITES/);
});

test('Pages coordinator selects tooling, frontend, and backend work in one fast gate', () => {
  assert.deepEqual(pages.on.push.branches, ['main']);
  assert.ok('workflow_dispatch' in pages.on);
  assert.equal(performance.on.push, undefined);
  assert.ok('pull_request' in performance.on);
  assert.equal(performance.on.schedule, undefined);
  assert.ok('schedule' in nightly.on);
  assert.equal(performance.jobs.validation.uses, './.github/workflows/pr-validation.yml');
  assert.equal(performance.jobs['diagnostic-validation'].uses, './.github/workflows/release-validation.yml');
  assert.deepEqual(Object.keys(pages.jobs), ['fast-gate', 'backend-publication', 'deploy', 'exact-live']);
  assert.equal(pages.jobs['fast-gate'].strategy, undefined);
  const steps = pages.jobs['fast-gate'].steps;
  assert.ok(steps.some(step => step.run === 'npm run check:inline'));
  assert.ok(steps.some(step => step.run === 'node scripts/run-tooling-release-checks.mjs'));
  for (const step of steps.filter(step => step.uses === './.github/actions/prepare-native-release' || ['seal', 'site'].includes(step.id))) {
    assert.equal(step.if, "steps.classify.outputs.frontend == 'true'");
  }
  assert.match(JSON.stringify(pages.jobs['backend-publication']), /APPS_SCRIPT|SUPABASE/);
  assert.equal(pages.concurrency['cancel-in-progress'], false);
  assert.match(pages.jobs['fast-gate'].if, /github.ref == 'refs\/heads\/main'/);
  assert.ok(pages.on.workflow_dispatch.inputs['expected-commit']);
  assert.doesNotMatch(JSON.stringify(pages.jobs['fast-gate']), /SUPABASE_SERVICE_ROLE_KEY|APPS_SCRIPT_DEPLOYMENT_ID|probe-production-auth-health/);
});

test('scheduled live canaries await main and run outside the release publication path', () => {
  assert.equal(pages.jobs['exact-live'].needs, 'deploy');
  assert.equal(pages.jobs['exact-live'].steps.find(step => step.name === 'Wait for the current live descriptor and immutable fingerprint').env.EXPECTED_COMMIT,
    '${{ needs.deploy.outputs.build-commit }}');
  assert.equal(pages.jobs['post-deployment-canary'], undefined);
  assert.deepEqual(nightly.jobs['post-deployment-canary'].needs, ['central-time-gate', 'current-live-release']);
  const matrix = nightly.jobs['post-deployment-canary'].strategy.matrix.include;
  assert.deepEqual([...new Set(matrix.map(x=>x.suite))], ['foundation','requests','session','login-photo']);
  assert.match(matrix.find(x=>x.suite==='requests').command, /--config playwright\.production\.config\.ts/);
  assert.deepEqual(matrix.filter(x=>x.suite==='login-photo').map(x=>x.project), ['chromium','webkit','android']);
  assert.equal(matrix.length, 9);
  assert.equal(nightly.jobs['post-deployment-canary'].strategy['fail-fast'], true);
  for (const row of matrix) assert.match(row.command, /--project=.*--workers=1.*--max-failures=1/);
  const liveCanary = nightly.jobs['post-deployment-canary'].steps.find(step => step.name?.startsWith('Mutation-blocked live'));
  assert.equal(liveCanary.env.APP_LIFECYCLE_BASE_URL, 'https://agmetricapp.com');
  assert.equal(liveCanary.env.SESSION_RECOVERY_BASE_URL, 'https://agmetricapp.com');
  assert.equal(liveCanary.env.LOGIN_PHOTO_BASE_URL, 'https://agmetricapp.com');
  assert.equal(liveCanary.env.EXPECTED_COMMIT, '${{ github.sha }}');
  const health = validation.jobs['production-health'].steps.find(s=>s.name === 'Probe production login bridge and Data API');
  assert.equal(health.env.PRODUCTION_PROBE_READ_ONLY, '1');
  assert.equal(validation.permissions.contents, 'read');
  assert.equal(pages.permissions.contents, 'read');
});

test('Lighthouse only retries protocol failures and preserves assertion failures', () => {
  assert.equal(mayRetryLighthouse(1, 'PROTOCOL_TIMEOUT', 1), true);
  assert.equal(mayRetryLighthouse(1, 'PROTOCOL_TIMEOUT', 3), false);
  assert.equal(mayRetryLighthouse(0, 'PROTOCOL_TIMEOUT', 1), false);
  assert.equal(mayRetryLighthouse(1, 'categories:performance assertion failed', 1), false);
});

test('execute the actual nightly release gate: failed, skipped, cancelled or missing selected lanes cannot pass', () => {
  const gate = validation.jobs['release-gate'].steps[0].run;
  const executable = gate.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, '');
  const healthy = Object.fromEntries(validation.jobs['release-gate'].needs.map(name => [name, {result: 'success'}]));
  healthy.build.outputs = {digest: 'a'.repeat(64)};
  function run(results, nightly = true) {
    return vm.runInNewContext(executable, {process: {env: {
      RELEASE_JOB_RESULTS: JSON.stringify(results), HOTFIX: 'false', RUN_NIGHTLY_SUITES: String(nightly),
      RUN_FRONTEND_TESTS: 'true', RUN_BACKEND_TESTS: 'true',
    }}, console: {log() {}}});
  }
  const daytime = Object.fromEntries(Object.keys(healthy).map(name => [name, { result: 'skipped' }]));
  daytime['release-mode'] = { result: 'success' };
  daytime.build = healthy.build;
  assert.doesNotThrow(() => run(daytime, false), 'daytime delivery does not require skipped nightly matrices');
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.throws(() => run({ ...daytime, build: { result } }, false), /RELEASE_GATE_FAILED_build/);
  }
  assert.doesNotThrow(() => run(healthy));
  for (const name of ['release-mode','lint','unit','react','contracts','database','build']) {
    for (const result of ['failure','cancelled','skipped']) {
      assert.throws(() => run({...healthy, [name]: {...healthy[name], result}}), /RELEASE_GATE_FAILED/);
    }
    const missing = structuredClone(healthy);
    delete missing[name];
    assert.throws(() => run(missing), /RELEASE_GATE_FAILED/);
  }
  healthy.build.outputs.digest = '';
  assert.throws(() => run(healthy), /RELEASE_DIGEST_MISSING/);
});

test('standard PR validation is one focused job; browser matrices run only nightly', () => {
  assert.equal(performance.jobs.validation.uses, './.github/workflows/pr-validation.yml');
  assert.equal(performance.jobs['diagnostic-validation'].uses, './.github/workflows/release-validation.yml');
  assert.equal(performance.jobs['diagnostic-validation'].with['run-nightly-suites'], false);
  assert.deepEqual(Object.keys(prValidation.jobs), ['fast-pr']);
  assert.equal(prValidation.jobs['fast-pr'].strategy, undefined);
  assert.equal(prValidation.jobs['fast-pr'].if, undefined);
  assert.ok(prValidation.jobs['fast-pr'].steps.some(step => step.run === 'npm run check:inline'));
  assert.ok(prValidation.jobs['fast-pr'].steps.some(step => step.run === 'node scripts/run-tooling-release-checks.mjs'));
  assert.doesNotMatch(JSON.stringify(prValidation.jobs['fast-pr']), /run-release-unit-checks|run-release-react-checks|run-discovered-tests|release-database|playwright|chromium|lighthouse|performance|upload-artifact/i);
  for (const name of ['foundation', 'functional', 'compiled', 'timing', 'performance', 'lighthouse']) {
    assert.match(validation.jobs[name].if, /needs\.release-mode\.outputs\.hotfix != 'true'/);
    assert.match(validation.jobs[name].if, /inputs\.run-nightly-suites/);
    assert.match(validation.jobs[name].if, /github.ref == 'refs\/heads\/main'/);
    assert.match(validation.jobs[name].if, /inputs.run-frontend-tests/);
  }
  for (const name of ['contracts', 'database', 'production-health']) {
    assert.match(validation.jobs[name].if, /needs\.release-mode\.outputs\.hotfix != 'true'/);
  }
  const database = yaml.load(read('.github/workflows/release-database.yml'));
  for (const name of ['integration', 'schema-contracts', 'database-and-functions', 'suspend-tag-approval']) {
    assert.match(database.jobs[name].if, /inputs\.run-schema-tests/);
    assert.match(database.jobs[name].if, /needs\.schema-path-scope\.outputs\.changed == 'true'/);
  }
  assert.match(validation.jobs['fast-browser'].if, /inputs\.run-nightly-suites/);
});

test('production health recovery follows actual publication and the published build commit', async () => {
  const auth = yaml.load(read('.github/workflows/production-auth-health.yml'));
  const script = auth.jobs['published-release'].steps[0].with.script;
  const runSha = 'a'.repeat(40), buildSha = 'b'.repeat(40);
  async function run({event = 'workflow_run', branch = 'main', deployed = true, descriptor = 'valid', runOverrides = {},
    eventOverrides = {}, jobsOverride, descriptorOverride} = {}) {
    const outputs = {};
    const eventRun = {head_branch:branch,id:1,run_attempt:2,head_sha:runSha,...eventOverrides};
    const pageRun = {id:1,path:'.github/workflows/pages-static.yml',event:'push',status:'completed',conclusion:'success',
      run_attempt:2,head_sha:runSha,head_branch:branch,head_repository:{full_name:'test/test'},...runOverrides};
    const jobsApi = () => {}, artifactsApi = () => {}, getRunApi = () => {};
    const descriptorRows = descriptorOverride || (descriptor === 'valid' ? [{id:17,name:'pages-publication-2',expired:false,
      expires_at:'2999-01-01T00:00:00Z',workflow_run:{id:1,head_sha:runSha}}] : descriptor === 'missing' ? []
      : descriptor === 'duplicate' ? [
        {id:17,name:'pages-publication-2',expired:false,expires_at:'2999-01-01T00:00:00Z',workflow_run:{id:1,head_sha:runSha}},
        {id:18,name:'pages-publication-2',expired:false,expires_at:'2999-01-01T00:00:00Z',workflow_run:{id:1,head_sha:runSha}},
      ] : [{id:17,name:'pages-publication-2',expired:descriptor !== 'expired',
        expires_at:descriptor === 'expired' ? '2000-01-01T00:00:00Z' : '2999-01-01T00:00:00Z',workflow_run:{id:1,head_sha:runSha}}]);
    const jobs = jobsOverride || [{name:'deploy',run_id:1,head_sha:runSha,status:'completed',conclusion:deployed?'success':'skipped',
      steps:[{name:'Deploy verified artifact to Pages',status:'completed',conclusion:deployed?'success':'skipped'}]}];
    const calls = [];
    const execute = vm.runInNewContext(`(async () => {${script}})`, {
      context: {eventName: event, repo: {owner:'test',repo:'test'}, payload:{workflow_run:eventRun}, sha:buildSha},
      core: {setOutput(key,value) { outputs[key] = value; }, notice() {}},
      github: {
        paginate:async(method, params)=> { calls.push({method,params});
          if (method === jobsApi && !Object.hasOwn(params, 'attempt_number')) {
            throw new Error('listJobsForWorkflowRunAttempt requires attempt_number');
          }
          return method === jobsApi ? jobs : method === artifactsApi ? descriptorRows : []; },
        rest:{actions:{getWorkflowRun: async params => { calls.push({method:getRunApi,params}); return {data:pageRun}; },
          listJobsForWorkflowRunAttempt:jobsApi,listWorkflowRunArtifacts:artifactsApi}},
      },
    });
    await execute();
    return {outputs,calls};
  }
  const published = await run();
  assert.equal(published.outputs['should-probe'], 'true');
  assert.equal(published.outputs['expected-commit'], runSha);
  assert.equal(published.outputs['descriptor-id'], '17');
  const jobRequest = published.calls.find(call => call.method.name === 'jobsApi');
  assert.equal(jobRequest.params.attempt_number, 2);
  assert.equal(Object.hasOwn(jobRequest.params, 'run_attempt'), false,
    'the Octokit endpoint uses attempt_number, not run_attempt');
  const notDeployed = await run({deployed:false});
  assert.equal(notDeployed.outputs['should-probe'], 'false');
  assert.equal((await run({jobsOverride:[{name:'deploy',run_id:1,head_sha:runSha,status:'completed',conclusion:'failure',
    steps:[{name:'Deploy verified artifact to Pages',status:'completed',conclusion:'failure'}]}]})).outputs['should-probe'], 'false',
  'a failed deployment is not publication');
  assert.equal((await run({runOverrides:{conclusion:'failure'}})).outputs['should-probe'], 'true',
    'a failed later canary does not hide a successful Pages deployment');
  for (const runOverrides of [
    {path:'.github/workflows/other.yml'}, {event:'pull_request'}, {status:'in_progress'},
    {run_attempt:3}, {head_sha:'c'.repeat(40)}, {head_branch:'preview'},
    {head_repository:{full_name:'fork/test'}},
  ]) assert.equal((await run({runOverrides})).outputs['should-probe'], 'false', JSON.stringify(runOverrides));
  assert.equal((await run({branch:'fix/benchmark'})).outputs['should-probe'], 'false');
  assert.equal((await run({event:'schedule'})).outputs['should-probe'], 'true');
  assert.equal((await run({eventOverrides:{run_attempt:3}})).outputs['should-probe'], 'false',
    'a stale event for an earlier attempt cannot trigger a publication probe');
  assert.equal((await run({descriptor:'missing'})).outputs['descriptor-id'], undefined, 'legacy publication keeps the fallback path');
  for (const descriptor of ['duplicate','expired']) await assert.rejects(run({descriptor}), /PAGES_PUBLICATION_DESCRIPTOR_/);
  await assert.rejects(run({descriptorOverride:[{id:17,name:'pages-publication-2',expired:false,
    expires_at:'2999-01-01T00:00:00Z',workflow_run:{id:2,head_sha:runSha}}]}), /PAGES_PUBLICATION_DESCRIPTOR_ARTIFACT_INVALID/);
  assert.equal((await run({jobsOverride:[]})).outputs['should-probe'], 'false', 'missing deploy job is not publication');
  assert.equal((await run({jobsOverride:[
    {name:'deploy',run_id:1,head_sha:runSha,status:'completed',conclusion:'success',steps:[{name:'Deploy to Pages',status:'completed',conclusion:'success'}]},
    {name:'deploy',run_id:1,head_sha:runSha,status:'completed',conclusion:'success',steps:[{name:'Deploy to Pages',status:'completed',conclusion:'success'}]},
  ]})).outputs['should-probe'], 'false', 'ambiguous deploy jobs are not publication');
  const descriptorScript = auth.jobs['published-release'].steps.find(step => step.id === 'descriptor').run;
  assert.match(descriptorScript, /value\.buildCommit/);
  assert.match(descriptorScript, /value\.repository !== process\.env\.GITHUB_REPOSITORY/);
  assert.match(descriptorScript, /value\.runId !== Number\(process\.env\.PAGES_RUN_ID\)/);
  assert.match(descriptorScript, /expected-commit=\$\{process\.env\.PAGES_RUN_SHA\}/);
  assert.equal(auth.jobs.probe.steps.find(step => step.name?.includes('exact live release')).env.EXPECTED_COMMIT,
    '${{ needs.published-release.outputs.expected-commit }}');
});

test('PR path filters select affected tests and match the artifact reuse classifier', () => {
  const filter = performance.jobs.changes.steps.find(step => step.id === 'filter');
  const patterns = yaml.load(filter.with.filters);
  const picomatch = require('picomatch');
  assert.equal(filter.with['predicate-quantifier'], 'every');
  assert.equal(performance.jobs.changes.permissions['pull-requests'], 'read');
  const cases = [
    [['supabase/functions/aura-llm-router/index.ts'], { frontend: false, backend: true, schema: true }],
    [['services/reclassMove.ts'], { frontend: true, backend: true, schema: false }],
    [['supabase/migrations/fixture.sql'], { frontend: false, backend: true, schema: true }],
    [['deno.lock', 'deno.jsonc'], { frontend: false, backend: true, schema: false }],
    [['docs/release.md'], { frontend: false, backend: false, schema: false }],
    [['migrations/fixture.sql'], { frontend: false, backend: true, schema: false }],
    [['database/schema.sql'], { frontend: false, backend: true, schema: true }],
    [['v2/src/App.tsx', 'styles/main.css'], { frontend: true, backend: false, schema: false }],
    [['supabase/functions/app-api/index.ts', 'index.html'], { frontend: true, backend: true, schema: true }],
    [['package-lock.json'], { frontend: true, backend: true, schema: false }],
    [['.github/workflows/release-validation.yml'], { frontend: true, backend: true, schema: false }],
    [['scripts/ci-test-scope.mjs', 'tests/release-pipeline.test.mjs'], { frontend: true, backend: true, schema: false }],
  ];
  for (const [paths, expected] of cases) {
    const actual = Object.fromEntries(Object.entries(patterns).map(([name, rules]) =>
      [name, paths.some(path => rules.every(rule => picomatch(rule, { dot: true })(path)))]));
    assert.deepEqual(actual, expected, paths.join(','));
    if (!paths.some(path => path.startsWith('database/'))) {
      const helper = testScopeForPaths(paths);
      assert.deepEqual({ frontend: helper.frontend, backend: helper.backend },
        { frontend: actual.frontend, backend: actual.backend }, 'reuse must enforce matching frontend/backend categories');
    }
  }
  assert.equal(validation.on.workflow_call.inputs['run-frontend-tests'].default, true);
  assert.equal(validation.on.workflow_call.inputs['run-backend-tests'].default, true);
  assert.equal(validation.on.workflow_call.inputs['run-schema-tests'].default, false);
  assert.equal(performance.jobs.validation.uses, './.github/workflows/pr-validation.yml');
});

test('the release gate accepts only intentional skips and still requires the immutable build', () => {
  const gate = validation.jobs['release-gate'].steps[0].run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, '');
  const frontend = ['react','fast-browser','foundation','functional','compiled','timing','performance','lighthouse'];
  for (const scope of [{ frontend: true, backend: false, schema: false }, { frontend: false, backend: true, schema: true }]) {
    const results = Object.fromEntries(validation.jobs['release-gate'].needs.map(name => [name, { result: 'success' }]));
    results.build.outputs = { digest: 'a'.repeat(64) };
    for (const name of scope.frontend ? ['database'] : frontend) results[name].result = 'skipped';
    const execute = () => vm.runInNewContext(gate, { process: { env: {
      RELEASE_JOB_RESULTS: JSON.stringify(results), HOTFIX: 'false', RUN_NIGHTLY_SUITES: 'true',
      RUN_FRONTEND_TESTS: String(scope.frontend), RUN_BACKEND_TESTS: String(scope.backend),
    } }, console: { log() {} } });
    assert.doesNotThrow(execute);
    const selected = scope.frontend ? 'react' : 'database';
    for (const result of ['failure', 'cancelled', 'skipped']) {
      results[selected].result = result;
      assert.throws(execute, /RELEASE_GATE_FAILED/);
    }
    results[selected].result = 'success';
    results.build.result = 'skipped';
    assert.throws(execute, /RELEASE_GATE_FAILED_build/);
  }
});
