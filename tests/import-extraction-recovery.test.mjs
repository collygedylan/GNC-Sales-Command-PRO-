// @test-group: node-unit
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

function createHarness() {
  const properties = new Map();
  const sleeps = [];
  const calls = [];
  const propertyStore = {
    getProperty: key => properties.get(String(key)) || null,
    setProperty: (key, value) => properties.set(String(key), String(value)),
    deleteProperty: key => properties.delete(String(key)),
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => propertyStore },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => Array.from(createHash(algorithm).update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      sleep: milliseconds => sleeps.push(milliseconds),
    },
    __sleeps: sleeps,
    __calls: calls,
  });
  new vm.Script(source, { filename: 'Code.gs' }).runInContext(context);
  return { context, properties, sleeps, calls };
}

test('worksheet extraction reads in 500-row chunks and resumes transient reads safely', () => {
  const harness = createHarness();
  const rowCount = 1101;
  let failedOnce = false;
  const sheet = {
    getDataRange: () => ({ getNumRows: () => rowCount, getNumColumns: () => 2 }),
    getRange(start, column, count, width) {
      harness.calls.push({ start, column, count, width });
      assert.ok(count <= 500, 'every Sheets API read is bounded to 500 rows');
      return {
        getValues() {
          if (start === 501 && !failedOnce) {
            failedOnce = true;
            throw new Error("We're sorry, a server error occurred. Please wait a bit and try again.");
          }
          return Array.from({ length: count }, (_, index) => [start + index, `row-${start + index}`]);
        },
      };
    },
  };
  const identity = {
    tableName: 'ph_soc_master', fileId: 'drive-file-1', fileName: 'SOC.xlsx',
    modifiedAt: '2026-10-13T07:00:00.000Z', size: 1234,
  };
  const rows = vm.runInContext('readSpreadsheetDataRangeChunked_(__sheet, {}, __identity, "temp-sheet")', Object.assign(harness.context, { __sheet: sheet, __identity: identity }));
  assert.equal(rows.length, rowCount);
  assert.deepEqual(harness.calls.map(call => call.start), [1, 501, 501, 1001]);
  assert.deepEqual(harness.sleeps, [1000]);
  const checkpoint = JSON.parse(harness.properties.get('IMPORT_EXTRACTION_CHECKPOINT_V1'));
  assert.equal(checkpoint.phase, 'reading');
  assert.equal(checkpoint.rowsRead, rowCount);
  assert.equal(checkpoint.tempSheetId, 'temp-sheet');
  assert.equal(JSON.stringify(checkpoint).includes('row-'), false, 'checkpoints never persist source cell values');
});

test('transient read retry stops after three attempts and does not retry permanent errors', () => {
  const harness = createHarness();
  const transient = { count: 0 };
  assert.throws(() => vm.runInContext(`withTransientGoogleReadRetry_('fixture', () => { __attempts.count++; throw new Error('service unavailable'); })`, Object.assign(harness.context, { __attempts: transient })), /service unavailable/);
  assert.equal(transient.count, 3);
  assert.deepEqual(harness.sleeps, [1000, 2000]);

  harness.sleeps.length = 0;
  const permanent = { count: 0 };
  const context = Object.assign(harness.context, { __permanent: permanent });
  assert.throws(() => vm.runInContext(`withTransientGoogleReadRetry_('fixture', () => { __permanent.count++; throw new Error('permission denied'); })`, context), /permission denied/);
  assert.equal(permanent.count, 1);
  assert.deepEqual(harness.sleeps, []);
});

test('a truncated worksheet range is rejected instead of becoming a partial snapshot', () => {
  for (const values of [[], [[1]], [[1, 2]]]) {
    const harness = createHarness();
    harness.context.__sheet = {
      getDataRange: () => ({ getNumRows: () => 2, getNumColumns: () => 2 }),
      getRange: () => ({ getValues: () => values }),
    };
    assert.throws(() => vm.runInContext('readSpreadsheetDataRangeChunked_(__sheet, {}, null, "", false)', harness.context), /IMPORT_WORKSHEET_READ_INCOMPLETE/);
    assert.equal(harness.properties.has('IMPORT_EXTRACTION_CHECKPOINT_V1'), false);
  }
});

