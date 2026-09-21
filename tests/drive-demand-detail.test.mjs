import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/drive-demand-detail.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const module = { exports: {} };
const context = { module, exports: module.exports, window: {}, String, Number, Object, Array, JSON, Set, Map };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'assets/drive-demand-detail.js' });
const detail = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const fetchAllStart = html.indexOf('async function fetchAllSupabaseRows(');
const fetchAllEnd = html.indexOf('let activeRequestLiveRowsViewReady', fetchAllStart);
assert.ok(fetchAllStart >= 0 && fetchAllEnd > fetchAllStart, 'real complete reader is present');
const fetchAllSource = html.slice(fetchAllStart, fetchAllEnd);
function completeReader(pages) {
  const ctx = { Object, String, Number, Array, Map, Set, JSON, Error, Promise,
        REQUEST_HISTORY_TABLE: 'ph_request_history', SALES_CREDIT_REQUESTS_TABLE: 'ph_sales_credit_requests',
    runDedupeSupabaseRead: async (_key, task) => task(), startGlobalProgress() {}, stopGlobalProgress() {},
    beginInternalPerfMeasure: () => 0, incrementInternalPerfCounter() {}, recordInternalPerfDuration() {},
    getFullDatasetPageLimit: () => 2, getFullDatasetPageConcurrency: () => 1,
    getProductionLiveSyncReadSignalKey: () => '', yieldToUiFrame: async () => {},
    fetchSupabaseRowsPage: async (_table, _query, _limit, offset) => pages[offset] || { offset, rows: [], total: null },
    fetchSupabaseRowsPageBatch: async (_table, _query, _limit, offsets) => offsets.map((offset) => pages[offset] || { offset, rows: [], total: null })
  };
  vm.createContext(ctx); vm.runInContext(fetchAllSource, ctx);
  return ctx;
}

test('Drive demand detail normalizes inventory season/year and only falls back to a valid lot', () => {
  assert.equal(detail.normalizeYear('27'), 2027);
  assert.equal(detail.normalizeYear('2027'), 2027);
  assert.equal(detail.normalizeYear('27.0'), null);
  assert.equal(detail.normalizeYear('202'), null);
  assert.deepEqual(plain(detail.parseLot(' 27.f1 ')), { season: 'F1', salesyear: 2027 });
  assert.equal(detail.parseLot('27F1'), null);

  assert.deepEqual(plain(detail.itemKey({ itemcode: ' synth.003 ', season: 'f1', saleyear: '27', lotcode: '26.S1' })), {
    itemcode: 'SYNTH.003', season: 'F1', salesyear: 2027
  });
  assert.deepEqual(plain(detail.itemKey({ itemcode: 'synth.003', lotcode: '27.F1' })), {
    itemcode: 'SYNTH.003', season: 'F1', salesyear: 2027
  });
  assert.equal(detail.itemKey({ itemcode: 'SYNTH.003', season: 'F1', lotcode: 'not-a-lot' }), null,
    'a missing explicit year must not silently widen the selected inventory key');
});

test('Drive demand detail selects only the exact item and lot-derived season/year, retaining raw zero and unknown values', () => {
  const selected = { itemcode: 'SYNTH.003', season: 'F1', saleyear: '27' };
  const rows = [
    { unique_id: 'reserve-exact', itemcode: ' synth.003 ', lotcode: '27.f1', quantityordered: '0', quantityshipped: null, ptravailable: 0 },
    { unique_id: 'reserve-other-season', itemcode: 'SYNTH.003', lotcode: '26.F1', quantityordered: '99' },
    { unique_id: 'reserve-other-item', itemcode: 'SYNTH.0030', lotcode: '27.F1', quantityordered: '99' },
    { unique_id: 'reserve-invalid-lot', itemcode: 'SYNTH.003', lotcode: 'unparsed', quantityordered: '99' }
  ];
  const result = detail.selectRows(rows, selected, 'reserves');
  assert.deepEqual(plain(result.rows.map((row) => row.unique_id)), ['reserve-exact']);
  assert.equal(result.rows[0].quantityordered, '0');
  assert.equal(result.rows[0].quantityshipped, null);
  assert.equal(result.rows[0].ptravailable, 0);
  assert.ok(result.invalidCount >= 1, 'malformed lot rows are reported rather than item-only matched');
});

test('Open Orders excludes invoiced SOC rows without applying a Docks date window', () => {
  const selected = { itemcode: 'SYNTH.003', season: 'F1', saleyear: 2027 };
  const rows = [
    { unique_id: 'open-no-date', itemcode: 'SYNTH.003', lotcode: '27.F1', invoicedate: null, planstartdate: '2024-01-01' },
    { unique_id: 'open-empty-date', itemcode: 'SYNTH.003', lotcode: '27.F1', invoicedate: '   ', planstartdate: '2032-01-01' },
    { unique_id: 'invoiced', itemcode: 'SYNTH.003', lotcode: '27.F1', invoicedate: '2026-09-01' },
    { unique_id: 'other-season', itemcode: 'SYNTH.003', lotcode: '26.F1', invoicedate: null }
  ];
  const result = detail.selectRows(rows, selected, 'open-orders');
  assert.deepEqual(plain(result.rows.map((row) => row.unique_id)), ['open-no-date', 'open-empty-date']);
  assert.match(decodeURIComponent(detail.buildQuery(selected)), /(?:^|&)itemcode=ilike\.%SYNTH\.003%(?:&|$)/i,
    'the source query must retrieve case/whitespace variants before strict normalized matching');
});

test('demand complete reader rejects missing, duplicate, and uncounted later pages before any snapshot can commit', async () => {
  const success = completeReader({
    0: { offset: 0, total: 3, rows: [{ unique_id: 'one' }, { unique_id: 'two' }] },
    2: { offset: 2, total: 3, rows: [{ unique_id: 'three' }] }
  });
  assert.deepEqual(plain(await success.fetchAllSupabaseRows('ph_reserves', 'select=*', { requireComplete: true })).map((row) => row.unique_id), ['one', 'two', 'three']);

  for (const pages of [
    { 0: { offset: 0, total: 3, rows: [{ unique_id: 'one' }, { unique_id: 'two' }] }, 2: { offset: 2, total: 3, rows: [] } },
    { 0: { offset: 0, total: 3, rows: [{ unique_id: 'one' }, { unique_id: 'two' }] }, 2: { offset: 2, total: 3, rows: [{ unique_id: 'one' }] } },
    { 0: { offset: 0, total: null, rows: [{ unique_id: 'one' }, { unique_id: 'two' }] }, 2: { offset: 2, total: null, rows: [] } }
  ]) {
    const reader = completeReader(pages);
    await assert.rejects(reader.fetchAllSupabaseRows('ph_soc_master', 'select=*', { requireComplete: true }), /Complete source rows could not be verified/);
  }
});
