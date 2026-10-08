import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePagesPublication } from '../scripts/pages-publication.mjs';

const repository = 'example/app', commit = 'a'.repeat(40), buildCommit = 'b'.repeat(40), tree = 'c'.repeat(40);
function fixture() {
  const run = { id: 12, run_number: 1, run_attempt: 2, path: '.github/workflows/pages-static.yml', head_sha: commit,
    head_branch: 'main', event: 'workflow_dispatch', head_repository: { full_name: repository } };
  const job = { id: 13, name: 'deploy', run_id: 12, head_sha: commit,
    steps: [{ name: 'Deploy verified artifact to Pages', status: 'completed', conclusion: 'success' }] };
  const artifact = { id: 99, name: 'pages-publication-2', expired: false, expires_at: '2999-01-01T00:00:00Z',
    workflow_run: { id: 12, head_sha: commit } };
  const descriptor = { schemaVersion: 'gnc-pages-publication-v1', repository, commit, buildCommit, runId: 12, attempt: 2 };
  const f = { runs: [run], jobs: [job], artifacts: [artifact], descriptor,
    merged: { sha: commit, tree: { sha: tree } }, built: { sha: buildCommit, tree: { sha: tree } } };
  f.api = async url => {
    const paged = (items, field) => {
      const params = new URL(url, 'https://api.github.com').searchParams;
      const page = Number(params.get('page') || 1), perPage = Number(params.get('per_page') || 100);
      return { total_count: items.length, [field]: items.slice((page - 1) * perPage, page * perPage) };
    };
    if (url.includes('/runs?')) return paged(f.runs, 'workflow_runs');
    if (url.includes('/jobs?')) return paged(f.jobs, 'jobs');
    if (url.includes('/artifacts?')) return paged(f.artifacts, 'artifacts');
    if (url.endsWith(`/commits/${commit}`)) return f.merged;
    if (url.endsWith(`/commits/${buildCommit}`)) return f.built;
    throw new Error('Unexpected API URL');
  };
  f.readDescriptor = async expected => { assert.deepEqual(expected, { runId: 12, name: 'pages-publication-2' }); return f.descriptor; };
  f.resolve = () => resolvePagesPublication({ repository, commit, api: f.api, readDescriptor: f.readDescriptor, readLiveCommit: f.readLiveCommit });
  return f;
}

test('independent health check resolves the published PR fingerprint from the exact Pages run and attempt', async () => {
  assert.equal(await fixture().resolve(), buildCommit);
});
test('independent health check finds the published step on jobs page two', async () => {
  const f = fixture();
  f.jobs = Array.from({ length: 102 }, (_, index) => ({ id: index + 100, name: `validation ${index}`, run_id: 12, head_sha: commit }));
  f.jobs[101] = { ...f.jobs[101], name: 'deploy', steps: [{ name: 'Deploy verified artifact to Pages', status: 'completed', conclusion: 'success' }] };
  assert.equal(await f.resolve(), buildCommit);
  f.jobs[101].steps[0].conclusion = 'failure';
  await assert.rejects(f.resolve(), /NOT_PUBLISHED/);
});
test('a legacy Pages publication without a descriptor retains the main fingerprint', async () => {
  const f = fixture(); f.artifacts = []; f.readDescriptor = () => assert.fail('no download for legacy publication');
  assert.equal(await f.resolve(), commit);
});
test('retention fallback verifies live build tree only after a confirmed successful publication', async () => {
  for (const expire of [f => f.artifacts = [], f => f.artifacts[0].expired = true]) {
    const f = fixture(); expire(f);
    f.readDescriptor = () => assert.fail('no download of an expired descriptor');
    f.readLiveCommit = async () => buildCommit;
    assert.equal(await f.resolve(), buildCommit);
    f.built.tree.sha = 'd'.repeat(40);
    await assert.rejects(f.resolve(), /TREE_MISMATCH/);
    f.built.tree.sha = tree;
    f.jobs[0].steps[0].conclusion = 'failure';
    await assert.rejects(f.resolve(), /NOT_PUBLISHED/);
  }
});
test('retention fallback does not mask invalid descriptor provenance or live identity', async () => {
  const f = fixture(); f.readLiveCommit = async () => buildCommit;
  f.artifacts[0].workflow_run.id = 13;
  await assert.rejects(f.resolve(), /ARTIFACT_INVALID/);
  f.artifacts = []; f.readLiveCommit = async () => 'bad';
  await assert.rejects(f.resolve(), /DESCRIPTOR_INVALID/);
});
for (const [name, mutate] of [
  ['missing run', f => f.runs = []], ['wrong workflow', f => f.runs[0].path = 'other.yml'],
  ['wrong branch', f => f.runs[0].head_branch = 'feature'], ['wrong event', f => f.runs[0].event = 'pull_request'],
  ['wrong commit', f => f.runs[0].head_sha = buildCommit], ['fork run', f => f.runs[0].head_repository.full_name = 'fork/app'],
  ['not deployed yet', f => f.jobs[0].steps[0].conclusion = null], ['failed deployment', f => f.jobs[0].steps[0].conclusion = 'failure'],
  ['superseded deployment', f => f.jobs[0].steps = []], ['job from another run', f => f.jobs[0].run_id = 13],
  ['expired descriptor', f => f.artifacts[0].expired = true], ['duplicate descriptor', f => f.artifacts.push({ ...f.artifacts[0], id: 100 })],
  ['artifact from another run', f => f.artifacts[0].workflow_run.id = 13],
  ['artifact from another commit', f => f.artifacts[0].workflow_run.head_sha = buildCommit],
  ['descriptor from another repository', f => f.descriptor.repository = 'fork/app'],
  ['descriptor from another main commit', f => f.descriptor.commit = buildCommit],
  ['descriptor from another run', f => f.descriptor.runId = 13], ['descriptor from another attempt', f => f.descriptor.attempt = 1],
  ['malformed build ID', f => f.descriptor.buildCommit = 'bad'], ['changed source tree', f => f.built.tree.sha = 'd'.repeat(40)],
  ['commit lookup mismatch', f => f.built.sha = commit],
]) test(`independent health verification rejects ${name}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(f.resolve(), /PAGES_PUBLICATION_/);
});
test('an older successful publication cannot hide a newer pending attempt', async () => {
  const f = fixture(); f.runs.push({ ...f.runs[0], id: 13, run_number: 2, run_attempt: 3 });
  f.api = async url => {
    if (url.includes('/runs?')) return { total_count: f.runs.length, workflow_runs: f.runs };
    assert.match(url, /attempts\/3\/jobs/);
    return { total_count: 0, jobs: [] };
  };
  await assert.rejects(f.resolve(), /NOT_PUBLISHED/);
});
