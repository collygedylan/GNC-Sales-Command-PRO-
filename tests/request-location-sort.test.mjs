// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const locationCodeSource = readFileSync(new URL('../assets/location-code.js', import.meta.url), 'utf8');

function sortWithComparator(rows, compare) {
  return rows.slice().sort((left, right) => compare(left.LOCATIONCODE, right.LOCATIONCODE))
    .map(row => row.LOCATIONCODE);
}

test('Pending request location sort uses the canonical natural location comparator', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(locationCodeSource, context);

  const locations = [
    'C.06.10', 'C.06.2', 'C.06.02', 'C.06.1', 'C.06.11',
    '', null, undefined, 'A-1', 'a-1', 'C.06.2', 'C.06.02',
  ];
  const rows = locations.map(LOCATIONCODE => ({ LOCATIONCODE }));
  const expected = sortWithComparator(rows,
    (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' }));
  const actual = sortWithComparator(rows, context.compareLocationCodeNatural);
  assert.deepEqual(actual, expected);
  assert.equal(context.LocationCode.compare, context.compareLocationCodeNatural);

  const originalCollator = Intl.Collator;
  let constructions = 0;
  const fresh = { Intl: { Collator: class extends originalCollator {
    constructor(...args) { super(...args); constructions++; }
  } } };
  vm.createContext(fresh);
  vm.runInContext(locationCodeSource, fresh);
  for (let index = 0; index < 500; index++) fresh.compareLocationCodeNatural('C.06.2', 'C.06.10');
  assert.equal(constructions, 0, 'canonical comparisons do not allocate competing collators');
});
