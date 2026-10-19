import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patchAppsScriptFunctions } from './apps-script-function-patch.mjs';

const BASE = '56d19543e1d1dee8ac0ad749b690b949af09a346';
const RECEIPT = 'docs/releases/v2.3.8-retained-validation.json';
const APPS_SCRIPT_PATCH_FUNCTIONS = Object.freeze([
  'buildSuspendTagApprovalEmail_',
  'handleSignedSuspendTagDelivery_',
]);
const V237_FOCUSED_NODE_FILES = Object.freeze([
  'tests/av-derived-rows.test.mjs',
  'tests/av-live-current-season.test.mjs',
  'tests/av-native-cache-hydration.test.mjs',
  'tests/av-sales-stock-visibility.test.mjs',
]);
const PENDING_ORDER_EVIDENCE = Object.freeze({
  runId: 37700127880,
  head: '2c127fcd81f68d3c4531dae04224a909784b1f58',
  job: 'pending-transactions',
  conclusion: 'success',
  inputHashes: Object.freeze({
    'supabase/tests/bloomscapes_pending_orders_test.sql': '4e101f0e5b1aafddc37a4a810cf8c8cd167707d946972bd0544fc414e0ab46d8',
    'supabase/ci/bloomscapes_pending_baseline.sql': 'b6788a1a6bc34b35b2019086a8eb39d6ccf63defc80f3da3e243373cd0efc2de',
    'supabase/ci/bloomscapes_pending_concurrency.mjs': 'e6215ab9e7ef43646e0e5acdac11ac5100f54daf8ca06bf571d0148d31efabd5',
  }),
  workflowHash: '72482b067c7d5b1a482980d4efb4f9fa05e361f07a18cc1aadc2811d5f5fd66f',
});
const LIVE_DATASET_EVIDENCE = Object.freeze({
  runId: 38309240953,
  head: '98dfa06c7c4266fb0ea09b0860e09a80392814d1',
  job: 'isolated-native-revisions',
  conclusion: 'success',
  inputHashes: Object.freeze({
    'docs/live-dataset-revisions.md': 'e68b3b845bdf56554994640f5b175544129a174b55e0d6fcebf64d464901a76d',
    'tests/transactions-keyed.test.mjs': '76c63fa01908820e38ea7aad0fca0fbccd0396f625f46e3c4916d34d48380488',
    'scripts/isolated-preview.mjs': '2b25ecc1d0fde6866216a78cba9b4583f76075b4000fd3d14102cf58361614e6',
    'scripts/check-isolated-preview.mjs': '6713b9e1e197652b2cfa774e5bb486456702b6becece40db957e06d9c248e86f',
  }),
  workflowHash: '66116bf44c6b8853c22ebff47df15a241af43bdb792f37c420ab8135304318cd',
});
const SOURCE_FILES = [
  '.github/workflows/apps-script-sync.yml',
  '.github/workflows/pr-validation.yml', '.github/workflows/release-database.yml',
  '.github/workflows/release-validation.yml',
  'Code.gs',
  'assets/ops-precision-pilot.css', 'assets/ops-precision-pilot.js', 'index.html',
  'manifest.json', 'package-lock.json', 'package.json', 'playwright.av-live-hydration.config.ts',
  'scripts/apply-item-low-stock-migration.mjs',
  'scripts/apps-script-function-patch.mjs', 'scripts/build-live-shell.mjs',
  'scripts/check-v238-retained-validation.mjs', 'scripts/ci-backend-matrix.mjs',
  'scripts/run-discovered-tests.mjs', 'scripts/run-release-react-checks.mjs',
  'scripts/run-release-unit-checks.mjs', 'scripts/sync-codegs-to-apps-script.js',
  'supabase/ci/suspend_tag_approval.mjs', 'supabase/ci/suspend_tag_sender_identity_pglite.mjs',
  'supabase/functions/_shared/suspend-tag.ts',
  'supabase/functions/request-delivery-worker/index.ts', 'supabase/functions/send-push-alert/index.ts',
  'supabase/migrations/20261019113414_suspend_tag_sender_identity.sql',
  'sw.js',
  'tests/apps-script-function-patch.test.mjs', 'tests/av-live-hydration.e2e.spec.ts',
  'tests/av-windowed-paint.test.mjs', 'tests/eval-report2-async-index.e2e.spec.ts',
  'tests/eval-report2-card-suppression.test.mjs', 'tests/suspend-tag-approval-delivery.test.mjs',
  'tests/suspend-tag-approval-email-vm.test.mjs',
  'tests/suspend-tag-compaction.e2e.spec.ts',
  'tests/suspend-tag-card-layout.test.mjs', 'tests/suspend-tag-completion.e2e.spec.ts',
  'tests/suspend-tag-migration-registration.test.mjs',
  'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
];
const ALLOWED = new Set([...SOURCE_FILES, RECEIPT]);
const RETAINED_BUNCH_SOURCE_FILES = [
  'assets/bunch-queue-shell.js', 'components/bunch-queue/QueueView.tsx',
  'components/bunch-queue/WorkCard.tsx', 'components/bunch-queue/bunch-queue.css',
  'services/bunchQueue.ts', 'tests/bunch-queue-shell.test.mjs', 'tests/bunch-queue-view.test.tsx',
];
const RETAINED_PYTHON_FILES = ['tests/test_sync_weather_hold_learning.py'];
const FOCUSED_NODE_FILES = [
  'tests/av-windowed-paint.test.mjs',
  'tests/eval-report2-card-suppression.test.mjs',
  'tests/suspend-tag-card-layout.test.mjs',
  'tests/suspend-tag-approval-delivery.test.mjs',
  'tests/suspend-tag-approval-email-vm.test.mjs',
  'tests/apps-script-function-patch.test.mjs',
  'tests/suspend-tag-migration-registration.test.mjs',
];
const FOCUSED_BROWSER_FILES = [
  'tests/av-live-hydration.e2e.spec.ts',
  'tests/eval-report2-async-index.e2e.spec.ts',
  'tests/suspend-tag-completion.e2e.spec.ts',
  'tests/suspend-tag-compaction.e2e.spec.ts',
];
const git = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
}).trim();
const gitRaw = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const digest = source => createHash('sha256').update(String(source).replaceAll('\r\n', '\n')).digest('hex');
function workflowJobBlock(source, jobName) {
  const normalized = String(source).replaceAll('\r\n', '\n');
  const marker = `  ${jobName}:\n`;
  const start = normalized.indexOf(marker);
  if (start < 0) throw new Error(`V238_BASELINE_JOB_MISSING:${jobName}`);
  const contentStart = start + marker.length;
  const tail = normalized.slice(contentStart);
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(tail);
  return normalized.slice(start, nextJob ? contentStart + nextJob.index : normalized.length)
    .replace(/^    needs: database-path-scope\n    if: needs\.database-path-scope\.outputs\.changed == 'true'\n/m, '');
}
function readWorkflowJob(rootDir, revision, file, jobName) {
  const source = gitRaw(rootDir, ['show', `${revision}:${file}`]);
  return workflowJobBlock(source, jobName);
}
function verifyRetainedBackendContract(rootDir, receiptEvidence, expected, workflowPath) {
  if (receiptEvidence?.runId !== expected.runId || receiptEvidence?.head !== expected.head
    || receiptEvidence?.job !== expected.job || receiptEvidence?.conclusion !== 'success'
    || JSON.stringify(receiptEvidence?.inputHashes) !== JSON.stringify(expected.inputHashes)) return false;
  for (const [file, hash] of Object.entries(expected.inputHashes)) {
    const current = digest(fs.readFileSync(path.join(rootDir, file), 'utf8'));
    const baseline = digest(gitRaw(rootDir, ['show', `${expected.head}:${file}`]));
    if (current !== hash || baseline !== hash) return false;
  }
  const baselineWorkflow = readWorkflowJob(rootDir, expected.head, workflowPath, expected.job);
  const currentWorkflow = workflowJobBlock(fs.readFileSync(path.join(rootDir, workflowPath), 'utf8'), expected.job);
  return digest(baselineWorkflow) === expected.workflowHash && digest(currentWorkflow) === expected.workflowHash;
}
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function computeV238SourceHashes({ rootDir = repositoryRoot } = {}) {
  return Object.fromEntries(SOURCE_FILES.map(file => [file, digest(fs.readFileSync(path.join(rootDir, file), 'utf8'))]));
}

