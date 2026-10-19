// Source-sealed v2.3.12 validation. Historical v2.3.11 evidence is retained
// only for sources that this release leaves unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const BASE = 'b4990af247236f6ae673236b8229ea5af92333d5';
const RECEIPT = 'docs/releases/v2.3.12-retained-validation.json';
const RESULT_DIR = 'docs/releases/v2.3.12-validation';
const SCOPES = Object.freeze(['node', 'browser', 'tooling', 'build']);
const RESULT_ARTIFACTS = Object.freeze(Object.fromEntries(SCOPES.map(scope => [scope, `${RESULT_DIR}/${scope}.json`])));
const SOURCE_FILES = Object.freeze([
  '.github/workflows/apps-script-sync.yml', '.github/workflows/pr-validation.yml',
  '.github/workflows/publish-candidate.yml', '.github/workflows/release-database.yml',
  '.github/workflows/release-validation.yml',
  'Code.gs', 'assets/ops-precision-pilot.css', 'assets/ops-precision-pilot.js',
  'index.html', 'manifest.json', 'package-lock.json', 'package.json', 'sw.js',
  'scripts/apps-script-function-patch.mjs', 'scripts/build-live-shell.mjs',
  'scripts/check-v2312-retained-validation.mjs', 'scripts/ci-backend-matrix.mjs',
  'scripts/run-release-react-checks.mjs', 'scripts/run-release-unit-checks.mjs',
  'scripts/sync-codegs-to-apps-script.js',
  'playwright.v2312-scoped.config.ts',
  'tests/apps-script-function-patch.test.mjs', 'tests/daily-data-sync.test.mjs',
  'tests/import-history-routing.test.mjs', 'tests/manual-sync-ui.test.mjs', 'tests/suspend-tag-import.test.mjs',
  'tests/suspend-tag-card-layout.test.mjs', 'tests/suspend-tag-compaction.e2e.spec.ts', 'tests/suspend-tag-completion.e2e.spec.ts',
  'tests/v2312-live-sync-ui.e2e.spec.ts',
  'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
]);
const PATCH_FUNCTIONS = Object.freeze([
  'assertRoutedPendingSourceSelection_',
  'processCustomerRepMapSnapshotLocked_',
  'getManualSyncStatusForClient_',
  'createManualSyncQueuedStatus_',
  'sanitizeManualSyncStatusForClient_',
  'runRoutedDropImport_', 'listRoutedDropFiles_', 'processSnapshotBatchFolderLocked_',
  'processLatestFileOnlyFolderLocked_', 'runQueuedManualSyncStage_', 'isLiveImportTemporaryFile_',
  'syncHlPoParsedFolder_', 'syncTransactionsKeyedFolder_', 'syncPikesOrdersFolder_',
  'processFolderLocked_', 'readManualSyncLiveSourceWatermark_', 'saveManualSyncLiveSourceWatermark_',
]);
const ADDITIVE_APPS_SCRIPT_FUNCTIONS = new Set([
  'isLiveImportTemporaryFile_', 'readManualSyncLiveSourceWatermark_', 'saveManualSyncLiveSourceWatermark_',
]);
const REQUIRED_SOURCE_FILES = Object.freeze([
  'Code.gs', 'assets/ops-precision-pilot.css', 'index.html', 'package.json',
  'scripts/apps-script-function-patch.mjs', 'tests/apps-script-function-patch.test.mjs',
  'tests/manual-sync-ui.test.mjs', 'tests/suspend-tag-card-layout.test.mjs',
  'tests/suspend-tag-compaction.e2e.spec.ts', 'tests/suspend-tag-completion.e2e.spec.ts', 'tests/v2312-live-sync-ui.e2e.spec.ts',
]);
const PROTECTED_BACKFILL_FUNCTIONS = Object.freeze([
  'importHistoryNightWindow_', 'assertImportHistoryBackfillWindow_',
  'startImportHistoryBackfill', 'runImportHistoryBackfillChunk_',
]);
const ALLOWED_PATHS = new Set([...SOURCE_FILES, RECEIPT, ...Object.values(RESULT_ARTIFACTS)]);
const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(String(value).replaceAll('\r\n', '\n')).digest('hex');
const digestBytes = value => createHash('sha256').update(value).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

function changedPathEntries(rootDir) {
  const raw = git(rootDir, ['diff', '--name-status', '-z', '--no-renames', BASE]).split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < raw.length;) {
    const status = raw[i++];
    const file = raw[i++];
    if (!status || !file || !/^[AMDRC][0-9]*$/.test(status)) throw new Error('V2312_GIT_CHANGE_STATUS_INVALID');
    entries.push({ status: status[0], file });
  }
  for (const file of git(rootDir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    entries.push({ status: 'A', file });
  }
  return entries;
}

