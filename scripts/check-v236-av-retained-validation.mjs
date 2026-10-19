import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = '5d89883c4031e6c56e3134bc7fbb6bd18b4fbc92';
const RECEIPT = 'docs/releases/v2.3.6-av-retained-validation.json';
const ALLOWED = new Set(['index.html', 'sw.js', 'assets/bunch-queue-shell.js', 'tests/bunch-queue-shell.test.mjs', 'tests/bunch-queue.e2e.spec.ts', 'tests/av-sales-stock-visibility.test.mjs',
  'tests/av-sales-stock-visibility.e2e.spec.ts', 'playwright.av-sales-stock.config.ts',
  'scripts/check-v236-av-retained-validation.mjs', 'scripts/run-release-unit-checks.mjs',
  'scripts/run-release-react-checks.mjs', RECEIPT]);
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const digest = source => createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');

export function verifyV236AvRetainedValidation({ rootDir = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  const read = file => fs.readFileSync(path.join(rootDir, file), 'utf8');
  const receipt = JSON.parse(read(RECEIPT));
  const pkg = JSON.parse(read('package.json'));
  if (pkg.version !== '2.3.6' || pkg.appsScriptRelease !== 'AgData v2.2.1'
    || receipt.base !== BASE || receipt.release !== 'AgData v2.3.6'
    || receipt.baselineCiRun !== 39200170986 || receipt.baselinePagesRun !== 39200394092
    || receipt.retainedNode !== 3550 || receipt.retainedReact !== 158) throw new Error('V236_AV_RETAINED_IDENTITY_INVALID');
  git(rootDir, ['merge-base', '--is-ancestor', BASE, 'HEAD']);
  const changed = new Set();
  for (const args of [['diff', '--name-only', `${BASE}...HEAD`], ['diff', '--name-only', 'HEAD'], ['ls-files', '--others', '--exclude-standard']]) {
    git(rootDir, args).split('\n').filter(Boolean).forEach(file => changed.add(file.replaceAll('\\', '/')));
  }
  for (const file of changed) if (!ALLOWED.has(file)) throw new Error(`V236_AV_UNEXPECTED_SCOPE:${file}`);
  for (const file of ['index.html', 'sw.js', 'assets/bunch-queue-shell.js', 'tests/bunch-queue-shell.test.mjs', 'tests/bunch-queue.e2e.spec.ts', 'tests/av-sales-stock-visibility.test.mjs', 'tests/av-sales-stock-visibility.e2e.spec.ts']) {
    if (!changed.has(file) || digest(read(file)) !== receipt.validatedSourceHashes[file]) throw new Error(`V236_AV_UNVALIDATED_SOURCE:${file}`);
  }
  const swBefore = git(rootDir, ['show', `${BASE}:sw.js`]).replaceAll('\r\n', '\n');
  const swAfter = read('sw.js').trim().replaceAll('\r\n', '\n').replace("'-scope-r1-lists-r1-av-stock-r2';", "'-scope-r1-lists-r1';");
  if (swBefore !== swAfter) throw new Error('V236_AV_UNRELATED_SERVICE_WORKER_CHANGE');
  // Bunch service/components, the backend and older receipts are outside ALLOWED.
  // The shell Request-return policy and focused browser fixture have their own source hashes.
  return { baseline: BASE, retainedNodePassed: 3550, retainedReactPassed: 158,
    focusedNodeFiles: ['tests/av-sales-stock-visibility.test.mjs', 'tests/bunch-queue-shell.test.mjs'], focusedReactFile: 'tests/bunch-queue-view.test.tsx',
    fullSuitesRerun: false, changedPaths: [...changed].sort() };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(verifyV236AvRetainedValidation(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
