import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseWorkspace, isolateCanonicalCronJob, splitPlatformDefaultPrivileges } from '../scripts/database-workspace.mjs';
import { assertUniqueSandboxTestBasenames, createSandboxDatabaseWorkspace, validateSandboxMigrationEnvelope } from '../scripts/sandbox-database-workspace.mjs';
import { withDisposableSupabase } from '../scripts/database-workspace-runner.mjs';
import { runDatabaseCheck, selectStagedHistoricalSql, stagedDatabaseFiles } from '../scripts/database-check.mjs';
import { prepareHistoricalDatabaseFixture, readHistoricalMigrationManifest } from '../scripts/historical-database-fixture.mjs';
import { discoverTests } from '../scripts/test-discovery.mjs';
import { generateContracts } from '../scripts/generate-database-contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('database workspace replays the production baseline and active chain without archive duplication', () => {
  const sourceConfig = readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
  const activeNames = readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => /^\d{14}_.+\.sql$/i.test(name)).sort();
  const workspace = createDatabaseWorkspace({ root });
  try {
    const migrations = path.join(workspace.root, 'supabase', 'migrations');
    const workspaceNames = readdirSync(migrations).sort();
    assert.equal(workspace.migrationCount, activeNames.length + 3);
    assert.equal(workspaceNames.length, activeNames.length + 3);
    assert.equal(workspaceNames[0], '20260929195959_typegen_schema_bootstrap.sql');
    assert.equal(workspaceNames[1], '20260929200000_production_baseline.sql');
    assert.equal(workspaceNames[2], '20260929200001_baseline_private_catalog_postlude.sql');
    const prerequisiteIndex = workspaceNames.indexOf('20261002134137_ci_canonical_migration_data_prerequisites.sql');
    assert.ok(prerequisiteIndex > 3);
    assert.equal(workspaceNames[prerequisiteIndex - 1], '20261002121446_aura_inventory_v2_007.sql');
    assert.equal(workspaceNames[prerequisiteIndex + 1], '20261002134138_nelly_access_audit_baseline_repair_007.sql');
    assert.deepEqual(workspaceNames.slice(3).filter(name => name !== '20261002134137_ci_canonical_migration_data_prerequisites.sql'),
      activeNames.filter((name) => name !== '20260929200000_production_baseline.sql'));
    const baseline = readFileSync(path.join(migrations, '20260929200000_production_baseline.sql'), 'utf8');
    const postlude = readFileSync(path.join(migrations, workspaceNames[2]), 'utf8');
    assert.match(baseline, /CREATE SCHEMA IF NOT EXISTS public;/);
    assert.match(baseline, /CREATE TABLE "private"\."ph_eval_item_low_stock_order_rows"[\s\S]*"itemcode_normalized" text GENERATED ALWAYS AS \(upper\(btrim\(itemcode\)\)\) STORED/);
    assert.match(baseline, /ALTER TABLE "app_sync_private"\."sources" ADD CONSTRAINT "sources_pkey" PRIMARY KEY \(key\)/);
    assert.match(postlude, /CREATE TRIGGER app_dataset_revision_inserted/);
    assert.match(baseline, /CREATE OR REPLACE FUNCTION private\./);
    assert.match(postlude, /RESET check_function_bodies;/);
    const platformSql = readFileSync(workspace.platformPrivilegeSqlPath, 'utf8');
    assert.equal((platformSql.match(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\b/gm) || []).length, 6);
    assert.match(platformSql, /GRANT ALL ON TABLES TO service_role;/);
    assert.doesNotMatch(baseline, /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\b/gm);
    assert.match(readFileSync(path.join(root, 'supabase/migrations/20260929200000_production_baseline.sql'), 'utf8'),
      /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;/m);
    assert.match(readFileSync(path.join(migrations, workspaceNames[0]), 'utf8'), /create schema if not exists aura_private;/);
    const prerequisites = readFileSync(path.join(migrations, workspaceNames[prerequisiteIndex]), 'utf8');
    assert.match(prerequisites, /CANONICAL_FIXTURE_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE/);
    assert.match(prerequisites, /nelly\.baseline\.fixture@local\.invalid/);
    assert.match(prerequisites, /select source_key, 1, 'ready' from tracked_sources/);
    assert.match(prerequisites, /source_key, '\{\}'::text\[\], false, true/);
    assert.match(prerequisites, /trigger_function\.proname = 'touch_source'/);
    assert.match(prerequisites, /\('drive\.reclass\.submit', 'action', 'drive', 'Submit Reclass inquiry',[\s\S]*?array\['assigned','global'\]::text\[\], 614, true\)/);
    assert.match(prerequisites, /'ADMIN', 'drive\.reclass\.submit', true, 'global'/);
    const permissionSeed = readFileSync(path.join(root, 'supabase/archive_migrations/20260903032040_protected_drive_reclass_inquiry_v1.sql'), 'utf8');
    assert.match(permissionSeed, /\('drive\.reclass\.submit', 'action', 'drive', 'Submit Reclass inquiry',[\s\S]*?array\['assigned', 'global'\]::text\[\], 614, true\)/);
    const activePermissionReferences = readdirSync(path.join(root, 'supabase/migrations'))
      .filter((name) => /^\d{14}_.+\.sql$/i.test(name))
      .map((name) => ({ name, sql: readFileSync(path.join(root, 'supabase/migrations', name), 'utf8') }))
      .filter(({ sql }) => /insert\s+into\s+private\.app_access_legacy_checks/i.test(sql));
    assert.deepEqual(activePermissionReferences.map(({ name }) => name), ['20261006145333_reclass_split_move_inquiries_v4.sql']);
    assert.match(activePermissionReferences[0].sql, /'drive\.reclass\.submit'/);
    assert.equal(readdirSync(path.join(root, 'supabase', 'migrations')).includes(workspaceNames[prerequisiteIndex]), false,
      'synthetic fixture is injected only into the disposable workspace');
    for (const [migrationName, jobName] of [
      ['20261001025638_aura_hr_command_center_v1.sql', 'hr_calendar_reminder_sweep'],
      ['20261001215508_scheduled_handover_005.sql', 'scheduled_handover_kayla_nelly_20261002'],
    ]) {
      const sourceText = readFileSync(path.join(root, 'supabase/migrations', migrationName), 'utf8');
      const replayText = readFileSync(path.join(migrations, migrationName), 'utf8');
      assert.match(replayText, new RegExp(`cron\\.alter_job\\(jobid, active := false\\)[\\s\\S]*?jobname='${jobName}'[\\s\\S]*?commit;\\s*$`, 'i'));
      assert.doesNotMatch(sourceText, /Disposable canonical replay only: prevent wall-clock job side effects/);
    }
    assert.match(readFileSync(path.join(workspace.root, 'supabase', 'config.toml'), 'utf8'), new RegExp(`project_id = "${workspace.projectId}"`));
    assert.notEqual(readFileSync(path.join(workspace.root, 'supabase', 'config.toml'), 'utf8'), sourceConfig);
    assert.equal(existsSync(path.join(workspace.root, 'supabase', 'tests')), false);
  } finally {
    workspace.dispose();
  }
  assert.equal(existsSync(workspace.root), false);
});

