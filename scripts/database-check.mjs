import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabaseWorkspace, DATABASE_LINT_SCHEMAS } from './database-workspace.mjs';
import { createSandboxDatabaseWorkspace } from './sandbox-database-workspace.mjs';
import { discoverTests } from './test-discovery.mjs';
import { doctor } from './tooling-doctor.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';
import { generatedDatabaseTypesPath, sandboxDatabaseTypesPath } from './database-types.mjs';
import { generateContracts } from './generate-database-contracts.mjs';
import { withDisposableSupabase } from './database-workspace-runner.mjs';
import { prepareHistoricalDatabaseFixture, readHistoricalMigrationManifest } from './historical-database-fixture.mjs';
import { runSqlRollbackTests } from './run-sql-rollback-tests.mjs';
import { runPostgresFixtureSqlTests, selectAffectedPostgresFixtureSqlGroups } from './run-postgres-fixture-sql-tests.mjs';
import { withSqlLintTempContext } from './sql-lint-temp-context.mjs';
import { runDatabasePerformanceBenchmark } from './performance-database.mjs';

const historicalFixtureTooling = new Set([
  'scripts/sql-lint-temp-context.mjs',
  'scripts/historical-database-fixture.mjs', 'scripts/historical-database-migrations.json',
  'scripts/disposable-supabase-container.mjs',
  'scripts/prepare-isolated-sql-tests.mjs', 'scripts/run-sql-rollback-tests.mjs',
  'scripts/run-postgres-fixture-sql-tests.mjs', 'scripts/database-workspace-runner.mjs', '.github/workflows/release-database.yml',
  'scripts/run-discovered-database-tests.mjs', 'scripts/test-discovery.mjs', 'scripts/sql-lint-temp-context.mjs',
]);

export function stagedDatabaseFiles({ root = repoRoot, execute = run } = {}) {
  return execute('git', ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMD', '-z'], { root, capture: true })
    .split('\0').filter(Boolean).map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.sql') || file === generatedDatabaseTypesPath || file === sandboxDatabaseTypesPath
      || file === 'services/database-contracts.generated.ts' || file === 'v2/src/services/sandbox-contracts.generated.ts' || file.startsWith('supabase/ci/')
      || file === 'performance/sql-schema-extensions.json'
      || /^scripts\/(?:database-|sandbox-database-workspace|db-|generate-database|check-database|historical-database-|disposable-supabase-container|run-sql-rollback-tests|run-postgres-fixture-sql-tests|run-discovered-database-tests|prepare-isolated-sql-tests|test-discovery)/.test(file)
      || historicalFixtureTooling.has(file)
      || /^supabase\/(?:config\.toml|schema\/)/.test(file));
}

export function selectStagedHistoricalSql({ root, files, discover = discoverTests } = {}) {
  const historicalSources = new Set(readHistoricalMigrationManifest({ root }).map(entry => entry.source));
  const migrationsChanged = files.some(file => file.startsWith('supabase/migrations/')
    || file.startsWith('supabase/archive_migrations/') || historicalSources.has(file));
  const toolingChanged = files.some(file => historicalFixtureTooling.has(file)
    || /^scripts\/(?:historical-database-|disposable-supabase-container|run-sql-rollback-tests|prepare-isolated-sql-tests)/.test(file));
  const rollback = discover({ root, group: 'sql-rollback' });
  const changedRollback = files.filter(file => rollback.includes(file));
  const rollbackFiles = migrationsChanged || toolingChanged ? rollback : changedRollback;

  const direct = discover({ root, group: 'sql-isolated-supabase' });
  const acceptance = discover({ root, group: 'sql-isolated-acceptance' });
  const allHistorical = [...direct, ...acceptance];
  const changedHistorical = files.filter(file => allHistorical.includes(file));
  const historicalFiles = migrationsChanged || toolingChanged ? allHistorical : changedHistorical;
  return { migrationOrToolingChanged: migrationsChanged || toolingChanged, rollbackFiles, historicalFiles,
    dedicatedPostgresGroups: selectAffectedPostgresFixtureSqlGroups({ root, files, discover }) };
}

