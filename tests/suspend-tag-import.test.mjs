import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function context() {
  const result = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
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

function processSnapshot(ctx, data, existing = []) {
  const events = [];
  let read = false;
  ctx.console = { log() {}, warn() {}, error() {} };
  ctx.getDriveFolderByIdWithRetry_ = () => ({});
  ctx.listDriveFilesWithRetry_ = () => ({
    hasNext: () => !read,
    next: () => { read = true; return { getName: () => 'synthetic.csv', getLastUpdated: () => new Date(0) }; },
  });
  ctx.extractDataFromFile = () => data;
  ctx.fetchAllSupabaseData = () => existing;
  ctx.beginDatasetImportFenceIfNeeded_ = () => { events.push({ type: 'begin' }); return null; };
  ctx.closeDatasetImportFence_ = () => events.push({ type: 'finish' });
  ctx.failDatasetImportFence_ = () => {};
  ctx.pushToSupabase = (_, rows) => events.push({ type: 'upsert', rows: plain(rows) });
  ctx.deleteFromSupabase = (_, ids) => events.push({ type: 'delete', ids: plain(ids) });
  ctx.moveDriveFileToFolderWithRetry_ = () => events.push({ type: 'archive' });
  ctx.emitTableSyncLiveEvent_ = () => {};
  const result = invoke(ctx, 'processLatestFileOnlyFolderLocked_', 'source', 'processed', 'ph_soc_master', ctx.buildStandardPayload, { deltaMode: true });
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
    assert.deepEqual(events, []);
  }
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
