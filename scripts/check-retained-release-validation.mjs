import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { normalizeRelease } from './deployment-fingerprint-lib.mjs';
import { generatedBuildOutput } from './local-validation-evidence.mjs';

const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const textHash = value => hash(Buffer.from(String(value).replaceAll('\r\n', '\n')));
const textExtensions = new Set(['.cjs', '.css', '.csv', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.ps1', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml']);
export const hashScopedFile = (file, bytes) => textExtensions.has(path.extname(file).toLowerCase())
  ? textHash(Buffer.from(bytes).toString('utf8'))
  : hash(bytes);
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function validateReceiptPath(value) {
  const file = String(value || '').replaceAll('\\', '/');
  if (!/^docs\/releases\/[a-z0-9.-]+-retained-validation\.json$/i.test(file)) throw new Error('SCOPED_RECEIPT_PATH_INVALID');
  return file;
}

export function captureScopedReleaseSources({ rootDir = rootDefault, base, receiptPath, evidencePrefix } = {}) {
  if (!/^[a-f0-9]{40}$/i.test(String(base || ''))) throw new Error('SCOPED_BASE_COMMIT_INVALID');
  const excludedReceipt = validateReceiptPath(receiptPath);
  const prefix = String(evidencePrefix || '').replaceAll('\\', '/');
  if (!/^docs\/releases\/[a-z0-9.-]+-validation\/$/i.test(prefix)) throw new Error('SCOPED_EVIDENCE_PREFIX_INVALID');
  const changed = [
    ...git(rootDir, ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`]).split('\0'),
    ...git(rootDir, ['diff', '--name-only', '--no-renames', '-z', base]).split('\0'),
    ...git(rootDir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(file => file && file !== excludedReceipt && !file.replaceAll('\\', '/').startsWith(prefix));
  return Object.fromEntries([...new Set(changed)].sort().map(file => {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) return [file, 'deleted'];
    if (!fs.lstatSync(absolute).isFile()) throw new Error(`SCOPED_SOURCE_FILE_INVALID:${file}`);
    const normalizedPath = file.replaceAll('\\', '/');
    return [normalizedPath, hashScopedFile(normalizedPath, fs.readFileSync(absolute))];
  }));
}

export function scopedSourceDigest({ rootDir = rootDefault, receiptPath, evidencePrefix } = {}) {
  const excludedReceipt = validateReceiptPath(receiptPath);
  const prefix = String(evidencePrefix || '').replaceAll('\\', '/');
  if (!/^docs\/releases\/[a-z0-9.-]+-validation\/$/i.test(prefix)) throw new Error('SCOPED_EVIDENCE_PREFIX_INVALID');
  const files = git(rootDir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/'))
    .filter(file => file !== excludedReceipt && !file.startsWith(prefix) && !generatedBuildOutput(file));
  const digest = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    const absolute = path.join(rootDir, file);
    digest.update(file + '\0');
    if (!fs.existsSync(absolute)) { digest.update('deleted\0'); continue; }
    if (!fs.lstatSync(absolute).isFile()) throw new Error(`LOCAL_SOURCE_FILE_INVALID:${file}`);
    digest.update(Buffer.from(hashScopedFile(file, fs.readFileSync(absolute)), 'hex'));
  }
  return digest.digest('hex');
}

function functionParts(source) {
  return parse(source, { ecmaVersion: 'latest', sourceType: 'script' }).body.map(node => ({
    name: node.type === 'FunctionDeclaration' ? node.id.name : null,
    source: source.slice(node.start, node.end).replaceAll('\r\n', '\n'),
  }));
}

function validateBrowserEvidence(value, contract) {
  const rows = value.browserEvidence || value.results || [];
  const requiredProjects = contract.projects;
  const metricIds = contract.metricIds;
  if (!Array.isArray(requiredProjects) || !requiredProjects.length || !Array.isArray(metricIds) || !metricIds.length
    || requiredProjects.length !== 3 || new Set(requiredProjects).size !== 3
    || !(contract.renderMsExclusive > 0) || contract.renderMsExclusive > 400
    || !(contract.expectedCards > 0) || !(contract.minimumMasterRows > 0)
    || ['requireSorted', 'requireMetrics', 'requireNoProductionWrites', 'requireLastCard', 'requireCompleteControl', 'requireNoOverflow']
      .some(key => contract[key] !== true)) {
    throw new Error('SCOPED_BROWSER_CONTRACT_INVALID');
  }
  if (rows.length !== requiredProjects.length) throw new Error('SCOPED_BROWSER_MATRIX_REQUIRED');
  for (const project of requiredProjects) {
    const row = rows.find(candidate => candidate.project === project || candidate.environment === project);
    const metrics = row?.metrics || row;
    const layout = row?.lastCardLayout;
    if (!row || metrics.renderMs < 0 || metrics.renderMs >= contract.renderMsExclusive
      || metrics.cards !== contract.expectedCards || metrics.expectedCards !== contract.expectedCards
      || metrics.masterRows < contract.minimumMasterRows
      || (contract.requireSorted === true && metrics.sorted !== true)
      || (contract.requireMetrics === true && metrics.metricsVerified !== true)
      || (contract.requireNoProductionWrites === true && metrics.productionWrites !== false)
      || (contract.requireLastCard === true && (!layout || layout.inViewport !== true))
      || (contract.requireCompleteControl === true && layout?.completeTagVisible !== true)
      || (contract.requireNoOverflow === true && layout?.cardOverflow !== false)
      || metricIds.some(id => !layout.metrics?.some(metric => metric.id === id && metric.label && metric.value
        && metric.labelSingleLine === true && metric.valueSingleLine === true))) {
      throw new Error(`SCOPED_BROWSER_EVIDENCE_INVALID:${project}`);
    }
  }
  return rows;
}

function verifyDependencySeal(rootDir, receipt, pkg) {
  const seal = receipt.dependencySeal;
  if (!seal || !Array.isArray(seal.lockfiles) || !seal.lockfiles.includes('package-lock.json')
    || !seal.lockfileHashes || !/^[a-f0-9]{64}$/.test(seal.manifestDigest || '')) {
    throw new Error('SCOPED_DEPENDENCY_SEAL_REQUIRED');
  }
  const dependencyManifest = {
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    overrides: pkg.overrides || {},
  };
  if (hash(Buffer.from(JSON.stringify(dependencyManifest))) !== seal.manifestDigest) {
    throw new Error('SCOPED_DEPENDENCY_MANIFEST_MISMATCH');
  }
  for (const lockfile of seal.lockfiles) {
    if (lockfile !== 'package-lock.json' || !/^[a-f0-9]{64}$/.test(seal.lockfileHashes[lockfile] || '')) {
      throw new Error(`SCOPED_DEPENDENCY_LOCK_SEAL_INVALID:${lockfile}`);
    }
    if (hashScopedFile(lockfile, fs.readFileSync(path.join(rootDir, lockfile))) !== seal.lockfileHashes[lockfile]) {
      throw new Error(`SCOPED_DEPENDENCY_LOCK_MISMATCH:${lockfile}`);
    }
  }
}

function verifyRetainedReceipts(rootDir, receipt) {
  const retained = receipt.retainedReceipts || {};
  const required = receipt.requiredRetainedReceipts || [];
  if (!Array.isArray(required) || !required.length) throw new Error('SCOPED_PRIOR_RECEIPT_RETENTION_REQUIRED');
  for (const file of required) {
    const relative = String(file).replaceAll('\\', '/');
    if (!/^docs\/releases\/[a-z0-9.-]+-retained-validation\.json$/i.test(relative)
      || !/^[a-f0-9]{64}$/.test(retained[relative] || '')) throw new Error(`SCOPED_PRIOR_RECEIPT_SEAL_INVALID:${relative}`);
    if (hashScopedFile(relative, Buffer.from(read(rootDir, relative))) !== retained[relative]) throw new Error(`SCOPED_PRIOR_RECEIPT_CHANGED:${relative}`);
  }
}

export function verifyScopedRetainedValidation({ rootDir = rootDefault, receiptPath } = {}) {
  const pkg = JSON.parse(read(rootDir, 'package.json'));
  const receiptFile = validateReceiptPath(receiptPath || process.env.SCOPED_VALIDATION_RECEIPT || pkg.scopedValidationReceipt);
  const receipt = JSON.parse(read(rootDir, receiptFile));
  if (receipt.schemaVersion !== 'agdata-scoped-validation-v1') throw new Error('SCOPED_RECEIPT_SCHEMA_INVALID');
  const release = normalizeRelease(receipt.release);
  if (!release || release !== normalizeRelease(`v${pkg.version}`)) throw new Error('SCOPED_RELEASE_IDENTITY_MISMATCH');
  const base = String(receipt.base || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('SCOPED_BASE_COMMIT_INVALID');
  git(rootDir, ['merge-base', '--is-ancestor', base, 'HEAD']);
  const evidencePrefix = String(receipt.evidencePathPrefix || '');
  const sources = captureScopedReleaseSources({ rootDir, base, receiptPath: receiptFile, evidencePrefix });
  if (JSON.stringify(sources) !== JSON.stringify(receipt.sourceHashes)) throw new Error('SCOPED_SOURCE_SEAL_MISMATCH');
  const changedPaths = Object.keys(sources);
  const sourceDigest = scopedSourceDigest({ rootDir, receiptPath: receiptFile, evidencePrefix });
  if (receipt.sourceDigest !== sourceDigest) throw new Error('SCOPED_SOURCE_DIGEST_MISMATCH');
  verifyDependencySeal(rootDir, receipt, pkg);
  verifyRetainedReceipts(rootDir, receipt);

  const permitted = new Set(receipt.appsScriptChangedFunctions || []);
  if ([...permitted].some(name => /history|backfill|trigger|schedule|^doGet$|^doPost$/i.test(name))) throw new Error('SCOPED_PROTECTED_SCRIPT_SCOPE');
  const codeChanged = changedPaths.includes('Code.gs');
  if (codeChanged && !permitted.size) throw new Error('SCOPED_SCRIPT_ALLOWLIST_REQUIRED');
  if (!codeChanged && permitted.size) throw new Error('SCOPED_SCRIPT_ALLOWLIST_WITHOUT_CHANGE');
  if (permitted.size) {
    const before = functionParts(git(rootDir, ['show', `${base}:Code.gs`]));
    const after = functionParts(read(rootDir, 'Code.gs'));
    const names = new Set([...before, ...after].map(node => node.name).filter(Boolean));
    const actuallyChanged = [...names].filter(name => JSON.stringify(before.filter(node => node.name === name))
      !== JSON.stringify(after.filter(node => node.name === name))).sort();
    if (JSON.stringify(actuallyChanged) !== JSON.stringify([...permitted].sort())) throw new Error('SCOPED_SCRIPT_ALLOWLIST_MISMATCH');
    if (JSON.stringify(before.filter(node => !permitted.has(node.name))) !== JSON.stringify(after.filter(node => !permitted.has(node.name)))) {
      throw new Error('SCOPED_PROTECTED_SCRIPT_CHANGED');
    }
    for (const name of permitted) if (after.filter(node => node.name === name).length !== 1
      || !pkg.appsScriptPatchFunctions.includes(name)) throw new Error('SCOPED_SCRIPT_PATCH_NOT_REGISTERED');
  }

  const kinds = {};
  const evidenceHashes = receipt.evidenceHashes || {};
  for (const [file, digest] of Object.entries(evidenceHashes)) {
    const normalized = file.replaceAll('\\', '/');
    if (!normalized.startsWith(evidencePrefix)) throw new Error(`SCOPED_EVIDENCE_PATH_INVALID:${file}`);
    const contents = read(rootDir, normalized);
    if (textHash(contents) !== digest) throw new Error(`SCOPED_EVIDENCE_HASH_MISMATCH:${file}`);
    const item = JSON.parse(contents);
    if (item.status !== 'passed' || item.sourceDigest !== sourceDigest || item.productionWrites !== false
      || item.realEmailsSent !== false || !item.capturedAt) throw new Error(`SCOPED_EVIDENCE_INVALID:${file}`);
    if (!item.kind || kinds[item.kind]) throw new Error(`SCOPED_EVIDENCE_KIND_INVALID:${file}`);
    kinds[item.kind] = item;
  }
  const requiredKinds = new Set(['unit', 'tooling', 'browser', ...(receipt.requiredKinds || [])]);
  const changedMigrations = changedPaths.filter(file => /^supabase\/migrations\/[^/]+\.sql$/i.test(file));
  const changedEdgePaths = changedPaths.filter(file => /^supabase\/functions\//i.test(file));
  const edgeFunctions = new Set(changedEdgePaths.map(file => /^supabase\/functions\/([^/]+)\//i.exec(file)?.[1])
    .filter(name => name && name !== '_shared'));
  const changedSharedPaths = changedEdgePaths.filter(file => /^supabase\/functions\/_shared\//i.test(file));
  if (changedSharedPaths.length) {
    const allFiles = git(rootDir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0')
      .filter(file => /^supabase\/functions\//i.test(file) && fs.existsSync(path.join(rootDir, file)));
    const functionFiles = allFiles.filter(file => !/^supabase\/functions\/_shared\//i.test(file));
    const extensions = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.js'];
    const resolveImport = (from, specifier) => {
      if (!specifier.startsWith('.')) return null;
      const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
      return extensions.map(extension => basePath + extension).find(candidate => allFiles.includes(candidate)) || null;
    };
    const graph = new Map();
    for (const file of allFiles) {
      if (!fs.existsSync(path.join(rootDir, file))) continue;
      const source = read(rootDir, file);
      const specs = [...source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2]);
      graph.set(file, specs.map(specifier => resolveImport(file, specifier)).filter(Boolean));
    }
    for (const sharedPath of changedSharedPaths) {
      for (const file of functionFiles) {
        const functionName = /^supabase\/functions\/([^/]+)\//i.exec(file)?.[1];
        if (!functionName || functionName === '_shared') continue;
        const seen = new Set();
        const reachesShared = current => {
          if (changedSharedPaths.includes(current)) return true;
          if (seen.has(current)) return false;
          seen.add(current);
          return (graph.get(current) || []).some(reachesShared);
        };
        if (reachesShared(file)) edgeFunctions.add(functionName);
      }
    }
    if (edgeFunctions.size === 0) throw new Error('SCOPED_SHARED_EDGE_IMPACT_UNRESOLVED');
  }
  const edgeFunctionList = [...edgeFunctions].sort();
  const deployment = { edgeFunctions: edgeFunctionList, migrations: changedMigrations.sort() };
  if (JSON.stringify(deployment) !== JSON.stringify(receipt.deployment)) throw new Error('SCOPED_DEPLOYMENT_LIST_MISMATCH');
  const changedSqlContracts = changedPaths.some(file => /^supabase\/(?:tests|functions\/app-api)\//i.test(file));
  if (changedMigrations.length || changedSqlContracts) requiredKinds.add('database');
  for (const kind of requiredKinds) if (!kinds[kind]) throw new Error(`SCOPED_REQUIRED_EVIDENCE_MISSING:${kind}`);
  if (!kinds.unit || !(kinds.unit.passed > 0) || kinds.unit.failed !== 0) throw new Error('SCOPED_UNIT_EVIDENCE_INVALID');
  if (requiredKinds.has('database') && (!(kinds.database.assertions > 0) || kinds.database.disposable !== true
    || kinds.database.failed !== 0 || kinds.database.errors !== 0)) {
    throw new Error('SCOPED_DISPOSABLE_SQL_EVIDENCE_INVALID');
  }
  if (changedMigrations.length) {
    const sealedMigrations = receipt.testedMigrationHashes || {};
    for (const migration of changedMigrations) {
    if (sealedMigrations[migration] !== hashScopedFile(migration, fs.readFileSync(path.join(rootDir, migration)))) {
        throw new Error(`SCOPED_MIGRATION_HASH_UNTESTED:${migration}`);
      }
    }
  }
  const browserEvidence = validateBrowserEvidence(kinds.browser, receipt.browserContract || {});
  return { release, base, sourceDigest, changedPaths, evidence: kinds, browserEvidence,
    appsScriptChangedFunctions: [...permitted], deployment };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const receiptPath = process.argv[2] || process.env.SCOPED_VALIDATION_RECEIPT;
    console.log(JSON.stringify(verifyScopedRetainedValidation({ receiptPath }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
