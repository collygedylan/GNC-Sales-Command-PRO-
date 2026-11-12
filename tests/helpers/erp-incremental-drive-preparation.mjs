import assert from 'node:assert/strict';
import { finishStageContinuation } from '../../supabase/functions/_shared/erp-stage-publication.mjs';

export async function assertIncrementalDrivePublication() {
  const file = { id: 'fixture-drive', name: 'incremental.xlsx' };
  const statuses = [];
  const moved = [];
  let next = { stageId: 'fixture-stage', phase: 'finalize', expectedRows: 501, processedRows: 501 };
  const invoke = data => finishStageContinuation({
    file, next, dataset: 'drive_around', stageKey: 'drive', requireReceipt: true,
    supabase: { rpc: async (name, args) => {
      assert.equal(name, 'fast_commit_erp_stage_swap_v1');
      assert.equal(args.p_stage_id, next.stageId);
      return { data };
    } },
    status: async patch => statuses.push(patch.sourceProgressDelta),
    moveProcessed: async (_fetch, _token, published) => moved.push(published.id)
  });
  const busy = { ok: true, busy: true, preparedRows: 501, stage_id: next.stageId };
  const checkpoints = [250, 500, 501].map(typedPreparedRows => ({ ...busy, typedPreparedRows }));
  checkpoints.push({ ...busy, typedPreparedRows: 501, sourceDigest: 'a'.repeat(64) });
  for (const checkpoint of checkpoints) {
    const result = await invoke({ ...checkpoint, publicationProgressAt: Date.now() });
    assert.equal(result.done, false);
    assert.equal(statuses.at(-1).rowsPublished, 0);
    assert.deepEqual(moved, []);
    next = { ...result.state, retryNotBefore: 0 };
  }
  const receipt = { ok: true, stage_commit: 'canonical_atomic_import', dataset_key: 'ph_master_inventory',
    staged_rows: 501, source_rows: 501, file_name: file.name };
  await assert.rejects(invoke({ ...receipt, file_name: 'other.xlsx' }), /ERP_STAGE_COMMIT_UNCONFIRMED/);
  assert.deepEqual(moved, []);
  assert.equal((await invoke(receipt)).done, true);
  assert.equal(statuses.at(-1).rowsPublished, 501);
  assert.deepEqual(moved, [file.id]);
}
