import assert from 'node:assert/strict';
import { compactErpPublicationState } from '../../supabase/functions/_shared/erp-publication-checkpoint.mjs';

export function assertErpPublicationCheckpoint() {
  const identityCounts = Object.fromEntries(Array.from({ length: 9610 }, (_, index) => [`drive-${String(index).padStart(32, '0')}`, 1]));
  const state = { phase: 'finalize', stageId: 'sealed-stage', expectedRows: 9610, processedRows: 9610,
    stagedPrefixRows: 0, expectedRowsPending: false, contentHash: 'source-hash', modifiedAt: 'source-modified',
    nextOffset: 9710, identityCounts, headerRowIndex: 3, header: ['itemcode', 'unique_id'],
    publicationProgressAt: 1000, publicationRecoveryAttempted: true };
  const compact = compactErpPublicationState(state);
  assert.ok(JSON.stringify(state).length > 400000);
  assert.ok(JSON.stringify(compact).length < 1000);
  assert.deepEqual(Object.keys(compact).sort(), Object.keys(state).filter(key => !['identityCounts', 'header', 'headerRowIndex'].includes(key)).sort());
  assert.equal(compact.stageId, state.stageId);
  assert.equal(compact.contentHash, state.contentHash);
  assert.equal(compact.expectedRows, 9610);
  assert.equal(state.identityCounts, identityCounts, 'compaction cannot mutate the previous checkpoint');
  assert.equal(compactErpPublicationState(compact), compact, 'already compact state is reused');
  for (const changes of [{ phase: 'staging' }, { phase: undefined }, { expectedRowsPending: true },
    { processedRows: 9609 }, { stagedPrefixRows: 1 }, { expectedRows: 0 }, { stageId: '' }]) {
    const incomplete = { ...state, ...changes };
    assert.equal(compactErpPublicationState(incomplete), incomplete, 'unfinished parsing must retain its exact identity/header state');
  }
}
