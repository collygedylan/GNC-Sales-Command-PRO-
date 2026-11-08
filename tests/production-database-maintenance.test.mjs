import test from 'node:test';
import assert from 'node:assert/strict';
import { safeInvalidIndex } from '../scripts/maintain-production-database.mjs';

const safe = { indisvalid: false, indisready: true, indislive: true, owner_access: true,
  original_valid: true, original_ready: true, equivalent: true, constraints: '0', dependents: '0' };

test('only invalid maintained duplicate remnants with valid originals can be removed', () => {
  assert.equal(safeInvalidIndex(safe), true);
  assert.equal(safeInvalidIndex(undefined), false);
  for (const field of ['indisready', 'indislive', 'owner_access', 'original_valid', 'original_ready', 'equivalent']) {
    assert.equal(safeInvalidIndex({ ...safe, [field]: false }), false, field);
  }
  assert.equal(safeInvalidIndex({ ...safe, indisvalid: true }), false);
  assert.equal(safeInvalidIndex({ ...safe, indisvalid: undefined }), false);
  assert.equal(safeInvalidIndex({ ...safe, original_valid: 'true' }), false);
  assert.equal(safeInvalidIndex({ ...safe, constraints: '1' }), false);
  assert.equal(safeInvalidIndex({ ...safe, dependents: '1' }), false);
});
