import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mayRetryLighthouse } from '../scripts/run-release-lighthouse.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const pages = yaml.load(read('.github/workflows/pages-static.yml'));
const validation = yaml.load(read('.github/workflows/release-validation.yml'));
const performance = yaml.load(read('.github/workflows/performance-monitor.yml'));
const download = yaml.load(read('.github/actions/download-release/action.yml'));

test('all safety lanes must succeed before the sealed release can deploy', () => {
  assert.equal(pages.permissions.actions, 'read');
  assert.equal(validation.jobs['release-gate'].outputs['proof-id'], '${{ steps.proof.outputs.artifact-id }}');
  assert.equal(validation.on.workflow_call.outputs['proof-id'].value, '${{ jobs.release-gate.outputs.proof-id }}');
  assert.equal(validation.on.workflow_call.outputs['site-id'].value, '${{ jobs.release-gate.outputs.site-id }}');
  assert.equal(validation.jobs['release-gate'].steps.find(s => s.uses === 'actions/upload-artifact@v4').id, 'proof');
  const select = pages.jobs['select-candidate'];
  assert.equal(select.outputs.reuse, '${{ steps.select.outputs.reuse }}');
  for (const output of ['run-id','attempt','site-id','proof-id','build-commit']) {
    assert.equal(select.outputs[output], `\u0024{{ steps.select.outputs.${output} }}`);
  }
  assert.equal(select.steps.find(s => s.id === 'select').run, 'node scripts/pages-release.mjs select');
  assert.equal(pages.jobs['candidate-validation'].uses, './.github/workflows/release-validation.yml');
  assert.match(pages.jobs['candidate-validation'].if, /needs\.select-candidate\.outputs\.reuse != 'true'/);
  assert.equal(pages.jobs.deploy.needs, 'validation');
  assert.match(pages.jobs.validation.if, /needs\.select-candidate\.outputs\.reuse == 'true'/);
  const validationVerify = pages.jobs.validation.steps.find(s => s.run === 'node scripts/pages-release.mjs verify');
  assert.ok(validationVerify);
  assert.equal(validationVerify.env.RELEASE_PROOF_RUN_ID,
    "\u0024{{ needs.select-candidate.outputs.reuse == 'true' && needs.select-candidate.outputs.run-id || needs.candidate-validation.outputs.run-id }}");
  assert.equal(validationVerify.env.RELEASE_PROOF_ID,
    "\u0024{{ needs.select-candidate.outputs.reuse == 'true' && needs.select-candidate.outputs.proof-id || needs.candidate-validation.outputs.proof-id }}");
  assert.equal(validationVerify.env.RELEASE_PROOF_DIGEST,
    '${{ needs.candidate-validation.outputs.digest }}');
  assert.equal(pages.jobs.validation.outputs['build-commit'], '${{ steps.verify.outputs.build-commit }}');
  assert.equal(pages.jobs.validation.outputs.digest, '${{ steps.verify.outputs.digest }}');
  const deployVerify = pages.jobs.deploy.steps.find(s => s.run === 'node scripts/pages-release.mjs verify');
  assert.equal(deployVerify.env.RELEASE_PROOF_DIGEST, '${{ needs.validation.outputs.digest }}');
  assert.equal(deployVerify.env.RELEASE_BUILD_COMMIT, '${{ needs.validation.outputs.build-commit }}');
  assert.equal(pages.jobs.validation.uses, undefined);
  assert.match(pages.jobs.deploy.if, /github.ref == 'refs\/heads\/main'/);
  assert.deepEqual(validation.jobs['release-gate'].needs, ['unit','database','build','foundation','functional','compiled','timing','lighthouse','production-health']);
  const gate = validation.jobs['release-gate'].steps[0].run;
  assert.match(gate, /jobs\[name\]\?\.result !== 'success'/);
  assert.match(gate, /RELEASE_DIGEST_MISSING/);
  for (const job of Object.values(validation.jobs)) assert.notEqual(job['continue-on-error'], true);
  assert.equal(validation.jobs.database.uses, './.github/workflows/release-database.yml');
});

