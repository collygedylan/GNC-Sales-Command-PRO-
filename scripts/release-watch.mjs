import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const WORKFLOW = 'performance-monitor.yml';
const WORKFLOW_PATH = `.github/workflows/${WORKFLOW}`;
const DEFAULT_TIMEOUT_MS = 3 * 60 * 60_000;
const usage = 'Usage: node scripts/release-watch.mjs --repo OWNER/REPO (--run RUN_ID [--sha SHA] | --branch BRANCH --sha SHA)';
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--repo', '--run', '--branch', '--sha'].includes(flag) || !value || values.has(flag)) {
      fail('RELEASE_WATCH_USAGE', usage);
    }
    values.set(flag, value);
  }
  const repository = values.get('--repo');
  const runId = values.get('--run');
  const branch = values.get('--branch');
  const sha = values.get('--sha')?.toLowerCase() || null;
  if (!repository || !REPOSITORY.test(repository) || Boolean(runId) === Boolean(branch) ||
      (runId && (!/^[1-9]\d*$/.test(runId) || !Number.isSafeInteger(Number(runId)))) ||
      (branch && (!BRANCH.test(branch) || !sha)) || (sha && !SHA.test(sha))) {
    fail('RELEASE_WATCH_USAGE', usage);
  }
  return { repository, runId: runId || null, branch: branch || null, sha };
}

