// v2.3.13 changes only operational ingestion and its deployment contracts.
// UI evidence is retained only when its source is identical apart from version markers.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';

export const V2313_BASE = '1fa247e779838d20ec5090f5d95559a0bf0be864';
const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = 'docs/releases/v2.3.13-retained-validation.json';
const evidencePaths = ['docs/releases/v2.3.13-validation/worker.json', 'docs/releases/v2.3.13-validation/database.json', 'docs/releases/v2.3.13-validation/erp-database.json', 'docs/releases/v2.3.13-validation/tooling.json', 'docs/releases/v2.3.13-validation/storm.json'];
const versionFiles = ['index.html', 'manifest.json', 'sw.js', 'scripts/build-live-shell.mjs', 'assets/ops-precision-pilot.js', 'v2/src/services/api.ts', 'v2/public/manifest.webmanifest'];
const allowed = new Set([
  ...versionFiles, 'package.json', 'package-lock.json', 'Code.gs',
  '.github/workflows/apps-script-sync.yml', '.github/workflows/release-database.yml',
  'scripts/apps-script-function-patch.mjs', 'scripts/check-v2313-retained-validation.mjs',
  'scripts/run-release-unit-checks.mjs', 'scripts/run-release-react-checks.mjs', 'scripts/ci-backend-matrix.mjs',
  'scripts/apply-item-low-stock-migration.mjs', 'scripts/verify-v2313-database.mjs',
  'scripts/verify-v2313-erp-database.mjs',
  'supabase/migrations/20261019225625_master_snapshot_chunked_staging_v1.sql',
  'supabase/migrations/20261019234222_identity_batch_not_ready_retry_sqlstate.sql',
  'supabase/migrations/20261020004000_erp_soc_snapshot_staging_v1.sql',
  'supabase/tests/master_snapshot_chunked_staging_v1_test.sql',
  'supabase/tests/erp_soc_snapshot_staging_v1_test.sql',
  'supabase/tests/bulk_context_index_plan_test.sql',
  'supabase/tests/inventory_master_identity_batch_test.sql',
  'supabase/functions/_shared/database.types.ts', 'services/database-contracts.generated.ts',
  'tests/master-snapshot-chunk-import.test.mjs', 'tests/erp-snapshot-stage-import.test.mjs', 'tests/v2313-release-contract.test.mjs', 'tests/suspend-tag-import.test.mjs',
]);
const hash = text => createHash('sha256').update(String(text).replaceAll('\r\n', '\n')).digest('hex');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const normalizeVersion = text => text.replaceAll('2.3.13', '2.3.12');

