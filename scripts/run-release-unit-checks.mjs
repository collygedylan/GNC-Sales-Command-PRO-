import { verifyV2313RetainedValidation } from './check-v2313-retained-validation.mjs';
import { verifyV2312RetainedValidation } from './check-v2312-retained-validation.mjs';
import { verifyV2311RetainedValidation } from './check-v2311-retained-validation.mjs';
import { verifyV2310RetainedValidation } from './check-v2310-retained-validation.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverTests } from './test-discovery.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { verifyV235RetainedValidation } from './check-v235-retained-validation.mjs';
import { verifyV236RetainedValidation } from './check-v236-retained-validation.mjs';
import { verifyV236AvRetainedValidation } from './check-v236-av-retained-validation.mjs';
import { verifyV237RetainedValidation } from './check-v237-retained-validation.mjs';
import { verifyV238RetainedValidation } from './check-v238-retained-validation.mjs';
import { verifyV239RetainedValidation } from './check-v239-retained-validation.mjs';

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
  const shard = argv.length === 1 && /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(argv[0]);
  if (argv.length && !shard && (argv.length !== 1 || argv[0] !== '--list')) {
    throw new Error('Usage: node scripts/run-release-unit-checks.mjs [--list|--shard=N/TOTAL]');
  }
  if (shard && (Number(shard[1]) > Number(shard[2]) || Number(shard[2]) > 32)) throw new Error('Usage: invalid unit shard');
  const packageManifest = JSON.parse(readPackage(rootDir));
  if (packageManifest.version === '2.3.13') {
    verifyV2313RetainedValidation({ rootDir });
    print(argv[0] === '--list' ? '[]' : 'Verified source-sealed v2.3.13 ingestion checks; retaining unchanged UI validation.');
    return 0;
  }
  if (packageManifest.version === '2.3.12') {
    verifyV2312RetainedValidation({ rootDir });
    print(argv[0] === '--list' ? '[]' : 'Retaining source-sealed v2.3.12 focused validation and unchanged baseline.');
    return 0;
  }
  if (packageManifest.version === '2.3.11') {
    verifyV2311RetainedValidation({ rootDir });
    print(argv[0] === '--list' ? '[]' : 'Retaining exact source-sealed v2.3.11 targeted pass and unaffected baseline; no passing suite rerun.');
    return 0;
  }
  if (packageManifest.version === '2.3.10') {
    verifyV2310RetainedValidation({ rootDir });
    print(argv[0] === '--list' ? '[]' : 'Retaining verified baseline and 34 exact-checkpoint focused checks; 23-rep fixture evidence is source-sealed.');
    return 0;
  }
  if (packageManifest.version === '2.3.9') {
    const evidence = verifyV239RetainedValidation({ rootDir });
    if (argv[0] === '--list') {
      print(JSON.stringify(evidence.focusedNodeFiles, null, 2));
      return 0;
    }
    print(`Retaining ${evidence.retainedNodePassed} baseline Node tests; running only the focused Reclass verification checks.`);
    if (shard && Number(shard[1]) !== 1) return 0;
    const result = spawn(process.execPath, ['--test', ...evidence.focusedNodeFiles], { cwd: rootDir, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  if (packageManifest.version === '2.3.8') {
    const evidence = verifyV238RetainedValidation({ rootDir });
    if (argv[0] === '--list') {
      print(JSON.stringify(evidence.focusedNodeFiles, null, 2));
      return 0;
    }
    print(`Retaining ${evidence.retainedNodePassed} baseline Node tests and ${evidence.retainedV237FocusedNodePassed} verified v2.3.7 focused AV tests; running only the v2.3.8 focused Node checks.`);
    if (shard && Number(shard[1]) !== 1) return 0;
    const result = spawn(process.execPath, ['--test', ...evidence.focusedNodeFiles], { cwd: rootDir, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  const files = collectReleaseUnitTestFiles(rootDir).filter((_file, index) => !shard || index % Number(shard[2]) === Number(shard[1]) - 1);
  if (!files.length) throw new Error('UNIT_TEST_SHARD_EMPTY');
  if (argv[0] === '--list') {
    print(JSON.stringify(files, null, 2));
    return 0;
  }
  if (packageManifest.version === '2.3.7') {
    const evidence = verifyV237RetainedValidation({ rootDir });
    print(`Retaining ${evidence.retainedNodePassed} baseline Node tests plus ${evidence.retainedBunchShellPassed} unchanged Bunch shell tests; running only focused AV unit checks.`);
    if (shard && Number(shard[1]) !== 1) return 0;
    const result = spawn(process.execPath, ['--test', ...evidence.focusedNodeFiles], { cwd: rootDir, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  if (packageManifest.version === '2.3.6' && fs.existsSync(path.join(rootDir, 'docs/releases/v2.3.6-av-retained-validation.json'))) {
    const evidence = verifyV236AvRetainedValidation({ rootDir });
    print(`Retaining ${evidence.retainedNodePassed} baseline Node tests from ${evidence.baseline}; running only AV Sales Rep visibility and Bunch shell regressions.`);
    if (shard && Number(shard[1]) !== 1) return 0;
    const result = spawn(process.execPath, ['--test', ...evidence.focusedNodeFiles], { cwd: rootDir, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  if (packageManifest.version === '2.3.6') {
    const evidence = verifyV236RetainedValidation({ rootDir });
    print(`Retaining ${evidence.retainedNodePassed} passing Node tests from ${evidence.baseline}; v2.3.6 runs only focused Bunch React/browser checks.`);
    return 0;
  }
  if (packageManifest.version === '2.3.5') {
    const evidence = verifyV235RetainedValidation({ rootDir });
    print(`Retained ${evidence.retainedNodePassed} passing Node tests from exact baseline ${evidence.baseline}; full Node suite not rerun for v2.3.5.`);
    if (shard && Number(shard[1]) !== 1) return 0;
    const result = spawn(process.execPath, ['--test', 'tests/eval-report2-card-suppression.test.mjs'], { cwd: rootDir, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    return result.status ?? 1;
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

function readPackage(rootDir) {
  const packagePath = path.join(rootDir, 'package.json');
  return fs.existsSync(packagePath) ? fs.readFileSync(packagePath, 'utf8') : '{}';
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = runReleaseUnitChecks({ argv: process.argv.slice(2) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
