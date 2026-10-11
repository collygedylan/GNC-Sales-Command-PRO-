import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const customerRepMapSourceHeaders = JSON.parse(readFileSync(new URL('./fixtures/customer-rep-map-headers.json', import.meta.url), 'utf8'));
function context() {
  const properties = new Map();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.has(String(key)) ? properties.get(String(key)) : null,
      setProperty: (key, value) => properties.set(String(key), String(value)),
      deleteProperty: key => properties.delete(String(key))
    }) },
    LockService: { getScriptLock: () => ({ hasLock: () => false, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      getUuid: () => '10000000-0000-4000-8000-000000000001',
      sleep() {}, parseCsv: text => text.split(/\r?\n/).map(line => line.split(','))
    },
    MimeType: { CSV: 'text/csv', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) }
  });
  new vm.Script(source, { filename: 'Code.gs' }).runInContext(ctx);
  return ctx;
}
const plain = value => JSON.parse(JSON.stringify(value));
const headers = [
  'CUSTOMERIDENTITYID', 'CUSTOMERNAME', 'CONSIGNEEID', 'CONSIGNEENAME', 'SALESREPID', 'SALESREPNAME',
  'CUSTOMERSTATUS', 'CONSIGNEESTATUS', 'TAX_EXEMPT_#', 'CADisc%', 'NEWER_SOURCE_FIELD'
];
const row = (customerId, consigneeId, repId = '', extras = []) => [
  customerId, 'Café 植物', consigneeId, 'Consignee™', repId, repId ? `Rep ${repId}` : '',
  'Inactive', 'Active', '0000123', '00.50', '原文 retained', ...extras
];
const invoke = (ctx, name, ...args) => { ctx.__args = args; return vm.runInContext(`${name}(...__args)`, ctx); };

test('customer map snapshot preserves raw display strings, newer fields, blank reps, and inactive rows', () => {
  const ctx = context();
  const snapshot = invoke(ctx, 'buildCustomerRepMapSnapshot_', [headers, row('00001', '00009'), row('00002', '00010', 'R007')], '2026-10-09T12:00:00Z', 'Cons List261009.xlsx');
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[0].customeridentityid, '00001');
  assert.equal(snapshot.rows[0].consigneeid, '00009');
  assert.equal(snapshot.rows[0].salesrepid, null);
  assert.equal(snapshot.rows[0].customerstatus, 'Inactive', 'inactive records are part of the mapping snapshot');
  assert.equal(snapshot.rows[0].raw_data['TAX_EXEMPT_#'], '0000123');
  assert.equal(snapshot.rows[0].raw_data['CADisc%'], '00.50');
  assert.equal(snapshot.rows[0].raw_data.NEWER_SOURCE_FIELD, '原文 retained');
  assert.equal(snapshot.rows[0].raw_data.CUSTOMERNAME, 'Café 植物');
  assert.equal(snapshot.rows[0].raw_data.CONSIGNEENAME, 'Consignee™');
});

test('customer map preserves every column in the approved 121-column source fixture', () => {
  const ctx = context();
  const values = customerRepMapSourceHeaders.map((_, index) => `source-${index + 1}`);
  const set = (key, value) => { values[customerRepMapSourceHeaders.indexOf(key)] = value; };
  set('CUSTOMERIDENTITYID', '00001234');
  set('CUSTOMERNAME', 'Café 植物');
  set('CUSTOMERSTATUS', 'A');
  set('CONSIGNEEID', '00005678');
  set('CONSIGNEENAME', 'Consignee™');
  set('CONSIGNEESTATUS', 'A');
  set('SALESREPID', '0009');
  set('SALESREPNAME', 'Rep Élodie');
  set('TAX_EXEMPT_#', '0000123');
  const snapshot = invoke(ctx, 'buildCustomerRepMapSnapshot_', [customerRepMapSourceHeaders, values], '2026-10-09T10:00:00.000Z', 'Cons List261009.xlsx');
  assert.equal(snapshot.headerCount, 121);
  assert.equal(snapshot.rows.length, 1);
  assert.deepEqual(Object.keys(plain(snapshot.rows[0].raw_data)), customerRepMapSourceHeaders);
  assert.equal(snapshot.rows[0].raw_data.CUSTOMERIDENTITYID, '00001234');
  assert.equal(snapshot.rows[0].raw_data.CONSIGNEEID, '00005678');
  assert.equal(snapshot.rows[0].raw_data['TAX_EXEMPT_#'], '0000123');
  assert.equal(snapshot.rows[0].raw_data.CUSTOMERNAME, 'Café 植物');
  assert.equal(snapshot.rows[0].raw_data.CONSIGNEENAME, 'Consignee™');
});