export function captureV2313Sources({ rootDir = rootDefault } = {}) {
  const names = [...new Set([...git(rootDir, ['diff', '--name-only', '--no-renames', '-z', V2313_BASE]).split('\0'),
    ...git(rootDir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))].sort();
  return Object.fromEntries(names.filter(file => file !== receiptPath && !evidencePaths.includes(file)).map(file => {
    if (!allowed.has(file) || !fs.existsSync(path.join(rootDir, file))) throw new Error(`V2313_UNAUTHORIZED_PATH:${file}`);
    return [file, hash(read(rootDir, file))];
  }));
}

export function verifyV2313AppsScriptProtection({ rootDir = rootDefault } = {}) {
  const patchNames = JSON.parse(read(rootDir, 'package.json')).appsScriptPatchFunctions;
  if (!Array.isArray(patchNames) || !patchNames.length || new Set(patchNames).size !== patchNames.length
    || !patchNames.includes('buildMasterBulkSnapshotPayload_')
    || patchNames.some(name => /history|backfill|trigger|schedule|^doGet$|^doPost$/i.test(name))) throw new Error('V2313_PATCH_SCOPE');
  const parts = source => {
    const functions = new Map(); const other = [];
    for (const node of parse(source, { ecmaVersion: 'latest', sourceType: 'script' }).body) {
      const body = source.slice(node.start, node.end).replaceAll('\r\n', '\n');
      if (node.type === 'FunctionDeclaration') {
        const name = node.id.name;
        if (!functions.has(name)) functions.set(name, []);
        functions.get(name).push(body);
      } else other.push(body);
    }
    return { functions, other };
  };
  const before = parts(git(rootDir, ['show', `${V2313_BASE}:Code.gs`]));
  const after = parts(read(rootDir, 'Code.gs'));
  if (JSON.stringify(before.other) !== JSON.stringify(after.other)) throw new Error('V2313_NONFUNCTION_CHANGED');
  for (const name of new Set([...before.functions.keys(), ...after.functions.keys()])) {
    if (patchNames.includes(name)) {
      if (after.functions.get(name)?.length !== 1) throw new Error(`V2313_PATCH_NOT_UNIQUE:${name}`);
    } else if (JSON.stringify(before.functions.get(name)) !== JSON.stringify(after.functions.get(name))) {
      throw new Error(`V2313_PROTECTED_FUNCTION_CHANGED:${name}`);
    }
  }
  const protectedFunctions = [...before.functions].filter(([name]) => !patchNames.includes(name));
  return { patchNames, protectedFunctions: protectedFunctions.length, protectedDigest: hash(JSON.stringify({ functions: protectedFunctions, other: before.other })) };
}

export function verifyV2313RetainedValidation({ rootDir = rootDefault } = {}) {
  git(rootDir, ['merge-base', '--is-ancestor', V2313_BASE, 'HEAD']);
  const pkg = JSON.parse(read(rootDir, 'package.json'));
  const receipt = JSON.parse(read(rootDir, receiptPath));
  if (pkg.version !== '2.3.13' || receipt.base !== V2313_BASE || receipt.release !== 'AgData v2.3.13'
    || receipt.schemaVersion !== 'agdata-v2313-scoped-validation-v1') throw new Error('V2313_IDENTITY');
  const sources = captureV2313Sources({ rootDir });
  for (const file of ['Code.gs', 'supabase/migrations/20261019225625_master_snapshot_chunked_staging_v1.sql', 'supabase/tests/master_snapshot_chunked_staging_v1_test.sql', 'supabase/tests/bulk_context_index_plan_test.sql', 'supabase/migrations/20261019234222_identity_batch_not_ready_retry_sqlstate.sql', 'supabase/tests/inventory_master_identity_batch_test.sql', 'supabase/migrations/20261020004000_erp_soc_snapshot_staging_v1.sql', 'supabase/tests/erp_soc_snapshot_staging_v1_test.sql', 'tests/master-snapshot-chunk-import.test.mjs', 'scripts/verify-v2313-database.mjs', 'scripts/verify-v2313-erp-database.mjs']) {
    if (!Object.hasOwn(sources, file)) throw new Error(`V2313_REQUIRED_SOURCE_MISSING:${file}`);
  }
  if (JSON.stringify(sources) !== JSON.stringify(receipt.sourceHashes)) throw new Error('V2313_SOURCE_SEAL_MISMATCH');
  for (const file of versionFiles) {
    if (hash(normalizeVersion(read(rootDir, file))) !== hash(git(rootDir, ['show', `${V2313_BASE}:${file}`]))) throw new Error(`V2313_UI_BASELINE_CHANGED:${file}`);
  }
  const oldReceipt = 'docs/releases/v2.3.12-retained-validation.json';
  if (hash(read(rootDir, oldReceipt)) !== hash(git(rootDir, ['show', `${V2313_BASE}:${oldReceipt}`]))) throw new Error('V2313_BASELINE_RECEIPT_CHANGED');
  const protection = verifyV2313AppsScriptProtection({ rootDir });
  if (JSON.stringify(protection) !== JSON.stringify(receipt.appsScriptProtection)) throw new Error('V2313_BACKFILL_PROTECTION_MISMATCH');
  const sourceDigest = hash(JSON.stringify(sources));
  for (const file of evidencePaths) {
    const text = read(rootDir, file); const artifact = JSON.parse(text);
    if (hash(text) !== receipt.evidenceHashes[file] || artifact.status !== 'passed' || artifact.sourceDigest !== sourceDigest
      || !artifact.capturedAt || artifact.productionWrites !== false || artifact.realEmailsSent !== false) throw new Error(`V2313_EVIDENCE_INVALID:${file}`);
  }
  const database = JSON.parse(read(rootDir, evidencePaths[1]));
  if (database.nativePostgres !== true || database.sourceRows < 9504 || database.migrationsReplayed < 85
    || !Number.isSafeInteger(database.assertions) || database.assertions < 1
    || !Array.isArray(database.timings) || !database.timings.length
    || database.timings.some(metric => !Number.isFinite(metric.ms) || metric.ms < 0 || metric.ms >= 2000)
    || !database.postgresVersion || !database.cacheCondition || !database.queryPlans
    || !['new', 'changed', 'unchanged', 'retry'].every(scenario => database.timings.some(metric => metric.scenario === scenario))) throw new Error('V2313_DATABASE_PERFORMANCE_EVIDENCE');
  if (database.contextTestFile !== 'supabase/tests/bulk_context_index_plan_test.sql'
    || database.contextTestSha256 !== sources[database.contextTestFile]) throw new Error('V2313_CONTEXT_TEST_EVIDENCE');
  const erp = JSON.parse(read(rootDir, evidencePaths[2]));
  const erpMetrics = erp.performance?.metrics;
  const erpTargets = ['ph_soc_master', 'ph_reserves'];
  const erpScenarios = ['new', 'changed', 'unchanged'];
  if (erp.status !== 'passed' || erp.sourceDigest !== sourceDigest || erp.nativePostgres !== true
    || erp.productionWrites !== false || erp.realEmailsSent !== false || erp.sourceRows !== 39938
    || erp.sourceRowsByTarget?.ph_soc_master !== 32484 || erp.sourceRowsByTarget?.ph_reserves !== 7454
    || erp.migrationsReplayed < 85 || erp.assertions < 1
    || erp.testFile !== 'supabase/tests/erp_soc_snapshot_staging_v1_test.sql'
    || erp.migrationFile !== 'supabase/migrations/20261020004000_erp_soc_snapshot_staging_v1.sql'
    || erp.sourceHashes?.testSha256 !== sources[erp.testFile]
    || erp.sourceHashes?.migrationSha256 !== sources[erp.migrationFile]
    || !Array.isArray(erp.migrationWorkspaceHashes) || erp.migrationWorkspaceHashes.length < 85
    || !Array.isArray(erpMetrics)
    || erpMetrics.some(metric => !Number.isFinite(Number(metric.elapsed_ms)) || Number(metric.elapsed_ms) < 0 || Number(metric.elapsed_ms) >= 2000)
    || !erpTargets.every(target => erpScenarios.every(scenario => erpMetrics.some(metric => metric.target_table === target && metric.scenario === scenario)))
    || !erpTargets.every(target => erpMetrics.some(metric => metric.target_table === target && metric.scenario === 'new' && metric.operation === 'append-retry')
      && erpMetrics.some(metric => metric.target_table === target && metric.operation === 'finalize-retry'))
    || erp.queryPlanEvidence?.explainOutputPresent !== true) throw new Error('V2313_ERP_DATABASE_EVIDENCE');
  const erpMigrationInWorkspace = erp.migrationWorkspaceHashes.find(item => item.path === erp.migrationFile);
  if (erpMigrationInWorkspace?.sha256 !== erp.sourceHashes.migrationSha256) throw new Error('V2313_ERP_WORKSPACE_MIGRATION_HASH');
  const storm = JSON.parse(read(rootDir, evidencePaths[4]));
  if (storm.status !== 'passed' || storm.sourceDigest !== sourceDigest || storm.nativePostgres !== true
    || storm.productionWrites !== false || storm.realEmailsSent !== false || storm.assertions !== 38
    || storm.testFile !== 'supabase/tests/inventory_master_identity_batch_test.sql'
    || storm.migrationFile !== 'supabase/migrations/20261019234222_identity_batch_not_ready_retry_sqlstate.sql'
    || storm.inputHashes?.test !== sources[storm.testFile] || storm.inputHashes?.migration !== sources[storm.migrationFile]
    || !storm.outputLog || !/^[a-f0-9]{64}$/.test(storm.outputLogSha256 || '')
    || !Number.isSafeInteger(storm.migrationsReplayed)) throw new Error('V2313_STORM_SQL_EVIDENCE');
  return { baseline: V2313_BASE, sourceDigest, changedPaths: Object.keys(sources), appsScriptProtection: protection,
    retainedUi: true, newValidation: receipt.evidenceHashes, databaseTimings: database.timings,
    contextTest: { file: database.contextTestFile, sha256: database.contextTestSha256 },
    erpSnapshot: { assertions: erp.assertions, sourceRowsByTarget: erp.sourceRowsByTarget, metrics: erpMetrics },
    stormAssertions: storm.assertions };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(process.argv.includes('--capture-source-hashes') ? captureV2313Sources() : verifyV2313RetainedValidation(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
