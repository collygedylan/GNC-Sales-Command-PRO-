import assert from 'node:assert/strict';
import test from 'node:test';
import { runReleaseCandidate } from '../scripts/release-candidate.mjs';

const head = 'a'.repeat(40);
const main = 'b'.repeat(40);
const other = 'c'.repeat(40);
const repository = 'example/release-app';
const branch = 'release/verified-candidate';
const workflowPath = '.github/workflows/performance-monitor.yml';
const benchmark = () => ({
  id: 42, run_number: 7, run_attempt: 1, workflow_id: 10, path: workflowPath,
  event: 'workflow_dispatch', head_branch: branch, head_sha: head,
  head_repository: { full_name: repository }, status: 'completed', conclusion: 'success',
});
const successfulJob = (name, id) => ({
  id, name: `validation / ${name}`, run_id: 42, head_sha: head,
  status: 'completed', conclusion: 'success', steps: [],
});

function fixture(overrides = {}) {
  const gate = successfulJob('release-gate', 8);
  gate.steps = [{ name: 'Require every safety lane for this commit', status: 'completed', conclusion: 'success' }];
  const health = { ...successfulJob('production-health', 9), conclusion: 'skipped' };
  const state = {
    branch, head, main, dirty: '', index: 'H scripts/file.mjs\0', ancestor: true,
    remoteMain: main, remoteBranch: head, remoteTag: null,
    fetchUrl: `https://github.com/${repository}.git`, pushUrl: `git@github.com:${repository}.git`,
    workflow: { id: 10, path: workflowPath, state: 'active' }, runs: [benchmark()],
    jobs: [...['unit', 'database / database-and-functions', 'build', 'functional (1)', 'compiled (footer)', 'timing', 'lighthouse'].map((name, i) => successfulJob(name, i + 1)), gate, health],
    ...overrides,
  };
  const calls = [];
  const output = [];
  function invoke(program, args, options) {
    calls.push({ program, args, options });
    const replacement = state.before?.(program, args, state, calls);
    if (replacement) return replacement;
    const ok = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
    assert.equal(options.shell, false);
    assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
    if (program === 'git') {
      if (args[0] === 'symbolic-ref') return ok(state.branch);
      if (args[0] === 'check-ref-format') return ok('');
      if (args[0] === 'rev-parse') return ok(args.at(-1) === 'HEAD^{commit}' ? state.head : state.main);
      if (args[0] === 'status') {
        assert.deepEqual(args, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']);
        return ok(state.dirty);
      }
      if (args[0] === 'ls-files') {
        assert.deepEqual(args, ['ls-files', '-v', '-z', '--full-name', ':/']);
        return ok(state.index);
      }
      if (args[0] === 'remote') return ok(args.includes('--push') ? state.pushUrl : state.fetchUrl);
      if (args[0] === 'merge-base') {
        assert.deepEqual(args, ['merge-base', '--is-ancestor', state.main, state.head]);
        return state.ancestor ? ok('') : { status: 1, stdout: '' };
      }
      if (args[0] === 'ls-remote') {
        return ok([
          state.remoteMain && `${state.remoteMain}\trefs/heads/main`,
          state.remoteBranch && `${state.remoteBranch}\trefs/heads/${state.branch}`,
          state.remoteTag && `${state.remoteTag}\trefs/tags/${state.branch}`,
        ].filter(Boolean).join('\n'));
      }
    }
    if (program === 'gh') {
      if (args[0] === 'workflow') return ok('');
      assert.deepEqual(args.slice(0, 5), ['api', '--hostname', 'github.com', '--method', 'GET']);
      const endpoint = args[5];
      if (endpoint === `repos/${repository}/actions/workflows/performance-monitor.yml`) return ok(state.workflow);
      if (endpoint.startsWith(`repos/${repository}/actions/workflows/10/runs?`)) {
        const query = new URLSearchParams(endpoint.split('?')[1]);
        assert.equal(query.get('head_sha'), head);
        assert.equal(query.get('branch'), branch);
        assert.equal(query.get('event'), 'workflow_dispatch');
        assert.equal(query.has('status'), false);
        return ok({ total_count: state.runs.length, workflow_runs: state.runs });
      }
      if (/\/actions\/runs\/\d+\/attempts\/\d+\/jobs\?per_page=100$/.test(endpoint)) {
        assert.deepEqual(args.slice(6), ['--paginate', '--slurp']);
        return ok(state.jobPages || [{ total_count: state.jobs.length, jobs: state.jobs }]);
      }
    }
    assert.fail(`Unexpected command: ${program} ${args.join(' ')}`);
  }
  return { state, calls, output, run: argv => runReleaseCandidate({ argv, invoke, cwd: '/candidate', print: line => output.push(line) }) };
}

test('prepare and check are read-only; check prints an immutable SHA and never pushes or deploys', () => {
  for (const command of ['prepare', 'check']) {
    const f = fixture();
    const result = f.run([command]);
    assert.equal(result.state, command === 'check' ? 'verified' : 'prepared');
    assert.equal(result.head, head);
    assert.ok(f.calls.every(call => call.program === 'git' || call.args[0] === 'api'));
    assert.ok(f.calls.every(call => !['push', 'fetch', 'checkout', 'reset', 'merge', 'add', 'commit', 'deploy'].includes(call.args[0])));
    if (command === 'check') assert.match(f.output.join('\n'), new RegExp(`${head}:refs/heads/main`));
    else assert.doesNotMatch(f.output.join('\n'), /refs\/heads\/main/);
  }
});

test('unpublished and out-of-date branches are only prepared; dispatch/check require exact remote HEAD', () => {
  for (const remoteBranch of [null, other]) {
    const f = fixture({ remoteBranch });
    assert.equal(f.run(['prepare']).published, false);
    assert.match(f.output.join('\n'), new RegExp(`git push origin '${head}:refs/heads/${branch}'`));
    for (const args of [['check'], ['prepare', '--dispatch']]) {
      const blocked = fixture({ remoteBranch });
      assert.throws(() => blocked.run(args), /CANDIDATE_BRANCH_NOT_PUSHED/);
      assert.ok(blocked.calls.every(call => call.args[0] !== 'workflow'));
    }
  }
});

test('only explicit prepare --dispatch starts one branch benchmark', () => {
  const f = fixture();
  assert.equal(f.run(['prepare', '--dispatch']).state, 'benchmark-dispatched');
  assert.deepEqual(f.calls.filter(call => call.args[0] === 'workflow').map(call => call.args), [
    ['workflow', 'run', 'performance-monitor.yml', '--repo', `github.com/${repository}`, '--ref', branch],
  ]);
  assert.doesNotMatch(f.output.join('\n'), /Verified candidate|refs\/heads\/main/);
});

test('unknown flags, main dispatch, and malformed run IDs fail without writes', () => {
  for (const args of [[], ['push'], ['prepare', '--force'], ['prepare', '--run', '42'], ['check', '--dispatch'],
    ['check', '--run', '42;bad'], ['check', '--run', '42', '--dispatch'], ['prepare', '--dispatch', '--dispatch']]) {
    const f = fixture();
    assert.throws(() => f.run(args), /CANDIDATE_USAGE/);
    assert.equal(f.calls.length, 0);
  }
  for (const invalidBranch of ['main', '', 'feature/$inject', 'release/name\nmalformed']) {
    const f = fixture({ branch: invalidBranch });
    assert.throws(() => f.run(['prepare', '--dispatch']), /CANDIDATE_BRANCH_INVALID/);
    assert.ok(f.calls.every(call => call.args[0] !== 'workflow'));
  }
});

test('tracked, staged, untracked, submodule and index-hidden changes block candidates', () => {
  for (const dirty of [' M app.js', 'M  app.js', '?? newly-created-test.mjs', ' m nested-module']) {
    const f = fixture({ dirty });
    assert.throws(() => f.run(['check']), /CANDIDATE_DIRTY/);
  }
  for (const index of ['h hidden.js\0', 'S sparse.js\0', 's hidden-sparse.js\0']) {
    assert.throws(() => fixture({ index }).run(['check']), /CANDIDATE_HIDDEN_CHANGES/);
  }
});

test('stale, missing or unrelated origin/main blocks candidates', () => {
  assert.throws(() => fixture({ remoteMain: other }).run(['check']), /CANDIDATE_MAIN_STALE/);
  assert.throws(() => fixture({ remoteMain: null }).run(['check']), /CANDIDATE_REMOTE_INVALID/);
  assert.throws(() => fixture({ ancestor: false }).run(['check']), /CANDIDATE_COMMAND_FAILED/);
  assert.throws(() => fixture({ head: 'abcdef' }).run(['check']), /CANDIDATE_SHA_INVALID/);
});

test('ambiguous tags, multiple origins, mismatched push destinations and unsafe remote URLs fail closed', () => {
  assert.throws(() => fixture({ remoteTag: head }).run(['prepare', '--dispatch']), /CANDIDATE_REF_AMBIGUOUS/);
  for (const fetchUrl of ['https://other.example/app.git', `https://github.com/${repository}.git\nhttps://github.com/a/b.git`, 'https://token@github.com/a/b.git']) {
    assert.throws(() => fixture({ fetchUrl }).run(['check']), /CANDIDATE_ORIGIN_INVALID/);
  }
  assert.throws(() => fixture({ pushUrl: 'https://github.com/other/repo.git' }).run(['check']), /CANDIDATE_ORIGIN_MISMATCH/);
});

test('wrong, disabled or missing workflow metadata cannot pass', () => {
  for (const workflow of [{ id: 10, path: '.github/workflows/pages-static.yml', state: 'active' },
    { id: 10, path: workflowPath, state: 'disabled_manually' }, null, { path: workflowPath, state: 'active' }]) {
    assert.throws(() => fixture({ workflow }).run(['check']), /CANDIDATE_WORKFLOW_INVALID/);
  }
});

test('benchmark must belong to the exact workflow, event, branch, SHA and repository', () => {
  for (const patch of [{ workflow_id: 11 }, { path: '.github/workflows/pages-static.yml' }, { event: 'pull_request' },
    { event: 'push' }, { event: 'schedule' }, { head_branch: 'main' }, { head_branch: 'another-branch' },
    { head_sha: other }, { head_repository: { full_name: 'attacker/release-app' } }, { head_repository: null },
    { run_attempt: undefined }, { id: '42' }]) {
    assert.throws(() => fixture({ runs: [{ ...benchmark(), ...patch }] }).run(['check']), /CANDIDATE_RUN_IDENTITY_INVALID/);
  }
});

test('missing, pending, failed, skipped, cancelled and neutral runs are never accepted', () => {
  assert.throws(() => fixture({ runs: [] }).run(['check']), /CANDIDATE_BENCHMARK_MISSING/);
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null]) {
    assert.throws(() => fixture({ runs: [{ ...benchmark(), conclusion }] }).run(['check']), /CANDIDATE_BENCHMARK_NOT_GREEN/);
  }
  assert.throws(() => fixture({ runs: [{ ...benchmark(), status: 'in_progress' }] }).run(['check']), /CANDIDATE_BENCHMARK_NOT_GREEN/);
});