test('customer map rejects duplicate normalized columns, duplicate identities, and missing identity IDs before writes', () => {
  const ctx = context();
  const duplicatedHeader = [...headers, 'CUSTOMERNAME'];
  assert.throws(() => invoke(ctx, 'buildCustomerRepMapSnapshot_', [duplicatedHeader, row('00001', '00009')], 'now', 'bad.xlsx'), error => error.errorCode === 'IMPORT_SOURCE_DUPLICATE_IDENTITIES');
  assert.throws(() => invoke(ctx, 'buildCustomerRepMapSnapshot_', [headers, row('00001', '00009', 'R2'), row('00001', '00009', 'R2')], 'now', 'bad.xlsx'), error => error.errorCode === 'IMPORT_SOURCE_DUPLICATE_IDENTITIES');
  assert.throws(() => invoke(ctx, 'buildCustomerRepMapSnapshot_', [headers, row('', '00009')], 'now', 'bad.xlsx'), error => error.errorCode === 'IMPORT_SOURCE_NO_VALID_IDENTITIES');
});

test('customer map requires complete identity and status headers and a nonempty snapshot', () => {
  const ctx = context();
  assert.throws(() => invoke(ctx, 'buildCustomerRepMapSnapshot_', [headers.filter(header => header !== 'CONSIGNEESTATUS'), row('1', '2')], 'now', 'bad.xlsx'), error => error.errorCode === 'IMPORT_SOURCE_NO_HEADER');
  assert.throws(() => invoke(ctx, 'buildCustomerRepMapSnapshot_', [headers], 'now', 'empty.xlsx'), error => error.errorCode === 'IMPORT_SOURCE_EMPTY');
  assert.equal(invoke(ctx, 'isCustomerRepMapCompleteHeaderRow_', headers), true);
  assert.equal(invoke(ctx, 'isCustomerRepMapCompleteHeaderRow_', ['CUSTOMERNAME', 'CONSIGNEENAME', 'SALESREPNAME']), false);
});

test('customer map spreadsheet extraction finds the second-row header and reads formatted display text', () => {
  const ctx = context();
  let displayRead = false;
  ctx.SpreadsheetApp = { openById: () => ({ getSheets: () => [{ getDataRange: () => ({
    getValues: () => { throw new Error('raw numeric values must not be used for this source'); },
    getDisplayValues: () => { displayRead = true; return [['Customer Consignee Report'], headers, row('00001', '00009')]; }
  }) }] }) };
  const file = { getMimeType: () => 'application/vnd.google-apps.spreadsheet', getName: () => 'Cons List261009.gsheet', getId: () => 'sheet-id' };
  const extracted = invoke(ctx, 'extractDataFromFile', file, 'folder', { headerMatcher: ctx.isCustomerRepMapCompleteHeaderRow_, displayValues: true, preserveHeaderRowIndex: true });
  assert.equal(displayRead, true);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0][0], 'CUSTOMERIDENTITYID');
  assert.equal(extracted[1][0], '00001');
  const snapshot = invoke(ctx, 'buildCustomerRepMapSnapshot_', extracted, 'now', 'Cons List261009.gsheet');
  assert.equal(snapshot.rows[0].source_row_number, 3, 'row numbers retain the original report preamble offset');
});