test('canonical cron isolation is limited to approved scheduled migrations and requires a transaction', () => {
  const migration = '20261001025638_aura_hr_command_center_v1.sql';
  const source = "begin;\nselect cron.schedule('hr_calendar_reminder_sweep', '*/5 * * * *', 'select 1');\ncommit;\n";
  const isolated = isolateCanonicalCronJob(source, migration);
  assert.match(isolated, /cron\.schedule\('hr_calendar_reminder_sweep'/);
  assert.match(isolated, /cron\.alter_job\(jobid, active := false\)/);
  assert.match(isolated, /jobname='hr_calendar_reminder_sweep';\s*commit;\s*$/);
  assert.equal(isolateCanonicalCronJob('select 1;', 'unrelated.sql'), 'select 1;');
  assert.throws(() => isolateCanonicalCronJob('begin; commit; select 1;', migration), /DATABASE_CRON_SCHEDULE_MISSING/);
  assert.throws(() => isolateCanonicalCronJob("select cron.schedule('hr_calendar_reminder_sweep');", migration), /DATABASE_CRON_ISOLATION_TRANSACTION_INVALID/);
});

test('platform default privilege splitter preserves baseline text except the owner-only statements', () => {
  const source = '-- retained comment\nALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;\n'
    + '-- platform ACL\nALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;\n';
  const split = splitPlatformDefaultPrivileges(source);
  assert.equal(split.baseline, '-- retained comment\nALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;');
  assert.equal(split.platformSql, 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;\n');
  assert.throws(() => splitPlatformDefaultPrivileges('select 1;'), /DATABASE_PLATFORM_PRIVILEGES_MISSING/);
});

test('database validation workspace includes discovered pgTAP tests and excludes unregistered SQL fixtures', () => {
  const expected = discoverTests({ root, group: 'sql-pgtap' });
  const workspace = createDatabaseWorkspace({ root, includeTests: true, discoverTests });
  try {
    const actual = readdirSync(path.join(workspace.root, 'supabase', 'tests')).sort();
    assert.equal(actual.length, expected.length);
    assert.deepEqual(actual, expected.map((file) => path.basename(file)).sort());
    assert.ok(actual.includes('aura_dynamic_season_scope_test.sql'));
    assert.equal(actual.some((name) => /rollback|canary/i.test(name)), false);
  } finally {
    workspace.dispose();
  }
});

test('canonical schema validation includes only its self-contained schema-contract tests', () => {
  const expected = discoverTests({ root, group: 'sql-canonical' });
  assert.ok(expected.includes('supabase/tests/canonical_schema_contract_test.sql'));
  assert.ok(expected.length > 0);
  const workspace = createDatabaseWorkspace({ root, includeTests: true, testGroup: 'sql-canonical', discoverTests });
  try {
    const actual = readdirSync(path.join(workspace.root, 'supabase', 'tests')).sort();
    assert.deepEqual(actual, expected.map((file) => path.basename(file)).sort());
  } finally {
    workspace.dispose();
  }
});

test('sandbox workspace layers discovered migrations and tests after the schema-only capture', () => {
  const sourceMigrations = readdirSync(path.join(root, 'supabase/sandbox/migrations')).filter(name => name.endsWith('.sql')).sort();
  const sourceTests = discoverTests({ root, group: 'sandbox-pgtap' });
  const workspace = createSandboxDatabaseWorkspace({ root, includeTests: true, discover: discoverTests });
  try {
    assert.equal(workspace.migrationCount, sourceMigrations.length + 1);
    assert.equal(workspace.testCount, sourceTests.length);
    assert.ok(workspace.lintSchemas.includes('public'));
    assert.ok(workspace.lintSchemas.includes('private'));
    const copiedMigrations = readdirSync(path.join(workspace.root, 'supabase/migrations')).sort();
    assert.deepEqual(copiedMigrations, ['20260929200000_sandbox_project_schema.sql', ...sourceMigrations]);
    assert.deepEqual(readdirSync(path.join(workspace.root, 'supabase/tests')).sort(), sourceTests.map(file => path.basename(file)).sort());
    const migration = readFileSync(path.join(workspace.root, 'supabase', 'migrations', '20260929200000_sandbox_project_schema.sql'), 'utf8');
    assert.match(migration, /CREATE TABLE "public"\."sandbox_profiles"/);
    assert.match(migration, /CREATE TABLE "bloomscapes_demo"\."environment"/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION private\./);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bloomscapes_demo_api_v1/);
    assert.match(migration, /RESET check_function_bodies;/);
    assert.doesNotMatch(migration, /INSERT INTO "public"\./i);
  } finally {
    workspace.dispose();
  }
});

test('sandbox migration transaction envelopes reject interior transaction controls', () => {
  assert.doesNotThrow(() => validateSandboxMigrationEnvelope('-- sandbox-only\nBEGIN;\nSELECT 1;\nCOMMIT;\n', 'valid.sql'));
  assert.throws(() => validateSandboxMigrationEnvelope('BEGIN;\nROLLBACK;\nSELECT 1;\nCOMMIT;\n', 'rollback.sql'),
    /SANDBOX_MIGRATION_TRANSACTION_REQUIRED/);
  assert.throws(() => validateSandboxMigrationEnvelope('BEGIN;\nSELECT 1;\nCOMMIT AND CHAIN;\n', 'chain.sql'),
    /SANDBOX_MIGRATION_TRANSACTION_REQUIRED/);
  assert.throws(() => validateSandboxMigrationEnvelope('BEGIN;\nSAVEPOINT inner;\nSELECT 1;\nCOMMIT;\n', 'savepoint.sql'),
    /SANDBOX_MIGRATION_TRANSACTION_REQUIRED/);
  assert.throws(() => assertUniqueSandboxTestBasenames([
    'supabase/sandbox/tests/Case_test.sql', 'supabase/sandbox/tests/nested/case_test.sql',
  ]), /SANDBOX_TEST_BASENAME_COLLISION/);
});

test('disposable database checks fail when stack cleanup fails without hiding the primary error', () => {
  let disposed = false;
  const workspace = { root: 'C:/tmp/gnc-db-test', dispose() { disposed = true; } };
  const execute = (args) => {
    if (args.at(-2) === 'stop') throw new Error('stop failed');
    return '';
  };
  assert.throws(() => withDisposableSupabase({ root, workspace, cli: 'supabase', execute, action: () => 'ok' }), /DATABASE_STACK_CLEANUP_FAILED:stop: stop failed/);
  assert.equal(disposed, false, 'keep workspace config available if the stack might still be running');

  disposed = false;
  assert.throws(() => withDisposableSupabase({
    root,
    workspace,
    cli: 'supabase',
    execute,
    action: () => { throw new Error('primary failure'); },
  }), /primary failure; disposable DB cleanup failed \(stop: stop failed; workspace retained at C:\/tmp\/gnc-db-test because the stack did not stop\)/);
  assert.equal(disposed, false);
});

test('disposable runner applies the owner ACL sidecar after start and each successful reset', t => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-db-workspace-acl-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const platformPrivilegeSqlPath = path.join(workspaceRoot, 'platform-admin-default-privileges.sql');
  const sql = 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;\n';
  writeFileSync(platformPrivilegeSqlPath, sql);
  const events = [];
  const workspace = { root: workspaceRoot, platformPrivilegeSqlPath, dispose: () => events.push('dispose') };
  const executeNode = args => { events.push(args.slice(3, 5).join(' ')); return ''; };
  const executeDocker = (command, args, options) => {
    events.push(args.includes('psql') ? `admin:${options.input}` : args[0]);
    return '';
  };
  withDisposableSupabase({ root, workspace, cli: 'supabase', execute: executeNode, executeDocker,
    inspectWorkspace: () => ({ containerId: 'a'.repeat(64) }), action: runCli => {
      runCli(['db', 'reset', '--local']);
      events.push('checks');
    } });
  const adminCalls = events.filter(event => typeof event === 'string' && event.startsWith('admin:'));
  const adminIndexes = events.map((event, index) => typeof event === 'string' && event.startsWith('admin:') ? index : -1).filter(index => index >= 0);
  assert.equal(adminCalls.length, 2);
  assert.ok(adminCalls.every(event => event.includes(`BEGIN;\n${sql}\nCOMMIT;`)));
  assert.ok(events.indexOf('start --exclude') < adminIndexes[0]);
  assert.ok(events.indexOf('db reset') < adminIndexes[1]);
  assert.ok(events.indexOf('checks') > adminIndexes[1]);
  assert.ok(events.includes('dispose'));
});

