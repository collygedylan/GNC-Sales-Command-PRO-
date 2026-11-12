import test from 'node:test';
import assert from 'node:assert/strict';
import { compactErpPublicationState } from '../supabase/functions/_shared/erp-publication-checkpoint.mjs';
import { finishStageContinuation } from '../supabase/functions/_shared/erp-stage-publication.mjs';
import { normalizeErpRowsChunk } from '../supabase/functions/_shared/erp-sync.mjs';
import { runPendingErpWorkerStep } from '../src/core/erp-worker-step.mjs';
import { fixtureErpReceipt } from '../src/core/erp-runtime-fetch-fixtures.mjs';
import { assertErpPublicationCheckpoint } from './helpers/erp-publication-checkpoint-contract.mjs';

function checkpoint() {
  return { phase: 'finalize', stageId: 'sealed-stage', expectedRows: 10, processedRows: 10,
    contentHash: 'source-hash', modifiedAt: 'source-modified', nextOffset: 12,
    identityCounts: { duplicate: 10 }, header: ['itemcode', 'unique_id'], headerRowIndex: 1 };
}

test('only an exactly sealed finalize checkpoint loses parser-only state', assertErpPublicationCheckpoint);

test('unfinished parsing retains duplicate identity numbering and original header', async () => {
  const partial = { ...checkpoint(), phase: 'staging', expectedRows: 100, processedRows: 1, identityCounts: { duplicate: 1 } };
  const retained = compactErpPublicationState(partial);
  assert.equal(retained.header, partial.header);
  const result = await normalizeErpRowsChunk([{ itemcode: 'item', uniqueid: 'duplicate' }], 'drive_around',
    ['itemcode', 'unique_id'], { priorRowCount: 1, identityCounts: retained.identityCounts });
  assert.equal(result.rows[0].values.unique_id, 'duplicate-1');
  assert.equal(result.rowCount, 2);
});

test('the first resumed status write omits the sealed parser map', async () => {
  const updates = [], file = { id: 'exact-file', name: 'exact.xlsx' };
  const result = await runPendingErpWorkerStep({ accessToken: 'fixture',
    cursor: { stageIndex: 0, fileContinuation: { stageIndex: 0, file, state: checkpoint() } },
    env: () => JSON.stringify({ drive: 'source' }), status: async patch => updates.push(patch) }, {
    stages: [{ key: 'drive', dataset: 'drive_around' }], sourceFolders: {}, resolveRows: () => 1000,
    prefetch: async () => ({ drive: { files: [file] } }),
    stageFile: async input => ({ done: false, state: input.state })
  });
  const first = updates[0].continuationCursor.fileContinuation;
  assert.equal(first.file.id, file.id);
  assert.equal(first.state.stageId, 'sealed-stage');
  assert.equal(Object.hasOwn(first.state, 'identityCounts'), false);
  assert.equal(Object.hasOwn(result.cursor.fileContinuation.state, 'header'), false);
});

test('failed sealing preserves parser state while a confirmed seal compacts publication retries', async () => {
  const state = { ...checkpoint(), expectedRows: 50000, expectedRowsPending: true };
  const args = { next: state, file: { name: 'exact.xlsx' }, dataset: 'drive_around', stageKey: 'drive',
    maxRows: 50000, status: async () => {}, moveProcessed: async () => assert.fail('no receipt') };
  const failed = await finishStageContinuation({ ...args, supabase: { rpc: async () => ({ error: { code: '57014' } }) } });
  assert.equal(failed.state.identityCounts, state.identityCounts);
  const rpc = async name => ({ data: name === 'fast_seal_erp_stage_v1' ? { ok: true } : { ok: true, busy: true } });
  const sealed = await finishStageContinuation({ ...args, supabase: { rpc } });
  assert.equal(sealed.state.expectedRows, 10);
  assert.equal(sealed.state.expectedRowsPending, false);
  assert.equal(Object.hasOwn(sealed.state, 'identityCounts'), false);
});

test('archive retry retains its exact receipt and source hash after parser compaction', async () => {
  const receipt = fixtureErpReceipt('ph_master_inventory', 'exact.xlsx', 10);
  const result = await finishStageContinuation({ next: checkpoint(), file: { name: 'exact.xlsx' },
    dataset: 'drive_around', stageKey: 'drive', requireReceipt: true, status: async () => {},
    supabase: { rpc: async () => ({ data: receipt }) }, moveProcessed: async () => { throw Error('transient archive failure'); } });
  assert.equal(result.done, false);
  assert.equal(result.state.phase, 'move');
  assert.equal(result.state.receipt, receipt);
  assert.equal(result.state.contentHash, 'source-hash');
  assert.equal(Object.hasOwn(result.state, 'identityCounts'), false);
});