function installImportFixture(ctx, { files, dataById, rpcResults = {}, initialStagedRows = 0 }) {
  const events = [];
  let stagedRows = Math.max(0, Number(initialStagedRows) || 0);
  const toDriveEntry = file => ({
    getName: () => file.name,
    getId: () => file.id,
    getLastUpdated: () => new Date(file.modifiedAt),
    getMimeType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const entries = files.map(toDriveEntry);
  let cursor = 0;
  ctx.getDriveFolderByIdWithRetry_ = id => { events.push({ type: 'folder', id }); return { id }; };
  ctx.listDriveFilesWithRetry_ = (_folder, label) => {
    events.push({ type: 'list-folder', label });
    cursor = 0;
    return { hasNext: () => cursor < entries.length, next: () => entries[cursor++] };
  };
  ctx.extractDataFromFile = (file, _folder, options) => {
    assert.equal(options.displayValues, true);
    assert.equal(options.headerMatcher(headers), true);
    return dataById[file.getId()];
  };
  ctx.beginDatasetImportFenceIfNeeded_ = table => { events.push({ type: 'fence-begin', table }); return { runId: 'fence' }; };
  ctx.closeDatasetImportFence_ = (_fence, success) => events.push({ type: 'fence-close', success });
  ctx.failDatasetImportFence_ = fence => { if (fence) events.push({ type: 'fence-fail' }); };
  ctx.heartbeatDatasetImportFence_ = () => {};
  ctx.callSupabaseRpc_ = (name, payload) => {
    events.push({ type: 'rpc', name, payload: plain(payload) });
    if (rpcResults[name]) return rpcResults[name](payload, events);
    if (name === 'begin_customer_rep_mapping_import_v1') return { ok: true, runId: payload.p_run_id, status: 'active', rowCount: stagedRows, stagedRows };
    if (name === 'stage_customer_rep_mapping_rows_v1') { stagedRows += payload.p_rows.length; return { ok: true, runId: payload.p_run_id, stagedRows }; }
    if (name === 'finalize_customer_rep_mapping_import_v1') return { ok: true, runId: payload.p_run_id || '10000000-0000-4000-8000-000000000001', rowCount: stagedRows, revision: '19' };
    throw new Error(`Unexpected RPC ${name}`);
  };
  ctx.moveDriveFileToFolderWithRetry_ = file => events.push({ type: 'archive', id: file.getId() });
  ctx.trashDriveFileWithRetry_ = file => events.push({ type: 'trash', id: file.getId() });
  ctx.emitTableSyncLiveEvent_ = (table, details) => events.push({ type: 'live-event', table, details: plain(details) });
  events.addFile = file => entries.push(toDriveEntry(file));
  return events;
}

test('customer map stages complete rows, publishes atomically, and archives only the published source', () => {
  const ctx = context();
  const files = [
    { id: 'new-file', name: 'Cons List261009.xlsx', modifiedAt: '2026-10-09T10:00:00Z' },
    { id: 'old-file', name: 'Cons List261008.xlsx', modifiedAt: '2026-10-08T10:00:00Z' }
  ];
  const events = installImportFixture(ctx, { files, dataById: { 'new-file': [headers, row('00001', '00009'), row('00002', '00010', 'R7')] } });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, true);
  assert.equal(result.totalRows, 2);
  assert.equal(result.skippedFiles, 1, 'the older source stays pending and is reported rather than archived');
  assert.deepEqual(plain(result.skippedFileNames), ['Cons List261008.xlsx']);
  const names = events.filter(event => event.type === 'rpc').map(event => event.name);
  assert.deepEqual(names, ['begin_customer_rep_mapping_import_v1', 'stage_customer_rep_mapping_rows_v1', 'finalize_customer_rep_mapping_import_v1']);
  const staged = events.find(event => event.type === 'rpc' && event.name === 'stage_customer_rep_mapping_rows_v1');
  assert.equal(staged.payload.p_rows.length, 2);
  assert.equal(staged.payload.p_rows[0].raw_data.NEWER_SOURCE_FIELD, '原文 retained');
  assert.equal(staged.payload.p_rows[0].row.customeridentityid, '00001');
  assert.equal(staged.payload.p_rows[0].row.imported_at, '2026-10-09T10:00:00.000Z');
  assert.equal(staged.payload.p_rows[0].row.updated_at, '2026-10-09T10:00:00.000Z');
  const begin = events.find(event => event.type === 'rpc' && event.name === 'begin_customer_rep_mapping_import_v1');
  assert.equal(begin.payload.p_source_file_id, 'new-file');
  assert.equal(begin.payload.p_source_modified_at, '2026-10-09T10:00:00.000Z');
  assert.equal(begin.payload.p_expected_rows, 2);
  assert.match(begin.payload.p_source_hash, /^[0-9a-f]{64}$/);
  assert.ok(events.findIndex(event => event.type === 'rpc' && event.name === 'finalize_customer_rep_mapping_import_v1') < events.findIndex(event => event.type === 'archive' && event.id === 'new-file'));
  assert.deepEqual(events.filter(event => event.type === 'archive').map(event => event.id), ['new-file']);
  assert.equal(events.filter(event => event.type === 'live-event').length, 1);
  assert.equal(events.filter(event => event.type.startsWith('fence')).length, 0, 'SQL finalization owns the atomic revision fence');
  assert.deepEqual(events.filter(event => event.type === 'folder').map(event => event.id), [
    '1lXgfgChixjodh_zDvofmMnXUBPiO4epV', '1S4OTJVC8rpVNfuuEv2A0lHq-xFdjydBI', '13zlcdCp_nc_j2GGKxkB5Nrko4G-MWaYl'
  ]);
  assert.equal(events.filter(event => event.type === 'trash').length, 0, 'importer never trashes files by a TEMP_ name');
});

test('customer map stage chunks report cumulative counts and keep the full source payload', () => {
  const ctx = context();
  const file = { id: 'large-source', name: 'Cons large.xlsx', modifiedAt: '2026-10-09T10:00:00Z' };
  const rows = Array.from({ length: 301 }, (_, index) => row(String(index + 1).padStart(5, '0'), String(index + 800).padStart(5, '0'), `R${index}`));
  const events = installImportFixture(ctx, { files: [file], dataById: { 'large-source': [headers, ...rows] } });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, true);
  const stages = events.filter(event => event.type === 'rpc' && event.name === 'stage_customer_rep_mapping_rows_v1');
  assert.deepEqual(stages.map(event => event.payload.p_rows.length), [300, 1]);
  assert.equal(stages[0].payload.p_rows[0].raw_data['CUSTOMERIDENTITYID'], '00001');
  assert.equal(stages[1].payload.p_rows[0].raw_data.NEWER_SOURCE_FIELD, '原文 retained');
});

