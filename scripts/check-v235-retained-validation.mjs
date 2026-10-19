import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASELINE = '06012577878f508b72cdafc9ee7caeef3381026a';
const MANIFEST_PATH = 'docs/releases/v2.3.5-retained-validation.json';
const FOCUSED_LOG = 'docs/releases/v2.3.5-bunch-focused.txt';
const BUNCH_FOCUSED_FILES = ['components/bunch-queue/WorkCard.tsx', 'components/bunch-queue/QueueView.tsx', 'components/bunch-queue/contract.ts', 'components/bunch-queue/bunch-queue.css', 'services/bunchQueue.ts', 'tests/bunch-queue-view.test.tsx'];
const REQUIRED_JOBS = [
  'validation / unit (1)', 'validation / unit (2)', 'validation / unit (3)', 'validation / unit (4)',
  'validation / react', 'validation / lint', 'validation / contracts', 'validation / build', 'validation / release-gate',
];
const REQUIRED_CHANGED_PATHS = [
  'components/bunch-queue/WorkCard.tsx',
  'components/bunch-queue/bunch-queue.css',
  'tests/bunch-queue-view.test.tsx',
  'tests/bunch-queue.e2e.spec.ts',
  'tests/bunch-queue-supervisor.e2e.spec.ts',
  'assets/eval-reports-engine.js',
  'tests/eval-report2-card-suppression.test.mjs',
  'tests/eval-report2-card-suppression.e2e.spec.ts',
  'scripts/run-release-unit-checks.mjs',
  'scripts/run-release-react-checks.mjs',
  'scripts/check-v235-retained-validation.mjs',
  MANIFEST_PATH,
  FOCUSED_LOG,
  '.github/workflows/pr-validation.yml',
  '.github/workflows/release-validation.yml',
];
const ALLOWED_SOURCE_PATHS = [
  'components/bunch-queue/WorkCard.tsx',
  'components/bunch-queue/QueueView.tsx',
  'components/bunch-queue/bunch-queue.css',
  'components/bunch-queue/contract.ts',
  'services/bunchQueue.ts',
  'tests/bunch-queue-view.test.tsx',
  'tests/bunch-queue.e2e.spec.ts',
  'tests/bunch-queue-supervisor.e2e.spec.ts',
  'assets/bunch-queue.js',
  'assets/bunch-queue.css',
  'assets/eval-reports-engine.js',
  'index.html',
  'tests/eval-report2-card-suppression.test.mjs',
  'tests/eval-report2-card-suppression.e2e.spec.ts',
  'scripts/run-release-unit-checks.mjs',
  'scripts/run-release-react-checks.mjs',
  'scripts/check-v235-retained-validation.mjs',
  MANIFEST_PATH,
  FOCUSED_LOG,
  '.github/workflows/pr-validation.yml',
  '.github/workflows/release-validation.yml',
];
const RELEASE_MARKER_PATHS = [
  'package.json', 'package-lock.json', 'index.html', 'manifest.json', 'sw.js',
  'scripts/build-live-shell.mjs', 'v2/src/services/api.ts', 'v2/public/manifest.webmanifest',
  'assets/ops-precision-pilot.js',
];
const FORBIDDEN_PATHS = ['Code.gs', 'supabase/**', 'database/**', 'migrations/**'];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw new Error(`RETAINED_V235_INVALID_JSON:${label}`); }
}

function normalizeReleaseJson(file, text, expectedVersion) {
  const value = parseJson(text, file);
  if (file === 'package.json') {
    if (value.version !== expectedVersion) throw new Error('RETAINED_V235_PACKAGE_VERSION_MISMATCH');
    value.version = '__PACKAGE_VERSION__';
  } else if (file === 'package-lock.json') {
    if (value.version !== expectedVersion || value.packages?.['']?.version !== expectedVersion) {
      throw new Error('RETAINED_V235_LOCK_VERSION_MISMATCH');
    }
    value.version = '__PACKAGE_VERSION__';
    value.packages[''].version = '__PACKAGE_VERSION__';
  }
  return JSON.stringify(value);
}

function normalizeReleaseText(text, version) {
  const token = `AgData v${version}`;
  const encoded = encodeURIComponent(token);
  return text.replaceAll(token, '__AGDATA_RELEASE__').replaceAll(encoded, '__AGDATA_RELEASE_ENCODED__');
}

