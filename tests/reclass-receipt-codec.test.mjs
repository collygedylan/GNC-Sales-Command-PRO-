import assert from 'node:assert/strict';
import test from 'node:test';
import { contracts } from '../services/database-contracts.generated.ts';
import { matchesSchema } from '../services/database-contract-runtime.ts';
import { decodeInventoryReclassReceipt } from '../services/reclassReceipt.ts';
import { confirmedInventoryReclassMoveReceipt, createInventoryReclassMovesService } from '../services/reclassMoves.ts';
import { compactReclassReceiptFixture } from './fixtures/reclass-receipt.ts';

const columns = Object.keys(contracts.tables.ph_master_inventory.row.object).sort();
const sourceIdentity = { unique_id: 'source-1', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'C.12.001',
  lotcode: '27.F1', season: 'F1', ptronhand: '50', ptravailable: '40' };
const command = { commandId: 'reclass-codec-command-0001', expectedRevision: 41,
  moves: [{ source: { uniqueId: 'source-1', identity: sourceIdentity },
    lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
const completeRow = values => ({ ...Object.fromEntries(columns.map(column => [column, null])), ...values });
const sourceRow = completeRow({ ...sourceIdentity, ptronhand: '30', ptravailable: '20', flyer_match: 0, av_note: '',
  last_updated: '2026-10-16T12:34:56.123456+00:00' });
const targetRow = completeRow({ ...sourceIdentity, unique_id: 'target-1', lotcode: '27.U1', season: 'U1', ptronhand: '20', ptravailable: '20' });
const receipt = { ok: true, commandId: command.commandId, requestId: 'request-1', revision: 42, status: 'applied', importStatus: 'pending',
  rows: [sourceRow, targetRow].map(row => ({ table: 'ph_master_inventory', row })),
  movements: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20, sourceUniqueId: 'source-1', destinationUniqueId: 'target-1' }],
  metadata: { enabled: false, count: 0, text: '', untouched: { value: null } } };
const encode = (full = receipt) => ({ ...full, rowEncoding: 'master-null-elision-v1', rowColumns: [...columns],
  rows: full.rows.map(({ table, row }) => ({ table, values: Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) })) });
const invalidEncoding = error => error instanceof Error && error.message === 'INVENTORY_RECLASS_RECEIPT_ENCODING_INVALID';

test('compact receipt reconstructs every generated field without losing zero, empty strings, nulls or false metadata', () => {
  assert.equal(columns.length, 223);
  const wire = encode();
  const original = structuredClone(wire);
  const decoded = decodeInventoryReclassReceipt(wire);
  assert.deepEqual(decoded, receipt);
  assert.deepEqual(wire, original, 'decoding never mutates the wire receipt');
  assert.equal(Object.keys(decoded.rows[0].row).length, columns.length);
  assert.equal(decoded.rows[0].row.flyer_match, 0);
  assert.equal(decoded.rows[0].row.av_note, '');
  assert.equal(decoded.rows[0].row.photo_link, null);
  assert.equal(decoded.metadata.enabled, false);
  assert.deepEqual(decoded.metadata.untouched, { value: null });
  assert.strictEqual(decodeInventoryReclassReceipt(decoded), decoded);
  assert.deepEqual(decodeInventoryReclassReceipt(encode()), decoded, 'replay decodes identically');
});

test('legacy full receipts and unencoded missing/pending statuses remain compatible', () => {
  for (const value of [receipt, { ok: true, status: 'missing' }, { ok: true, status: 'pending' }, { ok: true, status: 'conflict' }]) {
    assert.strictEqual(decodeInventoryReclassReceipt(value), value);
  }
  const legacy = { ...receipt, rows: receipt.rows.map(({ table, row }) => ({ table,
    row: Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) })) };
  assert.equal(confirmedInventoryReclassMoveReceipt(legacy).requestId, receipt.requestId);
});

test('every nonnull master field survives decoding without projection or coercion', () => {
  const fields = contracts.tables.ph_master_inventory.row.object;
  const row = Object.fromEntries(columns.map(column => {
    const schema = fields[column].schema;
    const variants = typeof schema === 'object' && 'oneOf' in schema ? schema.oneOf : [schema];
    return [column, variants.includes('number') ? 0 : `${column}:exact value`];
  }));
  const full = { ...receipt, rows: [{ table: 'ph_master_inventory', row }, receipt.rows[1]] };
  assert.deepEqual(decodeInventoryReclassReceipt(encode(full)), full);
});

test('browser compact fixture requires complete generated rows and decodes losslessly', () => {
  const compact = compactReclassReceiptFixture(receipt);
  assert.deepEqual(compact, encode());
  assert.deepEqual(decodeInventoryReclassReceipt(compact), receipt);
  const { photo_link: _photo, ...incomplete } = sourceRow;
  for (const row of [incomplete, { ...sourceRow, PTRONHAND: '30' }, { ...sourceRow, ptronhand: 30 }]) {
    assert.throws(() => compactReclassReceiptFixture({ ...receipt, rows: [{ table: 'ph_master_inventory', row }, receipt.rows[1]] }), /FIXTURE_ROW_INVALID/);
  }
});