export function computeV238RetainedSourceHashes({ rootDir = repositoryRoot } = {}) {
  const result = {};
  for (const file of [...RETAINED_BUNCH_SOURCE_FILES, ...RETAINED_PYTHON_FILES]) {
    result[file] = digest(gitRaw(rootDir, ['show', `${BASE}:${file}`]));
  }
  return result;
}

export function computeV238V237FocusedEvidence({ rootDir = repositoryRoot } = {}) {
  const v237 = JSON.parse(gitRaw(rootDir, ['show', `${BASE}:docs/releases/v2.3.7-retained-validation.json`]));
  const validatedSourceHashes = v237.validatedSourceHashes || {};
  const sourceHashesAtV238Base = Object.fromEntries(Object.keys(validatedSourceHashes).map(file => [
    file,
    digest(gitRaw(rootDir, ['show', `${BASE}:${file}`])),
  ]));
  return {
    passed: v237.targetedValidation?.node?.passed || 0,
    failed: v237.targetedValidation?.node?.failed || 0,
    stdoutSha256: '32858a4ff45ca7d87ea6d61a24cc3a782d4409dcd286efb39d8d3fbbee03135ba',
    progressSha256: 'd12851630174f01e3fe275b5097242f1045affed7b03185adce7e447ddf5973c',
    validatedSourceHashes,
    sourceHashesAtV238Base,
    sourceHashMatchesAtV238Base: Object.fromEntries(Object.keys(validatedSourceHashes).map(file => [
      file,
      validatedSourceHashes[file] === sourceHashesAtV238Base[file],
    ])),
  };
}