function changedPaths(root, baseline) {
  const result = new Set();
  for (const args of [
    ['diff', '--name-only', '--no-renames', `${baseline}...HEAD`],
    ['diff', '--name-only', '--no-renames', '--cached'],
    ['diff', '--name-only', '--no-renames'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    const output = git(root, args);
    for (const entry of output.split('\n').filter(Boolean)) result.add(entry.replaceAll('\\', '/'));
  }
  return [...result].sort();
}

export function verifyV235RetainedValidation({ rootDir = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  const read = file => fs.readFileSync(path.join(rootDir, file), 'utf8');
  const manifest = parseJson(read(MANIFEST_PATH), MANIFEST_PATH);
  const pkg = parseJson(read('package.json'), 'package.json');
  const baselinePackage = parseJson(git(rootDir, ['show', `${BASELINE}:package.json`]), 'baseline package.json');
  if (pkg.version !== '2.3.5' || baselinePackage.version !== '2.3.3'
    || baselinePackage.appsScriptRelease !== 'AgData v2.2.1'
    || manifest.schemaVersion !== 'agdata-v235-retained-validation-v1'
    || manifest.packageVersion !== '2.3.5' || manifest.baseline !== BASELINE) {
    throw new Error('RETAINED_V235_RELEASE_IDENTITY_INVALID');
  }
  if (pkg.appsScriptRelease !== baselinePackage.appsScriptRelease || pkg.appsScriptRelease !== 'AgData v2.2.1') {
    throw new Error('RETAINED_V235_APPS_SCRIPT_PIN_CHANGED');
  }
  git(rootDir, ['merge-base', '--is-ancestor', BASELINE, 'HEAD']);

  const proof = manifest.baselineProof;
  if (proof?.workflow !== 'Deploy static app to Pages' || proof.runId !== 39188509283
    || proof.event !== 'workflow_dispatch' || proof.branch !== 'main' || proof.headSha !== BASELINE
    || proof.conclusion !== 'success' || proof.node?.passed !== 3550
    || JSON.stringify(proof.node?.successfulShards) !== JSON.stringify([1, 2, 3, 4])
    || proof.react?.conclusion !== 'success' || proof.react?.passed !== 158
    || !Array.isArray(proof.requiredJobs) || proof.requiredJobs.length !== REQUIRED_JOBS.length
    || REQUIRED_JOBS.some((job, index) => proof.requiredJobs[index]?.name !== job
      || proof.requiredJobs[index]?.conclusion !== 'success')
    || proof.evidenceUrl !== `https://github.com/collygedylan/GNC-Sales-Command-PRO-/actions/runs/${proof.runId}`) {
    throw new Error('RETAINED_V235_BASELINE_RUN_PROOF_INVALID');
  }
  const scope = manifest.scope;
  if (!Array.isArray(scope?.sourcePaths) || !Array.isArray(scope?.releaseMarkerPaths)
    || !Array.isArray(scope?.forbiddenPaths)
    || JSON.stringify(scope.sourcePaths) !== JSON.stringify(ALLOWED_SOURCE_PATHS)
    || JSON.stringify(scope.releaseMarkerPaths) !== JSON.stringify(RELEASE_MARKER_PATHS)
    || JSON.stringify(scope.forbiddenPaths) !== JSON.stringify(FORBIDDEN_PATHS)
    || REQUIRED_CHANGED_PATHS.some(file => !scope.sourcePaths.includes(file))) {
    throw new Error('RETAINED_V235_SCOPE_MANIFEST_INVALID');
  }
  const allowed = new Set([...scope.sourcePaths, ...scope.releaseMarkerPaths]);
  const paths = changedPaths(rootDir, BASELINE);
  const unexpected = paths.filter(file => !allowed.has(file));
  if (unexpected.length) throw new Error(`RETAINED_V235_UNEXPECTED_CHANGED_PATHS:${unexpected.join(',')}`);
  for (const file of scope.forbiddenPaths) {
    if (paths.some(changed => changed === file || (file.endsWith('/**') && changed.startsWith(file.slice(0, -3))))) {
      throw new Error(`RETAINED_V235_FORBIDDEN_PATH_CHANGED:${file}`);
    }
  }
  for (const file of REQUIRED_CHANGED_PATHS) {
    if (!paths.includes(file)) throw new Error(`RETAINED_V235_REQUIRED_PATH_MISSING:${file}`);
  }

  for (const file of scope.releaseMarkerPaths) {
    const baselineText = git(rootDir, ['show', `${BASELINE}:${file}`]);
    const currentText = read(file);
    let normalizedBaseline;
    let normalizedCurrent;
    if (file === 'package.json' || file === 'package-lock.json') {
      normalizedBaseline = normalizeReleaseJson(file, baselineText, baselinePackage.version);
      normalizedCurrent = normalizeReleaseJson(file, currentText, pkg.version);
    } else {
      normalizedBaseline = normalizeReleaseText(baselineText, baselinePackage.version).trim().replaceAll('\r\n', '\n');
      normalizedCurrent = normalizeReleaseText(currentText, pkg.version).trim().replaceAll('\r\n', '\n');
    }
    if (file === 'index.html') {
      // Apart from release markers, only these reviewed Eval2 projection edits
      // are covered by the new targeted tests; retain all other inline code.
      normalizedCurrent = normalizedCurrent
        .replace('            index.suppressedItemCodes = new Set();\n            const reportApi = getManagerEvalReports2Api();\n', '')
        .replace("                if (reportApi && typeof reportApi.isSuppressedEvalReportCardRows === 'function')\n                    && reportApi.isSuppressedEvalReportCardRows(rows)) index.suppressedItemCodes.add(code);\n", '')
        .replace("                if (reportApi && typeof reportApi.isSuppressedEvalReportCardRows === 'function'\n                    && reportApi.isSuppressedEvalReportCardRows(rows)) index.suppressedItemCodes.add(code);\n", '')
        .replace('            const suppressedItemCodes = index.suppressedItemCodes instanceof Set ? index.suppressedItemCodes : new Set();\n            const result = Array.from(rows.values()).filter((row) => !suppressedItemCodes.has(getManagerEvalReport2ItemCode(row)));', '            const result = Array.from(rows.values());')
        .replace('String(getManagerEvalReport2Rows(id).length)', 'String(index.counts[id] || 0)');
    }
    if (normalizedBaseline !== normalizedCurrent) throw new Error(`RETAINED_V235_NON_VERSION_RELEASE_FILE_CHANGE:${file}`);
    if (baselineText === currentText) throw new Error(`RETAINED_V235_RELEASE_MARKER_NOT_UPDATED:${file}`);
  }

  const prWorkflow = read('.github/workflows/pr-validation.yml');
  const releaseWorkflow = read('.github/workflows/release-validation.yml');
  for (const [name, workflow] of [['pr-validation.yml', prWorkflow], ['release-validation.yml', releaseWorkflow]]) {
    if (!workflow.includes('node scripts/run-release-react-checks.mjs') || workflow.includes('npm run test:v2')) {
      throw new Error(`RETAINED_V235_REACT_WRAPPER_NOT_WIRED:${name}`);
    }
  }
  const focused = manifest.focusedBunchProof;
  const digest = value => createHash('sha256').update(value.replaceAll('\r\n', '\n')).digest('hex');
  if (focused?.passed !== 15 || focused.command !== 'node node_modules/vitest/vitest.mjs run --config vite.v2.config.ts tests/bunch-queue-view.test.tsx'
    || focused.logPath !== FOCUSED_LOG || focused.logSha256 !== digest(read(FOCUSED_LOG))
    || !/Tests\s+15 passed \(15\)/.test(read(FOCUSED_LOG))
    || JSON.stringify(Object.keys(focused.sourceSha256 || {})) !== JSON.stringify(BUNCH_FOCUSED_FILES)
    || BUNCH_FOCUSED_FILES.some(file => digest(read(file)) !== focused.sourceSha256[file])) {
    throw new Error('RETAINED_V235_FOCUSED_BUNCH_EVIDENCE_CHANGED');
  }
  return {
    packageVersion: pkg.version,
    baseline: BASELINE,
    baselineRunId: proof.runId,
    retainedNodePassed: proof.node.passed,
    retainedReactPassed: proof.react.passed,
    retainedSuitesRerun: false,
    retainedFocusedBunchPassed: focused.passed,
    focusedReactFile: manifest.reusedSuites?.requiredFocusedReactFile,
    focusedBrowserFiles: manifest.reusedSuites?.requiredFocusedBrowserFiles,
    changedPaths: paths,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(verifyV235RetainedValidation(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