export async function runReleaseWatch({
  argv = [], spawnProcess = spawn, print = console.log, cwd = process.cwd(),
  timeoutMs = DEFAULT_TIMEOUT_MS, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
  now = Date.now,
} = {}) {
  const expected = parseArgs(argv);
  const deadline = now() + timeoutMs;

  function run(args, { capture = true, bounded = false, waitTimeoutMs = timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const child = spawnProcess('gh', args, {
        cwd, shell: false, windowsHide: true,
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore'],
        env: process.env,
      });
      if (capture) {
        child.stdout?.setEncoding?.('utf8');
        child.stderr?.setEncoding?.('utf8');
        child.stdout?.on('data', chunk => { stdout += chunk; });
        child.stderr?.on('data', chunk => { stderr += chunk; });
      }
      const timer = bounded ? setTimeoutFn(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, waitTimeoutMs) : null;
      child.once('error', error => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeoutFn(timer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeoutFn(timer);
        resolve({ code, signal, stdout, stderr, timedOut });
      });
    });
  }

  async function json(args, code) {
    const remaining = deadline - now();
    if (remaining <= 0) fail('RELEASE_WATCH_TIMEOUT', 'The watcher deadline expired while reading run metadata.');
    const result = await run(args, { bounded: true, waitTimeoutMs: remaining });
    if (result.timedOut) fail('RELEASE_WATCH_TIMEOUT', 'Run metadata exceeded the watcher deadline.');
    if (result.code !== 0) fail(code, 'GitHub run metadata is unavailable.');
    try { return JSON.parse(result.stdout); } catch { fail(code, 'GitHub returned invalid run metadata.'); }
  }

  let selectedAttempt = null;
  let workflowMetadata = null;
  async function expectedWorkflow() {
    if (workflowMetadata) return workflowMetadata;
    workflowMetadata = await json([
      'api', '--hostname', 'github.com', '--method', 'GET',
      `repos/${expected.repository}/actions/workflows/${WORKFLOW}`,
    ], 'RELEASE_WATCH_WORKFLOW_INVALID');
    if (!Number.isSafeInteger(workflowMetadata?.id) || workflowMetadata.id < 1 ||
        workflowMetadata.path !== WORKFLOW_PATH || workflowMetadata.state !== 'active') {
      fail('RELEASE_WATCH_WORKFLOW_INVALID', 'The expected active performance benchmark workflow is unavailable.');
    }
    return workflowMetadata;
  }

  async function latestExactRun({ missingAllowed = false } = {}) {
    const workflow = await expectedWorkflow();
    const endpoint = `repos/${expected.repository}/actions/workflows/${workflow.id}/runs?${new URLSearchParams({
      branch: expected.branch, event: 'workflow_dispatch', head_sha: expected.sha, per_page: '100',
    })}`;
    const page = await json([
      'api', '--hostname', 'github.com', '--method', 'GET', endpoint,
    ], 'RELEASE_WATCH_RUNS_INVALID');
    if (!Number.isSafeInteger(page?.total_count) || !Array.isArray(page.workflow_runs) ||
        page.total_count !== page.workflow_runs.length || page.total_count > 100) {
      fail('RELEASE_WATCH_RUNS_INVALID', 'The exact-commit benchmark list is incomplete or too large.');
    }
    if (!page.workflow_runs.length) {
      if (missingAllowed) return null;
      fail('RELEASE_WATCH_RUN_MISSING', 'No exact-commit manual benchmark was found.');
    }
    for (const run of page.workflow_runs) {
      if (!Number.isSafeInteger(run?.id) || run.id < 1 || !Number.isSafeInteger(run.run_number) || run.run_number < 1 ||
          !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || run.workflow_id !== workflow.id ||
          run.path !== WORKFLOW_PATH || run.event !== 'workflow_dispatch' || run.head_branch !== expected.branch ||
          String(run.head_sha).toLowerCase() !== expected.sha ||
          run.head_repository?.full_name?.toLowerCase() !== expected.repository.toLowerCase()) {
        fail('RELEASE_WATCH_IDENTITY_INVALID', 'A discovered run has the wrong workflow, repository, event, branch, SHA or attempt.');
      }
    }
    if (new Set(page.workflow_runs.map(run => run.id)).size !== page.workflow_runs.length ||
        new Set(page.workflow_runs.map(run => run.run_number)).size !== page.workflow_runs.length) {
      fail('RELEASE_WATCH_RUNS_INVALID', 'The exact-commit benchmark list is duplicate or ambiguous.');
    }
    return page.workflow_runs.sort((a, b) => b.run_number - a.run_number)[0];
  }

  const workflow = await expectedWorkflow();
  if (expected.branch) {
    let discovered = await latestExactRun({ missingAllowed: true });
    while (!discovered) {
      const remaining = deadline - now();
      if (remaining <= 0) fail('RELEASE_WATCH_TIMEOUT', 'No exact-commit benchmark appeared before the watcher deadline.');
      await new Promise(resolve => setTimeoutFn(resolve, Math.min(5_000, remaining)));
      discovered = await latestExactRun({ missingAllowed: true });
    }
    expected.runId = String(discovered.id);
    selectedAttempt = discovered.run_attempt;
  }

  const before = await json([
    'api', '--hostname', 'github.com', '--method', 'GET',
    `repos/${expected.repository}/actions/runs/${expected.runId}`,
  ], 'RELEASE_WATCH_IDENTITY_INVALID');
  const observedSha = String(before?.head_sha || '').toLowerCase();
  if (String(before?.id) !== expected.runId ||
      before?.repository?.full_name?.toLowerCase() !== expected.repository.toLowerCase() ||
      before.workflow_id !== workflow.id || before.path !== WORKFLOW_PATH || before.event !== 'workflow_dispatch' ||
      (expected.branch && before.head_branch !== expected.branch) ||
      !SHA.test(observedSha) || (expected.sha && expected.sha !== observedSha)) {
    fail('RELEASE_WATCH_IDENTITY_INVALID', 'The run does not match the expected workflow, repository, event, branch, run ID or SHA.');
  }

  const remaining = deadline - now();
  if (remaining <= 0) fail('RELEASE_WATCH_TIMEOUT', 'The watcher deadline expired before the run could be watched.');
  const summaryReserveMs = Math.min(60_000, Math.max(1, Math.floor(timeoutMs / 10)));
  const watchTimeoutMs = Math.max(1, remaining - summaryReserveMs);
  let watched;
  try {
    watched = await run([
      'run', 'watch', expected.runId, '--repo', `github.com/${expected.repository}`,
      '--exit-status', '--interval', '60',
    ], { capture: false, bounded: true, waitTimeoutMs: watchTimeoutMs });
  } catch {
    fail('RELEASE_WATCH_COMMAND_FAILED', 'gh run watch could not be started.');
  }

  const summary = await json([
    'run', 'view', expected.runId, '--repo', `github.com/${expected.repository}`,
    '--json', 'databaseId,headSha,status,conclusion,url,jobs',
  ], 'RELEASE_WATCH_SUMMARY_INVALID');
  if (String(summary?.databaseId) !== expected.runId ||
      String(summary?.headSha || '').toLowerCase() !== observedSha || !Array.isArray(summary.jobs)) {
    fail('RELEASE_WATCH_IDENTITY_INVALID', 'The completed view does not match the expected run ID or SHA.');
  }
  if (expected.branch) {
    const confirmed = await latestExactRun();
    if (String(confirmed.id) !== expected.runId || confirmed.run_attempt !== selectedAttempt) {
      fail('RELEASE_WATCH_SUPERSEDED', 'A newer exact-commit benchmark or rerun superseded the watched run.');
    }
  }

  const failedJobs = summary.jobs
    .filter(job => !['success', 'skipped'].includes(job?.conclusion))
    .map(job => `${job.name || 'unnamed job'} (${job.conclusion || job.status || 'unknown'})`);
  const state = summary.conclusion || summary.status || 'unknown';
  if (watched.timedOut) {
    print(`Run ${expected.runId} timed out while ${state}. Failed jobs: ${failedJobs.join(', ') || 'none reported'}.`);
    fail('RELEASE_WATCH_TIMEOUT', `Run watch exceeded ${timeoutMs}ms and was stopped.`);
  }
  if (watched.code !== 0 || summary.status !== 'completed' || summary.conclusion !== 'success') {
    print(`Run ${expected.runId} ended ${state}. Failed jobs: ${failedJobs.join(', ') || 'none reported'}.`);
    fail('RELEASE_WATCH_FAILED', 'The watched run did not complete successfully; it was not rerun.');
  }

  print(`Run ${expected.runId} completed successfully at ${observedSha}. Status only; release approval still requires release-candidate check.`);
  return { state: 'success', repository: expected.repository, runId: Number(expected.runId), sha: observedSha, url: summary.url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runReleaseWatch({ argv: process.argv.slice(2) }); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
