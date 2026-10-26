// @test-group: node-unit
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function harness() {
  const properties = new Map(), calls = [];
  const ctx = vm.createContext({ Date, console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value), deleteProperty: key => properties.delete(key) }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => [...createHash(algorithm).update(value).digest()],
      formatDate: date => date.toISOString().slice(0, 10) },
  });
  new vm.Script(source).runInContext(ctx);
  ctx.DriveApp = { getFileById: () => file() };
  ctx.callSupabaseRpc_ = (name, args) => {
    calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    if (name === 'begin_import_history_v1') return { snapshotId: 'snapshot-1', displayLabel: '2026-10-15 01', status: 'staging', rowCount: args.p_expected_rows, stagedRows: 0 };
    if (name === 'stage_import_history_rows_v1') return { snapshotId: 'snapshot-1', acceptedRows: args.p_rows.length, stagedRows: args.p_rows.at(-1).row_number };
    return { snapshotId: 'snapshot-1', displayLabel: '2026-10-15 01', status: 'ready', rowCount: 1001, stagedRows: 1001 };
  };
  return { ctx, properties, calls };
}
function file(name = 'DriveAroundMC-10-06313120261015063131.xlsx') {
  return { getId: () => 'file-1', getName: () => name, getSize: () => 1234,
    getMimeType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    getLastUpdated: () => new Date('2026-10-16T13:00:00Z'), getDateCreated: () => new Date('2026-10-16T12:00:00Z') };
}
const invoke = (ctx, name, ...args) => ctx[name](...args);

function iterator(entries = [], continuationToken = '') {
  let index = 0;
  return {
    hasNext: () => index < entries.length,
    next: () => entries[index++],
    getContinuationToken: () => continuationToken,
  };
}

function routedFile(id, name, archiveFolderId = '') {
  const modified = new Date('2026-10-15T06:31:31.000Z');
  return {
    getId: () => id,
    getName: () => name,
    getSize: () => 1234,
    getMimeType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    getLastUpdated: () => modified,
    getDateCreated: () => new Date('2026-10-15T06:00:00.000Z'),
    getParents: () => iterator(archiveFolderId ? [{ getId: () => archiveFolderId }] : []),
  };
}

function installLatestImportHarness(ctx, events, configuredFile, dataset = 'soc') {
  const route = ctx.getImportHistoryRoute_(dataset);
  const folderForFiles = { id: route.dropFolderId };
  ctx.getDriveFolderByIdWithRetry_ = id => ({ id });
  ctx.listDriveFilesWithRetry_ = () => iterator([configuredFile]);
  ctx.isDriveAroundHistoricalFileSupported_ = () => true;
  ctx.pruneImportSourceRejectionMarkers_ = () => ({});
  ctx.getImportSourceRejectionMarker_ = () => null;
  ctx.isCheckpointedLatestImportTable_ = () => true;
  ctx.withTransientGoogleReadRetry_ = (_label, callback) => callback();
  ctx.getImportSourceIdentity_ = (source, tableName) => ({ tableName, fileId: source.getId(), fileName: source.getName(),
    modifiedAt: source.getLastUpdated().toISOString(), size: source.getSize() });
  ctx.importSourceIdentityMatches_ = (left, right) => !!left && !!right && left.tableName === right.tableName
    && left.fileId === right.fileId && left.modifiedAt === right.modifiedAt && left.size === right.size;
  ctx.loadManualSyncStatus_ = () => ({ active: false });
  ctx.readImportExtractionCheckpoint_ = () => null;
  ctx.extractDataFromFile = () => [['unique_id'], ['row-1']];
  ctx.getPayloadSelectColumns_ = () => ['unique_id'];
  ctx.fetchAllSupabaseData = () => [];
  ctx.createDeltaSyncStats_ = () => ({ sourceRows: 1, validIdentityRows: 1, fallbackIdentityRows: 0,
    unchangedRows: 0, changedRows: 0, insertedRows: 1, deletedRows: 0, skippedRows: 0, archivedOlderFiles: 0 });
  ctx.throwIfSnapshotSourceInvalid_ = () => {};
  ctx.combineSnapshotDeleteIds_ = () => [];
  ctx.setManualSyncImportPhase_ = () => {};
  ctx.beginDatasetImportFenceIfNeeded_ = () => { events.push('fence-open'); return { runId: 'fence-run' }; };
  ctx.heartbeatDatasetImportFence_ = () => {};
  ctx.pushToSupabase = () => { events.push('live-write'); };
  ctx.deleteFromSupabase = () => { events.push('live-delete'); };
  ctx.revalidateImportSourceIdentity_ = () => { events.push('source-revalidate'); };
  ctx.closeDatasetImportFence_ = () => { events.push('fence-close'); };
  ctx.failDatasetImportFence_ = () => { events.push('fence-fail'); };
  ctx.moveDriveFileToFolderWithRetry_ = () => { events.push('move'); };
  ctx.emitTableSyncLiveEvent_ = () => {};
  return { route, folderForFiles };
}

