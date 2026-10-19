import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = '643be9e9dc916a4f4197b8b72bea5a786524b642';
const CHECKPOINT = '7e4b90916a6ec8b0ca221b74fc58956b1ad75810';
const RECEIPT = 'docs/releases/v2.3.10-retained-validation.json';
const FOCUSED = ['tests/live-sync-registry-coverage.test.mjs', 'tests/av-native-cache-hydration.test.mjs'];
const REP_NAMES = ['abbey_burka', 'annette_hancock', 'ben_brown', 'ben_harveson', 'ben_maschino',
  'brian_hatfield', 'cait_bowden', 'casey_rufener', 'chance_alldredge', 'david_brandt', 'ellen_deely',
  'jessica_robertson', 'josh_ringleb', 'kevin_effinger', 'meredith_hilliard', 'nate_douglas',
  'rand_hopkins', 'toby_brown', 'tony_bono', 'tracey_tapscott', 'traci_earle', 'troy_lee', 'wes_lugas'];
const MARKER_ONLY = ['assets/ops-precision-pilot.js', 'sw.js', 'manifest.json',
  'scripts/build-live-shell.mjs', 'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
  'package.json', 'package-lock.json'];
const SOURCE_FILES = Object.freeze([
  'assets/live-sync-registry.js', 'assets/ops-precision-pilot.js', 'index.html',
  'manifest.json', 'package-lock.json', 'package.json', 'scripts/build-live-shell.mjs',
  'scripts/check-v2310-retained-validation.mjs', 'scripts/ci-backend-matrix.mjs',
  'scripts/run-discovered-tests.mjs', 'scripts/run-release-react-checks.mjs',
  'scripts/run-release-unit-checks.mjs', 'scripts/verify-live-av-sales-reps.mjs',
  'sw.js', ...FOCUSED, 'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
]);
const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const digest = text => createHash('sha256').update(String(text).replaceAll('\r\n', '\n')).digest('hex');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

// The retained checks stay at their tested checkpoint. Only these bounded
// preview values differ; the new 23-account browser gate validates them.
function normalizeValidatedPreview(source) {
  const replacements = [
    ['const previewRows = isAvOpenPreview ? rows.slice(0, 200) : rows;', 'const previewRows = isAvOpenPreview ? rows.slice(0, 16) : rows;'],
    ['{ firstPageLimit: 200 }', '{ firstPageLimit: 16 }'],
    ['const AV_DERIVED_PREVIEW_SOURCE_LIMIT = 200;', 'const AV_DERIVED_PREVIEW_SOURCE_LIMIT = 50;'],
    ['// Publish a bounded source preview large enough for the', '// The first visible card needs at most the same 16'],
    ['// initial card window while retaining partial/loading state.', '// prepared rows we publish. Keep the initial response'],
    ['// Continuation reads every remaining 500-row page from the', '// compact; continuation still reads complete 500-row'],
    ['// exact offset; final counts/export wait for full hydration.', '// pages from the exact offset after this preview.'],
  ];
  for (const [current, checkpoint] of replacements) {
    if (source.split(current).length !== 2) throw new Error('V2310_PREVIEW_BOUNDARY_INVALID');
    source = source.replace(current, checkpoint);
  }
  return source;
}

export function computeV2310SourceHashes({ rootDir = rootDefault } = {}) {
  return Object.fromEntries(SOURCE_FILES.map(file => [file, digest(read(rootDir, file))]));
}

