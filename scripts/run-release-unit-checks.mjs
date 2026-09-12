import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const releaseUnitScriptNames = Object.freeze(['test:photo', 'test:pilot', 'test:live-sync']);
export const explicitReleaseUnitTests = Object.freeze([
  'tests/hl-order.test.mjs',
  'tests/hl-order-ship-date.test.mjs',
  'tests/hl-po-import-staging.test.mjs',
  'tests/hl-po-receipt-ui.test.mjs',
  'tests/hl-order-rollback.test.mjs',
  'tests/hl-order-delivery.test.mjs',
  'tests/hl-order-delivery-worker.test.mjs',
  'tests/hl-tags-email.test.mjs',
  'tests/eval-review-assignedto-api.test.mjs',
  'tests/production-probe-read-only.test.mjs',
  'tests/prepare-ci-playwright-apt.test.mjs',
]);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function testFilesFromPackageScript(name, command) {
  const tokens = String(command || '').trim().split(/\s+/);
  if (tokens.shift() !== 'node' || tokens.shift() !== '--test') {
    throw new Error(`Release unit script ${name} must start with node --test.`);
  }
  const files = tokens.filter(token => !/^--test-concurrency=\d+$/.test(token));
  if (!files.length || files.some(file => !/^tests\/(?:[\w.-]+\/)*[\w.-]+\.test\.(?:mjs|cjs|js)$/.test(file)
    || file.split('/').includes('..'))) {
    throw new Error(`Release unit script ${name} must enumerate test files; unsupported flags, shell commands, and globs require an explicit runner update.`);
  }
  return files;
}

export function collectReleaseUnitTestFiles(rootDir = repositoryRoot) {
  const manifest = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const files = new Set(explicitReleaseUnitTests);
  for (const name of releaseUnitScriptNames) {
    for (const file of testFilesFromPackageScript(name, manifest.scripts?.[name])) files.add(file);
  }
  for (const entry of readdirSync(path.join(rootDir, 'tests'), { withFileTypes: true })) {
    if (entry.isFile() && /^release-.+\.test\.mjs$/.test(entry.name)) files.add(`tests/${entry.name}`);
  }
  const sorted = [...files].sort();
  for (const file of sorted) {
    if (!statSync(path.join(rootDir, file)).isFile()) throw new Error(`Release unit test is not a file: ${file}`);
  }
  return sorted;
}

export function runReleaseUnitChecks({
  rootDir = repositoryRoot,
  argv = [],
  spawn = spawnSync,
  print = console.log,
} = {}) {
  if (argv.length && (argv.length !== 1 || argv[0] !== '--list')) {
    throw new Error('Usage: node scripts/run-release-unit-checks.mjs [--list]');
  }
  const files = collectReleaseUnitTestFiles(rootDir);
  if (argv[0] === '--list') {
    print(JSON.stringify(files, null, 2));
    return 0;
  }
  print(`Running ${files.length} unique release unit-test files in one serial Node test process.`);
  const result = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runReleaseUnitChecks({ argv: process.argv.slice(2) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
