import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { historicalImportWindowOpen, mapArchiveRow, parseArguments, parseCsvRows } from '../scripts/fast-historical-archive-import.mjs';

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
