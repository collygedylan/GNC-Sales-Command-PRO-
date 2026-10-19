import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = '8364b1d488588052c4d8c48b9bfb525512bb8ad6';
const RECEIPT = 'docs/releases/v2.3.9-retained-validation.json';
const FOCUSED_NODE_FILES = Object.freeze([
  'tests/reclass-snapshot-verification.test.mjs',
  'tests/reclass-moves-frontend.test.mjs',
  'tests/reclass-preview-confirmed-revision.test.mjs',
  'tests/reclass-suspend-read-recovery.test.mjs',
  'tests/suspend-tag-reclass-delivery.test.mjs',
  'tests/suspend-tag-reclass.test.mjs',
]);
const FOCUSED_BROWSER_FILES = Object.freeze(['tests/reclass-splits.e2e.spec.ts']);
const RETAINED_SOURCE_FILES = Object.freeze([
  'tests/reclass-live-edits.test.mjs',
  'tests/reclass-fixture-transport.test.mjs',
  'tests/test_sync_weather_hold_learning.py',
  'supabase/migrations/20261015230000_inventory_reclass_moves_v1.sql',
]);
const SOURCE_FILES = Object.freeze([
  '.github/workflows/pr-validation.yml',
  'assets/ops-precision-pilot.js',
  '.github/workflows/release-database.yml',
  'index.html',
  'manifest.json',
  'package-lock.json',
  'package.json',
  'scripts/build-live-shell.mjs',
  'scripts/check-v239-retained-validation.mjs',
  'scripts/ci-backend-matrix.mjs',
  'scripts/run-discovered-tests.mjs',
  'scripts/run-release-react-checks.mjs',
  'scripts/run-release-unit-checks.mjs',
  'sw.js',
  'tests/reclass-moves-frontend.test.mjs',
  'tests/reclass-preview-confirmed-revision.test.mjs',
  'tests/reclass-snapshot-verification.test.mjs',
  'tests/reclass-suspend-read-recovery.test.mjs',
  'tests/reclass-splits.e2e.spec.ts',
  'tests/suspend-tag-reclass-delivery.test.mjs',
  'tests/suspend-tag-reclass.test.mjs',
  'v2/public/manifest.webmanifest',
  'v2/src/services/api.ts',
]);
const ALLOWED_PATHS = new Set([...SOURCE_FILES, ...FOCUSED_BROWSER_FILES, ...RETAINED_SOURCE_FILES, RECEIPT]);
const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const gitRaw = (rootDir, args) => execFileSync('git', args, {
  cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const git = (rootDir, args) => gitRaw(rootDir, args).trim();
const digest = value => createHash('sha256').update(String(value).replaceAll('\r\n', '\n')).digest('hex');

function collectChangedPaths(rootDir) {
  const changed = new Set();
  for (const args of [
    ['diff', '--name-only', `${BASE}...HEAD`],
    ['diff', '--name-only', 'HEAD'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    git(rootDir, args).split('\n').filter(Boolean).forEach(file => changed.add(file.replaceAll('\\', '/')));
  }
  return [...changed].sort();
}

export function computeV239SourceHashes({ rootDir = rootDefault } = {}) {
  return Object.fromEntries(SOURCE_FILES.map(file => [file, digest(fs.readFileSync(path.join(rootDir, file), 'utf8'))]));
}

export function computeV239RetainedSourceHashes({ rootDir = rootDefault } = {}) {
  return Object.fromEntries(RETAINED_SOURCE_FILES.map(file => [
    file,
    digest(gitRaw(rootDir, ['show', `${BASE}:${file}`])),
  ]));
}

export function verifyV239RetainedValidation({ rootDir = rootDefault } = {}) {
  const receipt = JSON.parse(fs.readFileSync(path.join(rootDir, RECEIPT), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (manifest.version !== '2.3.9' || receipt.schemaVersion !== 'agdata-v239-retained-validation-v1'
    || receipt.release !== 'AgData v2.3.9' || receipt.base !== BASE
    || receipt.baseline?.ciRunId !== 39256491099
    || receipt.baseline?.ciHead !== '1c226bca93c49eb16a4e1bc6d1471cde08d39213'
    || receipt.baseline?.ciConclusion !== 'success'
    || receipt.baseline?.ciPassedJobs !== 13 || receipt.baseline?.ciExpectedSkips !== 7
    || receipt.baseline?.ciFailures !== 0
    || receipt.baseline?.pagesRunId !== 39256866795
    || receipt.baseline?.mergedHead !== BASE
    || receipt.retained?.nodePassed !== 3550 || receipt.retained?.reactPassed !== 158
    || receipt.retained?.pythonContracts !== true || receipt.retained?.sqlContracts !== true) {
    throw new Error('V239_RETAINED_BASELINE_IDENTITY_INVALID');
  }
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);
  const priorReceipt = gitRaw(rootDir, ['show', `${BASE}:docs/releases/v2.3.8-retained-validation.json`]);
  if (digest(priorReceipt) !== digest(fs.readFileSync(path.join(rootDir, 'docs/releases/v2.3.8-retained-validation.json'), 'utf8'))) {
    throw new Error('V239_PREVIOUS_RELEASE_RECEIPT_CHANGED');
  }
  const prior = JSON.parse(priorReceipt);
  const priorDatabase = prior.targetedValidation?.isolatedDatabase;
  const priorDatabaseChecks = priorDatabase?.checks || [];
  const retainedSqlChecks = [
    'suspend_tag_approval.mjs',
    'suspend_tag_sender_identity_pglite.mjs',
    'suspend-tag-migration-registration.test.mjs',
  ];
  if (priorDatabase?.productionDatabaseAccessed !== false
    || priorDatabase?.productionDataModified !== false
    || retainedSqlChecks.some(name => !priorDatabaseChecks.some(check => check.name === name && check.result === 'passed'))) {
    throw new Error('V239_SQL_RETENTION_BASELINE_INVALID');
  }
  if (digest(gitRaw(rootDir, ['show', `${BASE}:Code.gs`])) !== digest(fs.readFileSync(path.join(rootDir, 'Code.gs'), 'utf8'))) {
    throw new Error('V239_CODE_GS_MUST_REMAIN_UNCHANGED');
  }

  const changedPaths = collectChangedPaths(rootDir);
  for (const file of changedPaths) {
    if (!ALLOWED_PATHS.has(file)) throw new Error(`V239_UNEXPECTED_SCOPE:${file}`);
    if (file.startsWith('supabase/') || file.startsWith('database/')) throw new Error(`V239_BACKEND_CHANGE_FORBIDDEN:${file}`);
  }
  const validatedSourceHashes = receipt.validatedSourceHashes;
  if (!validatedSourceHashes || JSON.stringify(Object.keys(validatedSourceHashes).sort()) !== JSON.stringify([...SOURCE_FILES].sort())) {
    throw new Error('V239_SOURCE_HASH_SET_INVALID');
  }
  for (const file of SOURCE_FILES) {
    const actual = digest(fs.readFileSync(path.join(rootDir, file), 'utf8'));
    if (actual !== validatedSourceHashes[file]) throw new Error(`V239_UNVALIDATED_SOURCE:${file}`);
  }

  const retainedHashes = receipt.retained?.unchangedFocusedSourceHashes;
  if (!retainedHashes || JSON.stringify(Object.keys(retainedHashes).sort()) !== JSON.stringify([...RETAINED_SOURCE_FILES].sort())) {
    throw new Error('V239_RETAINED_SOURCE_SET_INVALID');
  }
  for (const file of RETAINED_SOURCE_FILES) {
    const baseline = digest(gitRaw(rootDir, ['show', `${BASE}:${file}`]));
    const actual = digest(fs.readFileSync(path.join(rootDir, file), 'utf8'));
    if (retainedHashes[file] !== baseline || actual !== baseline) throw new Error(`V239_RETAINED_SOURCE_CHANGED:${file}`);
  }

  const focused = receipt.targetedValidation;
  if (JSON.stringify(focused?.node?.files) !== JSON.stringify(FOCUSED_NODE_FILES)
    || focused?.node?.status !== 'passed' || focused?.node?.failed !== 0
    || !Number.isInteger(focused.node.passed) || focused.node.passed < FOCUSED_NODE_FILES.length
    || JSON.stringify(focused?.browser?.files) !== JSON.stringify(FOCUSED_BROWSER_FILES)
    || focused?.browser?.status !== 'passed' || focused.browser.failed !== 0
    || !Number.isInteger(focused.browser.passed) || focused.browser.passed < 1) {
    throw new Error('V239_TARGETED_VALIDATION_EVIDENCE_INVALID');
  }
  return {
    baseline: BASE,
    baselineCiRunId: receipt.baseline.ciRunId,
    baselinePagesRunId: receipt.baseline.pagesRunId,
    retainedNodePassed: receipt.retained.nodePassed,
    retainedReactPassed: receipt.retained.reactPassed,
    retainedPythonContracts: receipt.retained.pythonContracts,
    retainedSqlContracts: receipt.retained.sqlContracts,
    focusedNodeFiles: [...FOCUSED_NODE_FILES],
    focusedBrowserFiles: [...FOCUSED_BROWSER_FILES],
    focusedNodePassed: focused.node.passed,
    focusedBrowserPassed: focused.browser.passed,
    fullSuitesRerun: false,
    changedPaths,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--capture-source-hashes') console.log(JSON.stringify(computeV239SourceHashes(), null, 2));
    else if (process.argv[2] === '--capture-retained-source-hashes') console.log(JSON.stringify(computeV239RetainedSourceHashes(), null, 2));
    else console.log(JSON.stringify(verifyV239RetainedValidation(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
