import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workflowPath = '.github/workflows/performance-monitor.yml';
const fail = code => { throw new Error(`RELEASE_PROOF_${code}`); };
const sha = value => /^[a-f0-9]{40}$/.test(value || '');

// GitHub metadata, not a caller-supplied success flag, establishes provenance.
export async function selectReleaseProof({ repository, commit, api }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !sha(commit)) fail('IDENTITY_INVALID');
  const root = `repos/${repository}`;
  const workflow = await api(`${root}/actions/workflows/performance-monitor.yml`);
  if (!Number.isSafeInteger(workflow.id) || workflow.id < 1 || workflow.path !== workflowPath || workflow.state !== 'active') fail('WORKFLOW_INVALID');
  const query = `${root}/actions/workflows/${workflow.id}/runs?head_sha=${commit}&event=workflow_dispatch&per_page=100`;
  const latest = async () => {
    const page = await api(query);
    if (!Array.isArray(page.workflow_runs) || !page.workflow_runs.length || page.total_count !== page.workflow_runs.length || page.total_count > 100) fail('RUNS_INCOMPLETE');
    const runs = page.workflow_runs;
    for (const r of runs) if (!Number.isSafeInteger(r.id) || r.id < 1 || !Number.isSafeInteger(r.run_number) || r.run_number < 1 || !Number.isSafeInteger(r.run_attempt)
      || r.run_attempt < 1 || r.workflow_id !== workflow.id || r.path !== workflowPath || r.event !== 'workflow_dispatch'
      || r.head_sha !== commit || r.head_repository?.full_name?.toLowerCase() !== repository.toLowerCase()) fail('RUN_IDENTITY_INVALID');
    if (new Set(runs.map(r=>r.id)).size !== runs.length || new Set(runs.map(r=>r.run_number)).size !== runs.length) fail('RUNS_AMBIGUOUS');
    const r = runs.toSorted((a,b)=>b.run_number-a.run_number)[0];
    if (r.status !== 'completed' || r.conclusion !== 'success') fail('LATEST_RUN_NOT_GREEN');
    return r;
  };
  const run = { ...await latest() };
  const jobsPage = await api(`${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  const jobs = jobsPage.jobs;
  if (!Array.isArray(jobs) || jobsPage.total_count !== jobs.length || jobs.length > 100 || new Set(jobs.map(j=>j.id)).size !== jobs.length) fail('JOBS_INCOMPLETE');
  if (jobs.some(j=>!Number.isSafeInteger(j.id) || j.id < 1 || j.run_id !== run.id || j.head_sha !== commit || j.status !== 'completed'
    || (j.conclusion !== 'success' && !(j.name === 'validation / production-health' && j.conclusion === 'skipped')))) fail('JOB_NOT_GREEN');
  const gates = jobs.filter(j=>j.name==='validation / release-gate');
  if (gates.length !== 1 || !gates[0].steps?.some(s=>s.name==='Require every safety lane for this commit' && s.status==='completed' && s.conclusion==='success')) fail('GATE_MISSING');
  const artifacts = await api(`${root}/actions/runs/${run.id}/artifacts?per_page=100`);
  if (!Array.isArray(artifacts.artifacts) || artifacts.total_count !== artifacts.artifacts.length || artifacts.total_count > 100) fail('ARTIFACTS_INCOMPLETE');
  function artifact(name) {
    const matches = artifacts.artifacts.filter(a=>a.name===name);
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const api = async endpoint => {
      const r = spawnSync('gh',['api','--hostname','github.com','--method','GET',endpoint],{encoding:'utf8',shell:false,windowsHide:true,timeout:60000});
      if (r.error || r.status !== 0) fail('API_FAILED');
      return JSON.parse(r.stdout);
    };
    const selected = await selectReleaseProof({repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,api});
    if (process.argv[2] === 'select') {
      if (!process.env.GITHUB_OUTPUT) fail('OUTPUT_MISSING');
      appendFileSync(process.env.GITHUB_OUTPUT, `run-id=${selected.runId}\nproof-id=${selected.proofArtifactId}\nsite-id=${selected.siteArtifactId}\n`);
    } else if (process.argv[2] === 'verify') {
      const proof = JSON.parse(readFileSync('artifacts/candidate-proof/release-proof.json','utf8'));
      const release = `V${JSON.parse(readFileSync('package.json','utf8')).version}`;
      const digest = verifyReleaseProof(proof,selected,release);
      if (!process.env.GITHUB_OUTPUT) fail('OUTPUT_MISSING');
      appendFileSync(process.env.GITHUB_OUTPUT,`digest=${digest}\nrun-id=${selected.runId}\nsite-id=${selected.siteArtifactId}\n`);
    } else fail('USAGE');
    console.log(`Verified candidate provenance ${selected.commit} run ${selected.runId} attempt ${selected.attempt}.`);
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
