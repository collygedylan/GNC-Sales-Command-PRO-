import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const workbookId = '1myBn2DzyhYtTj2MmYatf26jz575TjqxSpxC-kFt1Mhw';
const snapshotId = '8dff9a51-bbc8-42f6-9442-f9f79a7246ea';

function createContext({ sheets = [], rpc = () => ({}) } = {}) {
  const properties = new Map([['SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key']]);
  const triggers = [];
  const rpcCalls = [];
  let sourceUpdatedAt = '2026-09-30T12:00:00.000Z';
  let lockAvailable = true;
  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) || '',
        setProperty: (key, value) => { properties.set(key, String(value)); return this; },
        deleteProperty: (key) => properties.delete(key),
        getProperties: () => Object.fromEntries(properties)
      })
    },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      computeHmacSha256Signature: (message, key) => Array.from(crypto.createHmac('sha256', key).update(message).digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    },
    LockService: { getScriptLock: () => ({ tryLock: () => lockAvailable, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (trigger) => { const index = triggers.indexOf(trigger); if (index >= 0) triggers.splice(index, 1); },
      newTrigger: (handlerFunction) => ({
        timeBased: () => ({ everyMinutes: (minutes) => ({ create: () => {
          const trigger = { getHandlerFunction: () => handlerFunction, intervalMinutes: minutes };
          triggers.push(trigger);
          return trigger;
        } }) })
      })
    },
    DriveApp: {
      getFileById: (id) => ({ getLastUpdated: () => new Date(sourceUpdatedAt) })
    },
    SpreadsheetApp: { openById: () => ({ getSheets: () => sheets }) },
    __rpcCalls: rpcCalls,
    __properties: properties,
    __triggers: triggers,
    __rpc: rpc,
    __setSourceUpdatedAt: (value) => { sourceUpdatedAt = value; },
    __setLockAvailable: (value) => { lockAvailable = value; }
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);
  vm.runInContext(`callSupabaseRpc_ = function(name, payload) { __rpcCalls.push({ name, payload }); return __rpc(name, payload); };`, context);
  return context;
}

