import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { archiveRowStateHash, historicalImportWindowOpen, mapArchiveRow, parseArguments, parseCsvRows } from '../scripts/fast-historical-archive-import.mjs';

test('historical archive importer enforces bounded workers, batches, and the Chicago window', () => {
  const options = parseArguments(['--input', '.', '--workers', '16', '--batch-size', '2000']);
  assert.equal(options.workers, 16);
  assert.equal(options.batchSize, 2000);
  assert.equal(historicalImportWindowOpen(new Date('2026-10-26T05:00:00Z')), true);
  assert.equal(historicalImportWindowOpen(new Date('2026-10-25T20:00:00Z')), false);
  assert.throws(() => parseArguments(['--input', '.', '--workers', '17']), /between 1 and 16/);
  assert.throws(() => parseArguments(['--input', '.', '--batch-size', '2001']), /between 1 and 2000/);
});

test('historical archive importer streams quoted CSV and builds stable archive rows', async () => {
  const parsed = [];
  for await (const row of parseCsvRows(Readable.from(['ItemCode,Common Name,QuantityOrdered,ListPrice\n', '00123,"Red, Maple",2,12.50\n']))) parsed.push(row);
  assert.deepEqual(parsed, [['ItemCode', 'Common Name', 'QuantityOrdered', 'ListPrice'], ['00123', 'Red, Maple', '2', '12.50']]);
  const mapped = mapArchiveRow('orders', { itemcode: '00123', commonname: 'Red Maple', quantityordered: '2', listprice: '12.50' },
    { fileHash: 'a'.repeat(64), fileName: 'orders.csv', modifiedTime: '2026-10-10T12:00:00Z', rowNumber: 2 });
  assert.match(mapped.order_line_key, /^[0-9a-f]{64}$/);
  assert.equal(mapped.line_dollar_value, 25);
  assert.equal(mapped.customer_name, 'Unassigned');
  assert.equal(mapped.source_file_name, 'orders.csv');
});

test('historical archive identity ignores file provenance but preserves business changes', () => {
  const businessRow = { itemcode: '00123', commonname: 'Red Maple', locationcode: 'A.01.000', lotcode: '27.F1',
    quantityordered: '2', listprice: '12.50', customer: 'Austin Nursery', ordernumber: 'SO-100' };
  const first = mapArchiveRow('orders', businessRow,
    { fileHash: 'a'.repeat(64), fileName: 'orders-day-1.csv', modifiedTime: '2026-10-10T12:00:00Z', rowNumber: 2 });
  const fifth = mapArchiveRow('orders', businessRow,
    { fileHash: 'e'.repeat(64), fileName: 'orders-day-5.csv', modifiedTime: '2026-10-14T12:00:00Z', rowNumber: 900 });
  const changed = mapArchiveRow('orders', { ...businessRow, quantityordered: '3' },
    { fileHash: 'f'.repeat(64), fileName: 'orders-day-6.csv', modifiedTime: '2026-10-15T12:00:00Z', rowNumber: 2 });
  assert.equal(archiveRowStateHash('orders', first), archiveRowStateHash('orders', fifth));
  assert.equal(first.row_state_hash, fifth.row_state_hash);
  assert.equal(first.order_line_key, fifth.order_line_key);
  assert.notEqual(first.row_state_hash, changed.row_state_hash);
  assert.notEqual(first.order_line_key, changed.order_line_key);
  assert.notEqual(first.source_file_name, fifth.source_file_name);
});
