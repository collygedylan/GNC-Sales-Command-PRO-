// Source-sealed evidence for the authorized single-pass v2.3.11 release.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = 'f3bb57f2d77524617bce1502efd75a207b19bac7';
const RECEIPT = 'docs/releases/v2.3.11-retained-validation.json';
const RESULT_DIR = 'docs/releases/v2.3.11-validation';
const SCOPES = Object.freeze(['node', 'database', 'browser', 'tooling', 'build']);
const SOURCE_FILES = Object.freeze([
  'AGENTS.md', '.github/workflows/apps-script-sync.yml', '.github/workflows/publish-candidate.yml', '.github/workflows/release-database.yml',
  'Code.gs', 'assets/live-sync-coordinator.js', 'assets/ops-precision-pilot.css', 'deno.lock',
  'assets/ops-precision-pilot.js', 'assets/user-access-control.css', 'assets/user-access-control.js',
  'index.html', 'manifest.json', 'assets/live-tailwind-v2026082010.min.css', 'package-lock.json', 'package.json',
  'playwright.v2311-frontend-smoke.config.ts', 'playwright.v2311-scoped.config.ts',
  'scripts/apply-item-low-stock-migration.mjs', 'scripts/apps-script-function-patch.mjs',
  'scripts/build-live-shell.mjs', 'scripts/check-v2311-retained-validation.mjs',
  'scripts/ci-backend-matrix.mjs', 'scripts/run-discovered-tests.mjs',
  'scripts/database-workspace.mjs',
  'scripts/run-release-react-checks.mjs', 'scripts/run-release-unit-checks.mjs',
  'scripts/verify-live-av-sales-reps.mjs', 'scripts/verify-v2311-database.mjs',
  'services/database-contracts.generated.ts', 'supabase/functions/_shared/canonical-user-access.ts',
  'supabase/functions/_shared/database.types.ts', 'supabase/functions/_shared/production-workflow.ts',
  'supabase/functions/app-api/index.ts', 'supabase/functions/request-delivery-worker/index.ts',
  'supabase/migrations/20261019163128_canonical_user_access_control_v1.sql',
  'supabase/migrations/20261019172019_inventory_reclass_move_delivery_v1.sql',
  'supabase/ci/v2311_suspend_recipient_cleanup.sql', 'supabase/ci/v2311_suspend_recipient_prerequisites.sql',
  'supabase/tests/inventory_reclass_move_delivery_v1_test.sql',
  'supabase/tests/inventory_reclass_moves_v1_test.sql', 'supabase/tests/user_access_control_v1_test.sql',
  'sw.js', 'tests/access-control-audit.test.mjs', 'tests/apps-script-function-patch.test.mjs', 'tests/av-derived-rows.test.mjs', 'tests/bloom-picker-metrics.test.mjs',
  'tests/fixtures/hl-order-state.mjs', 'tests/fixtures/v2311-canonical-access.mjs', 'tests/helpers/customer-mapping-fixture.mjs',
  'tests/inventory-card-location-on-hand.test.mjs', 'tests/item-detail-shared-options.test.mjs',
  'tests/database-tooling.test.mjs', 'tests/eval-report2-async-index.e2e.spec.ts',
  'tests/live-sync-coordinator.test.mjs', 'tests/reclass-completion-delivery.test.mjs',
  'tests/reclass-move-api.test.mjs', 'tests/reclass-confirmed-live-edit.test.mjs', 'tests/reclass-live-edits.test.mjs', 'tests/reclass-inquiry.test.mjs', 'tests/reclass-pdf-layout.browser.test.mjs', 'tests/reclass-inquiry-compact-layout.test.mjs', 'tests/reclass-inquiry-compact-layout.e2e.spec.ts', 'tests/helpers/reclass-pdf-fixture.mjs', 'tests/reclass-shared-receipt.test.mjs',
  'tests/release-drive-card-layout.test.mjs', 'tests/release-publish-candidate.test.mjs', 'tests/request-mapping-reader.test.mjs',
  'tests/retained-view-status.test.mjs', 'tests/suspend-tag-card-layout.test.mjs',
  'tests/suspend-tag-completion.e2e.spec.ts', 'tests/suspend-tag-completion.test.mjs',
  'tests/user-access-control.test.mjs', 'tests/user-access-integration.test.mjs',
  'tests/v2311-frontend-smoke.e2e.spec.ts', 'tests/v2311-release-gates.test.mjs',
  'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
]);
const RESULT_ARTIFACTS = Object.freeze(Object.fromEntries(SCOPES.map(scope => [scope, `${RESULT_DIR}/${scope}.json`])));
const ALLOWED_PATHS = new Set([...SOURCE_FILES, RECEIPT, ...Object.values(RESULT_ARTIFACTS)]);
const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(String(value).replaceAll('\r\n', '\n')).digest('hex');
const digestBytes = value => createHash('sha256').update(value).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

