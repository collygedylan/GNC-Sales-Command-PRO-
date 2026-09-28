const fail = code => { throw new Error(`PAGES_PUBLICATION_${code}`); };
const sha = value => /^[a-f0-9]{40}$/.test(value || '');

// Health checks outside Pages resolve the actual publication, rather than
// assuming the sealed PR build's commit ID equals its final merge commit ID.
export async function resolvePagesPublication({ repository, commit, api, readDescriptor, readLiveCommit }) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repository || '') || !sha(commit)) fail('IDENTITY_INVALID');
  const root = `repos/${repository}`;
  const page = await api(`${root}/actions/workflows/pages-static.yml/runs?head_sha=${commit}&per_page=100`);
  if (!Array.isArray(page.workflow_runs) || page.total_count !== page.workflow_runs.length || page.total_count > 100) fail('RUNS_INCOMPLETE');
  const run = page.workflow_runs.toSorted((a, b) => b.run_number - a.run_number)[0];
  if (!run || !Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
    || run.path !== '.github/workflows/pages-static.yml' || run.head_sha !== commit || run.head_branch !== 'main'
    || !['push', 'workflow_dispatch'].includes(run.event) || run.head_repository?.full_name?.toLowerCase() !== repository.toLowerCase()) fail('RUN_INVALID');
  const jobs = await api(`${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (!Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length || jobs.total_count > 100) fail('JOBS_INCOMPLETE');
  const deployed = jobs.jobs.filter(job => job.name === 'deploy' && job.run_id === run.id && job.head_sha === commit
    && job.steps?.some(step => ['Deploy verified artifact to Pages', 'Deploy to Pages'].includes(step.name)
      && step.status === 'completed' && step.conclusion === 'success'));
  if (deployed.length !== 1) fail('NOT_PUBLISHED');
  const artifacts = await api(`${root}/actions/runs/${run.id}/artifacts?per_page=100`);
  if (!Array.isArray(artifacts.artifacts) || artifacts.total_count !== artifacts.artifacts.length || artifacts.total_count > 100) fail('ARTIFACTS_INCOMPLETE');
  async function requireMatchingTree(buildCommit) {
    if (!sha(buildCommit)) fail('DESCRIPTOR_INVALID');
    const [merged, built] = await Promise.all([api(`${root}/git/commits/${commit}`), api(`${root}/git/commits/${buildCommit}`)]);
    if (merged.sha !== commit || built.sha !== buildCommit || !sha(merged.tree?.sha) || merged.tree.sha !== built.tree?.sha) fail('TREE_MISMATCH');
    return buildCommit;
  }
  // Artifact retention must not manufacture a health incident for an older
  // release. This health-only fallback still requires a confirmed publication,
  // a version-checked live fingerprint and an identical Git tree. It cannot
  // authorize Pages publication or replace release proof/artifact verification.
  async function retainedIdentity() {
    return readLiveCommit ? requireMatchingTree(await readLiveCommit()) : commit;
  }
  const matches = artifacts.artifacts.filter(artifact => artifact.name === `pages-publication-${run.run_attempt}`);
  // Older workflows published the main commit directly, before descriptors existed.
  if (!matches.length) return retainedIdentity();
  const artifact = matches[0];
  if (matches.length !== 1 || !Number.isSafeInteger(artifact.id) || artifact.id < 1
    || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== commit) fail('ARTIFACT_INVALID');
  if (artifact.expired !== false || !(Date.parse(artifact.expires_at) > Date.now())) {
    if (!readLiveCommit) fail('ARTIFACT_INVALID');
    return retainedIdentity();
  }
  const value = await readDescriptor({ runId: run.id, name: artifact.name });
  if (value.schemaVersion !== 'gnc-pages-publication-v1' || value.repository !== repository
    || value.commit !== commit || value.runId !== run.id || value.attempt !== run.run_attempt || !sha(value.buildCommit)) fail('DESCRIPTOR_INVALID');
  return requireMatchingTree(value.buildCommit);
}
