import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverTests } from './test-discovery.mjs';
import { inspectDisposableSupabaseWorkspace } from './disposable-supabase-container.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';

const FIXTURES = Object.freeze({
  'bloomscapes-pgtap': Object.freeze({
    databaseName: 'pending_orders_test',
    baseline: 'supabase/ci/bloomscapes_pending_baseline.sql',
    migration: 'supabase/archive_migrations/20260908014335_bloomscapes_pending_orders.sql',
  }),
  'suspend-tag-pgtap': Object.freeze({
    databaseName: 'suspend_tag_test',
    baseline: 'supabase/ci/suspend_tag_baseline.sql',
    migration: 'supabase/archive_migrations/20260908165943_suspend_tag_completion.sql',
  }),
});
export const postgresFixtureSqlGroups = Object.freeze(Object.keys(FIXTURES));

export function selectAffectedPostgresFixtureSqlGroups({ root = repoRoot, files = [], discover = discoverTests } = {}) {
  if (!Array.isArray(files)) throw new Error('POSTGRES_FIXTURE_CHANGED_FILES_REQUIRED');
  const broad = files.some(file => file.startsWith('supabase/migrations/') || file.startsWith('supabase/archive_migrations/')
    || file === 'scripts/run-postgres-fixture-sql-tests.mjs'
    || file === 'scripts/database-check.mjs' || file === 'scripts/test-discovery.mjs'
    || file === 'scripts/run-discovered-database-tests.mjs'
    || file === 'scripts/historical-database-fixture.mjs' || file === 'scripts/historical-database-migrations.json'
    || file === 'scripts/database-workspace-runner.mjs' || file === '.github/workflows/release-database.yml'
    || file === '.github/workflows/bloomscapes-pending-tests.yml' || file === '.github/workflows/suspend-tag-tests.yml');
  return postgresFixtureSqlGroups.filter(group => {
    const fixture = FIXTURES[group];
    return broad || files.includes(fixture.baseline) || files.includes(fixture.migration)
      || discover({ root, group }).some(file => files.includes(file));
  }).sort();
}

function executeChecked(execute, command, args, options) {
  const result = execute(command, args, options);
  if (result?.status !== undefined && result.status !== 0) throw new Error(`POSTGRES_FIXTURE_COMMAND_FAILED:${path.basename(command)}:${result.status}`);
  return typeof result === 'string' ? result : result?.stdout || '';
}

/** Run discovered special SQL fixtures inside a temporary database owned by a verified disposable CLI stack. */
export function runPostgresFixtureSqlTests({ root = repoRoot, workspaceRoot, groups, cli = packageBin('supabase', 'supabase', root),
  execute = run, executeNode = runNode, discover = discoverTests, status } = {}) {
  if (!Array.isArray(groups) || groups.length === 0 || groups.some(group => !Object.hasOwn(FIXTURES, group))) {
    throw new Error('POSTGRES_FIXTURE_GROUP_REQUIRED');
  }
  let workspace;
  try {
    workspace = inspectDisposableSupabaseWorkspace({ root, workspaceRoot, status, execute, executeNode, cli });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DISPOSABLE_SUPABASE_')) {
      throw new Error(error.message.replace('DISPOSABLE_SUPABASE_', 'POSTGRES_FIXTURE_'), { cause: error });
    }
    throw error;
  }
  const results = [];
  for (const group of [...new Set(groups)].sort()) {
    const fixture = FIXTURES[group];
    const files = discover({ root, group });
    if (!files.length) throw new Error(`POSTGRES_FIXTURE_TESTS_REQUIRED:${group}`);
    for (const file of [fixture.baseline, fixture.migration, ...files]) {
      const absoluteFile = path.resolve(root, file);
      if (!absoluteFile.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('POSTGRES_FIXTURE_SOURCE_PATH_INVALID');
    }
    const database = `gnc_${fixture.databaseName}_${process.pid}_${randomBytes(4).toString('hex')}`;
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(database)) throw new Error('POSTGRES_FIXTURE_DATABASE_NAME_INVALID');
    let created = false;
    let failure;
    try {
      executeChecked(execute, 'docker', ['exec', workspace.containerId, 'psql', '-X', '-U', 'postgres', '-d', 'template1', '-v', 'ON_ERROR_STOP=1',
        '-c', `CREATE DATABASE ${database} TEMPLATE template0`], { root });
      created = true;
      // These suites assert through SQL exceptions and include psql directives;
      // they do not emit TAP and must use the native PostgreSQL runner.
      for (const file of [fixture.baseline, fixture.migration, ...files]) {
        executeChecked(execute, 'docker', ['exec', '-i', workspace.containerId, 'psql', '-X', '-U', 'postgres', '-d', database,
          '-v', 'ON_ERROR_STOP=1'], { root, capture: true, input: readFileSync(path.resolve(root, file), 'utf8') });
      }
      results.push({ group, files, database });
    } catch (error) {
      failure = error;
    }
    if (created) {
      try {
        executeChecked(execute, 'docker', ['exec', workspace.containerId, 'psql', '-X', '-U', 'postgres', '-d', 'template1', '-v', 'ON_ERROR_STOP=1',
          '-c', `DROP DATABASE ${database} WITH (FORCE)`], { root });
      } catch (error) {
        const message = failure instanceof Error ? failure.message : failure ? String(failure) : '';
        throw new Error(`${message}${message ? '; ' : ''}POSTGRES_FIXTURE_DATABASE_CLEANUP_FAILED:${error.message}`, { cause: error });
      }
    }
    if (failure) throw failure;
  }
  return { projectId: workspace.projectId, results };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [flag, workspaceRoot, ...groups] = process.argv.slice(2);
    if (flag !== '--workdir' || !workspaceRoot || !groups.length) throw new Error('Usage: node scripts/run-postgres-fixture-sql-tests.mjs --workdir <disposable-supabase-workspace> <discovery-group...>');
    const result = runPostgresFixtureSqlTests({ workspaceRoot, groups });
    console.log(`Ran ${result.results.reduce((total, item) => total + item.files.length, 0)} discovered fixture SQL tests in disposable project ${result.projectId}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