function installBackfillHarness(ctx, properties, filesByArchive = {}) {
  const triggers = [];
  const clock = Date.parse('2026-10-16T06:00:00Z');
  ctx.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
  ctx.Utilities.formatDate = (date, _zone, pattern) => pattern === 'HH:mm:ss' ? '01:00:00' : pattern === 'Z' ? '-0500' : date.toISOString().slice(0, 10);
  ctx.LockService = { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  ctx.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: trigger => { const index = triggers.indexOf(trigger); if (index >= 0) triggers.splice(index, 1); },
    newTrigger: handler => {
      const trigger = { handler, delay: 0, getHandlerFunction: () => handler, timeBased() { return this; },
        after(delay) { this.delay = delay; return this; }, at(date) { this.delay = date.getTime() - clock; return this; }, create() { triggers.push(this); return this; } };
      return trigger;
    },
  };
  const fileById = new Map();
  Object.values(filesByArchive).flat().forEach(file => fileById.set(file.getId(), file));
  ctx.DriveApp = {
    getFileById: id => fileById.get(id) || null,
    continueFileIterator: token => iterator([], token),
  };
  ctx.getDriveFolderByIdWithRetry_ = id => ({ id });
  ctx.listDriveFilesWithRetry_ = folder => iterator(filesByArchive[folder.id] || [], `after:${folder.id}`);
  ctx.isDriveAroundHistoricalFileSupported_ = () => true;
  ctx.getImportSourceIdentity_ = (file, tableName) => ({ tableName, fileId: file.getId(),
    modifiedAt: file.getLastUpdated().toISOString(), size: file.getSize() });
  ctx.extractDataFromFile = () => [['ITEMCODE'], ['SYNTH.001']];
  ctx.revalidateImportSourceIdentity_ = (identity, tableName) => {
    const source = fileById.get(identity.fileId);
    const current = source && ctx.getImportSourceIdentity_(source, tableName);
    if (!ctx.importSourceIdentityMatches_(identity, current)) throw new Error('IMPORT_SOURCE_CHANGED_DURING_READ');
    return current;
  };
  ctx.importSourceIdentityMatches_ = (left, right) => !!left && !!right && left.tableName === right.tableName
    && left.fileId === right.fileId && left.modifiedAt === right.modifiedAt && left.size === right.size;
  ctx.getSafeImportFailureCode_ = error => String(error && error.errorCode || error && error.message || 'IMPORT_HISTORY_BACKFILL_FAILED');
  ctx.refreshHoldStopItemcodeLearningAfterHistory_ = () => ({ refreshed: true });
  return { triggers, fileById };
}

