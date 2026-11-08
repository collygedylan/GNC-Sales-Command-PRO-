import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stageFileContinuation,isRetryableErpFinalizeError} from '../../supabase/functions/_shared/erp-sync.mjs';
import {patchAppsScriptFunctions} from '../../scripts/apps-script-function-patch.mjs';
import {matchesAppsScriptFingerprint} from '../../scripts/apps-script-health-fingerprint.mjs';
function finalizeFixture(failureCount) {
  let commits = 0;
  const status = [];
  const args = {
    supabase: { rpc: async name => {
      assert.equal(name, 'fast_commit_erp_stage_swap_v1');
      commits++;
      return commits <= failureCount ? {error:{code:'55P03',message:'lock timeout'}} : {data:{ok:true}};
    } },
    fetcher:async()=>({ok:true,json:async()=>({parents:['drop']})}), token:'fixture',
    file:{id:'file',name:'drive.xlsx',parents:['drop']}, dataset:'drive_around', stageKey:'drive',
    parentId:'drop',processedId:'processed',status:async update=>status.push(update),
    state:{phase:'finalize',stageId:'stage',expectedRows:9450,processedRows:9450}
  };
  return {args,status,commits:()=>commits};
}

export async function finalizeResilienceContract() {
  for (const code of ['55P03','57014','40P01','40001']) assert.equal(isRetryableErpFinalizeError({code}),true);
  assert.equal(isRetryableErpFinalizeError({code:'42501',message:'forbidden'}),false);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    for (const failureCount of [5,7]) {
      const fixture = finalizeFixture(failureCount);
      for (let attempt = 0; attempt < Math.min(failureCount,6); attempt++) {
        const result = await stageFileContinuation(fixture.args);
        assert.equal(result.done,false);
        assert.equal(result.state.stageId,'stage');
        assert.equal(result.state.processedRows,9450);
        assert.equal(result.state.phase,'finalize');
        fixture.args.state = result.state;
        await stageFileContinuation(fixture.args);
        assert.equal(fixture.commits(),attempt+1,'backoff prevents repeated RPC calls');
        now = result.state.retryNotBefore;
      }
      if (failureCount === 7) {
        await assert.rejects(stageFileContinuation(fixture.args), /ERP_PUBLICATION_RETRY_EXHAUSTED/);
      } else {
        const final = await stageFileContinuation(fixture.args);
        assert.equal(final.done,true);
        assert.equal(final.result.rowCount,9450);
      }
      assert.equal(fixture.status.some(update=>update.active===false),false);
    }
  } finally { Date.now = originalNow; }
}
export function summaryNotificationContract(){
 const source=readFileSync(new URL('../../assets/app-runtime.js',import.meta.url),'utf8');
 const start=source.indexOf('        function notifyManagerUnassignedItems()');const end=source.indexOf('        function openManagerUnassignedItems()',start);
 const values=new Map();let codes=['A','B'],count=0,body='';
 const context=vm.createContext({currentUser:'fixture',canViewAssignedItemsExport:()=>true,getManagerUnassignedItemcodes:()=>codes,getSupabaseReadIdentityScope:()=> 'fixture',localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},showToast:(_title,b)=>{count++;body=b}});
 vm.runInContext(source.slice(start,end),context);assert.equal(context.notifyManagerUnassignedItems(),2);assert.equal(context.notifyManagerUnassignedItems(),0);assert.equal(count,1);assert.match(body,/2 item code/);codes=[];context.notifyManagerUnassignedItems();codes=['A'];context.notifyManagerUnassignedItems();assert.equal(count,2);
}
export function fingerprintHealthContract(){
 const old="const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__'; function getAppsScriptDeploymentHealth_(){return {ok:true};} function remoteOnlyRoute(){return 'keep';}";
 const local=old.replace('{ok:true}','{ok:true,deployedCommit:APPS_SCRIPT_DEPLOYMENT_COMMIT_}');
 const patched=patchAppsScriptFunctions({remoteSource:old,localSource:local,functionNames:['getAppsScriptDeploymentHealth_']}).source;
 assert.match(patched,/function remoteOnlyRoute\(\)\{return 'keep';\}/);assert.match(patched,/deployedCommit:APPS_SCRIPT_DEPLOYMENT_COMMIT_/);
 const sourceCommit='a'.repeat(40),frontendCommit='b'.repeat(40);
 assert.equal(matchesAppsScriptFingerprint({deployedCommit:sourceCommit},sourceCommit),true);
 assert.equal(matchesAppsScriptFingerprint({deployedCommit:frontendCommit},sourceCommit),false);
 assert.equal(matchesAppsScriptFingerprint({deployedCommit:'__PLACEHOLDER__'},sourceCommit),false);
}
