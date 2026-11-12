import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceErpPublicationClock, readErpStagePublication } from '../supabase/functions/_shared/erp-publication-recovery.mjs';
import { finishStageContinuation } from '../supabase/functions/_shared/erp-stage-publication.mjs';
import { runPendingErpWorkerStep } from '../src/core/erp-worker-step.mjs';
import { assertErpPublicationRecovery } from './helpers/erp-publication-recovery-contract.mjs';
import { recoverErpCloudSliceFailure } from '../src/services/erp-cloud-slice-recovery.ts';

const state = { stageId: 'exact-stage', expectedRows: 9610, processedRows: 9610,
  phase: 'finalize', publicationPreparedRows: 9610, publicationProgressAt: 1000 };

function port(recovery = { ok: true, busy: true, stage_id: state.stageId, preparedRows: 9610, recoveryAccepted: true }) {
  const calls = [];
  return { calls, rpc: async (_client, name, args) => {
    calls.push({ name, args });
    return { data: name === 'fast_commit_erp_stage_swap_v1'
      ? { ok: true, busy: true, preparedRows: 9610 } : recovery };
  } };
}

function publicationClient(value) {
  return { rpc: async name => ({ data: name.startsWith('resume_')
    ? value : { ok: true, busy: true, preparedRows: 9610 } }) };
}

test('publication heartbeats do not reset the semantic stall clock', () => {
  const next = advanceErpPublicationClock({ ...state, updatedAt: '2099-01-01' }, { preparedRows: 9610 }, 95000);
  assert.equal(next.publicationProgressAt, 1000);
  const advanced = advanceErpPublicationClock({ ...state, publicationPreparedRows: 9000 }, { preparedRows: 9610 }, 95000);
  assert.equal(advanced.publicationProgressAt, 95000);
  assert.equal(advanced.publicationPreparedRows, 9610);
});

test('server durable progress permits an already-old sealed stage to recover immediately', async () => {
  const api = port();
  const rpc = async (client, name, args) => {
    const result = await api.rpc(client, name, args);
    return { data: { ...result.data, publicationProgressAt: new Date(1000).toISOString() } };
  };
  const result = await readErpStagePublication({}, { ...state, publicationProgressAt: undefined }, rpc, 100000);
  assert.equal(result.state.publicationRecoveryAttempted, true);
  assert.equal(api.calls.length, 2);
});

test('unchanged sealed publication resumes the same stage once after ninety seconds', assertErpPublicationRecovery);

test('real prepared-row progress delays recovery while ordinary status heartbeats do not', async () => {
  const api = port();
  const result = await readErpStagePublication({}, { ...state, publicationPreparedRows: 9000 }, api.rpc, 100000);
  assert.equal(result.state.publicationProgressAt, 100000);
  assert.equal(api.calls.length, 1);
});

test('a locked worker or newer server progress cannot consume the recovery budget', async () => {
  for (const reply of [{ ok: true, busy: true, stage_id: state.stageId },
    { ok: true, busy: true, stage_id: state.stageId, recoveryDue: false, publicationProgressAt: 99000 }]) {
    const api = port(reply);
    const busy = await readErpStagePublication({}, state, api.rpc, 100000);
    assert.equal(busy.state.publicationRecoveryAttempted, undefined);
    const next = await readErpStagePublication({}, busy.state, api.rpc, 200000);
    assert.equal(next.state.publicationRecoveryAttempted, undefined);
    assert.equal(api.calls.filter(call => call.name.startsWith('resume_')).length, 2);
  }
});

test('an exhausted server queue waits for the bounded recovery boundary', async () => {
  const calls = [];
  const rpc = async (_client, name) => {
    calls.push(name);
    return name.startsWith('resume_') ? { data: { ok: true, busy: true, stage_id: state.stageId, recoveryAccepted: true } }
      : { error: { code: '55000', message: 'ERP_PUBLICATION_RETRY_EXHAUSTED' } };
  };
  const early = await readErpStagePublication({}, state, rpc, 50000);
  assert.equal(early.data.busy, true);
  assert.deepEqual(calls, ['fast_commit_erp_stage_swap_v1']);
  const recovered = await readErpStagePublication({}, state, rpc, 91000);
  const final = await readErpStagePublication({}, recovered.state, rpc, 200000);
  assert.equal(final.error.code, '55000');
  assert.equal(calls.filter(name => name.startsWith('resume_')).length, 1);
});

test('exhausted queue error metadata retains the server progress clock for its exact stage', async () => {
  const calls = [];
  const rpc = async (_client, name) => {
    calls.push(name);
    return name.startsWith('resume_') ? { data: { ok: true, busy: true, stage_id: state.stageId, recoveryAccepted: true } }
      : { error: { code: '55000', message: 'ERP_PUBLICATION_RETRY_EXHAUSTED',
        details: JSON.stringify({ stage_id: state.stageId, publicationProgressAt: 1000 }) } };
  };
  const next = await readErpStagePublication({}, { ...state, publicationProgressAt: undefined }, rpc, 100000);
  assert.equal(next.state.publicationRecoveryAttempted, true);
  assert.equal(calls.length, 2);
});

