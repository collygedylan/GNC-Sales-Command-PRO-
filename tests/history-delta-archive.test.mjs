import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historicalBusinessState, planConsecutiveHistoricalStates, requestArchivePath }
  from '../src/services/history-delta-review.mjs';
import { createHistoricalSnapshotFetch, fetchHistoricalSnapshot, historicalSnapshotReadUrl } from '../supabase/functions/_shared/historical-snapshot-transport.mjs';
import { historyMaintenanceOptions, processHistoryMaintenanceItem,
  processImportHistoryMaintenanceBatch } from '../scripts/compact-historical-deltas.mjs';

function observation(id, sequence, values = {}) {
  return { unique_id: id, file_id: `file-${sequence}`, file_sequence: sequence,
    report_date: `2026-11-${String(sequence).padStart(2, '0')}`,
    itemcode: '00123', locationcode: 'A.01.001', lotcode: '27.F1', available: 20,
    spec: '24 H', photo_url: 'https://example.test/original.jpg', ...values };
}

const entity = { keyFields: ['itemcode', 'locationcode', 'lotcode'] };

test('consecutive history review keeps A-B-A and links unchanged observations to their own run', () => {
  const result = planConsecutiveHistoricalStates([
    observation('a1', 1), observation('a2', 2), observation('b', 3, { available: 19 }),
    observation('a3', 4), observation('a4', 5),
  ], entity);
  assert.deepEqual(result.kept.map(row => row.unique_id), ['a1', 'b', 'a3']);
  assert.deepEqual(result.duplicateIds, ['a2', 'a4']);
  assert.deepEqual(result.coverage.map(row => row.retainedId), ['a1', 'a1', 'b', 'a3', 'a3']);
  assert.equal(result.coverage.at(-1).observedAt, '2026-11-05');
});

test('history gaps retain reappearances and location, lot and new business columns remain distinct', () => {
  const rows = [observation('first', 1), observation('reappeared', 3),
    observation('moved', 4, { locationcode: 'A.01.002' }),
    observation('lot', 4, { lotcode: '27.S1' }),
    observation('new-column', 4, { nursery_header_added_later: 'changed' })];
  assert.deepEqual(planConsecutiveHistoricalStates(rows, entity).kept, rows);
  assert.notDeepEqual(historicalBusinessState({ available: null }), historicalBusinessState({ available: 0 }));
  assert.notDeepEqual(historicalBusinessState({ spec: 'Full' }), historicalBusinessState({ spec: 'full' }));
});

test('all supplied business columns participate in equality while provenance does not', () => {
  const columns = ['on_hand', 'ptrreview', 'ptravailable', 'open_stock', 'holdstopreason', 'priority',
    'contsize', 'spec', 'caliper', 'match_pct', 'loc_photo_match', 'locationnote', 'saleyear', 'source'];
  for (const column of columns) {
    const rows = [observation('first', 1), observation('change', 2, { [column]: 'changed' })];
    assert.equal(planConsecutiveHistoricalStates(rows, entity).kept.length, 2, column);
  }
  const result = planConsecutiveHistoricalStates([observation('first', 1),
    observation('same', 2, { created_at: '2099-01-01', row_hash: 'different' })], entity);
  assert.equal(result.kept.length, 1);
});

test('a deletion plan refuses missing sequencing, out-of-order observations and ambiguous physical keys', () => {
  assert.throws(() => planConsecutiveHistoricalStates([observation('bad', 1, { file_sequence: undefined })], entity), /SEQUENCE_REQUIRED/);
  assert.throws(() => planConsecutiveHistoricalStates([observation('late', 2), observation('early', 1)], entity), /ORDER_INVALID/);
  assert.throws(() => planConsecutiveHistoricalStates([observation('a', 1), observation('b', 1)], entity), /SNAPSHOT_AMBIGUOUS/);
});

test('request hierarchy preserves buying account, receiving store, exact request/item and original photo evidence', () => {
  const row = { sales_rep: 'Dylan', customer_name: 'Buying Account', consignee_name: 'Store 19',
    requested_at: '2023-05-12T16:30:00Z', unique_id: 'REQ-123', itemcode: '00123',
    photo_url: 'https://example.test/full-resolution-original.jpg', spec: '24 H', request_qty: 25 };
  const snapshot = structuredClone(row);
  assert.deepEqual(requestArchivePath(row), ['Dylan', 'Buying Account', 'Store 19', '2023-05-12_REQ-123', '00123']);
  for (const value of ['', 'N/A', 'na', null]) {
    assert.equal(requestArchivePath({ ...row, consignee_name: value })[2], 'Direct_or_NA');
  }
  assert.deepEqual(row, snapshot);
});