test('customer map resumes the exact source using the active run returned by begin', () => {
  const ctx = context();
  const file = { id: 'resumable-source', name: 'Cons resume.xlsx', modifiedAt: '2026-10-09T10:00:00Z' };
  const activeRunId = '20000000-0000-4000-8000-000000000002';
  const events = installImportFixture(ctx, {
    files: [file], dataById: { 'resumable-source': [headers, row('00031', '00042', 'R9')] },
    rpcResults: {
      begin_customer_rep_mapping_import_v1: payload => ({ ok: true, runId: activeRunId, status: 'active', rowCount: 0, stagedRows: 0 }),
      finalize_customer_rep_mapping_import_v1: payload => ({ ok: true, runId: payload.p_run_id, rowCount: 1, revision: '20' })
    }
  });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, true);
  const requested = events.find(event => event.type === 'rpc' && event.name === 'begin_customer_rep_mapping_import_v1').payload.p_run_id;
  const staged = events.find(event => event.type === 'rpc' && event.name === 'stage_customer_rep_mapping_rows_v1').payload.p_run_id;
  const finalized = events.find(event => event.type === 'rpc' && event.name === 'finalize_customer_rep_mapping_import_v1').payload.p_run_id;
  assert.notEqual(requested, activeRunId);
  assert.equal(staged, activeRunId);
  assert.equal(finalized, activeRunId);
});

test('customer map resumes after the server-confirmed staged prefix without replaying prior rows', () => {
  const ctx = context();
  const file = { id: 'prefix-source', name: 'Cons prefix.xlsx', modifiedAt: '2026-10-09T10:00:00Z' };
  const rows = Array.from({ length: 301 }, (_, index) => row(String(index + 1).padStart(5, '0'), String(index + 501).padStart(5, '0'), `R${index}`));
  const events = installImportFixture(ctx, {
    files: [file], dataById: { 'prefix-source': [headers, ...rows] }, initialStagedRows: 300,
    rpcResults: {
      begin_customer_rep_mapping_import_v1: payload => ({ ok: true, runId: '30000000-0000-4000-8000-000000000003', status: 'active', rowCount: 300, stagedRows: 300 }),
      finalize_customer_rep_mapping_import_v1: payload => ({ ok: true, runId: payload.p_run_id, rowCount: 301, revision: '21' })
    }
  });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, true);
  const stage = events.find(event => event.type === 'rpc' && event.name === 'stage_customer_rep_mapping_rows_v1');
  assert.equal(stage.payload.p_rows.length, 1);
  assert.equal(stage.payload.p_rows[0].source_row_number, 302);
  assert.equal(stage.payload.p_rows[0].row.customeridentityid, '00301');
  assert.equal(stage.payload.p_rows[0].row.imported_at, '2026-10-09T10:00:00.000Z');
});

