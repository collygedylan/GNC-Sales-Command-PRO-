import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareIsolatedSqlTests } from './prepare-isolated-sql-tests.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const historicalMigrationManifestPath = 'scripts/historical-database-migrations.json';
export const handoverIsolationMigration = '20261001215508_scheduled_handover_005.sql';

function resolveInside(root, relativePath, errorCode) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error(errorCode);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(errorCode);
  return absolute;
}

export function readHistoricalMigrationManifest({ root = repositoryRoot, manifestPath = historicalMigrationManifestPath } = {}) {
  const file = resolveInside(root, manifestPath, 'HISTORICAL_MIGRATION_MANIFEST_PATH_INVALID');
  let entries;
  try { entries = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`HISTORICAL_MIGRATION_MANIFEST_INVALID:${error.message}`, { cause: error }); }
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('HISTORICAL_MIGRATION_MANIFEST_EMPTY');
  const destinations = new Set();
  let previousDestination = '';
  for (const entry of entries) {
    if (!entry || typeof entry.source !== 'string' || typeof entry.destination !== 'string'
      || !/^supabase\/(?:ci|archive_migrations|migrations)\/[A-Za-z0-9_.-]+\.sql$/.test(entry.source)
      || !/^\d{14}_[A-Za-z0-9_.-]+\.sql$/.test(entry.destination)) {
      throw new Error('HISTORICAL_MIGRATION_MANIFEST_ENTRY_INVALID');
    }
    if (destinations.has(entry.destination)) throw new Error(`HISTORICAL_MIGRATION_DESTINATION_DUPLICATE:${entry.destination}`);
    if (previousDestination && entry.destination.localeCompare(previousDestination) < 0) {
      throw new Error('HISTORICAL_MIGRATION_MANIFEST_NOT_SORTED');
    }
    const source = resolveInside(root, entry.source, 'HISTORICAL_MIGRATION_SOURCE_PATH_INVALID');
    if (!existsSync(source)) throw new Error(`HISTORICAL_MIGRATION_SOURCE_MISSING:${entry.source}`);
    destinations.add(entry.destination);
    previousDestination = entry.destination;
  }
  if (!entries.some(entry => entry.destination === handoverIsolationMigration)) {
    throw new Error('HISTORICAL_HANDOVER_MIGRATION_REQUIRED');
  }
  return entries;
}

function copyDirectory(source, destination) {
  if (!existsSync(source)) throw new Error(`HISTORICAL_FIXTURE_SOURCE_MISSING:${source}`);
  cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
}

function patchScheduledHandover({ root, migrationsDir }) {
  const migrationPath = path.join(migrationsDir, handoverIsolationMigration);
  const source = readFileSync(migrationPath, 'utf8').trimEnd();
  if (!source.endsWith('commit;')) throw new Error('HANDOVER_MIGRATION_MUST_RETAIN_TRANSACTION_WRAPPER');
  const isolation = readFileSync(resolveInside(root, 'supabase/ci/scheduled_handover_isolation.sql', 'HANDOVER_ISOLATION_PATH_INVALID'), 'utf8');
  writeFileSync(migrationPath, `${source.slice(0, -'commit;'.length)}${isolation}\ncommit;\n`);
}

function isDirectoryEmpty(directory) {
  return readdirSync(directory).length === 0;
}