test('Pages job guards allow validated reuse without ignoring failures or cancellation', () => {
  function eligible(job, needs, { ref = 'refs/heads/main', cancelled = false } = {}) {
    const condition = pages.jobs[job].if;
    // A status function is required to override GitHub's implicit success()
    // when candidate-validation is intentionally skipped in the ancestor DAG.
    assert.match(condition, /!cancelled\(\)/, `${job} must handle the skipped reuse ancestor`);
    const expression = condition.replace(/needs\.([\w-]+)/g, 'needs["$1"]');
    return vm.runInNewContext(expression, { needs, github: { ref }, cancelled: () => cancelled });
  }
  const valid = {
    validation: { result: 'success' },
    deploy: { result: 'success', outputs: { published: 'true' } },
    'exact-live': { result: 'success' },
  };
  for (const job of ['deploy', 'exact-live', 'post-deployment-canary']) {
    assert.equal(eligible(job, valid), true, `${job}: valid reused candidate`);
    assert.equal(eligible(job, valid, { cancelled: true }), false, `${job}: cancelled workflow`);
  }
  assert.equal(eligible('deploy', valid, { ref: 'refs/heads/codex/example' }), false);
  for (const result of ['failure', 'skipped', 'cancelled', '']) {
    assert.equal(eligible('deploy', { ...valid, validation: { result } }), false);
    for (const job of ['exact-live', 'post-deployment-canary']) {
      assert.equal(eligible(job, { ...valid, deploy: { ...valid.deploy, result } }), false);
    }
    assert.equal(eligible('post-deployment-canary', { ...valid, 'exact-live': { result } }), false);
  }
  for (const published of ['false', '', undefined]) {
    for (const job of ['exact-live', 'post-deployment-canary']) {
      assert.equal(eligible(job, { ...valid, deploy: { result: 'success', outputs: { published } } }), false);
    }
  }
});

test('browser shards and compiled suites use isolated runners without racing performance tests', () => {
  assert.deepEqual(validation.jobs.functional.strategy.matrix.shard, [1,2,3,4]);
  assert.equal(validation.jobs.functional.strategy['max-parallel'], 4);
  assert.equal(validation.jobs.functional.strategy['fail-fast'], false);
  assert.match(validation.jobs.functional.steps.find(s => s.run?.includes('playwright test')).run, /--workers=1.*--shard=/);
  assert.deepEqual(validation.jobs.compiled.strategy.matrix.include.map(x => x.suite), ['production-requests','footer','home-1','home-2','season','season-priority','suspend','docks','av-blanks','session','assignedto','verified-cache','request-reliability','request-photo','bunch-note','sales-mobile','module-mobile','production-schedule-mobile','hl-order-1','hl-order-2','hl-order-3','hl-restock','stable-refresh']);
  const home = validation.jobs.compiled.strategy.matrix.include.filter(x => x.config === 'playwright.home-role.config.ts');
  assert.deepEqual(home.map(x => x.shard), ['1/2','2/2']);
  const hl = validation.jobs.compiled.strategy.matrix.include.filter(x => x.config === 'playwright.hl-order.config.ts');
  assert.deepEqual(hl.map(x => x.shard), ['1/3','2/3','3/3']);
  assert.equal(validation.jobs.compiled['timeout-minutes'], 20);
  assert.match(validation.jobs.compiled.steps.find(s => s.run?.includes('playwright test')).run, /--workers=1.*matrix.shard.*--shard=/);
  assert.match(validation.jobs.timing.steps.map(s=>s.run||'').join('\n'), /playwright.release-timing.config.ts --workers=1/);
  assert.match(validation.jobs.timing.steps.map(s=>s.run||'').join('\n'), /playwright.release-android.config.ts --project=android --workers=1/);
  assert.equal(validation.jobs.lighthouse['runs-on'], 'ubuntu-latest');
});

