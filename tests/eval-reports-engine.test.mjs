import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = readFileSync(new URL('../assets/eval-reports-engine.js', import.meta.url), 'utf8');
const context = vm.createContext({ Intl, Date, Map, Set, Object, Array, String, Number, Math });
context.globalThis = context;
vm.runInContext(engineSource, context, { filename: 'eval-reports-engine.js' });
const engine = context.GncEvalReports;

function row(itemcode, season, saleyear, overrides = {}) {
  return {
    ITEMCODE: itemcode,
    SEASON: season,
    SALEYEAR: saleyear,
    ASSIGNEDTO: '',
    PRIORITY: '',
    S_LTS: 999,
    HOLDSTOPCODE: '',
    HOLDSTOPBEGINDATE: '',
    LOCATIONNOTEDATE: '',
    LOCATIONCODE: 'A.01.001',
    ...overrides
  };
}

function ids(rows) {
  return Array.from(rows, (record) => record.TEST_ID);
}

const now = new Date('2026-08-20T17:00:00Z');

test('normalizes two-digit sales years and parses inventory dates without locale guessing', () => {
  assert.equal(engine.normalizeSalesYear('27'), 2027);
  assert.equal(engine.normalizeSalesYear(99), 2099);
  assert.equal(engine.normalizeSalesYear('2027'), 2027);
  assert.equal(engine.normalizeSalesYear(''), null);
  assert.equal(engine.parseInventoryDateEpochDay('8/9/26'), engine.parseInventoryDateEpochDay('2026-08-09'));
  assert.equal(engine.parseInventoryDateEpochDay('2/30/2026'), null);
  assert.equal(engine.parseInventoryDateEpochDay('not-a-date'), null);
});

