import assert from 'node:assert/strict';
import test from 'node:test';
import { featureFailures } from '../scripts/fast-feature-lock.mjs';

const resolver = `
function resolveCanonicalInventoryRow(row) {
  return projectCanonicalInventoryRow(row);
}
function projectCanonicalInventoryRow(row) {
  const target = resolveCanonicalInventoryTarget(row, masterInventoryById, masterInventoryByItemCode);
  return { ...target, noteScope: target.locationcode };
}
function resolveCanonicalInventoryTarget(row, byId, byItemCode) {
  const indexed = byId.get(row.unique_id);
  return canonicalInventorySameLot(indexed, row) ? indexed : byItemCode.get(row.itemcode);
}`;

function resolverFailures(source) {
  return featureFailures(source, '', 'fixture')
    .filter(issue => issue.startsWith('fixture: canonical inventory resolver '));
}

test('the feature lock accepts an indexed, lot-checked canonical resolver façade', () => {
  assert.deepEqual(resolverFailures(resolver), []);
});

test('the feature lock rejects a missing canonical delegate', () => {
  const source = resolver.replace('return projectCanonicalInventoryRow(row);', 'return row;');
  assert.deepEqual(resolverFailures(source), ['fixture: canonical inventory resolver missing']);
});

test('the feature lock rejects missing inventory indexes or note scope', () => {
  const expected = ['fixture: canonical inventory resolver lost indexed row and scoped evidence'];
  assert.deepEqual(resolverFailures(resolver.replace('masterInventoryById, masterInventoryByItemCode', 'visibleRows')), expected);
  assert.deepEqual(resolverFailures(resolver.replace('noteScope: target.locationcode', 'location: target.locationcode')), expected);
});

test('the feature lock rejects bypassing exact lot validation', () => {
  const source = resolver.replace('canonicalInventorySameLot(indexed, row) ? indexed : byItemCode.get(row.itemcode)', 'indexed');
  assert.deepEqual(resolverFailures(source), ['fixture: canonical inventory resolver lost exact lot validation']);
});
