import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function context() {
  const result = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => Array.from(createHash(algorithm).update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    },
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(result);
  return result;
}
function invoke(ctx, name, ...args) {
  ctx.__args = args;
  return vm.runInContext(`${name}(...__args)`, ctx);
}
const plain = value => JSON.parse(JSON.stringify(value));
function csv(completion = '', quantity = '10', completionHeader = 'DATE_COMPLETED') {
  return [
    ['ITEMCODE', 'DOCK', 'CUSTOMERNAME', 'CONSIGNEENAME', 'STOPNUMBER', 'TRANSACTIONNUMBER', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SUSPEND', 'SUSPEND_TO', 'QUANTITYORDERED', completionHeader],
    ['SYNTHETIC-ITEM', 'SYNTHETIC-DOCK', 'Fictitious Customer', 'Fictitious Consignee', '1', 'TEST-TX', '#3', 'TEST.LOC', '27.F1', 'SUSPEND', 'DC', quantity, completion],
  ];
}
const build = (ctx, data, existing = [], table = 'ph_soc_master') => invoke(ctx, 'buildStandardPayload', data, table, existing, '2026-09-08T17:00:00Z', 'synthetic.csv');

test('SOC imports omit blank, null-like, and nonblank completion columns uniformly', () => {
  const ctx = context();
  for (const header of ['DATE_COMPLETED', 'Date Completed', 'date-completed']) {
    for (const value of ['', 'NULL', '2026-09-01T00:00:00Z']) {
      const row = build(ctx, csv(value, '10', header)).upserts[0];
      assert.ok(row);
      assert.equal(Object.hasOwn(row, 'date_completed'), false);
      assert.equal(row.suspend, 'SUSPEND');
      assert.equal(row.quantityordered, '10');
    }
  }
});

test('unchanged SOC imports stay unchanged after an app completion', () => {
  const ctx = context();
  const source = plain(build(ctx, csv()).upserts[0]);
  const completed = { ...source, date_completed: '2026-09-08T17:05:00Z' };
  for (const completion of ['', 'NULL', '2026-01-01T00:00:00Z']) {
    const result = build(ctx, csv(completion), [completed]);
    assert.equal(result.upserts.length, 0, 'completion-only CSV differences must not trigger upserts');
    assert.equal(result.stats.unchangedRows, 1);
    assert.ok(result.seenIds.has(completed.unique_id), 'completed source is still present in snapshot');
  }
});

test('changed SOC inventory upsert preserves a concurrent Done by omission, not a stale copy', () => {
  const ctx = context();
  const source = plain(build(ctx, csv()).upserts[0]);
  const staleSnapshot = { ...source, date_completed: null };
  const upsert = plain(build(ctx, csv('', '12'), [staleSnapshot]).upserts[0]);
  assert.equal(Object.hasOwn(upsert, 'date_completed'), false);
  assert.equal(upsert.quantityordered, '12');
  const serverRow = { ...source, date_completed: '2026-09-08T17:05:00Z' };
  assert.equal({ ...serverRow, ...upsert }.date_completed, serverRow.date_completed);
});

test('completion changes do not affect SOC payload hashing or reintroduce a chunk-null field', () => {
  const ctx = context();
  const blank = build(ctx, csv()).upserts[0];
  const supplied = build(ctx, csv('2026-01-01T00:00:00Z')).upserts[0];
  assert.equal(invoke(ctx, 'buildRowSyncHash_', blank), invoke(ctx, 'buildRowSyncHash_', supplied));
  const chunk = invoke(ctx, 'normalizeSupabaseUpsertChunk', [blank, supplied]);
  assert.equal(chunk.length, 2);
  for (const row of chunk) assert.equal(Object.hasOwn(row, 'date_completed'), false);
  // SOC currently uses field comparisons rather than persisted hashes. Both
  // paths must ignore the app-owned completion column.
  assert.equal(invoke(ctx, 'didDeltaRowChange_', blank, supplied), false);
});

test('site-split SOC variants preserve the same app-owned completion contract', () => {
  const ctx = context();
  for (const table of ['ph_soc_master', 'tx_soc_master', 'nc_soc_master', 'hl_soc_master']) {
    assert.equal(Object.hasOwn(build(ctx, csv('2026-01-01T00:00:00Z'), [], table).upserts[0], 'date_completed'), false);
  }
});

test('master, reserve, and request payload completion behavior is unchanged', () => {
  const ctx = context();
  const completedAt = '2026-01-01T00:00:00Z';
  for (const table of ['ph_master_inventory', 'ph_reserves', 'ph_active_request']) {
    assert.equal(build(ctx, csv(completedAt), [], table).upserts[0].date_completed, completedAt);
    assert.equal(build(ctx, csv(), [], table).upserts[0].date_completed, null);
  }
});
