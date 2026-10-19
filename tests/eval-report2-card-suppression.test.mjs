import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = readFileSync(new URL('../assets/eval-reports-engine.js', import.meta.url), 'utf8');
const context = vm.createContext({ Intl, Date, Map, Set, Object, Array, String, Number, Math });
context.globalThis = context;
vm.runInContext(engineSource, context, { filename: 'eval-reports-engine.js' });
const engine = context.GncEvalReports;

function row(itemcode, season, lotcode, overrides = {}) {
  return { ITEMCODE: itemcode, SEASON: season, LOTCODE: lotcode, ITEMDESI: '', ...overrides };
}

test('Eval Reports #2 suppresses a card only when every underlying row is Y/U3, lot-Y/U3, or SHFT', () => {
  const fixtures = [
    ['jim-dandy', [row('000201.030.1', 'Y', '27.Y'), row('000201.030.1', 'Y', '28.Y')], true],
    ['season-u3', [row('U3.ONLY', 'u3', '27.S1')], true],
    ['lot-u3', [row('LOT.U3', 'F1', '27.u3')], true],
    ['design-shft', [row('SHIFT.ONLY', 'S1', '27.S1', { itemdesi: 'shade-shFt-extra' })], true],
    ['salsa-dancer', [row('000193.031.1', 'S1', '27.S1'), row('000193.031.1', 'Z', '27.Z')], false],
    ['mixed-active-row', [row('MIXED.1', 'U3', '27.U3'), row('MIXED.1', 'S1', '27.S1')], false],
    ['empty', [], false]
  ];
  for (const [name, rows, expected] of fixtures) {
    assert.equal(engine.isSuppressedEvalReportCardRows(rows), expected, name);
  }
  assert.equal(engine.isSuppressedEvalReportCardRow(row('DESIG.ALIAS', 'S1', '27.S1', { DESIGITEM: 'a SHFT label' })), true);
});

test('card suppression examines a 10,001-row, 1,000-itemcode snapshot without mutating source rows', () => {
  const rows = [];
  for (let item = 0; item < 1000; item += 1) {
    for (let physicalRow = 0; physicalRow < 10; physicalRow += 1) {
      const suppressed = item < 800;
      rows.push(row(`ITEM-${String(item).padStart(4, '0')}`, suppressed ? 'U3' : 'F1', suppressed ? '27.U3' : '27.F1', {
        UNIQUE_ID: `${item}-${physicalRow}`,
        COMMONNAME: `Fixture ${item}`,
        ITEMDESI: ''
      }));
    }
  }
  rows[0].SEASON = 'F1';
  rows[0].LOTCODE = '27.F1'; // Any active row preserves the whole item card.
  rows.push(row('ITEM-0000', 'U3', '27.U3', { UNIQUE_ID: '10000', COMMONNAME: 'Fixture 0' }));

  const sourceSnapshot = JSON.stringify(rows);
  const startedAt = performance.now();
  const byItemCode = new Map();
  for (const sourceRow of rows) {
    if (!byItemCode.has(sourceRow.ITEMCODE)) byItemCode.set(sourceRow.ITEMCODE, []);
    byItemCode.get(sourceRow.ITEMCODE).push(sourceRow);
  }
  const suppressedCodes = [...byItemCode].filter(([, cardRows]) => engine.isSuppressedEvalReportCardRows(cardRows)).map(([code]) => code);
  const durationMs = performance.now() - startedAt;
  console.log(JSON.stringify({ operation: 'Eval2 cached card suppression', rows: rows.length, itemcodes: byItemCode.size, durationMs, limitMs: 100, runtime: process.version, cache: 'in-memory fixture; no network', osCaches: 'uncontrolled' }));
  assert.ok(durationMs < 100, `Cached card suppression took ${durationMs} ms`);

  assert.equal(rows.length, 10001);
  assert.equal(byItemCode.size, 1000);
  assert.equal(suppressedCodes.length, 799);
  assert.ok(!suppressedCodes.includes('ITEM-0000'));
  assert.ok(suppressedCodes.includes('ITEM-0001'));
  assert.equal(JSON.stringify(rows), sourceSnapshot);
  assert.equal(byItemCode.get('ITEM-0000')[0], rows[0]);
});
