import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { assertV2311AuthorizedPaths, computeV2311SourceHashDigest, validateV2311ResultArtifact } from '../scripts/check-v2311-retained-validation.mjs';
import { patchAppsScriptFunctions } from '../scripts/apps-script-function-patch.mjs';
const load=file=>yaml.load(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));

test('v2311 retained artifacts bind status, validation identity, counts, exact bytes, and tested source',()=>{
 const sourceHashDigest=computeV2311SourceHashDigest({'assets/user-access-control.js':'a'.repeat(64),'index.html':'b'.repeat(64)});
 const artifact={schemaVersion:'agdata-v2311-validation-result-v1',scope:'node',validationId:'node-run-2026-10-19T16:00Z',status:'passed',checks:12,sourceHashDigest};
 const artifactText=JSON.stringify(artifact);
 const artifactSha256=createHash('sha256').update(Buffer.from(artifactText,'utf8')).digest('hex');
 const receiptResult={artifactPath:'docs/releases/v2.3.11-validation/node.json',artifactSha256,validationId:artifact.validationId,status:'passed',checks:12,sourceHashDigest};
 assert.equal(validateV2311ResultArtifact({scope:'node',receiptResult,artifactText,sourceHashDigest}).checks,12);
 assert.throws(()=>validateV2311ResultArtifact({scope:'node',receiptResult:{...receiptResult,artifactSha256:'0'.repeat(64)},artifactText,sourceHashDigest}),/V2311_RESULT_HASH_MISMATCH/);
 assert.throws(()=>validateV2311ResultArtifact({scope:'node',receiptResult:{...receiptResult,artifactPath:'docs/releases/other.json'},artifactText,sourceHashDigest}),/V2311_RESULT_PATH_INVALID/);
 assert.throws(()=>validateV2311ResultArtifact({scope:'node',receiptResult,artifactText:'{malformed',sourceHashDigest}),/V2311_RESULT_HASH_MISMATCH/);
 assert.throws(()=>validateV2311ResultArtifact({scope:'node',receiptResult:{...receiptResult,artifactSha256:createHash('sha256').update('{malformed').digest('hex')},artifactText:'{malformed',sourceHashDigest}),/V2311_RESULT_JSON_INVALID/);
 const wrongSourceText=JSON.stringify({...artifact,sourceHashDigest:'c'.repeat(64)});
 const wrongSourceHash=createHash('sha256').update(Buffer.from(wrongSourceText,'utf8')).digest('hex');
 assert.throws(()=>validateV2311ResultArtifact({scope:'node',receiptResult:{...receiptResult,artifactSha256:wrongSourceHash,sourceHashDigest:'c'.repeat(64)},artifactText:wrongSourceText,sourceHashDigest}),/V2311_RESULT_CONTRACT_INVALID/);
 assert.throws(()=>validateV2311ResultArtifact({scope:'node',receiptResult:{...receiptResult,validationId:'other'},artifactText,sourceHashDigest}),/V2311_RESULT_CONTRACT_INVALID/);
 assert.throws(()=>validateV2311ResultArtifact({scope:'node',receiptResult:{...receiptResult,checks:0},artifactText,sourceHashDigest}),/V2311_RESULT_CONTRACT_INVALID/);
});

test('v2311 exact changed-path guard rejects unapproved sources and every deletion',()=>{
 assert.doesNotThrow(()=>assertV2311AuthorizedPaths([
  {status:'M',file:'index.html'},
  {status:'A',file:'docs/releases/v2.3.11-validation/database.json'},
 ]));
 assert.throws(()=>assertV2311AuthorizedPaths([{status:'M',file:'src/unreviewed-feature.ts'}]),/V2311_UNAUTHORIZED_SOURCE_PATH/);
 assert.throws(()=>assertV2311AuthorizedPaths([{status:'D',file:'assets/user-access-control.js'}]),/V2311_DELETION_FORBIDDEN/);
 assert.throws(()=>assertV2311AuthorizedPaths([{status:'M',file:'index.html'},{status:'M',file:'index.html'}]),/V2311_DUPLICATE_SOURCE_PATH/);
});

test('database workflow executes the selected schema suites and gates on their exit status',()=>{
 const db=load('.github/workflows/release-database.yml');
 const gate=db.jobs['schema-gate'].steps.find(step=>step.name==='Require every selected backend integration check');
 assert.doesNotMatch(fs.readFileSync(new URL('../.github/workflows/release-database.yml',import.meta.url),'utf8'), /V238|V2311|V2313|scopedValidationReceipt|retained/i);
 for(const name of ['integration','schema-contracts','suspend-tag-approval','database-and-functions'])
  assert.match(db.jobs[name].if, /needs\.schema-path-scope\.outputs\.changed == 'true'/);
 assert.match(db.jobs['edge-functions'].if, /needs\.discover\.outputs\.edge/);
 assert.match(gate.run,/jobs\[name\]\?\.result !== 'success'/);
 assert.equal(db.jobs.integration.steps[0].with['fetch-depth'],0);
});

test('backend publication is authorized independently and deploys the exact selected functions',()=>{
 const workflow=load('.github/workflows/apps-script-sync.yml');
 const deploy=workflow.jobs['deploy-supabase'];
 assert.match(deploy.if,/needs\.authorize-backend\.outputs\.authorized == 'true'/);
 assert.doesNotMatch(JSON.stringify(deploy.needs),/pages/i);
 const step=deploy.steps.find(row=>row.name==='Deploy changed Edge Functions');
 assert.match(step.run,/RELEASE_EDGE_FUNCTIONS/);
 assert.match(step.run,/functions deploy/);
 assert.match(step.run,/for function_name in/);
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(Array.isArray(pkg.appsScriptPatchFunctions));
 assert.ok(pkg.appsScriptPatchFunctions.every(name=>typeof name==='string' && /^[A-Za-z_$][\w$]*$/.test(name)));
 assert.equal(new Set(pkg.appsScriptPatchFunctions).size,pkg.appsScriptPatchFunctions.length);
});
test('Apps Script patching preserves unselected functions with a synthetic fixture',()=>{
 const remote='const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = "fixture";\nfunction handleSignedRequestDeliveryEvent_(){ return "old"; }\nfunction protectedJob(){ return "trusted"; }\n';
 const local='const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = "fixture";\nfunction handleSignedRequestDeliveryEvent_(){ return "new"; }\nfunction protectedJob(){ return "attacker"; }\n';
 const result=patchAppsScriptFunctions({remoteSource:remote,localSource:local,functionNames:['handleSignedRequestDeliveryEvent_']});
 assert.match(result.source,/function handleSignedRequestDeliveryEvent_\(\)\{ return "new"; \}/);
 assert.match(result.source,/function protectedJob\(\)\{ return "trusted"; \}/);
 assert.doesNotMatch(result.source,/attacker/);
});
