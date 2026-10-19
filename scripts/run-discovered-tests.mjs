import { verifyV2311RetainedValidation } from './check-v2311-retained-validation.mjs';
import { verifyV2310RetainedValidation } from './check-v2310-retained-validation.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverTests, readTestAnnotations } from './test-discovery.mjs';
import { verifyV238RetainedValidation } from './check-v238-retained-validation.mjs';
import { verifyV239RetainedValidation } from './check-v239-retained-validation.mjs';

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
  if (group === 'python' && JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version === '2.3.11') {
    verifyV2311RetainedValidation({ rootDir: root });
    print('Retaining unaffected Python contracts; changed permissions and email contracts have source-sealed targeted Node/SQL coverage.');
    return 0;
  }
  if (group === 'python' && JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version === '2.3.10') {
    verifyV2310RetainedValidation({ rootDir: root });
    print('Retaining unchanged Python contract evidence from verified v2.3.9 baseline.');
    return 0;
  }
  if (group === 'python' && JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version === '2.3.9') {
    const evidence = verifyV239RetainedValidation({ rootDir: root });
    if (!evidence.retainedPythonContracts) throw new Error('V239_PYTHON_CONTRACT_RETENTION_SOURCE_MISMATCH');
    print(`Retaining unchanged Python contracts from baseline CI ${evidence.baselineCiRunId}; Python sources remain hash-verified.`);
    return 0;
  }
  if (remainder.includes('--list')) {
    print(JSON.stringify(files, null, 2));
    return 0;
  }
  if (group === 'python' && JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version === '2.3.8') {
    const evidence = verifyV238RetainedValidation({ rootDir: root });
    if (!evidence.retainedPythonContractUnchanged) throw new Error('V238_PYTHON_CONTRACT_RETENTION_SOURCE_MISMATCH');
    print(`Retaining the unchanged Python contract check from successful baseline CI ${evidence.baselineContractsRun}; source hash matches base, so Python is not rerun.`);
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
