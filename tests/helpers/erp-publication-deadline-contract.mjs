import assert from 'node:assert/strict';
import {boundedErpPublicationRpc, finishStageContinuation} from '../../supabase/functions/_shared/erp-stage-publication.mjs';
import {fixtureErpReceipt} from '../../src/core/erp-runtime-fetch-fixtures.mjs';

export async function assertPublicationDeadline() {
  let signal;
  const request = {abortSignal(value) {signal=value;return new Promise(()=>{});}};
  const start = performance.now();
  await assert.rejects(boundedErpPublicationRpc({rpc:()=>request},'commit',{},10), {name:'TimeoutError'});
  assert.equal(signal.aborted,true);
  assert.ok(performance.now()-start<1000);
  const stages=[],moves=[];
  const next={stageId:'same-stage',processedRows:2000,expectedRows:2000};
  const context={next,file:{name:'same.xlsx'},dataset:'drive_around',stageKey:'drive',requireReceipt:true,
    status:async patch=>stages.push(patch),moveProcessed:async()=>moves.push('moved')};
  const busy=await finishStageContinuation({...context,supabase:{rpc:async()=>({data:{busy:true,preparedRows:2000}})}});
  assert.equal(busy.done,false);
  assert.equal(busy.state.stageId,next.stageId);
  assert.equal(stages.at(-1).sourceProgressDelta.percent,95);
  assert.deepEqual(moves,[]);
  const result=await finishStageContinuation({...context,supabase:{rpc:async()=>({data:fixtureErpReceipt('ph_master_inventory','same.xlsx',2000)})}});
  assert.equal(result.done,true);
  assert.equal(stages.at(-1).sourceProgressDelta.percent,100);
  assert.deepEqual(moves,['moved']);
  await assert.rejects(finishStageContinuation({...context,supabase:{rpc:async()=>({data:{ok:true}})}}), /UNCONFIRMED/);
  assert.deepEqual(moves,['moved']);
}