test('owner ACL replay failure aborts checks and triggers disposable stack cleanup', t => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-db-workspace-acl-fail-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const platformPrivilegeSqlPath = path.join(workspaceRoot, 'platform-admin-default-privileges.sql');
  writeFileSync(platformPrivilegeSqlPath, 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;\n');
  let checksRan = false, disposed = false, stopped = false;
  assert.throws(() => withDisposableSupabase({
    root, workspace: { root: workspaceRoot, platformPrivilegeSqlPath, dispose: () => { disposed = true; } },
    cli: 'supabase', execute: args => { if (args.includes('stop')) stopped = true; return ''; },
    executeDocker: () => { throw new Error('admin replay failed'); },
    inspectWorkspace: () => ({ containerId: 'b'.repeat(64) }),
    action: () => { checksRan = true; },
  }), /admin replay failed/);
  assert.equal(checksRan, false);
  assert.equal(stopped, true);
  assert.equal(disposed, true);
});

test('database-check uses the shared fail-closed runner for both disposable workspaces', () => {
  let productionDisposed = false, sandboxDisposed = false;
  const productionWorkspace = { root: 'C:/tmp/gnc-production-db', migrationCount: 4, dispose() { productionDisposed = true; } };
  const sandboxWorkspace = { root: 'C:/tmp/gnc-sandbox-db', migrationCount: 1, testCount: 1, lintSchemas: ['public'], dispose() { sandboxDisposed = true; } };
  let sandboxCreated = false;
  const rollbackRuns = [];
  const cliCommands = [];
  const executeNode = failStopRoot => (args, options = {}) => {
    const workspaceRoot = args[2];
    cliCommands.push({ workspaceRoot, command: args.slice(3).join(' ') });
    if (args.at(-2) === 'stop' && workspaceRoot === failStopRoot) throw new Error('stop failed');
    if (args.includes('gen')) {
      const typePath = workspaceRoot === sandboxWorkspace.root
        ? 'v2/src/services/sandbox.database.types.ts' : 'supabase/functions/_shared/database.types.ts';
      return readFileSync(path.join(root, typePath), 'utf8');
    }
    return options.capture ? '' : '';
  };
  const check = (executeNodeMock) => runDatabaseCheck({
    root, mode: 'all', execute: () => '', executeNode: executeNodeMock, preflight: () => {},
    runLintWithTempContext: ({ action }) => action(),
    runRollback: options => { rollbackRuns.push(options.files); return { files: options.files }; },
    resolveCli: () => 'supabase-fixture',
    createProductionWorkspace: () => productionWorkspace,
    createSandboxWorkspace: options => { sandboxCreated = true; assert.equal(options.includeTests, true); return sandboxWorkspace; },
  });

  assert.throws(() => check(executeNode(productionWorkspace.root)), /DATABASE_STACK_CLEANUP_FAILED:stop: stop failed; workspace retained at C:\/tmp\/gnc-production-db/);
  assert.equal(sandboxCreated, false, 'a failed production stop prevents starting a second stack');
  assert.equal(productionDisposed, false);
  const allRollbackFiles = discoverTests({ root, group: 'sql-rollback' });
  assert.deepEqual(rollbackRuns[0], allRollbackFiles, '--all executes every discovered rollback canary in the canonical workspace');

  assert.throws(() => check(executeNode(sandboxWorkspace.root)), /DATABASE_STACK_CLEANUP_FAILED:stop: stop failed; workspace retained at C:\/tmp\/gnc-sandbox-db/);
  assert.equal(productionDisposed, true, 'the production workspace is disposed after a successful stop');
  assert.equal(sandboxDisposed, false, 'the sandbox workspace is retained after a failed stop');
  assert.deepEqual(rollbackRuns[1], allRollbackFiles);
  const sandboxCommands = cliCommands.filter(item => item.workspaceRoot === sandboxWorkspace.root).map(item => item.command);
  const sandboxLint = sandboxCommands.findIndex(command => command.startsWith('db lint'));
  assert.ok(sandboxLint >= 0 && sandboxCommands.indexOf('test db') > sandboxLint,
    'sandbox pgTAP runs after strict sandbox SQL lint');
});