test('exact route mappings and embedded timestamp dates are preserved', () => {
  const { ctx } = harness();
  const expected = {
    drive: ['1MWLYsQJ41bZVcg1SzDIw93uNmQpzPn48', '1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA'],
    soc: ['19kd-yBZZeJfhJsITpyrzzANbJBNTs9eE', '13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo'],
    reserves: ['1Xiyp6WQGAF-4Tm-KwSwi9RsBqulFcSAG', '1u4Vk5L92zmcXXT2qNWzImWTud73Bpole'],
  };
  for (const [dataset, folders] of Object.entries(expected)) {
    const route = invoke(ctx, 'getImportHistoryRoute_', dataset);
    assert.deepEqual([route.dropFolderId, route.archiveFolderId], folders);
  }
  assert.equal(invoke(ctx, 'parseImportHistoryFilenameTimestamp_', file().getName()), '20261015063131');
  assert.equal(invoke(ctx, 'parseImportHistoryFilenameTimestamp_', 'SOC-20260230063131.xlsx'), null);
  assert.equal(invoke(ctx, 'parseImportHistoryFilenameTimestamp_', 'SOC-20261015253131.xlsx'), null);
  assert.equal(invoke(ctx, 'resolveDriveAroundCanonicalDate_', file()).canonicalDate, '2026-10-15');
});

test('live routed source selection skips TEMP and Excel lock files and orders the newest valid file first', () => {
  const { ctx } = harness();
  const route = ctx.getImportHistoryRoute_('drive');
  const withModifiedAt = (id, name, modifiedAt) => {
    const base = routedFile(id, name);
    return { ...base, getLastUpdated: () => new Date(modifiedAt) };
  };
  const files = [
    withModifiedAt('temp-id', 'TEMP_DriveAroundMC-10-10320620261019103206.xlsx', '2026-10-19T19:05:00.000Z'),
    withModifiedAt('lock-id', '~$DriveAroundMC-10-10320620261019103206.xlsx', '2026-10-19T19:04:00.000Z'),
    withModifiedAt('older-id', 'DriveAroundMC-10-10320620261019103206.xlsx', '2026-10-19T19:01:17.152Z'),
    withModifiedAt('newer-id', 'DriveAroundMC-10-10320620261019103206.xlsx', '2026-10-19T19:01:54.672Z'),
    withModifiedAt('z-tie-id', 'DriveAroundMC-10-10320620261019103206.xlsx', '2026-10-19T19:01:54.672Z'),
  ];
  ctx.getDriveFolderByIdWithRetry_ = id => ({ id });
  ctx.listDriveFilesWithRetry_ = () => iterator(files);
  ctx.isDriveAroundHistoricalFileSupported_ = name => /\.xlsx$/i.test(name);

  const selected = ctx.listRoutedDropFiles_(route);
  assert.deepEqual(Array.from(selected, file => file.getId()), ['z-tie-id', 'newer-id', 'older-id']);
  assert.equal(ctx.isLiveImportTemporaryFile_('TEMP_DriveAround.xlsx'), true);
  assert.equal(ctx.isLiveImportTemporaryFile_('~$DriveAround.xlsx'), true);
  assert.equal(ctx.isLiveImportTemporaryFile_('DriveAround.xlsx'), false);
});

test('operational routed import pins the latest source without starting paused historical backfill', () => {
  const { ctx, properties } = harness();
  const route = ctx.getImportHistoryRoute_('drive');
  let modifiedAt = Date.parse('2026-10-19T19:01:54.672Z');
  const newest = { ...routedFile('newest-id', 'DriveAroundMC-10-10320620261019103206.xlsx'),
    getLastUpdated: () => new Date(modifiedAt) };
  properties.set('IMPORT_HISTORY_BACKFILL_PAUSED_V1', 'true');
  let listCalls = 0;
  let startCalls = 0;
  let stateReads = 0;
  let selectedId = '';
  ctx.withDatasetImportProcessorLock_ = work => work();
  ctx.listRoutedDropFiles_ = () => (++listCalls === 1 ? [newest] : []);
  ctx.readImportHistoryBackfillState_ = () => { stateReads++; return null; };
  ctx.startImportHistoryBackfill = () => { startCalls++; throw new Error('historical backfill must stay paused'); };
  ctx.processFastLiveFile_ = (_dataset, _route, files) => {
    selectedId = files[0].getId();
    modifiedAt = Date.parse('2026-10-19T20:01:54.672Z'); // Simulate archive/move changing Drive's modification time.
    return { filesProcessed: 1, failedFiles: 0, fatalFailure: false };
  };

  const result = ctx.runRoutedDropImport_('drive');
  assert.equal(result.filesProcessed, 1);
  assert.equal(selectedId, 'newest-id');
  assert.equal(startCalls, 0);
  assert.equal(stateReads, 0);
  assert.equal(properties.get('IMPORT_HISTORY_BACKFILL_PAUSED_V1'), 'true');
  const watermark = JSON.parse(properties.get('MANUAL_SYNC_LIVE_SOURCE_WATERMARK_V1_DRIVE'));
  assert.deepEqual(watermark, { fileId: 'newest-id', modifiedAt: Date.parse('2026-10-19T19:01:54.672Z') });
});

