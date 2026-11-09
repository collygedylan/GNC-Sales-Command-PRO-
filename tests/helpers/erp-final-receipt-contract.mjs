import assert from 'node:assert/strict';
import { finishStageContinuation } from '../../supabase/functions/_shared/erp-stage-publication.mjs';

export async function assertBoundedErpFinalReceipt() {
  const moved = [], statuses = [];
  const next = { stageId:'preserved-stage',processedRows:9549,expectedRows:9549,phase:'finalize' };
  const context = {
    next, dataset:'drive_around',stageKey:'drive',parentId:'source',processedId:'processed',
    file:{id:'preserved-file',name:'DriveAroundMC-10-06394220261109063943.xlsx'},
    status:async value=>statuses.push(value),moveProcessed:async()=>moved.push('preserved-file'),maxRows:20000
  };
  const busy = await finishStageContinuation({...context,
    supabase:{rpc:async()=>({data:{ok:true,busy:true,retryAfterMs:5000}})}});
  assert.equal(busy.done,false);
  assert.equal(busy.state.stageId,next.stageId);
  assert.equal(busy.state.processedRows,9549);
  assert.deepEqual(moved,[]);
  assert.equal(statuses.some(value=>value.sourceProgressDelta?.publicationConfirmed),false);
  await assert.rejects(finishStageContinuation({...context,next:{...next,finalizeAttempts:6},
    supabase:{rpc:async()=>({error:{code:'57014',message:'statement timeout'}})}}),
  /ERP_PUBLICATION_RETRY_EXHAUSTED/);
  assert.deepEqual(moved,[]);
  const saved = await finishStageContinuation({...context,
    supabase:{rpc:async()=>({data:{ok:true,stage_id:'preserved-stage'}})}});
  assert.equal(saved.done,true);
  assert.equal(saved.result.rowCount,9549);
  assert.deepEqual(moved,['preserved-file']);
  assert.equal(statuses.at(-1).sourceProgressDelta.publicationConfirmed,true);
}
