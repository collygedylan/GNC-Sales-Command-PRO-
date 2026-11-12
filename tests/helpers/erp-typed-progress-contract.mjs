import assert from 'node:assert/strict';
import { readErpStagePublication } from '../../supabase/functions/_shared/erp-publication-recovery.mjs';
import { finishStageContinuation } from '../../supabase/functions/_shared/erp-stage-publication.mjs';

export async function assertErpTypedPreparationProgress() {
  const began = Date.now();
  const state = { stageId: 'typed-stage', phase: 'finalize', expectedRows: 9610,
    processedRows: 9610, publicationPreparedRows: 9610, publicationProgressAt: began - 180000 };
  const calls = [], statuses = [], moves = [];
  const response = { ok: true, busy: true, stage_id: state.stageId, preparedRows: 9610,
    typedPreparedRows: 1000, publicationProgressAt: began, retryAfterMs: 2500 };
  const rpc = async (_client, name, args) => {
    calls.push({ name, args });
    return { data: name === 'resume_erp_stage_publication_v3077'
      ? { ...response, recoveryAccepted: true } : response };
  };
  const progress = await readErpStagePublication({}, state, rpc, began + 5000);
  assert.equal(progress.state.publicationProgressAt, began);
  assert.equal(progress.state.publicationRecoveryAttempted, undefined);
  assert.equal(calls.length, 1, 'durable typed progress postpones recovery without changing normalized row counts');
  const pending = await finishStageContinuation({ next: state,
    file: { id: 'typed-file', name: 'Typed.xlsx' }, dataset: 'drive_around', stageKey: 'drive',
    supabase: { rpc: (name, args) => rpc({}, name, args) }, requireReceipt: true,
    status: async patch => statuses.push(patch), moveProcessed: async () => moves.push('archive') });
  assert.equal(pending.done, false);
  assert.equal(pending.state.stageId, state.stageId);
  assert.equal(pending.state.processedRows, 9610);
  assert.equal(statuses.at(-1).sourceProgressDelta.rowsPublished, 0);
  assert.equal(statuses.at(-1).sourceProgressDelta.percent, 95);
  assert.deepEqual(moves, [], 'typed preparation cannot authorize archival or claim a publication receipt');
  const stalled = await readErpStagePublication({}, progress.state, rpc, began + 90000);
  assert.equal(stalled.state.publicationRecoveryAttempted, true);
  assert.equal(calls.at(-1).args.p_stage_id, state.stageId);
  await readErpStagePublication({}, stalled.state, rpc, began + 180000);
  assert.equal(calls.filter(call => call.name === 'resume_erp_stage_publication_v3077').length, 1);
}