test('the worker time reserve defers before starting another Google read', () => {
  const harness = createHarness();
  const attempted = { count: 0 };
  const context = Object.assign(harness.context, {
    __attempted: attempted,
    manualSyncInvocationDeadlineMs_: Date.now() + 1000,
  });
  assert.throws(() => vm.runInContext("withTransientGoogleReadRetry_('budget fixture', () => { __attempted.count++; return true; })", context), error => error.errorCode === 'IMPORT_PREPARATION_DEFERRED');
  assert.equal(attempted.count, 0);
});

test('retry budgeting includes backoff before another transient Google read', () => {
  const harness = createHarness();
  let now = Date.now(), attempts = 0;
  const deadline = now + 46400;
  harness.context.Date = class extends Date { static now() { return now; } };
  harness.context.manualSyncInvocationDeadlineMs_ = deadline;
  harness.context.__read = () => { attempts++; now += 500; throw new Error("We're sorry, a server error occurred. Please wait a bit and try again."); };
  assert.throws(() => vm.runInContext("withTransientGoogleReadRetry_('budgeted retry', __read)", harness.context), error => error.errorCode === 'IMPORT_PREPARATION_DEFERRED');
  assert.equal(attempts, 1);
  assert.deepEqual(harness.sleeps, [], 'backoff is skipped when it would consume the finalization reserve');
});

test('source checkpoints are bound to immutable file identity and deterministic conversion names', () => {
  const harness = createHarness();
  const identity = {
    tableName: 'ph_soc_master', fileId: 'drive-file-1', fileName: 'SOC.xlsx',
    modifiedAt: '2026-10-13T07:00:00.000Z', size: 1234,
  };
  const context = Object.assign(harness.context, { __identity: identity });
  const name = vm.runInContext('buildImportTempSheetName_(__identity)', context);
  assert.match(name, /^TEMP_IMPORT_ph_soc_master_drive-file-1_\d+_1234$/);
  const changedSizeName = vm.runInContext('buildImportTempSheetName_(__changed)', Object.assign(context, { __changed: { ...identity, size: 1235 } }));
  assert.notEqual(name, changedSizeName, 'a same-timestamp source size change cannot reuse an old conversion');
  vm.runInContext('saveImportExtractionCheckpoint_(__identity, "temp-sheet", "converted", 0)', context);
  const loaded = vm.runInContext('readImportExtractionCheckpoint_()', context);
  assert.equal(loaded.runId, '');
  assert.equal(loaded.attempt, 1);
  assert.equal(vm.runInContext('importSourceIdentityMatches_(__identity, __loaded)', Object.assign(context, { __loaded: loaded })), true);
  assert.equal(vm.runInContext('importSourceIdentityMatches_(__identity, __changed)', Object.assign(context, { __changed: { ...identity, size: 1235 } })), false);
  assert.equal(vm.runInContext('clearImportExtractionCheckpoint_(__changed)', Object.assign(context, { __changed: { ...identity, size: 1235 } })), false);
  assert.ok(harness.properties.has('IMPORT_EXTRACTION_CHECKPOINT_V1'));
  vm.runInContext('saveImportExtractionIntent_(__identity, "conversion-in-progress")', context);
  const intent = vm.runInContext('readImportExtractionCheckpoint_()', context);
  assert.equal(intent.tempSheetId, '', 'an interrupted conversion intent never becomes the literal "undefined" sheet id');
  assert.equal(intent.tempSheetName, 'conversion-in-progress');
});

