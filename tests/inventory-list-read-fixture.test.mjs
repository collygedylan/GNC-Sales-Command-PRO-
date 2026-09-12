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
    () => inventoryReadFixture.read(rows, 'commonname=match.*Holly*'),
    /unsupported exact filter commonname/
  );
});

test('actual Drive ILIKE lookup filters size, nulls and nonmatching names before pagination', () => {
  const rows = [
    { unique_id: 'b', commonname: 'SYNTHETIC — HL HOLLY', contsize: '#3' },
    { unique_id: 'a', commonname: 'Synthetic HL Holly', contsize: '#3' },
    { unique_id: 'size', commonname: 'Synthetic HL Holly', contsize: '#5' },
    { unique_id: 'other', commonname: 'Synthetic Other Holly', contsize: '#3' },
    { unique_id: 'unknown', commonname: null, contsize: '#3' }
  ];
  const result = inventoryReadFixture.read(rows, 'commonname=ilike.*synthetic*hl*holly*&contsize=eq.%233&order=unique_id.asc&offset=1&limit=1');
  assert.deepEqual(result.uniqueIds, ['b']);
  assert.equal(result.total, 2);
  assert.deepEqual(inventoryReadFixture.read(rows, 'commonname=ilike.%25synthetic%25hl%25holly%25&contsize=eq.%233').uniqueIds, ['b', 'a']);
});

test('ILIKE treats regex punctuation literally and preserves SQL escaping and single-character matching', () => {
  const names = ['A.[B](C)+? $ Holly', 'AxbC Holly', 'Holly', 'Holly\n', 'Holly_5%', 'HollyX5foo', 'Holly15%'];
  const rows = names.map((commonname, index) => ({ unique_id: String(index), commonname }));
  const lookup = pattern => inventoryReadFixture.read(rows, new URLSearchParams({ commonname: `ilike.${pattern}` }).toString()).uniqueIds;
  assert.deepEqual(lookup('a.[b](c)+? $ holly'), ['0']);
  assert.deepEqual(lookup('holly'), ['2']);
  assert.deepEqual(lookup('holly\\_5\\%'), ['4']);
  assert.deepEqual(lookup('holly_5%'), ['4', '5', '6']);
  assert.throws(() => lookup('holly\\'), /unterminated commonname escape/);
  assert.throws(() => inventoryReadFixture.read(rows, 'itemcode=ilike.*Holly*'), /unsupported exact filter itemcode/);
});
