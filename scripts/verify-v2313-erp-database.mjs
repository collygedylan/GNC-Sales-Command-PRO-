import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createDatabaseWorkspace } from './database-workspace.mjs';
import { withDisposableSupabase } from './database-workspace-runner.mjs';
import { packageBin, repoRoot, runNode } from './tooling-process.mjs';

const testFile = 'supabase/tests/erp_soc_snapshot_staging_v1_test.sql';
const migrationFile = 'supabase/migrations/20261020004000_erp_soc_snapshot_staging_v1.sql';
const digest = text => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

function parseFixtureMetrics(output) {
  const line = output.split(/\r?\n/).find(value => /"suite"\s*:\s*"soc-reserves-staged-erp"/.test(value));
  if (!line) throw new Error('V2313_ERP_PERFORMANCE_MARKER_MISSING');
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('V2313_ERP_PERFORMANCE_JSON_INVALID');
  const value = JSON.parse(line.slice(start, end + 1));
  if (value.suite !== 'soc-reserves-staged-erp' || value.datasetRows?.ph_soc_master !== 32484
      || value.datasetRows?.ph_reserves !== 7454 || !Array.isArray(value.metrics)) {
    throw new Error('V2313_ERP_PERFORMANCE_EVIDENCE_INVALID');
  }
  for (const target of ['ph_soc_master', 'ph_reserves']) {
    for (const scenario of ['new', 'changed', 'unchanged']) {
      if (!value.metrics.some(metric => metric.target_table === target && metric.scenario === scenario)) {
        throw new Error(`V2313_ERP_METRIC_MISSING:${target}:${scenario}`);
      }
    }
    if (!value.metrics.some(metric => metric.target_table === target && metric.scenario === 'new' && metric.operation === 'append-retry')
        || !value.metrics.some(metric => metric.target_table === target && metric.operation === 'finalize-retry')) {
      throw new Error(`V2313_ERP_RETRY_METRIC_MISSING:${target}`);
    }
  }
  if (value.metrics.some(metric => !Number.isFinite(Number(metric.elapsed_ms))
      || Number(metric.elapsed_ms) < 0 || Number(metric.elapsed_ms) >= 2000)) {
    throw new Error('V2313_ERP_RPC_TIMING_GATE_FAILED');
  }
  return value;
}

/** Replays the full migration chain in a disposable local Supabase stack, then runs only the SOC/Reserves contract. */
export function verifyV2313ErpDatabase({ root = repoRoot, cli = packageBin('supabase', 'supabase', root),
  execute = runNode, createWorkspace = createDatabaseWorkspace, runDisposable = withDisposableSupabase } = {}) {
  const startedAt = new Date().toISOString();
  const sourceHashes = {
    migrationSha256: digest(readFileSync(path.join(root, migrationFile), 'utf8')),
    testSha256: digest(readFileSync(path.join(root, testFile), 'utf8')),
  };
  const workspace = createWorkspace({ root, includeTests: true, testGroup: 'sql-pgtap', discoverTests: () => [testFile] });
  const migrationDirectory = path.join(workspace.root, 'supabase/migrations');
  const migrationWorkspaceHashes = readdirSync(migrationDirectory).filter(name => /^\d{14}_.+\.sql$/i.test(name)).sort()
    .map(name => ({ path: `supabase/migrations/${name}`,
      sha256: digest(readFileSync(path.join(migrationDirectory, name), 'utf8')) }));
  const copiedMigration = migrationWorkspaceHashes.find(item => item.path.endsWith('/' + path.basename(migrationFile)));
  const copiedTest = digest(readFileSync(path.join(workspace.root, 'supabase/tests', path.basename(testFile)), 'utf8'));
  if (!copiedMigration || copiedMigration.sha256 !== sourceHashes.migrationSha256 || copiedTest !== sourceHashes.testSha256) {
    workspace.dispose();
    throw new Error('V2313_ERP_WORKSPACE_SOURCE_MISMATCH');
  }
  const migrationWorkspaceDigest = digest(JSON.stringify(migrationWorkspaceHashes));
  const evidenceDirectory = path.join(root, '.gnc-local/v2313-erp-database');
  mkdirSync(evidenceDirectory, { recursive: true });
  const attemptStartPath = `.gnc-local/v2313-erp-database/attempt-${Date.now()}-start.json`;
  writeFileSync(path.join(root, attemptStartPath), JSON.stringify({
    startedAt, status: 'running', testFile, migrationFile, sourceHashes,
    migrationWorkspaceDigest, migrationWorkspaceHashes, migrationsReplayed: workspace.migrationCount,
  }, null, 2) + '\n', { mode: 0o600 });
  return runDisposable({ root, workspace, cli, execute, action: runCli => {
    let output;
    try {
      output = runCli(['test', 'db'], { capture: true });
    } catch (error) {
      const directory = path.join(root, '.gnc-local/v2313-erp-database');
      mkdirSync(directory, { recursive: true });
      const captured = [error?.stdout, error?.stderr, error?.message].filter(Boolean)
        .map(value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value)).join('\n');
      writeFileSync(path.join(directory, `failure-output-${Date.now()}.log`), captured + '\n', { mode: 0o600 });
      throw error;
    }
    const finalSourceHashes = {
      migrationSha256: digest(readFileSync(path.join(root, migrationFile), 'utf8')),
      testSha256: digest(readFileSync(path.join(root, testFile), 'utf8')),
    };
    if (JSON.stringify(finalSourceHashes) !== JSON.stringify(sourceHashes)) {
      throw new Error('V2313_ERP_SOURCE_CHANGED_DURING_RUN');
    }
    const directory = evidenceDirectory;
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'focused-erp-sql-output.log'), output, { mode: 0o600 });
    const testSummary = output.match(/Files\s*=\s*1\s*,\s*Tests\s*=\s*(\d+)\s*,/i);
    if (!testSummary || Number(testSummary[1]) < 1) {
      throw new Error('V2313_ERP_TEST_SUMMARY_INVALID');
    }
    const performance = parseFixtureMetrics(output);
    const result = {
      startedAt, capturedAt: new Date().toISOString(), status: 'passed', nativePostgres: true,
      migrationsReplayed: workspace.migrationCount, testFile, migrationFile,
      assertions: Number(testSummary[1]), sourceRows: performance.datasetRows.ph_soc_master + performance.datasetRows.ph_reserves,
      sourceRowsByTarget: performance.datasetRows, sourceHashes, performance,
      migrationWorkspaceDigest, migrationWorkspaceHashes,
      queryPlanEvidence: { explainOutputPresent: output.includes('QUERY PLAN') || output.includes('"Node Type"') },
      outputLog: '.gnc-local/v2313-erp-database/focused-erp-sql-output.log',
      outputLogSha256: digest(output),
      productionWrites: false, realEmailsSent: false,
      environment: 'Native PostgreSQL in isolated local Supabase Docker stack; only the SOC/Reserves pgTAP test is selected',
    };
    writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    return result;
  } });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(verifyV2313ErpDatabase(), null, 2)); }
  catch (error) {
    const diagnostic = String(error?.message || 'unknown')
      .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, '[redacted-local-db-url]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
    const directory = path.join(repoRoot, '.gnc-local/v2313-erp-database');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `failure-${Date.now()}.log`);
    writeFileSync(file, `${new Date().toISOString()}\n${diagnostic}\n`, { mode: 0o600 });
    console.error(`[v2313-erp-database] failed: ${diagnostic.slice(-5000)}`);
    process.exitCode = 1;
  }
}
