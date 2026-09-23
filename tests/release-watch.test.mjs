import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runReleaseWatch } from '../scripts/release-watch.mjs';

const repository = 'example/release-app';
const runId = '42';
const sha = 'a'.repeat(40);
const branch = 'release/candidate';
const workflowPath = '.github/workflows/performance-monitor.yml';
const workflow = { id: 10, path: workflowPath, state: 'active' };
const identity = {
  id: 42, workflow_id: 10, path: workflowPath, event: 'workflow_dispatch',
  head_branch: branch, head_sha: sha, repository: { full_name: repository },
};
const exactRun = {
  ...identity, run_number: 7, run_attempt: 1,
  head_repository: { full_name: repository },
};
const completed = {
  databaseId: 42, headSha: sha, status: 'completed', conclusion: 'success',
  url: `https://github.com/${repository}/actions/runs/42`,
  jobs: [{ name: 'validation / unit', status: 'completed', conclusion: 'success' }],
};
const runs = entries => ({ total_count: entries.length, workflow_runs: entries });

function fixture(responses) {
  const calls = [];
  const output = [];
  function spawnProcess(program, args, options) {
    calls.push({ program, args, options });
    const response = responses[calls.length - 1];
    assert.ok(response, `Unexpected command: ${program} ${args.join(' ')}`);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = signal => {
      queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    queueMicrotask(() => {
      if (response.error) return child.emit('error', response.error);
      if (response.hang) return;
      if (response.stdout !== undefined) child.stdout.end(response.stdout);
      if (response.stderr !== undefined) child.stderr.end(response.stderr);
      child.emit('close', response.code ?? 0, response.signal ?? null);
    });
    return child;
  }
  return {
    calls, output,
    run: options => runReleaseWatch({
      argv: ['--repo', repository, '--run', runId, '--sha', sha],
      spawnProcess, print: line => output.push(line), ...options,
    }),
  };
}

test('invalid arguments and mismatched run identity fail before watching', async () => {
  await assert.rejects(runReleaseWatch({ argv: ['--repo', repository, '--run', 'x'] }), /RELEASE_WATCH_USAGE/);
  const f = fixture([
    { stdout: JSON.stringify(workflow) },
    { stdout: JSON.stringify({ ...identity, repository: { full_name: 'other/repo' } }) },
  ]);
  await assert.rejects(f.run(), /RELEASE_WATCH_IDENTITY_INVALID/);
  assert.equal(f.calls.length, 2);
});

test('wrong workflow or event cannot be watched', async () => {
  for (const patch of [{ workflow_id: 11 }, { path: '.github/workflows/other.yml' }, { event: 'push' }]) {
    const f = fixture([
      { stdout: JSON.stringify(workflow) },
      { stdout: JSON.stringify({ ...identity, ...patch }) },
    ]);
    await assert.rejects(f.run(), /RELEASE_WATCH_IDENTITY_INVALID/);
    assert.equal(f.calls.length, 2);
  }
});

test('successful watch pins github.com, stays quiet and reports status only', async () => {
  const f = fixture([
    { stdout: JSON.stringify(workflow) },
    { stdout: JSON.stringify(identity) },
    { code: 0 },
    { stdout: JSON.stringify(completed) },
  ]);
  const result = await f.run();
  assert.equal(result.state, 'success');
  assert.deepEqual(f.calls[2].args, [
    'run', 'watch', runId, '--repo', `github.com/${repository}`, '--exit-status', '--interval', '60',
  ]);
  assert.deepEqual(f.calls[3].args.slice(0, 5), ['run', 'view', runId, '--repo', `github.com/${repository}`]);
  assert.deepEqual(f.calls[2].options.stdio, ['ignore', 'ignore', 'ignore']);
  assert.ok(f.calls.every(call => call.program === 'gh'));
  assert.ok(f.calls.every(call => !['workflow', 'rerun', 'cancel', 'delete'].includes(call.args[0])));
  assert.match(f.output.join('\n'), /Status only; release approval still requires release-candidate check/);
});

test('branch discovery waits quietly for the latest exact run and rejects wrong runs', async () => {
  const f = fixture([
    { stdout: JSON.stringify(workflow) },
    { stdout: JSON.stringify(runs([])) },
    { stdout: JSON.stringify(runs([exactRun])) },
    { stdout: JSON.stringify(identity) },
    { code: 0 },
    { stdout: JSON.stringify(completed) },
    { stdout: JSON.stringify(runs([exactRun])) },
  ]);
  const result = await f.run({
    argv: ['--repo', repository, '--branch', branch, '--sha', sha],
    setTimeoutFn(callback) { queueMicrotask(callback); return 7; },
    clearTimeoutFn() {},
  });
  assert.equal(result.runId, 42);
  assert.equal(f.calls[4].args[2], runId);

  const wrong = fixture([
    { stdout: JSON.stringify(workflow) },
    { stdout: JSON.stringify(runs([{ ...exactRun, event: 'push' }])) },
  ]);
  await assert.rejects(wrong.run({
    argv: ['--repo', repository, '--branch', branch, '--sha', sha],
  }), /RELEASE_WATCH_IDENTITY_INVALID/);
  assert.equal(wrong.calls.length, 2);
});

test('failed watch prints a compact failed-job summary and never reruns', async () => {
  const failed = {
    ...completed, conclusion: 'failure',
    jobs: [{ name: 'validation / database', status: 'completed', conclusion: 'failure' }],
  };
  const f = fixture([
    { stdout: JSON.stringify(workflow) },
    { stdout: JSON.stringify(identity) },
    { code: 1 },
    { stdout: JSON.stringify(failed) },
  ]);
  await assert.rejects(f.run(), /RELEASE_WATCH_FAILED/);
  assert.equal(f.calls.length, 4);
  assert.match(f.output.join('\n'), /validation \/ database \(failure\)/);
});

test('hanging metadata and watch are both bounded by the overall deadline', async () => {
  const metadata = fixture([{ hang: true }]);
  await assert.rejects(metadata.run({
    timeoutMs: 1234,
    setTimeoutFn(callback) { queueMicrotask(callback); return 7; },
    clearTimeoutFn() {},
  }), /RELEASE_WATCH_TIMEOUT/);
  assert.equal(metadata.calls.length, 1);

  const elapsed = fixture([{ stdout: JSON.stringify(workflow) }]);
  let clock = -600;
  await assert.rejects(elapsed.run({
    timeoutMs: 1000,
    now() { clock += 600; return clock; },
  }), /RELEASE_WATCH_TIMEOUT/);
  assert.equal(elapsed.calls.length, 1);
});

test('watch timeout stops the subprocess and still prints one compact final summary', async () => {
  const active = { ...completed, status: 'in_progress', conclusion: null, jobs: [] };
  const f = fixture([
    { stdout: JSON.stringify(workflow) },
    { stdout: JSON.stringify(identity) },
    { hang: true },
    { stdout: JSON.stringify(active) },
  ]);
  await assert.rejects(f.run({
    timeoutMs: 1234,
    setTimeoutFn(callback) { queueMicrotask(callback); return 7; },
    clearTimeoutFn() {},
  }), /RELEASE_WATCH_TIMEOUT/);
  assert.equal(f.calls.length, 4);
  assert.match(f.output.join('\n'), /timed out while in_progress/);
});

test('post-watch run ID or SHA mismatch fails closed', async () => {
  const f = fixture([
    { stdout: JSON.stringify(workflow) },
    { stdout: JSON.stringify(identity) },
    { code: 0 },
    { stdout: JSON.stringify({ ...completed, headSha: 'b'.repeat(40) }) },
  ]);
  await assert.rejects(f.run(), /RELEASE_WATCH_IDENTITY_INVALID/);
});
