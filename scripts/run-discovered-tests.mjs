import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverTests, readTestAnnotations } from './test-discovery.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function runDiscoveredNodeTests({ root = repositoryRoot, group, argv = [], spawn = spawnSync, print = console.log } = {}) {
  const tagIndex = argv.indexOf('--tag');
  const tag = tagIndex >= 0 ? argv[tagIndex + 1] : undefined;
  const remainder = tagIndex >= 0 ? argv.filter((_, index) => index !== tagIndex && index !== tagIndex + 1) : argv;
  if (tagIndex >= 0 && !/^[\w-]+$/.test(tag || '') || remainder.some(arg => arg !== '--list') || remainder.length > 1)
    throw new Error('Usage: node scripts/run-discovered-tests.mjs <group> [--tag name] [--list]');
  if (!['node-unit', 'node-browser', 'node-ci-integration', 'postgres-runtime', 'python', 'local-auth-smoke'].includes(group)) {
    throw new Error(`DISCOVERED_NODE_GROUP_UNSUPPORTED: ${String(group || '')}`);
  }
  const files = discoverTests({ root, group }).filter(file => !tag || readTestAnnotations({ root, file })
    .some(annotation => annotation.type === 'group' && annotation.value.split(',').includes(tag)));
  if (!files.length) throw new Error(`DISCOVERED_TEST_GROUP_EMPTY: ${group}${tag ? ':' + tag : ''}`);
  if (remainder.includes('--list')) {
    print(JSON.stringify(files, null, 2));
    return 0;
  }
  if (group === 'local-auth-smoke') {
    let endpoint;
    try { endpoint = new URL(String(process.env.SUPABASE_URL || '')); }
    catch { throw new Error('LOCAL_AUTH_SMOKE_REQUIRES_LOOPBACK_SUPABASE_CREDENTIALS'); }
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)
        || process.env.EXPECTED_PROJECT_REF !== 'local'
        || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('LOCAL_AUTH_SMOKE_REQUIRES_LOOPBACK_SUPABASE_CREDENTIALS');
    }
    for (const file of files) {
      const result = spawn(process.execPath, [file], { cwd: root, stdio: 'inherit', env: process.env });
      if (result.error) throw result.error;
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  }
  print(`Running ${files.length} discovered ${group} test files.`);
  if (group === 'python') {
    for (const file of files) {
      const result = spawn(process.env.PYTHON || 'python', [file], { cwd: root, stdio: 'inherit', env: process.env });
      if (result.error) throw result.error;
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  }
  const result = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: root, stdio: 'inherit', env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [group, ...argv] = process.argv.slice(2);
    process.exitCode = runDiscoveredNodeTests({ group, argv });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