test('staged database-check executes changed rollback and discovered SQL fixtures in disposable workspaces', () => {
  const staged = ['supabase/tests/photo_history_rollback_canary.sql', 'supabase/tests/aura_internal_query_test.sql',
    'supabase/tests/bloomscapes_pending_orders_test.sql', 'supabase/sandbox/tests/sandbox_inventory_test.sql'];
  const productionWorkspace = { root: 'C:/tmp/gnc-production-stage', migrationCount: 4, dispose() {} };
  const sandboxWorkspace = { root: 'C:/tmp/gnc-sandbox-stage', migrationCount: 1, testCount: 1, lintSchemas: ['public'], dispose() {} };
  const historicalWorkspace = { root: 'C:/tmp/gnc-historical-stage', migrationCount: 171,
    directTests: ['supabase/tests/aura_internal_query_test.sql'], acceptanceTests: [], dispose() {} };
  const events = [];
  let historicalInput;
  let dedicatedGroups;
  const result = runDatabaseCheck({
    root, mode: 'staged', execute: () => staged.join('\0'), preflight: () => {}, resolveCli: () => 'supabase-fixture',
    createProductionWorkspace: () => productionWorkspace,
    createSandboxWorkspace: options => { assert.equal(options.includeTests, true); return sandboxWorkspace; },
    createHistoricalWorkspace: options => { historicalInput = options; return historicalWorkspace; },
    runLintWithTempContext: ({ action }) => action(),
    runRollback: options => { events.push({ type: 'rollback', files: options.files }); return { files: options.files }; },
    runDedicatedPostgres: options => { dedicatedGroups = options.groups; return { results: [{ files: ['supabase/tests/bloomscapes_pending_orders_test.sql'] }] }; },
    executeNode: (args, options = {}) => {
      const workspaceRoot = args[2];
      const command = args.slice(3).join(' ');
      events.push({ type: 'cli', workspaceRoot, command });
      if (args.includes('gen')) {
        const typePath = workspaceRoot === sandboxWorkspace.root
          ? 'v2/src/services/sandbox.database.types.ts' : 'supabase/functions/_shared/database.types.ts';
        return readFileSync(path.join(root, typePath), 'utf8');
      }
      return options.capture ? '' : '';
    },
  });
  assert.deepEqual(historicalInput.testFiles, ['supabase/tests/aura_internal_query_test.sql']);
  assert.deepEqual(events.find(event => event.type === 'rollback').files, ['supabase/tests/photo_history_rollback_canary.sql']);
  assert.deepEqual(dedicatedGroups, ['bloomscapes-pgtap']);
  assert.ok(events.some(event => event.workspaceRoot === historicalWorkspace.root && event.command === 'test db'));
  const sandboxCommands = events.filter(event => event.workspaceRoot === sandboxWorkspace.root).map(event => event.command);
  assert.ok(sandboxCommands.indexOf('test db') > sandboxCommands.findIndex(command => command.startsWith('db lint')),
    'sandbox pgTAP runs after strict sandbox SQL lint');
  assert.equal(result.rollbackTests, 1);
  assert.equal(result.dedicatedPostgresTests, 1);
  assert.equal(result.historicalSqlTests, 1);
  assert.equal(result.historicalMigrations, 171);
  assert.equal(result.sandboxSqlTests, 1);
});

