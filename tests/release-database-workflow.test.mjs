import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startIsolatedDatabase, collectDatabaseEvidence, excludedServices } from '../scripts/release-database-startup.mjs';
import { readHistoricalMigrationManifest } from '../scripts/historical-database-fixture.mjs';
import { discoverTests } from '../scripts/test-discovery.mjs';
import { backendTestMatrices } from '../scripts/ci-backend-matrix.mjs';
import vm from 'node:vm';

const workflow = fs.readFileSync(new URL('../.github/workflows/release-database.yml', import.meta.url), 'utf8');
const yaml = createRequire(import.meta.url)('js-yaml');
const workflowConfig = yaml.load(workflow);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseJob = workflowConfig.jobs['database-and-functions'];
const browserConfig = fs.readFileSync(new URL('../playwright.database.config.ts', import.meta.url), 'utf8');
const provisioning = fs.readFileSync(new URL('./native-auth-provisioning-local.spec.js', import.meta.url), 'utf8');
const legacyBaseline = fs.readFileSync(new URL('../supabase/ci/native_auth_legacy_user_baseline.sql', import.meta.url), 'utf8');
const requestWorkflowBaseline = fs.readFileSync(new URL('../supabase/ci/request_workflow_baseline.sql', import.meta.url), 'utf8');
const departmentCalendarBaseline = fs.readFileSync(new URL('../supabase/ci/department_calendar_baseline.sql', import.meta.url), 'utf8');
const evalReport2Migration = fs.readFileSync(new URL('../supabase/archive_migrations/20260902002912_flatten_eval_reports_2_and_reconcile_work.sql', import.meta.url), 'utf8');

test('handover CI includes the production flyer row type before compiling the worker', () => {
  const fixture = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_fixture.sql', import.meta.url), 'utf8');
  const baseline = fs.readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
  const expected = baseline.match(/CREATE TABLE public\.ph_flyer_folder_rows \([\s\S]*?\n\);/)[0]
    .replace('CREATE TABLE public.', 'CREATE TABLE IF NOT EXISTS public.').replace(/\r\n/g, '\n');
  assert.ok(fixture.replace(/\r\n/g, '\n').includes(expected));
  assert.match(fixture, /ALTER TABLE public\.ph_flyer_folder_rows ENABLE ROW LEVEL SECURITY/);
  assert.match(fixture, /REVOKE ALL ON public\.ph_flyer_folder_rows FROM public, anon, authenticated/);
  const manifest = readHistoricalMigrationManifest({ root: repositoryRoot });
  const destinations = manifest.map(entry => entry.destination);
  assert.ok(destinations.indexOf('20261001215507_ci_scheduled_handover_fixture.sql') < destinations.indexOf('20261001215508_scheduled_handover_005.sql'));
});