test('revoked service authorization and a mismatched recovery never authorize publication', async () => {
  const calls = [];
  const denied = await readErpStagePublication({}, state, async (_client, name) => {
    calls.push(name); return { error: { code: '42501', message: 'FAST_ERP_STAGE_FORBIDDEN' } };
  }, 100000);
  assert.equal(denied.error.code, '42501');
  assert.equal(calls.length, 1);
  const api = port({ ok: true, stage_id: 'other-stage' });
  const wrong = await readErpStagePublication({}, state, api.rpc, 100000);
  assert.match(wrong.error.message, /IDENTITY_MISMATCH/);
});

test('recovery replay still requires the exact canonical receipt before archive', async () => {
  const originalNow = Date.now;
  const moves = [];
  Date.now = () => 100000;
  try {
    const args = { next: state, file: { name: 'exact.xlsx' }, dataset: 'drive_around', stageKey: 'drive',
      requireReceipt: true, status: async () => {}, moveProcessed: async () => moves.push('archived') };
    const receipt = { ok: true, stage_id: state.stageId, stage_commit: 'canonical_atomic_import',
      file_name: 'exact.xlsx', dataset_key: 'ph_master_inventory', staged_rows: 9610, source_rows: 9610 };
    await assert.rejects(finishStageContinuation({ ...args, supabase: publicationClient({ ...receipt, file_name: 'other.xlsx' }) }), /UNCONFIRMED/);
    assert.deepEqual(moves, []);
    const complete = await finishStageContinuation({ ...args, supabase: publicationClient(receipt) });
    assert.equal(complete.done, true);
    assert.equal(complete.result.rowCount, 9610);
    assert.deepEqual(moves, ['archived']);
  } finally { Date.now = originalNow; }
});

test('resuming publication keeps its publishing stage while the worker retains the same checkpoint', async () => {
  const updates = [];
  const file = { id: 'exact-file', name: 'exact.xlsx' };
  const cursor = { stageIndex: 0, fileContinuation: { stageIndex: 0, file, state },
    folderSnapshot: { drive: { files: [file] } } };
  const result = await runPendingErpWorkerStep({ cursor, accessToken: 'fixture',
    env: () => JSON.stringify({ drive: 'source', processed: { drive: 'processed' } }),
    status: async patch => updates.push(patch) }, {
    stages: [{ key: 'drive', dataset: 'drive_around' }], sourceFolders: {},
    prefetch: async (_fetch, _token, _folders, snapshot) => snapshot, resolveRows: () => 1000,
    stageFile: async input => { assert.equal(input.state.stageId, state.stageId); return { done: false, state }; }
  });
  assert.equal(updates[0].sourceProgressDelta.stage, 'publishing');
  assert.equal(updates[0].sourceProgressDelta.percent, 95);
  assert.equal(result.cursor.fileContinuation.state.stageId, state.stageId);
  assert.equal(result.cursor.stageIndex, 0);
});

test('outer recovery fails exhausted publication once and cannot change a replacement worker', async () => {
  const calls = [], failed = [];
  const error = new Error('ERP_PUBLICATION_RETRY_EXHAUSTED');
  const service = { object: value => value, fail: async (...args) => failed.push(args),
    rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } };
  await assert.rejects(recoverErpCloudSliceFailure(service, 'run', 'worker', {}, 1500, error), error);
  assert.equal(failed.length, 1);
  assert.equal(calls.length, 1, 'permanent exhaustion does not enqueue smaller worksheet retries');
  service.rpc = async () => ({ error: new Error('lease replaced') });
  await assert.rejects(recoverErpCloudSliceFailure(service, 'run', 'old-worker', {}, 1500, error), error);
  assert.equal(failed.length, 1, 'an expired lease cannot fail another worker');
});

test('durably exhausted recovery does not enter the outer slice retry loop', async () => {
  const error = new Error('ERP_PUBLICATION_RECOVERY_EXHAUSTED');
  const writes = [], failed = [];
  const service = { object: value => value, fail: async (...args) => failed.push(args),
    rpc: async (name, args) => { writes.push({ name, args }); return { error: null }; } };
  await assert.rejects(recoverErpCloudSliceFailure(service, 'run', 'worker', {}, 1500, error), error);
  assert.equal(failed.length, 1);
  assert.equal(writes.length, 1);
});

test('a transient finalization failure retains the original cursor and bounded backoff', async () => {
  const writes = [];
  const current = { maxRowsPerSlice: 1500, continuationCursor: { fileContinuation: { state } } };
  const failure = { code: '57014', message: 'statement timeout' };
  const service = { object: value => value, fail: async () => { throw Error('unexpected terminal failure'); },
    rpc: async (name, args) => { if (name.startsWith('update_')) writes.push(args.p_status); return { error: null }; } };
  const before = Date.now();
  await assert.rejects(recoverErpCloudSliceFailure(service, 'run', 'worker', current, 1500, failure));
  assert.equal(writes[0].continuationCursor, current.continuationCursor);
  assert.equal(writes[0].active, true);
  assert.equal(writes[0].errorCode, '');
  assert.equal(writes[0].sliceFailures, 1);
  assert.ok(writes[0].retryNotBefore >= before + 5000);
});