export function runDatabaseCheck({ root = repoRoot, mode = 'staged', execute = run, executeNode = runNode, preflight = doctor,
  createProductionWorkspace = createDatabaseWorkspace, createSandboxWorkspace = createSandboxDatabaseWorkspace,
  createHistoricalWorkspace = prepareHistoricalDatabaseFixture, runRollback = runSqlRollbackTests,
  runDedicatedPostgres = runPostgresFixtureSqlTests, runLintWithTempContext = withSqlLintTempContext,
  runPerformance = runDatabasePerformanceBenchmark,
  runApiPerformance = ({ root: runRoot, workspaceRoot, executeNode: runChild }) =>
    runChild(['scripts/run-performance-api.mjs', workspaceRoot], { root: runRoot }),
  environment = process.env,
  savePerformance = (report, reportRoot) => {
    const directory = path.join(reportRoot, 'artifacts', 'performance');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'database-sql.json'), `${JSON.stringify(report, null, 2)}\n`);
  },
  resolveCli = packageBin } = {}) {
  if (mode !== 'staged' && mode !== 'all') throw new Error('Usage: node scripts/database-check.mjs --staged|--all');
  const apiBenchmarkRequested = environment.PERFORMANCE_API_BENCHMARK === 'true';
  if (apiBenchmarkRequested && mode !== 'all') throw new Error('PERFORMANCE_API_BENCHMARK_REQUIRES_ALL_MODE');
  if (apiBenchmarkRequested && environment.GITHUB_ACTIONS !== 'true') throw new Error('PERFORMANCE_API_BENCHMARK_CI_ONLY');
  const stagedFiles = stagedDatabaseFiles({ root, execute });
  if (mode === 'staged' && stagedFiles.length === 0) {
    throw new Error('DATABASE_STAGED_FILES_REQUIRED');
  }
  const selectedHistorical = mode === 'staged' ? selectStagedHistoricalSql({ root, files: stagedFiles }) : null;
  const rollbackFilesToRun = mode === 'all' ? discoverTests({ root, group: 'sql-rollback' }) : selectedHistorical?.rollbackFiles || [];
  if (mode === 'all' && rollbackFilesToRun.length === 0) throw new Error('SQL_ROLLBACK_TESTS_REQUIRED');
  preflight({ root, database: true });
  const workspace = createProductionWorkspace({ root, includeTests: true, testGroup: 'sql-canonical', discoverTests });
  const cli = resolveCli('supabase', 'supabase', root);
  const strictLint = (targetWorkspace, runCli, allowMissingFunctions = false) => runLintWithTempContext({
    root, workspaceRoot: targetWorkspace.root, cli, executeNode, executeDocker: execute, allowMissingFunctions,
    action: () => runCli(['db', 'lint', '--local', '--schema', DATABASE_LINT_SCHEMAS.join(','), '--fail-on', 'error']),
  });
  const productionResult = withDisposableSupabase({ root, workspace, cli, execute: executeNode,
    serviceProfile: apiBenchmarkRequested ? 'benchmark-http' : 'database', action: runCli => {
    // start has applied the complete migration chain. Measure before reset so
    // the child can independently verify the CLI's workdir container label;
    // reset replaces the container and retains proof only in this process.
    if (mode === 'all') {
      const directory = path.join(root, 'artifacts', 'performance');
      mkdirSync(directory, { recursive: true });
      const reportPath = path.join(directory, `database-sql-attempt-${Date.now()}-${process.pid}.json`);
      const report = runPerformance({ root, workspaceRoot: workspace.root, cli, executeNode, reportPath });
      savePerformance(report, root);
      if (apiBenchmarkRequested) runApiPerformance({ root, workspaceRoot: workspace.root, cli, executeNode });
    }
    runCli(['db', 'reset', '--local', '--no-seed']);
    strictLint(workspace, runCli);
    runCli(['test', 'db']);

    const actual = runCli(['gen', 'types', '--local', '--schema', 'public', '--lang', 'typescript'], { capture: true });
    if (!actual.includes('export type Database =')) throw new Error('DATABASE_TYPES_GENERATION_EMPTY');
    const expected = readFileSync(path.join(root, generatedDatabaseTypesPath), 'utf8');
    if (expected !== actual && expected !== `${actual}\n`) throw new Error('DATABASE_TYPES_OUT_OF_DATE: run npm run types:db:generate and review the schema diff');
    if (rollbackFilesToRun.length) {
      runRollback({ root, workspaceRoot: workspace.root, cli, executeNode, execute, files: rollbackFilesToRun });
    }
    let dedicatedPostgresTests = 0;
    if (selectedHistorical?.dedicatedPostgresGroups.length) {
      const result = runDedicatedPostgres({ root, workspaceRoot: workspace.root, cli,
        groups: selectedHistorical.dedicatedPostgresGroups, execute, executeNode });
      dedicatedPostgresTests = result.results.reduce((count, item) => count + item.files.length, 0);
    }
    return { stagedFiles, migrations: workspace.migrationCount, sqlTests: discoverTests({ root, group: 'sql-canonical' }).length,
      rollbackTests: rollbackFilesToRun.length, dedicatedPostgresTests };
  } });

  let historicalResult = { migrationCount: 0, sqlTests: 0 };
  if (selectedHistorical?.historicalFiles.length) {
    const historicalWorkspace = createHistoricalWorkspace({ root, testFiles: selectedHistorical.historicalFiles });
    historicalResult = withDisposableSupabase({ root, workspace: historicalWorkspace, cli, execute: executeNode, action: runCli => {
      runCli(['db', 'reset', '--local', '--no-seed']);
      strictLint(historicalWorkspace, runCli, true);
      runCli(['test', 'db']);
      return { migrationCount: historicalWorkspace.migrationCount,
        sqlTests: historicalWorkspace.directTests.length + historicalWorkspace.acceptanceTests.length };
    } });
  }
  const sandboxWorkspace = createSandboxWorkspace({ root, includeTests: true, discover: discoverTests });
  withDisposableSupabase({ root, workspace: sandboxWorkspace, cli, execute: executeNode, action: runCli => {
    runCli(['db', 'reset', '--local', '--no-seed']);
    runCli(['db', 'lint', '--local', '--schema', sandboxWorkspace.lintSchemas.join(','), '--fail-on', 'error']);
    if (sandboxWorkspace.testCount < 1) throw new Error('SANDBOX_PGTAP_TESTS_REQUIRED');
    runCli(['test', 'db']);
    const actual = runCli(['gen', 'types', '--local', '--schema', 'public', '--lang', 'typescript'], { capture: true });
    if (!actual.includes('export type Database =')) throw new Error('SANDBOX_DATABASE_TYPES_GENERATION_EMPTY');
    const expected = readFileSync(path.join(root, sandboxDatabaseTypesPath), 'utf8');
    if (expected !== actual && expected !== `${actual}\n`) throw new Error('SANDBOX_DATABASE_TYPES_OUT_OF_DATE: run npm run types:db:generate and review the schema diff');
    generateContracts({ root, check: true });
  } });
  return { ...productionResult, historicalMigrations: historicalResult.migrationCount,
    historicalSqlTests: historicalResult.sqlTests, sandboxMigrations: sandboxWorkspace.migrationCount,
    sandboxSqlTests: sandboxWorkspace.testCount, sandboxSchemas: sandboxWorkspace.lintSchemas };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || !['--staged', '--all'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/database-check.mjs --staged|--all');
    }
    const result = runDatabaseCheck({ mode: process.argv[2] === '--all' ? 'all' : 'staged' });
    console.log(`[database-check] validated ${result.stagedFiles.length} staged DB paths, ${result.migrations} active migrations, ${result.sqlTests} canonical SQL tests, ${result.rollbackTests} rollback canaries, ${result.dedicatedPostgresTests} dedicated PostgreSQL SQL tests, ${result.historicalSqlTests} historical SQL tests, and ${result.sandboxSqlTests} sandbox SQL tests.`);
  } catch (error) {
    console.error(`[database-check] ${error.message}`);
    process.exitCode = 1;
  }
}