test('every build consumer verifies the original manifest, never rebuilds or reseals', () => {
  for (const name of ['foundation','functional','compiled','timing','lighthouse']) {
    const job = validation.jobs[name];
    assert.deepEqual(job.needs, ['functional','compiled'].includes(name) ? ['build','foundation'] : 'build');
    assert.equal(job.steps.filter(s => s.uses === './.github/actions/download-release').length, 1);
    assert.doesNotMatch(job.steps.map(s=>s.run||'').join('\n'), /npm run build|artifact\.mjs seal/);
  }
  const publish = pages.jobs.deploy.steps;
  assert.ok(publish.findIndex(s=>s.uses === './.github/actions/download-release') < publish.findIndex(s=>s.uses?.startsWith('actions/deploy-pages@')));
  assert.doesNotMatch(publish.map(s=>s.run||'').join('\n'), /npm run build|artifact\.mjs seal/);
  assert.equal(publish.find(s=>s.uses === './.github/actions/download-release').with.commit,
    '${{ needs.validation.outputs.build-commit }}');
  assert.match(download.runs.steps[1].run, /release-artifact.mjs verify/);
  assert.equal(download.runs.steps[1].env.EXPECTED_RELEASE_DIGEST, '${{ inputs.digest }}');
  assert.equal(download.runs.steps[1].env.EXPECTED_RELEASE_COMMIT, '${{ inputs.commit || github.sha }}');
  assert.equal(download.runs.steps[1].env.GITHUB_SHA, undefined);
  assert.equal(validation.jobs.build.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@')).with['include-hidden-files'], true);
});

test('main runs validation once and a feature benchmark cannot publish or change production health', () => {
  assert.ok(pages.on.push.branches.includes('main'));
  assert.equal(performance.on.push, undefined);
  assert.ok('pull_request' in performance.on);
  assert.ok('schedule' in performance.on);
  assert.equal(performance.jobs.validation.uses, './.github/workflows/release-validation.yml');
  assert.doesNotMatch(pages.jobs.validation.steps.map(s=>s.run||'').join('\n'), /build:|playwright|run-release-unit/);
  assert.equal(pages.concurrency['cancel-in-progress'], false);
  assert.match(pages.jobs.validation.if, /github.ref == 'refs\/heads\/main'/);
  assert.equal(pages.jobs.validation.steps.find(s=>s.name === 'Probe production login bridge and Data API').env.PRODUCTION_PROBE_READ_ONLY, '1');
  assert.match(pages.jobs['report-production-health'].if, /github.ref == 'refs\/heads\/main'/);
  const current = pages.jobs.deploy.steps.find(s=>s.id === 'current');
  assert.match(current.with.script, /ref.data.object.sha === context.sha/);
});

test('live probes await exact commit and all retained suites run with writes blocked', () => {
  assert.equal(pages.jobs['exact-live'].needs, 'deploy');
  assert.equal(pages.jobs['exact-live'].steps.find(step => step.name === 'Wait for exact live release and commit').env.EXPECTED_COMMIT,
    '${{ needs.deploy.outputs.build-commit }}');
  assert.deepEqual(pages.jobs['post-deployment-canary'].needs, ['deploy','exact-live']);
  const matrix = pages.jobs['post-deployment-canary'].strategy.matrix.include;
  assert.deepEqual(matrix.map(x=>x.suite), ['foundation','requests','session','login-photo']);
  assert.match(matrix.find(x=>x.suite==='requests').command, /production-request-canary.spec.ts/);
  const liveCanary = pages.jobs['post-deployment-canary'].steps.find(step => step.name?.startsWith('Mutation-blocked live'));
  assert.equal(liveCanary.env.APP_LIFECYCLE_BASE_URL, 'https://agmetricapp.com');
  assert.equal(liveCanary.env.SESSION_RECOVERY_BASE_URL, 'https://agmetricapp.com');
  assert.equal(liveCanary.env.LOGIN_PHOTO_BASE_URL, 'https://agmetricapp.com');
  assert.equal(liveCanary.env.EXPECTED_COMMIT, '${{ needs.deploy.outputs.build-commit }}');
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

test('execute the actual release gate: failed, skipped, cancelled or missing lanes cannot pass', () => {
  const gate = validation.jobs['release-gate'].steps[0].run;
  const executable = gate.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, '');
  const healthy = Object.fromEntries(validation.jobs['release-gate'].needs.map(name => [name, {result: 'success'}]));
  healthy.build.outputs = {digest: 'a'.repeat(64)};
  function run(results, required = true) {
    return vm.runInNewContext(executable, {process: {env: {
      RELEASE_JOB_RESULTS: JSON.stringify(results), REQUIRE_PRODUCTION_HEALTH: String(required),
    }}, console: {log() {}}});
  }
  assert.doesNotThrow(() => run(healthy));
  for (const name of validation.jobs['release-gate'].needs) {
    for (const result of ['failure','cancelled','skipped']) {
      assert.throws(() => run({...healthy, [name]: {...healthy[name], result}}), /RELEASE_GATE_FAILED/);
    }
    const missing = structuredClone(healthy);
    delete missing[name];
    assert.throws(() => run(missing), /RELEASE_GATE_FAILED/);
  }
  const benchmark = structuredClone(healthy);
  benchmark['production-health'] = {result: 'skipped'};
  assert.doesNotThrow(() => run(benchmark, false));
  benchmark.build.outputs.digest = '';
  assert.throws(() => run(benchmark, false), /RELEASE_DIGEST_MISSING/);
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
  assert.equal(jobRequest.params.run_attempt, 2);
  const notDeployed = await run({deployed:false});
  assert.equal(notDeployed.outputs['should-probe'], 'false');
  assert.equal((await run({runOverrides:{conclusion:'failure'}})).outputs['should-probe'], 'true',
    'a failed later canary does not hide a successful Pages deployment');
  for (const runOverrides of [
    {path:'.github/workflows/other.yml'}, {event:'pull_request'}, {status:'in_progress'},
    {run_attempt:3}, {head_sha:'c'.repeat(40)}, {head_branch:'preview'},
    {head_repository:{full_name:'fork/test'}},
  ]) assert.equal((await run({runOverrides})).outputs['should-probe'], 'false', JSON.stringify(runOverrides));
  assert.equal((await run({branch:'fix/benchmark'})).outputs['should-probe'], 'false');
  assert.equal((await run({event:'schedule'})).outputs['should-probe'], 'true');
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
