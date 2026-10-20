// @test-group: master-snapshot-chunk-import
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const processedFolderId = '1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA';
const DRIVE_HEADERS = [
  'WAREHOUSEI','PLANTGROUPCODE','ITEMCODE','QUALITYCODE','CONTSIZE','COMMONNAME','LOTCODE','LOCATIONCODE',
  'SOURCE','DesigItem','DesigCust','DesigLoc','PRIORITY','PTRONHAND','PTRREVIEWED','PTRAVAILABLE',
  'HOLDSTOPCODE','HOLDSTOPBEGINDATE','HOLDSTOPREASON','HSREASONBEGIN','SEASON_SUPPLY','SEASON_OH','SEASON_DEMAND',
  's_LTS','OVERSELLPERCENTAGE','ITEMSPEC','LOCATIONNOTE','LOCATIONNOTEDATE','SUSPEND','SUSPENDTO',
  'SPECIALPULLER','PULLTAGNOTE1','PULLTAGNOTE2','FIELDTAGCOLOR','SALESNOTE','INVENTORYNOTE','LOCATIONPTN1',
  'LOCATIONPTN2','PRISETBY','PRIUPDATED','BYPASSLOC','LARGEPTRQTY','MAXORDERQUANTITY','LOCHOLD','LISTPRICE',
  'EXT_PTRONHAND','VARIETYCODE','GENUSNAME','BOTANICALNAME','REVERSECOMMON','SORTNAMEVARIETY','CONTAINERSORT',
  'SALEYEAR','SEASON','BLOCKALPHA','BLOCKNUMBER','BAY','PULLERRESPONSIBILITY','GROWER','si_LTS','a_LTS','ai_LTS',
  'SEASON_AVAILABLE','HOLDSTOPENDDATE','SALESNOTE','FNSALESNOTE','WAREHOUSENAME','MCSTATUS','HZ','INTERCOPO',
  'INSURANCEGROUP','BRAND','PRINTEDCONTAINERCODE','SALESNOTEBEGINDATE','EQUIV_UNIT','EXT_EQUIV_UNIT',
];

function makeRows(count) {
  const index = Object.fromEntries(DRIVE_HEADERS.map((header, position) => [header.toUpperCase(), position]));
  const rows = Array.from({ length: count }, (_, offset) => {
    const row = Array(DRIVE_HEADERS.length).fill('');
    row[index.WAREHOUSEI] = 'PH';
    row[index.PLANTGROUPCODE] = '140_TEST';
    row[index.ITEMCODE] = `SYNTHETIC-${String(offset).padStart(5, '0')}`;
    row[index.QUALITYCODE] = 'A';
    row[index.CONTSIZE] = '#1';
    row[index.COMMONNAME] = `Synthetic ${offset}`;
    row[index.LOTCODE] = '27.F1';
    row[index.LOCATIONCODE] = 'TEST.LOC';
    row[index.SOURCE] = 'PH';
    row[index.PRIORITY] = '2';
    return row;
  });
  return [DRIVE_HEADERS.slice(), ...rows];
}

