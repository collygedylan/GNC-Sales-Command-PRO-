import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPagesRelease, verifyPagesRelease } from '../scripts/pages-release.mjs';

const repository = 'example/app', commit = 'a'.repeat(40), buildCommit = 'b'.repeat(40), head = 'c'.repeat(40), tree = 'd'.repeat(40);
const release = 'V2026.09.28.001', digest = 'e'.repeat(64);
function fixture() {
  const pr = { number: 42, merged: true, merged_at: '2026-09-28T00:00:00Z', draft: false, merge_commit_sha: commit,
    base: { ref: 'main', repo: { full_name: repository } }, head: { sha: head, repo: { full_name: repository } } };
  const run = { id: 12, run_number: 4, run_attempt: 1, workflow_id: 9, path: '.github/workflows/performance-monitor.yml',
    event: 'pull_request', head_sha: head, head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' };
  const jobs = [{ id: 2, run_id: 12, head_sha: head, name: 'validation / release-gate', status: 'completed', conclusion: 'success',
    steps: [{ name: 'Require every safety lane for this commit', status: 'completed', conclusion: 'success' }] }];
  const artifacts = [{ id: 30, name: `release-site-${buildCommit}` }, { id: 31, name: `release-proof-${buildCommit}-1` }]
    .map(artifact => ({ ...artifact, expired: false, expires_at: '2999-01-01T00:00:00Z', workflow_run: { id: 12, head_sha: head } }));
  const f = { pr, associated: [pr], runs: [run], jobs, artifacts, listRequests: [],
    workflow: { id: 9, path: run.path, state: 'active' },
    merged: { sha: commit, tree: { sha: tree } }, built: { sha: buildCommit, tree: { sha: tree }, parents: [{ sha: head }] } };
  const page = (url, field, rows) => {
    const parsed = new URL(url, 'https://fixture.invalid');
    const pageNumber = Number(parsed.searchParams.get('page') || 1);
    const pageSize = Number(parsed.searchParams.get('per_page') || 100);
    f.listRequests.push({ field, pageNumber, pageSize });
    return { total_count: rows.length,
      [field]: rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize) };
  };
  f.api = async url => {
    if (url.endsWith('/pulls?per_page=100')) return f.associated;
    if (url.endsWith('/pulls/42')) return f.pr;
    if (url.includes('/artifacts?')) return page(url, 'artifacts', f.artifacts);
    if (url.includes('/jobs?')) return page(url, 'jobs', f.jobs);
    if (url.includes('/runs?')) return page(url, 'workflow_runs', f.runs);
    if (url.endsWith(`/git/commits/${commit}`)) return f.merged;
    if (url.endsWith(`/git/commits/${buildCommit}`)) return f.built;
    if (url.endsWith('/actions/workflows/performance-monitor.yml')) return f.workflow;
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  f.select = () => selectPagesRelease({ repository, commit, api: f.api });
  f.proof = { schemaVersion: 'gnc-release-proof-v1', repository, commit: buildCommit, runId: 12, attempt: 1, siteArtifactId: 30, release, digest };
  f.verify = selected => verifyPagesRelease({ proof: f.proof, selected, repository, commit, runId: 88, attempt: 2, release, api: f.api });
  return f;
}

test('Pages reuses only the successful PR build with the identical full merged tree', async () => {
  const f = fixture(), selected = await f.select();
  assert.deepEqual(selected, { reuse: true, schemaVersion: 'gnc-release-proof-v1', repository, commit: buildCommit,
    mergedCommit: commit, tree, runId: 12, attempt: 1, siteArtifactId: 30, proofArtifactId: 31 });
  assert.deepEqual(await f.verify(selected), { digest, buildCommit });
  assert.notEqual(buildCommit, commit, 'the tested synthetic merge and final main commit need not have the same SHA');
  assert.equal(f.proof.commit, buildCommit, 'the saved artifact fingerprint is preserved');
});

test('optional PR production-health skip is allowed; fresh production health is checked by Pages', async () => {
  const f = fixture();
  f.jobs.push({ ...f.jobs[0], id: 3, name: 'validation / production-health', conclusion: 'skipped' });
  assert.equal((await f.select()).reuse, true);
});

test('Pages accepts complete 102-job proof metadata and finds the gate on the fifth bounded page', async () => {
  const f = fixture();
  const gate = f.jobs[0];
  f.jobs = Array.from({ length: 100 }, (_, index) => ({ ...gate, id: 100 + index, name: `validation / extra-${index}` }))
    .concat([gate, { ...gate, id: 999, name: 'validation / unit' }]);
  const selected = await f.select();
  assert.equal(selected.reuse, true);
  assert.deepEqual(f.listRequests.filter(request => request.field === 'jobs'),
    [1, 2, 3, 4, 5].map(pageNumber => ({ field: 'jobs', pageNumber, pageSize: 25 })));
});

for (const [name, mutate] of [
  ['a non-green job on the last page', f => { f.jobs[101] = { ...f.jobs[101], conclusion: 'failure' }; }],
  ['a foreign job on the last page', f => { f.jobs[101] = { ...f.jobs[101], head_sha: buildCommit }; }],
  ['a duplicate last-page job ID', f => { f.jobs[101] = { ...f.jobs[101], id: f.jobs[0].id }; }],
]) test(`Pages fails closed for ${name}`, async () => {
  const f = fixture(), gate = f.jobs[0];
  f.jobs = Array.from({ length: 100 }, (_, index) => ({ ...gate, id: 100 + index, name: `validation / extra-${index}` }))
    .concat([{ ...gate, id: 998 }, { ...gate, id: 999, name: 'validation / unit' }]);
  mutate(f);
  assert.equal((await f.select()).reuse, false);
});

for (const [name, mutate] of [
  ['an inconsistent page total', f => { const api = f.api; f.api = async url => {
    const result = await api(url);
    if (url.includes('/jobs?') && new URL(url, 'https://fixture.invalid').searchParams.get('page') === '2') result.total_count += 1;
    return result;
  }; }],
  ['a truncated second page', f => { const api = f.api; f.api = async url => {
    if (url.includes('/jobs?') && new URL(url, 'https://fixture.invalid').searchParams.get('page') === '2') {
      const result = await api(url); result.jobs = []; return result;
    }
    return api(url);
  }; }],
  ['an API error on page two', f => { const api = f.api; f.api = async url => {
    if (url.includes('/jobs?') && new URL(url, 'https://fixture.invalid').searchParams.get('page') === '2') throw new Error('API_PAGE_TWO_FAILED');
    return api(url);
  }; }],
]) test(`Pages does not accept ${name}`, async () => {
  const f = fixture(), gate = f.jobs[0];
  f.jobs = Array.from({ length: 100 }, (_, index) => ({ ...gate, id: 100 + index, name: `validation / extra-${index}` }))
    .concat([gate, { ...gate, id: 999, name: 'validation / unit' }]);
  mutate(f);
  if (name.includes('API error')) await assert.rejects(f.select(), /API_PAGE_TWO_FAILED|GITHUB_PAGINATION/);
  else assert.equal((await f.select()).reuse, false);
});

for (const [name, change] of [
  ['direct push without a merged PR', f => f.associated = []],
  ['ambiguous merged PR', f => f.associated.push({ ...f.pr, number: 43 })],
  ['unmerged PR', f => f.pr.merged = false],
  ['draft PR', f => f.pr.draft = true],
  ['fork PR', f => f.pr.head.repo.full_name = 'fork/app'],
  ['wrong PR base', f => f.pr.base.ref = 'preview'],
  ['wrong PR head', f => f.pr.head.sha = 'f'.repeat(40)],
  ['different final merge', f => f.pr.merge_commit_sha = 'f'.repeat(40)],
  ['missing PR run', f => f.runs = []],
  ['wrong workflow', f => f.workflow.path = '.github/workflows/other.yml'],
  ['inactive workflow', f => f.workflow.state = 'disabled_manually'],
  ['wrong run workflow', f => f.runs[0].workflow_id = 10],
  ['wrong event', f => f.runs[0].event = 'workflow_dispatch'],
  ['fork run', f => f.runs[0].head_repository.full_name = 'fork/app'],
  ['wrong API head', f => f.runs[0].head_sha = buildCommit],
  ['latest failed run', f => f.runs.push({ ...f.runs[0], id: 13, run_number: 5, conclusion: 'failure' })],
  ['latest pending run', f => f.runs[0].status = 'in_progress'],
  ['failed lane', f => f.jobs.push({ ...f.jobs[0], id: 3, name: 'validation / unit', conclusion: 'failure' })],
  ['skipped safety lane', f => f.jobs.push({ ...f.jobs[0], id: 3, name: 'validation / compiled', conclusion: 'skipped' })],
  ['wrong job SHA', f => f.jobs[0].head_sha = buildCommit],
  ['wrong job run', f => f.jobs[0].run_id = 13],
  ['duplicate gate', f => f.jobs.push({ ...f.jobs[0], id: 3 })],
  ['missing gate step', f => f.jobs[0].steps = []],
  ['missing gate', f => f.jobs = []],
  ['missing proof artifact', f => f.artifacts.pop()],
  ['proof from previous attempt', f => f.runs[0].run_attempt = 2],
  ['duplicate proof', f => f.artifacts.push({ ...f.artifacts[1], id: 32 })],
  ['missing site artifact', f => f.artifacts.shift()],
  ['duplicate site artifact', f => f.artifacts.push({ ...f.artifacts[0], id: 32 })],
  ['expired artifact', f => f.artifacts[0].expired = true],
  ['expiry in the past', f => f.artifacts[0].expires_at = '2000-01-01T00:00:00Z'],
  ['wrong artifact run', f => f.artifacts[0].workflow_run.id = 13],
  ['wrong artifact head SHA', f => f.artifacts[0].workflow_run.head_sha = buildCommit],
  ['changed merged source', f => f.merged.tree.sha = 'f'.repeat(40)],
  ['invalid tree ID', f => f.built.tree.sha = 'wrong'],
  ['commit response mismatch', f => f.built.sha = head],
  ['unrelated build commit', f => f.built.parents = [{ sha: 'f'.repeat(40) }]],
]) test(`Pages requires full main validation for ${name}`, async () => {
  const f = fixture(); change(f);
  const result = await f.select();
  assert.equal(result.reuse, false); assert.ok(result.reason);
});

test('truncated metadata cannot establish artifact provenance', async () => {
  for (const field of ['workflow_runs', 'jobs', 'artifacts']) {
    const f = fixture(), api = f.api;
    f.api = async url => { const page = await api(url); return page[field] ? { ...page, total_count: page.total_count + 1 } : page; };
    assert.equal((await f.select()).reuse, false);
  }
});

test('new validation attempts arriving during selection cannot supply a stale proof', async () => {
  const f = fixture(), api = f.api; let calls = 0;
  f.api = async url => { if (url.includes('/runs?') && ++calls === 2) f.runs[0].run_attempt = 2; return api(url); };
  assert.deepEqual(await f.select(), { reuse: false, reason: 'RUN_CHANGED' });
});

test('API outages fail closed, with no automatic reuse or fallback publication', async () => {
  const f = fixture(); f.api = async () => { throw new Error('API_UNAVAILABLE'); };
  await assert.rejects(f.select(), /API_UNAVAILABLE/);
});

test('prepublication verification rechecks the run, attempt, artifact IDs and tree', async () => {
  for (const mutate of [
    f => f.runs[0].conclusion = 'failure', f => f.runs[0].run_attempt = 2,
    f => f.artifacts[0].expired = true, f => f.artifacts[0].id = 32,
    f => f.artifacts[1].id = 32, f => f.merged.tree.sha = 'f'.repeat(40),
  ]) {
    const f = fixture(), selected = await f.select(); mutate(f);
    await assert.rejects(f.verify(selected), /PAGES_RELEASE_(REUSE_NO_LONGER_VALID|SELECTION_CHANGED)/);
  }
});

test('proof binds version, digest, repository, build commit, run, attempt and artifact', async () => {
  for (const key of ['schemaVersion', 'repository', 'commit', 'runId', 'attempt', 'siteArtifactId', 'release', 'digest']) {
    const f = fixture(), selected = await f.select(); f.proof[key] = 'wrong';
    await assert.rejects(f.verify(selected), /RELEASE_PROOF_/);
  }
  const f = fixture(), selected = await f.select();
  await assert.rejects(f.verify({ ...selected, digest: 'f'.repeat(64) }), /DIGEST_CHANGED/);
  assert.deepEqual(await f.verify({ ...selected, digest }), { digest, buildCommit });
});

test('full main validation fallback still requires the same Pages run, attempt, commit and digest', async () => {
  const f = fixture();
  f.proof = { ...f.proof, commit, runId: 88, attempt: 2 };
  const selected = { reuse: false, commit, runId: 88, attempt: 2, siteArtifactId: 30, proofArtifactId: 31, digest };
  f.api = async () => { throw new Error('same-run verification must not select a different PR artifact'); };
  assert.deepEqual(await f.verify(selected), { digest, buildCommit: commit });
  for (const update of [{ runId: 12 }, { attempt: 1 }, { commit: buildCommit }, { digest: undefined }, { digest: 'f'.repeat(64) }, { reuse: 'false' }]) {
    await assert.rejects(f.verify({ ...selected, ...update }), /(PAGES_RELEASE|RELEASE_PROOF)_/);
  }
});

test('invalid identifiers are rejected before using the API', async () => {
  await assert.rejects(selectPagesRelease({ repository: '../bad', commit, api: () => assert.fail('unexpected API call') }), /IDENTITY_INVALID/);
  const f = fixture(), selected = await f.select();
  await assert.rejects(f.verify({ ...selected, siteArtifactId: NaN }), /IDENTITY_INVALID/);
});
