// @test-group: erp-snapshot-stage-import
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const sourceIdentity = Object.freeze({
  tableName: 'ph_soc_master', fileId: 'synthetic-drive-source', fileName: 'soc.csv',
  modifiedAt: '2026-10-19T12:00:00.000Z', size: 12345,
});
const runId = '10000000-0000-4000-8000-000000000001';
const plain = value => JSON.parse(JSON.stringify(value));

function makeContext(properties = new Map()) {
  let uuid = 0;
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.has(String(key)) ? properties.get(String(key)) : null,
      setProperty: (key, value) => properties.set(String(key), String(value)),
      deleteProperty: key => properties.delete(String(key)),
      getProperties: () => Object.fromEntries(properties.entries()),
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(String(value), 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      getUuid: () => `20000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
      sleep() {},
    },
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);
  context.manualSyncInvocationDeadlineMs_ = 0;
  context.assertRoutedPendingSourceSelection_ = () => true;
  context.revalidateImportSourceIdentity_ = identity => identity;
  context.assertImportTimeBudget_ = () => true;
  context.properties = properties;
  return context;
}

function makeSocRow(context) {
  const headers = Array.from(vm.runInContext('SOC_HISTORY_LEGACY_COLUMNS', context));
  const row = Array(headers.length).fill('');
  const set = (name, value) => { row[headers.indexOf(name)] = value; };
  set('ITEMCODE', 'SYNTHETIC-ITEM');
  set('DOCK', 'SYNTHETIC-DOCK');
  set('CUSTOMERNAME', 'Synthetic Customer');
  set('CONSIGNEENAME', 'Synthetic Consignee');
  set('TRANSACTIONNUMBER', 'TX-1');
  set('STOPNUMBER', '1');
  set('PRINTEDCONTAINERCODE', '#1');
  set('LOCATIONCODE', 'A.01.001');
  set('LOTCODE', '27.F1');
  set('SALESNOTE', 'current note');
  return [headers, row];
}

function makeStageRows(count) {
  const canonicalKeys = vm.runInContext('SOC_HISTORY_LEGACY_COLUMNS.map(normalizePayloadColumnKey_)',
    makeContext());
  return Array.from({ length: count }, (_, index) => ({
    ...Object.fromEntries(canonicalKeys.map(key => [key, null])),
    itemcode: `SYNTHETIC-${index}`,
    customername: 'Synthetic Customer',
    invoicedate: null,
    unique_id: `soc-${index}`,
    contsize: '#1',
    last_updated: '2026-10-19T12:00:00.000Z',
    filename: 'soc.csv',
  }));
}

function invokeStage(context, rows, rpc, identity = sourceIdentity) {
  context.callSupabaseRpc_ = rpc;
  context.__stageArgs = [ 'ph_soc_master', identity, rows, runId,
    '2026-10-19T12:00:00.000Z', 'drop-folder', 'processed-folder' ];
  return vm.runInContext('callErpSnapshotStageImport_(...__stageArgs)', context);
}

test('SOC payload emits the complete 81-key source projection, including nulls and derived metadata', () => {
  const context = makeContext();
  const [headers, rows] = makeSocRow(context);
  const built = context.buildStandardPayload([headers, rows], 'ph_soc_master', [],
    '2026-10-19T12:00:00.000Z', 'soc.csv');
  assert.equal(headers.length, 81);
  assert.equal(built.upserts.length, 1);
  const sourceKeys = headers.map(header => context.normalizePayloadColumnKey_(header));
  assert.equal(new Set(sourceKeys).size, 81);
  for (const key of sourceKeys) assert.equal(Object.hasOwn(built.upserts[0], key), true, `missing ${key}`);
  assert.equal(built.upserts[0].invoicedate, null);
  assert.equal(built.upserts[0].salesnote, 'current note');
  assert.equal(built.upserts[0].contsize, '#1');
  assert.equal(typeof built.upserts[0].unique_id, 'string');
  assert.equal(built.upserts[0].last_updated, '2026-10-19T12:00:00.000Z');
  assert.equal(built.upserts[0].filename, 'soc.csv');
  assert.equal(Object.hasOwn(built.upserts[0], 'date_completed'), false);
});

test('SOC stage resumes only missing 500-row chunks and retries a committed chunk with identical bytes before finalizing', () => {
  const context = makeContext();
  const rows = makeStageRows(501);
  const chunkPayloads = new Map();
  const callCounts = new Map();
  const manifestDigest = 'a'.repeat(64);
  let finalizeCalls = 0;
  const rpc = (name, payload) => {
    callCounts.set(name, (callCounts.get(name) || 0) + 1);
    if (name === 'begin_erp_snapshot_stage_v1') {
      assert.equal(payload.p_expected_rows, 501);
      assert.equal(payload.p_expected_chunks, 2);
      assert.equal(payload.p_target_table, 'ph_soc_master');
      return {
        status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
        targetTable: payload.p_target_table, sourceDigest: payload.p_source_digest,
        sourceManifestDigest: manifestDigest, expectedRows: 501, expectedChunks: 2, chunkSize: 500,
        chunksReceived: 1, rowsReceived: 500, missingChunkIndexes: [1], nextChunkIndex: 1,
      };
    }
    if (name === 'append_erp_snapshot_stage_chunk_v1') {
      assert.equal(payload.p_chunk_index, 1, 'the already-staged first chunk is skipped on resume');
      const body = JSON.stringify(plain(payload.p_rows));
      if (chunkPayloads.has(payload.p_chunk_index)) assert.equal(chunkPayloads.get(payload.p_chunk_index), body);
      else chunkPayloads.set(payload.p_chunk_index, body);
      if (callCounts.get(name) === 1) {
        throw new Error('network connection timed out after accepted append');
      }
      return {
        status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
        targetTable: payload.p_target_table, sourceDigest: context.__sourceDigest,
        sourceManifestDigest: manifestDigest, chunkIndex: 1, rowCount: 1, accepted: true, replayed: true,
        expectedRows: 501, expectedChunks: 2, chunkSize: 500, chunksReceived: 2, rowsReceived: 501,
        missingChunkIndexes: [], nextChunkIndex: null,
      };
    }
    if (name === 'finalize_erp_snapshot_stage_v1') {
      finalizeCalls += 1;
      assert.equal(chunkPayloads.size, 1);
      const [chunk] = JSON.parse(chunkPayloads.get(1));
      assert.equal(chunk.unique_id, 'soc-500');
      return {
        status: 'published', requestId: payload.p_request_id, runId: payload.p_run_id,
        publicationRunId: payload.p_run_id, targetTable: payload.p_target_table,
        sourceDigest: payload.p_source_digest, sourceManifestDigest: manifestDigest,
        sourceRows: 501, inserted: 0, updated: 0, unchanged: 501, deleted: 0, revision: 'rev-501', replayed: false,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  context.__sourceDigest = '';
  context.callSupabaseRpc_ = (name, payload) => {
    if (name === 'begin_erp_snapshot_stage_v1') context.__sourceDigest = payload.p_source_digest;
    return rpc(name, payload);
  };
  const result = invokeStage(context, rows, context.callSupabaseRpc_);
  assert.equal(result.receipt.sourceRows, 501);
  assert.equal(result.receipt.replayed, false);
  assert.equal(finalizeCalls, 1);
  assert.equal(callCounts.get('append_erp_snapshot_stage_chunk_v1'), 2);
  assert.equal(callCounts.get('finalize_erp_snapshot_stage_v1'), 1);
  assert.equal(context.__sourceDigest.length, 64);
  assert.equal([...context.properties.values()].some(raw => {
    try { return JSON.parse(raw).phase === 'published_pending_postprocess'; } catch (ignored) { return false; }
  }), true);
});

test('new ERP source digests get independent checkpoints and preserve unfinished prior source state', () => {
  const context = makeContext();
  const manifest = [{ fileId: sourceIdentity.fileId, modifiedAt: sourceIdentity.modifiedAt, size: sourceIdentity.size }];
  const oldKey = context.erpSnapshotStageCheckpointKey_('ph_soc_master', manifest, '1'.repeat(64));
  const newKey = context.erpSnapshotStageCheckpointKey_('ph_soc_master', manifest, '2'.repeat(64));
  assert.notEqual(newKey, oldKey);
  context.PropertiesService.getScriptProperties().setProperty(oldKey, JSON.stringify({
    requestId: '20000000-0000-4000-8000-000000000099', storageKey: oldKey,
    targetTable: 'ph_soc_master', manifest, sourceDigest: '1'.repeat(64), expectedRows: 10,
    expectedChunks: 1, sourceManifestDigest: 'b'.repeat(64), phase: 'staging',
  }));
  const next = context.readErpSnapshotStageCheckpoint_(newKey, 'ph_soc_master', manifest, '2'.repeat(64), 10);
  assert.notEqual(next.requestId, '20000000-0000-4000-8000-000000000099');
  assert.equal(context.properties.has(oldKey), true);
  assert.equal(context.properties.has(newKey), true);
});