test('live source watermark prevents replaying already-published older files', () => {
  const { ctx, properties } = harness();
  const route = ctx.getImportHistoryRoute_('soc');
  const oldFile = { ...routedFile('older-id', 'SOC-10OpenOrders-12250920261019122509.xlsx'),
    getLastUpdated: () => new Date('2026-10-19T19:00:49.551Z') };
  const published = { ...routedFile('published-id', 'SOC-10OpenOrders-12250920261019122509.xlsx'),
    getLastUpdated: () => new Date('2026-10-19T19:01:00.000Z') };
  const sameTimestampLowerId = { ...routedFile('a-tie-id', 'SOC-10OpenOrders-12250920261019122509.xlsx'),
    getLastUpdated: () => new Date('2026-10-19T19:01:00.000Z') };
  const sameTimestampHigherId = { ...routedFile('z-tie-id', 'SOC-10OpenOrders-12250920261019122509.xlsx'),
    getLastUpdated: () => new Date('2026-10-19T19:01:00.000Z') };
  properties.set('MANUAL_SYNC_LIVE_SOURCE_WATERMARK_V1_SOC', JSON.stringify({
    fileId: 'published-id', modifiedAt: published.getLastUpdated().getTime()
  }));
  ctx.getDriveFolderByIdWithRetry_ = id => ({ id });
  ctx.listDriveFilesWithRetry_ = () => iterator([oldFile, published, sameTimestampLowerId, sameTimestampHigherId]);
  ctx.isDriveAroundHistoricalFileSupported_ = name => /^SOC-/i.test(name);

  const files = ctx.listRoutedDropFiles_(route, 'soc');
  assert.deepEqual(Array.from(files, candidate => candidate.getId()), ['z-tie-id']);
});

test('active matching stage keeps its checkpointed source ahead of a newer drop', () => {
  const { ctx } = harness();
  const route = ctx.getImportHistoryRoute_('soc');
  const pinned = { ...routedFile('pinned-id', 'SOC-10OpenOrders-12250920261019122509.xlsx'),
    getLastUpdated: () => new Date('2026-10-19T19:00:49.551Z') };
  const newer = { ...routedFile('newer-id', 'SOC-10OpenOrders-12250920261019122509.xlsx'),
    getLastUpdated: () => new Date('2026-10-19T19:01:54.672Z') };
  ctx.getDriveFolderByIdWithRetry_ = id => ({ id });
  ctx.listDriveFilesWithRetry_ = () => iterator([newer, pinned]);
  ctx.isDriveAroundHistoricalFileSupported_ = name => /^SOC-/i.test(name);
  ctx.loadManualSyncStatus_ = () => ({ active: true, runId: 'run-2', currentStage: 'soc' });
  const identity = ctx.getImportSourceIdentity_(pinned, route.tableName);
  ctx.saveImportExtractionCheckpoint_(Object.assign(identity, { runId: 'run-1', stage: 'soc' }), 'pinned-id', 'reading', 321, false);

  const files = ctx.listRoutedDropFiles_(route, 'soc');
  assert.deepEqual(Array.from(files, candidate => candidate.getId()), ['pinned-id', 'newer-id']);
});