test('customer map pins an active source across triggers even when a newer file arrives', () => {
  const ctx = context();
  ctx.__clock = Date.now();
  vm.runInContext('Date.now = () => __clock', ctx);
  const oldFile = { id: 'active-old-source', name: 'Cons active.xlsx', modifiedAt: '2026-10-09T10:00:00Z' };
  const newFile = { id: 'newer-source', name: 'Cons newer.xlsx', modifiedAt: '2026-10-09T11:00:00Z' };
  const oldRows = Array.from({ length: 301 }, (_, index) => row(String(index + 1).padStart(5, '0'), String(index + 501).padStart(5, '0'), `R${index}`));
  const events = installImportFixture(ctx, {
    files: [oldFile], dataById: { 'active-old-source': [headers, ...oldRows], 'newer-source': [headers, row('90001', '90002', 'Rnew')] }
  });
  const originalRpc = ctx.callSupabaseRpc_;
  let advanced = false;
  ctx.callSupabaseRpc_ = (name, payload) => {
    const result = originalRpc(name, payload);
    if (name === 'stage_customer_rep_mapping_rows_v1' && !advanced) {
      advanced = true;
      ctx.__clock += 181000;
    }
    return result;
  };
  const first = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(first.continuationPending, true);
  assert.equal(first.stagedRows, 300);
  events.addFile(newFile);

  const second = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(second.published, true);
  const begins = events.filter(event => event.type === 'rpc' && event.name === 'begin_customer_rep_mapping_import_v1');
  assert.deepEqual(begins.map(event => event.payload.p_source_file_id), ['active-old-source', 'active-old-source']);
  const stageCalls = events.filter(event => event.type === 'rpc' && event.name === 'stage_customer_rep_mapping_rows_v1');
  assert.deepEqual(stageCalls.map(event => event.payload.p_rows.length), [300, 1]);
  assert.deepEqual(events.filter(event => event.type === 'archive').map(event => event.id), ['active-old-source']);
  assert.equal(events.some(event => event.type === 'archive' && event.id === 'newer-source'), false);
});

test('customer map staging stops at the invocation budget and resumes one ordered prefix at a time', () => {
  const ctx = context();
  const rows = Array.from({ length: 601 }, (_, index) => ({
    unique_id: `uid-${index + 1}`, source_row_number: index + 2,
    customeridentityid: String(index + 1), raw_data: { CUSTOMERIDENTITYID: String(index + 1) }, imported_at: 'source-time'
  }));
  const stageCalls = [];
  let cumulative = 0;
  ctx.callSupabaseRpc_ = (name, payload) => {
    assert.equal(name, 'stage_customer_rep_mapping_rows_v1');
    stageCalls.push(payload.p_rows);
    cumulative += payload.p_rows.length;
    return { ok: true, runId: payload.p_run_id, stagedRows: cumulative };
  };
  const oldStart = Date.now() - 2000;
  const first = invoke(ctx, 'stageCustomerRepMapRows_', 'resume-run', rows, 0, oldStart, 1000);
  assert.deepEqual(plain(first), { stagedRows: 300, complete: false });
  const second = invoke(ctx, 'stageCustomerRepMapRows_', 'resume-run', rows, first.stagedRows, oldStart, 1000);
  assert.deepEqual(plain(second), { stagedRows: 600, complete: false });
  const third = invoke(ctx, 'stageCustomerRepMapRows_', 'resume-run', rows, second.stagedRows, oldStart, 1000);
  assert.deepEqual(plain(third), { stagedRows: 601, complete: true });
  assert.deepEqual(stageCalls.map(chunk => chunk.length), [300, 300, 1]);
  assert.equal(stageCalls[1][0].unique_id, 'uid-301');
  assert.equal(stageCalls[2][0].unique_id, 'uid-601');
});

test('customer map does not stage, publish, fence, or archive a malformed source', () => {
  const ctx = context();
  const file = { id: 'bad-file', name: 'bad.xlsx', modifiedAt: '2026-10-09T10:00:00Z' };
  const events = installImportFixture(ctx, { files: [file], dataById: { 'bad-file': [headers, row('1', '2', 'R2'), row('1', '2', 'R2')] } });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, false);
  assert.equal(result.failedFiles, 1);
  assert.equal(result.failedFileErrors[0].errorCode, 'IMPORT_SOURCE_DUPLICATE_IDENTITIES');
  assert.equal(events.filter(event => event.type === 'rpc').length, 0);
  assert.equal(events.filter(event => event.type.startsWith('fence')).length, 0);
  assert.equal(events.filter(event => event.type === 'archive').length, 0);
});

