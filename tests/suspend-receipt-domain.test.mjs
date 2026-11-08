import test from 'node:test';
import assert from 'node:assert/strict';
import { suspendTagReceiptMatchesSource } from '../src/core/suspend-receipt-domain.js';

test('editable Suspend receipts must match the submitted source identity', () => {
  for (const operation of ['save', 'complete', 'close']) {
    assert.equal(suspendTagReceiptMatchesSource(operation, { sourceUid: 'source-1' }, { row: { unique_id: 'source-1', date_completed: '2026-09-08T16:00:00Z' } }), true);
    for (const result of [{ row: { unique_id: 'source-2' } }, { row: { unique_id: ' source-1 ' } }, { row: {} }, {}, null]) {
      assert.equal(suspendTagReceiptMatchesSource(operation, { sourceUid: 'source-1' }, result), false);
    }
    assert.equal(suspendTagReceiptMatchesSource(operation, {}, { row: { unique_id: 'source-1' } }), false);
  }
  for (const date of [null, '', 'invalid']) {
    assert.equal(suspendTagReceiptMatchesSource('complete', { sourceUid: 'source-1' }, { row: { unique_id: 'source-1', date_completed: date } }), false);
  }
  assert.equal(suspendTagReceiptMatchesSource('rows', {}, { rows: [] }), true);
  assert.equal(suspendTagReceiptMatchesSource('add_candidates', {}, { row: { unique_id: 'new-candidate' } }), true);
});