export function assertV2312AuthorizedPaths(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const file = String(entry?.file || '');
    const status = String(entry?.status || '');
    if (status === 'D') throw new Error(`V2312_DELETION_FORBIDDEN:${file}`);
    if (!['A', 'M'].includes(status)) throw new Error(`V2312_CHANGE_STATUS_FORBIDDEN:${file}`);
    if (!ALLOWED_PATHS.has(file)) throw new Error(`V2312_UNAUTHORIZED_SOURCE_PATH:${file}`);
    if (seen.has(file)) throw new Error(`V2312_DUPLICATE_SOURCE_PATH:${file}`);
    seen.add(file);
  }
  return seen;
}

export function computeV2312SourceHashDigest(hashes) {
  const canonical = Object.fromEntries(Object.entries(hashes || {}).sort(([a], [b]) => a.localeCompare(b)));
  return digest(JSON.stringify(canonical));
}

export function validateV2312ResultArtifact({ scope, receiptResult, artifactText, sourceHashDigest }) {
  const expectedPath = RESULT_ARTIFACTS[scope];
  if (!expectedPath || receiptResult?.artifactPath !== expectedPath) throw new Error(`V2312_RESULT_PATH_INVALID:${scope}`);
  const actualArtifactHash = digestBytes(Buffer.from(String(artifactText), 'utf8'));
  if (receiptResult.artifactSha256 !== actualArtifactHash) throw new Error(`V2312_RESULT_HASH_MISMATCH:${scope}`);
  let artifact;
  try { artifact = JSON.parse(String(artifactText)); }
  catch { throw new Error(`V2312_RESULT_JSON_INVALID:${scope}`); }
  if (artifact?.schemaVersion !== 'agdata-v2312-validation-result-v1'
    || artifact.scope !== scope || artifact.status !== 'passed'
    || typeof artifact.validationId !== 'string' || !artifact.validationId.trim()
    || !Number.isSafeInteger(artifact.checks) || artifact.checks < 1
    || artifact.sourceHashDigest !== sourceHashDigest
    || receiptResult.validationId !== artifact.validationId
    || receiptResult.status !== artifact.status || receiptResult.checks !== artifact.checks
    || receiptResult.sourceHashDigest !== artifact.sourceHashDigest) {
    throw new Error(`V2312_RESULT_CONTRACT_INVALID:${scope}`);
  }
  return artifact;
}

function topLevelFunctions(source, label, patchFunctions) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const functions = new Map();
  const otherStatements = [];
  let deploymentFingerprintCount = 0;
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      const name = node.id.name;
      if (patchFunctions.includes(name) && functions.has(name)) {
        throw new Error(`V2312_APPS_SCRIPT_DUPLICATE_FUNCTION:${label}:${name}`);
      }
      const body = source.slice(node.start, node.end).replaceAll('\r\n', '\n');
      const bodies = functions.get(name) || [];
      bodies.push(body);
      functions.set(name, bodies);
      continue;
    }
    const isDeploymentFingerprint = node.type === 'VariableDeclaration'
      && node.declarations.some(declaration => declaration.id?.name === 'APPS_SCRIPT_DEPLOYMENT_COMMIT_');
    if (isDeploymentFingerprint) {
      deploymentFingerprintCount += 1;
      continue;
    }
    otherStatements.push(source.slice(node.start, node.end).replaceAll('\r\n', '\n'));
  }
  if (deploymentFingerprintCount !== 1) throw new Error(`V2312_APPS_SCRIPT_FINGERPRINT_COUNT:${label}`);
  return { functions, otherStatements };
}

