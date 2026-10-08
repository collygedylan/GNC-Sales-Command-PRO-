import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { GitHubPaginationError, listGitHubApiItems } from './github-api-pagination.mjs';

const workflowPath = '.github/workflows/performance-monitor.yml';
const fail = code => { throw new Error(`RELEASE_PROOF_${code}`); };
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
async function listComplete(api, endpoint, field, errorCode) {
  try { return await listGitHubApiItems({ api, endpoint, field }); }
  catch (error) {
    if (error instanceof GitHubPaginationError) fail(errorCode);
    throw error;
  }
}

// GitHub metadata, not a caller-supplied success flag, establishes provenance.
export async function selectReleaseProof({ repository, commit, api }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !sha(commit)) fail('IDENTITY_INVALID');
  const root = `repos/${repository}`;
  const workflow = await api(`${root}/actions/workflows/performance-monitor.yml`);
  if (!Number.isSafeInteger(workflow.id) || workflow.id < 1 || workflow.path !== workflowPath || workflow.state !== 'active') fail('WORKFLOW_INVALID');
  const query = `${root}/actions/workflows/${workflow.id}/runs?head_sha=${commit}&event=workflow_dispatch&per_page=100`;
  const latest = async () => {
    const runs = await listComplete(api, query, 'workflow_runs', 'RUNS_INCOMPLETE');
    if (!runs.length) fail('RUNS_INCOMPLETE');
    for (const r of runs) if (!Number.isSafeInteger(r.id) || r.id < 1 || !Number.isSafeInteger(r.run_number) || r.run_number < 1 || !Number.isSafeInteger(r.run_attempt)
      || r.run_attempt < 1 || r.workflow_id !== workflow.id || r.path !== workflowPath || r.event !== 'workflow_dispatch'
      || r.head_sha !== commit || r.head_repository?.full_name?.toLowerCase() !== repository.toLowerCase()) fail('RUN_IDENTITY_INVALID');
    if (new Set(runs.map(r=>r.id)).size !== runs.length || new Set(runs.map(r=>r.run_number)).size !== runs.length) fail('RUNS_AMBIGUOUS');
    const r = runs.toSorted((a,b)=>b.run_number-a.run_number)[0];
    if (r.status !== 'completed' || r.conclusion !== 'success') fail('LATEST_RUN_NOT_GREEN');
    return r;
  };
  const run = { ...await latest() };
  const jobs = await listComplete(api, `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, 'jobs', 'JOBS_INCOMPLETE');
  if (jobs.some(j=>!Number.isSafeInteger(j.id) || j.id < 1 || j.run_id !== run.id || j.head_sha !== commit || j.status !== 'completed'
    || (j.conclusion !== 'success' && !(j.name === 'validation / production-health' && j.conclusion === 'skipped')))) fail('JOB_NOT_GREEN');
  const gates = jobs.filter(j=>j.name==='validation / release-gate');
  if (gates.length !== 1 || !gates[0].steps?.some(s=>s.name==='Require every safety lane for this commit' && s.status==='completed' && s.conclusion==='success')) fail('GATE_MISSING');
  const artifacts = await listComplete(api, `${root}/actions/runs/${run.id}/artifacts?per_page=100`, 'artifacts', 'ARTIFACTS_INCOMPLETE');
  function artifact(name) {
    const matches = artifacts.filter(a=>a.name===name);
    if (matches.length !== 1) fail('ARTIFACT_AMBIGUOUS');
    const a = matches[0];
    if (!Number.isSafeInteger(a.id) || a.id < 1 || a.expired !== false || !(Date.parse(a.expires_at)>Date.now()) || a.workflow_run?.id !== run.id || a.workflow_run?.head_sha !== commit) fail('ARTIFACT_INVALID');
    return a;
  }
  const site = artifact(`release-site-${commit}`);
  const proof = artifact(`release-proof-${commit}-${run.run_attempt}`);
  const check = await latest();
  if (check.id !== run.id || check.run_attempt !== run.run_attempt) fail('RUN_CHANGED');
  return { schemaVersion:'gnc-release-proof-v1', repository, commit, runId:run.id, attempt:run.run_attempt, siteArtifactId:site.id, proofArtifactId:proof.id };
}

export function verifyReleaseProof(proof, selected, release) {
  for (const k of ['schemaVersion','repository','commit','runId','attempt','siteArtifactId']) if (proof[k] !== selected[k]) fail('RECORD_MISMATCH');
  if (proof.release !== release || !/^[a-f0-9]{64}$/.test(proof.digest || '')) fail('CONTENT_IDENTITY_INVALID');
  return proof.digest;
}

export function verifySameRunReleaseProof(proof, { repository, commit, runId, attempt, siteArtifactId, proofArtifactId, digest: expectedDigest }, release) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !sha(commit)
    || !Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(attempt) || attempt < 1
    || !Number.isSafeInteger(siteArtifactId) || siteArtifactId < 1
    || !Number.isSafeInteger(proofArtifactId) || proofArtifactId < 1
    || !/^[a-f0-9]{64}$/.test(expectedDigest || '')) fail('IDENTITY_INVALID');
  const expected = { schemaVersion:'gnc-release-proof-v1', repository, commit, runId, attempt, siteArtifactId };
  const digest = verifyReleaseProof(proof, expected, release);
  if (digest !== expectedDigest) fail('DIGEST_MISMATCH');
  return digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const api = async endpoint => {
      const r = spawnSync('gh',['api','--hostname','github.com','--method','GET',endpoint],{encoding:'utf8',shell:false,windowsHide:true,timeout:60000});
      if (r.error || r.status !== 0) fail('API_FAILED');
      return JSON.parse(r.stdout);
    };
    let selected;
    if (process.argv[2] === 'select') {
      selected = await selectReleaseProof({repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,api});
      if (!process.env.GITHUB_OUTPUT) fail('OUTPUT_MISSING');
      appendFileSync(process.env.GITHUB_OUTPUT, `run-id=${selected.runId}\nproof-id=${selected.proofArtifactId}\nsite-id=${selected.siteArtifactId}\n`);
    } else if (process.argv[2] === 'verify') {
      const proof = JSON.parse(readFileSync('artifacts/candidate-proof/release-proof.json','utf8'));
      const release = `V${JSON.parse(readFileSync('package.json','utf8')).version}`;
      let digest;
      if (process.env.RELEASE_PROOF_ID) {
        const number = name => {
          const value = Number(process.env[name]);
          if (!Number.isSafeInteger(value) || value < 1) fail('IDENTITY_INVALID');
          return value;
        };
        const expectedRunId = number('RELEASE_PROOF_RUN_ID');
        const expectedAttempt = number('RELEASE_PROOF_ATTEMPT');
        const runId = number('GITHUB_RUN_ID');
        const attempt = number('GITHUB_RUN_ATTEMPT');
        if (expectedRunId !== runId || expectedAttempt !== attempt) fail('RUN_IDENTITY_INVALID');
        selected = {
          repository:process.env.GITHUB_REPOSITORY, commit:process.env.GITHUB_SHA,
          runId:expectedRunId, attempt:expectedAttempt,
          siteArtifactId:number('RELEASE_PROOF_SITE_ID'), proofArtifactId:number('RELEASE_PROOF_ID'),
          digest:process.env.RELEASE_PROOF_DIGEST,
        };
        digest = verifySameRunReleaseProof(proof, selected, release);
      } else {
        selected = await selectReleaseProof({repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,api});
        digest = verifyReleaseProof(proof,selected,release);
      }
      if (!process.env.GITHUB_OUTPUT) fail('OUTPUT_MISSING');
      appendFileSync(process.env.GITHUB_OUTPUT,`digest=${digest}\nrun-id=${selected.runId}\nsite-id=${selected.siteArtifactId}\n`);
    } else fail('USAGE');
    console.log(`Verified candidate provenance ${selected.commit} run ${selected.runId} attempt ${selected.attempt}.`);
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
