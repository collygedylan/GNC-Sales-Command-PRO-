import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { GitHubPaginationError, listGitHubApiItems } from './github-api-pagination.mjs';
import { verifyReleaseProof, verifySameRunReleaseProof } from './release-proof.mjs';

const workflowPath = '.github/workflows/performance-monitor.yml';
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = code => { throw new Error(`PAGES_RELEASE_${code}`); };
class Unavailable extends Error {}
const unavailable = reason => { throw new Unavailable(reason); };

function identity(repository, commit) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repository || '') || ['.', '..'].includes(repository.split('/')[1]) || !sha(commit)) fail('IDENTITY_INVALID');
}
async function complete(api, endpoint, field) {
  try { return await listGitHubApiItems({ api, endpoint, field }); }
  catch (error) {
    if (error instanceof GitHubPaginationError) unavailable(`${field.toUpperCase()}_INCOMPLETE`);
    throw error;
  }
}

// PR runs report the branch HEAD in the API, but build GITHUB_SHA: the synthetic
// merge commit. Compare complete Git trees, then retain that build's sealed bytes
// and fingerprint. Approval or ancestry alone never authorizes artifact reuse.
async function matchingProof({ repository, commit, api, now }) {
  const root = `repos/${repository}`;
  const sameRepo = value => value?.toLowerCase() === repository.toLowerCase();
  const associated = await api(`${root}/commits/${commit}/pulls?per_page=100`);
  if (!Array.isArray(associated) || associated.length >= 100) unavailable('PRS_INCOMPLETE');
  const candidates = associated.filter(pr => pr.merge_commit_sha === commit && pr.merged_at
    && sameRepo(pr.base?.repo?.full_name) && pr.base.ref === 'main' && sameRepo(pr.head?.repo?.full_name));
  if (candidates.length !== 1 || !positive(candidates[0].number)) unavailable('NO_UNIQUE_MERGED_PR');
  const pr = await api(`${root}/pulls/${candidates[0].number}`);
  if (!pr.merged || pr.draft || pr.merge_commit_sha !== commit || !sha(pr.head?.sha)
    || !sameRepo(pr.base?.repo?.full_name) || pr.base.ref !== 'main' || !sameRepo(pr.head?.repo?.full_name)) unavailable('PR_CHANGED');
  const workflow = await api(`${root}/actions/workflows/performance-monitor.yml`);
  if (!positive(workflow.id) || workflow.path !== workflowPath || workflow.state !== 'active') unavailable('WORKFLOW_INVALID');
  const latest = async () => {
    const runs = await complete(api, `${root}/actions/workflows/${workflow.id}/runs?head_sha=${pr.head.sha}&event=pull_request`, 'workflow_runs');
    if (!runs.length || new Set(runs.map(run => run.run_number)).size !== runs.length) unavailable('NO_UNIQUE_RUN');
    for (const run of runs) {
      if (!positive(run.id) || !positive(run.run_number) || !positive(run.run_attempt)
        || run.workflow_id !== workflow.id || run.path !== workflowPath || run.event !== 'pull_request'
        || run.head_sha !== pr.head.sha || !sameRepo(run.head_repository?.full_name)) unavailable('RUN_IDENTITY_INVALID');
    }
    const run = runs.toSorted((a, b) => b.run_number - a.run_number)[0];
    if (run.status !== 'completed' || run.conclusion !== 'success') unavailable('LATEST_RUN_NOT_GREEN');
    return { ...run };
  };
  const run = await latest();
  const jobs = await complete(api, `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
  if (jobs.some(job => !positive(job.id) || job.run_id !== run.id || job.head_sha !== pr.head.sha
    || job.status !== 'completed' || (job.conclusion !== 'success'
      && !(job.name === 'validation / production-health' && job.conclusion === 'skipped')))) unavailable('JOB_NOT_GREEN');
  const gates = jobs.filter(job => job.name === 'validation / release-gate');
  if (gates.length !== 1 || !gates[0].steps?.some(step => step.name === 'Require every safety lane for this commit'
    && step.status === 'completed' && step.conclusion === 'success')) unavailable('GATE_MISSING');
  const artifacts = await complete(api, `${root}/actions/runs/${run.id}/artifacts`, 'artifacts');
  const proofs = artifacts.filter(artifact => new RegExp(`^release-proof-[a-f0-9]{40}-${run.run_attempt}$`).test(artifact.name));
  if (proofs.length !== 1) unavailable('PROOF_AMBIGUOUS');
  const proof = proofs[0];
  const buildCommit = proof.name.slice('release-proof-'.length, 'release-proof-'.length + 40);
  const sites = artifacts.filter(artifact => artifact.name === `release-site-${buildCommit}`);
  if (sites.length !== 1) unavailable('SITE_AMBIGUOUS');
  const site = sites[0];
  for (const artifact of [proof, site]) {
    if (!positive(artifact.id) || artifact.expired !== false || !(Date.parse(artifact.expires_at) > now)
      || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== pr.head.sha) unavailable('ARTIFACT_INVALID');
  }
  const [merged, built] = await Promise.all([
    api(`${root}/git/commits/${commit}`), api(`${root}/git/commits/${buildCommit}`),
  ]);
  if (merged.sha !== commit || built.sha !== buildCommit || !sha(merged.tree?.sha) || !sha(built.tree?.sha)) unavailable('COMMIT_INVALID');
  if (merged.tree.sha !== built.tree.sha) unavailable('MERGED_TREE_CHANGED');
  // A build must belong to this PR, even when another commit has the same tree.
  if (buildCommit !== pr.head.sha && !built.parents?.some(parent => parent.sha === pr.head.sha)) unavailable('BUILD_NOT_FROM_PR');
  const check = await latest();
  if (check.id !== run.id || check.run_attempt !== run.run_attempt) unavailable('RUN_CHANGED');
  return { reuse: true, schemaVersion: 'gnc-release-proof-v1', repository, commit: buildCommit,
    mergedCommit: commit, tree: merged.tree.sha, runId: run.id, attempt: run.run_attempt,
    siteArtifactId: site.id, proofArtifactId: proof.id };
}

export async function selectPagesRelease({ repository, commit, api, now = Date.now() }) {
  identity(repository, commit);
  try { return await matchingProof({ repository, commit, api, now }); }
  catch (error) {
    // An unavailable proof is never a waiver. Pages must run the complete suite
    // on main. Transport/API errors fail the job instead of silently publishing.
    if (error instanceof Unavailable) return { reuse: false, reason: error.message };
    throw error;
  }
}

export async function verifyPagesRelease({ proof, selected, repository, commit, runId, attempt, release, api }) {
  identity(repository, commit);
  if (!positive(runId) || !positive(attempt) || !sha(selected?.commit)
    || !positive(selected.runId) || !positive(selected.attempt)
    || !positive(selected.siteArtifactId) || !positive(selected.proofArtifactId)) fail('IDENTITY_INVALID');
  let digest;
  if (selected.reuse === true) {
    const current = await selectPagesRelease({ repository, commit, api });
    if (!current.reuse) fail('REUSE_NO_LONGER_VALID');
    for (const key of ['commit', 'runId', 'attempt', 'siteArtifactId', 'proofArtifactId']) {
      if (current[key] !== selected[key]) fail('SELECTION_CHANGED');
    }
    digest = verifyReleaseProof(proof, current, release);
    if (selected.digest && digest !== selected.digest) fail('DIGEST_CHANGED');
  } else if (selected.reuse === false) {
    if (selected.commit !== commit || selected.runId !== runId || selected.attempt !== attempt) fail('SAME_RUN_REQUIRED');
    digest = verifySameRunReleaseProof(proof, { ...selected, repository }, release);
  } else fail('REUSE_INVALID');
  return { digest, buildCommit: selected.commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const env = process.env;
    const api = async endpoint => {
      const result = spawnSync('gh', ['api', '--hostname', 'github.com', '--method', 'GET', endpoint],
        { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000 });
      if (result.error || result.status !== 0) fail('API_FAILED');
      return JSON.parse(result.stdout);
    };
    if (!env.GITHUB_OUTPUT) fail('OUTPUT_MISSING');
    const output = values => appendFileSync(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
    if (process.argv[2] === 'select') {
      const selected = await selectPagesRelease({ repository: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA, api });
      output({ reuse: selected.reuse });
      if (selected.reuse) {
        output({ 'run-id': selected.runId, attempt: selected.attempt, 'site-id': selected.siteArtifactId,
          'proof-id': selected.proofArtifactId, 'build-commit': selected.commit });
        console.log(`Reuse validated build ${selected.commit} from run ${selected.runId}, attempt ${selected.attempt}; merged tree matches.`);
      } else console.log(`Full main validation required: ${selected.reason}.`);
    } else if (process.argv[2] === 'verify') {
      if (!['true', 'false'].includes(env.RELEASE_REUSE)) fail('REUSE_INVALID');
      const result = await verifyPagesRelease({
        proof: JSON.parse(readFileSync('artifacts/candidate-proof/release-proof.json', 'utf8')),
        selected: { reuse: env.RELEASE_REUSE === 'true', commit: env.RELEASE_BUILD_COMMIT,
          runId: Number(env.RELEASE_PROOF_RUN_ID), attempt: Number(env.RELEASE_PROOF_ATTEMPT),
          siteArtifactId: Number(env.RELEASE_PROOF_SITE_ID), proofArtifactId: Number(env.RELEASE_PROOF_ID), digest: env.RELEASE_PROOF_DIGEST },
        repository: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA,
        runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT),
        release: `V${JSON.parse(readFileSync('package.json', 'utf8')).version}`, api,
      });
      output({ digest: result.digest, 'build-commit': result.buildCommit,
        'run-id': Number(env.RELEASE_PROOF_RUN_ID), attempt: Number(env.RELEASE_PROOF_ATTEMPT),
        'site-id': Number(env.RELEASE_PROOF_SITE_ID), 'proof-id': Number(env.RELEASE_PROOF_ID) });
      console.log(`Verified saved build ${result.buildCommit} for main ${env.GITHUB_SHA}.`);
    } else fail('USAGE');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