test('release SQL validation lints PL/pgSQL before executing discovered behavior tests', () => {
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'release-database.yml'), 'utf8');
  const lint = workflow.indexOf('node scripts/sql-lint-temp-context.mjs --historical-reset');
  const tests = workflow.indexOf('supabase --workdir "$SUPABASE_CI_ROOT" test db');
  assert.ok(lint >= 0, 'release workflow must fail on PL/pgSQL errors');
  assert.ok(tests > lint, 'database lint must run before pgTAP');
  const context = readFileSync(path.join(root, 'scripts/sql-lint-temp-context.mjs'), 'utf8');
  assert.match(context, /'db', 'lint', '--local', '--schema', DATABASE_LINT_SCHEMAS\.join\(','\), '--fail-on', 'error'/);
});

test('generated runtime contracts are synchronized with production and sandbox database types', () => {
  assert.equal(generateContracts({ root, check: true }), undefined);
});

test('database pre-commit recognizes staged database tooling and schema configuration', () => {
  const files = ['scripts/database-types.mjs', 'scripts/generate-database-contracts.mjs', 'scripts/historical-database-fixture.mjs',
    'scripts/historical-database-migrations.json', 'scripts/run-sql-rollback-tests.mjs', 'scripts/prepare-isolated-sql-tests.mjs',
    'scripts/disposable-supabase-container.mjs', 'scripts/sql-lint-temp-context.mjs',
    'scripts/run-postgres-fixture-sql-tests.mjs',
    'scripts/run-discovered-database-tests.mjs',
    'scripts/test-discovery.mjs',
    'scripts/sandbox-database-workspace.mjs',
    '.github/workflows/release-database.yml', 'supabase/config.toml', 'services/database-contracts.generated.ts', 'v2/src/services/sandbox.database.types.ts'];
  const actual = stagedDatabaseFiles({ root, execute: () => files.join('\0') });
  assert.deepEqual(actual, files);
});