test('200-row receipts retain every field and isolate reconstructed rows and retries', () => {
  const fields = contracts.tables.ph_master_inventory.row.object;
  const rows = Array.from({ length: 200 }, (_, index) => ({ table: 'ph_master_inventory', row: Object.fromEntries(columns.map((column, fieldIndex) => {
    const schema = fields[column].schema;
    const variants = typeof schema === 'object' && 'oneOf' in schema ? schema.oneOf : [schema];
    return [column, column === 'unique_id' ? `decoder-row-${index}` : fieldIndex % (index % 2 === 0 ? 4 : 8) !== 0
      ? null : variants.includes('number') ? 0 : `fixture-${column}`];
  })) }));
  const expected = { ...receipt, rows };
  const wire = compactReclassReceiptFixture(expected);
  const untouchedWire = structuredClone(wire);
  const decoded = decodeInventoryReclassReceipt(wire);
  assert.deepEqual(decoded, expected);
  assert.equal(decoded.rows.length, 200);
  for (const entry of decoded.rows) assert.deepEqual(Object.keys(entry.row), columns);
  decoded.rows[0].row.photo_link = 'local-only';
  assert.deepEqual(decoded.rows[1], expected.rows[1], 'each row owns its restored field map');
  assert.deepEqual(decodeInventoryReclassReceipt(wire), expected, 'local mutation cannot alter the null template or later replay');
  assert.deepEqual(wire, untouchedWire);
  const invalidLastRow = structuredClone(wire);
  invalidLastRow.rows[199].values.unknown_field = 'rejected';
  assert.throws(() => decodeInventoryReclassReceipt(invalidLastRow), invalidEncoding);
  assert.deepEqual(wire, untouchedWire, 'failure in the last row cannot modify the original response');
});

test('supplied-value and omission checks match full-row validation across every generated field', () => {
  const schema = contracts.tables.ph_master_inventory.row;
  const base = encode();
  const candidates = [null, undefined, false, true, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY,
    '', 'typed-value', [], [null], { nested: null }, { nested: [0, false, '', null] }];
  for (const column of columns) {
    for (const candidate of candidates) {
      const values = { ...base.rows[0].values, [column]: candidate };
      const full = { ...sourceRow, [column]: candidate };
      const expected = candidate !== null && candidate !== undefined && matchesSchema(schema, full)
        && typeof full.unique_id === 'string' && Boolean(full.unique_id.trim());
      const input = { ...base, rows: [{ table: 'ph_master_inventory', values }, base.rows[1]] };
      if (expected) assert.deepEqual(decodeInventoryReclassReceipt(input).rows[0].row, full, column);
      else assert.throws(() => decodeInventoryReclassReceipt(input), invalidEncoding, column);
    }
    const values = { ...base.rows[0].values };
    delete values[column];
    const full = { ...sourceRow, [column]: null };
    const input = { ...base, rows: [{ table: 'ph_master_inventory', values }, base.rows[1]] };
    if (matchesSchema(schema, full)) assert.deepEqual(decodeInventoryReclassReceipt(input).rows[0].row, full, column);
    else assert.throws(() => decodeInventoryReclassReceipt(input), invalidEncoding, column);
  }
});

test('a future JSON column retains nested nulls and the recursive schema validation contract', async () => {
  const fields = contracts.tables.ph_master_inventory.row.object;
  const original = fields.photo_link;
  try {
    // Model a future field type without changing the generated source file.
    // Load a fresh decoder so its cached omission rules use this same schema.
    fields.photo_link = { schema: 'json' };
    const { decodeInventoryReclassReceipt: decodeFuture } = await import('../services/reclassReceipt.ts?json-field-parity');
    const nested = { cleared: null, flags: [false, 0, '', null], details: { value: null } };
    const input = encode();
    input.rows[0].values.photo_link = nested;
    const expected = { ...sourceRow, photo_link: nested };
    assert.equal(matchesSchema(contracts.tables.ph_master_inventory.row, expected), true);
    assert.deepEqual(decodeFuture(input).rows[0].row, expected);
    input.rows[0].values.photo_link = { nested: Number.POSITIVE_INFINITY };
    assert.equal(matchesSchema(contracts.tables.ph_master_inventory.row, { ...sourceRow, photo_link: input.rows[0].values.photo_link }), false);
    assert.throws(() => decodeFuture(input), invalidEncoding);
  } finally {
    fields.photo_link = original;
  }
});

test('unknown, duplicated, missing and unsorted schema columns fail closed', () => {
  const unknown = [...columns]; unknown[0] = 'unknown_column';
  const duplicate = [...columns]; duplicate[1] = duplicate[0];
  for (const rowColumns of [unknown, duplicate, columns.slice(1), [...columns, 'extra'], [...columns].reverse(), null, 'columns']) {
    assert.throws(() => decodeInventoryReclassReceipt({ ...encode(), rowColumns }), invalidEncoding);
  }
});

