import test from 'node:test';
import assert from 'node:assert/strict';
import {selectReleaseProof,verifyReleaseProof} from '../scripts/release-proof.mjs';
const commit='a'.repeat(40), repository='example/app';
function fixture() {
  const run={id:12,run_number:4,run_attempt:1,workflow_id:9,path:'.github/workflows/performance-monitor.yml',event:'workflow_dispatch',head_sha:commit,head_branch:'repair/example',head_repository:{full_name:repository},status:'completed',conclusion:'success'};
  const job={id:2,run_id:12,head_sha:commit,name:'validation / release-gate',status:'completed',conclusion:'success',steps:[{name:'Require every safety lane for this commit',status:'completed',conclusion:'success'}]};
  const artifacts=[{id:30,name:`release-site-${commit}`},{id:31,name:`release-proof-${commit}-1`}].map(a=>({...a,expired:false,expires_at:'2999-01-01T00:00:00Z',workflow_run:{id:12,head_sha:commit}}));
  const f={runs:[run],jobs:[job],artifacts};
  f.api=async url=>url.includes('/artifacts?')?{total_count:f.artifacts.length,artifacts:f.artifacts}:url.includes('/jobs?')?{total_count:f.jobs.length,jobs:f.jobs}:url.includes('/runs?')?{total_count:f.runs.length,workflow_runs:f.runs}:{id:9,path:run.path,state:'active'};
  f.select=()=>selectReleaseProof({repository,commit,api:f.api});return f;
}
test('a release-branch benchmark supplies an immutable same-commit artifact for main',async()=>{
  const selected=await fixture().select();assert.equal(selected.siteArtifactId,30);assert.equal(selected.runId,12);
  const proof={...selected,release:'V2026.09.14.02',digest:'b'.repeat(64)};
  assert.equal(verifyReleaseProof(proof,selected,proof.release),proof.digest);
  for(const field of ['commit','repository','runId','attempt','siteArtifactId','digest','release']) {
    assert.throws(()=>verifyReleaseProof({...proof,[field]:'wrong'},selected,proof.release),/RELEASE_PROOF_/);
  }
});
for(const [name,change] of [
  ['wrong SHA',f=>f.runs[0].head_sha='c'.repeat(40)],
  ['wrong repository',f=>f.runs[0].head_repository.full_name='fork/app'],
  ['wrong event',f=>f.runs[0].event='pull_request'],
  ['wrong workflow',f=>f.runs[0].workflow_id=99],
  ['newer failed run',f=>f.runs.push({...f.runs[0],id:13,run_number:5,conclusion:'failure'})],
  ['newer pending attempt',f=>{f.runs[0].run_attempt=2;f.runs[0].status='in_progress';f.runs[0].conclusion=null;}],
  ['failed lane',f=>f.jobs.push({...f.jobs[0],id:3,name:'validation / unit',conclusion:'failure'})],
  ['missing gate',f=>f.jobs[0].steps=[]],
  ['expired artifact',f=>f.artifacts[0].expired=true],
  ['wrong artifact commit',f=>f.artifacts[0].workflow_run.head_sha='c'.repeat(40)],
  ['missing artifact',f=>f.artifacts.pop()],
  ['duplicate artifact',f=>f.artifacts.push({...f.artifacts[0],id:32})],
]) test(`proof rejects ${name}`,async()=>{const f=fixture();change(f);await assert.rejects(f.select(),/RELEASE_PROOF_/);});
test('proof rejects a new run arriving during verification',async()=>{
  const f=fixture(),api=f.api;let calls=0;f.api=async url=>{if(url.includes('/runs?') && ++calls===2)f.runs[0].run_attempt=2;return api(url);};
  await assert.rejects(f.select(),/RELEASE_PROOF_RUN_CHANGED/);
});
