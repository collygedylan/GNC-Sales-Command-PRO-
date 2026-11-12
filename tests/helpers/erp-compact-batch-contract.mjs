import assert from 'node:assert/strict';

export async function assertCompactErpBatchContract() {
  const { compactErpRowsPreservingNullColumnUnion } = await import('../../supabase/functions/_shared/erp-sync.mjs');
  const original = [{ unique_id:'a', itemcode:'001', note:null, quantity:'3' },
    { unique_id:'b', itemcode:'002', note:null, quantity:null },
    { unique_id:'c', itemcode:'003', note:'new', quantity:null, later_column:null }];
  const rows = original.map(row => ({ ...row }));
  compactErpRowsPreservingNullColumnUnion(rows);
  const columns = list => [...new Set(list.flatMap(Object.keys))].sort();
  assert.deepEqual(columns(rows), columns(original));
  const expand = list => list.map(row => Object.fromEntries(columns(original).map(key => [key, row[key] ?? null])));
  assert.deepEqual(expand(rows), expand(original));
  assert.ok(JSON.stringify(rows).length < JSON.stringify(original).length);
}
