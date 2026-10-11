// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(source, name, stopAt) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in shell`);
  const end = source.indexOf(stopAt, start);
  assert.ok(end > start, `${name} boundary`);
  return source.slice(start, end);
}

function sortWithComparator(rows, compare) {
  return rows.slice().sort((left, right) => compare(left.LOCATIONCODE, right.LOCATIONCODE))
    .map(row => row.LOCATIONCODE);
}

test('Pending request location sort reuses numeric collation with localeCompare-equivalent order', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([
    'let requestLocationCollator = null;',
    extractFunction(html, 'compareRequestLocationCodes', 'function buildPendingRequestRenderPlan('),
    'globalThis.compareRequestLocationCodes = compareRequestLocationCodes;'
  ].join('\n'), ctx);

  const locations = [
    'C.06.10', 'C.06.2', 'C.06.02', 'C.06.1', 'C.06.11',
    '', null, undefined, 'A-1', 'a-1', 'é-2', 'e-2', 'É-10', 'e-10',
    'C.06.2', 'C.06.02'
  ];
  const rows = locations.map(LOCATIONCODE => ({ LOCATIONCODE }));
  const expected = sortWithComparator(rows,
    (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true }));
  const actual = sortWithComparator(rows, ctx.compareRequestLocationCodes);
  assert.deepEqual(actual, expected);

  const originalCollator = Intl.Collator;
  let constructions = 0;
  const fresh = { Intl: { Collator: class extends originalCollator {
    constructor(...args) { super(...args); constructions++; }
  } } };
  vm.createContext(fresh);
  vm.runInContext([
    'let requestLocationCollator = null;',
    extractFunction(html, 'compareRequestLocationCodes', 'function buildPendingRequestRenderPlan('),
    'globalThis.compareRequestLocationCodes = compareRequestLocationCodes;'
  ].join('\n'), fresh);
  for (let index = 0; index < 500; index++) fresh.compareRequestLocationCodes('C.06.2', 'C.06.10');
  assert.equal(constructions, 1, 'one lazily-created collator is reused across comparisons');
});