function signPayload(delivery, timestamp = new Date().toISOString(), secret = 'test-service-role-key') {
  const deliveryJson = JSON.stringify(delivery);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${deliveryJson}`).digest('base64url');
  return { type: 'production_schedule_import_v1', timestamp, signature, deliveryJson };
}

function makeSheet(title, headerRow, headers, body) {
  const values = new Map();
  const firstHeaderRow = title === "New Weighted%'s" ? headerRow - 1 : headerRow;
  if (title === "New Weighted%'s") values.set(firstHeaderRow, ["2027", '2027', '2027']);
  values.set(headerRow, headers);
  body.forEach((row, index) => values.set(headerRow + index + 1, row));
  const lastRow = headerRow + body.length;
  return {
    getName: () => title,
    getLastRow: () => lastRow,
    getLastColumn: () => headers.length,
    getRange: (row, column, numRows, numColumns) => ({
      getDisplayValues: () => Array.from({ length: numRows }, (_, rowIndex) => {
        const source = values.get(row + rowIndex) || [];
        return Array.from({ length: numColumns }, (_, columnIndex) => source[column + columnIndex - 1] ?? '');
      })
    })
  };
}

const sevenSheets = [
  makeSheet('PROD SCHED', 8, ['Item', 'Action', 'Action', 'Metric'], [['007', 'Review', '0', ''], ['', '', '', ''], ['008', '', '', '3']]),
  makeSheet('PltDate-PltGrp', 1, ['Plant Group', 'Target Date'], [['A', '2027-04-01']]),
  makeSheet('ContTable', 1, ['Code', 'Stat'], [['1G', 'A']]),
  makeSheet('Code Key', 1, ['Code', 'Meaning'], [['X', 'Example']]),
  makeSheet('Calculations', 1, ['Item', 'Value'], [['I1', '2']]),
  makeSheet("New Weighted%'s", 2, ['Item', 'Common Name', 'Jan'], [['I2', 'Elm', '0']]),
  makeSheet('CPB', 1, ['Container', 'Count'], [['1G', '8']])
];

test('header parsing keeps 1-based physical positions, duplicate headers, and grouped headings', () => {
  const context = createContext();
  context.__sheets = sevenSheets;
  const metadata = vm.runInContext('productionScheduleSheetMetadata_({getSheets: () => __sheets})', context);
  assert.equal(metadata.length, 7);
  assert.equal(metadata[0].metadata.header_row, 8);
  assert.deepEqual(Array.from(metadata[0].metadata.columns, (column) => column.index), [1, 2, 3, 4]);
  assert.equal(metadata[0].metadata.columns[1].header, 'Action');
  assert.equal(metadata[0].metadata.columns[2].header, 'Action');
  assert.equal(metadata[5].metadata.columns[0].header, '2027 / Item');
  assert.equal(metadata[5].metadata.columns[2].header, '2027 / Jan');
});

test('merged weighted-sheet group headings apply to every covered physical column', () => {
  const source = sevenSheets[5];
  const weighted = {
    ...source,
    getRange(row, column, numRows, numColumns) {
      const range = source.getRange(row, column, numRows, numColumns);
      if (row !== 1 || numRows !== 2) return range;
      return {
        getDisplayValues() {
          const values = range.getDisplayValues();
          values[0] = ['2027', '', ''];
          return values;
        },
        getMergedRanges: () => [{
          getRow: () => 1, getColumn: () => 1, getNumRows: () => 1, getNumColumns: () => 3,
        }],
      };
    },
  };
  const context = createContext();
  context.__sheets = [...sevenSheets.slice(0, 5), weighted, sevenSheets[6]];
  const metadata = vm.runInContext('productionScheduleSheetMetadata_({getSheets: () => __sheets})', context);
  assert.equal(metadata[5].metadata.columns[1].header, '2027 / Common Name');
  assert.equal(metadata[5].metadata.columns[2].header, '2027 / Jan');
});

test('sparse rows preserve physical source rows and displayed zero while omitting blanks', () => {
  const context = createContext();
  context.__displayRows = [['', '0', 0, 'x'], ['', '', '', '']];
  const rows = vm.runInContext('productionScheduleSparseRows_(9, __displayRows)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { source_row: 9, cells: { '2': '0', '3': '0', '4': 'x' } }
  ]);
});

test('signed import command rejects a bad signature and accepts only the fixed workbook contract', () => {
  const context = createContext();
  context.__properties.set('REQUEST_DELIVERY_SIGNING_SECRET', 'unrelated-request-secret');
  const delivery = { contractVersion: 'production-schedule-import-v1', workbookId, runId: snapshotId, snapshotId, requestedBy: 'dylan' };
  const signed = signPayload(delivery);
  context.__command = signed;
  assert.equal(vm.runInContext('verifyProductionScheduleImportCommand_(__command).snapshotId', context), snapshotId);
  context.__command = { ...signed, signature: 'bad' };
  assert.throws(() => vm.runInContext('verifyProductionScheduleImportCommand_(__command)', context), /PRODUCTION_SCHEDULE_SIGNATURE_INVALID/);
  context.__command = signPayload({ ...delivery, workbookId: 'another-workbook' });
  assert.throws(() => vm.runInContext('verifyProductionScheduleImportCommand_(__command)', context), /PRODUCTION_SCHEDULE_COMMAND_INVALID/);
  context.__command = signPayload(delivery, '2020-01-01T00:00:00.000Z');
  assert.throws(() => vm.runInContext('verifyProductionScheduleImportCommand_(__command)', context), /PRODUCTION_SCHEDULE_SIGNATURE_EXPIRED/);
});

test('bounded worker stages all seven sheets with sparse 1-based columns and promotes only after completion', () => {
  const context = createContext({ sheets: sevenSheets });
  const delivery = { contractVersion: 'production-schedule-import-v1', workbookId, runId: snapshotId, snapshotId, requestedBy: 'dylan' };
  context.__command = signPayload(delivery);
  const accepted = vm.runInContext('acceptProductionScheduleImportCommand_(__command)', context);
  assert.equal(accepted.accepted, true);
  assert.equal(context.__triggers.length, 1);

  for (let attempt = 0; attempt < 25; attempt++) {
    const result = vm.runInContext('runProductionScheduleImportChunk_()', context);
    if (result.status === 'complete') break;
  }
  const calls = JSON.parse(JSON.stringify(context.__rpcCalls));
  const setSheets = calls.find((call) => call.name === 'production_schedule_set_sheets_v1');
  assert.equal(setSheets.payload.p_sheets.length, 7);
  assert.equal(setSheets.payload.p_sheets[0].header_row, 8);
  const appended = calls.filter((call) => call.name === 'production_schedule_append_rows_v1');
  const mainRows = appended.find((call) => call.payload.p_sheet_index === 0).payload.p_rows;
  assert.equal(mainRows[0].source_row, 9);
  assert.equal(mainRows[0].cells['3'], '0');
  assert.equal(Object.hasOwn(mainRows[0].cells, '1'), true);
  const finishIndex = calls.findIndex((call) => call.name === 'production_schedule_finish_import_v1');
  assert.ok(finishIndex > calls.findIndex((call) => call.name === 'production_schedule_append_rows_v1'));
  assert.equal(calls.filter((call) => call.name === 'production_schedule_finish_import_v1').length, 1);
  assert.equal(context.__properties.has('PRODUCTION_SCHEDULE_IMPORT_STATE_V1'), false);
  assert.equal(context.__triggers.length, 0);
});

test('worker handles a bounded number of row batches per execution and resumes from persisted cursor', () => {
  const longMain = makeSheet('PROD SCHED', 8, ['Item'], Array.from({ length: 1200 }, (_, index) => [`I${index + 1}`]));
  const sheets = [longMain, ...sevenSheets.slice(1)];
  const context = createContext({ sheets });
  const delivery = { contractVersion: 'production-schedule-import-v1', workbookId, runId: snapshotId, snapshotId, requestedBy: 'dylan' };
  context.__command = signPayload(delivery);
  vm.runInContext('acceptProductionScheduleImportCommand_(__command)', context);
  const result = vm.runInContext('runProductionScheduleImportChunk_()', context);
  const calls = JSON.parse(JSON.stringify(context.__rpcCalls));
  assert.equal(result.status, 'running');
  assert.equal(calls.filter((call) => call.name === 'production_schedule_append_rows_v1').length, 8);
  const progress = calls.filter((call) => call.name === 'production_schedule_update_progress_v1').at(-1);
  assert.equal(progress.payload.p_processed_rows, 800);
  const state = JSON.parse(context.__properties.get('PRODUCTION_SCHEDULE_IMPORT_STATE_V1'));
  assert.equal(state.sheet_index, 0);
  assert.equal(state.cursor, 800);
  assert.equal(context.__triggers.length, 1);
});

test('signed redelivery re-arms a recurring worker after a lost or locked continuation', () => {
  const context = createContext({ sheets: sevenSheets });
  const delivery = { contractVersion: 'production-schedule-import-v1', workbookId, runId: snapshotId, snapshotId, requestedBy: 'dylan' };
  context.__command = signPayload(delivery);
  vm.runInContext('acceptProductionScheduleImportCommand_(__command)', context);
  const initialTrigger = context.__triggers[0];
  assert.equal(initialTrigger.intervalMinutes, 1);

  context.__setLockAvailable(false);
  assert.equal(vm.runInContext('runProductionScheduleImportChunk_().status', context), 'locked');
  assert.equal(context.__triggers[0], initialTrigger, 'lock contention retains the recurring trigger');
  context.__setLockAvailable(true);

  const accepted = vm.runInContext('acceptProductionScheduleImportCommand_(__command)', context);
  assert.equal(accepted.snapshotId, snapshotId);
  assert.equal(context.__triggers.length, 1);
  assert.notEqual(context.__triggers[0], initialTrigger, 'redelivery replaces a stale trigger');
  assert.equal(context.__triggers[0].intervalMinutes, 1);
  assert.equal(vm.runInContext('runProductionScheduleImportChunk_().status', context), 'complete');
  assert.equal(context.__triggers.length, 0);
});

test('import RPC failure retries are bounded and never promote an incomplete snapshot', () => {
  let appendAttempts = 0;
  const context = createContext({ sheets: sevenSheets, rpc: (name) => {
    if (name === 'production_schedule_append_rows_v1') {
      appendAttempts += 1;
      throw new Error('network unavailable');
    }
    return {};
  } });
  const delivery = { contractVersion: 'production-schedule-import-v1', workbookId, runId: snapshotId, snapshotId, requestedBy: 'dylan' };
  context.__command = signPayload(delivery);
  vm.runInContext('acceptProductionScheduleImportCommand_(__command)', context);
  for (let attempt = 0; attempt < 3; attempt++) vm.runInContext('runProductionScheduleImportChunk_()', context);
  const calls = JSON.parse(JSON.stringify(context.__rpcCalls));
  assert.equal(appendAttempts, 3);
  assert.equal(calls.filter((call) => call.name === 'production_schedule_finish_import_v1').length, 0);
  assert.equal(calls.filter((call) => call.name === 'production_schedule_fail_import_v1').length, 1);
  assert.equal(context.__properties.has('PRODUCTION_SCHEDULE_IMPORT_STATE_V1'), false);
});

test('source edits during a resumed import fail the candidate snapshot without promotion', () => {
  const longMain = makeSheet('PROD SCHED', 8, ['Item'], Array.from({ length: 1200 }, (_, index) => [`I${index + 1}`]));
  const context = createContext({ sheets: [longMain, ...sevenSheets.slice(1)] });
  const delivery = { contractVersion: 'production-schedule-import-v1', workbookId, runId: snapshotId, snapshotId, requestedBy: 'dylan' };
  context.__command = signPayload(delivery);
  vm.runInContext('acceptProductionScheduleImportCommand_(__command)', context);
  vm.runInContext('runProductionScheduleImportChunk_()', context);
  context.__setSourceUpdatedAt('2026-09-30T12:01:00.000Z');
  const result = vm.runInContext('runProductionScheduleImportChunk_()', context);
  const calls = JSON.parse(JSON.stringify(context.__rpcCalls));
  assert.equal(result.code, 'PRODUCTION_SCHEDULE_SOURCE_CHANGED');
  assert.equal(calls.filter((call) => call.name === 'production_schedule_fail_import_v1').length, 1);
  assert.equal(calls.filter((call) => call.name === 'production_schedule_finish_import_v1').length, 0);
  assert.equal(context.__properties.has('PRODUCTION_SCHEDULE_IMPORT_STATE_V1'), false);
});
