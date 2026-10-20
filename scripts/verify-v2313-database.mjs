import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isV2313DriveTimingWithinBudget, V2313_FINALIZE_BUDGET_MS, V2313_OTHER_RPC_BUDGET_MS } from './check-v2313-retained-validation.mjs';
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


const retainedCommit = 'c19889ed7673427676070da0f552fc071e3c122c';
const checkpointText = (root, file) => execFileSync('git', ['show', retainedCommit + ':' + file],
  { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).replaceAll('\r\n', '\n');
const markedBlock = (source, name) => {
  const start = '-- ' + name + '_BEGIN'; const end = '-- ' + name + '_END';
  const a = source.indexOf(start); const b = source.indexOf(end, a);
  if (a < 0 || b < a) throw new Error('V2313_FOCUSED_CASE_MARKER_MISSING:' + name);
  return source.slice(a + start.length, b);
};
function retainedFixtureOutsideCorrection(source) {
  let text = source.replaceAll('\r\n', '\n').replace(/^-- V2313_SPLIT_[^\n]*\n/gm, '');
  const helperStart = text.indexOf('create or replace function pg_temp.v2313_genuine_split_case');
  const helperEnd = text.indexOf('create temporary table v2313_genuine_split_outcomes', helperStart);
  if (helperStart < 0 || helperEnd < helperStart) throw new Error('V2313_SPLIT_HELPER_SCOPE');
  text = text.slice(0, helperStart) + '/* corrected retained-case helper */\n' + text.slice(helperEnd);
  const insert = "insert into v2313_genuine_split_outcomes select c,pg_temp.v2313_genuine_split_case(c) from unnest(array['retained','omitted','pending']) c;";
  const assertionStart = text.indexOf(insert) + insert.length;
  const assertionEnd = text.indexOf("select ok(result->>'state'='55000'", assertionStart);
  if (assertionStart < insert.length || assertionEnd < assertionStart) throw new Error('V2313_SPLIT_ASSERTION_SCOPE');
  text = text.slice(0, assertionStart) + '\n/* corrected retained-case assertion */\n' + text.slice(assertionEnd);
  const timingStart = text.indexOf('select is((select count(*)::integer from v2313_rpc_metrics');
  const timingEnd = text.indexOf(';', timingStart);
  if (timingStart < 0 || timingEnd < timingStart) throw new Error('V2313_TIMING_ASSERTION_SCOPE');
  return text.slice(0, timingStart) + '/* approved finalization timing gate */' + text.slice(timingEnd + 1);
}
export function prepareCheckpointValidation(root, source) {
  const unchangedFixtureSha256 = digest(retainedFixtureOutsideCorrection(source));
  if (unchangedFixtureSha256 !== digest(retainedFixtureOutsideCorrection(checkpointText(root, testFile)))) {
    throw new Error('V2313_RETAINED_FIXTURE_CHANGED_OUTSIDE_AUTHORIZED_CORRECTION');
  }
  for (const file of [migrationFile, contextTestFile, protectionTestFile]) {
    if (digest(readFileSync(path.join(root, file), 'utf8')) !== digest(checkpointText(root, file))) {
      throw new Error('V2313_RETAINED_CHECKPOINT_SOURCE_MISMATCH:' + file);
    }
  }
  const log = '.gnc-local/v2313-database/failure-1792459423355.log';
  const logBuffer = readFileSync(path.join(root, log));
  const logSha256 = createHash('sha256').update(logBuffer).digest('hex');
  const checkpoint = checkpointText(root, 'docs/releases/v2.3.13-checkpoint.md');
  if (!checkpoint.includes(log + ': ' + logSha256)) throw new Error('V2313_RETAINED_LOG_HASH_MISMATCH');
  const output = logBuffer.toString('utf8');
  if (!/Tests=143/.test(output) || !/Failed tests:\s+31, 36/.test(output)) throw new Error('V2313_RETAINED_ASSERTION_COUNTS');
  const marker = 'V2313_PERFORMANCE_JSON=';
  const line = output.split(/\r?\n/).find(value => value.includes(marker));
  const performance = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  const timingSql = JSON.stringify(performance.timings).replaceAll("'", "''");
  const sql = [
    'create extension if not exists pgtap with schema extensions;', 'select plan(2);',
    markedBlock(source, 'V2313_SPLIT_HELPER'),
    'create temporary table v2313_genuine_split_outcomes(case_name text primary key,result jsonb);',
    "insert into v2313_genuine_split_outcomes values ('retained',pg_temp.v2313_genuine_split_case('retained'));",
    markedBlock(source, 'V2313_SPLIT_RETAINED_ASSERTION'),
    "select is((select count(*)::integer from jsonb_to_recordset('" + timingSql + "'::jsonb) as metrics(operation text, ms numeric) where ms < 0 or ms >= case when operation='finalize' then " + V2313_FINALIZE_BUDGET_MS + ' else ' + V2313_OTHER_RPC_BUDGET_MS + " end),0,'retained production-volume timings meet approved strict finalization and unchanged other RPC budgets');",
    'select * from finish();',
  ].join('\n');
  return { sql, performance, checkpoint: retainedCommit, assertions: 143, retainedAssertions: 141,
    unchangedFixtureSha256,
    executedAssertions: 2, log, logSha256, priorFailedAssertions: [31, 36],
    migrationSha256: digest(checkpointText(root, migrationFile)),
    testSha256: digest(checkpointText(root, testFile)),
    performanceReused: true, benchmarkRerun: false,
    finalizationBudgetMs: V2313_FINALIZE_BUDGET_MS, otherRpcBudgetMs: V2313_OTHER_RPC_BUDGET_MS };
}

/** Full native schema replay; only the changed ingestion contracts are executed. */
export function verifyV2313Database({ root = repoRoot, cli = packageBin('supabase', 'supabase', root),
  retainProtection = false, retainCheckpoint = false, execute = runNode, createWorkspace = createDatabaseWorkspace, runDisposable = withDisposableSupabase } = {}) {
  const startedAt = new Date().toISOString();
  const inputFiles = [migrationFile, testFile, contextTestFile, protectionTestFile];
  const inputHashes = Object.fromEntries(inputFiles.map(file => [file, digest(readFileSync(path.join(root, file), 'utf8'))]));
  const checkpointValidation = retainCheckpoint ? prepareCheckpointValidation(root, readFileSync(path.join(root, testFile), 'utf8')) : null;
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
  const workspace = createWorkspace({ root, includeTests: true, testGroup: 'sql-pgtap', discoverTests: () => checkpointValidation || retainedProtection ? [testFile] : [contextTestFile, protectionTestFile, testFile] });
  const migrationDirectory = path.join(workspace.root, 'supabase/migrations');
  const migrationWorkspaceHashes = readdirSync(migrationDirectory).filter(name => /^\d{14}_.+\.sql$/i.test(name)).sort()
    .map(name => ({ path: `supabase/migrations/${name}`, sha256: digest(readFileSync(path.join(migrationDirectory, name), 'utf8')) }));
  for (const file of inputFiles.filter(file => (!retainedProtection && !checkpointValidation) || ![contextTestFile, protectionTestFile].includes(file))) {
    if (digest(readFileSync(path.join(workspace.root, file), 'utf8')) !== inputHashes[file]) {
      workspace.dispose();
      throw new Error(`V2313_DATABASE_WORKSPACE_SOURCE_MISMATCH:${file}`);
    }
  }
  if (checkpointValidation) writeFileSync(path.join(workspace.root, testFile), checkpointValidation.sql);
  return runDisposable({ root, workspace, cli, execute, action: runCli => {
    // The fresh, unique stack has already replayed this complete migration chain
    // during start. Its seed is empty; resetting here would replay it twice.
    const output = runCli(['test', 'db'], { capture: true });
    const evidenceDirectory = path.join(root, '.gnc-local/v2313-database');
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(path.join(evidenceDirectory, 'focused-sql-output.log'), output, { mode: 0o600 });
    const marker = 'V2313_PERFORMANCE_JSON=';
    const lines = output.split(/\r?\n/).filter(line => line.includes(marker));
    if (!checkpointValidation && lines.length !== 1) throw new Error('V2313_DATABASE_PERFORMANCE_MARKER_MISSING');
    const performance = checkpointValidation?.performance ?? JSON.parse(lines[0].slice(lines[0].indexOf(marker) + marker.length).trim());
    if (!performance.timings.every(isV2313DriveTimingWithinBudget)) throw new Error('V2313_DATABASE_TIMING_BUDGET');
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
      performance, assertions: checkpointValidation?.assertions ?? 143,
      retainedCheckpoint: checkpointValidation ? { ...checkpointValidation, sql: undefined, performance: undefined } : null,
    };
    writeFileSync(path.join(evidenceDirectory, 'evidence.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    return result;
  } });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(verifyV2313Database({ retainProtection: process.argv.includes('--retain-protection'), retainCheckpoint: process.argv.includes('--retain-checkpoint') }), null, 2)); }
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