function harness({ files, properties = new Map(), rpc, runIds = ['10000000-0000-4000-8000-000000000001'] }) {
  const events = [];
  const entries = files.map(file => ({
    ...file,
    getName: () => file.name,
    getId: () => file.id,
    getLastUpdated: () => new Date(file.modifiedAt),
    getSize: () => file.size,
  }));
  let cursor = 0;
  let runCursor = 0;
  const context = vm.createContext({
    console: { log() {}, warn() {}, error(...args) { events.push({ type: 'error', value: String(args[0] || '') }); } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.has(String(key)) ? properties.get(String(key)) : null,
      setProperty: (key, value) => properties.set(String(key), String(value)),
      deleteProperty: key => properties.delete(String(key)),
      getProperties: () => Object.fromEntries(properties.entries()),
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      getUuid: () => `20000000-0000-4000-8000-${String(runCursor + 1).padStart(12, '0')}`,
      sleep() {},
    },
  });
  new vm.Script(source, { filename: 'Code.gs' }).runInContext(context);
  context.getDriveFolderByIdWithRetry_ = id => ({ id });
  context.listDriveFilesWithRetry_ = () => ({ hasNext: () => cursor < entries.length, next: () => entries[cursor++] });
  context.extractDataFromFile = file => file.data;
  context.DriveApp = { getFileById: id => entries.find(entry => entry.id === id) };
  context.fetchAllSupabaseData = () => { throw new Error('full-snapshot import must not fetch existing inventory'); };
  context.fetchAllSupabaseRowIdsForMaster_ = () => { throw new Error('full-snapshot import must not scan existing IDs'); };
  context.fetchSupabaseRowsByIds_ = () => { throw new Error('full-snapshot import must not compare existing rows'); };
  context.beginDatasetImportFenceIfNeeded_ = () => {
    const runId = runIds[runCursor++] || runIds[runIds.length - 1];
    events.push({ type: 'fence-begin', runId });
    return { runId };
  };
  context.closeDatasetImportFence_ = (fence, succeeded, beforeFinish) => {
    if (!succeeded) { events.push({ type: 'fence-failed', runId: fence && fence.runId }); return; }
    events.push({ type: 'assignment-reconcile', runId: fence.runId });
    if (typeof beforeFinish === 'function') beforeFinish();
    events.push({ type: 'fence-finish', runId: fence.runId });
  };
  context.failDatasetImportFence_ = fence => events.push({ type: 'fence-failed', runId: fence && fence.runId });
  context.reconcileSeasonSalesOfficeAfterImport_ = () => {};
  context.moveAndNormalizeDriveAroundProcessedFiles_ = parsed => {
    parsed.forEach(entry => events.push({ type: 'archive', fileId: entry.file.getId() }));
    return { warnings: [] };
  };
  context.emitTableSyncLiveEvent_ = () => {};
  context.callSupabaseRpc_ = (name, payload) => {
    events.push({ type: 'rpc', name, payload: plain(payload) });
    return rpc(name, payload, events, context);
  };
  context.resetFiles = () => { cursor = 0; };
  context.events = events;
  context.properties = properties;
  return context;
}

function file(id, data = makeRows(501)) {
  return { id, name: `${id}.csv`, modifiedAt: '2026-10-19T12:00:00.000Z', size: 12345, data };
}

function receipt(payload, runId, publicationRunId = runId) {
  return {
    status: 'published', published: true, replayed: false,
    requestId: payload.p_request_id, runId, publicationRunId,
    sourceDigest: payload.p_source_digest, sourceManifestDigest: 'c'.repeat(64),
    sourceRows: payload.sourceRows ?? 501, inserted: payload.sourceRows ?? 501,
    updated: 0, deleted: 0, unchanged: 0,
  };
}

