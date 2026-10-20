// Scoped release evidence: changed behavior is tested, unaffected suites are retained.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';

export const V2314_BASE = 'ebe5547b11fb415ef83b3f2891973776c5b4d682';
const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = 'docs/releases/v2.3.14-retained-validation.json';
const evidencePrefix = 'docs/releases/v2.3.14-validation/';
const hash = value => createHash('sha256').update(String(value).replaceAll('\r\n', '\n')).digest('hex');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function captureV2314Sources({ rootDir = rootDefault } = {}) {
  const files = [...new Set([
    ...git(rootDir, ['diff', '--name-only', '--no-renames', '-z', V2314_BASE]).split('\0'),
    ...git(rootDir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(file => file && file !== receiptPath && !file.startsWith(evidencePrefix)))].sort();
  return Object.fromEntries(files.map(file => [file, file.endsWith('.gz')
    ? createHash('sha256').update(fs.readFileSync(path.join(rootDir, file))).digest('hex')
    : hash(read(rootDir, file))]));
}

function scriptParts(source) {
  return parse(source, { ecmaVersion: 'latest', sourceType: 'script' }).body.map(node => ({
    name: node.type === 'FunctionDeclaration' ? node.id.name : null,
    source: source.slice(node.start, node.end).replaceAll('\r\n', '\n'),
  }));
}

export function verifyV2314RetainedValidation({ rootDir = rootDefault } = {}) {
  git(rootDir, ['merge-base', '--is-ancestor', V2314_BASE, 'HEAD']);
  const pkg = JSON.parse(read(rootDir, 'package.json'));
  const receipt = JSON.parse(read(rootDir, receiptPath));
  if (pkg.version !== '2.3.14' || receipt.base !== V2314_BASE || receipt.release !== 'AgData v2.3.14'
    || receipt.schemaVersion !== 'agdata-v2314-scoped-validation-v1') throw new Error('V2314_IDENTITY');
  const sources = captureV2314Sources({ rootDir });
  if (JSON.stringify(sources) !== JSON.stringify(receipt.sourceHashes)) throw new Error('V2314_SOURCE_SEAL_MISMATCH');
  const sourceDigest = hash(JSON.stringify(sources));
  const before = scriptParts(git(rootDir, ['show', `${V2314_BASE}:Code.gs`]));
  const after = scriptParts(read(rootDir, 'Code.gs'));
  const permitted = new Set(receipt.appsScriptChangedFunctions || []);
  if ([...permitted].some(name => /history|backfill|trigger|schedule|^doGet$|^doPost$/i.test(name))) throw new Error('V2314_PROTECTED_SCRIPT_SCOPE');
  if (JSON.stringify(before.filter(node => !permitted.has(node.name))) !== JSON.stringify(after.filter(node => !permitted.has(node.name)))) throw new Error('V2314_PROTECTED_SCRIPT_CHANGED');
  for (const name of permitted) if (after.filter(node => node.name === name).length !== 1
    || !pkg.appsScriptPatchFunctions.includes(name)) throw new Error('V2314_SCRIPT_PATCH_NOT_REGISTERED');
  const baselineReceipt = 'docs/releases/v2.3.13-retained-validation.json';
  if (hash(read(rootDir, baselineReceipt)) !== hash(git(rootDir, ['show', `${V2314_BASE}:${baselineReceipt}`]))) throw new Error('V2314_PRIOR_EVIDENCE_CHANGED');
  const evidence = {};
  for (const [file, digest] of Object.entries(receipt.evidenceHashes || {})) {
    const text = read(rootDir, file);
    const result = JSON.parse(text);
    if (!file.startsWith(evidencePrefix) || hash(text) !== digest || result.status !== 'passed'
      || result.sourceDigest !== sourceDigest || result.productionWrites !== false
      || result.realEmailsSent !== false || !result.capturedAt) throw new Error(`V2314_EVIDENCE_INVALID:${file}`);
    evidence[result.kind] = result;
  }
  if (!(evidence.unit?.passed > 0) || evidence.unit.failed !== 0
    || !evidence.tooling || !evidence.browser || !evidence.database) throw new Error('V2314_REQUIRED_EVIDENCE');
  if (!Array.isArray(evidence.browser.results) || evidence.browser.results.length < 2
    || evidence.browser.results.some(result => result.renderMs > 400 || result.renderMs < 0
      || result.cards !== result.expectedCards || result.masterRows < 9000
      || result.sorted !== true || result.metricsVerified !== true)) throw new Error('V2314_BROWSER_EVIDENCE');
  if (!(evidence.database.assertions > 0) || evidence.database.disposable !== true) throw new Error('V2314_DISPOSABLE_EVIDENCE');
  return { sourceDigest, changedPaths: Object.keys(sources), evidence, appsScriptChangedFunctions: [...permitted] };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(process.argv.includes('--capture-source-hashes') ? captureV2314Sources() : verifyV2314RetainedValidation(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