export function verifyV2312AppsScriptProtection({ baseSource, currentSource, patchFunctions }) {
  if (!Array.isArray(patchFunctions) || !patchFunctions.length
    || new Set(patchFunctions).size !== patchFunctions.length
    || patchFunctions.some(name => !PATCH_FUNCTIONS.includes(name))) throw new Error('V2312_APPS_SCRIPT_PATCH_ALLOWLIST');
  const baseline = topLevelFunctions(baseSource, 'base', patchFunctions);
  const current = topLevelFunctions(currentSource, 'current', patchFunctions);
  const sameBodies = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((body, index) => body === right[index]);
  for (const name of PROTECTED_BACKFILL_FUNCTIONS) {
    if (patchFunctions.includes(name) || !baseline.functions.has(name)
      || !sameBodies(current.functions.get(name), baseline.functions.get(name))) {
      throw new Error(`V2312_BACKFILL_FUNCTION_CHANGED:${name}`);
    }
  }
  if (JSON.stringify(baseline.otherStatements) !== JSON.stringify(current.otherStatements)) {
    throw new Error('V2312_APPS_SCRIPT_NONFUNCTION_SOURCE_CHANGED');
  }
  for (const [name, source] of baseline.functions) {
    if (patchFunctions.includes(name)) continue;
    if (!sameBodies(current.functions.get(name), source)) throw new Error(`V2312_APPS_SCRIPT_PROTECTED_FUNCTION_CHANGED:${name}`);
  }
  for (const [name] of current.functions) {
    if (baseline.functions.has(name)) continue;
    if (!patchFunctions.includes(name) || !ADDITIVE_APPS_SCRIPT_FUNCTIONS.has(name)) {
      throw new Error(`V2312_APPS_SCRIPT_UNAUTHORIZED_FUNCTION_ADDITION:${name}`);
    }
  }
  for (const name of patchFunctions) {
    const baselineCount = (baseline.functions.get(name) || []).length;
    const currentCount = (current.functions.get(name) || []).length;
    if (baselineCount > 1 || currentCount > 1) throw new Error(`V2312_APPS_SCRIPT_DUPLICATE_FUNCTION:patch:${name}`);
    if (currentCount !== 1) throw new Error(`V2312_APPS_SCRIPT_PATCH_FUNCTION_MISSING:${name}`);
  }
  const protectedFunctionSources = Object.fromEntries([...baseline.functions]
    .filter(([name]) => !patchFunctions.includes(name)).sort(([a], [b]) => a.localeCompare(b)));
  const protectedFunctionDefinitionCount = Object.values(protectedFunctionSources)
    .reduce((count, bodies) => count + bodies.length, 0);
  return {
    protectedFunctions: Object.keys(protectedFunctionSources).length,
    protectedFunctionDefinitionCount,
    protectedSourceDigest: digest(JSON.stringify({
      functions: protectedFunctionSources,
      otherStatements: baseline.otherStatements,
    })),
    patchFunctions: [...patchFunctions],
  };
}

export function computeV2312SourceHashes({ rootDir = rootDefault } = {}) {
  const changed = assertV2312AuthorizedPaths(changedPathEntries(rootDir));
  const excluded = new Set([RECEIPT, ...Object.values(RESULT_ARTIFACTS)]);
  return Object.fromEntries([...changed].filter(file => !excluded.has(file)).sort()
    .map(file => [file, digest(read(rootDir, file))]));
}