function currentChangedPathEntries(rootDir) {
  const tracked = git(rootDir, ['diff', '--name-status', '-z', '--no-renames', BASE]).split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tracked.length;) {
    const status = tracked[index++];
    const file = tracked[index++];
    if (!status || !file || !/^[AM]$/.test(status)) throw new Error('V2311_GIT_CHANGE_STATUS_INVALID');
    entries.push({ status, file });
  }
  const untracked = git(rootDir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const file of untracked) entries.push({ status: 'A', file });
  return entries;
}

export function assertV2311AuthorizedPaths(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const file = String(entry?.file || '');
    const status = String(entry?.status || '');
    if (status === 'D') throw new Error(`V2311_DELETION_FORBIDDEN:${file}`);
    if (!['A', 'M'].includes(status)) throw new Error(`V2311_CHANGE_STATUS_FORBIDDEN:${file}`);
    if (!ALLOWED_PATHS.has(file)) throw new Error(`V2311_UNAUTHORIZED_SOURCE_PATH:${file}`);
    if (seen.has(file)) throw new Error(`V2311_DUPLICATE_SOURCE_PATH:${file}`);
    seen.add(file);
  }
  return seen;
}

export function computeV2311SourceHashDigest(hashes) {
  const canonical = Object.fromEntries(Object.entries(hashes || {}).sort(([left], [right]) => left.localeCompare(right)));
  return digest(JSON.stringify(canonical));
}