test('historical migration order manifest preserves original inputs and appends approved SQL repairs', () => {
  const manifest = readHistoricalMigrationManifest({ root });
  const workflow = readFileSync(path.join(root, '.github/workflows/release-database.yml'), 'utf8');
  assert.equal(manifest.length, 173);
  assert.equal(new Set(manifest.map(entry => entry.destination)).size, manifest.length);
  assert.deepEqual(manifest.slice(-2).map(entry => entry.source), [
    'supabase/migrations/20261007211325_sql_function_correctness_repairs.sql',
    'supabase/migrations/20261007211340_sql_lint_runtime_context.sql',
  ]);
  assert.deepEqual(manifest.map(entry => entry.destination), [...manifest.map(entry => entry.destination)].sort());
  for (const entry of manifest) assert.ok(existsSync(path.join(root, entry.source)), entry.source);
  assert.match(workflow, /node scripts\/historical-database-fixture\.mjs "\$RUNNER_TEMP\/gnc-supabase-ci"/);
  assert.doesNotMatch(workflow, /cp supabase\/(?:ci|archive_migrations|migrations)\/[^\s]+\.sql "\$ci_root\/supabase\/migrations\//);
  assert.doesNotMatch(workflow, /python3 - "\$ci_root"/);
});

test('historical fixture builder preserves ordered migrations and isolates the scheduled handover', t => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-historical-fixture-source-'));
  const destination = path.join(mkdtempSync(path.join(os.tmpdir(), 'gnc-historical-fixture-dest-')), 'project');
  t.after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(path.dirname(destination), { recursive: true, force: true });
  });
  for (const directory of ['supabase/ci', 'supabase/migrations', 'supabase/functions', 'supabase/tests', 'utils']) {
    mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
  }
  writeFileSync(path.join(fixtureRoot, 'supabase/config.toml'), 'project_id = "fixture"\n');
  writeFileSync(path.join(fixtureRoot, 'supabase/functions/index.ts'), 'export {};\n');
  writeFileSync(path.join(fixtureRoot, 'utils/auraLingo.js'), 'export {};\n');
  writeFileSync(path.join(fixtureRoot, 'supabase/ci/base.sql'), 'select 1;\r\n');
  writeFileSync(path.join(fixtureRoot, 'supabase/ci/scheduled_handover_isolation.sql'), 'select 2;\n');
  writeFileSync(path.join(fixtureRoot, 'supabase/migrations/20261001215508_scheduled_handover_005.sql'), 'begin;\nselect 3;\ncommit;\n');
  writeFileSync(path.join(fixtureRoot, 'supabase/tests/direct_test.sql'), 'select 1;\n');
  writeFileSync(path.join(fixtureRoot, 'supabase/tests/acceptance_test.sql'), 'select 2;\n');
  writeFileSync(path.join(fixtureRoot, 'manifest.json'), JSON.stringify([
    { source: 'supabase/ci/base.sql', destination: '20261001215507_baseline.sql' },
    { source: 'supabase/migrations/20261001215508_scheduled_handover_005.sql', destination: '20261001215508_scheduled_handover_005.sql' },
  ]));
  const discover = ({ group }) => group === 'sql-isolated-supabase'
    ? ['supabase/tests/direct_test.sql'] : group === 'sql-isolated-acceptance' ? ['supabase/tests/acceptance_test.sql'] : [];
  const fixture = prepareHistoricalDatabaseFixture({ root: fixtureRoot, destination, manifestPath: 'manifest.json', discoverTests: discover });
  assert.equal(fixture.migrationCount, 2);
  assert.equal(readFileSync(path.join(destination, 'supabase/migrations/20261001215507_baseline.sql'), 'utf8'), 'select 1;\n');
  assert.equal(readFileSync(path.join(fixtureRoot, 'supabase/ci/base.sql'), 'utf8'), 'select 1;\r\n');
  assert.deepEqual(readdirSync(path.join(destination, 'supabase/migrations')), [
    '20261001215507_baseline.sql', '20261001215508_scheduled_handover_005.sql',
  ]);
  assert.match(readFileSync(path.join(destination, 'supabase/migrations/20261001215508_scheduled_handover_005.sql'), 'utf8'), /select 2;\s*commit;\s*$/);
  assert.deepEqual(readdirSync(path.join(destination, 'supabase/tests')).sort(), ['acceptance_test.sql', 'direct_test.sql']);
  assert.equal(existsSync(path.join(destination, 'supabase/seed.sql')), true);
});