test('an interrupted SOC workbook reuses its conversion and rereads the complete bounded source', () => {
  const harness = createHarness();
  const matrix = [['ITEMCODE', 'VALUE'], ...Array.from({ length: 1100 }, (_, index) => [`ITEM-${index + 1}`, index + 1])];
  let failSecondChunk = true;
  let tempExists = false;
  let createCalls = 0;
  const rangeStarts = [];
  const sheet = {
    getDataRange: () => ({ getNumRows: () => matrix.length, getNumColumns: () => 2 }),
    getRange(start, column, count) {
      rangeStarts.push(start);
      return { getValues() {
        if (start === 501 && failSecondChunk) { failSecondChunk = false; throw new Error('injected Apps Script interruption'); }
        return matrix.slice(start - 1, start - 1 + count);
      } };
    },
  };
  const sourceFile = {
    getId: () => 'soc-source-1', getName: () => 'SOC.xlsx', getMimeType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    getLastUpdated: () => new Date('2026-10-13T07:00:00.000Z'), getSize: () => 1234, getBlob: () => ({}),
  };
  const context = Object.assign(harness.context, {
    MimeType: { CSV: 'text/csv', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Drive: { Files: { create() { createCalls++; tempExists = true; return { id: 'converted-soc-1' }; } } },
    SpreadsheetApp: { openById: id => { assert.equal(id, 'converted-soc-1'); return { getSheets: () => [sheet] }; } },
  });
  context.findImportTempSheet_ = () => tempExists ? { getId: () => 'converted-soc-1' } : null;
  context.__file = sourceFile;
  context.__options = { importTableName: 'ph_soc_master', importCheckpointContext: { runId: 'run-1', stage: 'soc', attempt: 1 } };
  assert.throws(() => vm.runInContext('extractDataFromFile(__file, "drop", __options)', context), /injected Apps Script interruption/);
  const interrupted = JSON.parse(harness.properties.get('IMPORT_EXTRACTION_CHECKPOINT_V1'));
  assert.equal(interrupted.runId, 'run-1');
  assert.equal(interrupted.stage, 'soc');
  assert.equal(interrupted.isTempSheet, true);
  assert.equal(interrupted.tempSheetId, 'converted-soc-1');

  context.__options = { importTableName: 'ph_soc_master', importCheckpointContext: { runId: 'run-1', stage: 'soc', attempt: 2 } };
  const resumed = vm.runInContext('extractDataFromFile(__file, "drop", __options)', context);
  assert.equal(createCalls, 1, 'the retry reuses the source-bound converted workbook');
  assert.equal(resumed.length, matrix.length, 'the entire source, including its header, is parsed before publication');
  assert.deepEqual(rangeStarts, [1, 501, 1, 501, 1001]);
  const completed = JSON.parse(harness.properties.get('IMPORT_EXTRACTION_CHECKPOINT_V1'));
  assert.equal(completed.attempt, 2);
  assert.equal(completed.rowsRead, matrix.length);
});

for (const table of ['ph_soc_master', 'ph_reserves']) test(`chunk boundaries preserve duplicate ${table} identities exactly like a single complete read`, () => {
  const harness = createHarness();
  const header = ['ITEMCODE', 'DOCK', 'CUSTOMERNAME', 'CONSIGNEENAME', 'STOPNUMBER', 'TRANSACTIONNUMBER', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SUSPEND', 'SUSPEND_TO', 'QUANTITYORDERED', 'DATE_COMPLETED', 'INVOICEDATE'];
  const row = ['ITEM-1', 'DOCK-1', 'Customer', 'Consignee', '1', 'TX-1', '#3', 'A.1', '27.F1', '', '', '10', '', ''];
  const matrix = [header, ...Array.from({ length: 1000 }, (_, index) => index === 498 || index === 499 ? row.slice() : row.map((value, column) => column === 0 ? `ITEM-${index + 2}` : value))];
  const sheet = {
    getDataRange: () => ({ getNumRows: () => matrix.length, getNumColumns: () => header.length }),
    getRange(start, column, count) { return { getValues: () => matrix.slice(start - 1, start - 1 + count) }; },
  };
  const identity = { tableName: 'ph_soc_master', fileId: 'soc-dup', fileName: 'SOC.xlsx', modifiedAt: '2026-10-13T07:00:00.000Z', size: 1234, runId: 'run-2', stage: 'soc', attempt: 1 };
  const context = Object.assign(harness.context, { __sheet: sheet, __identity: identity, __matrix: matrix, __table: table });
  const chunked = vm.runInContext('readSpreadsheetDataRangeChunked_(__sheet, {}, __identity, "temp", true)', context);
  const chunkedBuild = vm.runInContext('buildStandardPayload(__rows, __table, [], "2026-10-13T08:00:00.000Z", "source.xlsx")', Object.assign(context, { __rows: chunked }));
  const singleBuild = vm.runInContext('buildStandardPayload(__matrix, __table, [], "2026-10-13T08:00:00.000Z", "source.xlsx")', context);
  const project = result => ({ upserts: JSON.parse(JSON.stringify(result.upserts)), seenIds: Array.from(result.seenIds).sort() });
  assert.deepEqual(project(chunkedBuild), project(singleBuild));
  assert.equal(new Set(chunkedBuild.upserts.map(record => record.unique_id)).size, chunkedBuild.upserts.length);
});

function makeImportFile(id, name, modifiedAt) {
  return {
    getId: () => id, getName: () => name, getLastUpdated: () => new Date(modifiedAt), getSize: () => 900,
    getMimeType: () => 'text/csv', getBlob: () => ({ getDataAsString: () => '' }),
  };
}

function configureLatestImportHarness(harness, filesByRead, moveFile) {
  let listRead = 0;
  harness.context.getDriveFolderByIdWithRetry_ = id => id;
  harness.context.listDriveFilesWithRetry_ = () => {
    const files = filesByRead[Math.min(listRead++, filesByRead.length - 1)];
    let index = 0;
    return { hasNext: () => index < files.length, next: () => files[index++] };
  };
  harness.context.pruneImportSourceRejectionMarkers_ = () => ({});
  harness.context.extractDataFromFile = () => [['ITEMCODE'], ['ITEM-1']];
  harness.context.fetchAllSupabaseData = () => [];
  harness.context.throwIfSnapshotSourceInvalid_ = () => {};
  harness.context.formatDeltaSyncStats_ = () => 'stats';
  const fence = { runId: 'fence', closed: false };
  harness.context.beginDatasetImportFenceIfNeeded_ = () => fence;
  harness.context.closeDatasetImportFence_ = () => { fence.closed = true; harness.calls.push({ type: 'published' }); };
  harness.context.failDatasetImportFence_ = () => { if (!fence.closed) harness.calls.push({ type: 'fence-failed' }); };
  harness.context.pushToSupabase = () => harness.calls.push({ type: 'write' });
  harness.context.deleteFromSupabase = () => {};
  harness.context.moveDriveFileToFolderWithRetry_ = file => moveFile(file);
  harness.context.emitTableSyncLiveEvent_ = () => {};
  harness.context.DriveApp = { getFileById: id => filesByRead[0].find(file => file.getId() === id) };
  harness.context.__files = filesByRead[0];
  harness.context.__builder = () => ({ upserts: [{ unique_id: 'row-1' }], seenIds: new Set(['row-1']), totalRows: 1, stats: harness.context.createDeltaSyncStats_() });
  harness.context.__options = { deltaMode: true };
  return `processLatestFileOnlyFolderLocked_("drop", "processed", "ph_soc_master", __builder, __options)`;
}

test('a newer SOC source arriving during preparation defers before any write', () => {
  const harness = createHarness();
  const oldFile = makeImportFile('soc-old', 'SOC-old.csv', '2026-10-13T07:00:00.000Z');
  const newFile = makeImportFile('soc-new', 'SOC-new.csv', '2026-10-13T08:00:00.000Z');
  const expression = configureLatestImportHarness(harness, [[oldFile], [newFile, oldFile]], () => {});
  harness.context.__expectedFile = oldFile;
  harness.context.DriveApp = { getFileById: id => id === oldFile.getId() ? oldFile : newFile };
  assert.throws(() => vm.runInContext(expression, harness.context), error => error.errorCode === 'IMPORT_SOURCE_SELECTION_CHANGED');
  assert.equal(harness.calls.some(call => call.type === 'write' || call.type === 'published'), false);
  assert.equal(harness.calls.some(call => call.type === 'fence-failed'), false);
});

test('a pinned SOC file that changes during database writes fails the fence and is not published or archived', () => {
  const harness = createHarness();
  const file = makeImportFile('soc-mutating', 'SOC-mutating.csv', '2026-10-13T07:00:00.000Z');
  let size = 900;
  file.getSize = () => size;
  const expression = configureLatestImportHarness(harness, [[file], [file]], () => harness.calls.push({ type: 'archive' }));
  harness.context.pushToSupabase = () => {
    harness.calls.push({ type: 'write' });
    size = 901;
  };
  const result = vm.runInContext(expression, harness.context);
  assert.equal(result.failedFiles, 1);
  assert.equal(harness.calls.some(call => call.type === 'fence-failed'), true);
  assert.equal(harness.calls.some(call => call.type === 'published'), false);
  assert.equal(harness.calls.some(call => call.type === 'archive'), false);
});

test('a publication/archive failure leaves the selected SOC source available for canonical replay', () => {
  const harness = createHarness();
  const file = makeImportFile('soc-pending', 'SOC-pending.csv', '2026-10-13T07:00:00.000Z');
  const expression = configureLatestImportHarness(harness, [[file], [file]], () => { throw new Error('archive unavailable'); });
  const result = vm.runInContext(expression, harness.context);
  assert.equal(result.filesProcessed, 0);
  assert.equal(result.failedFiles, 1);
  assert.equal(harness.calls.some(call => call.type === 'write'), true);
  assert.equal(harness.calls.some(call => call.type === 'published'), true);
  assert.equal(harness.calls.some(call => call.type === 'fence-failed'), false, 'a confirmed publication remains published and can be replayed idempotently');
});

test('an unconfirmed publication fails the fence and leaves the source unarchived', () => {
  const harness = createHarness();
  const file = makeImportFile('soc-unpublished', 'SOC-unpublished.csv', '2026-10-13T07:00:00.000Z');
  const expression = configureLatestImportHarness(harness, [[file], [file]], () => harness.calls.push({ type: 'archive' }));
  harness.context.closeDatasetImportFence_ = () => { throw new Error('DATASET_IMPORT_CLOSE_FAILED'); };
  const result = vm.runInContext(expression, harness.context);
  assert.equal(result.failedFiles, 1);
  assert.equal(result.filesProcessed, 0);
  assert.equal(harness.calls.some(call => call.type === 'fence-failed'), true);
  assert.equal(harness.calls.some(call => call.type === 'archive'), false);
});

test('a typed deferral raised after the write fence begins is recorded as a failed import, not rescheduled as prewrite work', () => {
  const harness = createHarness();
  const file = makeImportFile('soc-writing', 'SOC-writing.csv', '2026-10-13T07:00:00.000Z');
  const expression = configureLatestImportHarness(harness, [[file], [file]], () => {});
  harness.context.__options = {
    deltaMode: true,
    afterCommit() {
      const error = new Error('IMPORT_PREPARATION_DEFERRED');
      error.errorCode = 'IMPORT_PREPARATION_DEFERRED';
      throw error;
    },
  };
  const result = vm.runInContext(expression, harness.context);
  assert.equal(result.filesProcessed, 0);
  assert.equal(result.failedFiles, 1);
  assert.equal(harness.calls.some(call => call.type === 'fence-failed'), true);
});