export function verifyV238RetainedBackendContracts({ rootDir = repositoryRoot } = {}) {
  const receipt = JSON.parse(fs.readFileSync(path.join(rootDir, RECEIPT), 'utf8'));
  const pendingOrder = verifyRetainedBackendContract(rootDir, receipt.backendContracts?.pendingOrder,
    PENDING_ORDER_EVIDENCE, '.github/workflows/bloomscapes-pending-tests.yml');
  const liveDataset = verifyRetainedBackendContract(rootDir, receipt.backendContracts?.liveDataset,
    LIVE_DATASET_EVIDENCE, '.github/workflows/live-dataset-revisions.yml');
  if (!pendingOrder || !liveDataset) throw new Error('V238_RETAINED_BACKEND_CONTRACT_EVIDENCE_INVALID');
  return {
    pendingOrder: { verified: true, runId: PENDING_ORDER_EVIDENCE.runId, head: PENDING_ORDER_EVIDENCE.head,
      job: PENDING_ORDER_EVIDENCE.job },
    liveDataset: { verified: true, runId: LIVE_DATASET_EVIDENCE.runId, head: LIVE_DATASET_EVIDENCE.head,
      job: LIVE_DATASET_EVIDENCE.job },
  };
}

function verifyV237FocusedBaseline(rootDir, receipt) {
  const v237 = JSON.parse(gitRaw(rootDir, ['show', `${BASE}:docs/releases/v2.3.7-retained-validation.json`]));
  const outcome = v237.targetedValidation?.node;
  if (outcome?.passed !== 45 || outcome?.failed !== 0
    || JSON.stringify(v237.focusedNodeFiles) !== JSON.stringify(V237_FOCUSED_NODE_FILES)) {
    throw new Error('V238_V237_FOCUSED_NODE_EVIDENCE_INVALID');
  }
  const validatedHashes = v237.validatedSourceHashes || {};
  const currentBaseHashes = Object.fromEntries(Object.keys(validatedHashes).map(file => [
    file,
    digest(gitRaw(rootDir, ['show', `${BASE}:${file}`])),
  ]));
  const sourceHashMatchesAtV238Base = Object.fromEntries(Object.keys(validatedHashes).map(file => [
    file,
    validatedHashes[file] === currentBaseHashes[file],
  ]));
  const evidence = receipt.v237FocusedNodeEvidence;
  if (evidence?.passed !== 45 || evidence?.failed !== 0
    || evidence?.stdoutSha256 !== '32858a4ff45ca7d87ea6d61a24cc3a782d4409dcd286efb39d8d3fbbee03135ba'
    || evidence?.progressSha256 !== 'd12851630174f01e3fe275b5097242f1045affed7b03185adce7e447ddf5973c'
    || JSON.stringify(evidence?.validatedSourceHashes) !== JSON.stringify(validatedHashes)
    || JSON.stringify(evidence?.sourceHashesAtV238Base) !== JSON.stringify(currentBaseHashes)
    || JSON.stringify(evidence?.sourceHashMatchesAtV238Base) !== JSON.stringify(sourceHashMatchesAtV238Base)) {
    throw new Error('V238_V237_FOCUSED_NODE_PROVENANCE_INVALID');
  }
  return {
    passed: 45,
    failed: 0,
    stdoutEvidence: '.gnc-local/v237-focused-unit-final.log',
    stdoutSha256: evidence.stdoutSha256,
    progressEvidence: '.gnc-local/v237-validation-progress.json',
    progressSha256: evidence.progressSha256,
    sourceHashMatchesAtV238Base,
    nonmatchingSourcesAtV238Base: Object.keys(sourceHashMatchesAtV238Base).filter(file => !sourceHashMatchesAtV238Base[file]),
  };
}

