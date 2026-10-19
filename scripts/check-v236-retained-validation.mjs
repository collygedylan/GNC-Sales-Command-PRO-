import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = 'a8738c35a3ca4819fae6e005a481c57f1dfdd7ec';
const MARKERS = ['package.json', 'package-lock.json', 'index.html', 'manifest.json', 'sw.js', 'scripts/build-live-shell.mjs', 'v2/src/services/api.ts', 'v2/public/manifest.webmanifest', 'assets/ops-precision-pilot.js'];
const SOURCES = ['components/bunch-queue/WorkCard.tsx', 'components/bunch-queue/QueueView.tsx', 'components/bunch-queue/WorkCardDetail.tsx', 'components/bunch-queue/bunch-queue.css', 'assets/bunch-queue.js', 'assets/bunch-queue.css', 'assets/bunch-queue-shell.js', 'tests/bunch-queue-view.test.tsx', 'tests/bunch-queue.e2e.spec.ts', 'tests/bunch-queue-supervisor.e2e.spec.ts', 'scripts/check-v236-retained-validation.mjs', 'scripts/run-release-unit-checks.mjs', 'scripts/run-release-react-checks.mjs', 'docs/releases/v2.3.6-retained-validation.json'];
const REQUIRED = ['components/bunch-queue/WorkCard.tsx', 'components/bunch-queue/QueueView.tsx', 'components/bunch-queue/bunch-queue.css', 'assets/bunch-queue-shell.js', 'tests/bunch-queue-view.test.tsx', 'tests/bunch-queue.e2e.spec.ts', 'scripts/check-v236-retained-validation.mjs', 'docs/releases/v2.3.6-retained-validation.json'];
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const normalize = (source, version) => source.replaceAll('\r\n', '\n').trim().replaceAll(`AgData v${version}`, '__RELEASE__').replaceAll(encodeURIComponent(`AgData v${version}`), '__ENCODED_RELEASE__');

export function verifyV236RetainedValidation({ rootDir = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  const read = file => fs.readFileSync(path.join(rootDir, file), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const receipt = JSON.parse(read('docs/releases/v2.3.6-retained-validation.json'));
  if (pkg.version !== '2.3.6' || pkg.appsScriptRelease !== 'AgData v2.2.1'
    || receipt.base !== BASE || receipt.release !== 'AgData v2.3.6'
    || receipt.baselinePagesRun !== 39193074267 || receipt.baselineCiRun !== 39192936119
    || receipt.retainedNode !== 3550 || receipt.retainedReact !== 158
    || receipt.focusedReactFile !== 'tests/bunch-queue-view.test.tsx') throw new Error('V236_RETAINED_IDENTITY_INVALID');
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);
  const changed = new Set();
  for (const args of [['diff', '--name-only', `${BASE}...HEAD`], ['diff', '--name-only', 'HEAD'], ['ls-files', '--others', '--exclude-standard']]) {
    git(rootDir, args).split('\n').filter(Boolean).forEach(file => changed.add(file.replaceAll('\\', '/')));
  }
  const allowed = new Set([...MARKERS, ...SOURCES]);
  for (const file of changed) if (!allowed.has(file)) throw new Error(`V236_UNEXPECTED_SCOPE:${file}`);
  for (const file of REQUIRED) if (!changed.has(file)) throw new Error(`V236_REQUIRED_SCOPE_MISSING:${file}`);
  for (const file of MARKERS) {
    const before = git(rootDir, ['show', `${BASE}:${file}`]);
    let after = read(file);
    if (file === 'package.json' || file === 'package-lock.json') {
      const original = JSON.parse(before), next = JSON.parse(after);
      if (original.version !== '2.3.5' || next.version !== '2.3.6') throw new Error(`V236_VERSION_INVALID:${file}`);
      original.version = next.version = '__VERSION__';
      if (file === 'package-lock.json') {
        if (original.packages[''].version !== '2.3.5' || next.packages[''].version !== '2.3.6') throw new Error('V236_LOCK_VERSION_INVALID');
        original.packages[''].version = next.packages[''].version = '__VERSION__';
      }
      if (JSON.stringify(original) !== JSON.stringify(next)) throw new Error(`V236_UNRELATED_PACKAGE_CHANGE:${file}`);
      continue;
    }
    // These are the only inline changes: route the shared detail shell's Back,
    // navigation and legacy rendering through the Bunch detail owner.
    if (file === 'index.html') after = after.replaceAll('\r\n', '\n')
      .replace('./assets/bunch-queue-shell.js?v=AgData%20v2.3.6', './assets/bunch-queue-shell.js')
      .replace('./assets/bunch-queue.css?v=AgData%20v2.3.6', './assets/bunch-queue.css')
      .replace("            if (safeViewId !== 'detail') window.BunchQueueShell?.closeDetail();\n", '')
      .replace("            if (window.BunchQueueShell?.isDetailOpen()) return 'request';\n", '')
      .replace('            if (window.BunchQueueShell?.isDetailOpen()) return;\n', '')
      .replace("            if (viewId !== 'request' && !(viewId === 'detail' && window.BunchQueueShell?.isDetailOpen())) window.BunchQueueShell?.destroy();", "            if (viewId !== 'request') window.BunchQueueShell?.destroy();")
      .replace('            if (window.BunchQueueShell?.closeDetail()) return false;\n', '');
    if (file === 'sw.js') after = after.replaceAll('\r\n', '\n')
      .replace("  './assets/bunch-queue-shell.js?v=' + encodeURIComponent(APP_SHELL_BUILD),\n", '')
      .replace("  './assets/bunch-queue.js?v=' + encodeURIComponent(APP_SHELL_BUILD),\n", '')
      .replace("  './assets/bunch-queue.css?v=' + encodeURIComponent(APP_SHELL_BUILD),\n", '');
    if (normalize(before, '2.3.5') !== normalize(after, '2.3.6')) throw new Error(`V236_UNRELATED_RELEASE_FILE_CHANGE:${file}`);
  }
  // Retained receipts remain immutable; their source and exact run references
  // can be followed back to the last full baseline instead of rerunning it.
  const previousReceipt = 'docs/releases/v2.3.5-retained-validation.json';
  if (read(previousReceipt).trim().replaceAll('\r\n', '\n') !== git(rootDir, ['show', `${BASE}:${previousReceipt}`]).replaceAll('\r\n', '\n')) throw new Error('V236_BASELINE_RECEIPT_CHANGED');
  return { baseline: BASE, retainedNodePassed: 3550, retainedReactPassed: 158, focusedReactFile: receipt.focusedReactFile, fullSuitesRerun: false, changedPaths: [...changed].sort() };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(verifyV236RetainedValidation(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