test('master snapshot stages bounded idempotent chunks, resumes missing chunks, then atomically finalizes and archives', () => {
  const properties = new Map();
  let firstInvocation = true;
  let dropFirstAppendResponse = true;
  let stage = { missing: [0, 1], chunksReceived: 0, rowsReceived: 0, chunks: new Map() };
  let sourceManifest;
  let sourceDigest;
  const ctx = harness({
    files: [file('master-source')], properties,
    runIds: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'],
    rpc(name, payload, events, context) {
      if (name === 'begin_master_snapshot_stage_v1') {
        sourceManifest ||= plain(payload.p_source_manifest);
        sourceDigest ||= payload.p_source_digest;
        assert.deepEqual(plain(payload.p_source_manifest), sourceManifest);
        assert.equal(payload.p_source_digest, sourceDigest);
        return {
          status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
          sourceDigest, sourceManifestDigest: 'c'.repeat(64), sourceCount: 1,
          chunkSize: 500, expectedRows: 501, expectedChunks: 2,
          chunksReceived: stage.chunksReceived, rowsReceived: stage.rowsReceived,
          missingChunkIndexes: stage.missing.slice(), nextChunkIndex: stage.missing[0] ?? null,
          rebound: payload.p_run_id.endsWith('0002'), replayed: false,
        };
      }
      if (name === 'cleanup_master_snapshot_staging_v1') {
        assert.equal(payload.p_limit, 20);
        assert.ok(Date.parse(payload.p_older_than) < Date.now() - 23 * 60 * 60 * 1000);
        return 0;
      }
      if (name === 'append_master_snapshot_stage_chunk_v1') {
        assert.equal(payload.p_run_id.endsWith('0001') || payload.p_run_id.endsWith('0002'), true);
        assert.equal(payload.p_rows.length, payload.p_chunk_index === 0 ? 500 : 1);
        const prior = stage.chunks.get(payload.p_chunk_index);
        const serialized = JSON.stringify(payload.p_rows);
        if (prior) assert.equal(prior, serialized, 'retry must use identical chunk content');
        else {
          stage.chunks.set(payload.p_chunk_index, serialized);
          stage.missing = stage.missing.filter(index => index !== payload.p_chunk_index);
          stage.chunksReceived += 1;
          stage.rowsReceived += payload.p_rows.length;
        }
        const result = {
          status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
          chunkIndex: payload.p_chunk_index, rowCount: payload.p_rows.length, accepted: true,
          replayed: !!prior, chunksReceived: stage.chunksReceived, rowsReceived: stage.rowsReceived,
          missingChunkIndexes: stage.missing.slice(), nextChunkIndex: stage.missing[0] ?? null,
        };
        if (firstInvocation) {
          firstInvocation = false;
          context.shouldContinueMasterBulkStage_ = () => true;
        }
        if (dropFirstAppendResponse && payload.p_chunk_index === 0) {
          dropFirstAppendResponse = false;
          throw new Error('network connection timed out after staged commit');
        }
        return result;
      }
      if (name === 'finalize_master_snapshot_stage_v1') {
        assert.deepEqual(stage.missing, []);
        assert.equal(stage.rowsReceived, 501);
        return receipt({ ...payload, sourceRows: 501 }, payload.p_run_id);
      }
      if (name === 'reconcile_eval_report2_work_v1') return { ok: true, status: 'completed', resolved: 0 };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  });
  const originalShouldContinue = ctx.shouldContinueMasterBulkStage_;

  const run = () => {
    ctx.resetFiles();
    ctx.shouldContinueMasterBulkStage_ = originalShouldContinue;
    return vm.runInContext(`processSnapshotBatchFolderLocked_('source',${JSON.stringify(processedFolderId)}, 'ph_master_inventory', buildMasterPayload, {})`, ctx);
  };
  vm.runInContext('manualSyncInvocationDeadlineMs_ = Date.now() + 70000', ctx);
  const partial = run();
  assert.equal(partial.continuationPending, true, JSON.stringify(partial));
  assert.equal(partial.failedFiles, 0);
  assert.equal(ctx.events.some(event => event.type === 'archive'), false);
  assert.equal(ctx.events.filter(event => event.name === 'cleanup_master_snapshot_staging_v1').length, 1,
    'bounded orphan cleanup runs only when creating a new stage checkpoint');
  assert.equal(ctx.events.some(event => event.type === 'fence-failed'), true);
  assert.equal(ctx.events.some(event => event.name === 'bulk_import_master_snapshot_v1'), false);
  assert.equal(ctx.events.filter(event => event.name === 'append_master_snapshot_stage_chunk_v1' && event.payload.p_chunk_index === 0).length, 2,
    'the uncertain append is retried byte-for-byte and accepted as an idempotent replay');

  vm.runInContext('manualSyncInvocationDeadlineMs_ = Date.now() + 240000', ctx);
  const complete = run();
  assert.equal(complete.filesProcessed, 1);
  assert.equal(complete.failedFiles, 0);
  assert.deepEqual(stage.missing, []);
  assert.equal(stage.chunksReceived, 2);
  assert.equal(ctx.events.filter(event => event.name === 'finalize_master_snapshot_stage_v1').length, 1);
  assert.equal(ctx.events.filter(event => event.name === 'cleanup_master_snapshot_staging_v1').length, 1,
    'resumption does not run orphan cleanup against an active continuation');
  assert.equal(ctx.events.filter(event => event.type === 'archive').length, 1);
  assert.ok(ctx.events.findIndex(event => event.type === 'fence-finish') < ctx.events.findIndex(event => event.type === 'archive'));
  assert.ok(ctx.events.findIndex(event => event.name === 'finalize_master_snapshot_stage_v1') < ctx.events.findIndex(event => event.type === 'fence-finish'));
  assert.equal(properties.size, 0, 'the checkpoint clears only after confirmed publication and normal close/archive');
});

test('master snapshot payload projects only mapped source columns and preserves duplicate SALESNOTE last-column semantics', () => {
  const ctx = harness({ files: [file('master-source', makeRows(0))], rpc() { return 0; } });
  const rawData = makeRows(1);
  const salesNotePositions = DRIVE_HEADERS.flatMap((header, index) => header.toUpperCase() === 'SALESNOTE' ? [index] : []);
  rawData[1][DRIVE_HEADERS.indexOf('ITEMCODE')] = 'ITEM-1';
  rawData[1][DRIVE_HEADERS.indexOf('LOCATIONCODE')] = 'A.01.001';
  rawData[1][DRIVE_HEADERS.indexOf('COMMONNAME')] = 'Mapped Source Item';
  rawData[1][DRIVE_HEADERS.indexOf('HSREASONBEGIN')] = '2026-01-01';
  rawData[1][DRIVE_HEADERS.indexOf('EXT_EQUIV_UNIT')] = 'raw audit unit';
  rawData[1][salesNotePositions[0]] = 'legacy note';
  rawData[1][salesNotePositions[1]] = 'current note';
  const payload = ctx.buildMasterBulkSnapshotPayload_(
    'ph_master_inventory',
    [{ rawData, fileName: 'master-source.csv' }],
    function(data, tableName, existingRows, timestamp, fileName) {
      const result = ctx.buildMasterPayload(data, tableName, existingRows, timestamp, fileName);
      // Model extra live/app-owned fields on a builder result. They must not
      // enter the immutable source snapshot unless present in source headers.
      Object.assign(result.upserts[0], {
        av_note: 'app note',
        photo_link: 'app photo',
        hold_release_approved_by: 'reviewer',
        hsreasonbegin: 'wrong merged value',
        ext_equiv_unit: 'wrong merged value',
        assignedto: 'worker',
      });
      return result;
    },
    '2026-10-19T12:00:00.000Z',
  );

  const values = payload.rows[0].values;
  const normalizedSourceKeys = new Set(DRIVE_HEADERS.map(header => header.toLowerCase()
    .replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
    .replace(/^warehousei$/, 'warehouseid').replace(/^suspendto$/, 'suspend_to')));
  const expectedKeys = new Set([...normalizedSourceKeys, 'unique_id', 'last_updated', 'filename', 'concat']);
  assert.equal(DRIVE_HEADERS.length, 76);
  assert.equal(normalizedSourceKeys.size, 75);
  assert.deepEqual(Object.keys(values).sort(), [...expectedKeys].sort());
  assert.equal(values.salesnote, 'current note');
  assert.equal(values.filename, 'master-source.csv');
  assert.equal(values.last_updated, '2026-10-19T12:00:00.000Z');
  assert.equal(values.hsreasonbegin, '2026-01-01');
  assert.equal(values.ext_equiv_unit, 'raw audit unit');
  assert.equal(Object.hasOwn(values, 'av_note'), false);
  assert.equal(Object.hasOwn(values, 'photo_link'), false);
  assert.equal(Object.hasOwn(values, 'hold_release_approved_by'), false);
  assert.equal(Object.hasOwn(values, 'assignedto'), false);
});

test('Drive Around master snapshot rejects a header that does not match all 76 approved source positions', () => {
  const ctx = harness({ files: [file('master-source', makeRows(0))], rpc() { return 0; } });
  assert.equal(ctx.assertDriveAroundSourceContract_(makeRows(0), 'ph_master_inventory'), true);
  const changed = makeRows(0);
  changed[0][0] = 'UNEXPECTED_HEADER';
  assert.throws(() => ctx.assertDriveAroundSourceContract_(changed, 'ph_master_inventory'), error =>
    error.errorCode === 'IMPORT_SOURCE_NO_HEADER');
});

test('a published snapshot with incomplete archival blocks a different snapshot instead of importing a partial drop set', () => {
  const properties = new Map();
  let sourceDigest;
  let beginCount = 0;
  let finalizeCount = 0;
  const ctx = harness({ files: [file('master-source')], properties, rpc(name, payload) {
    if (name === 'cleanup_master_snapshot_staging_v1') return 0;
    if (name === 'begin_master_snapshot_stage_v1') {
      beginCount += 1;
      sourceDigest = payload.p_source_digest;
      return {
        status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
        sourceDigest, sourceManifestDigest: 'f'.repeat(64), sourceCount: 1,
        chunkSize: 500, expectedRows: 501, expectedChunks: 2, chunksReceived: 0, rowsReceived: 0,
        missingChunkIndexes: [0, 1], nextChunkIndex: 0, rebound: false, replayed: false,
      };
    }
    if (name === 'append_master_snapshot_stage_chunk_v1') {
      return {
        status: 'staging', requestId: payload.p_request_id, runId: payload.p_run_id,
        chunkIndex: payload.p_chunk_index, rowCount: payload.p_rows.length, accepted: true, replayed: false,
        chunksReceived: payload.p_chunk_index + 1, rowsReceived: Math.min((payload.p_chunk_index + 1) * 500, 501),
        missingChunkIndexes: payload.p_chunk_index === 0 ? [1] : [], nextChunkIndex: payload.p_chunk_index === 0 ? 1 : null,
      };
    }
    if (name === 'finalize_master_snapshot_stage_v1') {
      finalizeCount += 1;
      return { ...receipt({ ...payload, sourceRows: 501 }, payload.p_run_id), sourceManifestDigest: 'f'.repeat(64) };
    }
    if (name === 'reconcile_eval_report2_work_v1') return { ok: true, status: 'completed', resolved: 0 };
    throw new Error(`Unexpected RPC: ${name}`);
  } });
  ctx.moveAndNormalizeDriveAroundProcessedFiles_ = () => { throw new Error('simulated archive failure after atomic publication'); };
  ctx.moveDriveFileToFolderWithRetry_ = () => { throw new Error('simulated archive failure after atomic publication'); };
  vm.runInContext('manualSyncInvocationDeadlineMs_ = Date.now() + 240000', ctx);
  const first = vm.runInContext(`processSnapshotBatchFolderLocked_('source',${JSON.stringify(processedFolderId)}, 'ph_master_inventory', buildMasterPayload, {})`, ctx);
  assert.equal(first.failedFiles, 1, JSON.stringify(first));
  assert.equal(finalizeCount, 1);
  assert.ok(Array.from(properties.values()).some(raw => {
    try { return JSON.parse(raw).phase === 'ready_to_archive'; } catch { return false; }
  }));

  const source = ctx.DriveApp.getFileById('master-source');
  source.data = makeRows(501).map((row, index) => index === 1 ? row.map((value, column) => column === 2 ? 'Changed source after publication' : value) : row);
  ctx.resetFiles();
  vm.runInContext('manualSyncInvocationDeadlineMs_ = Date.now() + 240000', ctx);
  const blocked = vm.runInContext(`processSnapshotBatchFolderLocked_('source',${JSON.stringify(processedFolderId)}, 'ph_master_inventory', buildMasterPayload, {})`, ctx);
  assert.equal(blocked.failedFiles, 1);
  assert.equal(beginCount, 1, 'a changed manifest cannot start a second full snapshot while published files await archival');
  assert.equal(finalizeCount, 1, 'the published state is never republished from a partial pending set');
  assert.equal(ctx.events.some(event => event.type === 'archive'), false);
});

test('published staging replay validates original receipt and never appends or republishes', () => {
  const properties = new Map();
  const manifest = [{ fileId: 'master-source', modifiedAt: '2026-10-19T12:00:00.000Z', size: 12345 }];
  const sourceRows = makeRows(1);
  const ctx = harness({ files: [file('master-source', sourceRows)], properties, rpc() { throw new Error('RPC adapter is assigned after the source digest is prepared'); } });
  const sourceTimestamp = ctx.getOrCreateMasterBulkSnapshotSyncTimestamp_(manifest, '2026-10-19T12:00:00.000Z');
  const built = ctx.buildMasterBulkSnapshotPayload_('ph_master_inventory', [{ rawData: sourceRows, fileName: 'master-source.csv' }],
    ctx.buildMasterPayload, sourceTimestamp.value);
  const requestId = '20000000-0000-4000-8000-000000000001';
  const originalReceipt = {
    published: true, runId: '10000000-0000-4000-8000-000000000001', requestId,
    sourceDigest: built.sourceDigest, sourceRows: 1, inserted: 1, updated: 0, deleted: 0, unchanged: 0,
  };
  const storageKey = ctx.masterBulkSnapshotStageCheckpointKey_(manifest, built.sourceDigest);
  properties.set(storageKey, JSON.stringify({ requestId, storageKey, manifest,
    sourceManifestDigest: 'c'.repeat(64), sourceDigest: built.sourceDigest, expectedRows: 1, expectedChunks: 1 }));
  ctx.callSupabaseRpc_ = (name, payload) => {
    ctx.events.push({ type: 'rpc', name, payload: plain(payload) });
    if (name === 'begin_master_snapshot_stage_v1') return {
      status: 'published', replayed: true, requestId: payload.p_request_id, runId: payload.p_run_id,
      publicationRunId: originalReceipt.runId, sourceDigest: payload.p_source_digest,
      sourceManifestDigest: 'c'.repeat(64), sourceCount: 1, chunkSize: 500,
      expectedRows: 1, expectedChunks: 1, chunksReceived: 1, rowsReceived: 1,
      missingChunkIndexes: [], nextChunkIndex: null, rebound: true, publishedResponse: originalReceipt,
    };
    if (name === 'reconcile_eval_report2_work_v1') return { ok: true, status: 'completed', resolved: 0 };
    throw new Error(`Published request must not call ${name}`);
  };
  vm.runInContext('manualSyncInvocationDeadlineMs_ = Date.now() + 240000', ctx);
  const result = vm.runInContext(`processSnapshotBatchFolderLocked_('source',${JSON.stringify(processedFolderId)}, 'ph_master_inventory', buildMasterPayload, {})`, ctx);
  assert.equal(result.filesProcessed, 1, JSON.stringify(result));
  assert.equal(result.failedFiles, 0);
  assert.equal(ctx.events.some(event => event.type === 'archive'), true);
  assert.equal(ctx.events.some(event => event.name === 'append_master_snapshot_stage_chunk_v1'), false);
  assert.equal(ctx.events.some(event => event.name === 'finalize_master_snapshot_stage_v1'), false);
  assert.equal(properties.has(storageKey), false);
});

test('a newer source gets its own checkpoint without clearing older unfinished staged progress', () => {
  const properties = new Map();
  const oldManifest = [{ fileId: 'older-source', modifiedAt: '2026-10-18T12:00:00.000Z', size: 9 }];
  const oldCheckpoint = {
    requestId: '20000000-0000-4000-8000-000000000001', manifest: oldManifest,
    sourceManifestDigest: 'd'.repeat(64), sourceDigest: 'b'.repeat(64), expectedRows: 501, expectedChunks: 2,
  };
  const newData = makeRows(1);
  const ctx = harness({ files: [file('master-source', newData)], properties, rpc(name, payload) {
    if (name === 'begin_master_snapshot_stage_v1') return {
      status: 'staging', runId: payload.p_run_id, requestId: payload.p_request_id,
      sourceDigest: payload.p_source_digest, sourceManifestDigest: 'e'.repeat(64), sourceCount: 1,
      chunkSize: 500, expectedRows: 1, expectedChunks: 1, chunksReceived: 0, rowsReceived: 0,
      missingChunkIndexes: [0], nextChunkIndex: 0, rebound: false, replayed: false,
    };
    if (name === 'append_master_snapshot_stage_chunk_v1') return {
      status: 'staging', runId: payload.p_run_id, requestId: payload.p_request_id,
      chunkIndex: 0, rowCount: 1, accepted: true, replayed: false,
      chunksReceived: 1, rowsReceived: 1, missingChunkIndexes: [], nextChunkIndex: null,
    };
    if (name === 'finalize_master_snapshot_stage_v1') return { ...receipt({
      p_request_id: payload.p_request_id, p_source_digest: payload.p_source_digest, sourceRows: 1,
    }, payload.p_run_id), sourceManifestDigest: 'e'.repeat(64) };
    if (name === 'reconcile_eval_report2_work_v1') return { ok: true, status: 'completed', resolved: 0 };
    throw new Error(`Unexpected RPC: ${name}`);
  } });
  const oldKey = ctx.masterBulkSnapshotStageCheckpointKey_(oldManifest, oldCheckpoint.sourceDigest);
  oldCheckpoint.storageKey = oldKey;
  properties.set(oldKey, JSON.stringify(oldCheckpoint));
  vm.runInContext('manualSyncInvocationDeadlineMs_ = Date.now() + 240000', ctx);
  const result = vm.runInContext(`processSnapshotBatchFolderLocked_('source',${JSON.stringify(processedFolderId)}, 'ph_master_inventory', buildMasterPayload, {})`, ctx);
  assert.equal(result.filesProcessed, 1, JSON.stringify(result));
  assert.equal(result.failedFiles, 0);
  assert.equal(properties.has(oldKey), true, 'an unrelated source checkpoint is retained for safe server-side cleanup');
  assert.equal(properties.size, 1, 'the new source checkpoint clears only after successful publication and archive');
  const begin = ctx.events.find(event => event.type === 'rpc' && event.name === 'begin_master_snapshot_stage_v1');
  assert.notEqual(begin.payload.p_request_id, oldCheckpoint.requestId);
});

test('a canonical continuation reuses its persisted import timestamp so payload digest stays stable', () => {
  const properties = new Map();
  const data = makeRows(1);
  const ctx = harness({ files: [file('master-source', data)], properties, rpc() { return 0; } });
  const manifest = [{ fileId: 'master-source', modifiedAt: '2026-10-19T12:00:00.000Z', size: 12345 }];
  const first = ctx.getOrCreateMasterBulkSnapshotSyncTimestamp_(manifest, '2026-10-19T13:00:00.000Z');
  const firstPayload = ctx.buildMasterBulkSnapshotPayload_('ph_master_inventory', [
    { rawData: data, fileName: 'master-source.csv' },
  ], ctx.buildMasterPayload, first.value);
  const later = ctx.getOrCreateMasterBulkSnapshotSyncTimestamp_(manifest, '2026-10-19T14:00:00.000Z');
  const resumedPayload = ctx.buildMasterBulkSnapshotPayload_('ph_master_inventory', [
    { rawData: data, fileName: 'master-source.csv' },
  ], ctx.buildMasterPayload, later.value);
  assert.equal(later.value, first.value);
  assert.equal(resumedPayload.sourceDigest, firstPayload.sourceDigest,
    'last_updated and the canonical payload digest remain identical across worker invocations');
  assert.equal(later.key, first.key);
});