export function verifyV238RetainedValidation({ rootDir = repositoryRoot } = {}) {
  const receipt = JSON.parse(fs.readFileSync(path.join(rootDir, RECEIPT), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (pkg.version !== '2.3.8' || pkg.appsScriptRelease !== 'AgData v2.2.1'
    || JSON.stringify(pkg.appsScriptPatchFunctions) !== JSON.stringify(APPS_SCRIPT_PATCH_FUNCTIONS)
    || JSON.stringify(receipt.appsScriptPatchFunctions) !== JSON.stringify(APPS_SCRIPT_PATCH_FUNCTIONS)
    || receipt.schemaVersion !== 'agdata-v238-retained-validation-v1'
    || receipt.release !== 'AgData v2.3.8' || receipt.base !== BASE
    || receipt.baselineCiRun !== 39226551039 || receipt.baselinePagesRun !== 39226748483
    || receipt.retainedNode !== 3550 || receipt.retainedReact !== 158
    || receipt.retainedBunchShellPassed !== 2 || receipt.retainedBunchReactPassed !== 16
    || receipt.retainedV237FocusedNodePassed !== 45) {
    throw new Error('V238_RETAINED_IDENTITY_INVALID');
  }
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);
  const baseCode = gitRaw(rootDir, ['show', `${BASE}:Code.gs`]);
  const currentCode = fs.readFileSync(path.join(rootDir, 'Code.gs'), 'utf8');
  const protectedPatch = patchAppsScriptFunctions({
    remoteSource: baseCode,
    localSource: currentCode,
    functionNames: APPS_SCRIPT_PATCH_FUNCTIONS,
  });
  // Apps Script source may retain mixed LF/CRLF line endings after a scoped
  // editor update. The patch helper proves all non-allowlisted syntax nodes
  // are byte-preserved from BASE; compare the reconstructed source after EOL
  // normalization so line endings do not masquerade as extra Code.gs edits.
  if (protectedPatch.source.replaceAll('\r\n', '\n') !== currentCode.replaceAll('\r\n', '\n')) {
    throw new Error('V238_CODE_GS_SCOPE_INVALID');
  }

  const changed = new Set();
  for (const args of [
    ['diff', '--name-only', `${BASE}...HEAD`],
    ['diff', '--name-only', 'HEAD'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    git(rootDir, args).split('\n').filter(Boolean).forEach(file => changed.add(file.replaceAll('\\', '/')));
  }
  for (const file of changed) if (!ALLOWED.has(file)) throw new Error(`V238_UNEXPECTED_SCOPE:${file}`);

  const hashes = receipt.validatedSourceHashes;
  if (!hashes || typeof hashes !== 'object') throw new Error('V238_SOURCE_HASHES_MISSING');
  for (const file of SOURCE_FILES) {
    if (!hashes[file] || digest(fs.readFileSync(path.join(rootDir, file), 'utf8')) !== hashes[file]) {
      throw new Error(`V238_UNVALIDATED_SOURCE:${file}`);
    }
  }
  for (const file of Object.keys(hashes)) if (!SOURCE_FILES.includes(file)) {
    throw new Error(`V238_UNEXPECTED_SOURCE_HASH:${file}`);
  }

  const retainedHashes = receipt.retainedUnchangedSourceHashes;
  if (!retainedHashes || typeof retainedHashes !== 'object') throw new Error('V238_RETAINED_SOURCE_HASHES_MISSING');
  const retainedUnchanged = {};
  for (const file of [...RETAINED_BUNCH_SOURCE_FILES, ...RETAINED_PYTHON_FILES]) {
    const expected = digest(gitRaw(rootDir, ['show', `${BASE}:${file}`]));
    const actual = digest(fs.readFileSync(path.join(rootDir, file), 'utf8'));
    if (retainedHashes[file] !== expected || actual !== expected) {
      throw new Error(`V238_RETAINED_SOURCE_CHANGED:${file}`);
    }
    retainedUnchanged[file] = true;
  }
  for (const file of Object.keys(retainedHashes)) {
    if (![...RETAINED_BUNCH_SOURCE_FILES, ...RETAINED_PYTHON_FILES].includes(file)) {
      throw new Error(`V238_UNEXPECTED_RETAINED_SOURCE_HASH:${file}`);
    }
  }

  const focused = receipt.focusedNodeFiles;
  if (JSON.stringify(focused) !== JSON.stringify(FOCUSED_NODE_FILES)) throw new Error('V238_FOCUSED_NODE_SCOPE_INVALID');
  const focusedBrowser = FOCUSED_BROWSER_FILES;
  if (JSON.stringify(receipt.focusedBrowserFiles) !== JSON.stringify(focusedBrowser)) {
    throw new Error('V238_FOCUSED_BROWSER_SCOPE_INVALID');
  }
  const v237FocusedNodeEvidence = verifyV237FocusedBaseline(rootDir, receipt);
  const baselineContracts = receipt.baselineContracts;
  if (baselineContracts?.runId !== 39226551039 || baselineContracts?.conclusion !== 'success'
    || baselineContracts?.pythonContractsStep !== 'success' || baselineContracts?.reactJob !== 'success') {
    throw new Error('V238_BASELINE_CONTRACT_EVIDENCE_INVALID');
  }
  const backendContracts = verifyV238RetainedBackendContracts({ rootDir });
  const canRetainPendingOrderContract = backendContracts.pendingOrder.verified;
  const canRetainLiveDatasetContract = backendContracts.liveDataset.verified;
  return {
    baseline: BASE,
    retainedNodePassed: 3550,
    retainedReactPassed: 158,
    retainedBunchShellPassed: 2,
    retainedBunchReactPassed: 16,
    retainedV237FocusedNodePassed: 45,
    v237FocusedNodeEvidence,
    appsScriptPatchFunctions: [...APPS_SCRIPT_PATCH_FUNCTIONS],
    appsScriptCodeOutsideFunctionsUnchanged: true,
    retainedPythonContractFiles: RETAINED_PYTHON_FILES.length,
    retainedPythonContractUnchanged: true,
    baselineContractsRun: baselineContracts.runId,
    canRetainBunchReact: true,
    canRetainPendingOrderContract,
    pendingOrderRun: PENDING_ORDER_EVIDENCE.runId,
    canRetainLiveDatasetContract,
    liveDatasetRun: LIVE_DATASET_EVIDENCE.runId,
    focusedNodeFiles: [...FOCUSED_NODE_FILES],
    focusedBrowserFiles: [...focusedBrowser],
    fullSuitesRerun: false,
    changedPaths: [...changed].sort(),
    retainedUnchanged,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--capture-source-hashes') {
      console.log(JSON.stringify(computeV238SourceHashes(), null, 2));
    } else if (process.argv[2] === '--capture-retained-source-hashes') {
      console.log(JSON.stringify(computeV238RetainedSourceHashes(), null, 2));
    } else if (process.argv[2] === '--capture-v237-focused-evidence') {
      console.log(JSON.stringify(computeV238V237FocusedEvidence(), null, 2));
    } else if (process.argv[2] === '--verify-retained-backend-contracts') {
      console.log(JSON.stringify(verifyV238RetainedBackendContracts(), null, 2));
    } else {
      console.log(JSON.stringify(verifyV238RetainedValidation(), null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
