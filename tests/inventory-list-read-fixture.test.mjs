import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createInventoryReadFixture, inventoryReadFixture as fixture } from './fixtures/inventory-list-read-fixture.mjs';

const schema = JSON.parse(readFileSync(new URL('./fixtures/inventory-list-schema.json', import.meta.url), 'utf8')).schema;
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../assets/inventory-list-contract.js', import.meta.url), 'utf8'), context);
const contract = context.module.exports;
const full = (unique_id, overrides = {}) => fixture.row({ unique_id, itemcode: `SYNTHETIC-${unique_id}`, ...overrides });

test('real compact SELECT produces exactly its aliases and decodes to the same physical values', () => {
  const source = [full('B', { ptravailable: '20', flyer_match: 0 }), full('A', { photo_link: null, spec: '' })];
  const result = fixture.read(source, contract.buildQuery());
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.uniqueIds, ['A', 'B']);
  assert.equal(result.exact, false);
  assert.deepEqual(Object.keys(result.rows[0]), Array.from(contract.aliases));
  const decoded = JSON.parse(JSON.stringify(contract.decodeRows(result.rows)));
  assert.deepEqual(decoded, source.slice().reverse().map(row => Object.fromEntries(Array.from(contract.columns, key => [key, row[key]]))));
  assert.equal(Object.hasOwn(decoded[0], 'unitprice'), false, 'omitted full-only values are absent');
  assert.equal(Object.keys(source[0]).length, 213, 'projection never mutates canonical source');
});

test('exact eq/in reads select identities before full-row response and pagination', () => {
  const oddId = 'SYNTHETIC,quoted"\\id';
  const source = [full('A'), full(oddId), full('B'), full('C')];
  const eq = fixture.read(source, new URLSearchParams({ select: '*', unique_id: 'eq.B' }));
  assert.equal(eq.exact, true); assert.deepEqual(eq.uniqueIds, ['B']);
  assert.equal(Object.keys(eq.rows[0]).length, 213);
  const quoted = fixture.read(source, new URLSearchParams({ select: '*', unique_id: `in.(${JSON.stringify(oddId)},"B")`, order: 'unique_id.asc' }));
  assert.deepEqual(quoted.uniqueIds, ['B', oddId]);
  assert.equal(quoted.rows.every(row => Object.keys(row).length === 213), true);
  assert.deepEqual(fixture.read(source, 'select=unique_id&unique_id=in.(A,B,C)&order=unique_id.desc&offset=1&limit=1').rows, [{ unique_id: 'B' }]);
  assert.deepEqual(fixture.read(source, 'select=*&unique_id=eq.missing').rows, [], 'missing identity must not fall back to all rows');
  eq.rows[0].itemcode = 'LOCAL DRAFT';
  assert.equal(source[2].itemcode, 'SYNTHETIC-B', 'full responses are detached from fixture canonical values');
});

test('schema builder preserves null and physical types without inventing fields', () => {
  const row = fixture.row({ UNIQUE_ID: 'A', PTRAVAILABLE: 20, MATCH: '00100', FLYER_MATCH: 0,
    PHOTO_LINK: null, SPEC: '', SALEYEAR: '27', SALESYEAR: '27', SOURCE_TABLE: 'ph_master_inventory', SAVED_PHOTO_LINK: '' });
  assert.deepEqual(Object.keys(row), schema.map(column => column.name));
  assert.equal(row.ptravailable, '20'); assert.equal(row.match, '00100');
  assert.equal(row.flyer_match, 0); assert.equal(row.photo_link, null); assert.equal(row.spec, '');
  assert.equal(row.unitprice, null); assert.equal(row.quantityordered, null);
  assert.equal(Object.hasOwn(row, 'source_table'), false); assert.equal(Object.hasOwn(row, 'salesyear'), false);
  assert.deepEqual(fixture.read([row], 'select=f0:unique_id,f1:photo_link,f2:flyer_match,f3:spec').rows,
    [{ f0: 'A', f1: null, f2: 0, f3: '' }]);
});

test('unsupported queries, aliases, IDs and physical values fail closed', () => {
  const source = [full('A')];
  for (const query of ['select=made_up', 'select=f0:unique_id,f0:itemcode', 'unique_id=like.A*',
    'unique_id=in.()', 'unique_id=in.("A)', 'unique_id=in.(A,)', 'order=itemcode.asc', 'offset=-1',
    'limit=NaN', 'select=unique_id&select=itemcode', 'or=(unique_id.eq.A)']) {
    assert.throws(() => fixture.read(source, query), /INVENTORY_READ_FIXTURE_INVALID|JSON/);
  }
  for (const values of [{ unique_id: 'A', made_up: null }, { unique_id: 'A', flyer_match: '10' },
    { unique_id: 'A', itemcode: false }, { unique_id: 'A', UNIQUE_ID: 'B' },
    { unique_id: 'A', salesyear: '28', saleyear: '27' }, { unique_id: '' }]) {
    assert.throws(() => fixture.row(values), /INVENTORY_READ_FIXTURE_INVALID/);
  }
});

test('browser-installed factory is self-contained and uses the same schema contract', () => {
  const browserFactory = vm.runInNewContext(`(${createInventoryReadFixture.toString()})`, { URLSearchParams });
  const browserFixture = browserFactory(schema);
  const result = browserFixture.read([{ UNIQUE_ID: 'B', PTRAVAILABLE: 20 }], contract.buildQuery());
  assert.deepEqual(JSON.parse(JSON.stringify(result)), fixture.read([{ UNIQUE_ID: 'B', PTRAVAILABLE: 20 }], contract.buildQuery()));
});
