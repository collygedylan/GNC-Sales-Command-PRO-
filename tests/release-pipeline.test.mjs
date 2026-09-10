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
  assert.equal(pages.jobs.deploy.needs, 'validation');
  assert.equal(pages.jobs.validation.uses, './.github/workflows/release-validation.yml');
  assert.match(pages.jobs.deploy.if, /github.ref == 'refs\/heads\/main'/);
  assert.deepEqual(validation.jobs['release-gate'].needs, ['unit','database','build','functional','compiled','timing','lighthouse','production-health']);
  const gate = validation.jobs['release-gate'].steps[0].run;
  assert.match(gate, /jobs\[name\]\?\.result !== 'success'/);
  assert.match(gate, /RELEASE_DIGEST_MISSING/);
  for (const job of Object.values(validation.jobs)) assert.notEqual(job['continue-on-error'], true);
  assert.equal(validation.jobs.database.uses, './.github/workflows/release-database.yml');
});

test('browser shards and compiled suites use isolated runners without racing performance tests', () => {
  assert.deepEqual(validation.jobs.functional.strategy.matrix.shard, [1,2,3,4]);
  assert.equal(validation.jobs.functional.strategy['max-parallel'], 4);
  assert.equal(validation.jobs.functional.strategy['fail-fast'], false);
  assert.match(validation.jobs.functional.steps.find(s => s.run?.includes('playwright test')).run, /--workers=1.*--shard=/);
  assert.deepEqual(validation.jobs.compiled.strategy.matrix.include.map(x => x.suite), ['footer','home','season','suspend','docks','av-blanks','session','assignedto','verified-cache']);
  assert.match(validation.jobs.timing.steps.map(s=>s.run||'').join('\n'), /playwright.release-timing.config.ts --workers=1/);
  assert.match(validation.jobs.timing.steps.map(s=>s.run||'').join('\n'), /playwright.release-android.config.ts --project=android --workers=1/);
  assert.equal(validation.jobs.lighthouse['runs-on'], 'ubuntu-latest');
});

test('every build consumer verifies the original manifest, never rebuilds or reseals', () => {
  for (const name of ['functional','compiled','timing','lighthouse']) {
    const job = validation.jobs[name];
    assert.equal(job.needs, 'build');
    assert.equal(job.steps.filter(s => s.uses === './.github/actions/download-release').length, 1);
    assert.doesNotMatch(job.steps.map(s=>s.run||'').join('\n'), /npm run build|artifact\.mjs seal/);
  }
  const publish = pages.jobs.deploy.steps;
  assert.ok(publish.findIndex(s=>s.uses === './.github/actions/download-release') < publish.findIndex(s=>s.uses?.startsWith('actions/deploy-pages@')));
  assert.doesNotMatch(publish.map(s=>s.run||'').join('\n'), /npm run build|artifact\.mjs seal/);
  assert.match(download.runs.steps[1].run, /release-artifact.mjs verify/);
  assert.equal(download.runs.steps[1].env.EXPECTED_RELEASE_DIGEST, '${{ inputs.digest }}');
  assert.equal(validation.jobs.build.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@')).with['include-hidden-files'], true);
});

test('main runs validation once and a feature benchmark cannot publish or change production health', () => {
  assert.ok(pages.on.push.branches.includes('main'));
  assert.equal(performance.on.push, undefined);
  assert.ok('pull_request' in performance.on);
  assert.ok('schedule' in performance.on);
  assert.equal(performance.jobs.validation.uses, pages.jobs.validation.uses);
  assert.equal(pages.concurrency['cancel-in-progress'], false);
  assert.match(pages.jobs.validation.with['production-health'], /github.ref == 'refs\/heads\/main'/);
  assert.match(pages.jobs['report-production-health'].if, /github.ref == 'refs\/heads\/main'/);
  const current = pages.jobs.deploy.steps.find(s=>s.id === 'current');
  assert.match(current.with.script, /ref.data.object.sha === context.sha/);
});

test('live probes await exact commit and all retained suites run with writes blocked', () => {
  assert.equal(pages.jobs['exact-live'].needs, 'deploy');
  assert.deepEqual(pages.jobs['post-deployment-canary'].needs, ['deploy','exact-live']);
  const matrix = pages.jobs['post-deployment-canary'].strategy.matrix.include;
  assert.deepEqual(matrix.map(x=>x.suite), ['requests','session','assignedto','footer','home','season','suspend','docks','login-photo']);
  assert.match(matrix.find(x=>x.suite==='requests').command, /production-request-canary.spec.ts/);
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

test('production health recovery runs only after actual publication or on its existing schedule', async () => {
  const auth = yaml.load(read('.github/workflows/production-auth-health.yml'));
  const script = auth.jobs['published-release'].steps[0].with.script;
  async function run({event = 'workflow_run', branch = 'main', deployed = false} = {}) {
    let result;
    const execute = vm.runInNewContext(`(async () => {${script}})`, {
      context: {eventName: event, repo: {owner:'test',repo:'test'}, payload:{workflow_run:{head_branch:branch,id:1}}},
      core: {setOutput(_key,value) { result = value; }, notice() {}},
      github: {rest:{actions:{listJobsForWorkflowRun:{}}}, paginate:async()=>[{name:'deploy',steps:[{
        name:'Deploy verified artifact to Pages',conclusion:deployed ? 'success' : 'skipped',
      }]}]},
    });
    await execute();
    return result;
  }
  assert.equal(await run({deployed:true}), 'true');
  assert.equal(await run(), 'false');
  assert.equal(await run({branch:'fix/benchmark',deployed:true}), 'false');
  assert.equal(await run({event:'schedule'}), 'true');
});
