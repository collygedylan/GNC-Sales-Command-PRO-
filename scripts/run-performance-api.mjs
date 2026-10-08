import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBenchmarkManifest, compareBenchmarks } from '../services/performanceBaseline.ts';
import { aggregateApiPassReports, API_PAIR_SCHEDULE } from './performance-api-passes.mjs';
import { inspectDisposableSupabaseWorkspace } from './disposable-supabase-container.mjs';
import { assertPerformanceApiPath, assertPerformanceApiTree, PERFORMANCE_API_SOURCE_DIRECTORIES, clearPerformanceApiSources, restorePerformanceApiSources, stagePerformanceApiSources, validatePerformanceApiRoots } from './performance-api-source-snapshots.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';

// Run before the existing Auth smoke starts its own function server.
// Only source directories in the verified disposable project are switched; the
// same database, CLI, environment and benchmark driver serve both revisions.
if (process.env.GITHUB_ACTIONS !== 'true' || process.platform === 'win32') throw new Error('PERFORMANCE_API_PAIR_CLOUD_ONLY');
if (process.argv.length !== 3) throw new Error('Usage: node scripts/run-performance-api.mjs <verified-workspace>');
const manifest = parseBenchmarkManifest(JSON.parse(readFileSync(path.join(repoRoot, 'performance/baseline.json'), 'utf8')));
const cli = packageBin('supabase', 'supabase');
const workspace = inspectDisposableSupabaseWorkspace({ workspaceRoot: process.argv[2], cli }).absolute;
const status = runNode([cli, '--workdir', workspace, 'status', '--output', 'env'], { capture: true });
const values = Object.fromEntries(status.split(/\r?\n/).map(line => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map(match => [match[1], match[2]]));
const api = new URL(values.API_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) || api.protocol !== 'http:' || !values.SERVICE_ROLE_KEY) throw new Error('PERFORMANCE_LOCAL_AUTH_ENV_REQUIRED');
const runId = process.env.GITHUB_RUN_ID || '';
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '';
if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)) throw new Error('PERFORMANCE_CI_RUN_ID_INVALID');
const temp = mkdtempSync(path.join(os.tmpdir(), 'gnc-performance-api-'));
const files = PERFORMANCE_API_SOURCE_DIRECTORIES;
const output = path.join(repoRoot, 'artifacts/performance');
mkdirSync(output, { recursive: true });
const passOutput = path.join(output, `database-api-passes-${runId}-${runAttempt}`);
mkdirSync(passOutput, { recursive: true });
const sources = path.join(temp, 'baseline');
const backup = path.join(temp, 'candidate');
let candidateSnapshot;
let server;
const envFile = path.join(temp, 'function.env');
function removeOwnedTemporaryDirectory() {
  if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('gnc-performance-api-')) throw new Error('PERFORMANCE_CLEANUP_PATH_INVALID');
  assertPerformanceApiPath(temp);
  const info = lstatSync(temp);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('PERFORMANCE_CLEANUP_PATH_INVALID');
  assertPerformanceApiTree(temp);
  rmSync(temp, { recursive: true, force: false });
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) { server = undefined; return; }
  const current = server;
  const stopped = new Promise(resolve => current.once('exit', resolve));
  try { process.kill(-current.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  const timeout = setTimeout(() => { try { process.kill(-current.pid, 'SIGKILL'); } catch { /* already stopped */ } }, 5000);
  await stopped;
  clearTimeout(timeout);
  server = undefined;
}

async function measure(revision, passIndex, commit, source) {
  validatePerformanceApiRoots({ workspaceRoot: workspace, repositoryRoot: repoRoot, candidateRoot: backup });
  for (const relative of files) {
    const target = path.join(workspace, relative);
    const sourceTree = path.join(source, relative);
    assertPerformanceApiPath(target);
    assertPerformanceApiTree(sourceTree);
    cpSync(sourceTree, target, { recursive: true, errorOnExist: true, force: false });
  }
  server = spawn(process.execPath, [cli, '--workdir', workspace, 'functions', 'serve', '--env-file', envFile, '--no-verify-jwt'],
    { cwd: repoRoot, detached: true, stdio: 'ignore', env: process.env });
  let startupError;
  server.on('error', error => { startupError = error; });
  // The benchmark child runs synchronously; inherited pipes could fill and
  // deadlock serving. Do not persist local credentials from function logs.
  let ready = false;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (startupError || server.exitCode !== null) throw new Error('PERFORMANCE_FUNCTION_SERVER_FAILED', { cause: startupError });
      try {
        const response = await fetch(new URL('/functions/v1/app-api', api), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(2000) });
        await response.arrayBuffer();
        if ([400, 401, 403, 405, 422].includes(response.status)) { ready = true; break; }
      } catch { /* bounded readiness retry */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('PERFORMANCE_FUNCTION_SERVER_NOT_READY');
    const reportPath = path.join(passOutput, `pass-${String(passIndex).padStart(2, '0')}-${revision}.json`);
    runNode(['scripts/performance-database.mjs', '--api-workspace', workspace, '--cli', cli], {
      capture: true, env: { EXPECTED_PROJECT_REF: 'local', PERFORMANCE_SOURCE_COMMIT: commit, PERFORMANCE_REPORT_PATH: reportPath }
    });
    return JSON.parse(readFileSync(reportPath, 'utf8'));
  } finally {
    try { await stopServer(); }
    finally {
      clearPerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repoRoot, candidateRoot: backup });
    }
  }
}

try {
  mkdirSync(sources, { recursive: true });
  const archive = path.join(temp, 'source.tar');
  run('git', ['archive', '--format=tar', '--output', archive, manifest.baselineCommit, '--', ...files]);
  run('tar', ['-xf', archive, '-C', sources]);
  candidateSnapshot = stagePerformanceApiSources({ workspaceRoot: workspace, repositoryRoot: repoRoot, candidateRoot: backup });
  writeFileSync(envFile, `SUPABASE_URL=${api.origin}\nSUPABASE_SERVICE_ROLE_KEY=${values.SERVICE_ROLE_KEY}\nAPP_SESSION_SECRET=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  const candidateCommit = run('git', ['rev-parse', 'HEAD'], { capture: true }).trim();
  const reports = [];
  for (let index = 0; index < API_PAIR_SCHEDULE.length; index += 1) {
    const revision = API_PAIR_SCHEDULE[index];
    reports.push({ revision, report: await measure(revision, index + 1,
      revision === 'baseline' ? manifest.baselineCommit : candidateCommit,
      revision === 'baseline' ? sources : backup) });
  }
  const { baseline, candidate } = aggregateApiPassReports(reports, {
    baselineCommit: manifest.baselineCommit, candidateCommit,
    expectedSamplesPerPass: manifest.coldSamples + manifest.warmSamples,
  });
  const failures = compareBenchmarks(manifest, baseline, candidate);
  writeFileSync(path.join(output, 'database-api-comparison.json'), `${JSON.stringify({ manifest,
    passSchedule: API_PAIR_SCHEDULE, passFiles: reports.map((entry, index) => ({
      pass: index + 1, revision: entry.revision,
      file: path.relative(output, path.join(passOutput, `pass-${String(index + 1).padStart(2, '0')}-${entry.revision}.json`)).replaceAll(path.sep, '/'),
    })), baseline, candidate, failures }, null, 2)}\n`);
  if (failures.length) throw new Error(`PERFORMANCE_API_REGRESSION:\n${failures.join('\n')}`);
} finally {
  try { await stopServer(); }
  finally {
    if (candidateSnapshot) restorePerformanceApiSources(candidateSnapshot);
    removeOwnedTemporaryDirectory();
  }
}