/** Assemble the historical regression project using the checked-in migration order contract. */
export function prepareHistoricalDatabaseFixture({ root = repositoryRoot, destination, testFiles,
  manifestPath = historicalMigrationManifestPath, discoverTests } = {}) {
  const absoluteRoot = path.resolve(root);
  const ownedDestination = !destination;
  const absoluteDestination = ownedDestination
    ? mkdtempSync(path.join(os.tmpdir(), 'gnc-historical-db-workspace-'))
    : path.resolve(destination);
  if (absoluteDestination === absoluteRoot || absoluteDestination.startsWith(`${absoluteRoot}${path.sep}`)
      || absoluteRoot.startsWith(`${absoluteDestination}${path.sep}`)) {
    if (ownedDestination) rmSync(absoluteDestination, { recursive: true, force: true });
    throw new Error('HISTORICAL_FIXTURE_DESTINATION_UNSAFE');
  }
  if (!ownedDestination) mkdirSync(absoluteDestination, { recursive: true });
  try {
    if (!isDirectoryEmpty(absoluteDestination)) throw new Error('HISTORICAL_FIXTURE_DESTINATION_NOT_EMPTY');
    const manifest = readHistoricalMigrationManifest({ root: absoluteRoot, manifestPath });
    const supabaseDir = path.join(absoluteDestination, 'supabase');
    const migrationsDir = path.join(supabaseDir, 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    const configPath = resolveInside(absoluteRoot, 'supabase/config.toml', 'HISTORICAL_CONFIG_PATH_INVALID');
    let config = readFileSync(configPath, 'utf8');
    if (!/^project_id\s*=\s*"[^"]+"\s*$/m.test(config)) throw new Error('HISTORICAL_PROJECT_ID_CONFIG_INVALID');
    const projectId = `gnchist${process.pid}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
    config = config.replace(/^project_id\s*=\s*"[^"]+"\s*$/m, `project_id = "${projectId}"`);
    writeFileSync(path.join(supabaseDir, 'config.toml'), config);
    copyDirectory(resolveInside(absoluteRoot, 'supabase/functions', 'HISTORICAL_FUNCTIONS_PATH_INVALID'), path.join(supabaseDir, 'functions'));
    // Configured Edge Functions resolve shared runtime and generated contract
    // modules outside supabase/functions. Preserve the authored module tree so
    // local Edge Runtime and functions serve can load the same imports.
    copyDirectory(resolveInside(absoluteRoot, 'services', 'HISTORICAL_SERVICES_PATH_INVALID'), path.join(absoluteDestination, 'services'));
    mkdirSync(path.join(absoluteDestination, 'utils'), { recursive: true });
    copyDirectory(resolveInside(absoluteRoot, 'utils/auraLingo.js', 'HISTORICAL_LINGO_PATH_INVALID'), path.join(absoluteDestination, 'utils/auraLingo.js'));
    writeFileSync(path.join(supabaseDir, 'seed.sql'), '');

    for (const entry of manifest) {
      const source = resolveInside(absoluteRoot, entry.source, 'HISTORICAL_MIGRATION_SOURCE_PATH_INVALID');
      // Match GitHub's LF checkout: historical patches compare function bodies
      // against exact newline-delimited clauses returned by PostgreSQL.
      writeFileSync(path.join(migrationsDir, entry.destination), readFileSync(source, 'utf8').replaceAll('\r\n', '\n'), { flag: 'wx' });
    }
    patchScheduledHandover({ root: absoluteRoot, migrationsDir });

    const tests = prepareIsolatedSqlTests({ root: absoluteRoot, destination: path.join(supabaseDir, 'tests'), testFiles, discover: discoverTests });
    return {
      root: absoluteDestination,
      projectId,
      verifyContainer: true,
      migrationCount: manifest.length,
      directTests: tests.direct,
      acceptanceTests: tests.acceptance,
      dispose() {
        if (!ownedDestination) return;
        const resolved = path.resolve(absoluteDestination);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('gnc-historical-db-workspace-')) {
          throw new Error('HISTORICAL_FIXTURE_CLEANUP_PATH_INVALID');
        }
        rmSync(resolved, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (ownedDestination && path.dirname(absoluteDestination) === path.resolve(os.tmpdir())
      && path.basename(absoluteDestination).startsWith('gnc-historical-db-workspace-')) {
      rmSync(absoluteDestination, { recursive: true, force: true });
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const destination = process.argv[2];
    if (!destination || process.argv.length !== 3) throw new Error('Usage: node scripts/historical-database-fixture.mjs <empty-disposable-destination>');
    const fixture = prepareHistoricalDatabaseFixture({ destination });
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SUPABASE_CI_ROOT=${fixture.root}\n`);
    console.log(`Prepared ${fixture.migrationCount} ordered historical migrations, ${fixture.directTests.length} direct and ${fixture.acceptanceTests.length} acceptance SQL tests at ${fixture.root}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
