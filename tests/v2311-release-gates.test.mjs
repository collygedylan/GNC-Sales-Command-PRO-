import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { assertV2311AuthorizedPaths, computeV2311SourceHashDigest, validateV2311ResultArtifact } from '../scripts/check-v2311-retained-validation.mjs';
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

test('v2311 CI retains full suites only behind the exact source evidence and changed-edge checks',()=>{
 const db=load('.github/workflows/release-database.yml');
 const gate=db.jobs['schema-gate'].steps.find(step=>step.name==='Require every selected backend integration check');
 const script=gate.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/,'');
 const result=Object.fromEntries(['schema-path-scope','discover','integration','edge-functions'].map(name=>[name,{result:'success'}]));
 for(const name of ['schema-contracts','suspend-tag-approval','database-and-functions'])result[name]={result:'skipped'};
 const run=()=>vm.runInNewContext(script,{process:{env:{SCOPE:'true',V2311:'true',RESULTS:JSON.stringify(result)}},console:{log(){}}});
 assert.doesNotThrow(run);
 for(const name of ['integration','edge-functions','discover']){
  result[name].result='skipped';assert.throws(run,/BACKEND_SCHEMA_GATE_FAILED/);result[name].result='success';
 }
 assert.equal(db.jobs.integration.steps[0].with['fetch-depth'],0);
 const ci=fs.readFileSync(new URL('../scripts/ci-backend-matrix.mjs',import.meta.url),'utf8');
 assert.match(ci,/packageVersion === '2\.3\.11'[\s\S]*?verifyV2311RetainedValidation[\s\S]*?scripts\/check-v2311-retained-validation.mjs/);
});

test('v2311 backend publication is authorized independently and only deploys touched functions',()=>{
 const workflow=load('.github/workflows/apps-script-sync.yml');
 const deploy=workflow.jobs['deploy-supabase'];
 assert.match(deploy.if,/backend-validation.result == 'success'/);
 assert.match(deploy.if,/v238-retained-contracts.result == 'success'/);
 assert.doesNotMatch(JSON.stringify(deploy.needs),/pages/i);
 const step=deploy.steps.find(row=>row.run?.includes('V2311_SCOPED_DEPLOY'));
 const scoped=step.run.split('if [[ "$V2311_SCOPED_DEPLOY"')[1].split('elif')[0];
 assert.match(scoped,/functions deploy app-api/);assert.match(scoped,/functions deploy request-delivery-worker/);
 assert.doesNotMatch(scoped,/functions deploy (?:auth-admin|scheduled-offboarding|inventory-assistant)|secrets set/);
 assert.match(step.run,/for attempt in 1 2; do/);
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(pkg.appsScriptPatchFunctions.includes('handleSignedInventoryReclassMoveDelivery_'));
 assert.ok(pkg.appsScriptPatchFunctions.every(name=>!name.toLowerCase().includes('history')));
});
import { parse } from 'acorn';
import { execFileSync } from 'node:child_process';

test('v2311 Code.gs edits are restricted to the completed receipt handler and signed dispatcher',()=>{
 const before=execFileSync('git',['show','f3bb57f2d77524617bce1502efd75a207b19bac7:Code.gs'],{encoding:'utf8',maxBuffer:16*1024*1024});
 const after=fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
 const allowed=new Set(['handleSignedRequestDeliveryEvent_','handleSignedInventoryReclassMoveDelivery_']);
 const protectedNodes=source=>parse(source,{ecmaVersion:'latest',sourceType:'script'}).body
  .filter(node=>node.type!=='FunctionDeclaration'||!allowed.has(node.id.name))
  .map(node=>source.slice(node.start,node.end).replaceAll('\r\n','\n'));
 assert.deepEqual(protectedNodes(after),protectedNodes(before),'all backfill functions, scheduling constants, and other handlers remain byte-identical after newline normalization');
});
