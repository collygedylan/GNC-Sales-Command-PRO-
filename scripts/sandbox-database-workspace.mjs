import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './tooling-process.mjs';
import { renderStandaloneCatalog, sqlStatements } from './database-catalog.mjs';
import { discoverTests } from './test-discovery.mjs';

export const sandboxDatabaseTypesPath = 'v2/src/services/sandbox.database.types.ts';
const catalogMigrationName = '20260929200000_sandbox_project_schema.sql';

function isWithin(base, target) {
  const relative = path.relative(base, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveSafePath(rootReal, relative, { kind, optional = false } = {}) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..')) {
    throw new Error(`SANDBOX_${kind}_PATH_INVALID:${relative}`);
  }
  let current = rootReal;
  const parts = relative.split(/[\\/]/).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = lstatSync(current); }
    catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`SANDBOX_${kind}_SYMLINK_REJECTED:${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`SANDBOX_${kind}_PATH_INVALID:${relative}`);
  }
  const resolved = realpathSync(current);
  if (!isWithin(rootReal, resolved)) throw new Error(`SANDBOX_${kind}_PATH_ESCAPE:${relative}`);
  return resolved;
}

export function validateSandboxMigrationEnvelope(source, name = '<sandbox-migration>') {
  let statements;
  try { statements = sqlStatements(source).map(statement => statement.trim()).filter(Boolean); }
  catch (error) { throw new Error(`SANDBOX_MIGRATION_SQL_INVALID:${name}`, { cause: error }); }
  const executable = statements.map(statement => statement
    .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/g, '').trim()).filter(Boolean);
  const transactionControls = executable.map(statement => statement.match(/^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE\b|PREPARE\s+TRANSACTION|SET\s+TRANSACTION)\b/i)?.[1]?.toUpperCase());
  const controls = transactionControls.filter(Boolean);
  if (!/^BEGIN\s*;$/i.test(executable[0] || '') || !/^COMMIT\s*;$/i.test(executable.at(-1) || '')
      || controls.length !== 2 || controls[0] !== 'BEGIN' || controls[1] !== 'COMMIT') {
    throw new Error(`SANDBOX_MIGRATION_TRANSACTION_REQUIRED:${name}`);
  }
}

export function assertUniqueSandboxTestBasenames(files) {
  const seen = new Set();
  for (const file of files) {
    const basename = path.basename(file);
    const key = basename.toLowerCase();
    if (seen.has(key)) throw new Error(`SANDBOX_TEST_BASENAME_COLLISION:${basename}`);
    seen.add(key);
  }
}

/** Create an isolated sandbox schema workspace from the immutable capture and sandbox-only changes. */
export function createSandboxDatabaseWorkspace({ root = repoRoot, includeTests = false, discover = discoverTests } = {}) {
  const rootReal = realpathSync(path.resolve(root));
  const catalogPath = resolveSafePath(rootReal, 'supabase/schema/sandbox-project.catalog.json', { kind: 'CATALOG', optional: true });
  if (!catalogPath) throw new Error('SANDBOX_DATABASE_CATALOG_MISSING');
  const rawCatalog = readFileSync(catalogPath, 'utf8');
  const catalog = JSON.parse(rawCatalog.charCodeAt(0) === 0xfeff ? rawCatalog.slice(1) : rawCatalog);
  const migration = renderStandaloneCatalog(catalog);
  const sandboxMigrationSource = resolveSafePath(rootReal, 'supabase/sandbox/migrations', { kind: 'MIGRATION', optional: true });
  const sandboxMigrationNames = sandboxMigrationSource
    ? readdirSync(sandboxMigrationSource).filter(name => name.endsWith('.sql')).sort()
    : [];
  let lastVersion = catalogMigrationName.slice(0, 14);
  for (const name of sandboxMigrationNames) {
    const version = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/i)?.[1];
    if (!version || version <= lastVersion) throw new Error(`SANDBOX_MIGRATION_ORDER_INVALID:${name}`);
    const sourcePath = resolveSafePath(rootReal, `supabase/sandbox/migrations/${name}`, { kind: 'MIGRATION' });
    if (!lstatSync(sourcePath).isFile()) throw new Error(`SANDBOX_MIGRATION_SOURCE_INVALID:${name}`);
    validateSandboxMigrationEnvelope(readFileSync(sourcePath, 'utf8'), name);
    lastVersion = version;
  }
  const testFiles = includeTests ? discover({ root, group: 'sandbox-pgtap' }) : [];
  if (includeTests && testFiles.length === 0) throw new Error('SANDBOX_PGTAP_TESTS_REQUIRED');
  assertUniqueSandboxTestBasenames(testFiles);
  const safeTestFiles = testFiles.map(file => {
    if (!file.startsWith('supabase/sandbox/tests/') || !/^[\w.-]+_test\.sql$/i.test(path.basename(file))) {
      throw new Error(`SANDBOX_TEST_PATH_INVALID:${file}`);
    }
    const basename = path.basename(file);
    const source = resolveSafePath(rootReal, file, { kind: 'TEST' });
    if (!lstatSync(source).isFile()) throw new Error(`SANDBOX_TEST_SOURCE_INVALID:${file}`);
    return { file, basename, source };
  });
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'gnc-sandbox-db-workspace-'));
  try {
    const supabaseDir = path.join(workspace, 'supabase');
    const migrationsDir = path.join(supabaseDir, 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    const configPath = resolveSafePath(rootReal, 'supabase/config.toml', { kind: 'CONFIG' });
    const config = readFileSync(configPath, 'utf8');
    if (!/^project_id\s*=\s*"[^"]+"\s*$/m.test(config)) throw new Error('DATABASE_PROJECT_ID_CONFIG_INVALID');
    const projectId = `gncsandbox${process.pid}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
    writeFileSync(path.join(supabaseDir, 'config.toml'), config.replace(/^project_id\s*=\s*"[^"]+"\s*$/m, `project_id = "${projectId}"`));
    writeFileSync(path.join(migrationsDir, catalogMigrationName), migration);
    for (const name of sandboxMigrationNames) {
      const source = resolveSafePath(rootReal, `supabase/sandbox/migrations/${name}`, { kind: 'MIGRATION' });
      writeFileSync(path.join(migrationsDir, name), readFileSync(source));
    }
    if (includeTests) {
      const testsDir = path.join(supabaseDir, 'tests');
      mkdirSync(testsDir, { recursive: true });
      for (const { basename, source } of safeTestFiles) {
        writeFileSync(path.join(testsDir, basename), readFileSync(source));
      }
    }
    writeFileSync(path.join(supabaseDir, 'seed.sql'), '');
    return {
      root: workspace,
      projectId,
      migrationCount: sandboxMigrationNames.length + 1,
      testFiles,
      testCount: testFiles.length,
      lintSchemas: [...new Set((catalog.schemas || []).map(schema => schema.name))].sort(),
      dispose() {
        const resolved = path.resolve(workspace);
        const parent = path.resolve(os.tmpdir());
        if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('gnc-sandbox-db-workspace-')) {
          throw new Error('DATABASE_WORKSPACE_CLEANUP_PATH_INVALID');
        }
        rmSync(resolved, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const resolved = path.resolve(workspace);
    const parent = path.resolve(os.tmpdir());
    if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('gnc-sandbox-db-workspace-')) {
      rmSync(resolved, { recursive: true, force: true });
    }
    throw error;
  }
}