test('an older green run cannot bypass a newer pending or failed run, including explicit --run', () => {
  for (const patch of [{ status: 'queued', conclusion: null }, { conclusion: 'failure' }]) {
    const runs = [benchmark(), { ...benchmark(), id: 43, run_number: 8, ...patch }];
    assert.throws(() => fixture({ runs }).run(['check']), /CANDIDATE_BENCHMARK_NOT_GREEN/);
    assert.throws(() => fixture({ runs }).run(['check', '--run', '42']), /CANDIDATE_RUN_SUPERSEDED/);
  }
  assert.equal(fixture().run(['check', '--run', '42']).runId, 42);
});

test('failed historical runs do not invalidate a subsequently successful benchmark', () => {
  const f = fixture({ runs: [{ ...benchmark(), id: 41, run_number: 6, conclusion: 'failure' }, benchmark()] });
  assert.equal(f.run(['check']).state, 'verified');
});

test('duplicate benchmark identities are rejected as ambiguous', () => {
  for (const second of [benchmark(), { ...benchmark(), id: 43 }]) {
    assert.throws(() => fixture({ runs: [benchmark(), second] }).run(['check']), /CANDIDATE_RUNS_INCOMPLETE/);
  }
});

test('sealed gate and actual successful gate step are required', () => {
  for (const change of [
    jobs => jobs.filter(job => job.name !== 'validation / release-gate'),
    jobs => jobs.map(job => job.name.endsWith('release-gate') ? { ...job, steps: [] } : job),
    jobs => jobs.map(job => job.name.endsWith('release-gate') ? { ...job, steps: [{ name: 'Require every safety lane for this commit', status: 'completed', conclusion: 'skipped' }] } : job),
  ]) {
    const f = fixture();
    f.state.jobs = change(f.state.jobs);
    assert.throws(() => f.run(['check']), /CANDIDATE_RELEASE_GATE_MISSING/);
  }
});