test('handover CI includes every assignment target and the production Eval rule schema', () => {
  const fixture = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_fixture.sql', import.meta.url), 'utf8');
  const baseline = fs.readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
  const expected = baseline.match(/CREATE TABLE public\.ph_eval_assignment_rules \([\s\S]*?\n\);/)[0]
    .replace('CREATE TABLE public.', 'CREATE TABLE IF NOT EXISTS public.').replace(/\r\n/g, '\n');
  assert.ok(fixture.replace(/\r\n/g, '\n').includes(expected));
  assert.match(fixture, /ALTER TABLE public\.ph_eval_assignment_rules ENABLE ROW LEVEL SECURITY/);
  assert.match(fixture, /REVOKE ALL ON public\.ph_eval_assignment_rules FROM public, anon, authenticated/);
  const sources = readHistoricalMigrationManifest({ root: repositoryRoot })
    .map(entry => fs.readFileSync(new URL(`../${entry.source}`, import.meta.url), 'utf8')).join('\n');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261001222228_handover_assignment_transfer_005.sql', import.meta.url), 'utf8');
  const targets = [...migration.matchAll(/\('(ph_\w+)','\w+',array\[/g)].map(match => match[1]);
  assert.ok(targets.length >= 7);
  for (const table of new Set(targets)) {
    assert.match(sources, new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(`, 'i'), `${table} must exist in the isolated replay`);
  }
});

test('handover fixture accounts retain sequence and historical permission-audit contracts', () => {
  const fixture = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_fixture.sql', import.meta.url), 'utf8');
  assert.match(fixture, /setval\(pg_get_serial_sequence\('public\.ph_app_users','id'\),\s+greatest\(\(select max\(id\) from public\.ph_app_users\), 74\), true\)/);
  assert.match(fixture, /insert into private\.app_access_legacy_baseline\(profile_id,permission_key,allowed,access_scope\)/);
  assert.match(fixture, /private\.get_effective_app_permissions_v1\(p\.id,private\.resolve_app_access_policy_id_v1\(true\)\)/);
  assert.match(fixture, /e\.permission_key in \('drive\.reclass\.submit','manager\.orders\.view'\)/);
  assert.match(fixture, /on conflict\(profile_id,permission_key\) do nothing/);
});

test('perennial and Pikes SQL fixtures only call documented pgTAP assertions', () => {
  // Assertion names are checked against pgTAP's public API documentation:
  // https://pgtap.org/documentation.html (plan, ok, is, isnt, throws_ok,
  // lives_ok, matches, has_table, has_column, has_function, has_index).
  const documented = new Set(['plan', 'ok', 'is', 'isnt', 'throws_ok', 'lives_ok', 'matches', 'has_table', 'has_column', 'has_function', 'has_index']);
  for (const filename of ['perennial_zone_assignment_test.sql', 'pikes_orders_rls_test.sql']) {
    const source = fs.readFileSync(new URL(`../supabase/tests/${filename}`, import.meta.url), 'utf8');
    const calls = [...source.matchAll(/^\s*select\s+([a-z_]+)\s*\(/gim)].map(match => match[1].toLowerCase());
    // Nested fixture queries use PostgreSQL builtins; they are not assertions.
    const assertions = calls.filter(name => !['set_config', 'count', 'lower', 'jsonb_build_object'].includes(name));
    assert.ok(assertions.length > 0, `${filename} contains pgTAP assertions`);
    assert.deepEqual([...new Set(assertions.filter(name => !documented.has(name)))], [], `${filename} uses only documented pgTAP APIs`);
    assert.doesNotMatch(source, /\bis_null\s*\(/i, `${filename} does not use the nonexistent is_null assertion`);
  }
});

test('request workflow baseline provides the text hold start date consumed by Eval Report #2', () => {
  const inventory = requestWorkflowBaseline.match(/create table if not exists public\.ph_master_inventory\s*\(([\s\S]*?)\n\);/i);
  assert.ok(inventory, 'CI baseline defines the legacy master inventory table');
  assert.match(inventory[1], /\bholdstopbegindate\s+text\b/i);
  assert.match(evalReport2Migration, /eval_report2_inventory_date_v1\(m\.holdstopbegindate\)/i);
});

test('isolated master warehousei matches the production text column used by row ownership', () => {
  const production = fs.readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
  const master = production.match(/CREATE TABLE public\.ph_master_inventory\s*\(([\s\S]*?)\n\);/i);
  const fixture = requestWorkflowBaseline.match(/create table if not exists public\.ph_master_inventory\s*\(([\s\S]*?)\n\);/i);
  assert.ok(master && fixture, 'both inventory definitions exist');
  for (const [label, definition] of [['production', master[1]], ['CI', fixture[1]]]) {
    assert.match(definition, /^\s*warehousei text,?\s*$/m, `${label} has nullable text warehousei without a default`);
  }
});

test('isolated database stages the existing calendar before the HR migration', () => {
  assert.match(departmentCalendarBaseline, /create table public\.ph_department_calendar_events\s*\(/i);
  assert.match(departmentCalendarBaseline, /unique_id text primary key/i);
  assert.match(departmentCalendarBaseline, /assigned_usernames jsonb/i);
  assert.doesNotMatch(departmentCalendarBaseline, /hr_source_event_id/i);
  const destinations = readHistoricalMigrationManifest({ root: repositoryRoot }).map(entry => entry.destination);
  assert.ok(destinations.indexOf('20260929200001_ci_department_calendar_baseline.sql') < destinations.indexOf('20261001025638_aura_hr_command_center_v1.sql'));
});

test('database reusable workflow is secret-free and has read-only repository permissions', () => {
  assert.match(workflow, /on:\s+workflow_call:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(workflow, /secrets:|secrets\.|id-token:|contents: write|PRODUCTION_|--linked|--db-url|db push|functions deploy/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/setup-node-dependencies/);
  const setupNode = fs.readFileSync(new URL('../.github/actions/setup-node-dependencies/action.yml', import.meta.url), 'utf8');
  assert.match(setupNode, /node-version: \$\{\{ inputs\.node-version \}\}[\s\S]*?cache: npm/);
});

test('historical replay and SQL benchmark jobs fail closed unless schema paths changed', () => {
  assert.equal(workflowConfig.on.workflow_call.inputs['run-schema-tests'].default, false);
  assert.equal(workflowConfig.on.workflow_call.inputs['run-browser-tests'].default, false);
  assert.equal(workflowConfig.on.workflow_call.inputs['run-performance-tests'].default, false);
  assert.equal(workflowConfig.on.workflow_call.inputs['run-all-schema-tests'].default, false);
  const scope = workflowConfig.jobs['schema-path-scope'];
  assert.ok(scope, 'the reusable workflow verifies changed paths independently of its caller');
  const compare = scope.steps.find(step => step.id === 'scope');
  assert.ok(compare);
  assert.match(compare.run, /pull_request\)[\s\S]*PR_BASE_SHA[\s\S]*PR_HEAD_SHA/);
  assert.match(compare.run, /push\)[\s\S]*PUSH_BEFORE_SHA[\s\S]*PUSH_AFTER_SHA/);
  assert.match(compare.run, /workflow_dispatch\)[\s\S]*CURRENT_SHA\}\^1/);
  assert.match(compare.run, /--no-renames[\s\S]*--diff-filter=ACMRD/);
  assert.match(compare.run, /supabase\/\*\|database\/\*/);
  for (const name of ['integration', 'schema-contracts', 'suspend-tag-approval', 'database-and-functions']) {
    const job = workflowConfig.jobs[name];
    assert.match(job.if, /inputs\.run-schema-tests/);
    assert.match(job.if, /needs\.schema-path-scope\.outputs\.changed == 'true'/);
    assert.ok((Array.isArray(job.needs) ? job.needs : [job.needs]).includes('schema-path-scope'));
  }
  assert.equal(workflowConfig.jobs['edge-functions'].needs, 'discover',
    'Edge unit checks remain distinct from historical database replays');
  const browserSetup = workflowConfig.jobs['database-and-functions'].steps.find(step => step.id === 'browser_setup');
  const browserTransactions = workflowConfig.jobs['database-and-functions'].steps.find(step => step.id === 'transactions');
  assert.match(browserSetup.if, /inputs\.run-browser-tests/);
  assert.match(browserTransactions.if, /inputs\.run-browser-tests/);
  const pgTransactions = workflowConfig.jobs['database-and-functions'].steps.find(step => step.name === 'Run PostgreSQL concurrency transactions');
  assert.match(pgTransactions.if, /inputs\.run-schema-tests/);
  const benchmarks = workflowConfig.jobs['schema-contracts'].steps.find(step => step.run === 'node scripts/database-check.mjs --all');
  assert.equal(benchmarks.env.DATABASE_PERFORMANCE_BENCHMARK, "${{ inputs.run-performance-tests && 'true' || 'false' }}");
  assert.equal(benchmarks.env.PERFORMANCE_API_BENCHMARK, "${{ inputs.run-performance-tests && 'true' || 'false' }}");
});

test('backend schema gate requires every selected integration job and rejects skips', () => {
  const gate = workflowConfig.jobs['schema-gate'];
  assert.ok(gate.needs.includes('schema-path-scope'));
  const run = gate.steps.find(step => step.name === 'Require every selected backend integration check').run;
  const script = run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, '');
  const names = ['schema-path-scope', 'discover', 'integration', 'edge-functions', 'schema-contracts', 'suspend-tag-approval', 'database-and-functions'];
  const results = Object.fromEntries(names.map(name => [name, { result: 'success' }]));
  const execute = (scope = 'true', requireScope = 'true') => vm.runInNewContext(script, {
    process: { env: { SCOPE: scope, REQUIRE_SCHEMA_SCOPE: requireScope, RESULTS: JSON.stringify(results) } },
    console: { log() {} },
  });
  assert.doesNotThrow(() => execute());
  assert.doesNotThrow(() => execute('false', 'false'), 'unmatched paths are an intentional no-op for targeted/manual diagnostics');
  assert.throws(() => execute('false', 'true'), /BACKEND_SCHEMA_SCOPE_REQUIRED/);
  assert.throws(() => execute('', 'false'), /BACKEND_SCHEMA_SCOPE_REQUIRED/);
  for (const name of ['schema-path-scope', 'discover', 'edge-functions']) {
    results[name] = { result: 'failure' };
    assert.throws(() => execute('false', 'false'), new RegExp(`BACKEND_SCHEMA_GATE_FAILED_${name}`));
    results[name] = { result: 'success' };
  }
  for (const name of names) {
    for (const result of ['failure', 'skipped', 'cancelled']) {
      results[name] = { result };
      assert.throws(execute, new RegExp(`BACKEND_SCHEMA_GATE_FAILED_${name}`));
    }
    results[name] = { result: 'success' };
    const missing = { ...results }; delete missing[name];
    assert.throws(() => vm.runInNewContext(script, { process: { env: { SCOPE: 'true', RESULTS: JSON.stringify(missing) } } }),
      new RegExp(`BACKEND_SCHEMA_GATE_FAILED_${name}`));
  }
});

test('backend production mutations require current-main validation and every contract suite', () => {
  const sync = yaml.load(fs.readFileSync(new URL('../.github/workflows/apps-script-sync.yml', import.meta.url), 'utf8'));
  const validation = sync.jobs['backend-validation'];
  assert.equal(validation.uses, './.github/workflows/release-database.yml');
  assert.equal(validation.with['run-schema-tests'], true);
  assert.equal(validation.with['run-browser-tests'], false);
  assert.equal(validation.with['run-performance-tests'], false);
  assert.equal(validation.with['run-all-schema-tests'], true);
  const deploy = sync.jobs['deploy-supabase'];
  for (const name of ['authorize-backend', 'backend-validation', 'pending-order-contract', 'suspend-tag-contract', 'live-dataset-contract']) {
    assert.ok(deploy.needs.includes(name));
    if (name !== 'authorize-backend') assert.match(deploy.if, new RegExp(`needs\\.${name}\\.result == 'success'`));
  }
});

test('disposable live dataset database checks exclude workflow-only and application paths', () => {
  const live = yaml.load(fs.readFileSync(new URL('../.github/workflows/live-dataset-revisions.yml', import.meta.url), 'utf8'));
  assert.ok(Object.hasOwn(live.on, 'workflow_call'));
  assert.equal(live.on.pull_request, undefined);
  const scope = live.jobs['database-path-scope'];
  assert.ok(scope);
  const compare = scope.steps.find(step => step.id === 'scope');
  assert.match(compare.run, /pull_request\)[\s\S]*PR_BASE_SHA[\s\S]*PR_HEAD_SHA/);
  assert.match(compare.run, /workflow_dispatch\)[\s\S]*CURRENT_SHA\}\^1/);
  assert.match(compare.run, /supabase\/\*\|database\/\*/);
  assert.match(live.jobs['isolated-native-revisions'].if, /outputs\.changed == 'true'/);
  assert.deepEqual(live.jobs['isolated-native-revisions'].needs, 'database-path-scope');
});

test('standalone disposable database workflows require actual database paths, including on manual dispatch', () => {
  for (const [file, jobName] of [
    ['suspend-tag-tests.yml', 'suspend-tag-transactions'],
    ['bloomscapes-pending-tests.yml', 'pending-transactions'],
  ]) {
    const config = yaml.load(fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
    assert.ok(Object.hasOwn(config.on, 'workflow_call'), file);
    assert.equal(config.on.pull_request, undefined, file);
    const scope = config.jobs['database-path-scope'];
    assert.ok(scope, file);
    const compare = scope.steps.find(step => step.id === 'scope');
    assert.match(compare.run, /pull_request\)[\s\S]*PR_BASE_SHA[\s\S]*PR_HEAD_SHA/, file);
    assert.match(compare.run, /workflow_dispatch\)[\s\S]*CURRENT_SHA\}\^1/, file);
    assert.match(compare.run, /--no-renames[\s\S]*--diff-filter=ACMRD/, file);
    assert.match(compare.run, /git diff[\s\S]*> "\$diff_file"/, file);
    assert.match(config.jobs[jobName].if, /outputs\.changed == 'true'/, file);
    assert.equal(config.jobs[jobName].needs, 'database-path-scope', file);
  }
});

test('Edge Function CI resolves pinned npm imports used by the push sender', () => {
  const edge = workflowConfig.jobs['edge-functions'].steps.find(step => step.name === 'Run Edge Function unit tests');
  assert.ok(edge);
  for (const line of edge.run.split('\n').filter(line => /^\s*deno (?:check|test)\b/.test(line))) {
    assert.match(line, /--node-modules-dir=auto/, 'Deno must install pinned npm imports before checking or testing');
  }
});

test('historical regression fixture uses the explicit migration order manifest and dynamic SQL tests', () => {
  const root = repositoryRoot;
  const manifest = readHistoricalMigrationManifest({ root });
  assert.equal(manifest.length, 201);
  assert.equal(new Set(manifest.map(entry => entry.destination)).size, 201);
  assert.deepEqual(manifest.map(entry => entry.destination), [...manifest.map(entry => entry.destination)].sort());
  for (const entry of manifest) assert.ok(fs.existsSync(new URL('../' + entry.source, import.meta.url)), entry.source);
  const destinations = new Map(manifest.map((entry, index) => [entry.destination, index]));
  assert.ok(destinations.get('20260901024608_drive_eval_shear_location_inquiries_v1.sql') < destinations.get('20260901043510_harden_shear_location_rls.sql'));
  assert.ok(destinations.get('20260901043510_harden_shear_location_rls.sql') < destinations.get('20260901135456_drive_shear_location_access_audit_baseline_v1.sql'));
  assert.ok(destinations.get('20260901135456_drive_shear_location_access_audit_baseline_v1.sql') < destinations.get('20260929000151_stabilize_manager_rpc_conflicts_and_photo_refresh.sql'));
  const pt409 = destinations.get('20260930205254_season_sales_business_conflicts_use_pt409.sql');
  assert.ok(pt409 > destinations.get('20260904003007_sales_marketing_and_kayla_limited_access.sql'));
  assert.match(workflow, /node scripts\/historical-database-fixture\.mjs \"\$RUNNER_TEMP\/gnc-supabase-ci\"/);
  assert.doesNotMatch(workflow, /cp supabase\/(?:ci|archive_migrations|migrations)\/[^\s]+\.sql \"\$ci_root\/supabase\/migrations\//);
  assert.doesNotMatch(workflow, /python3 - \"\$ci_root\"/);
  const directSql = discoverTests({ group: 'sql-isolated-supabase' });
  const acceptanceSql = discoverTests({ group: 'sql-isolated-acceptance' });
  assert.ok(directSql.length > 0 && acceptanceSql.length > 0);
  assert.ok(directSql.every(file => fs.existsSync(new URL('../' + file, import.meta.url))));
  assert.ok(acceptanceSql.every(file => fs.existsSync(new URL('../' + file, import.meta.url))));
  for (const file of acceptanceSql) {
    const sql = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(sql, /select \* from finish\(\);/, file);
    assert.match(sql, /rollback;\s*$/, file);
    assert.match(sql, /ON_ERROR_STOP on/, file);
    assert.match(sql, /select ok\(\(select count\(\*\) > 0 from [a-z_]+\)/, file);
  }
});

test('handover cron is disabled inside the disposable migration transaction only', () => {
  const isolation = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_isolation.sql', import.meta.url), 'utf8');
  assert.match(isolation, /select cron\.alter_job\(jobid, active := false\)\s+from cron\.job where jobname='scheduled_handover_kayla_nelly_20261002'/);
  assert.doesNotMatch(isolation, /(?:update|delete from)\s+cron\.job/i);
  const builder = fs.readFileSync(new URL('../scripts/historical-database-fixture.mjs', import.meta.url), 'utf8');
  assert.match(builder, /patchScheduledHandover/);
  assert.match(builder, /source\.slice\(0, -'commit;'\.length\).*isolation[\s\S]*commit;/);
  const productionRunner = fs.readFileSync(new URL('../scripts/apply-item-low-stock-migration.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(productionRunner, /scheduled_handover_isolation/);
});

test('audit baseline repair checks both historical-row preservation and missing-row insertion in isolation', () => {
  const manifest = readHistoricalMigrationManifest({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') });
  const destinations = new Map(manifest.map((entry, index) => [entry.destination, index]));
  const snapshot = destinations.get('20261002134137_ci_nelly_baseline_snapshot.sql');
  const repair = destinations.get('20261002134138_nelly_access_audit_baseline_repair_007.sql');
  assert.ok(snapshot > destinations.get('20261001215507_ci_scheduled_handover_fixture.sql') && repair > snapshot);
  assert.match(workflow, /node "\$PGLITE_TEST" --pglite-root/);
  const runner = fs.readFileSync(new URL('../scripts/apply-item-low-stock-migration.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runner, /nelly_access_audit_baseline_snapshot_fixture|ci_nelly_baseline_snapshot/);
});

test('database mutation checks stay serialized while independent tests use separate runners', () => {
  const commands = [
    'node scripts/release-database-startup.mjs start',
    'node scripts/sql-lint-temp-context.mjs --historical-reset "$SUPABASE_CI_ROOT"',
    'supabase --workdir "$SUPABASE_CI_ROOT" test db',
    'node scripts/run-discovered-database-tests.mjs postgres-concurrency "$DB_URL"',
    'npx playwright test --config playwright.database.config.ts --project=chromium',
  ];
  let previous = -1;
  for (const command of commands) {
    const at = workflow.indexOf(command);
    assert.ok(at > previous, `Missing or out-of-order command: ${command}`);
    previous = at;
  }
  const lintWrapper = fs.readFileSync(new URL('../scripts/sql-lint-temp-context.mjs', import.meta.url), 'utf8');
  const resetAt = lintWrapper.indexOf("'db', 'reset'");
  const lintAt = lintWrapper.indexOf("'db', 'lint'");
  assert.ok(resetAt >= 0 && lintAt > resetAt, 'historical reset finishes before strict function lint');
  assert.match(lintWrapper, /--fail-on', 'error'/);
  assert.equal(databaseJob.strategy, undefined);
  for(const name of ['integration','edge-functions']) {
    assert.equal(workflowConfig.jobs[name].strategy['fail-fast'], true);
    assert.ok((Array.isArray(workflowConfig.jobs[name].needs) ? workflowConfig.jobs[name].needs : [workflowConfig.jobs[name].needs]).includes('discover'));
  }
});

test('Edge graph prefetch retries only bounded transient failures before one check and test pass', () => {
  const cache = workflowConfig.jobs['edge-functions'].steps.find(step => step.id === 'deno_cache');
  assert.ok(cache, 'discovered Edge dependencies are prefetched before validation');
  assert.equal(cache.shell, 'bash');
  assert.match(cache.run, /process\.env\.EDGE_TARGETS/);
  assert.match(cache.run, /process\.env\.EDGE_TESTS/);
  assert.match(cache.run, /for attempt in 1 2 3/);
  assert.match(cache.run, /sleep "\$delay"/);
  assert.match(cache.run, /429\[\[:space:\]\]\+Too Many Requests/);
  assert.match(cache.run, /5\[0-9\]\{2\}/);
  assert.match(cache.run, /connection reset by peer/);
  assert.match(cache.run, /non-retryable error/);
  assert.doesNotMatch(cache.run, /deno (check|test)/, 'prefetch does not rerun validation commands');

  const edge = workflowConfig.jobs['edge-functions'].steps.find(step => step.id === 'edge');
  assert.ok(edge);
  assert.match(edge.run, /deno check --node-modules-dir=auto "\$\{entrypoints\[@\]\}"/);
  assert.match(edge.run, /deno test --node-modules-dir=auto --allow-env --allow-net "\$\{tests\[@\]\}"/);
  const steps = workflowConfig.jobs['edge-functions'].steps;
  const save = steps.findIndex(step => step.name === 'Save prefetched Deno dependency graph');
  assert.ok(steps.indexOf(cache) < save && save < steps.indexOf(edge), 'save the fetched graph before tests can mutate it');
});

test('canonical schema contracts run as an isolated database-check gate', () => {
  const job = workflowConfig.jobs['schema-contracts'];
  assert.ok(job, 'schema contracts have their own disposable runner');
  assert.equal(job['timeout-minutes'], 45);
  assert.deepEqual(job.steps.map(step => step.uses).filter(Boolean), [
    'actions/checkout@v4', './.github/actions/setup-node-dependencies', './.github/actions/setup-supabase-images', 'actions/upload-artifact@v4',
  ]);
  assert.ok(job.steps.some(step => step.run === 'node scripts/database-check.mjs --all'));
  const replay = job.steps.find(step => step.run === 'node scripts/database-check.mjs --all');
  assert.equal(replay.env.DATABASE_PERFORMANCE_BENCHMARK, "${{ inputs.run-performance-tests && 'true' || 'false' }}");
  assert.equal(replay.env.PERFORMANCE_API_BENCHMARK, "${{ inputs.run-performance-tests && 'true' || 'false' }}");
  assert.ok(!databaseJob.steps.some(step => step.run === 'node scripts/run-performance-api.mjs "$SUPABASE_CI_ROOT"'),
    'the historical fixture must not run inventory benchmarks against its partial schema');
  const evidence = job.steps.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with.path, 'artifacts/performance');
  assert.match(evidence.with.name, /^performance-database-sql-/);
  assert.doesNotMatch(JSON.stringify(job), /--linked|--db-url|db push|functions deploy|PRODUCTION_/);
});

test('pinned CLI fallback is restored after setup and remains active for all database steps', () => {
  const steps = databaseJob.steps;
  const cli = steps.findIndex(step => step.uses === 'supabase/setup-cli@v1');
  const registry = steps.findIndex(step => step.id === 'registry');
  const start = steps.findIndex(step => step.id === 'stack');
  assert.equal(steps[cli].with.version, '2.111.0');
  assert.ok(cli < registry && registry < start);
  assert.equal(steps[registry].run, 'echo "SUPABASE_INTERNAL_IMAGE_REGISTRY=" >> "$GITHUB_ENV"');
  assert.equal(excludedServices, 'studio,imgproxy,logflare,vector');
  assert.equal(databaseJob['timeout-minutes'], 35);
  assert.ok(steps.every(step => !step['continue-on-error']));
  assert.doesNotMatch(workflow, /--ignore-health-check|gh run rerun|nick-fields\/retry/);
  const evidence = steps.find(step => step.run === 'node scripts/release-database-startup.mjs evidence');
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.env.DATABASE_STEPS, '${{ toJSON(steps) }}');
});

function startupFixture(result) {
  const runnerTemp = path.resolve('isolated-runner');
  const records = [];
  const calls = [];
  let clock = 1000;
  const options = {
    env: { RUNNER_TEMP: runnerTemp, SUPABASE_CI_ROOT: path.join(runnerTemp, 'gnc-supabase-ci'),
      SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io', PRIVATE_SENTINEL: 'do-not-record' },
    run: (...args) => { calls.push(args); return result; },
    now: () => { clock += 25; return clock; },
    save: (name, report) => records.push({ name, report }),
  };
  return { options, records, calls };
}

test('isolated startup preserves failure codes, records timing, and never retries the stack', () => {
  for (const status of [0, 7]) {
    const f = startupFixture({ status });
    assert.equal(startIsolatedDatabase(f.options), status);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].slice(0, 2), ['supabase', ['--workdir', f.options.env.SUPABASE_CI_ROOT,
      'start', '--exclude', 'studio,imgproxy,logflare,vector']]);
    assert.equal(f.calls[0][2].env.SUPABASE_INTERNAL_IMAGE_REGISTRY, '');
    assert.equal(f.records[0].report.exitCode, status);
    assert.equal(f.records[0].report.durationMs, 25);
    assert.equal(f.records[0].report.failure, status ? 'STACK_START_FAILED' : null);
    assert.doesNotMatch(JSON.stringify(f.records), /do-not-record/);
  }
});

test('invalid workdir and missing or terminated CLI fail closed with sanitized evidence', () => {
  const invalid = startupFixture({ status: 0 });
  invalid.options.env.SUPABASE_CI_ROOT = path.resolve('some-other-project');
  assert.equal(startIsolatedDatabase(invalid.options), 1);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.records[0].report.failure, 'ISOLATED_WORKDIR_REQUIRED');
  for (const result of [{ status: null, error: new Error('do-not-record') }, { status: null, signal: 'SIGTERM' }]) {
    const f = startupFixture(result);
    assert.equal(startIsolatedDatabase(f.options), 1);
    assert.equal(f.records[0].report.failure, 'START_PROCESS_FAILED');
    assert.doesNotMatch(JSON.stringify(f.records), /do-not-record/);
  }
});

test('stage evidence retains failures and public image identities without step outputs or Docker secrets', () => {
  const records = [];
  const digest = 'sha256:' + 'a'.repeat(64);
  const options = {
    steps: { stack: { outcome: 'failure', outputs: { token: 'do-not-record' } }, migrations: { outcome: 'skipped' } },
    run: () => ({ status: 0, stdout: JSON.stringify({ Repository: 'public.ecr.aws/supabase/postgres',
      Tag: '17.6.1.156', ID: digest, Digest: digest, Secret: 'do-not-record' }) }),
    save: (name, report) => records.push({ name, report }),
  };
  assert.equal(collectDatabaseEvidence(options), 0);
  assert.deepEqual(records[0].report.failedStages, ['stack']);
  assert.deepEqual(records[0].report.images, [{ repository: 'public.ecr.aws/supabase/postgres',
    tag: '17.6.1.156', id: digest, digest }]);
  assert.doesNotMatch(JSON.stringify(records), /do-not-record/);
  options.run = () => ({ status: 1, stderr: 'do-not-record' });
  assert.equal(collectDatabaseEvidence(options), 1);
  assert.equal(records[1].report.imageInventoryAvailable, false);
  assert.deepEqual(records[1].report.failedStages, ['stack']);
});

test('local browser config explicitly includes provisioning and prevents silent missing-environment skips', () => {
  assert.match(browserConfig, /testMatch: \/\.\+\\\.spec\\\.\(ts\|js\)\$\//);
  assert.match(browserConfig, /grep: \/@database\//);
  assert.match(browserConfig, /fullyParallel: false/);
  assert.match(browserConfig, /workers: 1/);
  assert.match(browserConfig, /isolated loopback Supabase environment/);
  assert.match(browserConfig, /SUPABASE_LOCAL_ANON_KEY/);
  assert.match(browserConfig, /SUPABASE_LOCAL_SERVICE_ROLE_KEY/);
});

test('database reports have a uniquely named artifact with browser failure evidence', () => {
  assert.match(workflow, /name: release-database-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /playwright-report\/database/);
  assert.match(workflow, /test-results\/database/);
});

test('native provisioning fixture exercises the two-part password update contract', () => {
  const nativeChange = provisioning.indexOf('const nativePasswordChange');
  const linkedChange = provisioning.indexOf('const passwordChange');
  assert.ok(nativeChange > 0 && nativeChange < linkedChange);
  assert.match(provisioning, /expect\(nativePasswordChange\.response\.ok/);
  assert.match(provisioning, /expect\(signedIn\.response\.ok/);
  assert.match(provisioning, /expect\(oldPasswordSignIn\.response\.ok\)\.toBeFalsy\(\)/);
  assert.match(provisioning, /invalid_credentials/);
});

test('native provisioning legacy-table fixture is installed with service-only access', () => {
  assert.ok(readHistoricalMigrationManifest({ root: repositoryRoot })
    .some(entry => entry.source === 'supabase/ci/native_auth_legacy_user_baseline.sql'
      && entry.destination === '20260803110000_native_auth_legacy_user_baseline.sql'));
  assert.match(legacyBaseline, /create table public\.ph_app_users/);
  for (const field of ['id', 'username', 'password', 'role', 'password_hash', 'password_salt', 'password_changed_at', 'must_change_password', 'failed_login_count', 'locked_until', 'disabled_at', 'division', 'language']) {
    assert.match(legacyBaseline, new RegExp(`\\b${field} (?:integer|text|timestamptz|boolean)\\b`), field);
  }
  assert.match(legacyBaseline, /alter table public\.ph_app_users enable row level security/);
  assert.match(legacyBaseline, /revoke all on table public\.ph_app_users from public, anon, authenticated/);
  assert.match(legacyBaseline, /revoke all on sequence public\.ph_app_users_id_seq from public, anon, authenticated/);
  assert.match(legacyBaseline, /grant select, insert, update, delete on table public\.ph_app_users to service_role/);
  assert.doesNotMatch(legacyBaseline, /grant[^;]+to\s+(?:public|anon|authenticated)\b/i);
  assert.match(provisioning, /expect\(deniedLegacy\.body\.code\)\.toBe\('42501'\)/);
});

test('historical sales mapping fixture supplies imported metadata without assuming active status', () => {
  const fixture = fs.readFileSync(new URL('../supabase/ci/sales_credit_baseline.sql', import.meta.url), 'utf8');
  for (const field of ['customerstatus','consigneestatus','territorycode','territorydesc','filename','source_file_name','source_row_number','row_hash','imported_at','created_at','updated_at']) {
    assert.match(fixture, new RegExp(`\\b${field} (?:text|integer|timestamptz)\\b`), field);
  }
  assert.doesNotMatch(fixture, /(?:customerstatus|consigneestatus) text\s+[^,]*default/i);
  const requestFixture = fs.readFileSync(new URL('../supabase/ci/request_workflow_baseline.sql', import.meta.url), 'utf8');
  assert.match(requestFixture, /\blistprice text\b/);
});

test('backend matrices retain every discovered integration, entrypoint, and Edge test', () => {
  const matrices = backendTestMatrices();
  assert.deepEqual(matrices.pglite, discoverTests({ group: 'pglite' }));
  const targets = matrices.edge.include.flatMap(group => group.targets).sort();
  const tests = matrices.edge.include.flatMap(group => group.tests).sort();
  assert.deepEqual(tests, discoverTests({ group: 'deno-tests' }));
  assert.deepEqual(targets, [...discoverTests({ group: 'deno-entrypoints' }), ...tests].sort());
  assert.equal(new Set(tests).size, tests.length, 'Edge tests run exactly once');
  assert.equal(workflowConfig.jobs.integration.strategy.matrix.test, '${{ fromJSON(needs.discover.outputs.pglite) }}');
  assert.equal(workflowConfig.jobs['edge-functions'].strategy.matrix, '${{ fromJSON(needs.discover.outputs.edge) }}');
});