test('failed live publication does not advance the source watermark', () => {
  const { ctx, properties } = harness();
  const newest = { ...routedFile('failed-source', 'SOC-10OpenOrders-12250920261019122509.xlsx'),
    getLastUpdated: () => new Date('2026-10-19T19:01:00.000Z') };
  ctx.withDatasetImportProcessorLock_ = work => work();
  ctx.listRoutedDropFiles_ = () => [newest];
  ctx.processFastLiveFile_ = (_dataset, _route, files) => {
    assert.equal(files[0].getId(), 'failed-source');
    return { filesProcessed: 0, failedFiles: 1, fatalFailure: true, errorCode: 'IMPORT_DATABASE_XX000' };
  };

  const result = ctx.runRoutedDropImport_('soc');
  assert.equal(result.filesProcessed, 0);
  assert.equal(result.failedFiles, 1);
  assert.equal(properties.has('MANUAL_SYNC_LIVE_SOURCE_WATERMARK_V1_SOC'), false);
});

test('history captures every column and zero/false/blank values without writing live tables', () => {
  const { ctx, calls } = harness();
  const matrix = [['ITEMCODE', 'holdstopcode', 'locationnote', 'duplicate', 'duplicate'],
    ...Array.from({ length: 1001 }, (_, i) => ['ITEM-' + i, 'incoming', '', 0, false])];
  invoke(ctx, 'persistImportedFileHistory_', 'drive', file(), matrix);
  assert.deepEqual(calls.map(call => call.name), ['begin_import_history_v1', 'stage_import_history_rows_v1', 'publish_import_history_v1']);
  assert.equal(calls[0].args.p_report_date, '2026-10-15');
  assert.deepEqual(calls.filter(call => call.name.startsWith('stage')).map(call => call.args.p_rows.length), [1001]);
  assert.deepEqual(calls[1].args.p_rows[0].values, ['ITEM-0', 'incoming', '', 0, false]);
  assert.deepEqual(calls[0].args.p_columns, matrix[0]);
});

test('history retries skip acknowledged chunks and reject incomplete publication', () => {
  const { ctx, calls } = harness();
  const normal = ctx.callSupabaseRpc_;
  ctx.callSupabaseRpc_ = (name, args) => {
    const result = normal(name, args);
    if (name === 'begin_import_history_v1') result.stagedRows = 500;
    if (name === 'publish_import_history_v1') result.rowCount = 1000;
    return result;
  };
  const matrix = [['ITEMCODE'], ...Array.from({ length: 1001 }, (_, i) => [i])];
  assert.throws(() => invoke(ctx, 'persistImportedFileHistory_', 'drive', file(), matrix), /IMPORT_HISTORY_PUBLICATION_UNCONFIRMED/);
  assert.equal(calls[1].args.p_rows[0].row_number, 501);
  assert.equal(calls.filter(call => call.name.startsWith('stage')).length, 1);
});

test('source hashing is stable after a move or rename and rejects lossy source shapes', () => {
  const { ctx } = harness();
  const matrix = [['ITEMCODE', 'NOTE'], ['01', 'Érable'], [null, '']];
  const first = invoke(ctx, 'buildImportHistorySnapshot_', matrix);
  assert.equal(first.sourceHash, invoke(ctx, 'buildImportHistorySnapshot_', matrix).sourceHash);
  assert.throws(() => invoke(ctx, 'buildImportHistorySnapshot_', [['ITEMCODE'], ['01', 'lost']]), /IMPORT_HISTORY_ROW_WIDTH_INVALID/);
  assert.throws(() => invoke(ctx, 'buildImportHistorySnapshot_', [['ITEMCODE'], [Infinity]]), /IMPORT_HISTORY_CELL_INVALID/);
});

test('all three live drivers use the same sequential, acknowledged archive route', () => {
  const { ctx } = harness();
  const datasets = [];
  ctx.runRoutedDropImport_ = dataset => datasets.push(dataset);
  ctx.runDriveAroundOnly(); ctx.runSOCOnly(); ctx.runReservesOnly();
  assert.deepEqual(datasets, ['drive', 'soc', 'reserves']);
});