export function verifyV2310RetainedValidation({ rootDir = rootDefault } = {}) {
  const receipt = JSON.parse(read(rootDir, RECEIPT));
  if (JSON.parse(read(rootDir, 'package.json')).version !== '2.3.10'
    || receipt.schemaVersion !== 'agdata-v2310-retained-validation-v1'
    || receipt.base !== BASE || receipt.checkpoint !== CHECKPOINT
    || receipt.baseline?.ciRunId !== 39264555216 || receipt.baseline?.pagesRunId !== 39264964801
    || receipt.baseline?.ciConclusion !== 'success'
    || receipt.retained?.nodePassed !== 3550 || receipt.retained?.reactPassed !== 158
    || receipt.focused?.passed !== 34 || receipt.focused?.failed !== 0
    || receipt.focused?.rerun !== false) throw new Error('V2310_RETAINED_IDENTITY_INVALID');
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);
  // Retain exact checkpoint code except the explicitly browser-validated preview bounds.
  for (const file of [...FOCUSED, 'assets/live-sync-registry.js', 'index.html']) {
    let current = read(rootDir, file).replaceAll('AgData v2.3.10', 'AgData v2.3.9').replaceAll('AgData%20v2.3.10', 'AgData%20v2.3.9');
    if (file === 'index.html') current = normalizeValidatedPreview(current);
    if (digest(current) !== digest(git(rootDir, ['show', `${CHECKPOINT}:${file}`]))) throw new Error(`V2310_FOCUSED_SOURCE_CHANGED:${file}`);
  }
  for (const file of MARKER_ONLY) {
    const current = read(rootDir, file).replaceAll('AgData v2.3.10', 'AgData v2.3.9')
      .replaceAll('AgData%20v2.3.10', 'AgData%20v2.3.9').replaceAll('"2.3.10"', '"2.3.9"');
    if (digest(current) !== digest(git(rootDir, ['show', `${CHECKPOINT}:${file}`]))) throw new Error(`V2310_RELEASE_MARKER_ONLY:${file}`);
  }
  for (const file of ['Code.gs', 'docs/releases/v2.3.9-retained-validation.json', 'docs/releases/v2.3.8-retained-validation.json']) {
    if (digest(read(rootDir, file)) !== digest(git(rootDir, ['show', `${BASE}:${file}`]))) throw new Error(`V2310_BASELINE_CHANGED:${file}`);
  }
  const prior = JSON.parse(read(rootDir, 'docs/releases/v2.3.9-retained-validation.json'));
  if (!prior.retained.sqlContracts || !prior.retained.pythonContracts) throw new Error('V2310_PRIOR_CONTRACT_EVIDENCE_MISSING');
  const allowed = new Set([...SOURCE_FILES, RECEIPT]);
  const changed = new Set([
    ...git(rootDir, ['diff', '--name-only', `${BASE}...HEAD`]).trim().split('\n'),
    ...git(rootDir, ['diff', '--name-only', 'HEAD']).trim().split('\n'),
    ...git(rootDir, ['ls-files', '--others', '--exclude-standard']).trim().split('\n'),
  ].filter(Boolean));
  for (const file of changed) if (!allowed.has(file)) throw new Error(`V2310_UNEXPECTED_SCOPE:${file}`);
  if (JSON.stringify(Object.keys(receipt.validatedSourceHashes || {}).sort()) !== JSON.stringify([...SOURCE_FILES].sort())) throw new Error('V2310_SOURCE_SET_INVALID');
  for (const [file, hash] of Object.entries(computeV2310SourceHashes({ rootDir }))) {
    if (receipt.validatedSourceHashes[file] !== hash) throw new Error(`V2310_UNVALIDATED_SOURCE:${file}`);
  }
  if (receipt.previewAdjustment?.firstPageRows !== 200 || receipt.previewAdjustment?.publishedSourceRows !== 200
    || receipt.previewAdjustment?.derivedSourceRows !== 200 || receipt.previewAdjustment?.fullReadStillRequired !== true) throw new Error('V2310_PREVIEW_EVIDENCE_MISSING');
  const browser = receipt.browser;
  if (browser?.mode !== 'production-snapshot-fixture' || browser.realAuthenticationVerified !== false
    || browser.status !== 'passed' || browser.failed !== 0 || browser.accounts !== 23
    || browser.productionWrites !== false || browser.realEmailsSent !== false
    || !/^[a-f0-9]{64}$/.test(browser.snapshotSha256 || '')
    || !Array.isArray(browser.results) || browser.results.length < 23) throw new Error('V2310_BROWSER_EVIDENCE_INVALID');
  const names = new Set();
  const environments = new Map();
  for (const result of browser.results) {
    if (!REP_NAMES.includes(result.username) || !result.environment || result.status !== 'passed'
      || !Number.isInteger(result.expectedRows) || result.expectedRows <= 5
      || result.actualRows !== result.expectedRows
      || !Number.isInteger(result.expectedItemcodes) || result.expectedItemcodes <= 5
      || result.actualItemcodes !== result.expectedItemcodes
      || result.initialWindowPaintMs < 0 || !Number.isFinite(result.initialWindowPaintMs)
      || result.initialWindowPaintMs >= 1500 || result.loadingObserved !== true || result.loadingCleared !== true
      || !Number.isFinite(result.fullReadyMs) || result.fullReadyMs < result.initialWindowPaintMs
      || result.mountedCards < 20) throw new Error('V2310_ACCOUNT_RESULT_INVALID');
    names.add(result.username);
    if (!environments.has(result.environment)) environments.set(result.environment, new Set());
    const environmentNames = environments.get(result.environment);
    if (environmentNames.has(result.username)) throw new Error('V2310_DUPLICATE_ACCOUNT_RESULT');
    environmentNames.add(result.username);
  }
  if (names.size !== 23 || [...environments.values()].some(group => group.size !== 23)) throw new Error('V2310_REP_SET_INVALID');
  return { baseline: BASE, baselineCiRunId: receipt.baseline.ciRunId,
    retainedNodePassed: 3550, retainedReactPassed: 158, focusedNodePassed: 34,
    retainedPythonContracts: true, retainedSqlContracts: true, fullSuitesRerun: false,
    browserAccounts: names.size, changedPaths: [...changed].sort() };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(process.argv.includes('--capture-source-hashes')
      ? computeV2310SourceHashes() : verifyV2310RetainedValidation(), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