test('required jobs cannot fail, disappear from pagination, be duplicated or belong to another run/commit', () => {
  for (const patch of [{ conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' },
    { conclusion: 'neutral' }, { status: 'in_progress' }, { run_id: 43 }, { head_sha: other }]) {
    const f = fixture();
    Object.assign(f.state.jobs[0], patch);
    assert.throws(() => f.run(['check']), /CANDIDATE_JOB_NOT_GREEN/);
  }
  const missing = fixture();
  missing.state.jobPages = [{ total_count: missing.state.jobs.length + 1, jobs: missing.state.jobs }];
  assert.throws(() => missing.run(['check']), /CANDIDATE_JOB_NOT_GREEN/);
  const duplicate = fixture();
  duplicate.state.jobs.push(duplicate.state.jobs[0]);
  assert.throws(() => duplicate.run(['check']), /CANDIDATE_JOB_NOT_GREEN/);
});

test('all job pages and the current attempt are inspected', () => {
  const f = fixture();
  f.state.runs[0].run_attempt = 2;
  f.state.jobPages = [
    { total_count: f.state.jobs.length, jobs: f.state.jobs.slice(0, 4) },
    { total_count: f.state.jobs.length, jobs: f.state.jobs.slice(4) },
  ];
  assert.equal(f.run(['check']).attempt, 2);
  assert.ok(f.calls.some(call => call.args[5]?.includes('/runs/42/attempts/2/jobs')));
});

test('candidate and remote changes during GitHub inspection invalidate the result', () => {
  for (const patch of [{ head: other }, { dirty: '?? late-file.mjs' }, { branch: 'release/new-branch' },
    { remoteBranch: other }, { remoteMain: other }, { pushUrl: 'https://github.com/other/repo.git' }]) {
    const f = fixture({ before(program, args, state) {
      if (program === 'gh' && args[5]?.includes('/jobs?')) Object.assign(state, patch);
    } });
    assert.throws(() => f.run(['check']), /CANDIDATE_(CHANGED|DIRTY|MAIN_STALE|ORIGIN_MISMATCH)/);
    assert.equal(f.output.length, 0);
  }
});

test('new runs and reruns during inspection cannot reuse the earlier green result', () => {
  for (const update of [
    run => ({ ...run, run_attempt: 2 }),
    run => ({ ...run, run_attempt: 2, status: 'in_progress', conclusion: null }),
    run => ({ ...run, id: 43, run_number: 8 }),
  ]) {
    const f = fixture({ before(program, args, state) {
      if (program === 'gh' && args[5]?.includes('/jobs?')) state.runs = [update(state.runs[0])];
    } });
    assert.throws(() => f.run(['check']), /CANDIDATE_(RUN_CHANGED|BENCHMARK_NOT_GREEN)/);
    assert.equal(f.output.length, 0);
  }
});

test('a newly dirty file immediately before dispatch prevents the remote write', () => {
  const f = fixture({ before(program, args, state) {
    if (program === 'gh' && args[5]?.endsWith('/performance-monitor.yml')) state.dirty = '?? unexpected-file.mjs';
  } });
  assert.throws(() => f.run(['prepare', '--dispatch']), /CANDIDATE_DIRTY/);
  assert.ok(f.calls.every(call => call.args[0] !== 'workflow'));
});

test('dispatch does not approve a release and detects a concurrent branch move afterwards', () => {
  const f = fixture({ before(program, args, state) {
    if (program === 'gh' && args[0] === 'workflow') state.remoteBranch = other;
  } });
  assert.throws(() => f.run(['prepare', '--dispatch']), /CANDIDATE_CHANGED/);
  assert.equal(f.calls.filter(call => call.args[0] === 'workflow').length, 1);
  assert.equal(f.output.length, 0);
});

test('git/gh failures, invalid JSON and truncated responses fail closed', () => {
  for (const failure of [{ status: 1, stderr: 'secret must not be printed' }, { status: null, error: new Error('timeout') }]) {
    const f = fixture({ before() { return failure; } });
    assert.throws(() => f.run(['check']), error => /CANDIDATE_COMMAND_FAILED/.test(error.message) && !error.message.includes('secret'));
  }
  for (const payload of ['not json', JSON.stringify({ total_count: 2, workflow_runs: [benchmark()] })]) {
    const f = fixture({ before(program, args) {
      if (program === 'gh' && args[5]?.includes('/runs?')) return { status: 0, stdout: payload };
    } });
    assert.throws(() => f.run(['check']), /CANDIDATE_(RESPONSE_INVALID|RUNS_INCOMPLETE)/);
  }
});