test('classifies the eight F1/27 reports with strict date and low-stock boundaries', () => {
  const rows = [
    row('A', 'F1', '27', { TEST_ID: 'a-f1', ASSIGNEDTO: 'josh_vann', PRIORITY: '1', S_LTS: 100, HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/14/2026', LOCATIONNOTEDATE: '8/9/2026' }),
    row('A', 'U1', 27, { TEST_ID: 'a-u1', ASSIGNEDTO: 'josh_vann' }),
    row('A', 'X', 27, { TEST_ID: 'a-x', ASSIGNEDTO: 'josh_vann' }),
    row('A', 'S1', 27, { TEST_ID: 'a-s1', ASSIGNEDTO: 'josh_vann' }),
    row('B', 'U2', 26, { TEST_ID: 'b-u2', ASSIGNEDTO: 'abigail_vazquez', HOLDSTOPBEGINDATE: 'invalid', LOCATIONNOTEDATE: 'invalid' }),
    row('C', 'F1', 28, { TEST_ID: 'c-future-f1', ASSIGNEDTO: 'bobby_adair', S_LTS: 10 }),
    row('D', 'F1', 27, { TEST_ID: 'd-boundary', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '2', S_LTS: 150, HOLDSTOPBEGINDATE: '8/15/2026', LOCATIONNOTEDATE: '8/10/2026' }),
    row('E', 'S1', 27, { TEST_ID: 'e-s1-pri', ASSIGNEDTO: 'megan_kelly', PRIORITY: '3' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'F1',
    currentSalesYear: 27,
    nextSeason: 'S1',
    nextSalesYear: 27,
    settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 },
    now
  });

  assert.deepEqual(ids(result.reports['s1-with-pri']), ['d-boundary', 'a-f1']);
  assert.deepEqual(ids(result.reports['od-loc-note-date']), ['a-f1']);
  assert.deepEqual(ids(result.reports['hs-plus-5-days']), ['a-f1']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['low-stock']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['no-pri']), ['b-u2', 'c-future-f1']);
  assert.deepEqual(ids(result.reports.culls), ['a-x']);
  assert.deepEqual(ids(result.reports['not-in-f1']), ['b-u2', 'c-future-f1', 'e-s1-pri']);
});

test('uses ItemCode-level Priority, F1, hold, and low-stock membership', () => {
  const rows = [
    row('ONE', 'F1', 27, { TEST_ID: 'one-seed', PRIORITY: '1', S_LTS: 149, HOLDSTOPBEGINDATE: '8/1/2026', HOLDSTOPCODE: 'H' }),
    row('ONE', 'U3', 27, { TEST_ID: 'one-support' }),
    row('ONE', 'U3', 28, { TEST_ID: 'one-too-new' }),
    row('TWO', 'U1', 27, { TEST_ID: 'two-a', PRIORITY: '' }),
    row('TWO', 'S1', 27, { TEST_ID: 'two-b', PRIORITY: '9' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'F1', currentSalesYear: 2027, nextSeason: 'S1', nextSalesYear: 2027, now
  });

  assert.deepEqual(ids(result.reports['low-stock']), ['one-support']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['one-support', 'one-too-new']);
  assert.equal(result.reports['no-pri'].some((record) => record.ITEMCODE === 'TWO'), false);
  assert.equal(result.reports['not-in-f1'].filter((record) => record.ITEMCODE === 'TWO').length, 2);
});

test('follows the configured current and next-season transition', () => {
  const rows = [
    row('SHIFT', 'S1', 27, { TEST_ID: 'shift-s1', PRIORITY: '1', S_LTS: 20 }),
    row('SHIFT', 'U1', 27, { TEST_ID: 'shift-u1' }),
    row('SHIFT', 'F1', 28, { TEST_ID: 'shift-f1-next' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'S1', currentSalesYear: 27, nextSeason: 'F1', nextSalesYear: 28, now
  });
  assert.deepEqual(ids(result.reports['s1-with-pri']), ['shift-s1']);
  assert.deepEqual(ids(result.reports['low-stock']), ['shift-f1-next', 'shift-u1']);
});

test('sorts by AssignedTo, ItemCode, season order, sales year, and location', () => {
  const rows = [
    row('B', 'X', 27, { TEST_ID: '4', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'B.02.001' }),
    row('A', 'U1', 27, { TEST_ID: '3', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'B.01.001' }),
    row('A', 'F1', 28, { TEST_ID: '2', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'A.02.001' }),
    row('A', 'F1', 27, { TEST_ID: '1', ASSIGNEDTO: 'abigail_vazquez', LOCATIONCODE: 'A.01.001' })
  ];
  assert.deepEqual(ids(rows.slice().sort(engine.compareRows)), ['1', '2', '3', '4']);
});

test('classifies 10,000 rows in one sub-500 ms pass on the test runtime', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(
    `ITEM-${String(index % 2500).padStart(4, '0')}`,
    index % 5 === 0 ? 'F1' : ['U1', 'U2', 'U3', 'X'][index % 4],
    27,
    { TEST_ID: String(index), PRIORITY: index % 7 === 0 ? '1' : '', S_LTS: index % 200 }
  ));
  const started = performance.now();
  const result = engine.classifyRows(rows, { currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  const elapsed = performance.now() - started;
  assert.equal(result.counts.culls, 2000);
  assert.ok(elapsed < 500, `classification took ${elapsed.toFixed(1)} ms`);
});

test('the live shell exposes the secured Dylan/Megan-only Eval Reports module', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(html, /const MANAGER_EVAL_REPORTS_VIEW = 'eval-reports'/);
  assert.match(html, /key === 'dylan_collyge' \|\| key === 'megan_kelly'/);
  assert.match(html, /supabaseRpc\('get_eval_report_settings'/);
  assert.match(html, /supabaseRpc\('set_eval_report_settings'/);
  assert.match(html, /assets\/eval-reports-engine\.js/);
  assert.match(serviceWorker, /\.\/assets\/eval-reports-engine\.js/);
});
