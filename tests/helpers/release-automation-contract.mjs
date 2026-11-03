import assert from 'node:assert/strict';
import { transformVersionSurface, applyVersionTransaction, assertPreparedVersionParity, decodeStagedBatch } from '../../scripts/sync-all-version-surfaces.mjs';
import { recoverVerifiedPublication, isTransientWorkflowFailure, finalizeVerifiedRelease, releaseStateLines, assertReleaseAdvance } from '../../scripts/recover-or-publish-release.mjs';
import { shouldRecoverFrontend } from '../../scripts/release-scope.mjs';
export function versionTransactionContract(){
 const content='Unicode ✅\nsecond line',bytes=Buffer.from(content),sha='a'.repeat(40),batch=Buffer.concat([Buffer.from(sha+' blob '+bytes.length+'\n'),bytes,Buffer.from('\n')]);assert.equal(decodeStagedBatch(batch,[{sha,file:'a.js'}]).get('a.js'),content);assert.throws(()=>decodeStagedBatch(batch.subarray(0,batch.length-1),[{sha,file:'a.js'}]),/INDEX_BATCH_INVALID/);
 const edge='const APP_RUNTIME_VERSION = "1.2.3";\nconst APP_RUNTIME_RELEASE = "AgData v1.2.3";\n';
 const next=transformVersionSurface('supabase/functions/app-api/index.ts',edge,'1.2.4','1.2.3');assert.match(next,/VERSION = "1.2.4"/);assert.match(next,/RELEASE = "AgData v1.2.4"/);assert.equal(transformVersionSurface('supabase/functions/app-api/index.ts',next,'1.2.4','1.2.4'),next);
 assert.equal(transformVersionSurface('scripts/apply-item-low-stock-migration.mjs','// AgData v1.2.3 historical migration\n','1.2.4','1.2.3'),'// AgData v1.2.3 historical migration\n');
 assert.equal(transformVersionSurface('tests/sample.test.mjs',String.raw`assert.match(x,/1\.2\.3/);`,'1.2.4','1.2.3'),String.raw`assert.match(x,/1\.2\.4/);`);
 const original={a:'old a',b:'old b'},values={...original};let fail=true;
 assert.throws(()=>applyVersionTransaction([{file:'a',before:values.a,after:'new a'},{file:'b',before:values.b,after:'new b'}],{write:(file,value)=>{values[file]=value;if(file==='b'&&fail){fail=false;throw Error('disk failure');}}}),/disk failure/);assert.deepEqual(values,original);
 assert.throws(()=>applyVersionTransaction([{file:'a',before:values.a,after:'new a'}],{write:(file,value)=>values[file]=value,verify:()=>{throw Error('artifact failed');}}),/artifact failed/);assert.deepEqual(values,original);
 const files={'version-parity.json':JSON.stringify({version:'1.2.4',sourceDigest:'staged-source'}),'index.html':'AgData v1.2.4','assets/app-runtime.js':next,'sw.js':'AgData v1.2.4','manifest.json':'{"version":"AgData v1.2.4"}','v2/manifest.webmanifest':'{"version":"AgData v1.2.4"}'};
 const verify=()=>assertPreparedVersionParity({version:'1.2.4',sourceDigest:'staged-source',read:file=>files[file]});assert.equal(verify(),true);files['assets/app-runtime.js']=edge;assert.throws(verify,/SITE_VERSION_MISMATCH/);files['assets/app-runtime.js']=next;files['version-parity.json']=JSON.stringify({version:'1.2.4',sourceDigest:'unstaged-source'});assert.throws(verify,/SITE_SOURCE_MISMATCH/);
}
const head='b'.repeat(40),old='a'.repeat(40),green={id:1,head_sha:head,head_branch:'main',run_attempt:1,status:'completed',conclusion:'success'};
export async function pushDiscoveryContract(){
 for(const visibleAt of [0,3000,27000,30000,Infinity]){
  let elapsed=0,dispatches=0,finalizations=0;const polls=[],waits=[];
  await recoverVerifiedPublication({sha:head,version:'1.2.4',now:()=>elapsed,
   runs:async()=>{polls.push(elapsed);return elapsed>=visibleAt||dispatches?[green]:[{...green,head_sha:old},{...green,head_branch:'other'}];},
   readLive:async()=>({release:'AgData v1.2.4',commit:head}),hasFrontendDiff:async()=>false,isAncestor:async()=>true,
   dispatch:async base=>{assert.equal(elapsed,30000,'missing run must receive the full push-discovery grace window');assert.equal(base,'');dispatches++;},
   rerun:async()=>assert.fail('discovery must not rerun CI'),failureLogs:async()=>'',
   wait:async ms=>{waits.push(ms);elapsed+=ms;},finalize:async()=>{finalizations++;}});
  assert.equal(dispatches,visibleAt===Infinity?1:0);assert.equal(finalizations,1);
  const graceEnd=Math.min(visibleAt,30000);assert.deepEqual(polls.filter(t=>t<=graceEnd),Array.from({length:graceEnd/3000+1},(_,i)=>i*3000));
  assert.deepEqual(waits.slice(0,graceEnd/3000),Array(graceEnd/3000).fill(3000));
 }
 let elapsed=0;
 await assert.rejects(recoverVerifiedPublication({sha:head,version:'1.2.4',now:()=>elapsed,runs:async()=>[],
  assertMain:async()=>{if(elapsed===3000)throw Error('superseded');},wait:async ms=>{elapsed+=ms;},
  dispatch:async()=>assert.fail('superseded main must not dispatch')}),/superseded/);
}
export async function frontendRecoveryContract(){
 assert.equal(shouldRecoverFrontend({toolingOnly:false,deploy:{frontend:false,supabase:true}}),true);assert.equal(shouldRecoverFrontend({toolingOnly:true,deploy:{}}),false);
 let published=false,dispatches=0,finalizations=0;const options={sha:head,version:'1.2.4',runs:async()=>[{...green,id:published?2:1}],readLive:async()=>({release:'AgData v'+(published?'1.2.4':'1.2.3'),commit:published?head:old}),hasFrontendDiff:async()=>true,isAncestor:async()=>true,dispatch:async base=>{assert.equal(base,old);dispatches++;published=true;},rerun:async()=>assert.fail('functional recovery must not rerun a failed job'),failureLogs:async()=>'',wait:async()=>{},finalize:async()=>{finalizations++;}};
 await recoverVerifiedPublication(options);assert.equal(dispatches,1);assert.equal(finalizations,1);await recoverVerifiedPublication(options);assert.equal(dispatches,1);assert.equal(finalizations,2);
 await assert.rejects(recoverVerifiedPublication({...options,assertMain:async()=>{throw Error('superseded');}}),/superseded/);
 assert.equal(isTransientWorkflowFailure({conclusion:'failure'},'AssertionError: runner lost communication'),false);assert.equal(isTransientWorkflowFailure({conclusion:'failure'},'runner lost communication'),true);
 let attempts=1,reruns=0;await recoverVerifiedPublication({...options,runs:async()=>[{...green,run_attempt:attempts,conclusion:attempts===1?'failure':'success'}],failureLogs:async()=>'runner lost communication',rerun:async()=>{attempts++;reruns++;}});assert.equal(reruns,1);
 await assert.rejects(recoverVerifiedPublication({...options,runs:async()=>[{...green,conclusion:'failure'}],failureLogs:async()=>'not ok 1 - assertion failure'}),/CI_FAILED/);
}
export async function finalizationContract(){
 assert.doesNotThrow(()=>assertReleaseAdvance('1.2.3','1.2.4'));assert.throws(()=>assertReleaseAdvance('1.3.0','1.2.4'),/SETTING_NEWER/);
 let database='1.2.3',state=null,writes=0,fail=true;const options={version:'1.2.4',sha:head,runId:2,liveCommit:head,updateSetting:async version=>{if(database!==version){database=version;writes++;}},verifySetting:async()=>database,saveState:async data=>{if(fail){fail=false;throw Error('interrupted local wait');}state=releaseStateLines(data);}};
 await assert.rejects(finalizeVerifiedRelease(options),/interrupted/);assert.equal(state,null);await finalizeVerifiedRelease(options);assert.equal(writes,1);assert.equal(state.length,10);assert.ok(state[0].includes('1.2.4'));
 let called=false;await assert.rejects(finalizeVerifiedRelease({...options,verifySetting:async()=>'1.2.3',saveState:async()=>{called=true;}}),/SETTING_MISMATCH/);assert.equal(called,false);
 await finalizeVerifiedRelease({...options,updateSetting:async()=>{throw Error('RELEASE_SETTING_CONCURRENT_CHANGE');}});assert.equal(state.length,10);
 await assert.rejects(finalizeVerifiedRelease({...options,updateSetting:async()=>{throw Error('RELEASE_SETTING_CONCURRENT_CHANGE');},verifySetting:async()=>'1.2.5'}),/CONCURRENT_CHANGE/);
}

export async function cdnPropagationContract(){
 for(const freshAt of [6000,30000,Infinity]){
  let elapsed=0,dispatches=0,reads=[];
  await recoverVerifiedPublication({sha:head,version:'1.2.4',runs:async()=>[green],now:()=>elapsed,
   readLive:async()=>{reads.push(elapsed);return elapsed>=freshAt||dispatches?{release:'AgData v1.2.4',commit:head}:{release:'AgData v1.2.3',commit:old};},
   wait:async ms=>{elapsed+=ms;},hasFrontendDiff:async()=>true,isAncestor:async()=>true,
   dispatch:async base=>{assert.equal(elapsed,30000);assert.equal(base,old);dispatches++;},finalize:async()=>{}});
  assert.equal(dispatches,Number(freshAt===Infinity));
  assert.deepEqual(reads.filter(t=>t<=30000),Array.from({length:Math.min(freshAt,30000)/3000+1},(_,i)=>i*3000));
 }
}