test('customer map leaves source pending when finalize is unconfirmed and does not archive it', () => {
  const ctx = context();
  const file = { id: 'source-file', name: 'Cons.xlsx', modifiedAt: '2026-10-09T10:00:00Z' };
  const events = installImportFixture(ctx, {
    files: [file], dataById: { 'source-file': [headers, row('1', '2'), row('3', '4', 'R4')] },
    rpcResults: { finalize_customer_rep_mapping_import_v1: () => ({ ok: false, errorCode: 'FINALIZE_FAILED' }) }
  });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, false);
  assert.equal(result.failedFiles, 1);
  assert.equal(events.filter(event => event.type === 'archive').length, 0);
  assert.equal(events.filter(event => event.type.startsWith('fence')).length, 0);
});

test('customer map accepts an already-published response only with the expected row count and revision', () => {
  const ctx = context();
  const source = { runId: 'run-1', fileId: 'sheet-1', modifiedAt: '2026-10-09T10:00:00Z', sourceHash: 'hash-a', rowCount: 2 };
  assert.equal(invoke(ctx, 'isCustomerRepMapAlreadyPublished_', { ok: true, alreadyPublished: true, runId: 'run-1', rowCount: 2, revision: '19' }, source), true);
  assert.equal(invoke(ctx, 'isCustomerRepMapAlreadyPublished_', { ok: true, alreadyPublished: true, runId: 'original-run-id', rowCount: 2, revision: '19' }, source), true,
    'the RPC proves the same source file, timestamp, and hash; it returns the original published run id');
  assert.equal(invoke(ctx, 'isCustomerRepMapAlreadyPublished_', { ok: true, alreadyPublished: true, runId: 'run-1', rowCount: 3, revision: '19' }, source), false);
  assert.equal(invoke(ctx, 'isCustomerRepMapAlreadyPublished_', { ok: true, alreadyPublished: true, runId: 'run-1', rowCount: 2, revision: '0' }, source), false);
});

test('customer map stale older source is reported and left pending without blocking later sync stages', () => {
  const ctx = context();
  const file = { id: 'older-file', name: 'Cons older.xlsx', modifiedAt: '2026-10-08T10:00:00Z' };
  installImportFixture(ctx, {
    files: [file], dataById: { 'older-file': [headers, row('1', '2', 'R2')] },
    rpcResults: { begin_customer_rep_mapping_import_v1: () => ({ ok: false, errorCode: 'CUSTOMER_REP_IMPORT_STALE_SOURCE' }) }
  });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, false);
  assert.equal(result.failedFiles, 0);
  assert.equal(result.skippedFiles, 1);
  assert.deepEqual(plain(result.skippedFileErrors), [{ name: 'Cons older.xlsx', errorCode: 'CUSTOMER_REP_IMPORT_STALE_SOURCE' }]);
  assert.equal(result.failedFileNames.length, 0);
});

test('customer map keeps a rejected newest source pending and never falls back to an older snapshot', () => {
  const ctx = context();
  const newest = { id: 'rejected-newest', name: 'Cons latest.xlsx', modifiedAt: '2026-10-09T10:00:00Z' };
  const older = { id: 'valid-older', name: 'Cons older.xlsx', modifiedAt: '2026-10-08T10:00:00Z' };
  const markerState = invoke(ctx, 'readImportSourceRejectionMarkers_');
  invoke(ctx, 'recordImportSourceRejection_', markerState, 'ph_customer_consignee_sales_reps', {
    getId: () => newest.id, getLastUpdated: () => new Date(newest.modifiedAt)
  }, 'IMPORT_SOURCE_DUPLICATE_IDENTITIES');
  const events = installImportFixture(ctx, {
    files: [newest, older], dataById: { 'valid-older': [headers, row('00001', '00002', 'R1')] }
  });
  const result = invoke(ctx, 'processCustomerRepMapSnapshot_');
  assert.equal(result.published, false);
  assert.equal(result.skippedFiles, 2);
  assert.deepEqual(plain(result.skippedFileNames), ['Cons latest.xlsx', 'Cons older.xlsx']);
  assert.equal(result.skippedFileErrors[0].errorCode, 'IMPORT_SOURCE_DUPLICATE_IDENTITIES');
  assert.equal(events.filter(event => event.type === 'rpc').length, 0);
  assert.equal(events.filter(event => event.type === 'archive').length, 0);
});
