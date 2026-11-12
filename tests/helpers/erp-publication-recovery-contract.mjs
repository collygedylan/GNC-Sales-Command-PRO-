import assert from 'node:assert/strict';
import { readErpStagePublication } from '../../supabase/functions/_shared/erp-publication-recovery.mjs';
import { finishStageContinuation } from '../../supabase/functions/_shared/erp-stage-publication.mjs';

async function assertRecoveryReceiptFence() {
  let archives = 0;
  const args = { next: { stageId: 'exact-stage', expectedRows: 9610, processedRows: 9610 },
    file: { name: 'exact.xlsx' }, dataset: 'drive_around', stageKey: 'drive', requireReceipt: true,
    status: async () => {}, moveProcessed: async () => { archives += 1; },
    supabase: { rpc: async () => ({ data: { ok: true, stage_id: 'exact-stage',
      stage_commit: 'canonical_atomic_import', file_name: 'other.xlsx', dataset_key: 'ph_master_inventory',
      staged_rows: 9610, source_rows: 9610 } }) } };
  await assert.rejects(finishStageContinuation(args), /ERP_STAGE_COMMIT_UNCONFIRMED/);
  assert.equal(archives, 0);
}

// Heartbeats are not publication progress. Recover only the same sealed stage,
// once, after a full ninety-second interval without new prepared-row evidence.
export async function assertErpPublicationRecovery() {
  await assertRecoveryReceiptFence();
  const calls = [];
  const state = { stageId: 'exact-stage', expectedRows: 9610, processedRows: 9610,
    phase: 'finalize', publicationPreparedRows: 9610, publicationProgressAt: 1000 };
  const rpc = async (_client, name, args) => {
    calls.push({ name, args });
    return { data: { ok: true, busy: true, stage_id: state.stageId, preparedRows: 9610,
      ...(name.startsWith('resume_') ? { recoveryAccepted: true } : {}) } };
  };
  const early = await readErpStagePublication({}, state, rpc, 90999);
  assert.equal(early.state.publicationRecoveryAttempted, undefined);
  assert.equal(calls.length, 1);
  const recovered = await readErpStagePublication({}, state, rpc, 91000);
  assert.deepEqual(calls.at(-1), { name: 'resume_erp_stage_publication_v3077', args: { p_stage_id: state.stageId } });
  assert.equal(recovered.state.publicationRecoveryAttempted, true);
  assert.equal(recovered.state.stageId, state.stageId);
  assert.equal(recovered.state.processedRows, 9610);
  await readErpStagePublication({}, recovered.state, rpc, 300000);
  assert.equal(calls.filter(call => call.name.startsWith('resume_')).length, 1);
  const progressed = await readErpStagePublication({}, { ...state, publicationPreparedRows: 9000 }, rpc, 100000);
  assert.equal(progressed.state.publicationProgressAt, 100000);
  assert.equal(progressed.state.publicationRecoveryAttempted, undefined);
}