test('unknown codecs and incomplete or mixed encoding metadata fail closed', () => {
  for (const rowEncoding of ['master-null-elision-v2', '', null, false, 1, {}]) {
    assert.throws(() => decodeInventoryReclassReceipt({ ...encode(), rowEncoding }), invalidEncoding);
  }
  const { rowColumns: _columns, ...missingColumns } = encode();
  const { rowEncoding: _encoding, ...missingEncoding } = encode();
  for (const malformed of [missingColumns, missingEncoding, null, [], { ...encode(), rows: receipt.rows },
    { ...encode(), rows: null }, { ...encode(), rows: [] }, { ...encode(), rows: [encode().rows[0]] },
    { ...encode(), rows: Array(201).fill(encode().rows[0]) }]) {
    assert.throws(() => decodeInventoryReclassReceipt(malformed), invalidEncoding);
  }
});

test('compact values require known typed fields and a nonnull unique ID', () => {
  const base = encode();
  const { unique_id: _uid, ...missingUid } = base.rows[0].values;
  const malformedValues = [null, [], missingUid, { ...base.rows[0].values, unique_id: null },
    { ...base.rows[0].values, unique_id: '' }, { ...base.rows[0].values, unique_id: 12 },
    { ...base.rows[0].values, extra: 'unknown' }, { ...base.rows[0].values, photo_link: null },
    { ...base.rows[0].values, av_note: undefined }, { ...base.rows[0].values, av_note: false },
    { ...base.rows[0].values, ptronhand: 30 }, { ...base.rows[0].values, flyer_match: '0' },
    { ...base.rows[0].values, flyer_match: Number.NaN }, { ...base.rows[0].values, photo_link: { nested: null } }];
  for (const values of malformedValues) {
    assert.throws(() => decodeInventoryReclassReceipt({ ...base, rows: [{ ...base.rows[0], values }, base.rows[1]] }), invalidEncoding);
  }
  for (const entry of [{ ...base.rows[0], table: 'profiles' }, { ...base.rows[0], row: sourceRow }]) {
    assert.throws(() => decodeInventoryReclassReceipt({ ...base, rows: [entry, base.rows[1]] }), invalidEncoding);
  }
});

test('service accepts compact submit and status receipts through unchanged command matching', async () => {
  const requests = [];
  const originalCommand = structuredClone(command);
  const service = createInventoryReclassMovesService(async (payload, options) => {
    requests.push({ payload, options });
    return { ok: true, data: encode() };
  });
  const submitted = await service.submit(command);
  assert.deepEqual(submitted.rows, receipt.rows);
  const status = await service.status(command.commandId, command);
  assert.equal(status.status, 'applied');
  assert.deepEqual(status.receipt, submitted);
  assert.equal(requests[0].options.idempotencyKey, command.commandId);
  assert.deepEqual(requests[0].payload.moves, command.moves);
  assert.equal(requests[0].payload.receiptEncoding, 'master-null-elision-v1');
  assert.equal(requests[1].payload.operation, 'status');
  assert.equal(requests[1].payload.receiptEncoding, 'master-null-elision-v1');
  const { action: _action, receiptEncoding: _encoding, ...sentCommand } = requests[0].payload;
  assert.deepEqual(sentCommand, originalCommand, 'transport capability does not change the business command');
  assert.deepEqual(command, originalCommand, 'the persisted retry command remains unchanged');
  const duplicate = encode(); duplicate.rows[1].values.unique_id = 'source-1';
  assert.throws(() => confirmedInventoryReclassMoveReceipt(duplicate), /RECEIPT_ROW_INVALID/);
});

test('malformed compact submit/status outcomes stay uncertain and same-command recovery succeeds', async () => {
  let response = { ...encode(), rowColumns: columns.slice(1) };
  const requests = [];
  const service = createInventoryReclassMovesService(async payload => { requests.push(structuredClone(payload)); return { ok: true, data: response }; });
  const uncertain = error => invalidEncoding(error) && error.outcomeUncertain === true;
  await assert.rejects(service.submit(command), uncertain);
  await assert.rejects(service.status(command.commandId, command), uncertain);
  response = encode();
  assert.equal((await service.status(command.commandId, command)).receipt.requestId, receipt.requestId);
  assert.equal((await service.submit(command)).requestId, receipt.requestId);
  assert.deepEqual(requests[0], requests[3], 'recovery retains the exact original write command');
  for (const status of ['missing', 'pending', 'conflict']) {
    response = { ok: true, status };
    assert.deepEqual(await service.status(command.commandId, command), { status });
  }
  response = { ok: true, status: 'pending', rowEncoding: 'unknown' };
  await assert.rejects(service.status(command.commandId, command), uncertain);
});
