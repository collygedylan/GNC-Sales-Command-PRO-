import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverTests } from './test-discovery.mjs';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function collectReleaseUnitTestFiles(rootDir = repositoryRoot) {
  return discoverTests({ root: rootDir, group: 'node-unit' });
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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = runReleaseUnitChecks({ argv: process.argv.slice(2) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
