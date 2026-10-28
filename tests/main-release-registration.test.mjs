import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import yaml from 'js-yaml';
import { releaseDatabaseMigrations, reclassRepScopeMigrationName, migrationContractQuery } from '../scripts/apply-item-low-stock-migration.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const workflow = file => yaml.load(read(`.github/workflows/${file}`));
const needs = job => [job.needs || []].flat();
const commands = job => (job.steps || []).map(step => step.run || step.with?.script || '').join('\n');
const nodeBody = step => {
  const match = step.run?.match(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE(?:\r?\n|$)/);
  assert.ok(match, 'workflow must retain its executable Node gate');
  return match[1];
};

test('the REP scope repair is a deployable allowlisted migration with a real security contract', () => {
  assert.equal(reclassRepScopeMigrationName, '20261020233500_reclass_rep_scope_preservation_v1.sql');
  assert.equal(releaseDatabaseMigrations.filter(name => name === reclassRepScopeMigrationName).length, 1);
  const sql = read(`supabase/migrations/${reclassRepScopeMigrationName}`);
  assert.match(sql, /pg_get_functiondef\(p\.oid\)/);
  assert.match(sql, /RECLASS_REP_PUBLIC_SECURITY_CHANGED/);
  assert.match(sql, /revoke all on function private\.enqueue_drive_reclass_inquiry_v7_rep_impl\(jsonb\) from public,anon,authenticated,service_role/);
  const contract = migrationContractQuery(reclassRepScopeMigrationName);
  for (const marker of ['sales_rep_operation_scope_v1', 'enqueue_drive_reclass_inquiry_v7_rep_impl',
    'reclass_delivery_recipients_v1', 'service_role', 'public.enqueue_drive_reclass_inquiry_v1(jsonb)',
    'public.enqueue_drive_reclass_inquiry_v6(jsonb)']) {
    assert.ok(contract.includes(marker), `installer must verify ${marker}`);
  }
});

