import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createProductionScheduleClient } from '../services/productionScheduleClient.js';
import { columnName, getScheduleCard, getScheduleRowDetails } from '../services/productionScheduleSheets.js';
import { renderScheduleFilters } from '../components/managers/ProductionSchedule/render.js';
const snapshotId = '12345678-1234-4123-8123-123456789abc';

test('mounted worksheet loading forwards the metadata snapshot to the required server request field', () => {
  const page = readFileSync(new URL('../pages/managers/ProductionSchedule.js', import.meta.url), 'utf8');
  assert.match(page, /client\.rows\(\{ sheet, sheetId: sheet\.id, snapshotId: snapshot\?\.id,/);
  const api = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  assert.match(api, /parsed\.operation === "rows"[\s\S]*?\!parsed\.snapshotId\) return errorResponse\("Invalid schedule request/);
});

test('row details preserve duplicate source headers and physical column positions', () => {
  const sheet = { title: 'PROD SCHED', columns: [
    { index: 1, header: 'Action' }, { index: 2, header: 'Action' },
    { index: 3, header: '' }, { index: 4, header: '2027 SCH TOTAL' },
  ] };
  const row = { sourceRow: 9, cells: { 1: 'Hold', 2: 'Release', 3: '0', 4: '' } };
  assert.deepEqual(getScheduleRowDetails(sheet, row), [
    { index: 1, label: 'Action', value: 'Hold' },
    { index: 2, label: 'Action', value: 'Release' },
    { index: 3, label: 'Column C', value: '0' },
  ]);
  assert.equal(getScheduleCard(sheet, row).sourceRow, 9);
  assert.equal(columnName(784), 'ADD');
});

test('sheet-specific source filters do not invent a status for the main schedule', () => {
  const main = { title: 'PROD SCHED', filterColumns: [
    { index: 39, header: 'NoSale', options: ['N', 'Y'] },
    { index: 90, header: 'Action', options: ['Change'] },
  ] };
  const container = { title: 'ContTable', statusColumn: 3,
    filterColumns: [{ index: 3, header: 'Stat', options: ['A', 'I'] }] };
  assert.match(renderScheduleFilters(main, {}, true), /NoSale/);
  assert.match(renderScheduleFilters(main, {}, true), /Action/);
  assert.doesNotMatch(renderScheduleFilters(main, {}, true), /Status/);
  assert.match(renderScheduleFilters(container, {}, true), /Status \(Stat\)/);
});

test('client uses the bounded native-session API contract', async () => {
  const calls = [];
  const client = createProductionScheduleClient(async (body, signal) => {
    calls.push({ body, signal });
    return { ok: true, rows: [], nextCursor: null, total: 0 };
  });
  const abort = new AbortController();
  await client.rows({ sheet: { columns: [{ index: 39, header: 'NoSale' }] }, sheetId: 2, snapshotId,
    q: 'rose', filters: { '39': 'N' }, cursor: '44', limit: 999 }, abort.signal);
  assert.deepEqual(calls[0].body, {
    action: 'production_schedule', operation: 'rows', sheetId: 2, snapshotId, q: 'rose',
    filters: { '39': 'N' }, cursor: '44', limit: 500, projection: 'cards', columnIndexes: [39],
  });
  assert.equal(calls[0].signal, abort.signal);
});

test('card projection handles a worksheet with no metadata columns', async () => {
  const calls = [];
  const client = createProductionScheduleClient(async (body) => {
    calls.push(body);
    return { ok: true, rows: [{ sourceRow: 9, cells: {}, fieldCount: 12 }] };
  });
  await client.rows({ sheet: { title: 'Empty headers', columns: [] }, sheetId: 6, snapshotId });
  assert.deepEqual(calls[0].columnIndexes, []);
});

test('every worksheet page is bound to a published snapshot without loading the entire 18,459-row workbook', async () => {
  const calls = [];
  const client = createProductionScheduleClient(async body => {
    calls.push(body);
    if (body.operation === 'metadata') return { ok: true, snapshot: { id: snapshotId }, sheets: [{ id: 0, title: 'PROD SCHED', rowCount: 18459, columns: [] }] };
    return { ok: true, snapshotId, rows: [{ sourceRow: 1, cells: {} }], total: 18459, nextCursor: '20' };
  });
  const metadata = await client.metadata();
  const first = await client.rows({ sheet: metadata.sheets[0], sheetId: 0, snapshotId: metadata.snapshot.id });
  await client.rows({ sheet: metadata.sheets[0], sheetId: 0, snapshotId, cursor: first.nextCursor });
  assert.equal(calls[1].snapshotId, snapshotId);
  assert.equal(calls[1].limit, 20);
  assert.equal(calls[2].snapshotId, snapshotId);
  assert.equal(calls[2].cursor, '20');
  assert.equal(first.total, 18459);
});

test('missing snapshot and invalid worksheet references fail before transport; real server denials remain errors', async () => {
  let reads = 0;
  const client = createProductionScheduleClient(async () => { reads++; return { ok: false, status: 403, code: 'PRODUCTION_SCHEDULE_FORBIDDEN', error: 'Forbidden' }; });
  assert.throws(() => client.rows({ sheetId: 0 }), /published workbook snapshot/);
  assert.throws(() => client.rows({ sheetId: 7, snapshotId }), /worksheet index/);
  assert.throws(() => client.rows({ sheetId: null, snapshotId }), /worksheet index/);
  assert.equal(reads, 0);
  await assert.rejects(client.rows({ sheetId: 0, snapshotId }), error => error.status === 403 && error.code === 'PRODUCTION_SCHEDULE_FORBIDDEN');
});