test('snapshot transport preserves authenticated reads and never remaps writes', async () => {
  const url = 'https://example.test/rest/v1/ph_drive_around_report_rows?select=unique_id&limit=25';
  const controller = new AbortController();
  const original = new Request(url, { method: 'GET', headers: { authorization: 'Bearer fixture' }, signal: controller.signal });
  const mapped = historicalSnapshotReadUrl(original);
  assert.equal(mapped.url, url.replace('ph_drive_around_report_rows', 'ph_drive_around_report_rows_snapshot_v3039'));
  assert.equal(mapped.headers.get('authorization'), 'Bearer fixture');
  controller.abort('test deadline');
  assert.equal(mapped.signal.aborted, true);
  const write = new Request(url, { method: 'POST', body: 'exact request body' });
  assert.equal(historicalSnapshotReadUrl(write), write);
  assert.equal(await write.text(), 'exact request body');
});

test('snapshot transport falls back only when the logical rollout relation is missing', async () => {
  const url = 'https://example.test/rest/v1/ph_hold_stop_itemcode_snapshots?select=file_id';
  const init = { method: 'GET', headers: { authorization: 'Bearer fixture' } };
  const calls = [];
  const fetcher = async target => {
    calls.push(target);
    return calls.length === 1 ? Response.json({ code: 'PGRST205' }, { status: 404 }) : Response.json([{ file_id: 'f1' }]);
  };
  assert.deepEqual(await (await fetchHistoricalSnapshot(fetcher, url, init)).json(), [{ file_id: 'f1' }]);
  assert.deepEqual(calls, [url.replace('snapshots?', 'snapshots_snapshot_v3039?'), url]);
  let deniedCalls = 0;
  const denied = await fetchHistoricalSnapshot(async () => {
    deniedCalls += 1;
    return Response.json({ code: '42501' }, { status: 403 });
  }, url, init);
  assert.equal(denied.status, 403);
  assert.equal(deniedCalls, 1);
});

test('database bridge snapshot transport keeps its bounded abort signal', async () => {
  let observed;
  const fetcher = createHistoricalSnapshotFetch(async (_input, init) => {
    observed = init;
    return Response.json([]);
  });
  const response = await fetcher('https://example.test/rest/v1/ph_drive_around_report_rows',
    { method: 'GET' }, 1_000);
  assert.deepEqual(await response.json(), []);
  assert.ok(observed.signal instanceof AbortSignal);
  assert.equal(observed.signal.aborted, false);
});

test('maintenance defaults to a bounded read-only cohort and binds explicit write receipts to a run', async () => {
  assert.deepEqual(historyMaintenanceOptions(['--relation=drive']), { relation: 'drive',
    table: 'public.ph_drive_around_report_rows', mode: 'dry-run', limit: 50, resume: false, vacuum: false });
  assert.throws(() => historyMaintenanceOptions(['--relation=drive', '--vacuum']), /SCOPE_INVALID/);
  assert.throws(() => historyMaintenanceOptions(['--relation=hold', '--limit=501']), /SCOPE_INVALID/);
  assert.deepEqual(historyMaintenanceOptions(['--relation=import', '--mode=apply', '--limit=25']), { relation: 'import',
    table: 'import_private.import_history_rows', mode: 'apply', limit: 25, resume: false, vacuum: false });
  const queries = [];
  const database = { async query(sql, args) {
    queries.push({ sql, args });
    return { rows: [{ receipt: { rows_removed: 0 } }] };
  } };
  const scope = { table: 'public.ph_drive_around_report_rows', itemcode: 'ITEM', runId: 'run-identity' };
  await processHistoryMaintenanceItem(database, { ...scope, apply: false });
  assert.equal(queries[0].sql, 'begin read only');
  assert.ok(!queries.some(call => call.sql.includes('set_config')));
  assert.deepEqual(queries.at(-2).args, [scope.table, 'ITEM', false]);
  queries.length = 0;
  await processHistoryMaintenanceItem(database, { ...scope, apply: true });
  assert.equal(queries[0].sql, 'begin');
  assert.deepEqual(queries.find(call => call.sql.includes('set_config')).args, ['run-identity']);
  assert.equal(queries.at(-1).sql, 'commit');
});

test('private import maintenance keeps each positional batch bounded and read-only in dry-run', async () => {
  const calls = [];
  const database = { async query(sql, args) {
    calls.push({ sql, args });
    return { rows: [{ receipt: { eligible: 500, next_row: 750, done: false } }] };
  } };
  const receipt = await processImportHistoryMaintenanceBatch(database,
    { snapshotId: '00000000-0000-0000-0000-000000000001', after: 250, apply: false });
  assert.equal(calls[0].sql, 'begin read only');
  assert.deepEqual(calls.at(-2).args,
    ['00000000-0000-0000-0000-000000000001', 250, false]);
  assert.equal(calls.at(-1).sql, 'commit');
  assert.equal(receipt.next_row, 750);
});
