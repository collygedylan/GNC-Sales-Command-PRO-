import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createDatabaseWorkspace } from './database-workspace.mjs';
import { withDisposableSupabase } from './database-workspace-runner.mjs';
import { runLocalTypesCommand, generatedDatabaseTypesPath } from './database-types.mjs';
import { generateContracts } from './generate-database-contracts.mjs';
import { packageBin, repoRoot, runNode } from './tooling-process.mjs';

const testFile = 'supabase/tests/master_snapshot_chunked_staging_v1_test.sql';
const protectionTestFile = 'supabase/tests/bulk_master_snapshot_v1_test.sql';
const contextTestFile = 'supabase/tests/bulk_context_index_plan_test.sql';
const migrationFile = 'supabase/migrations/20261019225625_master_snapshot_chunked_staging_v1.sql';
const digest = text => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

/** Full native schema replay; only the changed ingestion contracts are executed. */
export function verifyV2313Database({ root = repoRoot, cli = packageBin('supabase', 'supabase', root),
  retainProtection = false, execute = runNode, createWorkspace = createDatabaseWorkspace, runDisposable = withDisposableSupabase } = {}) {
  const startedAt = new Date().toISOString();
  const inputFiles = [migrationFile, testFile, contextTestFile, protectionTestFile];
  const inputHashes = Object.fromEntries(inputFiles.map(file => [file, digest(readFileSync(path.join(root, file), 'utf8'))]));
  let retainedProtection = null;
  if (retainProtection) {
    retainedProtection = JSON.parse(readFileSync(path.join(root, '.gnc-local/v2313-protection-pass.json'), 'utf8'));
    const source = readFileSync(path.join(root, migrationFile), 'utf8');
    const marker = '-- The canonical bulk context is transaction-local.';
    if (source.indexOf(marker) < 0 || retainedProtection.passed !== true || retainedProtection.assertions !== 66
      || retainedProtection.migrationProtectionSha256 !== digest(source.slice(source.indexOf(marker)))
      || retainedProtection.logSha256 !== digest(readFileSync(path.join(root, retainedProtection.log), 'utf8'))
      || [contextTestFile, protectionTestFile].some(file => retainedProtection.testHashes[file] !== digest(readFileSync(path.join(root, file), 'utf8')))) {
      throw new Error('V2313_RETAINED_PROTECTION_SOURCE_MISMATCH');
    }
  }
  const workspace = createWorkspace({ root, includeTests: true, testGroup: 'sql-pgtap', discoverTests: () => retainedProtection ? [testFile] : [contextTestFile, protectionTestFile, testFile] });
  const migrationDirectory = path.join(workspace.root, 'supabase/migrations');
  const migrationWorkspaceHashes = readdirSync(migrationDirectory).filter(name => /^\d{14}_.+\.sql$/i.test(name)).sort()
    .map(name => ({ path: `supabase/migrations/${name}`, sha256: digest(readFileSync(path.join(migrationDirectory, name), 'utf8')) }));
  for (const file of inputFiles.filter(file => !retainedProtection || ![contextTestFile, protectionTestFile].includes(file))) {
    if (digest(readFileSync(path.join(workspace.root, file), 'utf8')) !== inputHashes[file]) {
      workspace.dispose();
      throw new Error(`V2313_DATABASE_WORKSPACE_SOURCE_MISMATCH:${file}`);
    }
  }
  return runDisposable({ root, workspace, cli, execute, action: runCli => {
    // The fresh, unique stack has already replayed this complete migration chain
    // during start. Its seed is empty; resetting here would replay it twice.
    const output = runCli(['test', 'db'], { capture: true });
    const evidenceDirectory = path.join(root, '.gnc-local/v2313-database');
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(path.join(evidenceDirectory, 'focused-sql-output.log'), output, { mode: 0o600 });
    const marker = 'V2313_PERFORMANCE_JSON=';
    const lines = output.split(/\r?\n/).filter(line => line.includes(marker));
    if (lines.length !== 1) throw new Error('V2313_DATABASE_PERFORMANCE_MARKER_MISSING');
    const performance = JSON.parse(lines[0].slice(lines[0].indexOf(marker) + marker.length).trim());
    if (inputFiles.some(file => digest(readFileSync(path.join(root, file), 'utf8')) !== inputHashes[file])) {
      throw new Error('V2313_DATABASE_SOURCE_CHANGED_DURING_RUN');
    }
    const types = runLocalTypesCommand(runCli, ['gen', 'types', '--local', '--schema', 'public', '--lang', 'typescript']);
    if (!types.includes('export type Database =') || !types.includes('finalize_master_snapshot_stage_v1:')) {
      throw new Error('V2313_DATABASE_TYPES_MISSING_STAGED_RPC');
    }
    writeFileSync(path.join(root, generatedDatabaseTypesPath), types.endsWith('\n') ? types : types + '\n');
    generateContracts({ root });
    const result = {
      startedAt, capturedAt: new Date().toISOString(), nativePostgres: true,
      migrationsReplayed: workspace.migrationCount, testFile, migrationFile,
      inputHashes, migrationWorkspaceHashes, migrationWorkspaceDigest: digest(JSON.stringify(migrationWorkspaceHashes)),
      contextTestFile, contextTestSha256: digest(readFileSync(path.join(root, contextTestFile), 'utf8')),
      protectionTestFile, protectionTestSha256: digest(readFileSync(path.join(root, protectionTestFile), 'utf8')),
      testSha256: digest(readFileSync(path.join(root, testFile), 'utf8')),
      migrationSha256: digest(readFileSync(path.join(root, migrationFile), 'utf8')),
      productionWrites: false, realEmailsSent: false, retainedProtection,
      environment: 'Native PostgreSQL in isolated local Supabase Docker stack; no HTTP, Auth, Edge, or delivery workers started',
      performance,
    };
    writeFileSync(path.join(evidenceDirectory, 'evidence.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    return result;
  } });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(verifyV2313Database({ retainProtection: process.argv.includes('--retain-protection') }), null, 2)); }
  catch (error) {
    const diagnostic = String(error?.message || 'unknown')
      .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, '[redacted-local-db-url]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
    const directory = path.join(repoRoot, '.gnc-local/v2313-database');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `failure-${Date.now()}.log`);
    writeFileSync(file, `${new Date().toISOString()}\n${diagnostic}\n`, { mode: 0o600 });
    console.error(`[v2313-database] failed: ${diagnostic.slice(-5000)}`);
    process.exitCode = 1;
  }
}
