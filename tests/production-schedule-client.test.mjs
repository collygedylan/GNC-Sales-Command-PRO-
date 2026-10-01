import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionScheduleClient } from '../services/productionScheduleClient.js';
import { columnName, getScheduleCard, getScheduleRowDetails } from '../services/productionScheduleSheets.js';
import { renderScheduleFilters } from '../components/managers/ProductionSchedule/render.js';

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
  await client.rows({ sheetId: 12, q: 'rose', filters: { '39': 'N' }, cursor: '12:44', limit: 999 }, abort.signal);
  assert.deepEqual(calls[0].body, {
    action: 'production_schedule', operation: 'rows', sheetId: 12, q: 'rose',
    filters: { '39': 'N' }, cursor: '12:44', limit: 500,
  });
  assert.equal(calls[0].signal, abort.signal);
});
