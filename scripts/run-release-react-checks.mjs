import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyV235RetainedValidation } from './check-v235-retained-validation.mjs';
import { verifyV236RetainedValidation } from './check-v236-retained-validation.mjs';
import { verifyV236AvRetainedValidation } from './check-v236-av-retained-validation.mjs';
import { verifyV237RetainedValidation } from './check-v237-retained-validation.mjs';
import { verifyV238RetainedValidation } from './check-v238-retained-validation.mjs';
import { verifyV239RetainedValidation } from './check-v239-retained-validation.mjs';

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
  if (version === '2.3.9') {
    const evidence = verifyV239RetainedValidation({ rootDir });
    print(`Retaining ${evidence.retainedReactPassed} baseline React tests; no React source or component contract is changed.`);
    return 0;
  }
  if (version === '2.3.8') {
    const evidence = verifyV238RetainedValidation({ rootDir });
    if (!evidence.canRetainBunchReact) throw new Error('V238_REACT_RETENTION_SOURCE_MISMATCH');
    print(`Retaining ${evidence.retainedReactPassed} baseline React tests and ${evidence.retainedBunchReactPassed} unchanged Bunch React tests; component, service, stylesheet, and view-test hashes match base.`);
    return 0;
  }
  if (version === '2.3.7') {
    const evidence = verifyV237RetainedValidation({ rootDir });
    if (!evidence.canRetainFocusedBunchReact) throw new Error('V237_BUNCH_REACT_RETENTION_SOURCE_MISMATCH');
    print(`Retaining ${evidence.retainedReactPassed} baseline React tests plus ${evidence.retainedBunchReactPassed} focused Bunch tests; Bunch component/service hashes match the validated baseline, so no React tests rerun.`);
    return 0;
  }
  const args = ['2.3.5', '2.3.6'].includes(version)
    ? ['run', '--config', 'vite.v2.config.ts', focusedFile]
    : ['run', '--config', 'vite.v2.config.ts', ...argv];

  if (version === '2.3.5') {
    const evidence = verifyV235RetainedValidation({ rootDir });
    print(`Retaining ${evidence.retainedReactPassed} baseline React tests and ${evidence.retainedFocusedBunchPassed} passing focused Bunch tests with verified source hashes; no React suites rerun.`);
    return 0;
  }
  if (version === '2.3.6') {
    const evidence = fs.existsSync(path.join(rootDir, 'docs/releases/v2.3.6-av-retained-validation.json'))
      ? verifyV236AvRetainedValidation({ rootDir }) : verifyV236RetainedValidation({ rootDir });
    print(`Retaining ${evidence.retainedReactPassed} baseline React tests; running only ${focusedFile}.`);
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
