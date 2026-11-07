import test from 'node:test';
import assert from 'node:assert/strict';
import { stageFileContinuation } from '../supabase/functions/_shared/erp-sync.mjs';
test('ERP finalize 57014 preserves the stage, exponentially delays retries, and stops the infinite loop', async () => {
 let calls=0;const updates=[];const input={supabase:{rpc:async()=>{calls++;return {error:{code:'57014',message:'statement timeout'}};}},fetcher:()=>{throw Error('No file re-download');},token:'fixture',file:{id:'file',name:'file.xlsx'},dataset:'drive_around',stageKey:'drive',parentId:'source',processedId:'done',status:async patch=>updates.push(patch)};
 let state={phase:'finalize',stageId:'stage-receipt',processedRows:10,expectedRows:10};
 for(let attempt=1;attempt<=6;attempt++) {
  const before=Date.now(); const result=await stageFileContinuation({...input,state:{...state,retryNotBefore:0}});
  state=result.state;assert.equal(state.stageId,'stage-receipt');assert.equal(state.finalizeAttempts,attempt);
  assert.ok(state.retryNotBefore>=before+Math.min(60000,5000*2**(attempt-1)));
  const cool=await stageFileContinuation({...input,state});assert.equal(cool.state,state);assert.equal(calls,attempt);
 }
 await assert.rejects(stageFileContinuation({...input,state:{...state,retryNotBefore:0}}),/ERP_PUBLICATION_RETRY_EXHAUSTED/);
 assert.equal(calls,7);assert.equal(updates.length,6);
});
test('busy ERP publication retains the same stage and yields instead of immediately repeating', async()=>{
 let calls=0; const input={supabase:{rpc:async()=>{calls++;return {data:{ok:true,busy:true}};}},file:{name:'source.xlsx'},dataset:'drive_around',status:async()=>{},state:{phase:'finalize',stageId:'same',processedRows:1,expectedRows:1}};
 const result=await stageFileContinuation(input); await stageFileContinuation({...input,state:result.state});assert.equal(calls,1);assert.equal(result.state.stageId,'same');
});