test('staged SQL selection runs only changed canaries and conservatively expands for migration or fixture changes', () => {
  const rollback = 'supabase/tests/photo_history_rollback_canary.sql';
  const isolated = 'supabase/tests/aura_internal_query_test.sql';
  const direct = discoverTests({ root, group: 'sql-isolated-supabase' });
  const acceptance = discoverTests({ root, group: 'sql-isolated-acceptance' });
  const groups = { 'sql-rollback': [rollback], 'sql-isolated-supabase': direct, 'sql-isolated-acceptance': acceptance };
  const discover = ({ group }) => groups[group] || [];
  const targeted = selectStagedHistoricalSql({ root, files: [rollback, isolated], discover });
  assert.deepEqual(targeted.rollbackFiles, [rollback]);
  assert.deepEqual(targeted.historicalFiles, [isolated]);
  assert.deepEqual(targeted.dedicatedPostgresGroups, []);
  const migration = selectStagedHistoricalSql({ root, files: ['supabase/migrations/new_migration.sql'], discover });
  assert.deepEqual(migration.rollbackFiles, [rollback]);
  assert.deepEqual(migration.historicalFiles, [...direct, ...acceptance]);
  const fixtureTool = selectStagedHistoricalSql({ root, files: ['scripts/historical-database-fixture.mjs'], discover });
  assert.deepEqual(fixtureTool.historicalFiles, [...direct, ...acceptance]);
  const specialFixture = selectStagedHistoricalSql({ root, files: ['supabase/ci/suspend_tag_baseline.sql'] });
  assert.deepEqual(specialFixture.historicalFiles, []);
  assert.deepEqual(specialFixture.dedicatedPostgresGroups, ['suspend-tag-pgtap']);
});