test('main publication follows build then selected backend then Pages without validation matrices', () => {
  const pages = workflow('pages-static.yml');
  assert.deepEqual(pages.on.push.branches, ['main']);
  for (const job of Object.values(pages.jobs)) assert.equal(job.strategy?.matrix, undefined);
  for (const removed of ['node-validation', 'tooling-validation', 'frontend-validation']) assert.equal(pages.jobs[removed], undefined);
  const gate = pages.jobs['fast-gate'];
  assert.equal(gate.uses, undefined);
  assert.ok(gate.steps.some(step => step.run === 'npm run check:inline'));
  assert.ok(gate.steps.some(step => step.run === 'node scripts/run-tooling-release-checks.mjs'));
  const edgeSyntax = gate.steps.find(step => step.name === 'Parse and bundle selected Edge Functions with esbuild');
  assert.ok(edgeSyntax);
  assert.match(edgeSyntax.run, /from 'esbuild'/);
  assert.match(edgeSyntax.run, /bundle: true[^]*write: false/);
  assert.doesNotMatch(edgeSyntax.run, /deno check|Type-check only/i);
  assert.match(edgeSyntax.run, /no type-check claim/);
  const native = gate.steps.find(step => step.uses === './.github/actions/prepare-native-release');
  assert.equal(native.if, "steps.classify.outputs.frontend == 'true'");
  assert.doesNotMatch(commands(gate), /run-discovered-tests|playwright|run-release-smoke|docker build/);
  const prepare = yaml.load(read('.github/actions/prepare-native-release/action.yml'));
  assert.ok(prepare.runs.steps.some(step => step.run === 'node scripts/prepare-release-site.mjs'));
  assert.ok(prepare.runs.steps.some(step => step.uses === 'actions/cache@v4'));
  assert.doesNotMatch(JSON.stringify(prepare), /docker\//);
  assert.deepEqual(needs(pages.jobs['backend-publication']).sort(), ['fast-gate'].sort());
  assert.deepEqual(needs(pages.jobs.deploy).sort(), ['fast-gate', 'backend-publication'].sort());
  assert.match(pages.jobs['backend-publication'].if, /needs\.fast-gate\.result == 'success'/);
  assert.match(pages.jobs.deploy.if, /needs\.backend-publication\.result == 'success'/);
  assert.match(commands(pages.jobs['fast-gate']), /selectReleaseRecoveryBase\(/);
  assert.match(commands(gate), /initialScope\.deploy\.frontend \? await recover\('frontend'\)/);
  assert.match(commands(gate), /selectReleaseRecoveryBase\(\{ scope: initialScope/);
  const backend = workflow('apps-script-sync.yml');
  assert.deepEqual(needs(backend.jobs['deploy-supabase']), ['authorize-backend']);
  assert.doesNotMatch(commands(backend.jobs['deploy-supabase']), /run-discovered-tests|database-check|playwright/);
  const migrationStep = backend.jobs['deploy-supabase'].steps.find(step => step.name === 'Apply validated backend release migrations');
  assert.equal(migrationStep.env.SUPABASE_ACCESS_TOKEN, '${{ secrets.SUPABASE_ACCESS_TOKEN }}');
  assert.equal(migrationStep.env.SUPABASE_DB_URL, '${{ secrets.SUPABASE_DB_URL }}');
  assert.match(migrationStep.run, /node scripts\/apply-item-low-stock-migration\.mjs/);
  assert.match(migrationStep.run, /supabase\/\.temp\/project-ref/);
  assert.match(migrationStep.run, /validateDatabaseTarget\(process\.env\.SUPABASE_DB_URL, process\.env\.SUPABASE_URL\)/);
  assert.match(migrationStep.run, /supabase link --project-ref "\$project_ref"/);
  const migrationRunner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(migrationRunner, /spawn\(process\.execPath, \[cliEntrypoint, 'db', 'query', '--linked', '--file', queryFile/);
  const deployStep = backend.jobs['deploy-supabase'].steps.find(step => step.name === 'Deploy changed Edge Functions');
  assert.match(deployStep.run, /--no-verify-jwt/);
  assert.match(deployStep.run, /aura-llm-router/);
});

test('expanded validation remains registered exclusively behind the main nightly switch', () => {
  const release = workflow('release-validation.yml');
  for (const name of ['lint', 'unit', 'react', 'contracts', 'database', 'fast-browser', 'foundation',
    'functional', 'compiled', 'timing', 'performance', 'lighthouse']) {
    assert.ok(release.jobs[name], name);
    assert.match(release.jobs[name].if, /inputs\.run-nightly-suites/, name);
    assert.match(release.jobs[name].if, /github\.ref == 'refs\/heads\/main'/, name);
    assert.match(release.jobs[name].if, /github\.workflow == 'Nightly Validation'/, name);
  }
  const nightly = workflow('nightly-validation.yml');
  assert.equal(nightly.name, 'Nightly Validation');
  assert.equal(nightly.on.workflow_dispatch.inputs.full_regression.default, false);
  assert.equal(nightly.on.workflow_dispatch.inputs.full_regression.type, 'boolean');
  const nightGate = nightly.jobs['central-time-gate'].steps[0];
  assert.equal(nightGate.env.FULL_REGRESSION, '${{ inputs.full_regression }}');
  assert.match(nightGate.run, /should_run=\$FULL_REGRESSION/);
  assert.equal(nightly.jobs['release-smoke'].steps.find(step => step.run === 'node scripts/run-release-smoke.mjs').env.RELEASE_SMOKE_SITE_DIR, '_site');
  assert.deepEqual(nightly.on.schedule.map(item => item.cron), ['30 1,2 * * *']);
  assert.match(commands(nightly.jobs['central-time-gate']), /America\/Chicago/);
  const frontend = Object.values(nightly.jobs).find(job => job.uses === './.github/workflows/release-validation.yml');
  assert.equal(frontend.with['run-nightly-suites'], true);
  assert.equal(frontend.with['run-frontend-tests'], true);
  const database = Object.values(nightly.jobs).find(job => job.uses === './.github/workflows/release-database.yml');
  for (const option of ['run-schema-tests', 'run-browser-tests', 'run-performance-tests', 'run-all-schema-tests']) assert.equal(database.with[option], true);
  for (const file of ['bloomscapes-pending-tests.yml', 'suspend-tag-tests.yml', 'live-dataset-revisions.yml']) {
    assert.ok(Object.values(nightly.jobs).some(job => job.uses === `./.github/workflows/${file}`), file);
  }
});

test('the release gate requires build alone during direct delivery and retains nightly failures', () => {
  const release = workflow('release-validation.yml');
  const step = release.jobs['release-gate'].steps.find(step => step.env?.RELEASE_JOB_RESULTS);
  const code = nodeBody(step);
  const jobs = Object.fromEntries(needs(release.jobs['release-gate']).map(name => [name, { result: 'skipped' }]));
  jobs.build = { result: 'success', outputs: { digest: 'a'.repeat(64) } };
  jobs['release-mode'] = { result: 'success' };
  const runGate = (nightly, results) => vm.runInNewContext(code, {
    process: { env: { HOTFIX: 'false', RUN_NIGHTLY_SUITES: String(nightly), RUN_SCHEMA_TESTS: 'true',
      RUN_FRONTEND_TESTS: 'true', RUN_BACKEND_TESTS: 'true', RELEASE_JOB_RESULTS: JSON.stringify(results) } }, console: { log() {} },
  }, { timeout: 1000 });
  runGate(false, jobs);
  assert.throws(() => runGate(false, { ...jobs, build: { result: 'failure' } }), /RELEASE_GATE_FAILED_build/);
  assert.throws(() => runGate(false, { ...jobs, build: { result: 'skipped' } }), /RELEASE_GATE_FAILED_build/);
  const passed = Object.fromEntries(Object.entries(jobs).map(([name, value]) => [name, { ...value, result: 'success' }]));
  runGate(true, passed);
  assert.throws(() => runGate(true, { ...passed, unit: { result: 'failure' } }), /RELEASE_GATE_FAILED_unit/);
});

test('direct delivery proofs truthfully claim no nightly test scope', () => {
  const release = workflow('release-validation.yml');
  const step = release.jobs['release-gate'].steps.find(step => step.name === 'Record the passing immutable candidate');
  const code = nodeBody(step).replace(/^import fs from 'node:fs';\r?$/m, '');
  let proof;
  vm.runInNewContext(code, { process: { env: { HOTFIX: 'false', RUN_NIGHTLY_SUITES: 'false', RUN_FRONTEND_TESTS: 'true',
    RUN_BACKEND_TESTS: 'true', RUN_SCHEMA_TESTS: 'true', RELEASE_DIGEST: 'a'.repeat(64), RELEASE_SITE_ID: '1' } },
    fs: { writeFileSync(_file, value) { proof = JSON.parse(value); } },
  }, { timeout: 1000 });
  assert.equal(proof.browserMode, 'none');
  assert.deepEqual(proof.testScope, { frontend: false, backend: false, schema: false });
});

test('current-main, immutable artifact and privileged publishing safeguards survive direct delivery', () => {
  const pages = workflow('pages-static.yml');
  const authorization = commands(pages.jobs['fast-gate']);
  assert.match(authorization, /expected !== context\.sha/);
  assert.match(authorization, /main\.object\.sha !== context\.sha/);
  const deploy = pages.jobs.deploy;
  const download = deploy.steps.find(step => step.uses === './.github/actions/download-release');
  assert.equal(download.with.commit, '${{ github.sha }}');
  assert.equal(download.with.digest, '${{ needs.fast-gate.outputs.digest }}');
  assert.equal(download.with['artifact-id'], '${{ needs.fast-gate.outputs.site-id }}');
  assert.match(commands(deploy), /FRONTEND_VALIDATION_IDENTITY_MISMATCH/);
  assert.match(commands(deploy), /FRONTEND_MAIN_SUPERSEDED/);
  assert.match(commands(deploy), /GITHUB_RUN_ATTEMPT/);
  assert.equal(pages.jobs['exact-live'].needs, 'deploy');
  assert.equal(pages.jobs['exact-live'].steps.find(step => step.run === 'node scripts/wait-for-live-release.mjs').env.REQUIRE_CURRENT_LIVE_DESCRIPTOR, '1');
  const backend = workflow('apps-script-sync.yml');
  assert.match(commands(backend.jobs['authorize-backend']), /BACKEND_DISPATCH_STALE_MAIN/);
  assert.match(commands(backend.jobs['deploy-supabase']), /BACKEND_DISPATCH_STALE_MAIN/);
  const publisher = workflow('publish-candidate.yml');
  assert.match(publisher.jobs.publish.if, /head_repository\.full_name == github\.repository/);
  assert.ok(!publisher.jobs.publish.steps.some(step => String(step.uses).startsWith('actions/checkout')));
  for (const marker of ['CANDIDATE_MERGE_NOT_CONFIRMED', 'CANDIDATE_MERGE_BASE_NOT_VALIDATED', 'candidate.head_sha === pr.merge_commit_sha']) assert.ok(commands(publisher.jobs.publish).includes(marker), marker);
});
