import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKFLOW = 'performance-monitor.yml';
const WORKFLOW_PATH = `.github/workflows/${WORKFLOW}`;
const SHA = /^[a-f0-9]{40}$/;
const usage = 'Usage: node scripts/release-candidate.mjs prepare [--dispatch] | check [--run RUN_ID]';
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };

function repositoryFromRemote(value) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (!match) fail('CANDIDATE_ORIGIN_INVALID', 'origin must have one GitHub HTTPS or SSH repository URL.');
  return match[1];
}

export function runReleaseCandidate({ argv = [], invoke = spawnSync, cwd = process.cwd(), print = console.log } = {}) {
  const [command, ...flags] = argv;
  const dispatch = command === 'prepare' && flags.length === 1 && flags[0] === '--dispatch';
  const runId = command === 'check' && flags.length === 2 && flags[0] === '--run' && /^[1-9]\d*$/.test(flags[1]) ? flags[1] : null;
  if (!['prepare', 'check'].includes(command) || (flags.length && !dispatch && !runId)) fail('CANDIDATE_USAGE', usage);

  function call(program, args) {
    const result = invoke(program, args, {
      cwd, shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
      // Prevent status from refreshing the index; do not rely on GH_REPO/GH_HOST.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    if (result.error || result.status !== 0) fail('CANDIDATE_COMMAND_FAILED', `${program} ${args[0]} failed; no release is approved.`);
    return String(result.stdout || '').trim();
  }
  const git = (...args) => call('git', args);
  function api(endpoint, extra = []) {
    const response = call('gh', ['api', '--hostname', 'github.com', '--method', 'GET', endpoint, ...extra]);
    try { return JSON.parse(response); } catch { fail('CANDIDATE_RESPONSE_INVALID', 'GitHub returned invalid JSON.'); }
  }

  function localCandidate() {
    const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD');
    if (branch === 'main' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
      fail('CANDIDATE_BRANCH_INVALID', 'Use a named release branch with ordinary letters, numbers, dots, slashes, hyphens or underscores.');
    }
    git('check-ref-format', `refs/heads/${branch}`);
    const head = git('rev-parse', '--verify', 'HEAD^{commit}');
    const main = git('rev-parse', '--verify', 'refs/remotes/origin/main^{commit}');
    if (!SHA.test(head) || !SHA.test(main)) fail('CANDIDATE_SHA_INVALID', 'HEAD and origin/main must resolve to complete commit IDs.');
    if (git('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none')) {
      fail('CANDIDATE_DIRTY', 'Commit or remove the intended changes, including untracked files and submodule changes, before continuing.');
    }
    // These index flags can otherwise conceal tracked changes from status.
    if (git('ls-files', '-v', '-z', '--full-name', ':/').split('\0').some(entry => /^[a-zS] /.test(entry))) {
      fail('CANDIDATE_HIDDEN_CHANGES', 'Clear assume-unchanged/skip-worktree flags before checking a release candidate.');
    }
    const fetchUrl = git('remote', 'get-url', '--all', 'origin');
    const pushUrl = git('remote', 'get-url', '--push', '--all', 'origin');
    const repository = repositoryFromRemote(fetchUrl);
    if (repositoryFromRemote(pushUrl).toLowerCase() !== repository.toLowerCase()) {
      fail('CANDIDATE_ORIGIN_MISMATCH', 'origin fetch and push URLs must identify the same repository.');
    }
    git('merge-base', '--is-ancestor', main, head);
    return { branch, head, main, repository, fetchUrl, pushUrl };
  }

  function remoteCandidate(candidate) {
    const names = ['refs/heads/main', `refs/heads/${candidate.branch}`, `refs/tags/${candidate.branch}`];
    const output = git('ls-remote', 'origin', ...names);
    const refs = new Map();
    for (const line of output ? output.split(/\r?\n/) : []) {
      const fields = line.split(/\s+/);
      if (fields.length !== 2 || !SHA.test(fields[0]) || !names.includes(fields[1]) || refs.has(fields[1])) {
        fail('CANDIDATE_REMOTE_INVALID', 'Remote refs are missing, ambiguous or malformed.');
      }
      refs.set(fields[1], fields[0]);
    }
    if (!refs.has(names[0])) fail('CANDIDATE_REMOTE_INVALID', 'origin has no main branch.');
    if (refs.get(names[0]) !== candidate.main) {
      fail('CANDIDATE_MAIN_STALE', 'origin/main is stale. Run git fetch origin, integrate current main, then prepare again.');
    }
    if (refs.has(names[2])) fail('CANDIDATE_REF_AMBIGUOUS', 'The release branch also names a remote tag; use an unambiguous branch.');
    return { main: refs.get(names[0]), branch: refs.get(names[1]) || null };
  }

  const candidate = localCandidate();
  const remote = remoteCandidate(candidate);
  function unchanged() {
    if (JSON.stringify(localCandidate()) !== JSON.stringify(candidate) ||
        JSON.stringify(remoteCandidate(candidate)) !== JSON.stringify(remote) ||
        JSON.stringify(localCandidate()) !== JSON.stringify(candidate)) {
      fail('CANDIDATE_CHANGED', 'The candidate, origin or remote branch changed during preflight; run it again.');
    }
  }
  const published = remote.branch === candidate.head;
  if (!published && (command === 'check' || dispatch)) {
    fail('CANDIDATE_BRANCH_NOT_PUSHED', 'The remote release branch must point to this exact HEAD before dispatch or check. Run prepare for the branch push command.');
  }

  const workflow = api(`repos/${candidate.repository}/actions/workflows/${WORKFLOW}`);
  if (!Number.isSafeInteger(workflow?.id) || workflow.id < 1 || workflow.path !== WORKFLOW_PATH || workflow.state !== 'active') {
    fail('CANDIDATE_WORKFLOW_INVALID', 'The expected active performance benchmark workflow is unavailable.');
  }
  const dispatchCommand = `gh workflow run ${WORKFLOW} --repo 'github.com/${candidate.repository}' --ref '${candidate.branch}'`;
  if (command === 'prepare') {
    unchanged();
    if (dispatch) {
      // Only this opt-in path writes remotely, and only to start branch validation.
      call('gh', ['workflow', 'run', WORKFLOW, '--repo', `github.com/${candidate.repository}`, '--ref', candidate.branch]);
      unchanged();
    }
    const result = { state: dispatch ? 'benchmark-dispatched' : 'prepared', ...candidate, published };
    print(`Candidate ${candidate.head} on ${candidate.branch}; base ${candidate.main}.`);
    if (!published) print(`Next: git push origin '${candidate.head}:refs/heads/${candidate.branch}'`);
    else if (!dispatch) print(`Next: ${dispatchCommand}`);
    if (dispatch) print('Branch benchmark requested. Once it completes, run: node scripts/release-candidate.mjs check');
    else print('Prepared only; no benchmark success or production release is approved.');
    return result;
  }

  const runsEndpoint = `repos/${candidate.repository}/actions/workflows/${workflow.id}/runs?${new URLSearchParams({
    branch: candidate.branch, event: 'workflow_dispatch', head_sha: candidate.head, per_page: '100',
  })}`;
  function latestRun() {
    // Never filter for success: a newer queued, failed or cancelled run blocks.
    const page = api(runsEndpoint);
    if (!Number.isSafeInteger(page?.total_count) || !Array.isArray(page.workflow_runs) ||
        page.total_count !== page.workflow_runs.length || page.total_count > 100) {
      fail('CANDIDATE_RUNS_INCOMPLETE', 'The exact-commit benchmark list is incomplete or too large; inspect it before releasing.');
    }
    if (!page.workflow_runs.length) fail('CANDIDATE_BENCHMARK_MISSING', `No manual benchmark exists for this exact branch and HEAD. Next: ${dispatchCommand}`);
    for (const run of page.workflow_runs) {
      if (!Number.isSafeInteger(run?.id) || run.id < 1 || !Number.isSafeInteger(run.run_number) || run.run_number < 1 ||
          !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || run.workflow_id !== workflow.id ||
          run.path !== WORKFLOW_PATH || run.event !== 'workflow_dispatch' || run.head_branch !== candidate.branch ||
          run.head_sha !== candidate.head || run.head_repository?.full_name?.toLowerCase() !== candidate.repository.toLowerCase()) {
        fail('CANDIDATE_RUN_IDENTITY_INVALID', 'A benchmark has the wrong workflow, repository, event, branch, SHA or attempt.');
      }
    }
    if (new Set(page.workflow_runs.map(run => run.id)).size !== page.workflow_runs.length ||
        new Set(page.workflow_runs.map(run => run.run_number)).size !== page.workflow_runs.length) {
      fail('CANDIDATE_RUNS_INCOMPLETE', 'The benchmark list contains duplicate or ambiguous runs.');
    }
    const latest = page.workflow_runs.sort((a, b) => b.run_number - a.run_number)[0];
    if (runId && String(latest.id) !== runId) fail('CANDIDATE_RUN_SUPERSEDED', '--run must identify the latest benchmark for this branch and HEAD.');
    if (latest.status !== 'completed' || latest.conclusion !== 'success') {
      fail('CANDIDATE_BENCHMARK_NOT_GREEN', `Latest exact-commit benchmark ${latest.id} is ${latest.conclusion || latest.status || 'unknown'}. Fix the cause before releasing.`);
    }
    return latest;
  }
  const run = latestRun();
  const pages = api(`repos/${candidate.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, ['--paginate', '--slurp']);
  if (!Array.isArray(pages) || !pages.length || pages.some(page => !Array.isArray(page?.jobs))) {
    fail('CANDIDATE_JOBS_INVALID', 'The benchmark job list is unavailable.');
  }
  const jobs = pages.flatMap(page => page.jobs);
  if (pages.some(page => page.total_count !== jobs.length) || new Set(jobs.map(job => job.id)).size !== jobs.length ||
      jobs.some(job => !Number.isSafeInteger(job.id) || job.id < 1 || job.run_id !== run.id || job.head_sha !== candidate.head || job.status !== 'completed' ||
        (job.conclusion !== 'success' && !(job.name === 'validation / production-health' && job.conclusion === 'skipped')))) {
    fail('CANDIDATE_JOB_NOT_GREEN', 'Benchmark jobs are incomplete, from another commit, or contain a failed/cancelled/skipped required lane.');
  }
  const gates = jobs.filter(job => job.name === 'validation / release-gate');
  if (gates.length !== 1 || gates[0].conclusion !== 'success' ||
      !gates[0].steps?.some(step => step.name === 'Require every safety lane for this commit' && step.status === 'completed' && step.conclusion === 'success')) {
    fail('CANDIDATE_RELEASE_GATE_MISSING', 'The sealed release gate did not execute successfully.');
  }
  const confirmedRun = latestRun();
  if (confirmedRun.id !== run.id || confirmedRun.run_attempt !== run.run_attempt) {
    fail('CANDIDATE_RUN_CHANGED', 'A new benchmark or rerun started during preflight; check again after it completes.');
  }
  unchanged();
  const result = { state: 'verified', ...candidate, runId: run.id, attempt: run.run_attempt };
  print(`Verified candidate ${candidate.head} on ${candidate.branch} against origin/main ${candidate.main}.`);
  print(`Benchmark: https://github.com/${candidate.repository}/actions/runs/${run.id} (attempt ${run.run_attempt}).`);
  print(`Next, for an authorized release, rerun this check immediately before the normal fast-forward push: git push origin '${candidate.head}:refs/heads/main'`);
  print('No push or deployment was performed. This is a point-in-time preflight; main Pages validation and exact-live checks still apply.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runReleaseCandidate({ argv: process.argv.slice(2) }); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