test('SOC live write and publication fence complete before history publication and the Drive move', () => {
  const { ctx } = harness(), events = [];
  const route = ctx.getImportHistoryRoute_('soc');
  const source = routedFile('soc-live-1', 'SOC-20261015063131.xlsx');
  installLatestImportHarness(ctx, events, source, 'soc');
  ctx.persistImportedFileHistory_ = () => { events.push('history-published'); return { status: 'ready' }; };
  const result = ctx.processLatestFileOnlyFolderLocked_(route.dropFolderId, route.archiveFolderId, route.tableName,
    () => ({ upserts: [{ unique_id: 'row-1' }], seenIds: new Set(['row-1']), totalRows: 1,
      stats: { sourceRows: 1, validIdentityRows: 1, insertedRows: 1 } }),
    { deltaMode: true, historyDataset: 'soc', historyFileId: source.getId() });
  assert.equal(result.filesProcessed, 1);
  assert.ok(events.indexOf('live-write') >= 0, 'live rows were written');
  assert.ok(events.indexOf('history-published') > events.indexOf('live-write'), 'history follows the live write');
  assert.ok(events.indexOf('fence-close') > events.indexOf('history-published'), 'publication fence closes after history');
  assert.ok(events.indexOf('move') > events.indexOf('fence-close'), 'Drive move is last');
});

test('history publication failure or continuation leaves the live source in its drop folder', () => {
  for (const failureMode of ['publish-failure', 'continuation']) {
    const { ctx } = harness(), events = [];
    const route = ctx.getImportHistoryRoute_('soc');
    const source = routedFile(`soc-${failureMode}`, 'SOC-20261015063131.xlsx');
    installLatestImportHarness(ctx, events, source, 'soc');
    ctx.persistImportedFileHistory_ = () => {
      if (failureMode === 'continuation') {
        const error = new Error('IMPORT_HISTORY_CONTINUATION_PENDING');
        error.errorCode = 'IMPORT_HISTORY_CONTINUATION_PENDING'; error.stagedRows = 500; error.totalRows = 1000;
        throw error;
      }
      throw new Error('IMPORT_HISTORY_PUBLISH_FIXTURE_FAILURE');
    };
    const result = ctx.processLatestFileOnlyFolderLocked_(route.dropFolderId, route.archiveFolderId, route.tableName,
      () => ({ upserts: [{ unique_id: 'row-1' }], seenIds: new Set(['row-1']), totalRows: 1,
        stats: { sourceRows: 1, validIdentityRows: 1, insertedRows: 1 } }),
      { deltaMode: true, historyDataset: 'soc', historyFileId: source.getId() });
    assert.ok(events.indexOf('live-write') >= 0, `${failureMode}: live rows were written before history attempt`);
    assert.equal(events.includes('move'), false, `${failureMode}: source was not moved`);
    assert.equal(events.includes('fence-close'), false, `${failureMode}: success fence was not published`);
    assert.ok(events.includes('fence-fail'), `${failureMode}: fence is left failed for canonical retry`);
    if (failureMode === 'continuation') assert.equal(result.continuationPending, true);
    else assert.equal(result.failedFiles, 1);
  }
});

