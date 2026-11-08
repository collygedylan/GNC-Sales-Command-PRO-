import assert from 'node:assert/strict';
const plain = value => JSON.parse(JSON.stringify(value));

function beginStage(payload, state) {
  state.sourceManifest ||= plain(payload.p_source_manifest);
  state.sourceDigest ||= payload.p_source_digest;
  assert.deepEqual(plain(payload.p_source_manifest), state.sourceManifest);
  assert.equal(payload.p_source_digest, state.sourceDigest);
  return { status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
    sourceDigest: state.sourceDigest, sourceManifestDigest: 'c'.repeat(64), sourceCount: 1,
    chunkSize: 2000, expectedRows: 2001, expectedChunks: 2,
    chunksReceived: state.stage.chunksReceived, rowsReceived: state.stage.rowsReceived,
    missingChunkIndexes: state.stage.missing.slice(), nextChunkIndex: state.stage.missing[0] ?? null,
    rebound: payload.p_run_id.endsWith('0002'), replayed: false };
}

function appendStage(payload, context, state) {
  const stage = state.stage;
  assert.equal(payload.p_run_id.endsWith('0001') || payload.p_run_id.endsWith('0002'), true);
  assert.equal(payload.p_rows.length, payload.p_chunk_index === 0 ? 2000 : 1);
  const prior = stage.chunks.get(payload.p_chunk_index);
  const serialized = JSON.stringify(payload.p_rows);
  if (prior) assert.equal(prior, serialized, 'retry must use identical chunk content');
  else {
    stage.chunks.set(payload.p_chunk_index, serialized);
    stage.missing = stage.missing.filter(index => index !== payload.p_chunk_index);
    stage.chunksReceived += 1;
    stage.rowsReceived += payload.p_rows.length;
  }
  const result = { status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
    chunkIndex: payload.p_chunk_index, rowCount: payload.p_rows.length, accepted: true,
    replayed: !!prior, chunksReceived: stage.chunksReceived, rowsReceived: stage.rowsReceived,
    missingChunkIndexes: stage.missing.slice(), nextChunkIndex: stage.missing[0] ?? null };
  if (state.firstInvocation) { state.firstInvocation = false; context.shouldContinueMasterBulkStage_ = () => true; }
  if (state.dropFirstAppendResponse && payload.p_chunk_index === 0) {
    state.dropFirstAppendResponse = false;
    throw new Error('network connection timed out after staged commit');
  }
  return result;
}

export function masterStageRpc(name, payload, context, state, receipt) {
  if (name === 'begin_master_snapshot_stage_v1') return beginStage(payload, state);
  if (name === 'cleanup_master_snapshot_staging_v1') {
    assert.equal(payload.p_limit, 20);
    assert.ok(Date.parse(payload.p_older_than) < Date.now() - 23 * 60 * 60 * 1000);
    return 0;
  }
  if (name === 'append_master_snapshot_stage_chunk_v1') return appendStage(payload, context, state);
  if (name === 'finalize_master_snapshot_stage_v1') {
    assert.deepEqual(state.stage.missing, []);
    assert.equal(state.stage.rowsReceived, 2001);
    return receipt({ ...payload, sourceRows: 2001 }, payload.p_run_id);
  }
  if (name === 'reconcile_eval_report2_work_v1') return { ok: true, status: 'completed', resolved: 0 };
  throw new Error(`Unexpected RPC: ${name}`);
}

export function archiveStageRpc(name, payload, state, receipt) {
  if (name === 'cleanup_master_snapshot_staging_v1') return 0;
  if (name === 'begin_master_snapshot_stage_v1') {
    state.beginCount += 1; state.sourceDigest = payload.p_source_digest;
    return { status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
      sourceDigest: state.sourceDigest, sourceManifestDigest: 'f'.repeat(64), sourceCount: 1,
      chunkSize: 2000, expectedRows: 2001, expectedChunks: 2, chunksReceived: 0, rowsReceived: 0,
      missingChunkIndexes: [0, 1], nextChunkIndex: 0, rebound: false, replayed: false };
  }
  if (name === 'append_master_snapshot_stage_chunk_v1') return {
    status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
    chunkIndex: payload.p_chunk_index, rowCount: payload.p_rows.length, accepted: true, replayed: false,
    chunksReceived: payload.p_chunk_index + 1, rowsReceived: Math.min((payload.p_chunk_index + 1) * 2000, 2001),
    missingChunkIndexes: payload.p_chunk_index === 0 ? [1] : [], nextChunkIndex: payload.p_chunk_index === 0 ? 1 : null };
  if (name === 'finalize_master_snapshot_stage_v1') {
    state.finalizeCount += 1;
    return { ...receipt({ ...payload, sourceRows: 2001 }, payload.p_run_id), sourceManifestDigest: 'f'.repeat(64) };
  }
  if (name === 'reconcile_eval_report2_work_v1') return { ok: true, status: 'completed', resolved: 0 };
  throw new Error(`Unexpected RPC: ${name}`);
}

export function isReadyToArchive(raw) {
  try { return JSON.parse(raw).phase === 'ready_to_archive'; } catch { return false; }
}

export function changeFirstSource(rows) {
  const changed = rows.map(row => row.slice());
  changed[1][2] = 'Changed source after publication';
  return changed;
}