export function validateV2311ResultArtifact({ scope, receiptResult, artifactText, sourceHashDigest }) {
  const artifactPath = RESULT_ARTIFACTS[scope];
  if (!artifactPath || receiptResult?.artifactPath !== artifactPath) throw new Error(`V2311_RESULT_PATH_INVALID:${scope}`);
  const exactHash = digestBytes(Buffer.from(String(artifactText), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(receiptResult?.artifactSha256 || '') || receiptResult.artifactSha256 !== exactHash) {
    throw new Error(`V2311_RESULT_HASH_MISMATCH:${scope}`);
  }
  let artifact;
  try { artifact = JSON.parse(String(artifactText)); }
  catch { throw new Error(`V2311_RESULT_JSON_INVALID:${scope}`); }
  if (artifact?.schemaVersion !== 'agdata-v2311-validation-result-v1'
    || artifact.scope !== scope || artifact.status !== 'passed'
    || typeof artifact.validationId !== 'string' || !artifact.validationId.trim()
    || !Number.isSafeInteger(artifact.checks) || artifact.checks < 1
    || artifact.sourceHashDigest !== sourceHashDigest
    || receiptResult.validationId !== artifact.validationId
    || receiptResult.status !== artifact.status || receiptResult.checks !== artifact.checks
    || receiptResult.sourceHashDigest !== artifact.sourceHashDigest) {
    throw new Error(`V2311_RESULT_CONTRACT_INVALID:${scope}`);
  }
  return artifact;
}

export function computeV2311SourceHashes({ rootDir = rootDefault } = {}) {
  const changed = assertV2311AuthorizedPaths(currentChangedPathEntries(rootDir));
  const files = [...changed].filter(file => file !== RECEIPT && !Object.values(RESULT_ARTIFACTS).includes(file)).sort();
  return Object.fromEntries(files.map(file => [file, digest(read(rootDir, file))]));
}

export function verifyV2311RetainedValidation({ rootDir = rootDefault } = {}) {
  const receipt = JSON.parse(read(rootDir, RECEIPT));
  if (JSON.parse(read(rootDir, 'package.json')).version !== '2.3.11'
    || receipt.schemaVersion !== 'agdata-v2311-scoped-validation-v1' || receipt.base !== BASE) throw Error('V2311_RECEIPT_IDENTITY');
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);
  const changedEntries = currentChangedPathEntries(rootDir);
  assertV2311AuthorizedPaths(changedEntries);
  const actual = computeV2311SourceHashes({ rootDir });
  const receiptHashes = receipt.validatedSourceHashes && typeof receipt.validatedSourceHashes === 'object'
    ? Object.fromEntries(Object.entries(receipt.validatedSourceHashes).sort(([left], [right]) => left.localeCompare(right))) : null;
  if (!receiptHashes || computeV2311SourceHashDigest(actual) !== computeV2311SourceHashDigest(receiptHashes)) throw Error('V2311_SOURCE_SEAL_MISMATCH');
  const requiredSources = [
    'assets/user-access-control.js', 'supabase/functions/app-api/index.ts',
    'supabase/migrations/20261019163128_canonical_user_access_control_v1.sql',
    'supabase/migrations/20261019172019_inventory_reclass_move_delivery_v1.sql',
  ];
  for (const source of requiredSources) if (!Object.hasOwn(actual, source)) throw Error(`V2311_REQUIRED_SOURCE_MISSING:${source}`);
  const requiredPaths = new Set([...Object.keys(actual), RECEIPT, ...Object.values(RESULT_ARTIFACTS)]);
  for (const file of requiredPaths) if (!fs.existsSync(path.join(rootDir, file))) throw Error(`V2311_REQUIRED_ARTIFACT_MISSING:${file}`);
  for (const file of Object.keys(actual)) if (!SOURCE_FILES.includes(file)) throw Error(`V2311_SOURCE_NOT_IN_ALLOWLIST:${file}`);
  for (const resultPath of Object.values(RESULT_ARTIFACTS)) if (!changedEntries.some(entry => entry.file === resultPath && entry.status === 'A')) {
    throw Error(`V2311_RESULT_ARTIFACT_NOT_NEW:${resultPath}`);
  }
  const prior = read(rootDir, 'docs/releases/v2.3.10-retained-validation.json');
  if (digest(prior) !== digest(git(rootDir, ['show', `${BASE}:docs/releases/v2.3.10-retained-validation.json`]))) throw Error('V2311_BASELINE_RECEIPT_CHANGED');
  if (receipt.productionWrites !== false || receipt.realEmailsSent !== false || receipt.fixtureAuthentication !== true) throw Error('V2311_ISOLATION_EVIDENCE');

  const sourceHashDigest = computeV2311SourceHashDigest(actual);
  const artifacts = {};
  for (const scope of SCOPES) {
    const result = receipt.validation?.[scope];
    if (!result || result.status !== 'passed' || !(result.checks > 0)) throw Error(`V2311_REQUIRED_SCOPE_${scope}`);
    artifacts[scope] = validateV2311ResultArtifact({
      scope, receiptResult: result,
      artifactText: read(rootDir, RESULT_ARTIFACTS[scope]), sourceHashDigest,
    });
  }
  if (artifacts.database.disposable !== true || !(artifacts.database.interactiveMaxMs >= 0 && artifacts.database.interactiveMaxMs < 100)
    || artifacts.database.interactiveMaxMs !== receipt.validation.database.interactiveMaxMs) throw Error('V2311_DATABASE_GATE');
  if (artifacts.browser.productionWrites !== false || artifacts.browser.realEmailsSent !== false
    || artifacts.browser.fixtureAuthentication !== true || artifacts.browser.realAuthenticationVerified !== false
    || artifacts.browser.optimisticMaxMs !== receipt.browser.optimisticMaxMs
    || artifacts.browser.eval2MaxMs !== receipt.browser.eval2MaxMs) throw Error('V2311_BROWSER_ARTIFACT_ISOLATION');
  const completeTagIphone = artifacts.browser.completeTagIphone;
  const completeTagSummary = receipt.browser?.completeTagIphone;
  if (!completeTagIphone || !completeTagSummary
    || completeTagIphone.status !== 'passed' || completeTagSummary.status !== 'passed'
    || completeTagIphone.project !== 'v2311-iphone-webkit' || completeTagSummary.project !== completeTagIphone.project
    || completeTagIphone.rows !== 1000 || completeTagSummary.rows !== completeTagIphone.rows
    || !(Number.isFinite(completeTagIphone.domMs) && completeTagIphone.domMs >= 0 && completeTagIphone.domMs < 50)
    || completeTagSummary.domMs !== completeTagIphone.domMs
    || !(Number.isFinite(completeTagIphone.paintMs) && completeTagIphone.paintMs >= 0 && completeTagIphone.paintMs < 350)
    || completeTagSummary.paintMs !== completeTagIphone.paintMs
    || completeTagIphone.noModalOpened !== true || completeTagSummary.noModalOpened !== true
    || completeTagIphone.rowRemoved !== true || completeTagSummary.rowRemoved !== true
    || completeTagIphone.backingCountAfter !== 999 || completeTagSummary.backingCountAfter !== 999
    || completeTagIphone.displayCountAfter !== '99+' || completeTagSummary.displayCountAfter !== '99+'
    || completeTagIphone.backendAcknowledgmentHeld !== true || completeTagSummary.backendAcknowledgmentHeld !== true
    || completeTagIphone.trace !== 'off' || completeTagSummary.trace !== 'off') {
    throw Error('V2311_IPHONE_COMPLETE_TAG_GATE');
  }
  const unresolved = artifacts.browser.knownUnresolved;
  const requiredKnownFailures = ['hs-iphone', 'av-iphone'];
  if (!Array.isArray(unresolved) || !Array.isArray(receipt.browser?.knownUnresolved)
    || requiredKnownFailures.some(key => {
      const artifactEntry = unresolved.find(entry => entry.case === key);
      const receiptEntry = receipt.browser.knownUnresolved.find(entry => entry.case === key);
      return !artifactEntry || !receiptEntry || artifactEntry.status !== 'unresolved'
        || receiptEntry.status !== 'unresolved' || artifactEntry.evidencePath !== receiptEntry.evidencePath;
    })) throw Error('V2311_KNOWN_BROWSER_FAILURES_NOT_RETAINED');
  for (const username of ['annette_hancock', 'toby_brown']) {
    const result = artifacts.browser.salesReps?.find(row => row.username === username);
    const summary = receipt.browser?.salesReps?.find(row => row.username === username);
    if (!result || !summary || result.status !== summary.status || result.actualRows !== summary.actualRows
      || result.expectedRows !== summary.expectedRows || result.initialWindowPaintMs !== summary.initialWindowPaintMs
      || result.loadingCleared !== summary.loadingCleared) throw Error('V2311_BROWSER_ARTIFACT_MISMATCH_' + username);
  }
  const reps = receipt.browser?.salesReps || [];
  for (const username of ['annette_hancock', 'toby_brown']) {
    const result = reps.find(r => r.username === username);
    if (!result || result.status !== 'passed' || result.actualRows !== result.expectedRows || result.actualRows <= 5
      || !(result.initialWindowPaintMs >= 0 && result.initialWindowPaintMs < 1500) || !result.loadingCleared) throw Error('V2311_REP_GATE_' + username);
  }
  if (!(receipt.browser.optimisticMaxMs >= 0 && receipt.browser.optimisticMaxMs < 50)
    || !(receipt.browser.eval2MaxMs >= 0 && receipt.browser.eval2MaxMs < 300)) throw Error('V2311_INTERACTION_GATE');
  const protectedChanges = Object.keys(actual).filter(f => /^(components\/|hooks\/|services\/|v2\/src\/)/.test(f)
    && !['v2/src/services/api.ts', 'services/database-contracts.generated.ts'].includes(f));
  if (protectedChanges.length) throw Error('V2311_RETAINED_REACT_SCOPE_CHANGED');
  return {
    baseline: BASE, retainedReactPassed: 158, retainedNodePassed: 3550,
    scoped: receipt.validation, changedPaths: Object.keys(actual),
    completeTagIphone: { ...completeTagIphone },
    knownUnresolved: receipt.knownUnresolved || [],
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(process.argv.includes('--capture-source-hashes') ? computeV2311SourceHashes() : verifyV2311RetainedValidation(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
