import assert from 'node:assert/strict';
import test from 'node:test';
import { captureInventoryLocationRevision, enrichInventoryLocationRows } from '../supabase/functions/_shared/inventory-location-on-hand.ts';

function fixture(change = value => value) {
  const calls = [];
  const client = { async rpc(name, args) {
    calls.push({ name, args });
    return { data: change({ inventoryRevision: '9007199254740993', rows: args.p_pairs.map(pair => ({
      ...pair, loc_on_hand: pair.locationcode === 'ZERO' ? 0 : pair.locationcode === 'MISSING' ? null : 2000,
      loc_on_hand_revision: '9007199254740993',
    })) }), error: null };
  } };
  return { client, calls };
}

test('page enrichment batches exact string pairs, preserves row count and trusts the full server total', async () => {
  const { client, calls } = fixture();
  const revision = await captureInventoryLocationRevision(client, 'actor');
  const rows = [
    { unique_id: 'a', itemcode: '001973.030.1', locationcode: ' C.16.000 ', ptronhand: 2 },
    { unique_id: 'b', itemcode: '001973.030.1', locationcode: 'c.16.000', ptronhand: 3 },
    { unique_id: 'c', itemcode: '1973.030.1', locationcode: 'C.16.000', ptronhand: 9 },
    { unique_id: 'd', itemcode: '001973.030.1', locationcode: 'I.12.000', ptronhand: 4 },
  ];
  const enriched = await enrichInventoryLocationRows(client, 'actor', rows, revision);
  assert.equal(revision, '9007199254740993');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.p_pairs, []);
  assert.equal(calls[1].args.p_expected_revision, revision);
  assert.deepEqual(calls[1].args.p_pairs, [
    { itemcode: '001973.030.1', locationcode: 'C.16.000' },
    { itemcode: '1973.030.1', locationcode: 'C.16.000' },
    { itemcode: '001973.030.1', locationcode: 'I.12.000' },
  ]);
  assert.equal(enriched.length, rows.length);
  assert.equal(enriched[0].loc_on_hand, 2000, 'never sums this bounded page');
  assert.equal(rows[0].loc_on_hand, undefined, 'does not mutate source rows');
});

test('valid zero, explicit unknown and missing identity remain distinct from absent payload fields', async () => {
  const { client } = fixture();
  const result = await enrichInventoryLocationRows(client, 'actor', [
    { itemcode: 'A', locationcode: 'ZERO' }, { itemcode: 'A', locationcode: 'MISSING' }, { itemcode: 'A' },
  ], '9007199254740993');
  assert.deepEqual(result.map(row => row.loc_on_hand), [0, null, null]);
  assert.ok(result.every(row => row.loc_on_hand_revision === '9007199254740993'));
});

test('source revision races, missing pairs, duplicate pairs and foreign response keys reject the page', async () => {
  for (const change of [
    data => ({ ...data, inventoryRevision: '9007199254740994' }),
    data => ({ ...data, rows: [] }),
    data => ({ ...data, rows: [...data.rows, ...data.rows] }),
    data => ({ ...data, rows: data.rows.map(row => ({ ...row, itemcode: 'OTHER' })) }),
    data => ({ ...data, rows: data.rows.map(row => ({ ...row, loc_on_hand: 'UNKNOWN' })) }),
    data => ({ ...data, rows: data.rows.map(row => ({ ...row, loc_on_hand_revision: '1' })) }),
  ]) {
    const { client } = fixture(change);
    await assert.rejects(enrichInventoryLocationRows(client, 'actor', [{ itemcode: 'A', locationcode: 'C' }], '9007199254740993'), /LOC_ON_HAND_/);
  }
});

test('enrichment enforces the page bound and fences even empty pages', async () => {
  const { client, calls } = fixture();
  const rows = Array.from({ length: 500 }, (_, index) => ({ itemcode: String(index), locationcode: 'C' }));
  assert.equal((await enrichInventoryLocationRows(client, 'actor', rows, '9007199254740993')).length, 500);
  await assert.rejects(enrichInventoryLocationRows(client, 'actor', [...rows, rows[0]], '9007199254740993'), /RESPONSE_INVALID/);
  assert.deepEqual(await enrichInventoryLocationRows(client, 'actor', [], '9007199254740993'), []);
  assert.equal(calls.length, 2);
});