test('history backfill resumes the pinned archived source after a continuation and finishes all three routes', () => {
  const { ctx, properties } = harness(), imported = [];
  const routes = ['drive', 'soc', 'reserves'].map(dataset => ctx.getImportHistoryRoute_(dataset));
  const filesByArchive = Object.fromEntries(routes.map((route, index) => [route.archiveFolderId,
    [routedFile(`${route.tableName}-archive-${index}`, `${['DriveAroundMC', 'SOC', 'Reserves'][index]}-20261015063131.xlsx`, route.archiveFolderId)]]));
  const { triggers } = installBackfillHarness(ctx, properties, filesByArchive);
  const extractedFileIds = [];
  ctx.extractDataFromFile = file => {
    assert.equal(triggers.length, 1, 'a watchdog is armed before parsing the archived file');
    assert.equal(triggers[0].delay, 5 * 60000, 'the watchdog allows the bounded parse and RPC budget');
    extractedFileIds.push(file.getId());
    return [['ITEMCODE'], ['SYNTH.001']];
  };
  ctx.persistImportedFileHistory_ = (dataset, file, _rawData, _started, identity) => {
    assert.equal(triggers.length, 1, 'the watchdog remains armed before the history RPC');
    assert.equal(triggers[0].delay, 5 * 60000);
    imported.push({ dataset, fileId: file.getId(), identityFileId: identity.fileId,
      stagedRows: ctx.getImportHistoryBackfillStatus().stagedRows || 0 });
    if (imported.length === 1) {
      const error = new Error('IMPORT_HISTORY_CONTINUATION_PENDING');
      error.errorCode = 'IMPORT_HISTORY_CONTINUATION_PENDING'; error.stagedRows = 500; error.totalRows = 1000;
      throw error;
    }
    return { rowCount: 1 };
  };
  const started = ctx.startImportHistoryBackfill();
  assert.equal(started.status, 'running');

  const continuation = ctx.runImportHistoryBackfillChunk_();
  assert.equal(continuation.currentFileId, filesByArchive[routes[0].archiveFolderId][0].getId());
  assert.equal(continuation.stagedRows, 500);
  assert.equal(continuation.filesAcknowledged, 0);
  assert.equal(continuation.failures, 0);
  assert.equal(ctx.getImportHistoryBackfillStatus().stagedRows, 500, 'the acknowledged partial chunk remains recorded for recovery');

  const resumed = ctx.runImportHistoryBackfillChunk_();
  assert.equal(resumed.filesAcknowledged, 1);
  assert.equal(resumed.currentFileId, '');
  assert.equal(imported[0].fileId, imported[1].fileId, 'continuation retries the pinned file');
  assert.equal(imported[1].identityFileId, imported[1].fileId, 'history uses the verified source identity');
  assert.equal(imported[1].stagedRows, 500, 're-entry retains the confirmed staging cursor for RPC continuation');
  assert.deepEqual(extractedFileIds.slice(0, 2), [imported[0].fileId, imported[0].fileId], 're-entry parses the same pinned file');

  let state = resumed;
  while (state.status === 'running' && state.datasetIndex < 3) state = ctx.runImportHistoryBackfillChunk_();
  assert.equal(state.status, 'complete');
  assert.deepEqual([...new Set(imported.map(entry => entry.dataset))].sort(), ['drive', 'reserves', 'soc']);
  assert.deepEqual(imported.map(entry => entry.dataset).filter((value, index, list) => list.indexOf(value) === index), ['drive', 'soc', 'reserves']);
  assert.equal(state.filesAcknowledged, 3);
  assert.equal(state.rowsAcknowledged, 3);
  assert.equal(state.datasetIndex, 3);
  assert.equal(triggers.length, 0, 'completion removes the watchdog without leaving a repeating trigger');
});

test('history backfill preserves the source on identity change and stops after three failures', () => {
  const { ctx, properties } = harness();
  const route = ctx.getImportHistoryRoute_('drive');
  const source = routedFile('drive-identity-1', 'DriveAroundMC-20261015063131.xlsx', route.archiveFolderId);
  const { triggers } = installBackfillHarness(ctx, properties, { [route.archiveFolderId]: [source] });
  ctx.revalidateImportSourceIdentity_ = () => { throw new Error('IMPORT_SOURCE_CHANGED_DURING_READ'); };
  ctx.startImportHistoryBackfill();
  const states = [ctx.runImportHistoryBackfillChunk_(), ctx.runImportHistoryBackfillChunk_(), ctx.runImportHistoryBackfillChunk_()];
  assert.deepEqual(states.map(state => state.failures), [1, 2, 3]);
  assert.deepEqual(states.map(state => state.status), ['running', 'running', 'failed']);
  assert.ok(states.every(state => state.currentFileId === source.getId()), 'changed source remains pinned and unacknowledged');
  assert.ok(states.every(state => state.errorCode === 'IMPORT_SOURCE_CHANGED_DURING_READ'));
  assert.equal(states[2].filesAcknowledged, 0);
  assert.equal(triggers.length, 0, 'failed backfill removes its watchdog and stops retrying after the third failure');
  assert.equal(ctx.runImportHistoryBackfillChunk_().status, 'failed', 'a stopped backfill does not retry again');
});
