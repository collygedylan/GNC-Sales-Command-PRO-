import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createDatabaseWorkspace } from './database-workspace.mjs';
import { withDisposableSupabase } from './database-workspace-runner.mjs';
import { packageBin, repoRoot, runNode } from './tooling-process.mjs';

const focusedSqlTests = [
  'supabase/tests/user_access_control_v1_test.sql',
  'supabase/tests/inventory_reclass_moves_v1_test.sql',
  'supabase/tests/inventory_reclass_move_delivery_v1_test.sql',
];
const evidencePath = '.gnc-local/v2311-db-evidence.json';

function extractPerformanceEvidence(output, marker) {
  const prefix = `${marker}=`;
  const lines = String(output).split(/\r?\n/);
  const matches = lines.filter(line => line.includes(prefix));
  if (matches.length !== 1) throw new Error(`V2311_PERFORMANCE_EVIDENCE_MISSING:${marker}`);
  const raw = matches[0].slice(matches[0].indexOf(prefix) + prefix.length).trim();
  try { return JSON.parse(raw); }
  catch { throw new Error(`V2311_PERFORMANCE_EVIDENCE_INVALID:${marker}`); }
}

function assertPerformanceEvidence(access, reclass) {
  const accessPlansValid = Array.isArray(access.indexed_auth_lookup_plan)
    && Array.isArray(access.representative_master_read_plan);
  if (access.synthetic_profile_count !== 67 || access.directory_result_count < 67
    || access.representative_master_row_count < 10001
    || !['resolve_first_call_ms', 'resolve_second_call_ms', 'directory_first_call_ms', 'directory_second_call_ms']
      .every(key => Number.isFinite(access[key]) && access[key] < 100)
    || !accessPlansValid || !access.postgres_version || !access.cache_condition) {
    throw new Error('V2311_ACCESS_PERFORMANCE_EVIDENCE_GATE_FAILED');
  }
  if (reclass.source_count !== 100 || reclass.submitted_move_count !== 100
    || reclass.first_status !== 'applied' || reclass.first_movement_count !== 100
    || !Number.isFinite(reclass.first_atomic_rpc_ms) || reclass.first_atomic_rpc_ms > 1000
    || reclass.first_outbox_event_count !== 1 || reclass.retry_duplicate !== 'true'
    || reclass.retry_event_count !== 1 || !reclass.request_id
    || reclass.request_id !== reclass.retry_request_id
    || !reclass.delivery_event_id || reclass.delivery_event_id !== reclass.retry_delivery_event_id) {
    throw new Error('V2311_RECLASS_PERFORMANCE_EVIDENCE_GATE_FAILED');
  }
}

/** Replays the disposable canonical schema while running only v2.3.11's affected SQL contracts. */
export function verifyV2311Database({ root = repoRoot, cli = packageBin('supabase', 'supabase', root),
  execute = runNode, createWorkspace = createDatabaseWorkspace, runDisposable = withDisposableSupabase } = {}) {
  const absoluteRoot = path.resolve(root);
  if (focusedSqlTests.some((file) => !path.resolve(absoluteRoot, file).startsWith(`${absoluteRoot}${path.sep}`)
    || !existsSync(path.resolve(absoluteRoot, file)))) throw new Error('V2311_DATABASE_TEST_PATH_INVALID');
  const workspace = createWorkspace({ root, includeTests: true, testGroup: 'sql-pgtap', discoverTests: () => focusedSqlTests });
  let disposableOwnsCleanup = false;
  try {
    disposableOwnsCleanup = true;
    return runDisposable({ root, workspace, cli, execute, action: (runCli) => {
      runCli(['db', 'reset', '--local', '--no-seed']);
      const output = runCli(['test', 'db'], { capture: true });
      const accessPerformance = extractPerformanceEvidence(output, 'V2311_PERFORMANCE_JSON');
      const reclassPerformance = extractPerformanceEvidence(output, 'V2311_RECLASS_PERFORMANCE_JSON');
      assertPerformanceEvidence(accessPerformance, reclassPerformance);
      const evidence = {
        generatedAt: new Date().toISOString(),
        environment: {
          database: 'local disposable Supabase stack',
          postgresVersion: accessPerformance.postgres_version,
          cacheCondition: accessPerformance.cache_condition,
          noProductionConnection: true,
          noEmailOrDeliveryWorker: true,
        },
        migrationsReplayed: workspace.migrationCount,
        focusedSqlTests,
        permissionResolution: accessPerformance,
        atomicReclassDelivery: reclassPerformance,
      };
      const absoluteEvidencePath = path.resolve(absoluteRoot, evidencePath);
      mkdirSync(path.dirname(absoluteEvidencePath), { recursive: true });
      writeFileSync(absoluteEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      return { migrationsReplayed: workspace.migrationCount, focusedSqlTests, evidencePath };
    } });
  } finally {
    // withDisposableSupabase owns cleanup once called, including failure paths.
    if (!disposableOwnsCleanup && workspace?.dispose) workspace.dispose();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = verifyV2311Database();
    console.log(`[v2311-database] passed ${result.focusedSqlTests.length} focused SQL contracts after replaying ${result.migrationsReplayed} migrations on a disposable local Supabase stack.`);
  } catch (error) {
    const safeCode = String(error?.message || 'unknown').split('\n')[0].slice(0, 240);
    console.error(`[v2311-database] failed: ${safeCode}`);
    process.exitCode = 1;
  }
}
