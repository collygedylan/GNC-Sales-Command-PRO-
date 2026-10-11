import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverTests, readTestAnnotations } from './test-discovery.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function runFile(file, { root, args = [], env = process.env, spawn = spawnSync } = {}) {
  const result = spawn(process.execPath, [path.join(root, file), ...args], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`DATABASE_TEST_FAILED: ${file} (${result.status ?? 'signal'})`);
}

export function runDiscoveredDatabaseTests({ root = repositoryRoot, group, pgliteRoot, databaseUrl, spawn = spawnSync } = {}) {
  if (!['pglite', 'postgres-concurrency', 'bloomscapes-concurrency', 'suspend-tag-concurrency'].includes(group)) throw new Error(`DATABASE_TEST_GROUP_UNSUPPORTED: ${String(group || '')}`);
  const files = discoverTests({ root, group });
  if (!files.length) throw new Error(`DATABASE_TEST_GROUP_EMPTY: ${group}`);
  if (group === 'pglite') {
    if (!pgliteRoot) throw new Error('PGLITE_ROOT_REQUIRED');
    for (const file of files) runFile(file, { root, args: ['--pglite-root', pgliteRoot], spawn });
    return files;
  }
  if (group === 'bloomscapes-concurrency' || group === 'suspend-tag-concurrency') {
    const expectedDatabase = group === 'bloomscapes-concurrency' ? 'pending_orders_test' : 'suspend_tag_test';
    if (!['localhost', '127.0.0.1'].includes(process.env.PGHOST) || process.env.PGDATABASE !== expectedDatabase) {
      throw new Error(`DATABASE_TEST_REQUIRES_LOCAL_${expectedDatabase.toUpperCase()}`);
    }
    const env = { ...process.env, CI: 'true' };
    for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete env[key];
    for (const file of files) runFile(file, { root, env, spawn });
    return files;
  }
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  for (const file of files) {
    const annotations = readTestAnnotations({ root, file });
    const dbEnv = annotations.find(annotation => annotation.type === 'db-env')?.value;
    if (!dbEnv || !/^[A-Z][A-Z0-9_]*$/.test(dbEnv)) throw new Error(`DATABASE_TEST_ENV_REQUIRED: ${file}`);
    runFile(file, { root, env: { ...process.env, CI: 'true', [dbEnv]: databaseUrl }, spawn });
  }
  return files;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [group, ...args] = process.argv.slice(2);
    const options = group === 'pglite'
      ? { group, pgliteRoot: args[0] }
      : { group, databaseUrl: args[0] };
    const argumentRequired = group === 'pglite' || group === 'postgres-concurrency';
    if ((argumentRequired && args.length !== 1) || (!argumentRequired && args.length !== 0) || args.some(arg => arg.startsWith('--'))) {
      throw new Error('Usage: run-discovered-database-tests.mjs <group> [root-or-database-url]');
    }
    runDiscoveredDatabaseTests(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
