import assert from 'node:assert/strict';
import test from 'node:test';
import { RECLASS_SMART_SHIELD_POLICY, validateReclassSmartShieldProposals } from '../services/reclassSmartShield.ts';

function payload() {
  return {
    workflowPolicyVersion: RECLASS_SMART_SHIELD_POLICY,
    transaction: { requestActions: ['priority_change'], holdStopProposals: [] },
    source: { unique_id: 'origin' },
    rowOverlays: [{ unique_id: 'origin', expected: { priority: '2', holdstopcode: null, holdstopreason: null },
      proposals: [{ action: 'priority_change', priority: '1' }] }],
  };
}

test('V6 typed boundary retains nullable expected fields and mixed inquiry proposals', () => {
  const value = payload();
  value.rowOverlays[0].proposals.push({ action: 'move_up', applyHold: false, holdReason: '',
    splits: [{ quantity: 7, destinationSeason: 'F1' }] }, { action: 'sheared', quantity: 3 });
  const unchanged = structuredClone(value);
  validateReclassSmartShieldProposals(value);
  assert.deepEqual(value, unchanged, 'validation must not fabricate server scope or alter the inquiry');
});

test('V6 requires explicit nullable snapshots for every live-edit origin', () => {
  for (const key of ['priority', 'holdstopcode', 'holdstopreason']) {
    for (const invalid of [undefined, 1, false, {}]) {
      const value = payload();
      if (invalid === undefined) delete value.rowOverlays[0].expected[key];
      else value.rowOverlays[0].expected[key] = invalid;
      assert.throws(() => validateReclassSmartShieldProposals(value), /EXPECTED_FIELDS_INVALID/);
    }
  }
});

test('a hold names its selected origin without granting caller-controlled fanout', () => {
  const value = payload();
  value.rowOverlays.push({ unique_id: 'another-selected-row', expected: {
    priority: '3', holdstopcode: '', holdstopreason: '',
  }, proposals: [] });
  value.transaction.holdStopProposals = [{ action: 'hold', reason: 'Review', sourceUid: 'another-selected-row' }];
  validateReclassSmartShieldProposals(value);
  for (const sourceUid of ['unknown', ' another-selected-row ', null, 17]) {
    const invalid = structuredClone(value);
    invalid.transaction.holdStopProposals[0].sourceUid = sourceUid;
    assert.throws(() => validateReclassSmartShieldProposals(invalid), /HOLD_(?:SOURCE|PROPOSAL)_INVALID/);
  }
  const forged = structuredClone(value);
  forged.transaction.holdStopProposals[0].fanout = true;
  assert.throws(() => validateReclassSmartShieldProposals(forged), /HOLD_PROPOSAL_INVALID/);
});

test('Move Up rejects hold instructions anywhere in the same V6 inquiry', () => {
  for (const mode of ['global', 'same-row', 'another-row']) {
    const value = payload();
    value.rowOverlays[0].proposals.push({ action: 'move_up', applyHold: false, holdReason: '' });
    if (mode === 'global') value.transaction.holdStopProposals = [{ action: 'hold', reason: 'Review', sourceUid: 'origin' }];
    else if (mode === 'same-row') value.rowOverlays[0].proposals[1].applyHold = true;
    else value.rowOverlays.push({ unique_id: 'another-selected-row', proposals: [
      { action: 'move_down', applyHold: true, holdReason: 'Review moved quantity' },
    ] });
    assert.throws(() => validateReclassSmartShieldProposals(value), /MOVE_UP_HOLD_CONFLICT/);
  }
});

test('V6 preserves strict sheared quantities and leaves older contracts untouched', () => {
  for (const version of ['reclass-action-workflow-v3-20260901', 'reclass-action-workflow-v4-split-moves-20261006', 'reclass-action-workflow-v5-sheared-20261008']) {
    validateReclassSmartShieldProposals({ workflowPolicyVersion: version });
  }
  const value = payload();
  value.rowOverlays[0].proposals.push({ action: 'sheared', quantity: 0 });
  assert.throws(() => validateReclassSmartShieldProposals(value), /SHEARED_QUANTITY_INVALID/);
  value.rowOverlays[0].proposals = [];
  assert.throws(() => validateReclassSmartShieldProposals(value), /LIVE_ACTION_REQUIRED/);
});
