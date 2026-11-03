import {claspRefreshParameters} from '../../scripts/google-clasp-api.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {matchesSchema,validateSchema} from '../../services/database-contract-runtime.ts';
import {matchesAppsScriptSourceFingerprint,verifyHeadOnlyAppsScript} from '../../scripts/apps-script-health-fingerprint.mjs';
import {runToolingReleaseChecks} from '../../scripts/run-tooling-release-checks.mjs';
import {functionSource} from './completed-row-contract.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function dormantFamilyContract(){
 const c=vm.createContext({getManagerAssignedColumnState:()=>({}),fullInventory:[{ITEMCODE:'123456.010.1',PLANTGROUPCODE:'130_SHRUB'}],buildManagerEvalAssignmentKey:v=>String(v||'').toUpperCase(),getCropRollPlantGroup:r=>r.PLANTGROUPCODE||r.plant_group_code||''});
 vm.runInContext(functionSource('enrichManagerAssignedPlantGroups'),c);
 assert.equal(c.enrichManagerAssignedPlantGroups([{itemcode:'123456.070.9'}])[0].PLANTGROUPCODE,'130_SHRUB');
 c.fullInventory.push({ITEMCODE:'123456.030.1',PLANTGROUPCODE:'330_TREES'});
 assert.equal(c.enrichManagerAssignedPlantGroups([{itemcode:'123456.070.9'}])[0].PLANTGROUPCODE,'');
 const sql=read('supabase/migrations/20261103030000_dormant_itemcode_family_groups.sql');
 assert.match(sql,/lock_timeout = '4s'/);assert.match(sql,/statement_timeout = '15s'/);assert.match(sql,/DORMANT_GROUP_PROTECTED_STATE_CHANGED/);
 assert.match(sql,/h.itemcode>=d.family/);assert.match(sql,/ph_drive_around_report_rows/);assert.doesNotMatch(sql,/set assignedto|delete from|truncate /i);
}
export function additiveReadContract(){
 const schema={object:{itemcode:{schema:'string'},plant_group_code:{schema:'string'}}};
 const row={itemcode:'123456.010.1',plant_group_code:'130_SHRUB',extra_metadata:{source:'Drive',revision:2}};
 assert.equal(matchesSchema(schema,row),false,'writes still reject extra fields');
 assert.doesNotThrow(()=>validateSchema(schema,row,'read',true));
 for(const bad of [{...row,itemcode:42},{extra_metadata:'missing known fields'},{...row,extra_metadata:()=>{}}])assert.throws(()=>validateSchema(schema,bad,'read',true));
 assert.match(read('services/databaseRest.ts'),/validateSchema\(schema, row, .*method === 'GET'/);
}
export function sourceFingerprintContract(){
 const expected='a'.repeat(40),deployed='b'.repeat(40),blob='c'.repeat(40);let reads=0;
 assert.equal(matchesAppsScriptSourceFingerprint({deployedCommit:deployed},expected,()=>{reads++;return blob;}),true);assert.equal(reads,2);
 assert.equal(matchesAppsScriptSourceFingerprint({deployedCommit:deployed},expected,sha=>sha),false);
 assert.equal(matchesAppsScriptSourceFingerprint({deployedCommit:'__PLACEHOLDER__'},expected,()=>blob),false);
 assert.equal(matchesAppsScriptSourceFingerprint({deployedCommit:deployed},expected,()=>{throw Error('unknown source');}),false);
}
export function fastDefaultContract(){
 const env={AGDATA_FULL_AUDIT_ONCE:'1'},modes=[];
 const spawn=(_cmd,args,options)=>{modes.push(args.find(a=>a.startsWith('--test-concurrency=')));assert.equal(options.env.AGDATA_FULL_AUDIT_ONCE,undefined);return {status:0,stdout:'# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n'};};
 for(let i=0;i<2;i++)assert.equal(runToolingReleaseChecks({env,spawn,print(){}}).exitCode,0);
 assert.deepEqual(modes,['--test-concurrency=1','--test-concurrency=8']);
 const charter=read('AGENTS.md');for(const role of ['Nursery Business and Product Truth','Photo Lifecycle Owner','Dark-Emerald Touch Owner','Tables, Roster and Access Owner','Database, Storage and Anti-Rogue Owner','Fast Snapshot QA and Zero-Regression Gatekeeper'])assert.ok(charter.includes(role),role);
}

export async function verifiedHeadOnlyContract(){
 const payload={deployedCommit:'d5d7fb8dcffd4e4d585ca0fd6b51028c45c56bd2'},head='a3c49fae64db2184503bdf8c99e6f5e47172a2f6';
 const api=async path=>path.endsWith('/content')?{files:[]}:{deploymentId:'production',deploymentConfig:{scriptId:'script',versionNumber:376}};
 assert.equal(await verifyHeadOnlyAppsScript(payload,head,'script','production',api),false,'unexpected trigger source must fail');
 assert.equal(await verifyHeadOnlyAppsScript(payload,'1'.repeat(40),'script','production',()=>{throw Error('unexpected read');}),false);
 assert.equal(await verifyHeadOnlyAppsScript({deployedCommit:'2'.repeat(40)},head,'script','production',api),false);
}

export async function projectedDeploymentHealthContract() {
  const web = { deployedCommit: 'd5d7fb8dcffd4e4d585ca0fd6b51028c45c56bd2' };
  const head = 'a3c49fae64db2184503bdf8c99e6f5e47172a2f6';
  const calls = [];
  const api = async address => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://script.googleapis.com');
    calls.push(url.pathname);
    if (url.pathname.endsWith('/content')) return {files:[{type:'SERVER_JS',name:'Code',source:'changed'}]};
    assert.equal(url.pathname, '/v1/projects/script/deployments/web');
    if (url.searchParams.get('fields') !== 'deploymentId,deploymentConfig(scriptId,versionNumber)') throw Error('GOOGLE_API_HTTP_503');
    return {deploymentId:'web',deploymentConfig:{scriptId:'script',versionNumber:376}};
  };
  assert.equal(await verifyHeadOnlyAppsScript(web,head,'script','web',api),false,'a valid identity cannot authorize changed trigger source');
  assert.deepEqual(calls.sort(),['/v1/projects/script/content','/v1/projects/script/deployments/web']);
}

export function hostedClaspCredentialContract() {
  const token={refresh_token:' fixture-refresh ',client_id:' fixture-client ',client_secret:' fixture-secret '};
  for (const rc of [{token},{tokens:token},{tokens:{default:token}},{tokens:{account:token}},
    {tokens:{default:{refresh_token:token.refresh_token}},oauth2ClientSettings:{clientId:token.client_id,clientSecret:token.client_secret}}]) {
    const body=claspRefreshParameters('\uFEFF'+JSON.stringify(rc)+'\r\n');
    assert.deepEqual(Object.fromEntries(body),{client_id:'fixture-client',client_secret:'fixture-secret',refresh_token:'fixture-refresh',grant_type:'refresh_token'});
  }
  assert.throws(()=>claspRefreshParameters('not a credential'),/^Error: GOOGLE_CLASP_JSON_INVALID$/);
  assert.throws(()=>claspRefreshParameters('{}'),/^Error: GOOGLE_CLASP_CREDENTIALS_MISSING$/);
}
