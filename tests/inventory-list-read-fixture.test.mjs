import assert from 'node:assert/strict';
import test from 'node:test';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

test('inventory read fixture applies Normal Drive commonname exact filtering', () => {
  const rows = [
    { unique_id: 'name-a', itemcode: 'HL.A', commonname: 'Synthetic HL Holly', contsize: '#3' },
    { unique_id: 'name-b', itemcode: 'HL.B', commonname: 'Synthetic HL Holly', contsize: '#5' },
    { unique_id: 'other', itemcode: 'HL.C', commonname: 'Other Holly', contsize: '#3' }
  ];

  const result = inventoryReadFixture.read(rows, 'commonname=eq.Synthetic+HL+Holly&contsize=eq.%233&order=unique_id.asc');
  assert.deepEqual(result.rows.map(row => row.unique_id), ['name-a']);
  assert.throws(
    () => inventoryReadFixture.read(rows, 'commonname=ilike.*Holly*'),
    /unsupported exact filter commonname/
  );
});
