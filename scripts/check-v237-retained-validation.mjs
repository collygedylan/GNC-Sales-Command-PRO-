import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = 'd794001fa44d728af6dffa47a3cc143b055aa143';
const RECEIPT = 'docs/releases/v2.3.7-retained-validation.json';
const SOURCE_FILES = [
  'assets/av-derived-rows.js', 'tests/av-derived-rows.test.mjs',
  'assets/ops-precision-pilot.js', 'index.html', 'manifest.json', 'package-lock.json', 'package.json',
  'scripts/build-live-shell.mjs', 'sw.js', 'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
  'playwright.av-live-hydration.config.ts', 'tests/av-live-current-season.test.mjs',
  'tests/av-live-hydration.e2e.spec.ts', 'tests/av-native-cache-hydration.test.mjs',
  'tests/av-sales-stock-visibility.test.mjs', 'scripts/check-v237-retained-validation.mjs',
  'scripts/run-release-unit-checks.mjs', 'scripts/run-release-react-checks.mjs',
];
const ALLOWED = new Set([...SOURCE_FILES, RECEIPT]);
const REQUIRED_CHANGED_FILES = SOURCE_FILES.filter(file => file !== 'tests/av-sales-stock-visibility.test.mjs');
const RETAINED_BUNCH_SOURCE_FILES = [
  'assets/bunch-queue-shell.js', 'components/bunch-queue/QueueView.tsx',
  'components/bunch-queue/WorkCard.tsx', 'components/bunch-queue/bunch-queue.css',
  'services/bunchQueue.ts', 'tests/bunch-queue-shell.test.mjs', 'tests/bunch-queue-view.test.tsx',
];
const git = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
}).trim();
const gitRaw = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const digest = source => createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function computeV237SourceHashes({ rootDir = repositoryRoot } = {}) {
  return Object.fromEntries(SOURCE_FILES.map(file => [file, digest(fs.readFileSync(path.join(rootDir, file), 'utf8'))]));
}

export function computeV237RetainedBunchSourceHashes({ rootDir = repositoryRoot } = {}) {
  return Object.fromEntries(RETAINED_BUNCH_SOURCE_FILES.map(file => [
    file, digest(gitRaw(rootDir, ['show', `${BASE}:${file}`])),
  ]));
}

export function verifyV237RetainedValidation({ rootDir = repositoryRoot } = {}) {
  const receipt = JSON.parse(fs.readFileSync(path.join(rootDir, RECEIPT), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (pkg.version !== '2.3.7' || pkg.appsScriptRelease !== 'AgData v2.2.1'
    || receipt.base !== BASE || receipt.release !== 'AgData v2.3.7'
    || receipt.baselineCiRun !== 39226551039 || receipt.baselinePagesRun !== 39226748483
    || receipt.retainedNode !== 3550 || receipt.retainedReact !== 158
    || receipt.retainedBunchShellPassed !== 2 || receipt.retainedBunchReactPassed !== 16) {
    throw new Error('V237_RETAINED_IDENTITY_INVALID');
  }
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);

  const changed = new Set();
  for (const args of [
    ['diff', '--name-only', `${BASE}...HEAD`],
    ['diff', '--name-only', 'HEAD'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    git(rootDir, args).split('\n').filter(Boolean).forEach(file => changed.add(file.replaceAll('\\', '/')));
  }
  for (const file of changed) if (!ALLOWED.has(file)) throw new Error(`V237_UNEXPECTED_SCOPE:${file}`);

  const hashes = receipt.validatedSourceHashes;
  if (!hashes || typeof hashes !== 'object') throw new Error('V237_SOURCE_HASHES_MISSING');
  for (const file of SOURCE_FILES) {
    if (!hashes[file] || digest(fs.readFileSync(path.join(rootDir, file), 'utf8')) !== hashes[file]) {
      throw new Error(`V237_UNVALIDATED_SOURCE:${file}`);
    }
  }
  for (const file of REQUIRED_CHANGED_FILES) if (!changed.has(file)) {
    throw new Error(`V237_REQUIRED_SOURCE_NOT_CHANGED:${file}`);
  }
  for (const file of Object.keys(hashes)) if (!SOURCE_FILES.includes(file)) {
    throw new Error(`V237_UNEXPECTED_SOURCE_HASH:${file}`);
  }

  const retainedSourceHashes = receipt.retainedBunchSourceHashes;
  if (!retainedSourceHashes || typeof retainedSourceHashes !== 'object') throw new Error('V237_RETAINED_BUNCH_HASHES_MISSING');
  for (const file of RETAINED_BUNCH_SOURCE_FILES) {
    const baseSource = gitRaw(rootDir, ['show', `${BASE}:${file}`]);
    const expected = digest(baseSource);
    if (retainedSourceHashes[file] !== expected
      || digest(fs.readFileSync(path.join(rootDir, file), 'utf8')) !== expected) {
      throw new Error(`V237_RETAINED_BUNCH_SOURCE_CHANGED:${file}`);
    }
  }
  return {
    baseline: BASE,
    retainedNodePassed: 3550,
    retainedReactPassed: 158,
    retainedBunchShellPassed: 2,
    retainedBunchReactPassed: 16,
    canRetainFocusedBunchReact: true,
    focusedNodeFiles: [
      'tests/av-derived-rows.test.mjs',
      'tests/av-live-current-season.test.mjs',
      'tests/av-native-cache-hydration.test.mjs',
      'tests/av-sales-stock-visibility.test.mjs',
    ],
    fullSuitesRerun: false,
    changedPaths: [...changed].sort(),
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--capture-source-hashes') {
      console.log(JSON.stringify(computeV237SourceHashes(), null, 2));
    } else if (process.argv[2] === '--capture-retained-bunch-hashes') {
      console.log(JSON.stringify(computeV237RetainedBunchSourceHashes(), null, 2));
    } else {
      console.log(JSON.stringify(verifyV237RetainedValidation(), null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