export function verifyV2312RetainedValidation({ rootDir = rootDefault } = {}) {
  const receipt = JSON.parse(read(rootDir, RECEIPT));
  const packageManifest = JSON.parse(read(rootDir, 'package.json'));
  if (packageManifest.version !== '2.3.12' || receipt.schemaVersion !== 'agdata-v2312-scoped-validation-v1'
    || receipt.release !== 'AgData v2.3.12' || receipt.base !== BASE) throw new Error('V2312_RECEIPT_IDENTITY');
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);
  const changed = changedPathEntries(rootDir);
  assertV2312AuthorizedPaths(changed);
  const actual = computeV2312SourceHashes({ rootDir });
  for (const file of REQUIRED_SOURCE_FILES) if (!Object.hasOwn(actual, file)) {
    throw new Error(`V2312_REQUIRED_SOURCE_MISSING:${file}`);
  }
  const recorded = receipt.validatedSourceHashes && typeof receipt.validatedSourceHashes === 'object'
    ? Object.fromEntries(Object.entries(receipt.validatedSourceHashes).sort(([a], [b]) => a.localeCompare(b))) : null;
  if (!recorded || computeV2312SourceHashDigest(actual) !== computeV2312SourceHashDigest(recorded)) {
    throw new Error('V2312_SOURCE_SEAL_MISMATCH');
  }
  for (const file of Object.keys(actual)) if (!SOURCE_FILES.includes(file)) throw new Error(`V2312_SOURCE_NOT_IN_ALLOWLIST:${file}`);
  for (const file of [...Object.keys(actual), RECEIPT, ...Object.values(RESULT_ARTIFACTS)]) {
    if (!fs.existsSync(path.join(rootDir, file))) throw new Error(`V2312_REQUIRED_ARTIFACT_MISSING:${file}`);
  }
  for (const artifactPath of Object.values(RESULT_ARTIFACTS)) {
    if (!changed.some(entry => entry.status === 'A' && entry.file === artifactPath)) {
      throw new Error(`V2312_RESULT_ARTIFACT_NOT_NEW:${artifactPath}`);
    }
  }
  const baselineReceipt = read(rootDir, 'docs/releases/v2.3.11-retained-validation.json');
  const baselineReceiptAtBase = git(rootDir, ['show', `${BASE}:docs/releases/v2.3.11-retained-validation.json`]);
  if (digest(baselineReceipt) !== digest(baselineReceiptAtBase)) throw new Error('V2312_V2311_RECEIPT_CHANGED');
  const packagePatchFunctions = packageManifest.appsScriptPatchFunctions;
  const astGuard = verifyV2312AppsScriptProtection({
    baseSource: git(rootDir, ['show', `${BASE}:Code.gs`]),
    currentSource: read(rootDir, 'Code.gs'),
    patchFunctions: packagePatchFunctions,
  });
  if (receipt.productionWrites !== false || receipt.realEmailsSent !== false) throw new Error('V2312_ISOLATION_EVIDENCE');

  const sourceHashDigest = computeV2312SourceHashDigest(actual);
  const artifacts = {};
  for (const scope of SCOPES) {
    const summary = receipt.validation?.[scope];
    if (!summary || summary.status !== 'passed' || !Number.isSafeInteger(summary.checks) || summary.checks < 1) {
      throw new Error(`V2312_REQUIRED_SCOPE_${scope}`);
    }
    artifacts[scope] = validateV2312ResultArtifact({
      scope, receiptResult: summary, artifactText: read(rootDir, RESULT_ARTIFACTS[scope]), sourceHashDigest,
    });
  }
  if (artifacts.browser.productionWrites !== false || artifacts.browser.realEmailsSent !== false) {
    throw new Error('V2312_BROWSER_ISOLATION');
  }
  if (artifacts.node.appsScriptProtection?.passed !== true
    || artifacts.node.appsScriptProtection.patchFunctionsDigest !== digest(JSON.stringify(packagePatchFunctions))
    || artifacts.node.appsScriptProtection.protectedFunctionCount !== astGuard.protectedFunctions
    || artifacts.node.appsScriptProtection.protectedSourceDigest !== astGuard.protectedSourceDigest) {
    throw new Error('V2312_NODE_APPS_SCRIPT_PROTECTION_EVIDENCE');
  }
  if (!Array.isArray(receipt.knownUnresolved) || !Array.isArray(artifacts.browser.knownUnresolved)) {
    throw new Error('V2312_UNRESOLVED_EVIDENCE_MISSING');
  }
  if (receipt.knownUnresolved.length !== artifacts.browser.knownUnresolved.length) {
    throw new Error('V2312_UNRESOLVED_EVIDENCE_COUNT_MISMATCH');
  }
  const knownByCase = new Map(receipt.knownUnresolved.map(entry => [entry.case, entry]));
  for (const entry of artifacts.browser.knownUnresolved) {
    const summary = knownByCase.get(entry.case);
    if (!summary || summary.status !== entry.status || summary.evidencePath !== entry.evidencePath
      || summary.evidenceSha256 !== entry.evidenceSha256) {
      throw new Error(`V2312_UNRESOLVED_EVIDENCE_MISMATCH:${entry.case}`);
    }
  }
  const retainedFailures = JSON.parse(read(rootDir, 'docs/releases/v2.3.11-validation/browser.json')).knownUnresolved;
  if (JSON.stringify(receipt.knownUnresolved) !== JSON.stringify(retainedFailures)) throw new Error('V2312_BASELINE_FAILURE_DISCLOSURE_CHANGED');
  if (artifacts.browser.fixtureAuthentication !== true || artifacts.browser.realAuthenticationVerified !== false
    || artifacts.browser.checks < 12 || !Array.isArray(artifacts.browser.appRenderMeasurements)
    || artifacts.browser.appRenderMeasurements.length !== 3) throw new Error('V2312_BROWSER_COVERAGE');
  const projects = new Set();
  for (const metric of artifacts.browser.appRenderMeasurements) {
    if (!['v2312-desktop-chromium','v2312-android-chromium','v2312-iphone-webkit'].includes(metric.project)
      || projects.has(metric.project) || metric.sourceRows !== 1000 || metric.mounted !== 100
      || !(Number.isFinite(metric.paintMs) && metric.paintMs >= 0 && metric.paintMs <= 400)) throw new Error('V2312_BROWSER_RENDER_GATE');
    projects.add(metric.project);
  }
  const protectedUiChanges = Object.keys(actual).filter(file => /^(components\/|hooks\/|services\/|v2\/src\/)/.test(file)
    && file !== 'v2/src/services/api.ts');
  if (protectedUiChanges.length) throw new Error('V2312_REACT_BASELINE_NOT_UNCHANGED');
  return {
    baseline: BASE,
    retainedNodePassed: 3550,
    retainedV2311FocusedNodeChecks: 229,
    retainedV2311ReactPassed: 158,
    changedPaths: Object.keys(actual),
    sourceHashDigest,
    appsScriptProtection: astGuard,
    validation: receipt.validation,
    knownUnresolved: receipt.knownUnresolved,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const output = process.argv.includes('--capture-source-hashes')
      ? computeV2312SourceHashes() : verifyV2312RetainedValidation();
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
