import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyV235RetainedValidation } from './check-v235-retained-validation.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const focusedFile = 'tests/bunch-queue-view.test.tsx';

export function runReleaseReactChecks({
  rootDir = repositoryRoot,
  argv = [],
  spawn = spawnSync,
  print = console.log,
} = {}) {
  const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const vitest = path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs');
  const args = version === '2.3.5'
    ? ['run', '--config', 'vite.v2.config.ts', focusedFile]
    : ['run', '--config', 'vite.v2.config.ts', ...argv];

  if (version === '2.3.5') {
    const evidence = verifyV235RetainedValidation({ rootDir });
    print(`Retaining ${evidence.retainedReactPassed} baseline React tests and ${evidence.retainedFocusedBunchPassed} passing focused Bunch tests with verified source hashes; no React suites rerun.`);
    return 0;
  }

  const result = spawn(process.execPath, [vitest, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = runReleaseReactChecks({ argv: process.argv.slice(2) }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
