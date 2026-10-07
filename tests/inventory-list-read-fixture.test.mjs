// @test-group: inventory
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


test('immutable fixture memoization retains validation and mutable corrections remain observable', () => {
  const frozen = Object.freeze({ unique_id: 'frozen', ptravailable: '0' });
  assert.equal(inventoryReadFixture.row(frozen), inventoryReadFixture.row(frozen));
  assert.throws(() => inventoryReadFixture.row(Object.freeze({ unique_id: 'bad', unknown_column: 'not physical' })), /nonphysical/);
  const mutable = { unique_id: 'mutable', ptravailable: '1' };
  assert.equal(inventoryReadFixture.read([mutable]).rows[0].ptravailable, '1');
  mutable.ptravailable = '2';
  assert.equal(inventoryReadFixture.read([mutable]).rows[0].ptravailable, '2');
});


test('historical AV season scoping filters before calculating the total and paging', () => {
  const rows = ['F1', 'S1', 'X'].map((season, index) => ({ unique_id: String(index), season }));
  const result = inventoryReadFixture.read(rows, 'season=in.(F1,S1,U1,U2)&order=unique_id.asc&limit=1&offset=1');
  assert.equal(result.total, 2); assert.equal(result.rows[0].season, 'S1');
});

test('inventory master-page mocks return exact full and browse projection contracts', () => {
  const physicalColumns = new Set(inventoryReadFixture.physicalColumns);
  const fullColumns = inventoryReadFixture.projections.full;
  const browseColumns = inventoryReadFixture.projections.browse;
  assert.equal(physicalColumns.size, 213);
  assert.equal(fullColumns.length, 213);
  assert.deepEqual(new Set(fullColumns), physicalColumns);
  assert.equal(browseColumns.length, 161);
  assert.ok(browseColumns.every(column => physicalColumns.has(column)));

  const sourceRow = inventoryReadFixture.row({ unique_id: 'projection-row', ptravailable: '0', ptronhand: '12' });
  const browse = inventoryReadFixture.readMasterPage([sourceRow], { dataset: 'master', projection: 'browse', limit: 100 });
  assert.equal(browse.projection, 'browse');
  assert.equal(browse.fieldCoverage, 'browse');
  assert.equal(browse.columns.length, 161);
  assert.equal(browse.rows[0].ptravailable, '0');
  assert.equal(Object.hasOwn(browse.rows[0], 'concat'), false);

  const full = inventoryReadFixture.readMasterPage([sourceRow], { dataset: 'lookup', projection: 'full', uniqueId: 'projection-row', limit: 1 });
  assert.equal(full.projection, 'full');
  assert.equal(full.fieldCoverage, 'full');
  assert.equal(full.columns.length, 213);
  assert.equal(full.rows[0].ptravailable, '0');
  assert.equal(full.rows[0].ptronhand, '12');
  assert.equal(full.total, 1);
});
