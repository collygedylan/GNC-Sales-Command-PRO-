// @test-group: suspend
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function context(properties = new Map()) {
  const result = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.has(String(key)) ? properties.get(String(key)) : null,
      setProperty: (key, value) => { properties.set(String(key), String(value)); },
      deleteProperty: key => { properties.delete(String(key)); },
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => Array.from(createHash(algorithm).update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    },
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(result);
  return result;
}
function invoke(ctx, name, ...args) {
  ctx.__args = args;
  return vm.runInContext(`${name}(...__args)`, ctx);
}
const plain = value => JSON.parse(JSON.stringify(value));
function csv(completion = '', quantity = '10', completionHeader = 'DATE_COMPLETED', invoice = '', invoiceHeader = 'INVOICEDATE') {
  return [
    ['ITEMCODE', 'DOCK', 'CUSTOMERNAME', 'CONSIGNEENAME', 'STOPNUMBER', 'TRANSACTIONNUMBER', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SUSPEND', 'SUSPEND_TO', 'QUANTITYORDERED', completionHeader, invoiceHeader],
    ['SYNTHETIC-ITEM', 'SYNTHETIC-DOCK', 'Fictitious Customer', 'Fictitious Consignee', '1', 'TEST-TX', '#3', 'TEST.LOC', '27.F1', 'SUSPEND', 'DC', quantity, completion, invoice],
  ];
}
const build = (ctx, data, existing = [], table = 'ph_soc_master') => invoke(ctx, 'buildStandardPayload', data, table, existing, '2026-09-08T17:00:00Z', 'synthetic.csv');

function processSnapshot(ctx, data, existing = [], modifiedAt = '2026-09-08T17:00:00.000Z', tableName = 'ph_soc_master') {
  const events = [];
  let read = false;
  ctx.console = { log() {}, warn() {}, error() {} };
  ctx.getDriveFolderByIdWithRetry_ = () => ({});
  ctx.listDriveFilesWithRetry_ = () => ({
    hasNext: () => !read,
      next: () => { read = true; return { getName: () => 'synthetic.csv', getId: () => 'synthetic-file-id', getLastUpdated: () => new Date(modifiedAt) }; },
  });
  ctx.extractDataFromFile = () => data;
  ctx.fetchAllSupabaseData = (_, columns) => {
    const fields = Array.isArray(columns) ? columns : String(columns).split(',');
    return existing.map(row => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
  };
  ctx.beginDatasetImportFenceIfNeeded_ = () => { events.push({ type: 'begin' }); return null; };
  ctx.closeDatasetImportFence_ = () => events.push({ type: 'finish' });
  ctx.failDatasetImportFence_ = () => {};
  ctx.pushToSupabase = (_, rows) => events.push({ type: 'upsert', rows: plain(rows) });
  ctx.deleteFromSupabase = (_, ids) => events.push({ type: 'delete', ids: plain(ids) });
  ctx.moveDriveFileToFolderWithRetry_ = () => events.push({ type: 'archive' });
  ctx.emitTableSyncLiveEvent_ = () => {};
  const result = invoke(ctx, 'processLatestFileOnlyFolderLocked_', 'source', 'processed', tableName, ctx.buildStandardPayload, { deltaMode: true });
  return { result, events };
}

function processLatestSnapshotFiles(ctx, files, existing = [], tableName = 'ph_soc_master') {
  const events = [];
  const entries = files.map(file => ({
    ...file,
    getName: () => file.name,
    getId: () => file.id,
    getLastUpdated: () => new Date(file.modifiedAt),
  }));
  let readIndex = 0;
  ctx.console = { log() {}, warn() {}, error() {} };
  ctx.getDriveFolderByIdWithRetry_ = folderId => ({ folderId });
  ctx.listDriveFilesWithRetry_ = () => ({ hasNext: () => readIndex < entries.length, next: () => entries[readIndex++] });
  ctx.extractDataFromFile = file => file.data;
  ctx.fetchAllSupabaseData = (_, columns) => {
    const fields = Array.isArray(columns) ? columns : String(columns).split(',');
    return existing.map(row => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
  };
  ctx.beginDatasetImportFenceIfNeeded_ = () => { events.push({ type: 'begin' }); return null; };
  ctx.closeDatasetImportFence_ = () => events.push({ type: 'finish' });
  ctx.failDatasetImportFence_ = () => { events.push({ type: 'fence-failed' }); };
  ctx.pushToSupabase = (_, rows) => events.push({ type: 'upsert', rows: plain(rows) });
  ctx.deleteFromSupabase = (_, ids) => events.push({ type: 'delete', ids: plain(ids) });
  ctx.moveDriveFileToFolderWithRetry_ = file => events.push({ type: 'archive', name: file.getName() });
  ctx.emitTableSyncLiveEvent_ = table => events.push({ type: 'table-event', table });
  const result = invoke(ctx, 'processLatestFileOnlyFolderLocked_', 'source', 'processed', tableName, ctx.buildStandardPayload, { deltaMode: true });
  return { result, events };
}

function latestFile(id, name, data, modifiedAt) {
  return { id, name, data, modifiedAt };
}

function processMasterSnapshotBatch(ctx, files, existing = []) {
  const events = [];
  ctx.console = { log() {}, warn() {}, error(...args) { events.push({ type: 'error', detail: String(args[0] || '') }); } };
  ctx.getDriveFolderByIdWithRetry_ = folderId => ({ folderId });
  let readIndex = 0;
  ctx.listDriveFilesWithRetry_ = () => ({
    hasNext: () => readIndex < files.length,
    next: () => files[readIndex++],
  });
  ctx.extractDataFromFile = file => file.data;
  ctx.fetchAllSupabaseData = () => existing;
  ctx.fetchAllSupabaseRowIdsForMaster_ = () => existing.map(row => String(row.unique_id || '')).filter(Boolean);
  ctx.fetchSupabaseRowsByIds_ = () => existing;
  ctx.beginDatasetImportFenceIfNeeded_ = () => { events.push({ type: 'begin' }); return null; };
  ctx.closeDatasetImportFence_ = () => events.push({ type: 'finish' });
  ctx.failDatasetImportFence_ = () => events.push({ type: 'fence-failed' });
  ctx.pushToSupabase = (_, rows) => events.push({ type: 'upsert', rows: plain(rows) });
  ctx.deleteFromSupabase = (_, ids) => events.push({ type: 'delete', ids: plain(ids) });
  ctx.moveDriveFileToFolderWithRetry_ = file => events.push({ type: 'archive', name: file.getName() });
  ctx.emitTableSyncLiveEvent_ = table => events.push({ type: 'table-event', table });
  ctx.reconcileSeasonSalesOfficeAfterImport_ = () => {};
  ctx.callSupabaseRpc_ = () => ({ status: 'complete', resolved: 0 });
  const result = invoke(ctx, 'processSnapshotBatchFolderLocked_', 'source', 'processed-test', 'ph_master_inventory', ctx.buildMasterPayload, {});
  return { result, events };
}

test('SOC imports omit blank, null-like, and nonblank completion columns uniformly', () => {
  const ctx = context();
  for (const header of ['DATE_COMPLETED', 'Date Completed', 'date-completed']) {
    for (const value of ['', 'NULL', '2026-09-01T00:00:00Z']) {
      const row = build(ctx, csv(value, '10', header)).upserts[0];
      assert.ok(row);
      assert.equal(Object.hasOwn(row, 'date_completed'), false);
      assert.equal(row.suspend, 'SUSPEND');
      assert.equal(row.quantityordered, '10');
    }
  }
});

test('unchanged SOC imports stay unchanged after an app completion', () => {
  const ctx = context();
  const source = plain(build(ctx, csv()).upserts[0]);
  const completed = { ...source, date_completed: '2026-09-08T17:05:00Z' };
  for (const completion of ['', 'NULL', '2026-01-01T00:00:00Z']) {
    const result = build(ctx, csv(completion), [completed]);
    assert.equal(result.upserts.length, 0, 'completion-only CSV differences must not trigger upserts');
    assert.equal(result.stats.unchangedRows, 1);
    assert.ok(result.seenIds.has(completed.unique_id), 'completed source is still present in snapshot');
  }
});

test('changed SOC inventory upsert preserves a concurrent Done by omission, not a stale copy', () => {
  const ctx = context();
  const source = plain(build(ctx, csv()).upserts[0]);
  const staleSnapshot = { ...source, date_completed: null };
  const upsert = plain(build(ctx, csv('', '12'), [staleSnapshot]).upserts[0]);
  assert.equal(Object.hasOwn(upsert, 'date_completed'), false);
  assert.equal(upsert.quantityordered, '12');
  const serverRow = { ...source, date_completed: '2026-09-08T17:05:00Z' };
  assert.equal({ ...serverRow, ...upsert }.date_completed, serverRow.date_completed);
});

test('completion changes do not affect SOC payload hashing or reintroduce a chunk-null field', () => {
  const ctx = context();
  const blank = build(ctx, csv()).upserts[0];
  const supplied = build(ctx, csv('2026-01-01T00:00:00Z')).upserts[0];
  assert.equal(invoke(ctx, 'buildRowSyncHash_', blank), invoke(ctx, 'buildRowSyncHash_', supplied));
  const chunk = invoke(ctx, 'normalizeSupabaseUpsertChunk', [blank, supplied]);
  assert.equal(chunk.length, 2);
  for (const row of chunk) assert.equal(Object.hasOwn(row, 'date_completed'), false);
  // SOC currently uses field comparisons rather than persisted hashes. Both
  // paths must ignore the app-owned completion column.
  assert.equal(invoke(ctx, 'didDeltaRowChange_', blank, supplied), false);
});

test('site-split SOC variants preserve the same app-owned completion contract', () => {
  const ctx = context();
  for (const table of ['ph_soc_master', 'tx_soc_master', 'nc_soc_master', 'hl_soc_master']) {
    assert.equal(Object.hasOwn(build(ctx, csv('2026-01-01T00:00:00Z'), [], table).upserts[0], 'date_completed'), false);
  }
});

test('master, reserve, and request payload completion behavior is unchanged', () => {
  const ctx = context();
  const completedAt = '2026-01-01T00:00:00Z';
  for (const table of ['ph_master_inventory', 'ph_reserves', 'ph_active_request']) {
    assert.equal(build(ctx, csv(completedAt), [], table).upserts[0].date_completed, completedAt);
    assert.equal(build(ctx, csv(), [], table).upserts[0].date_completed, null);
  }
});

test('SOC accepts only null or blank invoice values and stores them as null', () => {
  const ctx = context();
  for (const header of ['INVOICEDATE', 'Invoice Date', 'invoice_date', 'invoice-date']) {
    for (const invoice of [null, undefined, '', ' \t ', 'NULL', ' null ', 'NuLl']) {
      const data = csv('', '10', 'DATE_COMPLETED', invoice, header);
      // Passing undefined to csv uses its default; exercise an actual absent cell too.
      data[1][data[0].length - 1] = invoice;
      const result = build(ctx, data);
      assert.equal(result.upserts.length, 1, `${header}: ${String(invoice)}`);
      assert.equal(result.upserts[0].invoicedate, null);
      assert.equal(result.upserts[0].quantityordered, '10');
      assert.equal(Object.hasOwn(result.upserts[0], 'date_completed'), false);
      assert.equal(result.seenIds.size, 1);
      assert.equal(result.totalRows, 1);
    }
  }
});

test('SOC excludes every populated invoice value, regardless of its date format or truthiness', () => {
  const ctx = context();
  for (const invoice of ['2026-09-09', '9/9/2026 12:00 AM', 'not a date', '0', 0, false, true]) {
    const result = build(ctx, csv('', '10', 'DATE_COMPLETED', invoice));
    assert.equal(result.upserts.length, 0, String(invoice));
    assert.equal(result.seenIds.size, 0);
    assert.equal(result.totalRows, 0);
    assert.equal(result.stats.validIdentityRows, 1, 'a valid filtered source identity proves an authoritative empty snapshot');
    assert.equal(invoke(ctx, 'shouldAbortSnapshotDelete_', result.stats, result.totalRows), false);
  }
});

test('mixed SOC snapshot deletes invoiced rows while preserving unchanged uninvoiced rows and their completion', () => {
  const ctx = context();
  const data = csv();
  data.push([...data[1]]);
  data[2][0] = 'SECOND-ITEM';
  const existing = plain(build(ctx, data).upserts).map(row => ({ ...row, date_completed: '2026-09-08T17:05:00Z' }));
  existing[0].invoicedate = '2026-09-09';
  data[1][data[0].length - 1] = '2026-09-09';
  const { result, events } = processSnapshot(ctx, data, existing);
  assert.equal(result.failedFiles, 0);
  assert.equal(result.totalRows, 1);
  assert.equal(result.upsertCount, 0);
  assert.equal(result.deleteCount, 1);
  assert.deepEqual(events.find(event => event.type === 'delete').ids, [existing[0].unique_id]);
  assert.ok(events.some(event => event.type === 'archive'));
});

test('all-invoiced SOC snapshot prunes existing rows through the real guard and delete calculation', () => {
  const ctx = context();
  const existing = plain(build(ctx, csv()).upserts);
  const { result, events } = processSnapshot(ctx, csv('', '10', 'DATE_COMPLETED', '2026-09-09'), existing);
  assert.equal(result.failedFiles, 0);
  assert.equal(result.totalRows, 0);
  assert.equal(result.upsertCount, 0);
  assert.equal(result.deleteCount, 1);
  assert.deepEqual(events.map(event => event.type), ['begin', 'delete', 'finish', 'archive']);
  assert.deepEqual(events.find(event => event.type === 'delete').ids, [existing[0].unique_id]);
});

test('SOC missing or ambiguous invoice headers fail before any write or archival', () => {
  for (const header of [null, 'Invoice Date']) {
    const ctx = context();
    const data = csv();
    if (header === null) data.forEach(row => row.pop());
    else { data[0].push(header); data[1].push(''); }
    assert.throws(() => build(ctx, data), /invoice/i);
    const { result, events } = processSnapshot(ctx, data, [{ unique_id: 'existing-source' }]);
    assert.equal(result.failedFiles, 1);
    assert.equal(result.failedFileErrors[0].errorCode, 'IMPORT_SOURCE_NO_HEADER');
    assert.equal(result.fatalFailure, false, 'a malformed source header is recoverable');
    assert.deepEqual(events, []);
  }
});

test('a spreadsheet with no worksheets is classified as an empty source', () => {
  const ctx = context();
  ctx.console = { log() {}, warn() {}, error() {} };
  ctx.MimeType = { CSV: 'text/csv' };
  ctx.SpreadsheetApp = { openById: () => ({ getSheets: () => [] }) };
  const workbook = {
    getMimeType: () => 'application/vnd.google-apps.spreadsheet',
    getName: () => 'empty-workbook',
    getId: () => 'synthetic-sheet-id',
  };

  assert.throws(
    () => invoke(ctx, 'extractDataFromFile', workbook, 'synthetic-folder'),
    error => error.errorCode === 'IMPORT_SOURCE_EMPTY',
  );
});

test('an older rejected file stays in the drop after a newer valid file imports', () => {
  const properties = new Map();
  const ctx = context(properties);
  const existing = plain(build(ctx, csv()).upserts);
  const badData = csv(); badData[0].pop(); badData[1].pop();
  const rejectedOlder = latestFile('rejected-old-id', 'rejected-old.csv', badData, '2026-09-08T17:00:00.000Z');
  const first = processLatestSnapshotFiles(ctx, [rejectedOlder], existing);
  assert.equal(first.result.failedFileErrors[0].errorCode, 'IMPORT_SOURCE_NO_HEADER');

  const validNewer = latestFile('valid-new-id', 'valid-new.csv', csv('', '12'), '2026-09-09T17:00:00.000Z');
  const next = processLatestSnapshotFiles(ctx, [rejectedOlder, validNewer], existing);
  assert.equal(next.result.filesProcessed, 1);
  assert.equal(next.result.failedFiles, 1);
  assert.equal(next.result.skippedFiles, 1);
  assert.deepEqual(plain(next.result.failedFileNames), ['rejected-old.csv']);
  assert.deepEqual(next.events.filter(event => event.type === 'archive').map(event => event.name), ['valid-new.csv']);
  assert.equal(next.events.find(event => event.type === 'upsert').rows[0].quantityordered, '12');
  assert.ok(next.events.some(event => event.type === 'table-event'), 'successful imports still emit their table event');
});

test('an unchanged rejected newest file is retried without falling back to an older file', () => {
  const properties = new Map();
  const ctx = context(properties);
  const existing = plain(build(ctx, csv()).upserts);
  const badData = csv(); badData[0].pop(); badData[1].pop();
  const rejectedNewest = latestFile('rejected-new-id', 'rejected-new.csv', badData, '2026-09-09T17:00:00.000Z');
  processLatestSnapshotFiles(ctx, [rejectedNewest], existing);

  const olderValid = latestFile('older-valid-id', 'older-valid.csv', csv(), '2026-09-08T17:00:00.000Z');
  const retry = processLatestSnapshotFiles(ctx, [olderValid, rejectedNewest], existing);
  assert.equal(retry.result.filesProcessed, 0);
  assert.equal(retry.result.failedFiles, 1);
  assert.equal(retry.result.skippedFiles, 1);
  assert.deepEqual(plain(retry.result.failedFileNames), ['rejected-new.csv']);
  assert.equal(retry.events.some(event => ['upsert', 'delete', 'archive', 'table-event'].includes(event.type)), false);
});

test('a changed rejected-file revision is retried and can import successfully', () => {
  const properties = new Map();
  const ctx = context(properties);
  const existing = plain(build(ctx, csv()).upserts);
  const badData = csv(); badData[0].pop(); badData[1].pop();
  const rejected = latestFile('same-drive-id', 'replacement.csv', badData, '2026-09-08T17:00:00.000Z');
  processLatestSnapshotFiles(ctx, [rejected], existing);

  const repairedRevision = latestFile('same-drive-id', 'replacement.csv', csv('', '13'), '2026-09-09T17:00:00.000Z');
  const retried = processLatestSnapshotFiles(ctx, [repairedRevision], existing);
  assert.equal(retried.result.failedFiles, 0);
  assert.equal(retried.result.filesProcessed, 1);
  assert.equal(retried.result.upsertCount, 1);
  assert.equal(retried.events.find(event => event.type === 'upsert').rows[0].quantityordered, '13');
  const markerStore = JSON.parse(properties.get('IMPORT_SOURCE_REJECTION_MARKERS_V1'));
  assert.equal(Object.hasOwn(markerStore, 'ph_soc_master|same-drive-id'), false, 'the previous timestamp marker is pruned');
});

test('the rejected-source marker limit fails closed when all retained markers are still pending', () => {
  const properties = new Map();
  const markers = {};
  const olderFiles = [];
  const markerBaseTime = Date.parse('2026-09-01T12:00:00.000Z');
  for (let index = 0; index < 48; index += 1) {
    const id = `retained-${index}`;
    const modifiedAt = markerBaseTime + index * 60_000;
    markers[`ph_soc_master|${id}`] = { modifiedAt, errorCode: 'IMPORT_SOURCE_NO_HEADER' };
    olderFiles.push(latestFile(id, `${id}.csv`, csv(), new Date(modifiedAt).toISOString()));
  }
  properties.set('IMPORT_SOURCE_REJECTION_MARKERS_V1', JSON.stringify(markers));
  const ctx = context(properties);
  const badData = csv(); badData[0].pop(); badData[1].pop();
  const rejectedNewest = latestFile('new-rejected', 'new-rejected.csv', badData, '2026-10-01T12:00:00.000Z');

  const result = processLatestSnapshotFiles(ctx, [...olderFiles, rejectedNewest]);
  assert.equal(result.result.fatalFailure, true);
  assert.equal(result.result.errorCode, 'IMPORT_SOURCE_REJECTION_TRACKER_FAILED');
  assert.equal(result.result.failedFileErrors[0].errorCode, 'IMPORT_SOURCE_REJECTION_TRACKER_FAILED');
  assert.equal(result.events.some(event => ['upsert', 'delete', 'archive', 'table-event'].includes(event.type)), false);
  assert.equal(Object.keys(JSON.parse(properties.get('IMPORT_SOURCE_REJECTION_MARKERS_V1'))).length, 48);
});

test('rejection marker storage fails closed instead of importing after persistence failure', () => {
  const properties = new Map();
  const originalSet = properties.set.bind(properties);
  properties.set = (key, value) => {
    if (key === 'IMPORT_SOURCE_REJECTION_MARKERS_V1') throw new Error('script property quota exceeded');
    return originalSet(key, value);
  };
  const ctx = context(properties);
  const badData = csv(); badData[0].pop(); badData[1].pop();
  const rejected = latestFile('storage-failure-id', 'bad.csv', badData, '2026-09-08T17:00:00.000Z');
  const result = processLatestSnapshotFiles(ctx, [rejected]);

  assert.equal(result.result.fatalFailure, true);
  assert.equal(result.result.errorCode, 'IMPORT_SOURCE_REJECTION_TRACKER_FAILED');
  assert.equal(result.result.failedFileErrors[0].errorCode, 'IMPORT_SOURCE_REJECTION_TRACKER_FAILED');
  assert.equal(result.events.some(event => ['upsert', 'delete', 'archive', 'table-event'].includes(event.type)), false);
});

test('invoiced rows without valid SOC identities still trigger the destructive-sync guard', () => {
  for (const invalidColumn of [0, 1, 2]) {
    const ctx = context();
    const data = csv('', '10', 'DATE_COMPLETED', '2026-09-09');
    data[1][invalidColumn] = '';
    const built = build(ctx, data);
    assert.equal(built.stats.validIdentityRows, 0);
    assert.equal(invoke(ctx, 'shouldAbortSnapshotDelete_', built.stats, built.totalRows), true);
    const { result, events } = processSnapshot(ctx, data, [{ unique_id: 'existing-source' }]);
    assert.equal(result.failedFiles, 1);
    assert.deepEqual(events, []);
  }
});

test('empty and header-only SOC and Reserves snapshots never delete existing data or archive the input', () => {
  const ctx = context();
  const existing = plain(build(ctx, csv()).upserts);
  const headerOnly = [csv()[0]];

  for (const tableName of ['ph_soc_master', 'ph_reserves']) {
    for (const [label, data] of [['empty', []], ['header-only', headerOnly]]) {
      const { result, events } = processSnapshot(ctx, data, existing, '2026-09-08T17:00:00.000Z', tableName);
      assert.equal(events.some(event => event.type === 'delete'), false, `${tableName} ${label} source must not delete existing rows`);
      assert.equal(events.some(event => event.type === 'upsert'), false, `${tableName} ${label} source must not upsert rows`);
      assert.equal(events.some(event => event.type === 'archive'), false, `${tableName} ${label} source must remain pending`);
      assert.equal(result.failedFiles, 1, `${tableName} ${label} source must be retained for review/retry`);
      assert.equal(result.deleteCount, 0, `${tableName} ${label} source must not produce destructive deletes`);
      assert.equal(result.upsertCount, 0, `${tableName} ${label} source must not produce writes`);
    }
  }
});

test('master batch skips empty files but imports and archives a valid replacement snapshot', () => {
  const validData = csv();
  validData[0].push('COMMONNAME');
  validData[1].push('Synthetic Plant');
  const files = [
    { data: [], getName: () => 'empty.csv', getLastUpdated: () => new Date('2026-09-08T17:00:00Z') },
    { data: validData, getName: () => 'replacement.csv', getLastUpdated: () => new Date('2026-09-09T17:00:00Z') },
  ];
  const { result, events } = processMasterSnapshotBatch(context(), files);

  assert.equal(result.filesProcessed, 1, JSON.stringify({ result, events }));
  assert.equal(result.failedFiles, 1);
  assert.deepEqual(plain(result.failedFileNames), ['empty.csv']);
  assert.equal(result.upsertCount, 1);
  assert.equal(events.find(event => event.type === 'upsert').rows[0].itemcode, 'SYNTHETIC-ITEM');
  assert.deepEqual(events.filter(event => event.type === 'archive').map(event => event.name), ['replacement.csv']);
  assert.equal(events.some(event => event.type === 'table-event'), true, 'the committed valid replacement emits the ordinary table event');
});

test('a nonempty unrecognized master file prevents applying a partial snapshot', () => {
  const invalidNonempty = [['Unrecognized column'], ['not-a-master-row']];
  const validData = csv();
  validData[0].push('COMMONNAME');
  validData[1].push('Synthetic Plant');
  const files = [
    { data: validData, getName: () => 'valid.csv', getLastUpdated: () => new Date('2026-09-08T17:00:00Z') },
    { data: invalidNonempty, getName: () => 'unrecognized.csv', getLastUpdated: () => new Date('2026-09-09T17:00:00Z') },
  ];
  const { result, events } = processMasterSnapshotBatch(context(), files);

  assert.equal(result.filesProcessed, 0);
  assert.equal(result.failedFiles, 1);
  assert.equal(result.skippedFiles, 1);
  assert.deepEqual(plain(result.failedFileNames), ['unrecognized.csv']);
  assert.equal(result.upsertCount, 0);
  assert.equal(result.deleteCount, 0);
  assert.equal(events.some(event => ['upsert', 'delete', 'archive', 'table-event'].includes(event.type)), false);
});

test('a retained failed source is re-read and imported after a valid replacement revision arrives', () => {
  const baselineContext = context();
  const existing = plain(build(baselineContext, csv()).upserts);
  const invalid = csv();
  invalid[0].pop();
  const firstAttempt = processSnapshot(context(), invalid, existing, '2026-09-08T17:00:00.000Z');
  assert.equal(firstAttempt.result.failedFiles, 1);
  assert.equal(firstAttempt.result.failedFileNames[0], 'synthetic.csv');
  assert.equal(firstAttempt.events.some(event => ['upsert', 'delete', 'archive'].includes(event.type)), false);

  const replacement = csv('', '12');
  const secondAttempt = processSnapshot(context(), replacement, existing, '2026-09-09T17:00:00.000Z');
  assert.equal(secondAttempt.result.failedFiles, 0);
  assert.equal(secondAttempt.result.filesProcessed, 1);
  assert.equal(secondAttempt.result.upsertCount, 1);
  assert.equal(secondAttempt.events.find(event => event.type === 'upsert').rows[0].quantityordered, '12');
  assert.ok(secondAttempt.events.some(event => event.type === 'archive'));
});

test('invoice filtering preserves duplicate SOC identity suffixes and existing completion in either order', () => {
  for (const filteredIndex of [1, 2]) {
    const ctx = context();
    const data = csv();
    data.push([...data[1]]);
    data[2][11] = '12';
    const existing = plain(build(ctx, data).upserts).map((row, index) => ({ ...row, date_completed: `2026-09-08T17:0${index}:00Z` }));
    assert.equal(existing[1].unique_id, `${existing[0].unique_id}-1`);
    data[filteredIndex][data[0].length - 1] = '2026-09-09';
    const result = build(ctx, data, existing);
    assert.equal(result.upserts.length, 0, 'the retained duplicate still matches its own quantity and ID');
    assert.equal(result.stats.unchangedRows, 1);
    assert.deepEqual(Array.from(result.seenIds), [existing[2 - filteredIndex].unique_id]);
    assert.deepEqual(plain(invoke(ctx, 'combineSnapshotDeleteIds_', existing, result.seenIds)), [existing[filteredIndex - 1].unique_id]);
  }
});

test('invoice filtering and required header apply to every SOC site variant only', () => {
  const ctx = context();
  for (const table of ['ph_soc_master', 'tx_soc_master', 'nc_soc_master', 'hl_soc_master']) {
    assert.equal(build(ctx, csv('', '10', 'DATE_COMPLETED', '2026-09-09'), [], table).upserts.length, 0);
    const missingHeader = csv().map(row => row.slice(0, -1));
    assert.throws(() => build(ctx, missingHeader, [], table), /invoice/i);
  }
  for (const table of ['ph_master_inventory', 'ph_reserves', 'ph_active_request']) {
    const result = build(ctx, csv('2026-09-01', '12', 'DATE_COMPLETED', '2026-09-09'), [], table);
    assert.equal(result.upserts.length, 1);
    assert.equal(result.upserts[0].invoicedate, '2026-09-09');
    assert.equal(result.upserts[0].date_completed, '2026-09-01');
    assert.equal(result.upserts[0].quantityordered, '12');
    assert.equal(build(ctx, csv().map(row => row.slice(0, -1)), [], table).upserts.length, 1);
  }
});

test('alternate invoice headers compare the stored invoice value before restoring an uninvoiced row', () => {
  for (const header of ['Invoice Date', 'invoice_date', 'invoice-date']) {
    const ctx = context();
    const existing = plain(build(ctx, csv()).upserts);
    existing[0].invoicedate = '2026-09-09';
    existing[0].date_completed = '2026-09-10T17:00:00Z';
    const { result, events } = processSnapshot(ctx, csv('', '10', 'DATE_COMPLETED', '', header), existing);
    assert.equal(result.failedFiles, 0);
    assert.equal(result.deleteCount, 0);
    assert.equal(result.upsertCount, 1, header);
    const [updated] = events.find(event => event.type === 'upsert').rows;
    assert.equal(updated.invoicedate, null);
    assert.equal(updated.unique_id, existing[0].unique_id);
    assert.equal(Object.hasOwn(updated, 'date_completed'), false);
  }
});
